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
npm install @arts-n-crafts/cdk-composition
# or
bun add @arts-n-crafts/cdk-composition
```

`aws-cdk-lib` and `constructs` are peer dependencies — they are not bundled.

## Concepts

Traits are **named, typed values defined outside the composition**. They live in a shared file or library, carry a descriptive name, and describe a single concern. A `compose()` call is then a readable manifest — which constructs belong together and which named capabilities each carries — with no configuration detail buried inside it.

`build()` materialises the composition in two phases:

1. **Instantiation** — constructs are created in *reverse* declaration order so that later-declared siblings are already available when earlier entries' property functions run.
2. **Deferred traits** — method and action traits are applied in the order collected during phase 1 (latest-declared first).

`build()` returns each construct under its own id, plus the same constructs typed and in declaration order, so nothing needs to be looked up afterwards:

```ts
const { fn, queue } = compose(Function, [nodeRuntime], "fn")
  .and(Queue, [], "queue")
  .build(this, "Worker");

queue.grantSendMessages(fn); // fully typed

// Or positionally, when the ids don't matter:
const { constructs: [handler, jobs] } = compose(Function, [nodeRuntime]).and(Queue).build(this, "Jobs");
```

Entries are named by their class name, with a numeric suffix on repeats (`Queue`, `Queue1`, …). Pass a third argument to `compose`/`and` to set the id yourself — worth doing when you want a stable, meaningful logical id, or a name to destructure `build()` by:

```ts
const { Inbox, Outbox } = compose(Queue, [], "Inbox").and(Queue, [], "Outbox").build(this, "Mail");
```

A defaulted id keys the entry at runtime too, but only ids written as literals are visible to the compiler — see [Why `get` is only sometimes typed](#why-get-is-only-sometimes-typed), which applies to these names for the same reason. `root`, `constructs` and `resources` are the build result's own members, so they are rejected as ids.

---

## Traits

### PropertyTrait

Merges configuration into a construct's props before it is instantiated.

`value` is a plain object for static configuration, or a function when a prop needs to reference a sibling construct. Because phase 1 runs in reverse declaration order, any sibling declared *after* the current entry is already built when the function runs — `resources.of()` throws with that hint if it is not.

Use the function form for anything stateful (`Code.fromAsset`, for instance). The object form is shared across every `build()`, and CDK rejects a second binding.

Property traits merge left-to-right, later traits winning. Plain objects merge deeply, so separate traits can each contribute part of a nested prop; arrays and class instances are replaced outright.

```ts
// traits/queue.ts
import { Duration } from "aws-cdk-lib";
import { type PropertyTrait } from "@arts-n-crafts/cdk-composition";

export const thirtySecondVisibility: PropertyTrait = {
  name: "visibility-30s",
  type: "property",
  value: { visibilityTimeout: Duration.seconds(30) },
};

// Function form — references a sibling that will be declared later in the composition
export const withDeadLetterQueue: PropertyTrait = {
  name: "dead-letter-queue",
  type: "property",
  value: (r) => ({ deadLetterQueue: { queue: r.of(Queue), maxReceiveCount: 3 } }),
};
```

```ts
// stack.ts
compose(Function, [withDeadLetterQueue])
  .and(Queue, [thirtySecondVisibility])
  .build(this, "Worker");
```

Apply a base trait and override specific keys with a more specific one — no subclassing required.

Note that props are checked individually but not collectively: because each trait contributes a `Partial`, a composition that never supplies a *required* prop still compiles and fails at synth with CDK's own error.

---

### MethodTrait

Calls a named method on the construct after all siblings are instantiated.

Use this for configuration that requires a method call rather than props — lifecycle rules, event source mappings, policy grants. Both the method name and its arguments are checked against the construct, and `args` receives a lookup covering every sibling.

Overloaded methods resolve to their last overload; TypeScript exposes only that one.

```ts
// traits/bucket.ts
import { Duration } from "aws-cdk-lib";
import { type MethodTrait } from "@arts-n-crafts/cdk-composition";
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
  args: (r) => [new SqsEventSource(r.of(Queue), { batchSize })],
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
import { type ActionTrait } from "@arts-n-crafts/cdk-composition";

