(function () {
  const P = window.PFTPresets;
  const St = window.PFTStorage;

  let state = St.load();
  if (!state._meta || typeof state._meta !== "object") state._meta = {};

  let cloudSyncTimer = null;
  let authUnsubscribe = null;

  const PROJECT_SORT_STORAGE = "pft_project_sort";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const CURRENCY_FLAG = {
    USD: "🇺🇸",
    ZAR: "🇿🇦",
    EUR: "🇪🇺",
    GBP: "🇬🇧",
  };

  function sym(code) {
    const c = P.CURRENCIES.find((x) => x.code === code);
    return c ? c.symbol : code;
  }

  function rates() {
    return state.settings.ratesFromUSD || { USD: 1 };
  }

  /** Units per 1 USD in Settings — keep 2 decimal places (e.g. 16.97) */
  function roundUsdRate(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return x;
    return Math.round(x * 100) / 100;
  }

  /** Convert `amount` in `fromCode` to book currency */
  function toBook(amount, fromCode) {
    const book = state.settings.bookCurrency || "USD";
    const r = rates();
    const from = r[fromCode] || 1;
    const to = r[book] || 1;
    const usd = amount / from;
    return usd * to;
  }

  function roundMoney(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  /** Convert a value already expressed in `fromBook` into `toBook` using USD bridge (rates = units per 1 USD). */
  function convertBookAmount(amount, fromBook, toBook) {
    const r = rates();
    const a = Number(amount) || 0;
    if (fromBook === toBook) return roundMoney(a);
    const from = r[fromBook] || 1;
    const to = r[toBook] || 1;
    if (!from || !to) return roundMoney(a);
    return roundMoney((a / from) * to);
  }

  /**
   * Call with state.settings.bookCurrency already set to `newBook`.
   * Recomputes stored book amounts so totals match FX (not just the symbol).
   */
  function revalueAllBookAmounts(oldBook, newBook) {
    if (oldBook === newBook) return;
    state.transactions.forEach((t) => {
      if (t.originalAmount != null && t.originalCurrency) {
        t.amountBook = roundMoney(toBook(Number(t.originalAmount), t.originalCurrency));
      } else {
        t.amountBook = convertBookAmount(t.amountBook, oldBook, newBook);
      }
    });
    state.projects.forEach((p) => {
      p.targetMonthlyProfit = convertBookAmount(p.targetMonthlyProfit || 0, oldBook, newBook);
      p.estimatedCost = convertBookAmount(p.estimatedCost || 0, oldBook, newBook);
    });
    state.budgets.forEach((b) => {
      b.monthlyLimit = convertBookAmount(b.monthlyLimit || 0, oldBook, newBook);
    });
    state.personalItems.forEach((it) => {
      it.purchasePrice = convertBookAmount(it.purchasePrice || 0, oldBook, newBook);
      it.healthBenefitPerUse = convertBookAmount(it.healthBenefitPerUse || 0, oldBook, newBook);
      it.timeSavingsPerUse = convertBookAmount(it.timeSavingsPerUse || 0, oldBook, newBook);
      it.enjoymentValuePerUse = convertBookAmount(it.enjoymentValuePerUse || 0, oldBook, newBook);
    });
    state.usageLogs.forEach((u) => {
      if (u.valueGenerated != null) u.valueGenerated = convertBookAmount(u.valueGenerated, oldBook, newBook);
    });
  }

  /** After rate edits (same book currency), refresh transaction book amounts from originals. */
  function recomputeTransactionAmountsFromOriginals() {
    state.transactions.forEach((t) => {
      if (t.originalAmount != null && t.originalCurrency) {
        t.amountBook = roundMoney(toBook(Number(t.originalAmount), t.originalCurrency));
      }
    });
  }

  function formatMoney(amount, code) {
    const c = code || state.settings.bookCurrency || "USD";
    const s = sym(c);
    const n = Number(amount) || 0;
    return s + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function todayISODate() {
    const d = new Date();
    const z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function parseISODate(s) {
    if (!s) return null;
    const p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function addMonths(iso, n) {
    const d = parseISODate(iso);
    if (!d) return iso;
    d.setMonth(d.getMonth() + n);
    const z = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function addWeeks(iso, n) {
    const d = parseISODate(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + n * 7);
    const z = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function addYears(iso, n) {
    const d = parseISODate(iso);
    if (!d) return iso;
    d.setFullYear(d.getFullYear() + n);
    const z = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function nextRecurringDate(fromIso, freq) {
    if (!freq) return "";
    if (freq === "weekly") return addWeeks(fromIso, 1);
    if (freq === "monthly") return addMonths(fromIso, 1);
    if (freq === "quarterly") return addMonths(fromIso, 3);
    if (freq === "yearly") return addYears(fromIso, 1);
    return fromIso;
  }

  function toast(msg) {
    const host = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function scheduleCloudSync() {
    const Sync = window.PFTSync;
    if (!Sync || !Sync.isAutoSync()) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(async () => {
      try {
        const client = Sync.getClient();
        if (!client) return;
        const { data } = await client.auth.getUser();
        if (!data.user) return;
        await Sync.pushState(state);
        if (state._meta) state._meta.lastRemoteUpdated = new Date().toISOString();
        St.save(state);
      } catch (_err) {
        /* silent — user can push manually */
      }
    }, 2000);
  }

  function save() {
    St.save(state);
    scheduleCloudSync();
  }

  function projectById(id) {
    return state.projects.find((p) => p.id === id);
  }

  function itemById(id) {
    return state.personalItems.find((i) => i.id === id);
  }

  function transactionsForProject(pid) {
    return state.transactions.filter((t) => t.projectId === pid);
  }

  function transactionsForItem(iid) {
    return state.transactions.filter((t) => t.itemId === iid);
  }

  function projectSummary(pid) {
    const txs = transactionsForProject(pid);
    let income = 0;
    let expense = 0;
    txs.forEach((t) => {
      if (t.type === "income") income += t.amountBook;
      else expense += t.amountBook;
    });
    const net = income - expense;
    const roi = expense > 0 ? (net / expense) * 100 : income > 0 ? 100 : 0;
    return { income, expense, net, roi };
  }

  function totalAssetInvestment(item) {
    const extra = transactionsForItem(item.id)
      .filter((t) => t.type === "expense")
      .reduce((a, t) => a + t.amountBook, 0);
    return (item.purchasePrice || 0) + extra;
  }

  function usageStats(item) {
    const logs = state.usageLogs.filter((u) => u.itemId === item.id);
    const totalUses = logs.length;
    const pd = parseISODate(item.purchaseDate);
    const today = new Date();
    const daysOwned = pd ? Math.max(1, Math.round((today - pd) / 86400000)) : 1;
    return {
      totalUses,
      avgUsesPerWeek: (totalUses / daysOwned) * 7,
      daysOwned,
    };
  }

  const clock = () => new Date();

  /** Mirrors Python smart ROI; fixes inf cost_per_use */
  function smartRoi(item) {
    const stats = usageStats(item);
    const totalInvestment = totalAssetInvestment(item);
    const totalUses = stats.totalUses;
    const health = totalUses * (item.healthBenefitPerUse || 0);
    const timeVal = ((totalUses * (item.timeSavingsPerUse || 0)) / 60) * 25;
    const enjoy = totalUses * (item.enjoymentValuePerUse || 0);
    const totalValue = health + timeVal + enjoy;
    const pd = parseISODate(item.purchaseDate);
    const yearsOwned = pd ? (clock() - pd) / (365.25 * 86400000) : 0;
    const life = item.expectedLifespanYears || 5;
    let currentValue = 0;
    if (yearsOwned < life) {
      currentValue = (item.purchasePrice || 0) * (1 - yearsOwned / life);
    }
    const netValue = totalValue + currentValue - totalInvestment;
    const costPerUse = totalUses > 0 ? totalInvestment / totalUses : null;
    const usageScore = Math.min(stats.avgUsesPerWeek * 10, 40);
    const valueScore =
      totalInvestment > 0 ? Math.min((totalValue / totalInvestment) * 30, 30) : 0;
    const timeScore = Math.min((yearsOwned / life) * 30, 30);
    const justificationScore = usageScore + valueScore + timeScore;
    return {
      totalInvestment,
      totalUses,
      costPerUse,
      netValue,
      roiPct: totalInvestment > 0 ? (netValue / totalInvestment) * 100 : 0,
      justificationScore,
    };
  }

  function currentMonthRange() {
    const today = clock();
    const y = today.getFullYear();
    const m = today.getMonth();
    const pad = (n) => String(n).padStart(2, "0");
    const start = `${y}-${pad(m + 1)}-01`;
    const last = new Date(y, m + 1, 0).getDate();
    const end = `${y}-${pad(m + 1)}-${pad(last)}`;
    return { start, end };
  }

  function txInMonth(t, start, end) {
    if (!t.date) return false;
    return t.date >= start && t.date <= end && t.type === "expense";
  }

  function budgetSpentThisMonth(b) {
    const { start, end } = currentMonthRange();
    const cat = (b.category || "").trim().toLowerCase();
    return state.transactions.reduce((sum, t) => {
      if (!txInMonth(t, start, end)) return sum;
      if ((t.category || "").trim().toLowerCase() !== cat) return sum;
      if (b.projectId) {
        if (t.projectId !== b.projectId) return sum;
      }
      return sum + t.amountBook;
    }, 0);
  }

  /** Sum of monthly category caps for budgets scoped to this project (this month’s envelope total). */
  function sumProjectBudgetCaps(projectId) {
    if (!projectId) return 0;
    return state.budgets
      .filter((b) => b.projectId === projectId)
      .reduce((s, b) => s + (Number(b.monthlyLimit) || 0), 0);
  }

  /** All expense transactions for this project in the current calendar month. */
  function projectExpenseThisMonth(projectId) {
    if (!projectId) return 0;
    const { start, end } = currentMonthRange();
    return state.transactions.reduce((sum, t) => {
      if (t.projectId !== projectId) return sum;
      if (t.type !== "expense") return sum;
      if (!t.date || t.date < start || t.date > end) return sum;
      return sum + (Number(t.amountBook) || 0);
    }, 0);
  }

  function formatBudgetAuditLine(b) {
    const c = b.createdAt;
    const u = b.updatedAt;
    if (!c && !u) return "—";
    const fmt = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    };
    const fs = fmt(c);
    const fu = fmt(u);
    if (fs && fu && c !== u) return `Set ${fs} · Updated ${fu}`;
    return fu || fs || "—";
  }

  function getProjectSort() {
    try {
      const v = localStorage.getItem(PROJECT_SORT_STORAGE);
      if (v === "name" || v === "created" || v === "updated" || v === "status") return v;
    } catch (_e) {
      /* ignore */
    }
    return "name";
  }

  function setProjectSort(v) {
    try {
      localStorage.setItem(PROJECT_SORT_STORAGE, v);
    } catch (_e) {
      /* ignore */
    }
  }

  function sortProjectsList(arr, sortKey) {
    const out = [...arr];
    const lifeOrder = (lc) => {
      const i = P.PROJECT_LIFECYCLES.findIndex((x) => x.value === lc);
      return i >= 0 ? i : 999;
    };
    out.sort((a, b) => {
      if (sortKey === "name") return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      if (sortKey === "created") {
        const ca = a.createdAt || "";
        const cb = b.createdAt || "";
        if (ca !== cb) return ca.localeCompare(cb);
        return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      }
      if (sortKey === "updated") {
        const ua = a.updatedAt || "";
        const ub = b.updatedAt || "";
        if (ua !== ub) return ub.localeCompare(ua);
        return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      }
      if (sortKey === "status") {
        const d = lifeOrder(a.lifecycle) - lifeOrder(b.lifecycle);
        if (d !== 0) return d;
        return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      }
      return 0;
    });
    return out;
  }

  function monthRangeFromDate(iso) {
    if (!iso) return currentMonthRange();
    const d = parseISODate(iso);
    if (!d || Number.isNaN(d.getTime())) return currentMonthRange();
    const y = d.getFullYear();
    const m = d.getMonth();
    const pad = (n) => String(n).padStart(2, "0");
    const start = `${y}-${pad(m + 1)}-01`;
    const end = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
    return { start, end };
  }

  function normCat(s) {
    return (s || "").trim().toLowerCase();
  }

  function budgetsForExpenseLike(tx) {
    if (!tx || tx.type !== "expense") return [];
    const txCat = normCat(tx.category);
    if (!txCat) return [];
    return state.budgets.filter((b) => {
      if (normCat(b.category) !== txCat) return false;
      if (b.projectId) return b.projectId === (tx.projectId || null);
      return true;
    });
  }

  function expenseBudgetFlag(tx) {
    if (!tx || tx.type !== "expense") return "";
    return budgetsForExpenseLike(tx).length ? "budgeted" : "unbudgeted";
  }

  function spentForBudgetInRange(budget, start, end, excludeTxId) {
    const cat = normCat(budget.category);
    return state.transactions.reduce((sum, t) => {
      if (t.id === excludeTxId) return sum;
      if (t.type !== "expense") return sum;
      if (!t.date || t.date < start || t.date > end) return sum;
      if (normCat(t.category) !== cat) return sum;
      if (budget.projectId && t.projectId !== budget.projectId) return sum;
      return sum + (Number(t.amountBook) || 0);
    }, 0);
  }

  async function confirmExpenseBudgetImpact(nextTx, editingId) {
    if (!nextTx || nextTx.type !== "expense") return true;
    if (!nextTx.category || !nextTx.date) return true;
    const matched = budgetsForExpenseLike(nextTx);
    if (!matched.length) {
      let extra = "";
      if (nextTx.projectId) {
        const scoped = state.budgets.filter((b) => b.projectId === nextTx.projectId);
        if (scoped.length) {
          const { start, end } = monthRangeFromDate(nextTx.date);
          const alloc = scoped.reduce((s, b) => s + (Number(b.monthlyLimit) || 0), 0);
          const used = scoped.reduce((s, b) => s + spentForBudgetInRange(b, start, end, editingId), 0);
          const rem = alloc - used;
          extra = `\n\nThis project currently has ${formatMoney(alloc)} budgeted across other categories, with ${formatMoney(Math.max(0, rem))} remaining.`;
        }
      }
      return warningConfirm({
        title: "Unbudgeted expense",
        message: `No budget is set for "${nextTx.category}"${nextTx.projectId ? " in this project" : ""} this month.${extra}\n\nProceed anyway?`,
        proceedLabel: "Proceed",
        cancelLabel: "Cancel",
      });
    }
    const { start, end } = monthRangeFromDate(nextTx.date);
    const nextAmount = Number(nextTx.amountBook) || 0;
    const exceeded = matched
      .map((b) => {
        const spent = spentForBudgetInRange(b, start, end, editingId);
        const after = spent + nextAmount;
        const limit = Number(b.monthlyLimit) || 0;
        const over = after - limit;
        return { b, after, limit, over };
      })
      .filter((x) => x.over > 0.0001);
    if (!exceeded.length) return true;
    const msg = exceeded
      .map((x) => {
        const scope = x.b.projectId ? projectById(x.b.projectId)?.name || "Project" : "Global";
        return `${scope} · ${x.b.category}: ${formatMoney(x.after)} / ${formatMoney(x.limit)} (over ${formatMoney(x.over)})`;
      })
      .join("\n");
    return warningConfirm({
      title: "Budget limit exceeded",
      message: `This expense exceeds budget:\n\n${msg}\n\nProceed anyway?`,
      proceedLabel: "Proceed",
      cancelLabel: "Cancel",
    });
  }

  function openModal(id) {
    $(id).classList.add("open");
  }

  function closeModals() {
    $$(".modal-overlay").forEach((el) => el.classList.remove("open"));
  }

  function warningConfirm(opts) {
    const ov = $("#modal-warning-confirm");
    const modalBox = $("#warning-confirm-box");
    const titleEl = $("#warning-confirm-title");
    const msgEl = $("#warning-confirm-message");
    const cancelBtn = $("#btn-warning-cancel");
    const proceedBtn = $("#btn-warning-proceed");
    if (!ov || !titleEl || !msgEl || !cancelBtn || !proceedBtn) {
      return Promise.resolve(confirm((opts && opts.message) || "Proceed?"));
    }
    const title = (opts && opts.title) || "Warning";
    const message = (opts && opts.message) || "Proceed?";
    const proceedLabel = (opts && opts.proceedLabel) || "Proceed";
    const cancelLabel = (opts && opts.cancelLabel) || "Cancel";
    const variant = opts && opts.variant === "danger" ? "danger" : "warning";
    titleEl.textContent = title;
    msgEl.textContent = message;
    proceedBtn.textContent = proceedLabel;
    cancelBtn.textContent = cancelLabel;
    proceedBtn.className = "btn " + (variant === "danger" ? "btn-danger" : "btn-primary");
    if (modalBox) {
      modalBox.classList.toggle("warning-modal--danger", variant === "danger");
    }
    return new Promise((resolve) => {
      let done = false;
      const cleanup = (result) => {
        if (done) return;
        done = true;
        ov.classList.remove("open");
        modalBox?.classList.remove("warning-modal--danger");
        proceedBtn.className = "btn btn-primary";
        proceedBtn.removeEventListener("click", onProceed);
        cancelBtn.removeEventListener("click", onCancel);
        ov.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onProceed = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => {
        if (e.target === ov) cleanup(false);
      };
      const onKey = (e) => {
        if (e.key === "Escape") cleanup(false);
      };
      proceedBtn.addEventListener("click", onProceed);
      cancelBtn.addEventListener("click", onCancel);
      ov.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
      ov.classList.add("open");
    });
  }

  function recordFxAudit(summary) {
    if (!state._meta || typeof state._meta !== "object") state._meta = {};
    state._meta.fxLastUpdatedAt = new Date().toISOString();
    state._meta.fxLastUpdatedSummary = summary || "";
    updateFxAuditUi();
  }

  function updateFxAuditUi() {
    const el = $("#fx-conversion-audit");
    if (!el) return;
    const iso = state._meta && state._meta.fxLastUpdatedAt;
    const sum = (state._meta && state._meta.fxLastUpdatedSummary) || "";
    if (!iso) {
      el.textContent = "";
      el.hidden = true;
      return;
    }
    const when = new Date(iso);
    const dt = when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    el.textContent = `Converted at ${dt}${sum ? " — " + sum : ""}.`;
    el.hidden = false;
  }

  function isMobileNav() {
    return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches;
  }

  function closeDrawer() {
    $("#main-nav")?.classList.remove("is-open");
    $("#drawer-backdrop")?.classList.remove("is-open");
    const mt = $("#menu-toggle");
    if (mt) mt.setAttribute("aria-expanded", "false");
    const db = $("#drawer-backdrop");
    if (db) db.setAttribute("aria-hidden", "true");
  }

  function toggleDrawer() {
    const nav = $("#main-nav");
    const back = $("#drawer-backdrop");
    if (!nav || !back) return;
    const open = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", open);
    back.classList.toggle("is-open", open);
    $("#menu-toggle")?.setAttribute("aria-expanded", open ? "true" : "false");
    back.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function navigate(view) {
    closeDrawer();
    $$(".view").forEach((v) => v.classList.remove("active"));
    const el = $("#view-" + view);
    if (el) el.classList.add("active");
    $$(".nav-pill").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    if (view === "dashboard") renderDashboard();
    if (view === "ledger") renderLedger();
    if (view === "projects") renderProjects();
    if (view === "assets") renderAssets();
    if (view === "budgets") renderBudgets();
    if (view === "settings") renderSettings();
  }

  function fillSelect(sel, options, getVal, getLabel, emptyLabel) {
    if (!sel) return;
    sel.innerHTML = "";
    if (emptyLabel !== undefined) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = emptyLabel;
      sel.appendChild(o);
    }
    options.forEach((x) => {
      const o = document.createElement("option");
      o.value = getVal(x);
      o.textContent = getLabel(x);
      sel.appendChild(o);
    });
  }

  function initPresetsUi() {
    const dlE = $("#list-cat-expense");
    const dlI = $("#list-cat-income");
    dlE.innerHTML = P.EXPENSE_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
    dlI.innerHTML = P.INCOME_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
    $("#list-asset-cat").innerHTML = P.ASSET_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
    $("#list-bd-cat").innerHTML = P.EXPENSE_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");

    fillSelect($("#tx-payment"), P.PAYMENT_METHODS, (x) => x, (x) => x, "—");
    fillSelect($("#tx-recurring"), P.RECURRING_FREQUENCIES, (x) => x.value, (x) => x.label);
    fillSelect($("#pj-lifecycle"), P.PROJECT_LIFECYCLES, (x) => x.value, (x) => x.label);
    fillSelect($("#set-book"), P.CURRENCIES, (x) => x.code, (x) => `${x.code} (${x.symbol})`);
    fillSelect($("#tx-currency"), P.CURRENCIES, (x) => x.code, (x) => `${x.code} ${x.symbol}`);

    const book = state.settings.bookCurrency || "USD";
    $("#set-book").value = book;
    renderHeaderCurrency(book);
    renderHeaderCurrencyMenu();
  }

  function renderHeaderCurrency(bookCode) {
    const code = bookCode || state.settings.bookCurrency || "USD";
    const cur = P.CURRENCIES.find((c) => c.code === code) || P.CURRENCIES[0];
    const chip = $("#header-book-cur");
    const flagEl = $("#header-book-cur-flag");
    const symbolEl = $("#header-book-cur-symbol");
    if (flagEl) flagEl.textContent = CURRENCY_FLAG[cur.code] || "💱";
    if (symbolEl) symbolEl.textContent = cur.symbol;
    if (chip) chip.title = `Book currency: ${cur.code} (${cur.name})`;
  }

  function renderHeaderCurrencyMenu() {
    const menu = $("#header-currency-menu");
    if (!menu) return;
    const activeCode = state.settings.bookCurrency || "USD";
    menu.innerHTML = "";
    P.CURRENCIES.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "currency-option" + (c.code === activeCode ? " active" : "");
      btn.setAttribute("data-currency", c.code);
      btn.innerHTML = `
        <span class="currency-option-flag">${CURRENCY_FLAG[c.code] || "💱"}</span>
        <span class="currency-option-meta">
          <span class="currency-option-code">${c.code} ${c.symbol}</span>
          <span class="currency-option-name">${escapeHtml(c.name)}</span>
        </span>`;
      menu.appendChild(btn);
    });
  }

  function setCurrencyMenuOpen(open) {
    const menu = $("#header-currency-menu");
    const chip = $("#header-book-cur");
    if (!menu || !chip) return;
    if (open) {
      menu.hidden = false;
      menu.classList.add("open");
      chip.setAttribute("aria-expanded", "true");
    } else {
      menu.classList.remove("open");
      chip.setAttribute("aria-expanded", "false");
      setTimeout(() => {
        if (!menu.classList.contains("open")) menu.hidden = true;
      }, 200);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function bindProjectsAndItemsSelects() {
    fillSelect(
      $("#tx-project"),
      state.projects,
      (p) => p.id,
      (p) => p.name,
      "None"
    );
    fillSelect(
      $("#tx-item"),
      state.personalItems,
      (i) => i.id,
      (i) => i.name,
      "None"
    );
    fillSelect(
      $("#filter-project"),
      state.projects,
      (p) => p.id,
      (p) => p.name,
      "All projects"
    );
    fillSelect(
      $("#bd-project"),
      state.projects,
      (p) => p.id,
      (p) => p.name,
      "All projects (global)"
    );
  }

  function updateTxCategoryDatalist() {
    const type = $("#tx-type").value;
    $("#tx-category").setAttribute("list", type === "income" ? "list-cat-income" : "list-cat-expense");
  }

  function renderTxTemplates() {
    const row = $("#tx-templates");
    row.innerHTML = "";
    const type = $("#tx-type").value;
    const list = type === "income" ? P.INCOME_TEMPLATES : P.EXPENSE_TEMPLATES;
    list.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = t.label;
      b.addEventListener("click", () => {
        $("#tx-category").value = t.category;
        $("#tx-amount").value = t.amount != null ? String(t.amount) : "";
        $("#tx-desc").value = t.description || "";
      });
      row.appendChild(b);
    });
  }

  function renderDashboard() {
    const book = state.settings.bookCurrency || "USD";
    const dashBook = $("#dash-book-cur");
    if (dashBook) dashBook.textContent = sym(book);
    renderHeaderCurrency(book);
    let inc = 0;
    let exp = 0;
    state.transactions.forEach((t) => {
      if (!t.projectId) return;
      if (t.type === "income") inc += t.amountBook;
      else exp += t.amountBook;
    });
    const net = inc - exp;
    $("#dash-income").textContent = formatMoney(inc);
    $("#dash-expense").textContent = formatMoney(exp);
    $("#dash-profit").textContent = formatMoney(net);
    $("#dash-profit").className = "stat-value" + (net >= 0 ? " plain" : " danger");
    $("#dash-roi").textContent = exp > 0 ? `Margin ${((net / exp) * 100).toFixed(1)}% on project spend` : "No project expenses yet";

    const tbody = $("#table-recent tbody");
    tbody.innerHTML = "";
    const recent = [...state.transactions].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 12);
    recent.forEach((t) => {
      const tr = document.createElement("tr");
      const proj = t.projectId ? projectById(t.projectId) : null;
      const label = proj ? proj.name : t.itemId ? itemById(t.itemId)?.name || "Asset" : "—";
      const expenseFlag = expenseBudgetFlag(t);
      tr.innerHTML = `
        <td>${escapeHtml(t.date || "")}</td>
        <td>${escapeHtml(label)}</td>
        <td><span class="badge ${t.type === "income" ? "badge-income" : `badge-expense ${expenseFlag === "unbudgeted" ? "badge-unbudgeted" : "badge-budgeted"}`}">${t.type}</span></td>
        <td>${formatMoney(t.amountBook)}</td>`;
      tbody.appendChild(tr);
    });

    const rt = $("#table-recurring tbody");
    rt.innerHTML = "";
    const { start: monthStart, end: monthEnd } = currentMonthRange();
    state.transactions
      .filter((t) => t.recurring && t.nextDueDate)
      .filter((t) => t.nextDueDate >= monthStart && t.nextDueDate <= monthEnd)
      .sort((a, b) => (a.nextDueDate || "").localeCompare(b.nextDueDate || ""))
      .slice(0, 15)
      .forEach((t) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(t.nextDueDate)}</td>
          <td>${escapeHtml(t.description || t.category || "")}</td>
          <td>${formatMoney(t.amountBook)}</td>`;
        rt.appendChild(tr);
      });

    const bmini = $("#table-budget-mini tbody");
    bmini.innerHTML = "";
    const { start, end } = currentMonthRange();
    state.budgets.forEach((b) => {
      const spent = budgetSpentThisMonth(b);
      const scope = b.projectId ? projectById(b.projectId)?.name || "Project" : "Global";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(scope + " · " + b.category)}</td><td>${formatMoney(spent)} / ${formatMoney(b.monthlyLimit)}</td>`;
      bmini.appendChild(tr);
    });
    $("#dash-budget-summary").textContent = `${state.budgets.length} active · ${start} → ${end}`;

    const ubt = $("#table-unbudgeted-mini tbody");
    if (ubt) {
      ubt.innerHTML = "";
      const unbudgetedByCat = new Map();
      state.transactions.forEach((t) => {
        if (!txInMonth(t, start, end)) return;
        if (expenseBudgetFlag(t) !== "unbudgeted") return;
        const cat = (t.category || "Uncategorized").trim() || "Uncategorized";
        unbudgetedByCat.set(cat, (unbudgetedByCat.get(cat) || 0) + (Number(t.amountBook) || 0));
      });
      const rows = Array.from(unbudgetedByCat.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      rows.forEach(([cat, amt]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${escapeHtml(cat)}</td><td>${formatMoney(amt)}</td>`;
        ubt.appendChild(tr);
      });
      if (!rows.length) {
        ubt.innerHTML = `<tr><td colspan="2" class="empty-state">No unbudgeted spend this month.</td></tr>`;
      }
      const ubSummary = $("#dash-unbudgeted-summary");
      if (ubSummary) {
        const total = Array.from(unbudgetedByCat.values()).reduce((sum, v) => sum + v, 0);
        ubSummary.textContent = `${unbudgetedByCat.size} categories · ${formatMoney(total)}`;
      }
    }

    drawProjectChart();
  }

  function drawProjectChart() {
    const wrap = $("#chart-projects")?.parentElement;
    const canvas = $("#chart-projects");
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    const w = wrap.clientWidth || 600;
    const projects = state.projects.slice(0, 12);
    const rowH = 38;
    const padT = 14;
    const padB = 14;
    const amtCol = Math.min(118, Math.floor(w * 0.22));
    const nameCol = Math.min(150, Math.max(72, Math.floor(w * 0.28)));
    const h = Math.max(140, padT + padB + projects.length * rowH);

    wrap.style.height = h + "px";
    canvas.style.height = h + "px";
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const bg = cssVar("--chart-canvas") || "#14182a";
    const text = cssVar("--text") || "#f1f5f9";
    const muted = cssVar("--chart-muted") || "#64748b";
    const track = cssVar("--progress-track") || "#334155";
    const ok = cssVar("--success") || "#22c55e";
    const bad = cssVar("--danger") || "#f43f5e";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!projects.length) {
      ctx.fillStyle = muted;
      ctx.font = "14px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText("Add a project to see performance", 16, h / 2);
      return;
    }

    const profits = projects.map((p) => projectSummary(p.id).net);
    const maxAbs = Math.max(1, ...profits.map((x) => Math.abs(x)));
    const xBar0 = nameCol + 10;
    const xBar1 = w - amtCol - 10;
    const barW = Math.max(24, xBar1 - xBar0);

    ctx.textBaseline = "middle";

    projects.forEach((p, i) => {
      const net = profits[i];
      const cy = padT + i * rowH + rowH / 2;
      const netStr = formatMoney(net);
      const barTop = cy - 11;
      const barHt = 22;

      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = text;
      let name = p.name;
      while (name.length > 1 && ctx.measureText(name + "…").width > nameCol - 6) name = name.slice(0, -1);
      if (name !== p.name) name += "…";
      ctx.fillText(name, 6, cy);

      ctx.fillStyle = track;
      ctx.fillRect(xBar0, barTop, barW, barHt);
      const fillFrac = Math.abs(net) / maxAbs;
      const fillW = Math.max(net !== 0 ? 3 : 0, fillFrac * barW);
      ctx.fillStyle = net >= 0 ? ok : bad;
      ctx.fillRect(xBar0, barTop, fillW, barHt);

      ctx.textAlign = "right";
      ctx.font = "600 13px ui-monospace, monospace";
      ctx.fillStyle = net >= 0 ? ok : bad;
      ctx.fillText(netStr, w - 6, cy);
    });
  }

  function renderLedger() {
    bindProjectsAndItemsSelects();
    const type = $("#filter-type").value;
    const pid = $("#filter-project").value;
    const from = $("#filter-from").value;
    const to = $("#filter-to").value;
    const q = ($("#filter-search").value || "").toLowerCase().trim();

    const tbody = $("#table-ledger tbody");
    tbody.innerHTML = "";
    let rows = [...state.transactions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (type) rows = rows.filter((t) => t.type === type);
    if (pid) rows = rows.filter((t) => t.projectId === pid);
    if (from) rows = rows.filter((t) => (t.date || "") >= from);
    if (to) rows = rows.filter((t) => (t.date || "") <= to);
    if (q) {
      rows = rows.filter((t) => {
        const blob = [t.description, t.category, t.vendor, (t.tags || []).join(" ")].join(" ").toLowerCase();
        return blob.includes(q);
      });
    }
    rows.forEach((t) => {
      const tr = document.createElement("tr");
      const pl = t.projectId ? projectById(t.projectId)?.name : "";
      const il = t.itemId ? itemById(t.itemId)?.name : "";
      const loc = [pl, il].filter(Boolean).join(" · ") || "—";
      const expenseFlag = expenseBudgetFlag(t);
      tr.innerHTML = `
        <td>${escapeHtml(t.date || "")}</td>
        <td><span class="badge ${t.type === "income" ? "badge-income" : `badge-expense ${expenseFlag === "unbudgeted" ? "badge-unbudgeted" : "badge-budgeted"}`}">${t.type}</span></td>
        <td>${formatMoney(t.amountBook)}</td>
        <td>${escapeHtml(t.category || "")}</td>
        <td>${escapeHtml(t.description || "")}</td>
        <td>${escapeHtml(loc)}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm" data-edit-tx="${escapeHtml(t.id)}">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-tx="${escapeHtml(t.id)}">Del</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = (e) => {
      const ed = e.target.closest("[data-edit-tx]");
      const del = e.target.closest("[data-del-tx]");
      if (ed) openTransactionModal(ed.getAttribute("data-edit-tx"));
      if (del) void deleteTransaction(del.getAttribute("data-del-tx"));
    };
  }

  async function deleteTransaction(id) {
    const ok = await warningConfirm({
      title: "Delete transaction",
      message: "Delete this transaction? This cannot be undone.",
      proceedLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    state.transactions = state.transactions.filter((t) => t.id !== id);
    save();
    toast("Transaction removed");
    renderLedger();
    renderDashboard();
    renderBudgets();
    renderProjects();
    if ($("#view-project-detail")?.classList.contains("active")) renderProjectDetail();
    if ($("#view-asset-detail")?.classList.contains("active")) renderAssetDetail();
  }

  function renderProjects() {
    const sortSel = $("#project-sort");
    if (sortSel) sortSel.value = getProjectSort();
    const host = $("#project-cards");
    host.innerHTML = "";
    if (!state.projects.length) {
      host.innerHTML = `<div class="card empty-state"><strong>No projects yet</strong>Create one to track income and expenses.</div>`;
      return;
    }
    const sortKey = getProjectSort();
    sortProjectsList(state.projects, sortKey).forEach((p) => {
      const s = projectSummary(p.id);
      const lc = p.lifecycle || "in_progress";
      const life = P.PROJECT_LIFECYCLES.find((x) => x.value === lc);
      const lifeLabel = life ? life.label : lc;
      const phaseClass = P.lifecycleCss(lc);
      const card = document.createElement("div");
      card.className = `card project-card ${phaseClass}`;
      card.innerHTML = `
        <h3>${escapeHtml(p.name)}</h3>
        <span class="badge project-phase-badge">${escapeHtml(lifeLabel)}</span>
        <div class="mini-stats">
          <div class="mini-stat"><span>Income</span><strong>${formatMoney(s.income)}</strong></div>
          <div class="mini-stat"><span>Expense</span><strong>${formatMoney(s.expense)}</strong></div>
          <div class="mini-stat"><span>Net</span><strong class="${s.net >= 0 ? "project-net-positive" : "project-net-negative"}">${formatMoney(s.net)}</strong></div>
        </div>
        <div class="row-actions" style="margin-top:1rem">
          <button type="button" class="btn btn-sm btn-primary" data-open-project="${escapeHtml(p.id)}">Open</button>
        </div>`;
      host.appendChild(card);
    });
    host.onclick = (e) => {
      const b = e.target.closest("[data-open-project]");
      if (b) openProjectDetail(b.getAttribute("data-open-project"));
    };
  }

  let selectedProjectId = null;
  let selectedItemId = null;

  function openProjectDetail(id) {
    selectedProjectId = id;
    $$(".view").forEach((v) => v.classList.remove("active"));
    $("#view-project-detail").classList.add("active");
    $$(".nav-pill").forEach((x) => x.classList.remove("active"));
    renderProjectDetail();
  }

  function renderProjectDetail() {
    const p = projectById(selectedProjectId);
    if (!p) {
      navigate("projects");
      return;
    }
    $("#detail-project-name").textContent = p.name;
    $("#detail-project-desc").textContent = p.description || "";
    const s = projectSummary(p.id);
    $("#detail-target").textContent = formatMoney(p.targetMonthlyProfit || 0);
    $("#detail-inc").textContent = formatMoney(s.income);
    $("#detail-exp").textContent = formatMoney(s.expense);
    $("#detail-net").textContent = formatMoney(s.net);
    $("#detail-net").style.color = s.net >= 0 ? "var(--success)" : "var(--danger)";
    const { start, end } = currentMonthRange();
    const monthInc = transactionsForProject(p.id)
      .filter((t) => t.type === "income" && t.date >= start && t.date <= end)
      .reduce((a, t) => a + t.amountBook, 0);
    const monthExp = transactionsForProject(p.id)
      .filter((t) => t.type === "expense" && t.date >= start && t.date <= end)
      .reduce((a, t) => a + t.amountBook, 0);
    const monthNet = monthInc - monthExp;
    const tgt = p.targetMonthlyProfit || 0;
    $("#detail-vs-target").textContent =
      tgt > 0
        ? `This month net ${formatMoney(monthNet)} vs target ${formatMoney(tgt)}`
        : `This month net ${formatMoney(monthNet)}`;
    const lc = p.lifecycle || "in_progress";
    const life = P.PROJECT_LIFECYCLES.find((x) => x.value === lc);
    $("#detail-phase").textContent = life ? life.label : lc;
    const est = Number(p.estimatedCost) || 0;
    const spent = s.expense;
    const targetEndLabel = p.estimatedEndDate || "—";
    $("#detail-plan").textContent = `Est. cost ${formatMoney(est)} · Spent ${formatMoney(spent)} · Target end ${targetEndLabel}`;
    $("#detail-plan").style.color = "var(--text-muted)";
    $("#detail-tags").textContent = `Tags: ${(p.tags || []).join(", ") || "—"}`;
    $("#detail-tags").style.color = "var(--text-muted)";
    $("#detail-tags").style.marginTop = "0.5rem";

    const allocCaps = sumProjectBudgetCaps(p.id);
    const spentThisMonth = monthExp;
    const remBudget = allocCaps - spentThisMonth;
    $("#detail-budget-alloc").textContent = formatMoney(allocCaps);
    $("#detail-budget-spent").textContent = formatMoney(spentThisMonth);
    const remEl = $("#detail-budget-rem");
    remEl.textContent = formatMoney(remBudget);
    remEl.style.color =
      remBudget < -0.0001 ? "var(--danger)" : remBudget > 0.0001 ? "var(--success)" : "var(--text)";

    const tb = $("#table-project-tx tbody");
    tb.innerHTML = "";
    transactionsForProject(p.id)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .forEach((t) => {
        const tr = document.createElement("tr");
        const expenseFlag = expenseBudgetFlag(t);
        tr.innerHTML = `
          <td>${escapeHtml(t.date || "")}</td>
          <td><span class="badge ${t.type === "income" ? "badge-income" : `badge-expense ${expenseFlag === "unbudgeted" ? "badge-unbudgeted" : "badge-budgeted"}`}">${t.type}</span></td>
          <td>${formatMoney(t.amountBook)}</td>
          <td>${escapeHtml(t.category || "")}</td>
          <td>${escapeHtml(t.description || "")}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-sm" data-edit-tx="${escapeHtml(t.id)}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-del-tx="${escapeHtml(t.id)}">Del</button>
          </td>`;
        tb.appendChild(tr);
      });
    tb.onclick = (e) => {
      const ed = e.target.closest("[data-edit-tx]");
      const del = e.target.closest("[data-del-tx]");
      if (ed) openTransactionModal(ed.getAttribute("data-edit-tx"));
      if (del) void deleteTransaction(del.getAttribute("data-del-tx"));
    };
  }

  function renderAssets() {
    const host = $("#asset-cards");
    host.innerHTML = "";
    if (!state.personalItems.length) {
      host.innerHTML = `<div class="card empty-state"><strong>No assets</strong>Add gear you want to amortize and justify.</div>`;
      return;
    }
    state.personalItems.forEach((item) => {
      const roi = smartRoi(item);
      const score = Math.min(100, roi.justificationScore || 0);
      const card = document.createElement("div");
      card.className = "card asset-card";
      const cpu =
        roi.costPerUse == null ? "—" : formatMoney(roi.costPerUse);
      card.innerHTML = `
        <h3>${escapeHtml(item.name)}</h3>
        <span class="badge badge-muted">${escapeHtml(item.category || "")}</span>
        <div class="progress-bar" style="margin-top:0.75rem"><i style="width:${score}%"></i></div>
        <p class="stat-sub">Score ${score.toFixed(0)}/100 · Uses ${roi.totalUses}</p>
        <div class="mini-stats">
          <div class="mini-stat"><span>Invested</span><strong>${formatMoney(roi.totalInvestment)}</strong></div>
          <div class="mini-stat"><span>Cost/use</span><strong>${cpu}</strong></div>
        </div>
        <div class="row-actions" style="margin-top:1rem">
          <button type="button" class="btn btn-sm btn-primary" data-open-asset="${escapeHtml(item.id)}">Open</button>
        </div>`;
      host.appendChild(card);
    });
    host.onclick = (e) => {
      const b = e.target.closest("[data-open-asset]");
      if (b) openAssetDetail(b.getAttribute("data-open-asset"));
    };
  }

  function openAssetDetail(id) {
    selectedItemId = id;
    $$(".view").forEach((v) => v.classList.remove("active"));
    $("#view-asset-detail").classList.add("active");
    $$(".nav-pill").forEach((x) => x.classList.remove("active"));
    renderAssetDetail();
  }

  function renderAssetDetail() {
    const item = itemById(selectedItemId);
    if (!item) {
      navigate("assets");
      return;
    }
    const roi = smartRoi(item);
    $("#detail-asset-name").textContent = item.name;
    $("#detail-asset-notes").textContent = item.notes || "";
    $("#asset-inv").textContent = formatMoney(roi.totalInvestment);
    $("#asset-uses").textContent = String(roi.totalUses);
    $("#asset-cpu").textContent = roi.costPerUse == null ? "—" : formatMoney(roi.costPerUse);
    $("#asset-roi-line").textContent = `Net value ${formatMoney(roi.netValue)} · ROI ${roi.roiPct.toFixed(1)}%`;
    const sc = Math.min(100, roi.justificationScore || 0);
    $("#asset-score-bar").style.width = sc + "%";

    const ut = $("#table-usage tbody");
    ut.innerHTML = "";
    state.usageLogs
      .filter((u) => u.itemId === item.id)
      .sort((a, b) => (b.usageDate || "").localeCompare(a.usageDate || ""))
      .forEach((u) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(u.usageDate || "")}</td>
          <td>${u.durationMinutes ?? 0}</td>
          <td>${u.distanceKm ?? 0}</td>
          <td>${escapeHtml(u.notes || "")}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-sm" data-edit-us="${escapeHtml(u.id)}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-del-us="${escapeHtml(u.id)}">Del</button>
          </td>`;
        ut.appendChild(tr);
      });
    ut.onclick = (e) => {
      const ed = e.target.closest("[data-edit-us]");
      if (ed) {
        openUsageModal(item.id, ed.getAttribute("data-edit-us"));
        return;
      }
      const d = e.target.closest("[data-del-us]");
      if (!d) return;
      const id = d.getAttribute("data-del-us");
      void (async () => {
        const ok = await warningConfirm({
          title: "Delete usage log",
          message: "Delete this usage log entry?",
          proceedLabel: "Delete",
          cancelLabel: "Cancel",
          variant: "danger",
        });
        if (!ok) return;
        state.usageLogs = state.usageLogs.filter((u) => u.id !== id);
        save();
        renderAssetDetail();
        toast("Usage log removed");
      })();
    };

    const at = $("#table-asset-tx tbody");
    at.innerHTML = "";
    transactionsForItem(item.id)
      .filter((t) => t.type === "expense")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .forEach((t) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(t.date || "")}</td>
          <td>${formatMoney(t.amountBook)}</td>
          <td>${escapeHtml(t.category || "")}</td>
          <td>${escapeHtml(t.description || "")}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-sm" data-edit-tx="${escapeHtml(t.id)}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-del-tx="${escapeHtml(t.id)}">Del</button>
          </td>`;
        at.appendChild(tr);
      });
    at.onclick = (e) => {
      const ed = e.target.closest("[data-edit-tx]");
      const del = e.target.closest("[data-del-tx]");
      if (ed) openTransactionModal(ed.getAttribute("data-edit-tx"));
      if (del) void deleteTransaction(del.getAttribute("data-del-tx"));
    };
  }

  function renderProjectBudgetRollup() {
    const tb = $("#table-project-budget-rollup tbody");
    if (!tb) return;
    tb.innerHTML = "";
    if (!state.projects.length) {
      tb.innerHTML = `<tr><td colspan="4" class="empty-state">No projects yet.</td></tr>`;
      return;
    }
    const sorted = [...state.projects].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
    );
    sorted.forEach((p) => {
      const alloc = sumProjectBudgetCaps(p.id);
      const spent = projectExpenseThisMonth(p.id);
      const rem = alloc - spent;
      const tr = document.createElement("tr");
      if (rem < -0.0001) tr.classList.add("budget-row-over");
      tr.innerHTML = `
        <td>${escapeHtml(p.name)}</td>
        <td>${formatMoney(alloc)}</td>
        <td>${formatMoney(spent)}</td>
        <td>${formatMoney(rem)}</td>`;
      tb.appendChild(tr);
    });
  }

  function renderBudgets() {
    renderProjectBudgetRollup();
    const tb = $("#table-budgets tbody");
    tb.innerHTML = "";
    if (!state.budgets.length) {
      tb.innerHTML = `<tr><td colspan="7" class="empty-state">No budgets — add monthly caps for categories.</td></tr>`;
      return;
    }
    state.budgets.forEach((b) => {
      const spent = budgetSpentThisMonth(b);
      const over = spent > (Number(b.monthlyLimit) || 0);
      const remaining = Math.max(0, (Number(b.monthlyLimit) || 0) - spent);
      const scope = b.projectId ? projectById(b.projectId)?.name || "Project" : "Global";
      const tr = document.createElement("tr");
      if (over) tr.classList.add("budget-row-over");
      tr.innerHTML = `
        <td>${escapeHtml(scope)}</td>
        <td>${escapeHtml(b.category)}</td>
        <td>${formatMoney(b.monthlyLimit)}</td>
        <td class="${over ? "budget-cell-over" : ""}">${formatMoney(spent)}${over ? ' <span class="badge badge-over">Over</span>' : ""}</td>
        <td>${formatMoney(remaining)}</td>
        <td class="budget-audit-cell" title="${escapeHtml(formatBudgetAuditLine(b))}">${escapeHtml(formatBudgetAuditLine(b))}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm" data-edit-bd="${escapeHtml(b.id)}">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-bd="${escapeHtml(b.id)}">Del</button>
        </td>`;
      tb.appendChild(tr);
    });
    tb.onclick = (e) => {
      const ed = e.target.closest("[data-edit-bd]");
      const del = e.target.closest("[data-del-bd]");
      if (ed) openBudgetModal(ed.getAttribute("data-edit-bd"));
      if (del) {
        const id = del.getAttribute("data-del-bd");
        void (async () => {
          const ok = await warningConfirm({
            title: "Delete budget",
            message: "Delete this budget? Future spend will no longer be compared to this cap.",
            proceedLabel: "Delete",
            cancelLabel: "Cancel",
            variant: "danger",
          });
          if (!ok) return;
          state.budgets = state.budgets.filter((b) => b.id !== id);
          save();
          renderBudgets();
          renderDashboard();
          toast("Budget removed");
        })();
      }
    };
  }

  function renderSettings() {
    $("#set-book").value = state.settings.bookCurrency || "USD";
    const fx = $("#fx-fields");
    fx.innerHTML = "";
    Object.keys(state.settings.ratesFromUSD || {}).forEach((code) => {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `
        <label class="field-label" for="fx-${code}">${escapeHtml(code)} per 1 USD</label>
        <input type="number" class="input" id="fx-${code}" step="0.01" min="0.01" value="${roundUsdRate(state.settings.ratesFromUSD[code])}" />`;
      fx.appendChild(wrap);
    });
    ensureAuthListener();
    void renderCloudControls();
    updateFxAuditUi();
  }

  function refreshAllViews() {
    renderDashboard();
    renderLedger();
    renderProjects();
    renderAssets();
    renderBudgets();
    renderSettings();
    if (selectedProjectId && $("#view-project-detail")?.classList.contains("active")) renderProjectDetail();
    if (selectedItemId && $("#view-asset-detail")?.classList.contains("active")) renderAssetDetail();
  }

  function updateThemeToggleIcon() {
    const el = $("#theme-toggle-icon");
    const t = document.documentElement.getAttribute("data-theme");
    if (el) el.textContent = t === "light" ? "☀" : "☾";
  }

  function updateCloudSetupUi() {
    const Sync = window.PFTSync;
    const conn = Sync ? Sync.getConnection() : {};
    const configured = !!(conn.url && conn.key);
    const embedded =
      Sync && Sync.hasEmbeddedSupabaseConfig && Sync.hasEmbeddedSupabaseConfig();
    const hideSetupHelp = configured || embedded;
    const hint = $("#cloud-setup-hint");
    const setupActions = $("#cloud-setup-actions");
    if (hint) hint.hidden = hideSetupHelp;
    if (setupActions) setupActions.hidden = hideSetupHelp;
    /* Keep Sign in / Create account / Google always clickable — disabled controls felt “broken”; handlers show toasts instead. */
  }

  function cloudClientOrToast() {
    const Sync = window.PFTSync;
    if (!Sync) {
      toast("Sync module missing. Reload the page.");
      return null;
    }
    const sb = Sync.getClient();
    if (sb) return sb;
    const embedded =
      Sync.hasEmbeddedSupabaseConfig && Sync.hasEmbeddedSupabaseConfig();
    if (Sync.isConfigured && Sync.isConfigured()) {
      toast(
        embedded
          ? "Cloud client didn’t start. Reload the page or check your Supabase URL/key in the build."
          : "URL/key are saved but the client didn’t start. Reload or re-save on Setup."
      );
      return null;
    }
    const supa = typeof window !== "undefined" ? window.supabase : null;
    if (!supa || typeof supa.createClient !== "function") {
      toast("Supabase script did not load. Check your network and reload.");
      return null;
    }
    toast(
      "Cloud sign-in isn’t configured for this copy of the app. Use Open Setup (or sync.html on the same site), save URL + anon key, then press F5 — or deploy with env vars (see .env.example)."
    );
    return null;
  }

  async function renderCloudControls() {
    const signin = $("#btn-cloud-signin");
    const signout = $("#btn-cloud-signout");
    const syncBtn = $("#btn-cloud-sync");
    const retrieveBtn = $("#btn-cloud-retrieve");
    const emailEl = $("#cloud-account-email");
    if (!signin || !syncBtn) return;
    const Sync = window.PFTSync;
    if (!Sync) {
      signin.hidden = false;
      signin.disabled = false;
      if (signout) signout.hidden = true;
      if (emailEl) emailEl.textContent = "";
      updateCloudSetupUi();
      return;
    }
    const { url, key } = Sync.getConnection();
    const configured = !!(url && key);
    const { session } = await Sync.getSession();
    const signedIn = !!(session && session.user);
    signin.hidden = signedIn;
    if (signout) signout.hidden = !signedIn;
    if (emailEl) emailEl.textContent = signedIn && session.user.email ? session.user.email : "";
    signin.disabled = false;
    syncBtn.disabled = !configured;
    if (retrieveBtn) retrieveBtn.disabled = !configured;
    if (signout) signout.disabled = !signedIn;
    updateCloudSetupUi();
  }

  async function cloudPushNow() {
    const Sync = window.PFTSync;
    if (!Sync || !Sync.getClient()) {
      const emb = Sync && Sync.hasEmbeddedSupabaseConfig && Sync.hasEmbeddedSupabaseConfig();
      toast(
        emb
          ? "Cloud sync couldn’t start. Refresh the page or check the deployment build."
          : "Cloud isn’t configured: use Setup in Sign in, or set SUPABASE_URL / SUPABASE_ANON_KEY and run npm run build."
      );
      return false;
    }
    try {
      const { data: u } = await Sync.getClient().auth.getUser();
      if (!u || !u.user) {
        toast("Sign in first.");
        return false;
      }
      await Sync.pushState(state);
      if (!state._meta) state._meta = {};
      state._meta.lastRemoteUpdated = new Date().toISOString();
      St.save(state);
      toast("Saved to cloud");
      return true;
    } catch (e) {
      toast(e.message || "Sync failed");
      return false;
    }
  }

  async function cloudPullNow() {
    const Sync = window.PFTSync;
    if (!Sync || !Sync.getClient()) {
      const emb = Sync && Sync.hasEmbeddedSupabaseConfig && Sync.hasEmbeddedSupabaseConfig();
      toast(
        emb
          ? "Cloud sync couldn’t start. Refresh the page or check the deployment build."
          : "Cloud isn’t configured: use Setup in Sign in, or set SUPABASE_URL / SUPABASE_ANON_KEY and run npm run build."
      );
      return false;
    }
    try {
      const { data: u } = await Sync.getClient().auth.getUser();
      if (!u || !u.user) {
        toast("Sign in first, then retrieve your backup.");
        return false;
      }
      if (typeof Sync.executeRetrieve !== "function") {
        toast("Sync module is outdated. Reload the app.");
        return false;
      }
      const result = await Sync.executeRetrieve(
        (ctx) => {
          const C = window.PFTCloudConflict;
          if (C && typeof C.prompt === "function") return C.prompt(ctx.updatedAt);
          return Promise.resolve(
            window.confirm(
              "This device and the cloud both have data. OK = use cloud only (replace this device). Cancel = keep this device (no merge in this fallback)."
            )
              ? "replace"
              : "keep"
          );
        },
        { localSnapshot: state }
      );
      state = St.load();
      initPresetsUi();
      updateFxAuditUi();
      refreshAllViews();
      switch (result.outcome) {
        case "replaced":
          toast("Retrieved data from cloud");
          break;
        case "merged":
          toast("Merged local and cloud data");
          break;
        case "no_backup":
          toast("No cloud backup found yet. On a device that has your data, use Save to cloud first.");
          break;
        case "no_cloud_data":
          toast("Cloud backup is empty. This device still has your local data.");
          break;
        case "cancelled":
          toast("Kept this device’s data");
          break;
        default:
          break;
      }
      return true;
    } catch (e) {
      toast(e.message || "Retrieve failed");
      return false;
    }
  }

  function ensureAuthListener() {
    const Sync = window.PFTSync;
    if (!Sync || authUnsubscribe) return;
    if (!Sync.getClient()) return;
    const { data } = Sync.onAuthChange((event, session) => {
      void renderCloudControls();
      if (event === "SIGNED_IN" && session && session.user) {
        toast("Signed in — use Retrieve from cloud on a new device, or Save to cloud to upload.");
      }
      if (event === "SIGNED_OUT") {
        toast("Signed out");
        clearTimeout(cloudSyncTimer);
      }
    });
    const sub = data && data.subscription;
    if (sub && typeof sub.unsubscribe === "function") {
      authUnsubscribe = () => sub.unsubscribe();
    }
  }

  function openTransactionModal(existingId, defaults) {
    bindProjectsAndItemsSelects();
    $("#mt-title").textContent = existingId ? "Edit transaction" : "New transaction";
    $("#form-transaction").reset();
    $("#tx-id").value = existingId || "";
    $("#tx-date").value = todayISODate();
    $("#tx-currency").value = state.settings.bookCurrency || "USD";
    updateTxCategoryDatalist();
    renderTxTemplates();

    if (defaults) {
      if (defaults.type) $("#tx-type").value = defaults.type;
      if (defaults.projectId) $("#tx-project").value = defaults.projectId;
      if (defaults.itemId) $("#tx-item").value = defaults.itemId;
      updateTxCategoryDatalist();
      renderTxTemplates();
    }

    if (existingId) {
      const t = state.transactions.find((x) => x.id === existingId);
      if (t) {
        $("#tx-type").value = t.type;
        $("#tx-date").value = t.date || todayISODate();
        $("#tx-amount").value = String(t.originalAmount != null ? t.originalAmount : t.amountBook);
        $("#tx-currency").value = t.originalCurrency || state.settings.bookCurrency;
        $("#tx-category").value = t.category || "";
        $("#tx-project").value = t.projectId || "";
        $("#tx-item").value = t.itemId || "";
        $("#tx-vendor").value = t.vendor || "";
        $("#tx-payment").value = t.paymentMethod || "";
        $("#tx-recurring").value = t.recurring || "";
        $("#tx-next-due").value = t.nextDueDate || "";
        $("#tx-desc").value = t.description || "";
        $("#tx-tags").value = (t.tags || []).join(", ");
        updateTxCategoryDatalist();
        renderTxTemplates();
      }
    }
    openModal("#modal-transaction");
  }

  function openProjectModal(existingId) {
    $("#mp-title").textContent = existingId ? "Edit project" : "New project";
    $("#form-project").reset();
    $("#pj-id").value = existingId || "";
    if (existingId) {
      const p = projectById(existingId);
      if (p) {
        $("#pj-name").value = p.name;
        $("#pj-desc").value = p.description || "";
        $("#pj-lifecycle").value = p.lifecycle || "in_progress";
        $("#pj-target").value = String(p.targetMonthlyProfit ?? 0);
        $("#pj-est-cost").value = String(p.estimatedCost ?? 0);
        $("#pj-est-end").value = p.estimatedEndDate || "";
        $("#pj-tags").value = (p.tags || []).join(", ");
      }
    } else {
      $("#pj-lifecycle").value = "in_progress";
      $("#pj-target").value = "0";
      $("#pj-est-cost").value = "0";
      $("#pj-est-end").value = "";
    }
    openModal("#modal-project");
  }

  function openAssetModal(existingId) {
    $("#ma-title").textContent = existingId ? "Edit asset" : "New asset";
    $("#form-asset").reset();
    $("#as-id").value = existingId || "";
    $("#as-pdate").value = todayISODate();
    if (existingId) {
      const it = itemById(existingId);
      if (it) {
        $("#as-name").value = it.name;
        $("#as-cat").value = it.category || "";
        $("#as-price").value = String(it.purchasePrice ?? 0);
        $("#as-pdate").value = it.purchaseDate || todayISODate();
        $("#as-life").value = String(it.expectedLifespanYears ?? 5);
        $("#as-status").value = it.status || "active";
        $("#as-health").value = String(it.healthBenefitPerUse ?? 0);
        $("#as-time").value = String(it.timeSavingsPerUse ?? 0);
        $("#as-enjoy").value = String(it.enjoymentValuePerUse ?? 0);
        $("#as-notes").value = it.notes || "";
      }
    }
    openModal("#modal-asset");
  }

  function openUsageModal(itemId, existingId) {
    $("#form-usage").reset();
    $("#us-item").value = itemId;
    $("#us-id").value = existingId || "";
    $("#us-date").value = todayISODate();
    if (existingId) {
      const u = state.usageLogs.find((x) => x.id === existingId);
      if (u) {
        $("#us-date").value = u.usageDate || todayISODate();
        $("#us-dur").value = String(u.durationMinutes ?? 0);
        $("#us-km").value = String(u.distanceKm ?? 0);
        $("#us-val").value = String(u.valueGenerated ?? 0);
        $("#us-notes").value = u.notes || "";
      }
    }
    openModal("#modal-usage");
  }

  function openBudgetModal(existingId) {
    bindProjectsAndItemsSelects();
    $("#form-budget").reset();
    $("#bd-id").value = existingId || "";
    if (existingId) {
      const b = state.budgets.find((x) => x.id === existingId);
      if (b) {
        $("#bd-project").value = b.projectId || "";
        $("#bd-cat").value = b.category || "";
        $("#bd-limit").value = String(b.monthlyLimit ?? 0);
        $("#bd-notes").value = b.notes || "";
      }
    }
    openModal("#modal-budget");
  }

  async function deleteProjectConfirmed() {
    const id = selectedProjectId;
    if (!id) return;
    const ok = await warningConfirm({
      title: "Delete project",
      message:
        "Delete this project and all linked transactions and budgets in this browser? This cannot be undone.",
      proceedLabel: "Delete project",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    state.transactions = state.transactions.filter((t) => t.projectId !== id);
    state.budgets = state.budgets.filter((b) => b.projectId !== id);
    state.projects = state.projects.filter((p) => p.id !== id);
    save();
    toast("Project deleted");
    selectedProjectId = null;
    navigate("projects");
  }

  async function deleteAssetConfirmed() {
    const id = selectedItemId;
    if (!id) return;
    const ok = await warningConfirm({
      title: "Delete asset",
      message: "Delete this asset and its linked expenses and usage logs? This cannot be undone.",
      proceedLabel: "Delete asset",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    state.transactions = state.transactions.filter((t) => t.itemId !== id);
    state.usageLogs = state.usageLogs.filter((u) => u.itemId !== id);
    state.personalItems = state.personalItems.filter((i) => i.id !== id);
    save();
    toast("Asset deleted");
    selectedItemId = null;
    navigate("assets");
  }

  function wireEvents() {
    $("#menu-toggle").addEventListener("click", () => {
      if (isMobileNav()) toggleDrawer();
    });
    $("#drawer-backdrop").addEventListener("click", closeDrawer);

    $("#theme-toggle").addEventListener("click", () => {
      if (window.PFTTheme) window.PFTTheme.toggle();
    });
    $("#header-book-cur")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("#header-currency-menu");
      setCurrencyMenuOpen(!(menu && menu.classList.contains("open")));
    });
    $("#header-currency-menu")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-currency]");
      if (!btn) return;
      const code = btn.getAttribute("data-currency");
      if (!code) return;
      const prevBook = state.settings.bookCurrency || "USD";
      if (code === prevBook) {
        setCurrencyMenuOpen(false);
        return;
      }
      state.settings.bookCurrency = code;
      revalueAllBookAmounts(prevBook, code);
      recordFxAudit(`Book currency set to ${code}`);
      $("#set-book").value = code;
      save();
      renderHeaderCurrency(code);
      renderHeaderCurrencyMenu();
      setCurrencyMenuOpen(false);
      toast(`Switched to ${code} — amounts converted using your FX rates.`);
      refreshAllViews();
    });
    document.addEventListener("click", (e) => {
      const wrap = e.target.closest(".header-currency-wrap");
      if (!wrap) setCurrencyMenuOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setCurrencyMenuOpen(false);
    });

    $("#main-nav").addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-pill");
      if (!btn) return;
      selectedProjectId = null;
      selectedItemId = null;
      navigate(btn.dataset.view);
    });

    $("#btn-quick-expense").addEventListener("click", () => openTransactionModal(null, { type: "expense" }));
    $("#btn-quick-income").addEventListener("click", () => openTransactionModal(null, { type: "income" }));

    $("#btn-new-project").addEventListener("click", () => openProjectModal(null));
    $("#project-sort")?.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "name" || v === "created" || v === "updated" || v === "status") {
        setProjectSort(v);
        renderProjects();
      }
    });
    $("#btn-new-asset").addEventListener("click", () => openAssetModal(null));
    $("#btn-new-budget").addEventListener("click", () => openBudgetModal(null));

    $("#btn-back-projects").addEventListener("click", () => navigate("projects"));
    $("#btn-back-assets").addEventListener("click", () => navigate("assets"));

    $("#detail-add-income").addEventListener("click", () =>
      openTransactionModal(null, { type: "income", projectId: selectedProjectId })
    );
    $("#detail-add-expense").addEventListener("click", () =>
      openTransactionModal(null, { type: "expense", projectId: selectedProjectId })
    );
    $("#btn-edit-project").addEventListener("click", () => openProjectModal(selectedProjectId));
    $("#btn-delete-project").addEventListener("click", () => void deleteProjectConfirmed());

    $("#detail-log-usage").addEventListener("click", () => openUsageModal(selectedItemId, null));
    $("#detail-asset-expense").addEventListener("click", () =>
      openTransactionModal(null, { type: "expense", itemId: selectedItemId })
    );
    $("#btn-edit-asset").addEventListener("click", () => openAssetModal(selectedItemId));
    $("#btn-delete-asset").addEventListener("click", () => void deleteAssetConfirmed());

    $("#tx-type").addEventListener("change", () => {
      updateTxCategoryDatalist();
      renderTxTemplates();
    });

    $$("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModals));
    $$(".modal-overlay").forEach((ov) =>
      ov.addEventListener("click", (e) => {
        if (ov.id === "modal-warning-confirm") return;
        if (e.target === ov) closeModals();
      })
    );

    $("#form-transaction").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#tx-id").value;
      const type = $("#tx-type").value;
      const amountRaw = parseFloat($("#tx-amount").value);
      if (Number.isNaN(amountRaw) || amountRaw < 0) {
        toast("Enter a valid amount");
        return;
      }
      const cur = $("#tx-currency").value;
      const amountBook = roundMoney(toBook(amountRaw, cur));
      const tags = ($("#tx-tags").value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const rec = $("#tx-recurring").value;
      let nextDue = $("#tx-next-due").value || "";
      if (rec && !nextDue) {
        const base = $("#tx-date").value || todayISODate();
        if (rec === "weekly") nextDue = addWeeks(base, 1);
        else if (rec === "monthly") nextDue = addMonths(base, 1);
        else if (rec === "quarterly") nextDue = addMonths(base, 3);
        else if (rec === "yearly") nextDue = addYears(base, 1);
      }

      const payload = {
        id: id || St.uid(),
        projectId: $("#tx-project").value || null,
        itemId: $("#tx-item").value || null,
        amountBook,
        originalAmount: amountRaw,
        originalCurrency: cur,
        category: $("#tx-category").value.trim(),
        description: $("#tx-desc").value.trim(),
        vendor: $("#tx-vendor").value.trim(),
        paymentMethod: $("#tx-payment").value || "",
        type,
        date: $("#tx-date").value,
        recurring: rec || "",
        nextDueDate: rec ? nextDue : "",
        tags,
      };

      if (!payload.projectId) payload.projectId = null;
      if (!payload.itemId) payload.itemId = null;
      if (!(await confirmExpenseBudgetImpact(payload, id || null))) {
        toast("Expense canceled");
        return;
      }

      if (id) {
        const idx = state.transactions.findIndex((t) => t.id === id);
        if (idx >= 0) state.transactions[idx] = { ...state.transactions[idx], ...payload };
      } else state.transactions.push(payload);
      save();
      closeModals();
      toast("Transaction saved");
      renderDashboard();
      renderLedger();
      renderBudgets();
      if ($("#view-project-detail").classList.contains("active")) renderProjectDetail();
      if ($("#view-asset-detail").classList.contains("active")) renderAssetDetail();
    });

    $("#form-project").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("#pj-id").value;
      const tags = ($("#pj-tags").value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const lifecycle = $("#pj-lifecycle").value || "in_progress";
      const now = new Date().toISOString();
      const row = {
        id: id || St.uid(),
        name: $("#pj-name").value.trim(),
        description: $("#pj-desc").value.trim(),
        lifecycle,
        status: lifecycle,
        targetMonthlyProfit: parseFloat($("#pj-target").value) || 0,
        estimatedCost: parseFloat($("#pj-est-cost").value) || 0,
        estimatedEndDate: $("#pj-est-end").value || "",
        tags,
      };
      if (id) {
        const idx = state.projects.findIndex((p) => p.id === id);
        if (idx >= 0) {
          const prev = state.projects[idx];
          state.projects[idx] = { ...prev, ...row, updatedAt: now };
          if (!state.projects[idx].createdAt) state.projects[idx].createdAt = prev.createdAt || now;
        }
      } else {
        state.projects.push({ ...row, createdAt: now, updatedAt: now });
      }
      save();
      closeModals();
      toast("Project saved");
      renderProjects();
      renderDashboard();
      if ($("#view-project-detail").classList.contains("active")) renderProjectDetail();
    });

    $("#form-asset").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("#as-id").value;
      const row = {
        id: id || St.uid(),
        name: $("#as-name").value.trim(),
        category: $("#as-cat").value.trim(),
        purchasePrice: parseFloat($("#as-price").value) || 0,
        purchaseDate: $("#as-pdate").value,
        expectedLifespanYears: parseInt($("#as-life").value, 10) || 5,
        status: $("#as-status").value,
        healthBenefitPerUse: parseFloat($("#as-health").value) || 0,
        timeSavingsPerUse: parseFloat($("#as-time").value) || 0,
        enjoymentValuePerUse: parseFloat($("#as-enjoy").value) || 0,
        notes: $("#as-notes").value.trim(),
      };
      if (id) {
        const idx = state.personalItems.findIndex((i) => i.id === id);
        if (idx >= 0) state.personalItems[idx] = { ...state.personalItems[idx], ...row };
      } else state.personalItems.push(row);
      save();
      closeModals();
      toast("Asset saved");
      renderAssets();
      renderDashboard();
      if ($("#view-asset-detail").classList.contains("active")) renderAssetDetail();
    });

    $("#form-usage").addEventListener("submit", (e) => {
      e.preventDefault();
      const itemId = $("#us-item").value;
      const uid = $("#us-id").value;
      const row = {
        id: uid || St.uid(),
        itemId,
        usageDate: $("#us-date").value,
        durationMinutes: parseInt($("#us-dur").value, 10) || 0,
        distanceKm: parseFloat($("#us-km").value) || 0,
        valueGenerated: parseFloat($("#us-val").value) || 0,
        notes: $("#us-notes").value.trim(),
      };
      if (uid) {
        const ix = state.usageLogs.findIndex((u) => u.id === uid);
        if (ix >= 0) state.usageLogs[ix] = { ...state.usageLogs[ix], ...row };
        else state.usageLogs.push(row);
      } else state.usageLogs.push(row);
      save();
      closeModals();
      toast(uid ? "Usage updated" : "Usage logged");
      renderAssetDetail();
    });

    $("#form-budget").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("#bd-id").value;
      const now = new Date().toISOString();
      const row = {
        id: id || St.uid(),
        projectId: $("#bd-project").value || null,
        category: $("#bd-cat").value.trim(),
        monthlyLimit: parseFloat($("#bd-limit").value) || 0,
        notes: $("#bd-notes").value.trim(),
      };
      if (id) {
        const idx = state.budgets.findIndex((b) => b.id === id);
        if (idx >= 0) {
          const prev = state.budgets[idx];
          state.budgets[idx] = {
            ...prev,
            ...row,
            updatedAt: now,
            createdAt: prev.createdAt || now,
          };
        }
      } else {
        state.budgets.push({ ...row, createdAt: now, updatedAt: now });
      }
      save();
      closeModals();
      toast("Budget saved");
      renderBudgets();
      renderDashboard();
    });

    $$("#filter-type, #filter-project, #filter-from, #filter-to, #filter-search").forEach((el) =>
      el.addEventListener("input", renderLedger)
    );
    $$("#filter-type, #filter-project, #filter-from, #filter-to").forEach((el) =>
      el.addEventListener("change", renderLedger)
    );

    $("#ledger-export-csv").addEventListener("click", exportCsv);

    $("#btn-save-settings").addEventListener("click", () => {
      const prevBook = state.settings.bookCurrency || "USD";
      const newBook = $("#set-book").value || "USD";
      const r = { ...state.settings.ratesFromUSD };
      Object.keys(r).forEach((code) => {
        const inp = document.getElementById("fx-" + code);
        if (inp) {
          const v = parseFloat(inp.value);
          if (!Number.isNaN(v) && v > 0) r[code] = roundUsdRate(v);
        }
      });
      state.settings.ratesFromUSD = r;
      state.settings.bookCurrency = newBook;
      if (prevBook !== newBook) {
        revalueAllBookAmounts(prevBook, newBook);
        recordFxAudit(`Book currency set to ${newBook}`);
        toast("Settings saved — book currency changed; amounts converted using FX rates.");
      } else {
        recomputeTransactionAmountsFromOriginals();
        recordFxAudit("Manual FX rates saved; amounts refreshed from originals where available.");
        toast("Settings saved — transaction amounts refreshed from originals where available.");
      }
      save();
      refreshAllViews();
    });

    $("#btn-fx-live")?.addEventListener("click", async () => {
      const Fx = window.PFTFx;
      if (!Fx) {
        toast("FX module missing");
        return;
      }
      try {
        const codes = Object.keys(state.settings.ratesFromUSD || {});
        const live = await Fx.fetchRatesForCodes(codes);
        const next = { ...state.settings.ratesFromUSD };
        const skipped = [];
        Object.keys(next).forEach((c) => {
          if (c === "USD") next[c] = 1;
          else if (typeof live[c] === "number" && live[c] > 0) next[c] = roundUsdRate(live[c]);
          else if (c !== "USD") skipped.push(c);
        });
        state.settings.ratesFromUSD = next;
        recomputeTransactionAmountsFromOriginals();
        recordFxAudit(
          skipped.length
            ? `Live FX rates (no live value for: ${skipped.join(", ")})`
            : "Live FX rates applied"
        );
        save();
        renderSettings();
        toast(
          skipped.length
            ? `FX updated; no live value for: ${skipped.join(", ")}`
            : "FX rates updated from live data"
        );
        refreshAllViews();
      } catch (err) {
        toast(err.message || "Could not fetch rates");
      }
    });

    $("#btn-cloud-signin")?.addEventListener("click", () => {
      updateCloudSetupUi();
      openModal("#modal-cloud-auth");
    });

    $("#btn-cloud-sync")?.addEventListener("click", () => void cloudPushNow());
    $("#btn-cloud-retrieve")?.addEventListener("click", () => void cloudPullNow());

    $("#btn-cloud-signout")?.addEventListener("click", async () => {
      const Sync = window.PFTSync;
      if (!Sync || !Sync.getClient()) return;
      try {
        await Sync.signOut();
        void renderCloudControls();
      } catch (e) {
        toast(e.message || "Sign out failed");
      }
    });

    $("#form-cloud-auth")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = $("#form-cloud-auth");
      if (form && !form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (!cloudClientOrToast()) return;
      const Sync = window.PFTSync;
      try {
        await Sync.signIn($("#cloud-email").value.trim(), $("#cloud-password").value);
        $("#cloud-password").value = "";
        closeModals();
        await renderCloudControls();
      } catch (err) {
        toast(err.message || "Sign in failed");
      }
    });

    $("#btn-cloud-register")?.addEventListener("click", async () => {
      const email = ($("#cloud-email")?.value || "").trim();
      const password = $("#cloud-password")?.value || "";
      if (!email || !password) {
        toast("Enter email and password.");
        const form = $("#form-cloud-auth");
        if (form) form.reportValidity();
        return;
      }
      if (!cloudClientOrToast()) return;
      const Sync = window.PFTSync;
      try {
        const data = await Sync.signUp(email, password);
        if (data && data.session) {
          $("#cloud-password").value = "";
          closeModals();
          await renderCloudControls();
        } else {
          toast("Check your email to confirm your account, then sign in.");
        }
      } catch (err) {
        toast(err.message || "Sign up failed");
      }
    });

    $("#btn-cloud-google")?.addEventListener("click", async () => {
      if (!cloudClientOrToast()) return;
      const Sync = window.PFTSync;
      try {
        await Sync.signInWithGoogle();
      } catch (err) {
        try {
          sessionStorage.removeItem("pft_oauth_pending");
        } catch (_e) {
          /* ignore */
        }
        toast(err.message || "Google sign-in failed");
      }
    });

    $("#btn-export-json").addEventListener("click", () => {
      const blob = new Blob([St.exportJson(state)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pft-backup-${todayISODate()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Backup downloaded");
    });

    $("#btn-import-replace").addEventListener("click", () => {
      $("#file-import").dataset.mode = "replace";
      $("#file-import").click();
    });
    $("#btn-import-merge").addEventListener("click", () => {
      $("#file-import").dataset.mode = "merge";
      $("#file-import").click();
    });
    $("#file-import").addEventListener("change", (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      const mode = $("#file-import").dataset.mode === "merge";
      const reader = new FileReader();
      reader.onload = () => {
        try {
          state = St.importJson(String(reader.result), mode);
          initPresetsUi();
          toast(mode ? "Merged import" : "Replaced with import");
          navigate("dashboard");
        } catch (err) {
          toast("Import failed: " + (err.message || "invalid file"));
        }
        ev.target.value = "";
      };
      reader.readAsText(f);
    });

    $("#btn-reset-all").addEventListener("click", () => {
      void (async () => {
        const ok = await warningConfirm({
          title: "Erase all data",
          message:
            "Erase ALL projects, transactions, assets, and settings stored in this browser? This cannot be undone.",
          proceedLabel: "Erase everything",
          cancelLabel: "Cancel",
          variant: "danger",
        });
        if (!ok) return;
        localStorage.removeItem(St.STORAGE_KEY);
        state = St.load();
        if (!state._meta) state._meta = {};
        initPresetsUi();
        updateFxAuditUi();
        toast("Storage cleared");
        navigate("dashboard");
      })();
    });

    window.addEventListener("resize", () => {
      if (!isMobileNav()) closeDrawer();
      if ($("#view-dashboard").classList.contains("active")) drawProjectChart();
    });
  }

  function exportCsv() {
    const rows = [["date", "type", "amount_book", "category", "description", "project", "asset", "vendor", "tags"]];
    const sorted = [...state.transactions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    sorted.forEach((t) => {
      rows.push([
        t.date,
        t.type,
        String(t.amountBook),
        t.category,
        t.description,
        t.projectId ? projectById(t.projectId)?.name || "" : "",
        t.itemId ? itemById(t.itemId)?.name || "" : "",
        t.vendor || "",
        (t.tags || []).join(";"),
      ]);
    });
    const lines = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pft-ledger-${todayISODate()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("CSV exported");
  }

  function initialViewFromHash() {
    const h = (location.hash || "").replace(/^#/, "").toLowerCase();
    if (h === "settings" || h === "sync" || h === "supabase") return "settings";
    return "dashboard";
  }

  function boot() {
    const h = (location.hash || "").replace(/^#/, "").toLowerCase();
    const openCloudModal = h === "sync" || h === "supabase";
    if (openCloudModal) {
      history.replaceState(null, "", `${location.pathname}${location.search}#settings`);
    }

    window.PFTSync?.applyBootstrapEnv();

    if (window.PFTTheme) window.PFTTheme.init();
    updateThemeToggleIcon();
    window.addEventListener("pft-theme-change", () => {
      updateThemeToggleIcon();
      if ($("#view-dashboard").classList.contains("active")) drawProjectChart();
    });

    initPresetsUi();
    wireEvents();
    navigate(initialViewFromHash());
    updateFxAuditUi();
    if (openCloudModal) requestAnimationFrame(() => openModal("#modal-cloud-auth"));

    window.addEventListener("hashchange", () => {
      const nh = (location.hash || "").replace(/^#/, "").toLowerCase();
      if (nh === "sync" || nh === "supabase") {
        history.replaceState(null, "", `${location.pathname}${location.search}#settings`);
        navigate("settings");
        requestAnimationFrame(() => openModal("#modal-cloud-auth"));
        return;
      }
      navigate(nh === "settings" ? "settings" : "dashboard");
    });

    window.addEventListener("storage", (ev) => {
      if (ev.key === "pft_supabase_url" || ev.key === "pft_supabase_anon_key") {
        ensureAuthListener();
        void renderCloudControls();
        if ($("#modal-cloud-auth")?.classList.contains("open")) updateCloudSetupUi();
      }
    });

    window.addEventListener("focus", () => {
      void renderCloudControls();
      if ($("#modal-cloud-auth")?.classList.contains("open")) updateCloudSetupUi();
    });

    window.addEventListener("pageshow", (ev) => {
      if (ev.persisted) {
        void renderCloudControls();
        updateCloudSetupUi();
      }
    });

    const Sync = window.PFTSync;
    if (Sync) {
      Sync.restoreSession()
        .then(() => {
          ensureAuthListener();
          return Sync.getSession();
        })
        .then(async ({ session }) => {
          if (session) {
            try {
              if (sessionStorage.getItem("pft_oauth_pending")) {
                sessionStorage.removeItem("pft_oauth_pending");
              }
            } catch (_e) {
              try {
                sessionStorage.removeItem("pft_oauth_pending");
              } catch (_e2) {
                /* ignore */
              }
            }
          }
          void renderCloudControls();
        });
    }
  }

  boot();
})();
