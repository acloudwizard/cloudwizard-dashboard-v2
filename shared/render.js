/**
 * CloudWizard Security Dashboard - Render Logic
 * (Security Overview + Compliance Explorer + Triage + Charts)
 */

(function () {

 window.goToComplianceFramework = function(frameworkName) {
  // 1. Switch to the Compliance Tab visually
  const tabOverview = document.getElementById("tabOverview");
  const tabCompliance = document.getElementById("tabCompliance");
  const viewOverview = document.getElementById("viewOverview");
  const viewCompliance = document.getElementById("viewCompliance");

  if (tabOverview && tabCompliance && viewOverview && viewCompliance) {
    tabCompliance.classList.add("cwTabActive");
    tabOverview.classList.remove("cwTabActive");
    
    viewOverview.style.display = "none";
    viewCompliance.style.display = "block";
  }

  // 2. Target the Compliance Explorer filters
  const ceFramework = document.getElementById("ceFramework");
  const ceStatus = document.getElementById("ceStatus"); 

  if (ceFramework) {
    // Set the specific framework
    ceFramework.value = frameworkName;
    
    // Auto-set status to FAIL since they clicked "View Failing Checks"
    if (ceStatus) {
      ceStatus.value = "FAIL"; 
    }

    // Dispatch a change event to trigger your existing `rerender()` logic
    ceFramework.dispatchEvent(new Event("change"));
    
    // Smooth scroll to the top so they see the KPIs instantly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}; 

  // ------------------------------------------------------------------------
  // 1. Utilities
  // ------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function norm(s) {
    return String(s ?? "").trim().toLowerCase();
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ------------------------------------------------------------------------
  // 2. Triage Engine (LocalStorage)
  // ------------------------------------------------------------------------
  const TRIAGE_STORE_KEY = "cw_triage_state";

  function getTriageState() {
    try {
      return JSON.parse(localStorage.getItem(TRIAGE_STORE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveTriageState(state) {
    localStorage.setItem(TRIAGE_STORE_KEY, JSON.stringify(state));
  }

  function getFindingId(r) {
    return `${r.CHECK_ID}|${r.RESOURCE_UID}|${r.ACCOUNT_UID}`;
  }

  function updateTriage(findingId, status, notes) {
    const state = getTriageState();
    if (!status && !notes) {
      delete state[findingId];
    } else {
      state[findingId] = {
        status: status || "",
        notes: notes || "",
        updatedAt: new Date().toISOString()
      };
    }
    saveTriageState(state);
    window.dispatchEvent(new Event("cw-triage-updated"));
  }

  // ------------------------------------------------------------------------
  // 3. Data Helpers
  // ------------------------------------------------------------------------
  function hydrateRowsWithMeta(rawRows) {
    return rawRows.map((r) => {
      r._findingId = r.CHECK_ID;
      return r;
    });
  }

  function groupMap(arr, keyFn) {
    const m = new Map();
    for (const item of arr) {
      const k = keyFn(item) || "Other";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(item);
    }
    return m;
  }

  function countStatuses(rows) {
    const c = { FAIL: 0, PASS: 0, MANUAL: 0, IGNORED: 0, INVESTIGATING: 0, PENDING: 0, FIXED: 0 };
    const tState = getTriageState();

    rows.forEach((r) => {
      const s = String(r.STATUS || "").toUpperCase();
      if (s === "FAIL") {
        const ts = tState[getFindingId(r)];
        if (ts && ts.status) {
          const st = ts.status.toUpperCase();
          if (c[st] !== undefined) c[st]++; else c.FAIL++;
        } else {
          c.FAIL++;
        }
      } else if (s in c) {
        c[s]++;
      }
    });
    return c;
  }

  function countSeverities(rows) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const tState = getTriageState();

    rows.forEach((r) => {
      if (String(r.STATUS || "").toUpperCase() === "FAIL") {
        const ts = tState[getFindingId(r)];
        if (ts && (ts.status === "ignored" || ts.status === "fixed")) return;
        const s = norm(r.SEVERITY);
        if (s in counts) counts[s]++;
      }
    });
    return counts;
  }

  function uniqueSorted(rows, key) {
    const set = new Set();
    rows.forEach((r) => {
      const v = String(r[key] ?? "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function extractFrameworksFromCell(cell) {
    const s = String(cell ?? "").trim();
    if (!s) return [];
    return s
      .split("|")
      .map((p) => p.trim())
      .map((p) => p.split(":")[0].trim())
      .filter(Boolean);
  }

  function collectFrameworks(rows) {
    const set = new Set();
    rows.forEach((r) => {
      extractFrameworksFromCell(r.COMPLIANCE).forEach((fw) => set.add(fw));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  // ------------------------------------------------------------------------
  // 4. Chart.js helpers
  // ------------------------------------------------------------------------
  function destroyIfExists(name) {
    if (window[name] && typeof window[name].destroy === "function") {
      window[name].destroy();
    }
  }

  // ------------------------------------------------------------------------
  // 5. Details Panel
  // ------------------------------------------------------------------------
  function renderDetailsPanel(r) {
    const get = (k) => String(r[k] ?? "").trim();

    const statusRaw = String(get("STATUS")).toUpperCase();
    const sevRaw = String(get("SEVERITY")).trim();
    const sevNorm = sevRaw.toLowerCase();

    const title = `${get("CHECK_ID")} – ${get("CHECK_TITLE")}`.trim();
    const remediation = get("REMEDIATION_RECOMMENDATION_TEXT");
    const remediationUrl = get("REMEDIATION_RECOMMENDATION_URL");
    const risk = get("RISK");
    const desc = get("DESCRIPTION");

    const findingId = getFindingId(r);
    const triageState = getTriageState()[findingId] || { status: "", notes: "" };

    const statusPillClass =
      statusRaw === "FAIL"
        ? "cwPill cwFail"
        : statusRaw === "PASS"
        ? "cwPill cwPass"
        : statusRaw === "MANUAL"
        ? "cwPill cwManual"
        : "cwPill";

    const sevClass =
      sevNorm === "critical"
        ? "cwSev cwSevCrit"
        : sevNorm === "high"
        ? "cwSev cwSevHigh"
        : sevNorm === "medium"
        ? "cwSev cwSevMed"
        : sevNorm === "low"
        ? "cwSev cwSevLow"
        : "cwSev cwSevOther";

    setTimeout(() => {
      const btn = document.getElementById("triageSaveBtn");
      const sel = document.getElementById("triageStatusSel");
      const txt = document.getElementById("triageNotesTxt");

      if (btn && sel && txt) {
        btn.addEventListener("click", () => {
          updateTriage(findingId, sel.value, txt.value);
          btn.textContent = "Saved!";
          btn.style.backgroundColor = "var(--cw-status-pass)";
          btn.style.color = "#fff";
          setTimeout(() => {
            btn.textContent = "Save Triage";
            btn.style.backgroundColor = "";
            btn.style.color = "";
          }, 1500);
        });
      }
    }, 0);

    return `
      <div class="cwPanelTitle">Details</div>
      <div class="cwDetailsTitle">${escapeHtml(title)} Finding</div>
      
      ${
        statusRaw === "FAIL"
          ? `
        <div class="cwBlock" style="background:#f8fafc; border-color:#cbd5e1; border-width:2px; padding:12px; border-radius:8px; margin-top:16px;">
          <div class="cwBlockTitle" style="color:var(--cw-text-main); margin-bottom:8px;">Triage & Notes</div>
          
          <select id="triageStatusSel" class="cwSelect" style="margin-bottom:8px; width:100%; border-color:#cbd5e1;">
            <option value="">-- No Triage Status --</option>
            <option value="investigating" ${triageState.status === "investigating" ? "selected" : ""}>Under Investigation</option>
            <option value="pending" ${triageState.status === "pending" ? "selected" : ""}>Pending Fix</option>
            <option value="fixed" ${triageState.status === "fixed" ? "selected" : ""}>Fixed (Awaiting Scan)</option>
            <option value="ignored" ${triageState.status === "ignored" ? "selected" : ""}>Ignored (False Positive)</option>
          </select>

          <textarea id="triageNotesTxt" class="cwInput" placeholder="Add notes, Jira tickets, etc..." 
            style="width:100%; min-height:60px; margin-bottom:8px; resize:vertical; font-family:inherit; border-color:#cbd5e1; box-sizing:border-box;"
          >${escapeHtml(triageState.notes)}</textarea>
          <button id="triageSaveBtn" class="cwBtn" style="width:100%; justify-content:center; text-align:center;">Save Triage</button>
        </div>
      `
          : ""
      }

      <div style="margin-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        <div class="cwKV">
          <div class="cwKVKey">Status</div>
          <div class="cwKVVal"><span class="${statusPillClass}">${escapeHtml(statusRaw)}</span></div>
        </div>
        <div class="cwKV">
          <div class="cwKVKey">Severity</div>
          <div class="cwKVVal"><span class="${sevClass}">${escapeHtml(sevRaw)}</span></div>
        </div>
        <div class="cwKV">
          <div class="cwKVKey">Service</div>
          <div class="cwKVVal">${escapeHtml(get("SERVICE_NAME"))}</div>
        </div>
        <div class="cwKV">
          <div class="cwKVKey">Region</div>
          <div class="cwKVVal">${escapeHtml(get("REGION"))}</div>
        </div>
        <div class="cwKV">
          <div class="cwKVKey">Account</div>
          <div class="cwKVVal">${escapeHtml(get("ACCOUNT_UID"))}</div>
        </div>
        <div class="cwKV">
          <div class="cwKVKey">Resource</div>
          <div class="cwKVVal cwMono cwBreak">${escapeHtml(get("RESOURCE_UID"))}</div>
        </div>
      </div>

      ${desc ? `<div class="cwBlock"><div class="cwBlockTitle">Description</div><div class="cwWrap">${escapeHtml(desc)}</div></div>` : ""}
      ${risk ? `<div class="cwBlock"><div class="cwBlockTitle">Risk</div><div class="cwWrap">${escapeHtml(risk)}</div></div>` : ""}
      ${remediation ? `<div class="cwBlock"><div class="cwBlockTitle">Remediation</div><div class="cwWrap">${escapeHtml(remediation)}</div></div>` : ""}
      ${
        remediationUrl
          ? `<div class="cwBlock"><div class="cwBlockTitle">Remediation URL</div><div class="cwWrap cwBreak"><a href="${escapeHtml(
              remediationUrl
            )}" target="_blank" rel="noopener" style="color:var(--cw-primary);">${escapeHtml(remediationUrl)}</a></div></div>`
          : ""
      }
    `;
  }

  // ------------------------------------------------------------------------
  // 6. Security Overview
  // ------------------------------------------------------------------------
  function renderOverview(allRows) {
    const host = $("viewOverview");
    if (!host) return;

    if (!host.dataset.initialized) {
      host.innerHTML = `
        <div class="card" style="padding:16px 14px;margin-bottom:12px;">
          <div style="font-weight:900;color:var(--cw-text-main);margin-bottom:8px;">Overview filters</div>
          <div class="cwFilters">
            <div><div class="cwLabel">Account</div><select id="ovAccount" class="cwSelect"></select></div>
            <div><div class="cwLabel">Region</div><select id="ovRegion" class="cwSelect"></select></div>
            <div><div class="cwLabel">Severity</div><select id="ovSeverity" class="cwSelect"></select></div>
            <div><div class="cwLabel">Service</div><select id="ovService" class="cwSelect"></select></div>
            <div>
              <div class="cwLabel">Status</div>
              <select id="ovStatus" class="cwSelect">
                <option value="ALL" selected>All</option>
                <option value="FAIL">Fail</option>
                <option value="PASS">Pass</option>
                <option value="MANUAL">Manual</option>
              </select>
            </div>
            <div style="flex:1;min-width:220px;">
              <div class="cwLabel">Search</div>
              <input id="ovSearch" class="cwInput" placeholder="Search check/resource...">
            </div>
            <div style="display:flex; gap:8px; align-items:flex-end;">
              <button id="ovReset" class="cwBtn" type="button">Reset</button>
            </div>
          </div>
        </div>

        <div id="ovFilterReadout" style="font-size:12px; font-weight:700; color:#475569; margin-bottom:12px; padding:0 4px; display:none;"></div>

        <div id="ovKpis" class="cwKpis"></div>

        <div class="cwGrid2">
          <div class="card" style="padding:14px;">
            <div style="font-weight:900;color:var(--cw-text-main);margin-bottom:10px;">Overall status result</div>
            <div style="height:240px;"><canvas id="ovStatusDonut"></canvas></div>
          </div>
          <div class="card" style="padding:14px;">
            <div style="font-weight:900;color:var(--cw-text-main);margin-bottom:10px;">Top failed sections</div>
            <div style="height:240px;"><canvas id="ovTopSections"></canvas></div>
          </div>
        </div>

        <div class="cwGrid2" style="margin-top:12px;">
          <div class="card" style="padding:14px;">
            <div style="font-weight:900;color:var(--cw-text-main);margin-bottom:10px;">Findings by severity</div>
            <div style="height:220px;"><canvas id="ovSeverityBar"></canvas></div>
          </div>
          <div class="card" style="padding:14px;">
            <div style="font-weight:900;color:var(--cw-text-main);margin-bottom:10px;">Top failing services</div>
            <div style="height:220px;"><canvas id="ovServiceBar"></canvas></div>
          </div>
        </div>

        <div class="card" style="padding:14px;margin-top:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div style="font-weight:900;color:var(--cw-text-main);">Findings <span id="ovFindingsCount" style="color:var(--cw-text-muted);font-weight:700;"></span></div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <div class="cwLabel" style="margin:0;">Rows:</div>
              <select id="ovPageSize" class="cwSelect" style="min-width:90px;">
                <option value="25">25</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div class="cwSplit2" style="margin-top:12px;">
            <div id="ovTable"></div>
            <div id="ovDetails" class="card cwDetails">
              <div style="font-weight:900;color:var(--cw-text-main);">Details</div>
              <div class="cwDetailsHint">Click a row to see details.</div>
            </div>
          </div>
        </div>
      `;
      host.dataset.initialized = "true";
    }

    const els = {
      account: $("ovAccount"),
      region: $("ovRegion"),
      severity: $("ovSeverity"),
      service: $("ovService"),
      status: $("ovStatus"),
      search: $("ovSearch"),
      reset: $("ovReset"),
      kpis: $("ovKpis"),
      filterReadout: $("ovFilterReadout"),
      table: $("ovTable"),
      details: $("ovDetails"),
      pageSize: $("ovPageSize"),
      findingsCount: $("ovFindingsCount")
    };

    function fillSelect(sel, first, values, selected) {
      if (!sel) return;
      sel.innerHTML =
        `<option value="ALL">${first}</option>` +
        values
          .filter((v) => v !== first)
          .map(
            (v) =>
              `<option value="${escapeHtml(v)}" ${
                v === selected ? "selected" : ""
              }>${escapeHtml(v)}</option>`
          )
          .join("");
    }

    fillSelect(els.account, "ALL", uniqueSorted(allRows, "ACCOUNT_UID"), "ALL");
    fillSelect(els.region, "ALL", uniqueSorted(allRows, "REGION"), "ALL");
    fillSelect(els.severity, "ALL", uniqueSorted(allRows, "SEVERITY"), "ALL");
    fillSelect(els.service, "ALL", uniqueSorted(allRows, "SERVICE_NAME"), "ALL");

    const state = {
      account: "ALL",
      region: "ALL",
      severity: "ALL",
      service: "ALL",
      status: "ALL",
      q: "",
      pageSize: 50
    };

    function updateFilterReadout() {
      if (!els.filterReadout) return;
      const parts = [];
      if (state.account !== "ALL") parts.push(`Account: <span style="color:var(--cw-primary);">${escapeHtml(state.account)}</span>`);
      if (state.region !== "ALL") parts.push(`Region: <span style="color:var(--cw-primary);">${escapeHtml(state.region)}</span>`);
      if (state.severity !== "ALL") parts.push(`Severity: <span style="color:var(--cw-primary);">${escapeHtml(state.severity)}</span>`);
      if (state.service !== "ALL") parts.push(`Service: <span style="color:var(--cw-primary);">${escapeHtml(state.service)}</span>`);
      if (state.status !== "ALL") parts.push(`Status: <span style="color:var(--cw-primary);">${escapeHtml(state.status)}</span>`);
      if (state.q) parts.push(`Search: <span style="color:var(--cw-primary);">${escapeHtml(state.q)}</span>`);

      if (parts.length > 0) {
        els.filterReadout.innerHTML = `Active Filters: &nbsp;&nbsp; ${parts.join(" &nbsp;&nbsp; ")}`;
        els.filterReadout.style.display = "block";
      } else {
        els.filterReadout.innerHTML = "";
        els.filterReadout.style.display = "none";
      }
    }

    function applyFilters(rows) {
      return rows.filter((r) => {
        if (state.account !== "ALL" && r.ACCOUNT_UID !== state.account) return false;
        if (state.region !== "ALL" && r.REGION !== state.region) return false;
        if (state.severity !== "ALL" && r.SEVERITY !== state.severity) return false;
        if (state.service !== "ALL" && r.SERVICE_NAME !== state.service) return false;
        if (state.status !== "ALL" && String(r.STATUS).toUpperCase() !== state.status) return false;

        if (state.q) {
          const hay = norm(
            [r.CHECK_ID, r.CHECK_TITLE, r.SERVICE_NAME, r.RESOURCE_UID, r.DESCRIPTION].join(" ")
          );
          if (!hay.includes(state.q)) return false;
        }
        return true;
      });
    }

    function renderKpis(filtered) {
      if (!els.kpis) return;
      const c = countStatuses(filtered);
      els.kpis.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(100px, 1fr)); gap:10px; width:100%;">
          <div class="cwKpi"><div class="cwKpiLabel">Total</div><div class="cwKpiVal">${filtered.length}</div></div>
          <div class="cwKpi cwKpiFail"><div class="cwKpiLabel">Fail</div><div class="cwKpiVal">${c.FAIL}</div></div>
          
          <div class="cwKpi" style="border-color:#cbd5e1; background:#f8fafc;"><div class="cwKpiLabel" style="color:#64748b;">Investigating</div><div class="cwKpiVal" style="color:#64748b;">${c.INVESTIGATING}</div></div>
          <div class="cwKpi" style="border-color:#fde047; background:#fef9c3;"><div class="cwKpiLabel" style="color:#ca8a04;">Pending Fix</div><div class="cwKpiVal" style="color:#ca8a04;">${c.PENDING}</div></div>
          <div class="cwKpi" style="border-color:#bbf7d0; background:#dcfce7;"><div class="cwKpiLabel" style="color:#16a34a;">Fixed</div><div class="cwKpiVal" style="color:#16a34a;">${c.FIXED}</div></div>
          <div class="cwKpi" style="border-color:#e2e8f0; background:#f1f5f9;"><div class="cwKpiLabel" style="color:#94a3b8;">Ignored</div><div class="cwKpiVal" style="color:#94a3b8;">${c.IGNORED}</div></div>

          <div class="cwKpi cwKpiPass"><div class="cwKpiLabel">Pass</div><div class="cwKpiVal">${c.PASS}</div></div>
          <div class="cwKpi cwKpiManual"><div class="cwKpiLabel">Manual</div><div class="cwKpiVal">${c.MANUAL}</div></div>
        </div>
      `;
    }

    function renderCharts(filtered) {
      const c = countStatuses(filtered);

      destroyIfExists("ovStatusDonut");
      const labels = ["FAIL", "PASS", "MANUAL", "IGNORED", "INVESTIGATING", "PENDING", "FIXED"];
      const rawData = [c.FAIL, c.PASS, c.MANUAL, c.IGNORED, c.INVESTIGATING, c.PENDING, c.FIXED];
      const colors = ["#ef4444", "#22c55e", "#f59e0b", "#94a3b8", "#cbd5e1", "#fde047", "#16a34a"];

      const chartLabels = [];
      const chartData = [];
      const chartColors = [];
      for (let i = 0; i < rawData.length; i++) {
        if (rawData[i] > 0) {
          chartLabels.push(labels[i]);
          chartData.push(rawData[i]);
          chartColors.push(colors[i]);
        }
      }

      if ($("ovStatusDonut")) {
        window.ovStatusDonut = new Chart($("ovStatusDonut"), {
          type: "doughnut",
          data: { labels: chartLabels, datasets: [{ data: chartData, backgroundColor: chartColors, borderWidth: 0 }] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            plugins: { legend: { position: "left", display: true } }
          }
        });
      }

      const failed = filtered.filter((r) => {
        if (String(r.STATUS).toUpperCase() !== "FAIL") return false;
        const ts = getTriageState()[getFindingId(r)];
        if (ts && (ts.status === "ignored" || ts.status === "fixed" || ts.status === "pending")) return false;
        return true;
      });

      const bySection = groupMap(failed, (r) => String(r.CATEGORIES || "Other").trim());
      const sortedSections = Array.from(bySection.entries())
        .map(([k, v]) => ({ k, n: v.length }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 12);

      destroyIfExists("ovTopSections");
      if ($("ovTopSections")) {
        window.ovTopSections = new Chart($("ovTopSections"), {
          type: "bar",
          data: {
            labels: sortedSections.map((s) =>
              s.k.length > 26 ? s.k.slice(0, 26) + "..." : s.k
            ),
            datasets: [{ data: sortedSections.map((s) => s.n), backgroundColor: "#ef4444", borderRadius: 4 }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true }, y: { grid: { display: false } } }
          }
        });
      }

      const sev = countSeverities(filtered);
      destroyIfExists("ovSeverityBar");
      if ($("ovSeverityBar")) {
        window.ovSeverityBar = new Chart($("ovSeverityBar"), {
          type: "bar",
          data: {
            labels: ["critical", "high", "medium", "low"],
            datasets: [
              {
                data: [sev.critical, sev.high, sev.medium, sev.low],
                backgroundColor: ["#7a0916", "#ef4444", "#f59e0b", "#22c55e"],
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
          }
        });
      }

      const bySvc = groupMap(failed, (r) => String(r.SERVICE_NAME || "Other").trim());
      const sortedSvc = Array.from(bySvc.entries())
        .map(([k, v]) => ({ k, n: v.length }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 12);

      destroyIfExists("ovServiceBar");
      if ($("ovServiceBar")) {
        window.ovServiceBar = new Chart($("ovServiceBar"), {
          type: "bar",
          data: {
            labels: sortedSvc.map((s) =>
              s.k.length > 26 ? s.k.slice(0, 26) + "..." : s.k
            ),
            datasets: [{ data: sortedSvc.map((s) => s.n), backgroundColor: "#7c2d12", borderRadius: 4 }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true }, y: { grid: { display: false } } }
          }
        });
      }
    }

    function renderTable(filtered) {
      if (els.findingsCount) els.findingsCount.textContent = `(${filtered.length})`;
      const tState = getTriageState();

      const checks = Array.from(groupMap(filtered, (r) => r.CHECK_ID || "Unknown").entries()).map(
        ([id, rows]) => {
          let fail = 0,
            pass = 0,
            manual = 0;
          let investigating = 0,
            pending = 0,
            fixed = 0,
            ignored = 0;

          rows.forEach((r) => {
            const st = String(r.STATUS).toUpperCase();
            if (st === "FAIL") {
              const ts = tState[getFindingId(r)];
              if (ts && ts.status === "ignored") ignored++;
              else if (ts && ts.status === "investigating") investigating++;
              else if (ts && ts.status === "pending") pending++;
              else if (ts && ts.status === "fixed") fixed++;
              else fail++;
            } else if (st === "PASS") pass++;
            else if (st === "MANUAL") manual++;
          });
          const title = rows[0]?.CHECK_TITLE;
          return { id, title, rows, fail, pass, manual, investigating, pending, fixed, ignored };
        }
      );

      if (!els.table) return;
      els.table.innerHTML = `
        <div class="cwTree">
          ${checks
            .slice(0, state.pageSize)
            .map((c, ci) => {
              const safeTitle = escapeHtml(c.title);
              const titleShort =
                c.title && c.title.length > 110
                  ? escapeHtml(c.title.slice(0, 110)) + "..."
                  : safeTitle;
              return `
              <details class="cwCheck" data-ci="${ci}">
                <summary class="cwCheckSummary" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                  <div class="cwCheckLeft" style="min-width:0;flex:1;padding-right:8px;">
                    <div class="cwCheckId">${escapeHtml(c.id)}</div>
                    <div class="cwCheckTitle" title="${safeTitle}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${titleShort}</div>
                  </div>
                  <div class="cwPills" style="flex-shrink:0;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                    ${c.fail > 0 ? `<span class="cwPill cwFail">FAIL ${c.fail}</span>` : ""}
                    ${
                      c.investigating > 0
                        ? `<span style="background:#f8fafc; border:1px solid #cbd5e1; color:#475569; padding:4px 8px; border-radius:999px; font-weight:900; font-size:10px;">INV ${c.investigating}</span>`
                        : ""
                    }
                    ${
                      c.pending > 0
                        ? `<span style="background:#fef9c3; border:1px solid #fde047; color:#a16207; padding:4px 8px; border-radius:999px; font-weight:900; font-size:10px;">PEND ${c.pending}</span>`
                        : ""
                    }
                    ${
                      c.fixed > 0
                        ? `<span style="background:#dcfce7; border:1px solid #bbf7d0; color:#15803d; padding:4px 8px; border-radius:999px; font-weight:900; font-size:10px;">FIXED ${c.fixed}</span>`
                        : ""
                    }
                    ${
                      c.ignored > 0
                        ? `<span style="background:#f1f5f9; border:1px solid #e2e8f0; color:#64748b; padding:4px 8px; border-radius:999px; font-weight:900; font-size:10px;">IGN ${c.ignored}</span>`
                        : ""
                    }
                    ${c.pass > 0 ? `<span class="cwPill cwPass">PASS ${c.pass}</span>` : ""}
                    ${c.manual > 0 ? `<span class="cwPill cwManual">MANUAL ${c.manual}</span>` : ""}
                    ${
                      c.fail === 0 &&
                      c.pass === 0 &&
                      c.manual === 0 &&
                      c.investigating === 0 &&
                      c.pending === 0 &&
                      c.fixed === 0 &&
                      c.ignored === 0
                        ? `<span class="cwPill">0</span>`
                        : ""
                    }
                  </div>
                </summary>
                <div class="cwTableWrap" style="margin:10px;">
                  <table class="cwTable">
                    <thead><tr><th>STATUS</th><th>SEV</th><th>SERVICE</th><th>RESOURCE</th></tr></thead>
                    <tbody>
                      ${c.rows
                        .slice(0, 100)
                        .map((r, ri) => {
                          const ts = tState[getFindingId(r)];
                          const isSuppressed = ts && (ts.status === "ignored" || ts.status === "fixed");
                          const rowOpacity = isSuppressed ? "opacity:0.5;" : "";
                          const triageBadge =
                            ts && ts.status
                              ? `<span style="font-size:9px; background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:800; text-transform:uppercase;">${escapeHtml(
                                  ts.status
                                )}</span>`
                              : "";
                          return `
                        <tr class="cwRow" data-ci="${ci}" data-ri="${ri}" style="${rowOpacity}">
                          <td>
                            <span class="${
                              String(r.STATUS).toUpperCase() === "FAIL"
                                ? "cwStatusFail"
                                : "cwStatusPass"
                            }">${escapeHtml(r.STATUS)}</span>
                            ${triageBadge}
                          </td>
                          <td>${escapeHtml(r.SEVERITY)}</td>
                          <td>${escapeHtml(r.SERVICE_NAME)}</td>
                          <td class="cwMono">${escapeHtml(r.RESOURCE_UID)}</td>
                        </tr>
                        `;
                        })
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </details>
            `;
            })
            .join("")}
        </div>
      `;

      els.table.querySelectorAll("tr.cwRow").forEach((tr) => {
        tr.addEventListener("click", () => {
          const ci = Number(tr.getAttribute("data-ci"));
          const ri = Number(tr.getAttribute("data-ri"));
          if (els.details) els.details.innerHTML = renderDetailsPanel(checks[ci].rows[ri]);
        });
      });
    }

    function rerender() {
      updateFilterReadout();
      const filtered = applyFilters(allRows);
      renderKpis(filtered);
      renderCharts(filtered);
      renderTable(filtered);
    }

    if (!host.dataset.eventsBound) {
      ["account", "region", "severity", "service", "status"].forEach((k) => {
        if (els[k]) els[k].addEventListener("change", () => { state[k] = els[k].value; rerender(); });
      });
      if (els.pageSize)
        els.pageSize.addEventListener("change", () => {
          state.pageSize = Number(els.pageSize.value);
          rerender();
        });
      if (els.search)
        els.search.addEventListener(
          "input",
          debounce(() => {
            state.q = norm(els.search.value);
            rerender();
          }, 200)
        );
      if (els.reset)
        els.reset.addEventListener("click", () => {
          ["account", "region", "severity", "service", "status"].forEach((k) => {
            state[k] = "ALL";
            if (els[k]) els[k].value = "ALL";
          });
          state.q = "";
          if (els.search) els.search.value = "";
          rerender();
        });

      window.addEventListener("cw-triage-updated", () => {
        rerender();
      });
      host.dataset.eventsBound = "true";
    }

    rerender();
  }

  // ------------------------------------------------------------------------
  // 7. Compliance Explorer
  // ------------------------------------------------------------------------
  function localStatusCounts(rows) {
    const c = { FAIL: 0, PASS: 0, MANUAL: 0, IGNORED: 0, INVESTIGATING: 0, PENDING: 0, FIXED: 0 };
    let tState = {};
    try {
      const stored = localStorage.getItem("cw_triage_state");
      if (stored) tState = JSON.parse(stored);
    } catch (e) {}

    rows.forEach((r) => {
      const s = String(r.STATUS).toUpperCase();
      if (s === "FAIL") {
        const findingId = [
          r.CHECKID || r.CHECK_ID,
          r.RESOURCEUID || r.RESOURCE_UID,
          r.ACCOUNTUID || r.ACCOUNT_UID
        ].join("|");
        const ts = tState[findingId];
        if (ts && ts.status) {
          const st = ts.status.toUpperCase();
          if (c[st] !== undefined) {
            c[st]++;
          } else {
            c.FAIL++;
          }
        } else {
          c.FAIL++;
        }
      } else if (s in c) {
        c[s]++;
      }
    });
    return c;
  }

  function renderCompliance(allRows) {
    const host = document.getElementById("viewCompliance");
    if (!host) return;

    if (!host.dataset.initialized) {
      host.innerHTML = `
        <div class="card" style="padding:16px 14px;margin-bottom:12px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div style="min-width:260px;">
              <div style="font-size:16px;font-weight:900;color:var(--cw-text-main);">Compliance Explorer</div>
              <div style="color:var(--cw-text-muted);margin-top:2px;">Browse by section & check affected resources.</div>
            </div>
            <div class="cwFilters" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <div>
                <label class="cwLabel">Framework</label>
                <select id="ceFramework" class="cwSelect"></select>
              </div>
              <div>
                <label class="cwLabel">Status</label>
                <select id="ceStatus" class="cwSelect">
                  <option value="ALL" selected>All</option>
                  <option value="FAIL">Fail</option>
                  <option value="PASS">Pass</option>
                  <option value="MANUAL">Manual</option>
                </select>
              </div>
              <div>
                <label class="cwLabel">Search</label>
                <input id="ceSearch" class="cwInput" placeholder="Search section/check..." style="width:220px;" />
              </div>
            </div>
          </div>
        </div>

        <div id="ceKpis" class="cwKpis" style="margin-bottom: 12px;"></div>

        <div class="cwSplit2" style="margin-top:12px;">
          <div id="ceTree" class="cwTree"></div>
          <div id="ceDetails" class="card cwDetails">
            <div style="font-weight:900;color:var(--cw-text-main);">Details</div>
            <div class="cwDetailsHint">Click a row to see details.</div>
          </div>
        </div>
      `;
      host.dataset.initialized = "true";
    }

    const els = {
      fw: document.getElementById("ceFramework"),
      status: document.getElementById("ceStatus"),
      search: document.getElementById("ceSearch"),
      tree: document.getElementById("ceTree"),
      details: document.getElementById("ceDetails"),
      kpis: document.getElementById("ceKpis")
    };

    const allFrameworks = collectFrameworks(allRows);
    if (els.fw) {
      els.fw.innerHTML = allFrameworks
        .map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`)
        .join("");
      if (allFrameworks.length > 0) els.fw.value = allFrameworks[0];
    }

    function renderKpis(filtered, currentFramework) {
      if (!els.kpis) return;
      const c = localStatusCounts(filtered);
      const total = filtered.length;
      const passCount = c.PASS || 0;
      const compliancePct = total > 0 ? Math.round((passCount / total) * 100) : 0;
      const pctColor =
        compliancePct >= 80 ? "#22c55e" : compliancePct >= 60 ? "#f59e0b" : "#ef4444";
      const fwDisplay = currentFramework ? escapeHtml(currentFramework) : "All Frameworks";

       els.kpis.innerHTML = `
      <div class="cwComplianceKpiGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(100px, 1fr)); gap:10px; width:100%;">
        <div class="cwFrameworkSummary" style="border: 1px solid rgba(255, 255, 255, 0.1); background-color:#22253D; box-shadow: 0 8px 20px -4px rgba(34, 37, 61, 0.3); grid-column: span 2; display:flex; justify-content:space-between; align-items:center; padding:20px 24px; border-radius: 12px;">
          <div class="cwFrameworkSummary-header">
            <div class="cwFrameworkSummary-label" style="font-size:12px; color:rgba(255,255,255,0.6); text-transform:uppercase; font-weight:800; letter-spacing:0.1em; margin-bottom:6px;">Framework</div>
            <div class="cwFrameworkSummary-name" style="font-size:18px; font-weight:900; color:#FFFFFF; line-height:1.3; word-wrap:break-word; letter-spacing:-0.01em;">${fwDisplay}</div>
          </div>
          <div class="cwFrameworkSummary-scoreBlock" style="text-align:right;">
            <div class="cwFrameworkSummary-scoreLabel" style="color:rgba(255,255,255,0.6); font-size:13px; font-weight: 800; text-transform:uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Compliance score</div>
            <div class="cwFrameworkSummary-scoreValue" style="color:${pctColor}; font-size:42px; font-weight:900; line-height:1; text-shadow:0 2px 18px ${pctColor}55;">
              ${compliancePct}%
            </div>
          </div>
        </div>

        <div class="cwKpi cwComplianceKpi"><div class="cwKpiLabel">Total Rows</div><div class="cwKpiVal">${total || 0}</div></div>
        <div class="cwKpi cwComplianceKpi cwKpiFail"><div class="cwKpiLabel">Fail</div><div class="cwKpiVal">${c.FAIL || 0}</div></div>
        
        ${(c.INVESTIGATING || 0) > 0 ? `<div class="cwKpi cwComplianceKpi" style="border-color:#cbd5e1; background:#f8fafc;"><div class="cwKpiLabel" style="color:#64748b;">Investigating</div><div class="cwKpiVal" style="color:#64748b;">${c.INVESTIGATING}</div></div>` : ""}
        ${(c.PENDING || 0) > 0 ? `<div class="cwKpi cwComplianceKpi" style="border-color:#fde047; background:#fef9c3;"><div class="cwKpiLabel" style="color:#ca8a04;">Pending Fix</div><div class="cwKpiVal" style="color:#ca8a04;">${c.PENDING}</div></div>` : ""}
        ${(c.FIXED || 0) > 0 ? `<div class="cwKpi cwComplianceKpi" style="border-color:#bbf7d0; background:#dcfce7;"><div class="cwKpiLabel" style="color:#16a34a;">Fixed</div><div class="cwKpiVal" style="color:#16a34a;">${c.FIXED}</div></div>` : ""}
        ${(c.IGNORED || 0) > 0 ? `<div class="cwKpi cwComplianceKpi" style="border-color:#e2e8f0; background:#f1f5f9;"><div class="cwKpiLabel" style="color:#94a3b8;">Ignored</div><div class="cwKpiVal" style="color:#94a3b8;">${c.IGNORED}</div></div>` : ""}
        
        <div class="cwKpi cwComplianceKpi cwKpiPass"><div class="cwKpiLabel">Pass</div><div class="cwKpiVal">${c.PASS || 0}</div></div>
        <div class="cwKpi cwComplianceKpi cwKpiManual"><div class="cwKpiLabel">Manual</div><div class="cwKpiVal">${c.MANUAL || 0}</div></div>
      </div>
    `;
    }

    function rerender() {
      const fw = els.fw ? els.fw.value : null;
      const st = els.status ? els.status.value : "ALL";
      const q = els.search ? norm(els.search.value) : "";

      const filtered = allRows.filter((r) => {
        if (fw && !extractFrameworksFromCell(r.COMPLIANCE).includes(fw)) return false;
        if (st !== "ALL" && String(r.STATUS).toUpperCase() !== st) return false;
        if (q) {
          const hay = norm(
            [
              r.COMPLIANCE,
              r.CHECK_ID || r.CHECKID,
              r.CHECK_TITLE || r.CHECKTITLE,
              r.RESOURCE_UID || r.RESOURCEUID,
              r.SERVICE_NAME || r.SERVICENAME
            ].join(" ")
          );
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      renderKpis(filtered, fw);

      const sections = groupMap(filtered, (r) => (r.CATEGORIES || "Other").trim());
      const sectionEntries = Array.from(sections.entries()).sort(
        (a, b) => b[1].length - a[1].length
      );

      if (!els.tree) return;
      els.tree.innerHTML = "";

      for (const [sectionName, sectionRows] of sectionEntries) {
        const secDet = document.createElement("details");
        secDet.className = "cwSection";
        secDet.open = true;
        secDet.innerHTML = `
          <summary class="cwSectionSummary">
            <div class="cwSectionName">${escapeHtml(sectionName)}</div>
            <div class="cwSectionMeta">${sectionRows.length} findings</div>
          </summary>
          <div class="cwSectionBody"></div>
        `;
        const body = secDet.querySelector(".cwSectionBody");

        const byCheck = groupMap(sectionRows, (r) =>
          ((r.CHECK_ID || r.CHECKID) || "Unknown").trim()
        );
        const checksSorted = Array.from(byCheck.entries()).sort(
          (a, b) => b[1].length - a[1].length
        );

        for (const [checkId, checkRows] of checksSorted) {
          const title = (checkRows[0]?.CHECK_TITLE || checkRows[0]?.CHECKTITLE || "").trim();
          const cc = localStatusCounts(checkRows);
          const chkDet = document.createElement("details");
          chkDet.className = "cwCheck";
          chkDet.innerHTML = `
            <summary class="cwCheckSummary" style="display:flex; justify-content:space-between; align-items:center;">
              <div style="flex:1; min-width:0; padding-right:15px;">
                <div class="cwCheckId">${escapeHtml(checkId)}</div>
                <div class="cwCheckTitle" style="font-size:0.75rem;color:var(--cw-text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(
                  title
                )}</div>
              </div>
              <div style="display:flex; gap:6px; flex-shrink:0;">
                ${cc.FAIL ? `<span class="cwPill cwFail">FAIL ${cc.FAIL}</span>` : ""}
                ${cc.PASS ? `<span class="cwPill cwPass">PASS ${cc.PASS}</span>` : ""}
              </div>
            </summary>
            
            <div class="cwTableWrap" style="margin:10px;">
              <table class="cwTable">
                <thead><tr><th>STATUS</th><th>SEV</th><th>SERVICE</th><th>RESOURCE</th></tr></thead>
                <tbody>
                  ${checkRows
                    .slice(0, 250)
                    .map((r, idx) => {
                      let ts = null;
                      try {
                        const state = JSON.parse(localStorage.getItem("cw_triage_state")) || {};
                        const fId = [
                          r.CHECK_ID || r.CHECKID,
                          r.RESOURCE_UID || r.RESOURCEUID,
                          r.ACCOUNT_UID || r.ACCOUNTUID
                        ].join("|");
                        ts = state[fId];
                      } catch (e) {}
                      const isSuppressed =
                        ts && (ts.status === "ignored" || ts.status === "fixed");
                      const rowOpacity = isSuppressed ? "opacity:0.5" : "";
                      const triageBadge =
                        ts && ts.status
                          ? `<span style="font-size:9px; background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:800; text-transform:uppercase;">${escapeHtml(
                              ts.status
                            )}</span>`
                          : "";
                      return `
                    <tr class="cwRow" data-idx="${idx}" style="${rowOpacity}">
                      <td><span class="${
                        String(r.STATUS).toUpperCase() === "FAIL"
                          ? "cwStatusFail"
                          : "cwStatusPass"
                      }">${escapeHtml(r.STATUS)}</span>${triageBadge}</td>
                      <td>${escapeHtml(r.SEVERITY)}</td>
                      <td>${escapeHtml(
                        r.SERVICE_NAME || r.SERVICENAME || r.SERVICE || ""
                      )}</td>
                      <td class="cwMono">${escapeHtml(
                        r.RESOURCE_UID || r.RESOURCEUID || r.RESOURCE || ""
                      )}</td>
                    </tr>
                    `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `;

          chkDet.querySelectorAll("tr.cwRow").forEach((tr) => {
            tr.addEventListener("click", () => {
              const idx = Number(tr.getAttribute("data-idx"));
              if (els.details) els.details.innerHTML = renderDetailsPanel(checkRows[idx]);
            });
          });
          body.appendChild(chkDet);
        }
        els.tree.appendChild(secDet);
      }
    }

    if (!host.dataset.eventsBound) {
      if (els.fw) els.fw.addEventListener("change", rerender);
      if (els.status) els.status.addEventListener("change", rerender);
      if (els.search) els.search.addEventListener("input", debounce(rerender, 200));
      host.dataset.eventsBound = "true";
    }

    rerender();
  }

  // ------------------------------------------------------------------------
  // 8. CSV Parser & Chart Loader
  // ------------------------------------------------------------------------
  function parseDelimited(text, delimiter) {
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    if (!lines.length) return { headers: [], rows: [] };

    const headers = parseDelimitedLine(lines[0], delimiter).map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseDelimitedLine(lines[i], delimiter);
      if (!cols.length) continue;
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        let val = cols[c] ?? "";
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1).replace(/""/g, '"');
        }
        obj[headers[c]] = val;
      }
      rows.push(obj);
    }
    return { headers, rows };
  }

  function parseDelimitedLine(line, delimiter) {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (!inQuotes && ch === delimiter) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Chart.js failed to load"));
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------------------
  // 9. Bootloader (tabs + data load)
  // ------------------------------------------------------------------------
  function bindTabs() {
    const tabOverview = document.getElementById('tabOverview');
    const tabCompliance = document.getElementById('tabCompliance');
    const viewOverview = document.getElementById('viewOverview');
    const viewCompliance = document.getElementById('viewCompliance');

    if (!tabOverview || !tabCompliance) return;

    tabOverview.addEventListener('click', () => {
      tabOverview.classList.add('cwTabActive');
      tabCompliance.classList.remove('cwTabActive');
      viewOverview.style.display = 'block';
      viewCompliance.style.display = 'none';
    });

    tabCompliance.addEventListener('click', () => {
      tabCompliance.classList.add('cwTabActive');
      tabOverview.classList.remove('cwTabActive');
      viewOverview.style.display = 'none';
      viewCompliance.style.display = 'block';
    });
  }

  function boot() {
    // bindTabs();
    
    const conf = window.CWCONFIG || { 
      clientName: "Synthetic Data — No Customer Info", 
      environment: "DEMO",
      csvUrl: "latest.csv" 
    };

    const uiClientName = document.getElementById('uiClientName');
    const uiEnvBadge = document.getElementById('uiEnvBadge');
    
    if (uiClientName) uiClientName.textContent = conf.clientName;
    if (uiEnvBadge) {
      uiEnvBadge.textContent = conf.environment;
      if (conf.environment === "PROD") {
        uiEnvBadge.style.backgroundColor = "#10b981";
      } else {
        uiEnvBadge.style.backgroundColor = "#7c3aed";
      }
    }
    
    if (!conf.csvUrl) {
      document.getElementById('viewOverview').innerHTML = 
        `<div style="color:#ef4444;padding:20px;">Configuration Error: Missing CSV URL.</div>`;
      return;
    }

    fetch(conf.csvUrl, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error("CSV fetch failed HTTP " + res.status);
        return res.text();
      })
      .then(text => {
        let parsed = parseDelimited(text, ';');
        if (parsed.headers.length <= 1) {
          parsed = parseDelimited(text, ',');
        }
        
        const rowsRaw = parsed.rows;
        const rows = hydrateRowsWithMeta(rowsRaw);
        window.allRows = rows;

        return loadChartJs().then(() => {
          window.Chart.defaults.color = '#64748b';
          window.Chart.defaults.scale.grid.color = '#f1f5f9';
          window.Chart.defaults.font.family = "'Inter', sans-serif";
          
          renderOverview(rows);
          renderCompliance(rows);
          renderSummary(rows);
        });
      })
      .catch(err => {
        console.error(err);
        const o = document.getElementById('viewOverview');
        if (o) o.innerHTML = `<div style="color:#ef4444;padding:20px;">Error loading data: ${err.message}</div>`;
      });
  }

   // ------------------------------------------------------------------------
  // 10. Summary View (With Embedded Charts)
  // ------------------------------------------------------------------------
 function buildSnapshotCard(allRows) {
  const c = countStatuses(allRows);
  const sev = countSeverities(allRows);

  const total = c.FAIL + c.PASS + c.MANUAL;
  const openFails = c.FAIL;
  const crit = sev.critical || 0;
  const high = sev.high || 0;

  // For now totals = overall critical/high findings; plug real denominators here if you have them
  const sevTotalCritical = crit;
  const sevTotalHigh = high;

  const passPct = total > 0 ? Math.round((c.PASS / total) * 100) : 0;
  const passColor =
    passPct >= 80 ? "#22c55e" :
    passPct >= 60 ? "#fbbf24" :
    "#f97316";

  return ''
    + '<div class="cwSummaryCard" style="padding:14px 12px; border-radius:12px;'
    + ' border:1px solid #1d4ed8;'
    + ' background:linear-gradient(135deg,#0E2262,#1d4ed8);'
    + ' color:#e5e7eb; box-shadow:0 10px 25px rgba(15,23,42,0.35);">'
    + '  <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.08em;'
    + ' color:#bfdbfe; font-weight:800; margin-bottom:4px;">Snapshot</div>'
    + '  <div style="font-size:16px; font-weight:900; margin-bottom:10px; color:#f9fafb;">Environment health</div>'
    + '  <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:10px;">'
    + '    <div>'
    + '      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#e5e7eb; margin-bottom:2px;">Pass rate</div>'
    + '      <div style="font-size:22px; font-weight:900; color:' + passColor + ';">' + passPct + '%</div>'
    + '    </div>'
    + '    <div>'
    + '      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#e5e7eb; margin-bottom:2px;">Open fails</div>'
    + '      <div style="font-size:18px; font-weight:800;">' + openFails + '</div>'
    + '    </div>'
    + '  </div>'
    + '  <div style="display:flex; flex-direction:column; gap:4px; font-size:11px;">'
    + '    <div style="display:flex; justify-content:space-between; align-items:center;">'
    + '      <span style="color:#e5e7eb;">Critical</span>'
    + '      <span><span style="color:#fecaca; font-weight:700;">' + crit + '</span><span style="opacity:0.8;"> / ' + sevTotalCritical + '</span></span>'
    + '    </div>'
        + '    <div style="display:flex; justify-content:space-between; align-items:center;">'
    + '      <span style="color:#e5e7eb;">High</span>'
    + '      <span><span style="color:#fed7aa; font-weight:700;">' + high + '</span><span style="opacity:0.8;"> / ' + sevTotalHigh + '</span></span>'
    + '    </div>'
    + '  </div>'
    + '  <div style="margin-top:10px; padding-top:8px; border-top:1px dashed rgba(248,250,252,0.35); font-size:11px; line-height:1.4; color:#e5e7eb;">'
    + '    We recommend addressing the critical and high-severity findings within the next 7 days to minimize security exposure. CloudWizard can help you remediate these issues quickly with our managed security service.'
    + '  </div>'
    + '</div>';
}
  
  function renderSummary(allRows) {
    const host = $("viewSummaryInner");
    if (!host) return;

    // -------- 10A. Data Processing --------
    var totalChecks = allRows.length;
    var counts = countStatuses(allRows);
    var failCount = counts.FAIL || 0;
    var passCount = counts.PASS || 0;
    
    var severities = countSeverities(allRows);
    var criticalFail = severities.critical || 0;
    var highFail = severities.high || 0;
    
    var passRate = totalChecks > 0 ? (passCount / totalChecks) * 100 : 0;
    var postureLabel = "Needs attention";
    if (passRate >= 90) postureLabel = "Strong";
    else if (passRate >= 70) postureLabel = "Fair";

    var byService = {};
    allRows.forEach(function(r) {
      if (String(r.STATUS).toUpperCase() === 'FAIL') {
        var svc = String(r.SERVICE_NAME || r.SERVICE || "Unknown").trim();
        var sev = norm(r.SEVERITY);
        if (!byService[svc]) byService[svc] = { critical: 0, high: 0, totalFail: 0 };
        byService[svc].totalFail++;
        if (sev === 'critical') byService[svc].critical++;
        if (sev === 'high') byService[svc].high++;
      }
    });

    var frameworkStats = {};
    allRows.forEach(function(r) {
      var fws = extractFrameworksFromCell(r.COMPLIANCE);
      var isPass = String(r.STATUS).toUpperCase() === 'PASS';
      var isFail = String(r.STATUS).toUpperCase() === 'FAIL';
      var sev = norm(r.SEVERITY);

      fws.forEach(function(fw) {
        if (!frameworkStats[fw]) {
          frameworkStats[fw] = { total: 0, pass: 0, fail: 0, highFail: 0, criticalFail: 0 };
        }
        frameworkStats[fw].total++;
        if (isPass) frameworkStats[fw].pass++;
        if (isFail) {
          frameworkStats[fw].fail++;
          if (sev === 'critical') frameworkStats[fw].criticalFail++;
          if (sev === 'high') frameworkStats[fw].highFail++;
        }
      });
    });

    var fwList = Object.keys(frameworkStats).map(function(fwName) {
      var stats = frameworkStats[fwName];
      var pr = stats.total > 0 ? (stats.pass / stats.total) * 100 : 0;
      return { id: fwName, name: fwName, passRate: pr, total: stats.total, pass: stats.pass, fail: stats.fail, highFail: stats.highFail, criticalFail: stats.criticalFail };
    }).sort(function(a, b) { return a.name.localeCompare(b.name); });

     // -------- 10B. HTML Generators --------
  var criticalSummaryHtml = "";
  if (criticalFail > 0) {
    var criticalServices = Object.keys(byService)
      .map(function (svc) {
        return { name: svc, critical: byService[svc].critical, high: byService[svc].high, totalFail: byService[svc].totalFail };
      })
      .filter(function (s) {
        return s.critical > 0;
      })
      .sort(function (a, b) {
        return (b.critical * 100 + b.high * 10 + b.totalFail) - (a.critical * 100 + a.high * 10 + a.totalFail);
      })
      .slice(0, 5);
      
    var criticalListHtml = "";
    if (criticalServices.length) {
      criticalListHtml = 
        '<ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 0.8rem; color: #881337;">' +
        criticalServices.map(function (s) {
          return '<li style="margin-bottom:4px;"><strong>' + s.name + '</strong> &ndash; ' + s.critical + ' critical</li>';
        }).join("") +
        '</ul>';
    }
    
    criticalSummaryHtml = `
      <div class="cwSummaryCard" style="display:flex; flex-direction:column; background: #fff1f2; border-color: #fecdd3;">
        <div class="cwSummaryLabel" style="color: #be123c;">Critical Risks</div>
        <div class="cwSummaryValue cwSummaryValue-critical" style="font-size: 32px; margin: 8px 0 4px;">${criticalFail}</div>
        <div class="cwSummarySub" style="font-weight: 600; color: #be123c; margin-bottom: 8px;">Failing critical checks</div>
        <div class="cwSummaryBody" style="font-size: 0.8rem; color: #881337;">Concentrated in your top services:</div>
        ${criticalListHtml}
      </div>`;
  } else {
    criticalSummaryHtml = `
      <div class="cwSummaryCard" style="display:flex; flex-direction:column; background: #f0fdf4; border-color: #bbf7d0;">
        <div class="cwSummaryLabel" style="color: #15803d;">Critical Risks</div>
        <div class="cwSummaryValue" style="font-size: 32px; margin: 8px 0 4px; color: #15803d;">0</div>
        <div class="cwSummarySub" style="font-weight: 600; color: #166534;">No critical failing checks!</div>
      </div>`;
  }

    var chartsHtml =
      // TOP ROW: 4 equal 25% boxes
      '<div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; margin-top:16px;">' +
      // snapshot card (25%)
      '  <div>' + buildSnapshotCard(allRows) + '</div>' +
      // Failing by Severity
      '  <div class="cwSummaryCard" style="display:flex; flex-direction:column; box-sizing:border-box;">' +
      '    <div class="cwSummaryLabel">Failing by Severity</div>' +
      '    <div style="flex:1; position:relative; min-height:220px; margin-top:10px;"><canvas id="sumSeverityBar"></canvas></div>' +
      '  </div>' +
      // Top Failing Services
      '  <div class="cwSummaryCard" style="display:flex; flex-direction:column; box-sizing:border-box;">' +
      '    <div class="cwSummaryLabel">Top Failing Services</div>' +
      '    <div style="flex:1; position:relative; min-height:220px; margin-top:10px;"><canvas id="sumServiceBar"></canvas></div>' +
      '  </div>' +
      // Top Failing Regions
      '  <div class="cwSummaryCard" style="display:flex; flex-direction:column; box-sizing:border-box;">' +
      '    <div class="cwSummaryLabel">Top Failing Regions</div>' +
      '    <div style="flex:1; position:relative; min-height:220px; margin-top:10px;"><canvas id="sumRegionBar"></canvas></div>' +
      '  </div>' +
      '</div>' +
      // SECOND ROW: container only; content filled by renderFailedCriticalRisksBlock
      '<div id="cwFailedCriticalWrapper" ' +
      '     style="margin-top:12px;"></div>';

  // ------------------------------------------------------------------------
// 10F. Top failing services cards
// ------------------------------------------------------------------------
var topServicesHtml = "";
var sortedAllServices = Object.keys(byService).map(function (svc) {
  return {
    name: svc,
    critical: byService[svc].critical,
    high: byService[svc].high,
    totalFail: byService[svc].totalFail
  };
}).sort(function (a, b) {
  return b.totalFail - a.totalFail;
}).slice(0, 8); // Show top 8 failing services

if (sortedAllServices.length > 0) {
  var serviceCardsHtml = sortedAllServices.map(function (s) {
    return ''
      + '<article class="cwSummaryCard-fw" style="display:flex; flex-direction:column; justify-content:space-between;">'
      + '  <header class="cwSummaryCardHead">'
      + '    <h3 class="cwSummaryCardTitle" title="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</h3>'
      + '  </header>'
      + '  <div style="flex-grow:1; margin-top:8px;">'
      + '    <div style="font-size:24px; font-weight:900; color:var(--cw-text-main);">'
      +        s.totalFail + ' <span style="font-size:12px; font-weight:600; color:var(--cw-text-muted);">open findings</span>'
      + '    </div>'
      + '  </div>'
      + '  <div class="cwSummaryCardMetrics" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--cw-border);">'
      + '    <div class="cwSummaryMetric">'
      + '      <span class="cwSummaryMetricLabel">High / Critical</span>'
      + '      <span class="cwSummaryMetricValue">'
      + '        <span style="color:#f97316;">' + s.high + '</span> / '
      + '        <span style="color:#ef4444;">' + s.critical + '</span>'
      + '      </span>'
      + '    </div>'
      + '  </div>'
      + '</article>';
  }).join("");

  topServicesHtml =
    '<div class="cwSummaryCard" style="margin-top:16px; border-radius:14px; background: transparent; border: none; box-shadow: none; padding: 0;">'
  + '  <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid var(--cw-border); padding-bottom: 12px; margin-bottom: 16px;">'
  + '    <div>'
  + '      <h2 class="cwSectionTitle" style="border:none; padding:0; margin:0; font-size: 1.25rem;">Top Failing Services</h2>'
  + '      <div style="color:var(--cw-text-muted); margin-top:4px; font-size:14px; font-weight:500;">View your most vulnerable services.</div>'
  + '    </div>'
  + '  </div>'
  + '  <div class="cwSummaryGrid-fw">' + serviceCardsHtml + '</div>'
  + '</div>';
}
        // -- FAILED CRITICAL RISKS ACCORDION --
        var criticalFailedRows = allRows.filter(function(r) {
          return String(r.STATUS).toUpperCase() === 'FAIL' && norm(r.SEVERITY) === 'critical';
        });
        var criticalTreeHtml = "";

        if (criticalFailedRows.length > 0) {
          var criticalChecks = groupMap(criticalFailedRows, function(r) {
            return r.CHECKID || r.CHECK_ID || "Unknown";
          });
          var sortedCriticalChecks = Array.from(criticalChecks.entries()).sort(function(a, b) {
            return b[1].length - a[1].length;
          });
          var tState = getTriageState() || {};

          criticalTreeHtml =
            '<div style="margin-top:32px;">' +
            '  <h2 style="margin:0 0 16px 0; font-size: 26px; font-weight: 500; color: var(--cw-text-main);">Failed critical risks</h2>' +
            '  <div class="cwTree" style="background: var(--cw-bg-card); border-radius: 8px; padding: 4px; border: 1px solid var(--cw-border);">';

          sortedCriticalChecks.forEach(function(chkEntry) {
            var chkId = chkEntry[0];
            var chkRows = chkEntry[1];
            var chkTitle = chkRows[0] && chkRows[0].CHECKTITLE ? chkRows[0].CHECKTITLE.trim() : "";
            var checkFailCount = chkRows.length;

            criticalTreeHtml +=
              '<details class="cwCheck">' +
              '  <summary class="cwCheckSummary" style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--cw-border); cursor:pointer;">' +
              '    <div class="cwCheckLeft" style="min-width:0; flex:1; padding-right:8px;">' +
              '      <div class="cwCheckId" style="font-weight:700; color:var(--cw-text-main); font-size:14px; margin-bottom:4px;">' + escapeHtml(chkId) + '</div>' +
              '      <div class="cwCheckTitle" title="' + escapeHtml(chkTitle) + '" style="font-size:14px; color:var(--cw-text-main);">' + escapeHtml(chkTitle) + '</div>' +
              '    </div>' +
              '    <div class="cwPills" style="flex-shrink:0; display:flex;">' +
              '      <span class="cwPill cwFail" style="border-radius:12px; padding:4px 10px; font-weight:800; font-size:12px; background:#ef4444; color:#fff;">FAIL ' + checkFailCount + '</span>' +
              '    </div>' +
              '  </summary>' +
              '  <div class="cwTableWrap" style="margin: 10px;">' +
              '    <table class="cwTable">' +
              '      <thead><tr><th>STATUS</th><th>SEV</th><th>SERVICE</th><th>RESOURCE</th></tr></thead>' +
              '      <tbody>' +
                       chkRows.slice(0, 100).map(function(r) {
                         var fId = [r.CHECKID, r.RESOURCEUID, r.ACCOUNTUID].join("|");
                         var ts = tState[fId];
                         var isSuppressed = ts && (ts.status === 'ignored' || ts.status === 'fixed');
                         var rowOpacity = isSuppressed ? 'opacity:0.5;' : '';
                         var triageBadge = (ts && ts.status)
                           ? '<span style="font-size:9px; background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:800; text-transform:uppercase;">' + escapeHtml(ts.status) + '</span>'
                           : "";
                         var statusClass = (String(r.STATUS).toUpperCase() === 'FAIL') ? 'cwStatusFail' : 'cwStatusPass';

                         return '<tr class="cwRow" style="' + rowOpacity + '">' +
                                '  <td><span class="' + statusClass + '">' + escapeHtml(r.STATUS) + '</span>' + triageBadge + '</td>' +
                                '  <td>' + escapeHtml(r.SEVERITY) + '</td>' +
                                '  <td>' + escapeHtml(r.SERVICENAME || r.SERVICE || '') + '</td>' +
                                '  <td class="cwMono">' + escapeHtml(r.RESOURCEUID || r.RESOURCE || '') + '</td>' +
                                '</tr>';
                       }).join("") +
              '      </tbody>' +
              '    </table>' +
              '  </div>' +
              '</details>';
          });

          criticalTreeHtml += '</div></div>';
        }

        // -- COMPLIANCE FILTER LOGIC --
        var defaultFrameworks = ["AWS-Foundational-Security-Best-Practices", "AWS-Foundational-Technical-Review", "AWS-Well-Architected-Framework-Security-Pillar", "PCI-3.2.1", "SOC2"];
        var storedStr = localStorage.getItem("cwframeworkprefs");
        var storedFwPref = storedStr ? JSON.parse(storedStr) : defaultFrameworks;

  var complianceHtml = "";
  if (fwList && fwList.length) {
    var filterOptionsHtml = fwList.map(function(fw) {
      var isChecked = storedFwPref.includes(fw.id) ? 'checked' : '';
      return `<label class="cwFwCheckbox"><input type="checkbox" value="${fw.id}" ${isChecked}> <span>${fw.name}</span></label>`;
    }).join('');

    var filterUIHtml = `
      <div class="cwFwFilterWrap">
        <button class="cwFwFilterBtn" id="fwFilterBtn">Filter Frameworks ▾</button>
        <div class="cwFwFilterDropdown" id="fwFilterDropdown">
          <div class="cwFwFilterHeader">
            <button id="fwFilterClear" class="cwBtn" style="padding:4px 8px; font-size:10px;">Clear All</button>
            <button id="fwFilterAll" class="cwBtn" style="padding:4px 8px; font-size:10px;">Select All</button>
          </div>
          <div class="cwFwFilterList">
            ${filterOptionsHtml}
          </div>
        </div>
      </div>`;

    var cardsHtml = fwList.map(function (fw) {
      var passRateFw = typeof fw.passRate === "number" ? fw.passRate : 0;
      var postureClass = passRateFw >= 90 ? "cwSummaryPill-good" : passRateFw >= 70 ? "cwSummaryPill-fair" : "cwSummaryPill-warn";
      var postureLabelFw = passRateFw >= 90 ? "Strong" : passRateFw >= 70 ? "Fair" : "Needs attention";
      var failLabel = (fw.highFail + fw.criticalFail === 0) 
        ? "No high or critical failing controls" 
        : `${fw.criticalFail} critical, ${fw.highFail} high failing controls`;
      
      var displayStyle = storedFwPref.includes(fw.id) ? "flex" : "none";

      return `
        <article class="cwSummaryCard-fw" data-fw-id="${fw.id}" style="display: ${displayStyle}; flex-direction: column; height: 100%; justify-content: space-between;">
          <header class="cwSummaryCardHead">
            <h3 class="cwSummaryCardTitle" title="${fw.name}">${fw.name}</h3>
            <span class="cwSummaryPill ${postureClass}">${postureLabelFw}</span>
          </header>

          <div style="flex-grow: 1;">
            <div class="cwSummaryCardBarWrap">
              <span class="cwSummaryCardBarLabel">${passRateFw.toFixed(0)}% passed</span>
              <div class="cwSummaryCardBarTrack">
                <div class="cwSummaryCardBarFill cwSummaryCardBarFill-${passRateFw >= 90 ? 'good' : passRateFw >= 70 ? 'fair' : 'bad'}" style="width: ${passRateFw.toFixed(0)}%;"></div>
              </div>
            </div>

            <div class="cwSummaryCardMetrics">
              <div class="cwSummaryMetric">
                <span class="cwSummaryMetricLabel">Controls</span>
                <span class="cwSummaryMetricValue">${fw.pass} / ${fw.total}</span>
              </div>
              <div class="cwSummaryMetric">
                <span class="cwSummaryMetricLabel">High / Critical</span>
                <span class="cwSummaryMetricValue">
                  <span style="color:#ef4444;">${fw.highFail}</span> / 
                  <span style="color:#f97316;">${fw.criticalFail}</span>
                </span>
              </div>
            </div>
            <p class="cwSummaryCardFoot">${failLabel}</p>
          </div>

          <div style="margin-top: auto; padding-top: 12px;">
            <button type="button" class="cwSummaryCardLink" data-fw-id="${fw.id}">View failing checks</button>
          </div>
        </article>
      `;
    }).join("");

    complianceHtml = `
      <div class="cwSummaryCard" style="margin-top:16px; border-radius:14px; background: transparent; border: none; box-shadow: none; padding: 0;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid var(--cw-border); padding-bottom: 12px; margin-bottom: 16px;">
          <h2 class="cwSectionTitleCentered" style="border:none; padding:0; margin:0;">Compliance Snapshot</h2>
          ${filterUIHtml}
        </div>
        <div class="cwSummaryGrid-fw" id="fwGridContainer">
          ${cardsHtml}
        </div>
      </div>`;
  }
      // -------- 10C. Final Render HTML & Events --------
    var failingServicesCount = Object.keys(byService).length;

host.innerHTML =
  '<div class="cwSummaryHeader">' +
    '<div class="cwSummaryHeader-main">' +
      '<div class="cwSummaryHeader-title">Security &amp; Compliance Snapshot</div>' +
      '<div class="cwSummaryHeader-sub">High-level view of your AWS risks and framework coverage.</div>' +
    '</div>' +
  '</div>' +
  chartsHtml;

// failed critical risks directly under charts
renderFailedCriticalRisksBlock(allRows);

// compliance grid now comes after that block
host.insertAdjacentHTML("beforeend", complianceHtml);

    // Clean up old event listeners to prevent duplicate triggers
    if (host._cwFilterBound) {
      host.removeEventListener('click', host._cwFilterBound);
      host.removeEventListener('change', host._cwChangeBound);
    }

    function applyFwFilter() {
      var checks = host.querySelectorAll(".cwFwCheckbox input[type='checkbox']");
      var cards = host.querySelectorAll(".cwSummaryCard-fw");
      
      var selected = [];
      for (var i = 0; i < checks.length; i++) {
        if (checks[i].checked) {
          selected.push(checks[i].value);
        }
      }
      
      localStorage.setItem("cwframeworkprefs", JSON.stringify(selected));

      for (var j = 0; j < cards.length; j++) {
        var id = cards[j].getAttribute("data-fw-id");
        cards[j].style.display = (selected.indexOf(id) > -1) ? "flex" : "none";
      }
    }

    // Event Delegation: Attach to the main container, not the volatile inner elements
    host._cwFilterBound = function(e) {
      var btn = e.target.closest('#fwFilterBtn');
      var drop = document.getElementById('fwFilterDropdown');
      
      if (btn && drop) {
        e.stopPropagation();
        drop.style.display = (drop.style.display === "block") ? "none" : "block";
        return;
      }

      if (e.target.closest('#fwFilterClear')) {
        var clrChecks = host.querySelectorAll(".cwFwCheckbox input[type='checkbox']");
        for (var k = 0; k < clrChecks.length; k++) { clrChecks[k].checked = false; }
        applyFwFilter();
        return;
      }

      if (e.target.closest('#fwFilterAll')) {
        var allChecks = host.querySelectorAll(".cwFwCheckbox input[type='checkbox']");
        for (var m = 0; m < allChecks.length; m++) { allChecks[m].checked = true; }
        applyFwFilter();
        return;
      }

      // Framework Card "View failing checks" redirect routing
      var linkBtn = e.target.closest('.cwSummaryCardLink');
      if (linkBtn) {
        var fwId = linkBtn.getAttribute('data-fw-id');
        if (typeof window.goToComplianceFramework === 'function') {
          window.goToComplianceFramework(fwId);
        }
        return;
      }

      if (drop && !e.target.closest('#fwFilterDropdown')) {
        drop.style.display = "none";
      }
    };

    host._cwChangeBound = function(e) {
      if (e.target && e.target.matches && e.target.matches(".cwFwCheckbox input[type='checkbox']")) {
        applyFwFilter();
      }
    };

    host.addEventListener('click', host._cwFilterBound);
    host.addEventListener('change', host._cwChangeBound);

    // -------- 10D. Render Chart.js Canvases --------
    if (window.Chart) {
      // 1. Severity Bar Chart
      destroyIfExists("sumSeverityBar");
      if ($("sumSeverityBar")) {
        window.sumSeverityBar = new Chart($("sumSeverityBar"), {
          type: "bar",
          data: { 
            labels: ["Critical", "High", "Medium", "Low"],
            datasets: [{ 
              data: [severities.critical, severities.high, severities.medium, severities.low], 
              // Colors: Critical=Red, High=Orange, Medium=Vibrant Yellow, Low=Green
              backgroundColor: ["#ef4444", "#f97316", "#eab308", "#22c55e"], 
              borderRadius: 4 
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
      }

      const failedRows = allRows.filter(r => String(r.STATUS).toUpperCase() === "FAIL");

      // 2. Top Failing Services Stacked Bar Chart
      const svcStats = {};
      failedRows.forEach(r => {
        const svc = String(r.SERVICE_NAME || "Other").trim();
        const sev = norm(r.SEVERITY);
        if (!svcStats[svc]) svcStats[svc] = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
        svcStats[svc].total++;
        if (sev === 'critical') svcStats[svc].critical++;
        if (sev === 'high') svcStats[svc].high++;
        if (sev === 'medium') svcStats[svc].medium++;
        if (sev === 'low') svcStats[svc].low++;
      });

      const sortedSvc = Object.keys(svcStats).map(k => ({ name: k, stats: svcStats[k] })).sort((a, b) => b.stats.total - a.stats.total).slice(0, 10);

      destroyIfExists("sumServiceBar");
      if ($("sumServiceBar")) {
        window.sumServiceBar = new Chart($("sumServiceBar"), {
          type: "bar",
          data: { 
            labels: sortedSvc.map(s => s.name.length > 15 ? s.name.slice(0, 15) + "..." : s.name),
            datasets: [
              { label: "Critical", data: sortedSvc.map(s => s.stats.critical), backgroundColor: "#ef4444" },
              { label: "High", data: sortedSvc.map(s => s.stats.high), backgroundColor: "#f97316" },
              { label: "Medium", data: sortedSvc.map(s => s.stats.medium), backgroundColor: "#eab308" },
              { label: "Low", data: sortedSvc.map(s => s.stats.low), backgroundColor: "#22c55e" }
            ]
          },
          options: { 
            responsive: true, maintainAspectRatio: false, indexAxis: "y", 
            plugins: { legend: { display: false } }, 
            scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true, grid: { display: false } } } 
          }
        });
      }

      // 3. Top Failing Regions Stacked Bar Chart
      const regStats = {};
      failedRows.forEach(r => {
        const reg = String(r.REGION || "global").trim();
        const sev = norm(r.SEVERITY);
        if (!regStats[reg]) regStats[reg] = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
        regStats[reg].total++;
        if (sev === 'critical') regStats[reg].critical++;
        if (sev === 'high') regStats[reg].high++;
        if (sev === 'medium') regStats[reg].medium++;
        if (sev === 'low') regStats[reg].low++;
      });

      const sortedReg = Object.keys(regStats).map(k => ({ name: k, stats: regStats[k] })).sort((a, b) => b.stats.total - a.stats.total).slice(0, 10);

      destroyIfExists("sumRegionBar");
      if ($("sumRegionBar")) {
        window.sumRegionBar = new Chart($("sumRegionBar"), {
          type: "bar",
          data: { 
            labels: sortedReg.map(s => s.name.length > 15 ? s.name.slice(0, 15) + "..." : s.name),
            datasets: [
              { label: "Critical", data: sortedReg.map(s => s.stats.critical), backgroundColor: "#ef4444" },
              { label: "High", data: sortedReg.map(s => s.stats.high), backgroundColor: "#f97316" },
              { label: "Medium", data: sortedReg.map(s => s.stats.medium), backgroundColor: "#eab308" },
              { label: "Low", data: sortedReg.map(s => s.stats.low), backgroundColor: "#22c55e" }
            ]
          },
          options: { 
            responsive: true, maintainAspectRatio: false, indexAxis: "y", 
            plugins: { legend: { display: false } }, 
            scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true, grid: { display: false } } } 
          }
        });
      }
    }
  }

// ------------------------------------------------------------------------
// 10E. Failed critical risks block (row-level 4-col grid, softer UI)
// ------------------------------------------------------------------------
function renderFailedCriticalRisksBlock(allRows) {
  const host =
    document.getElementById("viewSummaryInner") ||
    document.getElementById("viewSummary");
  if (!host) return;

  const wrapper = document.getElementById("cwFailedCriticalWrapper");
  if (!wrapper) return;

  const tState = getTriageState();

  // --- Critical Risks KPI card (first 25%) – unchanged look ---
  const criticalSummaryCardHtml = (function () {
    var severities = countSeverities(allRows);
    var criticalFail = severities.critical || 0;

    var byService = {};
    allRows.forEach(function (r) {
      if (String(r.STATUS).toUpperCase() === "FAIL") {
        var svc = String(r.SERVICE_NAME || r.SERVICE || "Unknown").trim();
        var sev = norm(r.SEVERITY);
        if (!byService[svc]) byService[svc] = { critical: 0, high: 0, totalFail: 0 };
        byService[svc].totalFail++;
        if (sev === "critical") byService[svc].critical++;
        if (sev === "high") byService[svc].high++;
      }
    });

    var criticalServices = Object.keys(byService)
      .map(function (svc) {
        return {
          name: svc,
          critical: byService[svc].critical,
          high: byService[svc].high,
          totalFail: byService[svc].totalFail
        };
      })
      .filter(function (s) {
        return s.critical > 0;
      })
      .sort(function (a, b) {
        return (
          b.critical * 100 +
          b.high * 10 +
          b.totalFail -
          (a.critical * 100 + a.high * 10 + a.totalFail)
        );
      })
      .slice(0, 5);

    var criticalListHtml = "";
    if (criticalServices.length) {
      criticalListHtml =
        '<ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 0.8rem; color: #881337;">' +
        criticalServices
          .map(function (s) {
            return (
              "<li style=\"margin-bottom:4px;\"><strong>" +
              escapeHtml(s.name) +
              "</strong> &ndash; " +
              s.critical +
              " critical</li>"
            );
          })
          .join("") +
        "</ul>";
    }

    if (criticalFail > 0) {
      return (
        '<div class="cwSummaryCard" style="display:flex; flex-direction:column; background:#fff1f2; border-color:#fecdd3;">' +
        '  <div class="cwSummaryLabel" style="color:#be123c;">Critical Risks</div>' +
        '  <div class="cwSummaryValue cwSummaryValue-critical" style="font-size:32px; margin:8px 0 4px;">' +
        criticalFail +
        "</div>" +
        '  <div class="cwSummarySub" style="font-weight:600; color:#be123c; margin-bottom:8px;\">Failing critical checks</div>' +
        '  <div class="cwSummaryBody" style="font-size:0.8rem; color: #4b5563;">Concentrated in your top services:</div>' +
        criticalListHtml +
        "</div>"
      );
    }

    return (
      '<div class="cwSummaryCard" style="display:flex; flex-direction:column; background:#f0fdf4; border-color:#bbf7d0;">' +
      '  <div class="cwSummaryLabel" style="color:#15803d;">Critical Risks</div>' +
      '  <div class="cwSummaryValue" style="font-size:32px; margin:8px 0 4px; color:#15803d;">0</div>' +
      '  <div class="cwSummarySub" style="font-weight:600; color:#166534;">No critical failing checks!</div>' +
      "</div>"
    );
  })();

  // --- critical FAIL rows (unsuppressed) ---
  const criticalRows = allRows.filter(function (r) {
    const status = String(r.STATUS || "").toUpperCase();
    if (status !== "FAIL") return false;

    const sev = norm(r.SEVERITY);
    if (sev !== "critical") return false;

    const ts = tState[getFindingId(r)];
    if (ts && (ts.status === "ignored" || ts.status === "fixed")) return false;

    return true;
  });

  if (!criticalRows.length) {
    wrapper.innerHTML =
      '<div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px;">' +
      '<div>' + criticalSummaryCardHtml + "</div>" +
      "</div>";
    return;
  }

  const byCheck = groupMap(criticalRows, function (r) {
    return String(r.CHECK_ID || "UNKNOWN").trim();
  });

  const ruleCards = Array.from(byCheck.entries())
    .sort(function (a, b) {
      return b[1].length - a[1].length;
    })
    .slice(0, 12)
    .map(function ([checkId, rows]) {
      const first = rows[0] || {};

      const desc = String(first.DESCRIPTION || "").trim();
      const risk = String(first.RISK || "").trim();
      const title = String(first.CHECK_TITLE || checkId).trim();
      const svc = String(first.SERVICE_NAME || "").trim();
      const region = String(first.REGION || "").trim();
      const account = String(first.ACCOUNT_UID || "").trim();
      const severity = String(first.SEVERITY || "").trim();
      const section = String(first.CATEGORIES || "").trim();
      const failCount = rows.length;

    return (
      '<div>' +
        '<article class="cwSummaryCard" ' +
        'style="display:flex; flex-direction:column; background:#ffffff; border:1px solid #fecaca; box-shadow:none; padding:10px 10px 8px;">' +

          // header
          '<header style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:6px;">' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280; margin-bottom:2px;">Critical rule</div>' +
              // rule id
              '<div style="font-size:11px; font-weight:700; color:#111827; margin-bottom:4px; word-break:break-word;">' +
                escapeHtml(checkId) +
              '</div>' +
              // Description
              (desc
                ? '<div style="font-size:10px; color:#4b5563; line-height:1.4; margin-bottom:4px; max-height:5.6em; overflow:hidden;">' +
                    '<span style="font-weight:600; color:#111827; margin-right:4px;">Description</span>' +
                    escapeHtml(desc) +
                  '</div>'
                : ''
              ) +
              // Risk
              (risk
                ? '<div style="font-size:10px; color:#4b5563; line-height:1.4; max-height:5.6em; overflow:hidden;">' +
                    '<span style="font-weight:600; color:#111827; margin-right:4px;">Risk</span>' +
                    escapeHtml(risk) +
                  '</div>'
                : ''
              ) +
            '</div>' +
            '<div style="text-align:right; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">' +
              '<button type="button" ' +
                'style="border:none; padding:3px 8px; border-radius:999px; background:#fee2e2; color:#b91c1c; font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; cursor:default;">' +
                'CRITICAL FAILURE' +
              '</button>' +
              '<div style="font-size:11px; color:#111827;"><span style="font-weight:700; color:#b91c1c;">' +
                failCount +
              '</span> open</div>' +
            '</div>' +
          '</header>' +

          // meta row
          '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:4px; font-size:9px; color:#4b5563;">' +
            (severity ? '<span>Sev: <span style="font-weight:600; color:#b91c1c;">' + escapeHtml(severity) + '</span></span>' : '') +
            (section ? '<span>Section: <span style="font-weight:600; color:#111827;">' + escapeHtml(section) + '</span></span>' : '') +
            (svc ? '<span>Svc: <span style="font-weight:600; color:#111827;">' + escapeHtml(svc) + '</span></span>' : '') +
            (region ? '<span>Region: <span style="font-weight:600; color:#111827;">' + escapeHtml(region) + '</span></span>' : '') +
            (account ? '<span>Acct: <span style="font-weight:600; color:#111827;">' + escapeHtml(account) + '</span></span>' : '') +
          '</div>' +

          // CTA button instead of list
          '<div style="margin-top:6px;">' +
            '<button type="button" ' +
              'style="width:100%; padding:6px 10px; border-radius:999px; border:1px solid #fecaca; background:#fff7f7;' +
                     ' font-size:11px; font-weight:600; color:#6b7280; cursor:default; display:inline-flex; align-items:center; justify-content:center; gap:6px;">' +
              '<span>View critical failures</span>' +
              '<span style="font-size:10px; color:#b91c1c;">(' + failCount + ')</span>' +
            '</button>' +
          '</div>' +

        '</article>' +
      '</div>'
    );
  }).join("");
  // Full row grid: first col = Critical Risks, remaining cols = rule cards
  wrapper.innerHTML =
    '<div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; align-items:flex-start;">' +
      '<div>' + criticalSummaryCardHtml + "</div>" +
      ruleCards +
    "</div>";
}
  // ------------------------------------------------------------------------
  // 11. Auto-start & Exports
  // ------------------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.parseDelimited = parseDelimited;
  window.hydrateRowsWithMeta = hydrateRowsWithMeta;
  window.loadChartJs = loadChartJs;
  window.renderOverview = renderOverview;
  window.renderCompliance = renderCompliance;
  window.renderSummary = renderSummary;

})(); // closing the IIFE