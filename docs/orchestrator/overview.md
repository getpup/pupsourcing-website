# Orchestrator Overview

Production-ready orchestration for running projections at scale.

---

## Table of Contents

- [What is pupsourcing-orchestrator?](#what-is-pupsourcing-orchestrator)
- [When to Use the Orchestrator](#when-to-use-the-orchestrator)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [No Vendor Lock-in](#no-vendor-lock-in)
- [Migration from Manual Runners](#migration-from-manual-runners)
- [Getting Started](#getting-started)

## What is pupsourcing-orchestrator?

**pupsourcing-orchestrator** is a companion library to [pupsourcing](https://github.com/getpup/pupsourcing) that handles operational coordination for running projections in production. It enables horizontal scaling of projection processing across multiple workers while ensuring correctness through coordinated partition assignment.

Instead of manually managing partition assignments and worker coordination, the orchestrator automatically:

- Distributes event processing across multiple workers
- Coordinates partition assignments when workers join or leave
- Monitors worker health through heartbeats
- Handles worker failures and recovery
- Exposes production-ready Prometheus metrics

## When to Use the Orchestrator

### ✅ Use the Orchestrator When:

**Production Deployments**
- Running projections in production with uptime requirements
- Need high availability and automatic failover
- Multiple workers for horizontal scaling

**Kubernetes/Container Environments**
- Deploying with Kubernetes, Docker Swarm, or similar
- Using autoscaling based on load
- Running multiple replicas for reliability

**High-Throughput Systems**
- Processing thousands of events per second
- Need to scale projection processing independently
- Multiple projection groups with different scaling needs

**Operational Excellence**
- Need built-in Prometheus metrics
- Want automatic coordination without manual intervention
- Require graceful handling of worker crashes

### ⚠️ Consider Alternatives When:

**Simple Applications**
- Single-process application
- Low event volume (< 100 events/second)
- Development or prototyping

**Fine-Grained Control**
- Custom partition assignment logic required
- Non-standard coordination mechanisms
- Integration with existing orchestration systems

**Learning/Testing**
- First time using pupsourcing
- Understanding event sourcing basics
- Running in development mode

For these cases, you can use the [core library's manual projection running](../projections.md) approach.

## Key Features

### Automatic Partitioning

Workers coordinate to automatically divide the event stream into partitions based on the number of active workers. No manual configuration needed.

```
3 workers running → Events partitioned 3 ways
1 worker crashes  → Remaining 2 workers rebalance automatically
2 new workers join → All 4 workers coordinate and rebalance
```

### Recreate Strategy

The orchestrator uses a "Recreate" strategy for handling worker changes:

1. New worker joins or existing worker leaves
2. All workers pause processing
3. New partition configuration calculated
4. All workers restart with new assignments
5. Processing resumes with correct partitioning

This ensures **correctness** - events are never processed by multiple workers simultaneously.

### PostgreSQL-based Coordination

Uses your existing PostgreSQL database for coordination. No additional infrastructure dependencies like:
- ❌ Kafka
- ❌ Redis
- ❌ etcd
- ❌ ZooKeeper

Just PostgreSQL tables for generation tracking and worker coordination.

### Multiple Replica Sets

Run independent projection groups that scale independently:

```go
// Critical user projections - scale to 10 workers
mainOrch, _ := orchestrator.New(
    db,
    eventStore,
    "main-projections",
)

// Analytics projections - scale to 3 workers
analyticsOrch, _ := orchestrator.New(
    db,
    eventStore,
    "analytics-projections",
)
```

Each replica set coordinates independently with its own scaling characteristics.

### Built-in Observability

Comprehensive Prometheus metrics out of the box:
- Worker count and status
- Event processing rates
- Coordination timing
- Error rates
- Generation changes

Integrate seamlessly with your existing metrics infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Event Store (PostgreSQL)              │
│                     (events table)                       │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ Read Events
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
┌──────────┐    ┌──────────┐    ┌──────────┐
│ Worker 1 │    │ Worker 2 │    │ Worker 3 │
│ Part 0/3 │    │ Part 1/3 │    │ Part 2/3 │
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │
     │ Heartbeat     │               │
     └───────────────┼───────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │  Coordination Store     │
        │  (PostgreSQL tables)    │
        │  - generations          │
        │  - workers              │
        │  - heartbeats           │
        └─────────────────────────┘
```

## No Vendor Lock-in

The orchestrator uses standard PostgreSQL with simple table structures. You can:
- Inspect coordination state with SQL queries
- Migrate to other orchestration systems if needed
- Build custom tooling on top of the same tables
- Understand exactly what's happening under the hood

## Migration from Manual Runners

If you're currently running projections manually, migrating to the orchestrator is straightforward.

### Before (Manual Runner)

```go
// Old approach: manually running a single projection processor
processor := projection.NewPostgresProcessor(projection.ProcessorConfig{
    DB:              db,
    EventStore:      eventStore,
    Projection:      &UserProjection{},
    BatchSize:       100,
    PartitionKey:    0,        // Hardcoded
    TotalPartitions: 3,        // Hardcoded
})

processor.Run(ctx)
```

**Issues:**
- Manual partition assignment
- No automatic scaling
- No coordination between workers
- No failure detection

### After (Orchestrator)

```go
// New approach: orchestrator handles everything
orch, _ := orchestrator.New(
    db,
    eventStore,
    "main-projections",
)

projections := []projection.Projection{
    &UserProjection{},
}

orch.Run(ctx, projections)
```

**Benefits:**
- Automatic partition assignment
- Horizontal scaling
- Coordinated worker management
- Automatic failure detection and recovery

### Migration Steps

1. **Run migrations**: Add orchestrator tables to your database
   ```go
   orchestrator.RunMigrations(db)
   ```

2. **Deploy orchestrator**: Replace manual runner with orchestrator

3. **Scale horizontally**: Add more replicas to your deployment

4. **Monitor**: Verify workers are coordinating correctly

## Getting Started

Ready to use the orchestrator? Continue to:

- **[Getting Started](getting-started.md)** - Quick start guide with code examples
- **[Concepts](concepts.md)** - Understand replica sets, generations, and workers
- **[Configuration](configuration.md)** - Configure for your specific needs
- **[Scaling](scaling.md)** - Scale from 1 to many workers
- **[Kubernetes](kubernetes.md)** - Deploy to Kubernetes

Or explore the [examples](https://github.com/getpup/pupsourcing-orchestrator/tree/main/examples) in the orchestrator repository.
