import { Construct } from 'constructs';

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
 * The ids a composition knows statically, mapped to what they hold.
 *
 * Empty unless entries were given explicit ids — see {@link Bind}.
 */
export type IdMap = Record<string, Construct>;

/**
 * The binding one entry contributes to the composition's {@link IdMap}.
 *
 * Only an id written as a literal binds. A `string` variable is unknowable at
 * compile time, and a defaulted id is derived from the class name at runtime —
 * `ctor.name` is typed `string` for every class, so the type system cannot see
 * it. Both cases contribute nothing and leave `get` at its untyped signature.
 */
type Bind<Id extends string, C extends Construct> = string extends Id
  ? Record<never, Construct>
  : { [K in Id]: C };

/**
 * Lookup for the constructs of a composition.
 *
 * Every method resolves an entry on demand: during {@link Composition.build}'s
 * first phase a lookup creates the construct it names if it does not exist yet,
 * so a property trait can reach any sibling regardless of where either sits in
 * the chain. Ordering is therefore discovered rather than declared — see
 * {@link Composition.build}.
 *
 * `Ids` carries the ids declared literally in the composition, so `get` can
 * hand those back typed and non-optional. Trait callbacks receive the default —
 * an empty map — because a trait is written alongside its own entry, before the
 * rest of the chain exists to be inferred from. Use {@link Resources.of} there.
 */
export interface Resources<Ids extends IdMap = Record<never, Construct>> {
  /** The single construct of the given class. Throws if absent or ambiguous. */
  of<T extends ConstructClass>(ctor: T): InstanceType<T>;
  /** Every construct of the given class, in declaration order. */
  all<T extends ConstructClass>(ctor: T): InstanceType<T>[];
  /**
   * The construct created under `id`.
   *
   * An id the composition declared literally resolves to that entry's type and
   * cannot be `undefined` — the composition declares it, so it is there. Any
   * other id stays `Construct | undefined`.
   */
  get<K extends string>(id: K): K extends keyof Ids ? Ids[K] : Construct | undefined;
  /**
   * The construct created under `id`, narrowed to `ctor`. The narrowing is a
   * real `instanceof` check, so the type is earned rather than asserted — a
   * construct of a different class reads as `undefined`, same as a missing id.
   */
  get<T extends ConstructClass>(id: string, ctor: T): InstanceType<T> | undefined;
  /** Whether the composition declares an entry under `id`. */
  has(id: string): boolean;
  /**
   * Every construct in the composition, in declaration order.
   *
   * This asks for *all* of them, including the entry a property trait is being
   * called for — so from a property trait it is always a cycle. Use it from a
   * method or action trait.
   */
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
 *
 * The function may resolve any sibling: the composition creates whatever it
 * asks for on the spot. Two entries that resolve *each other* from property
 * traits are the one unsatisfiable case, and `build` reports it as a cycle.
 */
export interface PropertyTrait<P = object> {
  name: string;
  type: 'property';
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
    type: 'method';
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
  type: 'action';
  run: (construct: C, resources: Resources) => void;
}

/** A named, typed descriptor that modifies or extends a construct entry. */
export type Trait<P = object, C extends Construct = Construct> =
  | PropertyTrait<P>
  | MethodTrait<C>
  | ActionTrait<C>;

/**
 * What {@link Composition.build} hands back: the fixed members below, plus one
 * entry per resource keyed by its id, so a construct can be destructured by
 * name instead of by position.
 *
 * ```ts
 * const { api, logs } = compose(HttpApi, [], "api").and(LogGroup, [], "logs").build(this, "Gateway");
 * ```
 *
 * Only ids written as literals appear in the type — the same rule `resources.get`
 * follows, and for the same reason (see {@link Bind}). A defaulted id still keys
 * the entry at runtime; the compiler just cannot see it.
 */
export type BuildResult<
  Ts extends readonly Construct[],
  Ids extends IdMap = Record<never, Construct>,
> = {
  /** The scope the entries were created under. */
  readonly root: Construct;
  /** The created constructs, typed and in declaration order. */
  readonly constructs: Ts;
  /** Lookup over the same constructs, typed for the ids declared literally. */
  readonly resources: Resources<Ids>;
} & Ids;

/** Members of {@link BuildResult} an entry id would shadow, so ids may not use them. */
const RESERVED_IDS: ReadonlySet<string> = new Set(['root', 'constructs', 'resources']);

/** Erased constructor used internally, once props are merged to a plain object. */
type ErasedConstructClass = new (
  scope: Construct,
  id: string,
  props: Record<string, unknown>
) => Construct;

/** Erased trait shapes for the heterogeneous entry list. */
interface ErasedMethodTrait {
  name: string;
  type: 'method';
  args: (resources: Resources) => readonly unknown[];
}
type ErasedTrait = PropertyTrait<object> | ErasedMethodTrait | ActionTrait<Construct>;

interface Entry {
  readonly ctor: ErasedConstructClass;
  readonly traits: ReadonlyArray<ErasedTrait>;
  readonly id?: string;
}

/** Creates entry `index`'s construct, or returns the one already created. */
type Instantiate = (index: number) => Construct;

const JSII_RTTI = Symbol.for('jsii.rtti');

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
    return meta.fqn.slice(meta.fqn.lastIndexOf('.') + 1);
  }
  return ctor.name;
}

