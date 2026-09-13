#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OpenIceFinderStack } from "../lib/open-ice-finder-stack.js";

const app = new cdk.App();
const stackName = process.env.STACK_NAME ?? "OpenIceFinderStack";
const region = process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1";

new OpenIceFinderStack(app, stackName, {
  stackName,
  description: "OpenIceFinder web hosting, scheduled rink scraper, and cached schedule JSON",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
});
