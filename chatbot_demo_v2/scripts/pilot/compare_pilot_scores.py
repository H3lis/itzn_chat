# -*- coding: utf-8 -*-
"""파일럿 자동 채점 결과 두 개를 세션·턴 단위로 비교한다.

사용:
    python -X utf8 compare_pilot_scores.py <기준선 auto_scores.json> <신규 auto_scores.json>

출력: 불리언 지표(route_ok 등)의 합계 변화와, 값이 바뀐 턴 목록.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


def _flatten(path: Path) -> dict[tuple[str, int], dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for s in data["scores"]:
        for t in s.get("turns", []):
            out[(s["session_id"], t.get("turn_index", 0))] = t
    return out


def _bool_totals(turns: dict) -> Counter:
    c: Counter = Counter()
    for t in turns.values():
        for k, v in t.items():
            if isinstance(v, bool):
                c[f"{k}_n"] += 1
                c[k] += int(v)
    return c


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    base, new = _flatten(Path(argv[1])), _flatten(Path(argv[2]))
    bt, nt = _bool_totals(base), _bool_totals(new)
    keys = sorted({k for k in bt if not k.endswith("_n")} | {k for k in nt if not k.endswith("_n")})
    print("| 지표 | 기준선 | 신규 |\n| --- | ---: | ---: |")
    for k in keys:
        print(f"| {k} | {bt[k]}/{bt[k + '_n']} | {nt[k]}/{nt[k + '_n']} |")
    print("\n변경된 턴:")
    changed = 0
    for key in sorted(set(base) | set(new)):
        b, n = base.get(key, {}), new.get(key, {})
        diff = {k: (b.get(k), n.get(k)) for k in set(b) | set(n)
                if k not in ("latency_s",) and b.get(k) != n.get(k)}
        if diff:
            changed += 1
            print(f"- {key[0]} t{key[1]}: " + ", ".join(f"{k}: {v[0]} → {v[1]}" for k, v in sorted(diff.items())))
    print(f"\n총 {changed}턴 변경")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
