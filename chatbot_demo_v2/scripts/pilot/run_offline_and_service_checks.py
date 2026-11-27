"""API 경로 밖의 보조 검증: 오프라인 HTML 시나리오 데이터, HistoryService 마스커 예외 회귀, 방화벽 단위 판정.

사용법(저장소 루트):
    .venv\\Scripts\\python.exe -X utf8 테스트결과_Claude\\scripts\\run_offline_and_service_checks.py

결과는 테스트결과_Claude/raw/offline_service_checks.json 에 저장한다(합성값은 {slot}로 치환).
"""
from __future__ import annotations

import json
import os
import logging
import re
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
logging.disable(logging.WARNING)

OUT = Path(os.environ.get("PILOT_OUT_DIR") or ROOT / "테스트결과_Claude" / "raw") / "offline_service_checks.json"
FIXTURES = {
    "CL_PII_001": ROOT / "테스트데이터_Claude/pii_fixtures.json",
    "P_PII_001": ROOT / "테스트데이터_Codex/pii_fixtures.json",
    "GEMINI_PII_001": ROOT / "테스트데이터_Gemini/pii_fixtures.json",
}
# 각 데이터셋 DS-5C 입력 문장(템플릿)
TEMPLATES = {
    "CL_PII_001": "{synthetic_name}입니다. 3층 과학실 태블릿이 와이파이에 안 붙어요. 단말 시리얼 {synthetic_serial}, MAC {synthetic_mac}, IP {synthetic_ip}이고 연락은 {synthetic_phone}로 주세요.",
    "P_PII_001": "{synthetic_name}\n연락처 {synthetic_phone} / IP {synthetic_ip} / MAC {synthetic_mac} / 시리얼 번호 {synthetic_serial}\n와이파이는 연결됐다고 뜨는데 인터넷이 안 돼요.",
    "GEMINI_PII_001": "{synthetic_name}\n연락처 {synthetic_phone} / 교실 PC IP {synthetic_ip} / MAC {synthetic_mac} / 단말 시리얼 {synthetic_serial}\n교실 인터넷 연결이 안 됩니다.",
}
ANSWER_TEMPLATE = "{synthetic_name} 선생님, 시리얼 {synthetic_serial} 단말의 IP {synthetic_ip}를 확인해 주세요."
SCENARIO_PATHS = {
    "Claude/CL_DS1B_002": [("root", "my_pc_only"), ("my_pc.port_led", "led_off"), ("my_pc.recheck", "still_dead")],
    "Codex/P_DS1B_002": [("root", "tablet_wifi")],
    "Gemini/PILOT_DS1C_001": [("root", "ap_no_light")],
}


def slots_of(fx_id: str) -> dict:
    fx = json.loads(FIXTURES[fx_id].read_text(encoding="utf-8"))[fx_id]
    return {v["slot"]: v["value"] for v in fx["values"]}


def check_offline_html() -> dict:
    html = (ROOT / "학교챗봇_장애대응가이드_오프라인.html").read_text(encoding="utf-8")
    m = re.search(r"root_node_id:`(\w+)`,nodes:JSON\.parse\(`(.*?)`\)", html, re.S)
    if not m:
        return {"status": "embedded_scenarios_not_found"}
    # JS 템플릿 리터럴은 `\\`를 `\`로 바꾼 뒤 JSON.parse에 넘기므로 같은 해석을 적용한다.
    off = json.loads(m.group(2).replace("\\\\", "\\"))
    src = json.loads((ROOT / "chatbot_demo_v2/data/scenarios.json").read_text(encoding="utf-8"))["nodes"]
    diff_nodes = sorted(k for k in set(off) | set(src) if off.get(k) != src.get(k))
    paths = {}
    for key, steps in SCENARIO_PATHS.items():
        node, trail, ok = m.group(1), [], True
        for node_id, opt_id in steps:
            if node != node_id:
                ok = False
                trail.append(f"상태 불일치: {node} != {node_id}")
                break
            opt = next((o for o in off[node].get("options", []) if o["option_id"] == opt_id), None)
            if not opt:
                ok = False
                trail.append(f"선택지 없음: {opt_id}")
                break
            node = opt["next_node_id"]
            trail.append(node)
        end = off.get(node, {})
        paths[key] = {"ok": ok, "trail": trail, "terminal": end.get("type") == "terminal",
                      "restart_option": [o["option_id"] for o in end.get("options", [])],
                      "terminal_text": (end.get("answer") or {}).get("text") or end.get("text")}
    return {"status": "ok", "root": m.group(1), "offline_node_count": len(off), "source_node_count": len(src),
            "nodes_differing_from_scenarios_json": diff_nodes, "paths": paths}


