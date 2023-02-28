import { Stack, StackProps, SecretValue } from "aws-cdk-lib";
import {
  CodePipeline,
  CodePipelineSource,
  ManualApprovalStep,
  ShellStep,
} from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";
import { TradeStoreCdkStage } from "./trade_store_cdk-stage";
import { ManualApprovalAction } from "aws-cdk-lib/aws-codepipeline-actions";

/**
 * The stack that defines the application pipeline
 * https://docs.aws.amazon.com/cdk/v2/guide/cdk_pipeline.html
 */
export class TradeStoreCdkPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const prebuild = new ShellStep("Prebuild", {
      input: CodePipelineSource.gitHub("cvlsrivatsa/TradeStoreApp", "main"),
      primaryOutputDirectory: "./build",
      commands: ["./build.sh"],
    });

    const pipeline = new CodePipeline(this, "Pipeline", {
      pipelineName: "TradeStorePipeline",
      synth: new ShellStep("Synth", {
        input: CodePipelineSource.gitHub("cvlsrivatsa/TradeStoreCdk", "main"),
        commands: ["npm ci", "npm run build", "npx cdk synth"],
        additionalInputs: { subdir: prebuild },
      }),
      selfMutation: true,
    });

    const devApp = new TradeStoreCdkStage(this, "Devo", {
      env: { account: "191296374569", region: "us-west-2" },
    });
    const devStage = pipeline.addStage(devApp);
    devStage.addPost(
      new ShellStep("validate", {
        envFromCfnOutputs: { lb_addr: devApp.urlOutput },
        commands: ["echo $lb_addr", "curl -Ssf $lb_addr"],
        // commands: ["../tests/validate.sh"],
      })
    );

    const preProdStage = pipeline.addStage(
      new TradeStoreCdkStage(this, "PreProd", {
        env: { account: "191296374569", region: "us-east-1" },
      })
    );
    preProdStage.addPost(new ManualApprovalStep("approval"));

    // ..
  }
}
