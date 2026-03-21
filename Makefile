.PHONY: dev build check deploy clean help

# --- Development ---

dev: ## Start frontend dev server
	npx vite dev --port 5173

build: ## Build for production
	npm run build

# --- Code Quality ---

check: ## Run format + typecheck
	npx prettier --write "src/**/*.{svelte,ts,js,css}"
	npx svelte-check --threshold error

# --- HuggingFace Space ---

deploy: ## Build and deploy to HuggingFace Space
	VITE_MODEL_BASE=https://huggingface.co/carpelan/htr-onnx-models/resolve/main VITE_DISABLE_BACKEND=true npm run build
	rm -rf space/_app space/viewer space/*.html space/*.jpg space/*.svg space/*.mp4
	mkdir -p space/viewer
	rsync -a --exclude='models' build/ space/
	cp space/viewer.html space/viewer/index.html
	cp space/index.html space/200.html
	cp space/index.html space/404.html
	cd space && python3 -c "from huggingface_hub import HfApi; HfApi().upload_folder(folder_path='.', repo_id='carpelan/lejonet', repo_type='space')"
	@echo "Deployed to https://huggingface.co/spaces/carpelan/lejonet"

# --- Cleanup ---

clean: ## Remove caches and builds
	rm -rf .svelte-kit build node_modules/.vite

# --- Help ---

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
