"""PII 실시간 비식별화 엔진 단위 테스트 (test_pii.py)."""
import pytest
from chatbot_demo_v2.app.pii_service import PiiMasker, default_masker


def test_phone_masking():
    masker = PiiMasker()
    # 휴대전화
    res1 = masker.mask_text("담당자 연락처는 010-1234-5678 입니다.")
    assert res1.has_pii is True
    assert "phone" in res1.detected_types
    assert "010-****-5678" in res1.masked_text

    # 공백 구분 전화번호
    res2 = masker.mask_text("제 번호 010 9876 5432 로 연락주세요.")
    assert "010-****-5432" in res2.masked_text or "010 **** 5432" in res2.masked_text

    # 유선전화 (지역번호)
    res3 = masker.mask_text("학교 교무실 031-234-5678 로 전화바람")
    assert "031-***-5678" in res3.masked_text or "031-****-5678" in res3.masked_text

    # 대시 없는 휴대전화 및 유선전화 (조사 결합 포함)
    res_nodash1 = masker.mask_text("제 번호 01012345678로 연락주세요.")
    assert res_nodash1.has_pii is True
    assert "010****5678로" in res_nodash1.masked_text

    res_nodash2 = masker.mask_text("행정실 03112345678로 전화해.")
    assert res_nodash2.has_pii is True
    assert "031****5678로" in res_nodash2.masked_text

    # 한글 바로 뒤에 공백 없이 붙은 대시 없는 11자리 전화번호 (실제 사용자 질의 케이스)
    res_nodash_attached = masker.mask_text("지금 전산 관련 교육청에 문의를 넣어야하는데01086592481로 연락하면 되지?")
    assert res_nodash_attached.has_pii is True
    assert "phone" in res_nodash_attached.detected_types
    assert "010****2481로" in res_nodash_attached.masked_text
    assert "01086592481" not in res_nodash_attached.masked_text

    # 대시 없는 050 안심번호 및 9자리 서울 유선번호
    res_050 = masker.mask_text("안심번호 050712345678로 문자 주세요")
    assert res_050.has_pii is True
    assert "0507****5678로" in res_050.masked_text

    res_seoul_9d = masker.mask_text("서울 사무소 027654321로 확인해봐")
    assert res_seoul_9d.has_pii is True
    assert "02***4321로" in res_seoul_9d.masked_text

    # 국번없이 적힌 8자리 전화번호 (대시 있는 경우 및 없는 경우)
    res_8d1 = masker.mask_text("국번없는 8자리 2345-6789로 전화주세요.")
    assert res_8d1.has_pii is True
    assert "****-6789로" in res_8d1.masked_text

    res_8d2 = masker.mask_text("국번없는 8자리 대시없이 23456789입니다.")
    assert res_8d2.has_pii is True
    assert "****6789입니다." in res_8d2.masked_text

    # 스쿨넷 및 대표 안내번호는 마스킹 제외 (화이트리스트 보존)
    res_pub1 = masker.mask_text("스쿨넷 지원센터(1899-0979)로 연락해 주세요.")
    assert "1899-0979" in res_pub1.masked_text
    assert res_pub1.has_pii is False

    res_pub2 = masker.mask_text("스쿨넷 대시없는 18990979 안내")
    assert "18990979" in res_pub2.masked_text
    assert res_pub2.has_pii is False

    res_pub3 = masker.mask_text("대표번호 1588-1234 및 1544-0079")
    assert "1588-1234" in res_pub3.masked_text
    assert "1544-0079" in res_pub3.masked_text
    assert res_pub3.has_pii is False

    res_pub4 = masker.mask_text("지역번호 붙은 스쿨넷 031-1899-0979 문의")
    assert "031-1899-0979" in res_pub4.masked_text
    assert res_pub4.has_pii is False

    # 날짜(Date) vs 국번 없는 8자리 전화번호(Phone) 문맥 판별 검증
    # 1) 표준 날짜 표기(YYYY-MM-DD)는 마스킹되지 않아야 함
    res_date1 = masker.mask_text("회의 일자는 2024-05-12 입니다.")
    assert "2024-05-12" in res_date1.masked_text
    assert res_date1.has_pii is False

    # 2) 8자리 연속 숫자(YYYYMMDD)가 날짜 문맥일 때는 보존
    res_date2 = masker.mask_text("점검일정은 20240512 일자입니다.")
    assert "20240512" in res_date2.masked_text
    assert res_date2.has_pii is False

    # 3) 8자리 연속 숫자(YYYYMMDD)가 단독 또는 전화 키워드가 없을 때는 보존
    res_date3 = masker.mask_text("기준일: 20260917")
    assert "20260917" in res_date3.masked_text
    assert res_date3.has_pii is False

    # 4) 날짜 형태(19xx/20xx)지만 명백한 전화번호/연락 문맥이 있는 경우 전화번호로 마스킹
    res_phone_collision1 = masker.mask_text("제 전화번호 2024-0512 로 연락주세요.")
    assert "****-0512" in res_phone_collision1.masked_text
    assert res_phone_collision1.has_pii is True

    res_phone_collision2 = masker.mask_text("담당자 연락처는 20210315 번호입니다.")
    assert "****0315" in res_phone_collision2.masked_text
    assert res_phone_collision2.has_pii is True


