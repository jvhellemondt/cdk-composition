import { App, Duration, Stack } from "aws-cdk-lib";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AnyPrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { describe, expect, test } from "bun:test";
import { Composition, compose } from "../src/compose";
import type { ActionTrait, Resources } from "../src/compose";

function stack() {
  return new Stack(new App(), "Stack");
}

function statement() {
  return new PolicyStatement({
    actions: ["sqs:SendMessage"],
    principals: [new AnyPrincipal()],
    resources: ["*"],
  });
}

describe("compose", () => {
  test("creates all declared constructs under a shared root", () => {
    const s = stack();
    compose(Queue).and(Bucket).build(s, "Service");
    const t = Template.fromStack(s);
    t.resourceCountIs("AWS::SQS::Queue", 1);
    t.resourceCountIs("AWS::S3::Bucket", 1);
  });

  test("property traits are merged into props", () => {
    const s = stack();
    compose(Queue, [
      { name: "visibility", type: "property", value: { visibilityTimeout: Duration.seconds(60) } },
    ]).build(s, "Service");
    Template.fromStack(s).hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 60,
    });
  });

  test("later property traits win on key collisions", () => {
    const s = stack();
    compose(Queue, [
      { name: "first", type: "property", value: { visibilityTimeout: Duration.seconds(30) } },
      { name: "second", type: "property", value: { visibilityTimeout: Duration.seconds(60) } },
    ]).build(s, "Service");
    Template.fromStack(s).hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 60,
    });
  });

  test("property trait value may be a function", () => {
    const s = stack();
    compose(Queue, [
      {
        name: "visibility",
        type: "property",
        value: (_r) => ({ visibilityTimeout: Duration.seconds(90) }),
      },
    ]).build(s, "Service");
    Template.fromStack(s).hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 90,
    });
  });

  test("property trait value function receives later-declared siblings in the resources map", () => {
    const s = stack();
    let resolvedBucket: unknown;

    compose(Queue, [
      {
        name: "peer",
        type: "property",
        value: (r) => {
          resolvedBucket = r.get("Bucket");
          return {};
        },
      },
    ])
      .and(Bucket)
      .build(s, "Service");

    expect(resolvedBucket).toBeInstanceOf(Bucket);
  });

  test("method traits call the named method with resolved args", () => {
    const s = stack();
    compose(Bucket, [
      {
        name: "addLifecycleRule",
        type: "method",
        args: (_r) => [{ expiration: Duration.days(30) }],
      },
    ]).build(s, "Service");
    Template.fromStack(s).hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ Status: "Enabled" })]),
      },
    });
  });

  test("method traits receive a resources lookup covering every sibling", () => {
    const s = stack();
    let captured: Resources | undefined;

    compose(Queue, [
      {
        name: "addToResourcePolicy",
        type: "method",
        args: (resources) => {
          captured = resources;
          return [statement()];
        },
      },
    ])
      .and(Bucket)
      .build(s, "Service");

    expect(captured?.has("Queue")).toBe(true);
    expect(captured?.has("Bucket")).toBe(true);
    expect(captured?.of(Bucket)).toBeInstanceOf(Bucket);
  });

  test("method traits are applied latest-first", () => {
    const s = stack();
    const order: number[] = [];

    compose(Queue, [
      {
        name: "addToResourcePolicy",
        type: "method",
        args: (_r) => {
          order.push(1);
          return [statement()];
        },
      },
    ])
      .and(Bucket, [
        {
          name: "addToResourcePolicy",
          type: "method",
          args: (_r) => {
            order.push(2);
            return [statement()];
          },
        },
      ])
      .build(s, "Service");

    // Bucket (.and second) should run before Queue (compose first).
    expect(order).toEqual([2, 1]);
  });

  test("action traits run with the construct and full resources map", () => {
    const s = stack();
    let capturedConstruct: unknown;
    let capturedResources: Resources | undefined;

    const inspect: ActionTrait = {
      name: "inspect-queue",
      type: "action",
      run: (c, r) => {
        capturedConstruct = c;
        capturedResources = r;
      },
    };

    compose(Queue, [inspect]).and(Bucket).build(s, "Service");

    expect(capturedConstruct).toBeInstanceOf(Queue);
    expect(capturedResources?.has("Queue")).toBe(true);
    expect(capturedResources?.has("Bucket")).toBe(true);
  });

  test("action traits fire latest-first alongside method traits", () => {
    const s = stack();
    const order: number[] = [];

    compose(Queue, [
      {
        name: "addToResourcePolicy",
        type: "method",
        args: (_r) => { order.push(1); return [statement()]; },
      },
    ])
      .and(Bucket, [
        {
          name: "inspect-bucket",
          type: "action",
          run: (_c, _r) => { order.push(2); },
        },
      ])
      .build(s, "Service");

    expect(order).toEqual([2, 1]);
  });

  test("and() is immutable — returns a new Composition each time", () => {
    const a = compose(Queue);
    const b = a.and(Bucket);
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(Composition);
    expect(b).toBeInstanceOf(Composition);
  });

  test("multiple and() calls each add a sibling", () => {
    const s = stack();
    compose(Queue).and(Queue).and(Bucket).build(s, "Service");
    const t = Template.fromStack(s);
    t.resourceCountIs("AWS::SQS::Queue", 2);
    t.resourceCountIs("AWS::S3::Bucket", 1);
  });
});

