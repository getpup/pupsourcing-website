# About Pupsourcing

## Project Overview

Pupsourcing is a production-ready event sourcing library for Go, designed with clean architecture principles. It provides mature infrastructure for building event-sourced systems without compromising your domain model.

## Project Philosophy

### Clean Architecture First

Event sourcing is powerful, but infrastructure concerns shouldn't leak into your domain logic. Pupsourcing maintains strict boundaries:

- **Pure domain events**: Your events are plain Go structs with no framework dependencies
- **Explicit dependencies**: No hidden globals, reflection magic, or automatic discovery
- **Library, not framework**: You control the flow; Pupsourcing provides the tools

### Production Ready

Pupsourcing is built for real-world production use:

- **Battle-tested patterns**: Based on proven event sourcing principles
- **Comprehensive testing**: Extensive unit and integration tests
- **Clear documentation**: Practical guides with working examples
- **Multiple database support**: PostgreSQL, MySQL, and SQLite adapters
- **Horizontal scaling**: Built-in partitioned projection support

### Developer Friendly

We prioritize developer experience:

- **Minimal boilerplate**: Sensible defaults, explicit configuration when needed
- **Type safety**: Strong typing with generics support
- **Observable**: Optional logging, tracing, and metrics integration
- **Fast feedback**: SQLite support enables rapid local development

## Key Features

### Event Store

- **Optimistic concurrency control**: Prevents lost updates with version checking
- **Bounded context support**: Align with Domain-Driven Design principles
- **Multiple databases**: PostgreSQL (recommended), MySQL, and SQLite
- **Aggregate versioning**: Track aggregate state evolution
- **Global ordering**: Every event gets a unique, monotonically increasing position

### Projections

- **Pull-based processing**: Natural backpressure, no message broker needed
- **Scoped projections**: Filter events by aggregate type and bounded context
- **Horizontal scaling**: Hash-based partitioning across workers
- **At-least-once delivery**: Automatic checkpointing with resumable processing
- **Flexible read models**: Build multiple views from the same event stream

### Code Generation

- **Type-safe event mapping**: Generated conversion between domain and persistence types
- **Version management**: Handle schema evolution with versioned events
- **Zero reflection**: All generated code is inspectable Go

### Observability

- **Optional logging**: Inject your logger of choice, zero overhead when disabled
- **Distributed tracing**: Built-in TraceID, CorrelationID, and CausationID support
- **Metrics integration**: Example Prometheus instrumentation patterns

## Origin Story

Pupsourcing emerged from building production event-sourced systems and identifying common patterns worth extracting into a reusable library. The goal was to create infrastructure that handles the complexity without dictating architecture.

The name "pupsourcing" is a playful take on "event sourcing" - it's approachable, memorable, and reflects the friendly developer experience we aim to provide.

## Who Uses Pupsourcing?

Pupsourcing is suitable for:

- **Microservices**: Event sourcing enables clear service boundaries and event-driven integration
- **Financial systems**: Complete audit trails and temporal queries for compliance
- **E-commerce platforms**: Track order lifecycle, inventory, and customer interactions
- **SaaS applications**: Multi-tenant data isolation with bounded contexts
- **Analytics platforms**: Rich historical data for business intelligence

## Contributing

Contributions are welcome! Whether it's:

- Bug reports and feature requests via [GitHub Issues](https://github.com/getpup/pupsourcing/issues)
- Documentation improvements
- Code contributions via pull requests
- Sharing your experience using pupsourcing

See the [pupsourcing repository](https://github.com/getpup/pupsourcing) for contribution guidelines.

## License

Pupsourcing is open source software released under the [MIT License](https://github.com/getpup/pupsourcing/blob/main/LICENSE).

## Community

- **GitHub Repository**: [github.com/getpup/pupsourcing](https://github.com/getpup/pupsourcing)
- **Documentation**: [getpup.github.io/pupsourcing-website](https://getpup.github.io/pupsourcing-website)
- **Issues & Discussions**: [GitHub Issues](https://github.com/getpup/pupsourcing/issues)

## Acknowledgments

Pupsourcing builds on decades of event sourcing knowledge from the wider software community. We're grateful for the foundational work by:

- Greg Young and the EventStore team
- Martin Fowler's writings on event sourcing and CQRS
- The Domain-Driven Design community
- The Go community for excellent tooling and libraries

## What's Next?

- **[Getting Started](./getting-started.md)** - Install and build your first event-sourced application
- **[Core Concepts](./core-concepts.md)** - Understand event sourcing with pupsourcing
- **[Examples](https://github.com/getpup/pupsourcing/tree/master/examples)** - Working code examples
- **[API Reference](./api-reference.md)** - Complete API documentation
