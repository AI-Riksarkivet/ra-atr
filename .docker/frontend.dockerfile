# Static build for HF Space or any static hosting
FROM node:25-slim AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ARG VITE_MODEL_BASE=https://huggingface.co/carpelan/htr-onnx-models/resolve/main
ARG VITE_DISABLE_BACKEND=true
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html

# SPA fallback
RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html; } }' \
    > /etc/nginx/conf.d/default.conf

EXPOSE 80
