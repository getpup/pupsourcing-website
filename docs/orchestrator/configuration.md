# Configuration

Detailed configuration reference for the orchestrator.

---

## Table of Contents

- [Config Structure](#config-structure)
- [Required Fields](#required-fields)
- [Optional Fields](#optional-fields)
- [Configuration Presets](#configuration-presets)
- [Environment-Based Configuration](#environment-based-configuration)
- [Validation](#validation)
- [Next Steps](#next-steps)

## Config Structure

The orchestrator is configured using the `orchestrator.Config` struct:

```go
type Config struct {
    // Required fields
    DB                  *sql.DB
    EventStore          *postgres.Store
    ReplicaSet          ReplicaSetName
    
    // Optional fields with defaults
    HeartbeatInterval   time.Duration
    StaleWorkerTimeout  time.Duration
    CoordinationTimeout time.Duration
    BatchSize           int
    Logger              es.Logger
}
```

## Required Fields

### DB

**Type:** `*sql.DB`

**Description:** Database connection used for:
- Generation and worker coordination
- Projection checkpoint storage
- Event reading (via EventStore)

**Example:**
```go
db, err := sql.Open("postgres", 
    "postgres://user:pass@localhost:5432/mydb?sslmode=disable")
if err != nil {
    log.Fatal(err)
}

config := orchestrator.Config{
    DB: db,
    // ...
}
```

**Connection Pool Settings:**

For production, configure the connection pool appropriately:

```go
db.SetMaxOpenConns(25)           // Max open connections
db.SetMaxIdleConns(5)            // Idle connections to keep
db.SetConnMaxLifetime(time.Hour) // Recycle connections after 1 hour
```

**Recommendations:**
- **Single worker:** 10-25 connections sufficient
- **Multiple workers:** Scale based on `workers × projections × 2`
- **High throughput:** 25-50 connections per worker

### EventStore

**Type:** `*postgres.Store`

**Description:** The pupsourcing event store for reading events.

**Example:**
```go
eventStore := postgres.NewStore(postgres.DefaultStoreConfig())

config := orchestrator.Config{
    EventStore: eventStore,
    // ...
}
```

**Custom Store Configuration:**

```go
storeConfig := postgres.StoreConfig{
    Schema: "events",          // Custom schema name
    Logger: myLogger,          // Custom logger
}
eventStore := postgres.NewStore(storeConfig)
```

### ReplicaSet

**Type:** `ReplicaSetName` (string)

**Description:** Unique name for this group of projections. Workers with the same replica set name coordinate together.

**Example:**
```go
config := orchestrator.Config{
    ReplicaSet: "main-projections",
    // ...
}
```

**Naming Conventions:**
- Use descriptive names: `"user-projections"`, `"order-analytics"`
- Keep names short and URL-safe
- Use lowercase with hyphens

**Multiple Replica Sets:**

Run different projection groups independently:

```go
mainConfig := orchestrator.Config{
    ReplicaSet: "main-projections",
    // ...
}

analyticsConfig := orchestrator.Config{
    ReplicaSet: "analytics-projections",
    // ...
}
```

## Optional Fields

### HeartbeatInterval

**Type:** `time.Duration`  
**Default:** `5 * time.Second`

**Description:** How often workers send heartbeats to prove they're alive.

**Example:**
```go
config := orchestrator.Config{
    HeartbeatInterval: 10 * time.Second,
    // ...
}
```

**Tuning Guidance:**

| Scenario | Recommended Value | Reason |
|----------|-------------------|---------|
| **Stable Production** | 10-15 seconds | Reduce database load, workers rarely change |
| **Standard Production** | 5 seconds (default) | Good balance of responsiveness and efficiency |
| **Development/Testing** | 2-3 seconds | Quick feedback during testing |
| **High Worker Churn** | 2-3 seconds | Faster detection of worker changes |

**Considerations:**
- Lower values = faster failure detection, more database writes
- Higher values = less database load, slower failure detection
- Should be significantly less than `StaleWorkerTimeout`

### StaleWorkerTimeout

**Type:** `time.Duration`  
**Default:** `30 * time.Second`

**Description:** How long without a heartbeat before a worker is considered dead and removed.

**Example:**
```go
config := orchestrator.Config{
    StaleWorkerTimeout: 60 * time.Second,
    // ...
}
```

**Tuning Guidance:**

| Scenario | Recommended Value | Reason |
|----------|-------------------|---------|
| **Stable Production** | 60 seconds | Tolerate brief network hiccups |
| **Standard Production** | 30 seconds (default) | Reasonable balance |
| **Fast Failover Required** | 15-20 seconds | Quick recovery from crashes |
| **Network Issues** | 90-120 seconds | Tolerate longer network problems |

**Recommendations:**
- Set to at least `3 × HeartbeatInterval`
- Consider network latency and database load
- Too low: false positives from brief network issues
- Too high: slow failure detection and recovery

**Formula:**
```
StaleWorkerTimeout = HeartbeatInterval × 3-6
```

### CoordinationTimeout

**Type:** `time.Duration`  
**Default:** `60 * time.Second`

**Description:** Maximum time to wait for all workers to coordinate during generation changes.

**Example:**
```go
config := orchestrator.Config{
    CoordinationTimeout: 120 * time.Second,
    // ...
}
```

**Tuning Guidance:**

| Scenario | Recommended Value | Reason |
|----------|-------------------|---------|
| **Small Clusters** (1-5 workers) | 60 seconds (default) | Quick coordination |
| **Large Clusters** (10+ workers) | 120-180 seconds | More time for all to coordinate |
| **Slow Database** | 120-180 seconds | Account for slow queries |
| **Fast Network** | 30-45 seconds | Can coordinate quickly |

**What Happens on Timeout:**

If coordination doesn't complete within this time:
1. Current generation attempt is abandoned
2. Workers retry coordination
3. Logged as an error with context

**Recommendations:**
- Should be longer than typical generation change duration
- Monitor `pupsourcing_orchestrator_coordination_duration_seconds` metric
- Set timeout to P99 duration × 2

### BatchSize

**Type:** `int`  
**Default:** `100`

**Description:** Number of events to read from the event store per batch.

**Example:**
```go
config := orchestrator.Config{
    BatchSize: 500,
    // ...
}
```

**Tuning Guidance:**

| Scenario | Recommended Value | Reason |
|----------|-------------------|---------|
| **Low Event Volume** | 50-100 (default) | Minimize latency, frequent commits |
| **High Event Volume** | 500-1000 | Better throughput, fewer round trips |
| **Large Events** | 50-100 | Avoid memory pressure |
| **Small Events** | 500-1000 | Maximize throughput |
| **Complex Projections** | 50-200 | Avoid long-running transactions |

**Considerations:**
- Larger batches = better throughput, higher latency, more memory
- Smaller batches = lower latency, more database round trips
- Consider projection processing time per event
- Monitor memory usage with different batch sizes

**Formula for High Throughput:**
```
BatchSize = TargetBatchProcessingTime(ms) / AvgEventProcessingTime(ms)

Example: 
  Target batch time: 1000ms (1 second)
  Avg event processing: 2ms
  BatchSize = 1000 / 2 = 500
```

### Logger

**Type:** `es.Logger` (interface)  
**Default:** `nil` (no logging)

**Description:** Logger for observability, structured logging of orchestrator operations.

**Interface:**
```go
type Logger interface {
    Info(ctx context.Context, msg string, keysAndValues ...interface{})
    Error(ctx context.Context, msg string, keysAndValues ...interface{})
}
```

**Example Implementation:**

```go
type MyLogger struct {
    logger *slog.Logger
}

func (l *MyLogger) Info(ctx context.Context, msg string, keysAndValues ...interface{}) {
    l.logger.InfoContext(ctx, msg, keysAndValues...)
}

func (l *MyLogger) Error(ctx context.Context, msg string, keysAndValues ...interface{}) {
    l.logger.ErrorContext(ctx, msg, keysAndValues...)
}

// Use it
config := orchestrator.Config{
    Logger: &MyLogger{logger: slog.Default()},
    // ...
}
```

**Example with zerolog:**

```go
import "github.com/rs/zerolog"

type ZerologAdapter struct {
    logger zerolog.Logger
}

func (z *ZerologAdapter) Info(ctx context.Context, msg string, keysAndValues ...interface{}) {
    event := z.logger.Info()
    for i := 0; i < len(keysAndValues); i += 2 {
        if i+1 < len(keysAndValues) {
            key := keysAndValues[i].(string)
            event = event.Interface(key, keysAndValues[i+1])
        }
    }
    event.Msg(msg)
}

func (z *ZerologAdapter) Error(ctx context.Context, msg string, keysAndValues ...interface{}) {
    event := z.logger.Error()
    for i := 0; i < len(keysAndValues); i += 2 {
        if i+1 < len(keysAndValues) {
            key := keysAndValues[i].(string)
            event = event.Interface(key, keysAndValues[i+1])
        }
    }
    event.Msg(msg)
}
```

**Logged Events:**

The orchestrator logs these events:
- Worker registration and unregistration
- Generation changes
- Partition assignments
- Heartbeat failures
- Coordination timeouts
- Stale worker cleanup
- Event processing errors

## Configuration Presets

### Development

Fast feedback, frequent changes:

```go
config := orchestrator.Config{
    DB:                  db,
    EventStore:          eventStore,
    ReplicaSet:          "dev-projections",
    HeartbeatInterval:   2 * time.Second,
    StaleWorkerTimeout:  10 * time.Second,
    CoordinationTimeout: 30 * time.Second,
    BatchSize:           50,
    Logger:              devLogger,
}
```

### Standard Production

Balanced for typical production use:

```go
config := orchestrator.Config{
    DB:                  db,
    EventStore:          eventStore,
    ReplicaSet:          "main-projections",
    // Use defaults:
    // HeartbeatInterval:   5s
    // StaleWorkerTimeout:  30s
    // CoordinationTimeout: 60s
    // BatchSize:           100
    Logger:              prodLogger,
}
```

### High Throughput

Optimized for event processing throughput:

```go
config := orchestrator.Config{
    DB:                  db,
    EventStore:          eventStore,
    ReplicaSet:          "high-throughput-projections",
    HeartbeatInterval:   10 * time.Second,
    StaleWorkerTimeout:  45 * time.Second,
    CoordinationTimeout: 90 * time.Second,
    BatchSize:           1000,
    Logger:              prodLogger,
}
```

### Stable with Few Workers

Optimized for stable systems with infrequent changes:

```go
config := orchestrator.Config{
    DB:                  db,
    EventStore:          eventStore,
    ReplicaSet:          "stable-projections",
    HeartbeatInterval:   15 * time.Second,
    StaleWorkerTimeout:  90 * time.Second,
    CoordinationTimeout: 120 * time.Second,
    BatchSize:           200,
    Logger:              prodLogger,
}
```

## Environment-Based Configuration

Load configuration from environment variables:

```go
package main

import (
    "database/sql"
    "os"
    "strconv"
    "time"
)

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
    val := os.Getenv(key)
    if val == "" {
        return defaultValue
    }
    duration, err := time.ParseDuration(val)
    if err != nil {
        return defaultValue
    }
    return duration
}

func getEnvInt(key string, defaultValue int) int {
    val := os.Getenv(key)
    if val == "" {
        return defaultValue
    }
    intVal, err := strconv.Atoi(val)
    if err != nil {
        return defaultValue
    }
    return intVal
}

func main() {
    config := orchestrator.Config{
        DB:                  db,
        EventStore:          eventStore,
        ReplicaSet:          orchestrator.ReplicaSetName(os.Getenv("REPLICA_SET")),
        HeartbeatInterval:   getEnvDuration("HEARTBEAT_INTERVAL", 5*time.Second),
        StaleWorkerTimeout:  getEnvDuration("STALE_WORKER_TIMEOUT", 30*time.Second),
        CoordinationTimeout: getEnvDuration("COORDINATION_TIMEOUT", 60*time.Second),
        BatchSize:           getEnvInt("BATCH_SIZE", 100),
        Logger:              logger,
    }
    
    // ...
}
```

**Example Environment Variables:**

```bash
# Required
DATABASE_URL="postgres://user:pass@localhost:5432/mydb"
REPLICA_SET="main-projections"

# Optional tuning
HEARTBEAT_INTERVAL="5s"
STALE_WORKER_TIMEOUT="30s"
COORDINATION_TIMEOUT="60s"
BATCH_SIZE="100"
```

## Validation

The orchestrator validates configuration on creation:

```go
orch, err := orchestrator.New(config)
if err != nil {
    // Configuration errors returned here:
    // - Missing required fields
    // - Invalid values
    // - Logical inconsistencies
}
```

**Common Validation Errors:**

- `DB cannot be nil`
- `EventStore cannot be nil`
- `ReplicaSet cannot be empty`
- `HeartbeatInterval must be positive`
- `StaleWorkerTimeout must be greater than HeartbeatInterval`
- `BatchSize must be positive`

## Next Steps

- **[Scaling](scaling.md)** - Learn how to scale workers effectively
- **[Metrics](metrics.md)** - Monitor your configuration's impact
- **[Kubernetes](kubernetes.md)** - Deploy with ConfigMaps and Secrets
