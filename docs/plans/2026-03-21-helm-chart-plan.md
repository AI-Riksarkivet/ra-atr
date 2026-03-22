# Helm Chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Helm chart for Kubernetes deployment of the Lejonet frontend (nginx serving static SPA).

**Architecture:** Single-container deployment serving the pre-built SPA via nginx. nginx config lives in a ConfigMap for per-deployment tuning of COOP/COEP headers and SPA fallback routing. Follows ra-hcp chart conventions for helpers, labels, and security context.

**Tech Stack:** Helm 3, Kubernetes, nginx

**Reference:** `~/ra-hcp/charts/helm-ra-hcp-v0.1.0/` for conventions. Design doc at `docs/plans/2026-03-21-helm-chart-design.md`.

---

### Task 1: Chart.yaml and .helmignore

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/Chart.yaml`
- Create: `charts/helm-lejonet-v0.1.0/.helmignore`

**Step 1: Create Chart.yaml**

```yaml
apiVersion: v2
name: lejonet
description: Svelte 5 frontend for handwritten text recognition with in-browser ONNX Runtime WASM inference
type: application
version: 0.1.0
appVersion: "v0.1.0"
home: https://github.com/carpelan/lejonet
sources:
  - https://github.com/carpelan/lejonet
maintainers:
  - name: carpelan
```

**Step 2: Create .helmignore**

```
.DS_Store
.git
.gitignore
.idea
*.swp
*.bak
*.tmp
```

**Step 3: Commit**

```bash
git add charts/
git commit -m "chore: scaffold helm chart with Chart.yaml"
```

---

### Task 2: _helpers.tpl

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/templates/_helpers.tpl`

**Step 1: Create helpers**

Adapted from ra-hcp — provides `lejonet.name`, `lejonet.fullname`, `lejonet.chart`, `lejonet.labels`, `lejonet.selectorLabels`.

```gotemplate
{{/*
Expand the name of the chart.
*/}}
{{- define "lejonet.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "lejonet.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "lejonet.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "lejonet.labels" -}}
helm.sh/chart: {{ include "lejonet.chart" . }}
{{ include "lejonet.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "lejonet.selectorLabels" -}}
app.kubernetes.io/name: {{ include "lejonet.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

**Step 2: Commit**

```bash
git add charts/
git commit -m "chore: add helm template helpers"
```

---

### Task 3: configmap.yaml (nginx config)

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/templates/configmap.yaml`

**Step 1: Create nginx ConfigMap**

nginx config with SPA fallback and COOP/COEP headers for SharedArrayBuffer (required for multi-threaded ONNX WASM).

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "lejonet.fullname" . }}-nginx
  labels:
    {{- include "lejonet.labels" . | nindent 4 }}
data:
  default.conf: |
    server {
      listen 80;
      root /usr/share/nginx/html;

      # Required for SharedArrayBuffer (multi-threaded WASM)
      add_header Cross-Origin-Opener-Policy "same-origin" always;
      add_header Cross-Origin-Embedder-Policy "credentialless" always;
      add_header Cross-Origin-Resource-Policy "cross-origin" always;

      location / {
        try_files $uri $uri/ /index.html;
      }

      # Cache static assets
      location ~* \.(js|css|wasm|onnx|jpg|png|svg|ico)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        # Re-add COOP/COEP since add_header in nested block overrides parent
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "credentialless" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
      }
    }
```

**Step 2: Commit**

```bash
git add charts/
git commit -m "feat: add nginx configmap with COOP/COEP headers"
```

---

### Task 4: deployment.yaml

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/templates/deployment.yaml`

