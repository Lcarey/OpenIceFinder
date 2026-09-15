import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { OpenIceFinderStack } from "../lib/open-ice-finder-stack.js";

function synthTemplate(): Template {
  const app = new cdk.App();
  const stack = new OpenIceFinderStack(app, "TestStack", {
    refreshCode: lambda.Code.fromInline("exports.handler = async () => ({ ok: true });"),
  });
  return Template.fromStack(stack);
}

describe("OpenIceFinderStack", () => {
  it("creates a retained, private web bucket", () => {
    const template = synthTemplate();
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      },
    });
  });

  it("runs the refresh Lambda on Node.js 24 ARM64 with bucket, distribution, and secret wired in", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Architectures: ["arm64"],
      Handler: "lambda.handler",
      Runtime: "nodejs24.x",
      MemorySize: 1024,
      Timeout: 600,
      Environment: {
        Variables: {
          NODE_OPTIONS: "--enable-source-maps",
          BUCKET_NAME: Match.anyValue(),
          DISTRIBUTION_ID: Match.anyValue(),
          OPENAI_API_KEY_SECRET_ARN: Match.anyValue(),
          OPENAI_MODEL: Match.stringLikeRegexp("gpt"),
        },
      },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(["secretsmanager:GetSecretValue"]), Effect: "Allow" }),
          Match.objectLike({ Action: "cloudfront:CreateInvalidation", Effect: "Allow" }),
        ]),
      },
    });
  });

  it("schedules the refresh every 6 hours", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(6 hours)",
      State: "ENABLED",
      Targets: Match.arrayWith([Match.objectLike({ Arn: Match.anyValue() })]),
    });
  });

  it("serves /data/* with a short TTL and /assets/* immutably", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: "/assets/*" }),
          Match.objectLike({ PathPattern: "/data/*" }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({ DefaultTTL: 60, MaxTTL: 600 }),
    });
    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/rangers.html"),
    });
  });

  it("keeps the OpenAI secret and exposes the expected outputs", () => {
    const template = synthTemplate();
    template.hasResource("AWS::SecretsManager::Secret", { DeletionPolicy: "Retain" });
    for (const key of ["AppUrl", "BucketName", "DistributionId", "RefreshFunctionName", "OpenAiApiKeySecretArn", "GitHubRangersRefreshRoleArn"]) {
      assert.ok(template.findOutputs(key)[key], `missing output ${key}`);
    }
  });

  it("lets GitHub Actions on main assume an OIDC role that can put rangers.json", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "OpenIceFinderGitHubRangersRefresh",
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Effect: "Allow",
            Condition: Match.objectLike({
              StringEquals: Match.objectLike({
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": "repo:Lcarey@7055619/OpenIceFinder@1368862512:ref:refs/heads/main",
              }),
            }),
          }),
        ]),
      },
    });
  });
});
