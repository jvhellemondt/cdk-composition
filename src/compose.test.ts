import { App, Duration, Stack } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AnyPrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Composition, compose, type ActionTrait, type Resources } from './compose';

function stack() {
  return new Stack(new App(), 'Stack');
}

function statement() {
  return new PolicyStatement({
    actions: ['sqs:SendMessage'],
    principals: [new AnyPrincipal()],
    resources: ['*'],
  });
}

describe('compose', () => {
  test('creates all declared constructs under a shared root', () => {
    const s = stack();
    compose(Queue).and(Bucket).build(s, 'Service');
    const t = Template.fromStack(s);
    t.resourceCountIs('AWS::SQS::Queue', 1);
    t.resourceCountIs('AWS::S3::Bucket', 1);
  });

  test('property traits are merged into props', () => {
    const s = stack();
    compose(Queue, [
      { name: 'visibility', type: 'property', value: { visibilityTimeout: Duration.seconds(60) } },
    ]).build(s, 'Service');
    Template.fromStack(s).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 60,
    });
  });

  test('later property traits win on key collisions', () => {
    const s = stack();
    compose(Queue, [
      { name: 'first', type: 'property', value: { visibilityTimeout: Duration.seconds(30) } },
      { name: 'second', type: 'property', value: { visibilityTimeout: Duration.seconds(60) } },
    ]).build(s, 'Service');
    Template.fromStack(s).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 60,
    });
  });

  test('property trait value may be a function', () => {
    const s = stack();
    compose(Queue, [
      {
        name: 'visibility',
        type: 'property',
        value: (_r) => ({ visibilityTimeout: Duration.seconds(90) }),
      },
    ]).build(s, 'Service');
    Template.fromStack(s).hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 90,
    });
  });

  test('property trait value function resolves a sibling declared after it', () => {
    const s = stack();
    let resolvedBucket: unknown;

    compose(Queue, [
      {
        name: 'peer',
        type: 'property',
        value: (r) => {
          resolvedBucket = r.get('Bucket');
          return {};
        },
      },
    ])
      .and(Bucket)
      .build(s, 'Service');

    expect(resolvedBucket).toBeInstanceOf(Bucket);
  });

  test('property trait value function resolves a sibling declared before it', () => {
    const s = stack();
    let resolvedBucket: unknown;

    compose(Bucket)
      .and(Queue, [
        {
          name: 'peer',
          type: 'property',
          value: (r) => {
            resolvedBucket = r.get('Bucket');
            return {};
          },
        },
      ])
      .build(s, 'Service');

    expect(resolvedBucket).toBeInstanceOf(Bucket);
  });

  test('method traits call the named method with resolved args', () => {
    const s = stack();
    compose(Bucket, [
      {
        name: 'addLifecycleRule',
        type: 'method',
        args: (_r) => [{ expiration: Duration.days(30) }],
      },
    ]).build(s, 'Service');
    Template.fromStack(s).hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ Status: 'Enabled' })]),
      },
    });
  });

  test('method traits receive a resources lookup covering every sibling', () => {
    const s = stack();
    let captured: Resources | undefined;

    compose(Queue, [
      {
        name: 'addToResourcePolicy',
        type: 'method',
        args: (resources) => {
          captured = resources;
          return [statement()];
        },
      },
    ])
      .and(Bucket)
      .build(s, 'Service');

    expect(captured?.has('Queue')).toBe(true);
    expect(captured?.has('Bucket')).toBe(true);
    expect(captured?.of(Bucket)).toBeInstanceOf(Bucket);
  });

  test('method traits are applied in declaration order', () => {
    const s = stack();
    const order: number[] = [];

    compose(Queue, [
      {
        name: 'addToResourcePolicy',
        type: 'method',
        args: (_r) => {
          order.push(1);
          return [statement()];
        },
      },
    ])
      .and(Bucket, [
        {
          name: 'addToResourcePolicy',
          type: 'method',
          args: (_r) => {
            order.push(2);
            return [statement()];
          },
        },
      ])
      .build(s, 'Service');

    // Queue (compose first) should run before Bucket (.and second).
    expect(order).toEqual([1, 2]);
  });

  test('action traits run with the construct and full resources map', () => {
    const s = stack();
    let capturedConstruct: unknown;
    let capturedResources: Resources | undefined;

    const inspect: ActionTrait = {
      name: 'inspect-queue',
      type: 'action',
      run: (c, r) => {
        capturedConstruct = c;
        capturedResources = r;
      },
    };

    compose(Queue, [inspect]).and(Bucket).build(s, 'Service');

    expect(capturedConstruct).toBeInstanceOf(Queue);
    expect(capturedResources?.has('Queue')).toBe(true);
    expect(capturedResources?.has('Bucket')).toBe(true);
  });

  test('action traits fire in declaration order alongside method traits', () => {
    const s = stack();
    const order: number[] = [];

    compose(Queue, [
      {
        name: 'addToResourcePolicy',
        type: 'method',
        args: (_r) => {
          order.push(1);
          return [statement()];
        },
      },
    ])
      .and(Bucket, [
        {
          name: 'inspect-bucket',
          type: 'action',
          run: (_c, _r) => {
            order.push(2);
          },
        },
      ])
      .build(s, 'Service');

    expect(order).toEqual([1, 2]);
  });

  test('and() is immutable — returns a new Composition each time', () => {
    const a = compose(Queue);
    const b = a.and(Bucket);
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(Composition);
    expect(b).toBeInstanceOf(Composition);
  });

  test('multiple and() calls each add a sibling', () => {
    const s = stack();
    compose(Queue).and(Queue).and(Bucket).build(s, 'Service');
    const t = Template.fromStack(s);
    t.resourceCountIs('AWS::SQS::Queue', 2);
    t.resourceCountIs('AWS::S3::Bucket', 1);
  });
});

