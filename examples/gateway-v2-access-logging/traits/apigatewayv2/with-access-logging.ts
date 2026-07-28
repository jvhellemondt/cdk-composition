import { HttpApi, type HttpStageProps, LogGroupLogDestination } from "aws-cdk-lib/aws-apigatewayv2";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { PropertyTrait } from "../../../../src";

/**
 * For: `HttpStage` (AWS::ApiGatewayV2::Stage)
 *
 * Points the stage at a sibling `LogGroup` for access logs. With no explicit
 * `stageName`, `HttpStage` builds the API's `$default` stage.
 *
 * Resolves both siblings from the resources map, so they must be declared
 * *after* `HttpStage` in the chain — entries are instantiated in reverse
 * declaration order, and this runs during instantiation.
 */
export const withAccessLogging: PropertyTrait<HttpStageProps> = {
  name: "access-logging",
  type: "property",
  value: (resources) => {
    const siblings = [...resources.values()];
    const httpApi = siblings.find((c): c is HttpApi => c instanceof HttpApi);
    const logGroup = siblings.find((c): c is LogGroup => c instanceof LogGroup);

    if (!httpApi) {
      throw new Error("withAccessLogging expects an HttpApi declared after HttpStage");
    }
    if (!logGroup) {
      throw new Error("withAccessLogging expects a LogGroup declared after HttpStage");
    }

    return {
      httpApi,
      autoDeploy: true,
      accessLogSettings: { destination: new LogGroupLogDestination(logGroup) },
    };
  },
};
