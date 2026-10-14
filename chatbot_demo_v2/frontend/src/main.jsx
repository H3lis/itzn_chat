import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { checkAndRedirectIfOnline } from './utils/onlineRedirect'

// 파일 더블클릭 실행(file://) 시 인터넷이 연결되어 있으면 온라인 웹 주소로 즉각 전환
checkAndRedirectIfOnline();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
