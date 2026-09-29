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

/**
 * 노드 ID 또는 속성으로 소속 플로우 감지
 */
function detectNodeFlow(nodeId = '') {
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
  return 'default';
}

/**
 * 부모 중심 서브트리 자동 레이아웃 알고리즘
 * 1. 루트부터 트리 구조 그래프 구축
 * 2. 리프 노드를 순서대로 세로 배치하고, 부모 노드는 자식 노드들의 Y 중앙값에 배치
 * 3. 선 교차(Cross)를 원천 차단하여 수평으로 미려하게 뻗는 트리 형성
 */
function computeSubtreeLayout(nodes, rootId, activeFlow = 'ALL', collapsedSet = new Set()) {
  if (!nodes || Object.keys(nodes).length === 0) return {};

  const actualRoot = rootId && nodes[rootId] ? rootId : Object.keys(nodes)[0];

  // 1. 활성 플로우에 포함될 노드 식별
  const targetNodeIds = new Set();
  if (activeFlow === 'ALL') {
    Object.keys(nodes).forEach((id) => targetNodeIds.add(id));
  } else {
    targetNodeIds.add(actualRoot);
    Object.keys(nodes).forEach((id) => {
      if (detectNodeFlow(id) === activeFlow) {
        targetNodeIds.add(id);
      }
    });
  }

  // 2. 인접 리스트 (부모 -> 자식) 구축 (단, collapsed 노드의 자식은 생략)
  const childrenMap = {};
  const parentMap = {};
  for (const nid of targetNodeIds) {
    childrenMap[nid] = [];
  }

  for (const nid of targetNodeIds) {
    if (collapsedSet.has(nid)) continue; // 접힌 노드는 하위 전개 제외
    const node = nodes[nid];
    if (!node) continue;
    const options = node.options || [];
    for (const opt of options) {
      const nextId = opt.next_node_id || opt.next_node;
      if (nextId && targetNodeIds.has(nextId) && nextId !== nid) {
        if (!childrenMap[nid].includes(nextId)) {
          childrenMap[nid].push(nextId);
        }
        parentMap[nextId] = nid;
      }
    }
  }

  // 3. 서브트리별 리프 노드 누적 Y 계산 (DFS 기반 배치)
  const positions = {};
  let currentY = 60;
  const startX = 60;

  // depth 계산
  const depths = {};
  function calcDepths(currId, currDepth) {
    depths[currId] = Math.max(depths[currId] || 0, currDepth);
    const children = childrenMap[currId] || [];
    for (const childId of children) {
      calcDepths(childId, currDepth + 1);
    }
  }
  calcDepths(actualRoot, 0);

  // 미방문 고립 노드 깊이 부여
  for (const nid of targetNodeIds) {
    if (depths[nid] === undefined) depths[nid] = 1;
  }

  // DFS로 리프 노드부터 Y 배치 및 부모 중앙 정렬
  const visited = new Set();
  function layoutDfs(currId) {
    visited.add(currId);
    const children = (childrenMap[currId] || []).filter((cid) => !visited.has(cid));

    if (children.length === 0) {
      // 리프 노드: 새로운 세로 줄에 단독 배치
      const y = currentY;
      currentY += NODE_APPROX_HEIGHT + VERTICAL_GAP;
      positions[currId] = {
        x: startX + depths[currId] * (NODE_WIDTH + HORIZONTAL_GAP),
        y
      };
      return y;
    }

    // 자식 노드들 먼저 재귀 레이아웃
    const childYs = [];
    for (const childId of children) {
      const cy = layoutDfs(childId);
      childYs.push(cy);
    }

    // 부모 노드의 Y는 자식들의 평균(중앙)
    const minY = Math.min(...childYs);
    const maxY = Math.max(...childYs);
    const midY = Math.round((minY + maxY) / 2);

    positions[currId] = {
      x: startX + depths[currId] * (NODE_WIDTH + HORIZONTAL_GAP),
      y: midY
    };

    return midY;
  }

  layoutDfs(actualRoot);

  // 고립된 노드들 추가 배치
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
  onCreateChildNode
}) {
  const containerRef = useRef(null);

  // 1. 활성 플로우 필터 (ALL | internet_down | internet_slow | my_pc | wifi | tablet_nms)
  const [activeFlow, setActiveFlow] = useState('ALL');

  // 2. 접기/펼치기 상태 Set (collapsedNodeIds)
  const [collapsedNodes, setCollapsedNodes] = useState(new Set());

  // 3. 카드 상세 모드 토글 (compact vs detailed)
  const [isCompact, setIsCompact] = useState(true);

  // 4. 검색어 필터
  const [searchQuery, setSearchQuery] = useState('');

  // 5. 캔버스 Pan & Zoom 상태
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 70, y: 50 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, initialPanX: 0, initialPanY: 0 });

  // 6. 노드 드래그 상태
  const [nodePositions, setNodePositions] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  // 7. 호버 중인 노드
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  // 자동 레이아웃 재계산
  const triggerAutoLayout = useCallback(
    (flow = activeFlow, collapsed = collapsedNodes) => {
      const calculated = computeSubtreeLayout(nodes, rootId, flow, collapsed);
      setNodePositions(calculated);
      setZoom(flow === 'ALL' ? 0.75 : 0.95);
      setPan({ x: 80, y: 60 });
    },
    [nodes, rootId, activeFlow, collapsedNodes]
  );

  // 초기 로드 또는 플로우 변경 시 자동 정렬
  useEffect(() => {
    if (!nodes || Object.keys(nodes).length === 0) return;
    triggerAutoLayout(activeFlow, collapsedNodes);
  }, [nodes, rootId, activeFlow, triggerAutoLayout]);

  // 플로우 변경 핸들러
  const handleSelectFlow = (flowKey) => {
    setActiveFlow(flowKey);
    triggerAutoLayout(flowKey, collapsedNodes);
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
      triggerAutoLayout(activeFlow, next);
      return next;
    });
  };

  // 특정 노드로 스무스 포커스 이동
  const focusOnNode = useCallback(
    (targetId) => {
      const pos = nodePositions[targetId];
      if (!pos || !containerRef.current) return;
      onSelectNode(targetId);

      const containerWidth = containerRef.current.clientWidth || 1000;
      const containerHeight = containerRef.current.clientHeight || 740;

      const targetX = Math.round(containerWidth / 2 - (pos.x + NODE_WIDTH / 2) * zoom);
      const targetY = Math.round(containerHeight / 2 - (pos.y + 80) * zoom);

      setPan({ x: targetX, y: targetY });
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

  // 경로 포커스 하이라이트 계산: 선택되거나 호버된 노드와 연결된 직계 부모, 자식 경로
  const activeFocusId = selectedNodeId || hoveredNodeId;
  const { pathNodeIds, pathEdgeIds } = useMemo(() => {
    if (!activeFocusId || !nodes) {
      return { pathNodeIds: null, pathEdgeIds: null };
    }

    const pNodes = new Set([activeFocusId]);
    const pEdges = new Set();

    // 1. 자식 및 출구 엣지 추적
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

    // 2. 부모 및 입구 엣지 추적
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

  // 엣지(연결선) 계산
  const visibleEdges = useMemo(() => {
    if (!nodes) return [];
    const list = [];

    for (const [sourceId, node] of Object.entries(nodes)) {
      if (!nodePositions[sourceId]) continue;
      if (collapsedNodes.has(sourceId)) continue; // 접힌 부모의 선은 숨김

      const options = node.options || [];
      options.forEach((opt, optIndex) => {
        const targetId = opt.next_node_id || opt.next_node;
        if (targetId && nodes[targetId] && nodePositions[targetId]) {
          list.push({
            id: `${sourceId}-${optIndex}->${targetId}`,
            sourceId,
            targetId,
            label: opt.label || '',
            optIndex,
            totalOptions: options.length
          });
        }
      });
    }
    return list;
  }, [nodes, nodePositions, collapsedNodes]);

  // 줌 인/아웃 핸들러
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.35, Number((z - 0.15).toFixed(2))));
  const handleZoomReset = () => {
    setZoom(1.0);
    setPan({ x: 80, y: 60 });
  };

  // 휠 이벤트 (줌 인/아웃)
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setZoom((z) => Math.min(2.2, Math.max(0.3, Number((z + delta).toFixed(2)))));
  };

  // 캔버스 패닝 시작
  const handleCanvasMouseDown = (e) => {
    if (
      e.target.closest('.scenario-node-card') ||
      e.target.closest('.canvas-control-btn') ||
      e.target.closest('.canvas-filter-bar') ||
      e.target.closest('.scenario-minimap')
    ) {
      return;
    }
    onSelectNode(null); // 빈 캔버스 클릭 시 선택 해제
    setIsPanning(true);
    panStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialPanX: pan.x,
      initialPanY: pan.y
    };
  };

  // 노드 드래그 시작
  const handleNodeMouseDown = (e, nid) => {
    e.stopPropagation();
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

  // 마우스 이동 (패닝 or 노드 드래그)
  const handleMouseMove = (e) => {
    if (draggingNodeId) {
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
  };

  // 마우스 업
  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  // 미니맵 좌표 계산을 위한 전체 바운딩 박스
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
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
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
        cursor: isPanning ? 'grabbing' : 'grab',
        userSelect: 'none',
        boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.02)'
      }}
    >
      {/* 1. 상단 플로우 필터 탭 바 (주제별 서브트리 집중 모드) */}
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
          maxWidth: 'calc(100% - 320px)',
          overflowX: 'auto'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', paddingRight: '0.4rem', borderRight: '1px solid var(--border-color)' }}>
          <Filter size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            플로우 필터:
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
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap'
          }}
        >
          전체 시나리오 ({Object.keys(nodes || {}).length})
        </button>

        {Object.entries(FLOW_THEMES).filter(([k]) => k !== 'default').map(([key, theme]) => {
          const isActive = activeFlow === key;
          const count = Object.keys(nodes || {}).filter((nid) => detectNodeFlow(nid) === key).length;
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
                transition: 'all 0.15s ease',
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
      </div>

      {/* 2. 상단 우측 퀵 검색 및 뷰 옵션 */}
      <div
        className="canvas-filter-bar"
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          padding: '0.4rem 0.6rem',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)'
        }}
      >
        {/* 노드 검색 입력창 */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={13} style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="노드·질문 빠른 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.3rem 1.6rem 0.3rem 1.8rem',
              fontSize: '0.78rem',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              outline: 'none',
              width: '160px',
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

          {/* 검색 결과 드롭다운 */}
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

        {/* 컴팩트 뷰 토글 */}
        <button
          className="canvas-control-btn btn btn-ghost btn-sm"
          onClick={() => setIsCompact((c) => !c)}
          title={isCompact ? '상세 정보 표시' : '간략히 표시'}
          style={{ padding: '0.35rem 0.55rem', fontSize: '0.78rem' }}
        >
          {isCompact ? <Eye size={13} /> : <EyeOff size={13} />}
          <span style={{ marginLeft: '0.25rem' }}>{isCompact ? '컴팩트' : '상세'}</span>
        </button>

        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />

        {/* 자동 정렬 버튼 */}
        <button
          className="canvas-control-btn btn btn-ghost btn-sm"
          onClick={() => triggerAutoLayout(activeFlow, collapsedNodes)}
          title="부모-자식 서브트리 레이아웃으로 완벽 자동 재정렬"
          style={{ padding: '0.35rem 0.55rem', fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600 }}
        >
          <Sparkles size={13} style={{ marginRight: '0.25rem' }} />
          <span>트리 자동정렬</span>
        </button>
      </div>

      {/* 3. 플로팅 줌 컨트롤 바 (하단 좌측) */}
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

      {/* 4. 미니맵 (하단 우측 네비게이터) */}
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

          setPan({
            x: Math.round(cW / 2 - worldX * zoom),
            y: Math.round(cH / 2 - worldY * zoom)
          });
        }}
      >
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {/* 미니맵 안의 축소 노드들 */}
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
          {/* 미니맵 뷰포트 사각형 인디케이터 */}
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

      {/* 5. 캔버스 본체: SVG 엣지 커넥터 레이어 + 노드 HTML 레이어 */}
      <div
        className="canvas-world"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isPanning || draggingNodeId ? 'none' : 'transform 0.08s ease-out'
        }}
      >
        {/* SVG 커넥터 레이어 */}
        <svg
          style={{
            position: 'absolute',
            top: -2000,
            left: -2000,
            width: 14000,
            height: 14000,
            pointerEvents: 'none',
            overflow: 'visible'
          }}
        >
          <defs>
            {/* 일반 화살표 마커 */}
            <marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94a3b8" />
            </marker>
            {/* 하이라이트 화살표 마커 */}
            <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#2563eb" />
            </marker>
            {/* 네온 글로우 필터 */}
            <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#2563eb" floodOpacity="0.5" />
            </filter>
          </defs>

          {visibleEdges.map((edge) => {
            const sourcePos = nodePositions[edge.sourceId];
            const targetPos = nodePositions[edge.targetId];
            if (!sourcePos || !targetPos) return null;

            // 출발점: 소스 노드 카드의 우측 중앙 (옵션 분기 위치)
            const optionVerticalOffset = isCompact ? 75 : 85;
            const startX = sourcePos.x + NODE_WIDTH;
            const startY =
              sourcePos.y +
              optionVerticalOffset +
              (edge.optIndex * 24) -
              ((edge.totalOptions - 1) * 12);

            // 도착점: 타겟 노드 카드의 좌측 중앙 포트
            const endX = targetPos.x;
            const endY = targetPos.y + (isCompact ? 45 : 55);

            // 3차 베지에(Cubic Bezier) 곡선 제어점 계산
            const deltaX = Math.abs(endX - startX) * 0.55;
            const cp1X = startX + Math.max(deltaX, 70);
            const cp1Y = startY;
            const cp2X = endX - Math.max(deltaX, 70);
            const cp2Y = endY;

            const pathD = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

            // 경로 포커스 하이라이트 여부
            const isHighlighted = pathEdgeIds ? pathEdgeIds.has(edge.id) : false;
            const isDimmed = pathEdgeIds !== null && !isHighlighted;

            return (
              <g key={edge.id} opacity={isDimmed ? 0.15 : 1} style={{ transition: 'opacity 0.2s ease' }}>
                {/* 외곽 보조 클릭/호버 감지용 투명 굵은 패스 */}
                <path d={pathD} fill="none" stroke="transparent" strokeWidth="14" />
                {/* 메인 커넥터 선 */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={isHighlighted ? '#2563eb' : '#94a3b8'}
                  strokeWidth={isHighlighted ? 3 : 1.8}
                  strokeDasharray={edge.label ? 'none' : '4,3'}
                  markerEnd={isHighlighted ? 'url(#arrow-active)' : 'url(#arrow-default)'}
                  filter={isHighlighted ? 'url(#edge-glow)' : 'none'}
                />
              </g>
            );
          })}
        </svg>

        {/* 노드 카드 HTML 레이어 */}
        {Object.entries(nodePositions).map(([nid, pos]) => {
          const node = nodes[nid];
          if (!node) return null;

          const isRoot = nid === rootId;
          const isTerminal = node.type === 'terminal' || (!node.options || node.options.length === 0);
          const isSelected = nid === selectedNodeId;
          const isDragging = nid === draggingNodeId;
          const isCollapsed = collapsedNodes.has(nid);
          const hasChildren = (node.options || []).some((o) => o.next_node_id || o.next_node);

          // 경로 포커스 여부
          const isHighlighted = pathNodeIds ? pathNodeIds.has(nid) : false;
          const isDimmed = pathNodeIds !== null && !isHighlighted;

          // 노드 플로우 테마
          const flowKey = detectNodeFlow(nid);
          const theme = FLOW_THEMES[flowKey] || FLOW_THEMES.default;

          return (
            <div
              key={nid}
              className="scenario-node-card"
              onMouseDown={(e) => handleNodeMouseDown(e, nid)}
              onMouseEnter={() => setHoveredNodeId(nid)}
              onMouseLeave={() => setHoveredNodeId(null)}
              style={{
                position: 'absolute',
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${NODE_WIDTH}px`,
                background: '#ffffff',
                borderRadius: '14px',
                border: isSelected
                  ? '2px solid #2563eb'
                  : isHighlighted
                  ? `2px solid ${theme.color}`
                  : `1px solid ${theme.border}`,
                boxShadow: isSelected
                  ? '0 10px 28px rgba(37, 99, 235, 0.28), 0 0 0 3px rgba(37, 99, 235, 0.15)'
                  : isHighlighted
                  ? `0 8px 24px ${theme.color}33`
                  : '0 3px 10px rgba(0, 0, 0, 0.05)',
                cursor: isDragging ? 'grabbing' : 'grab',
                opacity: isDimmed ? 0.22 : 1,
                transform: isDragging ? 'scale(1.02)' : isSelected ? 'scale(1.01)' : 'scale(1)',
                transition: isDragging ? 'none' : 'box-shadow 0.2s, border-color 0.2s, opacity 0.25s, transform 0.15s',
                zIndex: isSelected ? 20 : isHighlighted ? 15 : 10
              }}
            >
              {/* 타겟 입력 포트 점 (좌측) */}
              {!isRoot && (
                <div
                  style={{
                    position: 'absolute',
                    left: '-6px',
                    top: isCompact ? '42px' : '52px',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: isHighlighted ? '#2563eb' : theme.color,
                    border: '2px solid #ffffff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                    zIndex: 25
                  }}
                  title="자식 노드 진입점"
                />
              )}

              {/* 카드 상단 헤더 띠 */}
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
                  borderBottom: `1px solid ${isRoot || isTerminal ? 'transparent' : theme.border}`
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

                {/* 액션 버튼 그룹 (수정, 자식추가, 접기토글) */}
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

              {/* 카드 본문: 질문/답변 텍스트 */}
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

                {/* 최종 답변 노드 안내 요약 */}
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

                {/* 선택지 분기 버튼 목록 (우측 포트 제공) */}
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
                            background: hasNext ? '#f1f5f9' : '#fff1f2',
                            border: `1px solid ${hasNext ? '#e2e8f0' : '#fecdd3'}`,
                            fontSize: '0.76rem',
                            color: hasNext ? 'var(--text-main)' : 'var(--rose)',
                            cursor: hasNext ? 'pointer' : 'default',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (hasNext) {
                              e.currentTarget.style.background = '#e2e8f0';
                              e.currentTarget.style.borderColor = 'var(--primary)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (hasNext) {
                              e.currentTarget.style.background = '#f1f5f9';
                              e.currentTarget.style.borderColor = '#e2e8f0';
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

                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              color: hasNext ? 'var(--primary)' : 'var(--rose)'
                            }}
                          >
                            {hasNext ? (
                              <>
                                <ArrowRight size={10} />
                                {nextId.split('.').pop()}
                              </>
                            ) : (
                              '미연결'
                            )}
                          </span>

                          {/* 옵션 분기 우측 포트 점 */}
                          {hasNext && (
                            <div
                              style={{
                                position: 'absolute',
                                right: '-7px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                background: '#3b82f6',
                                border: '2px solid #ffffff',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                zIndex: 25
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 하위 접힘 상태 안내 */}
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
