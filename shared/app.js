/**
 * CloudWizard Dashboard v2 shell controller
 * - Static layout lives in tenant index.html
 * - This file wires tabs, modal, triage restore, CSV loading
 * - Dynamic rendering is delegated to renderSummary/renderOverview/renderCompliance
 */

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function initHeroFromConfig() {
    const conf = window.CWCONFIG || {};
    const envEl = $("cwEnvironmentBadge");
    const titleEl = $("cwDashboardTitle");
    const subtitleEl = $("cwDashboardSubtitle");

    if (envEl) envEl.textContent = conf.environment || "DEMO";
    if (titleEl) titleEl.textContent = conf.dashboardTitle || "CloudWizard Security Dashboard";
    if (subtitleEl) subtitleEl.textContent = conf.description || "";
  }

  function initTabs() {
    const tabSummary = $("tabSummary");
    const tabOverview = $("tabOverview");
    const tabCompliance = $("tabCompliance");
    const viewSummary = $("viewSummary");
    const viewOverview = $("viewOverview");
    const viewCompliance = $("viewCompliance");

    if (!tabSummary || !tabOverview || !tabCompliance || !viewSummary || !viewOverview || !viewCompliance) {
      console.warn("[CloudWizard] Tab elements missing, skipping tab wiring.");
      return;
    }

    let securityRendered = false;
    let complianceRendered = false;

    function ensureSecurityRendered() {
      if (securityRendered) return;
      const rows = window.__cwAllRows || window.allRows || [];
      if (typeof renderOverview === "function" && rows.length) {
        renderOverview(rows);
        securityRendered = true;
      }
    }

    function ensureComplianceRendered() {
      if (complianceRendered) return;
      const rows = window.__cwAllRows || window.allRows || [];
      if (typeof renderCompliance === "function" && rows.length) {
        renderCompliance(rows);
        complianceRendered = true;
      }
    }

    function ensureSummaryRendered() {
  const rows = window.__cwAllRows || window.allRows || [];
  const inner = document.getElementById("viewSummaryInner") || viewSummary;

  if (typeof renderSummary === "function" && rows.length) {
    inner.innerHTML = "";
    renderSummary(rows);
  } else if (!inner.innerHTML) {
    inner.innerHTML =
      '<div class="card" style="padding:16px;">Summary tab coming soon.</div>';
  }
}



function activate(target) {
  const tabs = [tabSummary, tabOverview, tabCompliance];
  const views = [viewSummary, viewOverview, viewCompliance];

  tabs.forEach((t) => t.classList.remove("cwTabActive"));
  views.forEach((v) => v.classList.add("cwViewHidden"));

  if (target === "summary") {
    tabSummary.classList.add("cwTabActive");
    viewSummary.classList.remove("cwViewHidden");
    ensureSummaryRendered();
  } else if (target === "security") {
    tabOverview.classList.add("cwTabActive");
    viewOverview.classList.remove("cwViewHidden");
    ensureSecurityRendered();
  } else if (target === "compliance") {
    tabCompliance.classList.add("cwTabActive");
    viewCompliance.classList.remove("cwViewHidden");
    ensureComplianceRendered();
  }
}

    tabSummary.addEventListener("click", () => activate("summary"));
    tabOverview.addEventListener("click", () => activate("security"));
    tabCompliance.addEventListener("click", () => activate("compliance"));

    // Default: Summary tab visible
    activate("summary");
  }

  function initModal() {
    const modal = $("cwScanModal");
    const scanBtn = $("btnRequestScanCenter");
    const cancelBtn = $("cwModalCancel");

    if (!modal) {
      console.warn("[CloudWizard] Modal container missing, skipping modal wiring.");
      return;
    }

    function openModal() {
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }

    if (scanBtn) scanBtn.addEventListener("click", openModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  function loadCsvAndRender() {
    const conf = window.CWCONFIG || {};
    const csvUrl = conf.csvUrl;

    if (!csvUrl) {
      const o = $("viewSummary") || $("viewOverview");
      if (o) {
        o.innerHTML =
          '<div style="color:#ef4444;padding:20px;">Configuration Error: Missing CSV URL.</div>';
      }
      console.error("[CloudWizard] CWCONFIG.csvUrl is not set.");
      return;
    }

    console.log("[CloudWizard] Fetching CSV:", csvUrl);

    fetch(csvUrl, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          throw new Error("CSV fetch failed, HTTP " + res.status);
        }
        return res.text();
      })
      .then((text) => {
        // Auto-detect delimiter, same behaviour as v1
        let parsed = parseDelimited(text, ";");
        if (!parsed.headers || parsed.headers.length === 1) {
          parsed = parseDelimited(text, ",");
        }

        const rowsRaw =
          parsed && parsed.rows && parsed.rows.length ? parsed.rows : [];
        const allRows = hydrateRowsWithMeta(rowsRaw);

        window.allRows = allRows;
        window.__cwAllRows = allRows;

        console.log("[CloudWizard] Parsed rows:", allRows.length);

        return loadChartJs().then(() => {
          if (window.Chart && window.Chart.defaults) {
            window.Chart.defaults.color = "#64748b";
            window.Chart.defaults.scale = window.Chart.defaults.scale || {};
            window.Chart.defaults.scale.grid = window.Chart.defaults.scale.grid || {};
            window.Chart.defaults.scale.grid.color = "#f1f5f9";
            window.Chart.defaults.font = window.Chart.defaults.font || {};
            window.Chart.defaults.font.family = "Inter, system-ui, sans-serif";
          }

          // Render Summary by default
          if (typeof renderSummary === "function") {
            try {
              renderSummary(allRows);
            } catch (e) {
              console.warn("[CloudWizard] renderSummary() error:", e);
            }
          } else {
            const host = $("viewSummary");
            if (host && !host.innerHTML) {
              host.innerHTML =
                '<div class="card" style="padding:16px;">Summary tab coming soon.</div>';
            }
          }
        });
      })
      .catch((err) => {
        console.error("[CloudWizard] Error loading data:", err);
        const o = $("viewSummary") || $("viewOverview");
        if (o) {
          o.innerHTML =
            '<div style="color:#ef4444;padding:20px;">Error loading data. Check console.</div>';
        }
      });
  }

  function restoreTriageState() {
    try {
      const raw = localStorage.getItem("cw_triage_state");
      if (!raw) {
        console.log("[CloudWizard] No triage state found in localStorage.");
        return;
      }
      const parsed = JSON.parse(raw);
      console.log("[CloudWizard] Triage state loaded with", Object.keys(parsed).length, "entries.");
    } catch (e) {
      console.warn("[CloudWizard] Failed to parse triage state from localStorage.", e);
    }
  }

  function boot() {
    console.log("[CloudWizard] app-v2 booting shell…");
    initHeroFromConfig();
    initTabs();
    initModal();
    restoreTriageState();
    loadCsvAndRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();