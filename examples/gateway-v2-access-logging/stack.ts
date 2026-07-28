import { Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { compose } from "../../src";
import { healthHandler, healthRoute, oneWeekRetention, withAccessLogging } from "./traits";

export class GatewayStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // HttpApi creates its own $default stage; withAccessLogging points that
    // stage at the LogGroup. Both are action traits, so they run after every
    // sibling exists and declaration order does not matter here.
    compose(HttpApi, [withAccessLogging]).and(LogGroup, [oneWeekRetention]).build(this, "Gateway");

    // Independent composition — healthRoute locates the HttpApi via Stack.of().
    compose(LambdaFunction, [healthHandler, healthRoute("/health")]).build(this, "Health");
  }
}
