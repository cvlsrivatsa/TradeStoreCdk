import {
  CfnOutput,
  Stage,
  StageProps,
  CfnParameter,
  SecretValue,
  Stack,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Repository } from "aws-cdk-lib/aws-ecr";
import {
  Project,
  PipelineProject,
  Source,
  EventAction,
  FilterGroup,
  LinuxBuildImage,
  BuildSpec,
  Cache,
  LocalCacheMode,
  GitHubSourceCredentials,
} from "aws-cdk-lib/aws-codebuild";
import { Pipeline, Artifact, ArtifactPath } from "aws-cdk-lib/aws-codepipeline";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import { TradeStoreCdkStage } from "./trade_store_cdk-stage";
import { TagParameterContainerImage } from "aws-cdk-lib/aws-ecs";

/*
 * https://docs.aws.amazon.com/cdk/api/v1/docs/aws-codepipeline-actions-readme.html#ecs
 */
export class TradeStoreCdkBuildStack extends Stack {
  public readonly tagParameterContainerImage: TagParameterContainerImage;

  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    const githubUserName = new CfnParameter(this, "githubUserName", {
      type: "String",
      description: "Github username for source code repository",
      default: "cvlsrivatsa",
    });

    const githubCdkRepository = new CfnParameter(this, "githubCdkRespository", {
      type: "String",
      description: "Github cdk code repository",
      default: "TradeStoreCdk",
    });

    const githubRepository = new CfnParameter(this, "githubRespository", {
      type: "String",
      description: "Github source code repository",
      default: "TradeStoreApp",
    });

    const githubPersonalTokenSecretName = new CfnParameter(
      this,
      "githubPersonalTokenSecretName",
      {
        type: "String",
        description:
          "The name of the AWS Secrets Manager Secret which holds the GitHub Personal Access Token for this project.",
        default: "github-token",
      }
    );

    const ecrRepo = new Repository(this, "ecrRepo", {
      repositoryName: "trade-store-app",
    });

    const gitHubCdkSource = Source.gitHub({
      owner: githubUserName.valueAsString,
      repo: githubCdkRepository.valueAsString,
      webhook: true,
      webhookFilters: [
        FilterGroup.inEventOf(EventAction.PUSH).andBranchIs("main"),
      ],
    });

    const gitHubSource = Source.gitHub({
      owner: githubUserName.valueAsString,
      repo: githubRepository.valueAsString,
      webhook: true,
      webhookFilters: [
        FilterGroup.inEventOf(EventAction.PUSH).andBranchIs("main"),
      ],
    });

    const cdk_project = new PipelineProject(this, "CdkCodeBuildProject", {
      // source: gitHubCdkSource,
      environment: {
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_4,
        privileged: true,
      },
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: ["npm install", "npm update -g aws-cdk"],
          },
          build: {
            commands: [
              // synthesize the CDK code for the ECS application Stack
              "npx cdk synth --verbose",
            ],
          },
        },
        artifacts: {
          // store the entire Cloud Assembly as the output artifact
          "base-directory": "cdk.out",
          files: "**/*",
        },
      }),
    });

    const app_project = new PipelineProject(this, "myProject", {
      // source: gitHubSource,
      environment: {
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_4,
        privileged: true,
      },
      environmentVariables: {
        ecr_repo_uri: {
          value: `${ecrRepo.repositoryUri}`,
        },
      },
      // badge: true,
      // TODO - I had to hardcode tag here
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            /*
            commands: [
              'env',
              'export tag=${CODEBUILD_RESOLVED_SOURCE_VERSION}'
            ]
            */
            commands: ["env", "export tag=latest"],
          },
          build: {
            commands: [
              // "cd trade-store-app",
              `docker build -t $ecr_repo_uri:$tag .`,
              "$(aws ecr get-login --no-include-email)",
              "docker push $ecr_repo_uri:$tag",
            ],
          },
          post_build: {
            commands: [
              'echo "in post-build stage"',
              // "cd ..",
              'printf \'[{"name":"trade-store-app","imageUri":"%s"}]\' $ecr_repo_uri:$tag > imagedefinitions.json',
              "pwd; ls -al; cat imagedefinitions.json",
              "export imageTag=$tag",
            ],
          },
        },
        env: {
          "exported-variables": ["imageTag"],
        },
        artifacts: {
          files: ["imagedefinitions.json"],
        },
      }),
      cache: Cache.local(LocalCacheMode.DOCKER_LAYER, LocalCacheMode.CUSTOM),
    });

    ecrRepo.grantPullPush(app_project.role!);

    // create the ContainerImage used for the ECS application Stack
    this.tagParameterContainerImage = new TagParameterContainerImage(ecrRepo);

    // ***pipeline actions***
    const cdkSourceOutput = new Artifact();
    const sourceOutput = new Artifact();
    const cdkBuildOutput = new Artifact();
    const buildOutput = new Artifact();

    const cdkSourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: "github_cdk_source",
      owner: githubUserName.valueAsString,
      repo: githubCdkRepository.valueAsString,
      branch: "main",
      oauthToken: SecretValue.secretsManager(
        githubPersonalTokenSecretName.valueAsString
      ),
      output: cdkSourceOutput,
    });

    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: "github_app_source",
      owner: githubUserName.valueAsString,
      repo: githubRepository.valueAsString,
      branch: "main",
      oauthToken: SecretValue.secretsManager(
        githubPersonalTokenSecretName.valueAsString
      ),
      output: sourceOutput,
    });

    const cdkBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: "cdk_build",
      project: cdk_project,
      input: sourceOutput,
      outputs: [buildOutput], // optional
    });

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: "app_build",
      project: app_project,
      input: cdkSourceOutput,
      outputs: [cdkBuildOutput],
    });

    const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
      actionName: "approve",
    });

    const cdkDeployAction =
      new codepipeline_actions.CloudFormationCreateUpdateStackAction({
        actionName: "CFN_Deploy",
        stackName: "SampleEcsStackDeployedFromCodePipeline",
        // this name has to be the same name as used below in the CDK code for the application Stack
        templatePath: cdkBuildOutput.atPath(
          "EcsStackDeployedInPipeline.template.json"
        ),
        adminPermissions: true,
        parameterOverrides: {
          // read the tag pushed to the ECR repository from the CodePipeline Variable saved by the application build step,
          // and pass it as the CloudFormation Parameter for the tag
          [this.tagParameterContainerImage.tagParameterName]:
            buildAction.variable("imageTag"),
        },
      });

    /*
    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: "deployAction",
      service: new TradeStoreCdkStage(this, "Devo").service,
      imageFile: new ArtifactPath(buildOutput, `imagedefinitions.json`),
    });
    */

    // pipeline stages

    // NOTE - Approve action is commented out!
    new Pipeline(this, "myecspipeline", {
      stages: [
        {
          stageName: "source",
          actions: [cdkSourceAction, sourceAction],
        },
        {
          stageName: "build",
          actions: [cdkBuildAction, buildAction],
        },
        {
          stageName: "approve",
          actions: [manualApprovalAction],
        },
        {
          stageName: "deploy-to-ecs",
          actions: [cdkDeployAction],
        },
      ],
    });

    /*
    project.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "ecs:describecluster",
          "ecr:getauthorizationtoken",
          "ecr:batchchecklayeravailability",
          "ecr:batchgetimage",
          "ecr:getdownloadurlforlayer",
        ],
        resources: [`${cluster.clusterArn}`],
      })
    );
    */
    new CfnOutput(this, "image", { value: ecrRepo.repositoryUri + ":latest" });
  }
}
