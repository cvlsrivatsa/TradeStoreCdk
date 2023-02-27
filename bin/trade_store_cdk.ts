#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { TradeStoreCdkPipelineStack } from "../lib/trade_store_cdk-pipeline-stack";
import { TradeStoreCdkBuildStack } from "../lib/trade_store_cdk-build-stage";
import { TradeStoreCdkStack } from "../lib/trade_store_cdk-stack";

const app = new App();
const pipelineStack = new TradeStoreCdkBuildStack(
  app,
  "TradeStoreCdkBuildStack",
  {
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */
    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    env: { account: "191296374569", region: "us-east-1" },
    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  }
);
new TradeStoreCdkStack(app, "TradeStoreCdkStack", {
  image: pipelineStack.tagParameterContainerImage,
  env: { account: "191296374569", region: "us-east-1" },
});

// app.synth();
