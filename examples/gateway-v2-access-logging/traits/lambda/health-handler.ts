import { fileURLToPath } from "node:url";
import { Code, type FunctionProps, Runtime } from "aws-cdk-lib/aws-lambda";
import type { PropertyTrait } from "../../../../src";

// Inline code (`Code.fromInline`) is written to `index.js`, which Lambda loads
// as CommonJS — `export` there fails at runtime. Shipping the handler as an
// asset lets it be a real ES module via the `.mjs` extension.
const handlerDir = fileURLToPath(new URL("../../handlers/health", import.meta.url));

/**
 * For: `Function` (AWS::Lambda::Function)
 *
 * An ES module handler returning `{ status: "ok" }`.
 */
export const healthHandler: PropertyTrait<FunctionProps> = {
  name: "health-handler",
  type: "property",
  // Function form, so each build gets its own Code: an AssetCode binds to one
  // stack, and a shared instance throws AssetAlreadyAssociatedWithStack the
  // second time this trait is used.
  value: () => ({
    runtime: Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: Code.fromAsset(handlerDir),
  }),
};
