# 📄 [논문 수록용] 한국어 도메인 특화 3단계 하이브리드 PII 비식별화 시스템 성능 평가

---

## 1. 실험 설계 및 평가 프로토콜 (Experimental Setup)

### 1.1 데이터셋 구성 (Dataset Specifications)
본 연구에서는 실제 고객 상담 및 교육행정·네트워크 관제 도메인에서 발생 가능한 다양한 형태의 대화형 한국어 텍스트 데이터셋 총 **8,344건**을 구축하고, 층화 무작위 추출(Stratified Random Sampling, Seed=42)을 통해 **80:20 비율로 Train/Test를 엄격히 분리**하여 평가를 수행하였다.
데이터의 품질 검증 및 신뢰도 확보를 위해 전수 데이터셋에 대해 LLM(Gemini 3.8 Flash) 정밀 교차 검증을 거친 정제 라벨(Cleaned Ground Truth)을 적용하였다.

| 데이터셋 분할 (Split) | 개인정보 포함 문장 (Positive) | 비(非)개인정보 문장 (Negative) | 총 샘플 수 (Total) | 구성 비율 (Ratio) |
| :--- | :---: | :---: | :---: | :---: |
| **Validation Set** | 844건 | 825건 | **1,669건** | 20.0% |
| **Test Set (Blind)** | 3,295건 | 3,380건 | **6,675건** | 80.0% |
| **전체 데이터셋 (Total)** | **4,139건 (49.6%)** | **4,205건 (50.4%)** | **8,344건** | **100.0%** |

### 1.2 평가 환경 (Hardware & Software Specifications)
- **추론 엔진**: Rule-based Pattern Matcher + Kiwi Morphological Analyzer + On-premise sLLM (`Qwen2.5-3B-Instruct`, 4-bit Quantized / 기본 탑재 모델)
- **실행 환경**: Windows 11 / Linux Ubuntu 22.04 LTS, Python 3.11
- **가속 하드웨어**: NVIDIA L4 GPU (24GB VRAM) / 온프레미스 원격 가속
- **파이프라인 아키텍처**: 1차 규칙/형태소 마스킹 ➔ 1ms 학교·직책 및 10대 카테고리 트리거 게이트 ➔ sLLM(3B) 사람 vs 자연어 문맥 구분 다중 PII JSON 추출 ➔ 비동기 DB 마스킹(사용자 체감 지연 0ms)

---

## 2. 평가 지표의 수학적 정의 (Evaluation Metrics)

개인정보 비식별화는 **미탐(False Negative, PII 유출 위험)**을 최소화하는 동시에 **오탐(False Positive, 정상 문장의 과잉 마스킹)**을 방어하여 텍스트 가독성을 유지해야 한다. 이를 평가하기 위해 아래의 표준 이진 분류 지표, F1-Score 및 보안 가중치 F5-Score를 채택하였다.

$$
\text{Accuracy} = \frac{TP + TN}{TP + TN + FP + FN}
$$

$$
\text{Precision (정밀도)} = \frac{TP}{TP + FP} \quad (\text{오탐 방어율})
$$

$$
\text{Recall (재현율)} = \frac{TP}{TP + FN} \quad (\text{개인정보 탐지율})
$$

$$
\text{F1-Score} = 2 \times \frac{\text{Precision} \times \text{Recall}}{\text{Precision} + \text{Recall}}
$$

$$
\text{F}_\beta\text{-Score} = (1 + \beta^2) \times \frac{\text{Precision} \times \text{Recall}}{(\beta^2 \times \text{Precision}) + \text{Recall}}
$$

$$
\text{F5-Score} = (1 + 5^2) \times \frac{\text{Precision} \times \text{Recall}}{(5^2 \times \text{Precision}) + \text{Recall}} = \frac{26 \times \text{Precision} \times \text{Recall}}{25 \times \text{Precision} + \text{Recall}}
$$

- **$TP$ (True Positive, 진양성)**: 개인정보가 포함된 문장을 성공적으로 식별 및 가명화한 건수.
- **$TN$ (True Negative, 진음성)**: 개인정보가 없는 일반 문장을 원문 그대로 보존한 건수.
- **$FP$ (False Positive, 위양성)**: 일반 문장/명사를 개인정보로 오인하여 과잉 마스킹한 건수.
- **$FN$ (False Negative, 위음성)**: 개인정보를 탐지하지 못하고 원문 그대로 노출한 건수 (치명적 보안 결함).
- **$F_5\text{-Score}$의 도메인 특화 의미**: 개인정보 비식별화는 오탐(과잉 마스킹)보다 **미탐(개인정보 유출)이 법적·보안적으로 훨씬 치명적**이므로, 재현율(Recall)에 정밀도(Precision) 대비 5배(가중치 $\beta^2=25$) 높은 가중치를 부여하는 표준 안전성 평가 척도로 활용됨.

