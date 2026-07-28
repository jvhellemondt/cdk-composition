import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "bun:test";
import { GatewayStack } from "./stack";

describe("gateway-v2-access-logging", () => {
  function setup() {
    return Template.fromStack(new GatewayStack(new App(), "TestStack"));
  }

  test("creates an HTTP API, stage, access-log group, and health Lambda", () => {
    const t = setup();
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    t.resourceCountIs("AWS::ApiGatewayV2::Stage", 1);
    t.resourceCountIs("AWS::Logs::LogGroup", 1);
    t.resourceCountIs("AWS::Lambda::Function", 1);
  });

  test("access logging is attached to the $default stage", () => {
    const t = setup();
    t.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      AccessLogSettings: Match.objectLike({
        DestinationArn: Match.anyValue(),
        Format: Match.anyValue(),
      }),
    });
  });

  test("the health handler runs the latest Node runtime as an ES module", () => {
    const t = setup();
    t.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Handler: "index.handler",
    });
    const asset = readFileSync(
      new URL("./handlers/health/index.mjs", import.meta.url),
      "utf8",
    );
    expect(asset).toContain("export const handler");
  });

  test("stage auto-deploys", () => {
    const t = setup();
    t.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      AutoDeploy: true,
    });
  });

  test("GET /health route is registered", () => {
    const t = setup();
    t.resourceCountIs("AWS::ApiGatewayV2::Route", 1);
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /health",
    });
  });
});
