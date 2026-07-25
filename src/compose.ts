import { Construct } from "constructs";

type Ctor<P extends object = object> = new (scope: Construct, id: string, props?: P) => Construct;

/**
 * Declares a prop (or set of props) to merge into the construct's props before
 * instantiation. `name` is a human-readable label and has no functional effect.
 *
 * `value` may be a plain object or a function that receives the resources map.
 * Use the function form to reference a later-declared sibling — because entries
 * are instantiated in reverse declaration order, any sibling added via a later
 * `.and()` call is already in the map when the function runs.
 */
export interface PropertyTrait {
  name: string;
  type: "property";
  value:
    | Record<string, unknown>
    | ((resources: Map<string, Construct>) => Record<string, unknown>);
}

/**
 * Declares a method call to be made on the construct after all siblings are
 * instantiated. `name` is the method name on the construct. `args` receives the
 * fully-populated resources map so any sibling can be referenced by its CDK id.
 *
 * Method traits are applied in latest-declared-first order (matching the reverse
 * instantiation order of phase 1).
 */
export interface MethodTrait {
  name: string;
  type: "method";
  args: (resources: Map<string, Construct>) => unknown[];
}

/** A named, typed descriptor that modifies or extends a construct entry. */
export type Trait = PropertyTrait | MethodTrait;

/** Internal representation of one entry in the composition graph. */
interface Entry {
  readonly ctor: Ctor;
  readonly traits: ReadonlyArray<Trait>;
}

/** Pending method call, captured during phase 1 and executed in phase 2. */
interface PendingMethod {
  readonly construct: Construct;
  readonly trait: MethodTrait;
}

/**
 * An immutable description of a group of CDK constructs to be created together
 * under a shared scope. Built via {@link compose} and extended with {@link Composition.and}.
 *
 * Nothing is instantiated until {@link Composition.build} is called.
 *
 * @example
 * compose(Function, [
 *   { name: 'runtime', type: 'property', value: { runtime: Runtime.NODEJS_24_X } },
 *   { name: 'logGroup', type: 'property', value: (r) => ({ logGroup: r.get('LogGroup') }) },
 *   { name: 'addEventSource', type: 'method', args: (r) => [new SqsEventSource(r.get('Queue'))] },
 * ])
 *   .and(Queue)
 *   .and(LogGroup)
 *   .build(this, "Worker");
 */
export class Composition {
  readonly #entries: ReadonlyArray<Entry>;

  private constructor(entries: ReadonlyArray<Entry>) {
    this.#entries = entries;
  }

  /** @internal */
  static of(ctor: Ctor, traits: Trait[] = []): Composition {
    return new Composition([{ ctor, traits }]);
  }

  /**
   * Appends a sibling construct entry and returns a new {@link Composition}.
   * The original is left unchanged (immutable).
   *
   * @param ctor - The CDK construct class to add as a sibling.
   * @param traits - Traits to apply to this entry.
   */
  and(ctor: Ctor, traits: Trait[] = []): Composition {
    return new Composition([...this.#entries, { ctor, traits }]);
  }

  /**
   * Materialises the composition in two phases:
   *
   * **Phase 1 — instantiation (reverse declaration order, latest first)**
   * IDs are pre-assigned in forward (declaration) order so that
   * `compose(Queue).and(Queue)` always names the first entry `Queue` and the
   * second `Queue1`, regardless of instantiation order. Constructs are then
   * created latest-declared first, so any sibling added via a later `.and()` call
   * is already in the resources map when earlier entries' property trait value
   * functions are evaluated. Property traits are merged (last wins) into props
   * before each construct is created.
   *
   * **Phase 2 — method application (same latest-first order as phase 1)**
   * Method traits are called in the same order they were collected during phase 1
   * (latest-declared first). Each `args` function receives the complete resources
   * map to resolve cross-sibling references.
   *
   * @param scope - The CDK scope to place the root construct in.
   * @param id - The CDK id for the root construct.
   * @returns The root {@link Construct} containing all entries.
   */
  build(scope: Construct, id: string): Construct {
    const root = new Construct(scope, id);
    const resources = new Map<string, Construct>();
    const pending: PendingMethod[] = [];

    // Pre-assign IDs in forward (declaration) order for predictable naming.
    const seen = new Map<Ctor, number>();
    const assignedIds = this.#entries.map(({ ctor }) => {
      const count = seen.get(ctor) ?? 0;
      seen.set(ctor, count + 1);
      // Strip trailing digits that bundlers append to class names (e.g. "Queue2" → "Queue").
      const baseName = ctor.name.replace(/\d+$/, "");
      return count === 0 ? baseName : `${baseName}${count}`;
    });

    // Phase 1: instantiate in reverse declaration order so later-declared siblings
    // are in the resources map when earlier entries' value functions run.
    const indexed = this.#entries.map((entry, i) => ({ entry, entryId: assignedIds[i] }));
    for (const { entry: { ctor, traits }, entryId } of indexed.toReversed()) {
      const config = traits
        .filter((t): t is PropertyTrait => t.type === "property")
        .reduce<Record<string, unknown>>((acc, t) => {
          const val = typeof t.value === "function" ? t.value(resources) : t.value;
          return { ...acc, ...val };
        }, {});

      const construct = new ctor(root, entryId, config);
      resources.set(entryId, construct);

      for (const trait of traits) {
        if (trait.type === "method") {
          pending.push({ construct, trait });
        }
      }
    }

    // Phase 2: apply method traits in the order collected during phase 1
    // (latest-declared first), so later siblings are already configured.
    for (const { construct, trait } of pending) {
      (construct as Record<string, (...a: unknown[]) => unknown>)[trait.name](
        ...trait.args(resources),
      );
    }

    return root;
  }
}

/**
 * Starts a new {@link Composition} with a single construct entry.
 *
 * Chain {@link Composition.and} to add siblings, then call
 * {@link Composition.build} to materialise everything under a shared CDK scope.
 *
 * ```ts
 * compose(Function, [
 *   { name: 'runtime', type: 'property', value: { runtime: Runtime.NODEJS_24_X } },
 *   { name: 'logGroup', type: 'property', value: (r) => ({ logGroup: r.get('LogGroup') }) },
 *   { name: 'addEventSource', type: 'method', args: (r) => [new SqsEventSource(r.get('Queue'))] },
 * ])
 *   .and(Queue)
 *   .and(LogGroup)
 *   .build(this, "Worker");
 * ```
 *
 * @param ctor - The CDK construct class to start the composition with.
 * @param traits - Traits to apply to this entry.
 */
export function compose(ctor: Ctor, traits: Trait[] = []): Composition {
  return Composition.of(ctor, traits);
}
