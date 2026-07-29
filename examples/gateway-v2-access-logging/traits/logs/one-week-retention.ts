import { type LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { PropertyTrait } from "../../../../src";

/**
 * For: `LogGroup` (AWS::Logs::LogGroup)
 *
 * Expires access logs after a week. Without it the group retains forever,
 * which is rarely what an access log wants.
 */
export const oneWeekRetention: PropertyTrait<LogGroupProps> = {
  name: "one-week-retention",
  type: "property",
  value: { retention: RetentionDays.ONE_WEEK },
};