/** True for `{}` literals only — not arrays, not class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
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
  next: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const previous = out[key];
    out[key] =
      isPlainObject(previous) && isPlainObject(value) ? mergeProps(previous, value) : value;
  }
  return out;
}

/**
 * {@link Resources} over the entries of one `build`, resolving each through
 * `instantiate` on first request.
 *
 * Lookups answer from the *declared* entries rather than from what exists, so
 * a class is matched statically — an entry need not be built to be found, and
 * `of` sees the same candidates whenever it is called. Only the construct it
 * settles on gets created.
 */
class ResourceRegistry implements Resources {
  readonly #entries: ReadonlyArray<Entry>;
  readonly #ids: ReadonlyArray<string>;
  readonly #instantiate: Instantiate;

  constructor(entries: ReadonlyArray<Entry>, ids: ReadonlyArray<string>, instantiate: Instantiate) {
    this.#entries = entries;
    this.#ids = ids;
    this.#instantiate = instantiate;
  }

  /** Indexes of the entries whose class is `ctor` or extends it. */
  #matching(ctor: ConstructClass): number[] {
    const target = ctor as unknown as ErasedConstructClass;
    return this.#entries.flatMap((entry, index) =>
      entry.ctor === target || entry.ctor.prototype instanceof ctor ? [index] : []
    );
  }

  get(id: string): Construct | undefined;
  get<T extends ConstructClass>(id: string, ctor: T): InstanceType<T> | undefined;
  get(id: string, ctor?: ConstructClass): Construct | undefined {
    const index = this.#ids.indexOf(id);
    if (index === -1) return undefined;
    const construct = this.#instantiate(index);
    if (ctor === undefined) return construct;
    return construct instanceof ctor ? construct : undefined;
  }

  has(id: string): boolean {
    return this.#ids.includes(id);
  }

  values(): Construct[] {
    return this.#entries.map((_, index) => this.#instantiate(index));
  }

  all<T extends ConstructClass>(ctor: T): InstanceType<T>[] {
    return this.#matching(ctor).map((index) => this.#instantiate(index) as InstanceType<T>);
  }

  of<T extends ConstructClass>(ctor: T): InstanceType<T> {
    const name = declaredName(ctor);
    const found = this.#matching(ctor);
    if (found.length > 1) {
      throw new Error(
        `Ambiguous resources.of(${name}): the composition has ${found.length} of them. ` +
          `Use resources.all(${name}) or look one up by id with resources.get(id).`
      );
    }
    const [only] = found;
    if (only === undefined) {
      throw new Error(`No ${name} in this composition.`);
    }
    return this.#instantiate(only) as InstanceType<T>;
  }
}

