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

    for (const [i, { ctor, traits }] of this.#entries.entries()) {
      const config = traits
        .filter((t): t is Record<string, unknown> => typeof t !== "function")
        .reduce<Record<string, unknown>>((acc, t) => ({ ...acc, ...t }), {});

      const host = new Construct(root, String(i));
      new ctor(host, "Default", config);

      for (const trait of traits) {
        if (typeof trait === "function") {
          new (trait as Ctor)(host, trait.name);
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
