/**
 * 학교 유무선 장애상담 챗봇 — 통합 관리자 페이지 프론트엔드 스크립트 (admin.js)
 * 1. 3대 탭 네비게이션 (FAQ 관리, RAG 문서 & 재색인, 웹 검색 설정)
 * 2. FAQ 관리 (조회, 통계, 검색/필터링, 페이징, 등록/수정/삭제 모달, 즉시 핫리로드)
 * 3. RAG 문서 관리 (조회, 업로드, 이름변경 Rename, 삭제)
 * 4. 5단계 사전 청킹/재색인 파이프라인 (진행률 스테퍼 및 SSE 실시간 터미널 스트리밍)
 * 5. 외부 웹 검색 (Google Search Grounding) 토글 및 상태/예산 모니터링
 */

document.addEventListener("DOMContentLoaded", () => {
  // ==================== DOM 요소 참조 ====================
  // 상단 탭
  const tabBtns = document.querySelectorAll(".nav-tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const tabBadgeFaq = document.getElementById("tab-badge-faq");
  const tabBadgeDocs = document.getElementById("tab-badge-docs");
  const tabBadgeScenario = document.getElementById("tab-badge-scenario");
  const tabBadgeWebsearch = document.getElementById("tab-badge-websearch");

  // RAG 통계 대시보드
  const statDocs = document.getElementById("stat-docs");
  const statRawSize = document.getElementById("stat-raw-size");
  const statPages = document.getElementById("stat-pages");
  const statChunks = document.getElementById("stat-chunks");
  const statIndexPages = document.getElementById("stat-index-pages");
  const statBackend = document.getElementById("stat-backend");
  const statIndexTime = document.getElementById("stat-index-time");
  const connStatus = document.getElementById("conn-status");

  // FAQ 관리 요소
  const faqStatTotal = document.getElementById("faq-stat-total");
  const faqStatSheets = document.getElementById("faq-stat-sheets");
  const faqSheetFilter = document.getElementById("faq-sheet-filter");
  const faqFaultFilter = document.getElementById("faq-fault-filter");
  const faqSearchInput = document.getElementById("faq-search-input");
  const btnRefreshFaq = document.getElementById("btn-refresh-faq");
  const btnAddFaq = document.getElementById("btn-add-faq");
  const faqTbody = document.getElementById("faq-tbody");
  const faqPagination = document.getElementById("faq-pagination");
  const faqPageInfo = document.getElementById("faq-page-info");
  const faqPaginationButtons = document.getElementById("faq-pagination-buttons");

  // FAQ 모달 요소
  const faqModal = document.getElementById("faq-modal");
  const faqModalTitle = document.getElementById("faq-modal-title");
  const btnFaqModalClose = document.getElementById("btn-faq-modal-close");
  const btnFaqModalCancel = document.getElementById("btn-faq-modal-cancel");
  const faqForm = document.getElementById("faq-form");
  const faqFormId = document.getElementById("faq-form-id");
  const faqFormSheet = document.getElementById("faq-form-sheet");
  const faqFormFault = document.getElementById("faq-form-fault");
  const faqFormQuestion = document.getElementById("faq-form-question");
  const faqFormQnorm = document.getElementById("faq-form-qnorm");
  const faqFormAnswer = document.getElementById("faq-form-answer");
  const faqFormSource = document.getElementById("faq-form-source");

  // RAG 문서 관리 요소
  const docTbody = document.getElementById("doc-tbody");
  const docSearch = document.getElementById("doc-search");
  const btnRefreshDocs = document.getElementById("btn-refresh-docs");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const uploadProgressList = document.getElementById("upload-progress-list");

  // 문서 이름변경 모달 요소
  const docRenameModal = document.getElementById("doc-rename-modal");
  const btnRenameClose = document.getElementById("btn-rename-close");
  const btnRenameCancel = document.getElementById("btn-rename-cancel");
  const docRenameForm = document.getElementById("doc-rename-form");
  const renameOldPath = document.getElementById("rename-old-path");
  const renameCurrentName = document.getElementById("rename-current-name");
  const renameNewName = document.getElementById("rename-new-name");

  // RAG 재색인 요소
  const btnReindex = document.getElementById("btn-reindex");
  const btnReindexText = document.getElementById("btn-reindex-text");
  const reindexSpinner = document.getElementById("reindex-spinner");
  const chkForce = document.getElementById("chk-force");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const terminalStatusBadge = document.getElementById("terminal-status-badge");
  const terminalBody = document.getElementById("terminal-body");
  const btnClearLogs = document.getElementById("btn-clear-logs");
  const btnCopyLogs = document.getElementById("btn-copy-logs");
  const summaryBox = document.getElementById("reindex-summary-box");
  const summaryMetrics = document.getElementById("summary-metrics");
  const toastEl = document.getElementById("toast");

  // 웹 검색 요소
  const websearchCard = document.getElementById("websearch-card");
  const websearchBadge = document.getElementById("websearch-badge");
  const websearchModel = document.getElementById("websearch-model");
  const websearchScope = document.getElementById("websearch-scope");
  const websearchBudget = document.getElementById("websearch-budget");
  const websearchUsage = document.getElementById("websearch-usage");
  const websearchToggleLabel = document.getElementById("websearch-toggle-label");
  const toggleWebSearch = document.getElementById("toggle-web-search");
  const topbarWebsearchStatus = document.getElementById("topbar-websearch-status");

  // [Phase 2] 시나리오 에디터 요소
  const scenarioTreeStats = document.getElementById("scenario-tree-stats");
  const scenarioIntegrityBadge = document.getElementById("scenario-integrity-badge");
  const scenarioIntegrityText = document.getElementById("scenario-integrity-text");
  const btnValidateScenario = document.getElementById("btn-validate-scenario");
  const btnCreateScenarioNode = document.getElementById("btn-create-scenario-node");
  const scenarioValidationAlert = document.getElementById("scenario-validation-alert");
  const scenarioNodeCount = document.getElementById("scenario-node-count");
  const scenarioTreeSearch = document.getElementById("scenario-tree-search");
  const scenarioTreeContainer = document.getElementById("scenario-tree-container");
  const scenarioEditorEmpty = document.getElementById("scenario-editor-empty");
  const scenarioNodeForm = document.getElementById("scenario-node-form");
  const formNodeTypeBadge = document.getElementById("form-node-type-badge");
  const formNodeIdDisplay = document.getElementById("form-node-id-display");
  const btnDeleteScenarioNode = document.getElementById("btn-delete-scenario-node");
  const btnSaveScenarioNode = document.getElementById("btn-save-scenario-node");
  const formNodeId = document.getElementById("form-node-id");
  const formScenarioId = document.getElementById("form-scenario-id");
  const formNodeType = document.getElementById("form-node-type");
  const formNodeText = document.getElementById("form-node-text");
  const sectionBranchOptions = document.getElementById("section-branch-options");
  const btnAddOptionRow = document.getElementById("btn-add-option-row");
  const optionsTbody = document.getElementById("options-tbody");
  const sectionTerminalAnswer = document.getElementById("section-terminal-answer");
  const formAnswerSource = document.getElementById("form-answer-source");
  const groupAnswerRef = document.getElementById("group-answer-ref");
  const formAnswerRef = document.getElementById("form-answer-ref");
  const groupAnswerText = document.getElementById("group-answer-text");
  const formAnswerText = document.getElementById("form-answer-text");

  // [Phase 2] 신규 노드 생성 모달 요소
  const scenarioCreateModal = document.getElementById("scenario-create-modal");
  const btnScenarioModalClose = document.getElementById("btn-scenario-modal-close");
  const btnScenarioModalCancel = document.getElementById("btn-scenario-modal-cancel");
  const scenarioCreateForm = document.getElementById("scenario-create-form");
  const modalNewNodeId = document.getElementById("modal-new-node-id");
  const modalNewScenarioId = document.getElementById("modal-new-scenario-id");
  const modalNewNodeType = document.getElementById("modal-new-node-type");
  const modalNewNodeText = document.getElementById("modal-new-node-text");

  // [Phase 2] 메타데이터 사이드 드로어 요소
  const metaDrawerOverlay = document.getElementById("meta-drawer-overlay");
  const drawerDocName = document.getElementById("drawer-doc-name");
  const drawerMetaInfo = document.getElementById("drawer-meta-info");
  const btnDrawerClose = document.getElementById("btn-drawer-close");
  const btnDrawerCancel = document.getElementById("btn-drawer-cancel");
  const btnAiExtractMeta = document.getElementById("btn-ai-extract-meta");
  const btnAiExtractText = document.getElementById("btn-ai-extract-text");
  const metaExtractSpinner = document.getElementById("meta-extract-spinner");
  const docMetaForm = document.getElementById("doc-meta-form");
  const metaRelPath = document.getElementById("meta-rel-path");
  const metaInputTitle = document.getElementById("meta-input-title");
  const metaInputSummary = document.getElementById("meta-input-summary");
  const metaInputKeywords = document.getElementById("meta-input-keywords");
  const metaKeywordTags = document.getElementById("meta-keyword-tags");
  const metaInputPublisher = document.getElementById("meta-input-publisher");
  const metaScopeRoles = document.getElementById("meta-scope-roles");
  const metaScopeEquipment = document.getElementById("meta-scope-equipment");
  const metaScopeSpaces = document.getElementById("meta-scope-spaces");
  const drawerExtractedAt = document.getElementById("drawer-extracted-at");
  const btnDrawerSave = document.getElementById("btn-drawer-save");

  // ==================== 상태 변수 ====================
  let currentFaqPage = 1;
  const faqPageSize = 15;
  let faqSearchTimer = null;

  let documentsCache = [];
  let eventSource = null;
  let isReindexing = false;

  // [Phase 2] 시나리오 상태
  let scenarioTreeCache = null;
  let selectedScenarioNodeId = null;

  const STAGES = ["scan", "parse", "chunk", "embed", "promote"];

  // ==================== 유틸리티: 알림 토스트 ====================
  function showToast(msg, duration = 3000) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    setTimeout(() => {
      toastEl.classList.add("hidden");
    }, duration);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ==================== 1. 탭 네비게이션 제어 ====================
  function switchTab(tabId) {
    tabBtns.forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle("active", isActive);
    });

    tabPanes.forEach(pane => {
      const isActive = pane.id === tabId;
      pane.classList.toggle("active", isActive);
    });

    localStorage.setItem("admin_active_tab", tabId);

    if (tabId === "tab-scenario") {
      loadScenarios();
    }
  }

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  // 이전 활성 탭 복원 (기본값: tab-faq)
  const savedTab = localStorage.getItem("admin_active_tab") || "tab-faq";
  switchTab(savedTab);

  // ==================== 2. FAQ 관리 로직 ====================
  async function loadFaqStats() {
    try {
      const res = await fetch("/api/admin/faq/stats");
      if (!res.ok) return;
      const data = await res.json();

      faqStatTotal.textContent = `${data.total_count}건`;
      tabBadgeFaq.textContent = `${data.total_count}`;

      // 시트별 건수 배지 렌더링
      const perSheet = data.per_sheet || {};
      faqStatSheets.innerHTML = Object.entries(perSheet)
        .map(([sheet, count]) => `
          <div class="faq-stat-pill">
            <span class="sheet-badge ${sheet}">${escapeHtml(sheet)}</span>
            <span class="val">${count}건</span>
          </div>
        `)
        .join("");

      // 시트 필터 옵션 채우기 (현재 선택값 보존)
      const currentSheet = faqSheetFilter.value;
      const sheets = data.sheets || [];
      faqFormSheet.innerHTML = sheets.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("") + `<option value="기타">기타</option>`;

      faqSheetFilter.innerHTML = `<option value="">전체 시트 (전체)</option>` +
        sheets.map(s => `<option value="${escapeHtml(s)}"${s === currentSheet ? " selected" : ""}>${escapeHtml(s)}</option>`).join("");

      // 장애유형 필터 옵션 채우기
      const currentFault = faqFaultFilter.value;
      const faultTypes = data.fault_types || [];
      faqFaultFilter.innerHTML = `<option value="">전체 장애유형 (전체)</option>` +
        faultTypes.map(f => `<option value="${escapeHtml(f)}"${f === currentFault ? " selected" : ""}>${escapeHtml(f)}</option>`).join("");

    } catch (err) {
      console.error("FAQ 통계 로드 실패:", err);
    }
  }

  async function loadFaqs(page = 1) {
    currentFaqPage = page;
    faqTbody.innerHTML = `<tr><td colspan="6" class="text-center muted" style="padding: 2.5rem;">FAQ 데이터를 불러오는 중…</td></tr>`;

    const sheet = faqSheetFilter.value;
    const faultType = faqFaultFilter.value;
    const search = faqSearchInput.value.trim();

    const params = new URLSearchParams({
      page: String(page),
      page_size: String(faqPageSize),
    });
    if (sheet) params.append("sheet", sheet);
    if (faultType) params.append("fault_type", faultType);
    if (search) params.append("search", search);

    try {
      const res = await fetch(`/api/admin/faq?${params.toString()}`);
      if (!res.ok) throw new Error("FAQ 목록 조회 실패");
      const data = await res.json();

      renderFaqTable(data.items || []);
      renderFaqPagination(data);
    } catch (err) {
      console.error("FAQ 목록 로드 실패:", err);
      faqTbody.innerHTML = `<tr><td colspan="6" class="text-center muted" style="color: var(--rose);">FAQ 로드 오류: ${err.message}</td></tr>`;
    }
  }

  function renderFaqTable(items) {
    if (!items || items.length === 0) {
      faqTbody.innerHTML = `<tr><td colspan="6" class="text-center muted" style="padding: 2.5rem;">등록된 FAQ가 없거나 검색 결과와 일치하는 항목이 없습니다.</td></tr>`;
      return;
    }

    faqTbody.innerHTML = items.map(item => {
      const sheetClass = item.sheet || "기타";
      const qNorm = item.question_normalized ? `<div style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem;">정규화: ${escapeHtml(item.question_normalized)}</div>` : "";
      const sourceTag = item.source_files && item.source_files.length > 0 
        ? `<div style="font-size: 0.72rem; color: #94a3b8; margin-top: 0.25rem;">출처: ${escapeHtml(item.source_files.join(", "))}</div>` 
        : "";

      return `
        <tr data-id="${escapeHtml(item.id)}">
          <td><span class="faq-id-badge">${escapeHtml(item.id)}</span></td>
          <td><span class="sheet-badge ${sheetClass}">${escapeHtml(item.sheet)}</span></td>
          <td><span class="fault-tag">${escapeHtml(item.fault_type || "일반")}</span></td>
          <td>
            <div class="faq-q-text">${escapeHtml(item.question)}</div>
            ${qNorm}
          </td>
          <td>
            <div class="faq-a-preview">${escapeHtml(item.answer)}</div>
            ${sourceTag}
          </td>
          <td style="text-align: center;">
            <div class="faq-actions-cell">
              <button class="btn btn-secondary-outline btn-edit-faq" data-id="${escapeHtml(item.id)}" title="FAQ 수정">수정</button>
              <button class="btn btn-danger-outline btn-delete-faq" data-id="${escapeHtml(item.id)}" title="FAQ 삭제">삭제</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // 수정 / 삭제 버튼 이벤트 바인딩
    faqTbody.querySelectorAll(".btn-edit-faq").forEach(btn => {
      btn.addEventListener("click", () => openEditFaqModal(btn.dataset.id));
    });

    faqTbody.querySelectorAll(".btn-delete-faq").forEach(btn => {
      btn.addEventListener("click", () => confirmDeleteFaq(btn.dataset.id));
    });
  }

  function renderFaqPagination(data) {
    const total = data.total || 0;
    const page = data.page || 1;
    const totalPages = data.total_pages || 1;

    if (total === 0) {
      faqPageInfo.textContent = "0건 표시";
      faqPaginationButtons.innerHTML = "";
      return;
    }

    const start = (page - 1) * faqPageSize + 1;
    const end = Math.min(page * faqPageSize, total);
    faqPageInfo.textContent = `총 ${total}건 중 ${start} - ${end}건 표시 (${page}/${totalPages} 페이지)`;

    let btnsHtml = "";
    btnsHtml += `<button class="page-btn" ${page <= 1 ? "disabled" : ""} data-page="${page - 1}">◀ 이전</button>`;

    // 페이지 번호 창 (최대 5개 노출)
    const maxButtons = 5;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let p = startPage; p <= endPage; p++) {
      btnsHtml += `<button class="page-btn ${p === page ? "active" : ""}" data-page="${p}">${p}</button>`;
    }

    btnsHtml += `<button class="page-btn" ${page >= totalPages ? "disabled" : ""} data-page="${page + 1}">다음 ▶</button>`;
    faqPaginationButtons.innerHTML = btnsHtml;

    faqPaginationButtons.querySelectorAll(".page-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetPage = parseInt(btn.dataset.page, 10);
        if (targetPage && targetPage !== currentFaqPage) {
          loadFaqs(targetPage);
        }
      });
    });
  }

  // FAQ 모달 열기 / 닫기
  function openCreateFaqModal() {
    faqModalTitle.innerHTML = "➕ 신규 FAQ 등록";
    faqFormId.value = "";
    faqForm.reset();
    faqModal.classList.remove("hidden");
    faqFormQuestion.focus();
  }

  async function openEditFaqModal(faqId) {
    try {
      const res = await fetch(`/api/admin/faq/${encodeURIComponent(faqId)}`);
      if (!res.ok) throw new Error("FAQ 정보를 불러올 수 없습니다.");
      const item = await res.json();

      faqModalTitle.innerHTML = `✏️ FAQ 항목 수정 <span class="faq-id-badge" style="margin-left: 0.5rem;">${escapeHtml(item.id)}</span>`;
      faqFormId.value = item.id;
      faqFormSheet.value = item.sheet || "스쿨넷";
      faqFormFault.value = item.fault_type || "";
      faqFormQuestion.value = item.question || "";
      faqFormQnorm.value = item.question_normalized || "";
      faqFormAnswer.value = item.answer || "";
      faqFormSource.value = (item.source_files || []).join(", ");

      faqModal.classList.remove("hidden");
      faqFormQuestion.focus();
    } catch (err) {
      alert(`FAQ 조회 실패: ${err.message}`);
    }
  }

  function closeFaqModal() {
    faqModal.classList.add("hidden");
  }

  btnFaqModalClose.addEventListener("click", closeFaqModal);
  btnFaqModalCancel.addEventListener("click", closeFaqModal);
  btnAddFaq.addEventListener("click", openCreateFaqModal);

  // FAQ 폼 제출 (등록 또는 수정)
  faqForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const faqId = faqFormId.value.trim();
    const isEdit = Boolean(faqId);

    const payload = {
      sheet: faqFormSheet.value.trim(),
      fault_type: faqFormFault.value.trim() || "일반",
      question: faqFormQuestion.value.trim(),
      question_normalized: faqFormQnorm.value.trim() || null,
      answer: faqFormAnswer.value.trim(),
      source_files: faqFormSource.value.trim() 
        ? faqFormSource.value.split(",").map(s => s.trim()).filter(Boolean)
        : [],
    };

    const submitBtn = document.getElementById("btn-faq-modal-save");
    submitBtn.disabled = true;
    submitBtn.textContent = "저장 및 메모리 핫리로드 중…";

    try {
      const url = isEdit ? `/api/admin/faq/${encodeURIComponent(faqId)}` : `/api/admin/faq`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "FAQ 저장 실패");
      }

      closeFaqModal();
      showToast(isEdit 
        ? "✅ FAQ가 성공적으로 수정되었으며, 챗봇 메모리에 즉시 반영되었습니다!" 
        : "🎉 새 FAQ가 등록되었으며, 챗봇 메모리에 즉시 핫리로드되었습니다!");

      await loadFaqStats();
      await loadFaqs(isEdit ? currentFaqPage : 1);
    } catch (err) {
      alert(`저장 실패: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="btn-icon">💾</span><span>저장 및 즉시 반영</span>`;
    }
  });

  // FAQ 삭제 확인
  async function confirmDeleteFaq(faqId) {
    if (!confirm(`FAQ [${faqId}] 항목을 삭제하시겠습니까?\n삭제 즉시 챗봇 메모리에서 제외됩니다.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/faq/${encodeURIComponent(faqId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "삭제 실패");
      }

      showToast(`🗑️ FAQ [${faqId}] 항목이 삭제되었으며 챗봇 메모리가 갱신되었습니다.`);
      await loadFaqStats();
      await loadFaqs(currentFaqPage);
    } catch (err) {
      alert(`삭제 오류: ${err.message}`);
    }
  }

  // FAQ 검색 및 필터 이벤트
  faqSheetFilter.addEventListener("change", () => loadFaqs(1));
  faqFaultFilter.addEventListener("change", () => loadFaqs(1));
  btnRefreshFaq.addEventListener("click", () => {
    loadFaqStats();
    loadFaqs(1);
    showToast("FAQ 목록 및 통계를 새로고침했습니다.");
  });

  faqSearchInput.addEventListener("input", () => {
    clearTimeout(faqSearchTimer);
    faqSearchTimer = setTimeout(() => {
      loadFaqs(1);
    }, 300);
  });

  // ==================== 3. 통계 대시보드 ====================
  async function loadStats() {
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) return;
      const data = await res.json();

      statDocs.textContent = `${data.total_documents}개`;
      tabBadgeDocs.textContent = `${data.total_documents}`;
      statRawSize.textContent = `용량: ${data.total_raw_size_formatted || "-"}`;
      statPages.textContent = data.total_pages_approx ? `약 ${data.total_pages_approx}쪽` : "-";
      statChunks.textContent = `${data.active_chunks_count.toLocaleString()}개`;
      statIndexPages.textContent = `색인 페이지: ${data.active_pages_count}쪽`;
      statBackend.textContent = data.embedding_backend || "embeddinggemma";
      statIndexTime.textContent = data.index_last_modified ? `최근 갱신: ${data.index_last_modified}` : "색인 미생성";

      connStatus.querySelector(".text").textContent = "서버 정상 연결";
      connStatus.querySelector(".dot").style.backgroundColor = "var(--emerald)";
    } catch (err) {
      console.error("통계 로드 실패:", err);
      connStatus.querySelector(".text").textContent = "연결 오류";
      connStatus.querySelector(".dot").style.backgroundColor = "var(--rose)";
    }
  }

  // ==================== 4. 웹 검색 설정 & 토글 ====================
  function renderWebSearchUI(data) {
    if (!data) return;
    const isEnabled = Boolean(data.enabled);

    if (toggleWebSearch) {
      toggleWebSearch.checked = isEnabled;
    }

    if (isEnabled) {
      websearchBadge.className = "badge badge-success";
      websearchBadge.textContent = "활성화 (Active)";
      websearchToggleLabel.textContent = "ON";
      websearchToggleLabel.classList.add("is-on");
      websearchCard.classList.add("active");
      tabBadgeWebsearch.textContent = "ON";
      topbarWebsearchStatus.querySelector(".dot").style.backgroundColor = "var(--emerald)";
      topbarWebsearchStatus.querySelector(".text").textContent = "웹 검색: ON";
    } else {
      websearchBadge.className = "badge badge-idle";
      websearchBadge.textContent = "비활성화 (Disabled)";
      websearchToggleLabel.textContent = "OFF";
      websearchToggleLabel.classList.remove("is-on");
      websearchCard.classList.remove("active");
      tabBadgeWebsearch.textContent = "OFF";
      topbarWebsearchStatus.querySelector(".dot").style.backgroundColor = "#64748b";
      topbarWebsearchStatus.querySelector(".text").textContent = "웹 검색: OFF";
    }

    if (data.model) websearchModel.textContent = data.model;
    if (data.scope) websearchScope.textContent = data.scope;
    if (data.daily_budget !== undefined) websearchBudget.textContent = `${data.daily_budget}회`;

    if (data.usage) {
      const calls = data.usage.calls_today || 0;
      const cost = data.usage.estimated_cost_usd !== undefined 
        ? `$${data.usage.estimated_cost_usd.toFixed(2)}` 
        : "$0.00";
      websearchUsage.textContent = `${calls}회 / ${cost}`;
    }
  }

  async function loadWebSearchStatus() {
    try {
      const res = await fetch("/api/admin/web-search");
      if (!res.ok) return;
      const data = await res.json();
      renderWebSearchUI(data);
    } catch (err) {
      console.error("웹 검색 상태 로드 실패:", err);
      if (websearchBadge) {
        websearchBadge.textContent = "조회 실패";
      }
    }
  }

  if (toggleWebSearch) {
    toggleWebSearch.addEventListener("change", async () => {
      const targetState = toggleWebSearch.checked;
      toggleWebSearch.disabled = true;

      try {
        const res = await fetch("/api/admin/web-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: targetState }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "설정 변경 실패");
        }

        const data = await res.json();
        renderWebSearchUI(data);
        showToast(targetState ? "🌐 웹 검색 기능이 활성화되었습니다." : "⚪ 웹 검색 기능이 비활성화되었습니다.");
      } catch (err) {
        console.error("웹 검색 토글 오류:", err);
        toggleWebSearch.checked = !targetState;
        renderWebSearchUI({ enabled: !targetState });
        alert(`웹 검색 설정 변경 실패: ${err.message}`);
      } finally {
        toggleWebSearch.disabled = false;
      }
    });
  }

  // ==================== 5. RAG 근거 문서 목록 및 Rename ====================
  async function loadDocuments() {
    try {
      docTbody.innerHTML = `<tr><td colspan="6" class="text-center muted" style="padding: 2rem;">문서 목록 불러오는 중…</td></tr>`;
      const res = await fetch("/api/admin/documents");
      if (!res.ok) throw new Error("문서 목록을 가져오지 못했습니다.");
      const data = await res.json();
      documentsCache = data.documents || [];
      renderDocumentTable(documentsCache);
    } catch (err) {
      console.error("문서 로드 실패:", err);
      docTbody.innerHTML = `<tr><td colspan="6" class="text-center muted" style="color: var(--rose);">문서 로드 실패: ${err.message}</td></tr>`;
    }
  }

  function renderDocumentTable(docs) {
    const filter = (docSearch.value || "").trim().toLowerCase();
    const filtered = docs.filter(d => 
      d.name.toLowerCase().includes(filter) || 
      (d.rel_path && d.rel_path.toLowerCase().includes(filter))
    );

    if (filtered.length === 0) {
      docTbody.innerHTML = `<tr><td colspan="6" class="text-center muted" style="padding: 2.5rem;">등록된 문서가 없거나 검색 결과가 없습니다.</td></tr>`;
      return;
    }

    docTbody.innerHTML = filtered.map(d => {
      const isPdf = d.is_pdf;
      const icon = isPdf ? "📄" : "📁";
      const pathText = d.folder ? `${d.folder}/` : "";
      const pageText = d.page_count ? `${d.page_count} 쪽` : "-";
      const metaBadge = d.has_metadata
        ? `<span class="meta-status-badge done" title="지능형 메타데이터 등록됨">✨ 등록완료</span>`
        : `<span class="meta-status-badge none" title="메타데이터 미생성">미등록</span>`;

      return `
        <tr data-path="${encodeURIComponent(d.rel_path)}">
          <td>
            <div class="doc-name-cell">
              <span class="doc-icon">${icon}</span>
              <div>
                <div class="doc-name">${escapeHtml(d.name)}</div>
                ${d.meta_title ? `<div class="doc-meta-title" title="${escapeHtml(d.meta_title)}">📌 ${escapeHtml(d.meta_title)}</div>` : ""}
                ${pathText ? `<div class="doc-path">${escapeHtml(pathText)}</div>` : ""}
              </div>
            </div>
          </td>
          <td>${d.size_formatted}</td>
          <td>${pageText}</td>
          <td>${metaBadge}</td>
          <td>${d.modified_at || "-"}</td>
          <td style="text-align: center;">
            <div style="display: flex; gap: 0.35rem; justify-content: center; flex-wrap: wrap;">
              <button class="btn btn-secondary-outline btn-meta-doc" data-path="${encodeURIComponent(d.rel_path)}" data-name="${escapeHtml(d.name)}" title="지능형 메타데이터 확인 및 수정">
                메타데이터
              </button>
              <button class="btn btn-secondary-outline btn-rename-doc" data-path="${encodeURIComponent(d.rel_path)}" data-name="${escapeHtml(d.name)}" title="문서 파일명 수정">
                수정
              </button>
              <button class="btn btn-danger-outline btn-delete-doc" data-path="${encodeURIComponent(d.rel_path)}" title="문서 삭제">
                삭제
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // 메타데이터 드로어 열기 이벤트
    docTbody.querySelectorAll(".btn-meta-doc").forEach(btn => {
      btn.addEventListener("click", () => {
        const rawPath = decodeURIComponent(btn.dataset.path);
        const docName = btn.dataset.name;
        openMetadataDrawer(rawPath, docName);
      });
    });

    // 이름 변경 버튼 이벤트
    docTbody.querySelectorAll(".btn-rename-doc").forEach(btn => {
      btn.addEventListener("click", () => {
        const rawPath = decodeURIComponent(btn.dataset.path);
        const currentName = btn.dataset.name;
        openRenameModal(rawPath, currentName);
      });
    });

    // 삭제 버튼 이벤트
    docTbody.querySelectorAll(".btn-delete-doc").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const rawPath = decodeURIComponent(e.currentTarget.dataset.path);
        if (confirm(`'${rawPath}' 문서를 삭제하시겠습니까?\n삭제 후 'RAG 전처리 및 재색인'을 실행해야 색인에 반영됩니다.`)) {
          await deleteDocument(rawPath);
        }
      });
    });
  }

  // 문서 이름변경 모달 제어
  function openRenameModal(relPath, name) {
    renameOldPath.value = relPath;
    renameCurrentName.textContent = name;
    renameNewName.value = name;
    docRenameModal.classList.remove("hidden");
    renameNewName.focus();
    renameNewName.select();
  }

  function closeRenameModal() {
    docRenameModal.classList.add("hidden");
  }

  btnRenameClose.addEventListener("click", closeRenameModal);
  btnRenameCancel.addEventListener("click", closeRenameModal);

  docRenameForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldPath = renameOldPath.value.trim();
    const newName = renameNewName.value.trim();

    if (!newName) {
      alert("새 파일명을 입력하세요.");
      return;
    }

    const saveBtn = document.getElementById("btn-rename-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "변경 저장 중…";

    try {
      const res = await fetch("/api/admin/documents/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_rel_path: oldPath, new_name: newName }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "이름 변경 실패");
      }

      closeRenameModal();
      showToast(`✏️ 파일명이 '${newName}'(으)로 변경되었습니다.`);
      await loadDocuments();
      await loadStats();
    } catch (err) {
      alert(`이름 변경 오류: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "변경 저장";
    }
  });

  async function deleteDocument(relPath) {
    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(relPath)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "삭제 실패");
      }
      showToast(`'${relPath}' 문서가 삭제되었습니다.`);
      await loadDocuments();
      await loadStats();
    } catch (err) {
      alert(`삭제 오류: ${err.message}`);
    }
  }

  // 검색 필터
  docSearch.addEventListener("input", () => {
    renderDocumentTable(documentsCache);
  });

  btnRefreshDocs.addEventListener("click", () => {
    loadDocuments();
    loadStats();
    showToast("문서 목록 및 통계를 새로고침했습니다.");
  });

  // ==================== 6. 드래그 앤 드롭 업로드 ====================
  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length > 0) {
      uploadFiles(fileInput.files);
    }
  });

  async function uploadFiles(fileList) {
    const formData = new FormData();
    for (const file of fileList) {
      formData.append("files", file);
    }

    uploadProgressList.innerHTML = `<div class="upload-item"><span>업로드 진행 중 (${fileList.length}개 파일)…</span></div>`;

    try {
      const res = await fetch("/api/admin/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("파일 업로드 실패");
      const data = await res.json();

      uploadProgressList.innerHTML = `
        <div class="upload-item" style="color: #4ade80;">
          <span>✅ 총 ${data.total}개 파일 업로드 완료! 'RAG 전처리 및 재색인 시작'을 눌러 색인에 반영하세요.</span>
        </div>
      `;
      setTimeout(() => { uploadProgressList.innerHTML = ""; }, 5000);

      fileInput.value = "";
      await loadDocuments();
      await loadStats();
      showToast("새 문서가 업로드되었습니다!");
    } catch (err) {
      uploadProgressList.innerHTML = `
        <div class="upload-item" style="color: #f87171;">
          <span>❌ 업로드 실패: ${err.message}</span>
        </div>
      `;
    }
  }

  // ==================== 7. 스테퍼 & 터미널 UI ====================
  function updateStepper(stage, pct) {
    progressBarFill.style.width = `${pct}%`;

    const currentIdx = STAGES.indexOf(stage);
    STAGES.forEach((st, idx) => {
      const el = document.getElementById(`step-${st}`);
      if (!el) return;
      el.classList.remove("active", "completed");

      if (idx < currentIdx || (stage === "ready" && pct === 100)) {
        el.classList.add("completed");
      } else if (idx === currentIdx) {
        el.classList.add("active");
      }
    });
  }

  function appendTerminalLog(logText, type = "normal") {
    const div = document.createElement("div");
    div.className = `terminal-line ${type}`;
    div.textContent = logText;
    terminalBody.appendChild(div);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  function setReindexUIState(status) {
    if (status === "running") {
      isReindexing = true;
      btnReindex.disabled = true;
      reindexSpinner.classList.remove("hidden");
      btnReindexText.textContent = "전처리 및 재색인 진행 중…";
      terminalStatusBadge.className = "badge badge-running";
      terminalStatusBadge.textContent = "실행 중";
      summaryBox.classList.add("hidden");
    } else if (status === "completed") {
      isReindexing = false;
      btnReindex.disabled = false;
      reindexSpinner.classList.add("hidden");
      btnReindexText.textContent = "RAG 전처리 및 재색인 시작";
      terminalStatusBadge.className = "badge badge-success";
      terminalStatusBadge.textContent = "완료됨";
    } else if (status === "failed") {
      isReindexing = false;
      btnReindex.disabled = false;
      reindexSpinner.classList.add("hidden");
      btnReindexText.textContent = "RAG 전처리 및 재색인 재시도";
      terminalStatusBadge.className = "badge badge-failed";
      terminalStatusBadge.textContent = "실패";
    } else {
      isReindexing = false;
      btnReindex.disabled = false;
      reindexSpinner.classList.add("hidden");
      btnReindexText.textContent = "RAG 전처리 및 재색인 시작";
      terminalStatusBadge.className = "badge badge-idle";
      terminalStatusBadge.textContent = "대기 중";
    }
  }

  function renderSummary(summary, elapsed) {
    if (!summary) return;
    const hy = summary.chunk_hygiene || {};
    summaryMetrics.innerHTML = `
      <div class="summary-tag">📄 파싱 문서: <b>${summary.documents_parsed || 0}개</b></div>
      <div class="summary-tag">📑 총 페이지: <b>${summary.total_pages || 0}쪽</b></div>
      <div class="summary-tag">🧩 생성 청크: <b>${summary.total_chunks || 0}개</b></div>
      <div class="summary-tag">🧹 중복제거: <b>${hy.dropped_duplicates || 0}개</b></div>
      <div class="summary-tag">✂️ 노이즈압축: <b>${hy.compressed_noise || 0}개 (${(hy.chars_saved || 0).toLocaleString()}자 절약)</b></div>
      <div class="summary-tag">⏱️ 총 소요시간: <b>${elapsed || summary.elapsed_seconds || 0}초</b></div>
    `;
    summaryBox.classList.remove("hidden");
  }

  // ==================== 8. SSE 실시간 스트리밍 ====================
  function connectReindexStream() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource("/api/admin/reindex/stream");

    eventSource.addEventListener("init", (e) => {
      const state = JSON.parse(e.data);
      setReindexUIState(state.status);
      updateStepper(state.stage, state.progress_pct);
      if (state.recent_logs && state.recent_logs.length > 0) {
        terminalBody.innerHTML = "";
        state.recent_logs.forEach(l => appendTerminalLog(l));
      }
      if (state.status === "completed" && state.summary) {
        renderSummary(state.summary, state.elapsed_seconds);
      }
    });

    eventSource.addEventListener("log", (e) => {
      const data = JSON.parse(e.data);
      setReindexUIState(data.status);
      updateStepper(data.stage, data.progress_pct);
      if (data.log) {
        appendTerminalLog(data.log);
      }
    });

    eventSource.addEventListener("completed", (e) => {
      const data = JSON.parse(e.data);
      setReindexUIState("completed");
      updateStepper("ready", 100);
      renderSummary(data.summary, data.elapsed_seconds);
      appendTerminalLog(`✨ [완료] 색인 교체 및 핫리로드 완료 (총 ${data.elapsed_seconds}초)`, "success");
      loadStats();
      loadDocuments();
      showToast("🎉 RAG 전처리 및 재색인이 성공적으로 완료되었습니다!");
    });

    eventSource.addEventListener("failed", (e) => {
      const data = JSON.parse(e.data);
      setReindexUIState("failed");
      appendTerminalLog(`❌ [오류] 재색인 실패: ${data.error}`, "error");
      showToast("❌ 재색인 중 오류가 발생했습니다.");
    });

    eventSource.onerror = () => {
      console.warn("SSE 연결 끊김 (자동 재연결 대기)");
    };
  }

  // ==================== 9. 재색인 실행 버튼 ====================
  btnReindex.addEventListener("click", async () => {
    if (isReindexing) return;

    const force = chkForce.checked;
    const confirmMsg = force 
      ? "기존 파싱 캐시를 모두 지우고 전체 문서를 처음부터 다시 파싱·색인합니다.\n진행하시겠습니까?"
      : "RAG 전처리 및 재색인을 시작하시겠습니까?";

    if (!confirm(confirmMsg)) return;

    terminalBody.innerHTML = "";
    summaryBox.classList.add("hidden");
    setReindexUIState("running");
    updateStepper("scan", 5);

    try {
      const res = await fetch("/api/admin/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "재색인 요청 실패");
      }

      showToast("🚀 RAG 전처리 및 재색인 파이프라인이 시작되었습니다.");
    } catch (err) {
      alert(`시작 실패: ${err.message}`);
      setReindexUIState("idle");
    }
  });

  // 터미널 제어
  btnClearLogs.addEventListener("click", () => {
    terminalBody.innerHTML = `<div class="terminal-line muted">로그가 초기화되었습니다.</div>`;
  });

  btnCopyLogs.addEventListener("click", () => {
    const text = Array.from(terminalBody.querySelectorAll(".terminal-line"))
      .map(el => el.textContent)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      showToast("터미널 로그가 클립보드에 복사되었습니다.");
    });
  });

  // =====================================================================
  // [Phase 2] 메타데이터 사이드 드로어 제어
  // =====================================================================
  let currentMetaDoc = null;

  async function openMetadataDrawer(relPath, docName) {
    currentMetaDoc = { relPath, docName };
    drawerDocName.textContent = docName;
    drawerMetaInfo.textContent = `경로: ${relPath}`;
    metaRelPath.value = relPath;

    // 폼 초기화
    metaInputTitle.value = "";
    metaInputSummary.value = "";
    metaInputKeywords.value = "";
    metaKeywordTags.innerHTML = "";
    metaInputPublisher.value = "";
    metaScopeRoles.value = "";
    metaScopeEquipment.value = "";
    metaScopeSpaces.value = "";
    drawerExtractedAt.textContent = "메타데이터 불러오는 중…";

    metaDrawerOverlay.classList.remove("hidden");

    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(relPath)}/metadata`);
      if (!res.ok) {
        throw new Error("메타데이터 조회 실패");
      }
      const data = await res.json();
      populateMetadataForm(data);
    } catch (err) {
      console.warn("메타데이터 로드 실패:", err);
      drawerExtractedAt.textContent = "메타데이터가 없습니다. [AI 메타데이터 자동 추출]을 실행해보세요.";
    }
  }

  function closeMetadataDrawer() {
    metaDrawerOverlay.classList.add("hidden");
    currentMetaDoc = null;
  }

  function populateMetadataForm(data) {
    metaInputTitle.value = data.title || "";
    metaInputSummary.value = data.summary || "";
    const kwList = Array.isArray(data.keywords) ? data.keywords : [];
    metaInputKeywords.value = kwList.join(", ");
    renderKeywordTags(kwList);

    metaInputPublisher.value = data.publisher || "";
    const scope = data.target_scope || {};
    metaScopeRoles.value = (scope.roles || []).join(", ");
    metaScopeEquipment.value = (scope.equipment || []).join(", ");
    metaScopeSpaces.value = (scope.spaces || []).join(", ");

    const dateStr = data.extracted_at ? new Date(data.extracted_at).toLocaleString() : "-";
    const methodStr = data.method === "gemini_flash" ? "Gemini Flash AI 추출" : "규칙 기반 추출";
    drawerExtractedAt.textContent = `최근 갱신: ${dateStr} (${methodStr}, 총 ${data.page_count || 1}페이지)`;
  }

  function renderKeywordTags(keywords) {
    if (!keywords || !keywords.length) {
      metaKeywordTags.innerHTML = "";
      return;
    }
    metaKeywordTags.innerHTML = keywords.map(kw => `<span class="keyword-tag">#${escapeHtml(kw.trim())}</span>`).join("");
  }

  metaInputKeywords.addEventListener("input", () => {
    const raw = metaInputKeywords.value;
    const tokens = raw.split(",").map(s => s.trim()).filter(Boolean);
    renderKeywordTags(tokens);
  });

  btnDrawerClose.addEventListener("click", closeMetadataDrawer);
  btnDrawerCancel.addEventListener("click", closeMetadataDrawer);
  metaDrawerOverlay.addEventListener("click", (e) => {
    if (e.target === metaDrawerOverlay) closeMetadataDrawer();
  });

  // AI 메타데이터 자동 재추출 버튼
  btnAiExtractMeta.addEventListener("click", async () => {
    if (!currentMetaDoc) return;
    btnAiExtractMeta.disabled = true;
    metaExtractSpinner.classList.remove("hidden");
    btnAiExtractText.textContent = "AI 추출 중…";

    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(currentMetaDoc.relPath)}/metadata/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "추출 실패");
      }

      const meta = await res.json();
      populateMetadataForm(meta);
      showToast("✨ AI 메타데이터가 성공적으로 추출되어 반영되었습니다.");
      await loadDocuments();
    } catch (err) {
      alert(`AI 메타데이터 추출 오류: ${err.message}`);
    } finally {
      btnAiExtractMeta.disabled = false;
      metaExtractSpinner.classList.add("hidden");
      btnAiExtractText.textContent = "AI 메타데이터 자동 추출";
    }
  });

  // 메타데이터 폼 저장
  docMetaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentMetaDoc) return;

    btnDrawerSave.disabled = true;
    btnDrawerSave.textContent = "저장 중…";

    const title = metaInputTitle.value.trim();
    const summary = metaInputSummary.value.trim();
    const keywords = metaInputKeywords.value.split(",").map(k => k.trim()).filter(Boolean);
    const publisher = metaInputPublisher.value.trim();
    const roles = metaScopeRoles.value.split(",").map(r => r.trim()).filter(Boolean);
    const equipment = metaScopeEquipment.value.split(",").map(eq => eq.trim()).filter(Boolean);
    const spaces = metaScopeSpaces.value.split(",").map(sp => sp.trim()).filter(Boolean);

    try {
      const res = await fetch(`/api/admin/documents/${encodeURIComponent(currentMetaDoc.relPath)}/metadata`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          keywords,
          publisher,
          target_scope: { roles, equipment, spaces },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "저장 실패");
      }

      showToast("💾 문서 메타데이터가 성공적으로 저장되었습니다.");
      closeMetadataDrawer();
      await loadDocuments();
    } catch (err) {
      alert(`메타데이터 저장 오류: ${err.message}`);
    } finally {
      btnDrawerSave.disabled = false;
      btnDrawerSave.textContent = "메타데이터 저장";
    }
  });

  // =====================================================================
  // [Phase 2] 시나리오 에디터 (Scenario Tree Editor) 제어
  // =====================================================================
  async function loadScenarios() {
    try {
      const res = await fetch("/api/admin/scenarios");
      if (!res.ok) throw new Error("시나리오 데이터 조회 실패");
      const data = await res.json();
      scenarioTreeCache = data;

      // 뱃지 및 통계 갱신
      tabBadgeScenario.textContent = `${data.total_nodes}개`;
      scenarioTreeStats.textContent = `총 ${data.total_nodes}개 노드`;
      scenarioNodeCount.textContent = data.total_nodes;

      // 무결성 뱃지 갱신
      const val = data.validation || {};
      if (val.is_valid && (!val.warnings || !val.warnings.length)) {
        scenarioIntegrityBadge.className = "integrity-badge valid";
        scenarioIntegrityText.textContent = "트리 무결성 정상";
        scenarioValidationAlert.classList.add("hidden");
      } else if (val.is_valid && val.warnings && val.warnings.length) {
        scenarioIntegrityBadge.className = "integrity-badge warning";
        scenarioIntegrityText.textContent = `경고 ${val.warnings.length}건`;
        scenarioValidationAlert.className = "validation-alert";
        scenarioValidationAlert.innerHTML = `⚠️ <b>시나리오 트리 경고:</b><br/>${val.warnings.map(w => `• ${escapeHtml(w)}`).join("<br/>")}`;
        scenarioValidationAlert.classList.remove("hidden");
      } else {
        scenarioIntegrityBadge.className = "integrity-badge error";
        scenarioIntegrityText.textContent = `오류 ${val.errors.length}건`;
        scenarioValidationAlert.className = "validation-alert error";
        scenarioValidationAlert.innerHTML = `🚨 <b>시나리오 트리 무결성 오류 (즉시 수정 필요):</b><br/>${val.errors.map(e => `• ${escapeHtml(e)}`).join("<br/>")}`;
        scenarioValidationAlert.classList.remove("hidden");
      }

      renderScenarioTree();

      // 기존 선택된 노드가 있으면 다시 선택 유지
      if (selectedScenarioNodeId && data.nodes[selectedScenarioNodeId]) {
        selectScenarioNode(selectedScenarioNodeId);
      } else if (data.root_node_id && data.nodes[data.root_node_id]) {
        selectScenarioNode(data.root_node_id);
      } else {
        scenarioEditorEmpty.classList.remove("hidden");
        scenarioNodeForm.classList.add("hidden");
      }
    } catch (err) {
      console.error("시나리오 로드 오류:", err);
      scenarioTreeContainer.innerHTML = `<div class="text-center muted" style="color: var(--rose); padding: 2rem;">시나리오 데이터를 불러올 수 없습니다: ${err.message}</div>`;
    }
  }

  function renderScenarioTree() {
    if (!scenarioTreeCache) return;
    const filter = (scenarioTreeSearch.value || "").trim().toLowerCase();
    const nodes = scenarioTreeCache.nodes || {};
    const rootId = scenarioTreeCache.root_node_id;

    // 그룹별 분류
    const groups = scenarioTreeCache.groups || {};
    let html = "";

    const groupKeys = Object.keys(groups).sort();
    let matchCount = 0;

    groupKeys.forEach(grp => {
      const nodeIds = groups[grp] || [];
      const filteredIds = nodeIds.filter(nid => {
        const n = nodes[nid];
        if (!n) return false;
        if (!filter) return true;
        const text = (n.text || "").toLowerCase();
        return nid.toLowerCase().includes(filter) || text.includes(filter);
      });

      if (filteredIds.length === 0) return;

      html += `<div class="tree-group-header"><span>📁 ${escapeHtml(grp)}</span><span>${filteredIds.length}개</span></div>`;

      filteredIds.forEach(nid => {
        matchCount++;
        const n = nodes[nid];
        const isTerminal = n.type === "terminal";
        const isRoot = nid === rootId;
        const isSelected = nid === selectedScenarioNodeId;

        const badgeClass = isTerminal ? "terminal" : "question";
        const badgeLabel = isRoot ? "ROOT" : (isTerminal ? "답변" : "질문");
        const preview = n.text || (n.answer ? (n.answer.text || n.answer.answer_ref || "") : "");

        html += `
          <div class="tree-node-item ${isSelected ? "selected" : ""} ${isTerminal ? "terminal" : ""}" data-id="${escapeHtml(nid)}">
            <span class="tree-node-badge ${badgeClass}">${badgeLabel}</span>
            <div class="tree-node-content">
              <div class="tree-node-id">${escapeHtml(nid)}</div>
              <div class="tree-node-desc">${escapeHtml(preview || "(내용 없음)")}</div>
            </div>
          </div>
        `;
      });
    });

    if (matchCount === 0) {
      scenarioTreeContainer.innerHTML = `<div class="text-center muted" style="padding: 2rem;">검색 결과가 없습니다.</div>`;
      return;
    }

    scenarioTreeContainer.innerHTML = html;

    scenarioTreeContainer.querySelectorAll(".tree-node-item").forEach(item => {
      item.addEventListener("click", () => {
        const nid = item.dataset.id;
        selectScenarioNode(nid);
      });
    });
  }

  scenarioTreeSearch.addEventListener("input", renderScenarioTree);

  function selectScenarioNode(nodeId) {
    if (!scenarioTreeCache || !scenarioTreeCache.nodes[nodeId]) return;
    selectedScenarioNodeId = nodeId;

    // 트리 active 하이라이트 갱신
    scenarioTreeContainer.querySelectorAll(".tree-node-item").forEach(el => {
      el.classList.toggle("selected", el.dataset.id === nodeId);
    });

    const node = scenarioTreeCache.nodes[nodeId];
    scenarioEditorEmpty.classList.add("hidden");
    scenarioNodeForm.classList.remove("hidden");

    // 폼 바인딩
    formNodeId.value = nodeId;
    formNodeIdDisplay.textContent = nodeId;
    formScenarioId.value = node.scenario_id || "";
    formNodeType.value = node.type || "question";
    formNodeText.value = node.text || "";

    formNodeTypeBadge.textContent = node.type === "terminal" ? "종단 솔루션" : "질문 분기";
    formNodeTypeBadge.className = `node-type-pill ${node.type === "terminal" ? "terminal" : ""}`;

    // Root 노드는 삭제 불가
    if (nodeId === scenarioTreeCache.root_node_id) {
      btnDeleteScenarioNode.disabled = true;
      btnDeleteScenarioNode.title = "루트(Root) 노드는 삭제할 수 없습니다.";
    } else {
      btnDeleteScenarioNode.disabled = false;
      btnDeleteScenarioNode.title = "노드 삭제";
    }

    updateNodeTypeUI(node.type || "question", node);
  }

  function updateNodeTypeUI(type, nodeData = null) {
    if (type === "terminal") {
      sectionBranchOptions.classList.add("hidden");
      sectionTerminalAnswer.classList.remove("hidden");

      const ans = (nodeData && nodeData.answer) || {};
      formAnswerSource.value = ans.source || "scenario_ppt";
      formAnswerRef.value = ans.answer_ref || "";
      formAnswerText.value = ans.text || (nodeData && nodeData.text ? nodeData.text : "");

      updateAnswerSourceUI(formAnswerSource.value);
    } else {
      sectionBranchOptions.classList.remove("hidden");
      sectionTerminalAnswer.classList.add("hidden");

      const options = (nodeData && nodeData.options) || [];
      renderOptionRows(options);
    }
  }

  function updateAnswerSourceUI(source) {
    if (source === "faq_ref") {
      groupAnswerRef.style.display = "block";
      groupAnswerText.style.display = "none";
    } else {
      groupAnswerRef.style.display = "none";
      groupAnswerText.style.display = "block";
    }
  }

  formAnswerSource.addEventListener("change", () => {
    updateAnswerSourceUI(formAnswerSource.value);
  });

  formNodeType.addEventListener("change", () => {
    const newType = formNodeType.value;
    formNodeTypeBadge.textContent = newType === "terminal" ? "종단 솔루션" : "질문 분기";
    formNodeTypeBadge.className = `node-type-pill ${newType === "terminal" ? "terminal" : ""}`;
    updateNodeTypeUI(newType);
  });

  function renderOptionRows(options) {
    optionsTbody.innerHTML = options.map((opt, idx) => `
      <tr data-index="${idx}">
        <td>
          <input type="text" class="opt-id" value="${escapeHtml(opt.option_id || "")}" placeholder="opt_01" required />
        </td>
        <td>
          <input type="text" class="opt-label" value="${escapeHtml(opt.label || "")}" placeholder="선택지 라벨" required />
        </td>
        <td>
          <input type="text" class="opt-next" value="${escapeHtml(opt.next_node_id || "")}" placeholder="다음 노드 ID" required />
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn-del-row" title="선택지 삭제">&times;</button>
        </td>
      </tr>
    `).join("");

    optionsTbody.querySelectorAll(".btn-del-row").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.target.closest("tr").remove();
      });
    });
  }

  btnAddOptionRow.addEventListener("click", () => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input type="text" class="opt-id" placeholder="opt_${optionsTbody.children.length + 1}" required />
      </td>
      <td>
        <input type="text" class="opt-label" placeholder="새 선택지 라벨" required />
      </td>
      <td>
        <input type="text" class="opt-next" placeholder="이동할 노드 ID" required />
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-del-row" title="선택지 삭제">&times;</button>
      </td>
    `;
    tr.querySelector(".btn-del-row").addEventListener("click", () => tr.remove());
    optionsTbody.appendChild(tr);
    tr.querySelector(".opt-label").focus();
  });

  // 노드 저장
  scenarioNodeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nodeId = formNodeId.value.trim();
    if (!nodeId) return;

    btnSaveScenarioNode.disabled = true;
    btnSaveScenarioNode.textContent = "저장 중…";

    const scenarioId = formScenarioId.value.trim();
    const type = formNodeType.value;
    const text = formNodeText.value.trim();

    const payload = {
      scenario_id: scenarioId,
      type: type,
      text: text,
      options: [],
    };

    if (type === "terminal") {
      const src = formAnswerSource.value;
      if (src === "faq_ref") {
        payload.answer = { source: "faq_ref", answer_ref: formAnswerRef.value.trim() };
      } else {
        payload.answer = { source: "scenario_ppt", text: formAnswerText.value.trim() };
      }
    } else {
      const rows = optionsTbody.querySelectorAll("tr");
      const opts = [];
      for (const r of rows) {
        const oid = r.querySelector(".opt-id").value.trim();
        const lbl = r.querySelector(".opt-label").value.trim();
        const nxt = r.querySelector(".opt-next").value.trim();
        if (oid && lbl && nxt) {
          opts.push({ option_id: oid, label: lbl, next_node_id: nxt });
        }
      }
      payload.options = opts;
    }

    try {
      const res = await fetch(`/api/admin/scenarios/nodes/${encodeURIComponent(nodeId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "노드 저장 실패");
      }

      showToast(`💾 노드 '${nodeId}'가 저장되고 런타임에 동기화되었습니다.`);
      await loadScenarios();
    } catch (err) {
      alert(`노드 저장 오류: ${err.message}`);
    } finally {
      btnSaveScenarioNode.disabled = false;
      btnSaveScenarioNode.textContent = "노드 저장 및 즉시 반영";
    }
  });

  // 노드 삭제
  btnDeleteScenarioNode.addEventListener("click", async () => {
    const nodeId = formNodeId.value.trim();
    if (!nodeId) return;

    if (!confirm(`정말로 시나리오 노드 '${nodeId}'를 삭제하시겠습니까?\n이 노드를 참조하고 있는 상위 버튼 링크가 깨질 수 있습니다.`)) {
      return;
    }

    btnDeleteScenarioNode.disabled = true;
    try {
      const res = await fetch(`/api/admin/scenarios/nodes/${encodeURIComponent(nodeId)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "노드 삭제 실패");
      }

      showToast(`🗑️ 노드 '${nodeId}'가 삭제되었습니다.`);
      selectedScenarioNodeId = null;
      await loadScenarios();
    } catch (err) {
      alert(`노드 삭제 오류: ${err.message}`);
    } finally {
      btnDeleteScenarioNode.disabled = false;
    }
  });

  // 신규 노드 생성 모달
  btnCreateScenarioNode.addEventListener("click", () => {
    modalNewNodeId.value = "";
    modalNewScenarioId.value = "";
    modalNewNodeType.value = "question";
    modalNewNodeText.value = "";
    scenarioCreateModal.classList.remove("hidden");
    modalNewNodeId.focus();
  });

  function closeScenarioModal() {
    scenarioCreateModal.classList.add("hidden");
  }

  btnScenarioModalClose.addEventListener("click", closeScenarioModal);
  btnScenarioModalCancel.addEventListener("click", closeScenarioModal);

  scenarioCreateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nodeId = modalNewNodeId.value.trim();
    const scenarioId = modalNewScenarioId.value.trim();
    const type = modalNewNodeType.value;
    const text = modalNewNodeText.value.trim();

    if (!nodeId) {
      alert("노드 ID를 입력하세요.");
      return;
    }

    const payload = {
      node_id: nodeId,
      scenario_id: scenarioId || nodeId.split(".")[0] || "default",
      type: type,
      text: text,
      options: [],
      answer: type === "terminal" ? { source: "scenario_ppt", text: text } : null,
    };

    try {
      const res = await fetch("/api/admin/scenarios/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "노드 생성 실패");
      }

      closeScenarioModal();
      showToast(`➕ 새 시나리오 노드 '${nodeId}'가 생성되었습니다.`);
      selectedScenarioNodeId = nodeId;
      await loadScenarios();
      selectScenarioNode(nodeId);
    } catch (err) {
      alert(`노드 생성 오류: ${err.message}`);
    }
  });

  // 무결성 검증 버튼
  btnValidateScenario.addEventListener("click", async () => {
    btnValidateScenario.disabled = true;
    try {
      const res = await fetch("/api/admin/scenarios/validate");
      if (!res.ok) throw new Error("무결성 검증 API 실패");
      const val = await res.json();

      if (val.is_valid && (!val.warnings || !val.warnings.length)) {
        showToast(`✅ 트리 무결성 완벽 정상! (총 ${val.reachable_count}개 노드 모두 연결됨)`);
      } else {
        await loadScenarios();
      }
    } catch (err) {
      alert(`검증 실패: ${err.message}`);
    } finally {
      btnValidateScenario.disabled = false;
    }
  });

  // ==================== 10. 초기화 실행 ====================
  loadFaqStats();
  loadFaqs(1);
  loadStats();
  loadWebSearchStatus();
  loadDocuments();
  loadScenarios();
  connectReindexStream();
});
