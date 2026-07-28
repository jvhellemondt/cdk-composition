// Traits are grouped by the AWS resource they apply to.
export { noDefaultStage } from "./apigatewayv2/no-default-stage";
export { withAccessLogging } from "./apigatewayv2/with-access-logging";
export { healthHandler } from "./lambda/health-handler";
export { healthRoute } from "./lambda/health-route";
export { oneWeekRetention } from "./logs/one-week-retention";
