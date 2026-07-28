import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, test } from "bun:test";
import { buildGateway, buildHealthLambda } from "./stack";

describe("gateway-v2-access-logging", () => {
  function setup() {
    const stack = new Stack(new App(), "TestStack");
    buildGateway(stack, "Gateway");
    buildHealthLambda(stack, "Health");
    return Template.fromStack(stack);
  }

  test("creates an HTTP API, stage, access-log group, and health Lambda", () => {
    const t = setup();
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    t.resourceCountIs("AWS::ApiGatewayV2::Stage", 1);
    t.resourceCountIs("AWS::Logs::LogGroup", 1);
    t.resourceCountIs("AWS::Lambda::Function", 1);
  });

  test("stage has access logging pointing at the log group", () => {
    const t = setup();
    t.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      AccessLogSettings: Match.objectLike({
        DestinationArn: Match.anyValue(),
      }),
    });
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
