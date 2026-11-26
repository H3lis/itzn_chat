"""테스트데이터_Claude 파일럿 데이터셋 정적 검증 스크립트.

저장소 루트에서 실행한다.
    .venv\\Scripts\\python.exe -X utf8 테스트데이터_Claude\\validate_pilot.py

검사 항목
1. JSONL 파싱, 필수 키, turn_index 연속성, input.kind 규격
2. 참조한 FAQ ID가 faq.json에 존재
3. 시나리오 턴의 node/option 존재와 다음 노드 전이 일치
4. 합성 픽스처 슬롯 치환 가능 여부
5. DS-5A 근거 PDF 해시와 표 셀 문자열 존재
6. DS-2 정규화 기대값(로컬 기본 사전 기준)
7. DS-5C 합성값의 1차 규칙 마스킹 후 평문 잔존 0건

6·7은 실서버가 아닌 로컬 모듈 기준 사전 점검이다. 실행 결과는 본 파일럿 실행에서 다시 측정한다.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "chatbot_demo_v2"))

GROUPS = {"DS-1": (2, 3), "DS-2": (2, 3), "DS-3": (2, 3), "DS-4": (2, 3), "DS-5": (2, 3)}
KINDS = {"message", "scenario_option", "clarify_choice", "followup_click"}

errors: list[str] = []
notes: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def load():
    faq = {e["id"] for e in json.loads((ROOT / "chatbot_demo_v2/data/faq.json").read_text(encoding="utf-8"))["entries"]}
    scn = json.loads((ROOT / "chatbot_demo_v2/data/scenarios.json").read_text(encoding="utf-8"))["nodes"]
    fixtures = json.loads((HERE / "pii_fixtures.json").read_text(encoding="utf-8"))
    sessions = []
    for n, line in enumerate((HERE / "pilot_dataset.jsonl").read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            try:
                sessions.append(json.loads(line))
            except json.JSONDecodeError as e:
                err(f"line {n}: JSON 오류 {e}")
    return faq, scn, fixtures, sessions


def collect_faq_ids(obj, out: set[str]) -> None:
    keys = {"target_faq_ids", "acceptable_faq_ids", "clarify_candidate_ids", "acceptable_extra_candidate_ids", "related_topic_ids"}
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys and isinstance(v, list):
                out.update(v)
            elif k in ("faq_id",) and isinstance(v, str):
                out.add(v)
            elif k in ("topic_oracles", "answer_facts_by_faq", "expected_candidate_positions") and isinstance(v, dict):
                out.update(v.keys())
            collect_faq_ids(v, out)
    elif isinstance(obj, list):
        for x in obj:
            collect_faq_ids(x, out)


def check_structure(sessions, faq, scn, fixtures):
    seen = set()
    counts: dict[str, int] = {}
    for s in sessions:
        sid = s.get("session_id")
        for k in ("session_id", "dataset_group", "turns"):
            if k not in s:
                err(f"{sid}: 필수 키 {k} 누락")
        if sid in seen:
            err(f"{sid}: session_id 중복")
        seen.add(sid)
        grp = s["dataset_group"][:4]
        counts[grp] = counts.get(grp, 0) + 1
        for i, t in enumerate(s["turns"], 1):
            if t.get("turn_index") != i:
                err(f"{sid}: turn_index {t.get('turn_index')} != {i}")
            kind = t["input"].get("kind")
            if kind not in KINDS:
                err(f"{sid} t{i}: input.kind {kind}")
            if "expected" not in t:
                err(f"{sid} t{i}: expected 누락")
            if kind == "followup_click" and not isinstance(t["input"].get("button_index"), int):
                err(f"{sid} t{i}: button_index 누락")
            if kind == "clarify_choice":
                prev = s["turns"][i - 2]["expected"]
                cands = set(prev.get("clarify_candidate_ids", [])) | set(prev.get("acceptable_extra_candidate_ids", []))
                if t["input"]["faq_id"] not in cands:
                    err(f"{sid} t{i}: clarify_choice가 직전 후보 밖")
        ids: set[str] = set()
        collect_faq_ids(s, ids)
        for r in s.get("source_refs", []):
            if "faq.json#" in r:
                ids.add(r.split("#", 1)[1])
        for fid in ids:
            if fid not in faq:
                err(f"{sid}: FAQ ID 없음 {fid}")
        # 시나리오 전이
        for t in s["turns"]:
            if t["input"]["kind"] != "scenario_option":
                continue
            a = t["input"]["action"]
            node = scn.get(a["node_id"])
            if not node:
                err(f"{sid}: 노드 없음 {a['node_id']}")
                continue
            if node.get("scenario_id") != a.get("scenario_id"):
                err(f"{sid}: scenario_id 불일치 {a['node_id']}")
            opt = next((o for o in node.get("options", []) if o["option_id"] == a["option_id"]), None)
            if not opt:
                err(f"{sid}: 선택지 없음 {a['option_id']}")
                continue
            if opt["label"] != a.get("label"):
                err(f"{sid}: label 불일치 {opt['label']} / {a.get('label')}")
            exp = t["expected"]["scenario"]
            if opt["next_node_id"] != exp["node_id"]:
                err(f"{sid}: 전이 {opt['next_node_id']} != 기대 {exp['node_id']}")
            nxt = scn[exp["node_id"]]
            if [o["option_id"] for o in nxt.get("options", [])] != exp["option_ids"]:
                err(f"{sid}: {exp['node_id']} 선택지 목록 불일치")
            if (nxt["type"] == "terminal") != exp["completed"]:
                err(f"{sid}: completed 불일치 {exp['node_id']}")
        # 픽스처
        for t in s["turns"]:
            fx = t["input"].get("substitute_from_fixture")
            if fx:
                slots = {v["slot"]: v["value"] for v in fixtures[fx]["values"]}
                try:
                    t["input"]["text"] = t["input"]["text_template"].format(**slots)
                except KeyError as e:
                    err(f"{sid}: 픽스처 슬롯 없음 {e}")
    for g, (lo, hi) in GROUPS.items():
        if not lo <= counts.get(g, 0) <= hi:
            err(f"{g}: 세션 수 {counts.get(g, 0)} (기대 {lo}~{hi})")
    notes.append(f"세션 수 {counts}, 총 {len(sessions)}세션 / {sum(len(s['turns']) for s in sessions)}턴")


def check_pdf(sessions):
    import pymupdf

    for s in sessions:
        if s["dataset_group"] != "DS-5A":
            continue
        ev = s["turns"][0]["expected"]["evidence_any"][0]
        path = ROOT / s["source_refs"][0].split("#")[0]
        h = hashlib.sha256(path.read_bytes()).hexdigest()
        if h != ev["document_file_sha256"]:
            err(f"{s['session_id']}: PDF 해시 불일치")
        text = pymupdf.open(path)[ev["page_number"] - 1].get_text().replace(" ", "").replace("\n", "")
        for needle in ("AP접속단말수확인", "30분", "실제접속한단말수와차이가있을수있음"):
            if needle not in text:
                err(f"{s['session_id']}: p{ev['page_number']}에 '{needle}' 없음")
        notes.append(f"{s['session_id']}: PDF 해시·p{ev['page_number']} 표 셀 문자열 확인")


def check_normalization(sessions):
    import logging

    logging.disable(logging.WARNING)
    from robustness_tool.core import SpokenRobustnessEngine

    eng = SpokenRobustnessEngine()
    for s in sessions:
        if not s["dataset_group"].startswith("DS-2"):
            continue
        t = s["turns"][0]
        norm = t["expected"]["normalization"]
        out = eng.run(t["input"]["text"])["preprocessed_query"]
        ok = out in norm["expected_preprocessed_any"]
        bad = [f for f in norm["forbidden_fragments"] if f in out]
        lost = [r for r in norm["protected_roots"] if r not in out]
        if not ok or bad or lost:
            err(f"{s['session_id']}: 정규화 '{out}' (금지 {bad}, 어근 손실 {lost})")
        else:
            notes.append(f"{s['session_id']}: 로컬 정규화 '{out}'")


def check_pii(sessions, fixtures):
    import logging

    logging.disable(logging.WARNING)
    from chatbot_demo_v2.app.pii_service import PiiMasker

    m = PiiMasker(backend="rule")
    for s in sessions:
        for t in s["turns"]:
            fx = t["input"].get("substitute_from_fixture")
            if not fx:
                continue
            vals = fixtures[fx]["values"]
            res = m.mask_text(t["input"]["text"], skip_sllm=True)
            left = [v["slot"] for v in vals if v["value"] in res.masked_text]
            want = set(t["expected"]["pii"]["expected_detected_types"])
            miss = want - set(res.detected_types)
            if left or miss:
                err(f"{s['session_id']}: 평문 잔존 {left}, 미검출 유형 {sorted(miss)}")
            else:
                notes.append(f"{s['session_id']}: 1차 규칙 마스킹 잔존 0/{len(vals)}, 유형 {sorted(res.detected_types)}")


def main() -> int:
    faq, scn, fixtures, sessions = load()
    check_structure(sessions, faq, scn, fixtures)
    for fn in (lambda: check_pdf(sessions), lambda: check_normalization(sessions), lambda: check_pii(sessions, fixtures)):
        try:
            fn()
        except ImportError as e:
            notes.append(f"건너뜀(모듈 없음): {e}")
    for n in notes:
        print("[OK]", n)
    for e in errors:
        print("[FAIL]", e)
    print("결과:", "통과" if not errors else f"실패 {len(errors)}건")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
