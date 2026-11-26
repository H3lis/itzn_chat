"""세 파일럿 데이터셋(Claude·Codex·Gemini)을 격리된 로컬 서버 API로 실행하고 원시 관측값을 저장한다.

사용법(저장소 루트):
    .venv\\Scripts\\python.exe -X utf8 테스트결과_Claude\\scripts\\run_pilot_e2e.py --base http://127.0.0.1:8111 --label on
    .venv\\Scripts\\python.exe -X utf8 테스트결과_Claude\\scripts\\run_pilot_e2e.py --base http://127.0.0.1:8112 --label off --only-ds2

- 서버는 DEMO_DATA_DIR를 임시 폴더로 지정해 운영 chat_history.db와 분리한 상태여야 한다.
- 합성 픽스처 값은 저장 전에 {slot} 표기로 되돌린다(리포트에 합성 식별자 원문을 남기지 않음).
- 후속 버튼은 프런트엔드 extractFollowupData()와 BotMessage의 폴백 규칙을 그대로 옮겨 계산한다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "테스트결과_Claude" / "raw"

DATASETS = {
    "Claude": (ROOT / "테스트데이터_Claude/pilot_dataset.jsonl", ROOT / "테스트데이터_Claude/pii_fixtures.json"),
    "Codex": (ROOT / "테스트데이터_Codex/pilot_dataset.jsonl", ROOT / "테스트데이터_Codex/pii_fixtures.json"),
    "Gemini": (ROOT / "테스트데이터_Gemini/pilot_e2e_dataset.jsonl", ROOT / "테스트데이터_Gemini/pii_fixtures.json"),
}


# ---------------- 프런트엔드 후속 버튼 파서 포팅 ----------------
def _format_option_btn(raw: str) -> str:
    t = re.sub(r"^[-*•\d.)\s\"'`]+|[\"'`.!?]+$", "", str(raw or "")).strip()
    if not t:
        return ""
    if t.startswith("네,") and "알려주세요" in t:
        return re.sub(r"[.!?]+$", "", t).strip()
    t = re.sub(r"^네,\s*", "", t).strip()
    t = re.sub(
        r"\s*(?:에\s*대해(?:서)?(?:도)?|에\s*관해(?:서)?|도\s*함께)?\s*(?:안내해\s*드릴까요|알려주세요|알려줘요|알려줘)?[.!?]*$",
        "", t).strip()
    return f"네, {t}에 대해 알려주세요" if t else ""


def extract_followup(answer: str, clarify: dict | None) -> dict:
    raw = str(answer or "")
    fm = re.search(r"<followup>([\s\S]*?)</followup>", raw, re.I)
    om = re.search(r"<followup_options>([\s\S]*?)</followup_options>", raw, re.I)
    ftext = fm.group(1).strip() if fm else ""
    oraw = om.group(1).strip() if om else ""
    opts: list[str] = []
    for line in oraw.split("\n") if oraw else []:
        b = _format_option_btn(line)
        if b and len(b) >= 10 and b not in opts:
            opts.append(b)
    if not opts and ftext:
        m1 = re.search(r"관련된\s*내용으로는\s*(.+?)\s*(?:와|과)\s*같은\s*(?:내용|항목|사항|절차|정보)", ftext)
        phrase = m1.group(1).strip() if m1 else ""
        if not phrase:
            m2 = re.search(r"혹시\s*(.+?)\s*(?:에\s*대해서도|에\s*대해|도\s*함께)\s*(?:함께\s*)?안내해", ftext)
            phrase = m2.group(1).strip() if m2 else ""
        if phrase:
            for p in re.split(r"\s*(?:이나|거나|또는|및|그리고|,\s*)\s*|\s+나\s+", phrase):
                if len(p.strip()) >= 3:
                    b = _format_option_btn(p.strip())
                    if b and b not in opts:
                        opts.append(b)
    opts = opts[:2]
    source = "followup_tag" if opts else None
    if not opts:  # BotMessage 폴백: 답변에 붙은 clarify 후보
        cands = (clarify or {}).get("candidates") or []
        opts = [str(c.get("question") or c.get("label") or c).strip() for c in cands[:2] if c]
        opts = [o for o in opts if o]
        source = "clarify_candidates_fallback" if opts else None
    bubble = bool(ftext or opts)
    body = re.sub(r"<followup>[\s\S]*?</followup>|<followup_options>[\s\S]*?</followup_options>", "", raw, flags=re.I).strip()
    return {"bubble": bubble, "buttons": opts, "button_source": source, "followup_text": ftext,
            "areas": 1 if bubble else 0, "body": body}


# ---------------- 데이터 정규화 ----------------
def load_sessions(name: str) -> list[dict]:
    path, fx_path = DATASETS[name]
    fixtures = json.loads(fx_path.read_text(encoding="utf-8")) if fx_path.exists() else {}
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            s = json.loads(line)
            s["_dataset"] = name
            s["_fixtures"] = fixtures
            out.append(s)
    return out


def fixture_slots(s: dict, fx_id: str) -> dict:
    fx = s["_fixtures"].get(fx_id) or {}
    slots = {v["slot"]: v["value"] for v in fx.get("values", [])}
    for k, v in fx.items():  # Gemini 방화벽 픽스처: synthetic_prompt 등 최상위 문자열
        if k.startswith("synthetic_") and isinstance(v, str):
            slots[k] = v
    return slots


def redact(obj, slots: dict):
    if not slots:
        return obj
    s = json.dumps(obj, ensure_ascii=False)
    for k, v in sorted(slots.items(), key=lambda kv: -len(kv[1])):
        s = s.replace(json.dumps(v, ensure_ascii=False)[1:-1], "{" + k + "}")
    return json.loads(s)


def faq_id_of(resp: dict) -> str | None:
    sm = resp.get("scenario_match") or {}
    for tr in resp.get("trace") or []:
        m = re.search(r"FAQ 모범답변 반환\(([^,]+),", tr.get("detail", ""))
        if m:
            return m.group(1).strip()
    if resp.get("route") == "faq" and sm.get("matched_id"):
        return sm["matched_id"]
    return None


def norm_from_trace(resp: dict) -> str | None:
    for tr in resp.get("trace") or []:
        d = tr.get("detail", "")
        if tr.get("node") == "normalize_input" and "강건성 툴 적용:" in d:
            return d.split("->", 1)[1].strip() if "->" in d else d
    return None


def compact(resp: dict, fu: dict) -> dict:
    ev = [{k: e.get(k) for k in ("document_name", "doc_title", "document_id", "doc_slug", "page_number", "page", "score", "rank", "source", "title")
           if e.get(k) is not None} for e in (resp.get("evidence") or [])]
    return {
        "http_status": resp.get("_http_status"),
        "type": resp.get("type"), "route": resp.get("route"),
        "answer": resp.get("answer"), "answer_body": fu["body"],
        "followup": {k: fu[k] for k in ("bubble", "buttons", "button_source", "followup_text", "areas")},
        "options": resp.get("options"), "scenario": resp.get("scenario"),
        "confidence": resp.get("confidence"), "answer_path": resp.get("answer_path"),
        "answer_source": resp.get("answer_source"), "source_meta": resp.get("source_meta"),
        "matched_faq_id": faq_id_of(resp), "scenario_match": resp.get("scenario_match"),
        "clarify": resp.get("clarify"), "evidence": ev, "evidence_raw_keys": sorted({k for e in resp.get("evidence") or [] for k in e}),
        "faq_evidence_n": len(resp.get("faq_evidence") or []), "citations": resp.get("citations"),
        "verification": resp.get("verification"), "grader_verdict": resp.get("grader_verdict"),
        "composed": resp.get("composed"), "original_answer": resp.get("original_answer"),
        "warnings": resp.get("warnings"), "normalized_query": norm_from_trace(resp),
        "trace": resp.get("trace"), "timings": resp.get("timings"),
        "elapsed_seconds": resp.get("elapsed_seconds"), "run_id": resp.get("run_id"),
    }


# ---------------- 실행 ----------------
def post(client: httpx.Client, base: str, body: dict) -> tuple[dict, float]:
    t0 = time.perf_counter()
    try:
        r = client.post(f"{base}/api/chat", json=body, timeout=600)
        wall = time.perf_counter() - t0
        try:
            data = r.json()
        except Exception:
            data = {"_raw_text": r.text[:2000]}
        data["_http_status"] = r.status_code
        return data, wall
    except Exception as e:  # 타임아웃·연결 오류
        return {"_http_status": None, "_error": f"{type(e).__name__}: {e}"}, time.perf_counter() - t0


def run_session(client: httpx.Client, base: str, s: dict) -> dict:
    session_id = None
    prev_buttons: list[str] = []
    prev_ended = False
    slots_used: dict = {}
    turns_out = []
    for t in s["turns"]:
        inp = t["input"]
        kind = inp["kind"]
        rec: dict = {"turn_index": t["turn_index"], "kind": kind, "expected": t.get("expected")}
        body: dict = {}
        if kind == "message":
            text = inp.get("text") if inp.get("text") is not None else inp.get("text_template")
            fx = inp.get("substitute_from_fixture")
            if fx:
                slots = fixture_slots(s, fx)
                slots_used.update(slots)
                text = text.format(**slots)
            body["message"] = text
            rec["sent"] = text
        elif kind == "scenario_option":
            act = {k: v for k, v in inp["action"].items() if k in ("type", "scenario_id", "node_id", "option_id", "label")}
            body["action"] = act
            rec["sent"] = act
        elif kind == "clarify_choice":
            choice = inp.get("faq_id") or (inp.get("clarify_response") or {}).get("choice")
            prev = turns_out[-1]["response"] if turns_out else {}
            cand_ids = [c.get("faq_id") for c in ((prev.get("clarify") or {}).get("candidates") or [])]
            if choice not in cand_ids:
                rec["skipped"] = "candidate_missing"
                rec["note"] = f"선택할 FAQ {choice}가 직전 후보 {cand_ids}에 없어 실행하지 않음"
                turns_out.append(rec)
                break
            body["clarify_response"] = {"choice": choice}
            rec["sent"] = body["clarify_response"]
        elif kind == "followup_click":
            idx = inp["button_index"]
            prev_type = (turns_out[-1].get("response") or {}).get("type") if turns_out else None
            if prev_type == "clarify":
                rec["skipped"] = "availability_failure"
                rec["note"] = "직전 응답이 답변이 아닌 되묻기 카드라 후속 버튼이 없음"
                turns_out.append(rec)
                break
            if prev_ended:
                rec["skipped"] = "normal_end"
                rec["note"] = "직전 응답에 새 추천이 없어 정상 종료(후속 턴 생략)"
                turns_out.append(rec)
                break
            if idx >= len(prev_buttons):
                rec["skipped"] = "availability_failure"
                rec["note"] = f"직전 버튼 {len(prev_buttons)}개 → {idx + 1}번 버튼 없음"
                turns_out.append(rec)
                break
            body["message"] = prev_buttons[idx]
            rec["sent"] = prev_buttons[idx]
            rec["clicked_from"] = list(prev_buttons)
        if session_id:
            body["session_id"] = session_id
        resp, wall = post(client, base, body)
        session_id = resp.get("session_id") or session_id
        fu = extract_followup(resp.get("answer"), resp.get("clarify") if resp.get("type") != "clarify" else None)
        rec["response"] = compact(resp, fu)
        if resp.get("_error") or resp.get("_raw_text"):
            rec["response"]["error"] = resp.get("_error") or resp.get("_raw_text")
        rec["wall_s"] = round(wall, 3)
        prev_buttons = fu["buttons"]
        prev_ended = not fu["buttons"]
        turns_out.append(rec)
        print(f"  t{t['turn_index']} {kind} → {resp.get('type')}/{resp.get('route')} faq={rec['response']['matched_faq_id']} "
              f"btn={len(fu['buttons'])} {wall:.1f}s", flush=True)
    out = {"dataset": s["_dataset"], "session_id": s["session_id"], "dataset_group": s["dataset_group"],
           "api_session_id": session_id, "turns": turns_out}
    return redact(out, slots_used)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--only-ds2", action="store_true")
    ap.add_argument("--only", nargs="*", help="session_id 필터")
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"results_{args.label}.jsonl"
    done = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                done.add((r["dataset"], r["session_id"]))
    with httpx.Client() as client, out_path.open("a", encoding="utf-8") as f:
        health = client.get(f"{args.base}/api/health", timeout=30).json()
        meta_path = OUT_DIR / f"run_meta_{args.label}.json"
        if not meta_path.exists():
            meta_path.write_text(json.dumps({"label": args.label, "base": args.base, "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                                             "routing": health.get("routing"), "toggles": health.get("toggles"),
                                             "web_search": health.get("web_search")}, ensure_ascii=False, indent=2), encoding="utf-8")
        for name in DATASETS:
            for s in load_sessions(name):
                if args.only_ds2 and not s["dataset_group"].startswith("DS-2"):
                    continue
                if args.only and s["session_id"] not in args.only:
                    continue
                if (name, s["session_id"]) in done:
                    continue
                print(f"[{args.label}] {name} {s['session_id']} ({s['dataset_group']})", flush=True)
                res = run_session(client, args.base, s)
                res["label"] = args.label
                f.write(json.dumps(res, ensure_ascii=False) + "\n")
                f.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
