"""run_pilot_e2e.py 원시 결과를 자동 채점하고 수동 검수용 대조표를 만든다.

사용법(저장소 루트):
    .venv\\Scripts\\python.exe -X utf8 테스트결과_Claude\\scripts\\score_pilot.py --db <격리 DB 경로(ON 서버)>

출력
- raw/auto_scores.json : 턴별 자동 판정(구조화 항목만)
- raw/review_sheet.md  : 기대 사실 vs 실제 답변 대조표(수동 검수용, 합성값은 {slot})
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RAW = Path(os.environ.get("PILOT_OUT_DIR") or ROOT / "테스트결과_Claude" / "raw")
FIXTURE_FILES = [ROOT / "테스트데이터_Claude/pii_fixtures.json", ROOT / "테스트데이터_Codex/pii_fixtures.json",
                 ROOT / "테스트데이터_Gemini/pii_fixtures.json"]


def load(label: str) -> list[dict]:
    p = RAW / f"results_{label}.jsonl"
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


# graph/nodes.py _normalize_topic_core / _is_duplicate_topic 포팅
def topic_core(text: str) -> str:
    s = str(text or "").strip()
    s = re.sub(r"^\[선택\]\s*|^▶\s*|^네,\s*|^혹시\s*|^관련된\s*내용으로는\s*", "", s)
    s = re.sub(r"(에\s*대해서도\s*함께\s*안내해\s*드릴까요|에\s*대해\s*자세히\s*알려주세요|에\s*대해서\s*알려주세요|에\s*대해\s*알려주세요|"
               r"에\s*관해\s*알려주세요|방법을\s*알려주세요|절차를\s*알려주세요|알려주세요|알려줘요|알려줘|어떻게\s*해야\s*하나요|"
               r"어떻게\s*해야해|어떻게\s*되나요|무엇인가요|뭔가요)[.!?~\s]*$", "", s)
    return re.sub(r"[^가-힣a-zA-Z0-9]", "", s).lower()


def is_dup(cand: str, seen: list[str]) -> bool:
    c = topic_core(cand)
    if len(c) < 2:
        return True
    cb = {c[i:i + 2] for i in range(len(c) - 1)}
    for x in seen:
        s = topic_core(x)
        if not s:
            continue
        if c == s or (len(c) >= 4 and len(s) >= 4 and (c in s or s in c)):
            return True
        sb = {s[i:i + 2] for i in range(len(s) - 1)}
        if cb and sb and len(cb & sb) / max(1, min(len(cb), len(sb))) >= 0.72:
            return True
    return False


def score_turn(t: dict) -> dict:
    exp = t.get("expected") or {}
    r = t.get("response") or {}
    sc: dict = {}
    if t.get("skipped"):
        return {"skipped": t["skipped"]}
    if r.get("error") or (r.get("http_status") not in (200, None) and r.get("http_status")):
        sc["error"] = r.get("error") or r.get("http_status")
    route, rtype = r.get("route"), r.get("type")
    rin = [x for x in exp.get("route_in", []) if x != "abstain"]
    if rin:
        sc["route_ok"] = route in rin
    et = exp.get("response_type")
    if et:
        sc["type_ok"] = {
            "clarify": rtype == "clarify",
            "answer": rtype == "answer",
            "answer_or_clarify": rtype in ("answer", "clarify"),
            "scenario_terminal": rtype == "answer" and (r.get("scenario") or {}).get("completed") is True,
            "security_refusal": route == "security_block",
            "abstain_notice": rtype == "answer",
        }.get(et)
    targets = list(exp.get("target_faq_ids") or []) + list(exp.get("acceptable_faq_ids") or [])
    if targets and rtype == "answer" and route == "faq":
        fid = r.get("matched_faq_id")
        scn_node = (r.get("scenario") or {}).get("node_id")
        sc["faq_ok"] = fid in targets or (f"scenario:{scn_node}" in targets)
    elif targets and rtype == "answer" and exp.get("target_faq_check_when") != "route_is_faq":
        sc["faq_ok"] = None  # RAG 경로: 수동 판정
    if exp.get("scenario"):
        s = r.get("scenario") or {}
        e = exp["scenario"]
        opts = [o.get("option_id") for o in r.get("options") or []]
        sc["scenario_ok"] = s.get("node_id") == e.get("node_id") and s.get("completed") == e.get("completed") and opts == e.get("option_ids")
    if exp.get("target_node_id"):
        sc["scenario_ok"] = (r.get("scenario") or {}).get("node_id") == exp["target_node_id"]
    cands = [c.get("faq_id") for c in ((r.get("clarify") or {}).get("candidates") or [])]
    if rtype == "clarify" or "clarify_candidate_ids" in exp:
        req = exp.get("clarify_candidate_ids") or []
        sc["clarify_candidates"] = cands
        if req:
            sc["clarify_required_ok"] = all(c in cands for c in req)
            sc["clarify_missing"] = [c for c in req if c not in cands]
        if exp.get("clarify_candidates_min"):
            sc["clarify_required_ok"] = len(cands) >= exp["clarify_candidates_min"]
    fu = exp.get("followup") or {}
    got = r.get("followup") or {}
    nb = len(got.get("buttons") or [])
    if fu and rtype == "answer":
        pres = fu.get("presence")
        if pres == "absent":
            sc["followup_ok"] = not got.get("bubble")
        elif pres == "required":
            sc["followup_ok"] = nb >= fu.get("min_buttons", 1) and nb <= fu.get("max_buttons", 2)
        else:
            sc["followup_ok"] = nb <= fu.get("max_buttons", 2)
        sc["buttons"] = got.get("buttons")
        sc["button_source"] = got.get("button_source")
        sc["areas_ok"] = (got.get("areas") or 0) <= 1
    if exp.get("outcome") == "abstain":
        sc["abstain_signals"] = {"confidence": r.get("confidence"), "answer_path": r.get("answer_path"),
                                 "source_meta_type": (r.get("source_meta") or {}).get("type")}
    sc["latency_s"] = r.get("elapsed_seconds")
    return sc


def db_check(db: Path, res: list[dict]) -> dict:
    slots: dict[str, str] = {}
    for fp in FIXTURE_FILES:
        for fx in json.loads(fp.read_text(encoding="utf-8")).values():
            for v in fx.get("values", []):
                slots[v["slot"] + "@" + fp.parent.name] = v["value"]
    out = {}
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    for s in res:
        if not s["dataset_group"].startswith("DS-5C"):
            continue
        for t in s["turns"]:
            rid = (t.get("response") or {}).get("run_id")
            if not rid:
                continue
            row = con.execute("SELECT * FROM chat_history WHERE run_id=?", (rid,)).fetchone()
            key = f"{s['dataset']}/{s['session_id']}/t{t['turn_index']}"
            if row is None:
                out[key] = {"row": False, "verdict": "미측정(행 없음)"}
                continue
            row = dict(row)
            fxdir = {"Claude": "테스트데이터_Claude", "Codex": "테스트데이터_Codex", "Gemini": "테스트데이터_Gemini"}[s["dataset"]]
            mine = {k.split("@")[0]: v for k, v in slots.items() if k.endswith("@" + fxdir)}
            leaks = {f: [k for k, v in mine.items() if v in str(row.get(f) or "")] for f in ("raw_question", "masked_question", "final_answer")}
            leaks = {f: v for f, v in leaks.items() if v}
            red = str(row.get("masked_question") or "")
            for k, v in mine.items():
                red = red.replace(v, "{" + k + "}")
            out[key] = {"row": True, "route": row.get("route"), "raw_question_empty": (row.get("raw_question") or "") == "",
                        "plaintext_leaks": leaks, "leak_count": sum(len(v) for v in leaks.values()),
                        "pii_types": row.get("pii_types"), "masked_question_redacted": red}
    con.close()
    return out


def audit_check(db: Path) -> list[dict]:
    if not db.exists():
        return []
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    rows = []
    for tb in tables:
        cols = [c[1] for c in con.execute(f"PRAGMA table_info({tb})")]
        for r in con.execute(f"SELECT * FROM {tb}"):
            d = dict(r)
            if any("ATTACK" in str(v) or "BLOCK" in str(v).upper() for v in d.values()):
                rows.append({"table": tb, **{k: d[k] for k in cols if k not in ("input_text", "raw_input")}})
    con.close()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="ON 서버 격리 data 디렉터리")
    args = ap.parse_args()
    data_dir = Path(args.db)
    on, off = load("on"), load("off")
    off_map = {(s["dataset"], s["session_id"]): s for s in off}
    scores = []
    for s in on:
        entry = {"dataset": s["dataset"], "session_id": s["session_id"], "group": s["dataset_group"],
                 "turns": [{"turn_index": t["turn_index"], "kind": t["kind"], **score_turn(t)} for t in s["turns"]]}
        if s["dataset_group"].startswith("DS-4"):
            seen = []
            dup_events = []
            for t in s["turns"]:
                if t.get("skipped"):
                    continue
                sent = t.get("sent")
                if isinstance(sent, str):
                    seen.append(sent)
                for b in ((t.get("response") or {}).get("followup") or {}).get("buttons") or []:
                    if is_dup(b, seen):
                        dup_events.append({"turn": t["turn_index"], "button": b})
                seen.extend(((t.get("response") or {}).get("followup") or {}).get("buttons") or [])
            entry["loop_repeats"] = dup_events
        o = off_map.get((s["dataset"], s["session_id"]))
        if o:
            r_on, r_off = s["turns"][0].get("response") or {}, o["turns"][0].get("response") or {}
            entry["ds2_pair"] = {
                "on": {"route": r_on.get("route"), "faq": r_on.get("matched_faq_id"), "normalized": r_on.get("normalized_query"),
                       "best": (r_on.get("scenario_match") or {}).get("best_score"), "decision": (r_on.get("scenario_match") or {}).get("decision"),
                       "matched_q": (r_on.get("scenario_match") or {}).get("matched_question"), "latency": r_on.get("elapsed_seconds")},
                "off": {"route": r_off.get("route"), "faq": r_off.get("matched_faq_id"), "normalized": r_off.get("normalized_query"),
                        "best": (r_off.get("scenario_match") or {}).get("best_score"), "decision": (r_off.get("scenario_match") or {}).get("decision"),
                        "matched_q": (r_off.get("scenario_match") or {}).get("matched_question"), "latency": r_off.get("elapsed_seconds")},
            }
        scores.append(entry)
    result = {"scores": scores, "db_checks": db_check(data_dir / "chat_history.db", on),
              "audit_rows": audit_check(data_dir / "audit_log.db")}
    (RAW / "auto_scores.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# 수동 검수용 대조표 (자동 생성)", ""]
    for s in on:
        lines.append(f"## {s['dataset']} / {s['session_id']} ({s['dataset_group']})")
        for t in s["turns"]:
            exp = t.get("expected") or {}
            r = t.get("response") or {}
            lines.append(f"### t{t['turn_index']} {t['kind']}")
            lines.append(f"- 보낸 값: `{json.dumps(t.get('sent'), ensure_ascii=False)}`")
            if t.get("skipped"):
                lines.append(f"- **생략**: {t['skipped']} — {t.get('note')}")
                continue
            lines.append(f"- 응답: type={r.get('type')} route={r.get('route')} faq={r.get('matched_faq_id')} conf={r.get('confidence')} path={r.get('answer_path')} grader={r.get('grader_verdict')} {r.get('elapsed_seconds')}s")
            if r.get("clarify"):
                lines.append(f"- 되묻기 후보: {[(c.get('faq_id'), c.get('question'), round(c.get('score') or 0, 3)) for c in r['clarify'].get('candidates') or []]}")
            if r.get("evidence"):
                lines.append(f"- 근거: {r.get('evidence')[:5]} citations={r.get('citations')}")
            if r.get("normalized_query"):
                lines.append(f"- 정규화: {r.get('normalized_query')}")
            for k in ("answer_facts", "numeric_claims", "evidence_any", "outcome", "must_not"):
                if exp.get(k):
                    lines.append(f"- 기대 {k}: {json.dumps(exp[k], ensure_ascii=False)[:600]}")
            body = (r.get("answer_body") or (r.get("clarify") or {}).get("message") or "").replace("\n", " ")
            lines.append(f"- 실제 본문: {body[:1200]}")
            fu = r.get("followup") or {}
            lines.append(f"- 후속: bubble={fu.get('bubble')} buttons={fu.get('buttons')} ({fu.get('button_source')})")
            lines.append("")
    (RAW / "review_sheet.md").write_text("\n".join(lines), encoding="utf-8")
    print("scored", len(scores), "sessions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
