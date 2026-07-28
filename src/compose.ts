import { Construct } from "constructs";

/**
 * Structural upper bound for CDK construct classes.
 *
 * `never[]` in the rest position is what makes this work without `any`:
 * constructor parameters are contravariant, and `never` is assignable to
 * everything, so every construct class matches whatever props it declares.
 */
export type ConstructClass = new (...args: never[]) => Construct;

/**
 * The props type a construct class accepts — its third constructor parameter.
 * `NonNullable` strips the `| undefined` optional-props classes carry.
 *
 * For the instance type, use TypeScript's built-in `InstanceType<T>`.
 */
export type PropsOf<T extends ConstructClass> = NonNullable<ConstructorParameters<T>[2]>;

/**
 * The names of callable members on a construct. TypeScript ships no built-in
 * for "keys whose values are functions".
 */
export type MethodKeys<C> = {
  [K in keyof C]: C[K] extends (...args: never[]) => unknown ? K : never;
}[keyof C] &
  string;

/** The parameters of method `K` on construct `C`. */
type MethodArgs<C, K extends keyof C> = Parameters<Extract<C[K], (...args: never[]) => unknown>>;

/**
 * Lookup for the constructs a composition has created so far.
 *
 * Prefer {@link Resources.of} over {@link Resources.get}: it is typed, and it
 * throws instead of yielding `undefined` when a construct is missing.
 */
export interface Resources {
  /** The single construct of the given class. Throws if absent or ambiguous. */
  of<T extends ConstructClass>(ctor: T): InstanceType<T>;
  /** Every construct of the given class, in declaration order. */
  all<T extends ConstructClass>(ctor: T): InstanceType<T>[];
  /** The construct created under `id`, if any. */
  get(id: string): Construct | undefined;
  /** Whether a construct exists under `id`. */
  has(id: string): boolean;
  /** Every construct created so far. */
  values(): Construct[];
}

/**
 * Declares props to merge into the construct before instantiation. `name` is a
 * label with no functional effect.
 *
 * `value` is checked against the construct's real props. It is `Partial`
 * because each trait contributes a subset — note that this means required
 * props are *not* enforced across the merged result; a composition missing one
 * compiles and fails at synth with CDK's own error.
 *
 * Use the function form when the value depends on a sibling, or when it holds
 * per-stack state. Anything stateful — `Code.fromAsset`, a `Bucket` reference —
 * must use the function form, or the same instance is shared by every
 * `build()` and CDK rejects the second one.
 */
export interface PropertyTrait<P = object> {
  name: string;
  type: "property";
  value: Partial<P> | ((resources: Resources) => Partial<P>);
}

/**
 * Calls a method on the construct once every sibling exists. Both the method
 * name and its arguments are checked against `C`.
 *
 * Overloaded methods resolve to their last overload — TypeScript exposes only
 * that one through `Parameters`.
 */
export type MethodTrait<C extends Construct = Construct> = {
  [K in MethodKeys<C>]: {
    name: K;
    type: "method";
    args: (resources: Resources) => MethodArgs<C, K>;
  };
}[MethodKeys<C>];

/**
 * Runs arbitrary logic against the construct once every sibling exists. `run`
 * receives the concrete construct type, so no cast is needed.
 *
 * Use this for wiring that is not a method call — for example reaching the
 * surrounding stack via `Stack.of(construct)`.
 */
export interface ActionTrait<C extends Construct = Construct> {
  name: string;
  type: "action";
  run: (construct: C, resources: Resources) => void;
}

/** A named, typed descriptor that modifies or extends a construct entry. */
export type Trait<P = object, C extends Construct = Construct> =
  | PropertyTrait<P>
  | MethodTrait<C>
  | ActionTrait<C>;

/** What {@link Composition.build} hands back. */
export interface BuildResult<Ts extends readonly Construct[]> {
  /** The scope the entries were created under. */
  readonly root: Construct;
  /** The created constructs, typed and in declaration order. */
  readonly constructs: Ts;
  /** Lookup over the same constructs. */
  readonly resources: Resources;
}

/** Erased constructor used internally, once props are merged to a plain object. */
type ErasedConstructClass = new (
  scope: Construct,
  id: string,
  props: Record<string, unknown>,
) => Construct;

/** Erased trait shapes for the heterogeneous entry list. */
interface ErasedMethodTrait {
  name: string;
  type: "method";
  args: (resources: Resources) => readonly unknown[];
}
type ErasedTrait = PropertyTrait<object> | ErasedMethodTrait | ActionTrait<Construct>;

