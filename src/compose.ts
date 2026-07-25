import { Construct } from "constructs";

type Ctor<P extends object = object> = new (scope: Construct, id: string, props?: P) => Construct;

// A trait is either a construct class (becomes a co-resident in the same host scope)
// or a plain object (merged into the primary construct's props).
export type Trait<P extends object = object> = Ctor | Partial<P>;

interface Entry {
  readonly ctor: Ctor;
  readonly traits: ReadonlyArray<Trait>;
}

export class Composition {
  readonly #entries: ReadonlyArray<Entry>;

  private constructor(entries: ReadonlyArray<Entry>) {
    this.#entries = entries;
  }

  static of<P extends object>(ctor: Ctor<P>, traits: Array<Trait<P>> = []): Composition {
    return new Composition([{ ctor: ctor as Ctor, traits }]);
  }

  and<P extends object>(ctor: Ctor<P>, traits: Array<Trait<P>> = []): Composition {
    return new Composition([...this.#entries, { ctor: ctor as Ctor, traits }]);
  }

  build(scope: Construct, id: string): Construct {
    const root = new Construct(scope, id);
    const seen = new Map<Ctor, number>();

    for (const { ctor, traits } of this.#entries) {
      const count = seen.get(ctor) ?? 0;
      seen.set(ctor, count + 1);
      const entryId = count === 0 ? ctor.name : `${ctor.name}${count}`;

      const config = traits
        .filter((t): t is Record<string, unknown> => typeof t !== "function")
        .reduce<Record<string, unknown>>((acc, t) => ({ ...acc, ...t }), {});

      new ctor(root, entryId, config);

      for (const [j, trait] of traits.entries()) {
        if (typeof trait === "function") {
          new (trait as Ctor)(root, `${entryId}-${trait.name}${j}`);
        }
      }
    }

    return root;
  }
}

export function compose<P extends object>(
  ctor: Ctor<P>,
  traits: Array<Trait<P>> = [],
): Composition {
  return Composition.of(ctor, traits);
}
