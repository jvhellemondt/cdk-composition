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

    // Entries are instantiated in reverse declaration order, so HttpApi and
    // LogGroup exist by the time withAccessLogging resolves them.
    // HttpStage without a stageName is the API's $default stage.
    compose(HttpStage, [withAccessLogging])
      .and(HttpApi, [noDefaultStage])
      .and(LogGroup, [oneWeekRetention])
      .build(this, "Gateway");

    // Independent composition — healthRoute locates the HttpApi via Stack.of().
    compose(LambdaFunction, [healthHandler, healthRoute("/health")]).build(this, "Health");
  }
}
