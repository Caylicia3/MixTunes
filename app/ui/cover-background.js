'use strict';

((root) => {
  const STORAGE_KEY = 'mixtunes-background-mode';
  const playableStates = new Set(['loading', 'buffering', 'playing', 'paused', 'ended']);

  function sourceFor(state, allowDataImages = false) {
    if (!state?.currentKey || !playableStates.has(state.status)) return '';
    const track = state.currentTrack?.key === state.currentKey ? state.currentTrack
      : (state.tracks || []).find((item) => item.key === state.currentKey);
    if (!track || !['qq', 'netease', 'bilibili'].includes(track.platform)) return '';
    const source = track.coverUrl;
    if (typeof source !== 'string' || source.length > 2 * 1024 * 1024) return '';
    try {
      const url = new URL(source);
      if (url.username || url.password) return '';
      if (url.protocol === 'https:') return url.href;
      if (allowDataImages && /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(source)) return source;
    } catch {}
    return '';
  }

  function create({ container, documentRoot = root.document.documentElement, storage,
    makeImage = () => new root.Image(), allowDataImages = false, onStorageError = () => {},
    schedule = root.setTimeout.bind(root), cancel = root.clearTimeout.bind(root) }) {
    let enabled = false, mode = 'theme', custom = null, opacity = 100, latest = {}, source = '', serial = 0, pending = null, timer = null;
    const removalTimers = new Map();
    try {
      if (storage === undefined) storage = root.localStorage;
      mode = storage?.getItem(STORAGE_KEY);
      if (!['theme', 'current-cover', 'custom'].includes(mode)) mode = 'theme';
      enabled = mode === 'current-cover';
      const savedOpacity = storage?.getItem('mixtunes-background-opacity');
      if (savedOpacity !== null && savedOpacity !== undefined && savedOpacity !== '' && Number.isFinite(Number(savedOpacity))) opacity = Math.max(0, Math.min(100, Number(savedOpacity)));
    } catch { onStorageError(); }
    container.style?.setProperty('--background-opacity', String(opacity / 100));
    function layoutCustom() {
      if (mode !== 'custom' || !custom || !root.mixTunesBackgroundImage) return;
      const box = container.getBoundingClientRect();
      for (const image of container.children) {
        if (!image.naturalWidth || !image.naturalHeight) continue;
        const rect = root.mixTunesBackgroundImage.layout(image.naturalWidth, image.naturalHeight, box.width, box.height, custom.crop);
        for (const name of ['left', 'top', 'width', 'height']) image.style[name] = rect[name] + 'px';
      }
    }
    const observer = typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(layoutCustom) : null;
    observer?.observe(container);

    function clearPending() {
      if (timer !== null) cancel(timer);
      timer = null;
      if (pending) { pending.onload = null; pending.onerror = null; pending.removeAttribute('src'); pending = null; }
    }
    function remove(image) {
      if (removalTimers.has(image)) cancel(removalTimers.get(image));
      removalTimers.delete(image);
      image.remove();
      image.removeAttribute('src');
    }
    function reset() {
      serial++; clearPending();
      documentRoot.classList.remove('has-cover-background');
      for (const image of Array.from(container.children)) remove(image);
    }
    function update(snapshot) {
      latest = snapshot || {};
      const next = mode === 'custom' ? (custom?.image || '') : enabled ? sourceFor(latest, allowDataImages) : '';
      if (next === source) return;
      source = next;
      const request = ++serial;
      clearPending();
      if (!next) { reset(); return; }
      // Fade the previous content away while loading; never leave a different song's cover on screen.
      for (const image of container.children) image.style.opacity = '0';
      const image = makeImage();
      if (mode === 'custom') image.className = 'custom-background-image';
      pending = image;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      const failed = () => { if (request === serial) { reset(); if (mode === 'custom') { mode = 'theme'; try { storage?.setItem(STORAGE_KEY, mode); } catch { onStorageError(); } container.dispatchEvent?.(new root.Event('background-failed')); } } };
      image.onerror = failed;
      image.onload = () => {
        if (request !== serial) return;
        if (!image.naturalWidth || !image.naturalHeight) { failed(); return; }
        cancel(timer); timer = null; pending = null;
        image.onload = null; image.onerror = null;
        // Two visible buffers at most, including rapid cached transitions.
        while (container.children.length > 1) remove(container.children[0]);
        const previous = container.children[0];
        container.appendChild(image);
        if (opacity > 0) documentRoot.classList.add('has-cover-background');
        layoutCustom();
        void image.offsetWidth;
        image.style.opacity = '1';
        if (previous) removalTimers.set(previous, schedule(() => remove(previous), 240));
      };
      timer = schedule(failed, 12000);
      image.src = next;
    }
    return {
      update,
      enabled: () => enabled,
      mode: () => mode,
      opacity: () => opacity,
      custom: () => custom,
      setMode(value) {
        const nextMode = ['theme', 'current-cover', 'custom'].includes(value) ? value : 'theme';
        const changed = nextMode !== mode;
        mode = nextMode;
        enabled = mode === 'current-cover';
        let saved = true;
        try { if (!storage) throw Error('Settings unavailable'); storage.setItem(STORAGE_KEY, mode); } catch { saved = false; onStorageError(); }
        // A mode switch can reuse the same pixels, but must reset their layout.
        if (changed) { source = ''; reset(); }
        update(latest);
        return saved;
      },
      setCustom(value) { custom = value; if (mode === 'custom') { update(latest); layoutCustom(); } },
      setOpacity(value) {
        opacity = Math.max(0, Math.min(100, Number(value) || 0));
        container.style?.setProperty('--background-opacity', String(opacity / 100));
        if (!opacity) documentRoot.classList.remove('has-cover-background');
        else if (container.children.length) documentRoot.classList.add('has-cover-background');
        try { if (!storage) throw Error('Settings unavailable'); storage.setItem('mixtunes-background-opacity', String(opacity)); return true; } catch { onStorageError(); return false; }
      },
      setEnabled(value) {
        enabled = Boolean(value);
        mode = enabled ? 'current-cover' : 'theme';
        try {
          if (!storage) throw new Error('Settings storage unavailable');
          storage.setItem(STORAGE_KEY, enabled ? 'current-cover' : 'theme');
        } catch { onStorageError(); }
        update(latest);
      },
      destroy() { source = ''; reset(); observer?.disconnect(); },
    };
  }

  const api = { STORAGE_KEY, sourceFor, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mixTunesCoverBackground = api;
})(globalThis);
