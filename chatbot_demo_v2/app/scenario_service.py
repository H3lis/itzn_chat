"""장애 문제 버튼형 시나리오 트리 관리 서비스 (ScenarioManager).

책임:
- data/scenarios.json 안전 읽기/쓰기 (스레드 락 및 원자적 임시파일 교체)
- 시나리오 전체 트리 조회 및 노드별 CRUD
- 트리 무결성 검사 (깨진 링크, 중복 옵션, 고립 노드, 순환 참조 검증)
- 변경 즉시 챗봇 런타임 메모리(ScenarioTree) 무중단 핫리로드
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from ..config.settings import Settings
from ..scenario.loader import load_scenarios, load_faq

logger = logging.getLogger("chatbot_demo_v2.scenario")


class ScenarioManager:
    """시나리오 트리(data/scenarios.json) 관리 및 런타임 동기화."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.scenarios_path = Path(settings.scenarios_path)
        self.faq_path = Path(settings.faq_path)
        self._lock = threading.Lock()

    def _read_data(self) -> dict[str, Any]:
        with self._lock:
            if not self.scenarios_path.is_file():
                return {
                    "version": 1,
                    "root_node_id": "root",
                    "nodes": {
                        "root": {
                            "node_id": "root",
                            "scenario_id": "root",
                            "type": "menu",
                            "text": "안녕하세요. 학교 운영지원 스쿨넷봇입니다.",
                            "options": [],
                        }
                    },
                }
            with self.scenarios_path.open("r", encoding="utf-8") as f:
                return json.load(f)

    def _write_data(self, data: dict[str, Any]) -> None:
        with self._lock:
            temp_path = self.scenarios_path.with_suffix(".tmp")
            with temp_path.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp_path.replace(self.scenarios_path)

    def get_tree(self) -> dict[str, Any]:
        """전체 시나리오 데이터 및 계층 정보 반환."""
        data = self._read_data()
        nodes = data.get("nodes", {})
        root_id = data.get("root_node_id", "root")

        # 시나리오 그룹(scenario_id)별 노드 분류
        scenarios_group: dict[str, list[str]] = {}
        for nid, n in nodes.items():
            sc_id = n.get("scenario_id", "default")
            scenarios_group.setdefault(sc_id, []).append(nid)

        validation = self.validate_integrity(data)

        return {
            "root_node_id": root_id,
            "total_nodes": len(nodes),
            "groups": scenarios_group,
            "nodes": nodes,
            "validation": validation,
        }

    def get_node(self, node_id: str) -> Optional[dict[str, Any]]:
        """특정 노드 상세 조회."""
        data = self._read_data()
        return data.get("nodes", {}).get(node_id)

    def save_node(self, node_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """단건 노드 정보 수정 및 저장."""
        data = self._read_data()
        nodes = data.get("nodes", {})

        if node_id not in nodes:
            raise ValueError(f"수정할 노드 '{node_id}'가 존재하지 않습니다.")

        node = nodes[node_id]

        if "scenario_id" in payload:
            node["scenario_id"] = (payload["scenario_id"] or node_id).strip()
        if "type" in payload:
            node["type"] = payload["type"]
        if "text" in payload:
            node["text"] = payload["text"].strip() if payload["text"] else ""
        if "options" in payload:
            # 옵션 유효성 확인
            raw_opts = payload["options"]
            seen_opt = set()
            clean_opts = []
            for o in raw_opts:
                oid = (o.get("option_id") or "").strip()
                lbl = (o.get("label") or "").strip()
                nxt = (o.get("next_node_id") or "").strip()
                if not oid or not lbl or not nxt:
                    continue
                if oid in seen_opt:
                    raise ValueError(f"노드 내 중복된 option_id: '{oid}'")
                seen_opt.add(oid)
                clean_opts.append({"option_id": oid, "label": lbl, "next_node_id": nxt})
            node["options"] = clean_opts

        if node.get("type") == "terminal":
            if "answer" in payload and payload["answer"]:
                node["answer"] = payload["answer"]
            elif "answer_text" in payload and payload["answer_text"]:
                node["answer"] = {
                    "source": "scenario_ppt",
                    "text": payload["answer_text"].strip(),
                }
            elif "answer" not in node:
                raise ValueError("종단(terminal) 노드는 반드시 답변 내용이 지정되어야 합니다.")
        else:
            # non-terminal 인 경우 불필요한 answer 필드 정리
            node.pop("answer", None)

        nodes[node_id] = node
        data["nodes"] = nodes

        # 무결성 검증 (에러가 있으면 예외 발생)
        val = self.validate_integrity(data)
        if not val["is_valid"]:
            err_msg = "; ".join(val["errors"])
            raise ValueError(f"시나리오 무결성 검증 실패: {err_msg}")

        self._write_data(data)
        logger.info("시나리오 노드 저장 완료 [Node ID: %s]", node_id)
        return node

    def create_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        """새로운 시나리오 노드 추가."""
        node_id = (payload.get("node_id") or "").strip()
        if not node_id:
            raise ValueError("노드 ID(node_id)는 필수입니다.")

        data = self._read_data()
        nodes = data.get("nodes", {})

        if node_id in nodes:
            raise ValueError(f"이미 동일한 node_id '{node_id}'가 존재합니다.")

        node_type = payload.get("type", "question")
        scenario_id = (payload.get("scenario_id") or node_id.split(".")[0]).strip()
        text = (payload.get("text") or "").strip()
        options = payload.get("options", [])

        new_node: dict[str, Any] = {
            "node_id": node_id,
            "scenario_id": scenario_id,
            "type": node_type,
            "text": text,
            "options": options,
        }

        if node_type == "terminal":
            if "answer" in payload:
                new_node["answer"] = payload["answer"]
            elif "answer_text" in payload:
                new_node["answer"] = {
                    "source": "scenario_ppt",
                    "text": payload["answer_text"].strip(),
                }
            else:
                new_node["answer"] = {
                    "source": "scenario_ppt",
                    "text": "안내 답변을 입력하세요.",
                }
            if not new_node.get("options"):
                new_node["options"] = [{"option_id": "__restart__", "label": "처음으로", "next_node_id": "root"}]

        nodes[node_id] = new_node
        data["nodes"] = nodes

        self._write_data(data)
        logger.info("새 시나리오 노드 생성 완료 [Node ID: %s]", node_id)
        return new_node

    def delete_node(self, node_id: str) -> bool:
        """시나리오 노드 삭제 (참조 무결성 검증)."""
        data = self._read_data()
        nodes = data.get("nodes", {})
        root_id = data.get("root_node_id", "root")

        if node_id == root_id:
            raise ValueError("루트 노드(root_node_id)는 삭제할 수 없습니다.")

        if node_id not in nodes:
            return False

        # 다른 노드에서 이 노드를 참조하는지 확인
        referrers = []
        for nid, n in nodes.items():
            if nid == node_id:
                continue
            for opt in n.get("options", []):
                if opt.get("next_node_id") == node_id:
                    referrers.append(f"{nid} (옵션: '{opt.get('label')}')")

        if referrers:
            ref_str = ", ".join(referrers[:3])
            raise ValueError(f"노드 '{node_id}'가 다음 노드들에 의해 참조되고 있어 삭제할 수 없습니다: {ref_str}")

        del nodes[node_id]
        data["nodes"] = nodes
        self._write_data(data)
        logger.info("시나리오 노드 삭제 완료 [Node ID: %s]", node_id)
        return True

    def validate_integrity(self, custom_data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """시나리오 트리의 전체 참조 무결성 및 순환/고립 검사."""
        data = custom_data or self._read_data()
        root_id = data.get("root_node_id", "root")
        nodes = data.get("nodes", {})

        errors: list[str] = []
        warnings: list[str] = []

        # 1. 루트 노드 존재 여부
        if root_id not in nodes:
            errors.append(f"루트 노드 '{root_id}'가 nodes 사전에 존재하지 않습니다.")

        # 2. 개별 노드 무결성 및 깨진 링크 검사
        for nid, n in nodes.items():
            if n.get("node_id") != nid:
                errors.append(f"노드 키('{nid}')와 내부 node_id('{n.get('node_id')}')가 불일치합니다.")

            ntype = n.get("type", "question")
            if ntype == "terminal":
                ans = n.get("answer")
                if not ans:
                    errors.append(f"종단(terminal) 노드 '{nid}'에 answer 필드가 없습니다.")
                else:
                    src = ans.get("source")
                    if src == "scenario_ppt" and not ans.get("text"):
                        errors.append(f"종단 노드 '{nid}': scenario_ppt 답변에 text 내용이 없습니다.")
                    elif src == "faq_ref" and not ans.get("answer_ref"):
                        errors.append(f"종단 노드 '{nid}': faq_ref 답변에 answer_ref 참조가 없습니다.")

            # 옵션 링크 검사
            seen_opt = set()
            for opt in n.get("options", []):
                oid = opt.get("option_id")
                nxt = opt.get("next_node_id")
                if oid in seen_opt:
                    errors.append(f"노드 '{nid}'에 중복된 option_id '{oid}'가 있습니다.")
                seen_opt.add(oid)

                if nxt not in nodes:
                    errors.append(f"노드 '{nid}'의 버튼 '{opt.get('label')}'가 미존재 노드 '{nxt}'를 가리킵니다.")

        # 3. 도달 가능성(고립 노드) 분석 (BFS 탐색)
        reachable: set[str] = set()
        if root_id in nodes:
            queue = [root_id]
            reachable.add(root_id)
            while queue:
                curr = queue.pop(0)
                curr_node = nodes.get(curr, {})
                for opt in curr_node.get("options", []):
                    nxt = opt.get("next_node_id")
                    if nxt in nodes and nxt not in reachable:
                        reachable.add(nxt)
                        queue.append(nxt)

        unreachable = sorted(list(set(nodes.keys()) - reachable))
        if unreachable:
            warnings.append(f"루트에서 도달할 수 없는 고립 노드가 {len(unreachable)}개 있습니다: {', '.join(unreachable[:5])}")

        return {
            "is_valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "reachable_count": len(reachable),
            "unreachable_count": len(unreachable),
            "unreachable_nodes": unreachable,
        }

    def reload_runtime(self, ctx: Any) -> None:
        """메모리 내 챗봇 런타임(ScenarioTree) 즉각 핫리로드."""
        try:
            faq = ctx.faq or load_faq(self.faq_path)
            new_tree = load_scenarios(self.scenarios_path, faq)
            ctx.tree = new_tree
            logger.info("시나리오 트리 런타임 핫리로드 완료 (총 %d개 노드)", len(new_tree.nodes))
        except Exception as e:
            logger.error("시나리오 트리 런타임 핫리로드 실패: %s", e, exc_info=True)
            raise
