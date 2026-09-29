"""오답 세부 사례 덤프 및 통계 스크립트."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

def main():
    report_path = Path("PII_test/validation_report.json")
    with open(report_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    fps = data.get("top_fp_samples", [])
    fns = data.get("top_fn_samples", [])

    print(f"Loaded {len(fps)} FPs and {len(fns)} FNs")

    # FP 상세 분석
    fp_details = []
    for c in fps:
        fp_details.append({
            "id": c["id"],
            "detected_types": c.get("detected_types", []),
            "text": c["text"],
            "masked_text": c["masked_text"],
        })

    # FN 상세 분석
    fn_details = []
    for c in fns:
        fn_details.append({
            "id": c["id"],
            "expected_pi": c.get("expected_pi", []),
            "text": c["text"],
            "masked_text": c["masked_text"],
        })

    with open("PII_test/fp_details.json", "w", encoding="utf-8") as f:
        json.dump(fp_details, f, ensure_ascii=False, indent=2)

    with open("PII_test/fn_details.json", "w", encoding="utf-8") as f:
        json.dump(fn_details, f, ensure_ascii=False, indent=2)

    print("Saved PII_test/fp_details.json and PII_test/fn_details.json")

if __name__ == "__main__":
    main()