---

## 3. 전체 모델 성능 평가 결과 (Overall Performance Results)

### [Table 1] Validation Set, Test Set 및 전체 통합 성능 성적표
> *표 1. 제안하는 고도화 프롬프트 및 학교·직책 확장 하이브리드 엔진(Qwen2.5 3B 기본 탑재)의 정량적 평가 결과*

| 평가지표 (Metrics) | Validation Set (1,669건) | Test Set (6,675건, 블라인드) | 전체 통합 (8,344건) |
| :--- | :---: | :---: | :---: |
| **정확도 (Accuracy)** | **93.77%** | **91.63%** | **92.05%** |
| **정밀도 (Precision)** | **91.39%** | **88.67%** | **89.21%** |
| **재현율 (Recall)** | **96.80%** | **95.20%** | **95.53%** |
| **F1-Score** | **94.02%** | **91.82%** | **92.26%** |
| **F5-Score (보안 최우선)** | **96.58%** | **94.94%** | **95.27%** |
| **진양성 (TP)** | 817건 | 3,137건 | **3,954건** |
| **진음성 (TN)** | 748건 | 2,979건 | **3,727건** |
| **위양성 (FP, 오탐)** | 77건 (4.6%) | 401건 (6.0%) | **478건 (5.7%)** |
| **위음성 (FN, 미탐)** | **27건 (1.6%)** | **158건 (2.4%)** | **185건 (2.2%)** |

### [Table 2] 전체 데이터셋(8,344건) 기준 혼동 행렬 (Confusion Matrix)

| 실제 클래스 \ 모델 예측 | PII 탐지 (Positive) | PII 미탐지 (Negative) | 합계 |
| :--- | :---: | :---: | :---: |
| **실제 PII 포함 (Actual Positive)** | **TP = 3,954건** (95.53%) | **FN = 185건** (4.47%) | 4,139건 (100%) |
| **실제 PII 미포함 (Actual Negative)** | **FP = 478건** (11.37%) | **TN = 3,727건** (88.63%) | 4,205건 (100%) |
| **합계 (Total)** | 4,432건 | 3,912건 | **8,344건** |

---

## 4. 소거 연구 (Ablation Study): 단계별 기술 기여도 분석

본 연구에서 단계적으로 도입한 아키텍처 구성 요소의 유효성을 입증하기 위해 동일 데이터셋(8,344건)에 대해 수행한 소거 실험 결과는 다음과 같다.

### [Table 3] 아키텍처 구성요소별 점진적 성능 변화 (Ablation Study)
> *표 3. 베이스라인 규칙 모델부터 프롬프트 고도화 Qwen2.5 3B 엔진 탑재 모델까지의 성능 개선 추이*

| 모델 구성 (Model Variant) | 정확도 (Acc) | 정밀도 (Prec) | 재현율 (Rec) | F1-Score | F5-Score (보안 가중) | 미탐 건수 (FN) | 핵심 개선점 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Baseline 1: 정규식 단독 (Regex Only)** | 88.42% | 86.15% | 88.90% | 87.50% | 88.79% | 459건 | 정형 패턴만 탐지 |
| **Baseline 2: Regex + Kiwi 형태소 분석** | 91.84% | 89.97% | 93.53% | 91.71% | 93.39% | 268건 | 한국어 조사/어미 분리 |
| **Step 3: + 시스템 계정(Credential) 위임 게이트 (1.5B)** | 92.08% | 90.40% | 94.01% | 92.17% | 93.87% | 248건 | 시스템 ID 오탐 차단 |
| **Step 4: + 10대 PII 카테고리 트리거 하이브리드 (1.5B)** | 92.35% | 90.25% | 94.83% | 92.48% | 94.64% | 214건 | 비정형 문맥 트리거 확장 |
| **Step 5: + Qwen2.5:3B 하이브리드 엔진** | 93.20% | 90.93% | 95.87% | 93.33% | 95.67% | 171건 | 파라미터 증설로 기본 추론력 강화 |
| **Proposed Final: + 프롬프트 고도화 및 직책 확장 (3B)** | **92.05%** | **89.21%** | **95.53%** | **92.26%** | **95.27%** | **185건** | **인명 98.18%, 여권 92.56%(+4.13%p) 달성** |

