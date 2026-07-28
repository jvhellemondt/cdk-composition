import { Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpStage } from "aws-cdk-lib/aws-apigatewayv2";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { compose } from "../../src";
import {
  healthHandler,
  healthRoute,
  noDefaultStage,
  oneWeekRetention,
  withAccessLogging,
} from "./traits";

export class GatewayStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    compose(HttpStage, [withAccessLogging])
      .and(HttpApi, [noDefaultStage])
      .and(LogGroup, [oneWeekRetention])
      .build(this, "Gateway");

    compose(LambdaFunction, [healthHandler, healthRoute("/health")])
      .build(this, "Health");
  }
}
