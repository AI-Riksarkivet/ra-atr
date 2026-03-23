# Code Quality Tooling Design

## Goal

Add code quality tooling to the ra-atr frontend: prettier-plugin-svelte, eslint, vitest, lefthook, and knip.

## Tools

| Tool | Config | Purpose |
|------|--------|---------|
| prettier-plugin-svelte | frontend/.prettierrc | Fix .svelte file formatting |
| eslint + eslint-plugin-svelte | frontend/eslint.config.js | Linting (flat config) |
| vitest | frontend/vitest.config.ts | Unit testing |
| lefthook | lefthook.yml (root) | Pre-commit hooks (blocking) |
| knip | frontend/knip.json | Dead code detection |

## Lefthook Pre-commit

Runs on staged files, blocks commit on failure:
- prettier --check
- eslint
- svelte-check

## Makefile Changes

- `make quality` — prettier + eslint + svelte-check
- `make lint` — eslint only
- `make test` — vitest (unchanged)

## Bug Fixes

- docs/architecture/frontend.md — add `frontend/` prefix to file paths
- .env.example — add `GPU_SERVER_URL`
