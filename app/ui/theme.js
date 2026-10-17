'use strict';

// This external script runs in <head> before the stylesheet, so the first
// painted frame already uses the user's choice. Storage may be unavailable.
(() => {
  const key = 'mixlink-theme';
  let current = 'light';
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') current = saved;
  } catch {}
  const apply = (theme) => {
    current = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', current);
    return current;
  };
  apply(current);
  const setTheme = (theme) => {
    const previous = current;
    apply(theme);
    try { window.localStorage.setItem(key, current); } catch {}
    if (previous !== current) window.dispatchEvent(new CustomEvent('mixlink-theme-change', { detail: { theme: current } }));
    return current;
  };
  window.mixlinkTheme = Object.freeze({
    get: () => current,
    set: setTheme,
    toggle: () => setTheme(current === 'light' ? 'dark' : 'light'),
  });
})();
