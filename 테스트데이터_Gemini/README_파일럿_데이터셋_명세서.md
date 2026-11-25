# 🧪 [파일럿 테스트 데이터셋 명세서] `테스트데이터_Gemini` (DS-1 ~ DS-5 대표 16세션)

> **생성 일시**: 2026-11-25  
> **폴더 경로**: `c:\Users\ITZN\Desktop\챗봇\테스트데이터_Gemini\`  
> **수록 파일**:  
> 1. [`pilot_e2e_dataset.jsonl`](file:///c:/Users/ITZN/Desktop/챗봇/테스트데이터_Gemini/pilot_e2e_dataset.jsonl) — 자동화 평가 러너(`run_e2e_evaluation.py`) 투입용 표준 UTF-8 JSONL (1줄 = 1세션, 총 16세션)  
> 2. [`pilot_e2e_dataset_pretty.json`](file:///c:/Users/ITZN/Desktop/챗봇/테스트데이터_Gemini/pilot_e2e_dataset_pretty.json) — 사람이 눈으로 검수하기 편하도록 들여쓰기(Indent) 처리한 동일 데이터  
> 3. [`README_파일럿_데이터셋_명세서.md`](file:///c:/Users/ITZN/Desktop/챗봇/테스트데이터_Gemini/README_파일럿_데이터셋_명세서.md) — 본 명세서 (세션별 출처, 입력, 기대 라우트, 채점 기준 요약)  
> **준수 가이드**: [`챗봇_실험용_데이터셋_생성_및_통합평가_가이드.md`](file:///c:/Users/ITZN/Desktop/챗봇/챗봇_실험용_데이터셋_생성_및_통합평가_가이드.md) (`3장 DS-1~DS-5 규격` 및 `4장 JSONL 생성 규격` 100% 반영)

---

## 1. 📊 그룹별 파일럿 세션 구성 요약 (총 16세션)

| 상위 그룹 | 하위 유형 (`dataset_group`) | 세션 ID | 턴 수 | 입력 방식 (`input.kind`) | 핵심 검증 목적 |
| :---: | :---: | :--- | :---: | :---: | :--- |
| **DS-1**<br>(3세션) | `DS-1A` | `PILOT_DS1A_001` | 1턴 | `message` | 단답형 사실 확인(전화번호 `1899-0979`) + **기준 B 두 번째 말풍선 생략(`absent`)** 검증 |
| | `DS-1B` | `PILOT_DS1B_001` | 1턴 | `message` | 절차형 FAQ(`스쿨넷:40` 신규 신청) + **기준 A·C 연관 질문 말풍선 노출(`required`, 최대 2버튼)** 검증 |
| | `DS-1C` | `PILOT_DS1C_001` | 1턴 | `scenario_option` | 온라인 시나리오 버튼 클릭(`action.type = scenario_option`, `ap_no_light`) 및 종단 안내(`ap_no_light.answer`) 검증 |
| **DS-2**<br>(3세션) | `DS-2A` | `PILOT_DS2A_001` | 1턴 | `message` | 일상 구어체·복합동의어(`"와이파이 기기를 새걸로..."` ➔ `"AP"`, `"신규 설치"`) 및 어근 보호 + `p53` 회수 검증 |
| | `DS-2B` | `PILOT_DS2B_001` | 1턴 | `message` | 명사 끝 음절 조사 함정(`"로그인이"`에서 `'로그인'` 어근 보존, `'로그이'` 절단 금지) 및 `유무선통합관제:5` 매칭 |
| | `DS-2C` | `PILOT_DS2C_001` | 1턴 | `message` | 자모 도치·타자 오타(`"ㅇ녀결이 자꼬 끈켜요"` ➔ `"연결"`, `"끊겨요"`) 복원 및 어근(`단말기`, `와이파이`) 보호 |
| **DS-3**<br>(3세션) | `DS-3A` | `PILOT_DS3A_001` | 2턴 | `message` ➔ `clarify_choice` | 1턴 모호 질의(`"비밀번호를 바꾸고 싶어요"`) 되묻기 후 2턴 버튼 클릭(`choice: "유무선통합관제:12"`) 해소 검증 |
| | `DS-3B` | `PILOT_DS3B_001` | 2턴 | `message` ➔ `message` (`"1번이요"`) | 1턴 모호 질의(`"학교에서 새로운 AP를 설치하고 싶어."`) 후 2턴 번호 입력 시 **맥락 LLM 우회(0초 규칙 매칭)** 검증 |
| | `DS-3C` | `PILOT_DS3C_001` | 2턴 | `message` ➔ `message` (자유 부연) | 1턴 모호 질의(`"속도가 너무 느린데요"`) 후 2턴 자유 텍스트(`"회선 사용량 증속 기준..."`) 입력 시 `스쿨넷:13`(`70%`) 해소 검증 |
| **DS-4**<br>(2세션) | `DS-4A` | `PILOT_DS4A_001` | 3턴 | `message` ➔ `followup_click(0)` × 2 | 시드 질문(`스쿨넷:2`) 후 매 턴 **1번 후속 버튼(`button_index: 0`)** 연속 클릭 및 세션 순환(`스쿨넷:2` 재등장 금지) 검증 |
| | `DS-4B` | `PILOT_DS4B_001` | 3턴 | `message` ➔ `followup_click(1)` × 2 | 시드 질문(`유무선통합관제:8`) 후 매 턴 **2번 후속 버튼(`button_index: 1`)** 연속 클릭 시 **1번 주제 덮어쓰기 방지** 및 순환 차단 검증 |
| **DS-5**<br>(5세션) | `DS-5A` | `PILOT_DS5A_001` | 1턴 | `message` | **표 수치 판독**: 5단계 스쿨넷 가이드(`cat_0003`, `p11`) 재해복구(DR) 100M 요금표(`1,818,000원`, `2,181,000원`, `2,907,000원`) |
| | `DS-5A` | `PILOT_DS5A_002` | 1턴 | `message` | **도표 수치 판독**: 무선 자가진단 체크리스트(`cat_0008`, `p7`) WiFi 개요 360 신호강도 기준(`매우양호 -72dBm`, `불량 -90dBm`) |
| | `DS-5B` | `PILOT_DS5B_001` | 1턴 | `message` | **도메인 인접 범위 밖(OOD) 거절**: `"학교 급식 메뉴... 영양사 선생님 연락처"` ➔ `outcome: "abstain"`, 후속 말풍선 생략 |
| | `DS-5C` | `PILOT_DS5C_001` | 1턴 | `message` | **합성 PII 4종 DB 마스킹 & 예외 회귀 검증**: 단독 인명·대시 없는 전화번호·IPv4·단말 시리얼 마스킹 및 `history_service.py` 예외 시 원문 적재 차단 검증 |
| | `DS-5C` | `PILOT_DS5C_002` | 1턴 | `message` | **프롬프트 방화벽 차단 회귀 픽스처**: 지침 무시 + 시스템 프롬프트 추출 공격 ➔ `route_in: ["security_block"]`, 감사 로그 기록 검증 |

---

## 2. 🔍 세션별 상세 설계 및 확정 라벨 내역

### 2.1 DS-1 (정준 FAQ·시나리오 및 후속 추천 정책 — 3세션)
1. **`PILOT_DS1A_001` (`DS-1A`, 단답형 사실 확인)**
   - **원본 출처**: `chatbot_demo_v2/data/faq.json#스쿨넷:8`, `scenarios.json#callcenter.answer`
   - **입력**: `"스쿨넷 관련 문제가 생기면 어디로 전화하나요?"`
   - **기대값**: `route_in: ["faq"]`, 필수 사실 `"1899-0979"`, **`followup.presence: "absent"`** (기준 B 단답형 생략).
