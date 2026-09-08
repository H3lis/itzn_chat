/**
 * RAG 관리자 페이지 프론트엔드 스크립트 (admin.js)
 * - 문서 목록 조회, 업로드, 삭제
 * - 사전 청킹/재색인 실행 및 SSE 실시간 진행률/터미널 로그 스트리밍
 * - 대시보드 통계 자동 갱신
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const statDocs = document.getElementById("stat-docs");
  const statRawSize = document.getElementById("stat-raw-size");
  const statPages = document.getElementById("stat-pages");
  const statChunks = document.getElementById("stat-chunks");
  const statIndexPages = document.getElementById("stat-index-pages");
  const statBackend = document.getElementById("stat-backend");
  const statIndexTime = document.getElementById("stat-index-time");
  const connStatus = document.getElementById("conn-status");

  const docTbody = document.getElementById("doc-tbody");
  const docSearch = document.getElementById("doc-search");
  const btnRefreshDocs = document.getElementById("btn-refresh-docs");

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const uploadProgressList = document.getElementById("upload-progress-list");

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

  // Web Search Elements
  const websearchCard = document.getElementById("websearch-card");
  const websearchBadge = document.getElementById("websearch-badge");
  const websearchModel = document.getElementById("websearch-model");
  const websearchScope = document.getElementById("websearch-scope");
  const websearchBudget = document.getElementById("websearch-budget");
  const websearchUsage = document.getElementById("websearch-usage");
  const websearchToggleLabel = document.getElementById("websearch-toggle-label");
  const toggleWebSearch = document.getElementById("toggle-web-search");
  const topbarWebsearchStatus = document.getElementById("topbar-websearch-status");

  // State
  let documentsCache = [];
  let eventSource = null;
  let isReindexing = false;

  const STAGES = ["scan", "parse", "chunk", "embed", "promote"];

  // ==================== 알림 토스트 ====================
  function showToast(msg, duration = 3000) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    setTimeout(() => {
      toastEl.classList.add("hidden");
    }, duration);
  }

  // ==================== 통계 대시보드 ====================
  async function loadStats() {
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) return;
      const data = await res.json();

      statDocs.textContent = `${data.total_documents}개`;
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

  // ==================== 웹 검색 설정 & 토글 ====================
  function renderWebSearchUI(data) {
    if (!data) return;
    const isEnabled = Boolean(data.enabled);

    if (toggleWebSearch) {
      toggleWebSearch.checked = isEnabled;
    }

    if (isEnabled) {
      if (websearchCard) websearchCard.classList.add("is-enabled");
      if (websearchBadge) {
        websearchBadge.className = "badge badge-success";
        websearchBadge.textContent = "🟢 활성화됨 (ON)";
      }
      if (websearchToggleLabel) {
        websearchToggleLabel.textContent = "ON";
        websearchToggleLabel.classList.add("is-on");
      }
      if (topbarWebsearchStatus) {
        topbarWebsearchStatus.classList.add("is-enabled");
        topbarWebsearchStatus.querySelector(".text").textContent = "웹 검색: ON";
      }
    } else {
      if (websearchCard) websearchCard.classList.remove("is-enabled");
      if (websearchBadge) {
        websearchBadge.className = "badge badge-idle";
        websearchBadge.textContent = "⚪ 비활성화됨 (OFF)";
      }
      if (websearchToggleLabel) {
        websearchToggleLabel.textContent = "OFF";
        websearchToggleLabel.classList.remove("is-on");
      }
      if (topbarWebsearchStatus) {
        topbarWebsearchStatus.classList.remove("is-enabled");
        topbarWebsearchStatus.querySelector(".text").textContent = "웹 검색: OFF";
      }
    }

    if (websearchModel) websearchModel.textContent = data.model || "gemini-3.1-flash-lite";
    if (websearchScope) websearchScope.textContent = data.scope || "in_domain_unresolved";
    if (websearchBudget) websearchBudget.textContent = data.daily_budget ? `${data.daily_budget}회` : "무제한";

    if (websearchUsage) {
      if (data.usage) {
        const calls = data.usage.calls_today ?? 0;
        const cost = typeof data.usage.cost_usd === "number" ? `$${data.usage.cost_usd.toFixed(2)}` : "$0.00";
        websearchUsage.textContent = `${calls}회 / ${cost}`;
      } else {
        websearchUsage.textContent = "0회 / $0.00";
      }
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
        // 오류 시 원래 체크 상태로 롤백
        toggleWebSearch.checked = !targetState;
        renderWebSearchUI({ enabled: !targetState });
        alert(`웹 검색 설정 변경 실패: ${err.message}`);
      } finally {
        toggleWebSearch.disabled = false;
      }
    });
  }

  // ==================== 문서 목록 ====================
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
      const statusBadge = d.is_parsed
        ? `<span class="status-badge parsed">파싱 완료</span>`
        : `<span class="status-badge unparsed">색인 대기</span>`;

      return `
        <tr data-path="${encodeURIComponent(d.rel_path)}">
          <td>
            <div class="doc-name-cell">
              <span class="doc-icon">${icon}</span>
              <div>
                <div class="doc-name">${escapeHtml(d.name)}</div>
                ${pathText ? `<div class="doc-path">${escapeHtml(pathText)}</div>` : ""}
              </div>
            </div>
          </td>
          <td>${d.size_formatted}</td>
          <td>${pageText}</td>
          <td>${statusBadge}</td>
          <td>${d.modified_at || "-"}</td>
          <td style="text-align: center;">
            <button class="btn btn-danger-outline btn-delete-doc" data-path="${encodeURIComponent(d.rel_path)}" title="문서 삭제">
              삭제
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // 삭제 버튼 이벤트 바인딩
    docTbody.querySelectorAll(".btn-delete-doc").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const rawPath = decodeURIComponent(e.currentTarget.dataset.path);
        if (confirm(`'${rawPath}' 문서를 삭제하시겠습니까?\n삭제 후 'RAG 전처리 및 재색인'을 실행해야 색인에 반영됩니다.`)) {
          await deleteDocument(rawPath);
        }
      });
    });
  }

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

  // ==================== 드래그 앤 드롭 업로드 ====================
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

  // ==================== 스테퍼 & 터미널 UI ====================
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

  // ==================== SSE 실시간 스트리밍 ====================
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

    eventSource.onerror = (err) => {
      console.warn("SSE 연결 끊김 (자동 재연결 대기)");
    };
  }

  // ==================== 재색인 버튼 클릭 ====================
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

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 초기화 실행
  loadStats();
  loadWebSearchStatus();
  loadDocuments();
  connectReindexStream();
});
