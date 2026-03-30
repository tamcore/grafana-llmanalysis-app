# Deploying with grafana-operator

This guide covers deploying the LLM Analysis plugin using the
[grafana-operator](https://github.com/grafana/grafana-operator) (v5+).

## Prerequisites

- Kubernetes cluster with grafana-operator installed
- `kubectl` access to the target namespace
- The plugin archive available (built from source or downloaded from a release)

Install the operator if you haven't already:

```bash
helm upgrade -i grafana-operator oci://ghcr.io/grafana/helm-charts/grafana-operator \
  --namespace grafana-operator --create-namespace
```

## 1. Namespace and Secrets

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: grafana
---
apiVersion: v1
kind: Secret
metadata:
  name: grafana-admin
  namespace: grafana
type: Opaque
stringData:
  password: "change-me"
```

## 2. Grafana Instance

The `Grafana` CR manages the Grafana deployment. Key points:

- `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS` must list the plugin ID
- `spec.config.plugins.allow_loading_unsigned_plugins` mirrors this in the INI config
- The plugin binary must be available in the container's plugin directory

```yaml
apiVersion: grafana.integreatly.org/v1beta1
kind: Grafana
metadata:
  name: grafana
  namespace: grafana
  labels:
    app: grafana
spec:
  version: "12.4.2"

  config:
    security:
      admin_user: admin
      admin_password: ${GF_SECURITY_ADMIN_PASSWORD}
    plugins:
      allow_loading_unsigned_plugins: tamcore-llmanalysis-app

  deployment:
    spec:
      template:
        spec:
          containers:
            - name: grafana
              env:
                - name: GF_SECURITY_ADMIN_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: grafana-admin
                      key: password
                - name: GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS
                  value: tamcore-llmanalysis-app
              resources:
                requests:
                  cpu: 100m
                  memory: 128Mi
                limits:
                  cpu: 500m
                  memory: 512Mi
              volumeMounts:
                - name: llm-plugin
                  mountPath: /var/lib/grafana/plugins/tamcore-llmanalysis-app
          volumes:
            - name: llm-plugin
              emptyDir: {}
```

### Loading the Plugin

The operator does not have a native way to install arbitrary app plugins from
a URL. You have several options:

**Option A — Init container (recommended)**

Add an init container that downloads or copies the plugin into the shared volume:

```yaml
deployment:
  spec:
    template:
      spec:
        initContainers:
          - name: install-llm-plugin
            image: busybox:latest
            command: ["sh", "-c"]
            args:
              - |
                wget -qO- https://github.com/tamcore/grafana-llmanalysis-app/releases/download/v1.0.0/tamcore-llmanalysis-app-1.0.0.tar.gz \
                  | tar xz -C /plugins/
            volumeMounts:
              - name: llm-plugin
                mountPath: /plugins
        containers:
          - name: grafana
            volumeMounts:
              - name: llm-plugin
                mountPath: /var/lib/grafana/plugins/tamcore-llmanalysis-app
        volumes:
          - name: llm-plugin
            emptyDir: {}
```

**Option B — PVC with manual upload**

Use a `PersistentVolumeClaim` and copy the plugin once:

```yaml
volumes:
  - name: llm-plugin
    persistentVolumeClaim:
      claimName: grafana-plugins
```

```bash
# Copy plugin to the PVC (via a running pod)
kubectl cp dist/ grafana/<pod-name>:/var/lib/grafana/plugins/tamcore-llmanalysis-app/
```

**Option C — Custom Grafana image**

Build a Grafana image with the plugin pre-installed:

```dockerfile
FROM grafana/grafana:12.4.2
COPY dist/ /var/lib/grafana/plugins/tamcore-llmanalysis-app/
```

Then reference it in the CR:

```yaml
spec:
  deployment:
    spec:
      template:
        spec:
          containers:
            - name: grafana
              image: your-registry/grafana-with-llm:12.4.2
```

## 3. Datasources

Use `GrafanaDatasource` CRs to provision the datasources the plugin queries.
The `instanceSelector` must match labels on your `Grafana` CR.

```yaml
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: prometheus
  namespace: grafana
spec:
  instanceSelector:
    matchLabels:
      app: grafana
  datasource:
    name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus-server.monitoring.svc:9090
    isDefault: true
    editable: true
---
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: loki
  namespace: grafana
spec:
  instanceSelector:
    matchLabels:
      app: grafana
  datasource:
    name: Loki
    type: loki
    access: proxy
    url: http://loki.monitoring.svc:3100
    editable: true
---
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: alertmanager
  namespace: grafana
spec:
  instanceSelector:
    matchLabels:
      app: grafana
  datasource:
    name: Alertmanager
    type: alertmanager
    access: proxy
    url: http://alertmanager.monitoring.svc:9093
    editable: true
    jsonData:
      implementation: prometheus
```

## 4. Dashboards (optional)

Provision dashboards so the plugin can inspect and explain them:

```yaml
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaFolder
metadata:
  name: kubernetes
  namespace: grafana
spec:
  instanceSelector:
    matchLabels:
      app: grafana
  title: Kubernetes
---
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDashboard
metadata:
  name: cluster-overview
  namespace: grafana
spec:
  instanceSelector:
    matchLabels:
      app: grafana
  folder: kubernetes
  url: https://raw.githubusercontent.com/dotdc/grafana-dashboards-kubernetes/master/dashboards/k8s-views-global.json
```

## 5. Ingress (optional)

The operator can manage an Ingress. Alternatively, create one yourself:

```yaml
apiVersion: grafana.integreatly.org/v1beta1
kind: Grafana
metadata:
  name: grafana
spec:
  # ... other config ...
  ingress:
    metadata:
      annotations:
        cert-manager.io/cluster-issuer: letsencrypt-prod
    spec:
      ingressClassName: nginx
      rules:
        - host: grafana.example.com
          http:
            paths:
              - path: /
                pathType: Prefix
                backend:
                  service:
                    name: grafana-service
                    port:
                      number: 3000
      tls:
        - hosts:
            - grafana.example.com
          secretName: grafana-tls
```

## 6. Plugin Configuration

After deployment, configure the LLM endpoint:

1. Log in to Grafana
2. Go to **Administration → Plugins → LLM Analysis → Configuration**
3. Set your endpoint URL, model, and API key
4. Click **Test Connection**, then **Save**

Alternatively, provision the plugin configuration via the Grafana API:

```bash
curl -u admin:change-me -X POST \
  http://grafana.example.com/api/plugins/tamcore-llmanalysis-app/settings \
  -H 'Content-Type: application/json' \
  -d '{
    "enabled": true,
    "jsonData": {
      "endpointURL": "https://api.openai.com/v1",
      "model": "gpt-4o",
      "timeoutSeconds": 60,
      "maxTokens": 4096,
      "maxContextTokens": 120000
    },
    "secureJsonData": {
      "apiKey": "sk-..."
    }
  }'
