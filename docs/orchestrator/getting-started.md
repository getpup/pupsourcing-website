# Getting Started with Orchestrator

Quick start guide to running projections with the orchestrator.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Database Setup](#database-setup)
- [Minimal Example](#minimal-example)
- [Running the Example](#running-the-example)
- [Verifying Coordination](#verifying-coordination)
- [Multiple Projections](#multiple-projections)
- [Configuration Options](#configuration-options)
- [Next Steps](#next-steps)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)

## Prerequisites

Before starting, you should have:

1. **pupsourcing** installed and working
2. **PostgreSQL** database set up
3. Basic understanding of [projections](../projections.md)
4. Familiarity with [core concepts](../core-concepts.md)

## Installation

Install the orchestrator library:

```bash
go get github.com/getpup/pupsourcing-orchestrator
```

## Database Setup

The orchestrator uses PostgreSQL tables to coordinate workers. Generate and apply migrations to create the required schema:

### 1. Generate Migrations

```bash
go run github.com/getpup/pupsourcing-orchestrator/cmd/migrate-gen -output migrations
```

This generates SQL migration files in the `migrations/` directory:
- `001_create_orchestrator_tables.up.sql` - Creates tables
- `001_create_orchestrator_tables.down.sql` - Rollback script

### 2. Apply Migrations

Use your preferred migration tool to apply the generated SQL files:

```bash
# Using golang-migrate
migrate -path migrations -database "postgres://user:pass@localhost/mydb?sslmode=disable" up

# Using psql directly
psql -h localhost -U user -d mydb -f migrations/001_create_orchestrator_tables.up.sql

# Or any other migration tool (Flyway, Liquibase, etc.)
```

!!! tip "Migration Best Practices"
    - Generate migrations once and commit them to version control
    - Apply migrations as part of your deployment pipeline
    - Use your team's existing migration tooling
    - Migrations are idempotent and safe to run multiple times

The migrations create these tables:
- `orchestrator_generations` - Tracks partition configurations
- `orchestrator_workers` - Active worker registry
- `orchestrator_heartbeats` - Worker health monitoring

## Minimal Example

Here's a complete example to get you started:

```go
package main

import (
    "context"
    "database/sql"
    "log"
    "os"
    "os/signal"
    "syscall"

    _ "github.com/lib/pq"

    "github.com/getpup/pupsourcing/es"
    "github.com/getpup/pupsourcing/es/adapters/postgres"
    "github.com/getpup/pupsourcing/es/projection"
    "github.com/getpup/pupsourcing-orchestrator"
)

// Define your projection
type UserProjection struct{}

func (p *UserProjection) Name() string {
    return "user_projection"
}

func (p *UserProjection) Handle(ctx context.Context, event es.PersistedEvent) error {
    // Process the event
    log.Printf("Processing event: %s (type: %s, position: %d)",
        event.EventID, event.EventType, event.GlobalPosition)
    
    // Update your read model here
    switch event.EventType {
    case "UserCreated":
        // Create user in read model
    case "EmailChanged":
        // Update email in read model
    case "UserDeleted":
        // Mark user as deleted
    }
    
    return nil
}

func main() {
    // Connect to database
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatalf("Failed to connect to database: %v", err)
    }
    defer db.Close()

    // Create event store
    eventStore := postgres.NewStore(postgres.DefaultStoreConfig())

    // Create orchestrator
    orch, err := orchestrator.New(
        db,
        eventStore,
        "main-projections",
    )
    if err != nil {
        log.Fatalf("Failed to create orchestrator: %v", err)
    }

    // Set up graceful shutdown
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
    go func() {
        sig := <-sigCh
        log.Printf("Received signal %v, shutting down...", sig)
        cancel()
    }()

    // Run projections
    projections := []projection.Projection{
        &UserProjection{},
    }
    
    log.Println("Starting orchestrator...")
    if err := orch.Run(ctx, projections); err != nil && err != context.Canceled {
        log.Fatalf("Orchestrator error: %v", err)
    }
    
    log.Println("Shutdown complete")
}
```

## Running the Example

1. **Start the first worker:**
   ```bash
   DATABASE_URL="postgres://user:pass@localhost/mydb?sslmode=disable" \
   go run main.go
   ```

   You should see:
   ```
   Starting orchestrator...
   Worker registered: worker-abc123
   Assigned partition: 0 of 1
   Processing events...
   ```

2. **Start a second worker** (in another terminal):
   ```bash
   DATABASE_URL="postgres://user:pass@localhost/mydb?sslmode=disable" \
   go run main.go
   ```

   Both workers will coordinate:
   ```
   # Worker 1
   New worker detected, reconfiguring...
   Stopping current generation
   Assigned partition: 0 of 2
   Restarting with new configuration...
   
   # Worker 2
   Worker registered: worker-def456
   Assigned partition: 1 of 2
   Processing events...
   ```

3. **Stop one worker** (Ctrl+C):
   ```
   # Worker 1 or 2
   Received signal interrupt, shutting down...
   Unregistering worker...
   Shutdown complete
   
   # Remaining worker
   Worker left, reconfiguring...
   Assigned partition: 0 of 1
   Processing all events now...
   ```

## Verifying Coordination

You can verify coordination is working by querying the orchestrator tables:

```sql
-- View current generation
SELECT * FROM orchestrator_generations 
WHERE replica_set = 'main-projections' 
ORDER BY generation_id DESC 
LIMIT 1;

-- View active workers
SELECT * FROM orchestrator_workers 
WHERE replica_set = 'main-projections';

-- View recent heartbeats
SELECT * FROM orchestrator_heartbeats 
WHERE replica_set = 'main-projections'
ORDER BY heartbeat_at DESC 
LIMIT 10;
```

## Multiple Projections

You can run multiple projections in the same replica set:

```go
projections := []projection.Projection{
    &UserProjection{},
    &OrderProjection{},
    &InventoryProjection{},
}

orch.Run(ctx, projections)
```

All projections in the same replica set:
- Share the same partition assignment
- Scale together as a unit
- Coordinate as one group

For independent scaling, use [multiple replica sets](concepts.md#replica-set).

## Configuration Options

The minimal example uses defaults. You can customize behavior:

```go
orch, err := orchestrator.New(
    db,
    eventStore,
    "main-projections",
    
    // Optional configurations
    orchestrator.WithHeartbeatInterval(5 * time.Second),   // How often to heartbeat
    orchestrator.WithStaleWorkerTimeout(30 * time.Second),  // When to consider worker dead
    orchestrator.WithCoordinationTimeout(60 * time.Second), // Max coordination wait time
    orchestrator.WithBatchSize(100),                        // Events per batch
    orchestrator.WithLogger(myLogger),                      // Custom logger
)
```

See [Configuration](configuration.md) for detailed options and tuning guidance.

## Next Steps

Now that you have the orchestrator running:

1. **Understand the [Concepts](concepts.md)** - Learn about replica sets, generations, and workers
2. **Configure for Production** - Review [Configuration](configuration.md) best practices
3. **Scale Horizontally** - Follow the [Scaling Guide](scaling.md)
4. **Monitor with Metrics** - Set up [Prometheus metrics](metrics.md)
5. **Deploy to Kubernetes** - Use the [Kubernetes guide](kubernetes.md)

## Troubleshooting

### Workers Not Coordinating

**Problem:** Starting a second worker doesn't trigger reconfiguration.

**Solution:** Check that both workers are using the same `ReplicaSet` name and connected to the same database.

### Events Processed Multiple Times

**Problem:** Same event appears to be processed by multiple workers.

**Solution:** This shouldn't happen with the orchestrator. Check:
- All workers are running the same version
- No manual projection processors running alongside orchestrator
- Partition assignment is correctly configured

### Worker Marked as Stale Immediately  

**Problem:** Worker registers then immediately marked as stale.

**Solution:** 
- Increase `StaleWorkerTimeout` if you have slow network/database
- Check database connectivity and performance
- Verify system clock is synchronized across all workers

### High Reconfiguration Rate

**Problem:** Workers constantly reconfiguring.

**Solution:**
- Check for worker crash loops (application bugs)
- Review health check configuration in Kubernetes
- Increase stabilization windows if using HPA
- Check database connection pool exhaustion

## Examples

The orchestrator repository includes comprehensive examples:

- **[basic](https://github.com/getpup/pupsourcing-orchestrator/tree/main/examples/basic)** - Complete minimal example
- **[multiple-replica-sets](https://github.com/getpup/pupsourcing-orchestrator/tree/main/examples/multiple-replica-sets)** - Independent scaling
- **[with-metrics](https://github.com/getpup/pupsourcing-orchestrator/tree/main/examples/with-metrics)** - Prometheus integration
- **[kubernetes](https://github.com/getpup/pupsourcing-orchestrator/tree/main/examples/kubernetes)** - Complete K8s manifests

Each example includes a detailed README with setup instructions.
