# cdk-composition

Higher-level composition patterns for AWS CDK TypeScript.

---

> *The core tension: reuse encourages centralisation, but centralisation creates coupling.*
>
> Custom L3 constructs start focused but accrete unrelated capabilities over time — the path of least resistance is always "add another prop." Changing any part of the construct risks regressions across every consumer. `cdk-composition` replaces the monolithic construct with a flat list of CDK classes and named, typed **traits**. Adding a capability means adding a trait. A change that alters the intent of an existing trait means writing a new one — the old trait stays valid for every consumer that still wants the original behaviour.
>
> — [ADR-0001](docs/0001-composition-with-pluggable-traits.md)

---

## Installation

```sh
npm install cdk-composition
# or
bun add cdk-composition
```

`aws-cdk-lib` and `constructs` are peer dependencies — they are not bundled.

## Concepts

A **Composition** is an immutable, ordered list of CDK construct classes, each paired with zero or more traits. Nothing is instantiated until `.build()` is called. `build()` runs in two phases:

1. **Instantiation** — constructs are created in *reverse* declaration order so that later-declared siblings are already in the resources map when earlier entries' property functions run.
2. **Deferred traits** — method and action traits are applied in the order they were collected during phase 1 (latest-declared first).

Constructs are named by their class name. Duplicates get a numeric suffix (`Queue`, `Queue1`, …).

## Traits

### PropertyTrait

**Merges configuration into a construct's props before it is instantiated.**

Use a plain object for static values. Use a function when you need to reference a sibling construct — because phase 1 runs in reverse declaration order, any sibling declared *after* the current entry is already available in the resources map.

```ts
import { Duration } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { compose } from "cdk-composition";

// Plain object — merged directly into Queue's props
compose(Queue, [
  {
    name: "visibility",
    type: "property",
    value: { visibilityTimeout: Duration.seconds(30) },
  },
]).build(this, "MyQueue");
```

Multiple property traits are merged left-to-right; later traits win on key collisions. This makes it straightforward to apply a base trait and override specific keys with a more specific one.

```ts
// The second trait wins — effective timeout is 60 s
compose(Queue, [
  { name: "base", type: "property", value: { visibilityTimeout: Duration.seconds(30) } },
  { name: "override", type: "property", value: { visibilityTimeout: Duration.seconds(60) } },
]).build(this, "MyQueue");
```

The function form receives the resources map, which already contains any sibling declared *later* in the composition:

```ts
// Function references "Queue", which is declared below via .and()
compose(Function, [
  {
    name: "deadLetterQueue",
    type: "property",
    value: (r) => ({ deadLetterQueue: r.get("Queue") }),
  },
])
  .and(Queue)
  .build(this, "Worker");
```

---

### MethodTrait

**Calls a named method on the construct after all siblings are instantiated.**

Use this for configuration that requires calling a method rather than setting props — lifecycle rules, event source mappings, policy grants. The `args` function receives the fully-populated resources map so any sibling can be referenced.

```ts
import { Duration } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { compose } from "cdk-composition";

compose(Bucket, [
  {
    name: "addLifecycleRule",
    type: "method",
    args: (_r) => [{ expiration: Duration.days(90) }],
  },
]).build(this, "Archive");
```

Method traits are applied in latest-declared-first order, matching the reverse-instantiation order of phase 1. This means siblings added via later `.and()` calls have their methods applied before earlier entries.

---

### ActionTrait

**Runs arbitrary logic against the construct after all siblings are instantiated.**

Use this for cross-composition wiring that cannot be expressed as a method call — most commonly finding a shared construct elsewhere in the stack via `Stack.of(construct).node.findAll()`. This lets you wire constructs across compositions without making either side explicitly aware of the other.

```ts
import { Stack } from "aws-cdk-lib";
import { Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { compose, type ActionTrait } from "cdk-composition";

const httpRoute = (path: string, method: HttpMethod): ActionTrait => ({
  name: `route-${method.toLowerCase()}-${path}`,
  type: "action",
  run: (fn, _r) => {
    const api = Stack.of(fn).node
      .findAll()
      .find((c): c is HttpApi => c instanceof HttpApi);
    api?.addRoutes({
      path,
      methods: [method],
      integration: new HttpLambdaIntegration(path, fn as Function),
    });
  },
});

compose(Function, [
  { name: "runtime", type: "property", value: { runtime: Runtime.NODEJS_24_X } },
  httpRoute("/orders", HttpMethod.POST),
]).build(this, "CreateOrder");
```

Because `ActionTrait` exposes `Stack.of(construct)`, it can reach any construct in the CDK tree — not just siblings in the same composition. This makes each route its own composition, with no shared state between them, while all of them still wire to the same `HttpApi`.

---

## Full example

A queue worker that demonstrates all three trait types together: a Lambda function with static props, a cross-sibling dead-letter queue reference, an event source wired via method call, and an HTTP status route wired via the shared `HttpApi`.

```ts
import { Duration, Stack } from "aws-cdk-lib";
import { Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { compose, type ActionTrait } from "cdk-composition";

// Reusable action trait — lives in a shared traits library, not in the stack
const statusRoute = (path: string): ActionTrait => ({
  name: `status-route-${path}`,
  type: "action",
  run: (fn, _r) => {
    const api = Stack.of(fn).node
      .findAll()
      .find((c): c is HttpApi => c instanceof HttpApi);
    api?.addRoutes({
      path,
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(path, fn as Function),
    });
  },
});

compose(Function, [
  // PropertyTrait (plain object) — static props merged at instantiation
  {
    name: "runtime",
    type: "property",
    value: {
      runtime: Runtime.NODEJS_24_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
    },
  },
  // PropertyTrait (function form) — Queue is declared below but already
  // instantiated by the time this runs (reverse-order phase 1)
  {
    name: "deadLetterQueue",
    type: "property",
    value: (r) => ({ deadLetterQueue: r.get("Queue") }),
  },
  // MethodTrait — called after all siblings exist; wires the SQS event source
  {
    name: "addEventSource",
    type: "method",
    args: (r) => [new SqsEventSource(r.get("Queue") as Queue, { batchSize: 10 })],
  },
  // ActionTrait — finds the shared HttpApi anywhere in the stack via Stack.of()
  statusRoute("/worker/status"),
])
  .and(Queue, [
    // PropertyTrait on Queue — sets visibility timeout to match Lambda timeout
    {
      name: "visibility",
      type: "property",
      value: { visibilityTimeout: Duration.seconds(30) },
    },
  ])
  .build(this, "Worker");
```

The `statusRoute` trait is a plain value — it can live in a shared traits library and be dropped into any composition. The composition itself stays a readable manifest: which constructs belong together, and what named capabilities each carries. No single file accumulates all the configuration details.

---

## API

### `compose(ctor, traits?)`

Starts a new `Composition` with one entry. Returns the `Composition`.

### `Composition.and(ctor, traits?)`

Appends a sibling entry. Returns a **new** `Composition` — the original is unchanged.

### `Composition.build(scope, id)`

Materialises the composition under `scope` with the given CDK id. Returns the root `Construct`.

### Trait types

| Type | Purpose | Runs |
|------|---------|------|
| `PropertyTrait` | Merges props before instantiation. `value` is a plain object or `(resources) => object`. | Phase 1, during instantiation |
| `MethodTrait` | Calls a named method. `args` is `(resources) => unknown[]`. | Phase 2, latest-declared first |
| `ActionTrait` | Runs arbitrary logic. `run` receives the construct and full resources map. | Phase 2, latest-declared first |

All traits carry a `name` field. It has no functional effect — it documents intent and is the unit of granularity at code review.
