# ra-atr Frontend Restructure — ra-hcp Pattern

## Goal

Restructure the `ra-atr` repo to match the `AI-Riksarkivet/ra-hcp` monorepo conventions. This is the frontend-only repo — inference and search are separate repos.

## Reference

Use `AI-Riksarkivet/ra-hcp` as the reference implementation. The user (carpelan) works on both projects and wants consistent structure across the suite.

## Steps

### 1. Move frontend into `frontend/` subdirectory

```bash
mkdir frontend
# Move all Svelte/Node files
mv src/ frontend/
mv package.json package-lock.json frontend/
mv svelte.config.js vite.config.ts tsconfig.json frontend/
mv static/ frontend/
mv public/ frontend/
# Move frontend-specific configs
mv .prettierrc .prettierignore frontend/ 2>/dev/null
```

Update all relative paths in:
- `frontend/vite.config.ts` — proxy paths, watch ignores
- `frontend/svelte.config.js` — adapter config
- `frontend/tsconfig.json` — paths

### 2. Create root Makefile (ra-hcp style)

```makefile
.PHONY: setup dev build deploy quality test docs help

setup:          ## Install all dependencies
	cd frontend && npm install

dev:            ## Start frontend dev server
	cd frontend && npx vite dev --port 5173

build:          ## Production build
	cd frontend && npm run build

deploy:         ## Build and deploy to HF Space
	cd frontend && VITE_MODEL_BASE=... VITE_DISABLE_BACKEND=true npm run build
	# ... copy to space, upload

quality:        ## Run all quality checks
	cd frontend && npx prettier --write "src/**/*.{svelte,ts,js,css}"
	cd frontend && npx svelte-check --threshold error

test:           ## Run tests
	cd frontend && npx vitest run

docs-dev:       ## Serve documentation locally
	uvx zensical serve

docs-build:     ## Build documentation site
	uvx zensical build

help:           ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
```

### 3. Create docs/ structure

```
docs/
├── index.md                    # Project overview
├── getting-started/
│   ├── index.md                # Quick start
│   └── configuration.md       # Env vars, model config
├── architecture/
│   ├── index.md                # System overview (3 repos)
│   ├── frontend.md            # Svelte + WASM pipeline
│   ├── inference.md           # GPU server (link to repo)
│   └── search.md              # Search backend (link to repo)
├── api/
│   └── index.md               # API reference links
└── stylesheets/
    └── extra.css
```

### 4. Create zensical.toml

Based on ra-hcp pattern — site name, nav, theme, extensions.

### 5. Create cliff.toml

Copy from ra-hcp — conventional commits changelog generation.

### 6. Create .env.example

```
# Model URLs
VITE_MODEL_BASE=/models
# VITE_MODEL_BASE=https://huggingface.co/carpelan/htr-onnx-models/resolve/main

# GPU Server (optional)
VITE_GPU_SERVER=

# Backend (optional, for catalog search)
# VITE_DISABLE_BACKEND=true

# HuggingFace token (optional, for private models)
# HF_TOKEN=hf_...
```

### 7. Create .docker/frontend.dockerfile

Static build for HF Space or any static hosting.

### 8. Create .dagger/ stubs

Minimal Go-based CI/CD pipeline:
- `main.go` — entry point
- `build.go` — frontend build
- `checks.go` — lint, typecheck
- `serve.go` — dev server

### 9. Update .github/

```
.github/
├── CODE_OF_CONDUCT.md          # Copy from ra-hcp
├── SECURITY.md                 # Security policy
├── dependabot.yml              # Dependency updates
└── workflows/
    ├── ci.yml                  # Build + typecheck
    ├── codeql.yml              # Security scanning
    ├── docs.yml                # Docs site build
    ├── scorecard.yml           # Supply chain security
    └── trufflehog.yml          # Secret scanning
```

### 10. Move CLAUDE.md → .claude/README.md

Move development guide to `.claude/README.md` following ra-hcp pattern.

### 11. Update root README.md

Match ra-hcp style:
- CI badges at top
- Technology table
- Quick start with `make` targets
- Links to docs site, related repos

### 12. Update space/ deployment

Update `make deploy` to build from `frontend/` subdirectory.

### 13. Clean up

- Remove old root-level config files that moved to frontend/
- Update .gitignore for new structure
- Verify `make setup && make dev` works
- Verify `make deploy` works
- Verify CI passes

## Files to create

| File | Source |
|------|--------|
| `Makefile` | New, ra-hcp style |
| `zensical.toml` | New, based on ra-hcp |
| `cliff.toml` | Copy from ra-hcp |
| `.env.example` | New |
| `docs/index.md` | New |
| `docs/getting-started/index.md` | New |
| `docs/architecture/index.md` | From existing design docs |
| `.docker/frontend.dockerfile` | New |
| `.dagger/main.go` | Stub |
| `.github/CODE_OF_CONDUCT.md` | Copy from ra-hcp |
| `.github/SECURITY.md` | Copy from ra-hcp |
| `.github/dependabot.yml` | Copy from ra-hcp |
| `.github/workflows/*.yml` | New/updated |
| `.claude/README.md` | Move from CLAUDE.md |

## Files to move

| From | To |
|------|-----|
| `src/` | `frontend/src/` |
| `package.json` | `frontend/package.json` |
| `package-lock.json` | `frontend/package-lock.json` |
| `svelte.config.js` | `frontend/svelte.config.js` |
| `vite.config.ts` | `frontend/vite.config.ts` |
| `tsconfig.json` | `frontend/tsconfig.json` |
| `static/` | `frontend/static/` |
| `public/` | `frontend/public/` |
| `CLAUDE.md` | `.claude/README.md` |

## Verification

After restructure:
1. `make setup` installs deps
2. `make dev` starts dev server on :5173
3. `make build` produces production build
4. `make deploy` deploys to HF Space
5. `make quality` runs prettier + svelte-check
6. CI workflows pass on push
