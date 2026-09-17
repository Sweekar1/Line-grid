/* Immersive now-playing: album color, lyric motion, tracks drawer */
(() => {
  "use strict";

  const cover = document.getElementById("cover");
  const ambient = document.getElementById("ambientCover");
  const root = document.documentElement;
  const menuBtn = document.getElementById("menuBtn");
  const menuClose = document.getElementById("menuClose");
  const drawer = document.getElementById("queueDrawer");
  const backdrop = document.getElementById("drawerBackdrop");

  document.body.classList.add("immersive");

  function setAlbumColorFromImage(img) {
    try {
      if (!img || !img.complete || !img.naturalWidth) return;
      const w = 48;
      const h = 48;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let bestS = -1;
      let best = [48, 52, 64];
      let rSum = 0, gSum = 0, bSum = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const rr = data[i], gg = data[i + 1], bb = data[i + 2], a = data[i + 3];
        if (a < 140) continue;
        const r = rr / 255, g = gg / 255, b = bb / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
        if (l < 0.08 || l > 0.92) continue;
        rSum += rr; gSum += gg; bSum += bb; n++;
        const score = s * (1 - Math.abs(l - 0.42));
        if (score > bestS) {
          bestS = score;
          best = [rr, gg, bb];
        }
      }
      const avg = n
        ? [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)]
        : best;
      const mix = [
        Math.round(best[0] * 0.72 + avg[0] * 0.28),
        Math.round(best[1] * 0.72 + avg[1] * 0.28),
        Math.round(best[2] * 0.72 + avg[2] * 0.28),
      ];
      const dark = mix.map((v) => Math.round(v * 0.28));
      const mid = mix.map((v) => Math.round(v * 0.48));
      const glow = mix.map((v) => Math.min(255, Math.round(v * 1.12)));
      root.style.setProperty("--album-bg", `rgb(${dark.join(",")})`);
      root.style.setProperty("--album-bg-mid", `rgb(${mid.join(",")})`);
      root.style.setProperty("--album-glow", `rgba(${glow.join(",")},0.55)`);
      root.style.setProperty("--album-accent", `rgb(${glow.join(",")})`);
      document.body.style.background = `rgb(${dark.join(",")})`;
    } catch (_) {
      /* canvas tainted — ambient blur still carries the color */
    }
  }

  function syncAmbient(img) {
    if (!ambient || !img) return;
    if (ambient.getAttribute("src") !== img.src) ambient.src = img.src;
  }

  function onCoverReady() {
    if (!cover) return;
    syncAmbient(cover);
    setAlbumColorFromImage(cover);
  }

  function scrollActiveLyric(node) {
    if (!node) return;
    const box = document.getElementById("lyrics");
    const track = document.getElementById("lyricsTrack");
    if (!box) return;
    const boxH = box.clientHeight || 1;
    const nodeTop = node.offsetTop;
    const nodeH = node.offsetHeight || 0;
    const center = boxH * 0.42;
    if (track) {
      const y = center - (nodeTop + nodeH / 2);
      track.style.transform = `translateY(${y}px)`;
    } else {
      box.scrollTo({
        top: Math.max(0, nodeTop - center + nodeH / 2),
        behavior: "smooth",
      });
    }
  }

  function openDrawer() {
    document.body.classList.add("drawer-open");
    if (drawer) drawer.setAttribute("aria-hidden", "false");
    if (backdrop) backdrop.hidden = false;
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeDrawer() {
    document.body.classList.remove("drawer-open");
    if (drawer) drawer.setAttribute("aria-hidden", "true");
    if (backdrop) backdrop.hidden = true;
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleDrawer() {
    if (document.body.classList.contains("drawer-open")) closeDrawer();
    else openDrawer();
  }

  if (menuBtn) menuBtn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleDrawer();
  });
  if (menuClose) menuClose.addEventListener("click", (e) => {
    e.preventDefault();
    closeDrawer();
  });
  if (backdrop) backdrop.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  if (cover) {
    cover.addEventListener("load", onCoverReady);
    if (cover.complete) onCoverReady();
    const mo = new MutationObserver(() => {
      setTimeout(onCoverReady, 40);
    });
    mo.observe(cover, { attributes: true, attributeFilter: ["src"] });
  }

  window.__lineGridUI = {
    scrollActiveLyric,
    openDrawer,
    closeDrawer,
    extractCoverColor: onCoverReady,
  };
})();
