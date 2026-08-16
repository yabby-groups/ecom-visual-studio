# Ecom Visual Studio Contributor Guide

## Project Layout

- `src/` is the React + TypeScript frontend. `App.tsx` owns routes and page-level UI, `api.ts` is the single browser API client, `store.ts` holds shared session/project/template state, and `types.ts` defines API-facing types.
- `backend/main.py` is the FastAPI application, SQLite schema, authentication, huabot integration, upload handling, and background image-generation workflow.
- `tests/test_api.py` contains API lifecycle tests.
- `storage/` contains the runtime SQLite database and uploaded/generated files. It is intentionally ignored and must not be committed.

## Local Development

Install the frontend dependencies with `npm install` and the backend dependencies with `python -m pip install -r requirements.txt` in a virtual environment.

Run the services in separate terminals:

```sh
uvicorn backend.main:app --reload
npm run dev
```

Vite proxies `/api` and `/files` to `http://127.0.0.1:8000`. Keep browser calls relative to those paths so development and deployed same-origin behavior remain aligned.

Use these checks for changes in their respective areas:

```sh
npm run build
npm test
pytest
```

## Frontend and API Contracts

- Keep each React component in its own file. The file name must match the component name.
- Add or change browser endpoints through `src/api.ts`; do not call `fetch` directly from components.
- When an API response or request changes, update the FastAPI handler, the `client` method, exported types in `src/types.ts`, all consuming UI, and relevant API tests together.
- Preserve cookie-based authentication: `api()` sends `credentials: 'include'`, and protected API calls must continue to work without exposing secrets to the client.
- Refresh Zustand state after mutations that affect project or template lists. The workspace currently reloads a project while any asset has a pending status.
- Reuse the existing compact studio layout, Lucide icons, responsive breakpoints, and warm white/charcoal/gold visual language. Do not redesign unrelated routes while making a focused feature change.

## Backend and Data Safety

- Every protected route must call `require_user`. Queries and mutations for projects, assets, templates, tokens, models, and settings must be scoped to the authenticated user.
- Treat `APP_SECRET_KEY`, huabot tokens, and `.env` values as server-only secrets. Tokens are encrypted before SQLite persistence; never return raw token values from an API route or serialize them into frontend state.
- Keep files under `storage/uploads` and `storage/generated`; only return paths relative to the storage root for `/files` access. Validate file type and size before writing uploads.
- Preserve generation lifecycle semantics: routes mark work `queued`, `generate_asset` advances it to `generating`, and completion records `ready` with a file path or `failed: <message>`. Changes must remain compatible with the frontend polling logic.
- Do not make tests depend on real huabot credentials or network services. Mock external calls or cover behavior before the outbound request boundary.

## Testing Expectations

- Extend `tests/test_api.py` when changing authentication, authorization, persistence, validation, response shapes, pack construction, or asset state transitions.
- Tests share the ignored local SQLite database through `init_db()`. Keep fixture identifiers deterministic and clean up only records created by that test; do not assume an empty developer database.
- Run the narrowest relevant check during development, then run `npm run build` for TypeScript/frontend changes and `pytest` for backend or contract changes before handoff.

## Repository Hygiene

- Do not commit `.env`, `storage/`, virtual environments, build outputs, caches, credentials, uploaded references, or generated images.
- Keep code changes scoped. Do not reformat large unrelated sections of `backend/main.py`, `src/App.tsx`, or `src/styles.css` for a targeted task.
- Use ASCII for new code and documentation unless non-ASCII text is required by the user-facing Chinese product copy.
