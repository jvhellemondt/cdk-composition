# Rule: no `any`

Do not use `any`. There are no exceptions in this codebase, and no
`@typescript-eslint/no-explicit-any` suppressions.

`any` disables type checking at the point of use and propagates silently through
inference, eroding safety far beyond the line it appears on.

## Alternatives

| Situation | Instead of `any` | Use |
|---|---|---|
| Unknown shape at a boundary | `any` | `unknown` + narrowing |
| Generic factory / callback | `any` | a type parameter, `infer`red from an argument |
| Upper bound over heterogeneous class signatures | `props: any` | `(...args: never[])` — see below |
| Heterogeneous collection | `any[]` | union type or `unknown[]` |
| Unavoidable erasure at a storage boundary | `x as any` | `x as unknown as T` — narrow, local, and greppable |

## The `never[]` bound + `infer` technique

This is the pattern that let `src/compose.ts` reach zero `any`, and it
generalises to any "accept a family of classes with incompatible signatures"
problem.

The problem: CDK construct classes each declare their own props type, with no
shared base. Constructor parameters are checked **contravariantly**, so any
*fixed* props type in an upper bound rejects every CDK class — `unknown`,
`object`, and `Record<string, unknown>` were all tested and all fail with
`Type 'unknown' is not assignable to type 'HttpStageProps'`.

The fix is to stop fixing the props type at all:

```ts
// `never` is assignable to every type, so contravariance is satisfied for
// every concrete class regardless of the props it declares.
export type ConstructClass = new (...args: never[]) => Construct;
```

That gives an upper bound that accepts everything. The concrete types are then
recovered per-call with `infer`, so no information is lost:

```ts
export type InstanceOf<T extends ConstructClass> =
  T extends new (...args: never[]) => infer C ? C : never;

export type PropsOf<T extends ConstructClass> =
  T extends new (scope: Construct, id: string, props: infer P) => Construct
    ? NonNullable<P>
    : never;
```

The result is strictly better than `any`: traits are now checked against each
construct's real props type, method names against its real methods, and action
callbacks receive the concrete instance.

### Watch the optionality of the inferred parameter

`props` is **required** in the `PropsOf` pattern on purpose. A constructor with
optional props (`Queue`, `LogGroup`, `HttpApi`) still matches a required-param
pattern, because it can be called with three arguments. The reverse is not true:
writing `props?: infer P` silently resolves to `never` for required-props
classes like `HttpStage` and `Function` — no error at the definition, just
mysterious `Trait<never, …>` failures at every call site.

`never` is the failure mode to watch for whenever a conditional type stops
matching. It is silent at the point of definition and only surfaces downstream.

## Enforcement

`test/types.test.ts` holds compile-time assertions for the public typing. They
use `@ts-expect-error`, which fails the build in both directions — the marked
line must error, and an unused directive is itself an error. So `bun x tsc
--noEmit` passing proves both that valid usage compiles and that invalid usage
is rejected.

Any change that reintroduces `any`, or that loosens these types, must keep
`bun x tsc --noEmit` green against real CDK construct classes — not toy stubs,
which do not reproduce the contravariance or optionality behaviour that makes
this hard.
