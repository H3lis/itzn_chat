import { useEffect, useRef, useCallback } from 'react';
import { saveScenarioCache } from '../utils/TieredDataLoader';
import { buildApiUrl } from '../utils/apiBase';

/**
 * 백그라운드 시나리오 자동 동기화 훅 (useAutoSync)
 *
 * 온라인 상태를 감지하여 조용히 서버의 최신 시나리오 트리와 버전을 조회하고,
 * 새 버전이 감지되면 localStorage에 영구 갱신 및 메모리 핫스왑 콜백을 호출합니다.
 */
export function useAutoSync({ currentVersion, onSyncSuccess, isOnline = true }) {
  const isSyncingRef = useRef(false);

  const checkAndSync = useCallback(async () => {
    if (!navigator.onLine || !isOnline) {
      return;
    }
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      // 1. 헤더 경량 프로빙 또는 전체 최신 시나리오 요청
      const res = await fetch(buildApiUrl('/api/scenarios/latest'), {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (!res.ok) {
        return;
      }

      const payload = await res.json();
      const remoteVersion = payload.version;

      // 버전이 변경되었거나 아직 캐시되지 않은 상태인 경우
      if (remoteVersion && remoteVersion !== currentVersion) {
        console.log(`[AutoSync] 최신 시나리오 감지 (${currentVersion} -> ${remoteVersion}). 로컬 동기화 실행.`);
        const scenarioTree = {
          root_node_id: payload.root_node_id,
          nodes: payload.nodes,
        };

        saveScenarioCache(scenarioTree, remoteVersion, payload.updated_at);

        if (onSyncSuccess) {
          onSyncSuccess({
            version: remoteVersion,
            updatedAt: payload.updated_at,
            data: scenarioTree,
          });
        }
      }
    } catch {
      // 오프라인이거나 서버 연결 실패 시 사용자 화면을 방해하지 않고 무시
    } finally {
      isSyncingRef.current = false;
    }
  }, [currentVersion, isOnline, onSyncSuccess]);

  // 마운트 시 1회 실행 + 온라인 이벤트 감지 시 실행
  useEffect(() => {
    checkAndSync();

    const handleOnline = () => {
      console.log('[AutoSync] 네트워크 온라인 전환 감지. 최신 시나리오 동기화 시도.');
      checkAndSync();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [checkAndSync]);

  return { triggerSync: checkAndSync };
}
