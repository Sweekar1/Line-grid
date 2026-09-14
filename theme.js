/* Theme toggle: light / dark — dark by default */
(() => {
  "use strict";

  const STORAGE_KEY = "linegrid.theme";

  function applyTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", value);
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.setAttribute("aria-pressed", value === "dark" ? "true" : "false");
      btn.title = value === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {}
  }

  function readPreference() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch (_) {}
    // Dark by default
    return "dark";
  }

  function toggle() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function init() {
    applyTheme(readPreference());
    const btn = document.getElementById("themeToggle");
    if (btn) btn.addEventListener("click", toggle);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
