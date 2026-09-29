"""FP 및 FN 오류 샘플 상세 확인 스크립트."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

def main():
    fps = json.load(open("PII_test/fp_details.json", encoding="utf-8"))
    fns = json.load(open("PII_test/fn_details.json", encoding="utf-8"))

    print(f"=== 1. FP (오탐: {len(fps)}건) 유형별 분류 ===")
    fp_by_type = defaultdict(list)
    for c in fps:
        t_key = tuple(c.get("detected_types", []))
        fp_by_type[t_key].append(c)

    for t_key, items in fp_by_type.items():
        print(f"\n[유형: {t_key}] (총 {len(items)}건)")
        for item in items[:5]:
            print(f"  ID: {item['id']}")
            print(f"    원문: {item['text']}")
            print(f"    마스킹: {item['masked_text']}")

    print(f"\n=== 2. FN (미탐: {len(fns)}건) 유형별 분류 ===")
    fn_by_type = defaultdict(list)
    for c in fns:
        pis = c.get("expected_pi", [])
        for pi in pis:
            fn_by_type[pi.get("type", "UNKNOWN")].append((c["id"], pi.get("text"), c["text"]))

    for t_name in sorted(fn_by_type.keys(), key=lambda k: len(fn_by_type[k]), reverse=True):
        items = fn_by_type[t_name]
        print(f"\n[PI 타입: {t_name}] (총 {len(items)}건)")
        for item_id, pi_val, text in items[:4]:
            print(f"  ID: {item_id}, 탐지대상: \"{pi_val}\"")
            print(f"    문맥: \"{text}\"")

if __name__ == "__main__":
    main()