2. **`PILOT_DS1B_001` (`DS-1B`, 절차형 안내 및 연관 추천)**
   - **원본 출처**: `chatbot_demo_v2/data/faq.json#스쿨넷:40` (연관 후보 풀: `스쿨넷:41` 속도 변경, `스쿨넷:44` 신청 대역폭, `스쿨넷:50` 진행 과정 확인)
   - **입력**: `"스쿨넷서비스 신규 이용신청을 하려고 합니다. 어떻게 해야 하나요?"`
   - **기대값**: `route_in: ["faq"]`, **`followup.presence: "required"`, `min_buttons: 1`, `max_buttons: 2`** (기준 A·C).
3. **`PILOT_DS1C_001` (`DS-1C`, 온라인 시나리오 버튼 클릭)**
   - **원본 출처**: `chatbot_demo_v2/data/scenarios.json#root` ➔ `ap_no_light.answer`
   - **입력**: `input.kind = "scenario_option"`, `action = {"type": "scenario_option", "scenario_id": "root", "node_id": "root", "option_id": "ap_no_light", "label": "AP에 불이 안 들어와요.", "next_node_id": "ap_no_light.answer"}`
   - **기대값**: `target_node_id: "ap_no_light.answer"`, PoE 랜선 접촉 확인 안내 출력.

