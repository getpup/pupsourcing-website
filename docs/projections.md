# Projections

Guide to building and managing projections in pupsourcing.

## Table of Contents

1. [Projections Overview](#projections-overview)
2. [Basic Implementation](#basic-implementation)
3. [One-Off Projection Processing](#one-off-projection-processing)

## Projections Overview

Projections transform events into query-optimized read models, implementing the read side of CQRS (Command Query Responsibility Segregation).

### Purpose

Event stores are optimized for writes and consistency, not queries. Projections solve this by maintaining denormalized views optimized for specific query patterns.

**Flow:**
```
Events → Projection Handler → Read Model (optimized for queries)
```

### Benefits

- **Performance** - Pre-joined, denormalized data enables fast queries
- **Flexibility** - Multiple read models from single event stream
- **CQRS** - Separate optimization for reads and writes
- **Scalability** - Independent scaling of read and write paths

### Use Cases

E-commerce system example:
- **Events**: `OrderPlaced`, `ItemAdded`, `PaymentProcessed`, `OrderShipped`
- **Read Models**:
  - `order_summary` - Fast order history lookups
  - `inventory_count` - Real-time stock levels
  - `user_order_stats` - Pre-computed customer metrics
  - `revenue_by_day` - Aggregated analytics

## Basic Implementation

### Projection Types

There are two types of projections:

#### Scoped Projections (Recommended for Read Models)

Scoped projections filter events by aggregate type, receiving only the events they care about. This is more efficient and clearer in intent.

```go
type UserCountProjection struct {
    db *sql.DB
}

func (p *UserCountProjection) Name() string {
    return "user_count"
}

// AggregateTypes filters events - only User events delivered to Handle()
func (p *UserCountProjection) AggregateTypes() []string {
    return []string{"User"}
}

// BoundedContexts filters by context - only Identity context events
func (p *UserCountProjection) BoundedContexts() []string {
    return []string{"Identity"}
}

func (p *UserCountProjection) Handle(ctx context.Context, tx *sql.Tx, event es.PersistedEvent) error {
    // Only User events arrive here - no need to check EventType for other aggregates
    
    // Use eventmap-gen for type-safe event handling (see Code Generation chapter)
    domainEvent, err := generated.FromESEvent(event)
    if err != nil {
        return err
    }
    
    // Type switch provides compile-time safety
    switch e := domainEvent.(type) {
    case events.UserCreated:
        // Use the processor's transaction for atomic updates
        _, err := tx.ExecContext(ctx,
            "INSERT INTO user_stats (user_id, email, created_at) VALUES ($1, $2, $3)"+
            "ON CONFLICT (user_id) DO NOTHING",
            event.AggregateID, e.Email, event.CreatedAt)
        return err
        
    case events.UserDeactivated:
        _, err := tx.ExecContext(ctx,
            "UPDATE user_stats SET active = false WHERE user_id = $1",
            event.AggregateID)
        return err
    }
    
    return nil
}
```

**When to use:**
- Read models for specific aggregates
- Domain-specific denormalizations
- Search indexes for entity types

#### Global Projections (For Integration/Outbox)

Global projections receive ALL events. Use for integration publishers, audit logs, or cross-aggregate analytics.

```go
type WatermillPublisher struct {
    publisher message.Publisher
}

func (p *WatermillPublisher) Name() string {
    return "system.integration.watermill.v1"
}

// No AggregateTypes() method - receives ALL events

func (p *WatermillPublisher) Handle(ctx context.Context, tx *sql.Tx, event es.PersistedEvent) error {
    // Ignore tx parameter for non-SQL projections
    _ = tx
    
    // Use message broker client instead
    msg := message.NewMessage(event.EventID.String(), event.Payload)
    return p.publisher.Publish(event.EventType, msg)
}
```

**When to use:**
- Message broker integrations (Kafka, RabbitMQ)
- Outbox pattern implementations
- Complete audit trails
- Cross-aggregate analytics

### Running a Projection

Both scoped and global projections run the same way:

```go
import (
    "github.com/getpup/pupsourcing/es/projection"
)

proj := &UserCountProjection{db: db}  // or &WatermillPublisher{...}
config := projection.DefaultProcessorConfig()
processor := postgres.NewProcessor(db, store, &config)

// Run until context is cancelled
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

err := processor.Run(ctx, proj)
```

### Key Features

- **Automatic Checkpointing**: Position is saved after each batch
- **At-Least-Once Delivery**: Events may be reprocessed on crash (make projections idempotent)
- **Transactional**: Event processing and checkpoint update are atomic
- **Resumable**: Stops and resumes without data loss

### Transaction Management

The processor passes its transaction to the `Handle` method, enabling atomic updates of read models and checkpoints.

**When to Use the Transaction:**

✅ **SQL-based Read Models** - Use `tx` for all database operations
```go
func (p *OrderStats) Handle(ctx context.Context, tx *sql.Tx, event es.PersistedEvent) error {
    // All database operations use the processor's transaction
    _, err := tx.ExecContext(ctx, "INSERT INTO order_stats ...")
    return err
}
```

**When to Ignore the Transaction:**

⚠️ **Non-SQL Destinations** - Ignore `tx` for message brokers, external APIs, NoSQL databases
```go
func (p *ElasticsearchIndexer) Handle(ctx context.Context, tx *sql.Tx, event es.PersistedEvent) error {
    // Ignore tx - use Elasticsearch client
    _ = tx
    return p.esClient.Index(ctx, event)
}
```

⚠️ **External HTTP APIs** - Ignore `tx` for webhook deliveries or API calls
```go
func (p *WebhookDelivery) Handle(ctx context.Context, tx *sql.Tx, event es.PersistedEvent) error {
    // Ignore tx - make HTTP call
    _ = tx
    return p.httpClient.Post(ctx, webhookURL, event)
}
```

**Important:** Never call `tx.Commit()` or `tx.Rollback()` in your projection. The processor manages the transaction lifecycle automatically.

## One-Off Projection Processing

Pupsourcing supports running projections in **one-off mode**, where the processor handles all available events and exits cleanly instead of running continuously. This enables synchronous, deterministic projection processing.

### Overview

By default, projections run in `RunModeContinuous` mode—polling for new events indefinitely. For scenarios where you need synchronous processing that completes and exits, use `RunModeOneOff`:

```go
config := projection.DefaultProcessorConfig()
config.RunMode = projection.RunModeOneOff  // Exit after catching up

processor := postgres.NewProcessor(db, store, &config)

// Process all events synchronously - exits when caught up
err := processor.Run(ctx, myProjection)
if err != nil {
    // Handle error
}

// Projection is now up-to-date and processor has exited
```

### Use Cases

- **Integration tests** (most common): Validate projection logic with known event sequences
- **Catch-up operations**: Process historical events once and exit
- **Backfilling**: Rebuild projections from existing event store
- **CI/CD pipelines**: Fast, deterministic tests without timing issues
- **One-time data migrations**: Process events synchronously and exit

### Integration Testing with RunModeOneOff

The most common use of one-off mode is **integration testing**. In production, projections run continuously, creating challenges for tests:

- Tests need to manage concurrent goroutines
- Hard to know when projection processing has completed
- Difficult to assert final state without timing issues
- Tests may be flaky due to race conditions

One-off mode solves these problems by processing events synchronously:

```go
func TestProjection_OneOffMode(t *testing.T) {
    // Setup
    db := setupTestDB(t)
    defer db.Close()
    
    ctx := context.Background()
    store := postgres.NewStore(postgres.DefaultStoreConfig())
    
    // Arrange: Append test events
    events := []es.Event{
        {
            BoundedContext: "TestContext",
            AggregateType:  "User",
            AggregateID:    "user-1",
            EventID:        uuid.New(),
            EventType:      "UserCreated",
            EventVersion:   1,
            Payload:        []byte(`{"name":"Alice"}`),
            Metadata:       []byte(`{}`),
            CreatedAt:      time.Now(),
        },
    }
    
    tx, _ := db.BeginTx(ctx, nil)
    store.Append(ctx, tx, es.NoStream(), events)
    tx.Commit()
    
    // Act: Process with one-off mode
    proj := &UserProjection{}
    config := projection.DefaultProcessorConfig()
    config.RunMode = projection.RunModeOneOff
    
    processor := postgres.NewProcessor(db, store, &config)
    
    // This will process all events and exit cleanly
    err := processor.Run(ctx, proj)
    
    // Assert: Verify results
    if err != nil {
        t.Fatalf("Expected nil error, got: %v", err)
    }
    
    if proj.GetUserCount() != 1 {
        t.Errorf("Expected 1 user, got %d", proj.GetUserCount())
    }
}
```

### Benefits

- **Deterministic**: Process events synchronously without timing issues
- **Simple**: No goroutines, channels, or context cancellation needed
- **Fast**: Tests run as fast as possible without polling delays
- **Clear**: Explicit about test behavior vs production behavior

### RunMode Comparison

| Mode | Use Case | Behavior |
|------|----------|----------|
| `RunModeContinuous` | Production | Runs forever, polling for new events |
| `RunModeOneOff` | Testing/Catch-up | Processes available events, then exits cleanly |

### Important Notes

- `RunModeOneOff` exits with `nil` error when caught up (not an error condition)
- Checkpoints are saved correctly in one-off mode
- Works with all adapters: postgres, mysql, sqlite
- Partition configuration is respected in one-off mode
- Scoped projections work normally in one-off mode

