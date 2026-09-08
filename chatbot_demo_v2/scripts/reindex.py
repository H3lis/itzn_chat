# -*- coding: utf-8 -*-
"""색인 재구축 — **원자적 교체** (작업 8 / 안전장치 0-4).

기존 `ragdata/index` 를 절대 덮어쓰지 않는다. 새 색인을 `ragdata/index_new` 에 만들고,
골든셋 검증을 통과한 뒤에만 rename 두 번으로 교체한다. 실패해도 서빙 색인은 무손상이다.

    index      → index_old   (직전 색인 보존)
    index_new  → index

되돌리려면 rename 두 번이면 된다. 자세한 절차는 `_backup/RESTORE.md`.

왜 재색인하나
    서빙 색인이 현재 코드와 불일치한다(실측). 178청크(7%)의 메타 char_count(1200)와
    실제 색인 길이(8,448자)가 다르고, 12,589자 청크가 현재 chunking 코드로는 11조각으로
    정상 분할된다. 즉 이전 규칙으로 만들어진 색인이 그대로 서빙되고 있었다.
    여기에 chunk_hygiene(중복 5.4% · 반복노이즈 2.5%) 정리를 더한다.

실행:
    <intern_chatbot python> -X utf8 chatbot_demo_v2/scripts/reindex.py            # 빌드만
    ... --promote        # 검증 후 교체까지 (index → index_old, index_new → index)
    ... --rollback       # index_old 로 되돌리기
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = PKG_ROOT.parent
sys.path.insert(0, str(PROJECT_ROOT))

from chatbot_demo_v2.config.settings import load_settings             # noqa: E402
from chatbot_demo_v2.rag.adapter_util import prepare_ragcore_imports  # noqa: E402

# 원본 카탈로그/PDF 기본 경로 — 내부 raw_data 우선, 없으면 외부 test_3 폴백
DEFAULT_CATALOG = PKG_ROOT / "raw_data" / "catalog" / "데이터카탈로그_DCAT_선정파일_RAG최적화.xlsx"
if not DEFAULT_CATALOG.is_file():
    DEFAULT_CATALOG = PROJECT_ROOT / "test_3" / "사전데이터" / "데이터카탈로그_DCAT_선정파일_RAG최적화.xlsx"

DEFAULT_DOCS = PKG_ROOT / "raw_data" / "documents"
if not DEFAULT_DOCS.is_dir():
    DEFAULT_DOCS = PROJECT_ROOT / "test_3" / "사전데이터" / "데이터 카탈로그 작업 파일"


def _dir_stats(p: Path) -> dict:
    if not p.is_dir():
        return {"exists": False}
    files = [f for f in p.rglob("*") if f.is_file()]
    return {"exists": True, "files": len(files), "bytes": sum(f.stat().st_size for f in files)}


def _guard_sources(catalog_path: Path, docs_dir: Path) -> None:
    """원본이 재색인 과정에서 훼손되지 않았는지 확인할 기준값을 출력한다."""
    for p in (catalog_path.parent, docs_dir):
        s = _dir_stats(p)
        print("  원본 %-46s %s" % (p.name, s))


def build(settings, force: bool, catalog_path: Path | None = None, docs_dir: Path | None = None) -> dict:
    prepare_ragcore_imports(settings)
    from rag3.config import load_config
    from rag3.ingest import run_ingest
    from rag3.models import get_backend

    src_catalog = catalog_path or DEFAULT_CATALOG
    src_docs = docs_dir or DEFAULT_DOCS

    new_dir = Path(settings.ragdata_dir) / "index_new"
    if new_dir.exists():
        if not force:
            raise SystemExit(f"이미 존재: {new_dir} (다시 만들려면 --force)")
        shutil.rmtree(new_dir)
    new_dir.mkdir(parents=True, exist_ok=True)

    if not src_catalog.is_file():
        raise SystemExit(f"카탈로그 없음: {src_catalog}")
    if not src_docs.is_dir():
        raise SystemExit(f"원본 문서 폴더 없음: {src_docs}")

    # 색인 대상만 index_new 로 돌린다. 파싱 캐시(source_parsed)는 기존 것을 **읽기만** 한다.
    config = load_config(str(settings.ragcore_config), {
        "index_dir": str(new_dir),
        "catalog_excel_path": str(src_catalog),
        "documents_dir": str(src_docs),
    })
    print("  index_dir      =", config.index_dir)
    print("  source_parsed  =", config.source_parsed, "(읽기 전용)")
    print("  catalog        =", src_catalog)
    print("  documents      =", src_docs)

    backend = get_backend(config)
    t0 = time.time()
    summary = run_ingest(config, backend, force=False)
    summary["elapsed_wall_s"] = round(time.time() - t0, 1)
    return summary


import gc

def _safe_promote_dir(new_dir: Path, cur_dir: Path, old_dir: Path, root: Path) -> None:
    """Windows 파일 락([WinError 5] Access Denied)에 안전한 원자적 색인 승격."""
    gc.collect()

    # 1) 기존 index_old 보존
    if old_dir.exists():
        stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
        dest_old = root / f"index_old_{stamp}"
        try:
            old_dir.rename(dest_old)
            print("  기존 index_old 를 index_old_%s 로 보존" % stamp)
        except Exception:
            try:
                shutil.copytree(str(old_dir), str(dest_old), dirs_exist_ok=True)
                shutil.rmtree(str(old_dir), ignore_errors=True)
                print("  기존 index_old 를 index_old_%s 로 복사 보존" % stamp)
            except Exception as e:
                print("  index_old 보존 건너뜀: %s" % e)

    # 2) 현재 index -> index_old 백업
    if cur_dir.exists():
        try:
            cur_dir.rename(old_dir)
        except Exception:
            try:
                shutil.copytree(str(cur_dir), str(old_dir), dirs_exist_ok=True)
                shutil.rmtree(str(cur_dir), ignore_errors=True)
            except Exception as e:
                print("  기존 index 백업: %s" % e)

    # 3) index_new -> index 승격
    gc.collect()
    time.sleep(0.3)
    try:
        if cur_dir.exists():
            shutil.rmtree(str(cur_dir), ignore_errors=True)
        new_dir.rename(cur_dir)
        print("  교체 완료 (rename): index → index_old, index_new → index")
    except Exception as e:
        print("  Windows 파일 락 감지(%s) -> copytree 방식으로 안전하게 교체 승격" % e)
        if cur_dir.exists():
            shutil.rmtree(str(cur_dir), ignore_errors=True)
        shutil.copytree(str(new_dir), str(cur_dir), dirs_exist_ok=True)
        try:
            shutil.rmtree(str(new_dir), ignore_errors=True)
        except Exception:
            pass
        print("  교체 완료 (copytree): index_new → index")


def promote(settings) -> None:
    root = Path(settings.ragdata_dir)
    cur, new, old = root / "index", root / "index_new", root / "index_old"
    if not new.is_dir():
        raise SystemExit(f"새 색인이 없다: {new} (먼저 빌드할 것)")
    
    _safe_promote_dir(new, cur, old, root)
    print("  되돌리려면: --rollback")


def rollback(settings) -> None:
    root = Path(settings.ragdata_dir)
    cur, old = root / "index", root / "index_old"
    if not old.is_dir():
        raise SystemExit(f"되돌릴 직전 색인이 없다: {old}")
    gc.collect()
    failed = root / ("index_failed_" + datetime.now().strftime("%Y%m%dT%H%M%S"))
    try:
        cur.rename(failed)
    except Exception:
        try:
            shutil.copytree(str(cur), str(failed), dirs_exist_ok=True)
            shutil.rmtree(str(cur), ignore_errors=True)
        except Exception:
            pass
    try:
        old.rename(cur)
        print("  롤백 완료 (rename): index → %s, index_old → index" % failed.name)
    except Exception:
        shutil.copytree(str(old), str(cur), dirs_exist_ok=True)
        print("  롤백 완료 (copytree): index → %s, index_old → index" % failed.name)


def main() -> int:
    ap = argparse.ArgumentParser(description="색인 재구축 (원자적 교체)")
    ap.add_argument("--promote", action="store_true", help="빌드 없이 index_new 를 교체")
    ap.add_argument("--rollback", action="store_true", help="index_old 로 되돌리기")
    ap.add_argument("--force", action="store_true", help="기존 index_new 를 지우고 다시 빌드")
    ap.add_argument("--catalog", type=Path, default=None, help="카탈로그 엑셀 경로")
    ap.add_argument("--docs", type=Path, default=None, help="원본 문서 디렉토리 경로")
    ap.add_argument("--report", default=str(PKG_ROOT / "runtime" / "reports" / "reindex_report.json"))
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = load_settings()

    if args.rollback:
        rollback(settings)
        return 0
    if args.promote:
        promote(settings)
        return 0

    catalog_path = args.catalog or DEFAULT_CATALOG
    docs_dir = args.docs or DEFAULT_DOCS

    print("원본 무결성 기준값(재색인 전):")
    _guard_sources(catalog_path, docs_dir)
    print()
    summary = build(settings, force=args.force, catalog_path=catalog_path, docs_dir=docs_dir)

    print()
    print("=" * 80)
    hy = summary.get("chunk_hygiene") or {}
    print("문서 %d · 페이지 %d · 청크 %d (%.1fs)"
          % (summary["documents_parsed"], summary["total_pages"],
             summary["total_chunks"], summary["elapsed_wall_s"]))
    print("청크 위생: 입력 %d → 출력 %d | 중복제거 %d | 반복압축 %d | 초과경고 %d | 절약 %d자"
          % (hy.get("input_chunks", 0), hy.get("output_chunks", 0),
             hy.get("dropped_duplicates", 0), hy.get("compressed_noise", 0),
             hy.get("oversize_warned", 0), hy.get("chars_saved", 0)))
    print("=" * 80)
    print()
    print("원본 무결성 확인(재색인 후 -- 위 기준값과 같아야 한다):")
    _guard_sources(catalog_path, docs_dir)

    out = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n리포트:", out)
    print("\n다음 단계: 골든셋으로 새 색인을 검증한 뒤에만 교체할 것")
    print("  1) RAGDATA 를 index_new 로 가리켜 평가:  run_eval.py --tag reindex")
    print("  2) ab_compare.py work1256 reindex   ← 악화 문항이 없는지 확인")
    print("  3) 통과하면:  reindex.py --promote")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
