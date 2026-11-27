# -*- coding: utf-8 -*-
"""의미가 겹치는 FAQ 쌍 목록 (개선계획 2-4).

각 FAQ 질문을 질의로 넣었을 때 자기 자신이 아닌 FAQ 가 높은 점수(기본 0.90 이상)를 받으면
두 FAQ 는 사용자 질문에서 구분이 어렵다. 이런 쌍이 margin 판정 되묻기 과발동의 원인이다.
통합 또는 대표 FAQ 지정은 콘텐츠 담당이 결정한다. 이 스크립트는 목록만 만든다.

실행(저장소 루트):
    .venv/Scripts/python.exe -X utf8 chatbot_demo_v2/scripts/pilot/list_overlapping_faq_pairs.py --out <파일.md>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from chatbot_demo_v2.config.settings import load_settings  # noqa: E402
from chatbot_demo_v2.scenario.loader import load_faq  # noqa: E402
from chatbot_demo_v2.scenario.matcher import SemanticScenarioMatcher  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-score", type=float, default=0.90)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    s = load_settings()
    faq = load_faq(s.faq_path)
    m = SemanticScenarioMatcher(faq, threshold=s.scenario_match_threshold,
                                margin=s.scenario_match_margin, settings=s)
    if not m._ensure():
        print("의미 매처 준비 실패(임베딩·리랭커 확인)")
        return 1

    pairs: dict[tuple[str, str], float] = {}
    entries = list(faq.entries)
    for i, e in enumerate(entries, 1):
        for c in m.top_candidates(e.question, k=4):
            if c["faq_id"] == e.id or c["score"] < args.min_score:
                continue
            key = tuple(sorted((e.id, c["faq_id"])))
            pairs[key] = max(pairs.get(key, 0.0), float(c["score"]))
        if i % 50 == 0:
            print(f"  {i}/{len(entries)}", flush=True)

    rows = sorted(pairs.items(), key=lambda kv: -kv[1])
    lines = [
        "# 의미가 겹치는 FAQ 쌍 (개선계획 2-4)",
        "",
        f"- FAQ {len(entries)}건, 기준: 다른 FAQ 질문을 질의로 넣었을 때 리랭커 점수 ≥ {args.min_score:.2f}",
        f"- 쌍 {len(rows)}개. 통합하거나 대표 FAQ를 지정할지 콘텐츠 담당이 결정한다.",
        "",
        "| 점수 | FAQ A | 질문 A | FAQ B | 질문 B |",
        "| ---: | --- | --- | --- | --- |",
    ]
    for (a, b), sc in rows:
        qa, qb = faq.get(a).question, faq.get(b).question
        lines.append(f"| {sc:.3f} | {a} | {qa} | {b} | {qb} |")
    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"쌍 {len(rows)}개 → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
