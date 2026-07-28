import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import { CfnStage, type HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { ActionTrait } from "../../../../src";

/**
 * For: `HttpApi` (AWS::ApiGatewayV2::Api)
 *
 * Sends access logs from the API's own `$default` stage to a `LogGroup`
 * declared as a sibling in the same composition.
 *
 * `HttpApiProps` has no access-logging option and `IHttpStage` exposes no L2
 * setter for it, so this reaches the underlying `CfnStage`. That escape hatch
 * is deliberately confined to this one trait.
 */
export const withAccessLogging: ActionTrait<HttpApi> = {
  name: "access-logging",
  type: "action",
  run: (api, resources) => {
    const logGroup = [...resources.values()].find((c): c is LogGroup => c instanceof LogGroup);
    if (!logGroup) {
      throw new Error("withAccessLogging expects a LogGroup sibling in the composition");
    }

    const stage = api.defaultStage?.node.defaultChild as CfnStage | undefined;
    if (!stage) {
      throw new Error("withAccessLogging expects the HttpApi to create its default stage");
    }

    stage.accessLogSettings = {
      destinationArn: logGroup.logGroupArn,
      format: AccessLogFormat.jsonWithStandardFields().toString(),
    };
  },
};
