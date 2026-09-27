# Track My Progress

A lightweight, mobile-first personal tracker for daily habits, study time, trading discipline, and progress reflections.

## Features

- Log daily entries and reflections
- Track goals and streaks
- Lightweight Supabase-backed persistence
- Small, focused React + TypeScript app suitable for local dev and static hosting

## Tech stack

- Vite + React + TypeScript
- Supabase (Postgres) for persistence

## Quickstart

Prerequisites: Node.js (16+ recommended) and a Supabase project (optional for local-only testing).

1. Create a `.env` file in the project root with these variables:

```
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

2. Install dependencies and start development server:

```bash
npm install
npm run dev
```

3. Build for production and preview locally:

```bash
npm run build
npm run preview
```

## Supabase / Database

- A SQL migration for the primary `daily_entries` table is available at `supabase/daily_entries.sql`.
- The client is initialized in `src/supabaseClient.ts` and services for domain logic live under `src/services/` (`dailyEntries.ts`, `goals.ts`, `weeklyReviews.ts`).

If you deploy or use Supabase, ensure the environment variables from the Quickstart are set and that the `daily_entries` table exists with the expected schema.

## Project structure (key files)

- `src/main.tsx` — app entry
- `src/supabaseClient.ts` — Supabase client initialization
- `src/services/` — domain services for entries, goals, weekly reviews
- `supabase/daily_entries.sql` — SQL to create the `daily_entries` table

## Deployment

Works well as a static site (Vite build) on platforms like Vercel, Netlify, or Cloudflare Pages. When deploying, set the same `VITE_SUPABASE_*` environment variables in the hosting provider.

## Contributing

Simple steps:

1. Fork and create a branch for changes
2. Open a PR with a short description

If you want, I can add a CONTRIBUTING.md and run formatting/lint scripts.

## License

This project is provided as-is. Add a license file if you plan to publish.

## Need help?

Tell me what you'd like updated next — examples: add CI, improve README sections, or create a demo dataset.