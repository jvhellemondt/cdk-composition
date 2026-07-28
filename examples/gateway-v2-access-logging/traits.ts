import { Stack } from "aws-cdk-lib";
import {
  HttpApi,
  type HttpApiProps,
  HttpMethod,
  type HttpStageProps,
  LogGroupLogDestination,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  Code,
  Function as LambdaFunction,
  type FunctionProps,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, type LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { ActionTrait, PropertyTrait } from "../../src";

// Each trait names the props type it contributes to, so values are checked
// against the real CDK props — a misspelled or mistyped prop fails to compile.
export const oneWeekRetention: PropertyTrait<LogGroupProps> = {
  name: "retention-1w",
  type: "property",
  value: { retention: RetentionDays.ONE_WEEK },
};

// Suppresses the $default stage that HttpApi creates automatically.
// Lets us attach an HttpStage with access logging in its place.
export const noDefaultStage: PropertyTrait<HttpApiProps> = {
  name: "no-default-stage",
  type: "property",
  value: { createDefaultStage: false },
};

// Function form: HttpApi and LogGroup are declared after HttpStage in the
// composition, so they are already instantiated (reverse-order phase 1) when
// this value function runs.
export const withAccessLogging: PropertyTrait<HttpStageProps> = {
  name: "access-logging",
  type: "property",
  value: (r) => ({
    httpApi: r.get("HttpApi") as HttpApi,
    autoDeploy: true,
    accessLogSettings: {
      destination: new LogGroupLogDestination(r.get("LogGroup") as LogGroup),
    },
  }),
};

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

// Locates the HttpApi anywhere in the stack so the Lambda composition stays
// self-contained — no shared state or cross-composition imports required.
export const healthRoute = (path: string): ActionTrait<LambdaFunction> => ({
  name: `health-route-${path}`,
  type: "action",
  run: (fn, _r) => {
    const api = Stack.of(fn).node
      .findAll()
      .find((c): c is HttpApi => c instanceof HttpApi);
    api?.addRoutes({
      path,
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(`${path}-integration`, fn),
    });
  },
});