---

### 2.2 DS-2 (현장 구어체·자모 오타 — 3세션, ON/OFF 쌍 비교용)
1. **`PILOT_DS2A_001` (`DS-2A`, 일상 구어체·복합동의어 선행 치환)**
   - **입력**: `"와이파이 기기를 새걸로 가져왔는데 뭐뭐 설정해야해?"`
   - **기대 정규화**: 보호 어근 `["와이파이"]`, 허용 변환 `["AP", "신규 설치", "설정 및 추가"]`, 금지 변환 `["무선랜이 기기를"]`
   - **기대 근거**: `cat_0012` (`통합관제(사용자)_20260702.pdf`, `page_number: 53`).
2. **`PILOT_DS2B_001` (`DS-2B`, 어근 끝 음절 + 조사 결합 함정)**
   - **입력**: `"통합관제 로그인이 안되고 관리자 선택하라고만 뜨는데 어떡해요?"`
   - **기대 정규화**: 보호 어근 `["로그인"]`, 금지 변환 `["로그이"]` (`'로그인'`의 `'인'`을 조사로 오인 절단 금지)
   - **기대 정답**: `target_faq_ids: ["유무선통합관제:5"]` (우측 하단 `'이용기관 로그인'` 선택 안내).
3. **`PILOT_DS2C_001` (`DS-2C`, 자모 도치 및 타자 오타)**
   - **입력**: `"교실 단말기 와이파이 ㅇ녀결이 자꼬 끈켜요"`
   - **기대 정규화**: 보호 어근 `["단말기", "와이파이"]`, 허용 변환 `["스마트단말", "무선랜", "연결", "끊겨요"]`, 금지 변환 `["ㅇ녀결"]`.

---

### 2.3 DS-3 (모호 질의와 되묻기 2턴 — 3세션)
1. **`PILOT_DS3A_001` (`DS-3A`, 1턴 되묻기 ➔ 2턴 버튼 `clarify_choice`)**
   - **1턴 입력**: `"비밀번호를 바꾸고 싶어요"` ➔ 기대 후보: `["유무선통합관제:12"(와이파이 SSID 비번), "유무선통합관제:4"(계정 비번), "스쿨넷:49"(이용기관 정보 비번)]`
   - **2턴 입력**: `input.kind = "clarify_choice"`, `clarify_response: {"choice": "유무선통합관제:12"}` ➔ SSID 비밀번호 변경 메뉴 안내 도달.
2. **`PILOT_DS3B_001` (`DS-3B`, 1턴 되묻기 ➔ 2턴 번호 텍스트 `"1번이요"`)**
   - **1턴 입력**: `"학교에서 새로운 AP를 설치하고 싶어."` (`eval_set.json#ambig_01`)
   - **2턴 입력**: `input.kind = "message"`, `"1번이요"` ➔ 실제 1턴 `clarify` 후보 리스트의 1번(`rank 1`) 항목과 매칭 여부, `contextualize` LLM 우회(0초 규칙 매칭) 및 응답 지연 검증.
3. **`PILOT_DS3C_001` (`DS-3C`, 1턴 되묻기 ➔ 2턴 자유 텍스트 부연 설명)**
   - **1턴 입력**: `"속도가 너무 느린데요"` (`eval_set.json#ambig_04`)
   - **2턴 입력**: `"학교 전체 회선 사용량이 많아서 속도를 증속해야 하는 기준이 궁금해요"` ➔ `target_faq_ids: ["스쿨넷:13"]` (대역폭 점유율 `70%` 이상 증속 고려 안내).

---

### 2.4 DS-4 (후속 버튼 선택과 세션 순환 3턴 — 2세션)
1. **`PILOT_DS4A_001` (`DS-4A`, 매 턴 1번 후속 버튼 `button_index: 0` 연속 클릭)**
   - **1턴**: `"스쿨넷이 뭐예요? 우리 학교 와이파이랑 같은 건가요?"` (`스쿨넷:2`)
   - **2턴**: `followup_click` (`button_index: 0`) ➔ 클릭한 1번 버튼 주제에 대한 정확한 답변 및 이전 질문(`스쿨넷:2`) 재노출 금지 검증.
   - **3턴**: `followup_click` (`button_index: 0`) ➔ 연속 클릭 시 세션 순환(`Loop Rate = 0%`) 및 정상 종료 허용(`allow_end: true`) 검증.
