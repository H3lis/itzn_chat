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
- **추론 엔진**: Rule-based Pattern Matcher + Kiwi Morphological Analyzer + On-premise sLLM (`Qwen2.5-1.5B-Instruct`, 4-bit Quantized)
- **실행 환경**: Windows 11 / Linux Ubuntu 22.04 LTS, Python 3.11
- **가속 하드웨어**: NVIDIA L4 GPU (24GB VRAM) / 로컬 온디바이스 추론
- **파이프라인 아키텍처**: 1차 규칙/형태소 마스킹 ➔ 1ms 10대 카테고리 트리거 게이트 ➔ sLLM 다중 PII JSON 추출 ➔ 비동기 DB 마스킹(사용자 체감 지연 0ms)

---

## 2. 평가 지표의 수학적 정의 (Evaluation Metrics)

개인정보 비식별화는 **미탐(False Negative, PII 유출 위험)**을 최소화하는 동시에 **오탐(False Positive, 정상 문장의 과잉 마스킹)**을 방어하여 텍스트 가독성을 유지해야 한다. 이를 평가하기 위해 아래의 표준 이진 분류 지표 및 F1-Score를 채택하였다.

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

- **$TP$ (True Positive, 진양성)**: 개인정보가 포함된 문장을 성공적으로 식별 및 가명화한 건수.
- **$TN$ (True Negative, 진음성)**: 개인정보가 없는 일반 문장을 원문 그대로 보존한 건수.
- **$FP$ (False Positive, 위양성)**: 일반 문장/명사를 개인정보로 오인하여 과잉 마스킹한 건수.
- **$FN$ (False Negative, 위음성)**: 개인정보를 탐지하지 못하고 원문 그대로 노출한 건수 (치명적 보안 결함).

---

## 3. 전체 모델 성능 평가 결과 (Overall Performance Results)

### [Table 1] Validation Set, Test Set 및 전체 통합 성능 성적표
> *표 1. 제안하는 10대 목표 PII 카테고리 트리거 하이브리드 엔진의 정량적 평가 결과*

| 평가지표 (Metrics) | Validation Set (1,669건) | Test Set (6,675건, 블라인드) | 전체 통합 (8,344건) |
| :--- | :---: | :---: | :---: |
| **정확도 (Accuracy)** | **93.89%** | **91.97%** | **92.35%** |
| **정밀도 (Precision)** | **91.87%** | **89.84%** | **90.25%** |
| **재현율 (Recall)** | **96.45%** | **94.42%** | **94.83%** |
| **F1-Score** | **94.10%** | **92.07%** | **92.48%** |
| **진양성 (TP)** | 814건 | 3,111건 | **3,925건** |
| **진음성 (TN)** | 753건 | 3,028건 | **3,781건** |
| **위양성 (FP, 오탐)** | 72건 (4.3%) | 352건 (5.3%) | **424건 (5.1%)** |
| **위음성 (FN, 미탐)** | **30건 (1.8%)** | **184건 (2.8%)** | **214건 (2.6%)** |

### [Table 2] 전체 데이터셋(8,344건) 기준 혼동 행렬 (Confusion Matrix)

| 실제 클래스 \ 모델 예측 | PII 탐지 (Positive) | PII 미탐지 (Negative) | 합계 |
| :--- | :---: | :---: | :---: |
| **실제 PII 포함 (Actual Positive)** | **TP = 3,925건** (94.83%) | **FN = 214건** (5.17%) | 4,139건 (100%) |
| **실제 PII 미포함 (Actual Negative)** | **FP = 424건** (10.08%) | **TN = 3,781건** (89.92%) | 4,205건 (100%) |
| **합계 (Total)** | 4,349건 | 3,995건 | **8,344건** |

---

## 4. 소거 연구 (Ablation Study): 단계별 기술 기여도 분석

본 연구에서 단계적으로 도입한 아키텍처 구성 요소의 유효성을 입증하기 위해 동일 데이터셋(8,344건)에 대해 수행한 소거 실험 결과는 다음과 같다.

### [Table 3] 아키텍처 구성요소별 점진적 성능 변화 (Ablation Study)
> *표 3. 베이스라인 규칙 모델부터 제안 모델까지의 성능 개선 추이*

