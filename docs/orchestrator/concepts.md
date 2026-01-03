# Orchestrator Concepts

Understanding the key concepts behind pupsourcing-orchestrator.

---

## Replica Set

A **Replica Set** is a named group of projections that scale together as a coordinated unit.

### Characteristics

- **Unique name** - e.g., `"main-projections"`, `"analytics-projections"`
- **Contains one or more projections** - All process events together
- **Independent scaling** - Each replica set scales separately
- **Shared coordination** - Workers coordinate via a shared generation store

### Use Cases

Run multiple replica sets when you need different scaling characteristics:

**Example: E-commerce System**

```go
// Critical user-facing projections - scale aggressively
mainOrch, _ := orchestrator.New(orchestrator.Config{
    ReplicaSet: "main-projections",
    // Scale to 10 workers for low latency
})
mainProjections := []projection.Projection{
    &UserProjection{},
    &OrderProjection{},
    &InventoryProjection{},
}

// Analytics projections - scale conservatively  
analyticsOrch, _ := orchestrator.New(orchestrator.Config{
    ReplicaSet: "analytics-projections",
    // Scale to 3 workers, not time-critical
})
analyticsProjections := []projection.Projection{
    &RevenueProjection{},
    &CustomerStatsProjection{},
}

// Run both concurrently
var wg sync.WaitGroup
wg.Add(2)

go func() {
    defer wg.Done()
    mainOrch.Run(ctx, mainProjections)
}()

go func() {
    defer wg.Done()
    analyticsOrch.Run(ctx, analyticsProjections)
}()

wg.Wait()
```

### Benefits of Multiple Replica Sets

- **Independent scaling** - Scale critical projections separately from analytics
- **Failure isolation** - Problems in analytics don't affect user-facing projections
- **Different SLAs** - Time-critical vs. batch processing
- **Resource allocation** - Dedicate more resources to important projections
- **Separate deployment** - Deploy updates to different sets independently

### Single vs. Multiple Replica Sets

**Use a single replica set when:**
- All projections have similar scaling needs
- Projections are all equally critical
- Simple deployment and management preferred
- Starting out and don't need complexity

**Use multiple replica sets when:**
- Different projections need different scale
- Failure isolation is important
- Different teams own different projections
- Resource allocation needs to be controlled

## Generation

A **Generation** represents a specific partition configuration at a point in time.

### What is a Generation?

When workers join or leave, the orchestrator creates a new generation with an updated partition configuration:

```
Generation 1: 1 worker  → 1 partition  (partition 0 of 1)
Generation 2: 3 workers → 3 partitions (partitions 0, 1, 2 of 3)
Generation 3: 2 workers → 2 partitions (partitions 0, 1 of 2)
```

Each generation has:
- **Generation ID** - Monotonically increasing number
- **Total Partitions** - Number of partitions in this generation
- **Worker Count** - Number of active workers
- **Created At** - When generation was created

### Generation Lifecycle

```
1. Worker joins/leaves
   ↓
2. Coordinator detects change
   ↓
3. New generation created (generation_id++)
   ↓
4. Old generation marked as superseded
   ↓
5. Workers in old generation stop
   ↓
6. Workers register for new generation
   ↓
7. Partition assignments calculated
   ↓
8. Workers start processing with new config
```

### Example: Worker Join

```
Initial State:
  Generation 1: Worker A (partition 0 of 1)
  Worker A processes all events (key % 1 == 0)

Worker B joins:
  Worker B registers, status = "pending"
  Coordinator sees 2 workers, creates Generation 2
  
Generation 2 created:
  Worker A stops (generation superseded)
  Worker A registers for Generation 2 → partition 0 of 2
  Worker B registers for Generation 2 → partition 1 of 2
  
New State:
  Generation 2: 
    - Worker A (partition 0 of 2) - processes events where key % 2 == 0
    - Worker B (partition 1 of 2) - processes events where key % 2 == 1
```

### Viewing Generations

Query the generations table to see history:

```sql
SELECT 
    generation_id,
    replica_set,
    total_partitions,
    created_at,
    superseded_at
FROM orchestrator_generations
WHERE replica_set = 'main-projections'
ORDER BY generation_id DESC
LIMIT 5;
```

