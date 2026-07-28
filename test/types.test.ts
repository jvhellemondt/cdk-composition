import { HttpApi, type HttpApiProps, HttpStage, type HttpStageProps } from "aws-cdk-lib/aws-apigatewayv2";
import { LogGroup, type LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { expect, test, describe } from "bun:test";
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
  compose(Queue, [{ name: "addToResourcePolicy", type: "method", args: () => [] }]);

  compose(Queue, [
    // @ts-expect-error - `addToResourcePolicee` is not a method on Queue
    { name: "addToResourcePolicee", type: "method", args: () => [] },
  ]);

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
}

describe("types", () => {
  test("compile-time assertions hold (enforced by tsc, not at runtime)", () => {
    expect(typeof _assertions).toBe("function");
  });
});