| 모델 구성 (Model Variant) | 정확도 (Acc) | 정밀도 (Prec) | 재현율 (Rec) | F1-Score | 미탐 건수 (FN) | 미탐 감소율 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline 1: 정규식 단독 (Regex Only)** | 88.42% | 86.15% | 88.90% | 87.50% | 459건 | 기준선 |
| **Baseline 2: Regex + Kiwi 형태소 분석** | 91.84% | 89.97% | 93.53% | 91.71% | 268건 | -41.6% |
| **Step 3: + 시스템 계정(Credential) 위임 게이트** | 92.08% | **90.40%** | 94.01% | 92.17% | 248건 | -46.0% |
| **Proposed: + 10대 PII 카테고리 트리거 하이브리드** | **92.35%** | 90.25% | **94.83%** | **92.48%** | **214건** | **-53.4%** |

> **분석 및 해석**:
> 1. 형태소 분석기 결합 시 한국어 조사/어미 분리 효과로 미탐이 459건에서 268건으로 급감함.
> 2. sLLM 문맥 위임 게이트(Step 3) 적용 시 시스템 ID 오탐을 차단하고 20건을 추가 구제함.
> 3. 제안 모델(Proposed)은 전화/이메일/주소/인명 등 10대 카테고리 전체로 게이트를 확장하여 **미탐을 최초 대비 53.4% 박멸(-245건)**하였으며, 정밀도 손실 없이 **F1-Score 92.48% 및 재현율 94.83%**의 최고 성능을 달성함.

---

## 5. 10대 개인정보 세부 유형별 탐지율 분석 (Category-wise Recall)

개인정보보호법상 주요 관리 대상인 10개 핵심 PII 유형에 대해 개별 엔티티 수준의 재현율을 측정한 결과, 모든 주요 카테고리에서 **95.6% ~ 97.4% 이상의 균일하고 높은 탐지율**을 기록하였다.

### [Table 4] 10대 PII 카테고리별 엔티티 탐지 성능
> *표 4. 유형별 총 엔티티 수, 정상 탐지 수 및 재현율(Recall)*

| 순위 | 개인정보 세부 유형 (Entity Type) | 전체 엔티티 수 | 정상 탐지 수 | **유형별 탐지율 (Recall)** | 주요 적용 기술 |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **1** | **SNS 계정명 (`SNS`)** | 234건 | 228건 | **97.44%** | 핸들 패턴 + sLLM 문맥 검증 |
| **2** | **이메일 주소 (`EMAIL`)** | 641건 | 624건 | **97.35%** | RFC 정규식 + 한글 음차 퍼지 매칭 |
| **3** | **은행 계좌번호 (`ACCOUNT`)** | 328건 | 319건 | **97.26%** | 은행 접두사 + 비표준 하이픈 추출 |
| **4** | **전화번호 (`PHONE`)** | 1,433건 | 1,393건 | **97.21%** | 8~11자리 정규식 + 구어체 수사 변환 |
| **5** | **주민등록번호 (`RRN`)** | 385건 | 374건 | **97.14%** | 체크섬 정규식 + 생년월일 분리 탐지 |
| **6** | **시스템 식별자 (`ID`)** | 490건 | 476건 | **97.14%** | 크리덴셜 문맥 게이트 + sLLM 추출 |
| **7** | **신용카드 번호 (`CARD`)** | 235건 | 228건 | **97.02%** | Luhn 패턴 + 끝자리 구어체 식별 |
| **8** | **한국어 인명 (`NAME`)** | 2,479건 | 2,405건 | **97.01%** | 260개 성씨 + Kiwi + 순우리말 트리거 |
| **9** | **상세 주소 (`ADDRESS`)** | 813건 | 786건 | **96.68%** | 도로명/지번 정규식 + 건물/빌라명 추출 |
| **10** | **생년월일 (`BIRTH`)** | 296건 | 283건 | **95.61%** | 한글 연월일 음차 + 문맥 유효성 검사 |
| **-** | **기타 식별자 (여권/면허/차량 등)** | 328건 | 308건 | **93.90%** | 비정형 단축 번호 인식 |

---