Example output:
```
generation_id | replica_set      | total_partitions | created_at          | superseded_at
--------------+------------------+------------------+---------------------+---------------
5             | main-projections | 2                | 2024-01-15 14:32:10 | NULL
4             | main-projections | 3                | 2024-01-15 14:28:45 | 2024-01-15 14:32:10
3             | main-projections | 3                | 2024-01-15 14:15:20 | 2024-01-15 14:28:45
2             | main-projections | 2                | 2024-01-15 14:10:05 | 2024-01-15 14:15:20
1             | main-projections | 1                | 2024-01-15 14:00:00 | 2024-01-15 14:10:05
```

This shows scaling history: 1 → 2 → 3 → 3 (stayed) → 2 workers.

## Worker

A **Worker** is an instance of the orchestrator running a specific replica set.

### Worker Identity

Each worker has:
- **Worker ID** - Unique identifier (UUID)
- **Replica Set** - Which replica set it belongs to
- **Partition Assignment** - Which partition it processes
- **Registration Time** - When it joined
- **Last Heartbeat** - Most recent health check

### Worker States

Workers progress through these states:

```
1. Starting
   ↓
2. Registering → Write to orchestrator_workers table
   ↓
3. Waiting for Assignment → Coordinator assigns partition
   ↓
4. Processing → Actively processing events
   ↓
5. Heartbeating → Continuous health reporting
   ↓
6. Stopping → Graceful shutdown or superseded generation
   ↓
7. Unregistered → Removed from orchestrator_workers
```

### Worker Coordination

Workers coordinate through database state:

```
┌──────────────────────────────────────────┐
│     orchestrator_workers table           │
├────────────┬─────────────┬───────────────┤
│ worker_id  │ replica_set │ partition_key │
├────────────┼─────────────┼───────────────┤
│ worker-123 │ main        │ 0             │
│ worker-456 │ main        │ 1             │
│ worker-789 │ main        │ 2             │
└────────────┴─────────────┴───────────────┘
```

Each worker:
1. Reads this table to see other workers
2. Determines its own partition assignment
3. Processes only events matching its partition
4. Updates heartbeat to prove it's alive

### Heartbeat Mechanism

Workers send heartbeats at regular intervals (default: 5 seconds):

```go
// Worker continuously heartbeats
for {
    select {
    case <-time.After(heartbeatInterval):
        db.Exec(`
            INSERT INTO orchestrator_heartbeats 
            (worker_id, replica_set, heartbeat_at)
            VALUES ($1, $2, NOW())
        `, workerID, replicaSet)
    case <-ctx.Done():
        return
    }
}
```

The coordinator monitors heartbeats:

```go
// Coordinator checks for stale workers
staleWorkers := db.Query(`
    SELECT worker_id 
    FROM orchestrator_workers w
    WHERE replica_set = $1
    AND NOT EXISTS (
        SELECT 1 FROM orchestrator_heartbeats h
        WHERE h.worker_id = w.worker_id
        AND h.heartbeat_at > NOW() - INTERVAL '30 seconds'
    )
`, replicaSet)

// Remove stale workers → triggers new generation
```

### Worker Failure Scenarios

**Scenario 1: Crash**
```
Worker B crashes (no shutdown handler runs)
  ↓
Heartbeat stops
  ↓
After StaleWorkerTimeout, coordinator marks worker as stale
  ↓
Worker removed from orchestrator_workers
  ↓
New generation created
  ↓
Remaining workers reconfigure
```

**Scenario 2: Network Partition**
```
Worker B loses database connectivity
  ↓
Cannot send heartbeats
  ↓
After StaleWorkerTimeout, marked as stale
  ↓
Removed and generation updated
  ↓
When network recovers, Worker B sees generation superseded
  ↓
Worker B stops old generation, registers for new one
```

**Scenario 3: Graceful Shutdown**
```
Worker B receives SIGTERM
  ↓
Context canceled
  ↓
Worker stops processing
  ↓
Worker unregisters from orchestrator_workers
  ↓
Coordinator immediately detects removal
  ↓
New generation created
  ↓
Remaining workers reconfigure
```

