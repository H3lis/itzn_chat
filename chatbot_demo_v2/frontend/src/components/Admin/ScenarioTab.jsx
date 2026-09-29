import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitFork, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle, RefreshCw, Search, Folder,
  LayoutGrid, List, Eye
} from 'lucide-react';
import { ScenarioVisualTree } from './ScenarioVisualTree';

/**
 * FastAPI 및 백엔드 JSON 에러(배열/객체/문자열)를 사람이 읽기 쉬운 한국어로 포맷팅
 */
export function formatApiError(err) {
  if (!err) return '오류가 발생했습니다.';
  if (typeof err.detail === 'string') return err.detail;
  if (Array.isArray(err.detail)) {
    return err.detail.map((d) => {
      if (typeof d === 'string') return d;
      if (typeof d === 'object' && d !== null) {
        const loc = Array.isArray(d.loc) ? d.loc.filter((x) => x !== 'body').join('.') : '';
        const fieldStr = loc ? `[${loc}] ` : '';
        return `${fieldStr}${d.msg || JSON.stringify(d)}`;
      }
      return String(d);
    }).join('\n• ');
  }
  if (typeof err.detail === 'object' && err.detail !== null) {
    return JSON.stringify(err.detail, null, 2);
  }
  if (err.message) return err.message;
  return String(err);
}

