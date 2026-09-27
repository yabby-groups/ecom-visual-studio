# Ecom Visual Studio

Ecom Visual Studio is a Go/Wails desktop workspace for creating e-commerce product visuals with huabot-compatible AI services. It combines a React studio with a local Go service layer so teams can turn a product reference into individual images or reusable visual packs.

## What it does

- Create projects with product information, selling points, a brand color, and a reference image.
- Upload a JPG, PNG, or WebP reference image, or import one from a public URL.
- Create marketplace, social, or custom visual packs; edit prompts; and generate new image versions.
- Use AI-assisted product analysis and creative chat while preparing a project.
- Manage custom templates, huabot tokens, and available image, text, and chat models.
- Browse recent creations and previously generated project assets.

## Architecture

- `src/` contains the React + TypeScript application built with Vite.
- `main.go`, `app.go`, `desktop_*.go`, and `studio_data.go` contain the Wails entrypoint, local persistence, Huabot integration, uploads, and generation workflow.
- `*_test.go` covers lifecycle, authorization, validation, persistence, generation, and external-service boundaries. `src/**/*.test.ts` covers frontend behavior.
- `storage/` and the desktop application data directory are runtime-only. They are intentionally ignored by Git.

The old `backend/` FastAPI implementation and its Python tests remain only as legacy reference material. They are not part of the supported desktop runtime, development server, or validation workflow.

## Prerequisites

- Node.js and npm
- Go 1.25 or the version declared by `go.mod`
- Wails v2 and the target platform build tools
- A huabot-compatible account and endpoint for live login, model lookup, chat, analysis, and image generation

## Setup

Install frontend dependencies:

```sh
npm install
```

Create a local `.env` file in the repository root. Do not commit it.

```dotenv
APP_SECRET_KEY=replace-with-a-long-random-secret
HUABOT_BASE_URL=https://huabot.com/v1
HUABOT_WEB_BASE_URL=https://huabot.com
```

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_SECRET_KEY` | Yes | Encrypts huabot token secrets before they are stored in SQLite. Changing it makes existing encrypted tokens unreadable. |
| `HUABOT_BASE_URL` | For live generation, chat, and analysis | OpenAI-compatible API base URL, including `/v1`; defaults to `https://huabot.com/v1`. |
| `IMG_BASE_URL` | No | Legacy browser-service fallback when `HUABOT_BASE_URL` is not set. |
| `HUABOT_WEB_BASE_URL` | For Huabot account sign-in and catalog sync | Website base URL for sign-in, Token Base and model catalog calls; defaults to `https://huabot.com`. |

The application stores the selected account token encrypted on the server. Raw token values are never returned to the browser.

## Run locally

Start the supported Wails desktop application:

```sh
npm run desktop:dev
```

The Wails runtime starts the React frontend and Go service layer together. Sign in with a Huabot account; credentials and local session data stay in the desktop application data directory.

## Desktop application

The Wails desktop runtime uses the React application at the repository root and a Go service layer. It stores fresh desktop-only data under the operating system application-config directory (`EcomVisualStudio`), so it does not read or migrate the legacy `storage/` directory and does not require Python at runtime. It reads environment variables first and then an optional `.env` in that directory. The selected Huabot Token is encrypted locally with a generated, owner-only key; login passwords and TOTP codes are never stored.

```sh
npm run desktop:dev
npm run desktop:build
npm run desktop:build:macos:x86_64
npm run desktop:build:windows
npm run desktop:build:all
```

`desktop:build` creates the macOS arm64 build. `desktop:build:macos:x86_64` creates an Intel Mac build on a macOS host. `desktop:build:windows` cross-builds a Windows x64 NSIS installer and needs the Wails Windows cross-compilation prerequisites (MinGW and NSIS) on the build host.

`desktop:build:all` uses the host macOS toolchain for both Mac architectures, then runs the Windows builds inside the project devenv, which supplies Go, MinGW, and NSIS. It builds macOS arm64 and x86_64 applications, a Windows x64 application and installer, and a Windows x86 portable application. It archives each target in `bin-dist/` using `wails.json`'s `info.productVersion` for file names. Run it on macOS with Wails installed.

The macOS package is ad-hoc signed with App Sandbox and outgoing-network entitlements. macOS notarization, Windows signing, automatic updates, and legacy data import are intentionally out of scope.

Video analysis needs FFmpeg and FFprobe. Packaging downloads target-specific standalone tools into `/tmp/ecom-visual-studio-media-tools` when they are not already cached. Apple Silicon uses static arm64 builds; Intel macOS uses the evermeet.cx builds. Set `FFMPEG_MACOS_ARM64_URL`, `FFMPEG_MACOS_X86_64_URL`, `FFMPEG_WINDOWS_AMD64_URL`, or `FFMPEG_WINDOWS_X86_URL` to override a download source, or set `FFPROBE_MACOS_ARM64_URL` or `FFPROBE_MACOS_X86_64_URL` to override the separate macOS FFprobe source. You can also set `FFMPEG_MACOS_ARM64_DIR`, `FFMPEG_MACOS_X86_64_DIR`, `FFMPEG_WINDOWS_AMD64_DIR`, and `FFMPEG_WINDOWS_X86_DIR` to use pre-downloaded directories. For an individual target, `FFMPEG_BIN_DIR` also works. The scripts verify the binary architecture, reject macOS builds with non-system dynamic library dependencies, and include the tools in the signed app, Windows installer, and portable Windows ZIPs. The Nix-profile FFmpeg build is dynamically linked to `/nix/store` and cannot be used as a redistributable macOS binary.

## Development checks

```sh
npm test
npm run build
go test ./...
go vet ./...
```

Use `npm test` for frontend tests, `npm run build` to type-check and produce the frontend build, and `go test ./...` plus `go vet ./...` for Go/Wails and desktop API changes. Go tests mock external calls and do not require live Huabot credentials. Python commands are not supported validation steps.

## Runtime behavior and limits

- Reference uploads accept JPG, JPEG, PNG, and WebP files up to 15 MB. Imported URLs must be public HTTP(S) image URLs and are subject to the same limit.
- Files are persisted below `storage/uploads` and `storage/generated`, then served through `/files` using paths relative to `storage/`.
- Generation records move through `queued`, `generating`, and either `ready` or `failed: <message>`. The workspace polls while an asset is pending.
- Image generation requires a selected enabled token and a model whose alias starts with `gpt-image-`.
- The bundled CORS policy permits the local Vite origins only. Configure a suitable same-origin or reverse-proxy deployment before exposing the service elsewhere.

## Security and repository hygiene

Do not commit `.env`, `storage/`, virtual environments, build output, generated images, credentials, or local tool state. Keep all secrets server-side, and preserve per-user authorization checks whenever extending projects, assets, templates, tokens, models, or settings.

For contribution conventions and agent-specific implementation rules, see [AGENTS.md](AGENTS.md).