## Recreate Strategy

The orchestrator uses a **Recreate Strategy** for handling topology changes.

### What is Recreate?

When the number of workers changes, ALL workers stop, reconfigure, and restart together with new partition assignments.

### Why Recreate?

**Correctness**
- Guarantees events are never processed by multiple workers simultaneously
- No complex rebalancing logic
- Clear state transitions

**Simplicity**
- Easy to reason about
- Predictable behavior
- Straightforward debugging

**Consistency**
- All workers always agree on partition count
- No gradual migration needed
- Clean generation boundaries

### Recreate Flow

```
Step 1: Stable State
  Generation 2: Workers A, B, C (3 partitions)
  All processing events normally

Step 2: Change Detected
  Worker D joins and registers
  Coordinator sees 4 workers

Step 3: New Generation Created
  Generation 3 created with 4 partitions
  Generation 2 marked as superseded

Step 4: Old Workers Stop
  Workers A, B, C see generation superseded
  All stop processing immediately
  All unregister from Generation 2

Step 5: All Workers Register
  Workers A, B, C, D register for Generation 3
  Coordinator assigns partitions:
    A → partition 0 of 4
    B → partition 1 of 4
    C → partition 2 of 4
    D → partition 3 of 4

Step 6: New Generation Starts
  All workers start processing simultaneously
  Events correctly partitioned across 4 workers
```

### Trade-offs

**Advantages:**
- ✅ Guaranteed correctness
- ✅ Simple implementation
- ✅ Easy to understand and debug
- ✅ No partial state issues

**Disadvantages:**
- ⚠️ Brief processing pause during reconfiguration
- ⚠️ All workers affected by any change
- ⚠️ Not suitable for very frequent scaling events

### Minimizing Impact

To minimize the impact of recreate strategy:

1. **Use conservative scaling policies** - Avoid frequent changes
2. **Set longer stabilization windows** - In HPA configuration
3. **Right-size initially** - Start with appropriate worker count
4. **Monitor reconfiguration frequency** - Alert on high churn
5. **Use manual scaling** - For predictable workloads

## Partition Assignment

Events are distributed to workers based on partition keys.

### How Partitioning Works

Each event has an implicit partition key (currently based on aggregate ID):

```go
// Event's partition key
partitionKey := hash(event.AggregateID) % totalPartitions

// Worker processes event if
workerPartitionKey == partitionKey
```

### Partition Distribution

With 3 workers and hash-based partitioning:

```
Events with aggregateID hashing to:
  hash % 3 == 0 → Worker 0
  hash % 3 == 1 → Worker 1  
  hash % 3 == 2 → Worker 2
```

### Partition Guarantees

The orchestrator guarantees:

1. **All events processed** - Every event assigned to exactly one partition
2. **No duplicate processing** - Each partition processed by exactly one worker
3. **Consistent hashing** - Same aggregate always maps to same partition (within a generation)
4. **Ordered per aggregate** - Events for same aggregate ID processed in order

### Example: 4 Workers

```
TotalPartitions: 4

Event Stream:
  Event 1: aggregateID = "user-alice"   → hash % 4 = 0 → Worker 0
  Event 2: aggregateID = "user-bob"     → hash % 4 = 2 → Worker 2
  Event 3: aggregateID = "user-alice"   → hash % 4 = 0 → Worker 0 (same)
  Event 4: aggregateID = "order-123"    → hash % 4 = 1 → Worker 1
  Event 5: aggregateID = "order-456"    → hash % 4 = 3 → Worker 3
  Event 6: aggregateID = "user-bob"     → hash % 4 = 2 → Worker 2 (same)
```

All "user-alice" events go to Worker 0, maintaining order.

## Next Steps

Now that you understand the core concepts:

- **[Configuration](configuration.md)** - Configure the orchestrator for your needs
- **[Scaling](scaling.md)** - Learn how to scale workers effectively
- **[Metrics](metrics.md)** - Monitor orchestrator health and performance
- **[Kubernetes](kubernetes.md)** - Deploy to Kubernetes with best practices
