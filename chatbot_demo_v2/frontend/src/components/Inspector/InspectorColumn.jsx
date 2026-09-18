import React from 'react';
import {
  Search,
  Activity,
  Clock,
  Image as ImageIcon,
  ShieldCheck,
  AlertTriangle,
  Zap,
  ExternalLink,
} from 'lucide-react';

function confBadgeClass(c) {
  if (c === 'high') return 'badge-tag high';
  if (c === 'low' || c === 'unknown') return 'badge-tag low';
  if (c === 'abstain' || c === 'none') return 'badge-tag abstain';
  return 'badge-tag';
}

function confLabel(c) {
  const map = { high: '높음', low: '낮음', unknown: '불명', abstain: '회피', none: '없음' };
  return map[c] || c;
}

export function InspectorColumn({
  response,
  health,
  warmupLoading,
  warmupMsg,
  onWarmup,
  onOpenEvidence,
}) {
  const resp = response;

  // Compile evidence list
  const evis = [
    ...(resp?.evidence || []).filter((e) => e?.image_url),
    ...(resp?.faq_evidence || []).filter((e) => e?.image_url),
  ];

  // Engine status summary from health
  const eng = health?.engine || {};
  const ls = health?.langsmith || {};
  const tg = health?.toggles || {};
  const onStr = (b) => (b ? 'on' : 'off');

  return (
    <aside className="inspector-column">
      {/* Header */}
      <div className="inspector-header">
        <div className="inspector-title">
          <Activity size={18} color="#2563eb" />
          <span>답변 근거 · 처리 과정</span>
        </div>

        {resp && (
          <div className="inspector-badges-row">
            {resp.route && (
              <span className="badge-tag route">route: {resp.route}</span>
            )}
            {resp.answer_source && (
              <span className="badge-tag">출처: {resp.answer_source}</span>
            )}
            {resp.answer_path && (
              <span className="badge-tag">path: {resp.answer_path}</span>
            )}
            {resp.confidence && (
              <span className={confBadgeClass(resp.confidence)}>
                신뢰도: {confLabel(resp.confidence)}
              </span>
            )}
            {resp.composed && (
              <span className="badge-tag composed">답변 정리됨</span>
            )}
            {resp.grader_verdict && (
              <span className="badge-tag">판정: {resp.grader_verdict}</span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="inspector-body">
        {!resp ? (
          <div className="inspector-empty">
            <div className="inspector-empty-icon">
              <Search size={26} />
            </div>
            <p>
              왼쪽에서 질문하거나 시나리오를 선택하면
              <br />
              여기에 <b>처리 파이프라인 · 소요 시간 · 근거 이미지</b>가 표시됩니다.
            </p>
          </div>
        ) : (
          <>
            {/* 1. LangGraph 파이프라인 경로 */}
            {resp.trace && resp.trace.length > 0 && (
              <div className="inspector-section">
                <div className="section-label">
                  <Activity size={15} />
                  <span>LangGraph 처리 경로</span>
                </div>
                <ol className="pipeline-list">
                  {resp.trace.map((t, idx) => (
                    <li key={idx} className="pipeline-item">
                      <span className="pipeline-dot" />
                      <div className="pipeline-node-name">{t.node}</div>
                      {t.detail && <div className="pipeline-node-detail">{t.detail}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* 2. 소요 시간 및 메타 정보 */}
            <div className="inspector-section">
              <div className="section-label">
                <Clock size={15} />
                <span>소요 시간 · 메타</span>
              </div>
              <div className="kv-grid">
                {resp.elapsed_seconds != null && (
                  <>
                    <div className="kv-key">소요 시간</div>
                    <div className="kv-val">{resp.elapsed_seconds}초</div>
                  </>
                )}

                {resp.timings?.rag_s != null && (
                  <>
                    <div className="kv-key">RAG 시간</div>
                    <div className="kv-val">{Number(resp.timings.rag_s).toFixed(1)}초</div>
                  </>
                )}

                {resp.timings?.compose_s != null && (
                  <>
                    <div className="kv-key">답변 정리</div>
                    <div className="kv-val">{Number(resp.timings.compose_s).toFixed(1)}초</div>
                  </>
                )}

                {resp.composer_fallback && (
                  <>
                    <div className="kv-key">합성 폐기 사유</div>
                    <div className="kv-val">{resp.composer_fallback}</div>
                  </>
                )}

                {/* FAQ Meta */}
                {resp.source_meta?.type === 'faq' && (
                  <>
                    {resp.source_meta.sheet && (
                      <>
                        <div className="kv-key">엑셀 시트</div>
                        <div className="kv-val">{resp.source_meta.sheet}</div>
                      </>
                    )}
                    {resp.source_meta.row != null && (
                      <>
                        <div className="kv-key">행</div>
                        <div className="kv-val">{resp.source_meta.row}</div>
                      </>
                    )}
                    {resp.source_meta.question_type && (
                      <>
                        <div className="kv-key">질문 유형</div>
                        <div className="kv-val">{resp.source_meta.question_type}</div>
                      </>
                    )}
                    {resp.source_meta.fault_type && (
                      <>
                        <div className="kv-key">장애 유형</div>
                        <div className="kv-val">{resp.source_meta.fault_type}</div>
                      </>
                    )}
                    {resp.source_meta.best_score != null && (
                      <>
                        <div className="kv-key">유사도</div>
                        <div className="kv-val">{Number(resp.source_meta.best_score).toFixed(3)}</div>
                      </>
                    )}
                    {resp.source_meta.source_files?.length > 0 && (
                      <>
                        <div className="kv-key">인용 표기</div>
                        <div className="kv-val">{resp.source_meta.source_files.join(', ')}</div>
                      </>
                    )}
                    {resp.source_meta.evidence_docs?.length > 0 && (
                      <>
                        <div className="kv-key">근거 문서</div>
                        <div className="kv-val">
                          {resp.source_meta.evidence_docs.map((d) =>
                            d.document_name + (d.pages?.length ? ` p${d.pages.join(',')}` : ' (쪽 미인용)')
                          ).join(' · ')}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* RAG 3x Meta */}
                {resp.source_meta?.type === 'rag3x' && (
                  <>
                    {resp.source_meta.rerank_top_score != null && (
                      <>
                        <div className="kv-key">리랭크 점수</div>
                        <div className="kv-val">{Number(resp.source_meta.rerank_top_score).toFixed(4)}</div>
                      </>
                    )}
                    {resp.source_meta.route_reason && (
                      <>
                        <div className="kv-key">RAG route</div>
                        <div className="kv-val">{resp.source_meta.route_reason}</div>
                      </>
                    )}
                    {resp.source_meta.metrics?.timings_seconds?.retrieve != null && (
                      <>
                        <div className="kv-key">검색 시간</div>
                        <div className="kv-val">{resp.source_meta.metrics.timings_seconds.retrieve}초</div>
                      </>
                    )}
                    {resp.source_meta.metrics?.timings_seconds?.answer != null && (
                      <>
                        <div className="kv-key">생성 시간</div>
                        <div className="kv-val">{resp.source_meta.metrics.timings_seconds.answer}초</div>
                      </>
                    )}
                  </>
                )}

                {/* Web Search Meta */}
                {resp.source_meta?.type === 'web' && (
                  <>
                    {resp.source_meta.provider && (
                      <>
                        <div className="kv-key">provider</div>
                        <div className="kv-val">{resp.source_meta.provider}</div>
                      </>
                    )}
                    {resp.source_meta.model && (
                      <>
                        <div className="kv-key">모델</div>
                        <div className="kv-val">{resp.source_meta.model}</div>
                      </>
                    )}
                    {resp.source_meta.search_queries?.length > 0 && (
                      <>
                        <div className="kv-key">검색어</div>
                        <div className="kv-val">{resp.source_meta.search_queries.join(' · ')}</div>
                      </>
                    )}
                    {resp.source_meta.usage?.searches != null && (
                      <>
                        <div className="kv-key">검색 횟수</div>
                        <div className="kv-val">{resp.source_meta.usage.searches}</div>
                      </>
                    )}
                    {resp.source_meta.sources?.length > 0 && (
                      <>
                        <div className="kv-key">출처</div>
                        <div className="kv-val search-sources-list">
                          {resp.source_meta.sources.map((s, idx) => (
                            <a
                              key={idx}
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span>{s.title || s.url}</span>
                              <ExternalLink size={11} />
                            </a>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Google Search Suggestion */}
              {resp.source_meta?.type === 'web' && resp.source_meta.search_entry_point && (
                <div
                  className="search-suggest-box"
                  dangerouslySetInnerHTML={{ __html: resp.source_meta.search_entry_point }}
                />
              )}
            </div>

            {/* 3. 근거 이미지 */}
            {evis.length > 0 && (
              <div className="inspector-section">
                <div className="section-label">
                  <ImageIcon size={15} />
                  <span>근거 이미지 ({evis.length}건)</span>
                </div>
                <div className="evidence-grid">
                  {evis.map((e, idx) => (
                    <div
                      key={idx}
                      className="evidence-card"
                      onClick={() => onOpenEvidence(e.image_url)}
                      title="클릭하여 확대 보기"
                    >
                      <img
                        src={e.image_url}
                        alt={`근거 p${e.page_number}`}
                        className="evidence-thumb"
                        loading="lazy"
                      />
                      <div className="evidence-caption">
                        {(e.document_name || '') + ' p' + (e.page_number ?? '?')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. 검증 및 경고 */}
            {((resp.verification && (resp.verification.abstain || resp.verification.transcription_ocr_mismatch?.length)) ||
              (resp.warnings && resp.warnings.length > 0)) && (
              <div className="inspector-section">
                <div className="section-label">
                  <ShieldCheck size={15} />
                  <span>검증 · 경고</span>
                </div>
                <div className="flags-container">
                  {resp.verification && (
                    <div className="flag-item">
                      <ShieldCheck size={14} color="#10b981" />
                      <span>
                        검증:{' '}
                        {[
                          resp.verification.abstain ? '회피' : null,
                          resp.verification.transcription_ocr_mismatch?.length
                            ? '전사-OCR 불일치'
                            : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || '이상 없음'}
                      </span>
                    </div>
                  )}
                  {(resp.warnings || []).map((w, idx) => (
                    <div key={idx} className="flag-item warn">
                      <AlertTriangle size={14} />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="inspector-footer">
        <div className="engine-status-text">
          RAG 엔진: <b>{eng.status || '?'}</b>
          {eng.error ? ` (${eng.error})` : ''} · 백엔드: {health?.routing?.backend || '알 수 없음'} · LangSmith: {onStr(ls.tracing_enabled)}
          <br />
          정리(composer): {onStr(tg.composer_faq || tg.composer_rag)} · 되묻기(clarify): {onStr(tg.clarify)} · 판정(grader): {onStr(tg.grader)} · 웹검색: {onStr(health?.web_search?.enabled)}
        </div>

        <div className="inspector-actions-row">
          <button
            type="button"
            className="warmup-btn"
            disabled={warmupLoading}
            onClick={onWarmup}
            title="RAG 엔진 임베딩 및 모델을 미리 메모리에 로드합니다"
          >
            <Zap size={14} />
            <span>RAG 엔진 예열(warmup)</span>
          </button>
          {warmupMsg && <span className="warmup-msg">{warmupMsg}</span>}
        </div>
      </div>
    </aside>
  );
}
