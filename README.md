# portal

The addresses people open for **JM Portal** and **Cash Balancing**.

| Address | Shows |
|---|---|
| `https://jacmar-restaurants-inc.github.io/portal/` | JM Portal |
| `https://jacmar-restaurants-inc.github.io/portal/cash-balancing/` | Cash Balancing, the RBAC trial on the production script |
| `https://jacmar-restaurants-inc.github.io/portal/cash-balancing-test/` | Cash Balancing's test script |

Version 36 of Cash Balancing, which Aylmer and Vanier use, is not here and not affected.

## Why this exists

Both apps are Google Apps Script web apps. Opened directly at `script.google.com`, in a
browser signed into **more than one Google account**, Google's account router answers
first and fails with *"Sorry, unable to open the file at this time"*. The app never runs,
so nothing in it can help. A private window works, because it sends no Google cookies.
On personal phones several accounts is the normal case.

Each page here shows its app **inside a frame on this site**, where the browser keeps
Google's cookies out of it: iPhone browsers block cross-site cookies, Chrome honours the
frame's `credentialless` attribute, Firefox partitions cookies per site. Google sees an
anonymous visitor, as in a private window, and the app loads. RBAC `CLAUDE.md` §49 has
the measurements.

## What the pages do

`frame.js`, shared by all three:

1. **Passes on a sign-in.** Google returns to `auth-redirect`, which forwards the
   one-time code here. Only `state`, `code` and `error` reach the app, and the code is
   removed from this page's address straight away.
2. **Remembers language and theme** for the app. Inside the frame Chrome gives the app
   storage that is thrown away when the page closes. The app tells this page when a
   choice changes, and this page hands it back on the next load.
3. **Paints the app's own ground** while the frame loads.

Each page frames **one fixed deployment**, written in the page. An address taken from the
URL would make these pages an open redirect.

## What they do not do

No sign-in, no tokens, no secrets. The Google sign-in, the code exchange and every access
decision still happen inside the apps.

This repository is public because GitHub Pages requires it.

## Changing things

- **A deployment id changes:** edit the page's `app`, and the id in `test/frame.test.js`.
  The apps' own deployments are updated, never recreated, so this should be rare.
- **The addresses change** (for example a custom domain): the apps, the RBAC library and
  `auth-redirect` all name these addresses. RBAC `CLAUDE.md` §52 lists every place.

`npm test` runs the pages in a stub DOM. No dependencies.

The icons are copies: `jm-portal-icon.png` from `RBAC/designs/branding/`, and
`cash-balancing-icon.png` from `auth-redirect`.
