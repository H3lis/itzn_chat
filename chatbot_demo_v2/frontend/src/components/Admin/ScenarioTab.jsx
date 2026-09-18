import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GitFork, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle, RefreshCw, Search, Folder } from 'lucide-react';

export function ScenarioTab({ onUpdateBadge }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const nodes = data?.nodes || {};
  const groups = data?.groups || {};
  const validation = data?.validation;
  const rootId = data?.root_node_id;
  const selectedNode = selectedNodeId ? nodes[selectedNodeId] : null;

  // 노드 생성/수정 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [nodeForm, setNodeForm] = useState({
    node_id: '',
    scenario_id: '',
    type: 'question',
    text: '',
    options: [],
    answer_text: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const badgeRef = useRef(onUpdateBadge);
  useEffect(() => {
    badgeRef.current = onUpdateBadge;
  }, [onUpdateBadge]);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/scenarios');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (badgeRef.current) badgeRef.current(json.total_nodes || 0);
        // 기본 선택 노드가 없으면 root 선택
        if (!selectedNodeId && json.root_node_id) {
          setSelectedNodeId(json.root_node_id);
        }
      }
    } catch (e) {
      console.error('시나리오 트리 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // 신규 노드 추가 모달
  const handleOpenCreate = () => {
    setModalMode('create');
    setNodeForm({
      node_id: '',
      scenario_id: selectedNode?.scenario_id || 'general',
      type: 'question',
      text: '',
      options: [{ label: '', next_node: '' }],
      answer_text: ''
    });
    setModalOpen(true);
  };

  // 노드 수정 모달
  const handleOpenEdit = (node) => {
    if (!node) return;
    setModalMode('edit');
    setNodeForm({
      node_id: node.node_id || node.id,
      scenario_id: node.scenario_id || '',
      type: node.type || 'question',
      text: node.text || '',
      options: node.options ? node.options.map(o => ({ ...o })) : [],
      answer_text: node.answer?.text || node.answer_text || ''
    });
    setModalOpen(true);
  };

  // 노드 삭제
  const handleDeleteNode = async (nodeId) => {
    if (!window.confirm(`시나리오 노드 [${nodeId}]을(를) 삭제하시겠습니까?\n하위 연결 노드 링크가 깨질 수 있습니다.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/scenarios/nodes/${encodeURIComponent(nodeId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert('노드가 삭제되었습니다.');
        if (selectedNodeId === nodeId) setSelectedNodeId(null);
        fetchTree();
      } else {
        const err = await res.json();
        alert(`삭제 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`삭제 통신 오류: ${e.message}`);
    }
  };

  // 노드 저장 제출
  const handleSubmitNode = async (e) => {
    e.preventDefault();
    if (!nodeForm.node_id.trim() || !nodeForm.text.trim()) {
      alert('노드 ID와 안내 텍스트는 필수입니다.');
      return;
    }
    setSubmitting(true);
    try {
      const url = modalMode === 'create'
        ? '/api/admin/scenarios/nodes'
        : `/api/admin/scenarios/nodes/${encodeURIComponent(nodeForm.node_id)}`;
      const method = modalMode === 'create' ? 'POST' : 'PUT';

      const payload = {
        node_id: nodeForm.node_id.trim(),
        scenario_id: nodeForm.scenario_id.trim() || undefined,
        type: nodeForm.type,
        text: nodeForm.text,
        options: nodeForm.options.filter(o => o.label && o.label.trim()),
        answer_text: nodeForm.type === 'terminal' ? nodeForm.answer_text : undefined
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert(modalMode === 'create' ? '신규 시나리오 노드가 추가되었습니다.' : '시나리오 노드가 수정되었습니다.');
        setModalOpen(false);
        setSelectedNodeId(nodeForm.node_id);
        fetchTree();
      } else {
        const err = await res.json();
        alert(`저장 실패: ${err.detail || '오류 발생'}`);
      }
    } catch (e) {
      alert(`통신 오류: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // 검색 필터링된 노드
  const filterLower = search.trim().toLowerCase();

  return (
    <div className="tab-pane active" id="tab-scenario">
      {/* 1. 상단 통계 및 무결성 검증 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="faq-stat-pill primary">
            <GitFork size={15} />
            <span>총 시나리오 노드:</span>
            <span className="val">{data?.total_nodes || 0} 개</span>
          </div>

          {validation && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.8rem',
              borderRadius: '9999px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: validation.is_valid ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
              color: validation.is_valid ? 'var(--emerald)' : 'var(--rose)',
              border: validation.is_valid ? '1px solid var(--emerald)' : '1px solid var(--rose)'
            }}>
              {validation.is_valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              <span>
                {validation.is_valid
                  ? `트리 무결성 정상 (도달 가능 ${validation.reachable_count}개)`
                  : `오류 ${validation.errors?.length || 0}건 / 미도달 ${validation.unreachable_count || 0}개`}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={fetchTree} title="새로고침">
            <RefreshCw size={14} className={loading ? 'spinner' : ''} />
            <span>새로고침</span>
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleOpenCreate}>
            <Plus size={14} />
            <span>신규 노드 추가</span>
          </button>
        </div>
      </div>

      {/* 2. 메인 2분할 레이아웃 (좌: 그룹별 트리 목록, 우: 노드 상세) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.25rem' }}>
        {/* 좌측: 그룹별 노드 탐색기 */}
        <div style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', height: '620px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="faq-search-input"
                style={{ width: '100%', paddingLeft: '32px' }}
                placeholder="노드 ID 또는 질문 검색…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.35rem' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>시나리오 데이터를 불러오는 중…</div>
            ) : Object.keys(groups).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>등록된 시나리오 노드가 없습니다.</div>
            ) : (
              Object.entries(groups).map(([grpName, nodeIds]) => {
                const filtered = nodeIds.filter((nid) => {
                  const n = nodes[nid];
                  if (!n) return false;
                  if (!filterLower) return true;
                  const text = (n.text || '').toLowerCase();
                  return nid.toLowerCase().includes(filterLower) || text.includes(filterLower);
                });

                if (filtered.length === 0) return null;

                return (
                  <div key={grpName} style={{ marginBottom: '1rem' }}>
                    <div style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      padding: '0.3rem 0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      borderBottom: '1px solid var(--border-color)',
                      marginBottom: '0.4rem'
                    }}>
                      <Folder size={13} color="var(--primary)" />
                      <span>{grpName}</span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.72rem' }}>{filtered.length}개</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {filtered.map((nid) => {
                        const n = nodes[nid];
                        const isSelected = selectedNodeId === nid;
                        const isRoot = nid === rootId;
                        const isTerminal = n?.type === 'terminal';

                        return (
                          <div
                            key={nid}
                            onClick={() => setSelectedNodeId(nid)}
                            style={{
                              padding: '0.6rem 0.75rem',
                              borderRadius: '8px',
                              background: isSelected ? 'rgba(59, 130, 246, 0.25)' : 'rgba(15, 23, 42, 0.5)',
                              border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.06)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              transition: 'background 0.15s'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                              <span style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                padding: '0.15rem 0.4rem',
                                borderRadius: '4px',
                                background: isRoot ? 'var(--primary)' : (isTerminal ? 'var(--emerald)' : 'rgba(255, 255, 255, 0.1)'),
                                color: '#fff',
                                flexShrink: 0
                              }}>
                                {isRoot ? 'ROOT' : (isTerminal ? '답변' : '질문')}
                              </span>
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: isSelected ? '#93c5fd' : 'var(--text-main)', fontWeight: 600 }}>
                                  {nid}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {n?.text || (n?.answer?.text ? `답변: ${n.answer.text}` : '(내용 없음)')}
                                </div>
                              </div>
                            </div>

                            {n?.options && n.options.length > 0 && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, paddingLeft: '0.5rem' }}>
                                분기 {n.options.length}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 우측: 선택 노드 상세 정보 & 분기 뷰어 */}
        <div style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', height: '620px', overflowY: 'auto' }}>
          {selectedNode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      <code>{selectedNode.node_id || selectedNode.id}</code>
                    </h3>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      background: selectedNode.type === 'terminal' ? 'var(--emerald)' : 'var(--primary)',
                      color: '#fff'
                    }}>
                      {selectedNode.type === 'terminal' ? '최종 답변 노드' : '질문/분기 노드'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    시나리오 그룹: {selectedNode.scenario_id || '미지정'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleOpenEdit(selectedNode)}>
                    <Edit2 size={13} />
                    <span>수정</span>
                  </button>
                  {selectedNode.node_id !== rootId && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteNode(selectedNode.node_id || selectedNode.id)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.78rem' }}>안내 및 질문 문구</label>
                <div style={{ background: 'var(--bg-darker)', padding: '0.85rem', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.6 }}>
                  {selectedNode.text || '(안내 텍스트 없음)'}
                </div>
              </div>

              {selectedNode.type === 'terminal' && selectedNode.answer && (
                <div>
                  <label className="form-label" style={{ fontSize: '0.78rem', color: 'var(--emerald)' }}>최종 조치 가이드 답변</label>
                  <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.85rem', borderRadius: '8px', fontSize: '0.88rem', color: 'var(--text-main)', lineHeight: 1.6 }}>
                    {selectedNode.answer.text || selectedNode.answer_text || '(상세 조치 답변 없음)'}
                  </div>
                </div>
              )}

              <div>
                <label className="form-label" style={{ fontSize: '0.78rem' }}>
                  하위 분기 선택지 ({selectedNode.options?.length || 0}개)
                </label>
                {selectedNode.options && selectedNode.options.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                    {selectedNode.options.map((opt, i) => (
                      <div
                        key={i}
                        onClick={() => opt.next_node && setSelectedNodeId(opt.next_node)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: 'rgba(15, 23, 42, 0.6)',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          border: '1px solid var(--border-color)',
                          cursor: opt.next_node ? 'pointer' : 'default',
                          transition: 'border-color 0.15s'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{opt.label}</span>
                          {opt.action && (
                            <span className="badge-pill" style={{ fontSize: '0.7rem' }}>
                              액션: {opt.action}
                            </span>
                          )}
                        </div>
                        <div style={{ color: opt.next_node ? 'var(--primary)' : 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                          ➔ {opt.next_node || '종료'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: 'var(--bg-darker)', padding: '1rem', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    {selectedNode.type === 'terminal' ? '상담 종결 리프(Leaf) 노드입니다.' : '설정된 하위 선택지가 없습니다.'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              좌측 목록에서 노드를 클릭하면 상세 안내 문구와 하위 분기 내역을 확인할 수 있습니다.
            </div>
          )}
        </div>
      </div>

      {/* 노드 생성/수정 모달 */}
      {modalOpen && (
        <div className="modal-backdrop active" onClick={() => setModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>{modalMode === 'create' ? '새 시나리오 노드 등록' : `노드 수정 (${nodeForm.node_id})`}</h3>
              <button className="btn-close" onClick={() => setModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleSubmitNode}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">노드 식별자 (ID)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={nodeForm.node_id}
                      onChange={(e) => setNodeForm({ ...nodeForm, node_id: e.target.value })}
                      disabled={modalMode === 'edit'}
                      placeholder="예: wired_ip_check"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">시나리오 그룹</label>
                    <input
                      type="text"
                      className="form-input"
                      value={nodeForm.scenario_id}
                      onChange={(e) => setNodeForm({ ...nodeForm, scenario_id: e.target.value })}
                      placeholder="예: wired_network"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">노드 유형</label>
                  <select
                    className="faq-select"
                    style={{ width: '100%' }}
                    value={nodeForm.type}
                    onChange={(e) => setNodeForm({ ...nodeForm, type: e.target.value })}
                  >
                    <option value="question">질문 / 분기 선택 노드 (Question)</option>
                    <option value="terminal">최종 답변 및 조치 노드 (Terminal)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">안내 및 질문 문구</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    value={nodeForm.text}
                    onChange={(e) => setNodeForm({ ...nodeForm, text: e.target.value })}
                    placeholder="사용자에게 보여줄 질문 또는 안내 문구"
                    required
                  />
                </div>

                {nodeForm.type === 'terminal' ? (
                  <div className="form-group">
                    <label className="form-label">최종 조치 답변 본문</label>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      value={nodeForm.answer_text}
                      onChange={(e) => setNodeForm({ ...nodeForm, answer_text: e.target.value })}
                      placeholder="사용자가 최종적으로 확인하고 조치할 표준 답변 가이드를 입력하세요."
                      required
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">하위 분기 선택지 목록 ({nodeForm.options.length}개)</label>
                    {nodeForm.options.map((opt, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: '0.4rem', marginBottom: '0.4rem' }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="버튼 라벨 (예: 네, 불이 켜져 있어요)"
                          value={opt.label}
                          onChange={(e) => {
                            const opts = [...nodeForm.options];
                            opts[i].label = e.target.value;
                            setNodeForm({ ...nodeForm, options: opts });
                          }}
                          required
                        />
                        <input
                          type="text"
                          className="form-input"
                          placeholder="다음 이동 노드 ID"
                          value={opt.next_node || ''}
                          onChange={(e) => {
                            const opts = [...nodeForm.options];
                            opts[i].next_node = e.target.value;
                            setNodeForm({ ...nodeForm, options: opts });
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setNodeForm({ ...nodeForm, options: nodeForm.options.filter((_, idx) => idx !== i) })}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '0.4rem' }}
                      onClick={() => setNodeForm({ ...nodeForm, options: [...nodeForm.options, { label: '', next_node: '' }] })}
                    >
                      + 선택지 추가
                    </button>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>취소</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? '저장 중…' : '저장 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