export const httpRoute = (path: string, method: HttpMethod): ActionTrait<Function> => ({
  name: `http-route-${method.toLowerCase()}-${path}`,
  type: "action",
  run: (fn, _r) => {
    const api = Stack.of(fn).node
      .findAll()
      .find((c): c is HttpApi => c instanceof HttpApi);
    api?.addRoutes({
      path,
      methods: [method],
      integration: new HttpLambdaIntegration(path, fn),
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
import { type PropertyTrait, type MethodTrait, type ActionTrait } from "@arts-n-crafts/cdk-composition";

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
  value: (r) => ({ deadLetterQueue: { queue: r.of(Queue), maxReceiveCount: 3 } }),
};

export const withSqsEventSource = (batchSize = 10): MethodTrait<Function> => ({
  name: "sqs-event-source",
  type: "method",
  args: (r) => [new SqsEventSource(r.of(Queue), { batchSize })],
});

export const statusRoute = (path: string): ActionTrait<Function> => ({
  name: `status-route-${path}`,
  type: "action",
  run: (fn, _r) => {
    const api = Stack.of(fn).node
      .findAll()
      .find((c): c is HttpApi => c instanceof HttpApi);
    api?.addRoutes({
      path,
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(path, fn),
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
import { compose } from "@arts-n-crafts/cdk-composition";
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

### `compose(ctor, traits?, id?)`

Starts a new `Composition` with one entry. `id` defaults to the construct's class name.

### `Composition.and(ctor, traits?, id?)`

Appends a sibling entry. Returns a **new** `Composition` — the original is unchanged.

### `Composition.build(scope, id)`

Materialises the composition under `scope`. Returns `{ root, constructs, resources, ...entriesById }`:

| Member | Returns |
|--------|---------|
| `root` | The scope the entries were created under. |
| `constructs` | The created constructs as a typed tuple, in declaration order. |
| `resources` | A `Resources` lookup over the same constructs. |
| *`<id>`* | The construct created under that id — typed for every id the composition declared literally. |

`root`, `constructs` and `resources` cannot be used as entry ids; `build()` throws if one is.

### `Resources`

Passed to trait callbacks and returned from `build()`.

| Member | Returns |
|--------|---------|
| `of(Class)` | The single construct of that class. Throws if absent or ambiguous. |
| `all(Class)` | Every construct of that class, in declaration order. |
| `get(id)` | The construct under that id. Typed as that entry's class — and never `undefined` — for an id the composition declared literally; `Construct \| undefined` otherwise. |
| `get(id, Class)` | The same, narrowed to `Class` by an `instanceof` check. A different class reads as `undefined`, same as a missing id. |
| `has(id)` | Whether an id exists. |
| `values()` | Every construct created so far. |

#### Why `get` is only sometimes typed

A composition tracks the ids it was given, so `build()` can hand them back typed:

```ts
const { resources } = compose(HttpApi, [], "Api").and(LogGroup, [], "AccessLogs").build(this, "Gateway");

resources.get("Api").apiEndpoint;      // HttpApi — no `?` needed, build() created it
resources.get("AccessLogs").logGroupArn; // LogGroup
resources.get("Nope");                 // Construct | undefined
```

Two cases stay untyped — and, for the same reason, absent from the build result's named entries — because the id is genuinely not knowable at compile time:

- **A defaulted id.** It is derived from the class name at runtime; `ctor.name` is `string` for every class, so the type system cannot read `"Queue"` out of `typeof Queue`.
- **A `string` variable as the id.** Nothing to bind.

Trait callbacks also receive the untyped lookup. A trait is written alongside its own entry, before the rest of the chain exists to be inferred from — and the ids that *are* known by then are precisely the earlier-declared ones, which a property trait cannot reach anyway, since entries are instantiated in reverse. Inside a trait, reach for `of(Class)`: it is typed, and it throws with an explanatory message rather than yielding `undefined`.

### Trait types

| Type | Purpose | Runs |
|------|---------|------|
| `PropertyTrait<Props>` | Merges props before instantiation. `value` is a plain object or `(resources) => object`. | Phase 1, during instantiation |
| `MethodTrait<Construct>` | Calls a method. Name and arguments are both checked. | Phase 2, latest-declared first |
| `ActionTrait<Construct>` | Runs arbitrary logic. `run` receives the concrete construct and the lookup. | Phase 2, latest-declared first |

All traits carry a `name` field. It has no functional effect — it documents intent and is the unit of granularity at code review.

---

## Releasing

The package is published to npm as [`@arts-n-crafts/cdk-composition`](https://www.npmjs.com/package/@arts-n-crafts/cdk-composition) by `.github/workflows/publish.yml`.

`bun run build` produces `dist/`: an ESM bundle (`index.mjs`), a CommonJS bundle (`index.cjs`) and declarations (`index.d.ts`). `aws-cdk-lib` and `constructs` stay external. Only `dist/` is published — `src/` and the tests are not.

To cut a release:

1. Bump `version` in `package.json` and commit it.
2. Tag and publish a GitHub release named `vX.Y.Z`. The workflow checks the tag matches `package.json`, runs lint, the tests and the build, then publishes.

`workflow_dispatch` runs the same pipeline with `npm publish --dry-run`, which is the way to validate packaging without releasing.

### Trusted publishing

The workflow authenticates to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers) — GitHub's OIDC token is exchanged for short-lived credentials, so there is no `NPM_TOKEN` secret to store or rotate. That is why the job requests `id-token: write`, runs on a GitHub-hosted runner, and runs on Node 24 (trusted publishing needs Node >= 22.14.0 and npm >= 11.5.1, and Node 24 bundles npm 11.17).

npm can only attach a trusted publisher to a package that already exists — there is no way to reserve or create an empty package on the registry. The first version therefore has to be published the old way, once:

```sh
npm login              # a member of the @arts-n-crafts org, with publish rights
bun run build
npm publish            # publishConfig already sets access: public
```

Then, on npmjs.com, open the package's **Settings -> Trusted Publisher**, choose GitHub Actions, and enter:

| Field | Value |
|-------|-------|
| Organization or user | `jvhellemondt` |
| Repository | `cdk-composition` |
| Workflow filename | `publish.yml` |
| Environment | *(leave empty)* |

Every release after that goes through the workflow with no credentials in the repository. npm attaches a provenance attestation automatically on a trusted publish, which is why `publishConfig` does not set `provenance` — that flag would break the manual bootstrap publish above, since provenance cannot be generated outside CI.
