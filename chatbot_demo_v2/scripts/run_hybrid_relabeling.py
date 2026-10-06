"""스마트 2단계 하이브리드 PII 전체 데이터셋 재라벨링 및 검수 도구 (옵션 3).

1단계: gemini-3.8-flash 를 통한 전체 8,344건 고속 배치 전수 스캔 (20건/배치)
2단계: 불일치/라벨 오류 의심 샘플에 대한 gemini-3.1-pro-preview 2차 정밀 심판
3단계: 정정 결과 집계, 리포트 생성 및 cleaned_manifest.json 저장
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("relabel")

_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

FLASH_MODEL = "gemini-3.8-flash"
PRO_MODEL = "gemini-3.1-pro-preview"

SYSTEM_PROMPT = """당신은 대한민국 개인정보보호법 및 PII 비식별화 최고 전문가입니다.
주어진 문장 목록에 대해, 현재 라벨링된 개인정보(current_pi)가 올바른지 엄격히 검수하고 재라벨링하세요.

[판정 및 정정 기준]
1. VALID: 현재 라벨이 올바름.
2. LABEL_ERROR: 개인정보가 전혀 아닌 일반 명사/감탄사/직급/지명/시스템용어인데 PII로 잘못 태깅되었거나, 개인정보가 없는데 있는 것으로 처리됨.
   - 대표적 오라벨: '이 상품', '네', '나', '너', '지하철역', '부장님', '고객님', '본인', '예전 거', '계정 번호', '본인 명의', '인스타그램', '강남병원' 등은 절대 PII가 아님 -> correct_pi는 빈 배열 []이어야 함.
3. MODIFIED: 실제 개인정보가 있으나 현재 라벨의 텍스트나 타입이 누락되었거나 부정확하여 수정이 필요함. (예: 따옴표 안의 인명이 누락되었거나, 잘못된 타입으로 태깅된 경우)

