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

Traits are **named, typed values defined outside the composition**. They live in a shared file or library, carry a descriptive name, and describe a single concern. A `compose()` call is then a readable manifest — which constructs belong together and which named capabilities each carries — with no configuration detail buried inside it.

`build()` materialises the composition in two phases:

1. **Instantiation** — constructs are created in *reverse* declaration order so that later-declared siblings are already in the resources map when earlier entries' property functions run.
2. **Deferred traits** — method and action traits are applied in the order collected during phase 1 (latest-declared first).

Constructs are named by their class name. Duplicates get a numeric suffix (`Queue`, `Queue1`, …).

---

## Traits

### PropertyTrait

Merges configuration into a construct's props before it is instantiated.

`value` is a plain object for static configuration, or a function when a prop needs to reference a sibling construct. Because phase 1 runs in reverse declaration order, any sibling declared *after* the current entry is already in the resources map when the function runs.

```ts
// traits/queue.ts
import { Duration } from "aws-cdk-lib";
import { type PropertyTrait } from "cdk-composition";

export const thirtySecondVisibility: PropertyTrait = {
  name: "visibility-30s",
  type: "property",
  value: { visibilityTimeout: Duration.seconds(30) },
};

// Function form — references a sibling that will be declared later in the composition
export const withDeadLetterQueue: PropertyTrait = {
  name: "dead-letter-queue",
  type: "property",
  value: (r) => ({ deadLetterQueue: r.get("Queue") }),
};
```

```ts
// stack.ts
compose(Function, [withDeadLetterQueue])
  .and(Queue, [thirtySecondVisibility])
  .build(this, "Worker");
```

Multiple property traits are merged left-to-right; later traits win on key collisions. Apply a base trait and override specific keys with a more specific one — no subclassing required.

---

### MethodTrait

Calls a named method on the construct after all siblings are instantiated.

Use this for configuration that requires a method call rather than props — lifecycle rules, event source mappings, policy grants. The `args` function receives the fully-populated resources map so any sibling can be referenced by name.

```ts
// traits/bucket.ts
import { Duration } from "aws-cdk-lib";
import { type MethodTrait } from "cdk-composition";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export const ninetyDayExpiry: MethodTrait = {
  name: "lifecycle-90d-expiry",
  type: "method",
  args: (_r) => [{ expiration: Duration.days(90) }],
};

// traits/lambda.ts
export const withSqsEventSource = (batchSize = 10): MethodTrait => ({
  name: "sqs-event-source",
  type: "method",
  args: (r) => [new SqsEventSource(r.get("Queue") as Queue, { batchSize })],
});
```

```ts
// stack.ts
compose(Bucket, [ninetyDayExpiry]).build(this, "Archive");

compose(Function, [withSqsEventSource(5)])
  .and(Queue)
  .build(this, "Worker");
```

Method traits are applied latest-declared-first, matching the reverse-instantiation order of phase 1.

---

### ActionTrait

Runs arbitrary logic against the construct after all siblings are instantiated.

Use this for cross-composition wiring that cannot be expressed as a method call. The `run` function receives the construct itself, so `Stack.of(construct).node.findAll()` can locate any construct in the broader CDK tree — including shared infrastructure from a different composition.

```ts
// traits/api.ts
import { Stack } from "aws-cdk-lib";
import { Function } from "aws-cdk-lib/aws-lambda";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { type ActionTrait } from "cdk-composition";

export const httpRoute = (path: string, method: HttpMethod): ActionTrait => ({
  name: `http-route-${method.toLowerCase()}-${path}`,
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
```

```ts
// stack.ts — each route is its own composition; all wire to the same shared HttpApi
compose(Function, [nodeRuntime, httpRoute("/orders", HttpMethod.POST)]).build(this, "CreateOrder");
compose(Function, [nodeRuntime, httpRoute("/orders", HttpMethod.GET)]).build(this, "ListOrders");
compose(Function, [nodeRuntime, httpRoute("/orders/:id", HttpMethod.DELETE)]).build(this, "DeleteOrder");
```

Because `httpRoute` finds the `HttpApi` via the CDK tree rather than through the resources map, each composition stays self-contained. No shared state, no cross-composition imports, no ordering dependencies.

---

## Full example

A queue worker that uses all three trait types. Traits are defined in a shared file; the composition itself is a one-screen manifest.

```ts
// traits/worker.ts
import { Duration, Stack } from "aws-cdk-lib";
import { Runtime, Function } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { type PropertyTrait, type MethodTrait, type ActionTrait } from "cdk-composition";

export const nodeRuntime: PropertyTrait = {
  name: "runtime",
  type: "property",
  value: { runtime: Runtime.NODEJS_24_X, memorySize: 512, timeout: Duration.seconds(30) },
};

// Function form — Queue is declared after Function in the composition,
// but already instantiated by the time this runs (reverse-order phase 1).
export const withDeadLetterQueue: PropertyTrait = {
  name: "dead-letter-queue",
  type: "property",
  value: (r) => ({ deadLetterQueue: r.get("Queue") }),
};

export const withSqsEventSource = (batchSize = 10): MethodTrait => ({
  name: "sqs-event-source",
  type: "method",
  args: (r) => [new SqsEventSource(r.get("Queue") as Queue, { batchSize })],
});

export const statusRoute = (path: string): ActionTrait => ({
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

export const workerVisibility: PropertyTrait = {
  name: "visibility-30s",
  type: "property",
  value: { visibilityTimeout: Duration.seconds(30) },
};
```

```ts
// stack.ts
import { compose } from "cdk-composition";
import {
  nodeRuntime,
  withDeadLetterQueue,
  withSqsEventSource,
  statusRoute,
  workerVisibility,
} from "./traits/worker";

compose(Function, [nodeRuntime, withDeadLetterQueue, withSqsEventSource(), statusRoute("/worker/status")])
  .and(Queue, [workerVisibility])
  .build(this, "Worker");
```

The stack file says what exists and what it can do. The trait file says how each capability is implemented. Neither knows about the other's internals.

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
