import { HttpApi, type HttpStageProps, LogGroupLogDestination } from "aws-cdk-lib/aws-apigatewayv2";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { PropertyTrait } from "../../../../src";

/**
 * For: `HttpStage` (AWS::ApiGatewayV2::Stage)
 *
 * Points the stage at a sibling `LogGroup` for access logs. With no explicit
 * `stageName`, `HttpStage` builds the API's `$default` stage.
 *
 * Both siblings must be declared *after* `HttpStage` in the chain: entries are
 * instantiated in reverse declaration order, and this runs during
 * instantiation. `resources.of` throws with that hint if they are not.
 */
export const withAccessLogging: PropertyTrait<HttpStageProps> = {
  name: "access-logging",
  type: "property",
  value: (resources) => ({
    httpApi: resources.of(HttpApi),
    autoDeploy: true,
    accessLogSettings: { destination: new LogGroupLogDestination(resources.of(LogGroup)) },
  }),
};
