#!/usr/bin/env bun
import { App } from "aws-cdk-lib";
import { GatewayStack } from "./stack";

// No explicit app.synth(): the CDK CLI sets CDK_OUTDIR, which turns on App's
// autoSynth, so the cloud assembly is written when the process exits.
const app = new App();
new GatewayStack(app, "GatewayV2AccessLogging");
