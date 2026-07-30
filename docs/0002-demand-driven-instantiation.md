---
status: accepted
date: 2026-07-29
decision-makers: [jvhellemondt]
consulted: []
informed: []
---

# Instantiate composition entries on demand rather than in a fixed order

## Context and Problem Statement

A `PropertyTrait` may resolve a sibling construct — an `HttpStage` needs its `HttpApi`, an `Alarm` needs the api it meters. Resolving a sibling means that sibling must already exist, so `build()` has to create entries in an order that satisfies every reference.

The first implementation created them in _reverse_ declaration order. That works, but it makes declaration order load-bearing: the author of a composition has to perform the topological sort by hand and encode the result as the order of the `.and()` chain. Worse, the constraint leaks into the traits themselves — `AttachHttpApi` had to document "the `HttpApi` must be declared _after_ the stage carrying this trait", a statement about a chain the trait does not own and cannot check. Getting it wrong produced a runtime error at synth time, and the fix was to shuffle unrelated-looking lines.

The question that prompted this: could instantiation happen in parallel instead? It cannot — CDK constructors are synchronous, perform no I/O, and mutate a shared construct tree, so there is nothing to overlap. But the question identifies the real problem, which is coupling rather than throughput.

## Decision Drivers

- A composition should read as a description of what exists, not as an encoding of build order
- A trait should state its own requirements only, so it stays portable between compositions
- Ordering mistakes should be impossible to make rather than diagnosed after the fact
- Dependencies are already expressed precisely (a `resources.of` / `resources.get` call); nothing further should need declaring
- The `BuildResult` and the synthesised template must not change shape

## Considered Options

- Keep reverse declaration order
- Declare dependencies explicitly on each entry (`dependsOn: [...]`) and topologically sort
- Instantiate on demand, discovering the order through the resolutions traits actually perform

## Decision Outcome

Chosen option: "instantiate on demand". `build()` creates an entry the first time something asks for it; a property trait asking for a sibling is what causes that sibling to be created. Ordering becomes an emergent property of the references rather than a rule the author follows, and declaration order is left as presentation. Entries nothing resolves are created by a final sweep in declaration order, so nothing is dropped.

### Consequences

- Good, because the `.and()` chain can be ordered for reading — api, then stage, then log group — instead of for the builder
- Good, because a trait's contract shrinks to "the composition holds an `HttpApi`", with no claim about position, which makes traits portable and their docs honest
- Good, because the dependency graph is derived from the code that already expresses it — no `dependsOn` to keep in sync with the resolutions it describes
- Good, because `resources.of` now considers every declared entry rather than the ones built so far, so an ambiguous `of(X)` in a composition holding two `X` is reported instead of resolving to whichever happened to exist
- Neutral, because phase 2 moves from latest-declared-first to declaration order; every construct exists by then, so the change only affects traits that mutate the same target twice
- Bad, because mutually-referencing property traits are now representable and must be detected at runtime as a cycle, where reverse order made them unexpressible
- Bad, because `resources.values()` from a property trait is a cycle by construction — it asks for the entry currently being configured

### Confirmation

`compose.test.ts` covers the properties this decision claims: a resolved sibling is created before its dependant in either declaration order; unresolved entries are still created; an entry resolved several times is created once; `constructs` and the id-keyed result stay in declaration order; and both mutual and self references throw a cycle error naming the entries.

## Pros and Cons of the Options

### Keep reverse declaration order

- Good, because instantiation is a single pass with no bookkeeping and no cycle detection
- Good, because circular property references cannot be written at all
- Bad, because the composition author performs the topological sort manually and silently
- Bad, because traits must document positional requirements they cannot enforce
- Bad, because the diagnostic for a mistake ("move `X` later in the chain") describes a fix in terms of the implementation rather than the intent

### Explicit `dependsOn` per entry

- Good, because the graph is stated plainly and can be sorted before anything is built
- Good, because cycles are detectable without running any trait code
- Bad, because it duplicates information the trait bodies already carry, and the two drift
- Bad, because it pushes knowledge of a trait's internals up into the composition — the stack would have to know that `AccessLogging` reaches for a `LogGroup`

### Instantiate on demand

- Good, because the only declaration of a dependency is the resolution itself
- Good, because ordering cannot be got wrong; there is no order to state
- Neutral, because construction is now re-entrant, which is the source of both the cycle detection and its error message
- Bad, because the creation order at runtime is no longer obvious from reading the composition — it has to be inferred from the traits (the construct tree records it, so it remains observable)

## More Information

Supersedes the instantiation-order half of [ADR-0001](0001-composition-with-pluggable-traits.md); the trait model it describes is unchanged.

Logical ids derive from the construct path, not from creation order, so no CloudFormation template changes as a result of this — the same set of constructs is created under the same scope with the same ids.
