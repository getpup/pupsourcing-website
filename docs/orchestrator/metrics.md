# Metrics

Prometheus metrics for monitoring orchestrator health and performance.

---

## Table of Contents

- [Overview](#overview)
- [Metrics Integration](#metrics-integration)
- [Available Metrics](#available-metrics)
- [Example Queries](#example-queries)
- [Grafana Dashboard](#grafana-dashboard)
- [Alerting Rules](#alerting-rules)
- [Next Steps](#next-steps)

## Overview

The orchestrator automatically exposes Prometheus metrics prefixed with `pupsourcing_orchestrator_`. These metrics provide visibility into:

- Worker coordination and health
- Event processing throughput
- Generation changes and stability
- Error rates and failures
- Performance characteristics

## Metrics Integration

### Automatic Integration

Metrics are automatically registered to the Prometheus default registry when the orchestrator starts (default behavior).

If your application already has a `/metrics` endpoint using the default registry, orchestrator metrics appear automatically:

```go
import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "github.com/getpup/pupsourcing-orchestrator"
)

func main() {
    // Your existing metrics endpoint
    http.Handle("/metrics", promhttp.Handler())
    go http.ListenAndServe(":9090", nil)

    // Create orchestrator - metrics automatically available
    orch, _ := orchestrator.New(orchestrator.Config{
        DB:         db,
        EventStore: eventStore,
        ReplicaSet: "main-projections",
        // MetricsEnabled defaults to true
    })

    orch.Run(ctx, projections)
}
```

### Standalone Metrics Server

For a dedicated metrics endpoint:

```go
import "github.com/getpup/pupsourcing-orchestrator/metrics"

// Start metrics server on dedicated port
metricsServer := metrics.NewServer(":9090")
metricsServer.Start()
defer metricsServer.Shutdown(ctx)

// Create orchestrator
orch, _ := orchestrator.New(orchestrator.Config{
    // ... config ...
})
```

### Disabling Metrics

To disable metrics collection:

```go
metricsEnabled := false
orch, _ := orchestrator.New(orchestrator.Config{
    DB:             db,
    EventStore:     eventStore,
    ReplicaSet:     "main-projections",
    MetricsEnabled: &metricsEnabled,
})
```

## Available Metrics

### Counters

Counters track cumulative totals that only increase.

#### pupsourcing_orchestrator_generations_total

**Type:** Counter  
**Labels:** `replica_set`

**Description:** Total number of generations created for a replica set.

**Use Case:** Track how often partition configuration changes occur.

```promql
# Rate of generations per hour
rate(pupsourcing_orchestrator_generations_total{replica_set="main-projections"}[1h]) * 3600

# Alert if > 5 generations per hour (unstable system)
pupsourcing_orchestrator_generations_total{replica_set="main-projections"} > 5
```

#### pupsourcing_orchestrator_workers_registered_total

**Type:** Counter  
**Labels:** `replica_set`

**Description:** Total number of worker registrations.

**Use Case:** Detect worker churn or crash loops.

```promql
# Worker registration rate per minute
rate(pupsourcing_orchestrator_workers_registered_total[5m]) * 60

# High registration rate indicates problems
rate(pupsourcing_orchestrator_workers_registered_total[5m]) > 0.1
```

#### pupsourcing_orchestrator_partition_assignments_total

**Type:** Counter  
**Labels:** `replica_set`

**Description:** Total partition assignments to workers.

**Use Case:** Track coordination activity.

```promql
# Assignments per hour
rate(pupsourcing_orchestrator_partition_assignments_total[1h]) * 3600
```

#### pupsourcing_orchestrator_reconfiguration_total

**Type:** Counter  
**Labels:** `replica_set`

**Description:** Total reconfigurations triggered by worker changes.

**Use Case:** Monitor system stability - low is good.

```promql
# Reconfigurations in last hour
increase(pupsourcing_orchestrator_reconfiguration_total{replica_set="main-projections"}[1h])

# Alert if > 10 per hour
rate(pupsourcing_orchestrator_reconfiguration_total[1h]) * 3600 > 10
```

#### pupsourcing_orchestrator_stale_workers_cleaned_total

**Type:** Counter  
**Labels:** `replica_set`

**Description:** Total stale workers cleaned up (workers that stopped heartbeating).

**Use Case:** Detect worker crashes or network issues.

```promql
# Stale worker cleanup rate
rate(pupsourcing_orchestrator_stale_workers_cleaned_total[1h]) * 3600

# Alert on any stale workers (shouldn't happen in healthy system)
increase(pupsourcing_orchestrator_stale_workers_cleaned_total[5m]) > 0
```

#### pupsourcing_orchestrator_events_processed_total

**Type:** Counter  
**Labels:** `replica_set`, `projection`

**Description:** Total events processed by projection.

**Use Case:** Monitor throughput and processing rates.

```promql
# Events per second by projection
rate(pupsourcing_orchestrator_events_processed_total{projection="user_projection"}[5m])

# Total throughput across all projections
sum(rate(pupsourcing_orchestrator_events_processed_total[5m]))

# Identify slow projections
topk(3, rate(pupsourcing_orchestrator_events_processed_total[5m]))
```

#### pupsourcing_orchestrator_projection_errors_total

**Type:** Counter  
**Labels:** `replica_set`, `projection`

**Description:** Total projection handler errors.

**Use Case:** Monitor projection health and error rates.

```promql
# Error rate per minute
rate(pupsourcing_orchestrator_projection_errors_total[5m]) * 60

# Error percentage
(
  rate(pupsourcing_orchestrator_projection_errors_total[5m])
  /
  rate(pupsourcing_orchestrator_events_processed_total[5m])
) * 100

# Alert if error rate > 1%
(
  rate(pupsourcing_orchestrator_projection_errors_total[5m])
  /
  rate(pupsourcing_orchestrator_events_processed_total[5m])
) > 0.01
```

### Gauges

Gauges represent current values that can increase or decrease.

#### pupsourcing_orchestrator_active_workers

**Type:** Gauge  
**Labels:** `replica_set`

**Description:** Current number of active workers in a replica set.

**Use Case:** Verify correct worker count, detect missing workers.

```promql
# Current active workers
pupsourcing_orchestrator_active_workers{replica_set="main-projections"}

# Alert if workers don't match expected count
abs(
  pupsourcing_orchestrator_active_workers{replica_set="main-projections"}
  - 5  # Expected count
) > 0
```

#### pupsourcing_orchestrator_current_generation_partitions

**Type:** Gauge  
**Labels:** `replica_set`

**Description:** Number of partitions in the current generation.

**Use Case:** Verify partition count matches active workers.

```promql
# Current partitions
pupsourcing_orchestrator_current_generation_partitions{replica_set="main-projections"}

# Partitions should equal active workers
pupsourcing_orchestrator_current_generation_partitions
==
pupsourcing_orchestrator_active_workers
```

#### pupsourcing_orchestrator_worker_state

**Type:** Gauge  
**Labels:** `replica_set`, `worker_id`, `state`

**Description:** Worker state (1 for current state, 0 otherwise).

**States:**
- `initializing` - Worker starting up
- `coordinating` - Participating in generation change
- `processing` - Actively processing events
- `stopping` - Shutting down

**Use Case:** Monitor individual worker states.

```promql
# Workers currently processing
sum(pupsourcing_orchestrator_worker_state{state="processing"})

# Workers stuck coordinating (potential issue)
sum(pupsourcing_orchestrator_worker_state{state="coordinating"})

# Alert if any worker coordinating > 2 minutes
time() - (
  pupsourcing_orchestrator_worker_state{state="coordinating"} > 0
) > 120
```

### Histograms

Histograms track distributions of values over time.

#### pupsourcing_orchestrator_coordination_duration_seconds

**Type:** Histogram  
**Labels:** `replica_set`

**Description:** Time spent coordinating during generation changes.

**Buckets:** 0.1, 0.5, 1, 2, 5, 10, 30, 60 seconds

**Use Case:** Monitor coordination performance.

```promql
# P50 coordination duration
histogram_quantile(0.5,
  rate(pupsourcing_orchestrator_coordination_duration_seconds_bucket[5m])
)

# P99 coordination duration
histogram_quantile(0.99,
  rate(pupsourcing_orchestrator_coordination_duration_seconds_bucket[5m])
)

# Average coordination time
rate(pupsourcing_orchestrator_coordination_duration_seconds_sum[5m])
/
rate(pupsourcing_orchestrator_coordination_duration_seconds_count[5m])

# Alert if P99 > 30 seconds
histogram_quantile(0.99,
  rate(pupsourcing_orchestrator_coordination_duration_seconds_bucket[5m])
) > 30
```

#### pupsourcing_orchestrator_event_processing_duration_seconds

**Type:** Histogram  
**Labels:** `replica_set`, `projection`

**Description:** Event processing latency per projection.

**Buckets:** 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5 seconds

**Use Case:** Identify slow projections and performance issues.

```promql
# P99 processing latency by projection
histogram_quantile(0.99,
  rate(pupsourcing_orchestrator_event_processing_duration_seconds_bucket[5m])
) by (projection)

# Average processing time
rate(pupsourcing_orchestrator_event_processing_duration_seconds_sum[5m])
/
rate(pupsourcing_orchestrator_event_processing_duration_seconds_count[5m])

# Slowest projections
topk(5,
  histogram_quantile(0.99,
    rate(pupsourcing_orchestrator_event_processing_duration_seconds_bucket[5m])
  ) by (projection)
)
```

#### pupsourcing_orchestrator_heartbeat_latency_seconds

**Type:** Histogram  
**Labels:** `replica_set`

**Description:** Heartbeat round-trip latency.

**Buckets:** 0.001, 0.01, 0.05, 0.1, 0.5, 1, 2 seconds

**Use Case:** Monitor database health and network latency.

```promql
# P95 heartbeat latency
histogram_quantile(0.95,
  rate(pupsourcing_orchestrator_heartbeat_latency_seconds_bucket[5m])
)

# Alert if P95 heartbeat > 1 second (database issues)
histogram_quantile(0.95,
  rate(pupsourcing_orchestrator_heartbeat_latency_seconds_bucket[5m])
) > 1
```

## Example Queries

### System Health

```promql
# Overall system health score (0-100)
100 - (
  # Penalty for reconfigurations (up to 30 points)
  min(rate(pupsourcing_orchestrator_reconfiguration_total[1h]) * 3600 * 6, 30)
  +
  # Penalty for error rate (up to 40 points)
  min(
    (rate(pupsourcing_orchestrator_projection_errors_total[5m])
     / rate(pupsourcing_orchestrator_events_processed_total[5m])) * 4000,
    40
  )
  +
  # Penalty for stale workers (up to 30 points)
  min(increase(pupsourcing_orchestrator_stale_workers_cleaned_total[1h]) * 10, 30)
)
```

### Throughput Analysis

```promql
# Total events per second
sum(rate(pupsourcing_orchestrator_events_processed_total[5m]))

# Throughput by projection
sum(rate(pupsourcing_orchestrator_events_processed_total[5m])) by (projection)

# Throughput per worker (should be roughly equal)
sum(rate(pupsourcing_orchestrator_events_processed_total[5m])) by (replica_set)
/
pupsourcing_orchestrator_active_workers
```

### Coordination Analysis

```promql
# % of time spent coordinating (should be low)
(
  rate(pupsourcing_orchestrator_coordination_duration_seconds_sum[5m])
  /
  rate(pupsourcing_orchestrator_coordination_duration_seconds_count[5m] + 
       pupsourcing_orchestrator_events_processed_total[5m])
) * 100

# Coordination frequency
rate(pupsourcing_orchestrator_coordination_duration_seconds_count[5m]) * 60
```

### Performance Analysis

```promql
# Events processed per coordination event (higher is better)
rate(pupsourcing_orchestrator_events_processed_total[5m])
/
rate(pupsourcing_orchestrator_reconfiguration_total[5m])

# Average batch processing time
rate(pupsourcing_orchestrator_event_processing_duration_seconds_sum[5m])
/
rate(pupsourcing_orchestrator_events_processed_total[5m])
```

## Grafana Dashboard

### Recommended Panels

**1. Worker Count**
```promql
pupsourcing_orchestrator_active_workers
```
Graph type: Stat or Time Series

**2. Event Processing Rate**
```promql
sum(rate(pupsourcing_orchestrator_events_processed_total[5m])) by (projection)
```
Graph type: Time Series (stacked area)

**3. Error Rate**
```promql
rate(pupsourcing_orchestrator_projection_errors_total[5m])
```
Graph type: Time Series

**4. Coordination Duration**
```promql
histogram_quantile(0.99,
  rate(pupsourcing_orchestrator_coordination_duration_seconds_bucket[5m])
)
```
Graph type: Time Series

**5. Reconfiguration Events**
```promql
increase(pupsourcing_orchestrator_reconfiguration_total[1h])
```
Graph type: Stat or Time Series

**6. Processing Latency by Projection**
```promql
histogram_quantile(0.95,
  rate(pupsourcing_orchestrator_event_processing_duration_seconds_bucket[5m])
) by (projection)
```
Graph type: Time Series

### Dashboard Layout

```
+------------------+------------------+------------------+
| Active Workers   | Current Gen      | Reconfigurations |
| (Stat)           | Partitions       | Last Hour        |
|                  | (Stat)           | (Stat)           |
+------------------+------------------+------------------+
| Event Processing Rate                                  |
| (Time Series - Stacked Area by Projection)            |
+--------------------------------------------------------+
| Error Rate                                             |
| (Time Series with alert threshold)                    |
+--------------------------------------------------------+
| Processing Latency P95                                 |
| (Time Series by Projection)                           |
+---------------------------+----------------------------+
| Coordination Duration P99 | Heartbeat Latency P95     |
| (Time Series)             | (Time Series)              |
+---------------------------+----------------------------+
```

## Alerting Rules

### Critical Alerts

```yaml
groups:
  - name: orchestrator_critical
    interval: 30s
    rules:
      # No workers active
      - alert: OrchestratorNoWorkers
        expr: pupsourcing_orchestrator_active_workers == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "No active workers for {{ $labels.replica_set }}"
          
      # High error rate
      - alert: OrchestratorHighErrorRate
        expr: |
          rate(pupsourcing_orchestrator_projection_errors_total[5m])
          / rate(pupsourcing_orchestrator_events_processed_total[5m])
          > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate: {{ $value | humanizePercentage }}"
```

### Warning Alerts

```yaml
groups:
  - name: orchestrator_warning
    interval: 1m
    rules:
      # Frequent reconfigurations
      - alert: OrchestratorFrequentReconfigurations
        expr: rate(pupsourcing_orchestrator_reconfiguration_total[1h]) * 3600 > 5
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Frequent reconfigurations: {{ $value }} per hour"
          
      # Slow coordination
      - alert: OrchestratorSlowCoordination
        expr: |
          histogram_quantile(0.99,
            rate(pupsourcing_orchestrator_coordination_duration_seconds_bucket[5m])
          ) > 30
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Slow coordination: P99 = {{ $value }}s"
          
      # Stale workers detected
      - alert: OrchestratorStaleWorkers
        expr: increase(pupsourcing_orchestrator_stale_workers_cleaned_total[5m]) > 0
        labels:
          severity: warning
        annotations:
          summary: "Stale worker detected and cleaned up"
```

## Next Steps

- **[Kubernetes](kubernetes.md)** - Deploy with ServiceMonitor for Prometheus
- **[Scaling](scaling.md)** - Use metrics to guide scaling decisions
- **[Configuration](configuration.md)** - Tune based on observed metrics