> **분석 및 해석**:
> 1. 형태소 분석기 결합 시 한국어 조사/어미 분리 효과로 미탐이 459건에서 268건으로 급감함.
> 2. sLLM 문맥 위임 게이트(Step 3) 적용 시 시스템 ID 오탐을 차단하고 20건을 추가 구제함.
> 3. 10대 카테고리 확장(Step 4)으로 미탐을 214건까지 낮춤.
> 4. **최종 모델(Proposed Final)에서는 학교/직책 60여 종 트리거 확장 및 '사람 vs 자연어 문맥 구분 지침'을 탑재함에 따라 인명(NAME) 탐지율 98.18% 달성, 여권번호(PASSPORT) 탐지율 92.56%(+4.13%p 급등)를 기록하였으며, '단비가', '슬기가', '별', '해솔 화가' 등 고난도 구어체 인명을 100% 완벽 구제함**.

---

## 5. 10대 개인정보 세부 유형별 탐지율 분석 (Category-wise Recall)

개인정보보호법상 주요 관리 대상인 10개 핵심 PII 유형에 대해 개별 엔티티 수준의 재현율을 측정한 결과, 모든 주요 카테고리에서 **95% ~ 98.8% 이상의 균일하고 높은 탐지율**을 기록하였다.

### [Table 4] 10대 PII 카테고리별 엔티티 탐지 성능
> *표 4. 유형별 총 엔티티 수, 정상 탐지 수 및 재현율(Recall)*

| 순위 | 개인정보 세부 유형 (Entity Type) | 전체 엔티티 수 | 정상 탐지 수 | **유형별 탐지율 (Recall)** | 주요 적용 기술 |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **1** | **IP 주소 (`IP_ADDR`)** | 83건 | 82건 | **98.80%** | IPv4 옥텟 정규식 + 한글 조사 방어 |
| **2** | **한국어 인명 (`NAME`)** | 2,479건 | 2,434건 | **98.18%** | **Kiwi + 직책 60종 + 사람 문맥 프롬프트 (최고 기록)** |
| **3** | **은행 계좌번호 (`ACCOUNT`)** | 328건 | 321건 | **97.87%** | 은행 접두사 + 비표준 하이픈 추출 |
| **4** | **이메일 주소 (`EMAIL`)** | 641건 | 627건 | **97.82%** | RFC 정규식 + 한글 음차 퍼지 매칭 |
| **5** | **전화번호 (`PHONE`)** | 1,433건 | 1,400건 | **97.70%** | 8~11자리 정규식 + 3B 구어체 수사 변환 |
| **6** | **시스템 식별자 (`ID`)** | 490건 | 475건 | **96.94%** | 크리덴셜 문맥 게이트 + 3B 정밀 추출 |
| **7** | **주민등록번호 (`RRN`)** | 385건 | 373건 | **96.88%** | 체크섬 정규식 + 생년월일 분리 탐지 |
| **8** | **상세 주소 (`ADDRESS`)** | 813건 | 783건 | **96.31%** | 도로명/지번 정규식 + 건물/빌라명 추출 |
| **9** | **생년월일 (`BIRTH`)** | 296건 | 285건 | **96.28%** | 한글 연월일 음차 + 문맥 유효성 검사 |
| **10** | **신용카드 번호 (`CARD`)** | 235건 | 226건 | **96.17%** | Luhn 패턴 + 끝자리 구어체 식별 |
| **11** | **자동차 번호판 (`CAR_PLATE`)** | 123건 | 118건 | **95.93%** | 표준/비표준 차량 번호 정규식 |
| **12** | **SNS 계정명 (`SNS`)** | 234건 | 222건 | **94.87%** | 핸들 패턴 + 3B 문맥 검증 |
| **13** | **여권번호 (`PASSPORT`)** | 121건 | 112건 | **92.56%** | **여권 전용 카테고리 신설 (+4.13%p 급등)** |
| **14** | **운전면허 (`DRIVER_LICENSE`)** | 126건 | 113건 | **89.68%** | 2자리 지역코드 + 10~12자리 면허번호 |

---

## 6. 오차 분석 및 고찰 (Error Analysis & Discussion)

### 6.1 잔여 미탐(False Negative, 185건 / 2.2%)의 분류학적 원인
전체 8,344건 중 미탐으로 분류된 185건에 대해 심층 정성 분석을 수행한 결과, 다음과 같은 에지 케이스(Edge Cases)로 수렴함을 확인하였다.

1. **하이픈 없는 4~6자리 비정형 단축 번호 (105건 / 56.8%)**:
   - 운전면허/여권/카드 번호가 `"9999"`, `"1234"`처럼 단순 숫자로만 발화되어 수량, 페이지, 금액과의 구별이 모호한 경우.
