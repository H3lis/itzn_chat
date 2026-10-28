import time
import json
from chatbot_demo_v2.config.settings import load_settings
from chatbot_demo_v2.app.dependencies import build_context
from chatbot_demo_v2.app.api import _build_init_state, _shape_response
from chatbot_demo_v2.app.schemas import ChatRequest
from chatbot_demo_v2.observability.langsmith import build_invoke_config

s = load_settings()
ctx = build_context(s)

session_id = "test_perf_session"
thread_id = ctx.session_registry.thread_id(session_id)
config = build_invoke_config(s, session_id, thread_id)

test_questions = [
    "인터넷이 안돼요",
    "와이파이 비밀번호가 뭔가요?",
    "선생님 우리반 와이파이가 자꾸 끊기는데 어떻게 해야하죠?",
]

for q in test_questions:
    print(f"\n========================================================")
    print(f"Testing Question: {q}")
    print(f"========================================================")
    body = ChatRequest(message=q, session_id=session_id)
    payload_in = _build_init_state(body, session_id, thread_id)

    t_start = time.time()
    node_timings = {}
    last_t = t_start

    for mode, chunk in ctx.graph.stream(payload_in, config, stream_mode=["updates", "custom"]):
        now = time.time()
        if mode == "updates" and isinstance(chunk, dict):
            for node_name in chunk:
                dur = now - last_t
                node_timings[node_name] = dur
                print(f"  [NODE] {node_name:<25} -> {dur:.2f}s")
                last_t = now
        elif mode == "custom":
            pass

    total_dur = time.time() - t_start
    print(f"Total Graph Duration: {total_dur:.2f}s")
    
    # 결과 확인
    state_val = ctx.graph.get_state(config).values
    resp = _shape_response(session_id, "run_id", state_val)
    print(f"Route: {resp.route}")
    print(f"Timings: {resp.timings}")
    print(f"Answer snippet: {resp.answer[:150] if resp.answer else 'None'}")
