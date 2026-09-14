/* Line Grid — a minimal synced-lyric player.
   Every demo track is synthesised in the browser with the Web Audio API, so the
   timeline below is both the music and the clock the lyrics follow. */
(() => {
  'use strict';

  const t = (key, params) => (window.eazoI18n ? window.eazoI18n.t(key, params) : key);

  const MINOR = [0, 2, 3, 5, 7, 8, 10];
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];

  const TRACKS = [
    {
      title: 'Paper Sun', artist: 'Mina Vale', cover: './assets/covers/cover-1.webp',
      duration: 76.8, bpm: 75, root: 57, scale: MINOR, drums: 'soft',
      progression: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
      lyrics: [
        [0.0, 'Red circle lifts above the paper sea'],
        [9.6, 'Fine lines carry morning, slowly'],
        [19.2, 'Your shadow folds into the light'],
        [28.8, 'I keep the beat under my breath'],
        [38.4, 'Every word returns in order'],
        [48.0, 'Every pause becomes a shore'],
        [57.6, 'When the sun arrives beside us'],
        [67.2, 'We begin the song once more']
      ]
    },
    {
      title: 'Soft Rain', artist: 'North Room', cover: './assets/covers/cover-2.webp',
      duration: 72, bpm: 80, root: 62, scale: MAJOR, drums: 'soft',
      progression: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]],
      lyrics: [
        [0.0, 'Cloud ink gathers over windows'],
        [9.0, 'Small rain writes across the glass'],
        [18.0, 'I count the drops between the measures'],
        [27.0, 'Your name appears, then lets me pass'],
        [36.0, 'Quiet streets repeat the chorus'],
        [45.0, 'Muted steps and softened tone'],
        [54.0, 'If the weather keeps the rhythm'],
        [63.0, 'I can hear it on my own']
      ]
    },
    {
      title: 'Night Clear', artist: 'Aiko Lane', cover: './assets/covers/cover-3.webp',
      duration: 88, bpm: 60, root: 48, scale: MAJOR, drums: 'none',
      progression: [[0, 7, 12], [-7, 0, 5], [-5, 2, 7], [-3, 4, 9]],
      lyrics: [
        [0.0, 'Gold moon rests on a black horizon'],
        [12.0, 'Birds cut marks through quiet air'],
        [24.0, 'Low tide hums beneath the silence'],
        [36.0, 'One line bright enough to share'],
        [48.0, 'Stay until the meter changes'],
        [60.0, 'Stay until the dark is thin'],
        [72.0, 'When the last refrain is fading'],
        [84.0, 'Turn the needle back again']
      ]
    },
    {
      title: 'Static Blue', artist: 'Halden Ray', cover: './assets/covers/cover-4.webp',
      duration: 70, bpm: 96, root: 52, scale: MINOR, drums: 'tick',
      progression: [[0, 3, 7], [3, 7, 10], [-4, 0, 3], [-2, 2, 5]],
      lyrics: [
        [0.0, 'Blue static hums along the wire'],
        [10.0, 'Half a signal, half a sign'],
        [20.0, 'I tune the room until it answers'],
        [30.0, 'Your frequency beside mine'],
        [40.0, 'Nothing here is out of order'],
        [50.0, 'Nothing here is quite the same'],
        [60.0, 'When the station goes to silence'],
        [65.0, 'I will say your name again']
      ]
    },
    {
      title: 'Low Tide', artist: 'Sena Okada', cover: './assets/covers/cover-5.webp',
      duration: 80, bpm: 72, root: 53, scale: MAJOR, drums: 'soft',
      progression: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]],
      lyrics: [
        [0.0, 'Low tide leaves the harbor open'],
        [10.0, 'Rope and salt and weathered stone'],
        [20.0, 'Boats rehearse their slow returning'],
        [30.0, 'Every wake a line of its own'],
        [40.0, 'Keep the tempo, keep it level'],
        [50.0, 'Keep the water in the bay'],
        [60.0, 'When the morning finds the harbor'],
        [70.0, 'We will row the long way']
      ]
    },
    {
      title: 'Room Tone', artist: 'The Ledger', cover: './assets/covers/cover-6.webp',
      duration: 64, bpm: 90, root: 55, scale: MINOR, drums: 'tick',
      progression: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [5, 9, 12]],
      lyrics: [
        [0.0, 'Room tone settles in the corners'],
        [8.0, 'Every wall has one more note'],
        [16.0, 'Dust decides the final measure'],
        [24.0, 'Air decides the final throat'],
        [32.0, 'Count it in and hold the level'],
        [40.0, 'Count it out and let it close'],
        [48.0, 'Nothing ends, it only lowers'],
        [56.0, 'Nothing ends, it only goes']
      ]
    }
  ];
  TRACKS.forEach((track, i) => {
    track.index = i;
    track.art = t('cover.alt', { title: track.title });
  });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const els = {
    cover: $('cover'), title: $('trackTitle'), artist: $('artist'),
    state: $('playState'), progress: $('progress'), elapsed: $('elapsed'),
    remaining: $('remaining'), play: $('play'), playGlyph: $('playGlyph'),
    prev: $('prev'), next: $('next'), shuffle: $('shuffle'), repeat: $('repeat'),
    volume: $('volume'), lyrics: $('lyrics'), lineTime: $('lineTime'),
    queue: $('queue'), queueCount: $('queueCount'), shuffleText: $('shuffleText'),
    repeatText: $('repeatText'), alert: $('audioAlert')
  };

  /* ---------------------------------------------------------------- helpers */

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function fmt(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------------- audio engine */

  let ctx = null;
  let master = null;
  let noise = null;
  const live = [];

  function ensureAudio() {
    if (ctx) return true;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      ctx = new Ctor();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 3;
      comp.attack.value = 0.01;
      comp.release.value = 0.3;
      master = ctx.createGain();
      master.gain.value = Number(els.volume.value) * 0.9;
      master.connect(comp);
      comp.connect(ctx.destination);

      const frames = Math.floor(ctx.sampleRate * 2);
      noise = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  function track(voice) {
    live.push(voice);
    return voice;
  }

  function releaseVoices(when) {
    const at = Math.max(when, ctx ? ctx.currentTime : 0);
    while (live.length) {
      const voice = live.pop();
      try {
        voice.gain.gain.cancelScheduledValues(at);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), at);
        voice.gain.gain.linearRampToValueAtTime(0, at + 0.06);
        voice.nodes.forEach((node) => {
          if (typeof node.stop === 'function') node.stop(at + 0.08);
        });
      } catch (error) {
        /* node already stopped */
      }
    }
  }

  function envelope(gain, time, peak, attack, release, sustain) {
    const g = gain.gain;
    g.setValueAtTime(0.0001, time);
    g.linearRampToValueAtTime(peak, time + attack);
    g.setValueAtTime(peak, time + Math.max(attack, sustain));
    g.exponentialRampToValueAtTime(0.0001, time + sustain + release);
  }

  function pad(time, chordNotes, duration, peak) {
    if (!ctx) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    filter.connect(gain);
    gain.connect(master);

    const attack = Math.min(1.4, duration * 0.35);
    const release = Math.min(2.2, duration * 0.5);
    const sustain = Math.max(0.2, duration - release);
    envelope(gain, time, peak, attack, release, sustain);

    const nodes = [filter, gain];
    chordNotes.forEach((freq, i) => {
      const oscA = ctx.createOscillator();
      oscA.type = 'triangle';
      oscA.frequency.value = freq;
      oscA.detune.value = i % 2 === 0 ? -5 : 5;
      const oscB = ctx.createOscillator();
      oscB.type = 'sine';
      oscB.frequency.value = freq;
      oscB.detune.value = i % 3 === 0 ? 7 : -7;
      const mix = ctx.createGain();
      mix.gain.value = 0.5;
      oscA.connect(mix);
      oscB.connect(mix);
      mix.connect(filter);
      oscA.start(time);
      oscB.start(time);
      const stop = time + sustain + release + 0.1;
      oscA.stop(stop);
      oscB.stop(stop);
      nodes.push(oscA, oscB, mix);
    });

    track({ gain, nodes });
  }

  function tone(time, freq, duration, options) {
    if (!ctx) return;
    const opts = options || {};
    const gain = ctx.createGain();
    gain.connect(master);
    const osc = ctx.createOscillator();
    osc.type = opts.type || 'triangle';
    osc.frequency.value = freq;
    osc.connect(gain);
    const peak = opts.peak || 0.08;
    const attack = opts.attack || 0.02;
    const release = opts.release || 0.35;
    envelope(gain, time, peak, attack, release, Math.max(attack, duration - release));
    osc.start(time);
    osc.stop(time + duration + release + 0.05);
    track({ gain, nodes: [osc, gain] });
  }

  function bass(time, freq, duration, peak) {
    if (!ctx) return;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.connect(gain);
    gain.connect(master);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(filter);
    envelope(gain, time, peak, 0.03, 0.3, Math.max(0.05, duration - 0.3));
    osc.start(time);
    osc.stop(time + duration + 0.35);
    track({ gain, nodes: [osc, filter, gain] });
  }

  function noiseHit(time, options) {
    if (!ctx) return;
    const opts = options || {};
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter || 'highpass';
    filter.frequency.value = opts.freq || 6000;
    filter.Q.value = opts.q || 0.7;
    const gain = ctx.createGain();
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    const decay = opts.decay || 0.09;
    const g = gain.gain;
    g.setValueAtTime(0.0001, time);
    g.linearRampToValueAtTime(opts.peak || 0.03, time + 0.004);
    g.exponentialRampToValueAtTime(0.0001, time + decay);
    src.start(time);
    src.stop(time + decay + 0.05);
    track({ gain, nodes: [src, filter, gain] });
  }

  function kick(time, peak) {
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.connect(master);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.12);
    osc.connect(gain);
    const g = gain.gain;
    g.setValueAtTime(0.0001, time);
    g.linearRampToValueAtTime(peak, time + 0.008);
    g.exponentialRampToValueAtTime(0.0001, time + 0.34);
    osc.start(time);
    osc.stop(time + 0.4);
    track({ gain, nodes: [osc, gain] });
  }

  /* ------------------------------------------------------------- timeline */

  const timelineCache = new Map();

  function timelineFor(trackIndex) {
    if (timelineCache.has(trackIndex)) return timelineCache.get(trackIndex);
    const tr = TRACKS[trackIndex];
    const beat = 60 / tr.bpm;
    const bar = beat * 4;
    const bars = Math.ceil(tr.duration / bar);
    const events = [];
    const rand = mulberry32(trackIndex * 977 + 13);

    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      if (t0 >= tr.duration) break;
      const chord = tr.progression[Math.floor(b / 2) % tr.progression.length];
      const left = tr.duration - t0;

      if (b % 2 === 0) {
        const dur = Math.min(bar * 2, left);
        events.push({ t: t0, kind: 'pad', chord: chord.map((n) => midiToFreq(tr.root + n + 12)), dur, peak: 0.075 });
      }

      events.push({ t: t0, kind: 'bass', freq: midiToFreq(tr.root + chord[0] - 12), dur: beat * 1.7, peak: 0.16 });
      events.push({ t: t0 + beat * 2, kind: 'bass', freq: midiToFreq(tr.root + chord[0] - 12), dur: beat * 1.4, peak: 0.12 });

      if (tr.drums === 'soft') {
        events.push({ t: t0, kind: 'kick', peak: 0.2 });
        events.push({ t: t0 + beat * 2, kind: 'kick', peak: 0.14 });
        for (let k = 0; k < 4; k++) {
          events.push({ t: t0 + beat * k, kind: 'hat', peak: 0.014 + rand() * 0.012, freq: 7200 });
          events.push({ t: t0 + beat * k + beat / 2, kind: 'hat', peak: 0.009 + rand() * 0.008, freq: 8600 });
        }
      } else if (tr.drums === 'tick') {
        events.push({ t: t0, kind: 'kick', peak: 0.19 });
        events.push({ t: t0 + beat * 2, kind: 'kick', peak: 0.15 });
        for (let k = 0; k < 4; k++) {
          events.push({ t: t0 + beat * k, kind: 'hat', peak: 0.022 + rand() * 0.016, freq: 9200 });
          events.push({ t: t0 + beat * k + beat / 2, kind: 'hat', peak: 0.012, freq: 6800 });
        }
        if (b % 2 === 1) events.push({ t: t0 + beat * 2, kind: 'clap', peak: 0.05 });
      }
    }

    const scale = tr.scale;
    tr.lyrics.forEach((line, li) => {
      const lineRand = mulberry32(trackIndex * 131 + li * 37 + 5);
      const start = line[0];
      const phrase = [3, 4, 3, 4][li % 4];
      for (let k = 0; k < phrase; k++) {
        const at = start + k * beat;
        if (at >= tr.duration) break;
        const degree = scale[Math.floor(lineRand() * scale.length)];
        const octave = lineRand() > 0.78 ? 12 : 0;
        events.push({
          t: at,
          kind: 'note',
          freq: midiToFreq(tr.root + 24 + degree + octave),
          dur: beat * (k === phrase - 1 ? 1.6 : 0.85),
          peak: 0.05 + lineRand() * 0.025
        });
      }
    });

    events.sort((a, b) => a.t - b.t);
    timelineCache.set(trackIndex, events);
    return events;
  }

  function fire(event, at) {
    switch (event.kind) {
      case 'pad': pad(at, event.chord, event.dur, event.peak); break;
      case 'bass': bass(at, event.freq, event.dur, event.peak); break;
      case 'note': tone(at, event.freq, event.dur, { peak: event.peak, type: 'triangle', attack: 0.05, release: 0.5 }); break;
      case 'kick': kick(at, event.peak); break;
      case 'hat': noiseHit(at, { freq: event.freq, peak: event.peak, decay: 0.05 }); break;
      case 'clap': noiseHit(at, { freq: 1400, filter: 'bandpass', q: 1.1, peak: event.peak, decay: 0.14 }); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------ playback */

  const state = {
    index: 0,
    offset: 0,
    playing: false,
    startedAt: 0,
    shuffle: false,
    repeat: 0,
    dragging: false,
    ended: false,
    nextEvent: 0,
    userScrolled: 0
  };

  const LOOKAHEAD = 0.5;

  const currentTime = () =>
    state.playing && ctx ? ctx.currentTime - state.startedAt + state.offset : state.offset;

  function seekTo(seconds, options) {
    const tr = TRACKS[state.index];
    const value = clamp(seconds, 0, tr.duration);
    const wasPlaying = state.playing;
    if (ctx) releaseVoices(ctx.currentTime);
    state.offset = value;
    state.ended = false;
    state.startedAt = ctx ? ctx.currentTime : 0;
    const events = timelineFor(state.index);
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].t < value - 0.02) lo = mid + 1;
      else hi = mid;
    }
    state.nextEvent = lo;
    if (wasPlaying && (!options || !options.silent)) resumeSustain();
    render();
  }

  function resumeSustain() {
    const tr = TRACKS[state.index];
    const beat = 60 / tr.bpm;
    const bar = beat * 4;
    const barIndex = Math.floor(state.offset / bar);
    const chord = tr.progression[Math.floor(barIndex / 2) % tr.progression.length];
    const leftInBlock = (2 - (barIndex % 2)) * bar - (state.offset - barIndex * bar);
    const at = ctx.currentTime + 0.02;
    pad(at, chord.map((n) => midiToFreq(tr.root + n + 12)), Math.max(0.6, leftInBlock), 0.05);
  }

  function play() {
    if (state.ended) seekTo(0, { silent: true });
    if (!ensureAudio()) {
      showAlert(t('audio.error'));
      return;
    }
    if (ctx.state === 'suspended') ctx.resume();
    state.playing = true;
    state.ended = false;
    state.startedAt = ctx.currentTime;
    const events = timelineFor(state.index);
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].t < state.offset - 0.02) lo = mid + 1;
      else hi = mid;
    }
    state.nextEvent = lo;
    resumeSustain();
    render();
  }

  function pause() {
    if (ctx) {
      state.offset = currentTime();
      releaseVoices(ctx.currentTime);
    }
    state.playing = false;
    render();
  }

  function toggle() {
    if (state.playing) pause();
    else play();
  }

  function nextIndex(direction) {
    const total = TRACKS.length;
    if (state.shuffle && total > 1) {
      let candidate = state.index;
      while (candidate === state.index) candidate = Math.floor(Math.random() * total);
      return candidate;
    }
    const raw = state.index + direction;
    if (raw < 0) return state.repeat === 1 ? total - 1 : 0;
    if (raw >= total) return state.repeat === 1 ? 0 : total - 1;
    return raw;
  }

  function load(index, autoplay) {
    const wasPlaying = autoplay !== undefined ? autoplay : state.playing;
    if (ctx) releaseVoices(ctx.currentTime);
    state.index = (index + TRACKS.length) % TRACKS.length;
    state.offset = 0;
    state.ended = false;
    state.nextEvent = 0;
    state.playing = false;
    activeLine = -1;
    renderLyrics();
    if (wasPlaying) play();
    else render();
  }

  function step(direction) {
    const wasPlaying = state.playing;
    load(nextIndex(direction), wasPlaying);
  }

  function handleEnd() {
    const tr = TRACKS[state.index];
    if (state.repeat === 2) {
      seekTo(0, { silent: true });
      return;
    }
    const last = state.index === TRACKS.length - 1;
    if (last && state.repeat === 0 && !state.shuffle) {
      if (ctx) releaseVoices(ctx.currentTime);
      state.playing = false;
      state.ended = true;
      state.offset = tr.duration;
      render();
      return;
    }
    const wasPlaying = true;
    load(nextIndex(1), wasPlaying);
  }

  function tick() {
    if (document.documentElement.dataset.online === '1') return;
    if (!state.playing || !ctx) return;
    const now = currentTime();
    const events = timelineFor(state.index);
    while (state.nextEvent < events.length && events[state.nextEvent].t < now + LOOKAHEAD) {
      const event = events[state.nextEvent];
      const at = Math.max(ctx.currentTime + 0.02, ctx.currentTime + (event.t - now));
      fire(event, at);
      state.nextEvent++;
    }
    if (now >= TRACKS[state.index].duration) handleEnd();
  }

  function showAlert(message) {
    if (!message) {
      els.alert.hidden = true;
      els.alert.textContent = '';
      return;
    }
    els.alert.textContent = message;
    els.alert.hidden = false;
  }

  /* ---------------------------------------------------------------- render */

  function setText(el, value) {
    if (el.textContent !== value) el.textContent = value;
  }

  const queueRows = [];

  function renderQueue() {
    els.queue.innerHTML = '';
    queueRows.length = 0;
    TRACKS.forEach((tr, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'track-row' + (i === state.index ? ' is-current' : '');
      row.setAttribute('aria-current', i === state.index ? 'true' : 'false');
      row.setAttribute('aria-label', t('queue.play', { title: tr.title, artist: tr.artist }));

      const index = document.createElement('span');
      index.className = 'index';
      index.textContent = String(i + 1).padStart(2, '0');

      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = tr.cover;
      img.alt = '';
      img.width = 40;
      img.height = 40;
      img.loading = 'lazy';

      const meta = document.createElement('span');
      const title = document.createElement('span');
      title.className = 'row-title';
      title.textContent = tr.title;
      const artist = document.createElement('span');
      artist.className = 'row-artist';
      artist.textContent = tr.artist;
      meta.append(title, artist);

      const time = document.createElement('span');
      time.className = 'row-time';
      time.textContent = fmt(tr.duration);

      row.append(index, img, meta, time);
      row.addEventListener('click', () => load(i, true));
      els.queue.appendChild(row);
      queueRows.push(row);
    });
    setText(els.queueCount, t('queue.count', { count: TRACKS.length }));
  }

  function renderLyrics() {
    const tr = TRACKS[state.index];
    activeLine = -1;
    els.lyrics.scrollTop = 0;
    els.lyrics.innerHTML = '';
    if (!tr.lyrics.length) {
      const empty = document.createElement('p');
      empty.className = 'lyrics-empty';
      empty.textContent = t('lyrics.empty');
      els.lyrics.appendChild(empty);
      return;
    }
    tr.lyrics.forEach((line) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lyric-line';
      btn.dataset.time = String(line[0]);
      btn.textContent = line[1];
      btn.addEventListener('click', () => seekTo(line[0]));
      els.lyrics.appendChild(btn);
    });
  }

  let activeLine = -1;

  function syncLyrics(now) {
    const lines = TRACKS[state.index].lyrics;
    let next = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (now + 0.001 >= lines[i][0]) { next = i; break; }
    }
    if (next !== activeLine) {
      const nodes = els.lyrics.querySelectorAll('.lyric-line');
      nodes.forEach((node, i) => {
        node.classList.toggle('is-active', i === next);
        node.classList.toggle('is-past', i < next);
      });
      activeLine = next;
      if (next >= 0) els.lineTime.textContent = fmt(lines[next][0]);
      scrollActiveIntoView(nodes[next]);
    }
  }

  function scrollActiveIntoView(node) {
    if (!node) return;
    if (Date.now() - state.userScrolled < 2500) return;
    const box = els.lyrics;
    const target = node.offsetTop - (box.clientHeight - node.offsetHeight) / 2;
    box.scrollTo({ top: Math.max(0, target), behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function render() {
    // When online (YouTube) mode is active, leave the left panel to online.js
    if (document.documentElement.dataset.online === '1') return;
    if (window.__lineGridOnline && window.__lineGridOnline.isOnline()) return;

    const tr = TRACKS[state.index];
    const desiredCover = tr.cover;
    if (els.cover.getAttribute('src') !== desiredCover) els.cover.src = desiredCover;
    const coverAlt = t('cover.alt', { title: tr.title });
    if (els.cover.alt !== coverAlt) els.cover.alt = coverAlt;
    setText(els.title, tr.title);
    setText(els.artist, tr.artist);

    const now = currentTime();
    const duration = tr.duration;
    const shown = state.dragging ? clamp(Number(els.progress.value), 0, duration) : clamp(now, 0, duration);

    if (!state.dragging) {
      els.progress.max = String(duration);
      els.progress.value = String(shown);
    }
    const pct = duration ? (shown / duration) * 100 : 0;
    els.progress.style.setProperty('--fill', `${pct}%`);
    setText(els.elapsed, fmt(shown));
    setText(els.remaining, `-${fmt(Math.max(0, duration - shown))}`);

    const glyph = state.playing ? '❚❚' : '▶';
    if (els.playGlyph.textContent !== glyph) els.playGlyph.textContent = glyph;
    const playLabel = state.playing ? t('controls.pause') : t('controls.play');
    if (els.play.getAttribute('aria-label') !== playLabel) {
      els.play.setAttribute('aria-label', playLabel);
      els.play.setAttribute('title', playLabel);
    }

    const stateLabel = state.playing
      ? t('state.playing')
      : (state.ended ? t('state.ended') : (shown > 0.1 ? t('state.paused') : t('state.ready')));
    setText(els.state, `${stateLabel} · ${fmt(shown)}`);

    setText(els.shuffleText, state.shuffle ? t('meta.shuffleOn') : t('meta.shuffleOrder'));
    setText(els.repeatText, [t('meta.repeatOff'), t('meta.repeatAll'), t('meta.repeatOne')][state.repeat]);
    els.shuffle.classList.toggle('is-on', state.shuffle);
    els.shuffle.setAttribute('aria-pressed', String(state.shuffle));
    els.repeat.classList.toggle('is-on', state.repeat !== 0);

    queueRows.forEach((row, i) => {
      const current = i === state.index;
      if (row.classList.contains('is-current') !== current) {
        row.classList.toggle('is-current', current);
        row.setAttribute('aria-current', current ? 'true' : 'false');
      }
    });

    syncLyrics(now);
  }

  function renderAll() {
    TRACKS.forEach((tr) => { tr.art = t('cover.alt', { title: tr.title }); });
    renderQueue();
    activeLine = -1;
    renderLyrics();
    showAlert('');
    render();
  }

  /* ----------------------------------------------------------------- wiring */

  els.play.addEventListener('click', toggle);
  els.prev.addEventListener('click', () => step(-1));
  els.next.addEventListener('click', () => step(1));

  els.shuffle.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    render();
  });

  els.repeat.addEventListener('click', () => {
    state.repeat = (state.repeat + 1) % 3;
    render();
  });

  els.progress.addEventListener('input', () => {
    state.dragging = true;
    const value = Number(els.progress.value);
    const pct = value / TRACKS[state.index].duration * 100;
    els.progress.style.setProperty('--fill', `${pct}%`);
    els.elapsed.textContent = fmt(value);
    els.remaining.textContent = `-${fmt(Math.max(0, TRACKS[state.index].duration - value))}`;
  });
  els.progress.addEventListener('change', () => {
    state.dragging = false;
    seekTo(Number(els.progress.value));
  });

  els.volume.addEventListener('input', () => {
    if (master && ctx) master.gain.setTargetAtTime(Number(els.volume.value) * 0.9, ctx.currentTime, 0.03);
  });

  els.volume.addEventListener('change', () => {
    if (master && ctx) master.gain.setTargetAtTime(Number(els.volume.value) * 0.9, ctx.currentTime, 0.03);
  });

  els.lyrics.addEventListener('scroll', () => { state.userScrolled = Date.now(); }, { passive: true });

  document.addEventListener('keydown', (event) => {
    const tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || event.target.isContentEditable) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === ' ' || key === 'Spacebar' || key === 'k') {
      event.preventDefault();
      toggle();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      seekTo(currentTime() - 5);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      seekTo(currentTime() + 5);
    } else if (key === 'ArrowUp' || key === 'j' || key === 'J') {
      event.preventDefault();
      step(-1);
    } else if (key === 'ArrowDown' || key === 'l' || key === 'L') {
      event.preventDefault();
      step(1);
    }
  });

  window.addEventListener('eazo:localechange', renderAll);
  window.addEventListener('beforeunload', () => { if (ctx) releaseVoices(ctx.currentTime); });

  let lastTick = 0;
  function loop(now) {
    if (now - lastTick > 60) {
      lastTick = now;
      tick();
      render();
    }
    requestAnimationFrame(loop);
  }

  window.__lineGridPause = () => {
    if (state.playing) pause();
    state.playing = false;
    if (ctx) {
      try { releaseVoices(ctx.currentTime); } catch (_) {}
    }
  };

  const boot = () => {
    renderAll();
    requestAnimationFrame(loop);
  };

  if (window.eazoI18n && window.eazoI18n.ready) window.eazoI18n.ready.then(boot).catch(boot);
  else boot();
})();