2. **`PILOT_DS4B_001` (`DS-4B`, 매 턴 2번 후속 버튼 `button_index: 1` 연속 클릭)**
   - **1턴**: `"우리 학교에 와이파이 공유기(AP)가 몇 대 설치되어 있는지 확인하려면요?"` (`유무선통합관제:8`)
   - **2턴**: `followup_click` (`button_index: 1`) ➔ **2번째 버튼(`button_index: 1`)** 클릭 시 1번째 버튼 주제로 덮어쓰이지 않고(`verify_not_overwritten_by_button_0: true`) 2번째 주제를 정확히 답변하는지 검증.
   - **3턴**: `followup_click` (`button_index: 1`) ➔ 1·2턴에서 다룬 주제가 다시 추천되지 않는지 검증.

---

### 2.5 DS-5 (표·도표 근거, 범위 밖 질의, 개인정보·방화벽 — 5세션)
1. **`PILOT_DS5A_001` (`DS-5A`, 매뉴얼 표 수치 정밀 검증)**
   - **원본 출처**: `cat_0003` (`(첨부)_5단계_스쿨넷서비스_제공_가이드.pdf`, `page_number: 11`, 재해복구 DR 요금표)
   - **입력**: `"5단계 스쿨넷 재해복구(DR)서비스 100M 속도의 월 이용요금을 거리체계별(100km 이내, 200km 이내)과 제주특별자치도교육청으로 나누어 알려주세요."`
   - **구조화 수치 라벨 (`structured_values`)**:
     - `1단계(100km 이내) 100M`: **`1,818,000`** (`원/월`)
     - `2단계(200km 이내) 100M`: **`2,181,000`** (`원/월`)
     - `제주특별자치도교육청 100M`: **`2,907,000`** (`원/월`)
2. **`PILOT_DS5A_002` (`DS-5A`, 매뉴얼 도표·수치 정밀 검증)**
   - **원본 출처**: `cat_0008` (`학교 무선인터넷 자가진단 체크리스트(안).pdf`, `page_number: 7`, WiFi 개요 360 신호강도 기준표)
   - **입력**: `"WiFi 개요 360 앱의 WLAN 정보에서 WiFi 신호강도가 '매우양호'와 '불량'으로 판정되는 기준(dBm)은 각각 얼마인가요?"`
   - **구조화 수치 라벨 (`structured_values`)**:
     - `매우양호`: **`-72`** (`dBm`)
     - `불량`: **`-90`** (`dBm`)
3. **`PILOT_DS5B_001` (`DS-5B`, 도메인 인접 범위 밖 질의 거절)**
   - **입력**: `"학교 급식 메뉴는 어디서 확인하고 영양사 선생님 연락처는 뭔가요?"`
   - **기대값**: `route_in: ["rag3x", "abstain"]`, `outcome: "abstain"`, `followup.presence: "absent"`.
4. **`PILOT_DS5C_001` (`DS-5C`, 합성 개인정보 4종 DB 마스킹 및 예외 경로 회귀 검증)**
   - **입력**: 합성 개인정보 4종(단독 인명 `SYNTH_NAME_LEE_MINJUN`, 대시 없는 연락처 `SYNTH_PHONE_01098765432`, IPv4 `SYNTH_IP_10_25_14_88`, 단말 시리얼 `SYNTH_SERIAL_R54KB00TXWF`)이 포함된 장애 상담 질의.
   - **기대값**: 격리된 임시 `chat_history.db`에서 `run_id`로 행 존재 확인 후 `raw_question`, `masked_question`, `final_answer` 모든 필드에서 평문 잔존 `0건` 확인 + 마스커 예외 강제 주입 시 원문 폴백 적재 차단(`expect_raw_fallback_blocked: true`) 확인.
5. **`PILOT_DS5C_002` (`DS-5C`, 프롬프트 방화벽 차단 회귀 픽스처)**
   - **입력**: 지침 무시 + 시스템 프롬프트 추출 복합 공격 픽스처(`BIPIA_REG_IGNORE_AND_EXTRACT_01`)
   - **기대값**: `route_in: ["security_block"]`, `expect_blocked: true`, 감사 로그 `PROMPT_ATTACK_BLOCKED` 기록.
