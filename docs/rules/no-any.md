# Rule: no `any`

No `any`, and no `no-explicit-any` suppressions. It switches off checking where
it appears and spreads silently through inference.

Reach for `unknown` plus narrowing at boundaries, a type parameter for generic
code, and `x as unknown as T` where erasure is genuinely unavoidable.

## Accepting a family of classes

Constructor parameters are contravariant, so a fixed props type in an upper
bound rejects every CDK class — `unknown`, `object` and `Record<string, unknown>`
all fail with `Type 'unknown' is not assignable to type 'HttpStageProps'`.

`never` is assignable to everything, so it satisfies contravariance for all of
them at once:

```ts
type ConstructClass = new (...args: never[]) => Construct;
```

Recover the concrete types per call site with the built-ins:

```ts
InstanceType<T>; // the construct instance
NonNullable<ConstructorParameters<T>[2]>; // its props
```

## Gotcha

`never` is a silent failure. A conditional type that stops matching yields
`never` with no error where it is defined — it turns up later as puzzling
`Trait<never, …>` errors at the call sites.

## Enforcement

`test/types.test.ts` pins the typing with `@ts-expect-error`, which fails the
build both ways: the marked line has to error, and an unused directive is itself
an error. Keep `bun x tsc --noEmit` green against real CDK classes — toy stubs
don't reproduce the contravariance that makes this awkward.
