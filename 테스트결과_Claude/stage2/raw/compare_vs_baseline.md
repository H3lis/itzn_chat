| 지표 | 기준선 | 신규 |
| --- | ---: | ---: |
| areas_ok | 25/25 | 35/35 |
| clarify_required_ok | 3/8 | 3/8 |
| faq_ok | 19/20 | 25/25 |
| followup_ok | 25/25 | 35/35 |
| route_ok | 49/58 | 54/58 |
| scenario_ok | 5/5 | 5/5 |
| type_ok | 53/60 | 61/61 |

변경된 턴:
- CL_DS1A_001 t1: areas_ok: None → True, buttons: None → [], clarify_candidates: ['무선망:49', '유무선통합관제:22'] → None, faq_ok: None → True, followup_ok: None → True, route_ok: False → True, type_ok: False → True
- CL_DS2C_001 t1: clarify_candidates: ['유무선통합관제:12', '유무선통합관제:4'] → None, faq_ok: None → True, route_ok: False → True, type_ok: False → True
- CL_DS3B_001 t1: clarify_candidates: ['유무선통합관제:2', '무선망:16'] → ['유무선통합관제:2']
- CL_DS3B_001 t2: faq_ok: False → None, route_ok: True → False
- CL_DS4A_001 t1: areas_ok: None → True, button_source: None → clarify_candidates_fallback, buttons: None → ['AP 전원이 안 들어옵니다.', "AP 연결 시 'Link' 불이 안 들어옵니다."], clarify_candidates: ['무선망:3', '무선망:50'] → None, faq_ok: None → True, followup_ok: None → True, route_ok: False → True, type_ok: False → True
- CL_DS4A_001 t2: areas_ok: None → True, button_source: None → clarify_candidates_fallback, buttons: None → ['AP는 콘센트가 안 보이는데 전원을 어떻게 받는 건가요?'], followup_ok: None → True, skipped: availability_failure → None
- CL_DS4A_001 t3: areas_ok: None → True, button_source: None → followup_tag, buttons: None → ['네, PoE 스위치에 대해 알려주세요'], followup_ok: None → True, kind: None → followup_click, turn_index: None → 3
- CL_DS4A_001 t4: areas_ok: None → True, button_source: None → clarify_candidates_fallback, buttons: None → ['PoE란 무엇인가요?', 'PoE가 뭐고 어디서 확인하나요?'], followup_ok: None → True, kind: None → followup_click, turn_index: None → 4
- CL_DS4B_001 t1: areas_ok: None → True, button_source: None → clarify_candidates_fallback, buttons: None → ['와이파이가 수업 중에 자꾸 끊기고 느려요.', '학교 인터넷이 자꾸 느린데, 회선을 늘려야 하는 건지 어떻게 알아요?'], clarify_candidates: ['무선망:17', '학내망:10'] → None, faq_ok: None → True, followup_ok: None → True, route_ok: False → True, type_ok: False → True
- CL_DS4B_001 t2: areas_ok: None → True, button_source: None → followup_tag, buttons: None → ["네, 스쿨넷 이용관리시스템에 로그인해서 '이용신청현황 > 신청서 내역 조회'로 들어가시면 소속 학교가 등록한 신청서 목록과 처리 상태를 볼 수 있어요. 목록에서 '신청번호'나 '배정번호'를 클릭하시면 상세정보로 이동하고, '...'와 같은 내용을 확인해 보세요에 대해 알려주세요", '네, 일부 교실만 느려지는 것 같은데, 그 교실의 AP 상태를 확인해 보시면 권장합니다에 대해 알려주세요'], followup_ok: None → True, skipped: availability_failure → None
- CL_DS4B_001 t3: areas_ok: None → True, button_source: None → followup_tag, buttons: None → ['네, 특정 교실의 AP 상태를 확인해 보시면 좋겠습니다에 대해 알려주세요'], followup_ok: None → True, kind: None → followup_click, turn_index: None → 3
- PILOT_DS2B_001 t1: buttons: ['네, 학교 관리자에게 문의해 보시려면 알려주세요 | 네, 학교 아이디와 비밀번호 관련 문제에 대해 알려주세요'] → ['네, 학교 로그인 화면에 대한 설명을 드릴까요에 대해 알려주세요']
- PILOT_DS3B_001 t1: clarify_candidates: ['학내망:29', '유무선통합관제:11'] → ['학내망:29']
- PILOT_DS4B_001 t1: buttons: ['네, 설치 위치에 대해 알려주세요', '네, IP와 MAC 정보에 대해 알려주세요'] → ['네, AP관리 메뉴에 들어가주세요에 대해 알려주세요', '네, AP모니터링에서 실시간 AP조회를 해보세요에 대해 알려주세요']
- PILOT_DS5C_001 t1: clarify_candidates: ['학내망:2', '스쿨넷:20'] → ['학내망:2']
- P_DS1B_001 t1: button_source: followup_tag → clarify_candidates_fallback, buttons: ['네, 스쿨넷 서비스 고객센터(1899-0979)에 문의해 보시겠습니까에 대해 알려주세요', '네, 스쿨넷 이용관리시스템 로그인 방법에 대해 알려주세요'] → ["스쿨넷 서비스(인터넷 회선)를 새로 신청하려면 어디서 시작하나요? '이용기관 등록신청'이 뭔가요?", '스쿨넷서비스 기술지원을 받고 싶습니다.']
- P_DS2A_001 t1: clarify_candidates: ['학내망:5', '학내망:2'] → None, faq_ok: None → True, route_ok: False → True, type_ok: False → True
- P_DS2C_001 t1: clarify_candidates: ['무선망:16', '무선망:7'] → None, faq_ok: None → True, route_ok: False → True, type_ok: False → True
- P_DS4A_001 t1: button_source: followup_tag → clarify_candidates_fallback, buttons: ['네, 스쿨넷 서비스 고객센터(1899-0979)에 문의해 보시겠습니까에 대해 알려주세요', '네, 스쿨넷 이용관리시스템 로그인 방법에 대해 알려주세요'] → ["스쿨넷 서비스(인터넷 회선)를 새로 신청하려면 어디서 시작하나요? '이용기관 등록신청'이 뭔가요?", '스쿨넷서비스 기술지원을 받고 싶습니다.']
- P_DS4A_001 t2: areas_ok: None → True, button_source: None → clarify_candidates_fallback, buttons: None → ['새 학기에 새 인터넷 회선을 추가로 신청하려면 어떻게 하나요?'], clarify_candidates: ['스쿨넷:51', '스쿨넷:8'] → None, followup_ok: None → True, type_ok: False → True
- P_DS4A_001 t3: areas_ok: None → True, button_source: None → clarify_candidates_fallback, buttons: None → ['서비스에 회선서비스와 인터넷서비스가 있는데 어떤 걸로 신청해야 하나요?'], followup_ok: None → True, skipped: availability_failure → None, type_ok: None → True
- P_DS4B_001 t2: button_source: followup_tag → None, buttons: ['네, PoE 스위치에 대해 알려주세요'] → []
- P_DS4B_001 t3: skipped: availability_failure → normal_end

총 23턴 변경
