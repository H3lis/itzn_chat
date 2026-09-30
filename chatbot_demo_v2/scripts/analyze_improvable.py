"""improvable FN 분석 스크립트."""
import json
from collections import Counter

def main():
    data = json.load(open("PII_test/fn_categorized.json", encoding="utf-8"))
    improvable = data["6_PATTERN_IMPROVABLE"]
    print(f"Count: {len(improvable)}")

    types = Counter()
    for c in improvable:
        for p in c.get("expected_pi", []):
            types[p.get("type")] += 1

    print("Types in improvable:")
    for t, cnt in types.most_common():
        print(f"  {t}: {cnt}건")

    with open("PII_test/improvable_samples.txt", "w", encoding="utf-8") as f:
        for i, c in enumerate(improvable, 1):
            pis = ", ".join([f"{p.get('type')}:{p.get('text')}" for p in c.get("expected_pi", [])])
            f.write(f"[{i}] {c['id']} | {pis}\n  Text: {c['text']}\n\n")
    print("improvable_samples.txt written")

if __name__ == "__main__":
    main()
