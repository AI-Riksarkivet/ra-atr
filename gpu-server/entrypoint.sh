#!/bin/bash
# Resize /dev/shm for Ray (RunPod default is 64MB, Ray needs GBs)
if [ -d /dev/shm ]; then
  mount -o remount,size=8G /dev/shm 2>/dev/null && echo "Resized /dev/shm to 8G" || echo "Could not resize /dev/shm (non-fatal)"
fi

# MODE=simple to skip Ray, just uvicorn
if [ "$MODE" = "simple" ]; then
  echo "Starting in simple mode (no Ray)"
  exec uv run uvicorn lejonet_gpu.app:app --host 0.0.0.0 --port 8080
fi

exec "$@"
