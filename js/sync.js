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

  async function pullState() {
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
    if (!data || !data.payload) return { applied: false, reason: "empty" };
    localStorage.setItem(LAST_PULL, data.updated_at || "");
    mergeRemoteIntoLocal(data.payload);
    return { applied: true, updated_at: data.updated_at };
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
    restoreSession,
    onAuthChange,
    LAST_PULL_KEY: LAST_PULL,
  };
})(typeof window !== "undefined" ? window : globalThis);
