# Installation

## Prerequisites

- Node.js 22+
- Python 3.11+
- Docker (for GPU server and monitoring)

## Setup

```bash
# Clone
git clone https://github.com/AI-Riksarkivet/lejonet.git
cd lejonet

# Install all dependencies
make install

# Start development servers
make serve
```

Open http://localhost:5173

## GPU Server (Optional)

For faster inference using a GPU:

### AMD ROCm
```bash
make build-gpu
make serve-gpu
```

### NVIDIA CUDA
```bash
make build-gpu-nvidia
docker run --gpus all -v ./public/models:/models -p 8080:8080 lejonet-gpu:nvidia
```

The frontend auto-detects the GPU server at localhost:8080.

## Monitoring (Optional)

```bash
make compose-up
```

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000
- Ray Dashboard: http://localhost:8265
