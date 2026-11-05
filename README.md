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
