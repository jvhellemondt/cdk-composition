import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { describe, expect, test } from "bun:test";
import { Composition, compose } from "../src/compose";

function stack() {
  return new Stack(new App(), "Stack");
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

  test("method traits receive the resources map keyed by class name", () => {
    const s = stack();
    let captured: Map<string, unknown> | undefined;

    compose(Queue, [
      {
        name: "addToResourcePolicy",
        type: "method",
        args: (resources) => {
          captured = resources as Map<string, unknown>;
          return [{ addStatements: () => {} }];
        },
      },
    ])
      .and(Bucket)
      .build(s, "Service");

    expect(captured).toBeInstanceOf(Map);
    expect(captured?.has("Queue")).toBe(true);
    expect(captured?.has("Bucket")).toBe(true);
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
          return [{ addStatements: () => {} }];
        },
      },
    ])
      .and(Bucket, [
        {
          name: "addToResourcePolicy",
          type: "method",
          args: (_r) => {
            order.push(2);
            return [{ addStatements: () => {} }];
          },
        },
      ])
      .build(s, "Service");

    // Bucket (.and second) should run before Queue (compose first).
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
