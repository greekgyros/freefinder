# FreeFinder

A small web app for students to mark their free periods (plus lunch and after school) and see when friends are free. You get a three-word secret code; friends enter it to *request* to see your frees, and only see them once you approve.

## Architecture

- **Frontend** (`frontend/`): plain HTML/CSS/JS, no build step. Hosted on **GitHub Pages** by `.github/workflows/pages.yml` (uploads `frontend/` on push to `main`; repo Settings → Pages → Source must be "GitHub Actions").
- **Backend** (`backend/schema.sql`): a **Supabase** (Postgres) database. The browser calls `public.ff_*` SQL functions directly via `POST {SUPABASE_URL}/rest/v1/rpc/ff_<name>` with the public publishable/anon key. There is no server of our own.
- `FreeFinder_original.html`: the original single-file version (used Claude's `window.storage`). Untouched, reference only.

```
backend/schema.sql            All tables, helpers, API functions, admin tools, permissions
frontend/index.html           Page shell
frontend/config.js            SUPABASE_URL, SUPABASE_KEY (placeholders until the user fills them in), TIMETABLE
frontend/api.js               fetch wrapper for the ff_* RPCs; holds the signed-in code in memory only
frontend/app.js               UI: name/code entry → free grid → code reveal → home (Calendar | My account tabs)
frontend/styles.css           Styles (same look as the original)
.github/workflows/pages.yml   GitHub Pages deploy
```

Node is **not** installed on the dev machine; Python 3.12 is (`py`).

## Backend (schema.sql)

- Paste the whole file into Supabase SQL Editor → Run. **Idempotent**: `create ... if not exists` / `create or replace`, word inserts `on conflict do nothing`. It never regenerates the code secret — doing so would break every code.
- Private schema `ff` (not exposed by the Data API): `accounts`, `follows`, `attempts` (rate limiting), `settings` (the `code_pepper` secret), `words` (~660-word list), helpers, and `admin_*` functions. `anon`/`authenticated` have no access to `ff` at all.
- Public API = `public.ff_*`, all `security definer set search_path = ''`, explicitly granted to `anon, authenticated`. Every function that acts on an account takes that account's code as `p_code`.
- **API functions return jsonb and never raise for user errors** — they return `{"error": "..."}` instead, because a raise would roll back the failed-attempt insert used for rate limiting. `api.js` turns `error` into a thrown `Error`; the message is shown to users as-is, so keep them friendly.
- Codes: three list words joined by dots. `ff.parse_code` accepts any case, spaces/dots/dashes/slashes, and a `///` prefix. Stored as `sha256(pepper || code)`; the raw code is only returned by `ff_create_account` (and echoed by `ff_login`, since the user typed it).
- Slots: weeks A/B × Mon–Sat × `1 2 3 4 L 5 6 AS` (L = lunch between P4 and P5, AS = after school). Keys like `A-Mon-L`. Validated by the regex in `ff.clean_free` — **keep it in sync with `TIMETABLE` in `frontend/config.js`**.
- Rate limits per IP (from `cf-connecting-ip` / `x-forwarded-for` in `request.headers`): 20 wrong codes / 15 min; 10 sign-ups / hour.

### Follow model

`ff.follows(viewer_id, owner_id, status)`: the viewer entered the owner's code. `pending` until the owner approves; only `approved` rows expose the owner's frees. Visibility is one-way. Deleting an account cascades to all its follows.

| Function | Who calls it | Effect |
|---|---|---|
| `ff_login(p_input)` | name box | `{account}` for a valid code, `{new:true,name}` for a name |
| `ff_create_account(p_name, p_free)` | new user saves | `{account}` incl. `code` |
| `ff_get_account(p_code)` | refresh | `{account}` |
| `ff_update_account(p_code, p_name?, p_free?)` | edit frees | `{account}` |
| `ff_delete_account(p_code)` | My account → Delete | `{deleted:true}` |
| `ff_request_follow(p_code, p_target_code)` | add a friend's code | creates pending request |
| `ff_unfollow(p_code, p_owner_id)` | viewer | cancel request / stop following |
| `ff_approve_viewer(p_code, p_viewer_id)` | owner | pending → approved |
| `ff_remove_viewer(p_code, p_viewer_id)` | owner | decline request or rescind access |

`account` = `{name, free, following: [{id, name, status, free|null}], viewers: [{id, name, status}], code?}` — `following[].free` is null unless approved.

Admin (SQL Editor only): `ff.admin_list_accounts()`, `ff.admin_delete_account(id)`, `ff.admin_delete_account_by_code(code)`.

## Frontend notes

- Signed-in home has two tabs. **Calendar**: week toggle, one coloured chip per approved friend (click to hide/show), "only times I'm free too" filter, grid of slots × days with friend names in each cell; cells where you're free are shaded. **My account**: your code (blurred until Show), requests (Approve/Decline), who can see your frees (Remove access), friends you follow (+ add code), edit frees, delete account (two-step inline confirm).
- Switching tabs re-fetches the account in the background; `renderCount` makes that refresh skip re-rendering if anything happened meanwhile or the friend-code box has text (otherwise it wiped typed input — found in testing).
- Always pass user text through `esc()` before `innerHTML` — names are shown to other people.
- Keep the original's look: Georgia headings, Arial UI text, green accent `#3a5a40`.

## Testing

No test suite is committed. What was used (in the session scratchpad, not the repo): a Python venv with `pgserver` (bundled Postgres 16), `psycopg2-binary` and `playwright`. SQL tests created `anon`/`authenticated` roles, loaded `schema.sql` twice, and called every function as `anon`. UI tests ran a tiny mock of `/rest/v1/rpc/*` in front of that Postgres, served `frontend/` with a patched `config.js`, and drove Chromium through sign-up, requests, approval, calendar, rescinding, editing and deleting with three users. It has **not** been run against a real Supabase project yet.

## Known limitations / ideas

- A name made of three list words (e.g. "Rose Lily Ivy") is treated as a code.
- No "block": someone whose request you decline or whose access you rescind can request again with your code. Code regeneration would fix that.
- Supabase free projects pause after ~7 days idle.
- On phones the calendar scrolls sideways inside its card (min-width 480px).

---

## Change log

### 2026-09-28 (2) — GitHub Pages + Supabase, approvals, calendar, account manager

- Replaced the Python backend (`backend/server.py`, `store.py`, `codes.py`) with `backend/schema.sql` for Supabase so the site can be hosted on GitHub Pages. Added `.github/workflows/pages.yml` and `frontend/config.js`.
- Friend requests now need **approval**: adding a code creates a pending request; the owner approves or declines.
- **Calendar view** of all approved friends' frees (replaces the single-slot "who's free?" picker).
- **Account manager** tab: requests, "who can see your frees" with **Remove access**, friends you follow, edit frees, **delete account**.
- **Admin delete** from the backend via `ff.admin_*` functions in the SQL Editor.
- Codes are now hashed with a secret pepper (fixes the earlier "brute-forceable if the data leaks" note). Added a sign-up rate limit.
- Widened layout to 720px for the calendar.
- README rewritten with Supabase + Pages setup and admin commands.
- Verified: 29 SQL checks and 14 browser checks passed, no JS errors.

### 2026-09-28 (1) — Accounts, secret codes, frontend/backend split

- Split the single-file app into a Python stdlib backend and `frontend/`. (Backend later replaced — see above.)
- Three-word what3words-style codes, shown once on creation; entering your code in the name box restores your saved frees.
- Friends list: only people with your code could see your frees.
- Added **Lunch** (between P4 and P5) and **After school** slots.
- Fixed unescaped names (XSS) from the original.

---

## Conversation history

### Session 1 — 2026-09-28

**Request 1:**
> save all changes and conversation history in claude.md
>
> edit this file so that there is an option to have accounts with an account 'secret code' that allows other people to find your frees. they can only see when your free periods are if they have your code.
>
> separate the frontend and the backend of this file. make it so that if you enter your own secret code into the name box you get your 'saved' selections of frees. also add options for putting which lunchtime (between p4 and p5) and after school slots are available.
>
> each personal code should be 3 words, similar to the what-three-words system

**What Claude did:** Read the original (Claude `window.storage`, everyone could see everyone). Node wasn't installed, so built a Python stdlib backend (`server.py`/`store.py`/`codes.py`, JSON file storage, hashed codes, IP rate limit) and a `frontend/` folder. Name box accepts name or code; friends list by code; lunch + after-school slots. End-to-end API test passed. Wrote this file, `.gitignore`, README. Didn't commit.

**Request 2:**
> add it so that I can host this on my github natively. also I want to be able to delete accounts in my own account manager, and also delete it through the backend. i also want to be able to view all my friends frees, after they have approved my account, in a calendar view instead of selecting each slot and seeing who is free. also add somewhere where you can see in your own account manager who else can see your frees, and give an option to rescind that visibility.

**What Claude did:**

1. Explained GitHub Pages can't run a backend and asked where data should live; the user chose **Supabase** (over keeping the Python server on another host).
2. Wrote `backend/schema.sql`: private `ff` schema, `public.ff_*` security-definer API, pending/approved follows, account deletion, admin delete functions, peppered code hashes, rate limits. Removed the Python backend.
3. Rewrote the frontend: `config.js`, RPC `api.js`, Calendar and My account tabs in `app.js`, new styles. Added the GitHub Pages workflow.
4. Tested locally with a bundled Postgres (`pgserver`) and headless Chromium (Playwright) against a mock of Supabase's RPC endpoint. Found and fixed a tab-refresh race that wiped typed friend codes. All checks passed.
5. Updated README (setup + admin) and this file. Didn't commit.

**Request 3:**
> is there a way to test run everything before committing

**What Claude did:** The user had filled in `frontend/config.js` with their Supabase project. Claude confirmed `schema.sql` was installed (read-only `ff_login` call returned `{"new": true}`) and that the private `ff` schema isn't exposed (PGRST106). It then served `frontend/` locally with `py -m http.server 8000 -d frontend` and explained how to test with two browser windows and how to clean up test accounts with the admin functions.

**Request 4:**
> commit everything and push this to the git

**What Claude did:** Committed all changes on `main` and pushed to `origin` (github.com/greekgyros/freefinder).
