# 🎨 프론트엔드 UI/UX 디자인 및 수정 협업 가이드

본 가이드의 공식 원본 문서는 프로젝트 루트에 위치해 있습니다:
👉 **[`프론트엔드_디자인_및_UI_수정_협업_가이드.md`](file:///c:/Users/ITZN/Desktop/챗봇/프론트엔드_디자인_및_UI_수정_협업_가이드.md)**

---

## ⚡ 빠른 요약 (Quick Reference)

### 1. 주요 스타일 시트 위치
* **메인 및 고객 대화창**: [`src/index.css`](file:///c:/Users/ITZN/Desktop/챗봇/chatbot_demo_v2/frontend/src/index.css) (CSS 변수 `:root` 포함)
* **관리자 콘솔**: [`src/components/Admin/Admin.css`](file:///c:/Users/ITZN/Desktop/챗봇/chatbot_demo_v2/frontend/src/components/Admin/Admin.css)

### 2. 로컬 실시간 개발 서버 실행
```bash
cd c:\Users\ITZN\Desktop\챗봇\chatbot_demo_v2\frontend
npm run dev
```
* 데모 모드: `http://localhost:5173/`
* 고객용 모드: `http://localhost:5173/client`
* 관리자 모드: `http://localhost:5173/admin`

### 3. 수정 후 필수 빌드 및 배포본 동기화
```bash
# 1. 일반 웹 번들 + 단일 오프라인 번들 동시 빌드
npm run build:all

# 2. 프로젝트 루트의 공식 오프라인 배포 파일 덮어쓰기 (PowerShell)
Copy-Item -Path "dist-standalone\index.html" -Destination "..\..\학교챗봇_장애대응가이드_오프라인.html" -Force
```

상세한 디자인 토큰 명세, 컴포넌트별 클래스 매핑 및 수정 레시피는 루트의 **[`프론트엔드_디자인_및_UI_수정_협업_가이드.md`](file:///c:/Users/ITZN/Desktop/챗봇/프론트엔드_디자인_및_UI_수정_협업_가이드.md)**를 참조해 주세요.