def test_ip_masking():
    masker = PiiMasker()
    # IPv4 호스트 대역 마스킹
    res = masker.mask_text("선생님 PC IP 주소 192.168.10.105 가 안 잡혀요")
    assert res.has_pii is True
    assert "ipv4" in res.detected_types
    assert "192.168.*.*" in res.masked_text
    assert "192.168.10.105" not in res.masked_text

    # 앞자리 0이 포함된 IPv4 주소 (예: 121.255.17.03)
    res_zero = masker.mask_text("인터넷은 잘 되는거같은데, 121.255.17.03 은 왜 연결이 안될까?")
    assert res_zero.has_pii is True
    assert "ipv4" in res_zero.detected_types
    assert "121.255.*.*" in res_zero.masked_text
    assert "121.255.17.03" not in res_zero.masked_text


def test_rrn_masking():
    masker = PiiMasker()
    res = masker.mask_text("주민등록번호 950101-1234567 확인 부탁드립니다.")
    assert res.has_pii is True
    assert "rrn" in res.detected_types
    assert "******-*******" in res.masked_text
    assert "950101-1234567" not in res.masked_text


def test_email_masking():
    masker = PiiMasker()
    res = masker.mask_text("이메일 honggildong@korea.kr 로 전송해주세요.")
    assert res.has_pii is True
    assert "email" in res.detected_types
    assert "h**********@korea.kr" in res.masked_text or "h***@korea.kr" in res.masked_text


