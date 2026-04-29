/**
 * Standalone cloud sync page (sync.html).
 */
(function () {
  const St = window.PFTStorage;
  const Sync = window.PFTSync;
  const $ = (s) => document.querySelector(s);

  function toast(msg) {
    const host = $("#toasts");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function updateThemeIcon() {
    const el = $("#theme-toggle-icon");
    const t = document.documentElement.getAttribute("data-theme");
    if (el) el.textContent = t === "light" ? "☀" : "☾";
  }

  async function renderStatus() {
    const statusEl = $("#sync-status");
    const urlEl = $("#sync-url");
    const anonEl = $("#sync-anon");
    const autoEl = $("#sync-auto");
    const connPanel = $("#sync-conn-panel");
    const embeddedNote = $("#sync-embedded-note");
    if (!statusEl) return;

    Sync.applyBootstrapEnv();

    const embedded = Sync.hasEmbeddedSupabaseConfig && Sync.hasEmbeddedSupabaseConfig();
    if (connPanel) connPanel.hidden = !!embedded;
    if (embeddedNote) embeddedNote.hidden = !embedded;

    const c = Sync.getConnection();
    if (urlEl && !embedded) urlEl.value = c.url || "";
    if (anonEl && !embedded) {
      if (!anonEl.value && c.key) anonEl.placeholder = "•••• key saved (enter new to replace)";
      else if (!c.key) anonEl.placeholder = "eyJ…";
    }

    if (autoEl) autoEl.checked = Sync.isAutoSync();
    const openEl = $("#sync-auto-open");
    if (openEl) openEl.checked = Sync.isAutoOpen && Sync.isAutoOpen();

    const client = Sync.getClient();
    if (!client) {
      statusEl.textContent = embedded
        ? "Waiting for Supabase client — try refreshing. If this persists, check the deployment build."
        : "Paste project URL + anon key above, then Save connection — or deploy with SUPABASE_URL / SUPABASE_ANON_KEY and npm run build.";
      return;
    }

    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const sess = data.session;
      if (!sess) {
        statusEl.textContent = "Not signed in — session will persist after you sign in (same device).";
        return;
      }
      const email = sess.user?.email || sess.user?.id || "user";
      statusEl.textContent = "Signed in as " + email + ". Open the main app — no sign-in screen.";
    } catch (e) {
      statusEl.textContent = (e && e.message) || "Session error.";
    }
  }

  function boot() {
    if (window.PFTTheme) window.PFTTheme.init();
    updateThemeIcon();
    $("#theme-toggle")?.addEventListener("click", () => {
      window.PFTTheme?.toggle();
    });
    window.addEventListener("pft-theme-change", updateThemeIcon);

    Sync.applyBootstrapEnv();

    $("#btn-sync-save-conn")?.addEventListener("click", () => {
      const url = $("#sync-url").value.trim();
      const key = $("#sync-anon").value.trim();
      if (!url || !key) {
        toast("Enter both URL and anon key");
        return;
      }
      Sync.saveConnection(url, key);
      $("#sync-anon").value = "";
      toast("Saved. Open the main app from the same site (same http://host:port) and refresh (F5).");
      renderStatus();
    });

    $("#btn-sync-signin")?.addEventListener("click", async () => {
      if (!Sync.getClient()) {
        toast("Save connection first");
        return;
      }
      try {
        await Sync.signIn($("#sync-email").value.trim(), $("#sync-password").value);
        $("#sync-password").value = "";
        toast("Signed in — return to main app");
        renderStatus();
      } catch (e) {
        toast(e.message || "Sign-in failed");
      }
    });

    $("#btn-sync-signup")?.addEventListener("click", async () => {
      if (!Sync.getClient()) {
        toast("Save connection first");
        return;
      }
      try {
        const data = await Sync.signUp($("#sync-email").value.trim(), $("#sync-password").value);
        $("#sync-password").value = "";
        toast(data.session ? "Signed up" : "Check email if confirmation is on");
        renderStatus();
      } catch (e) {
        toast(e.message || "Sign-up failed");
      }
    });

    $("#btn-sync-signout")?.addEventListener("click", async () => {
      await Sync.signOut();
      toast("Signed out");
      renderStatus();
    });

    $("#btn-sync-push")?.addEventListener("click", async () => {
      try {
        const state = St.load();
        await Sync.pushState(state);
        if (state._meta) state._meta.lastRemoteUpdated = new Date().toISOString();
        St.save(state);
        toast("Saved to cloud");
        renderStatus();
      } catch (e) {
        toast(e.message || "Push failed");
      }
    });

    $("#btn-sync-pull")?.addEventListener("click", async () => {
      try {
        if (typeof Sync.executeRetrieve !== "function") {
          toast("Reload the page — sync script is outdated.");
          return;
        }
        const result = await Sync.executeRetrieve((ctx) => {
          const C = window.PFTCloudConflict;
          if (C && typeof C.prompt === "function") return C.prompt(ctx.updatedAt);
          return Promise.resolve(
            window.confirm(
              "This device and the cloud both have data. OK = use cloud only. Cancel = keep this device."
            )
              ? "replace"
              : "keep"
          );
        });
        switch (result.outcome) {
          case "replaced":
          case "merged":
            toast("Done — reload the main app if it’s already open");
            break;
          case "no_backup":
            toast("No cloud backup found yet. Save to cloud from a device that has your data.");
            break;
          case "no_cloud_data":
            toast("Cloud backup is empty. Local data unchanged.");
            break;
          case "cancelled":
            toast("Kept this device’s data");
            break;
          default:
            break;
        }
        renderStatus();
      } catch (e) {
        toast(e.message || "Retrieve failed");
      }
    });

    $("#sync-auto")?.addEventListener("change", (e) => {
      Sync.setAutoSync(e.target.checked);
      toast(e.target.checked ? "Auto-sync on" : "Auto-sync off");
    });

    $("#sync-auto-open")?.addEventListener("change", (e) => {
      if (Sync.setAutoOpen) Sync.setAutoOpen(e.target.checked);
      toast(e.target.checked ? "Auto-restore on open — on" : "Auto-restore on open — off");
    });

    const client = Sync.getClient();
    if (client) {
      client.auth.onAuthStateChange(() => renderStatus());
    }

    renderStatus();
  }

  boot();
})();
