// Jira 测试报告生成器 - Chrome 扩展 content script (MAIN world)
// 由油猴脚本 jira脚本.js 转换生成，逻辑保持一致。

(() => {
  "use strict";
 
  /* ========== Utils ========== */
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const txt = (el) => (el ? (el.textContent || "").trim() : "");
  const toInt = (s) => {
    const x = (s ?? "").toString().replace(/[^\d]/g, "");
    return x ? parseInt(x, 10) : 0;
  };
  const pct = (n) => Math.round(n * 10000) / 100;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const backoff = (n) =>
    Math.min(1500, 200 * 2 ** (n - 1)) + Math.floor(Math.random() * 120);
  const log = (...a) => console.debug("[TM-Report]", ...a);
  const debounce = (fn, wait = 120) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), wait);
    };
  };
  const toast = (msg, err = false) => {
    if (!msg) return;
    const el = document.createElement("div");
    el.textContent = msg;
    Object.assign(el.style, {
      position: "fixed", left: "50%", bottom: "36px",
      transform: "translateX(-50%)",
      background: err ? "#b91c1c" : "#15803d", color: "#fff",
      padding: "8px 16px", borderRadius: "999px", fontSize: "13px",
      zIndex: "10001", boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  };
  const insertAfter = (node, ref) => {
    if (!ref?.parentNode) return false;
    ref.parentNode.insertBefore(node, ref.nextSibling);
    return true;
  };
 
  /* ========== Theme & Buttons ========== */
  const injectStyles = () => {
    if (document.getElementById("tm-style")) return;
    const s = document.createElement("style");
    s.id = "tm-style";
    s.textContent = `:root{--tm-primary:#2563eb;--tm-primary-hover:#1d4ed8;--tm-fg:#1f2328;--tm-border:rgba(0,0,0,0.15);--tm-ghost-bg:transparent;--tm-ghost-hover:rgba(0,0,0,0.06)}@media(prefers-color-scheme:dark){:root{--tm-fg:#e2e8f0;--tm-border:rgba(255,255,255,0.2);--tm-ghost-hover:rgba(255,255,255,0.08)}}.tm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;user-select:none;white-space:nowrap;border:1px solid var(--tm-border);border-radius:10px;background:var(--tm-ghost-bg);color:var(--tm-fg);transition:filter .12s,background-color .12s,border-color .12s}.tm-btn:hover{filter:brightness(.95)}.tm-btn:disabled{opacity:.6;cursor:not-allowed;filter:none}.tm-btn--sm{padding:2px 8px;font-size:12px;line-height:18px;border-radius:8px}.tm-btn--md{padding:6px 12px;font-size:14px;line-height:22px;border-radius:10px}.tm-btn--lg{padding:8px 14px;font-size:15px;line-height:24px;border-radius:12px}.tm-btn--primary{background:var(--tm-primary);color:#fff;border-color:var(--tm-primary-hover)}.tm-btn--ghost{background:transparent;color:var(--tm-primary);border-color:var(--tm-border)}`;
    document.head.appendChild(s);
  };
  const mkBtn = (text, { variant = "primary", size = "md", id } = {}) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.className = `tm-btn tm-btn--${variant} tm-btn--${size}`;
    if (id) b.id = id;
    return b;
  };
 
  /* ========== Selectors & IDs ========== */
  const SEL = {
    issueSummary:
      '#summary-val, h1#summary-val, h1[data-test-id="issue.views.issue-base.foundation.summary.heading"]',
    opsBar:
      '.command-bar .aui-toolbar2-primary, .command-bar .ops-menus, .command-bar, #opsbar-operations, #opsbar-operations_more, #opsbar-opsbar-operations, #opsbar-opsbar-transitions, .aui-page-header-actions, [data-test-id="issue.issue-view.views.issue-base.foundation.quick-add.quick-add"], [data-test-id="issue.opsbar"]',
    typeVal: "#type-val",
    progressBar: "#exec-tests-progressbar",
    fixVer: "#fixVersions-field a",
    reporter: "#reporter-val",
    splitPaneRight: '#issue-content, [data-test-id="issue-view"]',
    reportTable: "#test-execution-report-table",
  };
  const IDS = {
    modal: "tm-test-report-modal",
    btnToolbar: "tm-btn-toolbar",
    btnDashboard: "tm-btn-dashboard",
    toolbarWrap: "tm-toolbar-wrap",
    btnFloat: "tm-btn-float",
    btnSettings: "tm-btn-settings",
    btnCreateSubtask: "tm-btn-create-subtask",
  };
  const ROW_BTN = "tm-row-report-btn";
 
  const scoped = (sel) =>
    qs(sel) ||
    (qs(SEL.splitPaneRight) && qs(sel, qs(SEL.splitPaneRight))) ||
    null;
 
  /* ========== Page detection ========== */
  const isTestExecutionPage = () => {
    if (scoped(SEL.progressBar)) return true;
    const tv = scoped(SEL.typeVal);
    if (!tv) return false;
    const img = tv.querySelector("img");
    return (
      (img && /test[-_ ]?execution/i.test(img.src || "")) ||
      /Test\s*Execution/i.test(txt(tv))
    );
  };
  const isXrayReportListPage = () =>
    /\/secure\/XrayReport/.test(location.href) &&
    /selectedReportKey=xray-report-testexecution/.test(location.href);
 
  /* ========== Data extraction ========== */
  const extractTestCounts = () => {
    const root = scoped(SEL.progressBar);
    if (!root) return null;
    const cnt = (path) =>
      toInt(txt(root.querySelector(`a[href*="${path}"] .testexec-status-count`)));
    const pass = cnt("PASS"),
      fail = cnt("FAIL"),
      aborted = cnt("ABORTED"),
      executing = cnt("EXECUTING");
    let total = 0;
    const h6 = root.querySelector("h6");
    if (h6) {
      const m = h6.textContent.match(
        /Total\s*Tests[:：]?\s*([\d\.,\s\u202F\u00A0]+)/i
      );
      if (m) total = toInt(m[1]);
    }
    if (!total) total = pass + fail + aborted + executing;
    return { pass, fail, aborted, executing, total };
  };
  const buildCountsFromExecItem = (item) => {
    const s = item?.testCountByStatus?.countByStatus || {};
    const pass = toInt(s.PASS),
      fail = toInt(s.FAIL),
      aborted = toInt(s.ABORTED),
      executing = toInt(s.EXECUTING);
    const total = toInt(
      item?.testCountByStatus?.totalCount ||
        item?.totalTests ||
        item?.testCountByStatus?.finalCount ||
        pass + fail + aborted + executing
    );
    return { pass, fail, aborted, executing, total };
  };
  const getCurrentIssueKey = () =>
    (location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i) || [])[1] || "";
  const getCurrentIssueId = () => {
    const meta = qs('meta[name="ajs-issue-id"]')?.content;
    if (meta && /^\d+$/.test(meta)) return meta;
    const key = qs("#key-val");
    const rel = key?.getAttribute("rel");
    if (rel && /^\d+$/.test(rel)) return rel;
    const byData = qs("[data-issue-id]")?.getAttribute("data-issue-id");
    return byData && /^\d+$/.test(byData) ? byData : "";
  };
  const extractTitle = () => txt(scoped(SEL.issueSummary));
  const extractFixVersion = () => txt(scoped(SEL.fixVer));
  const extractReporter = () => {
    const box = scoped(SEL.reporter);
    if (!box) return "";
    const el =
      box.querySelector(
        '.user-hover, [data-username], a[href*="/people/"], a[href*="/jira/people/"]'
      ) || box;
    for (const a of [
      "data-username", "data-user", "data-user-hover", "aria-label", "rel",
    ]) {
      const v = el.getAttribute?.(a);
      if (v?.trim()) return v.trim();
    }
    return txt(el).replace(/\s*\(.*?\)\s*$/, "");
  };
 
  /* ========== Round info ========== */
  const CN_NUM = { 零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };
  const ROUND_CN = ["零","一","二","三","四","五","六","七","八","九","十"];
  const cnToNum = (s) => {
    if (!s) return NaN;
    if (s === "十") return 10;
    if (s.length === 2 && s[0] === "十") return 10 + (CN_NUM[s[1]] || 0);
    if (s.length === 2 && s[1] === "十") return (CN_NUM[s[0]] || 0) * 10;
    if (s.length === 3 && s[1] === "十")
      return (CN_NUM[s[0]] || 0) * 10 + (CN_NUM[s[2]] || 0);
    let n = 0;
    for (const c of s) {
      if (CN_NUM[c] == null) return NaN;
      n = n * 10 + CN_NUM[c];
    }
    return n;
  };
  const extractRoundInfo = (title) => {
    const m1 = title.match(/第?\s*([一二三四五六七八九十两〇零]{1,3})\s*轮/);
    if (m1) {
      const n = cnToNum(m1[1]);
      return `${Number.isFinite(n) && n > 0 ? n : 1}轮`;
    }
    const m2 = title.match(/第?\s*([0-9]+)\s*轮/);
    if (m2) return `${m2[1]}轮`;
    return "1轮";
  };
  const normalizeRound = (roundInfo, title = "") => {
    const m = (roundInfo || "").match(/(\d+)/);
    if (m) return `${parseInt(m[1], 10)}轮`;
    const cn = (roundInfo || "").match(/([一二三四五六七八九十两〇零]+)/);
    if (cn) {
      const n = cnToNum(cn[1]);
      if (Number.isFinite(n) && n > 0) return `${n}轮`;
    }
    if (title) {
      const tm =
        title.match(/([\d]+)轮/) ||
        title.match(/([一二三四五六七八九十两〇零]+)轮/);
      if (tm) {
        const v = /^\d/.test(tm[1]) ? parseInt(tm[1], 10) : cnToNum(tm[1]);
        if (Number.isFinite(v) && v > 0) return `${v}轮`;
      }
    }
    return "";
  };
  const roundLabelForFilter = (roundInfo, title = "") => {
    if (title && title.includes("两轮测试")) return "两轮测试";
    const norm = normalizeRound(roundInfo, title) || roundInfo || "";
    const n = parseInt((norm.match(/\d+/) || ["0"])[0], 10);
    if (Number.isFinite(n) && n > 0 && n < ROUND_CN.length)
      return `${ROUND_CN[n]}轮测试`;
    return roundInfo ? `${roundInfo}测试` : "测试轮次";
  };
 
  /* ========== Cookies ========== */
  const getXsrfToken = () => {
    const m = document.cookie.match(/(?:^|;\s*)atlassian\.xsrf\.token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  };
  const formatDateYmd = (d = new Date()) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const secondsToHours = (s) => Math.round((Number(s) || 0) / 36) / 100;
  const formatSeconds = (s) => {
    const sec = Math.max(0, Number(s) || 0);
    if (!sec) return "0h";
    const h = sec / 3600;
    if (Number.isInteger(h)) return `${h}h`;
    return `${Math.round(h * 100) / 100}h`;
  };
  const parseWorkSeconds = (raw) => {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return 0;
    const plain = Number(s);
    if (Number.isFinite(plain) && plain > 0) return Math.round(plain * 3600);
    let total = 0;
    const re = /(\d+(?:\.\d+)?)\s*(d|day|days|天|h|hour|hours|小时|m|min|minute|minutes|分钟)?/g;
    let m;
    while ((m = re.exec(s))) {
      const n = Number(m[1]);
      const unit = m[2] || "h";
      if (!Number.isFinite(n)) continue;
      if (/^(d|day|days|天)$/.test(unit)) total += n * 8 * 3600;
      else if (/^(m|min|minute|minutes|分钟)$/.test(unit)) total += n * 60;
      else total += n * 3600;
    }
    return Math.round(total);
  };
  const normalizeWorkEstimate = (raw) => {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    const plain = Number(s);
    if (Number.isFinite(plain) && plain > 0) return `${plain}h`;
    const seconds = parseWorkSeconds(s);
    if (seconds <= 0) return "";
    const hours = seconds / 3600;
    if (Number.isInteger(hours)) return `${hours}h`;
    return `${Math.round(hours * 100) / 100}h`;
  };

  /* ========== Exec metric config ========== */
  const EXEC_METRIC_KEY = "tm_exec_metric_include_blocked";
  const execMetric = { includeAborted: false, includeExecuting: false };
  const loadExecMetric = () => {
    try {
      const on = localStorage.getItem(EXEC_METRIC_KEY) === "1";
      execMetric.includeAborted = on;
      execMetric.includeExecuting = on;
    } catch {}
  };
  const execMetricLabel = () =>
    execMetric.includeAborted || execMetric.includeExecuting
      ? "已执行：含阻塞/执行中"
      : "已执行：仅PASS/FAIL";
  const toggleExecMetric = () => {
    const on = !execMetric.includeAborted;
    execMetric.includeAborted = on;
    execMetric.includeExecuting = on;
    try {
      localStorage.setItem(EXEC_METRIC_KEY, on ? "1" : "0");
    } catch {}
    toast(on ? "已执行/进度将包含阻塞和执行中" : "已执行/进度不包含阻塞和执行中");
  };
  const computeMetrics = (c) => {
    let executed = c.pass + c.fail;
    if (execMetric.includeAborted) executed += c.aborted;
    if (execMetric.includeExecuting) executed += c.executing;
    return {
      executed,
      progress: c.total > 0 ? pct(executed / c.total) : 0,
      successRate: executed > 0 ? pct(c.pass / executed) : 0,
    };
  };

  /* ========== Test summary cache ========== */
  const TEST_SUMMARY_CACHE_KEY = "tm_test_summary_cache_v1";
  const TestSummaryCache = {
    loadAll() {
      try {
        const data = JSON.parse(localStorage.getItem(TEST_SUMMARY_CACHE_KEY) || "{}");
        return data && typeof data === "object" ? data : {};
      } catch {
        return {};
      }
    },
    key(issueKey, title = "") {
      const k = String(issueKey || "").trim();
      if (k) return k;
      const t = String(title || "").trim();
      return t ? `title:${t}` : "";
    },
    get(issueKey, title = "") {
      const k = this.key(issueKey, title);
      if (!k) return "";
      const data = this.loadAll();
      return typeof data[k] === "string" ? data[k] : "";
    },
    set(issueKey, title, value) {
      const k = this.key(issueKey, title);
      if (!k) return;
      const data = this.loadAll();
      data[k] = String(value || "");
      localStorage.setItem(TEST_SUMMARY_CACHE_KEY, JSON.stringify(data));
    },
    remove(issueKey, title = "") {
      const k = this.key(issueKey, title);
      if (!k) return;
      const data = this.loadAll();
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        delete data[k];
        localStorage.setItem(TEST_SUMMARY_CACHE_KEY, JSON.stringify(data));
      }
    },
    saveOrRemove(issueKey, title, value) {
      const v = String(value || "").trim();
      if (v) this.set(issueKey, title, v);
      else this.remove(issueKey, title);
    },
  };
 
  /* ========== Reporter helpers ========== */
  const DEFAULT_REPORTER_CANDIDATES = ["海绵","泡泡","生姜","双辞","秀妍","甜粥","子恒"];
  const REPORTER_CANDIDATES = [...DEFAULT_REPORTER_CANDIDATES];
  const addReporterNames = (set, raw) => {
    if (raw == null) return;
    if (Array.isArray(raw)) return raw.forEach((x) => addReporterNames(set, x));
    String(raw)
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/["'“”]/g, "")
      .split(/[,，、；;]+/)
      .forEach((p) => {
        const n = p.trim();
        if (n) set.add(n);
      });
  };
  const collectAllReporters = (primary, { includeDom = true } = {}) => {
    const set = new Set();
    addReporterNames(set, primary);
    if (includeDom) {
      addReporterNames(set, extractReporter());
      const table = scoped(SEL.reportTable);
      if (table) {
        qsa(
          ".user-hover, [data-username], [data-displayname], [data-user], [data-fullname], [data-person]",
          table
        ).forEach((n) => {
          for (const a of [
            "data-username","data-displayname","data-user","data-fullname",
            "data-person","aria-label","title",
          ]) {
            const v = n.getAttribute?.(a);
            if (v) addReporterNames(set, v);
          }
          if (n.textContent) addReporterNames(set, n.textContent);
        });
      }
    }
    return [...set].filter(Boolean);
  };
 
  /* ========== Candidate picker UI ========== */
  const createCandidatePicker = (
    candidates,
    { onChange, compact = false, selected = [] } = {}
  ) => {
    const namesSet = new Set();
    addReporterNames(namesSet, candidates);
    addReporterNames(namesSet, selected);
    const names = [...namesSet].filter(Boolean);
 
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      display: "flex",
      alignItems: compact ? "flex-start" : "center",
      gap: "6px", flexWrap: "wrap",
      maxWidth: compact ? "420px" : "none",
    });
    const label = document.createElement("span");
    label.textContent = "候选：";
    Object.assign(label.style, {
      fontSize: "12px", color: "#64748b", whiteSpace: "nowrap",
      flex: "0 0 auto", lineHeight: "28px",
    });
    wrap.appendChild(label);
 
    const chips = document.createElement("div");
    Object.assign(chips.style, {
      display: "flex", alignItems: "center", gap: "4px",
      flexWrap: "wrap", flex: "1 1 auto", minWidth: "120px",
    });
    wrap.appendChild(chips);
 
    const selSet = new Set();
    addReporterNames(selSet, selected);
    const buttons = [];
    const setActive = (b, on) => {
      b.classList.toggle("tm-btn--primary", on);
      b.classList.toggle("tm-btn--ghost", !on);
    };
    const emit = () => onChange?.([...selSet]);
    const addChip = (n) => {
      const b = mkBtn(n, { variant: "ghost", size: "sm" });
      b.style.flex = "0 0 auto";
      setActive(b, selSet.has(n));
      b.onclick = () => {
        selSet.has(n) ? selSet.delete(n) : selSet.add(n);
        setActive(b, selSet.has(n));
        emit();
      };
      buttons.push(b);
      chips.appendChild(b);
    };
    names.forEach(addChip);
 
    const inputWrap = document.createElement("div");
    Object.assign(inputWrap.style, {
      display: "inline-flex", alignItems: "center", gap: "4px", flex: "0 0 auto",
    });
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "自定义报障人";
    Object.assign(input.style, {
      height: "28px",
      minWidth: compact ? "92px" : "120px",
      maxWidth: compact ? "120px" : "180px",
      padding: "0 8px", border: "1px solid var(--tm-border)",
      borderRadius: "8px", outline: "none", fontSize: "12px",
      background: "transparent", color: "inherit", boxSizing: "border-box",
    });
    const addBtn = mkBtn("添加", { variant: "ghost", size: "sm" });
    const addCustom = () => {
      const raw = (input.value || "").trim();
      if (!raw) return;
      const tmp = new Set();
      addReporterNames(tmp, raw);
      [...tmp].filter(Boolean).forEach((n) => {
        if (![...chips.children].some((el) => txt(el) === n)) addChip(n);
        selSet.add(n);
        buttons.forEach((b) => {
          if (txt(b) === n) setActive(b, true);
        });
      });
      input.value = "";
      emit();
    };
    addBtn.onclick = addCustom;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addCustom();
      }
    });
    inputWrap.appendChild(input);
    inputWrap.appendChild(addBtn);
    wrap.appendChild(inputWrap);
 
    return {
      wrap,
      getSelected: () => [...selSet],
      setDisabled: (d) => {
        buttons.forEach((b) => (b.disabled = d));
        input.disabled = d;
        addBtn.disabled = d;
      },
    };
  };
 
  /* ========== JQL & Issue fetch ========== */
  const buildReporterClause = (reporter) => {
    const set = new Set();
    addReporterNames(set, reporter);
    const arr = [...set].filter(Boolean);
    if (!arr.length) return "";
    const quoted = arr.map((n) => '"' + String(n).replace(/"/g, '\\"') + '"').join(", ");
    return " AND reporter in (" + quoted + ")";
  };
  const buildRoundClause = (roundInfo, title = "") => {
    const n = normalizeRound(roundInfo, title);
    return n ? ` AND 进度节点 = "${n.replace(/"/g, '\\"')}"` : "";
  };
  const buildJql = (fixVersion, roundInfo, reporter, title = "") =>
    'project = CJ AND issuetype = 缺陷 AND fixVersion = "' + fixVersion + '"' +
    buildRoundClause(roundInfo, title) +
    buildReporterClause(reporter) +
    " ORDER BY created DESC";
  const bugUrl = (fixVersion, roundInfo, reporter, title) =>
    "https://jira.cjdropshipping.cn/issues/?filter=-4&jql=" +
    encodeURIComponent(buildJql(fixVersion, roundInfo, reporter, title));
 
  const TE_CACHE = { byFix: new Map(), byKey: new Map() };
  const fetchExecsByFixVersion = async (
    fixVersion,
    { pageSize = 20, maxPages = 5 } = {}
  ) => {
    const v = (fixVersion || "").trim();
    if (!v) return [];
    if (TE_CACHE.byFix.has(v)) return TE_CACHE.byFix.get(v).slice();
    const items = [];
    let start = 0, total = null;
    for (let p = 0; p < maxPages; p++) {
      const url = "/rest/raven/1.0/report/testexecutionreport/testexecutions/?start=" + start + "&pageSize=" + pageSize + "&projectId=10000&filterscope=filter&version=" + encodeURIComponent(v) + "&_=" + Date.now();
      const r = await fetch(url, {
        method: "GET", credentials: "include",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!r.ok) throw new Error(`获取测试执行列表失败（${r.status}）`);
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) break;
      items.push(...data);
      if (total == null) total = data[0]?.total ?? null;
      start += pageSize;
      if (total != null && start >= total) break;
    }
    TE_CACHE.byFix.set(v, items);
    return items.slice();
  };
  const fetchExecIssueDetails = async (key) => {
    const k = (key || "").trim();
    if (!k) return null;
    if (TE_CACHE.byKey.has(k)) return TE_CACHE.byKey.get(k);
    try {
      const r = await fetch(
        "/rest/api/2/issue/" + encodeURIComponent(k) + "?fields=summary,reporter,fixVersions",
        {
          method: "GET", credentials: "include",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
          },
        }
      );
      if (!r.ok) throw new Error(`获取测试执行详情失败（${r.status}）`);
      const d = await r.json();
      const f = d?.fields || {};
      const info = {
        reporter:
          f?.reporter?.displayName ||
          f?.reporter?.name ||
          f?.reporter?.emailAddress ||
          "",
        summary: f?.summary || "",
        fixVersion: f?.fixVersions?.[0]?.name || "",
      };
      TE_CACHE.byKey.set(k, info);
      return info;
    } catch (e) {
      log("获取测试执行详情失败", e);
      return null;
    }
  };
 
  const analyzeIssues = (payload) => {
    const arr = payload?.issueTable?.table || [];
    let bug = arr.length, rej = 0, opt = 0, resolved = 0, unresolved = 0;
    for (const it of arr) {
      const s = (it.status || "").trim();
      const sum = (it.summary || "").trim();
      if (s === "拒绝" || /拒绝/.test(sum)) { rej++; bug--; continue; }
      if (sum.includes("优化")) { opt++; bug--; continue; }
      if (s === "Resolved" || s === "Done") resolved++;
      else unresolved++;
    }
    return { bug数: bug, 拒绝数: rej, 优化数: opt, 已解决: resolved, 未解决: unresolved };
  };
  const fetchBugStats = async (fixVersion, roundInfo, reporter, title) => {
    try {
      const bugsJql = buildJql(fixVersion, roundInfo, reporter, title);
      const url = "https://jira.cjdropshipping.cn/rest/issueNav/1/issueTable?startIndex=0&filterId=-4&jql=" + encodeURIComponent(bugsJql) + "&layoutKey=split-view";
      const r = await fetch(url, {
        method: "POST", credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-atlassian-token": "no-check",
          Accept: "*/*",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      return analyzeIssues(await r.json());
    } catch (e) {
      log("获取缺陷失败", e);
      return { bug数: 0, 拒绝数: 0, 优化数: 0 };
    }
  };
 
  /* ========== Modal ========== */
  class ReportModal {
    constructor(text, opts = {}) {
      this.text = text;
      this.opts = opts;
      this.prevOverflow = document.documentElement.style.overflow;
      this.modal = null;
      this.viewer = null;
      this.hiddenTA = null;
      this._onEsc = null;
      this.init();
    }
    renderText(t) {
      if (!this.viewer || !this.hiddenTA) return;
      const raw = typeof t === "string" ? t : this.text;
      this.text = raw;
      this.viewer.innerHTML = raw.replace(
        /https?:\/\/[^\s]+/g,
        (u) =>
          `<a class="tm-previewable-link" href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`
      );
      this.hiddenTA.value = raw;
    }
    init() {
      if (document.getElementById(IDS.modal)) return;
      document.documentElement.style.overflow = "hidden";
      const modal = document.createElement("div");
      modal.id = IDS.modal;
      Object.assign(modal.style, {
        position: "fixed", inset: "0",
        background: "rgba(0,0,0,0.45)", zIndex: "10000",
        display: "flex", justifyContent: "center", alignItems: "center",
        padding: "16px", boxSizing: "border-box",
      });
      const dialog = document.createElement("div");
      Object.assign(dialog.style, {
        position: "relative",
        width: "clamp(320px, 80vw, 900px)",
        maxWidth: "96vw", maxHeight: "85vh",
        background: "#fff", color: "#1f2328",
        borderRadius: "12px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column",
        overflow: "hidden", boxSizing: "border-box",
      });
      if (matchMedia?.("(prefers-color-scheme: dark)").matches) {
        dialog.style.background = "#0f172a";
        dialog.style.color = "#e2e8f0";
      }
      const header = document.createElement("div");
      Object.assign(header.style, {
        height: "48px", display: "flex", alignItems: "center",
        padding: "0 16px",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        cursor: "move", userSelect: "none", gap: "8px",
      });
      const hTitle = document.createElement("div");
      hTitle.textContent = this.opts.title || "测试报告";
      Object.assign(hTitle.style, {
        fontSize: "16px", fontWeight: "600", flex: "0 0 auto",
      });
      header.appendChild(hTitle);
      if (typeof this.opts.onToggleExecMode === "function") {
        const b = mkBtn(execMetricLabel(), { variant: "ghost", size: "sm" });
        b.style.marginLeft = "8px";
        b.style.flex = "0 0 auto";
        b.onclick = () => {
          toggleExecMetric();
          b.textContent = execMetricLabel();
          const nt = this.opts.onToggleExecMode();
          if (typeof nt === "string" && nt) this.renderText(nt);
        };
        header.appendChild(b);
      }
      const spacer = document.createElement("div");
      spacer.style.flex = "1 1 auto";
      header.appendChild(spacer);
 
      const content = document.createElement("div");
      Object.assign(content.style, {
        padding: "12px", display: "flex", flexDirection: "column",
        gap: "12px", flex: "1 1 auto", overflow: "hidden",
      });
      const useBody = typeof this.opts.bodyBuilder === "function";
      if (useBody) {
        try { this.opts.bodyBuilder(content, this); }
        catch (e) { log("bodyBuilder error", e); }
      } else {
        const viewer = document.createElement("div");
        this.viewer = viewer;
        Object.assign(viewer.style, {
          width: "100%", maxWidth: "100%", overflow: "auto",
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: "10px", padding: "12px 14px",
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
          fontSize: "13px", lineHeight: "1.6",
          background: "rgba(0,0,0,0.02)", color: "inherit",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          overflowWrap: "anywhere", hyphens: "auto", boxSizing: "border-box",
        });
        const ta = document.createElement("textarea");
        ta.value = this.text;
        ta.setAttribute("aria-hidden", "true");
        this.hiddenTA = ta;
        Object.assign(ta.style, {
          position: "absolute", opacity: "0",
          pointerEvents: "none", width: "0", height: "0",
        });
        content.appendChild(viewer);
        content.appendChild(ta);
      }
 
      const footer = document.createElement("div");
      Object.assign(footer.style, {
        padding: "12px", display: "flex", gap: "8px",
        justifyContent: "flex-end", alignItems: "center",
        borderTop: "1px solid rgba(0,0,0,0.08)",
        boxSizing: "border-box",
      });
      const useFooter = typeof this.opts.footerBuilder === "function";
      if (useFooter) {
        try { this.opts.footerBuilder(footer, this); }
        catch (e) { log("footerBuilder error", e); }
      } else if (!useBody) {
        const copyBtn = mkBtn("复制到剪贴板", { variant: "primary", size: "md" });
        copyBtn.onclick = async () => {
          try {
            if (navigator.clipboard && window.isSecureContext)
              await navigator.clipboard.writeText(this.hiddenTA.value);
            else {
              this.hiddenTA.select();
              const ok = document.execCommand("copy");
              this.hiddenTA.setSelectionRange(0, 0);
              if (!ok) throw new Error("execCommand copy failed");
            }
            this.toast("已复制到剪贴板");
          } catch {
            this.toast("复制失败，请手动全选复制", true);
          }
        };
        footer.appendChild(copyBtn);
      } else {
        const closeBtn = mkBtn("关闭", { variant: "ghost", size: "md" });
        closeBtn.onclick = () => this.close();
        footer.appendChild(closeBtn);
      }
 
      dialog.appendChild(header);
      dialog.appendChild(content);
      dialog.appendChild(footer);
      const onEsc = (e) => { if (e.key === "Escape") this.close(); };
      modal.addEventListener("mousedown", (e) => {
        if (e.target === modal) this.close();
      });
      document.addEventListener("keydown", onEsc);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
      this.modal = modal;
      this._onEsc = onEsc;
      if (!useBody) this.renderText(this.text);
    }
    toast(m, err = false) {
      const t = document.createElement("div");
      t.textContent = m;
      Object.assign(t.style, {
        position: "fixed", left: "50%", bottom: "36px",
        transform: "translateX(-50%)",
        background: err ? "#b91c1c" : "#16a34a",
        color: "#fff", padding: "8px 12px",
        borderRadius: "999px", fontSize: "12px",
        zIndex: "10001",
        boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
      });
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 1000);
    }
    close() {
      if (!this.modal) return;
      document.removeEventListener("keydown", this._onEsc);
      document.documentElement.style.overflow = "";
      this.modal.remove();
      this.modal = null;
      try { this.opts.onClose?.(); } catch (e) { log("onClose error", e); }
    }
  }
 
  const openReporterPicker = ({ title, autoReporterList, candidateList }) =>
    new Promise((resolve) => {
      let done = false;
      let picker = null;
      const modal = new ReportModal("", {
        title: title || "报障人选择",
        onClose: () => { if (!done) { done = true; resolve(null); } },
        bodyBuilder(content) {
          const info = document.createElement("div");
          info.textContent = `自动采集：${(autoReporterList || []).join("、") || "（空）"}`;
          Object.assign(info.style, { fontSize: "12px", color: "#64748b" });
          content.appendChild(info);
          picker = createCandidatePicker(candidateList, { compact: false });
          if (picker.wrap?.childNodes.length) {
            picker.wrap.style.marginTop = "4px";
            content.appendChild(picker.wrap);
          } else picker = null;
          const hint = document.createElement("div");
          hint.textContent = "不勾选则仅使用自动采集报障人";
          Object.assign(hint.style, { fontSize: "12px", color: "#94a3b8" });
          content.appendChild(hint);
        },
        footerBuilder(footer, m) {
          const cancel = mkBtn("取消", { variant: "ghost", size: "md" });
          const ok = mkBtn("确认", { variant: "primary", size: "md" });
          cancel.onclick = () => { done = true; m.close(); resolve(null); };
          ok.onclick = () => {
            done = true;
            m.close();
            resolve({ extraNames: picker ? picker.getSelected() : [] });
          };
          footer.appendChild(cancel);
          footer.appendChild(ok);
        },
      });
      void modal;
    });

  /* ========== Tempo worklog ========== */
  const WORKLOG_SETTINGS_KEY = "tm_subtask_worklog_settings_v1";
  const WORKLOG_BTN = "tm-subtask-worklog-btn";
  const WORKLOG_DEFAULTS = {
    mode: "remaining",
    hours: "8",
    comment: "",
  };
  const WorklogSettings = {
    load() {
      let s = {};
      try { s = JSON.parse(localStorage.getItem(WORKLOG_SETTINGS_KEY) || "{}"); } catch {}
      return { ...WORKLOG_DEFAULTS, ...s };
    },
    save(v) {
      try { localStorage.setItem(WORKLOG_SETTINGS_KEY, JSON.stringify(v || {})); } catch {}
    },
  };
  const isJiraIssuePage = () => /^\/browse\/[A-Z][A-Z0-9_]+-\d+/i.test(location.pathname);
  const getCurrentWorker = async () => {
    const r = await fetch("/rest/api/2/myself", {
      method: "GET", credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!r.ok) throw new Error(`获取当前用户失败（${r.status}）`);
    const d = await r.json();
    const worker = d?.key || d?.name;
    if (!worker) throw new Error("当前用户缺少 Jira key，无法记录 Tempo 工时");
    return { key: worker, displayName: d?.displayName || d?.name || worker };
  };
  const collectSubtaskKeysFromDom = () => {
    const roots = qsa(
      'issuetable-web-component[data-content="subtasks"], #subtasks-module, .subtask-table-container'
    );
    const rows = roots.flatMap((root) => qsa("tr.issuerow[data-issuekey]", root));
    const seen = new Set();
    return rows
      .map((tr) => (tr.getAttribute("data-issuekey") || "").trim())
      .filter((key) => {
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const getSubtaskRows = () => {
    const roots = qsa(
      'issuetable-web-component[data-content="subtasks"], #subtasks-module, .subtask-table-container'
    );
    const seen = new Set();
    return roots.flatMap((root) => qsa("tr.issuerow[data-issuekey]", root)).filter((tr) => {
      const key = (tr.getAttribute("data-issuekey") || "").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const fetchSubtaskDetails = async (keys) => {
    const uniq = [...new Set((keys || []).map((k) => String(k || "").trim()).filter(Boolean))];
    if (!uniq.length) return [];
    const quoted = uniq.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",");
    const r = await fetch("/rest/api/2/search/", {
      method: "POST", credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        jql: `issue in (${quoted})`,
        fields: [
          "summary", "issuetype", "status", "assignee",
          "timeestimate", "timeoriginalestimate", "timespent", "timetracking",
        ],
        startAt: 0,
        maxResults: Math.max(50, uniq.length),
      }),
    });
    if (!r.ok) throw new Error(`获取子任务列表失败（${r.status}）`);
    const data = await r.json();
    const byKey = new Map((data?.issues || []).map((it) => [it.key, it]));
    return uniq.map((key) => byKey.get(key)).filter(Boolean).map((it) => {
      const f = it.fields || {};
      const remaining = Number(f.timeestimate ?? f.timetracking?.remainingEstimateSeconds ?? 0) || 0;
      const original = Number(f.timeoriginalestimate ?? f.timetracking?.originalEstimateSeconds ?? 0) || 0;
      const spent = Number(f.timespent ?? f.timetracking?.timeSpentSeconds ?? 0) || 0;
      return {
        id: String(it.id || ""),
        key: it.key,
        summary: f.summary || "",
        issueType: f.issuetype?.name || "",
        issueTypeSubtask: !!f.issuetype?.subtask,
        status: f.status?.name || "",
        assignee: f.assignee?.displayName || f.assignee?.name || "",
        remainingSeconds: remaining,
        originalSeconds: original,
        spentSeconds: spent,
        checked: remaining > 0,
      };
    });
  };
  const fetchWorklogCandidates = async () => {
    const keys = collectSubtaskKeysFromDom();
    if (keys.length) return fetchSubtaskDetails(keys);
    const issueKey = getCurrentIssueKey();
    if (!issueKey) return [];
    const r = await fetch(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=subtasks`, {
      method: "GET", credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!r.ok) throw new Error(`获取当前问题子任务失败（${r.status}）`);
    const data = await r.json();
    const apiKeys = (data?.fields?.subtasks || []).map((it) => it.key).filter(Boolean);
    return fetchSubtaskDetails(apiKeys);
  };
  const postTempoWorklog = async ({ issue, worker, started, seconds, remainingEstimate, comment }) => {
    const body = {
      attributes: {},
      billableSeconds: "",
      worker,
      comment: comment ? String(comment) : null,
      started,
      timeSpentSeconds: seconds,
      originTaskId: String(issue.id),
      remainingEstimate,
      endDate: null,
      includeNonWorkingDays: false,
    };
    const r = await fetch("/rest/tempo-timesheets/4/worklogs/", {
      method: "POST", credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = await r.text(); } catch {}
      throw new Error(`记录 ${issue.key} 工时失败（${r.status}）${detail ? "：" + detail.slice(0, 120) : ""}`);
    }
    return r.json().catch(() => null);
  };
  const getIssueTransitions = async (issueKey) => {
    const r = await fetch(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: "GET", credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!r.ok) throw new Error(`获取 ${issueKey} 状态流转失败（${r.status}）`);
    const data = await r.json();
    return Array.isArray(data?.transitions) ? data.transitions : [];
  };
  const matchTransition = (transitions, names) => {
    const wanted = names.map((n) => String(n).toLowerCase());
    return transitions.find((t) => {
      const n = String(t?.name || "").trim().toLowerCase();
      return wanted.some((w) => n === w || n.includes(w));
    }) || null;
  };
  const doRestTransition = async (issueKey, transition) => {
    const id = transition?.id;
    if (!id) throw new Error(`缺少 ${issueKey} 状态流转 ID`);
    const r = await fetch(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: "POST", credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Atlassian-Token": "no-check",
      },
      body: JSON.stringify({ transition: { id: String(id) } }),
    });
    if (!r.ok && r.status !== 204) {
      const detail = await r.text().catch(() => "");
      throw new Error(`${issueKey} 执行 ${transition.name || id} 失败（${r.status}）${detail ? "：" + detail.slice(0, 120) : ""}`);
    }
    return true;
  };
  const legacyActionsAndOperations = async (issue) => {
    const token = getXsrfToken();
    if (!token) throw new Error("缺少 XSRF Token，无法执行旧版状态流转");
    const id = issue?.id;
    if (!id) throw new Error(`缺少 ${issue?.key || ""} issue id，无法执行旧版状态流转`);
    const url = `/rest/api/1.0/issues/${encodeURIComponent(id)}/ActionsAndOperations?atl_token=${encodeURIComponent(token)}&_=${Date.now()}`;
    const r = await fetch(url, {
      method: "GET", credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!r.ok) throw new Error(`获取 ${issue.key} 旧版操作失败（${r.status}）`);
    return r.json();
  };
  const doLegacyTransition = async (issue, actionNames) => {
    const data = await legacyActionsAndOperations(issue);
    const actions = Array.isArray(data?.actions) ? data.actions : [];
    const wanted = actionNames.map((n) => String(n).toLowerCase());
    const action = actions.find((a) => {
      const n = String(a?.name || "").trim().toLowerCase();
      return wanted.some((w) => n === w || n.includes(w));
    });
    if (!action?.action) return false;
    const token = data?.atlToken || getXsrfToken();
    const params = new URLSearchParams({
      id: String(issue.id),
      action: String(action.action),
      atl_token: token,
      returnUrl: `/browse/${issue.key}`,
      decorator: "dialog",
      inline: "true",
      _: String(Date.now()),
    });
    const r = await fetch(`/secure/WorkflowUIDispatcher.jspa?${params.toString()}`, {
      method: "GET", credentials: "include",
      headers: {
        Accept: "text/html, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!r.ok) throw new Error(`${issue.key} 执行 ${action.name} 失败（${r.status}）`);
    return true;
  };
  const runIssueTransition = async (issue, actionNames) => {
    const key = issue?.key;
    if (!key) throw new Error("缺少子任务 Key，无法执行状态流转");
    try {
      const transitions = await getIssueTransitions(key);
      const transition = matchTransition(transitions, actionNames);
      if (!transition) return false;
      await doRestTransition(key, transition);
      return true;
    } catch (e) {
      log("REST 状态流转失败，尝试旧版链路", e);
      return doLegacyTransition(issue, actionNames);
    }
  };
  const startProgressIssue = (issue) =>
    runIssueTransition(issue, ["Start Progress", "开始处理", "处理中"]);
  const doneIssue = (issue) =>
    runIssueTransition(issue, ["Done", "完成", "已完成"]);
  const recordIssueWorklogAndDone = async ({ issue, worker, started, seconds, comment, setStatus }) => {
    if (!issue?.key || !issue?.id) throw new Error("缺少子任务信息，无法记录工时");
    if (!worker) throw new Error("缺少当前用户，无法记录工时");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(started || ""))) {
      throw new Error("记录日期格式不正确");
    }
    if (!(Number(seconds) > 0)) throw new Error("记录工时必须大于 0");
    setStatus?.(`正在将 ${issue.key} 置为处理中...`);
    const startedProgress = await startProgressIssue(issue);
    if (!startedProgress) log(`${issue.key} 未找到 Start Progress 动作，继续记录工时`);
    await sleep(350);
    setStatus?.(`正在记录 ${issue.key}：${formatSeconds(seconds)}...`);
    await postTempoWorklog({
      issue,
      worker,
      started,
      seconds,
      remainingEstimate: 0,
      comment: (comment || "").trim(),
    });
    await sleep(350);
    setStatus?.(`正在将 ${issue.key} 置为完成...`);
    const done = await doneIssue(issue);
    if (!done) log(`${issue.key} 未找到 Done 动作`);
    return true;
  };

  /* ========== Subtask create ========== */
  const CREATE_SUBTASK_SETTINGS_KEY = "tm_create_subtask_settings_v1";
  const SUBTASK_ISSUE_TYPE_ID = "10104";
  const CreateSubtaskSettings = {
    load() {
      let s = {};
      try { s = JSON.parse(localStorage.getItem(CREATE_SUBTASK_SETTINGS_KEY) || "{}"); } catch {}
      return { hours: "0.5h", ...s };
    },
    save(v) {
      try { localStorage.setItem(CREATE_SUBTASK_SETTINGS_KEY, JSON.stringify(v || {})); } catch {}
    },
  };
  const fetchCurrentIssueContextForSubtask = async () => {
    const key = getCurrentIssueKey();
    if (!key) throw new Error("缺少当前问题 Key，无法创建子任务");
    const r = await fetch(`/rest/api/2/issue/${encodeURIComponent(key)}?fields=fixVersions,project,priority`, {
      method: "GET", credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!r.ok) throw new Error(`获取当前问题信息失败（${r.status}）`);
    const data = await r.json();
    const fix = data?.fields?.fixVersions?.[0] || null;
    const project = data?.fields?.project || null;
    const priority = data?.fields?.priority || null;
    return {
      id: String(data?.id || getCurrentIssueId() || ""),
      key: data?.key || key,
      fixVersionId: fix?.id ? String(fix.id) : "",
      fixVersionName: fix?.name || extractFixVersion() || "",
      projectId: project?.id ? String(project.id) : "10000",
      priorityId: priority?.id ? String(priority.id) : "3",
    };
  };
  const extractFormTokenFromQuickCreate = (data) => {
    if (data?.formToken) return String(data.formToken);
    const fields = Array.isArray(data?.fields) ? data.fields : [];
    for (const f of fields) {
      const html = String(f?.editHtml || "");
      if (!html) continue;
      const dom = new DOMParser().parseFromString(html, "text/html");
      const input = dom.querySelector('input[name="formToken"]');
      const v = input?.getAttribute("value");
      if (v) return v;
    }
    const raw = JSON.stringify(data || {});
    const m =
      raw.match(/name=\\?"formToken\\?"[^]*?value=\\?"([^"\\]+)\\?"/i) ||
      raw.match(/"formToken"\s*:\s*"([^"]+)"/i) ||
      raw.match(/formToken[^a-z0-9]+([a-f0-9]{20,})/i);
    return m ? m[1] : "";
  };
  const fetchQuickCreateFormToken = async (parentIssueId) => {
    const token = getXsrfToken();
    if (!token) throw new Error("缺少 XSRF Token，无法创建子任务，请刷新页面后重试");
    const form = new URLSearchParams();
    form.set("atl_token", token);
    const r = await fetch(
      `/secure/QuickCreateIssue!default.jspa?decorator=none&parentIssueId=${encodeURIComponent(parentIssueId)}`,
      {
        method: "POST", credentials: "include",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: form.toString(),
      }
    );
    if (!r.ok) throw new Error(`初始化创建子任务表单失败（${r.status}）`);
    const data = await r.json();
    const formToken = extractFormTokenFromQuickCreate(data);
    if (!formToken) throw new Error("未获取到创建子任务 formToken，请刷新页面后重试");
    return formToken;
  };
  const appendCreateFieldRetains = (form) => {
    [
      "project", "issuetype", "fixVersions", "customfield_10705",
      "priority", "labels", "assignee", "customfield_10108",
      "customfield_10101", "customfield_10102", "customfield_10507",
      "issuelinks", "resolution",
    ].forEach((v) => form.append("fieldsToRetain", v));
  };
  const parseQuickCreateError = (data, fallbackText = "") => {
    const errors = data?.errors || {};
    const messages = [];
    if (Array.isArray(data?.errorMessages)) messages.push(...data.errorMessages);
    if (errors && typeof errors === "object") {
      Object.entries(errors).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((x) => messages.push(`${k}：${x}`));
        else if (v) messages.push(`${k}：${v}`);
      });
    }
    if (messages.length) return messages.join("；");
    if (fallbackText && /error|错误|required|必填|invalid/i.test(fallbackText)) {
      return fallbackText.replace(/\s+/g, " ").slice(0, 180);
    }
    return "";
  };
  const postCreateSubtask = async ({ context, worker, summary, estimate }) => {
    const xsrf = getXsrfToken();
    if (!xsrf) throw new Error("缺少 XSRF Token，无法创建子任务，请刷新页面后重试");
    if (!context?.id) throw new Error("缺少父任务 ID，无法创建子任务");
    if (!context?.fixVersionId) throw new Error("当前任务没有可提交的修复版本 ID，无法创建子任务");
    const formToken = await fetchQuickCreateFormToken(context.id);
    const form = new URLSearchParams();
    form.set("pid", context.projectId || "10000");
    form.set("issuetype", SUBTASK_ISSUE_TYPE_ID);
    form.set("parentIssueId", context.id);
    form.set("atl_token", xsrf);
    form.set("formToken", formToken);
    form.set("summary", summary);
    form.set("fixVersions", context.fixVersionId);
    form.set("priority", context.priorityId || "3");
    form.set("dnd-dropzone", "");
    form.set("assignee", worker.displayName || worker.name || worker.key);
    form.set("customfield_10101", "");
    form.set("customfield_10102", "");
    form.set("description", "");
    form.set("timetracking_originalestimate", estimate);
    form.set("timetracking_remainingestimate", "");
    form.set("isCreateIssue", "true");
    form.set("hasWorkStarted", "");
    form.set("issuelinks", "issuelinks");
    form.set("issuelinks-linktype", "blocks");
    form.set("resolution", "10000");
    appendCreateFieldRetains(form);
    const r = await fetch("/secure/QuickCreateIssue.jspa?decorator=none", {
      method: "POST", credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "X-Atlassian-Token": "no-check",
      },
      body: form.toString(),
    });
    const text = await r.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) {
      throw new Error(`创建子任务失败（${r.status}）${text ? "：" + text.slice(0, 120) : ""}`);
    }
    const err = parseQuickCreateError(data, text);
    if (err && !data?.issueKey && !data?.createdIssueDetails) throw new Error(`创建子任务失败：${err}`);
    const createdKey =
      data?.issueKey ||
      data?.createdIssueDetails?.issueKey ||
      data?.createdIssueDetails?.key ||
      data?.createdIssueDetails?.issue?.key ||
      data?.createdIssueDetails?.issue?.issueKey ||
      data?.createdIssueDetails?.id ||
      data?.createdIssueDetails?.key ||
      "";
    return { key: createdKey, raw: data };
  };
  const issueFromCreatedIssueDetails = (created) => {
    const d = created?.raw?.createdIssueDetails || {};
    if (!d?.key || !d?.id) return null;
    const f = d.fields || {};
    const remaining = Number(f.timeestimate ?? f.timetracking?.remainingEstimateSeconds ?? 0) || 0;
    const original = Number(f.timeoriginalestimate ?? f.timetracking?.originalEstimateSeconds ?? 0) || 0;
    const spent = Number(f.timespent ?? f.timetracking?.timeSpentSeconds ?? 0) || 0;
    return {
      id: String(d.id),
      key: d.key,
      summary: f.summary || "",
      issueType: f.issuetype?.name || "",
      issueTypeSubtask: !!f.issuetype?.subtask,
      status: f.status?.name || "",
      assignee: f.assignee?.displayName || f.assignee?.name || "",
      remainingSeconds: remaining,
      originalSeconds: original,
      spentSeconds: spent,
      checked: true,
    };
  };
  const fetchCreatedSubtaskIssue = async (created) => {
    const fromPayload = issueFromCreatedIssueDetails(created);
    if (fromPayload) return fromPayload;
    const key = created?.key;
    if (!key) throw new Error("子任务已创建，但未获取到新子任务 Key，无法自动记录工时");
    const list = await fetchSubtaskDetails([key]);
    const issue = list[0] || null;
    if (!issue) throw new Error(`未能获取新子任务 ${key} 详情，无法自动记录工时`);
    return issue;
  };
  const openCreateSubtaskPanel = () => {
    if (document.getElementById(IDS.modal)) return;
    const saved = CreateSubtaskSettings.load();
    let context = null;
    let worker = null;
    let statusEl, submitBtn, cancelBtn, info;
    const setStatus = (msg, err = false) => {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      Object.assign(statusEl.style, {
        color: err ? "#b91c1c" : "#64748b",
        fontSize: "12px",
      });
    };
    const renderInfo = () => {
      if (!info) return;
      info.innerHTML = "";
      const putInfo = (label, value) => {
        const l = document.createElement("div");
        l.textContent = label;
        Object.assign(l.style, { color: "#64748b" });
        const v = document.createElement("div");
        v.textContent = value || "-";
        Object.assign(v.style, { color: "inherit", wordBreak: "break-word" });
        info.appendChild(l);
        info.appendChild(v);
      };
      putInfo("父任务", context?.key || getCurrentIssueKey());
      putInfo("修复版本", context?.fixVersionName || "正在加载...");
      putInfo("经办人", worker?.displayName || "正在加载...");
    };
    const modal = new ReportModal("", {
      title: "创建并完成测试子任务",
      bodyBuilder(content, m) {
        content.style.overflow = "auto";
        content.style.gap = "12px";
        const makeInput = (type, value) => {
          const el = document.createElement("input");
          el.type = type;
          el.value = value || "";
          Object.assign(el.style, {
            height: "32px", padding: "0 10px",
            border: "1px solid var(--tm-border)", borderRadius: "8px",
            outline: "none", fontSize: "12px",
            background: "transparent", color: "inherit",
            boxSizing: "border-box", width: "100%",
          });
          return el;
        };
        const makeField = (label, input, hint) => {
          const wrap = document.createElement("label");
          Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "#64748b" });
          const span = document.createElement("span");
          span.textContent = label;
          wrap.appendChild(span);
          wrap.appendChild(input);
          if (hint) {
            const h = document.createElement("span");
            h.textContent = hint;
            Object.assign(h.style, { color: "#94a3b8", fontSize: "11px" });
            wrap.appendChild(h);
          }
          return wrap;
        };
        info = document.createElement("div");
        Object.assign(info.style, {
          border: "1px solid var(--tm-border)",
          borderRadius: "10px",
          padding: "10px 12px",
          display: "grid",
          gridTemplateColumns: "96px minmax(0, 1fr)",
          gap: "6px 10px",
          fontSize: "12px",
        });
        content.appendChild(info);
        renderInfo();

        const summaryInput = makeInput("text", "");
        summaryInput.placeholder = "请输入子任务标题";
        content.appendChild(makeField("标题", summaryInput));
        const hoursInput = makeInput("text", saved.hours || "0.5h");
        content.appendChild(makeField("预估工时", hoursInput, "支持 0.5h、0.5、4h、30m 写法"));

        statusEl = document.createElement("div");
        setStatus("正在加载当前任务修复版本和登录用户...");
        content.appendChild(statusEl);
        m.__createSubtaskForm = { summaryInput, hoursInput };
        Promise.all([fetchCurrentIssueContextForSubtask(), getCurrentWorker()])
          .then(([ctx, u]) => {
            context = ctx;
            worker = u;
            renderInfo();
            if (!context.fixVersionId) {
              setStatus("当前任务没有修复版本，无法创建子任务", true);
              return;
            }
            setStatus(`将创建测试子任务，修复版本使用“${context.fixVersionName}”，经办人使用“${u.displayName}”，创建后自动记录工时并完成状态。`);
            if (submitBtn) submitBtn.disabled = false;
          })
          .catch((e) => {
            log("加载创建子任务上下文失败", e);
            renderInfo();
            setStatus(e.message || "加载失败", true);
            if (submitBtn) submitBtn.disabled = true;
          });
      },
      footerBuilder(footer, m) {
        cancelBtn = mkBtn("取消", { variant: "ghost", size: "md" });
        cancelBtn.onclick = () => m.close();
        submitBtn = mkBtn("创建并记工时", { variant: "primary", size: "md" });
        submitBtn.disabled = true;
        submitBtn.onclick = async () => {
          const f = m.__createSubtaskForm;
          if (!f || !context || !worker) return;
          const summary = (f.summaryInput.value || "").trim();
          const estimate = normalizeWorkEstimate(f.hoursInput.value);
          const seconds = parseWorkSeconds(f.hoursInput.value);
          if (!summary) {
            setStatus("标题不能为空", true);
            return;
          }
          if (!estimate) {
            setStatus("工时格式不正确，请填写 0.5h、0.5、4h 或 30m", true);
            return;
          }
          if (seconds <= 0) {
            setStatus("记录工时必须大于 0", true);
            return;
          }
          CreateSubtaskSettings.save({
            hours: f.hoursInput.value || "",
          });
          submitBtn.disabled = true;
          cancelBtn.disabled = true;
          setStatus("正在创建子任务...");
          try {
            const created = await postCreateSubtask({ context, worker, summary, estimate });
            const keyText = created.key ? ` ${created.key}` : "";
            setStatus(`已创建子任务${keyText}，正在准备记录工时...`);
            const createdIssue = await fetchCreatedSubtaskIssue(created);
            await recordIssueWorklogAndDone({
              issue: createdIssue,
              worker: worker.key,
              started: formatDateYmd(),
              seconds,
              comment: "",
              setStatus,
            });
            setStatus(`已创建并完成 ${createdIssue.key}：${formatSeconds(seconds)}，正在刷新页面...`);
            toast(`已创建并记录 ${createdIssue.key} 工时`);
            setTimeout(() => location.reload(), 900);
          } catch (e) {
            log("创建并记录子任务工时失败", e);
            setStatus(e.message || "创建或记录失败", true);
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
          }
        };
        footer.appendChild(cancelBtn);
        footer.appendChild(submitBtn);
      },
    });
    void modal;
  };
  const openSubtaskWorklogPanel = async (issueKey) => {
    if (document.getElementById(IDS.modal)) return;
    const key = String(issueKey || "").trim();
    if (!key) {
      toast("缺少子任务 Key，无法记录工时", true);
      return;
    }
    const saved = WorklogSettings.load();
    let issue = null;
    let worker = null;
    let statusEl, submitBtn, cancelBtn;
    const setStatus = (msg, err = false) => {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      Object.assign(statusEl.style, {
        color: err ? "#b91c1c" : "#64748b",
        fontSize: "12px",
      });
    };
    const rowSeconds = (row, mode, fixedSeconds) =>
      mode === "fixed" ? fixedSeconds : Math.max(0, Number(row?.remainingSeconds) || 0);
    const modal = new ReportModal("", {
      title: `记录子任务工时：${key}`,
      bodyBuilder(content, m) {
        content.style.overflow = "auto";
        content.style.gap = "12px";
        const makeInput = (type, value) => {
          const el = document.createElement("input");
          el.type = type;
          el.value = value || "";
          Object.assign(el.style, {
            height: "32px", padding: "0 10px",
            border: "1px solid var(--tm-border)", borderRadius: "8px",
            outline: "none", fontSize: "12px",
            background: "transparent", color: "inherit",
            boxSizing: "border-box", width: "100%",
          });
          return el;
        };
        const makeField = (label, input, hint) => {
          const wrap = document.createElement("label");
          Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "#64748b" });
          const span = document.createElement("span");
          span.textContent = label;
          wrap.appendChild(span);
          wrap.appendChild(input);
          if (hint) {
            const h = document.createElement("span");
            h.textContent = hint;
            Object.assign(h.style, { color: "#94a3b8", fontSize: "11px" });
            wrap.appendChild(h);
          }
          return wrap;
        };
        const info = document.createElement("div");
        Object.assign(info.style, {
          border: "1px solid var(--tm-border)",
          borderRadius: "10px",
          padding: "10px 12px",
          display: "grid",
          gridTemplateColumns: "96px minmax(0, 1fr)",
          gap: "6px 10px",
          fontSize: "12px",
        });
        const putInfo = (label, value) => {
          const l = document.createElement("div");
          l.textContent = label;
          Object.assign(l.style, { color: "#64748b" });
          const v = document.createElement("div");
          v.textContent = value || "-";
          Object.assign(v.style, { color: "inherit", wordBreak: "break-word" });
          info.appendChild(l);
          info.appendChild(v);
        };
        putInfo("子任务", key);
        putInfo("摘要", "正在加载...");
        putInfo("剩余预估", "-");
        putInfo("已记录", "-");
        content.appendChild(info);

        const controls = document.createElement("div");
        Object.assign(controls.style, {
          display: "grid",
          gridTemplateColumns: "minmax(130px, 1fr) minmax(130px, 1fr) minmax(110px, 0.8fr)",
          gap: "8px",
          alignItems: "end",
        });
        const dateInput = makeInput("date", formatDateYmd());
        const modeSelect = document.createElement("select");
        modeSelect.innerHTML = '<option value="remaining">按剩余预估</option><option value="fixed">手动填写工时</option>';
        modeSelect.value = saved.mode === "fixed" ? "fixed" : "remaining";
        Object.assign(modeSelect.style, {
          height: "32px", padding: "0 10px",
          border: "1px solid var(--tm-border)", borderRadius: "8px",
          background: "transparent", color: "inherit", fontSize: "12px",
          boxSizing: "border-box", width: "100%",
        });
        const hoursInput = makeInput("text", saved.hours || "8");
        controls.appendChild(makeField("记录日期", dateInput, "默认当天，可手动选择"));
        controls.appendChild(makeField("工时来源", modeSelect));
        controls.appendChild(makeField("手动工时(h)", hoursInput, "示例：8、1.5、2h、30m"));
        content.appendChild(controls);

        const commentInput = makeInput("text", saved.comment || "");
        commentInput.placeholder = "可选：默认留空，Tempo 会生成“处理问题KEY”";
        content.appendChild(makeField("说明", commentInput));

        statusEl = document.createElement("div");
        setStatus("正在加载子任务和当前用户...");
        content.appendChild(statusEl);

        m.__worklogForm = { dateInput, modeSelect, hoursInput, commentInput, info };
        Promise.all([getCurrentWorker(), fetchSubtaskDetails([key])])
          .then(([u, list]) => {
            worker = u;
            issue = list[0] || null;
            info.innerHTML = "";
            if (!issue) {
              putInfo("子任务", key);
              putInfo("状态", "未找到");
              setStatus("未能通过 Jira API 获取该子任务详情", true);
              return;
            }
            putInfo("子任务", issue.key);
            putInfo("摘要", issue.summary);
            putInfo("状态", issue.status);
            putInfo("经办人", issue.assignee || "-");
            putInfo("原预估", formatSeconds(issue.originalSeconds));
            putInfo("剩余预估", formatSeconds(issue.remainingSeconds));
            putInfo("已记录", formatSeconds(issue.spentSeconds));
            setStatus(`当前用户：${u.displayName}。默认记录 ${formatSeconds(issue.remainingSeconds)}，提交后剩余预估置为 0。`);
            if (submitBtn) submitBtn.disabled = false;
          })
          .catch((e) => {
            log("加载子任务工时失败", e);
            setStatus(e.message || "加载失败", true);
            if (submitBtn) submitBtn.disabled = true;
          });
      },
      footerBuilder(footer, m) {
        cancelBtn = mkBtn("取消", { variant: "ghost", size: "md" });
        cancelBtn.onclick = () => m.close();
        submitBtn = mkBtn("记录工时", { variant: "primary", size: "md" });
        submitBtn.disabled = true;
        submitBtn.onclick = async () => {
          const f = m.__worklogForm;
          if (!f || !worker || !issue) return;
          const started = (f.dateInput.value || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(started)) {
            setStatus("记录日期格式不正确", true);
            return;
          }
          const mode = f.modeSelect.value === "fixed" ? "fixed" : "remaining";
          const fixedSeconds = parseWorkSeconds(f.hoursInput.value);
          if (mode === "fixed" && fixedSeconds <= 0) {
            setStatus("手动工时必须大于 0", true);
            return;
          }
          const seconds = rowSeconds(issue, mode, fixedSeconds);
          if (seconds <= 0) {
            setStatus("当前子任务没有可记录的剩余预估，请切换为手动填写工时", true);
            return;
          }
          WorklogSettings.save({
            mode,
            hours: f.hoursInput.value || "",
            comment: f.commentInput.value || "",
          });
          submitBtn.disabled = true;
          cancelBtn.disabled = true;
          try {
            await recordIssueWorklogAndDone({
              issue,
              worker: worker.key,
              started,
              seconds,
              comment: (f.commentInput.value || "").trim(),
              setStatus,
            });
            setStatus(`已记录 ${issue.key}：${formatSeconds(seconds)}，状态已处理`);
            toast(`已记录 ${issue.key} 工时并处理状态`);
            setTimeout(() => m.close(), 700);
          } catch (e) {
            log("记录子任务工时失败", e);
            setStatus(e.message || "记录失败", true);
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
          }
        };
        footer.appendChild(cancelBtn);
        footer.appendChild(submitBtn);
      },
    });
    void modal;
  };
  /* ========== Portal & dashboard config ========== */
  const DEFAULT_PORTAL = {
    ownerPrefix: "生姜-", pageId: "10923",
    returnUrl: "/secure/Dashboard.jspa",
    favourite: "true",
    groupShare: ["jira-software-users", "测试"],
    projectShare: "10000", roleShare: "",
    shareValues: [
      { type: "group", param1: "jira-software-users", rights: { value: 1 } },
      { type: "group", param1: "测试", rights: { value: 1 } },
    ],
    submitLabel: "更新",
  };
  const PORTAL = JSON.parse(JSON.stringify(DEFAULT_PORTAL));
  const DEFAULT_DASHBOARD = {
    boardId: "10923",
    gadgets: [
      { id: "11387", prefs: { up_isConfigured: true, up_xstattype: "priorities", up_ystattype: "allFixfor", up_sortBy: "natural", up_sortDirection: "desc", up_numberToShow: "5", up_refresh: "false", up_more: "false" } },
      { id: "11384", prefs: { up_isConfigured: true, up_xstattype: "assignees", up_ystattype: "reporter", up_sortBy: "natural", up_sortDirection: "asc", up_numberToShow: "5", up_refresh: "false", up_more: "false" } },
      { id: "11386", prefs: { up_isConfigured: true, up_xstattype: "statuses", up_ystattype: "assignees", up_sortBy: "natural", up_sortDirection: "desc", up_numberToShow: "5", up_refresh: "false", up_more: "false" } },
      { id: "11385", prefs: { up_isConfigured: true, up_xstattype: "statuses", up_ystattype: "priorities", up_sortBy: "natural", up_sortDirection: "asc", up_numberToShow: "5", up_refresh: "false", up_more: "false" } },
    ],
  };
  const DASHBOARD = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD));
 
  /* ========== Settings ========== */
  const SETTINGS_KEY = "tm_report_settings_v1";
  const Settings = {
    load() {
      let s = {};
      try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch {}
      if (Array.isArray(s.reporterCandidates) && s.reporterCandidates.length) {
        REPORTER_CANDIDATES.splice(
          0, REPORTER_CANDIDATES.length,
          ...s.reporterCandidates.map((x) => String(x || "").trim()).filter(Boolean)
        );
      }
      if (s.portal) {
        for (const k of ["ownerPrefix", "pageId", "projectShare"]) {
          if (typeof s.portal[k] === "string") PORTAL[k] = s.portal[k];
        }
        if (Array.isArray(s.portal.groupShare)) {
          const gs = s.portal.groupShare.map((g) => String(g || "").trim()).filter(Boolean);
          PORTAL.groupShare = gs.slice();
          PORTAL.shareValues = gs.map((g) => ({ type: "group", param1: g, rights: { value: 1 } }));
        }
      }
      if (s.dashboard) {
        if (s.dashboard.boardId) DASHBOARD.boardId = String(s.dashboard.boardId);
        if (Array.isArray(s.dashboard.gadgetIds)) {
          s.dashboard.gadgetIds.forEach((id, i) => {
            if (DASHBOARD.gadgets[i] && id) DASHBOARD.gadgets[i].id = String(id);
          });
        }
      }
    },
    save(partial) {
      let cur = {};
      try { cur = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch {}
      const merged = { ...cur, ...partial };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch {}
      this.load();
      lastPortalName = "";
      lastGadgetKey = "";
    },
    reset() {
      try { localStorage.removeItem(SETTINGS_KEY); } catch {}
      REPORTER_CANDIDATES.splice(0, REPORTER_CANDIDATES.length, ...DEFAULT_REPORTER_CANDIDATES);
      const p = JSON.parse(JSON.stringify(DEFAULT_PORTAL));
      Object.keys(PORTAL).forEach((k) => delete PORTAL[k]);
      Object.assign(PORTAL, p);
      DASHBOARD.boardId = DEFAULT_DASHBOARD.boardId;
      DEFAULT_DASHBOARD.gadgets.forEach((g, i) => {
        if (DASHBOARD.gadgets[i]) DASHBOARD.gadgets[i].id = g.id;
      });
      lastPortalName = "";
      lastGadgetKey = "";
    },
    dump() {
      return {
        reporterCandidates: [...REPORTER_CANDIDATES],
        portal: {
          ownerPrefix: PORTAL.ownerPrefix,
          pageId: PORTAL.pageId,
          groupShare: [...PORTAL.groupShare],
          projectShare: PORTAL.projectShare,
        },
        dashboard: {
          boardId: DASHBOARD.boardId,
          gadgetIds: DASHBOARD.gadgets.map((g) => g.id),
        },
      };
    },
  };
 
  let dashboardBusy = false;
  let lastPortalName = "";
  let lastGadgetKey = "";
 
  const updatePortalPage = async (fixVersion, { force = false } = {}) => {
    const token = getXsrfToken();
    if (!token) {
      toast("缺少 XSRF Token，无法更新仪表盘，请刷新页面后重试", true);
      return false;
    }
    const fv = (fixVersion || "").trim();
    if (!fv) {
      toast("缺少修复版本，仪表盘标题未更新", true);
      return false;
    }
    const name = `${PORTAL.ownerPrefix}${fv}`;
    if (!force && lastPortalName === name) return true;
    const form = new URLSearchParams();
    form.set("portalPageName", name);
    form.set("portalPageDescription", "");
    form.set("favourite", PORTAL.favourite);
    PORTAL.groupShare.forEach((g) => form.append("groupShare", g));
    if (PORTAL.projectShare) form.set("projectShare", PORTAL.projectShare);
    form.set("roleShare", PORTAL.roleShare);
    form.set("shareValues", JSON.stringify(PORTAL.shareValues));
    form.set("pageId", PORTAL.pageId);
    form.set("returnUrl", PORTAL.returnUrl);
    form.set("atl_token", token);
    form.set("update_submit", PORTAL.submitLabel);
    try {
      const r = await fetch(
        "https://jira.cjdropshipping.cn/secure/EditPortalPage.jspa",
        {
          method: "POST", credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          body: form,
        }
      );
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`仪表盘更新失败（${r.status}）${t ? `：${t}` : ""}`);
      }
      toast("仪表盘标题已同步");
      lastPortalName = name;
      return true;
    } catch (e) {
      log("更新仪表盘失败", e);
      toast(e.message || "仪表盘更新失败", true);
      return false;
    }
  };
 
  const findFilterIdByName = async (name, { maxPages = 50 } = {}) => {
    if (!name) return null;
    const base =
      "https://jira.cjdropshipping.cn/secure/ManageFilters.jspa?filterView=my&Search=Search&filterView=search&searchName=&searchOwnerUserName=&searchShareType=any&projectShare=10000&roleShare=&groupShare=jira-software-users&userShare=&sortAscending=true&sortColumn=name";
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const target = norm(name);
    for (let i = 0; i < maxPages; i++) {
      try {
        const r = await fetch(`${base}&pagingOffset=${i}`, {
          method: "GET", credentials: "include",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });
        if (!r.ok) break;
        const dom = new DOMParser().parseFromString(await r.text(), "text/html");
        const links = dom.querySelectorAll(
          '.favourite-item a, .favourite-item a[id^="filterlink_"]'
        );
        if (!links.length) break;
        for (const a of links) {
          if (norm(a.textContent) === target) {
            const m =
              (a.getAttribute("id") || "").match(/filterlink_(\d+)/) ||
              (a.getAttribute("href") || "").match(/filter=(\d+)/);
            if (m) return m[1];
          }
        }
      } catch {}
    }
    return null;
  };
  const deleteFilterById = async (id) => {
    if (!id) return false;
    const token = getXsrfToken();
    if (!token) { toast("缺少 XSRF Token，无法删除同名筛选器", true); return false; }
    const form = new URLSearchParams();
    form.set("inline", "true");
    form.set("decorator", "dialog");
    form.set("filterId", String(id));
    form.set("atl_token", token);
    try {
      const r = await fetch(
        "https://jira.cjdropshipping.cn/secure/DeleteFilter.jspa",
        {
          method: "POST", credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "text/html, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: form.toString(),
        }
      );
      if (!r.ok) throw new Error(`删除筛选器失败（${r.status}）`);
      toast("已删除同名筛选器，重新创建中...");
      return true;
    } catch (e) {
      log("删除筛选器失败", e);
      toast(e.message || "删除同名筛选器失败", true);
      return false;
    }
  };
 
  const gadgetPrefsUrl = (bid, gid, v) =>
    `/rest/dashboards/${v}/${bid}/gadget/${gid}/prefs`;
  const putPrefsJson = (v, bid, gid, prefs) =>
    fetch(gadgetPrefsUrl(bid, gid, v), {
      method: "PUT", credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        "X-Atlassian-Token": "no-check",
      },
      body: JSON.stringify(prefs),
    });
  const putPrefsForm = (v, bid, gid, prefs) => {
    const form = new URLSearchParams();
    Object.keys(prefs).forEach((k) => form.set(k, prefs[k]));
    return fetch(gadgetPrefsUrl(bid, gid, v), {
      method: "PUT", credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        "X-Atlassian-Token": "no-check",
      },
      body: form.toString(),
    });
  };
  const updateOneGadget = async (v, bid, gadget, key) => {
    const prefs = { ...(gadget.prefs || {}), up_filterId: key, up_isConfigured: true };
    for (let i = 1; i <= 4; i++) {
      try {
        const r = await putPrefsJson(v, bid, gadget.id, prefs);
        if (r.ok || r.status === 204) return true;
        const r2 = await putPrefsForm(v, bid, gadget.id, prefs);
        if (r2.ok || r2.status === 204) return true;
        const code = r2.status || r.status;
        if ([429, 500, 502, 503, 504].includes(code)) {
          await sleep(backoff(i));
          continue;
        }
        throw new Error(`更新 gadget ${gadget.id} 失败（${code}）`);
      } catch (e) {
        if (i >= 4) throw e;
        await sleep(backoff(i));
      }
    }
    return false;
  };
  const updateDashboardGadgets = async (filterId, { force = false } = {}) => {
    if (!filterId) return false;
    const key = String(filterId).startsWith("filter-")
      ? String(filterId)
      : `filter-${filterId}`;
    if (!force && lastGadgetKey === key) return true;
    const bid = String(DASHBOARD.boardId);
    const gadgets = DASHBOARD.gadgets.map((g) => ({
      id: String(g.id),
      prefs: g.prefs || {},
    }));
    if (!gadgets.length) {
      toast("未在仪表盘上找到可更新的 gadget", true);
      return false;
    }
    try {
      for (const g of gadgets) {
        await updateOneGadget("latest", bid, g, key);
        await sleep(120);
      }
    } catch {
      for (const g of gadgets) {
        await updateOneGadget("1.0", bid, g, key);
        await sleep(120);
      }
    }
    lastGadgetKey = key;
    toast("仪表盘小组件已更新");
    return true;
  };
 
  const configureDashboard = async (triggerBtn) => {
    if (dashboardBusy) { toast("仪表盘正在配置中，请稍候…"); return; }
    if (!isTestExecutionPage()) {
      toast("仅支持在 Test Execution 页面使用该功能", true);
      return;
    }
    const title = extractTitle();
    const fixVersion = extractFixVersion();
    if (!fixVersion) {
      toast("未识别到修复版本，无法创建筛选器", true);
      return;
    }
    const roundInfo = extractRoundInfo(title);
    const autoList = collectAllReporters(extractReporter());
    let reporterList = autoList.slice();
    let origText = "";
    if (triggerBtn) {
      origText = triggerBtn.textContent;
      triggerBtn.disabled = true;
      triggerBtn.textContent = "选择报障人…";
    }
    dashboardBusy = true;
    const picked = await openReporterPicker({
      title: "筛选器报障人",
      autoReporterList: autoList,
      candidateList: REPORTER_CANDIDATES,
    });
    if (!picked) {
      dashboardBusy = false;
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = origText || "配置仪表盘";
      }
      return;
    }
    if (picked.extraNames?.length) {
      const s = new Set();
      addReporterNames(s, autoList);
      addReporterNames(s, picked.extraNames);
      const merged = [...s];
      if (merged.length) reporterList = merged;
    }
    toast(`筛选器报障人：${reporterList.join("、") || "未限制"}`);
    const displayName = `${fixVersion}-${roundLabelForFilter(roundInfo, title)}`;
    const jql = buildJql(fixVersion, roundInfo, reporterList, title);
    const payload = JSON.stringify({ name: displayName, jql, favourite: true });
    if (triggerBtn) triggerBtn.textContent = "配置中…";
    let err = null, filterId = null, retried = false;
    const doCreate = () =>
      fetch("https://jira.cjdropshipping.cn/rest/api/2/filter/", {
        method: "POST", credentials: "include",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Atlassian-Token": "no-check",
        },
        body: payload,
      });
    try {
      let resp = await doCreate();
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        const lower = text.toLowerCase();
        if (
          resp.status === 400 ||
          resp.status === 409 ||
          lower.includes("already exists") ||
          /已存在/.test(text)
        ) {
          const existing = await findFilterIdByName(displayName);
          if (existing && !retried && (await deleteFilterById(existing))) {
            retried = true;
            resp = await doCreate();
          }
          if (!resp.ok) throw new Error(text || "筛选器已存在且无法替换");
        } else {
          throw new Error(
            `创建筛选器失败（${resp.status}）${text ? `：${text}` : ""}`
          );
        }
      }
      const data = await resp.json().catch(() => ({}));
      filterId = data?.id ?? data?.filterId ?? null;
      const link = filterId
        ? `https://jira.cjdropshipping.cn/issues/?filter=${filterId}`
        : data?.self || "";
      if (link && navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(link); } catch {}
      }
      toast("筛选器创建成功");
    } catch (e) {
      err = e;
      log("创建筛选器异常", e);
      toast(e.message || "创建筛选器失败", true);
    } finally {
      dashboardBusy = false;
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = origText || "配置仪表盘";
      }
    }
    if (!err) {
      await updatePortalPage(fixVersion);
      if (!filterId) filterId = await findFilterIdByName(displayName);
      if (filterId) await updateDashboardGadgets(filterId);
      else toast("未能获取筛选器ID，仪表盘小组件未更新", true);
    }
  };
 
  /* ========== Settings panel UI ========== */
  const openSettingsPanel = () => {
    const draft = Settings.dump();
    let reporterChips = [...draft.reporterCandidates];
 
    const mkSection = (title) => {
      const s = document.createElement("div");
      Object.assign(s.style, {
        display: "flex", flexDirection: "column", gap: "8px",
        padding: "10px 12px", borderRadius: "10px",
        border: "1px dashed var(--tm-border)",
        background: "rgba(0,0,0,0.02)",
      });
      const h = document.createElement("div");
      h.textContent = title;
      Object.assign(h.style, { fontSize: "13px", fontWeight: "600" });
      s.appendChild(h);
      return s;
    };
    const mkInput = (val, ph) => {
      const el = document.createElement("input");
      el.type = "text";
      el.value = val == null ? "" : String(val);
      if (ph) el.placeholder = ph;
      Object.assign(el.style, {
        height: "30px", padding: "0 10px",
        border: "1px solid var(--tm-border)", borderRadius: "8px",
        outline: "none", fontSize: "12px",
        background: "transparent", color: "inherit",
        boxSizing: "border-box", width: "100%",
      });
      return el;
    };
    const mkField = (label, input, hint) => {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", flexDirection: "column", gap: "4px" });
      const lab = document.createElement("label");
      lab.textContent = label;
      Object.assign(lab.style, { fontSize: "12px", color: "#64748b" });
      row.appendChild(lab);
      row.appendChild(input);
      if (hint) {
        const h = document.createElement("div");
        h.textContent = hint;
        Object.assign(h.style, { fontSize: "11px", color: "#94a3b8" });
        row.appendChild(h);
      }
      return row;
    };
 
    new ReportModal("", {
      title: "脚本设置",
      bodyBuilder(content, m) {
        content.style.overflow = "auto";
        content.style.gap = "14px";
 
        // 候选报障人
        const rs = mkSection("候选报障人");
        const chipWrap = document.createElement("div");
        Object.assign(chipWrap.style, { display: "flex", flexWrap: "wrap", gap: "6px" });
        const renderChips = () => {
          chipWrap.innerHTML = "";
          if (!reporterChips.length) {
            const empty = document.createElement("span");
            empty.textContent = "(暂无候选)";
            Object.assign(empty.style, { fontSize: "12px", color: "#94a3b8" });
            chipWrap.appendChild(empty);
            return;
          }
          reporterChips.forEach((name, idx) => {
            const chip = document.createElement("span");
            Object.assign(chip.style, {
              display: "inline-flex", alignItems: "center", gap: "2px",
              padding: "2px 4px 2px 10px", borderRadius: "999px",
              border: "1px solid var(--tm-border)", fontSize: "12px",
              background: "rgba(37,99,235,0.08)",
            });
            const t = document.createElement("span");
            t.textContent = name;
            const x = document.createElement("button");
            x.textContent = "×";
            x.title = "删除";
            Object.assign(x.style, {
              border: "none", background: "transparent", cursor: "pointer",
              fontSize: "14px", lineHeight: "1", color: "#94a3b8",
              padding: "0 6px",
            });
            x.onclick = () => { reporterChips.splice(idx, 1); renderChips(); };
            chip.appendChild(t);
            chip.appendChild(x);
            chipWrap.appendChild(chip);
          });
        };
        renderChips();
        rs.appendChild(chipWrap);
        const addRow = document.createElement("div");
        Object.assign(addRow.style, { display: "flex", gap: "6px" });
        const addInput = mkInput("", "输入姓名，回车或逗号分隔多个");
        addInput.style.flex = "1 1 auto";
        const addBtn = mkBtn("添加", { variant: "ghost", size: "sm" });
        const doAdd = () => {
          const v = (addInput.value || "").trim();
          if (!v) return;
          v.split(/[,，、；;\s]+/).filter(Boolean).forEach((n) => {
            if (!reporterChips.includes(n)) reporterChips.push(n);
          });
          addInput.value = "";
          renderChips();
        };
        addBtn.onclick = doAdd;
        addInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); doAdd(); }
        });
        addRow.appendChild(addInput);
        addRow.appendChild(addBtn);
        rs.appendChild(addRow);
        content.appendChild(rs);
 
        // 仪表盘
        const ds = mkSection("仪表盘配置");
        const portalPrefix = mkInput(draft.portal.ownerPrefix, "生姜-");
        ds.appendChild(mkField("门户标题前缀", portalPrefix, "标题格式：前缀 + 修复版本"));
        const portalPageId = mkInput(draft.portal.pageId, "10923");
        ds.appendChild(mkField("仪表盘页面 ID (pageId)", portalPageId));
        const dashBoardId = mkInput(draft.dashboard.boardId, "10923");
        ds.appendChild(mkField("仪表盘 Board ID", dashBoardId, "一般与 pageId 相同"));
        const gadgetInputs = [];
        const gadgetLabels = ["优先级 × 修复版本", "经办人 × 报告人", "状态 × 经办人", "状态 × 优先级"];
        draft.dashboard.gadgetIds.forEach((id, i) => {
          const inp = mkInput(id, "");
          gadgetInputs.push(inp);
          ds.appendChild(mkField("Gadget " + (i + 1) + " ID (" + (gadgetLabels[i] || "") + ")", inp));
        });
        content.appendChild(ds);
 
        // 共享
        const ss = mkSection("共享配置 (高级)");
        const groupShare = mkInput(draft.portal.groupShare.join(", "), "jira-software-users, 测试");
        ss.appendChild(mkField("共享组 (逗号分隔)", groupShare));
        const projectShare = mkInput(draft.portal.projectShare, "10000");
        ss.appendChild(mkField("项目共享 ID", projectShare));
        content.appendChild(ss);
 
        m.__settingsForm = {
          getReporterChips: () => reporterChips.slice(),
          portalPrefix, portalPageId, dashBoardId, gadgetInputs,
          groupShare, projectShare,
        };
      },
      footerBuilder(footer, m) {
        const resetBtn = mkBtn("重置默认", { variant: "ghost", size: "md" });
        resetBtn.onclick = () => {
          if (!confirm("确定要将所有设置重置为默认值吗？")) return;
          Settings.reset();
          m.close();
          toast("已重置为默认设置");
        };
        const cancelBtn = mkBtn("取消", { variant: "ghost", size: "md" });
        cancelBtn.onclick = () => m.close();
        const saveBtn = mkBtn("保存", { variant: "primary", size: "md" });
        saveBtn.onclick = () => {
          const f = m.__settingsForm;
          if (!f) return;
          const partial = {
            reporterCandidates: f.getReporterChips(),
            portal: {
              ownerPrefix: (f.portalPrefix.value || "").trim(),
              pageId: (f.portalPageId.value || "").trim(),
              groupShare: (f.groupShare.value || "")
                .split(/[,，;；]+/).map((s) => s.trim()).filter(Boolean),
              projectShare: (f.projectShare.value || "").trim(),
            },
            dashboard: {
              boardId: (f.dashBoardId.value || "").trim(),
              gadgetIds: f.gadgetInputs.map((i) => (i.value || "").trim()),
            },
          };
          Settings.save(partial);
          m.close();
          toast("设置已保存");
        };
        const spacer = document.createElement("div");
        spacer.style.flex = "1 1 auto";
        footer.appendChild(resetBtn);
        footer.appendChild(spacer);
        footer.appendChild(cancelBtn);
        footer.appendChild(saveBtn);
      },
    });
  };
 
  /* ========== Report context ========== */
  class ReportContext {
    constructor({
      counts, title, fixVersion, reporter, roundInfo,
      includeDomReporters = true, issueKey = "", testSummary = "",
    }) {
      this.counts = counts;
      this.title = title;
      this.fixVersion = fixVersion;
      this.roundInfo = roundInfo;
      this.issueKey = issueKey;
      this.testSummary = (testSummary || "").toString().trim();
      this.baseReporterList = collectAllReporters(reporter, { includeDom: includeDomReporters });
      this.currentReporterList = this.baseReporterList.slice();
      const norm = normalizeRound(roundInfo, title);
      const m = norm.match(/(\d+)/);
      this.roundNum = m ? parseInt(m[1], 10) : 1;
      this.currentRoundKey = roundInfo;
      this.statsNow = this.statsR1 = this.statsR2 = null;
    }
    roundKeyForR2() { return this.roundNum === 2 ? this.currentRoundKey : "2轮"; }
    getStatVal(o, k) {
      const n = Number(o?.[k]);
      return Number.isFinite(n) ? n : 0;
    }
    buildReporterListWithExtra(extra) {
      const s = new Set();
      addReporterNames(s, this.baseReporterList);
      if (extra) addReporterNames(s, extra);
      return [...s].filter(Boolean);
    }
    async recompute(extra) {
      this.currentReporterList = this.buildReporterListWithExtra(extra);
      this.statsNow = await fetchBugStats(
        this.fixVersion, this.currentRoundKey, this.currentReporterList, this.title
      );
      if (this.roundNum >= 2) {
        this.statsR1 = await fetchBugStats(
          this.fixVersion, "1轮", this.currentReporterList, this.title
        );
        this.statsR2 = await fetchBugStats(
          this.fixVersion, this.roundKeyForR2(),
          this.currentReporterList, this.title
        );
      } else this.statsR1 = this.statsR2 = null;
    }
    async init() { await this.recompute(); }
    buildText() {
      const m = computeMetrics(this.counts);
      const g = (o, k) => this.getStatVal(o, k);
      const sN = this.statsNow || {}, s1 = this.statsR1 || {}, s2 = this.statsR2 || {};
      const lines = [
        `${this.title}：`,
        `测试用例总数：${this.counts.total}`,
        `执行进度：${m.progress}%`,
        `已执行：${m.executed}`,
        this.counts.fail ? `失败用例数：${this.counts.fail}` : "",
        this.counts.aborted ? `阻塞用例数：${this.counts.aborted}` : "",
        this.counts.executing ? `执行中用例数：${this.counts.executing}` : "",
        `通过率：${m.successRate}%`,
      ];
      const fmtBug = (label, s) => {
        const bug = g(s, "bug数"), res = g(s, "已解决"),
          un = g(s, "未解决"), opt = g(s, "优化数"), rej = g(s, "拒绝数");
        return [
          `${label}：${bug} (不包含拒绝和优化；已解决:${res}${un > 0 ? `, 未解决:${un}` : ""})`,
          `   优化数：${opt}`,
          `   拒绝数：${rej}`,
        ];
      };
      if (this.roundNum < 2) {
        lines.push(...fmtBug("bug数", sN));
      } else {
        lines.push(...fmtBug("一轮bug数", s1));
        lines.push(...fmtBug("二轮bug数", s2));
        const b1 = g(s1, "bug数"), b2 = g(s2, "bug数");
        lines.push(
          b1 > 0
            ? `复测bug率：${Math.round(((b2 / b1 - 1) * 10000 * -1) / 100)}%`
            : "复测bug率：—"
        );
      }
      if (this.testSummary) lines.push(`测试小结：${this.testSummary}`);
      lines.push(
        `bug地址：${bugUrl(this.fixVersion, this.roundInfo, this.currentReporterList, this.title)}`
      );
      return lines.filter(Boolean).join("\n");
    }
  }
 
  /* ========== Wait helper ========== */
  const waitFor = (check, timeout = 5000, interval = 100) =>
    new Promise((resolve) => {
      const start = Date.now();
      (function loop() {
        if (check()) return resolve(true);
        if (Date.now() - start >= timeout) return resolve(false);
        setTimeout(loop, interval);
      })();
    });
 
  /* ========== Generate report ========== */
  async function generateReport() {
    const ok = await waitFor(() => scoped(SEL.progressBar), 6000);
    if (!ok) { alert("未检测到执行进度区域，可能尚未加载完毕"); return; }
    const counts = extractTestCounts();
    if (!counts) { alert("无法提取测试数据"); return; }
    const title = extractTitle();
    const fixVersion = extractFixVersion();
    const reporter = extractReporter();
    const roundInfo = extractRoundInfo(title);
    const currentKey = getCurrentIssueKey();
 
    let testSummary = TestSummaryCache.get(currentKey, title);
    const ctx = new ReportContext({
      counts, title, fixVersion, reporter, roundInfo,
      issueKey: currentKey, testSummary,
    });
    await ctx.init();
 
    let modalRef = null;
    let execList = [], execListLoaded = false, execListLoading = false;
    let execCheckboxes = [];
    const selectedKeys = new Set();
    let execListWrap, execLoadBtn, execApplyBtn, execCountLabel, execToggleBtn, execListHint;
    let execCollapsed = false;
    let reporterSummaryList = null;
    let reporterPickers = [];
    let recomputeBusy = false;
    let summaryInputEl = null;
    let setExecControlsDisabled = () => {};
    const persistTestSummary = (raw) => {
      testSummary = (raw || "").trim();
      TestSummaryCache.saveOrRemove(currentKey, title, testSummary);
      ctx.testSummary = testSummary;
    };
 
    const extraMap = new Map();
    const getCtxKey = (c, i) =>
      c ? c.issueKey || c.title || String(i ?? "") : String(i ?? "");
    const getExtraByKey = (k) => extraMap.get(k) || [];
    const getExtraFor = (c, i) => getExtraByKey(getCtxKey(c, i));
    const setAllDisabled = (d) => {
      reporterPickers.forEach((p) => p.setDisabled(d));
      setExecControlsDisabled(d);
    };
 
    let contexts = [ctx];
    const buildCombined = () =>
      contexts.map((c) => c.buildText()).join("\n\n------------------------------\n\n");
    const buildCtxFromItem = async (item) => {
      if (!item) return null;
      const countsI = buildCountsFromExecItem(item);
      let t = (item.summary || "").trim();
      let fv = (fixVersion || "").trim();
      let rep = "";
      if (item.key) {
        const info = await fetchExecIssueDetails(item.key);
        if (info) {
          if (info.summary) t = info.summary;
          if (!fv && info.fixVersion) fv = info.fixVersion;
          rep = info.reporter || "";
        }
      }
      const rInfo = extractRoundInfo(t);
      const c = new ReportContext({
        counts: countsI, title: t, fixVersion: fv || fixVersion,
        reporter: rep, roundInfo: rInfo,
        includeDomReporters: false, issueKey: item.key,
      });
      await c.recompute(getExtraByKey(item.key));
      return c;
    };
    const buildAllContexts = async () => {
      const list = [];
      await ctx.recompute(getExtraByKey(currentKey));
      list.push(ctx);
      for (const item of execList) {
        if (!item?.key || !selectedKeys.has(item.key)) continue;
        const c = await buildCtxFromItem(item);
        if (c) list.push(c);
      }
      return list;
    };
    const applyExecCollapse = () => {
      if (!execListWrap) return;
      const c = execCollapsed && execListLoaded;
      execListWrap.style.display = c ? "none" : "";
      if (execListHint) {
        execListHint.textContent = c
          ? selectedKeys.size
            ? `已选 ${selectedKeys.size} 个测试执行，列表已收起`
            : "列表已收起"
          : '勾选后点击"应用选择"生成多条报告';
      }
      if (execToggleBtn) {
        execToggleBtn.textContent = c ? "展开列表" : "收起列表";
        execToggleBtn.disabled = !execListLoaded;
      }
    };
    const setExecCollapsed = (v) => { execCollapsed = v; applyExecCollapse(); };
    const updateCountLabel = () => {
      if (execCountLabel) execCountLabel.textContent = `已选其他执行：${selectedKeys.size}`;
      applyExecCollapse();
    };
    const renderReporterSummary = () => {
      if (!reporterSummaryList) return;
      reporterSummaryList.innerHTML = "";
      reporterPickers = [];
      const wrapEl = reporterSummaryList.parentElement;
      wrapEl?.__applyCollapse?.();
      if (!contexts.length) {
        const empty = document.createElement("div");
        empty.textContent = "暂无统计报障人";
        Object.assign(empty.style, { fontSize: "12px", color: "#94a3b8" });
        reporterSummaryList.appendChild(empty);
        return;
      }
      contexts.forEach((item, i) => {
        const key = getCtxKey(item, i);
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex", flexDirection: "column", gap: "6px",
          paddingBottom: "6px",
          borderBottom: "1px dashed rgba(0,0,0,0.08)",
        });
        const label = `${item.issueKey ? item.issueKey + " " : ""}${item.title || ""}`.trim() || "未知测试执行";
        const t = document.createElement("div");
        t.textContent = label;
        Object.assign(t.style, { fontSize: "12px", color: "#334155" });
        row.appendChild(t);
        const auto = document.createElement("div");
        auto.textContent = `自动获取：${item.baseReporterList.join("、") || "（空）"}`;
        Object.assign(auto.style, { fontSize: "12px", color: "#64748b" });
        row.appendChild(auto);
        const picker = createCandidatePicker(REPORTER_CANDIDATES, {
          compact: true,
          selected: getExtraByKey(key),
          onChange: (sel) => {
            if (sel.length) extraMap.set(key, sel);
            else extraMap.delete(key);
            void recomputeAll({ rebuildContexts: false });
          },
        });
        if (picker.wrap?.childNodes.length) {
          row.appendChild(picker.wrap);
          reporterPickers.push(picker);
        }
        reporterSummaryList.appendChild(row);
      });
    };
    const renderExecList = () => {
      if (!execListWrap) return;
      execListWrap.innerHTML = "";
      execCheckboxes = [];
      if (execLoadBtn) execLoadBtn.textContent = execListLoaded ? "刷新列表" : "加载列表";
      if (execApplyBtn) execApplyBtn.disabled = !execListLoaded || recomputeBusy;
      updateCountLabel();
      const hint = (s) => {
        const h = document.createElement("div");
        h.textContent = s;
        Object.assign(h.style, { fontSize: "12px", color: "#94a3b8" });
        execListWrap.appendChild(h);
      };
      if (execListLoading) { hint("正在加载列表…"); applyExecCollapse(); return; }
      if (!execListLoaded) { hint('点击"加载列表"获取其他测试执行'); applyExecCollapse(); return; }
      const list = execList.filter((it) => it?.key && it.key !== currentKey);
      if (!list.length) { hint("未找到其他测试执行"); applyExecCollapse(); return; }
      list.forEach((item) => {
        const row = document.createElement("label");
        Object.assign(row.style, {
          display: "flex", alignItems: "flex-start", gap: "6px",
          fontSize: "12px", cursor: "pointer",
        });
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selectedKeys.has(item.key);
        cb.onchange = () => {
          cb.checked ? selectedKeys.add(item.key) : selectedKeys.delete(item.key);
          updateCountLabel();
        };
        execCheckboxes.push(cb);
        const info = document.createElement("div");
        Object.assign(info.style, { display: "flex", flexDirection: "column", gap: "2px" });
        const main = document.createElement("span");
        main.textContent = `${item.key} ${item.summary || ""}`.trim();
        const stats = buildCountsFromExecItem(item);
        const sub = document.createElement("span");
        sub.textContent = `总${stats.total} / PASS ${stats.pass} / FAIL ${stats.fail} / 阻塞 ${stats.aborted} / 执行中 ${stats.executing}`;
        sub.style.color = "#94a3b8";
        info.appendChild(main);
        info.appendChild(sub);
        row.appendChild(cb);
        row.appendChild(info);
        execListWrap.appendChild(row);
      });
      applyExecCollapse();
    };
    const loadExecList = async () => {
      if (execListLoading) return;
      if (!fixVersion) { toast("缺少修复版本，无法加载其他测试执行", true); return; }
      execListLoading = true;
      renderExecList();
      setAllDisabled(true);
      try {
        execList = await fetchExecsByFixVersion(fixVersion);
        const avail = new Set(execList.map((i) => i?.key).filter(Boolean));
        for (const k of [...selectedKeys]) {
          if (!avail.has(k) || k === currentKey) selectedKeys.delete(k);
        }
        execListLoaded = true;
      } catch (e) {
        log("loadExecList", e);
        toast("获取其他测试执行失败，请稍后重试", true);
      } finally {
        execListLoading = false;
        setAllDisabled(false);
        renderExecList();
      }
    };
    const recomputeAll = async ({ rebuildContexts = false, toastText } = {}) => {
      if (recomputeBusy) return;
      recomputeBusy = true;
      setAllDisabled(true);
      try {
        if (rebuildContexts) contexts = await buildAllContexts();
        else for (const [i, c] of contexts.entries()) await c.recompute(getExtraFor(c, i));
        updateCountLabel();
        renderReporterSummary();
        modalRef?.renderText(buildCombined());
        if (toastText) toast(toastText);
      } catch (e) {
        log("recomputeAll", e);
        toast("更新报告失败，请稍后重试", true);
      } finally {
        recomputeBusy = false;
        setAllDisabled(false);
      }
    };
 
    new ReportModal(buildCombined(), {
      onClose: () => {
        if (summaryInputEl) persistTestSummary(summaryInputEl.value);
      },
      onToggleExecMode: () => buildCombined(),
      bodyBuilder(content, m) {
        modalRef = m;
        content.style.overflow = "auto";
 
        // Exec list panel
        const panel = document.createElement("div");
        Object.assign(panel.style, {
          display: "flex", flexDirection: "column", gap: "6px",
          padding: "8px 10px", borderRadius: "10px",
          border: "1px dashed var(--tm-border)",
          background: "rgba(0,0,0,0.02)",
        });
        const head = document.createElement("div");
        Object.assign(head.style, {
          display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
        });
        const ptitle = document.createElement("span");
        ptitle.textContent = "其他测试执行";
        Object.assign(ptitle.style, { fontSize: "13px", fontWeight: "600" });
        execCountLabel = document.createElement("span");
        Object.assign(execCountLabel.style, { fontSize: "12px", color: "#64748b" });
        updateCountLabel();
        const sp = document.createElement("span");
        sp.style.flex = "1 1 auto";
        execToggleBtn = mkBtn("收起列表", { variant: "ghost", size: "sm" });
        execToggleBtn.onclick = () => setExecCollapsed(!execCollapsed);
        execLoadBtn = mkBtn("加载列表", { variant: "ghost", size: "sm" });
        execLoadBtn.onclick = () => { void loadExecList(); };
        execApplyBtn = mkBtn("应用选择", { variant: "primary", size: "sm" });
        execApplyBtn.onclick = () => {
          const msg = selectedKeys.size
            ? `已合并 ${selectedKeys.size} 个测试执行报告`
            : "已恢复为当前测试执行报告";
          setExecCollapsed(selectedKeys.size > 0);
          void recomputeAll({ rebuildContexts: true, toastText: msg });
        };
        head.append(ptitle, execCountLabel, sp, execToggleBtn, execLoadBtn, execApplyBtn);
        panel.appendChild(head);
        const ci = document.createElement("div");
        ci.textContent = `当前：${(currentKey ? `${currentKey} ${title}` : title).trim() || "未知"}`;
        Object.assign(ci.style, { fontSize: "12px", color: "#64748b" });
        panel.appendChild(ci);
        execListWrap = document.createElement("div");
        Object.assign(execListWrap.style, {
          display: "flex", flexDirection: "column", gap: "6px",
          maxHeight: "180px", overflowY: "auto", padding: "6px",
          borderRadius: "8px", border: "1px solid var(--tm-border)",
          background: "rgba(0,0,0,0.02)",
        });
        panel.appendChild(execListWrap);
        execListHint = document.createElement("div");
        execListHint.textContent = '勾选后点击"应用选择"生成多条报告';
        Object.assign(execListHint.style, { fontSize: "12px", color: "#94a3b8" });
        panel.appendChild(execListHint);
        content.appendChild(panel);
        renderExecList();
 
        // Reporter summary panel
        const rsWrap = document.createElement("div");
        Object.assign(rsWrap.style, {
          display: "flex", flexDirection: "column", gap: "6px",
          padding: "8px 10px", borderRadius: "10px",
          border: "1px dashed var(--tm-border)",
          background: "rgba(0,0,0,0.02)", flex: "0 0 auto",
        });
        const rh = document.createElement("div");
        Object.assign(rh.style, {
          display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
        });
        const rt = document.createElement("span");
        rt.textContent = "统计报障人明细";
        Object.assign(rt.style, { fontSize: "13px", fontWeight: "600" });
        const rc = document.createElement("span");
        Object.assign(rc.style, { fontSize: "12px", color: "#64748b" });
        const rs = document.createElement("span");
        rs.style.flex = "1 1 auto";
        let rCollapsed = true;
        const rToggle = mkBtn("收起", { variant: "ghost", size: "sm" });
        rh.append(rt, rc, rs, rToggle);
        rsWrap.appendChild(rh);
        reporterSummaryList = document.createElement("div");
        Object.assign(reporterSummaryList.style, {
          display: "flex", flexDirection: "column", gap: "4px",
          maxHeight: "180px", overflowY: "auto", paddingRight: "4px",
        });
        rsWrap.appendChild(reporterSummaryList);
        const applyRCollapse = () => {
          reporterSummaryList.style.display = rCollapsed ? "none" : "flex";
          rToggle.textContent = rCollapsed ? "展开" : "收起";
          rc.textContent = `共 ${contexts.length} 项`;
        };
        rToggle.onclick = () => { rCollapsed = !rCollapsed; applyRCollapse(); };
        rsWrap.__applyCollapse = applyRCollapse;
        content.appendChild(rsWrap);
        renderReporterSummary();
        applyRCollapse();
 
        // Test summary panel
        const sw = document.createElement("div");
        Object.assign(sw.style, {
          display: "flex", flexDirection: "column", gap: "6px",
          padding: "8px 10px", borderRadius: "10px",
          border: "1px dashed var(--tm-border)",
          background: "rgba(0,0,0,0.02)",
        });
        const st = document.createElement("span");
        st.textContent = "测试小结（可选）";
        Object.assign(st.style, { fontSize: "13px", fontWeight: "600" });
        sw.appendChild(st);
        const si = document.createElement("textarea");
        si.placeholder = "不填写则不显示在报告中";
        si.value = testSummary;
        Object.assign(si.style, {
          width: "100%", minHeight: "68px", padding: "8px 10px",
          border: "1px solid var(--tm-border)", borderRadius: "10px",
          outline: "none", fontSize: "12px", lineHeight: "1.5",
          resize: "vertical", background: "transparent",
          color: "inherit", boxSizing: "border-box",
        });
        summaryInputEl = si;
        const refreshSummaryPreview = debounce(() => {
          void recomputeAll({ rebuildContexts: false });
        }, 200);
        si.addEventListener("input", () => {
          persistTestSummary(si.value);
          refreshSummaryPreview();
        });
        sw.appendChild(si);
        content.appendChild(sw);
 
        setExecControlsDisabled = (d) => {
          if (execToggleBtn) execToggleBtn.disabled = d || !execListLoaded;
          if (execLoadBtn) execLoadBtn.disabled = d;
          if (execApplyBtn) execApplyBtn.disabled = d || !execListLoaded;
          execCheckboxes.forEach((cb) => (cb.disabled = d));
        };
 
        // Viewer
        const viewer = document.createElement("div");
        m.viewer = viewer;
        Object.assign(viewer.style, {
          width: "100%", maxWidth: "100%",
          flex: "0 0 auto", minHeight: "160px", maxHeight: "260px", overflow: "auto",
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: "10px", padding: "12px 14px",
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
          fontSize: "13px", lineHeight: "1.6",
          background: "rgba(0,0,0,0.02)", color: "inherit",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          overflowWrap: "anywhere", hyphens: "auto",
          boxSizing: "border-box",
        });
        const ta = document.createElement("textarea");
        ta.value = buildCombined();
        ta.setAttribute("aria-hidden", "true");
        m.hiddenTA = ta;
        Object.assign(ta.style, {
          position: "absolute", opacity: "0",
          pointerEvents: "none", width: "0", height: "0",
        });
        content.appendChild(viewer);
        content.appendChild(ta);
 
        const previewWrap = document.createElement("div");
        Object.assign(previewWrap.style, {
          display: "none", flexDirection: "column", gap: "6px",
          padding: "8px 10px", borderRadius: "10px",
          border: "1px dashed var(--tm-border)",
          background: "rgba(0,0,0,0.02)",
          flexShrink: "0",
        });
        const phead = document.createElement("div");
        Object.assign(phead.style, {
          display: "flex", alignItems: "center", gap: "8px",
        });
        const plabel = document.createElement("span");
        plabel.textContent = "仪表盘预览";
        Object.assign(plabel.style, { fontSize: "13px", fontWeight: "600" });
        const psp = document.createElement("span");
        psp.style.flex = "1 1 auto";
        const phide = mkBtn("隐藏", { variant: "ghost", size: "sm" });
        phead.append(plabel, psp, phide);
        previewWrap.appendChild(phead);
        const previewImg = document.createElement("img");
        Object.assign(previewImg.style, {
          maxWidth: "100%", objectFit: "contain",
          borderRadius: "8px", border: "1px solid var(--tm-border)",
          background: "#fff", alignSelf: "center", cursor: "zoom-in",
        });
        previewImg.title = "点击放大查看";
        previewImg.onclick = () => {
          if (!m.__previewUrl) return;
          window.open(m.__previewUrl, "_blank", "noopener");
        };
        previewWrap.appendChild(previewImg);
        phide.onclick = () => {
          previewWrap.style.display = "none";
          if (m.__previewUrl) { try { URL.revokeObjectURL(m.__previewUrl); } catch (e) {} m.__previewUrl = null; }
          previewImg.removeAttribute("src");
        };
        content.appendChild(previewWrap);
        m.__previewWrap = previewWrap;
        m.__previewImg = previewImg;
 
        m.renderText(buildCombined());
      },
      footerBuilder(footer, m) {
        let __shotOk = false;
        const shotBtn = mkBtn("截图仪表盘", { variant: "ghost", size: "md" });
        shotBtn.onclick = async () => {
          const fv0 = (ctx && ctx.fixVersion) || fixVersion;
          if (!fv0) { m.toast("缺少修复版本，无法截图", true); return; }
          shotBtn.disabled = true;
          const prev = shotBtn.textContent;
          try {
            shotBtn.textContent = "拉取数据…";
            const jqlStr = buildJql(
              fv0,
              (ctx && ctx.currentRoundKey) || roundInfo,
              (ctx && ctx.currentReporterList) || [],
              title
            );
            const apiUrl = "/rest/api/2/search?jql=" + encodeURIComponent(jqlStr) +
              "&maxResults=1000&fields=priority,assignee,reporter,status,fixVersions";
            const r = await fetch(apiUrl, {
              method: "GET", credentials: "include",
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
            });
            if (!r.ok) throw new Error("查询失败 " + r.status);
            const data = await r.json();
            const issues = data.issues || [];
            if (!issues.length) { m.toast("该筛选条件下没有缺陷数据", true); return; }
 
            shotBtn.textContent = "生成图片…";
            const W = 1400;
            const C = { border: "#dde3eb", headerBg: "#eef3fa", totalBg: "#f8fafc", text: "#1f2328", sub: "#64748b", link: "#2563eb" };
            const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
            const clip = (s, n) => { const t = String(s); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
 
            const renderPivot = (px, py, pw, ph, panel) => {
              const rowMap = new Map();
              const colTot = new Map();
              const rowTot = new Map();
              for (const it of issues) {
                const yk = panel.yGet(it) || "未指定";
                const xk = panel.xGet(it) || "未指定";
                if (!rowMap.has(yk)) rowMap.set(yk, new Map());
                const r = rowMap.get(yk);
                r.set(xk, (r.get(xk) || 0) + 1);
                colTot.set(xk, (colTot.get(xk) || 0) + 1);
                rowTot.set(yk, (rowTot.get(yk) || 0) + 1);
              }
              const xAll = [...colTot.entries()].sort((a, b) => b[1] - a[1]);
              const yAll = [...rowTot.entries()].sort((a, b) => b[1] - a[1]);
              const xShow = xAll.slice(0, 8);
              const yShow = yAll.slice(0, 10);
              const pad = 16, titleH = 28, headerH = 30, rowH = 26;
              const firstColW = 140, totalColW = 64;
              const innerW = pw - pad * 2 - firstColW - totalColW;
              const dataColW = xShow.length > 0 ? Math.max(54, Math.floor(innerW / xShow.length)) : innerW;
              const tableW = firstColW + dataColW * xShow.length + totalColW;
              const tx = px + pad;
              const ty = py + titleH + 12;
              const xClip = Math.max(4, Math.floor(dataColW / 11));
 
              let s = "";
              s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="10" fill="#ffffff" stroke="' + C.border + '"/>';
              s += '<text x="' + (px + pad) + '" y="' + (py + 22) + '" font-size="14" font-weight="700" fill="' + C.text + '">' + esc(panel.t) + '</text>';
 
              s += '<rect x="' + tx + '" y="' + ty + '" width="' + tableW + '" height="' + headerH + '" fill="' + C.headerBg + '" stroke="' + C.border + '"/>';
              s += '<text x="' + (tx + 10) + '" y="' + (ty + 19) + '" font-size="12" font-weight="600" fill="' + C.sub + '">' + esc(panel.yName) + '</text>';
              let cx = tx + firstColW;
              for (const entry of xShow) {
                s += '<text x="' + (cx + dataColW / 2) + '" y="' + (ty + 19) + '" font-size="12" font-weight="600" fill="' + C.text + '" text-anchor="middle">' + esc(clip(entry[0], xClip)) + '</text>';
                cx += dataColW;
              }
              s += '<text x="' + (cx + totalColW / 2) + '" y="' + (ty + 19) + '" font-size="12" font-weight="700" fill="' + C.text + '" text-anchor="middle">合计</text>';
 
              for (let i = 0; i < yShow.length; i++) {
                const yk = yShow[i][0];
                const yTot = yShow[i][1];
                const ry = ty + headerH + i * rowH;
                const bg = i % 2 === 0 ? "#ffffff" : "#fafbfc";
                s += '<rect x="' + tx + '" y="' + ry + '" width="' + tableW + '" height="' + rowH + '" fill="' + bg + '" stroke="' + C.border + '"/>';
                s += '<text x="' + (tx + 10) + '" y="' + (ry + 17) + '" font-size="12" fill="' + C.text + '">' + esc(clip(yk, 16)) + '</text>';
                cx = tx + firstColW;
                const row = rowMap.get(yk) || new Map();
                for (const entry of xShow) {
                  const v = row.get(entry[0]) || 0;
                  s += '<text x="' + (cx + dataColW / 2) + '" y="' + (ry + 17) + '" font-size="12" fill="' + (v ? C.link : "#cbd5e1") + '" text-anchor="middle">' + v + '</text>';
                  cx += dataColW;
                }
                s += '<text x="' + (cx + totalColW / 2) + '" y="' + (ry + 17) + '" font-size="12" font-weight="700" fill="' + C.text + '" text-anchor="middle">' + yTot + '</text>';
              }
 
              const toY = ty + headerH + yShow.length * rowH;
              s += '<rect x="' + tx + '" y="' + toY + '" width="' + tableW + '" height="' + rowH + '" fill="' + C.totalBg + '" stroke="' + C.border + '"/>';
              s += '<text x="' + (tx + 10) + '" y="' + (toY + 17) + '" font-size="12" font-weight="700" fill="' + C.text + '">唯一问题合计</text>';
              cx = tx + firstColW;
              for (const entry of xShow) {
                s += '<text x="' + (cx + dataColW / 2) + '" y="' + (toY + 17) + '" font-size="12" font-weight="700" fill="' + C.text + '" text-anchor="middle">' + entry[1] + '</text>';
                cx += dataColW;
              }
              s += '<text x="' + (cx + totalColW / 2) + '" y="' + (toY + 17) + '" font-size="13" font-weight="700" fill="' + C.link + '" text-anchor="middle">' + issues.length + '</text>';
 
              const infoY = toY + rowH + 20;
              let info = "分组：" + panel.xName + " · 显示 " + xShow.length + "/" + xAll.length + " 列 · " + yShow.length + "/" + yAll.length + " 行";
              s += '<text x="' + (px + pad) + '" y="' + infoY + '" font-size="11" fill="' + C.sub + '">' + esc(info) + '</text>';
              return s;
            };
 
            const getFix = (i) => (i.fields && i.fields.fixVersions && i.fields.fixVersions[0] && i.fields.fixVersions[0].name);
            const getPri = (i) => (i.fields && i.fields.priority && i.fields.priority.name);
            const getAsn = (i) => (i.fields && i.fields.assignee && i.fields.assignee.displayName);
            const getRep = (i) => (i.fields && i.fields.reporter && i.fields.reporter.displayName);
            const getSts = (i) => (i.fields && i.fields.status && i.fields.status.name);
            const panels = [
              { t: "修复的版本 × 优先级", yName: "修复的版本", xName: "优先级", yGet: getFix, xGet: getPri },
              { t: "报告人 × 经办人", yName: "报告人", xName: "经办人", yGet: getRep, xGet: getAsn },
              { t: "经办人 × 状态", yName: "经办人", xName: "状态", yGet: getAsn, xGet: getSts },
              { t: "优先级 × 状态", yName: "优先级", xName: "状态", yGet: getPri, xGet: getSts },
            ];
 
            const computePanelH = (panel) => {
              const yTot = new Map();
              for (const it of issues) {
                const yk = panel.yGet(it) || "未指定";
                yTot.set(yk, (yTot.get(yk) || 0) + 1);
              }
              const yShowN = Math.min(10, yTot.size);
              return 28 + 12 + 30 + 26 * yShowN + 26 + 20 + 16 + 12;
            };
            const MIN_PH = 180;
            const phs = panels.map((p) => Math.max(MIN_PH, computePanelH(p)));
            const rowTopH = Math.max(phs[0], phs[1]);
            const rowBotH = Math.max(phs[2], phs[3]);
            const headerOff = 100;
            const gapY = 20;
            const H = headerOff + rowTopH + gapY + rowBotH + 24;
 
            let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
            svg += '<rect width="' + W + '" height="' + H + '" fill="#f8fafc"/>';
            svg += '<text x="' + (W / 2) + '" y="44" text-anchor="middle" font-size="26" font-weight="700" fill="#0f172a">' + esc(fv0) + ' 缺陷分布</text>';
            svg += '<text x="' + (W / 2) + '" y="74" text-anchor="middle" font-size="14" fill="#64748b">共 ' + issues.length + ' 条 · ' + esc(new Date().toLocaleString("zh-CN")) + '</text>';
            svg += renderPivot(30, headerOff, 680, rowTopH, panels[0]);
            svg += renderPivot(720, headerOff, 680, rowTopH, panels[1]);
            svg += renderPivot(30, headerOff + rowTopH + gapY, 680, rowBotH, panels[2]);
            svg += renderPivot(720, headerOff + rowTopH + gapY, 680, rowBotH, panels[3]);
            svg += '</svg>';
 
            const blob = await new Promise((resolve, reject) => {
              const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
              const u = URL.createObjectURL(svgBlob);
              const img = new Image();
              img.onload = () => {
                try {
                  const canvas = document.createElement("canvas");
                  canvas.width = W * 2; canvas.height = H * 2;
                  const cc = canvas.getContext("2d");
                  cc.scale(2, 2);
                  cc.fillStyle = "#f8fafc"; cc.fillRect(0, 0, W, H);
                  cc.drawImage(img, 0, 0);
                  canvas.toBlob((b) => {
                    URL.revokeObjectURL(u);
                    if (b) resolve(b); else reject(new Error("PNG 生成失败"));
                  }, "image/png");
                } catch (e) { URL.revokeObjectURL(u); reject(e); }
              };
              img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("SVG 加载失败")); };
              img.src = u;
            });
 
            window.__tm_lastShotBlob = blob;
            // 先把预览展示出来，确保即使剪贴板失败也能让用户右键保存图片
            if (m.__previewWrap && m.__previewImg) {
              if (m.__previewUrl) { try { URL.revokeObjectURL(m.__previewUrl); } catch (e2) {} }
              const purl = URL.createObjectURL(blob);
              m.__previewUrl = purl;
              m.__previewImg.src = purl;
              m.__previewWrap.style.display = "flex";
            }
            // Mac Safari 在 await 链之后再调用 clipboard.write 经常被判定为"非用户手势"而拒绝，
            // 改用 ClipboardItem 接受 Promise 的形式可以缓解；同时无论成功与否都不阻断流程。
            let __copyOk = false;
            if (navigator.clipboard && window.ClipboardItem) {
              try {
                await navigator.clipboard.write([
                  new ClipboardItem({ "image/png": Promise.resolve(blob) })
                ]);
                __copyOk = true;
              } catch (errCopy) {
                log("剪贴板写入失败", errCopy);
              }
            }
            __shotOk = true;
            if (__copyOk) {
              m.toast("图片已复制并预览");
            } else {
              // 退化方案：剪贴板不可用时自动下载 PNG（Safari / 隐私模式 / HTTP 等场景）
              try {
                const dlUrl = URL.createObjectURL(blob);
                const dlA = document.createElement("a");
                dlA.href = dlUrl;
                dlA.download = fv0 + "-缺陷分布-" + Date.now() + ".png";
                document.body.appendChild(dlA);
                dlA.click();
                dlA.remove();
                setTimeout(function () { URL.revokeObjectURL(dlUrl); }, 1500);
                m.toast("剪贴板不可用，已下载图片");
              } catch (e3) {
                log("下载图片失败", e3);
                m.toast("可在预览处右键保存图片", true);
              }
            }
          } catch (e) {
            log("截图失败", e);
            m.toast((e && e.message) || "截图失败", true);
          } finally {
            shotBtn.disabled = false;
            shotBtn.textContent = prev;
          }
        };
        footer.appendChild(shotBtn);
 
        const copyBtn = mkBtn("复制文字", { variant: "primary", size: "md" });
        copyBtn.onclick = async () => {
          try {
            if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText(m.hiddenTA.value);
            } else {
              m.hiddenTA.select();
              const ok = document.execCommand("copy");
              m.hiddenTA.setSelectionRange(0, 0);
              if (!ok) throw new Error("execCommand copy failed");
            }
            m.toast("文字已复制");
          } catch (e) {
            log("复制文字失败", e);
            m.toast("复制失败，请手动全选复制", true);
          }
        };
        footer.appendChild(copyBtn);
      },
    });
  }
 
  /* ========== Buttons injection ========== */
  const countActionBtns = () =>
    !!document.getElementById(IDS.btnToolbar) +
    !!document.getElementById(IDS.btnDashboard);
  const countIssueActionBtns = () =>
    countActionBtns() + !!document.getElementById(IDS.btnCreateSubtask);
  const getOpsBar = () =>
    qs(SEL.opsBar) ||
    (qs(SEL.splitPaneRight) && qs(SEL.opsBar, qs(SEL.splitPaneRight)));
  const ensureToolbarWrap = (ops) => {
    if (!ops) return null;
    let wrap = document.getElementById(IDS.toolbarWrap);
    if (!wrap) {
      wrap = document.createElement("span");
      wrap.id = IDS.toolbarWrap;
      Object.assign(wrap.style, {
        marginLeft: "8px", display: "inline-flex",
        gap: "8px", alignItems: "center",
      });
      const target = ops.matches?.("a, button") ? ops.parentElement : ops;
      (target || ops).appendChild(wrap);
    } else {
      const target = ops.matches?.("a, button") ? ops.parentElement : ops;
      if (wrap.parentNode !== target) (target || ops).appendChild(wrap);
    }
    return wrap;
  };

  const ensureToolbarButton = () => {
    if (!isJiraIssuePage()) return false;
    const ops = getOpsBar();
    if (!ops) return false;
    const wrap = ensureToolbarWrap(ops);
    if (!wrap) return false;
    let changed = false;
    if (!document.getElementById(IDS.btnCreateSubtask)) {
      const b = mkBtn("创建子任务", { variant: "ghost", size: "md", id: IDS.btnCreateSubtask });
      b.onclick = () => openCreateSubtaskPanel();
      wrap.appendChild(b);
      changed = true;
    }
    if (isTestExecutionPage() && !document.getElementById(IDS.btnToolbar)) {
      const b = mkBtn("生成测试报告", { variant: "primary", size: "md", id: IDS.btnToolbar });
      b.onclick = generateReport;
      wrap.appendChild(b);
      changed = true;
    }
    if (isTestExecutionPage() && !document.getElementById(IDS.btnDashboard)) {
      const b = mkBtn("配置仪表盘", { variant: "ghost", size: "md", id: IDS.btnDashboard });
      b.onclick = () => configureDashboard(b);
      wrap.appendChild(b);
      changed = true;
    }
    if (isTestExecutionPage() && !document.getElementById(IDS.btnSettings)) {
      const b = mkBtn("设置", { variant: "ghost", size: "md", id: IDS.btnSettings });
      b.onclick = () => openSettingsPanel();
      wrap.appendChild(b);
      changed = true;
    }
    return changed;
  };
  const ensureSubtaskWorklogButtons = () => {
    if (!isJiraIssuePage()) return false;
    let changed = false;
    getSubtaskRows().forEach((tr) => {
      if (tr.querySelector(`.${WORKLOG_BTN}`)) return;
      const key = (tr.getAttribute("data-issuekey") || "").trim();
      if (!key) return;
      const td = document.createElement("td");
      td.className = "tm-subtask-worklog-cell";
      Object.assign(td.style, { padding: "4px 6px", whiteSpace: "nowrap", verticalAlign: "middle" });
      const b = mkBtn("记工时", { variant: "ghost", size: "sm" });
      b.classList.add(WORKLOG_BTN);
      b.title = `记录 ${key} 工时`;
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSubtaskWorklogPanel(key);
      };
      td.appendChild(b);
      tr.appendChild(td);
      changed = true;
    });
    return changed;
  };
  const ensureFloatButton = () => {
    const fb = document.getElementById(IDS.btnFloat);
    if (fb) {
      fb.style.display = countActionBtns() >= 2 ? "none" : "";
      return false;
    }
    const btn = mkBtn("生成报告", { variant: "primary", size: "md", id: IDS.btnFloat });
    btn.onclick = generateReport;
    Object.assign(btn.style, {
      position: "fixed", right: "16px", bottom: "16px",
      zIndex: 9999, boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
    });
    document.body.appendChild(btn);
    return true;
  };
  const ensureReportListButtons = () => {
    if (!isXrayReportListPage()) return false;
    const table = qs(SEL.reportTable);
    if (!table) return false;
    qsa("tbody tr", table).forEach((tr) => {
      if (tr.querySelector(`.${ROW_BTN}`)) return;
      const link = tr.querySelector('td a[href*="/browse/"]');
      if (!link) return;
      const td = document.createElement("td");
      const btn = mkBtn("生成报告", { variant: "primary", size: "sm" });
      btn.classList.add(ROW_BTN);
      btn.onclick = (e) => {
        e.preventDefault();
        try {
          const u = new URL(link.href, location.origin);
          u.searchParams.set("tm_report", "1");
          window.open(u.toString(), "_blank", "noopener");
        } catch {
          location.href = link.href + (link.href.includes("?") ? "&" : "?") + "tm_report=1";
        }
      };
      td.appendChild(btn);
      tr.appendChild(td);
    });
    return true;
  };
 
  /* ========== Scheduling ========== */
  const MAX_QUICK = 10, HB_MS = 1000, HB_BURST = 40;
  let quickSpin = 0, hbTimer = null, hbLeft = 0;
  const needButtons = () => {
    if (isTestExecutionPage() && countActionBtns() < 2) return true;
    if (isJiraIssuePage()) {
      if (!document.getElementById(IDS.btnCreateSubtask)) return true;
      const rows = getSubtaskRows();
      if (rows.length && rows.some((tr) => !tr.querySelector(`.${WORKLOG_BTN}`))) return true;
    }
    if (isXrayReportListPage()) {
      const table = qs(SEL.reportTable);
      if (!table) return true;
      if (qs("tbody tr", table) && !qs(`.${ROW_BTN}`, table)) return true;
    }
    return false;
  };
  const rearmOnce = () => {
    let changed = false;
    if (isJiraIssuePage()) {
      changed = ensureToolbarButton() || changed;
    }
    if (isTestExecutionPage()) {
      ensureFloatButton();
    }
    if (isJiraIssuePage()) changed = ensureSubtaskWorklogButtons() || changed;
    if (isXrayReportListPage()) changed = ensureReportListButtons() || changed;
    if (countIssueActionBtns() >= 2) {
      const fb = document.getElementById(IDS.btnFloat);
      if (fb) fb.style.display = "none";
    }
    return changed;
  };
  const extendHeartbeat = () => {
    hbLeft = Math.max(hbLeft, HB_BURST);
    if (hbTimer) return;
    hbTimer = setInterval(() => {
      if (hbLeft-- <= 0) { clearInterval(hbTimer); hbTimer = null; return; }
      rearmOnce();
      if (!needButtons()) { clearInterval(hbTimer); hbTimer = null; }
    }, HB_MS);
  };
  const rearm = debounce(() => {
    rearmOnce();
    if (quickSpin < MAX_QUICK && needButtons()) {
      quickSpin++; setTimeout(rearm, 150); return;
    }
    if (needButtons()) extendHeartbeat();
  }, 60);
 
  /* ========== Triggers ========== */
  new MutationObserver(() => rearm()).observe(
    document.documentElement || document.body,
    { childList: true, subtree: true }
  );
  (() => {
    if (!window.__tm_fetch_hooked) {
      window.__tm_fetch_hooked = true;
      const raw = window.fetch;
      window.fetch = (...a) =>
        raw(...a).then((r) => {
          r.clone().text().catch(() => null).finally(() => setTimeout(rearm, 0));
          return r;
        });
    }
    if (!window.__tm_xhr_hooked) {
      window.__tm_xhr_hooked = true;
      const Raw = window.XMLHttpRequest;
      window.XMLHttpRequest = function () {
        const xhr = new Raw();
        xhr.addEventListener("loadend", () => setTimeout(rearm, 0));
        return xhr;
      };
    }
  })();
  document.addEventListener("click", (e) => {
    const el = e.target.closest('button, a, span, input[type="button"], input[type="submit"]');
    if (!el) return;
    const t = (txt(el) || el.value || "").toString();
    if (/获取|刷新|查询|Search|Load|Apply|Filter/i.test(t)) {
      let n = 0;
      const it = setInterval(() => {
        rearm();
        if (++n > 24) clearInterval(it);
      }, 250);
    }
  });
  const autoGenerateIfFlagged = () => {
    const p = new URLSearchParams(location.search);
    if (
      isTestExecutionPage() &&
      p.get("tm_report") === "1" &&
      !document.getElementById(IDS.modal)
    ) {
      setTimeout(() => generateReport(), 300);
    }
  };
  (() => {
    if (history.__tm_hooked) return;
    history.__tm_hooked = true;
    const _p = history.pushState;
    history.pushState = function (...a) {
      const r = _p.apply(this, a);
      setTimeout(rearm, 0);
      setTimeout(autoGenerateIfFlagged, 0);
      return r;
    };
    addEventListener("popstate", () => {
      setTimeout(rearm, 0);
      setTimeout(autoGenerateIfFlagged, 0);
    });
    addEventListener("pageshow", () => {
      quickSpin = 0;
      rearm();
      autoGenerateIfFlagged();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        quickSpin = 0;
        rearm();
      }
    });
  })();
  document.addEventListener("keydown", (e) => {
    // Mac 兼容：在 macOS 上 Option+R 会被映射为 ?，e.key 取不到 "r"，必须用 e.code 判断物理键
    const isRKey =
      e.code === "KeyR" ||
      (typeof e.key === "string" && e.key.toLowerCase() === "r");
    if (
      e.altKey && isRKey &&
      isTestExecutionPage() && !document.getElementById(IDS.modal)
    ) {
      e.preventDefault();
      generateReport();
    }
  });
 
  /* ========== Init ========== */
  const init = () => {
    injectStyles();
    Settings.load();
    loadExecMetric();
    quickSpin = 0;
    rearm();
    extendHeartbeat();
    autoGenerateIfFlagged();
    if (isXrayReportListPage()) {
      hbLeft = Math.max(hbLeft, HB_BURST);
      extendHeartbeat();
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
 
  // Debug exports
  window.__tm_generateReport = generateReport;
  window.__tm_forceRearm = () => { quickSpin = 0; rearm(); };
  window.__tm_configureDashboard = () => configureDashboard();
  window.__tm_openSettings = openSettingsPanel;
  window.__tm_openCreateSubtaskPanel = openCreateSubtaskPanel;
  window.__tm_openSubtaskWorklogPanel = openSubtaskWorklogPanel;
})();