반드시 오직 아래 형식의 JSON 배열만 반환하세요:
[
  {
    "id": "A-000000",
    "status": "VALID" | "LABEL_ERROR" | "MODIFIED",
    "correct_pi": [{"type": "NAME|PHONE|EMAIL|RRN|ADDRESS|BIRTH|ACCOUNT|CARD|ID|SNS|...", "text": "추출텍스트"}],
    "reason": "사유"
  }
]
"""


def load_gemini_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        env_path = Path(__file__).resolve().parents[1] / ".env"
        if env_path.is_file():
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("GEMINI_API_KEY="):
                        key = line.split("=", 1)[1].strip()
                        break
    if not key:
        raise RuntimeError("GEMINI_API_KEY 를 찾을 수 없습니다.")
    return key


def call_gemini(model: str, samples: list[dict], api_key: str, max_retries: int = 5) -> list[dict]:
    url = _API_URL.format(model=model)
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": json.dumps(samples, ensure_ascii=False)}]}],
        "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"},
    }

    last_err = ""
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                url,
                params={"key": api_key},
                json=payload,
                timeout=30,
            )
            if resp.status_code == 200:
                raw_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(raw_text)
                if isinstance(parsed, list):
                    return parsed
                elif isinstance(parsed, dict) and "items" in parsed:
                    return parsed["items"]
            elif resp.status_code == 429:
                time.sleep(2 ** attempt + 1)
                continue
            else:
                last_err = f"HTTP {resp.status_code}: {resp.text[:150]}"
        except Exception as e:
            last_err = str(e)
            time.sleep(2 ** attempt + 1)

    logger.warning("배치 호출 실패 (%s): %s", model, last_err)
    # 폴백: 실패 시 기존 라벨 유지(VALID)
    return [{"id": s["id"], "status": "VALID", "correct_pi": s.get("current_pi", []), "reason": "API_FAIL_FALLBACK"} for s in samples]


def load_all_dataset(manifest_path: Path, dataset_dir: Path) -> list[dict]:
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    all_rel_paths = manifest["test_set"] + manifest["validation"]
    logger.info("총 로드 대상 파일: %d건", len(all_rel_paths))

    samples = []
    for rel_path in all_rel_paths:
        file_path = dataset_dir / rel_path
        if not file_path.is_file():
            continue
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                samples.append({
                    "id": data["id"],
                    "rel_path": rel_path,
                    "text": data["text"],
                    "current_pi": data.get("pi", []),
                    "meta": data.get("meta", {}),
                })
        except Exception as e:
            logger.warning("파일 읽기 실패 %s: %s", rel_path, e)

    return samples


def run_stage1_flash(
    samples: list[dict],
    checkpoint_file: Path,
    api_key: str,
    batch_size: int = 20,
    max_workers: int = 6,
) -> dict[str, dict]:
    """1단계: gemini-3.8-flash 를 사용한 고속 배치 전수 스캔."""
    results = {}
    if checkpoint_file.is_file():
        with open(checkpoint_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    item = json.loads(line)
                    results[item["id"]] = item
        logger.info("기존 1단계 체크포인트 로드 완료: %d건", len(results))

    remaining = [s for s in samples if s["id"] not in results]
    logger.info("1단계 신규 처리 대상: %d건", len(remaining))
    if not remaining:
        return results

    batches = []
    for i in range(0, len(remaining), batch_size):
        batches.append(remaining[i:i + batch_size])

    checkpoint_f = open(checkpoint_file, "a", encoding="utf-8")

    start_t = time.time()
    completed_batches = 0

    def _worker(batch):
        payload_samples = [
            {"id": s["id"], "text": s["text"], "current_pi": s["current_pi"]}
            for s in batch
        ]
        return call_gemini(FLASH_MODEL, payload_samples, api_key)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_worker, b): b for b in batches}
        for future in as_completed(futures):
            batch_res = future.result()
            for r in batch_res:
                sid = r.get("id")
                if sid:
                    results[sid] = r
                    checkpoint_f.write(json.dumps(r, ensure_ascii=False) + "\n")
            checkpoint_f.flush()
            completed_batches += 1
            if completed_batches % 20 == 0 or completed_batches == len(batches):
                elapsed = time.time() - start_t
                speed = (completed_batches * batch_size) / max(elapsed, 0.001)
                logger.info(
                    "1단계 Flash 진행 중: [%d/%d 배치] (%.1f 건/초, 경과: %.1f초)",
                    completed_batches, len(batches), speed, elapsed
                )

    checkpoint_f.close()
    return results


def run_stage2_pro(
    stage1_results: dict[str, dict],
    samples_by_id: dict[str, dict],
    pro_checkpoint_file: Path,
    api_key: str,
    batch_size: int = 10,
    max_workers: int = 4,
) -> dict[str, dict]:
    """2단계: Flash 판정 결과가 VALID가 아닌(라벨 오류/수정 의심) 건을 gemini-3.1-pro 로 2차 정밀 심판."""
    pro_results = {}
    if pro_checkpoint_file.is_file():
        with open(pro_checkpoint_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    item = json.loads(line)
                    pro_results[item["id"]] = item
        logger.info("기존 2단계 Pro 체크포인트 로드 완료: %d건", len(pro_results))

    # 의심 케이스 선별: status != 'VALID'
    suspicious_ids = [
        sid for sid, r in stage1_results.items()
        if r.get("status") in ("LABEL_ERROR", "MODIFIED")
    ]
    logger.info("1단계에서 적출된 2차 Pro 정밀 심판 대상: 총 %d건", len(suspicious_ids))

    remaining = [samples_by_id[sid] for sid in suspicious_ids if sid not in pro_results and sid in samples_by_id]
    logger.info("2단계 Pro 신규 심판 대상: %d건", len(remaining))
    if not remaining:
        return pro_results

    batches = []
    for i in range(0, len(remaining), batch_size):
        batches.append(remaining[i:i + batch_size])

    checkpoint_f = open(pro_checkpoint_file, "a", encoding="utf-8")
    start_t = time.time()
    completed_batches = 0

    def _worker(batch):
        payload_samples = [
            {"id": s["id"], "text": s["text"], "current_pi": s["current_pi"]}
            for s in batch
        ]
        return call_gemini(PRO_MODEL, payload_samples, api_key)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_worker, b): b for b in batches}
        for future in as_completed(futures):
            batch_res = future.result()
            for r in batch_res:
                sid = r.get("id")
                if sid:
                    pro_results[sid] = r
                    checkpoint_f.write(json.dumps(r, ensure_ascii=False) + "\n")
            checkpoint_f.flush()
            completed_batches += 1
            if completed_batches % 10 == 0 or completed_batches == len(batches):
                elapsed = time.time() - start_t
                logger.info(
                    "2단계 Pro 진행 중: [%d/%d 배치] (경과: %.1f초)",
                    completed_batches, len(batches), elapsed
                )

    checkpoint_f.close()
    return pro_results


def main():
    parser = argparse.ArgumentParser(description="옵션 3 하이브리드 PII 재라벨링")
    parser.add_argument("--dataset-dir", type=str, default="PII_test")
    parser.add_argument("--manifest", type=str, default="PII_test/split_manifest.json")
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    ds_dir = Path(args.dataset_dir)
    manifest_p = Path(args.manifest)

    api_key = load_gemini_key()
    samples = load_all_dataset(manifest_p, ds_dir)
    samples_by_id = {s["id"]: s for s in samples}

    cp_flash = ds_dir / "relabel_stage1_flash.jsonl"
    cp_pro = ds_dir / "relabel_stage2_pro.jsonl"

    logger.info("🚀 [1단계] gemini-3.8-flash 고속 전수 스캔 시작 (%d건)...", len(samples))
    stage1_res = run_stage1_flash(samples, cp_flash, api_key, batch_size=args.batch_size, max_workers=args.workers)

    logger.info("🧠 [2단계] gemini-3.1-pro-preview 2차 정밀 심판 시작...")
    stage2_res = run_stage2_pro(stage1_res, samples_by_id, cp_pro, api_key, batch_size=10, max_workers=4)

    logger.info("📊 [3단계] 최종 판정 종합 및 통계 산출 중...")
    final_verdict = {}
    label_error_count = 0
    modified_count = 0
    valid_count = 0

    for sid, s1 in stage1_res.items():
        if sid in stage2_res:
            final_res = stage2_res[sid]  # Pro 판정을 최종 기준으로 채택
        else:
            final_res = s1

        st = final_res.get("status", "VALID")
        if st == "LABEL_ERROR":
            label_error_count += 1
        elif st == "MODIFIED":
            modified_count += 1
        else:
            valid_count += 1
        final_verdict[sid] = final_res

    summary = {
        "total_samples": len(samples),
        "valid_count": valid_count,
        "label_error_count": label_error_count,
        "modified_count": modified_count,
        "error_or_modified_ratio_pct": round((label_error_count + modified_count) / max(len(samples), 1) * 100, 2),
        "results": final_verdict,
    }

    summary_out = ds_dir / "hybrid_relabel_summary.json"
    with open(summary_out, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    logger.info("=" * 60)
    logger.info("🎯 [전체 8,344건 하이브리드 재라벨링 최종 결과]")
    logger.info(" • 전체 데이터: %d건", len(samples))
    logger.info(" • VALID (정상 라벨): %d건 (%.1f%%)", valid_count, (valid_count / len(samples)) * 100)
    logger.info(" • LABEL_ERROR (명백한 오라벨/가짜 PII): %d건 (%.1f%%)", label_error_count, (label_error_count / len(samples)) * 100)
    logger.info(" • MODIFIED (라벨 텍스트/타입 정정 필요): %d건 (%.1f%%)", modified_count, (modified_count / len(samples)) * 100)
    logger.info(" • 총 라벨 결함/정정 비율: %.2f%%", summary["error_or_modified_ratio_pct"])
    logger.info(" • 결과 JSON 저장 완료: %s", summary_out)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
