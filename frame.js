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
 *   ink    { light, dark } - the text on that ground, while it loads
 *   acc    { light, dark } - the spinner on that ground, while it loads
 *
 * It does four things and nothing else:
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
 *
 * 4. SAYS SOMETHING WHILE THE APP LOADS. An Apps Script page takes about two
 *    seconds to open cold, and about eight to come back from a sign-in, and until
 *    it answers, this page is a coloured rectangle with an empty frame on it. That
 *    reads as frozen. RBAC CLAUDE.md §25 already settled what to do, for the
 *    auth-redirect page that sits between these two screens: "blank and a brief
 *    message cost the same time; only one looks like it is working". So this paints
 *    the app's own mark, a spinner and one line, on the ground it was going to paint
 *    anyway, and clears it when the frame loads.
 *
 *    Presentation only. It passes nothing, stores nothing, and cannot change what
 *    the app decides. It is built here rather than written into each page's HTML so
 *    there is ONE copy of the markup, the words and the timing; the cost is that it
 *    paints after this file loads rather than with the page, which is one small
 *    request to this same origin against the seconds it is covering.
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

  /**
   * Dark or light, once, so the ground and the loading screen can never disagree
   * about it. With nothing saved, follow the app's own default: Cash Balancing is
   * dark unless the device asks for light (safe-count Styles.html).
   */
  function isDark() {
    var theme = readPref('theme');
    if (theme) return theme === 'dark';
    return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function paint() {
    var dark = isDark();
    var pick = function (set) { var s = set || {}; return (dark ? s.dark : s.light) || s.light; };
    var c = pick(cfg.bg), ink = pick(cfg.ink), acc = pick(cfg.acc);
    var root = document.documentElement;
    if (c) {
      root.style.background = c;
      if (document.body) document.body.style.background = c;
    }
    // The loading screen reads these, so a theme arriving mid-load recolours it too.
    if (root.style.setProperty) {
      if (c)   root.style.setProperty('--jm-bg', c);
      if (ink) root.style.setProperty('--jm-ink', ink);
      if (acc) root.style.setProperty('--jm-acc', acc);
    }
    var lang = readPref('lang');
    if (lang) root.lang = lang;
  }

  // ------------------------------------------------- 4: saying it is working

  // French first: it is the default on both products (RBAC CLAUDE.md §26). The
  // sign-in line is auth-redirect's own wording, so the screen a person has just
  // come from and this one read as one process rather than two pages.
  var WORDS = {
    open:   { fr: 'Ouverture de ',                    en: 'Opening ' },
    signin: { fr: 'Connexion en cours…',              en: 'Signing you in…' },
    slow:   { fr: 'Cela prend un peu plus de temps.', en: 'This is taking a little longer.' }
  };
  // TWELVE, NOT SIX (owner, 2026-09-22): at six it fired "just as the app is
  // opening", which is noise rather than reassurance - §68 measured the sign-in leg
  // at about eight seconds cold, so six was inside an ordinary wait rather than
  // past it. Twelve clears that, so an ordinary slow sign-in never shows this line
  // and only a genuinely stuck one does. It must stay well under FAILSAFE_MS below,
  // or the screen it explains is gone before the explanation arrives.
  var SLOW_AFTER_MS = 12000;
  // If the frame's load event never arrives, this must not sit on top of a working
  // app for ever. Uncovering early is the status quo; covering for ever is not.
  var FAILSAFE_MS = 30000;
  var FADE_MS = 220;

  var CSS = [
    '#jmload{position:fixed;inset:0;z-index:2;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:16px;padding:24px;',
    'box-sizing:border-box;text-align:center;background:var(--jm-bg,#fff);',
    'color:var(--jm-ink,#333);transition:opacity ', FADE_MS, 'ms ease;',
    "font:400 15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
    '#jmload[data-done]{opacity:0;pointer-events:none}',
    '#jmload img{width:56px;height:56px;display:block}',
    '#jmspin{width:26px;height:26px;border-radius:50%;',
    'border:3px solid rgba(128,128,128,.35);border-top-color:var(--jm-acc,#888);',
    'animation:jmspin .8s linear infinite}',
    // A flex item centred on the cross axis takes its CONTENT width, so a long
    // enough line would overrun the box on both sides rather than wrap. Today's
    // longest, "Ouverture de Cash Balancing (test)…", measures 253px inside a
    // 360px viewport, so this is headroom rather than a fix - and one declaration
    // is cheaper than finding out when an app with a longer name is added.
    '#jmsay{margin:0;max-width:100%}',
    '#jmwait{margin:0;max-width:100%;font-size:13px;opacity:.75}',
    '@keyframes jmspin{to{transform:rotate(360deg)}}',
    // A spinner that cannot spin is just a broken ring (auth-redirect's own rule).
    '@media (prefers-reduced-motion:reduce){',
    '#jmload{transition:none}',
    '#jmspin{animation:none;border-right-color:var(--jm-acc,#888)}}'
  ].join('');

  function language() {
    var saved = readPref('lang');
    if (saved) return saved;
    var nav = '';
    try { nav = String(window.navigator && window.navigator.language || '').toLowerCase(); } catch (e) {}
    return nav.indexOf('en') === 0 ? 'en' : 'fr';
  }

  var loading = null, slowTimer = null, failTimer = null;

  function showLoading(signingIn) {
    var style = document.createElement('style');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    var box = document.createElement('div');
    box.id = 'jmload';
    // Announced to a screen reader, which otherwise meets the same silence.
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');

    // The tab icon, which every page already declares and the app already owns.
    // Taken from the page rather than configured again, so the two cannot drift.
    var link = document.querySelector('link[rel="icon"]');
    var href = link && link.getAttribute('href');
    if (href) {
      var img = document.createElement('img');
      img.src = href;
      img.alt = '';                       // decorative: the line below says it
      box.appendChild(img);
    }

    var spin = document.createElement('div');
    spin.id = 'jmspin';
    spin.setAttribute('aria-hidden', 'true');
    box.appendChild(spin);

    var lang = language();
    var say = document.createElement('p');
    say.id = 'jmsay';
    // textContent, never innerHTML: the title is ours, and it stays that way.
    say.textContent = signingIn ? WORDS.signin[lang]
                                : WORDS.open[lang] + (document.title || '') + '…';
    box.appendChild(say);

    var wait = document.createElement('p');
    wait.id = 'jmwait';
    wait.hidden = true;
    wait.textContent = WORDS.slow[lang];
    box.appendChild(wait);

    (document.body || document.documentElement).appendChild(box);
    loading = box;

    slowTimer = setTimeout(function () { wait.hidden = false; }, SLOW_AFTER_MS);
    failTimer = setTimeout(hideLoading, FAILSAFE_MS);
  }

  function hideLoading() {
    if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
    if (failTimer) { clearTimeout(failTimer); failTimer = null; }
    if (!loading) return;
    var gone = loading;
    loading = null;
    gone.setAttribute('data-done', '');   // fades, then leaves
    setTimeout(function () {
      if (gone.parentNode) gone.parentNode.removeChild(gone);
    }, FADE_MS);
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
  // A `code` means Google has just sent them back, so this is the wait after
  // signing in rather than the wait on opening. Same page, different sentence.
  showLoading(!!incoming.get('code'));
  paint();
  var qs = out.toString();
  frame.src = qs ? cfg.app + '?' + qs : cfg.app;
  frame.addEventListener('load', hideLoading);
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
    if (!d || typeof d !== 'object') return;
    if (d.type !== 'jm-frame-pref' && d.type !== 'jm-frame-ready') return;
    if (!APP_ORIGIN.test(String(ev.origin))) return;
    if (!insideOurFrame(ev.source)) return;
    // The app saying it has drawn itself. The frame's own load event fires when the
    // HtmlService wrapper loads, which can be a beat before the app's page paints,
    // so an app that sends this is uncovered at exactly the right moment. Nothing
    // sends it yet; the load event is what clears the screen today.
    if (d.type === 'jm-frame-ready') { hideLoading(); return; }
    if (!allowed(d.name, d.value)) return;
    try { window.localStorage.setItem(storeKey(d.name), d.value); } catch (e) {}
    paint();
  });
})();
