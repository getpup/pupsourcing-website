# Pupsourcing

A production-ready Event Sourcing library for Go with clean architecture principles.

---

## What is Event Sourcing?

Event sourcing is a powerful architectural pattern that stores **state changes as an immutable sequence of events** rather than maintaining only the current state. Instead of updating records (CRUD), your system appends events that describe **what happened**.

### Think of it Like a Bank Statement

Imagine your bank account. The bank doesn't just store your current balance - they keep a complete record of every transaction:

```
Jan 1:  Deposit    +$1000  → Balance: $1000
Jan 5:  Withdraw   -$200   → Balance: $800
Jan 10: Deposit    +$500   → Balance: $1300
Jan 15: Withdraw   -$300   → Balance: $1000
```

If you wanted to know your balance on January 10th, the bank could replay all transactions up to that date. This is exactly how event sourcing works - instead of storing the final balance, you store every transaction (event) and calculate the current state by replaying them.

### How Does This Work in Software?

In event sourcing, you never update or delete data. Instead, you:

1. **Write events** when something happens (UserRegistered, EmailChanged, OrderPlaced)
2. **Store events** in an append-only log (events can't be changed or deleted)
3. **Read events** and replay them to reconstruct the current state
4. **Build projections** (read models) by processing events into formats optimized for querying

### The Traditional Approach vs Event Sourcing

**Traditional CRUD - Updates destroy history:**

```
User table:
┌────┬─────────────────────┬───────┬────────┐
│ id │ email               │ name  │ status │
├────┼─────────────────────┼───────┼────────┤
│ 1  │ alice@example.com   │ Alice │ active │
└────┴─────────────────────┴───────┴────────┘
```

```sql
-- UPDATE loses history - no way to know what changed
UPDATE users SET email='new@email.com' WHERE id=1;
```

**Event Sourcing - Preserves complete history:**

```
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

// Replay events to get current state (pseudo-code)
Order = empty order object

FOR EACH event IN events:
    IF event is OrderCreated:
        Order.Items = event.items
        Order.Total = event.total
        Order.Status = "created"
    ELSE IF event is PaymentProcessed:
        Order.Status = "paid"
    ELSE IF event is OrderShipped:
        Order.Status = "shipped"
        Order.TrackingNumber = event.tracking
    ELSE IF event is OrderDelivered:
        Order.Status = "delivered"

// Result: Order.Status = "delivered"
```

### How to Read a List of Users?

This is a common question for newcomers: "If everything is stored as events, how do I get a simple list of users?"

The answer is **projections** (also called read models). You process events to build tables optimized for queries:

**Events (append-only):**
```
1. UserCreated     { id: 1, email: "alice@example.com", name: "Alice" }
2. UserCreated     { id: 2, email: "bob@example.com", name: "Bob" }
3. EmailChanged    { id: 1, newEmail: "alice@newdomain.com" }
4. UserDeactivated { id: 2, reason: "account closed" }
```

**Projection (users_view table):**
```
Process each event and update a regular database table:
┌────┬───────────────────────┬───────┬──────────┐
│ id │ email                 │ name  │ status   │
├────┼───────────────────────┼───────┼──────────┤
│ 1  │ alice@newdomain.com   │ Alice │ active   │
│ 2  │ bob@example.com       │ Bob   │ inactive │
└────┴───────────────────────┴───────┴──────────┘
```

Now you can query: `SELECT * FROM users_view WHERE status = 'active'` - fast and simple!

**Key insight:** You keep both the events (for history and replaying) and projections (for fast queries). The projections are built by processing events and can be rebuilt at any time.

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
