// Service Worker for School Chatbot Offline Resilience
const CACHE_NAME = 'school-chatbot-shell-v1';
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
];

// 1. 설치: 기본 앱 셸 프리캐싱 및 즉시 활성화
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.debug('[SW] 프리캐시 일부 생략 (무시 가능):', err);
      });
    })
  );
});

// 2. 활성화: 구버전 캐시 정리 및 클라이언트 즉시 제어
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. 패치 가로채기: 네비게이션(페이지 이동/새로고침) 및 정적 자산 오프라인 폴백
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 백엔드 API 호출, SSE 스트림, 헬스체크는 캐시를 우회하여 실시간 통신
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // HTML 네비게이션 요청 (브라우저 주소창 입력, 새로고침, 링크 이동)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          // 온라인: 최신 HTML을 캐시에 업데이트하고 반환
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, copy);
              cache.put('/', copy);
            });
          }
          return networkRes;
        })
        .catch(() => {
          // 오프라인 (인터넷 단절 / ERR_INTERNET_DISCONNECTED):
          // 브라우저 공룡 에러를 원천 차단하고 캐시된 앱 셸을 0초 즉시 반환!
          return caches.match(req).then((cached) => {
            return cached || caches.match('/') || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // 정적 자산 (JS, CSS, 이미지, 폰트): Stale-While-Revalidate 전략
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cachedRes) => {
        const fetchPromise = fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        }).catch(() => cachedRes);

        return cachedRes || fetchPromise;
      })
    );
  }
});
