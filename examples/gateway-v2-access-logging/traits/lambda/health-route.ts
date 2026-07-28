import { Stack } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import type { ActionTrait } from "../../../../src";

/**
 * For: `Function` (AWS::Lambda::Function)
 *
 * Registers `GET {path}` on the `HttpApi` found in the surrounding stack, so
 * the Lambda composition needs no reference to the gateway composition.
 */
export const healthRoute = (path: string): ActionTrait<LambdaFunction> => ({
  name: `health-route-${path}`,
  type: "action",
  run: (fn) => {
    const api = Stack.of(fn)
      .node.findAll()
      .find((c): c is HttpApi => c instanceof HttpApi);
    api?.addRoutes({
      path,
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(`${path}-integration`, fn),
    });
  },
});
