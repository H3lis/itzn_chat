"""비동기 작업 큐 워커 및 추론 감지 게이트 단위/동시성 테스트."""
from __future__ import annotations

import concurrent.futures
import threading
import time
from pathlib import Path

import pytest

from chatbot_demo_v2.app.history_service import HistoryService
from chatbot_demo_v2.app.history_worker import AsyncHistoryWorker
from chatbot_demo_v2.app.pii_service import PiiMasker
from chatbot_demo_v2.config.settings import load_settings


@pytest.fixture
def temp_history_env(tmp_path: Path):
    """임시 DB를 갖는 HistoryService 및 AsyncHistoryWorker 픽스처."""
    settings = load_settings()
    # 임시 DB 경로 설정
    db_file = tmp_path / "test_chat_history.db"

    class MockSettings:
        def __init__(self, orig, db_p):
            self.data_dir = db_p.parent
            self.pii_backend = "rule"
            self.pii_sllm_model = "qwen2.5:1.5b"
            self.pii_sllm_host = "http://127.0.0.1:11434"
            self.pii_sllm_timeout_s = 1.0

    mock_settings = MockSettings(settings, db_file)
    masker = PiiMasker(backend="rule")
    svc = HistoryService(mock_settings, pii_masker=masker)
    svc.db_path = db_file
    svc._init_db()

    idle_event = threading.Event()
    idle_event.set()

    worker = AsyncHistoryWorker(
        history_service=svc,
        inference_idle_event=idle_event,
        maxsize=1000,
        worker_timeout_s=2.0,
    )
    worker.start()

    yield svc, worker, idle_event

    worker.drain_and_stop(timeout_s=3.0)


def test_history_worker_queue_and_drain(temp_history_env):
    """큐에 작업 등록 후 워커가 소비하여 DB에 적재되는지 검증."""
    svc, worker, _ = temp_history_env

    for i in range(5):
        payload = svc.prepare_turn_payload(
            session_id="s1",
            run_id=f"run_{i}",
            raw_question=f"제 전화번호는 010-1234-567{i}입니다.",
            final_answer=f"답변 {i}입니다.",
            route="faq",
        )
        assert worker.enqueue(payload) is True

    # 워커가 큐를 비울 때까지 최대 3초 대기
    t0 = time.time()
    while worker.queue_size > 0 and time.time() - t0 < 3.0:
        time.sleep(0.05)

    res = svc.search_history(page_size=10)
    assert res["total"] == 5

    # PII 마스킹 확인
    conversations = res["items"]
    assert len(conversations) == 5
    for conv in conversations:
        assert "010-****" in conv["masked_question"]


def test_inference_gate_yielding(temp_history_env):
    """메인 추론 중(Busy)일 때 워커가 대기하고, Idle 상태 복귀 후 처리되는지 검증."""
    svc, worker, idle_event = temp_history_env

    # 1. 메인 추론 활성화 시뮬레이션 (Busy 설정)
    idle_event.clear()

    payload = svc.prepare_turn_payload(
        session_id="s_gate",
        run_id="run_gate_1",
        raw_question="비밀번호는 1234입니다.",
        final_answer="확인했습니다.",
    )
    worker.enqueue(payload)

    # 0.2초 대기 후에도 Busy 상태이므로 큐에 머물러 있어야 함
    time.sleep(0.2)
    assert worker.queue_size == 1

    # 2. 메인 추론 완료 (Idle 복귀)
    idle_event.set()

    # 즉시 소비되어 큐가 비워져야 함
    t0 = time.time()
    while worker.queue_size > 0 and time.time() - t0 < 2.0:
        time.sleep(0.05)

    assert worker.queue_size == 0
    res = svc.search_history(page_size=10)
    assert res["total"] == 1


def test_concurrency_stress_no_db_lock(temp_history_env):
    """다중 스레드 동시 대량 인입 시 SQLite lock 에러 없이 100% 저장되는지 검증."""
    svc, worker, _ = temp_history_env

    total_tasks = 40
    def _enqueue_task(idx):
        payload = svc.prepare_turn_payload(
            session_id=f"sess_{idx % 4}",
            run_id=f"stress_{idx}",
            raw_question=f"질문_{idx} 주민번호 900101-1234567",
            final_answer=f"답변_{idx}",
        )
        return worker.enqueue(payload)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_enqueue_task, range(total_tasks)))

    assert all(results)

    # 큐가 모두 소진될 때까지 대기
    t0 = time.time()
    while worker.queue_size > 0 and time.time() - t0 < 5.0:
        time.sleep(0.05)

    assert worker.queue_size == 0
    res = svc.search_history(page_size=50)
    assert res["total"] == total_tasks
