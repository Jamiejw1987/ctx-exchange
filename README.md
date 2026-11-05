# Consumer Talent Exchange (CTX)

- `index.html` – public landing page with waiting list
- `exchange/` – **the live app**: real accounts and data on Supabase (built from `app.html` + `live.js`)
- `client/` – hiring team taster (demo data)
- `professionals/` – professional taster (demo data)
- `team-x9k4p2/` – full demo with the Consumer Talent team view (demo data)
- `app.html` – app source the tasters and live app are built from (`python3 build_tasters.py`)
- `live.js` – live mode: sign-in, loading and saving to Supabase, live updates
- `supabase/schema.sql` – database tables, privacy rules and server-side triggers
- `supabase-js.min.js` – Supabase client library (v2.45.4), bundled so the app doesn't depend on a CDN

The tasters and demo use fictional sample data. The live app uses real accounts only.

- `supabase/emails.sql`: email alerts through Postmark (every notification also goes by email; chat emails max one per 15 minutes; the Postmark token lives in the private.settings table, never in this repo). Sign-up confirmation and password-reset emails go through Postmark via Supabase Auth SMTP settings.
- `supabase/functions/push/`: edge function that sends phone/desktop push notifications (Web Push, VAPID). The database calls it for every notification; devices opt in from the bell or the prompt after sign-in. On iPhone the Exchange must be added to the Home Screen first (iOS 16.4+).
- `supabase/interviews.sql`: interview booking (propose times, choose, new times, reschedule, cancel, outcome, private feedback), calendar invite emails with .ics, contact sharing at booking, time zones.
- `supabase/admin.sql`: admin delete-account, Contact us messages, profile email sync.
- `supabase/team.sql`: team members for companies (invites by email, join existing company at sign-up, Admin / Hiring manager roles, remove colleagues).
- `supabase/terms.sql`: custom terms requests (propose, accept/counter/decline, respond to counter, sign agreed terms; signed tiers locked server-side).
