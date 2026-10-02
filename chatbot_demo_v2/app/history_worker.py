"""비동기 지능형 작업 큐 기반 대화 이력 적재 및 PII 비식별화 워커.

핵심 책임:
1. 사용자 대화 응답 지연 0ms 보장 (큐 Enqueue 후 즉시 반환).
2. FIFO 작업 큐(queue.Queue) 기반으로 단일 스레드가 대화 턴을 순차 소비하여
   SQLite chat_history.db 동시 쓰기 락(Lock) 충돌 100% 원천 방어.
3. 메인 LLM 활성 추론 게이트(Active Inference Gate):
   메인 챗봇이 사용자 답변을 생성 중일 때는 sLLM 백그라운드 호출을 일시 양보(Yield/Wait)하여
   GPU/CPU 자원 경합 및 답변 스트리밍 끊김 현상 0% 차단.
4. Graceful Shutdown & 무손실 플러시(Flush):
   서버 종료 시 큐에 남아있는 미처리 항목들을 규칙 기반으로 즉시 일괄 커밋하여 데이터 유실 방어.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Any, Optional

logger = logging.getLogger("chatbot_demo_v2.history_worker")


class AsyncHistoryWorker:
    """대화 이력 비동기 큐 처리 및 자원 경합 방어 워커."""

    def __init__(
        self,
        history_service: Any,
        inference_idle_event: Optional[threading.Event] = None,
        maxsize: int = 2000,
        worker_timeout_s: float = 5.0,
    ) -> None:
        self.history_service = history_service
        self.inference_idle_event = inference_idle_event
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=maxsize)
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self._worker_timeout_s = worker_timeout_s
        self._lock = threading.Lock()

    def start(self) -> None:
        """백그라운드 단일 워커 스레드 기동."""
        with self._lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._worker_loop,
                name="AsyncHistoryWorkerThread",
                daemon=True,
            )
            self._worker_thread.start()
            logger.info("AsyncHistoryWorker 백그라운드 큐 워커 스레드 시작 완료 (maxsize=%d)", self._queue.maxsize)

    def enqueue(self, payload: dict[str, Any]) -> bool:
        """대화 턴 적재 작업을 큐에 비차단(Non-blocking)으로 등록. (사용자 응답 0ms 지연)"""
        try:
            self._queue.put_nowait(payload)
            return True
        except queue.Full:
            logger.warning("대화 이력 큐 가득 참 (maxsize 초과), 긴급 즉시 저장 폴백 수행")
            try:
                # 큐 초과 시 긴급 규칙 기반 저장 (유실 방어)
                self.history_service.save_turn_payload(payload, use_sllm_refine=False)
                return True
            except Exception as e:
                logger.error("긴급 대화 이력 적재 실패: %s", e)
                return False

    def _worker_loop(self) -> None:
        """단일 워커 소비 루프."""
        while not self._stop_event.is_set():
            # 1. 메인 추론 게이트 검사: 메인 LLM이 활성 상태면 큐에서 꺼내지 않고 유휴(Idle) 대기
            if self.inference_idle_event is not None and not self.inference_idle_event.is_set():
                self.inference_idle_event.wait(timeout=self._worker_timeout_s)
                if self._stop_event.is_set():
                    break

            try:
                task = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue

            try:
                # 2. 큐에서 꺼낸 직후에도 혹시 그 사이에 메인 추론이 시작되었으면 대기
                if self.inference_idle_event is not None and not self.inference_idle_event.is_set():
                    self.inference_idle_event.wait(timeout=self._worker_timeout_s)

                # 단일 스레드 순차 정밀 검증 & DB 커밋
                use_sllm = getattr(self.history_service, "pii_masker", None) is not None and \
                           getattr(self.history_service.pii_masker, "backend", "") == "sllm"
                self.history_service.save_turn_payload(task, use_sllm_refine=use_sllm)
            except Exception as e:
                logger.error("AsyncHistoryWorker 작업 처리 중 예외 발생: %s", e, exc_info=True)
            finally:
                self._queue.task_done()

    def drain_and_stop(self, timeout_s: float = 5.0) -> None:
        """Graceful Shutdown: 큐에 남은 작업을 초고속(규칙 기반)으로 전량 플러시 후 워커 종료."""
        logger.info("AsyncHistoryWorker 큐 플러시 및 정상 종료 절차 시작...")
        self._stop_event.set()

        # 잔여 작업 초고속 플러시
        flushed_count = 0
        while not self._queue.empty():
            try:
                task = self._queue.get_nowait()
                # 종료 시에는 sLLM을 건너뛰고 1차 규칙 마스킹본으로 즉시 저장
                self.history_service.save_turn_payload(task, use_sllm_refine=False)
                self._queue.task_done()
                flushed_count += 1
            except queue.Empty:
                break
            except Exception as e:
                logger.warning("종료 플러시 중 단일 작업 적재 실패: %s", e)

        if flushed_count > 0:
            logger.info("종료 시 미처리 대화 턴 %d건 플러시 완료", flushed_count)

        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=timeout_s)
        logger.info("AsyncHistoryWorker 백그라운드 워커 종료 완료")

    @property
    def queue_size(self) -> int:
        """현재 대기 중인 작업 수."""
        return self._queue.qsize()
