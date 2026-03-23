# Helm Chart Design — Frontend Only

## Goal

Create a Helm chart for Kubernetes deployment of the ra-atr frontend, following the ra-hcp chart conventions.

## Scope

Frontend-only: nginx serving the static SPA build from `.docker/frontend.dockerfile`.

## Chart Structure

```
charts/helm-ra-atr-v0.1.0/
├── Chart.yaml
├── values.yaml
├── .helmignore
└── templates/
    ├── _helpers.tpl
    ├── configmap.yaml        # nginx config (SPA fallback + COOP/COEP headers)
    ├── deployment.yaml       # nginx container
    ├── service.yaml          # NodePort/ClusterIP/LoadBalancer
    ├── ingress.yaml          # Optional ingress
    ├── hpa.yaml              # Optional autoscaling
    ├── pdb.yaml              # Optional pod disruption budget
    └── NOTES.txt             # Post-install instructions
```

## Key Decisions

### nginx config in ConfigMap

The nginx configuration (SPA fallback routing, COOP/COEP headers for SharedArrayBuffer/multi-threaded WASM) is stored in a ConfigMap rather than baked into the Docker image. This allows tuning headers and routing per-deployment without rebuilding.

### Required CORS headers

ONNX Runtime Web requires `SharedArrayBuffer` for multi-threaded WASM inference. Browsers gate this behind:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

These are included in the nginx ConfigMap by default.

### Security

- Non-root user (1000:1000)
- Read-only root filesystem
- Drop all capabilities
- No privilege escalation

## values.yaml

```yaml
replicaCount: 1
image:
  repository: AI-Riksarkivet/ra-atr
  tag: ""  # defaults to appVersion
  pullPolicy: IfNotPresent
service:
  type: NodePort
  port: 80
  nodePort: 30517
ingress:
  enabled: false
autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 5
podDisruptionBudget:
  enabled: false
  maxUnavailable: 1
```

## Reference

Based on `ra-hcp/charts/helm-ra-hcp-v0.1.0/` — same helpers, labels, security context pattern.
