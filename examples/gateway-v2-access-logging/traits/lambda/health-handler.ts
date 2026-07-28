import { Code, type FunctionProps, Runtime } from "aws-cdk-lib/aws-lambda";
import type { PropertyTrait } from "../../../../src";

/**
 * For: `Function` (AWS::Lambda::Function)
 *
 * An inline handler returning `{ status: "ok" }`.
 */
export const healthHandler: PropertyTrait<FunctionProps> = {
  name: "health-handler",
  type: "property",
  value: {
    runtime: Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: Code.fromInline(
      "exports.handler = async () => ({ statusCode: 200, body: JSON.stringify({ status: 'ok' }) });",
    ),
  },
};