export function ScenarioTab({ onUpdateBadge }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [viewMode, setViewMode] = useState('canvas'); // 'canvas' | 'list'

  // ★ 비주얼 에디터용 드래프트 노드 맵 & 변경사항(isDirty) 상태
  const [draftNodes, setDraftNodes] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const [savingTree, setSavingTree] = useState(false);

  // 실시간 무결성 검증 상태
  const [validationResult, setValidationResult] = useState({
    is_valid: true,
    errors: [],
    warnings: [],
    unreachable_count: 0
  });

  // 새 플로우 생성 모달
  const [createFlowModalOpen, setCreateFlowModalOpen] = useState(false);
  const [newFlowForm, setNewFlowForm] = useState({
    flow_key: '',
    flow_name: '',
    first_question: ''
  });

  const nodes = draftNodes && Object.keys(draftNodes).length > 0 ? draftNodes : (data?.nodes || {});
  const groups = data?.groups || {};
  const validation = data?.validation;
  const rootId = data?.root_node_id || 'root';
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

  // 로컬 트리 무결성 검증 함수
  const validateDraft = useCallback((nodesMap, targetRootId = rootId) => {
    if (!nodesMap || Object.keys(nodesMap).length === 0) {
      return { is_valid: true, errors: [], warnings: [], unreachable_count: 0 };
    }
    const errors = [];
    const warnings = [];

    // 1. 루트 존재
    if (!nodesMap[targetRootId]) {
      errors.push(`루트 노드 '${targetRootId}'가 존재하지 않습니다.`);
    }

    // 2. 개별 노드 검증
    for (const [nid, node] of Object.entries(nodesMap)) {
      if (node.type === 'terminal') {
        const hasText = node.answer?.text || node.answer_text;
        if (!hasText) {
          errors.push(`답변 노드 [${nid}]에 최종 답변 내용이 없습니다.`);
        }
      }

      // 옵션 링크 검사
      (node.options || []).forEach((opt, idx) => {
        const nxt = opt.next_node_id || opt.next_node;
        if (!nxt) {
          errors.push(`노드 [${nid}]의 선택지 "${opt.label || `#${idx + 1}`}"에 연결된 대상 노드가 없습니다.`);
        } else if (!nodesMap[nxt]) {
          errors.push(`노드 [${nid}]의 선택지가 미존재 노드 '${nxt}'를 가리킵니다.`);
        }
      });
    }

    // 3. 도달 가능성 검사
    const reachable = new Set();
    if (nodesMap[targetRootId]) {
      const q = [targetRootId];
      reachable.add(targetRootId);
      while (q.length > 0) {
        const curr = q.shift();
        const currNode = nodesMap[curr];
        if (!currNode) continue;
        for (const opt of currNode.options || []) {
          const nxt = opt.next_node_id || opt.next_node;
          if (nxt && nodesMap[nxt] && !reachable.has(nxt)) {
            reachable.add(nxt);
            q.push(nxt);
          }
        }
      }
    }

    const unreachable = Object.keys(nodesMap).filter((nid) => !reachable.has(nid));
    if (unreachable.length > 0) {
      warnings.push(`시작(루트)에서 도달할 수 없는 고립 노드가 ${unreachable.length}개 있습니다.`);
    }

    const result = {
      is_valid: errors.length === 0,
      errors,
      warnings,
      unreachable_count: unreachable.length,
      reachable_count: reachable.size
    };
    setValidationResult(result);
    return result;
  }, [rootId]);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/scenarios');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setDraftNodes(json.nodes || {});
        setIsDirty(false);
        if (badgeRef.current) badgeRef.current(json.total_nodes || 0);
        setSelectedNodeId((prev) => prev || json.root_node_id || null);
        if (json.validation) {
          setValidationResult(json.validation);
        }
      }
    } catch (e) {
      console.error('시나리오 트리 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, []);

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

  // 하위 자식 노드 추가 모달
  const handleOpenCreateChild = (parentNode) => {
    if (!parentNode) {
      handleOpenCreate();
      return;
    }
    const parentId = parentNode.node_id || parentNode.id || 'node';
    setModalMode('create');
    setNodeForm({
      node_id: `${parentId}.step`,
      scenario_id: parentNode.scenario_id || 'general',
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

  // 노드 삭제 (캔버스 드래프트 완전 동기화)
  const handleDeleteNode = (nodeId) => {
    if (nodeId === rootId) {
      alert('루트 노드(시작점)는 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm(`시나리오 노드 [${nodeId}]을(를) 삭제하시겠습니까?\n이 노드로 연결된 분기 선들도 함께 정리됩니다.`)) {
      return;
    }

    setDraftNodes((prev) => {
      const nextMap = { ...prev };
      delete nextMap[nodeId];

      // 이 노드를 가리키던 다른 노드들의 연결 선(next_node_id) 자동 해제
      Object.keys(nextMap).forEach((nid) => {
        const n = nextMap[nid];
        if (n.options && Array.isArray(n.options)) {
          nextMap[nid] = {
            ...n,
            options: n.options.map((opt) => {
              if (opt.next_node_id === nodeId || opt.next_node === nodeId) {
                return { ...opt, next_node_id: '', next_node: '' };
              }
              return opt;
            })
          };
        }
      });

      validateDraft(nextMap);
      return nextMap;
    });

    setIsDirty(true);
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  // 노드 저장 제출 (캔버스 드래프트 완전 동기화)
  const handleSubmitNode = (e) => {
    e.preventDefault();
    const cleanId = nodeForm.node_id.trim();
    const cleanText = nodeForm.text.trim();
    if (!cleanId || !cleanText) {
      alert('노드 ID와 안내 텍스트는 필수입니다.');
      return;
    }

    // 신규 노드 등록(create) 시 중복 ID 사전 검사
    if (modalMode === 'create') {
      if (draftNodes[cleanId] || (data?.nodes && data.nodes[cleanId])) {
        alert(`이미 동일한 노드 ID '${cleanId}'가 시나리오 트리에 존재합니다.\n다른 고유한 ID를 입력해주세요.`);
        return;
      }
    }

    const cleanOptions = (nodeForm.options || [])
      .filter((o) => o.label && o.label.trim())
      .map((o, idx) => ({
        option_id: o.option_id || `opt_${idx + 1}`,
        label: o.label.trim(),
        next_node_id: (o.next_node_id || o.next_node || '').trim(),
        next_node: (o.next_node_id || o.next_node || '').trim()
      }));

    const updatedNode = {
      node_id: cleanId,
      scenario_id: nodeForm.scenario_id.trim() || cleanId.split('.')[0] || 'general',
      type: nodeForm.type,
      text: cleanText,
      options: cleanOptions,
      answer_text: nodeForm.type === 'terminal' ? (nodeForm.answer_text || '').trim() : undefined,
      answer: nodeForm.type === 'terminal' ? { text: (nodeForm.answer_text || '').trim() } : undefined
    };

    setDraftNodes((prev) => {
      const nextMap = {
        ...prev,
        [cleanId]: updatedNode
      };
      validateDraft(nextMap);
      return nextMap;
    });

    setIsDirty(true);
    setSelectedNodeId(cleanId);
    setModalOpen(false);
  };

  // ★ 1. 노드 간 연결 핸들러 (선 잇기 Port-to-Port Snap)
  const handleConnectNodes = useCallback((sourceId, optionIndex, targetId) => {
    setDraftNodes((prev) => {
      const srcNode = prev[sourceId];
      if (!srcNode || !srcNode.options || !srcNode.options[optionIndex]) return prev;
      const updatedOpts = [...srcNode.options];
      updatedOpts[optionIndex] = {
        ...updatedOpts[optionIndex],
        next_node_id: targetId,
        next_node: targetId
      };
      const nextMap = {
        ...prev,
        [sourceId]: {
          ...srcNode,
          options: updatedOpts
        }
      };
      validateDraft(nextMap);
      return nextMap;
    });
    setIsDirty(true);
  }, [validateDraft]);

  // ★ 2. 옵션 연결 해제 핸들러
  const handleDisconnectOption = useCallback((sourceId, optionIndex) => {
    setDraftNodes((prev) => {
      const srcNode = prev[sourceId];
      if (!srcNode || !srcNode.options || !srcNode.options[optionIndex]) return prev;
      const updatedOpts = [...srcNode.options];
      updatedOpts[optionIndex] = {
        ...updatedOpts[optionIndex],
        next_node_id: '',
        next_node: ''
      };
      const nextMap = {
        ...prev,
        [sourceId]: {
          ...srcNode,
          options: updatedOpts
        }
      };
      validateDraft(nextMap);
      return nextMap;
    });
    setIsDirty(true);
  }, [validateDraft]);

  // ★ 3. 비주얼 캔버스 전용 빠른 노드 생성 핸들러 (질문/답변)
  const handleCreateVisualNode = useCallback((type = 'question', targetFlowKey = 'general') => {
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const flow = targetFlowKey === 'ALL' || !targetFlowKey ? 'custom' : targetFlowKey;
    const nodeId = type === 'terminal' ? `${flow}.ans_${randomSuffix}` : `${flow}.step_${randomSuffix}`;

    const newNode = {
      node_id: nodeId,
      scenario_id: flow,
      type,
      text: type === 'terminal' ? '해결 조치 가이드 내용을 입력해주세요.' : '상세 안내 또는 추가 질문을 입력해주세요.',
      options: type === 'question' ? [{ label: '다음 단계', next_node: '', next_node_id: '' }] : [],
      answer_text: type === 'terminal' ? '최종 조치 및 가이드 내용입니다.' : undefined,
      answer: type === 'terminal' ? { text: '최종 조치 및 가이드 내용입니다.' } : undefined
    };

    setDraftNodes((prev) => {
      const nextMap = { ...prev, [nodeId]: newNode };
      validateDraft(nextMap);
      return nextMap;
    });
    setSelectedNodeId(nodeId);
    setIsDirty(true);
    return nodeId;
  }, [validateDraft]);

  // ★ 4. 새로운 플로우 생성 핸들러 (루트 분기 연결 + 첫 질문 노드 동시 생성)
  const handleCreateFlow = useCallback((flowKey, flowName, firstQuestion) => {
    const cleanKey = flowKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanKey) {
      alert('플로우 영문 키(영문 소문자, 숫자, 언더스코어)를 입력해주세요.');
      return false;
    }
    const cleanName = flowName.trim();
    if (!cleanName) {
      alert('플로우 명칭(라벨)을 입력해주세요.');
      return false;
    }
    const cleanQ = firstQuestion?.trim() || `${cleanName} 관련 질문입니다. 어떤 문제가 발생했나요?`;

    const startNodeId = `${cleanKey}.start`;

    setDraftNodes((prev) => {
      const targetRoot = rootId || 'root';
      const actualRoot = prev[targetRoot] || { node_id: targetRoot, options: [] };

      // 1. 루트 노드의 옵션에 신규 플로우 시작 버튼 추가
      const newRootOptions = [
        ...(actualRoot.options || []),
        {
          option_id: cleanKey,
          label: cleanName,
          next_node: startNodeId,
          next_node_id: startNodeId
        }
      ];

      // 2. 신규 플로우의 첫 시작 질문 노드 생성
      const startNode = {
        node_id: startNodeId,
        scenario_id: cleanKey,
        type: 'question',
        text: cleanQ,
        options: [
          {
            option_id: 'choice_1',
            label: '상세 점검 1',
            next_node: '',
            next_node_id: ''
          }
        ]
      };

      const nextMap = {
        ...prev,
        [targetRoot]: {
          ...actualRoot,
          options: newRootOptions
        },
        [startNodeId]: startNode
      };

      validateDraft(nextMap, targetRoot);
      return nextMap;
    });

    setSelectedNodeId(startNodeId);
    setIsDirty(true);
    setCreateFlowModalOpen(false);
    setNewFlowForm({ flow_key: '', flow_name: '', first_question: '' });
    return true;
  }, [rootId, validateDraft]);

  // ★ 5. 무결성 정상 판정 후 전체 트리 일괄 최종 저장 핸들러
  const handleSaveTree = useCallback(async () => {
    const val = validateDraft(draftNodes, rootId);
    if (!val.is_valid) {
      alert(`[저장 불가] 트리에 해결되지 않은 무결성 결함이 있습니다.\n\n오류 목록:\n• ${val.errors.join('\n• ')}\n\n모든 노드와 분기를 올바르게 연결한 후 다시 저장해주세요.`);
      return;
    }

    if (val.unreachable_count > 0) {
      const proceed = window.confirm(`주의: 시작(루트)에서 도달할 수 없는 고립 노드가 ${val.unreachable_count}개 있습니다.\n이대로 저장을 진행하시겠습니까?`);
      if (!proceed) return;
    }

    setSavingTree(true);
    try {
      const payload = {
        root_node_id: rootId,
        nodes: draftNodes
      };

      const res = await fetch('/api/admin/scenarios/tree', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const json = await res.json();
        alert(`🎉 시나리오 트리가 성공적으로 저장 및 즉시 반영되었습니다!\n(총 ${json.total_nodes || Object.keys(draftNodes).length}개 노드 가동 중)`);
        setIsDirty(false);
        fetchTree();
      } else {
        const err = await res.json();
        alert(`저장 실패:\n• ${formatApiError(err)}`);
      }
    } catch (e) {
      alert(`저장 통신 실패: ${e.message}`);
    } finally {
      setSavingTree(false);
    }
  }, [draftNodes, rootId, validateDraft, fetchTree]);

  // ★ 6. 변경사항 취소 및 서버 원본 리셋
  const handleResetDraft = useCallback(() => {
    if (window.confirm('작업 중인 변경사항을 모두 취소하고 서버의 원래 시나리오 트리 상태로 되돌리시겠습니까?')) {
      const originalNodes = data?.nodes || {};
      setDraftNodes(originalNodes);
      setIsDirty(false);
      validateDraft(originalNodes, rootId);
    }
  }, [data, rootId, validateDraft]);

  // 검색 필터링된 노드
  const filterLower = search.trim().toLowerCase();

  return (
    <div className="tab-pane active" id="tab-scenario">
      {/* 1. 상단 헤더 및 메뉴 설명 블록 */}
      <div className="admin-page-header">
        <div className="admin-page-header-top">
          <h2 className="admin-page-title">대화 시나리오 관리</h2>
        </div>
        <p className="admin-page-desc">
          자주 묻는 질문에 버튼 클릭만으로 답변을 받을 수 있도록, 질문-답변이 이어지는 대화 흐름을 트리 구조로 설계하는 공간입니다.
        </p>
      </div>

      {/* 2. 상단 통계 및 툴바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* 뷰 모드 전환 버튼 */}
          <div style={{ display: 'inline-flex', padding: '3px', background: '#f1f5f9', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'canvas' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('canvas')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: viewMode === 'canvas' ? 700 : 500,
                borderRadius: '6px'
              }}
              title="인터랙티브 캔버스에서 노드를 클릭하고 드래그하며 시각적으로 편집"
            >
              <LayoutGrid size={13} style={{ marginRight: '0.3rem' }} />
              <span>비주얼 캔버스</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('list')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: viewMode === 'list' ? 700 : 500,
                borderRadius: '6px'
              }}
              title="그룹별 트리 목록과 상세 에디터 2분할 뷰"
            >
              <List size={13} style={{ marginRight: '0.3rem' }} />
              <span>목록 뷰</span>
            </button>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={fetchTree} title="새로고침">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>새로고침</span>
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleOpenCreate}>
            <Plus size={14} />
            <span>신규 노드 추가</span>
          </button>
        </div>
      </div>

      {/* 3. 뷰 모드에 따른 렌더링: 비주얼 캔버스 뷰 vs 그룹 목록 뷰 */}
      {viewMode === 'canvas' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* 캔버스 상단: 선택 노드 인스펙터 바 */}
          {selectedNode && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1.25rem',
                background: '#ffffff',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                gap: '1rem',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden', minWidth: 0 }}>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  background: selectedNode.type === 'terminal' ? 'rgba(5, 150, 105, 0.15)' : 'rgba(37, 99, 235, 0.15)',
                  color: selectedNode.type === 'terminal' ? 'var(--emerald)' : 'var(--primary)',
                  border: selectedNode.type === 'terminal' ? '1px solid var(--emerald)' : '1px solid var(--primary)',
                  flexShrink: 0
                }}>
                  {selectedNode.type === 'terminal' ? '답변 노드' : '질문 노드'}
                </span>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-main)', flexShrink: 0 }}>
                  {selectedNode.node_id || selectedNode.id}
                </strong>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '460px' }}>
                  {selectedNode.text || selectedNode.answer?.text || ''}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleOpenEdit(selectedNode)}
                  title="선택된 노드 내용 및 분기 옵션 수정"
                >
                  <Edit2 size={13} />
                  <span>이 노드 수정</span>
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleOpenCreateChild(selectedNode)}
                  title="이 노드의 하위 분기 노드 생성"
                >
                  <Plus size={13} />
                  <span>하위 노드 추가</span>
                </button>
              </div>
            </div>
          )}

          {/* 메인 인터랙티브 비주얼 노드 트리 캔버스 */}
          <ScenarioVisualTree
            nodes={nodes}
            rootId={rootId}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onEditNode={handleOpenEdit}
            onDeleteNode={handleDeleteNode}
            onCreateChildNode={handleOpenCreateChild}
            isDirty={isDirty}
            validationResult={validationResult}
            savingTree={savingTree}
            onConnectNodes={handleConnectNodes}
            onDisconnectOption={handleDisconnectOption}
            onCreateVisualNode={handleCreateVisualNode}
            onOpenCreateFlow={() => setCreateFlowModalOpen(true)}
            onSaveTree={handleSaveTree}
            onResetDraft={handleResetDraft}
          />
        </div>
      ) : (
        /* 기존 2분할 목록 뷰 */
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 420px) minmax(0, 1fr)', gap: '1.25rem', width: '100%', minWidth: 0, alignItems: 'start' }}>
          {/* 좌측: 그룹별 노드 탐색기 */}
          <div style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', height: '680px', display: 'flex', flexDirection: 'column', minWidth: 0, boxSizing: 'border-box' }}>
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
                                background: isSelected ? '#eff6ff' : '#f8fafc',
                                border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                transition: 'all 0.15s',
                                minWidth: 0
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden', minWidth: 0 }}>
                                <span style={{
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: '4px',
                                  background: isRoot ? 'var(--primary)' : (isTerminal ? 'var(--emerald)' : '#e2e8f0'),
                                  color: isRoot || isTerminal ? '#fff' : 'var(--text-main)',
                                  flexShrink: 0
                                }}>
                                  {isRoot ? 'ROOT' : (isTerminal ? '답변' : '질문')}
                                </span>
                                <div style={{ overflow: 'hidden', minWidth: 0 }}>
                                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: isSelected ? 'var(--primary)' : 'var(--text-main)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {nid}
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {n?.text || (n?.answer?.text ? `답변: ${n.answer.text}` : '(내용 없음)')}
                                  </div>
                                </div>
                              </div>

                              {n?.options && n.options.length > 0 && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, paddingLeft: '0.5rem', whiteSpace: 'nowrap' }}>
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
          <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', height: '680px', overflowY: 'auto', minWidth: 0, boxSizing: 'border-box' }}>
            {selectedNode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                        <code>{selectedNode.node_id || selectedNode.id}</code>
                      </h3>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '0.15rem 0.55rem',
                        borderRadius: '4px',
                        background: selectedNode.type === 'terminal' ? 'rgba(5, 150, 105, 0.15)' : 'rgba(37, 99, 235, 0.15)',
                        color: selectedNode.type === 'terminal' ? 'var(--emerald)' : 'var(--primary)',
                        border: selectedNode.type === 'terminal' ? '1px solid var(--emerald)' : '1px solid var(--primary)'
                      }}>
                        {selectedNode.type === 'terminal' ? '최종 답변 노드' : '질문/분기 노드'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      시나리오 그룹: <strong style={{ color: 'var(--text-main)' }}>{selectedNode.scenario_id || '미지정'}</strong>
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
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-sub)', marginBottom: '0.4rem', display: 'block' }}>
                    💬 안내 및 질문 문구
                  </label>
                  <div style={{ background: '#f8fafc', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {selectedNode.text || '(안내 텍스트 없음)'}
                  </div>
                </div>

                {selectedNode.type === 'terminal' && (selectedNode.answer || selectedNode.answer_text) && (
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emerald)', marginBottom: '0.4rem', display: 'block' }}>
                      ✅ 최종 조치 가이드 답변
                    </label>
                    <div style={{ background: 'rgba(5, 150, 105, 0.05)', border: '1px solid rgba(5, 150, 105, 0.25)', padding: '1rem', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                      {selectedNode.answer?.text || selectedNode.answer_text || '(상세 조치 답변 없음)'}
                    </div>
                  </div>
                )}

                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-sub)', marginBottom: '0.4rem', display: 'block' }}>
                    🔀 하위 분기 선택지 ({selectedNode.options?.length || 0}개)
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
                            background: '#f8fafc',
                            padding: '0.75rem 1rem',
                            borderRadius: '8px',
                            fontSize: '0.88rem',
                            border: '1px solid var(--border-color)',
                            cursor: opt.next_node ? 'pointer' : 'default',
                            transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{opt.label}</span>
                            {opt.action && (
                              <span className="badge-pill" style={{ fontSize: '0.7rem' }}>
                                액션: {opt.action}
                              </span>
                            )}
                          </div>
                          <div style={{ color: opt.next_node ? 'var(--primary)' : 'var(--text-muted)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0, paddingLeft: '0.5rem' }}>
                            ➔ {opt.next_node || '종료'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ background: '#f8fafc', border: '1px solid var(--border-color)', padding: '1.25rem', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                      {selectedNode.type === 'terminal' ? '🎉 상담 종결 리프(Leaf) 노드입니다.' : '설정된 하위 선택지가 없습니다.'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '6rem 1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                좌측 목록에서 노드를 클릭하면 상세 안내 문구와 하위 분기 내역을 확인할 수 있습니다.
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* 5. 신규 플로우 생성 모달 */}
      {createFlowModalOpen && (
        <div className="modal-backdrop" onClick={() => setCreateFlowModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">✨ 새로운 대화 플로우 생성</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCreateFlowModalOpen(false)}
                style={{ fontSize: '1.2rem', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateFlow(newFlowForm.flow_key, newFlowForm.flow_name, newFlowForm.first_question);
              }}
            >
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                  새로운 상담 주제(플로우)를 생성하면 <strong>시작 루트 노드에 바로가기 분기 버튼</strong>과
                  <strong>첫 번째 시작 질문 노드</strong>가 자동으로 생성되어 캔버스에 배치됩니다.
                </p>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    플로우 영문 식별 키 <span style={{ color: 'var(--rose)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="예: printer_issue, vpn_connect, payment"
                    value={newFlowForm.flow_key}
                    onChange={(e) => setNewFlowForm({ ...newFlowForm, flow_key: e.target.value })}
                    required
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <small style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    노드 ID의 접두사로 사용됩니다. (영문 소문자, 숫자, 언더스코어 권장)
                  </small>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    플로우 표시 명칭 (라벨) <span style={{ color: 'var(--rose)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="예: 🖨️ 프린터 출력 장애 점검"
                    value={newFlowForm.flow_name}
                    onChange={(e) => setNewFlowForm({ ...newFlowForm, flow_name: e.target.value })}
                    required
                  />
                  <small style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    루트 질문 노드 및 플로우 탭에 표시될 직관적인 이름입니다.
                  </small>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    첫 번째 시작 질문 안내 문구
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="예: 프린터에서 어떤 문제가 발생하나요? 아래 보기 중 해당하는 증상을 선택해주세요."
                    value={newFlowForm.first_question}
                    onChange={(e) => setNewFlowForm({ ...newFlowForm, first_question: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCreateFlowModalOpen(false)}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ fontWeight: 700 }}>
                  🚀 플로우 생성 및 캔버스 배치
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
