/**
 * localStorage persistence with schema versioning and export/import.
 */
(function (global) {
  const STORAGE_KEY = "pft_data_v2";

  function defaultState() {
    return {
      version: 2,
      _meta: {
        lastModified: null,
        lastRemoteUpdated: null,
      },
      settings: {
        bookCurrency: "USD",
        /** Units of `code` per 1 USD (e.g. ZAR ~17 — refresh live rates for current values) */
        ratesFromUSD: { USD: 1, ZAR: 17, EUR: 0.92, GBP: 0.79 },
        fiscalYearStartMonth: 1,
        defaultProjectId: null,
      },
      projects: [],
      personalItems: [],
      transactions: [],
      usageLogs: [],
      budgets: [],
    };
  }

  function uid() {
    return "id_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return defaultState();
      return migrate(data);
    } catch {
      return defaultState();
    }
  }

  function save(state) {
    state.version = 2;
    if (!state._meta || typeof state._meta !== "object") state._meta = {};
    state._meta.lastModified = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function migrate(data) {
    const base = defaultState();
    const out = {
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings || {}) },
      _meta: { ...base._meta, ...(data._meta || {}) },
    };
    if (!out.settings.ratesFromUSD) out.settings.ratesFromUSD = { ...base.settings.ratesFromUSD };
    Object.keys(out.settings.ratesFromUSD).forEach((code) => {
      const v = out.settings.ratesFromUSD[code];
      if (code === "USD") out.settings.ratesFromUSD.USD = 1;
      else if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        out.settings.ratesFromUSD[code] = Math.round(v * 100) / 100;
      }
    });
    ["projects", "personalItems", "transactions", "usageLogs", "budgets"].forEach((k) => {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    out.projects = out.projects.map(normalizeProjectRow);
    out.budgets = (out.budgets || []).map(normalizeBudgetRow);
    return out;
  }

  function normalizeBudgetRow(b) {
    if (!b || typeof b !== "object") return b;
    const o = { ...b };
    if (o.createdAt == null) o.createdAt = "";
    if (o.updatedAt == null) o.updatedAt = o.createdAt || "";
    return o;
  }

  function normalizeProjectRow(p) {
    if (!p || typeof p !== "object") return p;
    const o = { ...p };
    if (o.createdAt == null) o.createdAt = "";
    if (o.updatedAt == null) o.updatedAt = o.createdAt || "";
    if (!o.lifecycle) {
      const s = o.status || "active";
      if (s === "paused") o.lifecycle = "on_hold";
      else if (s === "completed") o.lifecycle = "completed";
      else if (s === "archived") o.lifecycle = "archived";
      else o.lifecycle = "in_progress";
    }
    o.status = o.lifecycle;
    if (o.estimatedCost == null || Number.isNaN(Number(o.estimatedCost))) o.estimatedCost = 0;
    if (o.estimatedEndDate == null) o.estimatedEndDate = "";
    return o;
  }

  function exportJson(state) {
    return JSON.stringify(state, null, 2);
  }

  function compareRowRecency(a, b) {
    const t = (row) => String(row.updatedAt || row.createdAt || row.date || row.usageDate || "").trim();
    const ta = t(a);
    const tb = t(b);
    if (ta !== tb) return ta < tb ? -1 : ta > tb ? 1 : 0;
    return 0;
  }

  function pickNewerRow(localRow, remoteRow) {
    const c = compareRowRecency(localRow, remoteRow);
    if (c > 0) return localRow;
    if (c < 0) return remoteRow;
    return localRow;
  }

  function mergeIdArrays(localArr, remoteArr) {
    const map = new Map();
    for (const row of localArr || []) {
      if (row && row.id) map.set(row.id, row);
    }
    for (const row of remoteArr || []) {
      if (!row || !row.id) continue;
      const ex = map.get(row.id);
      if (!ex) map.set(row.id, row);
      else map.set(row.id, pickNewerRow(ex, row));
    }
    return Array.from(map.values());
  }

  function mergeSettings(localSettings, remoteSettings) {
    const lr = { ...(localSettings && localSettings.ratesFromUSD) };
    const rr = { ...(remoteSettings && remoteSettings.ratesFromUSD) };
    const rates = { ...rr, ...lr };
    rates.USD = 1;
    const defS = defaultState().settings;
    const lp = localSettings && localSettings.defaultProjectId;
    const rp = remoteSettings && remoteSettings.defaultProjectId;
    return {
      bookCurrency: (localSettings && localSettings.bookCurrency) || (remoteSettings && remoteSettings.bookCurrency) || defS.bookCurrency,
      fiscalYearStartMonth:
        localSettings && localSettings.fiscalYearStartMonth != null
          ? localSettings.fiscalYearStartMonth
          : remoteSettings && remoteSettings.fiscalYearStartMonth != null
            ? remoteSettings.fiscalYearStartMonth
            : defS.fiscalYearStartMonth,
      defaultProjectId: lp != null && lp !== "" ? lp : rp != null && rp !== "" ? rp : null,
      ratesFromUSD: rates,
    };
  }

  function isSubstantiveState(state) {
    if (!state || typeof state !== "object") return false;
    const hasRows =
      (Array.isArray(state.projects) && state.projects.length > 0) ||
      (Array.isArray(state.personalItems) && state.personalItems.length > 0) ||
      (Array.isArray(state.transactions) && state.transactions.length > 0) ||
      (Array.isArray(state.usageLogs) && state.usageLogs.length > 0) ||
      (Array.isArray(state.budgets) && state.budgets.length > 0);
    if (hasRows) return true;
    const def = defaultState();
    const s = state.settings || {};
    if (s.bookCurrency && s.bookCurrency !== def.settings.bookCurrency) return true;
    if (s.defaultProjectId != null && s.defaultProjectId !== "") return true;
    if (s.fiscalYearStartMonth != null && Number(s.fiscalYearStartMonth) !== def.settings.fiscalYearStartMonth) return true;
    return false;
  }

  function mergeCloudStates(localState, remoteState) {
    const L = migrate(JSON.parse(JSON.stringify(localState)));
    const R = migrate(JSON.parse(JSON.stringify(remoteState)));
    const baseMeta = defaultState()._meta;
    const out = {
      version: 2,
      settings: mergeSettings(L.settings, R.settings),
      projects: mergeIdArrays(L.projects, R.projects).map(normalizeProjectRow),
      personalItems: mergeIdArrays(L.personalItems, R.personalItems),
      transactions: mergeIdArrays(L.transactions, R.transactions),
      usageLogs: mergeIdArrays(L.usageLogs, R.usageLogs),
      budgets: mergeIdArrays(L.budgets, R.budgets).map(normalizeBudgetRow),
      _meta: {
        ...baseMeta,
        ...(R._meta || {}),
        ...(L._meta || {}),
        lastModified: new Date().toISOString(),
      },
    };
    return migrate(out);
  }

  function importJson(text, merge) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid file");
    if (!merge) {
      const fresh = migrate(parsed);
      save(fresh);
      return fresh;
    }
    const current = load();
    const incoming = migrate(parsed);
    const idMapProj = {};
    const idMapItem = {};
    incoming.projects.forEach((p) => {
      const nid = uid();
      idMapProj[p.id] = nid;
      current.projects.push({ ...p, id: nid });
    });
    incoming.personalItems.forEach((it) => {
      const nid = uid();
      idMapItem[it.id] = nid;
      current.personalItems.push({ ...it, id: nid });
    });
    incoming.transactions.forEach((t) => {
      current.transactions.push({
        ...t,
        id: uid(),
        projectId: t.projectId ? idMapProj[t.projectId] || null : null,
        itemId: t.itemId ? idMapItem[t.itemId] || null : null,
      });
    });
    incoming.usageLogs.forEach((u) => {
      current.usageLogs.push({
        ...u,
        id: uid(),
        itemId: idMapItem[u.itemId] || u.itemId,
      });
    });
    (incoming.budgets || []).forEach((b) => {
      current.budgets.push({
        ...b,
        id: uid(),
        projectId: b.projectId ? idMapProj[b.projectId] || null : null,
      });
    });
    save(current);
    return current;
  }

  global.PFTStorage = {
    STORAGE_KEY,
    defaultState,
    load,
    save,
    uid,
    exportJson,
    importJson,
    migrate,
    isSubstantiveState,
    mergeCloudStates,
  };
})(typeof window !== "undefined" ? window : globalThis);
