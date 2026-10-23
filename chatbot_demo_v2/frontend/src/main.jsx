import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 브라우저 HTTP/HTTPS 접속 시 PWA Service Worker 자동 등록 (오프라인 회복 탄력성 보장)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.debug('[PWA] Service Worker 등록 성공:', reg.scope);
        })
        .catch((err) => {
          console.debug('[PWA] Service Worker 등록 생략:', err);
        });
    });
  }
}

