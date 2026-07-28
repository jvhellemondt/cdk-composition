import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { HttpApi, HttpStage } from "aws-cdk-lib/aws-apigatewayv2";
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

// Instantiation order (reverse declaration):
//   LogGroup → HttpApi → HttpStage
//
// By the time HttpStage's withAccessLogging trait runs, both HttpApi and
// LogGroup are already in the resources map.
export function buildGateway(scope: Construct, id: string): Construct {
  return compose(HttpStage, [withAccessLogging])
    .and(HttpApi, [noDefaultStage])
    .and(LogGroup, [oneWeekRetention])
    .build(scope, id);
}

// Independent composition — healthRoute finds the HttpApi via Stack.of()
// rather than through the resources map, so this stays self-contained.
export function buildHealthLambda(scope: Construct, id: string): Construct {
  return compose(LambdaFunction, [healthHandler, healthRoute("/health")])
    .build(scope, id);
}