def test_korean_name_masking():
    masker = PiiMasker(backend="rule")
    # 3글자 이름: 한 글자 제외하고 전체 마스킹 (홍길동 -> 홍**)
    res1 = masker.mask_text("교무실 홍길동 선생님 PC가 인터넷이 안 됩니다.")
    assert "홍**" in res1.masked_text
    assert "홍길동" not in res1.masked_text

    # 2글자 이름: 한 글자 제외하고 전체 마스킹 (김철 -> 김*)
    res2 = masker.mask_text("이건 김철 교사 자리입니다.")
    assert "김*" in res2.masked_text
    assert "김철" not in res2.masked_text

    # 4글자 복성(남궁, 제갈 등) 인명 마스킹
    res3 = masker.mask_text("남궁민수 선생님에게 문의드렸습니다.")
    assert "남***" in res3.masked_text
    assert "남궁민수" not in res3.masked_text

    res4 = masker.mask_text("제갈공명 교사가 확인했습니다.")
    assert "제***" in res4.masked_text
    assert "제갈공명" not in res4.masked_text

    res5 = masker.mask_text("남궁민수가 자리 비움. 제갈공명에게 물어보세요.")
    assert "남***" in res5.masked_text
    assert "제***" in res5.masked_text

    # 희귀 복성 '장곡' 및 인명 다양한 문맥 마스킹 (단독, 호칭, 조사, 라벨)
    res_jg1 = masker.mask_text("장곡민지")
    assert res_jg1.masked_text == "장***"
    assert "name" in res_jg1.detected_types

    res_jg2 = masker.mask_text("장곡민지가 작성함")
    assert "장***가" in res_jg2.masked_text

    res_jg3 = masker.mask_text("제 이름은 장곡민지입니다")
    assert "장***입니다" in res_jg3.masked_text
    assert "이름" in res_jg3.masked_text  # 일반명사 '이름'은 오인 마스킹되지 않아야 함

    res_jg4 = masker.mask_text("담당자: 장곡민지")
    assert "담당자: 장***" in res_jg4.masked_text

    res_jg5 = masker.mask_text("가명으로 장곡민지라는 이름으로 테스트해봤는데")
    assert "장***라는" in res_jg5.masked_text
    assert "이름" in res_jg5.masked_text

    # 희귀 단성 (궉 등)
    res_kwok = masker.mask_text("궉채이 학생입니다")
    assert "궉**" in res_kwok.masked_text

    # 직책/호칭 결합(조사 결합 포함) 및 역할 라벨 패턴 (김성겸 선생님이, 담당자인 김성겸 등)
    res_ksg1 = masker.mask_text("지금 AP연결을 해야하는데 담당자인 김성겸 선생님이 없어. 어떡해야할까?")
    assert "김** 선생님이" in res_ksg1.masked_text
    assert "김성겸" not in res_ksg1.masked_text
    assert "name" in res_ksg1.detected_types

    res_ksg2 = masker.mask_text("담당자인 김성겸이 없어")
    assert "김**이" in res_ksg2.masked_text

    res_ksg3 = masker.mask_text("김성겸선생님이 부재중이십니다")
    assert "김**선생님이" in res_ksg3.masked_text

    # 성 없는 단독 이름 (민수가 등)
    res_single_name = masker.mask_text("민수가 자리에 없어")
    assert "민*가" in res_single_name.masked_text
    assert "name" in res_single_name.detected_types

    # 교육행정 고유명사 및 IT/학교 역할 일반명사는 보존 (오인 마스킹 방지)
    res6 = masker.mask_text("나이스 및 스쿨넷 점검 담당자 확인 바람")
    assert "스쿨넷" in res6.masked_text
    assert "나이스" in res6.masked_text

    res_safe = masker.mask_text("문제는 AP 연결이 안 됩니다. 서버를 재부팅해주세요.")
    assert "문제는" in res_safe.masked_text
    assert "연결이" in res_safe.masked_text
    assert "서버를" in res_safe.masked_text

    # 역할 일반명사(담당, 담임, 전산, 사서 등) 오인 마스킹 방지 검증
    res_role1 = masker.mask_text("성영준 선생님 담당이었어서 난 잘 몰라. 알려줘.")
    assert "성** 선생님" in res_role1.masked_text
    assert "담당이었어서" in res_role1.masked_text
    assert "담*" not in res_role1.masked_text

    res_role2 = masker.mask_text("전산 담당 선생님께 문의하시기 바랍니다.")
    assert "전산 담당 선생님께" in res_role2.masked_text
    assert "담*" not in res_role2.masked_text

    # 학교 부서(정보부, 교무부, 학생부, 연구부 등) 및 스쿨넷 지원센터 안내문구 오인 마스킹 방지
    res_abstain = masker.mask_text(
        "죄송합니다. 현재 내부 자료로는 정확한 답변을 드리기 어렵습니다. "
        "학교 정보부 담당 선생님께 문의하시거나, 스쿨넷 서비스 지원센터(1899-0979)로 연락해 주세요."
    )
    assert res_abstain.has_pii is False
    assert "학교 정보부 담당 선생님께" in res_abstain.masked_text
    assert "정**" not in res_abstain.masked_text
    assert "지원센터(1899-0979)" in res_abstain.masked_text

    res_dept = masker.mask_text("교무부 및 학생부, 연구부 담당 선생님 회의가 있습니다.")
    assert res_dept.has_pii is False
    assert "교무부" in res_dept.masked_text
    assert "학생부" in res_dept.masked_text
    assert "연구부" in res_dept.masked_text


