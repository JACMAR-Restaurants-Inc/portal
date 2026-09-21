/**
 * The framed front doors. Every sign-in to the portal and Cash Balancing passes
 * through one of these pages, so this runs each real page's script, with frame.js,
 * in a stub DOM and asserts on what the app is given and what the page accepts.
 * No dependencies: node built-ins only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0; const failures = []; const skipped = [];
const ok = (label, cond, detail) => cond ? passed++ : failures.push(label + (detail ? '  [' + detail + ']' : ''));
// A check that cannot run here must SAY so. A clean list of ok lines with a silent
// omission reads as "everything was checked" (RBAC CLAUDE.md §35's UNPROBEABLE).
const skip = (label, why) => skipped.push(label + '  [' + why + ']');

const FRAME_JS = fs.readFileSync(path.join(ROOT, 'frame.js'), 'utf8');

// The deployments, by id. The portal's is the one registered with Google (RBAC
// CLAUDE.md §16); the other two are Cash Balancing's trial and test.
const DEPLOY = {
  'index.html':                     'AKfycbw9ITLeoTRo1qI-MkmkAdPpId7GeqwT6LgL8V9igMxkPpQmVvK_WYqtwhkIcU4GuTDh',
  'cash-balancing/index.html':      'AKfycbzyfEGc760BCyS7OKbXQTzklaBdJGPnEG0c7-zkMFKurKRrlDPwiV7GDCXd9I5TINf-QQ',
  'cash-balancing-test/index.html': 'AKfycbw8ajAFSUJyMi9dPfTC3Wc7kSqZoNbqsPvEe8a5jXku-miS4NXgKbr__4GgocjI5cUb'
};
const execOf = (id) => 'https://script.google.com/macros/s/' + id + '/exec';

function load(page) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  return { html, inline };
}

// A DOM faithful enough that a page which stopped drawing something really has
// nothing to find. A stub that always answers is how a missing element passes
// (RBAC CLAUDE.md §65), so elements here are created, appended and removed for real.
function El(tag) {
  return {
    tagName: tag, children: [], attrs: {}, style: {}, parentNode: null,
    id: '', lang: '', textContent: '', hidden: false, src: '', alt: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
    }
  };
}
const find = (el, id) => {
  if (!el) return null;
  if (el.id === id) return el;
  for (const c of el.children || []) { const hit = find(c, id); if (hit) return hit; }
  return null;
};
const textOf = (el, id) => { const n = find(el, id); return n ? n.textContent : null; };
// Null safe on purpose: a page that drew nothing must fail by name, not crash the
// run and hide every assertion after it (RBAC CLAUDE.md §48).
const attr   = (el, k) => (el ? el.getAttribute(k) : null);
const hidden = (el, id) => { const n = find(el, id); return n ? n.hidden : null; };
const starts = (s, p) => typeof s === 'string' && s.indexOf(p) === 0;

// Runs a page: its inline config, then frame.js. Returns what happened.
function run(page, opts) {
  opts = opts || {};
  const { html, inline } = load(page);
  const store = Object.assign({}, opts.stored || {});
  const listeners = [];
  const inner = {};                 // the HtmlService page, two frames inside ours
  const middle = { parent: null };
  const contentWindow = { };
  contentWindow.parent = null;      // set below
  middle.parent = contentWindow;
  inner.parent = middle;
  const frameLoad = [];
  const frame = { contentWindow, addEventListener: (t, fn) => { if (t === 'load') frameLoad.push(fn); } };
  let replaced = null;
  const vars = {};
  const docEl = El('html');
  docEl.style.setProperty = (k, v) => { vars[k] = v; };
  const head = El('head');
  const body = El('body');
  // The tab icon the real page declares, answered the way querySelector would.
  const iconHref = (html.match(/<link rel="icon" type="image\/png" href="([^"]+)">/) || [])[1] || '';
  const iconLink = El('link');
  if (iconHref) iconLink.setAttribute('href', iconHref);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';

  // A clock we drive, so "after six seconds" is asserted rather than waited for.
  let now = 0, seq = 0;
  const timers = new Map();
  const tick = (ms) => {
    const until = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= until && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = until;
  };

  const win = {
    location: { search: opts.search || '', pathname: '/portal/' + page.replace('index.html', '') },
    history: { replaceState: (a, b, u) => { replaced = u; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: light)' ? !!opts.deviceLight : false }),
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    navigator: { language: 'language' in opts ? opts.language : 'fr-CA' },
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0) }); return id; },
    clearTimeout: (id) => { timers.delete(id); }
  };
  contentWindow.parent = win;
  win.parent = win;
  win.window = win;
  const sandbox = Object.assign(win, {
    document: {
      title,
      getElementById: (id) => (id === 'app' ? frame : null),
      querySelector: (sel) => (sel === 'link[rel="icon"]' && iconHref ? iconLink : null),
      createElement: (tag) => El(tag),
      documentElement: docEl, head, body
    },
    URLSearchParams
  });
  vm.createContext(sandbox);
  inline.forEach(s => vm.runInContext(s, sandbox));
  vm.runInContext(FRAME_JS, sandbox);
  const send = (data, origin, source) => listeners.forEach(fn => fn({ data, origin, source }));
  return { src: frame.src, replaced, store, send, inner, middle, contentWindow, docEl, body, head,
           cfg: sandbox.FRAME, listeners, vars, tick, title, iconHref,
           fireLoad: () => frameLoad.forEach(fn => fn()),
           hasLoadListener: () => frameLoad.length > 0,
           load: () => find(body, 'jmload') };
}

const GOOD_ORIGIN = 'https://n-abc123def-0lu-script.googleusercontent.com';

// ============================================================ every page
for (const page of Object.keys(DEPLOY)) {
  const { html, inline } = load(page);
  const APP = execOf(DEPLOY[page]);
  const P = page + ': ';

  ok(P + 'frames its one deployment', run(page).src === APP, run(page).src);
  ok(P + '...and no other address appears in the page',
     (html.match(/https:\/\/script\.google\.com\/[^'"\s]+/g) || []).join() === APP);
  ok(P + 'in a cookie-free frame', /<iframe credentialless id="app" title="[^"]+"><\/iframe>/.test(html));
  const src = (html.match(/<script src="([^"]+)"><\/script>/) || [])[1] || '';
  ok(P + 'loads frame.js by a relative path that exists',
     !!src && !/^\/|^https?:/.test(src) && fs.existsSync(path.join(ROOT, path.dirname(page), src)), src);
  ok(P + 'loads it after declaring FRAME', html.indexOf('window.FRAME') < html.indexOf('<script src='));
  const icon = (html.match(/<link rel="icon" type="image\/png" href="([^"]+)">/) || [])[1] || '';
  ok(P + 'has a tab icon that exists', !!icon && fs.existsSync(path.join(ROOT, path.dirname(page), icon)), icon);
  ok(P + 'is kept out of search results', /<meta name="robots" content="noindex">/.test(html));
  // viewport-fit=cover would put the app under an iPhone's notch: the frame's own
  // page cannot see the safe-area insets.
  ok(P + 'keeps the phone\'s safe areas', /content="width=device-width, initial-scale=1"/.test(html) && !/viewport-fit/.test(html));

  // --- a sign-in
  const r = run(page, { search: '?state=zz.x&code=4%2F0AX&authuser=1&scope=email&prompt=none' });
  ok(P + 'hands the app the state and code', r.src === APP + '?state=zz.x&code=4%2F0AX', r.src);
  ok(P + '...and nothing else Google appended', !/authuser|scope|prompt/.test(r.src));
  ok(P + '...then takes the code out of its own address', r.replaced === '/portal/' + page.replace('index.html', ''), r.replaced);
  ok(P + 'passes on a refusal from Google too', run(page, { search: '?error=access_denied' }).src === APP + '?error=access_denied');
  ok(P + 'never frames an address from the query string',
     run(page, { search: '?state=a&code=b&app=https://evil.invalid&dest=https://evil.invalid' }).src.indexOf('evil') === -1);
  ok(P + 'with nothing to pass on, shows the app and leaves its address alone',
     run(page).src === APP && run(page).replaced === null);
}

// ============================================================ preferences
const CB = 'cash-balancing/index.html', CBT = 'cash-balancing-test/index.html', PORTAL = 'index.html';

ok('each page keeps its preferences under its own name',
   new Set([PORTAL, CB, CBT].map(p => run(p).cfg.key)).size === 3);
ok('the portal saves a language only; Cash Balancing a language and a theme',
   run(PORTAL).cfg.prefs.join() === 'lang' && run(CB).cfg.prefs.join() === 'lang,theme' && run(CBT).cfg.prefs.join() === 'lang,theme');

// Saved here, handed to the app on the next load.
const back = run(CB, { stored: { 'jm.cash-balancing.lang': 'en', 'jm.cash-balancing.theme': 'light' } });
ok('a saved language and theme go to the app', back.src === execOf(DEPLOY[CB]) + '?jm_lang=en&jm_theme=light', back.src);
const both = run(CB, { search: '?state=s.safecount&code=c', stored: { 'jm.cash-balancing.lang': 'en' } });
ok('...alongside a sign-in', both.src === execOf(DEPLOY[CB]) + '?state=s.safecount&code=c&jm_lang=en', both.src);
ok('...but not another page\'s', run(CBT, { stored: { 'jm.cash-balancing.lang': 'en' } }).src === execOf(DEPLOY[CBT]));
ok('...and never a value the app does not know',
   run(CB, { stored: { 'jm.cash-balancing.lang': 'de', 'jm.cash-balancing.theme': '"><script>' } }).src === execOf(DEPLOY[CB]));
ok('...and the portal is never handed a theme',
   run(PORTAL, { stored: { 'jm.portal.lang': 'en', 'jm.portal.theme': 'dark' } }).src === execOf(DEPLOY[PORTAL]) + '?jm_lang=en');

// Messages from the app.
(() => {
  const r = run(CB);
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'en' }, GOOD_ORIGIN, r.inner);
  ok('the app, two frames down, saves its language here', r.store['jm.cash-balancing.lang'] === 'en', JSON.stringify(r.store));
  r.send({ type: 'jm-frame-pref', name: 'theme', value: 'light' }, GOOD_ORIGIN, r.middle);
  ok('...and its theme, from any frame inside ours', r.store['jm.cash-balancing.theme'] === 'light');
  ok('...and the ground behind the frame follows it', r.body.style.background === '#F2F8F4' && r.docEl.style.background === '#F2F8F4');
})();
(() => {
  const r = run(CB);
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'en' }, 'https://evil.invalid', r.inner);
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'en' }, 'https://script.google.com', r.inner);
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'en' }, 'https://x-script.googleusercontent.com.evil.invalid', r.inner);
  ok('a message from any other origin is ignored', Object.keys(r.store).length === 0, JSON.stringify(r.store));
  const stranger = { parent: null }; stranger.parent = stranger;
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'en' }, GOOD_ORIGIN, stranger);
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'en' }, GOOD_ORIGIN, null);
  ok('...and one from a window outside our frame', Object.keys(r.store).length === 0);
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'de' }, GOOD_ORIGIN, r.inner);
  r.send({ type: 'jm-frame-pref', name: 'colour', value: 'red' }, GOOD_ORIGIN, r.inner);
  r.send({ type: 'other', name: 'lang', value: 'en' }, GOOD_ORIGIN, r.inner);
  r.send('jm-frame-pref', GOOD_ORIGIN, r.inner);
  ok('...and one with an unknown name, value or type', Object.keys(r.store).length === 0, JSON.stringify(r.store));
})();
(() => {
  const r = run(PORTAL);
  r.send({ type: 'jm-frame-pref', name: 'theme', value: 'dark' }, GOOD_ORIGIN, r.inner);
  r.send({ type: 'jm-frame-pref', name: 'lang', value: 'en' }, GOOD_ORIGIN, r.inner);
  ok('the portal takes a language but not a theme',
     r.store['jm.portal.lang'] === 'en' && !('jm.portal.theme' in r.store), JSON.stringify(r.store));
})();

// The ground while the frame loads.
ok('Cash Balancing loads on charcoal by default', run(CB).body.style.background === '#1A1A1A');
ok('...on its light ground when the device asks', run(CB, { deviceLight: true }).body.style.background === '#F2F8F4');
ok('...and a saved theme beats the device', run(CB, { deviceLight: true, stored: { 'jm.cash-balancing.theme': 'dark' } }).body.style.background === '#1A1A1A');
ok('the portal is light whatever the device', run(PORTAL).body.style.background === '#F3F6FB');

// ============================================================ add to home screen
// A manifest is what lets a phone offer to install this, and what decides how the
// saved icon looks. Both are invisible from the page itself, so they are read here:
// the real PNG headers, not the names of the files.

// Width, height, colour type and whether the file carries any transparency at all,
// read out of the PNG itself - an icon that is the wrong size or see-through is the
// kind of thing nobody notices until it is on somebody's home screen.
function pngInfo(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  const sig = b.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  const out = { sig, w: b.readUInt32BE(16), h: b.readUInt32BE(20), colour: b[25], alpha: false };
  for (let i = 8; i + 8 <= b.length; ) {
    const len = b.readUInt32BE(i), type = b.slice(i + 4, i + 8).toString('ascii');
    // The builder writes a tRNS chunk on every file, so its PRESENCE proves nothing.
    // What matters is whether any palette entry in it is actually see-through.
    if (type === 'tRNS') {
      const t = b.slice(i + 8, i + 8 + len);
      for (let k = 0; k < t.length; k++) if (t[k] < 255) out.alpha = true;
    }
    if (type === 'IEND') break;
    i += 12 + len;
  }
  if (out.colour === 6 || out.colour === 4) out.alpha = true;   // RGBA / grey+alpha
  return out;
}

// The portal is the one people are told to add to their home screen. Cash Balancing's
// doors are reached from it, so they do not need one - but that is a decision, and it
// lives here rather than being inferred from which files happen to exist.
const MANIFEST_REQUIRED = ['index.html'];

for (const page of Object.keys(DEPLOY)) {
  const { html } = load(page);
  const M = page + ': ';
  const link = (html.match(/<link rel="manifest" href="([^"]+)">/) || [])[1];
  if (!link) {
    // A NAMED list, not "whatever happens to have one". Skipping any page without a
    // manifest meant deleting the portal's link turned its checks green (same shape as
    // guarded.test.js in the RBAC repo: the pages that must comply are written down).
    if (MANIFEST_REQUIRED.indexOf(page) !== -1) ok(M + 'has a web app manifest', false, 'no link in the page');
    else skip(M + 'has a web app manifest', 'this page does not offer one');
    continue;
  }

  const mpath = path.join(path.dirname(page), link);
  ok(M + 'links a manifest that exists', fs.existsSync(path.join(ROOT, mpath)), mpath);
  let m = null;
  try { m = JSON.parse(fs.readFileSync(path.join(ROOT, mpath), 'utf8')); } catch (e) { m = null; }
  ok(M + '...which is valid JSON', !!m);
  if (!m) continue;

  // Without these a phone will not offer to install it at all.
  ok(M + '...with a name and a short name', !!m.name && !!m.short_name);
  ok(M + '...a start url inside this folder', m.start_url === './' && m.scope === './', m.start_url);
  ok(M + '...and a display mode a phone can install',
     ['standalone', 'minimal-ui', 'fullscreen'].indexOf(m.display) !== -1, m.display);

  // The splash a phone paints before the page arrives. If it is not the ground the
  // page itself paints, launching flashes one colour and then another.
  const ground = (html.match(/html, ?body \{[^}]*background:(#[0-9A-Fa-f]{6})/) || [])[1];
  ok(M + '...on the same ground the page paints, so launching does not flash',
     !!ground && m.background_color.toLowerCase() === ground.toLowerCase(),
     m.background_color + ' vs ' + ground);
  const meta = (html.match(/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})">/) || [])[1];
  ok(M + '...and one theme colour, in the manifest and the page', !!meta && meta === m.theme_color,
     m.theme_color + ' vs ' + meta);

  // Every icon is real, and is the size it claims.
  (m.icons || []).forEach(function (ic) {
    const f = path.join(path.dirname(page), ic.src);
    const there = fs.existsSync(path.join(ROOT, f));
    ok(M + 'icon ' + ic.src + ' exists', there);
    if (!there) return;
    const info = pngInfo(f);
    const want = String(ic.sizes).split('x').map(Number);
    ok(M + '...is a PNG of the size it claims',
       info.sig && info.w === want[0] && info.h === want[1], info.w + 'x' + info.h);
  });

  const any = (m.icons || []).filter(ic => (ic.purpose || 'any').split(' ').indexOf('any') !== -1)
                             .map(ic => parseInt(ic.sizes, 10));
  ok(M + '...and an install has both sizes it looks for',
     any.some(n => n >= 192) && any.some(n => n >= 512), any.join(','));

  // Android crops an icon to a circle or a squircle. A maskable one has to keep the
  // mark inside the middle, and must not be see-through or the crop shows nothing.
  const mask = (m.icons || []).filter(ic => String(ic.purpose || '').split(' ').indexOf('maskable') !== -1);
  ok(M + '...and one drawn to survive being cropped round', mask.length >= 1);
  mask.forEach(ic => ok(M + '...which is opaque, so the crop is not see-through',
                        !pngInfo(path.join(path.dirname(page), ic.src)).alpha, ic.src));

  // iOS does not read the manifest. It takes this, fills any transparency with BLACK
  // and rounds the corners off - so it is its own file, opaque, with the mark inset.
  const touch = (html.match(/<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)">/) || [])[1];
  ok(M + 'has a 180px apple-touch-icon', !!touch, touch);
  if (touch) {
    const info = pngInfo(path.join(path.dirname(page), touch));
    ok(M + '...that really is 180x180', info.w === 180 && info.h === 180, info.w + 'x' + info.h);
    ok(M + '...and is opaque, so iOS does not fill it with black', !info.alpha);
    ok(M + '...and is not the same file as the tab icon', touch !== 'jm-portal-icon.png');
  }

  // Deliberate, and recorded so it is a decision rather than an omission: this would
  // open the icon with no Safari chrome, and sign-in has to leave for Google.
  // Comments stripped, because the comment in index.html explaining this decision has
  // to NAME the tag it is declining to use. Same family as the innerHTML check above.
  ok(M + 'does not claim iOS standalone until that round trip is tested',
     !/apple-mobile-web-app-capable/.test(html.replace(/<!--[\s\S]*?-->/g, '')));
}

// ============================================================ the loading screen
// An Apps Script page is blank for about 2s cold and about 8s coming back from a
// sign-in. §25 settled what to do about that for auth-redirect and the framed doors
// never got it: "blank and a brief message cost the same time; only one looks like
// it is working". These assert the screen a person sees during that wait.

const lum = (h) => {
  const v = [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

for (const page of Object.keys(DEPLOY)) {
  const P = page + ': ';
  const r = run(page);
  const box = r.load();

  ok(P + 'says something the moment it starts waiting', !!box);
  ok(P + '...with the app\'s own mark, the one on the tab',
     !!box && box.children.some(c => c.tagName === 'img' && c.src === r.iconHref), r.iconHref);
  ok(P + '...which is decorative, not a filename read aloud',
     !!box && box.children.filter(c => c.tagName === 'img').every(c => c.alt === ''));
  ok(P + '...a spinner, hidden from a screen reader',
     !!find(box, 'jmspin') && find(box, 'jmspin').getAttribute('aria-hidden') === 'true');
  ok(P + '...and a line of words', !!textOf(box, 'jmsay'));
  ok(P + 'is announced rather than silent',
     attr(box, 'role') === 'status' && attr(box, 'aria-live') === 'polite');

  // The app is uncovered when its frame loads. Without this it sits over a working app.
  ok(P + 'listens for the frame loading', r.hasLoadListener());
  const r2 = run(page); const b2 = r2.load();
  r2.fireLoad();
  ok(P + '...and gets out of the way when it does', attr(b2, 'data-done') === '');
  r2.tick(500);
  ok(P + '...then leaves the page entirely', !!b2 && r2.load() === null && b2.parentNode === null);

  // Covering a working app for ever is worse than uncovering one a beat early.
  const r3 = run(page); const b3 = r3.load();
  r3.tick(30000);
  ok(P + 'uncovers the app even if the frame never reports loading',
     attr(b3, 'data-done') === '');

  // Colour: whatever ground this page paints, the words and spinner must read on it.
  for (const theme of ['dark', 'light']) {
    const cfg = run(page).cfg;
    if (!cfg.bg[theme]) continue;
    ok(P + 'its loading text reads on the ' + theme + ' ground',
       ratio(cfg.ink[theme], cfg.bg[theme]) >= 4.5,
       cfg.ink[theme] + ' on ' + cfg.bg[theme] + ' = ' + ratio(cfg.ink[theme], cfg.bg[theme]).toFixed(2));
    ok(P + '...and so does its spinner',
       ratio(cfg.acc[theme], cfg.bg[theme]) >= 3,
       cfg.acc[theme] + ' on ' + cfg.bg[theme] + ' = ' + ratio(cfg.acc[theme], cfg.bg[theme]).toFixed(2));
  }

  // The whole point is that it changes nothing about the sign-in it is covering.
  const signIn = run(page, { search: '?state=zz.x&code=4%2F0AX' });
  ok(P + 'passes the app exactly what it did before',
     signIn.src === execOf(DEPLOY[page]) + '?state=zz.x&code=4%2F0AX', signIn.src);
}

// --- which wait it is, and in which language
(() => {
  const open = run(PORTAL);
  ok('opening names the app it is opening',
     textOf(open.load(), 'jmsay') === 'Ouverture de ' + open.title + '…',
     textOf(open.load(), 'jmsay'));
  const back = run(PORTAL, { search: '?state=s.portal&code=c' });
  // auth-redirect's own words, so the screen before this one and this one read as
  // one process rather than two pages.
  ok('coming back from Google says it is signing you in',
     textOf(back.load(), 'jmsay') === 'Connexion en cours…', textOf(back.load(), 'jmsay'));
  // auth-redirect is a SEPARATE REPOSITORY. Checking our wording against its file
  // works on a machine with both checked out side by side and cannot work in CI, where
  // only this repo exists - reading it there threw ENOENT and took the whole run down,
  // hiding every assertion after this line. So: checked when it is there, and
  // announced as not checked when it is not. Never silently green.
  const AR = path.join(ROOT, '..', 'auth-redirect', 'index.html');
  const words = ['Connexion en cours…', 'Signing you in…'];
  if (fs.existsSync(AR)) {
    const ar = fs.readFileSync(AR, 'utf8');
    ok('...and those are the words auth-redirect already uses', words.every(w => ar.includes(w)),
       words.filter(w => !ar.includes(w)).join(' / '));
  } else {
    skip('the sign-in line matches auth-redirect\'s wording',
         'auth-redirect is not checked out beside this repo');
  }

  ok('French by default, like both products',
     starts(textOf(run(PORTAL, { language: 'fr-CA' }).load(), 'jmsay'), 'Ouverture'));
  ok('...English for an English device',
     starts(textOf(run(PORTAL, { language: 'en-CA' }).load(), 'jmsay'), 'Opening '));
  ok('...and a saved language beats the device',
     starts(textOf(run(PORTAL, { language: 'en-CA', stored: { 'jm.portal.lang': 'fr' } }).load(), 'jmsay'),
            'Ouverture'));
  ok('...a saved language is used for the sign-in line too',
     textOf(run(PORTAL, { search: '?code=c', stored: { 'jm.portal.lang': 'en' } }).load(), 'jmsay')
       === 'Signing you in…');
})();

// --- the eight second wait gets a second line, §48's own pattern
(() => {
  const r = run(PORTAL, { search: '?state=s.portal&code=c' });
  const box = r.load();
  ok('the "still going" line is there from the start, unshown', hidden(box, 'jmwait') === true);
  r.tick(5900);
  ok('...and stays unshown while the wait is still ordinary', hidden(box, 'jmwait') === true);
  r.tick(200);
  ok('...then shows once it has run long', hidden(box, 'jmwait') === false);
  ok('...saying so in the reader\'s language',
     textOf(box, 'jmwait') === 'Cela prend un peu plus de temps.', textOf(box, 'jmwait'));
  const en = run(PORTAL, { language: 'en-CA' });
  const enBox = en.load(); en.tick(6100);
  ok('...or in English', textOf(enBox, 'jmwait') === 'This is taking a little longer.');
})();
(() => {
  // A screen that has gone must not come back, or a loaded app is covered again.
  const r = run(PORTAL);
  const box = r.load();
  r.fireLoad();
  r.tick(20000);
  ok('once it is gone nothing brings it back', hidden(box, 'jmwait') === true && r.load() === null);
})();

// --- the app may say it is ready, on the channel it already uses
(() => {
  const r = run(PORTAL);
  const box = r.load();
  r.send({ type: 'jm-frame-ready' }, GOOD_ORIGIN, r.inner);
  ok('the app saying it is ready clears the screen', attr(box, 'data-done') === '');
})();
(() => {
  const r = run(PORTAL);
  const box = r.load();
  r.send({ type: 'jm-frame-ready' }, 'https://evil.invalid', r.inner);
  const stranger = { parent: null }; stranger.parent = stranger;
  r.send({ type: 'jm-frame-ready' }, GOOD_ORIGIN, stranger);
  ok('...but only from inside our own frame, on an Apps Script origin',
     !!box && attr(box, 'data-done') === null);
})();

// --- the colours follow the theme, including one arriving mid-load
ok('the loading screen is painted on Cash Balancing\'s charcoal',
   run(CB).vars['--jm-bg'] === '#1A1A1A' && run(CB).vars['--jm-acc'] === '#FFC72C');
ok('...on its light ground when the device asks',
   run(CB, { deviceLight: true }).vars['--jm-bg'] === '#F2F8F4' &&
   run(CB, { deviceLight: true }).vars['--jm-acc'] === '#1B5E37');
ok('the portal\'s is light whatever the device',
   run(PORTAL).vars['--jm-bg'] === '#F3F6FB' && run(PORTAL).vars['--jm-ink'] === '#0B2556');
(() => {
  const r = run(CB);
  r.send({ type: 'jm-frame-pref', name: 'theme', value: 'light' }, GOOD_ORIGIN, r.inner);
  ok('a theme arriving while it waits recolours the loading screen too',
     r.vars['--jm-bg'] === '#F2F8F4' && r.vars['--jm-acc'] === '#1B5E37', JSON.stringify(r.vars));
})();

// --- two properties with no layout engine to check them (§26), read from the source
ok('a spinner that cannot spin is drawn as a ring, not left broken',
   /prefers-reduced-motion:reduce\)\{[^}]*#jmload\{transition:none\}[\s\S]*?animation:none/.test(FRAME_JS));
ok('the loading screen covers the frame rather than sitting beside it',
   /#jmload\{position:fixed;inset:0;z-index:2;/.test(FRAME_JS));
// A centred flex item takes its content width, so a long enough line would run off
// both edges rather than wrap. No title is close today (253px inside 360px, measured),
// so this holds the headroom - and there is no layout engine here to catch losing it (§26).
ok('a long line would wrap rather than run off the screen',
   /#jmsay\{[^}]*max-width:100%/.test(FRAME_JS) && /#jmwait\{[^}]*max-width:100%/.test(FRAME_JS));
// Comments stripped: the line in frame.js explaining this rule NAMES innerHTML, so
// reading the raw file fails on its own explanation. One more of the family RBAC
// CLAUDE.md keeps counting (§26, §33, §38, §44, §45, §52, §60, §68).
const FRAME_CODE = FRAME_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('the words are written as text, never as markup', !/innerHTML/.test(FRAME_CODE));

console.log('\nportal (framed front doors)');
console.log('---------------------------');
skipped.forEach(sk => console.log('  SKIP  ' + sk));
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\n' + failures.length + ' FAILED, ' + passed + ' passed' +
              (skipped.length ? ', ' + skipped.length + ' skipped' : ''));
  process.exit(1);
}
console.log('  ' + passed + ' passed, 0 failed' +
            (skipped.length ? ', ' + skipped.length + ' skipped' : ''));
