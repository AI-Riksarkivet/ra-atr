FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
WORKDIR /app
COPY pyproject.toml .
COPY src/ src/
RUN uv venv && uv pip install -e .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "lejonet_backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
