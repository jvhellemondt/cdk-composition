import type { HttpApiProps } from "aws-cdk-lib/aws-apigatewayv2";
import type { PropertyTrait } from "../../../../src";

/**
 * For: `HttpApi` (AWS::ApiGatewayV2::Api)
 *
 * Suppresses the stage `HttpApi` would create on its own, leaving the
 * composition's `HttpStage` to be the `$default` stage instead.
 */
export const noDefaultStage: PropertyTrait<HttpApiProps> = {
  name: "no-default-stage",
  type: "property",
  value: { createDefaultStage: false },
};