```

## Complete Example

A single-file deployment combining all resources:

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Namespace
metadata:
  name: grafana
---
apiVersion: v1
kind: Secret
metadata:
  name: grafana-admin
  namespace: grafana
stringData:
  password: "change-me"
---
apiVersion: grafana.integreatly.org/v1beta1
kind: Grafana
metadata:
  name: grafana
  namespace: grafana
  labels:
    app: grafana
spec:
  version: "12.4.2"
  config:
    security:
      admin_user: admin
      admin_password: ${GF_SECURITY_ADMIN_PASSWORD}
    plugins:
      allow_loading_unsigned_plugins: tamcore-llmanalysis-app
  deployment:
    spec:
      template:
        spec:
          initContainers:
            - name: install-llm-plugin
              image: busybox:latest
              command: ["sh", "-c"]
              args:
                - |
                  wget -qO- https://github.com/tamcore/grafana-llmanalysis-app/releases/download/v1.0.0/tamcore-llmanalysis-app-1.0.0.tar.gz \
                    | tar xz -C /plugins/
              volumeMounts:
                - name: llm-plugin
                  mountPath: /plugins
          containers:
            - name: grafana
              env:
                - name: GF_SECURITY_ADMIN_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: grafana-admin
                      key: password
                - name: GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS
                  value: tamcore-llmanalysis-app
              volumeMounts:
                - name: llm-plugin
                  mountPath: /var/lib/grafana/plugins/tamcore-llmanalysis-app
          volumes:
            - name: llm-plugin
              emptyDir: {}
---
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: prometheus
  namespace: grafana
spec:
  instanceSelector:
    matchLabels:
      app: grafana
  datasource:
    name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus-server.monitoring.svc:9090
    isDefault: true
---
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: loki
  namespace: grafana
spec:
  instanceSelector:
    matchLabels:
      app: grafana
  datasource:
    name: Loki
    type: loki
    access: proxy
    url: http://loki.monitoring.svc:3100
EOF
```

## Troubleshooting

```bash
# Operator logs
kubectl logs -f deployment/grafana-operator -n grafana-operator

# Grafana pod logs
kubectl logs -f deployment/grafana-deployment -n grafana

# Verify plugin loaded
kubectl exec -it deployment/grafana-deployment -n grafana -- \
  ls -la /var/lib/grafana/plugins/tamcore-llmanalysis-app/

# Check Grafana CR status
kubectl describe grafana grafana -n grafana
```

| Symptom | Fix |
|---------|-----|
| Plugin not listed in UI | Check `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS` env var |
| "Plugin not found" errors | Verify the plugin binary exists at the expected mount path |
| Backend plugin won't start | Check Grafana logs for `msg="plugin process exited"` errors |
| Datasources missing | Verify `instanceSelector` labels match the `Grafana` CR labels |
