import os, sys, time
from pathlib import Path
ROOT = Path(r"c:\Users\ITZN\Desktop\챗봇")
sys.path.insert(0, str(ROOT))

os.environ['RAG_BACKEND'] = 'ollama'
os.environ['RAGCORE_CONFIG'] = r'c:\Users\ITZN\Desktop\챗봇\chatbot_demo_v2\ragcore\rag3\config.yaml'
os.environ['OLLAMA_HOST'] = 'http://34.64.143.198:11434'

from chatbot_demo_v2.config.settings import load_settings
from chatbot_demo_v2.app.dependencies import build_context

settings = load_settings()
print(f"Loaded Settings:")
print(f"  robustness_llm_rewrite_enabled: {settings.robustness_llm_rewrite_enabled}")
print(f"  contextualize_enabled: {settings.contextualize_enabled}")
print(f"  composer_faq_enabled: {settings.composer_faq_enabled}")
print(f"  grader_enabled: {settings.grader_enabled}")
print(f"  deadline_seconds: {settings.deadline_seconds if hasattr(settings, 'deadline_seconds') else 'N/A'}")

ctx = build_context(settings=settings)

def run_test(label, query, history=None):
    print(f"\n{'='*20} [{label}] '{query}' {'='*20}")
    state_in = {
        "session_id": f"timing_{int(time.time())}",
        "thread_id": f"timing_thread_{int(time.time())}",
        "input_type": "text",
        "user_input": query,
    }
    if history:
        from langchain_core.messages import HumanMessage, AIMessage
        state_in["messages"] = history
    
    start_t = time.time()
    res = ctx.graph.invoke(state_in, {"configurable": {"thread_id": state_in["thread_id"]}})
    total_elapsed = time.time() - start_t
    
    print(f"Total Elapsed Time: {total_elapsed:.2f}s")
    print(f"Route: {res.get('route')}")
    print(f"Route Reason: {res.get('route_reason')}")
    print(f"Answer Source: {res.get('answer_source')}")
    if res.get("timings"):
        print(f"Timings: {res.get('timings')}")
    if res.get("rag_result") and res.get("rag_result").get("metrics"):
        m = res.get("rag_result").get("metrics")
        print(f"RAG Metrics:")
        print(f"  total_model_calls: {m.get('total_model_calls')}")
        print(f"  timings_seconds: {m.get('timings_seconds')}")
        print(f"  rollback_history: {res.get('rag_result').get('rollback_history')}")
        
    print("\nTrace entries:")
    for t in (res.get("trace") or []):
        print(f"  [{t.get('node')}] {t.get('detail')}")

# Test 1: FAQ query with slight paraphrase (변형 구어체)
run_test("FAQ 변형 구어체", "우리 학교 스쿨넷 통신사 어디야?")

# Test 2: RAG Deep Analysis query (RAG 심층분석)
run_test("RAG 심층분석 질의", "학교 AP 장비에 주황색 불이 깜빡일 때 대처 절차 알려줘")
