# Ecom Visual Studio Contributor Guide

## Project map

- `src/` is the React + TypeScript frontend. `App.tsx` owns route composition, `api.ts` is the sole browser API client, `store.ts` owns shared session/project/template state, and `types.ts` exports API-facing types.
- `src/components/` contains one React component per file; the file name must match the component name. Keep its paired CSS local to that component where the existing project does so.
- `backend/main.py` is the FastAPI application, SQLite schema/migrations, cookie authentication, huabot integration, uploads, and background generation workflow.
- `tests/test_api.py` contains API lifecycle, authorization, validation, and mocked external-service tests.
- `storage/` contains runtime-only SQLite, uploaded references, and generated files. It must never be committed.

## Local development

Install dependencies with `npm install` and, in an activated virtual environment, `python -m pip install -r requirements.txt`.

Run the services separately:

```sh
uvicorn backend.main:app --reload
npm run dev
```

Vite proxies `/api` and `/files` to `http://127.0.0.1:8000`. Browser code must keep using those relative paths so local development and same-origin deployment behave identically.

Use the narrowest relevant check while developing, then run the applicable final checks:

```sh
npm test
npm run build
pytest
```

Run `npm run build` for frontend or TypeScript changes and `pytest` for backend or API-contract changes before handoff.

## CodeGraph

Use the configured CodeGraph MCP server for structural questions before falling back to text search:

- Use CodeGraph context/explore for focused task context and related source.
- Use symbol search for definitions, callers/callees for call graphs, and impact analysis before changing shared behavior.
- Use native search only for literal strings, comments, logs, or already-known files.
- If CodeGraph reports that the project is not initialized, ask before running `codegraph init -i`.

Treat `.codegraph/` as local generated state. Do not add it, `.codex/`, `.loopx/`, `.env`, `storage/`, dependency directories, virtual environments, caches, or build output to commits.

## Frontend and API contracts

- Add or change browser endpoints through `src/api.ts`; components must not call `fetch` directly.
- When an API request or response changes, update the FastAPI handler, `client` method, exported `src/types.ts` types, all consumers, and relevant API tests in the same change.
- Preserve cookie authentication: `api()` sends `credentials: "include"`, and protected API calls must work without exposing server secrets to frontend state.
- Refresh Zustand state after mutations that affect project or template lists. The workspace must continue polling a project while any asset is pending.
- Reuse the compact studio layout, Lucide icon set, responsive breakpoints, and warm white/charcoal/gold visual language. Do not redesign unrelated routes for a focused change.

## Backend, data, and generation safety

- Every protected route calls `require_user`. Queries and mutations for projects, assets, templates, tokens, models, and settings must be scoped to the authenticated user.
- `APP_SECRET_KEY`, huabot tokens, and `.env` values are server-only. Persist tokens only through the existing encryption helpers; never return raw token values from an API route.
- Write files only below `storage/uploads` and `storage/generated`. Return paths relative to the storage root for `/files`, and validate type and size before writing any upload.
- Preserve the asset lifecycle: routes mark work `queued`, `generate_asset` advances it to `generating`, and completion records `ready` with a relative file path or `failed: <message>`.
- Do not make tests depend on real huabot credentials or network services. Mock external calls at or before the outbound request boundary.

## Test and repository hygiene

- Extend `tests/test_api.py` for authentication, authorization, persistence, validation, response-shape, pack-construction, or asset-state changes.
- Tests share the ignored local SQLite database through `init_db()`. Use deterministic fixture IDs and clean up only records created by the test; never assume an empty developer database.
- Keep changes scoped. Do not reformat broad unrelated sections of `backend/main.py`, `src/App.tsx`, or `src/styles.css` during targeted work.
- Use ASCII in code and documentation unless non-ASCII text is required for user-facing Chinese product copy.