def test_serial_and_mac_masking():
    masker = PiiMasker()
    # S/N 시리얼 번호 마스킹
    res1 = masker.mask_text("AP 장비 S/N: FOC21450XYZ 가 불량입니다.")
    assert res1.has_pii is True
    assert "serial" in res1.detected_types
    assert "FOC21450XYZ" not in res1.masked_text
    assert "S/N: ***********" in res1.masked_text

    # 한글 라벨 시리얼 번호
    res2 = masker.mask_text("시리얼번호 2102353000123 확인 바람")
    assert "serial" in res2.detected_types
    assert "2102353000123" not in res2.masked_text
    assert "시리얼번호 *************" in res2.masked_text

    # 기기 MAC 주소 마스킹
    res3 = masker.mask_text("기기 MAC은 00:1A:2B:3C:4D:5E 입니다.")
    assert res3.has_pii is True
    assert "mac" in res3.detected_types
    assert "00:1A:2B:3C:4D:5E" not in res3.masked_text
    assert "**:**:**:**:**:**" in res3.masked_text


def test_complex_sentence():
    masker = PiiMasker(backend="rule")
    input_text = "교무실 홍길동 교사 PC IP 192.168.1.50 및 AP S/N: FOC21450XYZ 안 됩니다. 010-1234-5678 연락요망"
    res = masker.mask_text(input_text)
    assert res.has_pii is True
    assert "phone" in res.detected_types
    assert "ipv4" in res.detected_types
    assert "serial" in res.detected_types
    assert "name" in res.detected_types
    assert "192.168.*.*" in res.masked_text
    assert "010-****-5678" in res.masked_text
    assert "홍**" in res.masked_text
    assert "S/N: ***********" in res.masked_text


def test_sllm_and_fallback_modes():
    # 1. 명시적 rule 모드
    rule_masker = PiiMasker(backend="rule")
    res_rule = rule_masker.mask_text("교무실 홍길동 선생님 PC 고장")
    assert "홍**" in res_rule.masked_text

    # 2. sllm 정상 모드 (띄어쓰기 인명 '정 산 주무관' 마스킹 및 '운영 담당자' 보존 검증)
    sllm_masker = PiiMasker(backend="sllm", sllm_model="qwen2.5:1.5b", timeout_s=8.0)
    q = "안녕하세요, 현재 인수인계 받는중인 정 산 주무관입니다. 스쿨넷 관련 자료를 받았는데, 양이 너무 많아서 요약해서 정리해줄수 있나요?"
    res_q = sllm_masker.mask_text(q)
    assert "정* 주무관" in res_q.masked_text
    assert "정 산" not in res_q.masked_text
    assert res_q.has_pii is True

    # 설명/답변 내 운영 담당자 오마스킹 방지 (보조 룰 엔진 비활성화 검증)
    ans = "관리자 계정은 임의 추가가 불가하므로 필요 시 운영 담당자에게 문의하시기 바랍니다."
    res_ans = sllm_masker.mask_text(ans)
    assert "운영 담당자" in res_ans.masked_text
    assert "운*" not in res_ans.masked_text
    assert res_ans.has_pii is False


