# Simply Connect — Agent Sales Submission Web App

A static frontend (HTML/CSS/JS, deployable on Vercel or any static host) that
talks to a Google Apps Script Web App acting as a JSON API. Agent submissions
are saved to a Google Sheet, matched **by column header name** — so you can
reorder, add, or remove sheet columns without breaking anything, as long as
the header text stays the same.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | Page markup — login screen, sales form, history drawer, modals |
| `style.css` | All styling — yellow / white / dark-gray corporate theme (unchanged design) |
| `script.js` | All client logic — login, form rendering, validation, API calls |
| `assets/logo.png` | Your Simply Connect logo |
| `Code.gs` | Google Apps Script backend — JSON API + Google Sheet read/write |

Nothing about the design, layout, or form behavior was changed — only the
architecture (Apps Script HTML templating → static site + JSON API).

---

## 1. Deploy the Google Apps Script backend (API)

1. Create a new Google Sheet (or open the one you want submissions saved to).
2. In the Sheet, go to **Extensions → Apps Script**.
3. Delete the default `Code.gs` content and paste in this project's `Code.gs`.
4. Save the project (e.g. name it "Agent Sales API").
5. Click **Deploy → New deployment**.
6. Click the gear icon next to "Select type" → choose **Web app**.
7. Settings:
   - **Execute as:** Me (your account)
   - **Who has access:** **Anyone** — required so your public Vercel site can
     reach it. (Agent identity is still validated server-side against the
     roster in `CONFIG.agentNames`, so this is safe — nobody can write to
     the sheet as an unlisted "agent.")
8. Click **Deploy**, authorize the requested permissions (Sheets + Drive,
   for the screenshot upload feature), and **copy the Web app URL** — it
   looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

You'll need that URL in step 2 below. Every time you edit `Code.gs`, go to
**Deploy → Manage deployments → Edit (pencil icon) → New version** so the
live API picks up your changes — just saving the file isn't enough.

The script automatically creates two tabs the first time it runs:
- **Submissions** — every sale, with a header row (53 columns).
- **Login Log** — a simple audit trail of agent sign-ins/sign-outs.

---

## 2. Point the frontend at your API

Open `script.js` and find this near the top:

```js
var API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

Replace it with the Web app URL you copied in step 1, e.g.:

```js
var API_URL = 'https://script.google.com/macros/s/AKfycbz.../exec';
```

Save the file.

---

## 3. Push the frontend to GitHub

```bash
# From inside this folder (index.html, style.css, script.js, assets/, Code.gs)
git init
git add .
git commit -m "Agent Sales Portal — static frontend + Apps Script API"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/agent-sales-portal.git
git push -u origin main
```

(No git installed, or prefer the website? Create a new repo on
[github.com](https://github.com) → **Add file → Upload files** → drag in
`index.html`, `style.css`, `script.js`, and the `assets` folder, then commit.
`Code.gs` can go in the same repo for version history, even though it isn't
deployed from GitHub — it lives in the Apps Script editor.)

Use a **private** repo if you'd rather keep the agent roster and internal
field lists out of public view.

---

## 4. Deploy the frontend on Vercel

1. Go to [vercel.com](https://vercel.com) and log in (GitHub login is easiest).
2. Click **Add New → Project**.
3. Select the GitHub repo you just pushed.
4. Framework preset: choose **Other** (this is a plain static site — no
   build step needed).
5. Leave build/output settings blank and click **Deploy**.
6. Vercel gives you a live URL like `https://agent-sales-portal.vercel.app` —
   share that with your agents.

Any time you push a change to the `main` branch on GitHub, Vercel
automatically redeploys the site.

---

## 5. How the pieces talk to each other

- The frontend calls your Apps Script Web App over `fetch()`:
  - `GET  ?action=config` — loads the agent roster + all dropdown options on page load
  - `GET  ?action=validateAgent&agent=NAME` — checks login against the roster
  - `GET  ?action=history&agent=NAME` — loads an agent's past submissions
  - `POST { action: 'submit', ...fields }` — saves a sale
  - `POST { action: 'logout', agentName }` — logs the sign-out
- POST requests are sent with `Content-Type: text/plain` on purpose — Apps
  Script doesn't handle the CORS preflight that `application/json` would
  trigger from a browser, so `text/plain` keeps it a "simple request" while
  the body is still parsed as JSON server-side (`JSON.parse(e.postData.contents)`
  in `doPost`). This is the standard, widely-used pattern for calling Apps
  Script from an external site — you don't need to change anything about it.
- **Column matching by header name:** `Code.gs` reads the sheet's actual
  header row before every write or read (`getHeaderMap_`), and writes each
  field under the header text that matches it — not a fixed column index.
  Reorder, insert, or delete columns in the Sheet freely; just don't rename
  a header without also updating the matching entry in `Code.gs`'s
  `COLUMNS` list.
- **Duplicate prevention:** before saving, the API checks for an existing
  row with the same **Phone number + Account Number** (found by header
  name). If one exists, the agent sees who submitted it and when, and must
  confirm "Submit Anyway" to proceed.
- **Screenshot uploads:** saved to a Drive folder named "Simply Connect -
  Sale Screenshots" (auto-created), set to link-viewable, with the link
  written into the Screenshot column.

---

## 6. Customizing agents / dropdown options / provider fields

Everything editable lives in the `CONFIG` object at the top of `Code.gs`:
agent roster, campaign numbers, teams, providers, closer names, and the
`providerFields` map that controls which extra fields appear for each
Provider selection. Edit it, redeploy (**New version**, see step 1), and
the frontend picks up the change automatically on next load — no frontend
code changes needed.

---

## 7. Troubleshooting

- **"Failed to load configuration" on page load** — `API_URL` in `script.js`
  is probably still the placeholder, or the Apps Script deployment's access
  is set to something other than "Anyone." Double-check both.
- **CORS error in the browser console** — make sure you redeployed
  (**New version**) after any `Code.gs` edit; editing the file alone doesn't
  update the live deployment.
- **Submissions not appearing** — open the Apps Script project's
  **Executions** log (left sidebar) to see the actual server-side error.
- **Screenshot uploads failing silently** — the first submission with a
  screenshot triggers a one-time Drive authorization prompt *for you, the
  script owner*, not the agent. If you deployed with "Execute as: Me," this
  should already be authorized from the initial deployment step.
