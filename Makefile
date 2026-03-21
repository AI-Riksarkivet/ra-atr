.PHONY: install format lint typecheck check test ci serve serve-backend serve-gpu clean

# --- Setup ---

install: ## Install all dependencies
	cd backend && uv sync
	cd gpu-server && uv sync
	npm install

# --- Code Quality ---

format: ## Auto-format code
	cd backend && uvx ruff format .
	cd gpu-server && uvx ruff format .
	npx prettier --write "src/**/*.{svelte,ts,js,css}"

lint: ## Lint code with auto-fix
	cd backend && uvx ruff check --fix .
	cd gpu-server && uvx ruff check --fix .

typecheck: ## Type check
	npx svelte-check --threshold error

check: format lint typecheck ## Run all quality checks

test: ## Run tests
	cd backend && .venv/bin/python -m pytest -v
	cd gpu-server && uv run pytest -v

# --- Development ---

serve: serve-backend serve-frontend ## Start backend + frontend

serve-backend: ## Start backend on port 8000
	cd backend && uv run uvicorn lejonet_backend.app:app --reload --port 8000 --host 0.0.0.0 &

serve-frontend: ## Start frontend dev server (set GPU_SERVER_URL for remote GPU)
	GPU_SERVER_URL=$(GPU_SERVER_URL) npx vite dev --port 5173 &

serve-gpu: ## Start GPU server (Docker, ROCm)
	docker run --rm -d \
		--device /dev/kfd --device /dev/dri --group-add video \
		--shm-size=4g \
		-v $(PWD)/public/models:/models \
		-p 8080:8080 -p 8265:8265 \
		--network lejonet_lejonet \
		--name lejonet-gpu \
		lejonet-gpu:rocm

serve-all: serve serve-gpu ## Start all services

# --- Docker ---

build-gpu: ## Build GPU server Docker image (ROCm)
	cd gpu-server && docker build -f Dockerfile.rocm -t lejonet-gpu:rocm .

build-gpu-nvidia: ## Build GPU server Docker image (NVIDIA)
	cd gpu-server && docker build -f Dockerfile.nvidia -t lejonet-gpu:nvidia .

compose-up: ## Start Prometheus + Grafana
	docker compose up -d prometheus grafana

compose-down: ## Stop all Docker Compose services
	docker compose down

# --- Data ---

ingest-catalog: ## Ingest Riksarkivet metadata into LanceDB
	cd backend && .venv/bin/python ingest_catalog.py $(DATA_DIR) --no-embed

# --- HuggingFace Space ---

deploy: ## Build and deploy frontend to HuggingFace Space
	VITE_MODEL_BASE=https://huggingface.co/carpelan/htr-onnx-models/resolve/main VITE_DISABLE_BACKEND=true npm run build
	rm -rf space/_app space/viewer space/*.html space/*.jpg space/*.svg space/*.mp4
	mkdir -p space/viewer
	rsync -a --exclude='models' build/ space/
	cp space/viewer.html space/viewer/index.html
	cp space/index.html space/200.html
	cp space/index.html space/404.html
	cd space && python3 -c "from huggingface_hub import HfApi; HfApi().upload_folder(folder_path='.', repo_id='carpelan/lejonet', repo_type='space')"
	@echo "Deployed to https://huggingface.co/spaces/carpelan/lejonet"

# --- Documentation ---

docs-serve: ## Serve documentation locally
	uvx zensical serve

docs-build: ## Build documentation site
	uvx zensical build

# --- Cleanup ---

clean: ## Remove caches and builds
	rm -rf .svelte-kit node_modules/.vite
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true

# --- Help ---

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
