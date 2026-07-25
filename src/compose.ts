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
 * Declares an intent to call a method on the construct after instantiation.
 * `name` is a human-readable label and has no functional effect yet.
 * `args` are the arguments that will eventually be forwarded to the method.
 */
export interface MethodTrait {
  name: string;
  type: "method";
  args: unknown[];
}

/** A named, typed descriptor that modifies or extends a construct entry. */
export type Trait = PropertyTrait | MethodTrait;

/** Internal representation of one entry in the composition graph. */
interface Entry {
  readonly ctor: Ctor;
  readonly traits: ReadonlyArray<Trait>;
}

/**
 * An immutable description of a group of CDK constructs to be created together
 * under a shared scope. Built via {@link compose} and extended with {@link Composition.and}.
 *
 * Nothing is instantiated until {@link Composition.build} is called.
 *
 * @example
 * compose(Queue, [
 *   { name: 'visibility', type: 'property', value: { visibilityTimeout: Duration.seconds(30) } },
 * ])
 *   .and(Queue)
 *   .build(this, "Messaging");
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
   * Materialises the composition by instantiating all entries as children of a
   * new root {@link Construct} at `scope/<id>`.
   *
   * **Naming** — each entry's CDK id is its class name (e.g. `Queue`). If the
   * same class appears more than once, a numeric suffix is appended starting at
   * `1` (`Queue`, `Queue1`, `Queue2`, …).
   *
   * **`property` traits** — their `value` objects are shallow-merged left-to-right
   * into the construct's props before instantiation. Later traits win on key collisions.
   *
   * **`method` traits** — declared but not yet applied.
   *
   * @param scope - The CDK scope to place the root construct in.
   * @param id - The CDK id for the root construct.
   * @returns The root {@link Construct} containing all entries.
   */
  build(scope: Construct, id: string): Construct {
    const root = new Construct(scope, id);

    // Track how many times each constructor has appeared so duplicate classes
    // get a numeric suffix instead of colliding on the same CDK id.
    const seen = new Map<Ctor, number>();

    for (const { ctor, traits } of this.#entries) {
      const count = seen.get(ctor) ?? 0;
      seen.set(ctor, count + 1);
      const entryId = count === 0 ? ctor.name : `${ctor.name}${count}`;

      // Merge all property trait values left-to-right into a single props object.
      const config = traits
        .filter((t): t is PropertyTrait => t.type === "property")
        .reduce<Record<string, unknown>>((acc, t) => ({ ...acc, ...t.value }), {});

      new ctor(root, entryId, config);
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
 * compose(Queue, [
 *   { name: 'visibility', type: 'property', value: { visibilityTimeout: Duration.seconds(30) } },
 * ])
 *   .and(Queue)
 *   .build(this, "Messaging");
 * ```
 *
 * @param ctor - The CDK construct class to start the composition with.
 * @param traits - Traits to apply to this entry.
 */
export function compose(ctor: Ctor, traits: Trait[] = []): Composition {
  return Composition.of(ctor, traits);
}
