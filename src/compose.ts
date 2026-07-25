import { Construct } from "constructs";

type Ctor<P extends object = object> = new (scope: Construct, id: string, props?: P) => Construct;

/**
 * A trait applied to a construct entry. Two forms are accepted:
 *
 * - **Construct class** — instantiated as a co-resident sibling directly under
 *   the same root scope, using `<primaryId>-<ClassName><index>` as its CDK id.
 * - **Plain object** — shallowly merged (left-to-right) into the construct's
 *   props before instantiation. Later objects win on key collisions.
 */
export type Trait<P extends object = object> = Ctor | Partial<P>;

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
 * compose(Queue, [{ visibilityTimeout: Duration.seconds(30) }])
 *   .and(Queue, [DeadLetterAlarm])   // sibling Queue + a co-resident Alarm trait
 *   .build(this, "Messaging");
 */
export class Composition {
  readonly #entries: ReadonlyArray<Entry>;

  private constructor(entries: ReadonlyArray<Entry>) {
    this.#entries = entries;
  }

  /** @internal */
  static of<P extends object>(ctor: Ctor<P>, traits: Array<Trait<P>> = []): Composition {
    return new Composition([{ ctor: ctor as Ctor, traits }]);
  }

  /**
   * Appends a sibling construct entry to the composition and returns a new
   * {@link Composition}. The original is left unchanged (immutable).
   *
   * @param ctor - The CDK construct class to add as a sibling.
   * @param traits - Traits to apply: plain objects are merged into props;
   *   construct classes become co-residents under the same root scope.
   */
  and<P extends object>(ctor: Ctor<P>, traits: Array<Trait<P>> = []): Composition {
    return new Composition([...this.#entries, { ctor: ctor as Ctor, traits }]);
  }

  /**
   * Materialises the composition by instantiating all entries as children of a
   * new root {@link Construct} at `scope/<id>`.
   *
   * **Naming** — each entry's CDK id is its class name (e.g. `Queue`). If the
   * same class appears more than once, a numeric suffix is appended starting at
   * `1` (`Queue`, `Queue1`, `Queue2`, …). Construct-class traits follow the
   * pattern `<primaryId>-<TraitClassName><traitIndex>`.
   *
   * **Props** — plain-object traits are shallow-merged left-to-right before the
   * construct is instantiated, so later objects override earlier ones.
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

      // Collect plain-object traits and merge them into a single props object.
      // Construct-class traits are handled separately below.
      const config = traits
        .filter((t): t is Record<string, unknown> => typeof t !== "function")
        .reduce<Record<string, unknown>>((acc, t) => ({ ...acc, ...t }), {});

      new ctor(root, entryId, config);

      // Instantiate construct-class traits as co-residents under the same root.
      // The index `j` is included in the id to prevent collisions when the same
      // trait class appears more than once for an entry.
      for (const [j, trait] of traits.entries()) {
        if (typeof trait === "function") {
          new (trait as Ctor)(root, `${entryId}-${trait.name}${j}`);
        }
      }
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
 * compose(Queue, [{ visibilityTimeout: Duration.seconds(30) }])
 *   .and(Queue, [DeadLetterAlarm])
 *   .build(this, "Messaging");
 * ```
 *
 * @param ctor - The CDK construct class to start the composition with.
 * @param traits - Traits to apply: plain objects are merged into props;
 *   construct classes become co-residents under the root scope.
 */
export function compose<P extends object>(
  ctor: Ctor<P>,
  traits: Array<Trait<P>> = [],
): Composition {
  return Composition.of(ctor, traits);
}
