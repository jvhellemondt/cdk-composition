import { Construct } from "constructs";

type Ctor<P extends object = object> = new (scope: Construct, id: string, props?: P) => Construct;

/**
 * Declares a prop (or set of props) to merge into the construct's props before
 * instantiation. `name` is a human-readable label and has no functional effect.
 */
export interface PropertyTrait {
  name: string;
  type: "property";
  value: Record<string, unknown>;
}

/**
 * Declares a method call to be made on the construct after all siblings are
 * instantiated. `name` is the method name on the construct. `args` receives the
 * fully-populated resources map so any sibling can be referenced by its CDK id.
 *
 * Method traits are applied in reverse entry order (latest sibling first) to
 * ensure constructs declared later in the composition are already configured
 * when earlier ones' methods run.
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
 *   { name: 'eventSource', type: 'method', args: (r) => [new SqsEventSource(r.get('Queue'))] },
 * ])
 *   .and(Queue)
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
   * **Phase 1 — instantiation (forward order)**
   * Every entry is constructed and added to a `resources` map keyed by CDK id
   * (`Queue`, `Queue1`, `Bucket`, …). Duplicate class names get a numeric suffix
   * starting at `1`. Property traits are merged (last wins) into props before
   * each construct is created.
   *
   * **Phase 2 — method application (reverse order, latest first)**
   * Method traits are called on their construct in reverse entry order, so later
   * siblings are fully instantiated before earlier ones' methods run. Each
   * `args` function receives the complete resources map to resolve cross-sibling
   * references.
   *
   * @param scope - The CDK scope to place the root construct in.
   * @param id - The CDK id for the root construct.
   * @returns The root {@link Construct} containing all entries.
   */
  build(scope: Construct, id: string): Construct {
    const root = new Construct(scope, id);
    const seen = new Map<Ctor, number>();
    const resources = new Map<string, Construct>();
    const pending: PendingMethod[] = [];

    // Phase 1: instantiate every construct and collect method traits.
    for (const { ctor, traits } of this.#entries) {
      const count = seen.get(ctor) ?? 0;
      seen.set(ctor, count + 1);
      // Strip trailing digits that bundlers append to class names (e.g. "Queue2" → "Queue").
      const baseName = ctor.name.replace(/\d+$/, "");
      const entryId = count === 0 ? baseName : `${baseName}${count}`;

      const config = traits
        .filter((t): t is PropertyTrait => t.type === "property")
        .reduce<Record<string, unknown>>((acc, t) => ({ ...acc, ...t.value }), {});

      const construct = new ctor(root, entryId, config);
      resources.set(entryId, construct);

      for (const trait of traits) {
        if (trait.type === "method") {
          pending.push({ construct, trait });
        }
      }
    }

    // Phase 2: apply method traits latest-first so cross-sibling references
    // resolve against already-configured constructs.
    for (const { construct, trait } of pending.toReversed()) {
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
 *   { name: 'addEventSource', type: 'method', args: (r) => [new SqsEventSource(r.get('Queue'))] },
 * ])
 *   .and(Queue)
 *   .build(this, "Worker");
 * ```
 *
 * @param ctor - The CDK construct class to start the composition with.
 * @param traits - Traits to apply to this entry.
 */
export function compose(ctor: Ctor, traits: Trait[] = []): Composition {
  return Composition.of(ctor, traits);
}