describe('compose — ids', () => {
  test('resolves CDK class names through jsii, not the bundled class name', () => {
    const s = stack();
    const { resources } = compose(Queue).and(Bucket).build(s, 'Service');
    // aws-cdk-lib is bundled: Queue.name is "Queue2" at runtime.
    expect(resources.has('Queue')).toBe(true);
    expect(resources.has('Bucket')).toBe(true);
  });

  test('keeps user construct names that end in a digit', () => {
    class ServiceV2 extends Construct {}
    class Layer3 extends Construct {}
    const s = stack();
    const { resources } = compose(ServiceV2).and(Layer3).build(s, 'Service');
    expect(resources.has('ServiceV2')).toBe(true);
    expect(resources.has('Layer3')).toBe(true);
  });

  test('suffixes repeats of the same class', () => {
    const s = stack();
    const { resources } = compose(Queue).and(Queue).and(Queue).build(s, 'Service');
    expect(['Queue', 'Queue1', 'Queue2'].every((id) => resources.has(id))).toBe(true);
  });

  test('accepts an explicit id', () => {
    const s = stack();
    const { resources } = compose(Queue, [], 'Inbox').and(Queue, [], 'Outbox').build(s, 'Service');
    expect(resources.has('Inbox')).toBe(true);
    expect(resources.has('Outbox')).toBe(true);
  });

  test('rejects colliding ids', () => {
    const s = stack();
    expect(() => compose(Queue, [], 'Same').and(Bucket, [], 'Same').build(s, 'Service')).toThrow(
      /Duplicate ids/
    );
  });

  test('rejects ids that would shadow a fixed member of the build result', () => {
    const s = stack();
    for (const reserved of ['root', 'constructs', 'resources']) {
      expect(() => compose(Queue, [], reserved).build(s, `Service${reserved}`)).toThrow(
        /Reserved ids/
      );
    }
  });
});

