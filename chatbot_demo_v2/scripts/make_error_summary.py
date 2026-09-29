"""오답 요약 텍스트 파일 생성 스크립트."""
from __future__ import annotations

import json
from pathlib import Path

def main():
    fps = json.load(open("PII_test/fp_details.json", encoding="utf-8"))
    fns = json.load(open("PII_test/fn_details.json", encoding="utf-8"))

    with open("PII_test/error_summary.txt", "w", encoding="utf-8") as f:
        f.write(f"=== 1. FP (오탐: {len(fps)}건) ===\n")
        for i, c in enumerate(fps):
            f.write(f"[{i+1}] {c['id']} | types: {c.get('detected_types', [])}\n")
            f.write(f"  원문: {c['text']}\n")
            f.write(f"  마스킹: {c['masked_text']}\n\n")

        f.write(f"\n=== 2. FN (미탐: {len(fns)}건) ===\n")
        for i, c in enumerate(fns):
            pis = ", ".join([f"{p.get('type')}:{p.get('text')}" for p in c.get('expected_pi', [])])
            f.write(f"[{i+1}] {c['id']} | 기대PI: [{pis}]\n")
            f.write(f"  원문: {c['text']}\n")
            f.write(f"  마스킹: {c['masked_text']}\n\n")

    print(f"PII_test/error_summary.txt 생성 완료! (FP: {len(fps)}, FN: {len(fns)})")

if __name__ == "__main__":
    main()