interface Entry {
  readonly ctor: ErasedConstructClass;
  readonly traits: ReadonlyArray<ErasedTrait>;
  readonly id?: string;
}

interface PendingDeferred {
  readonly construct: Construct;
  readonly trait: ErasedMethodTrait | ActionTrait<Construct>;
}

const JSII_RTTI = Symbol.for("jsii.rtti");

/**
 * The name a construct class was declared with.
 *
 * `ctor.name` alone is unreliable: aws-cdk-lib ships bundled, so its classes
 * are named `Queue2`, `HttpStage2` and so on. jsii records the real name in
 * static metadata, but that metadata is *inherited*, so reading it naively
 * reports `Construct` for every user-defined construct.
 *
 * The metadata describes this class only when the class declaring it shares
 * this class's name: a decorator wrapper and the class it wraps do, a subclass
 * and its base do not. So `Queue` resolves through jsii to `Queue`, while a
 * user's `ServiceV2` keeps its own name instead of being truncated or reported
 * as `Construct`.
 */
function declaredName(ctor: { readonly name: string }): string {
  for (let cur: object | null = ctor; cur !== null; cur = Object.getPrototypeOf(cur)) {
    const meta = Object.getOwnPropertyDescriptor(cur, JSII_RTTI)?.value as
      | { fqn?: string }
      | undefined;
    if (!meta?.fqn) continue;
    if ((cur as { name?: string }).name !== ctor.name) break;
    return meta.fqn.slice(meta.fqn.lastIndexOf(".") + 1);
  }
  return ctor.name;
}

/** True for `{}` literals only — not arrays, not class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Merges `next` over `base`, recursing into plain objects so sibling traits can
 * each contribute part of a nested prop (a Lambda's `environment`, say).
 * Arrays and class instances — `Duration`, `Code`, construct references — are
 * replaced wholesale rather than merged.
 */
function mergeProps(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const previous = out[key];
    out[key] =
      isPlainObject(previous) && isPlainObject(value) ? mergeProps(previous, value) : value;
  }
  return out;
}

class ResourceRegistry implements Resources {
  readonly #byId = new Map<string, Construct>();
  /** Phase 1 only sees later-declared entries, so misses get a different hint. */
  #instantiating = true;

  add(id: string, construct: Construct): void {
    this.#byId.set(id, construct);
  }

  sealInstantiation(): void {
    this.#instantiating = false;
  }

  get(id: string): Construct | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  values(): Construct[] {
    return [...this.#byId.values()];
  }

  all<T extends ConstructClass>(ctor: T): InstanceType<T>[] {
    return this.values().filter((c): c is InstanceType<T> => c instanceof ctor);
  }

  of<T extends ConstructClass>(ctor: T): InstanceType<T> {
    const name = declaredName(ctor);
    const found = this.all(ctor);
    if (found.length > 1) {
      throw new Error(
        `Ambiguous resources.of(${name}): the composition has ${found.length} of them. ` +
          `Use resources.all(${name}) or look one up by id with resources.get(id).`,
      );
    }
    const [only] = found;
    if (!only) {
      throw new Error(
        this.#instantiating
          ? `No ${name} available yet. Entries are instantiated in reverse declaration ` +
            `order, so a property trait only sees siblings declared after it — move ${name} ` +
            `later in the chain, or resolve it from a method or action trait instead.`
          : `No ${name} in this composition.`,
      );
    }
    return only;
  }
}

function toEntry<T extends ConstructClass>(
  ctor: T,
  traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>>,
  id?: string,
): Entry {
  return {
    ctor: ctor as unknown as ErasedConstructClass,
    traits: traits as unknown as ReadonlyArray<ErasedTrait>,
    id,
  };
}

/**
 * An immutable description of constructs to create together under one scope.
 * Nothing is instantiated until {@link Composition.build}.
 *
 * `Ts` accumulates the instance types as entries are added, so `build` can hand
 * them back typed.
 *
 * @example
 * const { constructs: [fn, queue] } = compose(Function, [nodeRuntime])
 *   .and(Queue)
 *   .build(this, "Worker");
 */
export class Composition<Ts extends readonly Construct[] = readonly []> {
  readonly #entries: ReadonlyArray<Entry>;

  private constructor(entries: ReadonlyArray<Entry>) {
    this.#entries = entries;
  }

