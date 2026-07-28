import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
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

  test("access logging is attached to the API's own $default stage", () => {
    const t = setup();
    t.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      AccessLogSettings: Match.objectLike({
        DestinationArn: Match.anyValue(),
        Format: Match.anyValue(),
      }),
    });
  });

  test("the API keeps its default stage, so url and defaultStage resolve", () => {
    const stack = new GatewayStack(new App(), "TestStack");
    const api = stack.node.findAll().find((c): c is HttpApi => c instanceof HttpApi);
    expect(api?.defaultStage).toBeDefined();
    expect(api?.url).toBeDefined();
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
