/**
 * Light / dark theme — persisted, contrast-safe tokens live in CSS [data-theme].
 */
(function (global) {
  const KEY = "pft_theme";

  function getStored() {
    return localStorage.getItem(KEY);
  }

  function getEffective() {
    const s = getStored();
    if (s === "light" || s === "dark") return s;
    if (global.matchMedia && global.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    return "dark";
  }

  function apply(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t === "light" ? "light" : "dark";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#e8f4f3" : "#0f1228");
  }

  function set(theme) {
    const t = theme === "light" ? "light" : "dark";
    localStorage.setItem(KEY, t);
    apply(t);
    global.dispatchEvent(new CustomEvent("pft-theme-change", { detail: { theme: t } }));
  }

  function toggle() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    set(cur === "dark" ? "light" : "dark");
    return document.documentElement.getAttribute("data-theme");
  }

  function init() {
    apply(getEffective());
  }

  global.PFTTheme = { init, getEffective, getStored, set, toggle, apply };
})(typeof window !== "undefined" ? window : globalThis);