def test_credential_masking():
    masker = PiiMasker()
    # 1. 조사 및 구어체 결합 (내 계정 비밀번호는 asdasasd 야)
    res1 = masker.mask_text("내 계정 비밀번호는 asdasasd 야")
    assert res1.has_pii is True
    assert "credential" in res1.detected_types
    assert "내 계정 비밀번호는 ******** 야" in res1.masked_text

    res1_glued = masker.mask_text("내 계정 비밀번호는 asdasasd야")
    assert "내 계정 비밀번호는 ********야" in res1_glued.masked_text

    # 2. 콜론/라벨 결합
    res2 = masker.mask_text("비밀번호: Admin1234!")
    assert "비밀번호: **********" in res2.masked_text
    assert "credential" in res2.detected_types

    # 3. 복수 계정 정보 (아이디, 비번)
    res3 = masker.mask_text("아이디는 testuser 이고 비번은 pass1234야")
    assert "아이디는 ******** 이고 비번은 ********야" in res3.masked_text

    # 4. IT 장비 ID (VLAN ID, 포트 ID 등) 오탐 방지
    res4 = masker.mask_text("스위치 VLAN ID 10 및 포트 ID 1 설정해주세요.")
    assert "VLAN ID 10" in res4.masked_text
    assert "포트 ID 1" in res4.masked_text
    assert "credential" not in res4.detected_types


def test_account_masking():
    masker = PiiMasker()
    # 1. 은행명 라벨 포함 계좌번호
    res1 = masker.mask_text("계좌번호는 국민 123-456-789012 입니다.")
    assert res1.has_pii is True
    assert "account" in res1.detected_types
    assert "123-***-******" in res1.masked_text

    res2 = masker.mask_text("신한 110-123-456789 로 이체해줘")
    assert "110-***-******" in res2.masked_text
    assert "account" in res2.detected_types


def test_driver_license_and_passport_masking():
    masker = PiiMasker()
    # 1. 운전면허번호 (숫자 지역코드 및 한글 지역코드)
    res_lic1 = masker.mask_text("운전면허 11-22-123456-12 확인 요망")
    assert res_lic1.has_pii is True
    assert "driver_license" in res_lic1.detected_types
    assert "11-**-******-**" in res_lic1.masked_text

    res_lic2 = masker.mask_text("면허증 서울-12-123456-12 입니다")
    assert "서울-**-******-**" in res_lic2.masked_text

    # 2. 여권번호 (구여권 및 신여권 전자여권)
    res_pass1 = masker.mask_text("여권번호 M12345678 입니다.")
    assert res_pass1.has_pii is True
    assert "passport" in res_pass1.detected_types
    assert "M********" in res_pass1.masked_text

    res_pass2 = masker.mask_text("신여권 M123A4567 확인")
    assert "M********" in res_pass2.masked_text

    # 3. 네트워크 장비명 오탐 방지 (WS-C2960-24TC-L 등)
    res_dev = masker.mask_text("장비 모델은 WS-C2960-24TC-L 스위치입니다.")
    assert "WS-C2960-24TC-L" in res_dev.masked_text
    assert "passport" not in res_dev.detected_types


def test_student_and_address_masking():
    masker = PiiMasker()
    # 1. 학번
    res_std = masker.mask_text("신청 학생 학번: 20241020 입니다.")
    assert res_std.has_pii is True
    assert "student_id" in res_std.detected_types
    assert "학번: ********" in res_std.masked_text

    # 2. 학적 정보 (학년-반-번) 및 인명 결합
    res_rec = masker.mask_text("학생 정보는 3학년 2반 15번 홍길동 입니다.")
    assert res_rec.has_pii is True
    assert "school_record" in res_rec.detected_types
    assert "*학년 *반 **번" in res_rec.masked_text
    assert "홍**" in res_rec.masked_text

    # 3. 상세 거주지 주소 (동·호수)
    res_addr1 = masker.mask_text("거주지는 분당 파크뷰 102동 1201호 입니다.")
    assert res_addr1.has_pii is True
    assert "address" in res_addr1.detected_types
    assert "****동 ****호" in res_addr1.masked_text

    res_addr2 = masker.mask_text("우편물 301호로 전달 부탁드립니다.")
    assert "****호로" in res_addr2.masked_text

    # 4. 학교 교무실/전산실 오탐 방지
    res_sch = masker.mask_text("교무실 1호 및 컴퓨터실에 장비가 있습니다.")
    assert "교무실 1호" in res_sch.masked_text
    assert "address" not in res_sch.detected_types

