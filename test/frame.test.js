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
let passed = 0; const failures = [];
const ok = (label, cond, detail) => cond ? passed++ : failures.push(label + (detail ? '  [' + detail + ']' : ''));

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

// Runs a page: its inline config, then frame.js. Returns what happened.
function run(page, opts) {
  opts = opts || {};
  const { inline } = load(page);
  const store = Object.assign({}, opts.stored || {});
  const listeners = [];
  const inner = {};                 // the HtmlService page, two frames inside ours
  const middle = { parent: null };
  const contentWindow = { };
  contentWindow.parent = null;      // set below
  middle.parent = contentWindow;
  inner.parent = middle;
  const frame = { contentWindow };
  let replaced = null;
  const docEl = { style: {}, lang: 'fr' };
  const win = {
    location: { search: opts.search || '', pathname: '/portal/' + page.replace('index.html', '') },
    history: { replaceState: (a, b, u) => { replaced = u; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: light)' ? !!opts.deviceLight : false }),
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); }
  };
  contentWindow.parent = win;
  win.parent = win;
  win.window = win;
  const sandbox = Object.assign(win, {
    document: { getElementById: (id) => (id === 'app' ? frame : null), documentElement: docEl, body: { style: {} } },
    URLSearchParams
  });
  vm.createContext(sandbox);
  inline.forEach(s => vm.runInContext(s, sandbox));
  vm.runInContext(FRAME_JS, sandbox);
  const send = (data, origin, source) => listeners.forEach(fn => fn({ data, origin, source }));
  return { src: frame.src, replaced, store, send, inner, middle, contentWindow, docEl, body: sandbox.document.body,
           cfg: sandbox.FRAME, listeners };
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

console.log('\nportal (framed front doors)');
console.log('---------------------------');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\n' + failures.length + ' FAILED, ' + passed + ' passed');
  process.exit(1);
}
console.log('  ' + passed + ' passed, 0 failed');
