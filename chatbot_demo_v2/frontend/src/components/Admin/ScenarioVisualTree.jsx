import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Move, Plus, Edit2, Trash2,
  ArrowRight, CheckCircle2, HelpCircle, ChevronRight, ChevronDown,
  Layers, Search, Compass, Eye, EyeOff, Sparkles, Filter, X
} from 'lucide-react';

const NODE_WIDTH = 290;
const NODE_APPROX_HEIGHT = 170;
const HORIZONTAL_GAP = 140;
const VERTICAL_GAP = 40;

/**
 * 플로우별 테마 컬러 및 메타데이터 정의
 */
const FLOW_THEMES = {
  internet_down: {
    label: '🌐 인터넷 불통',
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    badge: '인터넷 장애'
  },
  internet_slow: {
    label: '⚡ 인터넷 속도',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    badge: '속도 저하'
  },
  my_pc: {
    label: '💻 내 PC 점검',
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    badge: '개인 PC'
  },
  wifi: {
    label: '📶 Wi-Fi / AP',
    color: '#0891b2',
    bg: '#ecfeff',
    border: '#a5f3fc',
    badge: '무선망'
  },
  tablet_nms: {
    label: '📱 단말 / 관제 / 콜센터',
    color: '#059669',
    bg: '#ecfdf5',
    border: '#a7f3d0',
    badge: '단말·지원'
  },
  default: {
    label: '📋 일반 시나리오',
    color: '#475569',
    bg: '#f8fafc',
    border: '#cbd5e1',
    badge: '시나리오'
  }
};

