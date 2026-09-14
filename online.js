/* Online search + stream playback for Line Grid
   Requires the local server (python3 server.py) for /api/* endpoints. */
(() => {
  "use strict";

  const API = ""; // same origin when served by server.py

  const $ = (id) => document.getElementById(id);
  const searchForm = $("searchForm");
  const searchInput = $("searchInput");
  const searchStatus = $("searchStatus");
  const queue = $("queue");

  if (!searchForm || !searchInput || !queue) return;

  // Shared HTMLAudioElement for remote streams
  const remote = new Audio();
  remote.preload = "auto";
  remote.crossOrigin = "anonymous";

  let onlineMode = false;
  let currentOnline = null; // { id, title, artist, duration, thumbnail }
  let searchResults = [];
  let busy = false;

  function setStatus(text, isBusy = false) {
    if (!searchStatus) return;
    if (!text) {
      searchStatus.hidden = true;
      searchStatus.textContent = "";
      return;
    }
    searchStatus.hidden = false;
    searchStatus.textContent = text;
    searchStatus.dataset.busy = isBusy ? "true" : "false";
  }

  function fmt(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------- Search ----------
  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q || busy) return;
    busy = true;
    setStatus("Searching…", true);
    searchResults = [];
    try {
      const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=10`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      searchResults = data.results || [];
      if (!searchResults.length) {
        setStatus("No results. Try another query.");
      } else {
        setStatus(`${searchResults.length} results — click to play`);
        renderSearchResults();
      }
    } catch (err) {
      console.error(err);
      setStatus("Search failed. Is the local server running? (python3 server.py)");
    } finally {
      busy = false;
    }
  });

  function renderSearchResults() {
    // Prepend search results above demo tracks
    const existingDemo = [...queue.querySelectorAll(".track-row:not(.is-online)")];
    queue.innerHTML = "";

    searchResults.forEach((tr, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "track-row is-online";
      if (currentOnline && currentOnline.id === tr.id) btn.classList.add("is-current");
      btn.setAttribute("aria-label", `Play ${tr.title} by ${tr.artist}`);
      btn.innerHTML = `
        <span class="index">${String(i + 1).padStart(2, "0")}</span>
        <img class="thumb" src="${tr.thumbnail || ""}" alt="" width="40" height="40" loading="lazy"
             onerror="this.style.opacity='0.3'">
        <span>
          <span class="row-title">${escapeHtml(tr.title)}</span>
          <span class="row-artist">${escapeHtml(tr.artist)}</span>
        </span>
        <span class="row-time">${tr.duration ? fmt(tr.duration) : "—"}</span>
      `;
      btn.addEventListener("click", () => playOnline(tr));
      queue.appendChild(btn);
    });

    // Re-append a divider + demo tracks if we still want them visible
    if (existingDemo.length && searchResults.length) {
      const sep = document.createElement("div");
      sep.style.cssText = "padding:8px 14px;font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--hair);";
      sep.textContent = "Demo tracks";
      queue.appendChild(sep);
    }
    existingDemo.forEach((el) => queue.appendChild(el));

    const countEl = $("queueCount");
    if (countEl) countEl.textContent = `${searchResults.length} results`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- Playback ----------
  async function playOnline(tr) {
    if (busy) return;
    busy = true;
    setStatus(`Loading “${tr.title}”…`, true);
    stopDemoEngine();

    try {
      // Prefer proxy so browser can play + seek
      const proxyUrl = `${API}/api/proxy/${tr.id}`;
      currentOnline = { ...tr };
      onlineMode = true;
      document.documentElement.dataset.online = '1';

      remote.pause();
      remote.src = proxyUrl;
      remote.load();

      applyTrackMeta(tr, 0);
      // Lyrics
      await loadLyrics(tr);

      await remote.play();
      setStatus(`Playing · ${tr.title}`);
      markCurrentRow(tr.id);
      updatePlayButton(true);
      applyTrackMeta(tr, remote.currentTime || 0);
    } catch (err) {
      console.error(err);
      setStatus("Could not play this track. Server may be blocked or the video is unavailable.");
      onlineMode = false;
      document.documentElement.dataset.online = '0';
    } finally {
      busy = false;
    }
  }

  function applyTrackMeta(tr, time) {
    if (!tr) return;
    const cover = $("cover");
    const title = $("trackTitle");
    const artist = $("artist");
    const progress = $("progress");
    const elapsed = $("elapsed");
    const remaining = $("remaining");
    const shuffleText = $("shuffleText");
    const repeatText = $("repeatText");

    const dur = remote.duration && isFinite(remote.duration) && remote.duration > 0
      ? remote.duration
      : (tr.duration || 0);
    const t = Math.max(0, time || 0);

    if (cover) {
      const src = tr.thumbnail || cover.src;
      if (tr.thumbnail && cover.getAttribute("src") !== tr.thumbnail) {
        cover.src = tr.thumbnail;
      }
      cover.alt = `Cover art for ${tr.title}`;
    }
    if (title) {
      // Clean noisy YT suffixes for display
      let nice = String(tr.title || "")
        .replace(/\s*[\[\(]?(Official\s*)?(Audio|Video|Lyric[s]?|Visualizer|HD|4K)[\]\)]?/gi, "")
        .replace(/\s*ft\..*$/i, (m) => m) // keep featured
        .trim();
      if (nice.length > 48) nice = nice.slice(0, 46) + "…";
      title.textContent = nice || tr.title;
    }
    if (artist) {
      let a = String(tr.artist || "");
      if (a.length > 36) a = a.slice(0, 34) + "…";
      artist.textContent = a;
    }
    if (shuffleText) shuffleText.textContent = "YouTube";
    if (repeatText) repeatText.textContent = "Stream";

    if (progress && dur) {
      progress.max = String(dur);
      if (!progress.matches(":active")) {
        progress.value = String(t);
        progress.style.setProperty("--fill", `${(t / dur) * 100}%`);
      }
    }
    if (elapsed) elapsed.textContent = fmt(t);
    if (remaining && dur) remaining.textContent = `-${fmt(Math.max(0, dur - t))}`;
  }

  function stopDemoEngine() {

    // Pause synth engine if exposed
    try {
      const playBtn = $("play");
      // Dispatch a custom event the main app can listen to, or click pause if playing
      if (window.__lineGridPause) window.__lineGridPause();
    } catch (_) {}
  }

  function markCurrentRow(id) {
    queue.querySelectorAll(".track-row.is-online").forEach((row) => {
      const isCur = row.querySelector(".row-title") && currentOnline && currentOnline.id === id;
      // simpler: mark by data
      row.classList.toggle("is-current", false);
    });
    // re-render highlights after results
    queue.querySelectorAll(".track-row.is-online").forEach((row, i) => {
      if (searchResults[i] && searchResults[i].id === id) {
        row.classList.add("is-current");
      }
    });
  }

  function updatePlayButton(playing) {
    const glyph = $("playGlyph");
    const playBtn = $("play");
    if (glyph) glyph.textContent = playing ? "❚❚" : "▶";
    if (playBtn) {
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      playBtn.title = playing ? "Pause" : "Play";
    }
    const stateEl = $("playState");
    if (stateEl && currentOnline) {
      stateEl.textContent = `${playing ? "Playing" : "Paused"} · ${fmt(remote.currentTime)}`;
    }
  }

  // ---------- Lyrics from LRCLIB ----------
  async function loadLyrics(tr) {
    const lyricsEl = $("lyrics");
    if (!lyricsEl) return;
    lyricsEl.innerHTML = `<p class="lyric-line" style="color:var(--muted)">Loading lyrics…</p>`;

    try {
      const params = new URLSearchParams({
        title: tr.title.replace(/\s*[\(\[].*?[\)\]]/g, "").replace(/\s*(Official|Audio|Video|Lyrics).*$/i, "").trim() || tr.title,
        artist: tr.artist,
      });
      if (tr.duration) params.set("duration", String(Math.round(tr.duration)));

      const res = await fetch(`${API}/api/lyrics?${params}`);
      const data = await res.json();

      lyricsEl.innerHTML = "";
      if (data.found && data.synced && data.synced.length) {
        data.synced.forEach((line, i) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "lyric-line";
          btn.dataset.t = line.t;
          btn.textContent = line.text;
          btn.addEventListener("click", () => {
            remote.currentTime = line.t;
            if (remote.paused) remote.play();
          });
          lyricsEl.appendChild(btn);
        });
        // store for sync
        remote._syncedLyrics = data.synced;
      } else if (data.plain) {
        data.plain.split("\n").forEach((text) => {
          if (!text.trim()) return;
          const p = document.createElement("p");
          p.className = "lyric-line";
          p.textContent = text;
          lyricsEl.appendChild(p);
        });
        remote._syncedLyrics = null;
      } else {
        lyricsEl.innerHTML = `<p class="lyric-line" style="color:var(--muted)">No lyrics found for this track.</p>`;
        remote._syncedLyrics = null;
      }
    } catch (err) {
      console.error(err);
      lyricsEl.innerHTML = `<p class="lyric-line" style="color:var(--muted)">Lyrics unavailable.</p>`;
      remote._syncedLyrics = null;
    }
  }

  // ---------- Sync UI while remote plays ----------
  function tickRemote() {
    if (!onlineMode || !currentOnline) return;

    const t = remote.currentTime || 0;
    applyTrackMeta(currentOnline, t);

    const lineTime = $("lineTime");
    const stateEl = $("playState");
    if (lineTime) lineTime.textContent = fmt(t);
    if (stateEl) {
      const label = remote.paused ? (t > 0.1 ? "Paused" : "Ready") : "Playing";
      stateEl.textContent = `${label} · ${fmt(t)}`;
    }

    // Highlight lyric line
    const lines = remote._syncedLyrics;
    if (lines && lines.length) {
      let active = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= t + 0.15) active = i;
        else break;
      }
      const nodes = document.querySelectorAll("#lyrics .lyric-line");
      nodes.forEach((node, i) => {
        node.classList.toggle("is-active", i === active);
        node.classList.toggle("is-past", i < active);
      });
      if (active >= 0 && nodes[active]) {
        const box = nodes[active];
        const parent = $("lyrics");
        if (parent) {
          const mid = parent.clientHeight / 2;
          parent.scrollTop = box.offsetTop - mid + box.clientHeight / 2;
        }
      }
    }
  }

  remote.addEventListener("loadedmetadata", () => {
    if (onlineMode && currentOnline) {
      if (remote.duration && isFinite(remote.duration)) {
        currentOnline.duration = remote.duration;
      }
      applyTrackMeta(currentOnline, remote.currentTime || 0);
    }
  });
  remote.addEventListener("timeupdate", tickRemote);

  function onlineLoop() {
    if (onlineMode && currentOnline) {
      applyTrackMeta(currentOnline, remote.currentTime || 0);
      const glyph = $("playGlyph");
      if (glyph) glyph.textContent = remote.paused ? "▶" : "❚❚";
      const stateEl = $("playState");
      if (stateEl) {
        const t = remote.currentTime || 0;
        const label = remote.paused ? (t > 0.1 ? "Paused" : "Ready") : "Playing";
        stateEl.textContent = `${label} · ${fmt(t)}`;
      }
    }
    requestAnimationFrame(onlineLoop);
  }
  requestAnimationFrame(onlineLoop);
  remote.addEventListener("play", () => updatePlayButton(true));
  remote.addEventListener("pause", () => updatePlayButton(false));
  remote.addEventListener("ended", () => {
    updatePlayButton(false);
    setStatus("Ended");
  });
  remote.addEventListener("error", () => {
    setStatus("Playback error — try another result or check the server.");
    updatePlayButton(false);
  });

  // Hook main transport buttons when in online mode
  const playBtn = $("play");
  if (playBtn) {
    playBtn.addEventListener(
      "click",
      (e) => {
        if (!onlineMode) return;
        e.stopImmediatePropagation();
        if (remote.paused) remote.play();
        else remote.pause();
      },
      true,
    );
  }

  const progress = $("progress");
  if (progress) {
    progress.addEventListener("change", () => {
      if (!onlineMode) return;
      remote.currentTime = Number(progress.value);
    });
  }

  const volume = $("volume");
  if (volume) {
    remote.volume = Number(volume.value);
    volume.addEventListener("input", () => {
      remote.volume = Number(volume.value);
    });
  }

  // When user clicks a demo track, leave online mode
  queue.addEventListener("click", (e) => {
    const row = e.target.closest(".track-row:not(.is-online)");
    if (row) {
      onlineMode = false;
      document.documentElement.dataset.online = '0';
      remote.pause();
      remote.removeAttribute("src");
      setStatus("");
    }
  });

  // Expose helpers
  window.__lineGridOnline = {
    isOnline: () => onlineMode,
    pause: () => remote.pause(),
    play: () => remote.play(),
  };
})();
