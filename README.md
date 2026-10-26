# DailyWars

Every morning at 3:00 am you get a war: 15 new LeetCode questions (5 Easy, 7 Medium, 3 Hard) to finish by
10:30 pm. Mark each one done when you've understood it and written the code. Win every day to keep your
streak. You can also save any LeetCode problem with one click from Chrome and read everything, organized and
searchable, on any device.

```
extension/   Chrome extension (Manifest V3). Extracts the problem and saves it to Supabase; queues saves while offline.
supabase/    Database schema (tables, Row Level Security, save/search/stats functions) as a migration.
web/         React site for Netlify: dashboard, search and filters, question page, notes, solutions.
tests/       Database tests, extractor tests on real LeetCode data, end-to-end test (real Chrome + live LeetCode).
```

```
Chrome extension (your PC) ──save──►  Supabase  ◄──read── Website on Netlify (phone, laptop, anywhere)
                                (Postgres + Auth)
```

No server of your own is needed. The extension and the site both talk to Supabase directly. Each request
carries your login, and Row Level Security rules in the database ensure an account can only read and change
its own questions.

---

## Setup (one time, about 15 minutes)

### 1. Supabase: create the database

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the full contents of
   [`supabase/migrations/20261018000000_leetvault_schema.sql`](supabase/migrations/20261018000000_leetvault_schema.sql),
   and click **Run**. It should finish with "Success. No rows returned". Then do the same with
   [`supabase/migrations/20261026000000_daily_wars.sql`](supabase/migrations/20261026000000_daily_wars.sql),
   which adds the daily wars and schedules the 3:00 am job.
   (CLI alternative: `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npm run db:push`.)
3. Open **Project Settings → API** (or **API Keys**) and copy:
   * the **Project URL** (`https://<ref>.supabase.co`)
   * the **anon** key or **publishable** key (either works).
   **Never** use the `service_role` / secret key anywhere in this project.

### 2. Netlify: put the website online

