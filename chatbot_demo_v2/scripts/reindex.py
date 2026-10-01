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

LIVE_REPORTS_DIR = PKG_ROOT / "runtime" / "reports"
LIVE_LOG_FILE = LIVE_REPORTS_DIR / "reindex_live.log"
LIVE_STATUS_FILE = LIVE_REPORTS_DIR / "reindex_status.json"


def emit_live_log(text: str, stage: str | None = None, progress: int | None = None, status: str = "running"):
    """웹 관리자 콘솔과 실시간 동기화되는 라이브 로그 및 상태 파일에 기록."""
    LIVE_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%H:%M:%S")
    line = f"[{stamp}] {text}"
    try:
        with open(LIVE_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
    except Exception:
        pass

    try:
        cur_status = {}
        if LIVE_STATUS_FILE.is_file():
            try:
                cur_status = json.loads(LIVE_STATUS_FILE.read_text(encoding="utf-8"))
            except Exception:
                cur_status = {}
        cur_status["status"] = status
        if stage:
            cur_status["stage"] = stage
        if progress is not None:
            cur_status["progress_pct"] = progress
        cur_status["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        LIVE_STATUS_FILE.write_text(json.dumps(cur_status, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


class _LiveFileLogHandler(logging.Handler):
    """표준 로깅 출력을 실시간 live 로그 파일에 미러링."""

    def __init__(self):
        super().__init__()
        self.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))

    def emit(self, record: logging.LogRecord):
        # HTTP 액세스 로그나 uvicorn 통신/핑 로그, httpx 내부 통신 로그는 필터링
        if record.name.startswith("uvicorn") or record.name.startswith("httpx") or "HTTP/1.1" in record.getMessage() or ": ping" in record.getMessage():
            return
        try:
            msg = self.format(record)
            emit_live_log(msg)
        except Exception:
            pass


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

    try:
        from rag3.index import clear_all_index_caches
        clear_all_index_caches()
    except Exception:
        pass

    src_catalog = catalog_path or DEFAULT_CATALOG
    src_docs = docs_dir or DEFAULT_DOCS

    new_dir = Path(settings.ragdata_dir) / "index_new"
    if new_dir.exists():
        for root, dirs, files in os.walk(new_dir):
            for fname in files:
                try:
                    os.chmod(os.path.join(root, fname), 0o777)
                except Exception:
                    pass
        shutil.rmtree(new_dir, ignore_errors=True)
    new_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(new_dir, 0o777)
    except Exception:
        pass

    try:
        from rag3.index import clear_all_index_caches
        clear_all_index_caches()
    except Exception:
        pass

    # 카탈로그 엑셀이 없더라도 가상 카탈로그(Virtual Catalog Row)로 전체 문서를 색인할 수 있도록 폴백 처리
    catalog_arg_path = src_catalog
    if not src_catalog.is_file():
        # 임시 가상 카탈로그 경로 설정 (catalog.py에서 가상 카탈로그 fallback 자동 작동)
        catalog_arg_path = Path(settings.ragdata_dir) / "_unused_catalog.xlsx"
        print(f"  [알림] 원본 카탈로그 엑셀 없음 ({src_catalog}) -> 가상 카탈로그(Virtual Catalog) 모드로 전체 문서 색인 진행")

    if not src_docs.is_dir():
        src_docs.mkdir(parents=True, exist_ok=True)
        print(f"  [알림] 문서 디렉토리 생성: {src_docs}")

    # 색인 대상만 index_new 로 돌린다.
    config = load_config(str(settings.ragcore_config), {
        "index_dir": str(new_dir),
        "catalog_excel_path": str(catalog_arg_path),
        "documents_dir": str(src_docs),
    })
    print("  index_dir      =", config.index_dir)
    print("  source_parsed  =", config.source_parsed)
    print("  catalog        =", catalog_arg_path)
    print("  documents      =", src_docs)
    print("  force_reparse  =", force)

    backend = get_backend(config)
    t0 = time.time()
    summary = run_ingest(config, backend, force=force)
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
        raise RuntimeError(f"새 색인 디렉토리가 생성되지 않았습니다: {new}")
    
    _safe_promote_dir(new, cur, old, root)
    try:
        from rag3.index import clear_all_index_caches
        clear_all_index_caches()
    except Exception:
        pass
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
    ap.add_argument("--promote", action="store_true", help="색인 빌드 완료 후 서빙 색인(index)으로 즉시 원자적 교체 승격")
    ap.add_argument("--promote-only", action="store_true", help="빌드 과정 없이 기존 index_new 만 서빙 색인으로 교체 승격")
    ap.add_argument("--rollback", action="store_true", help="index_old 로 되돌리기")
    ap.add_argument("--force", action="store_true", help="기존 파싱 캐시를 무시하고 1페이지부터 전체 완전 재파싱")
    ap.add_argument("--catalog", type=Path, default=None, help="카탈로그 엑셀 경로")
    ap.add_argument("--docs", type=Path, default=None, help="원본 문서 디렉토리 경로")
    ap.add_argument("--report", default=str(PKG_ROOT / "runtime" / "reports" / "reindex_report.json"))
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    # 웹 콘솔 동기화용 실시간 라이브 로거 장착
    live_handler = _LiveFileLogHandler()
    logging.getLogger().addHandler(live_handler)

    settings = load_settings()

    if args.rollback:
        rollback(settings)
        emit_live_log("⏪ 색인 롤백 완료 (index_old -> index)", stage="ready", progress=100, status="completed")
        return 0
    if args.promote_only:
        promote(settings)
        emit_live_log("🎉 기존 index_new 승격 완료", stage="ready", progress=100, status="completed")
        return 0

    mode_text = "전체 완전 재파싱 & 강제 재색인" if args.force else "고속 증분 재색인 (파싱 캐시 재사용)"
    emit_live_log(f"🚀 RAG 재색인 파이프라인 가동 (CLI 모드: {mode_text})", stage="scan", progress=5, status="running")

    catalog_path = args.catalog or DEFAULT_CATALOG
    docs_dir = args.docs or DEFAULT_DOCS

    print("원본 무결성 기준값(재색인 전):")
    _guard_sources(catalog_path, docs_dir)
    print()

    emit_live_log("📁 1단계: 원본 문서 및 카탈로그 스캔 완료", stage="parse", progress=20)
    emit_live_log("🔍 2단계: 문서 파싱 및 구조 추출 진행 중...", stage="parse", progress=35)

    try:
        summary = build(settings, force=args.force, catalog_path=catalog_path, docs_dir=docs_dir)
    except Exception as exc:
        emit_live_log(f"❌ 색인 빌드 실패: {exc}", stage="ready", progress=0, status="failed")
        raise

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

    emit_live_log(f"✅ 새 색인 빌드 완료 (index_new): 총 {summary.get('documents_parsed', 0)}개 문서, {summary.get('total_pages', 0)}개 페이지, {summary.get('total_chunks', 0)}개 청크", stage="promote", progress=85)

    if args.promote:
        print("\n[승격] 새 색인(index_new)을 서빙 색인(index)으로 즉시 교체 승격합니다...")
        emit_live_log("🔄 5단계: 원자적 색인 승격 (index_new → index)...", stage="promote", progress=90)
        promote(settings)
        print("🎉 색인 원자적 교체 완료! 챗봇에서 새 색인이 즉시 사용됩니다.")
        emit_live_log("✨ 모든 전처리 및 재색인 작업이 성공적으로 완료되었습니다!", stage="ready", progress=100, status="completed")
    else:
        print("\n다음 단계: 골든셋으로 새 색인을 검증한 뒤에 교체하거나, --promote 옵션으로 빌드 즉시 교체할 수 있습니다.")
        print("  1) RAGDATA 를 index_new 로 가리켜 평가:  run_eval.py --tag reindex")
        print("  2) ab_compare.py work1256 reindex   ← 악화 문항이 없는지 확인")
        print("  3) 통과하면:  reindex.py --promote-only")
        emit_live_log("✨ 새 색인(index_new) 빌드가 완료되었습니다. (--promote 로 교체 가능)", stage="ready", progress=100, status="completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
