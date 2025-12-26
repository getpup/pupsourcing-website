# Pupsourcing

[![CI](https://github.com/getpup/pupsourcing/actions/workflows/ci.yml/badge.svg)](https://github.com/getpup/pupsourcing/actions/workflows/ci.yml)
[![Go Report Card](https://goreportcard.com/badge/github.com/getpup/pupsourcing)](https://goreportcard.com/report/github.com/getpup/pupsourcing)
[![GoDoc](https://godoc.org/github.com/getpup/pupsourcing?status.svg)](https://godoc.org/github.com/getpup/pupsourcing)

A production-ready Event Sourcing library for Go with clean architecture principles.

---

## What is Event Sourcing?

Event sourcing is a powerful architectural pattern that stores **state changes as an immutable sequence of events** rather than maintaining only the current state. Instead of updating records (CRUD), your system appends events that describe **what happened**.

### The Traditional Approach vs Event Sourcing

**Traditional CRUD - Updates destroy history:**

```sql
User table:
┌────┬─────────────────────┬───────┬────────┐
│ id │ email               │ name  │ status │
├────┼─────────────────────┼───────┼────────┤
│ 1  │ alice@example.com   │ Alice │ active │
└────┴─────────────────────┴───────┴────────┘

-- UPDATE loses history - no way to know what changed
UPDATE users SET email='new@email.com' WHERE id=1;
```

**Event Sourcing - Preserves complete history:**

```go
Events (append-only log):
┌───────────────────────────────────────────────────────┐
│ 1. UserCreated                                        │
│    {id: 1, email: "alice@example.com", name: "Alice"} │
├───────────────────────────────────────────────────────┤
│ 2. EmailVerified                                      │
│    {id: 1}                                            │
├───────────────────────────────────────────────────────┤
│ 3. EmailChanged                                       │
│    {id: 1, from: "alice@example.com",                 │
│     to: "alice@newdomain.com"}                        │
├───────────────────────────────────────────────────────┤
│ 4. UserDeactivated                                    │
│    {id: 1, reason: "account closed"}                  │
└───────────────────────────────────────────────────────┘

Current state = Apply events 1-4 in sequence
Historical state = Apply events up to any point in time
```

### Real-World Example: E-commerce Order

Let's see a concrete example of how event sourcing works with an online shopping order:

```go
// Traditional approach - single row gets updated repeatedly
Order {
    ID: "order-123",
    Status: "delivered",  // Lost history: was it created? paid? shipped?
    Items: [...],
    Total: 99.99
}

// Event sourcing - complete audit trail
Events for order-123:
1. OrderCreated      { items: [...], total: 99.99 }
2. PaymentProcessed  { method: "credit_card", amount: 99.99 }
3. OrderShipped      { carrier: "FedEx", tracking: "123456789" }
4. OrderDelivered    { deliveredAt: "2024-01-15T14:30:00Z" }

// Replay events to get current state
func (o *Order) Apply(events []Event) {
    for _, event := range events {
        switch e := event.(type) {
        case OrderCreated:
            o.Items = e.Items
            o.Total = e.Total
            o.Status = "created"
        case PaymentProcessed:
            o.Status = "paid"
        case OrderShipped:
            o.Status = "shipped"
            o.TrackingNumber = e.Tracking
        case OrderDelivered:
            o.Status = "delivered"
        }
    }
}
```

### Why Event Sourcing?

Event sourcing provides powerful capabilities that are difficult or impossible with traditional CRUD:

**✅ Complete Audit Trail**
- Every state change is recorded with full context
- Perfect for compliance (financial, healthcare, legal)
- Natural debugging: see exactly what happened and when

**✅ Temporal Queries**
- "What was the user's email on January 1st?"
- "Show me all orders that were pending last week"
- Reconstruct past state at any point in time

**✅ Flexible Read Models**
- Build new views from existing events without migrations
- Multiple projections from the same event stream
- Add new read models without touching write side

**✅ Event Replay**
- Fix bugs by replaying events with corrected logic
- Test new features on production data
- Generate new projections from historical events

**✅ Business Intelligence**
- Rich analytics from complete event history
- Answer questions that weren't anticipated
- "How many users changed their email in the last month?"

### When to Use Event Sourcing

**✅ Great fit:**
- Systems requiring audit trails (finance, healthcare, legal)
- Complex business domains with rich behavior
- Applications needing temporal queries
- Microservices publishing domain events
- Multiple read models from the same data

**⚠️ Consider carefully:**
- Simple CRUD applications (may be overkill)
- Prototypes without event sourcing requirements
- Teams new to event sourcing (learning curve)
- Strict low-latency requirements everywhere

---

## How Pupsourcing Helps

Pupsourcing makes event sourcing in Go **simple, clean, and production-ready**. Here's what sets it apart:

### 🎯 Clean Architecture

No infrastructure creep into your domain model:

```go
// Your domain events are plain Go structs
type UserCreated struct {
    Email string
    Name  string
}

// No annotations, no framework inheritance
// Pure domain logic
```

### 🔌 Database Flexibility

Support for multiple databases with the same API:

- **PostgreSQL** (recommended for production)
- **SQLite** (perfect for testing and development)
- **MySQL/MariaDB**

Switch databases without changing your application code:

```go
// PostgreSQL
store := postgres.NewStore(postgres.DefaultStoreConfig())

// SQLite
store := sqlite.NewStore(sqlite.DefaultStoreConfig())

// MySQL
store := mysql.NewStore(mysql.DefaultStoreConfig())
```

### 🏗️ Bounded Context Support

Align with Domain-Driven Design (DDD):

```go
// Events are scoped to bounded contexts
event := es.Event{
    BoundedContext: "Identity",  // Clear domain boundaries
    AggregateType:  "User",
    AggregateID:    userID,
    EventType:      "UserCreated",
    // ...
}
```

### 🔒 Optimistic Concurrency

Automatic conflict detection prevents lost updates:

```go
// Append with expected version
result, err := store.Append(ctx, tx, 
    es.ExpectedVersion(3),  // Expects version 3
    []es.Event{event},
)
// If another process already wrote version 4, this fails
```

### 📊 Powerful Projections

Transform events into query-optimized read models:

```go
// Scoped projection - only User events from Identity context
type UserReadModel struct{}

func (p *UserReadModel) AggregateTypes() []string {
    return []string{"User"}
}

func (p *UserReadModel) BoundedContexts() []string {
    return []string{"Identity"}
}

func (p *UserReadModel) Handle(ctx context.Context, event es.PersistedEvent) error {
    // Update your read model
    switch event.EventType {
    case "UserCreated":
        // Create user in read model
    case "EmailChanged":
        // Update email in read model
    }
    return nil
}
```

### 📈 Horizontal Scaling

Built-in support for scaling projections across multiple workers:

```go
// Partition projections across 4 workers
config := projection.ProcessorConfig{
    PartitionCount:  4,
    PartitionNumber: 0,  // This worker handles partition 0
}
processor := postgres.NewProcessor(db, store, &config)
```

### 🛠️ Code Generation

Optional type-safe event mapping:

```bash
# Generate strongly-typed event mappers
go run github.com/getpup/pupsourcing/cmd/eventmap-gen \
  -input internal/domain/events \
  -output internal/infrastructure/generated
```

### 🎁 Minimal Dependencies

- Go standard library
- Database driver (your choice)
- That's it!

---

## Quick Start

### Installation

```bash
go get github.com/getpup/pupsourcing

# Choose your database driver
go get github.com/lib/pq  # PostgreSQL
```

### Your First Event

```go
import (
    "github.com/getpup/pupsourcing/es"
    "github.com/getpup/pupsourcing/es/adapters/postgres"
    "github.com/google/uuid"
)

// Create store
store := postgres.NewStore(postgres.DefaultStoreConfig())

// Create event
event := es.Event{
    BoundedContext: "Identity",
    AggregateType:  "User",
    AggregateID:    uuid.New().String(),
    EventID:        uuid.New(),
    EventType:      "UserCreated",
    EventVersion:   1,
    Payload:        []byte(`{"email":"alice@example.com","name":"Alice"}`),
    Metadata:       []byte(`{}`),
    CreatedAt:      time.Now(),
}

// Append to event store
tx, _ := db.BeginTx(ctx, nil)
result, err := store.Append(ctx, tx, es.NoStream(), []es.Event{event})
if err != nil {
    tx.Rollback()
    log.Fatal(err)
}
tx.Commit()

fmt.Printf("Event stored at position: %d\n", result.GlobalPositions[0])
```

### Read Events

```go
// Read all events for an aggregate
stream, err := store.ReadAggregateStream(
    ctx, tx, 
    "Identity",  // bounded context
    "User",      // aggregate type
    aggregateID, // aggregate ID
    nil, nil,    // from/to version
)

// Process events
for _, event := range stream.Events {
    fmt.Printf("Event: %s at version %d\n", 
        event.EventType, event.AggregateVersion)
}
```

---

## What's Next?

- **[Getting Started](getting-started.md)** - Complete setup guide and first steps
- **[Core Concepts](core-concepts.md)** - Deep dive into event sourcing principles
- **[Database Adapters](adapters.md)** - Choosing and configuring your database
- **[Scaling & Projections](scaling.md)** - Building read models and horizontal scaling
- **[API Reference](api-reference.md)** - Complete API documentation

---

## Production Ready

Pupsourcing is designed for production use with:

- **Comprehensive test coverage** - Unit and integration tests
- **Battle-tested patterns** - Based on proven event sourcing principles
- **Clear documentation** - Extensive guides and examples
- **Active maintenance** - Regular updates and bug fixes
- **Clean codebase** - Easy to understand and extend

---

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/getpup/pupsourcing/blob/main/LICENSE) file for details.