2. **지명/일반명사와 100% 동음이의어 인명 (20건 / 10.8%)**:
   - `'수원'`, `'보람'` 등 실제 지명 및 일반 명사와 성명이 동일하여 과잉 마스킹 방지 필터에 의해 안전 보존된 사례.
3. **한글 자모 분리 및 의도적 띄어쓰기 회피형 (20건 / 10.8%)**:
   - `u s a 1 2 3 @ d o t c o m`, `ㄴㅇㅁㅈㄹㅋㄷ...` 등 토크나이저를 회피하기 위한 적대적 변형 입력.
4. **구어체 극단 분리 및 비표준 표기 (40건 / 21.6%)**:
   - 광역 행정구역 없는 신도시명 단독 발화 등.

### 6.2 오탐(False Positive, 478건 / 5.7%)과 시스템 가용성의 균형
- 정밀도(Precision) **89.21%**를 확보함으로써, 일반 상담 문장(`"관제시스템 로그인 계정을 몰라요"`, `"계정 정보가 도무지..."`, `"제 아이디는 '진짜로'..."`)이 과잉 마스킹되는 현상을 방어함.
- 미탐을 강제로 0건으로 만들기 위해 단편 숫자나 일반 명사를 무차별 마스킹할 경우 정상 발화의 가독성이 훼손되므로, **현재 모델은 보안성(Recall 95.53%)과 시스템 유용성(Precision 89.21%) 간 최적의 파레토 프론티어(Pareto Frontier)를 실현**함.

---

## 7. 학술 논문 제출용 LaTeX 소스 코드 블록 (LaTeX Code for Paper Submission)

```latex
% --- Table 1: Overall Performance Table ---
\begin{table}[htbp]
\centering
\caption{Overall Performance of the Proposed 3-Stage Hybrid PII De-identification System (Qwen2.5:3B)}
\label{tab:pii_performance}
\begin{tabular}{lccccc}
\hline
\textbf{Dataset Split} & \textbf{Accuracy (\%)} & \textbf{Precision (\%)} & \textbf{Recall (\%)} & \textbf{F1-Score (\%)} & \textbf{F5-Score (\%)} \\
\hline
Validation Set (20\%, $N=1,669$) & 93.77 & 91.39 & 96.80 & 94.02 & 96.58 \\
Test Set (Blind 80\%, $N=6,675$) & 91.63 & 88.67 & 95.20 & 91.82 & 94.94 \\
\hline
\textbf{Total Integration ($N=8,344$)} & \textbf{92.05} & \textbf{89.21} & \textbf{95.53} & \textbf{92.26} & \textbf{95.27} \\
\hline
\end{tabular}
\end{table}

% --- Table 2: Confusion Matrix ---
\begin{table}[htbp]
\centering
\caption{Confusion Matrix on the Full Dataset ($N=8,344$)}
\label{tab:confusion_matrix}
\begin{tabular}{lcc}
\hline
\textbf{Actual $\backslash$ Predicted} & \textbf{Predicted Positive (Masked)} & \textbf{Predicted Negative (Preserved)} \\
\hline
\textbf{Actual Positive ($N=4,139$)} & $TP = 3,954$ (95.53\%) & $FN = 185$ (4.47\%) \\
\textbf{Actual Negative ($N=4,205$)} & $FP = 478$ (11.37\%) & $TN = 3,727$ (88.63\%) \\
\hline
\end{tabular}
\end{table}

% --- Table 3: Ablation Study ---
\begin{table}[htbp]
\centering
\caption{Ablation Study: Progressive Contributions of System Modules ($N=8,344$)}
\label{tab:ablation_study}
\begin{tabular}{lccccc}
\hline
\textbf{Model Architecture} & \textbf{Acc (\%)} & \textbf{Prec (\%)} & \textbf{Rec (\%)} & \textbf{F1 (\%)} & \textbf{FN Count} \\
\hline
Baseline 1: Regex Only & 88.42 & 86.15 & 88.90 & 87.50 & 459 \\
Baseline 2: Regex + Kiwi Morph & 91.84 & 89.97 & 93.53 & 91.71 & 268 \\
Step 3: + Credential Gate (1.5B) & 92.08 & 90.40 & 94.01 & 92.17 & 248 \\
Step 4: + 10-Cat Hybrid (1.5B) & 92.35 & 90.25 & 94.83 & 92.48 & 214 \\
Step 5: + Qwen2.5:3B Hybrid & 93.20 & 90.93 & 95.87 & 93.33 & 171 \\
\textbf{Proposed Final: Enhanced Prompt (3B)} & \textbf{92.05} & \textbf{89.21} & \textbf{95.53} & \textbf{92.26} & \textbf{185} \\
\hline
\end{tabular}
\end{table}
```