function toEntry<T extends ConstructClass>(
  ctor: T,
  traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>>,
  id?: string
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
 * `Ts` accumulates the instance types as entries are added, and `Ids` the ids
 * declared literally, so `build` can hand both back typed.
 *
 * @example
 * const { fn, queue } = compose(Function, [nodeRuntime], "fn")
 *   .and(Queue, [], "queue")
 *   .build(this, "Worker");
 */
export class Composition<
  Ts extends readonly Construct[] = readonly [],
  Ids extends IdMap = Record<never, Construct>,
> {
  readonly #entries: ReadonlyArray<Entry>;

  private constructor(entries: ReadonlyArray<Entry>) {
    this.#entries = entries;
  }

  /** @internal */
  static of<T extends ConstructClass, Id extends string = never>(
    ctor: T,
    traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>>,
    id?: Id
  ): Composition<[InstanceType<T>], Bind<Id, InstanceType<T>>> {
    return new Composition<[InstanceType<T>], Bind<Id, InstanceType<T>>>([
      toEntry(ctor, traits, id),
    ]);
  }

  /**
   * Appends a sibling entry, returning a new {@link Composition}.
   *
   * @param ctor - The construct class to add.
   * @param traits - Traits for this entry, checked against `ctor`.
   * @param id - CDK id for this entry. Defaults to the class name, suffixed
   *   when a class appears more than once. Pass one explicitly if the class
   *   name is minified, you want a stable, meaningful logical id, or you want
   *   the entry typed under that name — both on the {@link BuildResult} itself
   *   and through `resources.get(id)` — after {@link Composition.build}.
   */
  and<T extends ConstructClass, Id extends string = never>(
    ctor: T,
    traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>> = [],
    id?: Id
  ): Composition<[...Ts, InstanceType<T>], Ids & Bind<Id, InstanceType<T>>> {
    return new Composition<[...Ts, InstanceType<T>], Ids & Bind<Id, InstanceType<T>>>([
      ...this.#entries,
      toEntry(ctor, traits, id),
    ]);
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
        `Duplicate ids in composition: ${[...new Set(duplicates)].join(', ')}. ` +
          `Pass an explicit id to distinguish the entries.`
      );
    }

    const reserved = ids.filter((id) => RESERVED_IDS.has(id));
    if (reserved.length > 0) {
      throw new Error(
        `Reserved ids in composition: ${[...new Set(reserved)].join(', ')}. ` +
          `build() returns each resource under its own id alongside ` +
          `${[...RESERVED_IDS].join(', ')}, so those names cannot be used as ids.`
      );
    }
    return ids;
  }

  /**
   * Materialises the composition in two phases.
   *
   * **Phase 1 — instantiation, on demand.** Each entry is created the first
   * time something asks for it, and a property trait asks by resolving a
   * sibling from its {@link Resources}. Creation order is therefore whatever
   * the traits imply — a topological sort discovered by following the
   * references, so declaration order carries no meaning. Entries nobody
   * resolves are created by a final sweep in declaration order. Property
   * traits are merged (last wins, plain objects deep) into props.
   *
   * A property trait that resolves a sibling whose own property traits resolve
   * it back has asked for something that cannot exist; that is reported as a
   * cycle naming the entries involved.
   *
   * **Phase 2 — deferred traits, declaration order.** Method and action traits
   * run once every construct exists, so they may resolve any sibling freely.
   *
   * @returns The scope, the constructs in declaration order, a lookup, and each
   *   construct under its own id.
   */
  build(scope: Construct, id: string): BuildResult<Ts, Ids> {
    const root = new Construct(scope, id);
    const entries = this.#entries;
    const ids = this.#assignIds();
    const instances: (Construct | undefined)[] = new Array(entries.length);
    /** Entries whose props are being assembled, innermost last — the cycle path. */
    const resolving: number[] = [];

    const instantiate: Instantiate = (index) => {
      const existing = instances[index];
      if (existing !== undefined) return existing;

      const cycleStart = resolving.indexOf(index);
      if (cycleStart !== -1) {
        const path = [...resolving.slice(cycleStart), index].map((i) => ids[i]).join(' → ');
        throw new Error(
          `Cyclic property dependency: ${path}. Each of these entries needs the next one to ` +
            `exist before its own props are complete, so none of them can be created first. ` +
            `Move one side to a method or action trait — those run once every construct exists.`
        );
      }

      resolving.push(index);
      try {
        const entry = entries[index];
        const config = entry.traits
          .filter((t): t is PropertyTrait<object> => t.type === 'property')
          .reduce<Record<string, unknown>>((acc, trait) => {
            const value = typeof trait.value === 'function' ? trait.value(resources) : trait.value;
            return mergeProps(acc, value as Record<string, unknown>);
          }, {});

        const construct = new entry.ctor(root, ids[index], config);
        instances[index] = construct;
        return construct;
      } finally {
        resolving.pop();
      }
    };

    const resources = new ResourceRegistry(entries, ids, instantiate);

    // Memoised, so this both creates whatever no trait reached and collects the
    // results in declaration order.
    const built = entries.map((_, index) => instantiate(index));

    for (const [index, entry] of entries.entries()) {
      const construct = built[index];
      for (const trait of entry.traits) {
        if (trait.type === 'method') {
          const target = construct as unknown as Record<string, unknown>;
          const method = target[trait.name];
          if (typeof method !== 'function') {
            throw new Error(
              `Method trait "${trait.name}" is not a function on ${construct.constructor.name}.`
            );
          }
          (method as (...args: unknown[]) => unknown).apply(construct, [...trait.args(resources)]);
        } else if (trait.type === 'action') {
          trait.run(construct, resources);
        }
      }
    }

    // Named entries come first, so the fixed members always win a collision —
    // `#assignIds` already rejects the ids that could cause one.
    return {
      ...Object.fromEntries(ids.map((entryId, index) => [entryId, built[index]])),
      root,
      constructs: built as unknown as Ts,
      // The registry answers `get` honestly at runtime; `Ids` records which of
      // those answers the composition already proved present at build time.
      resources: resources as unknown as Resources<Ids>,
    } as BuildResult<Ts, Ids>;
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
export function compose<T extends ConstructClass, Id extends string = never>(
  ctor: T,
  traits: ReadonlyArray<Trait<PropsOf<T>, InstanceType<T>>> = [],
  id?: Id
): Composition<[InstanceType<T>], Bind<Id, InstanceType<T>>> {
  return Composition.of(ctor, traits, id);
}