describe("compose — ids", () => {
  test("resolves CDK class names through jsii, not the bundled class name", () => {
    const s = stack();
    const { resources } = compose(Queue).and(Bucket).build(s, "Service");
    // aws-cdk-lib is bundled: Queue.name is "Queue2" at runtime.
    expect(resources.has("Queue")).toBe(true);
    expect(resources.has("Bucket")).toBe(true);
  });

  test("keeps user construct names that end in a digit", () => {
    class ServiceV2 extends Construct {}
    class Layer3 extends Construct {}
    const s = stack();
    const { resources } = compose(ServiceV2).and(Layer3).build(s, "Service");
    expect(resources.has("ServiceV2")).toBe(true);
    expect(resources.has("Layer3")).toBe(true);
  });

  test("suffixes repeats of the same class", () => {
    const s = stack();
    const { resources } = compose(Queue).and(Queue).and(Queue).build(s, "Service");
    expect(["Queue", "Queue1", "Queue2"].every((id) => resources.has(id))).toBe(true);
  });

  test("accepts an explicit id", () => {
    const s = stack();
    const { resources } = compose(Queue, [], "Inbox").and(Queue, [], "Outbox").build(s, "Service");
    expect(resources.has("Inbox")).toBe(true);
    expect(resources.has("Outbox")).toBe(true);
  });

  test("rejects colliding ids", () => {
    const s = stack();
    expect(() => compose(Queue, [], "Same").and(Bucket, [], "Same").build(s, "Service")).toThrow(
      /Duplicate ids/,
    );
  });
});

describe("compose — resources lookup", () => {
  test("of() returns the construct typed", () => {
    const s = stack();
    let found: Bucket | undefined;
    compose(Queue, [{ name: "peek", type: "action", run: (_q, r) => void (found = r.of(Bucket)) }])
      .and(Bucket)
      .build(s, "Service");
    expect(found).toBeInstanceOf(Bucket);
  });

  test("of() throws with an ordering hint when a sibling is not yet built", () => {
    const s = stack();
    expect(() =>
      compose(Bucket)
        .and(Queue, [
          {
            name: "early",
            type: "property",
            value: (r) => {
              r.of(Bucket);
              return {};
            },
          },
        ])
        .build(s, "Service"),
    ).toThrow(/reverse declaration order/);
  });

  test("of() throws when the class is absent entirely", () => {
    const s = stack();
    expect(() =>
      compose(Queue, [{ name: "missing", type: "action", run: (_q, r) => void r.of(Bucket) }]).build(
        s,
        "Service",
      ),
    ).toThrow(/No Bucket in this composition/);
  });

  test("of() throws when ambiguous, all() returns both", () => {
    const s = stack();
    let count = 0;
    compose(Bucket, [
      {
        name: "count",
        type: "action",
        run: (_b, r) => {
          count = r.all(Queue).length;
          expect(() => r.of(Queue)).toThrow(/Ambiguous/);
        },
      },
    ])
      .and(Queue)
      .and(Queue)
      .build(s, "Service");
    expect(count).toBe(2);
  });
});

describe("compose — prop merging", () => {
  test("deep-merges plain objects from sibling traits", () => {
    const s = stack();
    compose(LambdaFunction, [
      { name: "base", type: "property", value: () => ({
          runtime: Runtime.NODEJS_24_X,
          handler: "index.handler",
          code: Code.fromInline("exports.handler = async () => {};"),
          environment: { A: "1" },
        }) },
      { name: "more-env", type: "property", value: { environment: { B: "2" } } },
    ]).build(s, "Service");
    Template.fromStack(s).hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { A: "1", B: "2" } },
    });
  });

  test("replaces class instances rather than merging them", () => {
    const s = stack();
    compose(Queue, [
      { name: "a", type: "property", value: { visibilityTimeout: Duration.seconds(30) } },
      { name: "b", type: "property", value: { visibilityTimeout: Duration.seconds(60) } },
    ]).build(s, "Service");
    Template.fromStack(s).hasResourceProperties("AWS::SQS::Queue", { VisibilityTimeout: 60 });
  });
});

describe("compose — build result", () => {
  test("returns the constructs typed and in declaration order", () => {
    const s = stack();
    const { root, constructs } = compose(Queue).and(Bucket).build(s, "Service");
    const [queue, bucket] = constructs;
    expect(queue).toBeInstanceOf(Queue);
    expect(bucket).toBeInstanceOf(Bucket);
    expect(queue.queueArn).toBeDefined();
    expect(root.node.id).toBe("Service");
  });
});

describe("compose — method dispatch", () => {
  test("throws a clear error when the method is missing at runtime", () => {
    const s = stack();
    const bogus = { name: "nope", type: "method" as const, args: () => [] };
    expect(() =>
      compose(Queue, [bogus as unknown as ActionTrait<Queue>]).build(s, "Service"),
    ).toThrow(/is not a function on/);
  });
});
