# AGENTS.md

## Purpose
Project-level instructions for AI coding agents working in this workspace.

## Autonomy Mode (User Preference)
- Inside this workspace, execute normal read/write/edit/search/refactor actions without asking for per-step approval.
- Run routine non-destructive terminal commands (list, search, install, build, run, test, lint) without asking each time.
- Ask before destructive or high-risk actions (mass delete, history rewrite, secret rotation, production-impacting operations).

## Safety Boundaries
- Never expose or copy secrets from local env files into commits, logs, or messages.
- Never run destructive git commands unless explicitly requested.
- Prefer smallest possible code changes; do not reformat unrelated files.

## Project Layout
- Root static pages: `case-admin.html`, `case-search.html`, `case-lite.html`, `video-room.html`, `mm1.html`.
- Serverless API: `api/*.js` and `api/admin/*.js`.
- Shared admin utilities: `api/_lib/admin.js`.
- Deployment config: `vercel.json`.
- DB bootstrap SQL: `supabase-init.sql`.

## Runbook
- Primary deployment target: Vercel serverless functions under `api/`.
- Local validation command: `npm run check`.
- If required env values are missing, API handlers will fail early.

## Environment Expectations
- Env template: `.env.example`.
- Required core vars:
  - `SESSION_SECRET`
  - `SHARED_ADMIN_LOGIN`
  - `SHARED_ADMIN_PASSWORD`
- Database mode:
  - `DB_MODE=supabase`
  - Requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_ADMIN_EMAIL`, `SUPABASE_ADMIN_PASSWORD`
- Image upload endpoint:
  - Uses Supabase Storage bucket `SUPABASE_STORAGE_BUCKET` (default `case-photos`).
- RTC token endpoint:
  - Uses Agora only: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, optional `AGORA_TOKEN_EXPIRES_IN`.

## Backend Conventions
- API handlers use explicit method checks and JSON responses.
- Admin auth is cookie-session based. Reuse helpers in `api/_lib/admin.js`:
  - `requireAdminSession`
  - `getJsonBody`
  - `json`
  - `methodNotAllowed`
  - `signInAdmin`
- Keep user-facing error text consistent with current Chinese locale behavior.

## Architecture Notes
- Backend is Vercel-style function handlers under `api/`.
- Prefer extending existing serverless patterns for new API files in `api/admin/`.

## Known Friction Patterns (from recent sessions)
- Avoid changing UI interaction flow unless requested explicitly.
- For auth changes, verify login/session behavior end-to-end to prevent password bypass regressions.
- For image flow changes, preserve direct-upload UX and verify returned hosted URL behavior.

## Quick Validation Checklist
- Run syntax check: `npm run check`.
- Validate admin auth flow:
  - `POST /api/admin/login`
  - `GET /api/admin/session`
  - protected endpoint access under `/api/admin/*`
- Validate image upload path with Supabase Storage bucket configured.
