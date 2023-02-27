import * as ecs from "aws-cdk-lib/aws-ecs";
import { TradeStoreCdkStack } from "./trade_store_cdk-stack";
import { CfnOutput, Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";

/**
 * Deployable unit of web service app
 */
export class TradeStoreCdkStage extends Stage {
  public readonly urlOutput: CfnOutput;
  public readonly loadBalancerAddress: string;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    const service = new TradeStoreCdkStack(this, "WebService");

    // Expose TradeStoreCdkStack's output one level higher
    this.urlOutput = service.urlOutput;
    this.loadBalancerAddress = service.loadBalancerAddress;
    this.service = service.service;
  }
}
