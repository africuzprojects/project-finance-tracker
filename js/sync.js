/**
 * Supabase sync — optional cloud backup per authenticated user.
 * Requires: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> before this file.
 */
(function (global) {
  const URL_KEY = "pft_supabase_url";
  const ANON_KEY = "pft_supabase_anon_key";
  const AUTO_KEY = "pft_sync_auto";
  const LAST_PULL = "pft_sync_last_pull_iso";

  let client = null;
  let lastClientKey = "";

  /** Build-time keys (env.generated.js) take precedence so deploys never rely on localStorage Setup. */
  function getConnection() {
    const e = global.__PFT_ENV__ || {};
    const envUrl = String(e.supabaseUrl || "").trim();
    const envKey = String(e.supabaseAnonKey || "").trim();
    if (envUrl && envKey) return { url: envUrl, key: envKey };
    const url = (localStorage.getItem(URL_KEY) || "").trim();
    const key = (localStorage.getItem(ANON_KEY) || "").trim();
    return { url, key };
  }

  function hasEmbeddedSupabaseConfig() {
    const e = global.__PFT_ENV__ || {};
    return !!(String(e.supabaseUrl || "").trim() && String(e.supabaseAnonKey || "").trim());
  }

  function isConfigured() {
    const { url, key } = getConnection();
    return !!(url && key);
  }

  /** Persist build-time env once so session storage key is stable across loads */
  function applyBootstrapEnv() {
    const e = global.__PFT_ENV__ || {};
    const url = String(e.supabaseUrl || "").trim();
    const key = String(e.supabaseAnonKey || "").trim();
    if (!url || !key) return;
    const curUrl = (localStorage.getItem(URL_KEY) || "").trim();
    const curKey = (localStorage.getItem(ANON_KEY) || "").trim();
    if (!curUrl && !curKey) {
      saveConnection(url, key);
    }
  }

  function saveConnection(url, key) {
    localStorage.setItem(URL_KEY, (url || "").trim());
    localStorage.setItem(ANON_KEY, (key || "").trim());
    invalidate();
  }

  function invalidate() {
    client = null;
    lastClientKey = "";
  }

  function getClient() {
    const { url, key } = getConnection();
    if (!url || !key) return null;
    const supa = global.supabase;
    if (!supa || typeof supa.createClient !== "function") return null;
    const sig = url + "|" + key.slice(0, 12);
    if (client && lastClientKey === sig) return client;
    try {
      client = supa.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: global.localStorage,
          storageKey: "pft-supabase-auth-v1",
        },
      });
      lastClientKey = sig;
      return client;
    } catch (_e) {
      client = null;
      lastClientKey = "";
      return null;
    }
  }

  function isAutoSync() {
    return localStorage.getItem(AUTO_KEY) === "1";
  }

  function setAutoSync(on) {
    localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  }

  function payloadFromState(state) {
    const copy = JSON.parse(JSON.stringify(state));
    return copy;
  }

  function mergeRemoteIntoLocal(remotePayload) {
    const St = global.PFTStorage;
    if (!remotePayload || typeof remotePayload !== "object") return St.load();
    const merged = St.migrate ? St.migrate(remotePayload) : remotePayload;
    St.save(merged);
    return merged;
  }

  async function getSession() {
    const sb = getClient();
    if (!sb) return { session: null, error: new Error("Configure Supabase URL and anon key") };
    const { data, error } = await sb.auth.getSession();
    if (error) return { session: null, error };
    return { session: data.session, error: null };
  }

  async function signIn(email, password) {
    const sb = getClient();
    if (!sb) throw new Error("Missing Supabase client");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password) {
    const sb = getClient();
    if (!sb) throw new Error("Missing Supabase client");
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    await sb.auth.signOut();
  }

  /** OAuth redirect must match a URL allowed in Supabase Auth → URL configuration */
  function oauthRedirectUrl() {
    if (typeof window === "undefined") return "";
    const { origin, pathname, search } = window.location;
    return `${origin}${pathname}${search || ""}`.split("#")[0];
  }

  async function signInWithGoogle() {
    const sb = getClient();
    if (!sb) throw new Error("Sync is not available.");
    try {
      if (typeof window !== "undefined") window.sessionStorage.setItem("pft_oauth_pending", "1");
    } catch (_e) {
      /* ignore */
    }
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: oauthRedirectUrl() },
    });
    if (error) {
      try {
        if (typeof window !== "undefined") window.sessionStorage.removeItem("pft_oauth_pending");
      } catch (_e2) {
        /* ignore */
      }
      throw error;
    }
    return data;
  }

  async function pushState(state) {
    const sb = getClient();
    if (!sb) throw new Error("Missing Supabase client");
    const { data: u } = await sb.auth.getUser();
    const user = u && u.user;
    if (!user) throw new Error("Sign in to sync");

    const payload = payloadFromState(state);
    const now = new Date().toISOString();
    payload._meta = payload._meta || {};
    payload._meta.lastModified = now;

    const { error } = await sb.from("pft_user_data").upsert(
      { user_id: user.id, payload, updated_at: now },
      { onConflict: "user_id" }
    );
    if (error) throw error;
    return now;
  }

  async function fetchRemotePayload() {
    const sb = getClient();
    if (!sb) throw new Error("Missing Supabase client");
    const { data: u } = await sb.auth.getUser();
    const user = u && u.user;
    if (!user) throw new Error("Sign in to sync");

    const { data, error } = await sb
      .from("pft_user_data")
      .select("payload, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.payload == null || data.payload === undefined) {
      return { empty: true };
    }
    const St = global.PFTStorage;
    const migrated = St.migrate(JSON.parse(JSON.stringify(data.payload)));
    if (!St.isSubstantiveState(migrated)) {
      return { empty: true };
    }
    return { empty: false, payload: data.payload, updated_at: data.updated_at };
  }

  function applyRemotePayload(payload, updated_at) {
    if (updated_at) localStorage.setItem(LAST_PULL, updated_at);
    mergeRemoteIntoLocal(payload);
  }

  /**
   * Interactive retrieve: empty device replaces; both substantive calls chooseConflict({ updatedAt, payload, localSnapshot }).
   * chooseConflict must return Promise<'keep'|'replace'|'merge'>.
   * options.localSnapshot: optional in-memory state (main app); defaults to St.load().
   */
  async function executeRetrieve(chooseConflict, options) {
    if (typeof chooseConflict !== "function") {
      throw new Error("executeRetrieve requires chooseConflict callback");
    }
    const opts = options && typeof options === "object" ? options : {};
    const St = global.PFTStorage;
    const peek = await fetchRemotePayload();
    const local =
      opts.localSnapshot != null
        ? St.migrate(JSON.parse(JSON.stringify(opts.localSnapshot)))
        : St.load();

    if (peek.empty) {
      if (St.isSubstantiveState(local)) {
        return { outcome: "no_cloud_data" };
      }
      return { outcome: "no_backup" };
    }

    if (!St.isSubstantiveState(local)) {
      applyRemotePayload(peek.payload, peek.updated_at);
      return { outcome: "replaced" };
    }

    const choice = await chooseConflict({
      updatedAt: peek.updated_at || "",
      payload: peek.payload,
      localSnapshot: local,
    });

    if (choice === "keep" || !choice) {
      return { outcome: "cancelled" };
    }
    if (choice === "replace") {
      applyRemotePayload(peek.payload, peek.updated_at);
      return { outcome: "replaced" };
    }
    if (choice === "merge") {
      const remoteMigrated = St.migrate(JSON.parse(JSON.stringify(peek.payload)));
      const merged = St.mergeCloudStates(local, remoteMigrated);
      St.save(merged);
      if (peek.updated_at) localStorage.setItem(LAST_PULL, peek.updated_at);
      return { outcome: "merged", state: merged };
    }
    return { outcome: "cancelled" };
  }

  async function pullState() {
    const peek = await fetchRemotePayload();
    if (peek.empty) return { applied: false, reason: "empty" };
    applyRemotePayload(peek.payload, peek.updated_at);
    return { applied: true, updated_at: peek.updated_at };
  }

  async function restoreSession() {
    const sb = getClient();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session || null;
  }

  function onAuthChange(cb) {
    const sb = getClient();
    if (!sb) return { data: { subscription: { unsubscribe() {} } } };
    return sb.auth.onAuthStateChange((event, session) => cb(event, session));
  }

  global.PFTSync = {
    getConnection,
    hasEmbeddedSupabaseConfig,
    isConfigured,
    applyBootstrapEnv,
    saveConnection,
    invalidate,
    getClient,
    isAutoSync,
    setAutoSync,
    getSession,
    signIn,
    signUp,
    signOut,
    signInWithGoogle,
    pushState,
    pullState,
    fetchRemotePayload,
    applyRemotePayload,
    executeRetrieve,
    restoreSession,
    onAuthChange,
    LAST_PULL_KEY: LAST_PULL,
  };
})(typeof window !== "undefined" ? window : globalThis);
