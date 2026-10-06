"""PII_test 데이터셋 80:20 분할 및 PiiMasker 비식별화 성능 검증 도구.

사용법:
  # 1. 80:20 분할 및 validation 1차 평가 동시 수행:
  python chatbot_demo_v2/scripts/evaluate_pii.py --split-and-eval-val

  # 2. validation 평가만 다시 수행:
  python chatbot_demo_v2/scripts/evaluate_pii.py --eval-val

  # 3. test_set 최종 블라인드 평가 수행:
  python chatbot_demo_v2/scripts/evaluate_pii.py --eval-test
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

# dotenv 안전 로드
try:
    from dotenv import load_dotenv
    load_dotenv("chatbot_demo_v2/.env")
except Exception:
    pass

# 프로젝트 루트를 sys.path 에 자동 등록
_ROOT_DIR = Path(__file__).resolve().parents[2]
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

# Windows 콘솔 출력 utf-8 안전 처리
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from chatbot_demo_v2.app.pii_service import PiiMasker



def split_dataset(
    dataset_dir: Path,
    test_ratio: float = 0.8,
    seed: int = 42,
    manifest_path: Path | None = None,
) -> dict[str, Any]:
    """PII_test/pos 및 PII_test/neg 파일들을 층화 무작위(Stratified)로 80:20 분할."""
    random.seed(seed)
    pos_dir = dataset_dir / "pos"
    neg_dir = dataset_dir / "neg"

    pos_files = sorted(list(pos_dir.glob("**/*.json")))
    neg_files = sorted(list(neg_dir.glob("**/*.json")))

    random.shuffle(pos_files)
    random.shuffle(neg_files)

    pos_test_count = int(len(pos_files) * test_ratio)
    neg_test_count = int(len(neg_files) * test_ratio)

    test_pos = pos_files[:pos_test_count]
    val_pos = pos_files[pos_test_count:]

    test_neg = neg_files[:neg_test_count]
    val_neg = neg_files[neg_test_count:]

    manifest = {
        "metadata": {
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "seed": seed,
            "test_ratio": test_ratio,
            "val_ratio": round(1.0 - test_ratio, 2),
            "total_files": len(pos_files) + len(neg_files),
            "pos_total": len(pos_files),
            "neg_total": len(neg_files),
            "test_counts": {
                "total": len(test_pos) + len(test_neg),
                "pos": len(test_pos),
                "neg": len(test_neg),
            },
            "val_counts": {
                "total": len(val_pos) + len(val_neg),
                "pos": len(val_pos),
                "neg": len(val_neg),
            },
        },
        "test_set": [str(p.relative_to(dataset_dir)).replace("\\", "/") for p in (test_pos + test_neg)],
        "validation": [str(p.relative_to(dataset_dir)).replace("\\", "/") for p in (val_pos + val_neg)],
    }

    if manifest_path:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"[✓] 분할 매니페스트 저장 완료: {manifest_path}")

    print("=" * 60)
    print("📊 [데이터셋 80:20 분할 결과 요약]")
    print(f" • 전체 데이터: {manifest['metadata']['total_files']:,}건 (POS: {len(pos_files):,}건, NEG: {len(neg_files):,}건)")
    print(f" • test_set (80%): {manifest['metadata']['test_counts']['total']:,}건 (POS: {len(test_pos):,}건, NEG: {len(test_neg):,}건)")
    print(f" • validation (20%): {manifest['metadata']['val_counts']['total']:,}건 (POS: {len(val_pos):,}건, NEG: {len(val_neg):,}건)")
    print("=" * 60)
    return manifest


def evaluate_split(
    dataset_dir: Path,
    manifest_path: Path,
    split_name: str = "validation",
    output_result_path: Path | None = None,
    backend: str = "hybrid",
    use_cleaned_labels: bool = True,
) -> dict[str, Any]:
    """지정된 분할(validation 또는 test_set)에 대해 PiiMasker 검증 실행."""
    if not manifest_path.exists():
        raise FileNotFoundError(f"매니페스트 파일이 없습니다: {manifest_path}. 먼저 --split 을 실행하세요.")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    target_rel_paths = manifest.get(split_name, [])
    if not target_rel_paths:
        raise ValueError(f"매니페스트에 '{split_name}' 목록이 비어있습니다.")

    print(f"\n🚀 [{split_name.upper()} 비식별화 검증 시작 (엔진: {backend.upper()})] 총 {len(target_rel_paths):,}건 평가 중...")

    relabel_dict = {}
    if use_cleaned_labels:
        relabel_path = dataset_dir / "hybrid_relabel_summary.json"
        if relabel_path.is_file():
            try:
                with open(relabel_path, "r", encoding="utf-8") as rf:
                    relabel_dict = json.load(rf).get("results", {})
                print(f" • [Cleaned Labels] LLM 전수 정제 라벨 {len(relabel_dict):,}건 적용")
            except Exception as e:
                print(f" • [경고] 정제 라벨 로드 실패: {e}")

    # PiiMasker 초기화 및 워밍업
    masker = PiiMasker(
        backend=backend,
        sllm_host=os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434"),
        gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
    )
    masker.warmup()


    tp = 0  # POS에서 PII 탐지 성공 (정상 마스킹)
    fn = 0  # POS에서 PII 탐지 실패 (미탐, 보안 위험)
    tn = 0  # NEG에서 원문 유지 (정상 보존)
    fp = 0  # NEG에서 PII 오탐 (과잉 마스킹)

    fp_cases: list[dict] = []
    fn_cases: list[dict] = []

    type_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "detected": 0})
    domain_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "correct": 0})

    t0 = time.time()

    for idx, rel_path in enumerate(target_rel_paths):
        file_path = dataset_dir / rel_path
        with open(file_path, "r", encoding="utf-8") as f:
            sample = json.load(f)

        item_id = sample.get("id", rel_path)
        text = sample.get("text", "")
        gt_pi = sample.get("pi", [])

        # LLM 정제 라벨 적용
        if use_cleaned_labels and item_id in relabel_dict:
            r_item = relabel_dict[item_id]
            st = r_item.get("status", "VALID")
            if st == "LABEL_ERROR":
                gt_pi = []  # 가짜 PII 제거 (정상 문장으로 교정)
            elif st == "MODIFIED":
                gt_pi = r_item.get("correct_pi", gt_pi)

        meta = sample.get("meta", {})
        domain = meta.get("domain", "기타")

        is_pos = len(gt_pi) > 0

        # PiiMasker 실행
        res = masker.mask_text(text)
        has_masked = res.has_pii or (res.masked_text != text)

        # 도메인 통계
        domain_stats[domain]["total"] += 1

        if is_pos:
            # POS 평가
            all_detected = True
            for pi_item in gt_pi:
                pi_type = pi_item.get("type", "UNKNOWN")
                pi_val = pi_item.get("text", "")
                type_stats[pi_type]["total"] += 1

                # 마스킹된 텍스트 안에 원문 값이 제거/변형되었는지 검사
                if pi_val and (pi_val not in res.masked_text):
                    type_stats[pi_type]["detected"] += 1
                elif has_masked:
                    # 완벽한 텍스트 소멸은 아니지만 PII 감지 태그가 붙은 경우
                    type_stats[pi_type]["detected"] += 1
                else:
                    all_detected = False

            if has_masked:
                tp += 1
                domain_stats[domain]["correct"] += 1
            else:
                fn += 1
                fn_cases.append({
                    "id": item_id,
                    "file": rel_path,
                    "text": text,
                    "expected_pi": gt_pi,
                    "masked_text": res.masked_text,
                    "meta": meta,
                })
        else:
            # NEG 평가 (오탐 방지)
            if not has_masked:
                tn += 1
                domain_stats[domain]["correct"] += 1
            else:
                fp += 1
                fp_cases.append({
                    "id": item_id,
                    "file": rel_path,
                    "text": text,
                    "masked_text": res.masked_text,
                    "detected_types": res.detected_types,
                    "meta": meta,
                })

        if (idx + 1) % 500 == 0 or (idx + 1) == len(target_rel_paths):
            elapsed = time.time() - t0
            speed = (idx + 1) / max(elapsed, 0.001)
            print(f"  [{idx + 1:>5}/{len(target_rel_paths):>5}] 진행 중... (초당 {speed:.1f}건, 소요시간: {elapsed:.1f}초)")

    total_time = time.time() - t0
    total_eval = tp + tn + fp + fn

    accuracy = (tp + tn) / max(total_eval, 1)
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * (precision * recall) / max(precision + recall, 1e-9)

    report = {
        "split": split_name,
        "evaluated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_samples": total_eval,
        "elapsed_seconds": round(total_time, 2),
        "throughput_samples_per_sec": round(total_eval / max(total_time, 0.001), 1),
        "metrics": {
            "accuracy": round(accuracy * 100, 2),
            "precision": round(precision * 100, 2),
            "recall": round(recall * 100, 2),
            "f1_score": round(f1 * 100, 2),
        },
        "confusion_matrix": {
            "true_positive": tp,
            "false_positive": fp,
            "true_negative": tn,
            "false_negative": fn,
        },
        "type_level_recall": {
            k: {
                "total": v["total"],
                "detected": v["detected"],
                "recall": round(v["detected"] / max(v["total"], 1) * 100, 2),
            }
            for k, v in sorted(type_stats.items(), key=lambda x: x[1]["total"], reverse=True)
        },
        "domain_accuracy": {
            k: {
                "total": v["total"],
                "correct": v["correct"],
                "accuracy": round(v["correct"] / max(v["total"], 1) * 100, 2),
            }
            for k, v in sorted(domain_stats.items(), key=lambda x: x[1]["total"], reverse=True)
        },
        "top_fp_samples": fp_cases,
        "top_fn_samples": fn_cases,
    }

    if output_result_path:
        output_result_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_result_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\n[✓] 평가 상세 리포트 JSON 저장 완료: {output_result_path}")

    # 터미널 출력용 성적표
    print("\n" + "=" * 65)
    print(f"🎯 [{split_name.upper()} 비식별화 1차 검증 성적표]")
    print("=" * 65)
    print(f" • 총 평가 건수: {total_eval:,}건 (소요 시간: {total_time:.2f}초, 초당 {report['throughput_samples_per_sec']}건)")
    print(f" • 정확도 (Accuracy)  : {report['metrics']['accuracy']:>6.2f}%  ((TP+TN)/Total)")
    print(f" • 정밀도 (Precision) : {report['metrics']['precision']:>6.2f}%  (TP/(TP+FP) - 오탐 방어율)")
    print(f" • 재현율 (Recall)    : {report['metrics']['recall']:>6.2f}%  (TP/(TP+FN) - 개인정보 탐지율)")
    print(f" • F1-Score (종합)    : {report['metrics']['f1_score']:>6.2f}%")
    print("-" * 65)
    print("📊 [혼동 행렬 (Confusion Matrix)]")
    print(f" • TP (개인정보 정상 마스킹) : {tp:>4}건")
    print(f" • TN (일반 문장 정상 보존)   : {tn:>4}건")
    print(f" • FP (일반 문장 오탐/과잉)   : {fp:>4}건")
    print(f" • FN (개인정보 누락/미탐)   : {fn:>4}건 (보안 주의)")
    print("-" * 65)
    print("🏷️ [개인정보 주요 유형별 탐지율 (Type-wise Recall)]")
    for t_name, t_info in list(report["type_level_recall"].items())[:10]:
        print(f" • {t_name:<16}: {t_info['detected']:>4}/{t_info['total']:<4} ({t_info['recall']:>5.1f}%)")
    print("=" * 65)

    return report


def main():
    parser = argparse.ArgumentParser(description="PII 검증 및 80:20 분할 도구")
    parser.add_argument("--dataset-dir", type=str, default="PII_test")
    parser.add_argument("--manifest", type=str, default="PII_test/split_manifest.json")
    parser.add_argument("--split-only", action="store_true", help="80:20 분할만 수행")
    parser.add_argument("--eval-val", action="store_true", help="validation(20%) 평가 수행")
    parser.add_argument("--eval-test", action="store_true", help="test_set(80%) 평가 수행")
    parser.add_argument("--split-and-eval-val", action="store_true", help="분할 후 validation 평가 수행")
    parser.add_argument("--backend", type=str, default="hybrid", choices=["rule", "hybrid", "sllm"], help="비식별화 엔진 백엔드 (기본: hybrid)")
    parser.add_argument("--original-labels", action="store_true", help="정제 라벨 대신 원본 라벨 사용")
    args = parser.parse_args()

    ds_dir = Path(args.dataset_dir)
    manifest_p = Path(args.manifest)
    use_cleaned = not args.original_labels

    if args.split_and_eval_val or args.split_only or not manifest_p.exists():
        split_dataset(ds_dir, test_ratio=0.8, seed=42, manifest_path=manifest_p)

    if args.split_and_eval_val or args.eval_val:
        out_p = ds_dir / "validation_report.json"
        evaluate_split(
            ds_dir,
            manifest_p,
            split_name="validation",
            output_result_path=out_p,
            backend=args.backend,
            use_cleaned_labels=use_cleaned,
        )
    elif args.eval_test:
        out_p = ds_dir / "test_report.json"
        evaluate_split(
            ds_dir,
            manifest_p,
            split_name="test_set",
            output_result_path=out_p,
            backend=args.backend,
            use_cleaned_labels=use_cleaned,
        )


if __name__ == "__main__":
    main()
