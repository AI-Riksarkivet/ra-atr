# ──────────────────────────────────────────────────────────────────────
#  Lejonet HTR — Development commands
# ──────────────────────────────────────────────────────────────────────
.PHONY: setup dev build deploy quality test docs-dev docs-build clean help

## setup: install all dependencies
setup:
	cd frontend && npm install

## dev: start frontend dev server
dev:
	cd frontend && npx vite dev --port 5173

## build: production build
build:
	cd frontend && npm run build

## deploy: build and deploy to HF Space
deploy:
	cd frontend && VITE_MODEL_BASE=https://huggingface.co/carpelan/htr-onnx-models/resolve/main VITE_DISABLE_BACKEND=true npm run build
	rm -rf space/_app space/viewer space/*.html space/*.jpg space/*.svg space/*.mp4
	mkdir -p space/viewer
	rsync -a --exclude='models' frontend/build/ space/
	cp space/viewer.html space/viewer/index.html
	cp space/index.html space/200.html
	cp space/index.html space/404.html
	cd space && python3 -c "from huggingface_hub import HfApi; HfApi().upload_folder(folder_path='.', repo_id='carpelan/lejonet', repo_type='space')"
	@echo "Deployed to https://huggingface.co/spaces/carpelan/lejonet"

## quality: run all quality checks
quality:
	cd frontend && npx prettier --write "src/**/*.{svelte,ts,js,css}"
	cd frontend && npx svelte-check --threshold error

## test: run tests
test:
	cd frontend && npx vitest run

## docs-dev: serve documentation locally
docs-dev:
	uvx zensical serve

## docs-build: build documentation site
docs-build:
	uvx zensical build

## clean: remove caches and builds
clean:
	rm -rf frontend/.svelte-kit frontend/build frontend/node_modules/.vite

## help: show this help
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  make /' | sed 's/: /\t/'

.DEFAULT_GOAL := help
