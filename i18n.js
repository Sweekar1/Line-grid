/* Minimal i18n stub — English only, no remote locale loading */
(() => {
  "use strict";

  const DICT = {
    "app.name": "Line Grid",
    "state.ready": "Ready",
    "state.playing": "Playing",
    "state.paused": "Paused",
    "state.ended": "Ended",
    "meta.shuffleOrder": "In order",
    "meta.shuffleOn": "Shuffle",
    "meta.repeatOff": "Repeat off",
    "meta.repeatAll": "Repeat all",
    "meta.repeatOne": "Repeat one",
    "controls.shuffle": "Toggle shuffle",
    "controls.prev": "Previous track",
    "controls.play": "Play",
    "controls.pause": "Pause",
    "controls.next": "Next track",
    "controls.repeat": "Cycle repeat mode",
    "progress.label": "Seek through the track",
    "volume.label": "Volume",
    "lyrics.title": "Lyrics",
    "lyrics.empty": "This track has no timed lyrics.",
    "lyrics.hint": "Tap a line to jump there.",
    "queue.title": "Tracks",
    "queue.count": "{{count}} cuts",
    "queue.play": "Play {{title}} by {{artist}}",
    "cover.alt": "Cover art for {{title}}",
    "hint.keys": "Space plays and pauses · ← → seek · ↑ ↓ change track",
    "audio.error": "Playback could not start in this browser. Try pressing play again.",
    "colophon.note": "Demo tracks are synthesised in-browser. Search uses a local server + YouTube (personal use)."
  };

  function interpolate(value, parameters) {
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key) => {
      const replacement = parameters?.[key];
      return replacement == null ? "" : String(replacement);
    });
  }

  function t(key, parameters = {}) {
    const value = DICT[key];
    return typeof value === "string" ? interpolate(value, parameters) : key;
  }

  function translate(root = document) {
    const bindings = [
      ["data-i18n", "textContent"],
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-aria-label", "aria-label"],
      ["data-i18n-title", "title"],
    ];
    for (const [attribute, target] of bindings) {
      root.querySelectorAll(`[${attribute}]`).forEach((element) => {
        const value = t(element.getAttribute(attribute));
        if (target === "textContent") element.textContent = value;
        else element.setAttribute(target, value);
      });
    }
  }

  window.eazoI18n = {
    getLocale: () => "en-US",
    getPreference: () => "en-US",
    ready: Promise.resolve("en-US"),
    setLocale: async () => "en-US",
    t,
    translate,
  };

  // Run once DOM is ready enough
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => translate());
  } else {
    translate();
  }
})();