describe('compose — resources lookup', () => {
  test('of() returns the construct typed', () => {
    const s = stack();
    let found: Bucket | undefined;
    compose(Queue, [{ name: 'peek', type: 'action', run: (_q, r) => void (found = r.of(Bucket)) }])
      .and(Bucket)
      .build(s, 'Service');
    expect(found).toBeInstanceOf(Bucket);
  });

  test('of() throws when the class is absent entirely', () => {
    const s = stack();
    expect(() =>
      compose(Queue, [
        { name: 'missing', type: 'action', run: (_q, r) => void r.of(Bucket) },
      ]).build(s, 'Service')
    ).toThrow(/No Bucket in this composition/);
  });

  test('of() throws when ambiguous, all() returns both', () => {
    const s = stack();
    let count = 0;
    compose(Bucket, [
      {
        name: 'count',
        type: 'action',
        run: (_b, r) => {
          count = r.all(Queue).length;
          expect(() => r.of(Queue)).toThrow(/Ambiguous/);
        },
      },
    ])
      .and(Queue)
      .and(Queue)
      .build(s, 'Service');
    expect(count).toBe(2);
  });

  test('values() returns every construct in declaration order', () => {
    const s = stack();
    const { resources, constructs } = compose(Queue, [], 'Inbox')
      .and(Bucket, [], 'Store')
      .build(s, 'Service');
    expect(resources.values()).toEqual([...constructs]);
  });

  test('values() from a property trait is a cycle — it asks for the entry being built', () => {
    const s = stack();
    expect(() =>
      compose(Queue, [
        {
          name: 'sweep',
          type: 'property',
          value: (r) => {
            r.values();
            return {};
          },
        },
      ])
        .and(Bucket)
        .build(s, 'Service')
    ).toThrow(/Cyclic property dependency: Queue → Queue/);
  });

  test('get() returns the construct under an id', () => {
    const s = stack();
    const { resources } = compose(Queue, [], 'Inbox').build(s, 'Service');
    expect(resources.get('Inbox')).toBeInstanceOf(Queue);
    expect(resources.get('Nope')).toBeUndefined();
  });

  test('get() narrows to the witness class', () => {
    const s = stack();
    const { resources } = compose(Queue, [], 'Inbox').and(Bucket, [], 'Store').build(s, 'Service');
    expect(resources.get('Inbox', Queue)).toBeInstanceOf(Queue);
    expect(resources.get('Store', Bucket)).toBeInstanceOf(Bucket);
  });

  test('get() with a witness treats a class mismatch as a miss', () => {
    const s = stack();
    const { resources } = compose(Queue, [], 'Inbox').build(s, 'Service');
    expect(resources.get('Inbox', Bucket)).toBeUndefined();
    expect(resources.get('Nope', Queue)).toBeUndefined();
  });

  test('get() witnesses accept a base class', () => {
    class ServiceV2 extends Construct {}
    const s = stack();
    const { resources } = compose(ServiceV2).build(s, 'Service');
    expect(resources.get('ServiceV2', Construct)).toBeInstanceOf(ServiceV2);
  });
});

describe('compose — instantiation order', () => {
  /** Ids of the root's children, which CDK holds in creation order. */
  const created = (root: Construct) => root.node.children.map((c) => c.node.id);

  /** Resolves the composition's Bucket, contributing nothing to the props. */
  const readsBucket = {
    name: 'reads-bucket',
    type: 'property' as const,
    value: (r: Resources) => {
      r.of(Bucket);
      return {};
    },
  };

  test('a resolved sibling is created first, whichever side declares it', () => {
    const before = compose(Bucket, [], 'B')
      .and(Queue, [readsBucket], 'Q')
      .build(stack(), 'Service');
    const after = compose(Queue, [readsBucket], 'Q').and(Bucket, [], 'B').build(stack(), 'Service');

    expect(created(before.root)).toEqual(['B', 'Q']);
    expect(created(after.root)).toEqual(['B', 'Q']);
  });

  test('entries no trait resolves are still created, in declaration order', () => {
    const { root } = compose(Queue, [], 'First')
      .and(Queue, [readsBucket], 'Second')
      .and(Bucket, [], 'Store')
      .and(Queue, [], 'Last')
      .build(stack(), 'Service');

    expect(created(root)).toEqual(['First', 'Store', 'Second', 'Last']);
  });

  test('an entry resolved more than once is created once', () => {
    const s = stack();
    const seen: unknown[] = [];
    const capture = {
      name: 'capture-bucket',
      type: 'property' as const,
      value: (r: Resources) => {
        seen.push(r.of(Bucket));
        return {};
      },
    };

    const { Store } = compose(Queue, [capture, capture], 'Q')
      .and(Queue, [capture], 'Q2')
      .and(Bucket, [], 'Store')
      .build(s, 'Service');

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(Store);
    Template.fromStack(s).resourceCountIs('AWS::S3::Bucket', 1);
  });

  test('declaration order does not change the synthesised template', () => {
    // Logical ids derive from the construct path, not from creation order.
    const first = stack();
    const second = stack();

    compose(Queue, [readsBucket], 'Q').and(Bucket, [], 'B').build(first, 'Service');
    compose(Bucket, [], 'B').and(Queue, [readsBucket], 'Q').build(second, 'Service');

    expect(Template.fromStack(first).toJSON()).toEqual(Template.fromStack(second).toJSON());
  });

  test('constructs and the id-keyed result stay in declaration order', () => {
    const built = compose(Queue, [readsBucket], 'Q').and(Bucket, [], 'B').build(stack(), 'Service');
    const [first, second] = built.constructs;

    expect(first).toBeInstanceOf(Queue);
    expect(second).toBeInstanceOf(Bucket);
    expect(built.Q).toBe(first);
    expect(built.B).toBe(second);
  });

  test('property traits that resolve each other are reported as a cycle', () => {
    const readsQueue = {
      name: 'reads-queue',
      type: 'property' as const,
      value: (r: Resources) => {
        r.of(Queue);
        return {};
      },
    };

    expect(() =>
      compose(Queue, [readsBucket], 'A').and(Bucket, [readsQueue], 'B').build(stack(), 'Service')
    ).toThrow(/Cyclic property dependency: A → B → A/);
  });

  test('a property trait resolving its own entry is reported as a cycle', () => {
    expect(() => compose(Bucket, [readsBucket], 'Self').build(stack(), 'Service')).toThrow(
      /Cyclic property dependency: Self → Self/
    );
  });

  test('ambiguity is detected from a property trait, not masked by order', () => {
    expect(() =>
      compose(Queue, [readsBucket], 'Q')
        .and(Bucket, [], 'One')
        .and(Bucket, [], 'Two')
        .build(stack(), 'Service')
    ).toThrow(/Ambiguous resources.of\(Bucket\)/);
  });
});

