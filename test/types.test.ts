import { HttpApi, type HttpApiProps, HttpStage, type HttpStageProps } from "aws-cdk-lib/aws-apigatewayv2";
import { Duration } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup, type LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { expect, test, describe } from "bun:test";
import type { Construct } from "constructs";
import { compose } from "../src/compose";
import type { PropsOf } from "../src/compose";

/**
 * Compile-time assertions for the public typing.
 *
 * `@ts-expect-error` fails the build in *both* directions: the marked line must
 * produce an error, and an unused directive is itself an error. So `tsc` passing
 * proves the good cases compile *and* the bad cases are rejected.
 */

type Expect<T extends true> = T;
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

// --- PropsOf infers the real CDK props type ---
// Required-props classes (the case a `props?:` pattern silently turns into `never`).
type _P1 = Expect<Equals<PropsOf<typeof HttpStage>, HttpStageProps>>;
// Optional-props classes, with `| undefined` stripped.
type _P2 = Expect<Equals<PropsOf<typeof Queue>, QueueProps>>;
type _P3 = Expect<Equals<PropsOf<typeof LogGroup>, LogGroupProps>>;
type _P4 = Expect<Equals<PropsOf<typeof HttpApi>, HttpApiProps>>;

// --- The native InstanceType works against the ConstructClass bound ---
declare const scope: Construct;
declare const runtimeId: string;

type _I1 = Expect<Equals<InstanceType<typeof Queue>, Queue>>;
type _I2 = Expect<Equals<InstanceType<typeof HttpStage>, HttpStage>>;

