# Rule: no `any`

Do not use `any` in TypeScript. Prefer `unknown`, explicit generics, or precise union types.

`any` disables type checking entirely at the point of use and propagates silently through inference, eroding safety across the codebase.

## Alternatives

| Situation | Instead of `any` | Use |
|---|---|---|
| Unknown shape at a boundary | `any` | `unknown` + narrowing |
| Generic factory / callback | `any` | `<T>` generic parameter |
| Heterogeneous collection | `any[]` | union type or `unknown[]` |
| Unsafe cast required | `x as any` | `x as unknown as T` (double cast, makes intent explicit) |

## Documented exception: `Ctor` in `src/compose.ts`

```ts
type Ctor<C extends Construct = Construct> = new (scope: Construct, id: string, props: any) => C;
```

CDK construct classes (`HttpStage`, `Function`, `LogGroup`, …) each declare their own specific props types with no shared base interface. TypeScript checks construct signature parameters **contravariantly**, which means no single non-`any` props type can be placed on `Ctor` and still accept all CDK classes:

- `props: unknown` — rejected; `unknown` is not assignable to `HttpStageProps`, `FunctionProps`, etc.
- `props: object` — rejected for the same reason (object doesn't satisfy required props fields).
- `props: Record<string, unknown>` — rejected for the same reason.

`any` is the only type TypeScript accepts here. It is confined to this single internal type alias and is never part of any public API surface. The eslint suppression comment must stay co-located with this type so the exception is visible.

Any future change that claims to replace this `any` must pass `bun x tsc --noEmit` with real CDK construct classes (not toy stubs) before it is accepted.
