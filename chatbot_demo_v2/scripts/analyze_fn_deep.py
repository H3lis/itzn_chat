"""미탐(FN) 148건 심층 분석 스크립트."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

def main():
    with open("PII_test/fn_details.json", "r", encoding="utf-8") as f:
        fns = json.load(f)

    # 카테고리 분류
    categories = {
        "1_DATASET_LABEL_NOISE": [],         # 데이터셋 명백한 오라벨 / 엉뚱한 일반어 라벨
        "2_KOREAN_SPEECH_STT": [],           # 음성 구어체 수사 표기 (칠칠이, 010 다음에 1이 네 번 등)
        "3_DECOMPOSED_CHARS": [],            # 자모 분리 및 타이핑 노이즈 (ㄴㅣㅇㄱㅓㅁ, 김 ㅁ ㄴ ㅈ)
        "4_HOMOPHONE_2CHAR_NAME": [],        # 성씨 없는 2글자 인명 / 일반 명사 동음이의어 (구름, 온유, 장미, 보람, 가을)
        "5_UNCONVENTIONAL_FORMAT": [],       # 비정형 식별자/계정/주소 (99마켓, A-201B, ㅋㄹ2024 등)
        "6_PATTERN_IMPROVABLE": [],          # 규칙으로 추가 개선 가능한 패턴 (예: 전각 숫자, 점점 표기 등)
    }

    # 1. 명백한 데이터셋 오라벨 목록
    noise_words = {
        "이 상품", "나", "네", "네 핸드폰 번호", "메일 주소", "본인", "지하철역",
        "전형적으로 영어권 이름처럼", "본인 명의", "계정 번호", "예전 거", "이거구요",
        "네이밍", "카드", "가보시는 건가요", "가보시는", "회원님의 계정", "네이버 지도",
        "부장님", "고객님", "운전면허번호", "계좌번호"
    }

    # 2. 음성 수사 키워드
    speech_keywords = ("다음에", "네 번", "다시 하나", "칠칠이", "구구구", "이삼이칠", "일구팔십사", "골뱅이", "점 컴", "점컴", "천구백", "이십일년", "세이디브이", "오일공")

    # 3. 자모 분리
    jamo_list = ("ㄴㅣㅇ", "ㅁ ㄴ ㅈ", "ㄱㅏㅇㄴㅏㅁ", "ㅆㄹㅋ", "ㅇㅇㅁ", "ㅁㅁㅇㅇ", "ㄱ①⓪①", "ㄴㅇㅁㅈ")

    for c in fns:
        item_id = c["id"]
        text = c["text"]
        pis = c.get("expected_pi", [])
        pi_texts = [p.get("text", "") for p in pis]

        # 1) 데이터셋 오라벨 검사
        if any(w in pi_texts for w in noise_words):
            categories["1_DATASET_LABEL_NOISE"].append(c)
        # 2) 자모 분리 검사
        elif any(any(j in t for j in jamo_list) for t in pi_texts) or any(j in text for j in jamo_list):
            categories["3_DECOMPOSED_CHARS"].append(c)
        # 3) 음성 구어체 수사
        elif any(any(sk in t for sk in speech_keywords) for t in pi_texts) or any(sk in text for sk in speech_keywords):
            categories["2_KOREAN_SPEECH_STT"].append(c)
        # 4) 성씨 없는 2글자 인명
        elif any(p.get("type") == "NAME" and len(p.get("text", "")) <= 3 for p in pis) and any(w in pi_texts for w in ("구름", "온유", "장미", "보람", "별", "가을", "겨울", "슬기", "민지", "기쁨", "바다", "노을", "새벽", "다솜")):
            categories["4_HOMOPHONE_2CHAR_NAME"].append(c)
        # 5) 비정형 식별자
        elif any(p.get("type") in ("ID", "ACCOUNT", "ORG", "ADDRESS") for p in pis) and any(t in pi_texts for t in ("99마켓", "A-201B", "ㅋㄹ2024디지탈", "A1B2C3D4", "G3-9999-K", "사용자123#", "이십오시 북삼동", "네이키드-001", "전국보상원")):
            categories["5_UNCONVENTIONAL_FORMAT"].append(c)
        else:
            categories["6_PATTERN_IMPROVABLE"].append(c)

    summary_path = Path("PII_test/fn_deep_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({k: len(v) for k, v in categories.items()}, f, indent=2)

    with open("PII_test/fn_categorized.json", "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=2)

    print("=== FN 148건 카테고리별 분류 통계 ===")
    for k, v in categories.items():
        print(f"  {k}: {len(v)}건")

if __name__ == "__main__":
    main()