const FLOW_PALETTE = [
  { color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe' },
  { color: '#ec4899', bg: '#fdf2f8', border: '#fbcfe8' },
  { color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  { color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
  { color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe' }
];

export function getFlowTheme(flowKey = 'default') {
  if (FLOW_THEMES[flowKey]) return FLOW_THEMES[flowKey];
  let hash = 0;
  for (let i = 0; i < flowKey.length; i++) {
    hash = flowKey.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorSet = FLOW_PALETTE[Math.abs(hash) % FLOW_PALETTE.length];
  return {
    label: `📁 ${flowKey}`,
    color: colorSet.color,
    bg: colorSet.bg,
    border: colorSet.border,
    badge: flowKey
  };
}

/**
 * 노드 ID 또는 속성으로 소속 플로우 감지 (신규 커스텀 플로우 포함)
 */
function detectNodeFlow(nodeId = '', nodeData = null) {
  if (nodeData?.scenario_id && nodeData.scenario_id !== 'general') {
    return nodeData.scenario_id;
  }
  if (nodeId.startsWith('internet_down')) return 'internet_down';
  if (nodeId.startsWith('internet_slow')) return 'internet_slow';
  if (nodeId.startsWith('my_pc')) return 'my_pc';
  if (nodeId.startsWith('wifi') || nodeId.startsWith('ap_no_light')) return 'wifi';
  if (
    nodeId.startsWith('tablet') ||
    nodeId.startsWith('nms') ||
    nodeId.startsWith('callcenter')
  ) {
    return 'tablet_nms';
  }
  if (nodeId.includes('.')) {
    return nodeId.split('.')[0];
  }
  return 'default';
}

/**
 * 사이클(순환 참조) 완전 방어 부모 중심 서브트리 레이아웃
 */
function computeSubtreeLayout(nodes, rootId, activeFlow = 'ALL', collapsedSet = new Set()) {
  if (!nodes || Object.keys(nodes).length === 0) return {};

  const actualRoot = rootId && nodes[rootId] ? rootId : Object.keys(nodes)[0];

  const targetNodeIds = new Set();
  if (activeFlow === 'ALL') {
    Object.keys(nodes).forEach((id) => targetNodeIds.add(id));
  } else {
    targetNodeIds.add(actualRoot);
    Object.keys(nodes).forEach((id) => {
      if (detectNodeFlow(id, nodes[id]) === activeFlow) {
        targetNodeIds.add(id);
      }
    });
  }

  const treeChildren = {};
  const depths = {};
  for (const nid of targetNodeIds) {
    treeChildren[nid] = [];
  }

  const bfsQueue = [actualRoot];
  const bfsVisited = new Set([actualRoot]);
  depths[actualRoot] = 0;

  while (bfsQueue.length > 0) {
    const currId = bfsQueue.shift();
    const currDepth = depths[currId] || 0;
    const node = nodes[currId];
    if (!node) continue;

    if (collapsedSet.has(currId)) continue;

    const options = node.options || [];
    for (const opt of options) {
      const nextId = opt.next_node_id || opt.next_node;
      if (
        nextId &&
        targetNodeIds.has(nextId) &&
        nextId !== actualRoot &&
        !bfsVisited.has(nextId)
      ) {
        bfsVisited.add(nextId);
        depths[nextId] = currDepth + 1;
        treeChildren[currId].push(nextId);
        bfsQueue.push(nextId);
      }
    }
  }

  let maxFoundDepth = Math.max(0, ...Object.values(depths));
  for (const nid of targetNodeIds) {
    if (depths[nid] === undefined) {
      maxFoundDepth += 1;
      depths[nid] = maxFoundDepth;
    }
  }

  const positions = {};
  let currentY = 60;
  const startX = 60;

  const layoutVisited = new Set();
  function placeNodeSubtree(currId) {
    if (layoutVisited.has(currId)) {
      return positions[currId]?.y || currentY;
    }
    layoutVisited.add(currId);

    const children = (treeChildren[currId] || []).filter((cid) => !layoutVisited.has(cid));

    if (children.length === 0) {
      const y = currentY;
      currentY += NODE_APPROX_HEIGHT + VERTICAL_GAP;
      positions[currId] = {
        x: startX + (depths[currId] || 0) * (NODE_WIDTH + HORIZONTAL_GAP),
        y
      };
      return y;
    }

    const childYs = [];
    for (const childId of children) {
      const cy = placeNodeSubtree(childId);
      childYs.push(cy);
    }

    const minY = Math.min(...childYs);
    const maxY = Math.max(...childYs);
    const midY = Math.round((minY + maxY) / 2);

    positions[currId] = {
      x: startX + (depths[currId] || 0) * (NODE_WIDTH + HORIZONTAL_GAP),
      y: midY
    };

    return midY;
  }

  placeNodeSubtree(actualRoot);

  for (const nid of targetNodeIds) {
    if (!positions[nid]) {
      positions[nid] = {
        x: startX + (depths[nid] || 1) * (NODE_WIDTH + HORIZONTAL_GAP),
        y: currentY
      };
      currentY += NODE_APPROX_HEIGHT + VERTICAL_GAP;
    }
  }

  return positions;
}

export function ScenarioVisualTree({
  nodes,
  rootId,
  selectedNodeId,
  onSelectNode,
  onEditNode,
  onDeleteNode,
  onCreateChildNode,
  // ★ 신규 시각적 노드 빌더 Props
  isDirty = false,
  validationResult = { is_valid: true, errors: [], warnings: [] },
  savingTree = false,
  onConnectNodes,
  onDisconnectOption,
  onCreateVisualNode,
  onOpenCreateFlow,
  onSaveTree,
  onResetDraft
}) {
  const containerRef = useRef(null);

  // 1. 활성 플로우 필터 (ALL | internet_down | internet_slow | my_pc | wifi | tablet_nms | 신규 플로우)
  const [activeFlow, setActiveFlow] = useState('ALL');

  // ★ 1-1. 포트 간 선 연결 (Port-to-Port Wiring) 상태
  // { sourceId, optionIndex, label, startX, startY }
  const [connectingPort, setConnectingPort] = useState(null);
  const [mouseWorldPos, setMouseWorldPos] = useState({ x: 0, y: 0 });
  const [showValidationPopover, setShowValidationPopover] = useState(false);

  // 모든 동적 플로우 목록 추출
  const allFlowKeys = useMemo(() => {
    const defaultFlows = ['internet_down', 'internet_slow', 'my_pc', 'wifi', 'tablet_nms'];
    const keys = new Set(defaultFlows);
    if (nodes) {
      Object.entries(nodes).forEach(([nid, node]) => {
        const flow = detectNodeFlow(nid, node);
        if (flow && flow !== 'default') {
          keys.add(flow);
        }
      });
    }
    return Array.from(keys);
  }, [nodes]);

  // 2. 접기/펼치기 상태 Set
  const [collapsedNodes, setCollapsedNodes] = useState(new Set());

  // 3. 카드 상세 모드 토글 (compact vs detailed)
  const [isCompact, setIsCompact] = useState(true);

  // 4. 검색어 필터
  const [searchQuery, setSearchQuery] = useState('');

  // 5. 캔버스 Pan & Zoom 상태 (기본 100% 뷰, 사용자가 맞춘 줌 유지!)
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 80, y: 60 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, initialPanX: 0, initialPanY: 0 });

  // 6. 노드 드래그 상태
  const [nodePositions, setNodePositions] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  // 7. 호버 중인 노드
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  // 8. 캔버스 월드 애니메이션 활성화 (버튼 클릭 시만 부드럽게 이동)
  const [animateWorld, setAnimateWorld] = useState(false);

  // 최초 초기화 완료 여부 플래그 (최초 1회만 레이아웃과 뷰포트 초기화)
  const initialLayoutDoneRef = useRef(false);

  // RAF 스케줄러 ref
  const rafRef = useRef(null);

  // 레이아웃 계산 함수 (resetViewport: 사용자가 명시적으로 정렬 버튼/탭을 눌렀을 때만 true)
  const applyLayout = useCallback(
    (flow = activeFlow, collapsed = collapsedNodes, resetViewport = false) => {
      try {
        const calculated = computeSubtreeLayout(nodes, rootId, flow, collapsed);
        setNodePositions((prev) => {
          // 기존 위치가 있고 resetViewport가 아니면 기존 위치 유지, 신규 노드만 자동 배치
          if (!resetViewport && Object.keys(prev).length > 0) {
            const merged = { ...calculated };
            for (const [k, p] of Object.entries(prev)) {
              if (calculated[k]) merged[k] = p;
            }
            return merged;
          }
          return calculated;
        });

        // 사용자가 명시적으로 초기화를 원할 때만 줌/팬 리셋
        if (resetViewport) {
          setAnimateWorld(true);
          setZoom(1.0);
          setPan({ x: 80, y: 60 });
          setTimeout(() => setAnimateWorld(false), 250);
        }
      } catch (err) {
        console.error('Layout computation error:', err);
      }
    },
    [nodes, rootId, activeFlow, collapsedNodes]
  );

  // 초기 1회 로드 시에만 기본 위치 계산 (이후 노드 선택이나 클릭 시 줌 리셋 절대 없음!)
  useEffect(() => {
    if (!nodes || Object.keys(nodes).length === 0) return;
    if (!initialLayoutDoneRef.current) {
      applyLayout(activeFlow, collapsedNodes, true);
      initialLayoutDoneRef.current = true;
    } else {
      // 데이터가 갱신되어도 사용자의 현재 줌과 팬, 드래그한 위치는 100% 보존
      applyLayout(activeFlow, collapsedNodes, false);
    }
  }, [nodes, rootId, activeFlow, collapsedNodes, applyLayout]);

  // 플로우 선택 핸들러 (사용자가 탭을 바꿨을 때는 해당 플로우로 시점 맞춤)
  const handleSelectFlow = (flowKey) => {
    setActiveFlow(flowKey);
    applyLayout(flowKey, collapsedNodes, true);
  };

  // 자동 정렬 버튼 핸들러 (사용자가 직접 정렬을 요청했을 때)
  const handleManualAutoLayout = () => {
    applyLayout(activeFlow, collapsedNodes, true);
  };

  // 노드 접기/펼치기 토글
  const handleToggleCollapse = (e, nodeId) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      applyLayout(activeFlow, next, false);
      return next;
    });
  };

  // 특정 노드로 스무스 뷰포트 이동 (줌 배율은 그대로 유지하고 팬만 이동)
  const focusOnNode = useCallback(
    (targetId) => {
      const pos = nodePositions[targetId];
      if (!pos || !containerRef.current) return;
      onSelectNode(targetId);

      const containerWidth = containerRef.current.clientWidth || 1000;
      const containerHeight = containerRef.current.clientHeight || 740;

      const targetX = Math.round(containerWidth / 2 - (pos.x + NODE_WIDTH / 2) * zoom);
      const targetY = Math.round(containerHeight / 2 - (pos.y + 80) * zoom);

      setAnimateWorld(true);
      setPan({ x: targetX, y: targetY });
      setTimeout(() => setAnimateWorld(false), 250);
    },
    [nodePositions, onSelectNode, zoom]
  );

  // 검색 결과 목록
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !nodes) return [];
    const q = searchQuery.toLowerCase();
    return Object.values(nodes).filter((node) => {
      const nid = (node.node_id || node.id || '').toLowerCase();
      const text = (node.text || node.answer?.text || '').toLowerCase();
      const optionsStr = (node.options || []).map((o) => o.label || '').join(' ').toLowerCase();
      return nid.includes(q) || text.includes(q) || optionsStr.includes(q);
    });
  }, [searchQuery, nodes]);

  // 활성 경로 포커스 하이라이트
  const activeFocusId = selectedNodeId || hoveredNodeId;
  const { pathNodeIds, pathEdgeIds } = useMemo(() => {
    if (!activeFocusId || !nodes) {
      return { pathNodeIds: null, pathEdgeIds: null };
    }

    const pNodes = new Set([activeFocusId]);
    const pEdges = new Set();

    const curr = nodes[activeFocusId];
    if (curr) {
      (curr.options || []).forEach((opt, idx) => {
        const nextId = opt.next_node_id || opt.next_node;
        if (nextId) {
          pNodes.add(nextId);
          pEdges.add(`${activeFocusId}-${idx}->${nextId}`);
        }
      });
    }

    for (const [pId, pNode] of Object.entries(nodes)) {
      (pNode.options || []).forEach((opt, idx) => {
        const nextId = opt.next_node_id || opt.next_node;
        if (nextId === activeFocusId) {
          pNodes.add(pId);
          pEdges.add(`${pId}-${idx}->${activeFocusId}`);
        }
      });
    }

    return { pathNodeIds: pNodes, pathEdgeIds: pEdges };
  }, [activeFocusId, nodes]);

  // 엣지(연결선) 계산: 그래프 왼쪽에 의미없는 선(역방향 백링크 19개 등) 완전 차단
  const visibleEdges = useMemo(() => {
    if (!nodes) return [];
    const list = [];
    const actualRootId = rootId || 'root';
    const activeNodeIdSet = new Set(Object.keys(nodePositions));

    for (const [sourceId, node] of Object.entries(nodes)) {
      if (!activeNodeIdSet.has(sourceId)) continue;
      if (collapsedNodes.has(sourceId)) continue;

      const sPos = nodePositions[sourceId];
      if (!sPos) continue;

      const options = node.options || [];
      options.forEach((opt, optIndex) => {
        const targetId = opt.next_node_id || opt.next_node;

        // 1. 타겟이 없거나, 루트('root')로 향하는 모든 역방향 백링크는 SVG 선에서 100% 제외
        // (단말 답변 노드에서 화면 왼쪽 root로 날아가는 19개의 의미없는 선 제거)
        if (!targetId || targetId === 'root' || targetId === actualRootId) {
          return;
        }

        // 2. 타겟 노드가 현재 활성 노드 집합에 없으면 제외
        if (!activeNodeIdSet.has(targetId) || !nodes[targetId]) {
          return;
        }

        const tPos = nodePositions[targetId];
        if (!tPos) return;

        // 3. 역방향 선(왼쪽으로 거꾸로 뻗는 선) 제외: 트리는 항상 좌->우 순방향이어야 함
        if (tPos.x <= sPos.x) {
          return;
        }

        // 4. 특정 플로우 선택 시, 다른 플로우로 나가는 선 제외
        if (activeFlow !== 'ALL') {
          const targetFlow = detectNodeFlow(targetId);
          if (targetFlow !== activeFlow) {
            return;
          }
        }

        list.push({
          id: `${sourceId}-${optIndex}->${targetId}`,
          sourceId,
          targetId,
          label: opt.label || '',
          optIndex,
          totalOptions: options.length
        });
      });
    }
    return list;
  }, [nodes, nodePositions, collapsedNodes, rootId, activeFlow]);

  // 줌 버튼 핸들러
  const handleZoomIn = () => {
    setAnimateWorld(true);
    setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
    setTimeout(() => setAnimateWorld(false), 200);
  };
  const handleZoomOut = () => {
    setAnimateWorld(true);
    setZoom((z) => Math.max(0.35, Number((z - 0.15).toFixed(2))));
    setTimeout(() => setAnimateWorld(false), 200);
  };
  const handleZoomReset = () => {
    setAnimateWorld(true);
    setZoom(1.0);
    setPan({ x: 80, y: 60 });
    setTimeout(() => setAnimateWorld(false), 200);
  };

  /**
   * 마우스 커서 중심 스마트 줌 (Zoom-to-Pointer)
   */
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      const newZoom = Math.min(2.2, Math.max(0.3, zoom * zoomFactor));

      if (newZoom === zoom) return;

      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      setZoom(Number(newZoom.toFixed(3)));
      setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
    },
    [zoom, pan]
  );

  // 캔버스 마우스 다운 (패닝 시작 또는 연결 취소)
  const handleCanvasMouseDown = (e) => {
    if (connectingPort) {
      setConnectingPort(null);
      return;
    }
    if (
      e.target.closest('.scenario-node-card') ||
      e.target.closest('.canvas-control-btn') ||
      e.target.closest('.canvas-filter-bar') ||
      e.target.closest('.scenario-minimap')
    ) {
      return;
    }
    onSelectNode(null);
    setIsPanning(true);
    panStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialPanX: pan.x,
      initialPanY: pan.y
    };
  };

  // ★ 출발 포트 클릭 -> 선 잇기(Rubberband Wire) 모드 시작
  const handleStartConnect = (e, sourceId, optionIndex, optLabel) => {
    e.stopPropagation();
    const sourcePos = nodePositions[sourceId];
    if (!sourcePos) return;

    const optionVerticalOffset = isCompact ? 75 : 85;
    const startX = sourcePos.x + NODE_WIDTH;
    const node = nodes[sourceId];
    const totalOptions = node?.options?.length || 1;
    const startY = sourcePos.y + optionVerticalOffset + (optionIndex * 24) - ((totalOptions - 1) * 12);

    setConnectingPort({
      sourceId,
      optionIndex,
      label: optLabel || `선택지 #${optionIndex + 1}`,
      startX,
      startY
    });
    setMouseWorldPos({ x: startX + 40, y: startY });
  };

  // ★ 타겟 노드 클릭 -> 선 잇기 완료(Snap & Connect)
  const handleTargetNodeClick = (e, targetId) => {
    if (connectingPort) {
      e.stopPropagation();
      if (connectingPort.sourceId === targetId) {
        alert('자기 자신 노드로는 바로 연결할 수 없습니다. 다른 분기 노드를 선택해주세요.');
        return;
      }
      if (targetId === rootId) {
        alert('시작 루트 노드로 역연결할 수 없습니다.');
        return;
      }
      if (onConnectNodes) {
        onConnectNodes(connectingPort.sourceId, connectingPort.optionIndex, targetId);
      }
      setConnectingPort(null);
      return;
    }
    onSelectNode(targetId);
  };

  // 노드 드래그 시작 (줌이나 팬 리셋 절대 없이 오직 해당 노드만 선택 및 드래그 시작)
  const handleNodeMouseDown = (e, nid) => {
    e.stopPropagation();
    if (connectingPort) {
      handleTargetNodeClick(e, nid);
      return;
    }
    if (e.target.closest('button') || e.target.closest('.option-link-pill')) {
      return;
    }
    onSelectNode(nid);
    setDraggingNodeId(nid);
    const pos = nodePositions[nid] || { x: 0, y: 0 };
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      nodeX: pos.x,
      nodeY: pos.y
    };
  };

  /**
   * 글로벌 윈도우 마우스 리스너 & RAF 60fps 부드러운 드래그 & 선 연결 실시간 추적
   */
  useEffect(() => {
    if (!isPanning && !draggingNodeId && !connectingPort) return;

    const handleWindowMouseMove = (e) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        if (connectingPort && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const mx = Math.round((e.clientX - rect.left - pan.x) / zoom);
          const my = Math.round((e.clientY - rect.top - pan.y) / zoom);
          setMouseWorldPos({ x: mx, y: my });
        } else if (draggingNodeId) {
          const dx = (e.clientX - dragStartRef.current.mouseX) / zoom;
          const dy = (e.clientY - dragStartRef.current.mouseY) / zoom;
          setNodePositions((prev) => ({
            ...prev,
            [draggingNodeId]: {
              x: Math.round(dragStartRef.current.nodeX + dx),
              y: Math.round(dragStartRef.current.nodeY + dy)
            }
          }));
        } else if (isPanning) {
          const dx = e.clientX - panStartRef.current.mouseX;
          const dy = e.clientY - panStartRef.current.mouseY;
          setPan({
            x: Math.round(panStartRef.current.initialPanX + dx),
            y: Math.round(panStartRef.current.initialPanY + dy)
          });
        }
      });
    };

    const handleWindowMouseUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setIsPanning(false);
      setDraggingNodeId(null);
    };

    const handleWindowKeyDown = (e) => {
      if (e.key === 'Escape') {
        setConnectingPort(null);
        setShowValidationPopover(false);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove, { passive: true });
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('keydown', handleWindowKeyDown);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('keydown', handleWindowKeyDown);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPanning, draggingNodeId, connectingPort, zoom, pan]);

  // 미니맵 바운딩 박스
  const bounds = useMemo(() => {
    const coords = Object.values(nodePositions);
    if (coords.length === 0) return { minX: 0, maxX: 1200, minY: 0, maxY: 800 };
    const minX = Math.min(...coords.map((c) => c.x));
    const maxX = Math.max(...coords.map((c) => c.x)) + NODE_WIDTH;
    const minY = Math.min(...coords.map((c) => c.y));
    const maxY = Math.max(...coords.map((c) => c.y)) + NODE_APPROX_HEIGHT;
    return { minX, maxX, minY, maxY };
  }, [nodePositions]);

  return (
    <div
      ref={containerRef}
      className="scenario-canvas-container"
      onMouseDown={handleCanvasMouseDown}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: '100%',
        height: '760px',
        overflow: 'hidden',
        background: '#f8fafc',
        backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
        backgroundSize: '24px 24px',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        cursor: isPanning ? 'grabbing' : draggingNodeId ? 'grabbing' : 'grab',
        userSelect: 'none',
        boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.02)'
      }}
    >
      {/* 1. 상단 좌측: 플로우 필터 탭 바 & 새 플로우 추가 버튼 */}
      <div
        className="canvas-filter-bar"
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          padding: '0.4rem 0.6rem',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
          maxWidth: 'calc(100% - 580px)',
          overflowX: 'auto'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', paddingRight: '0.4rem', borderRight: '1px solid var(--border-color)' }}>
          <Filter size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            플로우:
          </span>
        </div>

        <button
          type="button"
          onClick={() => handleSelectFlow('ALL')}
          style={{
            padding: '0.3rem 0.65rem',
            borderRadius: '8px',
            fontSize: '0.78rem',
            fontWeight: activeFlow === 'ALL' ? 700 : 500,
            background: activeFlow === 'ALL' ? 'var(--primary)' : 'transparent',
            color: activeFlow === 'ALL' ? '#ffffff' : 'var(--text-muted)',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease, color 0.15s ease',
            whiteSpace: 'nowrap'
          }}
        >
          전체 ({Object.keys(nodes || {}).length})
        </button>

        {allFlowKeys.map((key) => {
          const theme = getFlowTheme(key);
          const isActive = activeFlow === key;
          const count = Object.keys(nodes || {}).filter((nid) => detectNodeFlow(nid, nodes[nid]) === key).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleSelectFlow(key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.3rem 0.65rem',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: isActive ? 700 : 500,
                background: isActive ? theme.color : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-main)',
                border: isActive ? `1px solid ${theme.color}` : '1px solid transparent',
                cursor: 'pointer',
                transition: 'background 0.15s ease, color 0.15s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{theme.label}</span>
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '0.05rem 0.35rem',
                  borderRadius: '9999px',
                  background: isActive ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                  color: isActive ? '#ffffff' : 'var(--text-muted)'
                }}
              >
                {count}
              </span>
            </button>
          );
        })}

        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 0.2rem' }} />

        {/* 🚀 1. 신규 플로우 생성 버튼 */}
        {onOpenCreateFlow && (
          <button
            type="button"
            onClick={onOpenCreateFlow}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.3rem 0.7rem',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(99, 102, 241, 0.35)'
            }}
            title="새로운 대화 주제 플로우 생성 (루트 노드 연동 및 시작 노드 생성)"
          >
            <Plus size={13} />
            <span>+ 새 플로우 추가</span>
          </button>
        )}
      </div>

      {/* 2. 상단 우측: 캔버스 작업 툴바 (노드 추가, 무결성 배지, 최종 저장) */}
      <div
        className="canvas-filter-bar"
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          padding: '0.4rem 0.6rem',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)'
        }}
      >
        {/* 🚀 2. 신규 노드 추가 버튼 (질문 / 답변) */}
        {onCreateVisualNode && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onCreateVisualNode('question', activeFlow)}
              style={{
                padding: '0.3rem 0.55rem',
                fontSize: '0.76rem',
                fontWeight: 600,
                color: 'var(--primary)',
                background: 'rgba(37, 99, 235, 0.08)',
                border: '1px solid rgba(37, 99, 235, 0.25)',
                borderRadius: '6px'
              }}
              title="현재 플로우에 새 질문 노드 추가"
            >
              <Plus size={12} style={{ marginRight: '0.15rem' }} />
              <span>질문 노드</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onCreateVisualNode('terminal', activeFlow)}
              style={{
                padding: '0.3rem 0.55rem',
                fontSize: '0.76rem',
                fontWeight: 600,
                color: 'var(--emerald)',
                background: 'rgba(5, 150, 105, 0.08)',
                border: '1px solid rgba(5, 150, 105, 0.25)',
                borderRadius: '6px'
              }}
              title="현재 플로우에 새 최종 답변 노드 추가"
            >
              <Plus size={12} style={{ marginRight: '0.15rem' }} />
              <span>답변 노드</span>
            </button>
          </div>
        )}

        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />

        {/* 🚀 3. 실시간 무결성 검증 배지 및 상세 팝오버 */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowValidationPopover((p) => !p)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.3rem 0.6rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 700,
              background: validationResult.is_valid ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
              color: validationResult.is_valid ? 'var(--emerald)' : 'var(--rose)',
              border: validationResult.is_valid ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(244, 63, 94, 0.3)',
              cursor: 'pointer'
            }}
            title="실시간 트리 무결성 검증 상태 (클릭 시 세부 항목 확인)"
          >
            {validationResult.is_valid ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            <span>
              {validationResult.is_valid
                ? '무결성 정상'
                : `오류 ${validationResult.errors?.length || 0}건`}
            </span>
          </button>

          {/* 무결성 결과 팝오버 */}
          {showValidationPopover && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '8px',
                width: '320px',
                background: '#ffffff',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                padding: '0.8rem',
                zIndex: 60,
                fontSize: '0.78rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontWeight: 700 }}>
                <span>트리 무결성 진단 리포트</span>
                <button
                  type="button"
                  onClick={() => setShowValidationPopover(false)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px' }}
                >
                  ×
                </button>
              </div>

              {validationResult.is_valid ? (
                <div style={{ color: 'var(--emerald)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <CheckCircle2 size={16} />
                  <span>모든 노드와 선택지가 완벽하게 연결되어 있습니다!</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ color: 'var(--rose)', fontWeight: 600 }}>해결이 필요한 결함 ({validationResult.errors.length}건):</div>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#334155' }}>
                    {validationResult.errors.map((err, i) => (
                      <li key={i} style={{ marginBottom: '0.2rem' }}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validationResult.warnings && validationResult.warnings.length > 0 && (
                <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9', color: '#d97706' }}>
                  <div style={{ fontWeight: 600 }}>참고 사항:</div>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {validationResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 🚀 4. 저장 및 취소 버튼 (드래프트 변경사항 있을 때) */}
        {isDirty && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            {onResetDraft && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={onResetDraft}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}
                title="서버 원본으로 변경사항 취소"
              >
                취소
              </button>
            )}

            {onSaveTree && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={onSaveTree}
                disabled={savingTree}
                style={{
                  padding: '0.3rem 0.65rem',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  background: validationResult.is_valid
                    ? 'linear-gradient(135deg, #059669, #10b981)'
                    : 'linear-gradient(135deg, #64748b, #94a3b8)',
                  borderColor: 'transparent',
                  boxShadow: validationResult.is_valid ? '0 2px 8px rgba(16, 185, 129, 0.4)' : 'none'
                }}
                title={validationResult.is_valid ? '무결성 통과! 전체 트리 저장' : '무결성 오류를 먼저 해결해주세요.'}
              >
                {savingTree ? '저장 중…' : '💾 최종 저장'}
              </button>
            )}
          </div>
        )}

        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />

        {/* 검색 인풋 */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={13} style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="노드 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.28rem 1.4rem 0.28rem 1.6rem',
              fontSize: '0.76rem',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              outline: 'none',
              width: '120px',
              background: '#f8fafc'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: '6px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              <X size={12} />
            </button>
          )}

          {searchQuery && searchResults.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '6px',
                width: '260px',
                maxHeight: '220px',
                overflowY: 'auto',
                background: '#ffffff',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                boxShadow: '0 8px 20px rgba(0, 0, 0, 0.12)',
                zIndex: 50,
                padding: '0.3rem'
              }}
            >
              {searchResults.slice(0, 8).map((node) => {
                const nid = node.node_id || node.id;
                return (
                  <div
                    key={nid}
                    onClick={() => {
                      focusOnNode(nid);
                      setSearchQuery('');
                    }}
                    style={{
                      padding: '0.4rem 0.6rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.15rem',
                      borderBottom: '1px solid #f1f5f9'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{nid}</span>
                    <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.text || node.answer?.text || ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button
          className="canvas-control-btn btn btn-ghost btn-sm"
          onClick={() => setIsCompact((c) => !c)}
          title={isCompact ? '상세 정보 표시' : '간략히 표시'}
          style={{ padding: '0.3rem 0.45rem', fontSize: '0.76rem' }}
        >
          {isCompact ? <Eye size={12} /> : <EyeOff size={12} />}
          <span style={{ marginLeft: '0.2rem' }}>{isCompact ? '컴팩트' : '상세'}</span>
        </button>

        <button
          className="canvas-control-btn btn btn-ghost btn-sm"
          onClick={handleManualAutoLayout}
          title="부모-자식 서브트리 레이아웃으로 완벽 자동 재정렬"
          style={{ padding: '0.3rem 0.45rem', fontSize: '0.76rem', color: 'var(--primary)', fontWeight: 600 }}
        >
          <Sparkles size={12} style={{ marginRight: '0.2rem' }} />
          <span>정렬</span>
        </button>
      </div>

      {/* 2-1. 선 잇기(Port-to-Port Wiring) 활성화 플로팅 알림 배너 */}
      {connectingPort && (
        <div
          style={{
            position: 'absolute',
            top: '72px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.55rem 1.25rem',
            borderRadius: '9999px',
            background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
            color: '#ffffff',
            fontSize: '0.84rem',
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(37, 99, 235, 0.4)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.3)'
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🔗</span>
            <span>
              선택지 <strong>"{connectingPort.label}"</strong>를 연결할 <strong>대상 노드</strong>를 클릭하세요.
            </span>
          </span>
          <button
            type="button"
            onClick={() => setConnectingPort(null)}
            style={{
              background: 'rgba(255, 255, 255, 0.25)',
              border: 'none',
              borderRadius: '9999px',
              padding: '0.15rem 0.5rem',
              color: '#ffffff',
              fontSize: '0.74rem',
              cursor: 'pointer',
              fontWeight: 700
            }}
            title="연결 취소 (ESC)"
          >
            취소 (ESC)
          </button>
        </div>
      )}

      {/* 3. 플로팅 줌 컨트롤 바 */}
      <div
        className="canvas-controls"
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          padding: '0.4rem 0.6rem',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)'
        }}
      >
        <button className="canvas-control-btn btn btn-secondary btn-sm" onClick={handleZoomIn} title="확대">
          <ZoomIn size={14} />
        </button>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, minWidth: '42px', textAlign: 'center', color: 'var(--text-main)' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="canvas-control-btn btn btn-secondary btn-sm" onClick={handleZoomOut} title="축소">
          <ZoomOut size={14} />
        </button>
        <button className="canvas-control-btn btn btn-secondary btn-sm" onClick={handleZoomReset} title="100% 뷰">
          1:1
        </button>
        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 0.15rem' }} />
        <button
          className="canvas-control-btn btn btn-secondary btn-sm"
          onClick={() => focusOnNode(rootId || 'root')}
          title="루트 노드로 화면 이동"
        >
          <Compass size={14} style={{ marginRight: '0.2rem' }} />
          <span>루트 맞춤</span>
        </button>
      </div>

      {/* 4. 미니맵 네비게이터 */}
      <div
        className="scenario-minimap"
        style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          zIndex: 30,
          width: '170px',
          height: '110px',
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(8px)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
          overflow: 'hidden',
          padding: '4px',
          cursor: 'pointer'
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = (e.clientX - rect.left) / rect.width;
          const clickY = (e.clientY - rect.top) / rect.height;

          const totalWidth = bounds.maxX - bounds.minX || 1200;
          const totalHeight = bounds.maxY - bounds.minY || 800;

          const worldX = bounds.minX + clickX * totalWidth;
          const worldY = bounds.minY + clickY * totalHeight;

          const cW = containerRef.current?.clientWidth || 1000;
          const cH = containerRef.current?.clientHeight || 740;

          setAnimateWorld(true);
          setPan({
            x: Math.round(cW / 2 - worldX * zoom),
            y: Math.round(cH / 2 - worldY * zoom)
          });
          setTimeout(() => setAnimateWorld(false), 250);
        }}
      >
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {Object.entries(nodePositions).map(([nid, pos]) => {
            const totalW = bounds.maxX - bounds.minX || 1200;
            const totalH = bounds.maxY - bounds.minY || 800;
            const normX = ((pos.x - bounds.minX) / totalW) * 100;
            const normY = ((pos.y - bounds.minY) / totalH) * 100;
            const isSelected = nid === selectedNodeId;

            return (
              <div
                key={nid}
                style={{
                  position: 'absolute',
                  left: `${normX}%`,
                  top: `${normY}%`,
                  width: '6px',
                  height: '4px',
                  borderRadius: '1px',
                  background: isSelected ? 'var(--primary)' : '#94a3b8',
                  transform: 'translate(-50%, -50%)'
                }}
              />
            );
          })}
          {containerRef.current && (
            <div
              style={{
                position: 'absolute',
                left: `${Math.max(0, Math.min(100, ((-pan.x / zoom - bounds.minX) / (bounds.maxX - bounds.minX || 1200)) * 100))}%`,
                top: `${Math.max(0, Math.min(100, ((-pan.y / zoom - bounds.minY) / (bounds.maxY - bounds.minY || 800)) * 100))}%`,
                width: `${Math.min(100, ((containerRef.current.clientWidth / zoom) / (bounds.maxX - bounds.minX || 1200)) * 100)}%`,
                height: `${Math.min(100, ((containerRef.current.clientHeight / zoom) / (bounds.maxY - bounds.minY || 800)) * 100)}%`,
                border: '1.5px solid var(--primary)',
                background: 'rgba(37, 99, 235, 0.12)',
                borderRadius: '2px',
                pointerEvents: 'none'
              }}
            />
          )}
        </div>
      </div>

      {/* 5. 캔버스 본체 월드 레이어 */}
      <div
        className="canvas-world"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: animateWorld ? 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
          willChange: 'transform'
        }}
      >
        {/* SVG 커넥터 레이어 */}
        <svg
          style={{
            position: 'absolute',
            top: -3000,
            left: -3000,
            width: 16000,
            height: 16000,
            pointerEvents: 'none',
            overflow: 'visible'
          }}
        >
          <defs>
            <marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94a3b8" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#2563eb" />
            </marker>
            <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#2563eb" floodOpacity="0.5" />
            </filter>
          </defs>

          {visibleEdges.map((edge) => {
            const sourcePos = nodePositions[edge.sourceId];
            const targetPos = nodePositions[edge.targetId];
            if (!sourcePos || !targetPos) return null;
            if (typeof sourcePos.x !== 'number' || typeof targetPos.x !== 'number') return null;
            if (typeof sourcePos.y !== 'number' || typeof targetPos.y !== 'number') return null;

            // 순방향 트리만 허용: 타겟의 X 좌표가 소스의 X 좌표보다 작거나 같으면 렌더링하지 않음
            if (targetPos.x <= sourcePos.x) return null;

            const optionVerticalOffset = isCompact ? 75 : 85;
            const startX = sourcePos.x + NODE_WIDTH;
            const startY =
              sourcePos.y +
              optionVerticalOffset +
              (edge.optIndex * 24) -
              ((edge.totalOptions - 1) * 12);

            const endX = targetPos.x;
            const endY = targetPos.y + (isCompact ? 45 : 55);

            const deltaX = Math.abs(endX - startX) * 0.55;
            const cp1X = startX + Math.max(deltaX, 70);
            const cp1Y = startY;
            const cp2X = endX - Math.max(deltaX, 70);
            const cp2Y = endY;

            const pathD = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

            const isHighlighted = pathEdgeIds ? pathEdgeIds.has(edge.id) : false;
            const isDimmed = pathEdgeIds !== null && !isHighlighted;

            return (
              <g key={edge.id} opacity={isDimmed ? 0.15 : 1} style={{ transition: 'opacity 0.15s ease' }}>
                <path d={pathD} fill="none" stroke="transparent" strokeWidth="14" />
                <path
                  d={pathD}
                  fill="none"
                  stroke={isHighlighted ? '#2563eb' : '#94a3b8'}
                  strokeWidth={isHighlighted ? 2.8 : 1.8}
                  strokeDasharray={edge.label ? 'none' : '4,3'}
                  markerEnd={isHighlighted ? 'url(#arrow-active)' : 'url(#arrow-default)'}
                  filter={isHighlighted ? 'url(#edge-glow)' : 'none'}
                />
              </g>
            );
          })}

          {/* 선 잇기(Port-to-Port Wiring) 진행 중일 때 마우스 위치로 뻗는 고무줄 베지에 선 */}
          {connectingPort && (
            <g>
              {(() => {
                const startX = connectingPort.startX;
                const startY = connectingPort.startY;
                const endX = mouseWorldPos.x;
                const endY = mouseWorldPos.y;
                const deltaX = Math.abs(endX - startX) * 0.55;
                const cp1X = startX + Math.max(deltaX, 60);
                const cp1Y = startY;
                const cp2X = endX - Math.max(deltaX, 60);
                const cp2Y = endY;
                const pathD = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
                return (
                  <>
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="3.2"
                      strokeDasharray="6,4"
                      markerEnd="url(#arrow-active)"
                      filter="url(#edge-glow)"
                    />
                    <circle cx={endX} cy={endY} r="5" fill="#2563eb" />
                  </>
                );
              })()}
            </g>
          )}
        </svg>

        {/* 노드 카드 HTML 레이어 */}
        {Object.entries(nodePositions).map(([nid, pos]) => {
          const node = nodes[nid];
          if (!node) return null;

          const actualRootId = rootId || 'root';
          const isRoot = nid === actualRootId || nid === 'root';
          const isTerminal = node.type === 'terminal' || (!node.options || node.options.length === 0);
          const isSelected = nid === selectedNodeId;
          const isDragging = nid === draggingNodeId;
          const isCollapsed = collapsedNodes.has(nid);
          const hasChildren = (node.options || []).some((o) => {
            const target = o.next_node_id || o.next_node;
            return target && target !== actualRootId && target !== 'root';
          });

          const isHighlighted = pathNodeIds ? pathNodeIds.has(nid) : false;
          const isDimmed = pathNodeIds !== null && !isHighlighted;

          const flowKey = detectNodeFlow(nid, node);
          const theme = getFlowTheme(flowKey);
          const isConnectTargetCandidate = connectingPort && connectingPort.sourceId !== nid && !isRoot;

          return (
            <div
              key={nid}
              className="scenario-node-card"
              onMouseDown={(e) => handleNodeMouseDown(e, nid)}
              onClick={(e) => {
                if (isConnectTargetCandidate) {
                  handleTargetNodeClick(e, nid);
                }
              }}
              onMouseEnter={() => setHoveredNodeId(nid)}
              onMouseLeave={() => setHoveredNodeId(null)}
              style={{
                position: 'absolute',
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${NODE_WIDTH}px`,
                background: isConnectTargetCandidate ? '#f0f7ff' : '#ffffff',
                borderRadius: '14px',
                border: isConnectTargetCandidate
                  ? '2px dashed #2563eb'
                  : isSelected
                  ? '2px solid #2563eb'
                  : isHighlighted
                  ? `2px solid ${theme.color}`
                  : `1px solid ${theme.border}`,
                boxShadow: isConnectTargetCandidate
                  ? '0 0 20px rgba(37, 99, 235, 0.35)'
                  : isDragging
                  ? '0 16px 36px rgba(0, 0, 0, 0.18)'
                  : isSelected
                  ? '0 10px 28px rgba(37, 99, 235, 0.28), 0 0 0 3px rgba(37, 99, 235, 0.15)'
                  : isHighlighted
                  ? `0 8px 24px ${theme.color}33`
                  : '0 3px 10px rgba(0, 0, 0, 0.05)',
                cursor: isConnectTargetCandidate ? 'pointer' : isDragging ? 'grabbing' : 'grab',
                opacity: isDimmed ? 0.22 : 1,
                transform: 'none',
                transition: isDragging ? 'none' : 'box-shadow 0.15s, border-color 0.15s, opacity 0.15s, background 0.15s',
                zIndex: isDragging ? 50 : isSelected ? 20 : isHighlighted ? 15 : 10,
                willChange: isDragging ? 'left, top' : 'auto'
              }}
            >
              {/* 타겟 입력 포트 점 (좌측) */}
              {!isRoot && (
                <div
                  onClick={(e) => {
                    if (isConnectTargetCandidate) {
                      handleTargetNodeClick(e, nid);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    left: isConnectTargetCandidate ? '-8px' : '-6px',
                    top: isCompact ? (isConnectTargetCandidate ? '40px' : '42px') : (isConnectTargetCandidate ? '50px' : '52px'),
                    width: isConnectTargetCandidate ? '16px' : '12px',
                    height: isConnectTargetCandidate ? '16px' : '12px',
                    borderRadius: '50%',
                    background: isConnectTargetCandidate ? '#2563eb' : isHighlighted ? '#2563eb' : theme.color,
                    border: '2px solid #ffffff',
                    boxShadow: isConnectTargetCandidate ? '0 0 12px #2563eb' : '0 1px 4px rgba(0,0,0,0.2)',
                    zIndex: 35,
                    cursor: isConnectTargetCandidate ? 'pointer' : 'default',
                    transition: 'all 0.15s ease'
                  }}
                  title={isConnectTargetCandidate ? '클릭하여 이 노드로 선 연결' : '자식 노드 진입점'}
                />
              )}

              {/* 카드 상단 헤더 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.55rem 0.8rem',
                  borderTopLeftRadius: '13px',
                  borderTopRightRadius: '13px',
                  background: isRoot
                    ? 'linear-gradient(135deg, #1e40af, #2563eb)'
                    : isTerminal
                    ? 'linear-gradient(135deg, #065f46, #059669)'
                    : theme.bg,
                  color: isRoot || isTerminal ? '#ffffff' : theme.color,
                  borderBottom: `1px solid ${isRoot || isTerminal ? 'transparent' : theme.border}`,
                  cursor: isDragging ? 'grabbing' : 'grab'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden' }}>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '0.12rem 0.45rem',
                      borderRadius: '4px',
                      background: isRoot || isTerminal ? 'rgba(255, 255, 255, 0.22)' : '#ffffff',
                      color: isRoot || isTerminal ? '#ffffff' : theme.color,
                      border: isRoot || isTerminal ? 'none' : `1px solid ${theme.border}`,
                      flexShrink: 0
                    }}
                  >
                    {isRoot ? 'START' : isTerminal ? 'FINAL' : theme.badge}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={nid}
                  >
                    {nid}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={(e) => handleToggleCollapse(e, nid)}
                      title={isCollapsed ? '하위 노드 펼치기' : '하위 노드 접기'}
                      style={{
                        background: 'rgba(255, 255, 255, 0.4)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.15rem 0.3rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        color: isRoot || isTerminal ? '#ffffff' : theme.color
                      }}
                    >
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditNode(node);
                    }}
                    title="노드 편집"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: isRoot || isTerminal ? '#ffffff' : 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '0.15rem 0.25rem'
                    }}
                  >
                    <Edit2 size={12} />
                  </button>
                  {!isRoot && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNode(nid);
                      }}
                      title="노드 삭제"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: isRoot || isTerminal ? '#fecaca' : 'var(--rose)',
                        cursor: 'pointer',
                        padding: '0.15rem 0.25rem'
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* 카드 본문 */}
              <div style={{ padding: '0.75rem 0.85rem' }}>
                <div
                  style={{
                    fontSize: '0.86rem',
                    fontWeight: 600,
                    lineHeight: 1.4,
                    color: '#1e293b',
                    display: '-webkit-box',
                    WebkitLineClamp: isCompact ? 2 : 5,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    marginBottom: isTerminal ? '0.4rem' : '0.6rem'
                  }}
                  title={node.text || node.answer?.text}
                >
                  {node.text || node.answer?.text || '(내용 없음)'}
                </div>

                {/* 최종 답변 안내 */}
                {isTerminal && node.answer?.text && (
                  <div
                    style={{
                      fontSize: '0.75rem',
                      lineHeight: 1.35,
                      color: '#065f46',
                      background: '#ecfdf5',
                      padding: '0.4rem 0.6rem',
                      borderRadius: '8px',
                      border: '1px solid #a7f3d0'
                    }}
                  >
                    <span style={{ fontWeight: 700, marginRight: '0.3rem' }}>✓ 안내:</span>
                    <span
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: isCompact ? 2 : 4,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}
                    >
                      {node.answer.text}
                    </span>
                  </div>
                )}

                {/* 선택지 분기 버튼 목록 */}
                {node.options && node.options.length > 0 && !isCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.4rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                        선택 분기 ({node.options.length}개):
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateChildNode(nid);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--primary)',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.15rem'
                        }}
                      >
                        <Plus size={11} />
                        하위 추가
                      </button>
                    </div>

                    {node.options.map((opt, optIndex) => {
                      const nextId = opt.next_node_id || opt.next_node;
                      const hasNext = Boolean(nextId && nodes[nextId]);
                      const isReturnToRoot = nextId === rootId;

                      return (
                        <div
                          key={optIndex}
                          className="option-link-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasNext) focusOnNode(nextId);
                          }}
                          style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.32rem 0.55rem',
                            borderRadius: '6px',
                            background: isReturnToRoot ? '#f8fafc' : hasNext ? '#f1f5f9' : '#fff1f2',
                            border: `1px solid ${isReturnToRoot ? '#cbd5e1' : hasNext ? '#e2e8f0' : '#fecdd3'}`,
                            fontSize: '0.76rem',
                            color: isReturnToRoot ? 'var(--text-muted)' : hasNext ? 'var(--text-main)' : 'var(--rose)',
                            cursor: hasNext ? 'pointer' : 'default',
                            transition: 'background 0.15s ease, border-color 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (hasNext) {
                              e.currentTarget.style.background = '#e2e8f0';
                              e.currentTarget.style.borderColor = 'var(--primary)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (hasNext) {
                              e.currentTarget.style.background = isReturnToRoot ? '#f8fafc' : '#f1f5f9';
                              e.currentTarget.style.borderColor = isReturnToRoot ? '#cbd5e1' : '#e2e8f0';
                            }
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '180px',
                              fontWeight: 500
                            }}
                            title={opt.label}
                          >
                            {opt.label || `옵션 ${optIndex + 1}`}
                          </span>

                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.2rem',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                color: isReturnToRoot ? 'var(--text-muted)' : hasNext ? 'var(--primary)' : 'var(--rose)'
                              }}
                            >
                              {isReturnToRoot ? (
                                '↩ 처음으로'
                              ) : hasNext ? (
                                <>
                                  <ArrowRight size={10} />
                                  {nextId.split('.').pop()}
                                </>
                              ) : (
                                '미연결'
                              )}
                            </span>

                            {/* 연결 해제 (Disconnect) 버튼 */}
                            {hasNext && !isReturnToRoot && onDisconnectOption && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDisconnectOption(nid, optIndex);
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  padding: '0 2px',
                                  fontSize: '11px',
                                  lineHeight: 1,
                                  borderRadius: '3px'
                                }}
                                title="연결 해제"
                                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--rose)')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                              >
                                ×
                              </button>
                            )}
                          </div>

                          {/* 출발 포트 (선 잇기 Port 버튼) */}
                          {!isReturnToRoot && (
                            <button
                              type="button"
                              onClick={(e) => handleStartConnect(e, nid, optIndex, opt.label)}
                              style={{
                                position: 'absolute',
                                right: '-8px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                background: connectingPort?.sourceId === nid && connectingPort?.optionIndex === optIndex
                                  ? '#ef4444'
                                  : hasNext
                                  ? '#3b82f6'
                                  : '#f59e0b',
                                border: '2px solid #ffffff',
                                boxShadow: connectingPort?.sourceId === nid && connectingPort?.optionIndex === optIndex
                                  ? '0 0 10px #ef4444'
                                  : '0 1px 4px rgba(0,0,0,0.25)',
                                zIndex: 30,
                                cursor: 'crosshair',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                              title={hasNext ? '다른 대상 노드로 선 다시 잇기 (클릭)' : '다음 대상 노드와 선 연결 (클릭)'}
                            >
                              <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ffffff' }} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isCollapsed && (
                  <div
                    onClick={(e) => handleToggleCollapse(e, nid)}
                    style={{
                      marginTop: '0.4rem',
                      padding: '0.3rem 0.5rem',
                      borderRadius: '6px',
                      background: '#f1f5f9',
                      fontSize: '0.72rem',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    + 하위 {node.options?.length || 0}개 분기 접힘 (클릭하여 펼치기)
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
