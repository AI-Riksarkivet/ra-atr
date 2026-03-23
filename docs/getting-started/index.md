# Getting Started

## Prerequisites

- Node.js 22+

## Setup

```bash
git clone https://github.com/AI-Riksarkivet/ra-atr.git
cd ra-atr

# Install dependencies
make setup

# Start development server
make dev
```

Open http://localhost:5173

## Optional Services

### GPU Inference Server

For faster inference using a GPU, see [lejonet-inference](https://github.com/carpelan/lejonet-inference).

The frontend auto-detects the GPU server at `localhost:8080`.

### Search Backend

For archive catalog search and transcription storage, see [lejonet-search](https://github.com/carpelan/lejonet-search).

```bash
# Run frontend without backend
VITE_DISABLE_BACKEND=true make dev
```

## Make Targets

| Target | Description |
|--------|-------------|
| `make setup` | Install all dependencies |
| `make dev` | Start frontend dev server |
| `make build` | Production build |
| `make deploy` | Build and deploy to HF Space |
| `make quality` | Run prettier + svelte-check |
| `make test` | Run tests |
| `make docs-dev` | Serve documentation locally |