class RaisingMasker:
    backend = "rule"

    def __init__(self, fail_on: str, real):
        self.fail_on, self.real, self.calls = fail_on, real, 0

    def mask_text(self, text, skip_sllm=False):
        self.calls += 1
        # prepare_turn_payload은 질문 → 답변 순서로 호출한다.
        if (self.fail_on == "question" and self.calls == 1) or (self.fail_on == "answer" and self.calls == 2):
            raise RuntimeError("injected masker failure")
        return self.real.mask_text(text, skip_sllm=skip_sllm)


def check_history_service() -> dict:
    from chatbot_demo_v2.app.history_service import HistoryService
    from chatbot_demo_v2.app.pii_service import PiiMasker
    from chatbot_demo_v2.config.settings import load_settings

    settings = load_settings()
    real = PiiMasker(backend="rule")
    real.warmup()
    results = {}
    tmp = Path(tempfile.mkdtemp(prefix="pii_regress_"))
    for fx_id in FIXTURES:
        slots = slots_of(fx_id)
        q = TEMPLATES[fx_id].format(**slots)
        a = ANSWER_TEMPLATE.format(**slots)
        for variant in ("normal", "question", "answer"):
            masker = real if variant == "normal" else RaisingMasker(variant, real)
            db = tmp / f"{fx_id}_{variant}.db"
            svc = HistoryService(settings, pii_masker=masker, db_path=db)
            run_id = f"{fx_id}-{variant}-{int(time.time() * 1000)}"
            svc.record_turn(session_id="pii-regress", run_id=run_id, raw_question=q, final_answer=a, route="faq")
            con = sqlite3.connect(db)
            con.row_factory = sqlite3.Row
            row = con.execute("SELECT * FROM chat_history WHERE run_id=?", (run_id,)).fetchone()
            con.close()
            if row is None:
                results[f"{fx_id}/{variant}"] = {"row": False}
                continue
            row = dict(row)
            leaks = {}
            for fld in ("raw_question", "masked_question", "final_answer"):
                hit = [k for k, v in slots.items() if v and v in str(row.get(fld) or "")]
                if hit:
                    leaks[fld] = hit
            results[f"{fx_id}/{variant}"] = {
                "row": True, "raw_question_empty": (row.get("raw_question") or "") == "",
                "plaintext_leaks": leaks, "leak_count": sum(len(v) for v in leaks.values()),
                "pii_types": row.get("pii_types"),
                "masked_question_redacted": _redact(row.get("masked_question"), slots),
                "final_answer_redacted": _redact(row.get("final_answer"), slots),
            }
    return results


def _redact(text, slots):
    s = str(text or "")
    for k, v in slots.items():
        s = s.replace(v, "{" + k + "}")
    return s


def check_prompt_guard() -> dict:
    from chatbot_demo_v2.app.prompt_guard import PromptGuard  # type: ignore

    guard = PromptGuard()
    out = {}
    fx = json.loads((ROOT / "테스트데이터_Gemini/pii_fixtures.json").read_text(encoding="utf-8"))["GEMINI_GUARD_001"]
    cases = {"GEMINI_GUARD_001": fx["synthetic_prompt"]}
    for fx_id in FIXTURES:
        cases[f"{fx_id}(정상 상담)"] = TEMPLATES[fx_id].format(**slots_of(fx_id))
    for k, text in cases.items():
        t0 = time.perf_counter()
        blocked, reason, cat = guard.check_input(text)
        out[k] = {"blocked": blocked, "category": cat, "reason": reason, "latency_ms": round((time.perf_counter() - t0) * 1000, 3)}
    return out


def main() -> int:
    res = {"offline_html": check_offline_html(), "history_service": check_history_service()}
    try:
        res["prompt_guard"] = check_prompt_guard()
    except Exception as e:
        res["prompt_guard"] = {"error": f"{type(e).__name__}: {e}"}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1)[:6000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
