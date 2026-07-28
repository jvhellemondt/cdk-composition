#!/usr/bin/env bun
import { App } from "aws-cdk-lib";
import { GatewayStack } from "./stack";

const app = new App();
new GatewayStack(app, "GatewayV2AccessLogging");
app.synth();
