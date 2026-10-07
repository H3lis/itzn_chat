import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  GitFork, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle, RefreshCw, Search, Folder,
  LayoutGrid, List, Eye, ArrowUp, CornerUpLeft, Lock
} from 'lucide-react';
import { ScenarioVisualTree } from './ScenarioVisualTree';

/**
 * 버튼명을 기반으로 안전한 노드 식별자(ID) 자동 생성 헬퍼
 */
function generateNodeIdFromLabel(label, parentId, type) {
  const prefix = parentId || 'node';
  const tag = type === 'terminal' ? 'ans' : 'step';
  if (!label || !label.trim()) {
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    return `${prefix}.${tag}_${randomSuffix}`;
  }
  const clean = label.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, '').slice(0, 16);
  const randomSuffix = Math.random().toString(36).substring(2, 5);
  return `${prefix}.${tag}_${clean || randomSuffix}`;
}

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
    parentNodeId: null,
    parentOptionLabel: '',
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
      errors.push(`상담 시작 항목 '${targetRootId}'가 존재하지 않습니다.`);
    }

    // 2. 개별 항목 검증
    for (const [nid, node] of Object.entries(nodesMap)) {
      if (node.type === 'terminal') {
        const hasText = node.answer?.text || node.answer_text;
        if (!hasText) {
          errors.push(`답변 항목 [${nid}]에 최종 답변 내용이 없습니다.`);
        }
      }

      // 옵션 링크 검사
      (node.options || []).forEach((opt, idx) => {
        const nxt = opt.next_node_id || opt.next_node;
        if (!nxt) {
          errors.push(`항목 [${nid}]의 버튼 "${opt.label || `#${idx + 1}`}"에 연결된 대상 항목이 없습니다.`);
        } else if (!nodesMap[nxt]) {
          errors.push(`항목 [${nid}]의 버튼이 존재하지 않는 항목 '${nxt}'를 가리킵니다.`);
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
      warnings.push(`상담 시작에서 도달할 수 없는 고립 항목이 ${unreachable.length}개 있습니다.`);
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

  // ★ 상위 -> 하위뿐만 아니라 하위 -> 상위 역추적 맵 구축
  const incomingParentsMap = useMemo(() => {
    const map = {};
    if (!draftNodes) return map;
    Object.entries(draftNodes).forEach(([pId, pNode]) => {
      const opts = pNode.options || [];
      opts.forEach((opt) => {
        const targetId = opt.next_node_id || opt.next_node;
        if (targetId) {
          if (!map[targetId]) map[targetId] = [];
          map[targetId].push({
            parentId: pId,
            parentText: pNode.text || pNode.answer?.text || pId,
            parentType: pNode.type,
            buttonLabel: opt.label || '선택지'
          });
        }
      });
    });
    return map;
  }, [draftNodes]);

  // ★ [사용자 피드백 반영] 연결 가능한 모든 대상 노드 목록 (버튼명/노드명 중심)
  const availableTargetNodes = useMemo(() => {
    if (!draftNodes) return [];
    return Object.entries(draftNodes)
      .filter(([nid]) => nid !== nodeForm.node_id) // 자기 자신 제외
      .map(([nid, n]) => {
        const displayName = n.name || n.title || incomingParentsMap[nid]?.[0]?.buttonLabel || n.parentOptionLabel || nid;
        const typeLabel = n.type === 'terminal' ? '종결 답변' : '중간 질문';
        return {
          id: nid,
          name: displayName,
          typeLabel
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [draftNodes, nodeForm.node_id, incomingParentsMap]);

  // 신규 노드 추가 모달 (사용자가 이름을 직접 정할 수 있도록 지원)
  const handleOpenCreate = () => {
    setModalMode('create');
    const flow = selectedNode?.scenario_id || 'general';
    const initId = generateNodeIdFromLabel('', flow, 'question');
    setNodeForm({
      name: '',
      node_id: initId,
      scenario_id: flow,
      parentNodeId: null,
      parentOptionLabel: '',
      type: 'question',
      text: '',
      options: [{ label: '', next_node: '', next_node_id: '' }],
      answer_text: ''
    });
    setModalOpen(true);
  };

  // 하위 자식 노드 추가 모달 (사용자 지정 노드 이름 및 자동 내부 ID 매핑)
  const handleOpenCreateChild = (parentNode, defaultChildType = 'terminal') => {
    if (!parentNode) {
      handleOpenCreate();
      return;
    }
    const parentObj = typeof parentNode === 'string'
      ? (draftNodes[parentNode] || { node_id: parentNode })
      : parentNode;
    const parentId = parentObj.node_id || parentObj.id || 'node';
    const isTerminal = defaultChildType === 'terminal';
    const initialLabel = isTerminal ? '해결 방법 확인' : '상세 점검 진행';
    const childId = generateNodeIdFromLabel(initialLabel, parentId, defaultChildType);
    const initialContent = isTerminal ? '해결 가이드 내용을 확인하세요.' : '';

    setModalMode('create');
    setNodeForm({
      name: initialLabel,
      node_id: childId,
      scenario_id: parentObj.scenario_id || (parentId.includes('.') ? parentId.split('.')[0] : 'general'),
      parentNodeId: parentId,
      parentOptionLabel: initialLabel,
      type: defaultChildType,
      text: initialContent,
      options: isTerminal
        ? [{ option_id: '__restart__', label: '처음으로', next_node_id: rootId || 'root' }]
        : [{ label: '다음 단계', next_node: '', next_node_id: '' }],
      answer_text: initialContent
    });
    setModalOpen(true);
  };

  // 노드 수정 모달 (사용자가 지정한 노드 이름 및 버튼선택시 내용 반영)
  const handleOpenEdit = (node) => {
    if (!node) return;
    setModalMode('edit');
    const incomingName = incomingParentsMap[node.node_id || node.id]?.[0]?.buttonLabel;
    const initialName = node.name || node.title || incomingName || node.parentOptionLabel || node.node_id || '';
    const nodeContent = node.text || node.answer?.text || node.answer_text || '';
    setNodeForm({
      name: initialName,
      node_id: node.node_id || node.id,
      scenario_id: node.scenario_id || '',
      parentNodeId: null,
      parentOptionLabel: '',
      type: node.type || 'question',
      text: nodeContent,
      options: node.options ? node.options.map(o => ({ ...o })) : [],
      answer_text: nodeContent
    });
    setModalOpen(true);
  };

  // 상담 항목 삭제 (캔버스 드래프트 완전 동기화)
  const handleDeleteNode = (nodeId) => {
    if (nodeId === rootId) {
      alert('상담 시작(시작점) 항목은 삭제할 수 없습니다.');
      return;
    }
    const targetName = draftNodes[nodeId]?.name || nodeId;
    if (!window.confirm(`상담 항목 [${targetName}]을(를) 삭제하시겠습니까?\n이 항목과 연결된 버튼 선들도 함께 정리됩니다.`)) {
      return;
    }

    setDraftNodes((prev) => {
      const nextMap = { ...prev };
      delete nextMap[nodeId];

      // 이 항목을 가리키던 다른 항목들의 연결 선(next_node_id) 자동 해제
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

  // 상담 항목 저장 제출 (캔버스 드래프트 완전 동기화)
  const handleSubmitNode = (e) => {
    e.preventDefault();
    const cleanId = nodeForm.node_id.trim();
    const cleanText = nodeForm.text.trim();
    if (!cleanId || !cleanText) {
      alert('항목 ID와 안내 텍스트는 필수입니다.');
      return;
    }

    // 신규 상담 항목 등록(create) 시 중복 ID 사전 검사
    if (modalMode === 'create') {
      if (draftNodes[cleanId] || (data?.nodes && data.nodes[cleanId])) {
        alert(`이미 동일한 항목 ID '${cleanId}'가 상담 흐름에 존재합니다.\n다른 고유한 ID를 입력해주세요.`);
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

    // ★ terminal 노드의 경우: '처음으로(__restart__)' 옵션이 반드시 100% 보장되도록 정규화
    let finalOptions = cleanOptions;
    if (nodeForm.type === 'terminal') {
      const hasRestart = finalOptions.some((o) => o.option_id === '__restart__' || o.next_node_id === (rootId || 'root'));
      if (!hasRestart) {
        finalOptions = [{ option_id: '__restart__', label: '처음으로', next_node_id: rootId || 'root' }];
      }
    }

    const cleanName = (nodeForm.name || '').trim();

    const updatedNode = {
      ...(draftNodes[cleanId] || {}),
      name: cleanName || cleanId,
      title: cleanName || cleanId,
      node_id: cleanId,
      scenario_id: nodeForm.scenario_id.trim() || cleanId.split('.')[0] || 'general',
      type: nodeForm.type,
      text: cleanText,
      options: finalOptions,
      answer_text: nodeForm.type === 'terminal' ? ((nodeForm.answer_text || cleanText).trim() || '최종 조치 및 가이드 내용입니다.') : undefined,
      answer: nodeForm.type === 'terminal'
        ? { source: 'scenario_ppt', text: (nodeForm.answer_text || cleanText).trim() || '최종 조치 및 가이드 내용입니다.' }
        : undefined
    };

    setDraftNodes((prev) => {
      const nextMap = {
        ...prev,
        [cleanId]: updatedNode
      };

      // ★ 부모 노드가 지정된 경우: 부모 노드의 options에 신규 자식 노드로 연결되는 선택지 자동 추가 및 선 연결
      if (nodeForm.parentNodeId && nextMap[nodeForm.parentNodeId]) {
        const parent = nextMap[nodeForm.parentNodeId];
        const optLabel = (nodeForm.parentOptionLabel || '다음 단계').trim();
        const optId = `opt_${cleanId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

        const nextParentOptions = [
          ...(parent.options || []),
          {
            option_id: optId,
            label: optLabel,
            next_node: cleanId,
            next_node_id: cleanId
          }
        ];

        nextMap[nodeForm.parentNodeId] = {
          ...parent,
          options: nextParentOptions
        };
      }

      validateDraft(nextMap);
      return nextMap;
    });

    setIsDirty(true);
    setSelectedNodeId(cleanId);
    setModalOpen(false);

    alert(modalMode === 'create'
      ? (nodeForm.parentNodeId
          ? `🎉 하위 노드 [${cleanId}]가 추가되고 부모 노드 [${nodeForm.parentNodeId}]와 선으로 자동 연결되었습니다!\n캔버스에서 확인 후 상단의 [최종 저장]을 눌러주세요.`
          : `🎉 신규 노드 [${cleanId}]가 캔버스에 추가되었습니다.\n선으로 연결한 후 상단의 [최종 저장]을 눌러주세요.`)
      : `✓ 노드 [${cleanId}] 내용이 수정되었습니다.\n완료 후 상단의 [최종 저장]을 눌러주세요.`
    );
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
      options: type === 'terminal'
        ? [{ option_id: '__restart__', label: '처음으로', next_node_id: rootId || 'root' }]
        : [{ label: '다음 단계', next_node: '', next_node_id: '' }],
      answer_text: type === 'terminal' ? '최종 조치 및 가이드 내용입니다.' : undefined,
      answer: type === 'terminal' ? { source: 'scenario_ppt', text: '최종 조치 및 가이드 내용입니다.' } : undefined
    };

    setDraftNodes((prev) => {
      const nextMap = { ...prev, [nodeId]: newNode };
      validateDraft(nextMap);
      return nextMap;
    });
    setSelectedNodeId(nodeId);
    setIsDirty(true);
    return nodeId;
  }, [rootId, validateDraft]);

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

  // ★ 5. 무결성 정상 판정 후 상담 흐름 일괄 최종 저장 핸들러
  const handleSaveTree = useCallback(async () => {
    const val = validateDraft(draftNodes, rootId);
    if (!val.is_valid) {
      alert(`[저장 불가] 상담 흐름에 해결되지 않은 연결 오류가 있습니다.\n\n오류 목록:\n• ${val.errors.join('\n• ')}\n\n모든 상담 항목과 버튼을 올바르게 연결한 후 다시 저장해주세요.`);
      return;
    }

    if (val.unreachable_count > 0) {
      const proceed = window.confirm(`주의: 상담 시작에서 도달할 수 없는 고립 항목이 ${val.unreachable_count}개 있습니다.\n이대로 저장을 진행하시겠습니까?`);
      if (!proceed) return;
    }

    setSavingTree(true);
    try {
      // 전송 전 모든 항목 정규화 (터미널 노드의 answer.source = 'scenario_ppt' 보장)
      const cleanNodes = {};
      Object.keys(draftNodes).forEach((nid) => {
        const n = { ...draftNodes[nid] };
        if (n.type === 'terminal') {
          const ansText = n.answer?.text || n.answer_text || '최종 조치 및 가이드 내용입니다.';
          n.answer = {
            source: 'scenario_ppt',
            text: ansText
          };
          const hasRestart = n.options && n.options.some((o) => o.option_id === '__restart__' || o.next_node_id === (rootId || 'root'));
          if (!hasRestart) {
            n.options = [{ option_id: '__restart__', label: '처음으로', next_node_id: rootId || 'root' }];
          }
        }
        cleanNodes[nid] = n;
      });

      const payload = {
        root_node_id: rootId,
        nodes: cleanNodes
      };

      const res = await fetch('/api/admin/scenarios/tree', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const json = await res.json();
        alert(`🎉 상담 흐름이 성공적으로 저장 및 즉시 반영되었습니다!\n(총 ${json.total_nodes || Object.keys(draftNodes).length}개 항목 가동 중)`);
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
    if (window.confirm('작업 중인 변경사항을 모두 취소하고 서버의 원래 상담 흐름 상태로 되돌리시겠습니까?')) {
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
          <h2 className="admin-page-title">장애 상담 흐름 관리</h2>
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
            <span>전체 상담 항목 :</span>
            <span className="val">{data?.total_nodes || 0}개</span>
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
                  ? `상담 흐름 상태 : 정상 (도달 가능 ${validation.reachable_count}개)`
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
              <span>상담 흐름 보기</span>
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
              <span>목록으로 보기</span>
            </button>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={fetchTree} title="새로고침">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>새로고침</span>
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleOpenCreate}>
            <Plus size={14} />
            <span>상담 항목 추가</span>
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
                  title="선택된 상담 흐름 내용 및 분기 옵션 수정"
                >
                  <Edit2 size={13} />
                  <span>상담 흐름 수정</span>
                </button>
                {selectedNode.type !== 'terminal' ? (
                  <>
                    <button
                      className="btn btn-emerald btn-sm"
                      onClick={() => handleOpenCreateChild(selectedNode, 'terminal')}
                      title="이 항목의 하위 최종 해결 답변('처음으로' 리셋 포함) 생성"
                      style={{
                        background: 'rgba(5, 150, 105, 0.15)',
                        color: 'var(--emerald)',
                        border: '1px solid var(--emerald)',
                        fontWeight: 700
                      }}
                    >
                      <Plus size={13} />
                      <span>하위 답변 추가</span>
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenCreateChild(selectedNode, 'question')}
                      title="이 항목의 하위 질문/선택 항목 생성"
                      style={{ fontWeight: 600 }}
                    >
                      <Plus size={13} />
                      <span>하위 질문 추가</span>
                    </button>
                  </>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--emerald)', fontWeight: 700, padding: '0.2rem 0.55rem', background: 'rgba(5, 150, 105, 0.1)', borderRadius: '6px', border: '1px solid rgba(5, 150, 105, 0.3)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Lock size={12} />
                    <span>최종 상담 종결 항목 (하위 추가 불가)</span>
                  </span>
                )}
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
          {/* 좌측: 그룹별 항목 탐색기 */}
          <div style={{ background: 'var(--bg-card)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', height: '680px', display: 'flex', flexDirection: 'column', minWidth: 0, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="faq-search-input"
                  style={{ width: '100%', paddingLeft: '32px' }}
                  placeholder="상담 항목 또는 질문 검색…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.35rem' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>상담 흐름 데이터를 불러오는 중…</div>
              ) : Object.keys(groups).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>등록된 상담 항목이 없습니다.</div>
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
                      <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                        {selectedNode.name || selectedNode.title || selectedNode.node_id || selectedNode.id}
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
                        {selectedNode.type === 'terminal' ? '최종 답변 항목' : '질문/선택 항목'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                      <span>시나리오: <strong style={{ color: 'var(--text-main)' }}>{selectedNode.scenario_id || '미지정'}</strong></span>
                      <span>내부 ID: <code style={{ fontSize: '0.74rem' }}>{selectedNode.node_id || selectedNode.id}</code></span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleOpenEdit(selectedNode)}>
                      <Edit2 size={13} />
                      <span>수정</span>
                    </button>
                    {selectedNode.node_id !== rootId && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteNode(selectedNode.node_id || selectedNode.id)} title="이 상담 항목 삭제">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* ★ [요청 ②] 상위 경로 (이전 노드 / 유입 버튼) 양방향 확인 네비게이션 */}
                {(() => {
                  const currentId = selectedNode.node_id || selectedNode.id;
                  const parents = incomingParentsMap[currentId] || [];
                  const isRoot = currentId === rootId;

                  return (
                    <div style={{
                      background: 'rgba(37, 99, 235, 0.04)',
                      border: '1px solid rgba(37, 99, 235, 0.2)',
                      borderRadius: '8px',
                      padding: '0.85rem 1rem'
                    }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <CornerUpLeft size={14} />
                        <span>상위 경로 (이전 항목 및 유입 버튼)</span>
                      </div>
                      {isRoot ? (
                        <div style={{ fontSize: '0.84rem', color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span>🏁 최상위 상담 시작 항목입니다. (상위 항목 없음)</span>
                        </div>
                      ) : parents.length === 0 ? (
                        <div style={{ fontSize: '0.82rem', color: 'var(--rose)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span>⚠️ 현재 이 항목으로 연결된 상위 항목이 없습니다 (고립 항목).</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {parents.map((p, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                background: '#ffffff',
                                border: '1px solid var(--border-color)',
                                padding: '0.45rem 0.75rem',
                                borderRadius: '6px',
                                fontSize: '0.84rem'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden' }}>
                                <span style={{ fontWeight: 700, color: 'var(--primary)', background: 'rgba(37, 99, 235, 0.1)', padding: '0.1rem 0.45rem', borderRadius: '4px', fontSize: '0.78rem' }}>
                                  버튼: {p.buttonLabel}
                                </span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>from</span>
                                <code style={{ fontSize: '0.8rem', fontWeight: 600 }}>{p.parentId}</code>
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setSelectedNodeId(p.parentId)}
                                style={{ fontSize: '0.74rem', padding: '0.15rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                                title="상위 항목으로 이동"
                              >
                                <ArrowUp size={11} />
                                <span>상위로 이동</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-sub)', marginBottom: '0.4rem', display: 'block' }}>
                    💬 버튼선택시 내용
                  </label>
                  <div style={{ background: '#f8fafc', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {selectedNode.text || selectedNode.answer?.text || selectedNode.answer_text || '(내용 없음)'}
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-sub)', marginBottom: '0.4rem', display: 'block' }}>
                    🔀 버튼 목록 (버튼명 - 버튼 ID) ({selectedNode.options?.length || 0}개)
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
                            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>버튼: {opt.label}</span>
                            {opt.action && (
                              <span className="badge-pill" style={{ fontSize: '0.7rem' }}>
                                액션: {opt.action}
                              </span>
                            )}
                          </div>
                          <div style={{ color: opt.next_node ? 'var(--primary)' : 'var(--text-muted)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0, paddingLeft: '0.5rem' }}>
                            ➔ 버튼 ID: {opt.next_node || '종료'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ background: '#f8fafc', border: '1px solid var(--border-color)', padding: '1.25rem', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                      {selectedNode.type === 'terminal' ? '🎉 상담 종결 리프(Leaf) 노드입니다. (하위 질문/선택지 없음)' : '설정된 하위 버튼이 없습니다.'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '6rem 1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                좌측 목록에서 항목을 클릭하면 상세 안내 문구와 하위 선택 버튼 내역을 확인할 수 있습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 상담 항목 생성/수정 모달 - ★ [요청 ⑦] X 버튼 또는 취소 버튼을 누를 때만 닫히도록 backdrop onClick 제거 */}
      {modalOpen && (
        <div className="modal-backdrop active">
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
            <div className="modal-header">
              <h3>{modalMode === 'create' ? (nodeForm.parentNodeId ? '새 하위 상담 항목 추가' : '새 상담 항목 등록') : `상담 흐름 수정: ${nodeForm.name || nodeForm.node_id}`}</h3>
              <button className="btn-close" onClick={() => setModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleSubmitNode}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* ★ [사용자 피드백 반영] 의미 없는 ID 대신 사용자가 직접 이름을 지정할 수 있는 전용 필드 */}
                <div className="form-group" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-main)' }}>
                      🏷️ 상담 항목 이름 (사용자 지정 명칭)
                    </label>
                    <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 600 }}>
                      * 캔버스와 관리 화면에 노출될 명칭
                    </span>
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    value={nodeForm.name}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setNodeForm((prev) => ({
                        ...prev,
                        name: newName,
                        // 신규 생성 시 항목 이름에 맞춰 부모 버튼명 및 내부 식별 ID 자동 동기화
                        parentOptionLabel: modalMode === 'create' && (!prev.parentOptionLabel || prev.parentOptionLabel === prev.name) ? newName : prev.parentOptionLabel,
                        node_id: modalMode === 'create'
                          ? generateNodeIdFromLabel(newName, prev.parentNodeId || prev.scenario_id, prev.type)
                          : prev.node_id
                      }));
                    }}
                    placeholder="예: 와이파이 전원 확인, 공유기 리셋 안내, 랜선 점검"
                    required
                    style={{ fontWeight: 600, fontSize: '0.92rem' }}
                  />
                </div>

                {nodeForm.parentNodeId && (
                  <div style={{
                    background: 'rgba(37, 99, 235, 0.05)',
                    border: '1px solid rgba(37, 99, 235, 0.2)',
                    borderRadius: '8px',
                    padding: '0.75rem 0.85rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <GitFork size={14} />
                      <span>상위 항목 <code>{nodeForm.parentNodeId}</code>의 하위 단계로 자동 연결됩니다.</span>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.74rem', marginBottom: '0.2rem' }}>
                        상위 항목에 노출될 선택지 버튼 명칭
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        value={nodeForm.parentOptionLabel}
                        onChange={(e) => setNodeForm({ ...nodeForm, parentOptionLabel: e.target.value })}
                        placeholder="예: 상세 점검 진행, 네 맞아요, 공유기 재부팅 완료"
                        required
                      />
                    </div>
                  </div>
                )}

                {/* 시나리오 그룹 및 내부 관리 ID (보조 정보로 깔끔하게 정리) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.75rem', background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: '0.2rem' }}>시나리오 그룹</label>
                    <input
                      type="text"
                      className="form-input"
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
                      value={nodeForm.scenario_id}
                      onChange={(e) => setNodeForm({ ...nodeForm, scenario_id: e.target.value })}
                      placeholder="예: wired_network"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <label className="form-label" style={{ fontSize: '0.74rem', color: '#64748b', margin: 0 }}>내부 시스템 ID (자동 관리)</label>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: '#64748b', padding: '0.4rem 0.6rem', background: '#f1f5f9', borderRadius: '6px', border: '1px dashed #cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nodeForm.node_id}>
                      {nodeForm.node_id}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">항목 유형 (종류)</label>
                  <select
                    className="faq-select"
                    style={{ width: '100%', fontWeight: 600 }}
                    value={nodeForm.type}
                    onChange={(e) => {
                      const newType = e.target.value;
                      setNodeForm((prev) => {
                        const basePrefix = prev.parentNodeId || prev.scenario_id || 'node';
                        const autoId = generateNodeIdFromLabel(prev.parentOptionLabel, basePrefix, newType);
                        if (newType === 'terminal') {
                          return {
                            ...prev,
                            type: 'terminal',
                            node_id: modalMode === 'create' ? autoId : prev.node_id,
                            parentOptionLabel: prev.parentOptionLabel === '상세 점검 진행' ? '해결 방법 확인' : prev.parentOptionLabel,
                            text: prev.text || '해결 조치 가이드 내용을 확인하세요.',
                            options: [{ option_id: '__restart__', label: '처음으로', next_node_id: rootId || 'root' }],
                            answer_text: prev.answer_text || '최종 조치 및 가이드 내용입니다.'
                          };
                        } else {
                          return {
                            ...prev,
                            type: 'question',
                            node_id: modalMode === 'create' ? autoId : prev.node_id,
                            parentOptionLabel: prev.parentOptionLabel === '해결 방법 확인' ? '상세 점검 진행' : prev.parentOptionLabel,
                            text: prev.text === '해결 조치 가이드 내용을 확인하세요.' ? '' : prev.text,
                            options: [{ label: '다음 단계', next_node: '', next_node_id: '' }],
                            answer_text: ''
                          };
                        }
                      });
                    }}
                  >
                    <option value="terminal">✅ 최종 답변 및 조치 항목 (해결 안내 및 종결)</option>
                    <option value="question">❓ 중간 안내 항목 (하위 선택 버튼 및 추가 질문)</option>
                  </select>
                </div>

                {/* ★ [사용자 피드백 반영] '최종 조치 안내 문구'와 '최종 조치 답변 본문'을 '버튼선택시 내용'으로 단일화 통일 */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-main)' }}>
                    버튼선택시 내용
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={4}
                    value={nodeForm.text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNodeForm({ ...nodeForm, text: val, answer_text: val });
                    }}
                    placeholder="버튼을 클릭했을 때 사용자에게 안내할 상세 내용 또는 해결 가이드를 입력하세요."
                    required
                  />
                  {nodeForm.type === 'terminal' && (
                    <div style={{ marginTop: '0.45rem', fontSize: '0.78rem', color: 'var(--emerald)', background: 'rgba(5, 150, 105, 0.08)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(5, 150, 105, 0.25)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Lock size={13} />
                      <span>최종 종결 노드이므로 하위 질문 및 선택지가 추가되지 않으며, '처음으로' 버튼이 자동 제공됩니다.</span>
                    </div>
                  )}
                </div>

                {nodeForm.type !== 'terminal' && (
                  /* ★ [사용자 피드백 반영] 직접 입력 + 목록 선택 하이브리드 지원 및 카드형 가시성 극대화 */
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem' }}>
                        버튼 목록 및 이동할 다음 노드 ({nodeForm.options.length}개)
                      </label>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        직접 타이핑하거나 목록에서 선택 가능 (미지정 시 캔버스 드래그 연결)
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {nodeForm.options.map((opt, i) => {
                        const currentNext = opt.next_node || opt.next_node_id || '';
                        const matchedNode = availableTargetNodes.find(
                          (t) => t.id === currentNext || t.name === currentNext
                        );

                        return (
                          <div
                            key={i}
                            style={{
                              padding: '0.65rem 0.75rem',
                              background: 'var(--card-bg, #ffffff)',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color, #e2e8f0)',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.45rem'
                            }}
                          >
                            {/* 1행: 버튼명 입력 + 삭제 버튼 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '58px' }}>
                                버튼명:
                              </span>
                              <input
                                type="text"
                                className="form-input"
                                placeholder="사용자 화면에 노출될 버튼 이름 (예: 네, 전원이 켜져 있어요)"
                                value={opt.label}
                                onChange={(e) => {
                                  const opts = [...nodeForm.options];
                                  opts[i].label = e.target.value;
                                  setNodeForm({ ...nodeForm, options: opts });
                                }}
                                style={{ flex: 1, height: '36px' }}
                                required
                              />
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => setNodeForm({ ...nodeForm, options: nodeForm.options.filter((_, idx) => idx !== i) })}
                                title="버튼 삭제"
                                style={{ height: '36px', padding: '0 0.65rem', minWidth: '36px' }}
                              >
                                ×
                              </button>
                            </div>

                            {/* 2행: 이동할 다음 항목 (직접 입력창 + 빠른 드롭다운 선택) */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '58px' }}>
                                연결 항목:
                              </span>
                              {/* ✏️ 직접 텍스트 입력창 (항목 이름 또는 ID 모두 인식) */}
                              <input
                                type="text"
                                className="form-input"
                                placeholder="항목 이름 또는 ID 직접 타이핑"
                                value={opt.custom_target_text !== undefined ? opt.custom_target_text : (matchedNode ? matchedNode.name : currentNext)}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const found = availableTargetNodes.find(
                                    (t) => t.name.trim().toLowerCase() === val.trim().toLowerCase() || t.id.trim().toLowerCase() === val.trim().toLowerCase()
                                  );
                                  const opts = [...nodeForm.options];
                                  opts[i].custom_target_text = val;
                                  const targetId = found ? found.id : val.trim();
                                  opts[i].next_node = targetId;
                                  opts[i].next_node_id = targetId;
                                  setNodeForm({ ...nodeForm, options: opts });
                                }}
                                style={{ flex: 1, height: '36px', fontSize: '0.84rem' }}
                              />

                              {/* 📋 빠른 목록 선택 드롭다운 */}
                              <select
                                className="form-select"
                                value={matchedNode ? matchedNode.id : (availableTargetNodes.some(t => t.id === currentNext) ? currentNext : '')}
                                onChange={(e) => {
                                  const chosenId = e.target.value;
                                  const found = availableTargetNodes.find((t) => t.id === chosenId);
                                  const opts = [...nodeForm.options];
                                  opts[i].custom_target_text = found ? found.name : '';
                                  opts[i].next_node = chosenId;
                                  opts[i].next_node_id = chosenId;
                                  setNodeForm({ ...nodeForm, options: opts });
                                }}
                                style={{ width: '165px', flexShrink: 0, height: '36px', fontSize: '0.8rem', fontWeight: 600 }}
                              >
                                <option value="">📋 목록에서 선택</option>
                                {availableTargetNodes.map((target) => (
                                  <option key={target.id} value={target.id}>
                                    {target.name} [{target.typeLabel}]
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* 3행: 연결 상태 가시성 실시간 배지 */}
                            <div style={{ paddingLeft: '63px', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              {matchedNode ? (
                                <span style={{ color: '#059669', background: 'rgba(5, 150, 105, 0.08)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                                  ✓ 연결 완료: <strong>{matchedNode.name}</strong> ({matchedNode.typeLabel} / ID: {matchedNode.id})
                                </span>
                              ) : currentNext ? (
                                <span style={{ color: '#d97706', background: 'rgba(217, 119, 6, 0.08)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                                  ✎ 직접 지정 ID: <strong>{currentNext}</strong> (목록 외 항목)
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', background: 'rgba(100, 116, 139, 0.08)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                                  ⚪ 미연결 상태 (저장 후 캔버스에서 마우스로 선을 끌어 연결할 수 있습니다)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => setNodeForm({ ...nodeForm, options: [...nodeForm.options, { label: '', next_node: '', next_node_id: '' }] })}
                    >
                      + 버튼 추가
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

      {/* 5. 신규 플로우 생성 모달 - ★ [요청 ⑦] X 버튼 또는 취소 시에만 닫힘 */}
      {createFlowModalOpen && (
        <div className="modal-backdrop">
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
                  새로운 상담 주제(플로우)를 생성하면 <strong>상담 시작에 바로가기 선택 버튼</strong>과
                  <strong>첫 번째 시작 질문 항목</strong>이 자동으로 생성되어 캔버스에 배치됩니다.
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
                    항목 ID의 접두사로 사용됩니다. (영문 소문자, 숫자, 언더스코어 권장)
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
                    상담 시작 버튼 및 플로우 탭에 표시될 직관적인 이름입니다.
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
