import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Move, Plus, Edit2, Trash2, ArrowRight, CheckCircle2, HelpCircle
} from 'lucide-react';

const NODE_WIDTH = 280;
const NODE_APPROX_HEIGHT = 180;
const HORIZONTAL_GAP = 120;
const VERTICAL_GAP = 60;

/**
 * 계층형 트리 자동 레이아웃 알고리즘
 * root 노드부터 BFS로 depth를 부여하고 겹치지 않도록 Y 좌표를 계산
 */
function computeHierarchyLayout(nodes, rootId) {
  if (!nodes || Object.keys(nodes).length === 0) return {};

  const positions = {};
  const actualRoot = rootId && nodes[rootId] ? rootId : Object.keys(nodes)[0];

  // 1. BFS로 레벨(depth) 부여
  const levels = {};
  const queue = [{ id: actualRoot, depth: 0 }];
  const visited = new Set([actualRoot]);
  levels[actualRoot] = 0;

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    const node = nodes[id];
    if (!node) continue;

    const options = node.options || [];
    for (const opt of options) {
      const nextId = opt.next_node_id || opt.next_node;
      if (nextId && nodes[nextId] && !visited.has(nextId)) {
        visited.add(nextId);
        levels[nextId] = depth + 1;
        queue.push({ id: nextId, depth: depth + 1 });
      }
    }
  }

  // 방문하지 않은 고립 노드는 마지막 레벨 + 1에 배치
  let maxDepth = Math.max(0, ...Object.values(levels));
  for (const nid of Object.keys(nodes)) {
    if (levels[nid] === undefined) {
      maxDepth += 1;
      levels[nid] = maxDepth;
    }
  }

  // 2. 레벨별 노드 그룹화
  const nodesByLevel = {};
  for (const [nid, depth] of Object.entries(levels)) {
    if (!nodesByLevel[depth]) nodesByLevel[depth] = [];
    nodesByLevel[depth].push(nid);
  }

  // 3. X, Y 좌표 계산
  const startX = 60;
  const startY = 80;

  for (const [depthStr, nodeIds] of Object.entries(nodesByLevel)) {
    const depth = parseInt(depthStr, 10);
    const x = startX + depth * (NODE_WIDTH + HORIZONTAL_GAP);
    const totalHeight = nodeIds.length * (NODE_APPROX_HEIGHT + VERTICAL_GAP);
    const currentStartY = startY;

    nodeIds.forEach((nid, idx) => {
      const y = currentStartY + idx * (NODE_APPROX_HEIGHT + VERTICAL_GAP);
      positions[nid] = { x, y };
    });
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

  // 캔버스 Pan & Zoom 상태
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 80, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, initialPanX: 0, initialPanY: 0 });

  // 노드 드래그 상태
  const [nodePositions, setNodePositions] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  // 초기 자동 레이아웃 계산 (노드 목록 변경 시 또는 첫 로드)
  useEffect(() => {
    if (!nodes || Object.keys(nodes).length === 0) return;
    setNodePositions((prev) => {
      // 이미 위치가 저장된 노드는 유지하고, 신규 노드만 자동 배치
      const initial = computeHierarchyLayout(nodes, rootId);
      const merged = { ...initial };
      for (const [k, pos] of Object.entries(prev)) {
        if (nodes[k]) {
          merged[k] = pos;
        }
      }
      return merged;
    });
  }, [nodes, rootId]);

  // 자동 정렬 함수
  const handleAutoLayout = useCallback(() => {
    const newPositions = computeHierarchyLayout(nodes, rootId);
    setNodePositions(newPositions);
    setZoom(0.85);
    setPan({ x: 80, y: 60 });
  }, [nodes, rootId]);

  // 화면 중앙 루트로 이동
  const handleResetFocus = useCallback(() => {
    setZoom(0.85);
    setPan({ x: 80, y: 60 });
  }, []);

  // 줌 인/아웃 핸들러
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))));
  const handleZoomReset = () => setZoom(1.0);

  // 휠 이벤트 (줌 인/아웃)
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setZoom((z) => Math.min(2.2, Math.max(0.35, Number((z + delta).toFixed(2)))));
  };

  // 캔버스 패닝 시작
  const handleCanvasMouseDown = (e) => {
    // 노드나 버튼 클릭 시에는 패닝 시작 안 함
    if (e.target.closest('.scenario-node-card') || e.target.closest('.canvas-control-btn')) {
      return;
    }
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
    // 수정, 삭제, 옵션 클릭 시에는 드래그 시작 안 함
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
      // 줌 배율을 감안하여 실제 이동 거리 환산
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

  // 마우스 업 (이동 종료)
  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  // 엣지(연결선) 목록 계산
  const edges = useMemo(() => {
    if (!nodes) return [];
    const list = [];

    for (const [sourceId, node] of Object.entries(nodes)) {
      const options = node.options || [];
      options.forEach((opt, optIndex) => {
        const targetId = opt.next_node_id || opt.next_node;
        if (targetId && nodes[targetId]) {
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
  }, [nodes]);

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
        height: '740px',
        overflow: 'hidden',
        background: '#f8fafc',
        backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
        backgroundSize: '24px 24px',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        cursor: isPanning ? 'grabbing' : 'grab',
        userSelect: 'none'
      }}
    >
      {/* 플로팅 컨트롤 바 (줌, 자동정렬, 화면 맞춤) */}
      <div
        className="canvas-controls"
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          padding: '0.4rem 0.6rem',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)'
        }}
      >
        <button
          className="canvas-control-btn btn btn-secondary btn-sm"
          onClick={handleZoomIn}
          title="확대 (줌 인)"
          style={{ padding: '0.35rem 0.5rem' }}
        >
          <ZoomIn size={14} />
        </button>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, minWidth: '42px', textAlign: 'center', color: 'var(--text-main)' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="canvas-control-btn btn btn-secondary btn-sm"
          onClick={handleZoomOut}
          title="축소 (줌 아웃)"
          style={{ padding: '0.35rem 0.5rem' }}
        >
          <ZoomOut size={14} />
        </button>
        <button
          className="canvas-control-btn btn btn-secondary btn-sm"
          onClick={handleZoomReset}
          title="100% 원본 비율"
          style={{ padding: '0.35rem 0.5rem' }}
        >
          1:1
        </button>
        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 0.2rem' }} />
        <button
          className="canvas-control-btn btn btn-secondary btn-sm"
          onClick={handleResetFocus}
          title="루트 노드로 화면 중심 맞춤"
          style={{ padding: '0.35rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          <Maximize2 size={13} />
          <span>중앙</span>
        </button>
        <button
          className="canvas-control-btn btn btn-primary btn-sm"
          onClick={handleAutoLayout}
          title="계층형 트리 자동 정렬"
          style={{ padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          <RotateCcw size={13} />
          <span>자동 정렬</span>
        </button>
      </div>

      {/* 좌측 하단 가이드 팁 */}
      <div
        style={{
          position: 'absolute',
          bottom: '14px',
          left: '16px',
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          background: 'rgba(255, 255, 255, 0.9)',
          padding: '0.35rem 0.75rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          pointerEvents: 'none'
        }}
      >
        <Move size={12} color="var(--primary)" />
        <span>캔버스 드래그: 이동 · 마우스 휠: 줌 · 노드 카드 드래그: 원하는 위치로 자유 배치</span>
      </div>

      {/* 변환 컨테이너 (Pan & Zoom 적용) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isPanning || draggingNodeId ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        {/* SVG 커넥터 엣지 (Bézier Curves) */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '10000px',
            height: '10000px',
            pointerEvents: 'none',
            overflow: 'visible'
          }}
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
            </marker>
            <marker
              id="flow-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563eb" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const srcPos = nodePositions[edge.sourceId];
            const tgtPos = nodePositions[edge.targetId];
            if (!srcPos || !tgtPos) return null;

            // 부모 노드 우측에서 시작
            const startX = srcPos.x + NODE_WIDTH;
            // 옵션의 대략적인 높이 위치
            const optOffset = 100 + edge.optIndex * 28;
            const startY = srcPos.y + optOffset;

            // 자식 노드 좌측 중앙으로 진입
            const endX = tgtPos.x;
            const endY = tgtPos.y + 40;

            const isEdgeActive = selectedNodeId === edge.sourceId || selectedNodeId === edge.targetId;
            const dx = Math.abs(endX - startX) * 0.45;
            const pathData = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

            return (
              <g key={edge.id}>
                {/* 외곽선 (호버/선택 강조) */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={isEdgeActive ? '#2563eb' : '#94a3b8'}
                  strokeWidth={isEdgeActive ? 2.8 : 1.8}
                  strokeDasharray={isEdgeActive ? 'none' : 'none'}
                  markerEnd={isEdgeActive ? 'url(#flow-arrow-active)' : 'url(#flow-arrow)'}
                  style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
                />
              </g>
            );
          })}
        </svg>

        {/* 인터랙티브 노드 카드 렌더링 */}
        {Object.entries(nodes || {}).map(([nid, node]) => {
          const pos = nodePositions[nid] || { x: 80, y: 80 };
          const isSelected = selectedNodeId === nid;
          const isRoot = nid === rootId;
          const isTerminal = node.type === 'terminal';
          const isDragging = draggingNodeId === nid;

          return (
            <div
              key={nid}
              className={`scenario-node-card ${isSelected ? 'selected' : ''}`}
              onMouseDown={(e) => handleNodeMouseDown(e, nid)}
              style={{
                position: 'absolute',
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${NODE_WIDTH}px`,
                background: '#ffffff',
                borderRadius: '12px',
                border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                boxShadow: isDragging
                  ? '0 16px 32px rgba(0, 0, 0, 0.18), 0 0 0 3px rgba(37, 99, 235, 0.25)'
                  : isSelected
                    ? '0 8px 24px rgba(37, 99, 235, 0.16), 0 0 0 2px rgba(37, 99, 235, 0.2)'
                    : '0 2px 8px rgba(0, 0, 0, 0.05)',
                cursor: isDragging ? 'grabbing' : 'grab',
                zIndex: isDragging ? 50 : isSelected ? 40 : 10,
                transition: isDragging ? 'none' : 'box-shadow 0.15s, border-color 0.15s',
                overflow: 'hidden'
              }}
            >
              {/* 노드 상단 헤더 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.65rem 0.85rem',
                  background: isRoot
                    ? 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)'
                    : isTerminal
                      ? 'linear-gradient(135deg, #065f46 0%, #059669 100%)'
                      : '#f8fafc',
                  borderBottom: '1px solid var(--border-color)',
                  color: isRoot || isTerminal ? '#ffffff' : 'var(--text-main)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden' }}>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      padding: '0.12rem 0.4rem',
                      borderRadius: '4px',
                      background: isRoot || isTerminal ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0',
                      color: isRoot || isTerminal ? '#ffffff' : '#334155',
                      flexShrink: 0
                    }}
                  >
                    {isRoot ? 'ROOT' : isTerminal ? '답변' : '질문'}
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

                {/* 노드 액션 버튼들 (수정, 삭제) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.2rem 0.35rem', height: '22px', fontSize: '0.7rem' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditNode(node);
                    }}
                    title="노드 수정"
                  >
                    <Edit2 size={11} />
                  </button>
                  {!isRoot && (
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ padding: '0.2rem 0.35rem', height: '22px', fontSize: '0.7rem' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNode(nid);
                      }}
                      title="노드 삭제"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* 노드 본문 문구 */}
              <div style={{ padding: '0.75rem 0.85rem' }}>
                <div
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-main)',
                    lineHeight: 1.45,
                    maxHeight: '56px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word'
                  }}
                  title={node.text}
                >
                  {node.text || (isTerminal ? '(최종 답변 조치)' : '(안내 문구 없음)')}
                </div>

                {/* 터미널 노드인 경우 최종 답변 미리보기 */}
                {isTerminal && (node.answer || node.answer_text) && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.4rem 0.6rem',
                      background: 'rgba(5, 150, 105, 0.08)',
                      border: '1px solid rgba(5, 150, 105, 0.25)',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      color: '#065f46',
                      lineHeight: 1.4,
                      maxHeight: '44px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }}
                  >
                    ✅ {node.answer?.text || node.answer_text}
                  </div>
                )}

                {/* 하위 선택지 버튼 목록 */}
                {node.options && node.options.length > 0 && (
                  <div style={{ marginTop: '0.65rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>선택지 분기</span>
                      <span>{node.options.length}개</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {node.options.map((opt, i) => {
                        const nextId = opt.next_node_id || opt.next_node;
                        return (
                          <div
                            key={i}
                            className="option-link-pill"
                            onClick={(e) => {
                              if (nextId) {
                                e.stopPropagation();
                                onSelectNode(nextId);
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.3rem 0.5rem',
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              cursor: nextId ? 'pointer' : 'default',
                              transition: 'background 0.15s, border-color 0.15s'
                            }}
                            title={nextId ? `클릭 시 [${nextId}] 노드로 포커스 이동` : ''}
                          >
                            <span style={{ fontWeight: 600, color: 'var(--text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                              • {opt.label}
                            </span>
                            <span style={{ color: nextId ? 'var(--primary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                              ➔ {nextId ? nextId.split('.').pop() : '종료'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
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