// Never executed — present only so the compiler checks it.
function _assertions() {
  // Valid props are accepted.
  compose(LogGroup, [
    { name: "ok", type: "property", value: { retention: RetentionDays.ONE_WEEK } },
  ]);

  compose(LogGroup, [
    {
      name: "misspelled-prop",
      type: "property",
      // @ts-expect-error - `retenton` is not a key of LogGroupProps
      value: { retenton: RetentionDays.ONE_WEEK },
    },
  ]);

  compose(LogGroup, [
    {
      name: "wrong-prop-type",
      type: "property",
      // @ts-expect-error - retention expects RetentionDays, not a string
      value: { retention: "one-week" },
    },
  ]);

  // Props are checked through the function form too.
  compose(LogGroup, [
    {
      name: "wrong-prop-type-via-fn",
      type: "property",
      // @ts-expect-error - `retenton` is not a key of LogGroupProps
      value: () => ({ retenton: RetentionDays.ONE_WEEK }),
    },
  ]);

  // Method names are checked against the construct's callable members.
  compose(Queue, [
    { name: "addToResourcePolicy", type: "method", args: () => [new PolicyStatement()] },
  ]);

  compose(Queue, [
    // @ts-expect-error - `addToResourcePolicee` is not a method on Queue
    { name: "addToResourcePolicee", type: "method", args: () => [new PolicyStatement()] },
  ]);

  // Method arguments are checked against the method's signature.
  compose(Queue, [
    // @ts-expect-error - addToResourcePolicy takes one argument, not zero
    { name: "addToResourcePolicy", type: "method", args: () => [] },
  ]);

  compose(Bucket, [
    // @ts-expect-error - addLifecycleRule takes a LifecycleRule
    { name: "addLifecycleRule", type: "method", args: () => [{ nonsense: true }] },
  ]);

  compose(Bucket, [
    { name: "addLifecycleRule", type: "method", args: () => [{ expiration: Duration.days(30) }] },
  ]);

  // Resources lookups are typed by class, so no casts are needed.
  compose(Queue, [
    {
      name: "typed-lookup",
      type: "property",
      value: (r) => ({ deadLetterQueue: { queue: r.of(Queue), maxReceiveCount: 3 } }),
    },
  ]);

  compose(Queue, [
    {
      name: "lookup-is-typed",
      type: "action",
      // @ts-expect-error - resources.of(Bucket) is a Bucket, which has no queueArn
      run: (_q, r) => void r.of(Bucket).queueArn,
    },
  ]);

  // get(id) is untyped; get(id, Class) is narrowed by the witness.
  compose(Queue, [
    {
      name: "get-is-untyped-without-a-witness",
      type: "action",
      // @ts-expect-error - get(id) yields Construct | undefined, which has no queueArn
      run: (_q, r) => void r.get("Queue").queueArn,
    },
  ]);

  compose(Queue, [
    {
      name: "get-with-witness-is-typed",
      type: "action",
      run: (_q, r) => void r.get("Queue", Queue)?.queueArn,
    },
  ]);

  compose(Queue, [
    {
      name: "get-witness-picks-the-class",
      type: "action",
      // @ts-expect-error - the witness is Bucket, so the result has no queueArn
      run: (_q, r) => void r.get("Queue", Bucket)?.queueArn,
    },
  ]);

  compose(Queue, [
    {
      name: "get-result-is-optional",
      type: "action",
      // @ts-expect-error - the result may be undefined; it needs narrowing first
      run: (_q, r) => void r.get("Queue", Queue).queueArn,
    },
  ]);

  // --- After build(), ids declared literally are typed and non-optional ---
  const named = compose(Queue, [], "Inbox").and(Bucket, [], "Store").build(scope, "R");
  // No `?` — the composition declared the id, so build() created it.
  const inbox = named.resources.get("Inbox");
  const store = named.resources.get("Store");
  const _named: string[] = [inbox.queueArn, store.bucketArn];
  type _G1 = Expect<Equals<typeof inbox, Queue>>;
  type _G2 = Expect<Equals<typeof store, Bucket>>;
  type _G3 = Expect<Equals<typeof unknownId, Construct | undefined>>;

  // @ts-expect-error - "Inbox" is the Queue, not the Bucket
  void named.resources.get("Inbox").bucketArn;

  const unknownId = named.resources.get("Elsewhere");
  // @ts-expect-error - an id the composition never declared stays Construct | undefined
  void unknownId.node;

  // A defaulted id is derived from the class name at runtime, so it stays untyped.
  const defaulted = compose(Queue).build(scope, "R");
  // @ts-expect-error - get("Queue") yields Construct | undefined
  void defaulted.resources.get("Queue").queueArn;

  // A non-literal id is unknowable, and must not widen every lookup to a Queue.
  const dynamic = compose(Queue, [], runtimeId).build(scope, "R");
  // @ts-expect-error - nothing was bound, so this is Construct | undefined
  void dynamic.resources.get("anything").queueArn;

  // The witness overload still wins on the two-argument call, id known or not.
  void named.resources.get("Inbox", Bucket)?.bucketArn;

  // Action traits receive the concrete construct — no cast needed.
  compose(Queue, [
    {
      name: "uses-queue-api",
      type: "action",
      run: (q) => {
        void q.queueArn;
      },
    },
  ]);

  compose(Queue, [
    {
      name: "wrong-construct-member",
      type: "action",
      // @ts-expect-error - Queue has no `bucketArn`
      run: (q) => void q.bucketArn,
    },
  ]);

  // Sibling entries added via .and() are checked against their own class.
  compose(HttpStage, [{ name: "ok", type: "property", value: { autoDeploy: true } }])
    .and(HttpApi, [{ name: "ok", type: "property", value: { createDefaultStage: false } }])
    // @ts-expect-error - `createDefaultStage` belongs to HttpApiProps, not LogGroupProps
    .and(LogGroup, [{ name: "wrong-class", type: "property", value: { createDefaultStage: false } }]);

  class NotAConstruct {
    constructor(readonly x: string) {}
  }
  // @ts-expect-error - not a Construct subclass
  compose(NotAConstruct);

  // build() hands back the constructs typed, in declaration order.
  const built = compose(Queue).and(Bucket).and(LogGroup).build(scope, "R");
  const [queue, bucket, logGroup] = built.constructs;
  const _arns: string[] = [queue.queueArn, bucket.bucketArn, logGroup.logGroupArn];
  // @ts-expect-error - the tuple has exactly three entries
  const [, , , _fourth] = built.constructs;
}

describe("types", () => {
  test("compile-time assertions hold (enforced by tsc, not at runtime)", () => {
    expect(typeof _assertions).toBe("function");
  });
});
