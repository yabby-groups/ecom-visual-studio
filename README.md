# Ecom Visual Studio

Ecom Visual Studio is an authenticated workspace for creating e-commerce product visuals with huabot-compatible AI services. It combines a React studio with a FastAPI backend so teams can turn a product reference into individual images or reusable visual packs.

## What it does

- Create projects with product information, selling points, a brand color, and a reference image.
- Upload a JPG, PNG, or WebP reference image, or import one from a public URL.
- Create marketplace, social, or custom visual packs; edit prompts; and generate new image versions.
- Use AI-assisted product analysis and creative chat while preparing a project.
- Manage custom templates, huabot tokens, and available image, text, and chat models.
- Browse recent creations and previously generated project assets.

## Architecture

- `src/` contains the React + TypeScript application built with Vite.
- `backend/main.py` contains the FastAPI application, SQLite persistence, huabot integration, uploads, and background generation workflow.
- `tests/test_api.py` covers API lifecycle, authorization, validation, and external-service boundaries.
- `storage/` is created at runtime for the SQLite database, uploads, and generated files. It is intentionally ignored by Git.

The browser uses relative `/api` and `/files` URLs. During development, Vite proxies both paths to the backend at `http://127.0.0.1:8000`; this keeps local and same-origin deployments aligned.

## Prerequisites

- Node.js and npm
- Python 3 with a virtual environment
- A huabot-compatible account and endpoint for live login, model lookup, chat, analysis, and image generation

## Setup

Install frontend dependencies:

```sh
npm install
```

Create and activate a Python virtual environment, then install backend dependencies:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Create a local `.env` file in the repository root. Do not commit it.

```dotenv
APP_SECRET_KEY=replace-with-a-long-random-secret
HUABOT_BASE_URL=https://your-huabot-compatible-endpoint
# Optional: override the public endpoint used to refresh the model catalog.
# HUABOT_WEB_BASE_URL=https://www.huabot.com
```

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_SECRET_KEY` | Yes | Encrypts huabot token secrets before they are stored in SQLite. Changing it makes existing encrypted tokens unreadable. |
| `HUABOT_BASE_URL` | For live generation, chat, and analysis | Base URL for huabot authentication and OpenAI-compatible generation/chat calls. |
| `IMG_BASE_URL` | No | Compatibility fallback when `HUABOT_BASE_URL` is not set. |
| `HUABOT_WEB_BASE_URL` | No | Overrides the endpoint used to retrieve the public huabot model catalog. Defaults to `https://www.huabot.com`. |

The application stores the selected account token encrypted on the server. Raw token values are never returned to the browser.

## Run locally

Start the backend in one terminal:

```sh
source .venv/bin/activate
uvicorn backend.main:app --reload
```

Start the frontend in another terminal:

```sh
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://127.0.0.1:5173`. Sign in with a huabot account; an HTTP-only session cookie keeps the browser authenticated.

## Development checks

```sh
npm test
npm run build
pytest
```

Use `npm test` for frontend tests, `npm run build` to type-check and produce the Vite build, and `pytest` for FastAPI/API-contract changes. Backend tests mock external calls and do not require live huabot credentials.

## Runtime behavior and limits

- Reference uploads accept JPG, JPEG, PNG, and WebP files up to 15 MB. Imported URLs must be public HTTP(S) image URLs and are subject to the same limit.
- Files are persisted below `storage/uploads` and `storage/generated`, then served through `/files` using paths relative to `storage/`.
- Generation records move through `queued`, `generating`, and either `ready` or `failed: <message>`. The workspace polls while an asset is pending.
- Image generation requires a selected enabled token and a model whose alias starts with `gpt-image-`.
- The bundled CORS policy permits the local Vite origins only. Configure a suitable same-origin or reverse-proxy deployment before exposing the service elsewhere.

## Security and repository hygiene

Do not commit `.env`, `storage/`, virtual environments, build output, generated images, credentials, or local tool state. Keep all secrets server-side, and preserve per-user authorization checks whenever extending projects, assets, templates, tokens, models, or settings.

For contribution conventions and agent-specific implementation rules, see [AGENTS.md](AGENTS.md).