**Step 1: Create deployment**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "lejonet.fullname" . }}
  labels:
    {{- include "lejonet.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "lejonet.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      {{- with .Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "lejonet.selectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.podSecurityContext }}
      securityContext:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: frontend
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 80
              protocol: TCP
          livenessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 5
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 3
            periodSeconds: 10
          {{- with .Values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.securityContext }}
          securityContext:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/conf.d
              readOnly: true
            - name: tmp
              mountPath: /tmp
            - name: nginx-cache
              mountPath: /var/cache/nginx
            - name: nginx-run
              mountPath: /var/run
      volumes:
        - name: nginx-config
          configMap:
            name: {{ include "lejonet.fullname" . }}-nginx
        - name: tmp
          emptyDir: {}
        - name: nginx-cache
          emptyDir: {}
        - name: nginx-run
          emptyDir: {}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

**Step 2: Commit**

```bash
git add charts/
git commit -m "feat: add frontend deployment template"
```

---

### Task 5: service.yaml

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/templates/service.yaml`

**Step 1: Create service**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lejonet.fullname" . }}
  labels:
    {{- include "lejonet.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
      {{- if and (eq .Values.service.type "NodePort") .Values.service.nodePort }}
      nodePort: {{ .Values.service.nodePort }}
      {{- end }}
  selector:
    {{- include "lejonet.selectorLabels" . | nindent 4 }}
```

**Step 2: Commit**

```bash
git add charts/
git commit -m "feat: add service template"
```

---

### Task 6: ingress.yaml

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/templates/ingress.yaml`

**Step 1: Create ingress**

```yaml
{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "lejonet.fullname" . }}
  labels:
    {{- include "lejonet.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls }}
  tls:
    {{- range .Values.ingress.tls }}
    - hosts:
        {{- range .hosts }}
        - {{ . | quote }}
        {{- end }}
      secretName: {{ .secretName }}
    {{- end }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "lejonet.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
    {{- end }}
{{- end }}
```

**Step 2: Commit**

```bash
git add charts/
git commit -m "feat: add ingress template"
```

---

### Task 7: hpa.yaml and pdb.yaml

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/templates/hpa.yaml`
- Create: `charts/helm-lejonet-v0.1.0/templates/pdb.yaml`

**Step 1: Create HPA**

```yaml
{{- if .Values.autoscaling.enabled -}}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "lejonet.fullname" . }}
  labels:
    {{- include "lejonet.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "lejonet.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
```

**Step 2: Create PDB**

```yaml
{{- if .Values.podDisruptionBudget.enabled -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "lejonet.fullname" . }}
  labels:
    {{- include "lejonet.labels" . | nindent 4 }}
spec:
  {{- if .Values.podDisruptionBudget.minAvailable }}
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  {{- else }}
  maxUnavailable: {{ .Values.podDisruptionBudget.maxUnavailable }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "lejonet.selectorLabels" . | nindent 6 }}
{{- end }}
```

**Step 3: Commit**

```bash
git add charts/
git commit -m "feat: add HPA and PDB templates"
```

---

### Task 8: values.yaml and NOTES.txt

**Files:**
- Create: `charts/helm-lejonet-v0.1.0/values.yaml`
- Create: `charts/helm-lejonet-v0.1.0/templates/NOTES.txt`

**Step 1: Create values.yaml**

```yaml
replicaCount: 1

imagePullSecrets: []
  # - name: regcred

image:
  repository: carpelan/lejonet
  tag: ""  # defaults to appVersion from Chart.yaml
  pullPolicy: IfNotPresent

service:
  type: NodePort
  port: 80
  nodePort: 30517

ingress:
  enabled: false
  className: ""
  annotations: {}
  hosts: []
  tls: []

resources: {}
  # limits:
  #   cpu: 200m
  #   memory: 128Mi
  # requests:
  #   cpu: 50m
  #   memory: 64Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 5
  targetCPUUtilizationPercentage: 80

podDisruptionBudget:
  enabled: false
  # minAvailable: 1
  maxUnavailable: 1

nodeSelector: {}
tolerations: []
affinity: {}
podAnnotations: {}

podSecurityContext:
  runAsUser: 1000
  runAsGroup: 1000
  runAsNonRoot: true

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

**Step 2: Create NOTES.txt**

```
Lejonet HTR has been deployed!

1. Get the application URL:
{{- if .Values.ingress.enabled }}
{{- range .Values.ingress.hosts }}
  http{{ if $.Values.ingress.tls }}s{{ end }}://{{ .host }}
{{- end }}
{{- else if eq .Values.service.type "NodePort" }}
  export NODE_IP=$(kubectl get nodes --namespace {{ .Release.Namespace }} -o jsonpath="{.items[0].status.addresses[0].address}")
  echo "Frontend: http://$NODE_IP:{{ .Values.service.nodePort }}"
{{- else if eq .Values.service.type "LoadBalancer" }}
  NOTE: It may take a few minutes for the LoadBalancer IP to be available.
  kubectl get --namespace {{ .Release.Namespace }} svc {{ include "lejonet.fullname" . }} -w
{{- else }}
  kubectl --namespace {{ .Release.Namespace }} port-forward svc/{{ include "lejonet.fullname" . }} {{ .Values.service.port }}:{{ .Values.service.port }}
  echo "Frontend: http://127.0.0.1:{{ .Values.service.port }}"
{{- end }}
```

**Step 3: Commit**

```bash
git add charts/
git commit -m "feat: add values.yaml and NOTES.txt"
```

---

### Task 9: Validate chart

**Step 1: Lint the chart**

```bash
helm lint charts/helm-lejonet-v0.1.0/
```

Expected: `1 chart(s) linted, 0 chart(s) failed`

**Step 2: Template render check**

```bash
helm template test charts/helm-lejonet-v0.1.0/ | head -80
```

Expected: Valid YAML output with all templates rendered.

**Step 3: Commit any fixes, then final commit**

```bash
git add charts/
git commit -m "feat: complete lejonet helm chart"
```
