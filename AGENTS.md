# Ecom Visual Studio Contributor Guide

## Project map

- `main.go`, `app.go`, `desktop_*.go`, `media_tools.go`, and `studio_data.go` are the Go/Wails desktop runtime, persistence layer, integrations, and file serving code.
- `src/` is the React + TypeScript frontend. `App.tsx` owns route composition, `api.ts` is the browser-side Wails/API client boundary, `store.ts` owns shared session/project/template state, and `types.ts` exports frontend-facing types.
- `src/components/` contains one React component per file; the file name must match the component name. Keep its paired CSS local to that component where the existing project does so.
- `*_test.go` contains the supported backend, persistence, authorization, generation, packaging, and validation tests. `src/**/*.test.ts` contains frontend tests.
- `backend/`, `requirements.txt`, and `tests/test_api.py` are legacy Python implementation files. They are not a supported runtime, development server, API contract, or validation path; do not add new features to them.
- `storage/`, desktop application data, and build output are runtime-only and must never be committed.

## Local development

Install frontend dependencies with `npm install`. Install Go and Wails v2 through the project toolchain or `devenv`.

Run the supported desktop application:

```sh
npm run desktop:dev
```

Use the narrowest relevant check while developing, then run the applicable final checks:

```sh
go test ./...
go vet ./...
npm test
npm run build
```

Use `go test ./...` and `go vet ./...` for Go/Wails, persistence, authorization, generation, or desktop API changes. Use `npm test` and `npm run build` for frontend or TypeScript changes. Packaging checks use the existing `npm run desktop:build*` scripts and target-specific toolchains. Do not use `pytest`, `uvicorn`, or the legacy Python service as evidence of correctness.

## CodeGraph

Use the configured CodeGraph MCP server for structural questions before falling back to text search:

- Use CodeGraph context/explore for focused task context and related source.
- Use symbol search for definitions, callers/callees for call graphs, and impact analysis before changing shared behavior.
- Use native search only for literal strings, comments, logs, documentation, or already-known files.
- If CodeGraph reports that the project is not initialized, ask before running `codegraph init -i`.

Treat `.codegraph/` as local generated state. Do not add it, `.codex/`, `.loopx/`, `.env`, `storage/`, dependency directories, virtual environments, caches, or build output to commits.

## Frontend and Wails contracts

- Add or change browser-facing calls through `src/api.ts` and the generated Wails bindings; components must not create ad hoc request clients.
- When a Go method or response changes, update the Go implementation, exported TypeScript types, generated bindings, all consumers, and relevant Go/frontend tests in the same change.
- Keep credentials, provider secrets, and encrypted token data in Go/Wails storage. Never expose raw secrets through frontend state or generated bindings.
- Refresh Zustand state after mutations that affect project or template lists. The workspace must continue polling a project while any asset is pending.
- Reuse the compact studio layout, Lucide icon set, responsive breakpoints, and warm white/charcoal/gold visual language. Do not redesign unrelated routes for a focused change.

## Color and button visibility

- Use the existing theme tokens in `src/styles.css` and component CSS. Add a new token before adding repeated hard-coded colors.
- Every supported screen must be readable in both `data-theme="light"` and `data-theme="dark"`; inspect component overrides, overlays, cards, inputs, notices, and modal surfaces together.
- Foreground/background combinations must meet WCAG AA contrast targets where applicable: 4.5:1 for normal text and 3:1 for large text and graphical controls. Do not use low-contrast gray text, transparent text, or a single purple/blue gradient palette as the dominant UI treatment.
- Every interactive button or button-like control must remain visibly identifiable in default, hover, active, `:focus-visible`, and disabled states. This includes text buttons, icon buttons, back links, tabs, selectors, upload controls, custom cards, and modal actions.
- A disabled button may be muted but must retain readable text/icon, a discernible boundary or surface, and a visible disabled state; never rely on opacity alone. Focus must have a clear non-color-only outline or ring.
- Button text and icons must not blend into the background, be clipped, overflow their container, or disappear behind an overlay. Check long labels, loading labels, narrow widths, and both themes.
- Before handoff, inspect all button selectors in `src/**/*.css` and the rendered states in both themes. A build passing alone does not prove visual button visibility.

## Go/Wails data and generation safety

- Every protected Go method calls the existing authorization checks, and all project, asset, template, token, model, settings, and file queries are scoped to the authenticated user.
- `APP_SECRET_KEY`, Huabot tokens, and `.env` values are server-side or local encrypted storage concerns. Persist tokens only through the existing encryption helpers; never return raw token values to React.
- Write files only below the configured application data directory and validate type, size, traversal, and symlink boundaries before writing or serving uploads/generated files.
- Preserve the asset lifecycle: methods mark work `queued`, generation advances it to `generating`, and completion records `ready` with a relative file path or `failed: <message>`.
- Do not make tests depend on real Huabot credentials, provider responses, or network services. Mock external calls at or before the outbound request boundary.

## Test and repository hygiene

- Extend the relevant `*_test.go` or frontend test for authentication, authorization, persistence, validation, response shape, pack construction, asset state, or theme/button behavior.
- Tests must use deterministic fixture IDs and clean up only records created by the test; never assume an empty developer database.
- Keep changes scoped. Do not reformat broad unrelated sections of `app.go`, `src/App.tsx`, or `src/styles.css` during targeted work.
- Use ASCII in code and documentation unless non-ASCII text is required for user-facing Chinese product copy.
