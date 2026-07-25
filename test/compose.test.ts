import { App, Duration, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
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

  test("method traits are accepted but not yet applied", () => {
    const s = stack();
    compose(Queue, [{ name: "grant", type: "method", args: [] }]).build(s, "Service");
    Template.fromStack(s).resourceCountIs("AWS::SQS::Queue", 1);
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