1. Push this folder to a GitHub repository.
2. On [netlify.com](https://netlify.com): **Add new site → Import an existing project**, then pick the repo.
   `netlify.toml` already sets the build (base `web`, command `npm run build`, publish `dist`).
3. Before deploying, add two **environment variables**:
   * `VITE_SUPABASE_URL` = your Project URL
   * `VITE_SUPABASE_ANON_KEY` = your anon/publishable key
4. Deploy. Your site is at `https://<name>.netlify.app`. If you add the variables after the first deploy,
   trigger a new deploy, because they are built into the site.

### 3. Supabase: point login emails at your site

In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to your Netlify URL, so the
"confirm your email" link opens your site.

### 4. Create your account

Open your Netlify site, click **No account? Register**, and sign up. Supabase emails you a confirmation link.
Click it, then log in.

Then lock the door: in Supabase, go to **Authentication → Sign In / Providers** and turn off
**Allow new users to sign up**. You're the only user.

### 5. Chrome extension

1. Edit [`extension/config.js`](extension/config.js) and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `LIBRARY_URL` (your Netlify URL).
2. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/` folder.
3. Pin DailyWars, open any `leetcode.com/problems/...` page, click the icon, and log in with the same account.
4. Click **Save Question**.

If you edit `config.js` later, click the reload icon on the extension's card in `chrome://extensions`.

---

## Daily use

**The daily war:** at 3:00 am (India time) your Supabase database picks 15 LeetCode questions you haven't
had before (5 Easy, 7 Medium, 3 Hard). It fetches them from LeetCode by itself on a schedule (`pg_cron`), so
your PC, Chrome and the extension don't need to be on. If LeetCode can't be reached, it retries every 15 minutes.
Starter code comes in the language you save most often, or Python 3 if you haven't saved any yet.

* The home screen lists today's 15 questions, how many are done, and the time left until 10:30 pm.
* At the end of each question there's an **I solved it** button. Press it only after you've understood the problem
  and written the code (on paper or in the app). You can undo a mistaken press. Marking a question done after
  10:30 pm is recorded as late.
* A day is **won** when all 15 are done before 10:30 pm. The **Streak calendar** in the menu shows each day
  (green: won, amber: partly done, red: missed), your current and best streak, and opens any earlier day's war.

**Saving:** open a problem, click the DailyWars icon, then **Save Question**. The popup shows the title,
difficulty, topics, the language detected from LeetCode's editor, and whether the problem is already saved.
To keep another language, switch the language in LeetCode's editor (or in the popup) and save again.
Each language is stored separately and never overwritten.

**Offline:** if Supabase can't be reached, the save is kept in the extension and the icon shows a badge
count. It retries every minute and when Chrome starts, and the popup has **Retry now**. The saved time is
when you clicked, not when the save synced.

**Reading (any device):** open your Netlify URL and log in. The site gives you:
* Counts by difficulty, a search box (title, statement words, topic, problem number), and filters for
  difficulty, topic, and language, which combine. There's also sorting, recently saved questions, and a topic summary.
* A question page with the full original statement, Examples and Constraints tabs, starter code per language
  with syntax highlighting and **Copy code**, a link back to LeetCode, your notes, your own solutions, and delete.

**On a phone** the site switches to a minimal reader on a light background. The library is just the list
of questions. A question shows only its number, statement, each example's input and output, and the
constraints. Explanations and follow-ups are collapsed. Search, filters, starter code, notes, solutions,
delete and log out are in the ☰ menu.

**Install it as an app:** open the site on your phone, then use **Add to Home screen** (Safari: Share → Add to
Home Screen; Chrome: ⋮ → Install app). The installed app opens from the cache and picks up new
deploys by itself: it checks when opened, when brought back to the foreground, and every 30 minutes, then reloads,
but never while a note or solution has unsaved edits. App icons are generated by `python web/scripts/make_icons.py`.

The original statement and starter code are read-only. That's enforced in the database, not just hidden in the UI.

---

## How extraction works

* The content script sends the same GraphQL query LeetCode's own page makes, from the page itself, with your
  normal LeetCode session. The response contains the **original statement HTML** and LeetCode's **untouched
  starter template for each language**. Both are stored exactly as received.
* Examples and constraints are parsed out of that HTML. Both the older `<pre>` format and the newer
  `example-block` format are handled.
* **Language:** if exactly one editor button shows a LeetCode language name (`Python3`, `C++`, …), that's the
  selection. Otherwise it falls back to your stored LeetCode preference, or asks you to choose.
* If LeetCode's data can't be fetched, saving is **disabled** with an explanation. It never stores
  incomplete starter code. Premium problems your account can't open are reported, not worked around.

---

## Local development

Requirements: Node 20+, Docker (for a local Supabase), Chrome.

```bash
npm install                 # Supabase CLI (root)
npm run db:start            # local Supabase at http://127.0.0.1:54321 with the schema applied
                            # it prints the local "Publishable key"

cd web
npm install
cp .env.example .env.local  # set VITE_SUPABASE_URL=http://127.0.0.1:54321 and the local publishable key
npm run dev                 # http://localhost:5173
```

To point the extension at local Supabase without editing `config.js`, run this in the extension's
service-worker console (`chrome://extensions` → DailyWars → "service worker"):

```js
chrome.storage.local.set({ overrides: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: '<local key>', LIBRARY_URL: 'http://localhost:5173' } })
```

Remove the overrides with `chrome.storage.local.remove('overrides')`.

## Tests

```bash
npm run db:start && npm run test:db                    # database/API tests against Supabase
npm run test:war                                       # daily-war generator against live LeetCode (rolled back)
cd tests/extension && npm install && npm test          # 24 extractor tests on real LeetCode responses
cd tests/e2e && npm install && npx puppeteer browsers install chrome && npm test   # end-to-end (see file header)
```

* **Database tests** go through the same Supabase Auth and REST endpoints the apps use. They cover login and
  token refresh, user isolation, duplicate prevention, adding a second language without overwriting,
  validation messages, read-only original data, search, every filter, pagination, stats, solutions, and cascading deletes.
* **End-to-end** runs real Chrome with the extension on live leetcode.com, plus local Supabase and the built
  site. It checks that the unconfigured extension shows setup help, then registers on the site and logs in from
  the popup (a wrong password is rejected). It saves an Easy, a Medium, and a Hard problem, switches the
  language in LeetCode's own editor and saves a second version, and checks that a duplicate is blocked. It
  simulates an outage and confirms the queued save syncs automatically and via **Retry now**, and that an expired
  token is refreshed silently. It checks that every stored statement, topic list, and starter code is identical
  to LeetCode's. Then, as a phone in a separate browser profile, it logs in, searches, opens a question, checks the
  code and Copy button, tests filters, edits notes and solutions, deletes with confirmation, and confirms the
  extension sees the deletion.

## Limitations

* **Free Supabase projects pause after about a week with no activity.** Regular use keeps the project awake.
  A paused project can be restored from the Supabase dashboard.
* leetcode.com only (not leetcode.cn).
* Language detection depends on LeetCode's editor showing the language name on a button. If a redesign breaks
  that, choose the language in the popup.
* Starter code is LeetCode's original template, not what you typed in the editor. Paste your own code under
  "My solutions" on the site.
* The extension's login is stored in `chrome.storage.local` on that one PC. It refreshes automatically, and
  **Log out** clears it.
