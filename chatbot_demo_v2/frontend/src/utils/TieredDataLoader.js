/**
 * 계층형 시나리오 데이터 로더 (TieredDataLoader)
 *
 * 역할:
 * 1. Tier 1 (최우선): localStorage에 동기화된 최신 시나리오 캐시 탐색
 * 2. Tier 2 (폴백): 캐시가 없는 최초 실행/망분리 PC는 번들 내장본(defaultScenarios) 즉시 로드
 */
import defaultScenarios from '../data/defaultScenarios.json';

export const SCENARIO_CACHE_KEY = 'chatbot_synced_scenarios_v1';
export const SCENARIO_VERSION_KEY = 'chatbot_synced_version';
export const SCENARIO_UPDATED_AT_KEY = 'chatbot_synced_updated_at';

export function loadScenarioData() {
  try {
    const cachedRaw = localStorage.getItem(SCENARIO_CACHE_KEY);
    const cachedVersion = localStorage.getItem(SCENARIO_VERSION_KEY);
    const cachedUpdatedAt = localStorage.getItem(SCENARIO_UPDATED_AT_KEY);

    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      if (parsed && parsed.nodes && parsed.root_node_id) {
        return {
          source: 'CACHE',
          version: cachedVersion || 'cached',
          updatedAt: cachedUpdatedAt || null,
          data: parsed,
        };
      }
    }
  } catch (err) {
    console.warn('[TieredDataLoader] 로컬 캐시 파싱 실패, 내장 기본본으로 폴백:', err);
  }

  // 로컬 캐시가 없는 최초 실행자는 배포 파일에 내장된 기본 시나리오 로드
  return {
    source: 'EMBEDDED',
    version: '1.0.0',
    updatedAt: null,
    data: defaultScenarios,
  };
}

export function saveScenarioCache(scenarioData, version, updatedAt) {
  try {
    if (!scenarioData || !scenarioData.nodes) return false;
    localStorage.setItem(SCENARIO_CACHE_KEY, JSON.stringify(scenarioData));
    if (version) localStorage.setItem(SCENARIO_VERSION_KEY, version);
    if (updatedAt) localStorage.setItem(SCENARIO_UPDATED_AT_KEY, updatedAt);
    return true;
  } catch (err) {
    console.error('[TieredDataLoader] 시나리오 캐시 저장 실패:', err);
    return false;
  }
}

export function clearScenarioCache() {
  try {
    localStorage.removeItem(SCENARIO_CACHE_KEY);
    localStorage.removeItem(SCENARIO_VERSION_KEY);
    localStorage.removeItem(SCENARIO_UPDATED_AT_KEY);
  } catch (err) {
    console.error('[TieredDataLoader] 시나리오 캐시 삭제 실패:', err);
  }
}
