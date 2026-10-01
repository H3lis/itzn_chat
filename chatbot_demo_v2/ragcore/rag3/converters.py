# -*- coding: utf-8 -*-
"""다양한 문서 포맷(XLSX, DOCX, HWP/HWPX, TXT/MD) 파싱 및 PDF 자동 변환 모듈.

- DOCX, HWP/HWPX: LibreOffice(soffice) 헤드리스 엔진을 통해 고품질 PDF로 자동 변환 후
  기존 MinerU/pdfplumber 파이프라인으로 연결하거나, LibreOffice가 없을 시 python-docx/pyhwp로
  직접 텍스트/표를 구조화하여 색인합니다.
- XLSX/XLS/CSV: PDF로 강제 변환하지 않고 시트별 데이터를 고품질 마크다운 표(Markdown Table)로
  직접 추출하여 가상 페이지 및 시맨틱 청크로 완벽 색인합니다.
- TXT/MD: 일반 텍스트 및 마크다운 파일도 분할하여 즉시 색인합니다.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pandas as pd

from .config import Config
from .parse import DocumentInfo, PageRecord
from .utils import doc_slug

logger = logging.getLogger(__name__)

SUPPORTED_DOCUMENT_EXTENSIONS: set[str] = {
    ".pdf",
    ".docx",
    ".hwpx",
    ".hwp",
    ".xlsx",
    ".xls",
    ".csv",
    ".txt",
    ".md",
}


def _find_libreoffice_binary() -> str | None:
    """시스템에서 LibreOffice(soffice) 실행 경로를 탐색합니다."""
    # 1. PATH 환경변수 우선
    which_path = shutil.which("soffice") or shutil.which("libreoffice")
    if which_path:
        return which_path

    # 2. Windows 기본 설치 경로 확인
    win_paths = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]
    for p in win_paths:
        if os.path.isfile(p):
            return p

    # 3. Linux 기본 설치 경로 확인
    linux_paths = [
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/usr/local/bin/soffice",
    ]
    for p in linux_paths:
        if os.path.isfile(p):
            return p

    return None


def try_convert_to_pdf(input_path: Path, output_dir: Path) -> Path | None:
    """LibreOffice를 호출하여 문서를 PDF로 변환합니다. 실패하거나 미설치 시 None 반환."""
    soffice = _find_libreoffice_binary()
    if not soffice:
        logger.debug("LibreOffice(soffice) 미설치 — 파이썬 직접 파싱 폴백으로 진행합니다.")
        return None

    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            soffice,
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(input_path),
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=120)
        if res.returncode != 0:
            logger.warning("LibreOffice 변환 실패 (%s): %s", input_path.name, res.stderr.decode(errors="ignore"))
            return None

        expected_pdf = output_dir / f"{input_path.stem}.pdf"
        if expected_pdf.is_file():
            logger.info("[%s] LibreOffice -> PDF 변환 성공: %s", input_path.name, expected_pdf)
            return expected_pdf
    except Exception as e:
        logger.warning("[%s] PDF 변환 중 예외 발생: %s", input_path.name, e)

    return None


# ============================================================================
# 1. 엑셀 파일 (.xlsx, .xls, .csv) -> 시트별 마크다운 표 파서
# ============================================================================

def _dataframe_to_markdown_table(df: pd.DataFrame, max_col_width: int = 200) -> str:
    """데이터프레임을 깨끗하고 견고한 마크다운 표 문자열로 변환합니다."""
    if df.empty:
        return ""

    headers = [str(col).replace("\n", " ").strip() for col in df.columns]
    # 빈 컬럼명 정리
    headers = [h if h and not h.startswith("Unnamed:") else f"열_{i+1}" for i, h in enumerate(headers)]

    header_line = "| " + " | ".join(headers) + " |"
    sep_line = "| " + " | ".join("---" for _ in headers) + " |"

    body_lines = []
    for _, row in df.iterrows():
        row_vals = []
        for val in row:
            if pd.isna(val) or val is None:
                val_str = ""
            else:
                val_str = str(val).replace("\r\n", " ").replace("\n", " ").replace("|", "\\|").strip()
                if len(val_str) > max_col_width:
                    val_str = val_str[:max_col_width] + "…"
            row_vals.append(val_str)
        # 행 전체가 비어있지 않은 경우만 포함
        if any(row_vals):
            body_lines.append("| " + " | ".join(row_vals) + " |")

    if not body_lines:
        return ""

    return "\n".join([header_line, sep_line] + body_lines)


def parse_excel_file(abs_path: Path, rel_path: str, config: Config) -> DocumentInfo:
    """엑셀(.xlsx, .xls, .csv) 파일을 읽어 시트별 마크다운 표로 구조화된 DocumentInfo를 생성합니다."""
    slug = doc_slug(rel_path)
    document_name = abs_path.name
    ext = abs_path.suffix.lower()

    sheet_dict: dict[str, pd.DataFrame] = {}
    try:
        if ext == ".csv":
            # CSV 인코딩 자동 감지 시도 (utf-8 -> cp949 -> euc-kr)
            for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
                try:
                    df = pd.read_csv(abs_path, encoding=enc)
                    sheet_dict["Sheet1"] = df
                    break
                except Exception:
                    continue
        else:
            with pd.ExcelFile(abs_path) as excel_file:
                for sname in excel_file.sheet_names:
                    try:
                        df = pd.read_excel(excel_file, sheet_name=sname)
                        if not df.empty and df.dropna(how="all").shape[0] > 0:
                            sheet_dict[sname] = df
                    except Exception as se:
                        logger.warning("[%s] 시트 '%s' 읽기 실패: %s", document_name, sname, se)
    except Exception as e:
        logger.error("[%s] 엑셀 파일 로드 실패: %s", document_name, e)
        raise RuntimeError(f"엑셀 파일 로드 실패: {e}") from e


    pages: list[PageRecord] = []
    page_num = 1
    rows_per_page = 40  # 대형 시트 분할 단위 (헤더 보존)

    for sname, df in sheet_dict.items():
        # 완전 빈 행/열 정리
        clean_df = df.dropna(how="all").dropna(axis=1, how="all")
        if clean_df.empty:
            continue

        total_rows = len(clean_df)
        total_subpages = max(1, (total_rows + rows_per_page - 1) // rows_per_page)

        for sub_idx in range(total_subpages):
            start_r = sub_idx * rows_per_page
            end_r = min(start_r + rows_per_page, total_rows)
            chunk_df = clean_df.iloc[start_r:end_r]

            table_md = _dataframe_to_markdown_table(chunk_df)
            if not table_md.strip():
                continue

            page_header = f"### [시트: {sname}] (데이터 {start_r+1}~{end_r}행 / 총 {total_rows}행)\n\n"
            full_text = page_header + table_md

            pages.append(
                PageRecord(
                    document_name=document_name,
                    file_path=rel_path,
                    doc_slug=slug,
                    page_number=page_num,
                    page_type="table",
                    text=full_text,
                    is_scanned=False,
                    has_table=True,
                    table_markdown=table_md,
                    table_crop_path="",
                    page_image_path="",
                    figure_area_ratio=0.0,
                    char_count=len(full_text),
                )
            )
            page_num += 1

    if not pages:
        # 데이터가 비어 있는 경우 기본 레코드 1장 생성
        empty_text = f"### [{document_name}]\n(내용이 비어 있거나 유효한 데이터 표를 찾지 못했습니다.)"
        pages.append(
            PageRecord(
                document_name=document_name,
                file_path=rel_path,
                doc_slug=slug,
                page_number=1,
                page_type="table",
                text=empty_text,
                is_scanned=False,
                has_table=False,
                table_markdown="",
                table_crop_path="",
                page_image_path="",
                figure_area_ratio=0.0,
                char_count=len(empty_text),
            )
        )

    logger.info("[%s] 엑셀 마크다운 표 파싱 완료: %d개 가상 페이지 레코드 생성", document_name, len(pages))
    return DocumentInfo(
        document_name=document_name,
        rel_path=rel_path,
        abs_path=str(abs_path),
        doc_slug=slug,
        page_count=len(pages),
        parser_used="excel_markdown_table",
        pages=pages,
    )


# ============================================================================
# 2. 워드 문서 (.docx) 파서 (PDF 변환 우선 + python-docx 직접 파싱 폴백)
# ============================================================================

def parse_docx_file(abs_path: Path, rel_path: str, config: Config) -> DocumentInfo:
    """DOCX 파일을 파싱합니다. LibreOffice로 PDF 변환을 우선 시도하고, 부재 시 python-docx로 직접 파싱합니다."""
    slug = doc_slug(rel_path)
    document_name = abs_path.name

    # 1. LibreOffice를 통한 PDF 변환 시도
    conv_dir = config.cache_dir / "converted_pdf" / slug
    converted_pdf = try_convert_to_pdf(abs_path, conv_dir)
    if converted_pdf and converted_pdf.is_file():
        logger.info("[%s] DOCX -> PDF 변환 성공. 표준 PDF 파이프라인으로 파싱합니다.", document_name)
        from .parse import parse_document
        doc_info = parse_document(converted_pdf, rel_path, config)
        doc_info.document_name = document_name
        doc_info.abs_path = str(abs_path)
        doc_info.parser_used = f"docx_to_pdf_{doc_info.parser_used}"
        return doc_info

    # 2. python-docx 직접 파싱 폴백
    logger.info("[%s] python-docx 엔진으로 본문 및 표를 직접 파싱합니다.", document_name)
    import docx

    doc = docx.Document(str(abs_path))
    pages: list[PageRecord] = []

    # 단락(Paragraph)과 표(Table)를 문서 내 등장 순서대로 텍스트 블록화
    sections: list[str] = []
    current_section: list[str] = []
    current_chars = 0
    target_page_chars = 1200

    def flush_section():
        nonlocal current_section, current_chars
        if current_section:
            sections.append("\n\n".join(current_section))
            current_section = []
            current_chars = 0

    # docx의 body element 순회
    for elem in doc.element.body:
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag == "p":
            p = docx.text.paragraph.Paragraph(elem, doc)
            text = p.text.strip()
            if not text:
                continue
            # 헤딩 스타일 확인
            style_name = (p.style.name or "").lower()
            if "heading 1" in style_name:
                flush_section()
                text = f"# {text}"
            elif "heading 2" in style_name:
                flush_section()
                text = f"## {text}"
            elif "heading 3" in style_name:
                text = f"### {text}"

            current_section.append(text)
            current_chars += len(text)
            if current_chars >= target_page_chars:
                flush_section()

        elif tag == "tbl":
            t = docx.table.Table(elem, doc)
            table_rows = []
            for row in t.rows:
                row_vals = [cell.text.replace("\n", " ").strip() for cell in row.cells]
                table_rows.append(row_vals)
            if table_rows:
                # 데이터프레임으로 변환 후 마크다운 표 생성
                headers = table_rows[0]
                headers = [h if h else f"열_{idx+1}" for idx, h in enumerate(headers)]
                body = table_rows[1:] if len(table_rows) > 1 else []
                df = pd.DataFrame(body, columns=headers) if body else pd.DataFrame(columns=headers)
                t_md = _dataframe_to_markdown_table(df)
                if t_md:
                    current_section.append(t_md)
                    current_chars += len(t_md)
                    if current_chars >= target_page_chars:
                        flush_section()

    flush_section()

    if not sections:
        sections = [f"# {document_name}\n\n(문서 본문이 비어 있습니다.)"]

    for idx, sec_text in enumerate(sections, start=1):
        has_table = "|" in sec_text and "---" in sec_text
        pages.append(
            PageRecord(
                document_name=document_name,
                file_path=rel_path,
                doc_slug=slug,
                page_number=idx,
                page_type="table" if has_table else "text",
                text=sec_text,
                is_scanned=False,
                has_table=has_table,
                table_markdown=sec_text if has_table else "",
                table_crop_path="",
                page_image_path="",
                figure_area_ratio=0.0,
                char_count=len(sec_text),
            )
        )

    logger.info("[%s] DOCX 직접 파싱 완료: %d개 가상 페이지 생성", document_name, len(pages))
    return DocumentInfo(
        document_name=document_name,
        rel_path=rel_path,
        abs_path=str(abs_path),
        doc_slug=slug,
        page_count=len(pages),
        parser_used="docx_direct",
        pages=pages,
    )


# ============================================================================
# 3. 한글 문서 (.hwpx, .hwp) 파서 (PDF 변환 우선 + XML/pyhwp 직접 파싱 폴백)
# ============================================================================

def _parse_hwpx_xml(abs_path: Path) -> list[str]:
    """HWPX(Zip+XML) 내부 section0.xml 등에서 텍스트 및 표를 추출합니다."""
    extracted_sections: list[str] = []
    with zipfile.ZipFile(abs_path, "r") as zf:
        section_names = [n for n in zf.namelist() if re.search(r"Contents/section\d+\.xml", n)]
        section_names.sort()
        for sname in section_names:
            xml_bytes = zf.read(sname)
            root = ET.fromstring(xml_bytes)
            # 네임스페이스 무관하게 모든 단락(p) 및 텍스트(t) 추출
            texts = []
            for elem in root.iter():
                tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                if tag == "t" and elem.text:
                    texts.append(elem.text.strip())
                elif tag == "p" and texts:
                    # 줄바꿈
                    texts.append("\n")
            sec_full = "".join(texts).strip()
            # 연속 줄바꿈 정제
            sec_full = re.sub(r"\n{3,}", "\n\n", sec_full)
            if sec_full:
                extracted_sections.append(sec_full)
    return extracted_sections


def _parse_hwp_binary(abs_path: Path) -> list[str]:
    """구형 HWP 바이너리에서 pyhwp 또는 olefile을 통해 텍스트를 추출합니다."""
    # 1. pyhwp의 hwp5txt 시도
    try:
        import hwp5.hwp5txt
        out_buf = io.StringIO()
        # hwp5txt를 통한 텍스트 덤프
        app = hwp5.hwp5txt.Hwp5TxtApp()
        app.run([str(abs_path), "--output", "-"], stdout=out_buf)
        content = out_buf.getvalue().strip()
        if content:
            return [content]
    except Exception as e:
        logger.debug("[%s] pyhwp hwp5txt 실행 중 알림 (olefile 폴백 시도): %s", abs_path.name, e)

    # 2. olefile 직접 파싱 폴백
    try:
        import olefile
        if olefile.isOleFile(str(abs_path)):
            ole = olefile.OleFileIO(str(abs_path))
            # PrvText 스트림 (HWP 미리보기 텍스트) 우선 확인
            if ole.exists("PrvText"):
                raw = ole.openstream("PrvText").read()
                text = raw.decode("utf-16le", errors="ignore").strip()
                if text:
                    return [text]
            # BodyText/Section0 등 스트림 압축 해제 시도
            import zlib
            body_texts = []
            for stream in ole.listdir():
                if len(stream) == 2 and stream[0] == "BodyText" and stream[1].startswith("Section"):
                    try:
                        compressed = ole.openstream(stream).read()
                        decompressed = zlib.decompress(compressed, -15)
                        sec_text = decompressed.decode("utf-16le", errors="ignore")
                        clean_text = "".join(ch for ch in sec_text if ch.isprintable() or ch in "\n\r\t ")
                        if clean_text.strip():
                            body_texts.append(clean_text.strip())
                    except Exception:
                        continue
            if body_texts:
                return body_texts
    except Exception as e:
        logger.warning("[%s] olefile 파싱 실패: %s", abs_path.name, e)

    return []


def parse_hwp_file(abs_path: Path, rel_path: str, config: Config) -> DocumentInfo:
    """HWP/HWPX 파일을 파싱합니다. PDF 변환을 우선 시도하고 부재 시 XML/pyhwp로 직접 파싱합니다."""
    slug = doc_slug(rel_path)
    document_name = abs_path.name
    ext = abs_path.suffix.lower()

    # 1. LibreOffice를 통한 PDF 변환 시도
    conv_dir = config.cache_dir / "converted_pdf" / slug
    converted_pdf = try_convert_to_pdf(abs_path, conv_dir)
    if converted_pdf and converted_pdf.is_file():
        logger.info("[%s] HWP -> PDF 변환 성공. 표준 PDF 파이프라인으로 파싱합니다.", document_name)
        from .parse import parse_document
        doc_info = parse_document(converted_pdf, rel_path, config)
        doc_info.document_name = document_name
        doc_info.abs_path = str(abs_path)
        doc_info.parser_used = f"hwp_to_pdf_{doc_info.parser_used}"
        return doc_info

    # 2. 파이썬 직접 파싱 폴백
    logger.info("[%s] 파이썬 내장/라이브러리 엔진으로 한글 문서를 직접 파싱합니다.", document_name)
    sections: list[str] = []
    if ext == ".hwpx":
        sections = _parse_hwpx_xml(abs_path)
    else:
        sections = _parse_hwp_binary(abs_path)

    if not sections:
        sections = [f"# {document_name}\n\n(한글 문서 본문을 추출하지 못했습니다.)"]

    pages: list[PageRecord] = []
    page_num = 1
    target_page_chars = 1200

    for sec in sections:
        # 긴 섹션은 1200자 내외로 분할
        paras = [p.strip() for p in sec.split("\n") if p.strip()]
        cur_text = ""
        for p in paras:
            if len(cur_text) + len(p) > target_page_chars and len(cur_text) >= 400:
                pages.append(
                    PageRecord(
                        document_name=document_name,
                        file_path=rel_path,
                        doc_slug=slug,
                        page_number=page_num,
                        page_type="text",
                        text=cur_text.strip(),
                        is_scanned=False,
                        has_table=False,
                        table_markdown="",
                        table_crop_path="",
                        page_image_path="",
                        figure_area_ratio=0.0,
                        char_count=len(cur_text.strip()),
                    )
                )
                page_num += 1
                cur_text = p + "\n"
            else:
                cur_text += p + "\n"
        if cur_text.strip():
            pages.append(
                PageRecord(
                    document_name=document_name,
                    file_path=rel_path,
                    doc_slug=slug,
                    page_number=page_num,
                    page_type="text",
                    text=cur_text.strip(),
                    is_scanned=False,
                    has_table=False,
                    table_markdown="",
                    table_crop_path="",
                    page_image_path="",
                    figure_area_ratio=0.0,
                    char_count=len(cur_text.strip()),
                )
            )
            page_num += 1

    logger.info("[%s] 한글 직접 파싱 완료: %d개 가상 페이지 생성", document_name, len(pages))
    return DocumentInfo(
        document_name=document_name,
        rel_path=rel_path,
        abs_path=str(abs_path),
        doc_slug=slug,
        page_count=len(pages),
        parser_used="hwpx_xml" if ext == ".hwpx" else "hwp_direct",
        pages=pages,
    )


# ============================================================================
# 4. 일반 텍스트 및 마크다운 (.txt, .md) 파서
# ============================================================================

def parse_text_file(abs_path: Path, rel_path: str, config: Config) -> DocumentInfo:
    """TXT, MD 파일을 읽어 가상 페이지 레코드로 파싱합니다."""
    slug = doc_slug(rel_path)
    document_name = abs_path.name

    raw_bytes = abs_path.read_bytes()
    content = ""
    for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            content = raw_bytes.decode(enc)
            break
        except Exception:
            continue
    if not content:
        content = raw_bytes.decode("utf-8", errors="ignore")

    pages: list[PageRecord] = []
    paras = [p.strip() for p in content.split("\n") if p.strip()]
    cur_text = ""
    page_num = 1
    target_page_chars = 1200

    for p in paras:
        if len(cur_text) + len(p) > target_page_chars and len(cur_text) >= 400:
            pages.append(
                PageRecord(
                    document_name=document_name,
                    file_path=rel_path,
                    doc_slug=slug,
                    page_number=page_num,
                    page_type="text",
                    text=cur_text.strip(),
                    is_scanned=False,
                    has_table=False,
                    table_markdown="",
                    table_crop_path="",
                    page_image_path="",
                    figure_area_ratio=0.0,
                    char_count=len(cur_text.strip()),
                )
            )
            page_num += 1
            cur_text = p + "\n"
        else:
            cur_text += p + "\n"
    if cur_text.strip():
        pages.append(
            PageRecord(
                document_name=document_name,
                file_path=rel_path,
                doc_slug=slug,
                page_number=page_num,
                page_type="text",
                text=cur_text.strip(),
                is_scanned=False,
                has_table=False,
                table_markdown="",
                table_crop_path="",
                page_image_path="",
                figure_area_ratio=0.0,
                char_count=len(cur_text.strip()),
            )
        )

    logger.info("[%s] 텍스트 파싱 완료: %d개 가상 페이지 생성", document_name, len(pages))
    return DocumentInfo(
        document_name=document_name,
        rel_path=rel_path,
        abs_path=str(abs_path),
        doc_slug=slug,
        page_count=len(pages),
        parser_used="text_direct",
        pages=pages,
    )
