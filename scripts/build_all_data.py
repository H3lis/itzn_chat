# -*- coding: utf-8 -*-
"""chatbot_demo_v2 통합 데이터 빌드 파이프라인.

raw_data/ 폴더(카탈로그, 원본 문서, FAQ 엑셀)를 기반으로
서빙 및 RAG에 필요한 모든 데이터(faq.json, 임베딩, 문서 링크, RAG 색인)를 일괄 처리합니다.

실행:
    # 1. FAQ 데이터만 전체 가공 (엑셀 import -> 임베딩 -> 근거문서 링크 생성)
    python chatbot_demo_v2/scripts/build_all_data.py --faq-only

    # 2. RAG 색인만 재구축 및 서빙 적용
    python chatbot_demo_v2/scripts/build_all_data.py --reindex-only

    # 3. 전체 일괄 빌드 및 적용
    python chatbot_demo_v2/scripts/build_all_data.py --all
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[1]


def run_step(name: str, cmd: list[str]) -> bool:
    print(f"\n{'='*70}")
    print(f">> [{name}] 실행: {' '.join(cmd)}")
    print(f"{'='*70}")
    t0 = time.time()
    res = subprocess.run([sys.executable, "-X", "utf8"] + cmd, cwd=str(PKG_ROOT))
    elapsed = time.time() - t0
    if res.returncode != 0:
        print(f"[FAIL] [{name}] 실패 (종료 코드: {res.returncode}, 소요: {elapsed:.1f}s)")
        return False
    print(f"[OK] [{name}] 완료 ({elapsed:.1f}s)")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="chatbot_demo_v2 데이터 통합 가공 파이프라인")
    parser.add_argument("--all", action="store_true", help="FAQ 가공 및 RAG 재색인 전체 실행")
    parser.add_argument("--faq-only", action="store_true", help="FAQ 엑셀 변환, 임베딩, 문서링크만 생성")
    parser.add_argument("--reindex-only", action="store_true", help="RAG 색인만 재구축 및 교체")
    parser.add_argument("--faq-excel", type=str, default=None, help="지정할 FAQ 엑셀 경로")
    args = parser.parse_args()

    do_faq = args.all or args.faq_only or (not args.reindex_only)
    do_reindex = args.all or args.reindex_only

    print("======================================================================")
    print("  chatbot_demo_v2 데이터 가공 파이프라인")
    print(f"  - FAQ 처리: {'예' if do_faq else '아니오'}")
    print(f"  - RAG 재색인: {'예' if do_reindex else '아니오'}")
    print("======================================================================")

    # 1. FAQ 엑셀 Import
    if do_faq:
        faq_dir = PKG_ROOT / "raw_data" / "faq"
        faq_files = list(faq_dir.glob("*.xlsx")) if faq_dir.is_dir() else []
        has_faq_excel = bool(args.faq_excel) or bool(faq_files)

        if has_faq_excel:
            import_cmd = ["scripts/import_faq.py"]
            if args.faq_excel:
                import_cmd.extend(["--excel", args.faq_excel])
            if not run_step("1. FAQ 엑셀 Import", import_cmd):
                return 1
        else:
            print("\n[INFO] raw_data/faq/ 내에 신규 엑셀 파일이 없어 기존 data/faq.json을 유지합니다.")

        # 2. FAQ 질문 임베딩 생성
        if not run_step("2. FAQ 임베딩 생성", ["scripts/build_faq_embeddings.py"]):
            return 1

        # 3. FAQ 근거 문서 링크 매핑
        if not run_step("3. FAQ 근거 문서 링크 생성", ["scripts/build_faq_doc_links.py"]):
            return 1

    # 4. RAG 재색인 빌드 및 서빙 적용
    if do_reindex:
        if not run_step("4-1. RAG 새 색인 빌드 (index_new)", ["scripts/reindex.py", "--force"]):
            return 1
        if not run_step("4-2. RAG 색인 교체 승격 (promote)", ["scripts/reindex.py", "--promote"]):
            return 1

    print("\n[SUCCESS] 모든 데이터 가공 및 빌드가 성공적으로 완료되었습니다!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
