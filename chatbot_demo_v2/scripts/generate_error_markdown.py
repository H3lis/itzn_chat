"""오답(FP 39건, FN 148건) 전수 마크다운 아티팩트 생성 스크립트."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

def generate():
    with open("PII_test/fp_details.json", "r", encoding="utf-8") as f:
        fps = json.load(f)
    with open("PII_test/fn_details.json", "r", encoding="utf-8") as f:
        fns = json.load(f)

    artifact_path = Path(r"C:\Users\ITZN\.gemini\antigravity-ide\brain\d2413550-b51d-4432-8616-14899924b60d\pii_tuning_error_list.md")
    artifact_path.parent.mkdir(parents=True, exist_ok=True)

    lines = []
    lines.append("# 📋 PII 비식별화 2차 Validation 오답(FP/FN) 전수 리스트\n")
    lines.append(f"> **검증 일시**: 2026-09-29 | **대상 데이터**: Validation 20% (1,669건)")
    lines.append(f"> **오탐 (FP, False Positive)**: 총 {len(fps)}건 (일반 문장을 개인정보로 오인)")
    lines.append(f"> **미탐 (FN, False Negative)**: 총 {len(fns)}건 (실제 개인정보를 탐지하지 못함)\n")

    # 1. FP 전수 리스트
    lines.append("## 1. ⚠️ 오탐 (FP: False Positive) 전수 리스트 (39건)\n")
    lines.append("| 번호 | 파일 ID | 탐지 유형 | 원문 | 비식별화 마스킹 결과 | 오탐 원인 분석 |")
    lines.append("|:---:|:---:|:---:|:---|:---|:---|")

    for i, c in enumerate(fps, 1):
        item_id = c["id"]
        types = ", ".join(c.get("detected_types", []))
        orig = c["text"].replace("|", "\\|").replace("\n", " ")
        masked = c["masked_text"].replace("|", "\\|").replace("\n", " ")
        # 원인 간략 추정
        cause = "문맥상 동음이의어/수사/고유명사"
        if "name" in types:
            cause = "성씨 없는 2글자 인명(미소, 지혜 등) 또는 명사 오인"
        elif "credential" in types:
            cause = "비밀번호 키워드 포함 일반 숫자"
        elif "address" in types:
            cause = "배달 요청 동/호수 (데이터셋 특이 NEG 라벨)"
        elif "serial" in types:
            cause = "송장 번호 앞 영문 접두사"
        lines.append(f"| {i} | `{item_id}` | `{types}` | {orig} | {masked} | {cause} |")

    lines.append("\n---\n")

    # 2. FN 전수 리스트 (유형별 분류 후 전수 나열)
    lines.append("## 2. 🛡️ 미탐 (FN: False Negative) 전수 리스트 (148건)\n")
    lines.append("> 실제 개인정보(`pi`)가 포함되어 있으나 규칙 엔진이 놓친 전수 데이터입니다.\n")

    fn_by_type = defaultdict(list)
    for c in fns:
        pis = c.get("expected_pi", [])
        for pi in pis:
            t = pi.get("type", "UNKNOWN")
            fn_by_type[t].append((c, pi))

    lines.append("### 2-1. 유형별 미탐 건수 통계\n")
    lines.append("| 순위 | 개인정보 유형 | 미탐 건수 | 주요 미탐 패턴 |")
    lines.append("|:---:|:---|:---:|:---|")
    sorted_types = sorted(fn_by_type.items(), key=lambda x: len(x[1]), reverse=True)
    for r, (t, items) in enumerate(sorted_types, 1):
        lines.append(f"| {r} | **{t}** | {len(items)}건 | {t} 유형 세부 참조 |")

    lines.append("\n### 2-2. 미탐 상세 전수 리스트\n")
    lines.append("| 번호 | 파일 ID | 기대 PI 유형 | 정답 개인정보(Target) | 전체 문맥 | 규칙 마스킹 결과 |")
    lines.append("|:---:|:---:|:---:|:---|:---|:---|")

    for i, c in enumerate(fns, 1):
        item_id = c["id"]
        pis = c.get("expected_pi", [])
        types_str = ", ".join(set(p.get("type", "") for p in pis))
        vals_str = ", ".join([f"`{p.get('text', '')}`" for p in pis])
        orig = c["text"].replace("|", "\\|").replace("\n", " ")
        masked = c["masked_text"].replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {i} | `{item_id}` | `{types_str}` | {vals_str} | {orig} | {masked} |")

    with open(artifact_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"[OK] Report markdown generated: {artifact_path}")

if __name__ == "__main__":
    generate()
