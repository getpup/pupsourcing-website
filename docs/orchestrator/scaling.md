# Scaling with Orchestrator

Guide to scaling projection processing from one to many workers.

---

## Overview

The orchestrator makes scaling projections simple:

1. **Start with one worker** - Process all events
2. **Add workers as needed** - Automatic coordination
3. **Scale down when quiet** - Workers leave cleanly

No manual partition assignment or complex configuration needed.

## Single Worker to Multiple Workers

### Starting Point: One Worker

Deploy a single worker to start:

```go
orch, _ := orchestrator.New(orchestrator.Config{
    DB:         db,
    EventStore: eventStore,
    ReplicaSet: "main-projections",
})

orch.Run(ctx, projections)
```

**Initial State:**
```
Generation 1: 1 worker, 1 partition
Worker A: partition 0 of 1 (processes all events)
```

### Adding a Second Worker

Simply start another instance with the same configuration:

```bash
# Terminal 1 - Worker A already running
# Terminal 2 - Start Worker B
DATABASE_URL="..." go run main.go
```

**What Happens:**

```
1. Worker B registers with replica set
2. Coordinator detects 2 workers
3. Generation 2 created with 2 partitions
4. Worker A stops processing
5. Both workers coordinate
6. Worker A → partition 0 of 2
7. Worker B → partition 1 of 2
8. Both start processing
```

**New State:**
```
Generation 2: 2 workers, 2 partitions
Worker A: partition 0 of 2 (processes ~50% of events)
Worker B: partition 1 of 2 (processes ~50% of events)
```

### Scaling to Many Workers

Continue adding workers as needed:

```
3 workers → 3 partitions (each handles ~33%)
5 workers → 5 partitions (each handles ~20%)
10 workers → 10 partitions (each handles ~10%)
```

## When to Scale

### Indicators You Need More Workers

**Projection Lag Increasing:**
```sql
-- Check checkpoint lag
SELECT 
    name,
    last_position,
    (SELECT MAX(global_position) FROM events) - last_position AS lag
FROM projection_checkpoints
WHERE name = 'user_projection';
```

If lag is increasing over time, you need more capacity.

**High CPU/Memory:**
- Single worker consistently at 80%+ CPU
- Memory pressure from large batches
- Event processing cannot keep up with event creation rate

**Event Processing Rate:**

Calculate required workers:

```
Events per hour: 360,000
Events per second: 100

Per-event cost: 10ms (projection logic + database)
Events per second per worker: 1000ms / 10ms = 100

Required workers: 100 / 100 = 1 worker (but add margin)
Recommended: 2-3 workers for headroom
```

### Indicators You DON'T Need to Scale

**Stable Lag:**
- Projection keeps up with event creation
- Lag is bounded and not growing
- Resources are not constrained

**Low Event Volume:**
- < 100 events/second
- Single worker CPU < 50%
- Fast projection logic (< 5ms per event)

**Development/Testing:**
- Local development environment
- Integration testing
- POC or prototype systems

## Kubernetes Scaling

### Basic Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: projections
  namespace: production
spec:
  replicas: 3  # Start with 3 workers
  selector:
    matchLabels:
      app: projections
  template:
    metadata:
      labels:
        app: projections
    spec:
      containers:
      - name: projections
        image: myregistry/projections:v1.0.0
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: url
        - name: REPLICA_SET
          value: "main-projections"
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
      terminationGracePeriodSeconds: 60
```

### Manual Scaling

Scale up or down by changing replicas:

```bash
# Scale to 5 workers
kubectl scale deployment projections --replicas=5