describe('compose — prop merging', () => {
  test('deep-merges plain objects from sibling traits', () => {
    const s = stack();
    compose(LambdaFunction, [
      {
        name: 'base',
        type: 'property',
        value: () => ({
          runtime: Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: Code.fromInline('exports.handler = async () => {};'),
          environment: { A: '1' },
        }),
      },
      { name: 'more-env', type: 'property', value: { environment: { B: '2' } } },
    ]).build(s, 'Service');
    Template.fromStack(s).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { A: '1', B: '2' } },
    });
  });

  test('replaces class instances rather than merging them', () => {
    const s = stack();
    compose(Queue, [
      { name: 'a', type: 'property', value: { visibilityTimeout: Duration.seconds(30) } },
      { name: 'b', type: 'property', value: { visibilityTimeout: Duration.seconds(60) } },
    ]).build(s, 'Service');
    Template.fromStack(s).hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 60 });
  });
});

describe('compose — build result', () => {
  test('returns the constructs typed and in declaration order', () => {
    const s = stack();
    const { root, constructs } = compose(Queue).and(Bucket).build(s, 'Service');
    const [queue, bucket] = constructs;
    expect(queue).toBeInstanceOf(Queue);
    expect(bucket).toBeInstanceOf(Bucket);
    expect(queue.queueArn).toBeDefined();
    expect(root.node.id).toBe('Service');
  });

  test('returns each construct under its own id', () => {
    const s = stack();
    const { Inbox, Store } = compose(Queue, [], 'Inbox')
      .and(Bucket, [], 'Store')
      .build(s, 'Service');
    expect(Inbox).toBeInstanceOf(Queue);
    expect(Store).toBeInstanceOf(Bucket);
    expect(Inbox.queueArn).toBeDefined();
    expect(Store.bucketArn).toBeDefined();
  });

  test('keys defaulted ids too, including the suffix on repeats', () => {
    const s = stack();
    const built: Record<string, unknown> = compose(Queue)
      .and(Queue)
      .and(Bucket)
      .build(s, 'Service');
    expect(Object.keys(built).toSorted()).toEqual([
      'Bucket',
      'Queue',
      'Queue1',
      'constructs',
      'resources',
      'root',
    ]);
    expect(built.Queue1).toBeInstanceOf(Queue);
  });

  test('the named entries are the same instances as constructs and resources', () => {
    const s = stack();
    const built = compose(Queue, [], 'Inbox').and(Bucket, [], 'Store').build(s, 'Service');
    const [queue, bucket] = built.constructs;
    expect(built.Inbox).toBe(queue);
    expect(built.Store).toBe(bucket);
    expect(built.Inbox).toBe(built.resources.get('Inbox'));
  });
});

describe('compose — method dispatch', () => {
  test('throws a clear error when the method is missing at runtime', () => {
    const s = stack();
    const bogus = { name: 'nope', type: 'method' as const, args: () => [] };
    expect(() =>
      compose(Queue, [bogus as unknown as ActionTrait<Queue>]).build(s, 'Service')
    ).toThrow(/is not a function on/);
  });
});
