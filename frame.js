/*
 * THE FRAMED FRONT DOOR. Shared by every page in this site.
 *
 * Why it exists (RBAC CLAUDE.md §49). Opening an Apps Script web app directly, in
 * a browser signed into more than one Google account, dies at Google's account
 * router - "Sorry, unable to open the file at this time" - before the app runs.
 * Nothing in the app can answer it, because the request never reaches the app.
 * A private window works, because no Google cookies are sent.
 *
 * So each page here shows its app INSIDE a frame on this (non-Google) site, where
 * the browser keeps Google's cookies out of it:
 *   - every iPhone browser (all WebKit) blocks cross-site cookies by default;
 *   - Chrome honours `credentialless`, which loads the frame with no cookies at all;
 *   - Firefox partitions cookies per site, so the frame's jar is empty.
 * Google then sees an anonymous visitor - the private-window case - and the app loads.
 *
 * Each page declares window.FRAME before loading this file:
 *   app    the ONE deployment it shows. Never taken from the address bar: a
 *          destination read from the URL would make this page an open redirect.
 *   key    a name for this page's saved preferences
 *   prefs  which preferences the app may save here: 'lang', 'theme'
 *   bg     { light, dark } - the ground behind the frame while it loads
 *
 * It does three things and nothing else:
 *
 * 1. PASSES ON A SIGN-IN. Google returns to auth-redirect, which forwards the
 *    one-time `code` here. Only state, code and error go to the app, and the code
 *    is removed from this page's own address at once, so a reload, a bookmark or
 *    the history never carries a spent one.
 *
 * 2. REMEMBERS LANGUAGE AND THEME FOR THE APP. Inside a credentialless frame
 *    Chrome gives the app a storage that is thrown away when the page closes, so
 *    the app would forget them every visit. The app tells this page when one
 *    changes (postMessage); this page keeps it and hands it back on the next load
 *    as jm_lang / jm_theme, which the app's server writes into its page before
 *    anything reads it. A message is accepted only from inside this page's own
 *    frame, from an Apps Script origin, and only for a known name and value - the
 *    worst anybody else could do is nothing.
 *
 * 3. PAINTS THE RIGHT GROUND while the frame loads, so a dark app does not flash
 *    white first.
 */
(function () {
  var cfg = window.FRAME || {};
  var frame = document.getElementById('app');
  if (!frame || !cfg.app) return;

  var ALLOWED = { lang: ['fr', 'en'], theme: ['light', 'dark'] };
  // The origin an HtmlService page runs on: https://n-<id>-script.googleusercontent.com
  var APP_ORIGIN = /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/;

  function allowed(name, value) {
    return (cfg.prefs || []).indexOf(name) !== -1 && !!ALLOWED[name] &&
           ALLOWED[name].indexOf(value) !== -1;
  }
  function storeKey(name) { return 'jm.' + cfg.key + '.' + name; }
  function readPref(name) {
    var v = null;
    try { v = window.localStorage.getItem(storeKey(name)); } catch (e) {}
    return allowed(name, v) ? v : '';
  }
  function paint() {
    var bg = cfg.bg || {};
    var theme = readPref('theme');
    // With nothing saved, follow the app's own default: Cash Balancing is dark unless
    // the device asks for light (safe-count Styles.html).
    var dark = theme ? theme === 'dark'
      : !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    var c = (dark ? bg.dark : bg.light) || bg.light;
    if (c) {
      document.documentElement.style.background = c;
      if (document.body) document.body.style.background = c;
    }
    var lang = readPref('lang');
    if (lang) document.documentElement.lang = lang;
  }

  // 1 and 2: what the app is given.
  var incoming = new URLSearchParams(window.location.search);
  var out = new URLSearchParams();
  ['state', 'code', 'error'].forEach(function (k) {
    var v = incoming.get(k);
    if (v) out.set(k, v);
  });
  (cfg.prefs || []).forEach(function (name) {
    var v = readPref(name);
    if (v) out.set('jm_' + name, v);
  });
  paint();
  var qs = out.toString();
  frame.src = qs ? cfg.app + '?' + qs : cfg.app;
  if (window.location.search) {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) {}
  }

  // Is this window our frame, or inside it? An HtmlService page runs two frames
  // deep inside the deployment's page. Reading .parent across origins is allowed.
  function insideOurFrame(w) {
    var target = frame.contentWindow;
    for (var i = 0; i < 4 && w; i++) {
      if (w === target) return true;
      try { if (w === w.parent) return false; w = w.parent; } catch (e) { return false; }
    }
    return false;
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object' || d.type !== 'jm-frame-pref') return;
    if (!APP_ORIGIN.test(String(ev.origin))) return;
    if (!insideOurFrame(ev.source)) return;
    if (!allowed(d.name, d.value)) return;
    try { window.localStorage.setItem(storeKey(d.name), d.value); } catch (e) {}
    paint();
  });
})();
