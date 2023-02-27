import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import { Function, Code, InlineCode, Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";

export interface EcsAppStackProps extends StackProps {
  readonly image: ecs.ContainerImage;
}
export class TradeStoreCdkStack extends Stack {
  public readonly urlOutput: CfnOutput;
  public readonly loadBalancerAddress: string;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props?: EcsAppStackProps) {
    super(scope, id, props);

    // SQS
    const queue = new sqs.Queue(this, "TradeStoreCdkQueue", {
      visibilityTimeout: Duration.seconds(300),
    });

    // The Lambda function that contains the functionality
    const handler = new Function(this, "Lambda", {
      runtime: Runtime.NODEJS_14_X,
      handler: "handler.handler",
      code: Code.fromAsset(path.resolve(__dirname, "lambda")),
    });

    // An API Gateway to make the Lambda web-accessible
    // const gw = new apigw.LambdaRestApi(this, "Gateway", {
    //   description: "Endpoint for a simple Lambda-powered web service",
    //   handler,
    // });

    const dynamoTable = new Table(this, "TradeRecordTable", {
      partitionKey: { name: "TradeId", type: AttributeType.STRING },
      sortKey: { name: "Version", type: AttributeType.NUMBER },
      tableName: "TradeRecordTable",
      /**
       *  The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
       * the new table, and it will remain in your account until manually deleted. By setting the policy to
       * DESTROY, cdk destroy will delete the table (even if it has data in it)
       */
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production code
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    // Create a cluster
    const vpc = new Vpc(this, "Vpc", { maxAzs: 2, natGateways: 1 });
    const cluster = new ecs.Cluster(this, "fargate-service-autoscaling", {
      vpc,
    });

    // Fargate service
    const fargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "fargateService",
        {
          cluster: cluster,
          memoryLimitMiB: 2048,
          cpu: 512,
          taskImageOptions: {
            containerName: "trade-store-app",
            // image: ecs.ContainerImage.fromAsset("../backend/"),
            // image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-example"),
            image: props?.image!,
            environment: {
              myVar: "variable01",
            },
            containerPort: 8080,
          },
          publicLoadBalancer: true,
          desiredCount: 1,
          listenerPort: 80,
        }
      );
    fargateService.taskDefinition.executionRole?.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonEC2ContainerRegistryPowerUser"
      )
    );

    dynamoTable.grantReadWriteData(fargateService.taskDefinition.taskRole);

    // Setup AutoScaling policy
    const scaling = fargateService.service.autoScaleTaskCount({
      maxCapacity: 2,
    });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 50,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // Health check
    fargateService.targetGroup.configureHealthCheck({ path: "/health" });

    // Load balancer url
    new CfnOutput(this, "loadBalancerUrl", {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      exportName: "loadBalancerUrl",
    });

    this.loadBalancerAddress = fargateService.loadBalancer.loadBalancerDnsName;
    this.service = fargateService.service;

    // given a stack lbStack that exposes a load balancer construct as loadBalancer
    // this.loadBalancerAddress = new CfnOutput(lbStack, "LbAddress", {
    //   value: `https://${lbStack.loadBalancer.loadBalancerDnsName}/`,
    // });

    // this.urlOutput = new CfnOutput(this, "Url", {
    //   value: gw.url,
    // });
  }
}
