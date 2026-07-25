---
status: accepted
date: 2026-07-25
decision-makers: [jvhellemondt]
consulted: []
informed: []
---

# Compose CDK constructs from isolated, pluggable traits

## Context and Problem Statement

AWS CDK stacks written directly with L2 constructs grow large quickly. The idiomatic response is to extract reusable groups of resources into custom L3 constructs. This works initially, but L3 constructs accumulate scope over time: a queue construct gains a dead-letter queue, then retry settings, then an alarm, then an event-source mapping — each addition made sense individually, but collectively they drift far from the original rationale. Features get bolted on because modifying the construct is the path of least resistance. The construct becomes a monolith in miniature, and changing any part of it risks regressions in every consumer.

The core tension: reuse encourages centralisation, but centralisation creates coupling. How do we keep CDK infrastructure composable without letting any single unit accumulate unbounded responsibility?

## Decision Drivers

- Stack files should stay readable; resource configuration should not crowd out structural intent
- A construct's purpose should remain stable over its lifetime; unrelated capabilities should not accrete onto it
- Changes to one concern should not require understanding or testing unrelated concerns
- New capabilities should be addable without touching existing code
- Configuration should be traceable to a named, typed unit of intent

## Considered Options

- Traditional custom L3 constructs
- Inline L2 constructs in the stack with no extraction layer
- Composition with named, typed, pluggable traits

## Decision Outcome

Chosen option: "Composition with named, typed, pluggable traits", because it makes every unit of configuration a first-class, named value that can be reasoned about, tested, and replaced in isolation. Adding a capability means adding a trait; changing the intent of an existing configuration means writing a new trait rather than mutating an existing one — the old trait remains valid for other consumers. This keeps the surface area of any change small and its impact predictable.

### Consequences

- Good, because stack files describe structure (which constructs belong together) without describing every configuration detail
- Good, because a trait with a single responsibility is easy to read, test, and name accurately
- Good, because adding a capability to a composition does not require modifying any existing construct or trait
- Good, because traits can be developed and distributed independently — a team can publish a `sqsVisibilityTrait` or `s3LifecycleTrait` that others compose in without taking a transitive dependency on an opinionated L3 construct
- Bad, because the indirection between a trait and the resource it configures requires familiarity with the pattern before it reads naturally
- Bad, because highly stateful or order-sensitive wiring (e.g. circular cross-construct dependencies) is harder to express than it is inside a monolithic construct that controls all instantiation

### Confirmation

Each trait is a typed value (`PropertyTrait`, `MethodTrait`, or `ActionTrait`) with a `name` that must be set by the author. Code review of any new trait should verify that the name accurately describes the single concern it addresses. A trait whose name contains "and" or requires a paragraph to explain is a candidate for splitting.

## Pros and Cons of the Options

### Traditional custom L3 constructs

A class that extends `Construct` groups related resources under a single CDK node. Props control variation.

- Good, because it is the established CDK pattern with broad tooling and documentation support
- Good, because the construct is a single import — easy to discover and depend on
- Neutral, because TypeScript props provide some configuration expressiveness but no structural separation of concerns
- Bad, because every new requirement is a props change or a new method, both of which widen the public surface of the construct
- Bad, because consumers couple to the entire construct even when they only need part of it, so removing a feature is a breaking change regardless of whether any consumer used it
- Bad, because the construct's git history conflates unrelated changes, making it hard to understand why a capability exists or when it was added

### Inline L2 constructs in the stack

Resources are declared directly in the stack class with no extraction layer.

- Good, because there is no abstraction to understand — the stack is the full picture
- Good, because there is no coupling surface; each stack is self-contained
- Bad, because stacks grow to hundreds or thousands of lines and become hard to navigate
- Bad, because identical configuration must be duplicated across stacks with no shared unit of intent
- Bad, because a change to a shared pattern (e.g. all queues should have a DLQ) requires editing every stack

### Composition with named, typed, pluggable traits

Resources are declared as a `Composition` — a flat list of construct classes plus traits. Traits are plain typed values (`PropertyTrait`, `MethodTrait`, `ActionTrait`) that carry a `name` and describe a single intent. `build()` materialises everything under a shared CDK scope.

- Good, because a composition reads like a manifest: which constructs, and what named capabilities each carries
- Good, because traits are open for extension and closed for modification — a changed requirement yields a new trait, leaving existing consumers untouched
- Good, because traits are distributable; a shared library of named traits is more granular than a shared library of L3 constructs
- Good, because the two-phase build (instantiate reversed, then apply deferred traits) means cross-sibling references are expressed as data rather than imperative wiring code
- Neutral, because traits that call arbitrary methods (`MethodTrait`) or run arbitrary logic (`ActionTrait`) can still accumulate complexity — discipline in naming and scope is still required
- Bad, because the pattern is not part of the CDK standard library; teams adopting it must learn the trait model before they can contribute

## More Information

The Open/Closed Principle is the underlying design pressure: software entities should be open for extension, closed for modification. Traditional L3 constructs make extension cheap in the short term (just add a prop) but accumulate modification debt over time. The trait model makes extension the default path by making traits cheap to write, name, and replace.

The practical heuristic for deciding when to write a new trait versus modifying an existing one: if the change would require renaming the trait to remain accurate, write a new trait.
