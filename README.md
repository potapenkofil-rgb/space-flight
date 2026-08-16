# Kármán

2D spaceflight simulator (Windows 10), inspired by Spaceflight Simulator. See
[`docs/PLAN.md`](docs/PLAN.md) for the implementation plan and
[`docs/DESIGN.md`](docs/DESIGN.md) for the visual language — both are the
source of truth for anyone touching this codebase.

## Requirements

- Node.js ≥ 20
- pnpm 10 (`corepack enable` or `npm i -g pnpm@10.33.0`)
- Rust + Cargo (only needed for `tauri build`, not for `pnpm build`/`test`/`e2e`)

## Getting started

```sh
pnpm install
pnpm dev        # runs @karman/app under Vite at http://localhost:5183
```

## Scripts (from the repo root)

| Command | What it does |
|---|---|
| `pnpm lint` | ESLint across the whole workspace (`any` is a lint error) |
| `pnpm test` | Vitest for `@karman/core` and `@karman/app` (headless, no browser) |
| `pnpm build` | Type-checks and builds `@karman/core` then `@karman/app` |
| `pnpm e2e` | Playwright smoke suite against the built app (`vite preview`) |

`pnpm i && pnpm lint && pnpm test && pnpm build && pnpm e2e` is the full
acceptance check and is what CI (`.github/workflows/ci.yml`) runs.

## Packaging as a Windows `.exe` (Tauri)

The desktop shell lives in [`src-tauri/`](src-tauri) (Tauri 2, using the
system WebView2 that ships with Windows 10 since 2022 — the bundled installer
must include the offline WebView2 bootstrapper for machines without it, set
via `bundle.windows.webviewInstallMode.type: "offlineInstaller"` in
`tauri.conf.json`).

This repo's CI has no Windows runner, so `tauri build` is **not** run in CI —
only the config and icons are validated by hand. To produce the actual
installer, run this on a Windows machine (or a Windows CI runner) with the
Rust toolchain and the Tauri CLI installed:

```sh
pnpm install
pnpm --filter @karman/app run build   # produces packages/app/dist, which tauri.conf.json points at
cargo install tauri-cli --version "^2"
cargo tauri build                     # from src-tauri/, or `cargo tauri build` from the repo root with a workspace Cargo.toml
```

This produces an NSIS and/or MSI installer under
`src-tauri/target/release/bundle/`.

## Repository layout

See `docs/PLAN.md` §2 for the full rationale. Short version:

```
packages/core/   @karman/core — pure TypeScript simulation, zero DOM access
packages/app/    @karman/app — Vite application (canvas world + HTML UI)
src-tauri/       Rust/Tauri 2 desktop shell, icons, bundle config
data/            Game content (parts, systems) — data-driven, moddable
mods/            User mod folders, loaded after data/
tests/e2e/       Playwright smoke suite
docs/            PLAN.md, DESIGN.md — read these first
```

## Contracts

The core types and function signatures every subsystem is built against are
declared in `packages/core/src/**` (see `packages/core/src/index.ts` for the
full barrel export) per `docs/PLAN.md` §4. Unimplemented functions throw
`Error('not implemented: <name>')` but have complete signatures and TSDoc
(units are always documented — metres, m/s, newtons, radians, seconds).
