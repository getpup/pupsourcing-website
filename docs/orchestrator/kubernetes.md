# Kubernetes Deployment

Complete guide to deploying the orchestrator on Kubernetes.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Basic Deployment](#basic-deployment)
- [Health Checks](#health-checks)
- [Graceful Shutdown](#graceful-shutdown)
- [Metrics Service](#metrics-service)
- [Horizontal Pod Autoscaler](#horizontal-pod-autoscaler)
- [Resource Limits](#resource-limits)
- [Complete Example](#complete-example)
- [Deployment Commands](#deployment-commands)
- [Troubleshooting](#troubleshooting)
- [Production Checklist](#production-checklist)
- [Next Steps](#next-steps)

## Overview

This guide covers deploying projection workers using the orchestrator to Kubernetes with:

- Multiple worker replicas for horizontal scaling
- Proper health checks and graceful shutdown
- ConfigMap and Secret management
- Prometheus metrics integration
- Production-ready configurations

## Prerequisites

- Kubernetes cluster (1.19+)
- `kubectl` configured
- PostgreSQL database accessible from cluster
- Container image with your projections

## Basic Deployment

### 1. Create Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: projections
```

Apply:
```bash
kubectl apply -f namespace.yaml
```

### 2. Create Database Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: database-credentials
  namespace: projections
type: Opaque
stringData:
  url: "postgres://user:password@postgres.default.svc.cluster.local:5432/mydb?sslmode=require"
```

Apply:
```bash
kubectl apply -f database-secret.yaml
```

!!! warning "Production Secrets"
    In production, use a proper secret management solution:
    - External Secrets Operator
    - Sealed Secrets
    - HashiCorp Vault
    - Cloud provider secret managers (AWS Secrets Manager, GCP Secret Manager, etc.)

### 3. Create ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: projections-config
  namespace: projections
data:
  REPLICA_SET: "main-projections"
  HEARTBEAT_INTERVAL: "5s"
  STALE_WORKER_TIMEOUT: "30s"
  COORDINATION_TIMEOUT: "60s"
  BATCH_SIZE: "100"
  LOG_LEVEL: "info"
```

Apply:
```bash
kubectl apply -f configmap.yaml
```

### 4. Create Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: projections
  namespace: projections
  labels:
    app: projections
    version: v1.0.0
spec:
  replicas: 3
  selector:
    matchLabels:
      app: projections
  template:
    metadata:
      labels:
        app: projections
        version: v1.0.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      terminationGracePeriodSeconds: 60
      
      containers:
      - name: projections
        image: myregistry/projections:v1.0.0
        imagePullPolicy: IfNotPresent
        
        ports:
        - name: metrics
          containerPort: 9090
          protocol: TCP
        
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: url
        
        envFrom:
        - configMapRef:
            name: projections-config
        
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
        
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
```

Apply:
```bash
kubectl apply -f deployment.yaml
```

## Health Checks

Implement health check endpoints in your application:

### Liveness Probe

Checks if the application is alive and should restart if failing:

```go
func healthHandler(w http.ResponseWriter, r *http.Request) {
    // Check if application is responsive
    // Don't check database - that's for readiness
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("OK"))
}

func main() {
    http.HandleFunc("/health", healthHandler)
    go http.ListenAndServe(":8080", nil)
    
    // ... orchestrator setup ...
}
```

### Readiness Probe

Checks if the application can serve traffic:

```go
var (
    isReady     atomic.Bool
    dbConnected atomic.Bool
)

func readyHandler(w http.ResponseWriter, r *http.Request) {
    if !isReady.Load() {
        w.WriteHeader(http.StatusServiceUnavailable)
        w.Write([]byte("Not ready"))
        return
    }
    
    // Check database connectivity
    if err := db.PingContext(r.Context()); err != nil {
        w.WriteHeader(http.StatusServiceUnavailable)
        w.Write([]byte("Database not available"))
        return
    }
    
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("Ready"))
}

func main() {
    http.HandleFunc("/ready", readyHandler)
    go http.ListenAndServe(":8080", nil)
    
    // Mark ready after initialization
    defer isReady.Store(true)
    
    // ... orchestrator setup ...
}
```

## Graceful Shutdown

Handle SIGTERM properly for graceful pod termination:

```go
func main() {
    // Create context for shutdown
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    // Handle shutdown signals
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
    
    go func() {
        sig := <-sigCh
        log.Printf("Received signal %v, initiating graceful shutdown", sig)
        
        // Mark as not ready
        isReady.Store(false)
        
        // Give load balancer time to remove pod
        time.Sleep(5 * time.Second)
        
        // Cancel context to stop orchestrator
        cancel()
    }()
    
    // Run orchestrator (blocks until context canceled)
    if err := orch.Run(ctx, projections); err != nil && err != context.Canceled {
        log.Fatalf("Orchestrator error: %v", err)
    }
    
    log.Println("Shutdown complete")
}
```

**Shutdown Flow:**
```
1. Kubernetes sends SIGTERM
2. Application receives signal
3. Mark readiness probe as failed (stops receiving traffic)
4. Wait 5 seconds (load balancer updates)
5. Cancel context (orchestrator stops)
6. Worker unregisters from replica set
7. Application exits
8. Pod terminates
```

## Metrics Service

Create a Service for Prometheus scraping:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: projections-metrics
  namespace: projections
  labels:
    app: projections
spec:
  type: ClusterIP
  ports:
  - name: metrics
    port: 9090
    targetPort: 9090
    protocol: TCP
  selector:
    app: projections
```

### ServiceMonitor (Prometheus Operator)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: projections
  namespace: projections
  labels:
    app: projections
spec:
  selector:
    matchLabels:
      app: projections
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

Apply:
```bash
kubectl apply -f service.yaml
kubectl apply -f servicemonitor.yaml
```

## Horizontal Pod Autoscaler

!!! warning "HPA Considerations"
    The orchestrator uses a Recreate strategy - all workers pause during scaling.
    Use **conservative** settings or **manual scaling** for most workloads.

### CPU-Based HPA (Conservative)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: projections-hpa
  namespace: projections
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: projections
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 300  # 5 minutes
      policies:
      - type: Pods
        value: 1
        periodSeconds: 60
      selectPolicy: Min
    scaleDown:
      stabilizationWindowSeconds: 600  # 10 minutes
      policies:
      - type: Pods
        value: 1
        periodSeconds: 180
      selectPolicy: Min
```

### Custom Metrics HPA (Recommended)

Use projection lag instead of CPU:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: projections-hpa
  namespace: projections
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: projections
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Pods
    pods:
      metric:
        name: projection_lag_events
      target:
        type: AverageValue
        averageValue: "10000"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 300
      policies:
      - type: Pods
        value: 2
        periodSeconds: 120
    scaleDown:
      stabilizationWindowSeconds: 900  # 15 minutes
      policies:
      - type: Pods
        value: 1
        periodSeconds: 300
```

Requires Prometheus Adapter or similar to expose custom metrics.

## Resource Limits

### Sizing Guidelines

**Small Workload** (< 100 events/sec per worker):
```yaml
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

**Medium Workload** (100-500 events/sec per worker):
```yaml
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1Gi
```

**Large Workload** (> 500 events/sec per worker):
```yaml
resources:
  requests:
    cpu: 1000m
    memory: 1Gi
  limits:
    cpu: 2000m
    memory: 2Gi
```

### Database Connection Pooling

Size connection pool based on replicas:

```go
// Calculate based on expected replicas
expectedReplicas := 5
projectionsPerWorker := 3

maxConns := expectedReplicas * projectionsPerWorker * 2
db.SetMaxOpenConns(maxConns)  // e.g., 30
db.SetMaxIdleConns(maxConns / 2)  // e.g., 15
```

## Complete Example

### Complete Deployment with All Features

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: projections

---
apiVersion: v1
kind: Secret
metadata:
  name: database-credentials
  namespace: projections
type: Opaque
stringData:
  url: "postgres://user:pass@postgres.default.svc.cluster.local:5432/mydb?sslmode=require"

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: projections-config
  namespace: projections
data:
  REPLICA_SET: "main-projections"
  HEARTBEAT_INTERVAL: "5s"
  STALE_WORKER_TIMEOUT: "30s"
  COORDINATION_TIMEOUT: "60s"
  BATCH_SIZE: "100"
  LOG_LEVEL: "info"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: projections
  namespace: projections
  labels:
    app: projections
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: projections
  template:
    metadata:
      labels:
        app: projections
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      
      containers:
      - name: projections
        image: myregistry/projections:v1.0.0
        imagePullPolicy: IfNotPresent
        
        ports:
        - name: metrics
          containerPort: 9090
        - name: health
          containerPort: 8080
        
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: url
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
        
        envFrom:
        - configMapRef:
            name: projections-config
        
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
        
        livenessProbe:
          httpGet:
            path: /health
            port: health
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        
        readinessProbe:
          httpGet:
            path: /ready
            port: health
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3

---
apiVersion: v1
kind: Service
metadata:
  name: projections-metrics
  namespace: projections
  labels:
    app: projections
spec:
  type: ClusterIP
  ports:
  - name: metrics
    port: 9090
    targetPort: 9090
  selector:
    app: projections

---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: projections
  namespace: projections
  labels:
    app: projections
spec:
  selector:
    matchLabels:
      app: projections
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

## Deployment Commands

```bash
# Apply all resources
kubectl apply -f deployment-complete.yaml

# Check deployment status
kubectl -n projections get deployment projections

# Check pods
kubectl -n projections get pods

# View logs
kubectl -n projections logs -f deployment/projections

# Scale manually
kubectl -n projections scale deployment projections --replicas=5

# Check worker coordination
kubectl -n projections logs deployment/projections | grep -i "worker\|generation\|partition"
```

## Troubleshooting

### Pods CrashLooping

Check logs:
```bash
kubectl -n projections logs deployment/projections --previous
```

Common causes:
- Database connection failure
- Missing migrations
- Configuration errors
- Invalid replica set name

### Workers Not Coordinating

Verify all pods using same config:
```bash
kubectl -n projections get pods -o jsonpath='{.items[*].spec.containers[*].env[?(@.name=="REPLICA_SET")].value}'
```

Check database connectivity:
```bash
kubectl -n projections exec -it deployment/projections -- /bin/sh
# Inside pod
psql $DATABASE_URL -c "SELECT * FROM orchestrator_workers;"
```

### High Resource Usage

Check actual usage:
```bash
kubectl -n projections top pods
```

Consider:
- Reducing `BATCH_SIZE`
- Increasing resource limits
- Reviewing projection logic for inefficiencies

### Metrics Not Appearing

Verify metrics endpoint:
```bash
kubectl -n projections port-forward deployment/projections 9090:9090
curl http://localhost:9090/metrics | grep pupsourcing_orchestrator
```

Check ServiceMonitor:
```bash
kubectl -n projections get servicemonitor
kubectl -n projections describe servicemonitor projections
```

## Production Checklist

- [ ] Database credentials in Secret (not ConfigMap)
- [ ] Resource requests and limits configured
- [ ] Health checks (liveness and readiness) implemented
- [ ] Graceful shutdown handling (SIGTERM)
- [ ] `terminationGracePeriodSeconds` >= 60
- [ ] Metrics exposed and scraped by Prometheus
- [ ] Alerting rules configured
- [ ] Logs being collected and indexed
- [ ] Multiple replicas for high availability
- [ ] HPA configured (if needed) with conservative settings
- [ ] Network policies in place (if required)
- [ ] Pod security policies applied
- [ ] Resource quotas set for namespace
- [ ] Monitoring dashboard created

## Next Steps

- **[Metrics](metrics.md)** - Set up Grafana dashboards and alerts
- **[Scaling](scaling.md)** - Learn when and how to scale
- **[Configuration](configuration.md)** - Tune for your specific needs