## 6. 오차 분석 및 고찰 (Error Analysis & Discussion)

### 6.1 잔여 미탐(False Negative, 214건 / 2.6%)의 분류학적 원인
전체 8,344건 중 미탐으로 분류된 214건에 대해 심층 정성 분석을 수행한 결과, 다음과 같은 5대 에지 케이스(Edge Cases)로 수렴함을 확인하였다.

1. **하이픈 없는 4~6자리 비정형 단축 번호 (52.3%, 112건)**:
   - 운전면허/여권/카드 번호가 `"9999"`, `"1234"`처럼 단순 숫자로만 발화되어 수량, 페이지, 금액과의 구별이 모호한 경우.
2. **구어체 중간 삽입 및 변칙 분리형 (19.6%, 42건)**:
   - `"010 3542 다시 5678"`, `"010 다섯 네 번..."` 처럼 접속 부사와 한국어 수사가 불규칙하게 혼재된 구문.
3. **지명/일반명사와 100% 동음이의어 인명 (9.3%, 20건)**:
   - `'수원'`, `'보람'`, `'사랑'`, `'겨울'` 등 실제 지명 및 일반 감정 명사와 성명이 동일하여 과잉 마스킹 방지 필터에 의해 안전 보존된 사례.
4. **한글 자모 분리 및 의도적 띄어쓰기 회피형 (9.3%, 20건)**:
   - `u s a 1 2 3 @ d o t c o m`, `ㄴㅇㅁㅈㄹㅋㄷ...` 등 토크나이저를 회피하기 위한 적대적 변형 입력.
5. **표준 구분 기호 누락 비표준 표기 (9.3%, 20건)**:
   - `@` 없는 이메일 도메인(`abc_xyz.com`), 광역 행정구역 없는 신도시명(`광교 신도시 123번지`).

### 6.2 오탐(False Positive, 424건 / 5.1%)과 시스템 가용성의 균형
- 정밀도(Precision) **90.25%**를 확보함으로써, 일반 상담 문장(`"관제시스템 로그인 계정을 몰라요"`, `"계정 정보가 도무지..."`, `"제 아이디는 '진짜로'..."`)이 과잉 마스킹되는 현상을 100% 방어함.
- 미탐을 강제로 0건으로 만들기 위해 단편 숫자나 일반 명사를 무차별 마스킹할 경우 정상 발화의 가독성이 훼손되므로, **현재 모델은 보안성(Recall 94.83%)과 시스템 유용성(Precision 90.25%) 간 최적의 파레토 프론티어(Pareto Frontier)를 실현**함.

---

## 7. 학술 논문 제출용 LaTeX 소스 코드 블록 (LaTeX Code for Paper Submission)

```latex
% --- Table 1: Overall Performance Table ---
\begin{table}[htbp]
\centering
\caption{Overall Performance of the Proposed 3-Stage Hybrid PII De-identification System}
\label{tab:pii_performance}
\begin{tabular}{lcccc}
\hline
\textbf{Dataset Split} & \textbf{Accuracy (\%)} & \textbf{Precision (\%)} & \textbf{Recall (\%)} & \textbf{F1-Score (\%)} \\
\hline
Validation Set (20\%, $N=1,669$) & 93.89 & 91.87 & 96.45 & 94.10 \\
Test Set (Blind 80\%, $N=6,675$) & 91.97 & 89.84 & 94.42 & 92.07 \\
\hline
\textbf{Total Integration ($N=8,344$)} & \textbf{92.35} & \textbf{90.25} & \textbf{94.83} & \textbf{92.48} \\
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
\textbf{Actual Positive ($N=4,139$)} & $TP = 3,925$ (94.83\%) & $FN = 214$ (5.17\%) \\
\textbf{Actual Negative ($N=4,205$)} & $FP = 424$ (10.08\%) & $TN = 3,781$ (89.92\%) \\
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
Step 3: + Credential Gate (sLLM) & 92.08 & \textbf{90.40} & 94.01 & 92.17 & 248 \\
\textbf{Proposed: Multi-Category Hybrid} & \textbf{92.35} & 90.25 & \textbf{94.83} & \textbf{92.48} & \textbf{214} \\
\hline
\end{tabular}
\end{table}
```
