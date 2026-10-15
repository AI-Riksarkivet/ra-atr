# Static build for HF Space or any static hosting
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ARG VITE_MODEL_BASE=https://huggingface.co/carpelan/htr-onnx-models/resolve/main
ARG VITE_DISABLE_BACKEND=true
RUN npm run build

FROM nginx:alpine@sha256:72aeb3308ef6cb3118242fb16389518923916dfa206e32d1a8377acc328b9870
COPY --from=build /app/build /usr/share/nginx/html

# SPA fallback
RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html; } }' \
    > /etc/nginx/conf.d/default.conf

EXPOSE 80
