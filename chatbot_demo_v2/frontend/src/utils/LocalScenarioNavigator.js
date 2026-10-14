/**
 * 클라이언트 사이드 시나리오 룰 엔진 (LocalScenarioNavigator)
 *
 * 서버(LangGraph)와 통신이 불가능한 오프라인 환경에서
 * 브라우저 메모리의 시나리오 트리를 직접 순회하여
 * 안내 메시지와 다음 선택지 칩을 0ms 만에 생성합니다.
 */

function extractNodeText(node) {
  if (!node) return '안내에 따라 확인해 주시기 바랍니다.';

  // 1. text 필드 (일반 질문/메뉴 노드)
  if (typeof node.text === 'string' && node.text.trim()) {
    return node.text.trim();
  }

  // 2. answer 필드 (객체 또는 문자열 - terminal 노드)
  if (node.answer) {
    if (typeof node.answer === 'string' && node.answer.trim()) {
      return node.answer.trim();
    }
    if (typeof node.answer === 'object') {
      if (typeof node.answer.text === 'string' && node.answer.text.trim()) {
        return node.answer.text.trim();
      }
      if (typeof node.answer.answer_text === 'string' && node.answer.answer_text.trim()) {
        return node.answer.answer_text.trim();
      }
    }
  }

  // 3. solution 필드
  if (node.solution) {
    if (typeof node.solution === 'string' && node.solution.trim()) {
      return node.solution.trim();
    }
    if (typeof node.solution === 'object' && typeof node.solution.text === 'string') {
      return node.solution.text.trim();
    }
  }

  return '안내에 따라 확인해 주시기 바랍니다.';
}

export class LocalScenarioNavigator {
  constructor(scenarioTree) {
    this.tree = scenarioTree || { root_node_id: 'root', nodes: {} };
    this.rootNodeId = this.tree.root_node_id || 'root';
    this.nodes = this.tree.nodes || {};
  }

  /**
   * 새로운 시나리오 트리로 엔진 핫스왑
   */
  updateTree(newTree) {
    if (newTree && newTree.nodes) {
      this.tree = newTree;
      this.rootNodeId = newTree.root_node_id || 'root';
      this.nodes = newTree.nodes || {};
    }
  }

  /**
   * 루트 노드의 초기 옵션 칩 목록 반환
   */
  getRootOptions() {
    const rootNode = this.nodes[this.rootNodeId];
    if (!rootNode || !Array.isArray(rootNode.options)) {
      return [];
    }
    return rootNode.options.map((opt) => ({
      option_id: opt.option_id,
      label: opt.label,
      next_node_id: opt.next_node_id,
      action: opt.action,
    }));
  }

  /**
   * 루트 노드의 초기 환영 메시지 반환
   */
  getRootGreeting() {
    const rootNode = this.nodes[this.rootNodeId];
    return extractNodeText(rootNode);
  }

  /**
   * 사용자가 선택한 시나리오 옵션(버튼)을 처리하여 다음 메시지와 옵션을 반환
   *
   * @param {Object} optionItem 선택한 옵션 { option_id, label, next_node_id, action }
   * @param {string} currentNodeId 현재 위치한 노드 ID
   * @returns {Object} { userMsg, botMsg, nextOptions, nextNodeId, completed }
   */
  step(optionItem, currentNodeId = null) {
    const nextNodeId = optionItem.next_node_id;
    const targetNode = nextNodeId ? this.nodes[nextNodeId] : null;

    const userMsg = {
      id: 'msg_usr_' + Date.now(),
      type: 'user',
      text: optionItem.label,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // 타겟 노드가 존재하지 않는 경우 (예외 폴백)
    if (!targetNode) {
      const fallbackBotMsg = {
        id: 'msg_bot_' + Date.now(),
        type: 'bot',
        text: '해당 시나리오의 세부 안내 정보를 찾을 수 없습니다. 처음으로 돌아가시겠습니까?',
        resp: {
          answer: '해당 시나리오의 세부 안내 정보를 찾을 수 없습니다. 처음으로 돌아가시겠습니까?',
          run_id: null,
          evidence: [],
          faq_evidence: [],
          isOffline: true,
        },
        isOffline: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      return {
        userMsg,
        botMsg: fallbackBotMsg,
        nextOptions: [{ option_id: '__restart__', label: '처음으로' }],
        nextNodeId: this.rootNodeId,
        completed: true,
      };
    }

    // 봇 안내 문구 생성 (복합 객체 answer.text 지원)
    const botText = extractNodeText(targetNode);
    const isTerminal = targetNode.type === 'terminal';

    const botMsg = {
      id: 'msg_bot_' + Date.now(),
      type: 'bot',
      text: botText,
      resp: {
        answer: botText,
        run_id: null,
        evidence: [],
        faq_evidence: [],
        isOffline: true,
      },
      isOffline: true,
      nodeId: nextNodeId,
      scenarioId: targetNode.scenario_id,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // 다음 선택지 구성
    let nextOptions = [];
    if (Array.isArray(targetNode.options) && targetNode.options.length > 0) {
      nextOptions = targetNode.options.map((opt) => ({
        option_id: opt.option_id,
        label: opt.label,
        next_node_id: opt.next_node_id,
        action: opt.action,
      }));

      // '처음으로' 칩이 없을 때만 추가
      const hasRestart = nextOptions.some(
        (o) => o.option_id === '__restart__' || o.label?.trim() === '처음으로' || o.next_node_id === 'root'
      );
      if (!hasRestart) {
        nextOptions.push({
          option_id: '__restart__',
          label: '처음으로',
        });
      }
    } else {
      // 리프 노드(최종 해결책 안내 노드)인 경우
      nextOptions = [
        {
          option_id: '__restart__',
          label: '처음으로',
        },
      ];
    }

    return {
      userMsg,
      botMsg,
      nextOptions,
      nextNodeId,
      completed: isTerminal || !targetNode.options || targetNode.options.length === 0,
    };
  }
}