# Scale down to 2 workers  
kubectl scale deployment projections --replicas=2
```

**What Happens During Scale:**

**Scale Up (3 → 5 workers):**
```
1. Kubernetes creates 2 new pods
2. New workers start and register
3. Coordinator detects 5 workers
4. New generation created (5 partitions)
5. All 5 workers stop and reconfigure
6. All 5 workers restart with new assignments
```

**Scale Down (5 → 2 workers):**
```
1. Kubernetes sends SIGTERM to 3 pods
2. Workers handle signal, unregister gracefully
3. Coordinator detects 2 workers
4. New generation created (2 partitions)
5. 2 remaining workers reconfigure
6. 2 workers process all events
```

### Horizontal Pod Autoscaler (HPA)

!!! warning "HPA with Recreate Strategy"
    The orchestrator uses a Recreate strategy - all workers pause during scaling. Frequent scaling causes processing interruptions.
    
    **Use conservative settings or manual scaling for most workloads.**

#### Conservative HPA Configuration

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: projections-hpa
  namespace: production
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
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling up
      policies:
      - type: Pods
        value: 1                        # Add 1 pod at a time
        periodSeconds: 60               # Every 60 seconds max
    scaleDown:
      stabilizationWindowSeconds: 600  # Wait 10 min before scaling down
      policies:
      - type: Pods
        value: 1                        # Remove 1 pod at a time
        periodSeconds: 180              # Every 3 minutes max
```

**Key Settings Explained:**

- **stabilizationWindowSeconds**: Prevents rapid scaling
- **policies.value: 1**: Only add/remove one worker at a time
- **periodSeconds**: Minimum time between scaling operations

#### Custom Metrics HPA

Better than CPU-based scaling - use projection lag:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: projections-hpa
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
        averageValue: "10000"  # Scale up if avg lag > 10k events
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 300
      policies:
      - type: Pods
        value: 2
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 900  # 15 min
      policies:
      - type: Pods
        value: 1
        periodSeconds: 300
```

Expose custom metrics via Prometheus adapter or similar.

## Monitoring Scaling Events

### Metrics to Watch

**Reconfiguration Frequency:**
```promql
# Reconfigurations per hour
rate(pupsourcing_orchestrator_reconfiguration_total[1h]) * 3600

# Alert if > 5 per hour (indicates instability)
```

**Active Workers:**
```promql
# Should match deployment replica count
pupsourcing_orchestrator_active_workers{replica_set="main-projections"}
```

**Coordination Duration:**
```promql
# How long workers spend coordinating
histogram_quantile(0.99, 
  rate(pupsourcing_orchestrator_coordination_duration_seconds_bucket[5m])
)

# Alert if P99 > 30 seconds
```

**Processing Interruptions:**
```promql
# Time spent not processing (coordinating + downtime)
rate(pupsourcing_orchestrator_coordination_duration_seconds_sum[5m])
```

### Logs to Monitor

Look for these log messages during scaling:

```
Worker registered: worker_id=abc-123 partition=0/3
Generation created: generation=5 total_partitions=3
Coordination started: generation=5
All workers coordinated: generation=5 duration=1.2s
Worker processing: generation=5 partition=0/3
```

**Warning Signs:**
```
Coordination timeout: generation=5
Stale worker cleaned: worker_id=abc-123
Worker registration failed
Partition assignment mismatch
```

## Scaling Best Practices

### 1. Start Small, Scale Gradually

```
Day 1: Deploy 1 worker, monitor performance
Day 2: Add 1 worker if needed
Day 3: Add 1-2 more based on lag
Week 2: Settle on optimal worker count
```

Don't immediately deploy 10 workers. Find the right balance.

### 2. Use Manual Scaling for Predictable Workloads

If your event volume is predictable:
- Set fixed replica count based on peak load
- Don't use HPA
- Avoid reconfiguration overhead

### 3. Consider Multiple Replica Sets

If you have different projection priorities:

```go
// Time-critical projections - scale aggressively
mainOrch := orchestrator.New(orchestrator.Config{
    ReplicaSet: "main-projections",  // 10 workers
})

// Analytics - scale conservatively
analyticsOrch := orchestrator.New(orchestrator.Config{
    ReplicaSet: "analytics",  // 2 workers
})
```

### 4. Monitor Coordination Overhead

Track time spent coordinating vs. processing:

```promql
# % of time spent coordinating
(
  rate(pupsourcing_orchestrator_coordination_duration_seconds_sum[5m])
  /
  (time() - process_start_time_seconds)
) * 100