  /** @internal */
  static of<T extends ConstructClass>(
    ctor: T,
    traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>> = [],
    id?: string,
  ): Composition<[InstanceType<T>]> {
    return new Composition<[InstanceType<T>]>([toEntry(ctor, traits, id)]);
  }

  /**
   * Appends a sibling entry, returning a new {@link Composition}.
   *
   * @param ctor - The construct class to add.
   * @param traits - Traits for this entry, checked against `ctor`.
   * @param id - CDK id for this entry. Defaults to the class name, suffixed
   *   when a class appears more than once. Pass one explicitly if the class
   *   name is minified or you want a stable, meaningful logical id.
   */
  and<T extends ConstructClass>(
    ctor: T,
    traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>> = [],
    id?: string,
  ): Composition<[...Ts, InstanceType<T>]> {
    return new Composition<[...Ts, InstanceType<T>]>([...this.#entries, toEntry(ctor, traits, id)]);
  }

  /** Ids in declaration order, defaulting to class names with a suffix on repeats. */
  #assignIds(): string[] {
    const seen = new Map<string, number>();
    const ids = this.#entries.map(({ ctor, id }) => {
      if (id !== undefined) return id;
      const base = declaredName(ctor);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}${count}`;
    });

    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate ids in composition: ${[...new Set(duplicates)].join(", ")}. ` +
          `Pass an explicit id to distinguish the entries.`,
      );
    }
    return ids;
  }

  /**
   * Materialises the composition in two phases.
   *
   * **Phase 1 — instantiation, reverse declaration order.** Later-declared
   * siblings exist first, so earlier entries' property functions can resolve
   * them. Property traits are merged (last wins, plain objects deep) into props.
   *
   * **Phase 2 — deferred traits, same reverse order.** Method and action traits
   * run once every construct exists.
   *
   * @returns The scope, the constructs in declaration order, and a lookup.
   */
  build(scope: Construct, id: string): BuildResult<Ts> {
    const root = new Construct(scope, id);
    const resources = new ResourceRegistry();
    const pending: PendingDeferred[] = [];
    const ids = this.#assignIds();
    const instances: Construct[] = new Array(this.#entries.length);

    const indexed = this.#entries.map((entry, index) => ({ entry, index }));
    for (const { entry, index } of indexed.toReversed()) {
      const config = entry.traits
        .filter((t): t is PropertyTrait<object> => t.type === "property")
        .reduce<Record<string, unknown>>((acc, trait) => {
          const value = typeof trait.value === "function" ? trait.value(resources) : trait.value;
          return mergeProps(acc, value as Record<string, unknown>);
        }, {});

      const construct = new entry.ctor(root, ids[index], config);
      instances[index] = construct;
      resources.add(ids[index], construct);

      for (const trait of entry.traits) {
        if (trait.type === "method" || trait.type === "action") {
          pending.push({ construct, trait });
        }
      }
    }

    resources.sealInstantiation();

    for (const { construct, trait } of pending) {
      if (trait.type === "method") {
        const target = construct as unknown as Record<string, unknown>;
        const method = target[trait.name];
        if (typeof method !== "function") {
          throw new Error(
            `Method trait "${trait.name}" is not a function on ${construct.constructor.name}.`,
          );
        }
        (method as (...args: unknown[]) => unknown).apply(construct, [...trait.args(resources)]);
      } else {
        trait.run(construct, resources);
      }
    }

    return { root, constructs: instances as unknown as Ts, resources };
  }
}

/**
 * Starts a {@link Composition}. Chain {@link Composition.and} to add siblings,
 * then {@link Composition.build} to create everything under one scope.
 *
 * Traits are checked against `ctor`: property values against its props, method
 * names and arguments against its methods, and action callbacks receive the
 * concrete instance.
 *
 * ```ts
 * const { constructs: [fn, queue] } = compose(Function, [
 *   { name: "runtime", type: "property", value: { runtime: Runtime.NODEJS_24_X } },
 *   { name: "addEventSource", type: "method", args: (r) => [new SqsEventSource(r.of(Queue))] },
 * ])
 *   .and(Queue)
 *   .build(this, "Worker");
 * ```
 *
 * @param ctor - The construct class to start with.
 * @param traits - Traits for this entry, checked against `ctor`.
 * @param id - CDK id for this entry. Defaults to the class name.
 */
export function compose<T extends ConstructClass>(
  ctor: T,
  traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>> = [],
  id?: string,
): Composition<[InstanceType<T>]> {
  return Composition.of(ctor, traits, id);
}