# Alert if > 5% (too much reconfiguration)
```

### 5. Set Resource Limits Appropriately

Each worker needs:

```yaml
resources:
  requests:
    cpu: 500m      # 0.5 CPU cores
    memory: 512Mi  # 512 MB RAM
  limits:
    cpu: 1000m     # 1 CPU core max
    memory: 1Gi    # 1 GB RAM max
```

Adjust based on:
- Projection complexity
- Batch size
- Event payload size
- Database query performance

### 6. Plan for Failures

**Pod Eviction:**
- Set `terminationGracePeriodSeconds: 60`
- Handle SIGTERM in your application
- Allow time for graceful shutdown

**Database Issues:**
- Use connection pooling
- Handle transient failures
- Implement retry logic

**Network Partitions:**
- Use appropriate `StaleWorkerTimeout`
- Monitor heartbeat latency
- Alert on high timeout rates

## Scaling Scenarios

### Scenario 1: Gradual Growth

Your event volume is growing 10% per month:

```
Month 1: 1 worker, 50 events/sec
Month 3: 2 workers, 75 events/sec
Month 6: 3 workers, 100 events/sec
Month 12: 5 workers, 150 events/sec
```

**Strategy:**
- Monitor lag weekly
- Scale manually when lag trends up
- Use fixed replica counts

### Scenario 2: Spiky Traffic

Event volume spikes 10x during business hours:

```
Night: 10 events/sec → 1 worker
Day: 100 events/sec → need 3-5 workers
```

**Strategy:**
- Use HPA with conservative settings
- Scale up in morning, down at night
- Accept brief processing delays during scale events
- Or: Keep workers at peak capacity 24/7

### Scenario 3: Rebuild Projections

Need to rebuild projections from scratch:

```
Normal: 100 events/sec → 2 workers
Rebuild: Processing 1M historical events
```

**Strategy:**
- Temporarily scale to 10-20 workers
- Use higher `BatchSize` (500-1000)
- Monitor database load
- Scale down after catching up

### Scenario 4: Multi-Region

Running in multiple regions with separate databases:

```
Region 1: 5 workers, replica_set="us-east-projections"
Region 2: 3 workers, replica_set="eu-west-projections"
```

**Strategy:**
- Separate replica sets per region
- Scale independently
- Region-specific monitoring
- Different performance characteristics

## Troubleshooting Scaling Issues

### Workers Not Coordinating

**Symptoms:**
- New worker joins but count doesn't increase
- Metrics show wrong worker count

**Solutions:**
- Verify same `ReplicaSet` name
- Check database connectivity
- Review worker logs for errors
- Confirm migrations have run

### Frequent Reconfigurations

**Symptoms:**
- `reconfiguration_total` metric high
- Logs show constant generation changes
- Processing frequently interrupted

**Solutions:**
- Check for worker crash loops (application bugs)
- Review Kubernetes liveness/readiness probes
- Increase HPA stabilization windows
- Check database performance

### Slow Coordination

**Symptoms:**
- High `coordination_duration_seconds`
- Workers take long to reconfigure

**Solutions:**
- Increase `CoordinationTimeout`
- Check database load and connection pool
- Verify network latency between workers and database
- Review database index performance

### Uneven Processing

**Symptoms:**
- Some workers idle, others overloaded
- Uneven event distribution

**Note:** This is expected with hash-based partitioning if:
- Event aggregate IDs are not uniformly distributed
- Small number of distinct aggregate IDs
- Some aggregates have many more events

**Solutions:**
- Increase worker count (more partitions = better distribution)
- Consider custom partition key logic (requires code changes)
- Accept some imbalance as normal

## Next Steps

- **[Metrics](metrics.md)** - Monitor scaling effectiveness
- **[Kubernetes](kubernetes.md)** - Complete K8s deployment guide
- **[Configuration](configuration.md)** - Tune settings for your scale
