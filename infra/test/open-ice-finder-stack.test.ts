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
          Match.objectLike({ Action: "geo-routes:CalculateRoutes", Effect: "Allow", Resource: Match.anyValue() }),
          Match.objectLike({ Action: "cloudfront:CreateInvalidation", Effect: "Allow" }),
        ]),
      },
    });
  });

  it("scopes routing permission to the AWS provider ARN, which has no account component", () => {
    const template = synthTemplate();
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    assert.ok(policies.includes("::provider/default"));
  });

  it("schedules the refresh every 24 hours", () => {
    const template = synthTemplate();
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 day)",
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
          Match.objectLike({ PathPattern: "/data/*", FunctionAssociations: Match.arrayWith([Match.objectLike({ EventType: "viewer-request" })]) }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({ DefaultTTL: 60, MaxTTL: 600 }),
    });
    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionCode: Match.stringLikeRegexp("/data/drive-times/"),
    });
  });

  it("keeps the OpenAI secret and exposes the expected outputs", () => {
    const template = synthTemplate();
    template.hasResource("AWS::SecretsManager::Secret", { DeletionPolicy: "Retain" });
    for (const key of ["AppUrl", "BucketName", "DistributionId", "RefreshFunctionName", "OpenAiApiKeySecretArn", "GitHubRangersRefreshRoleArn", "GitHubYouthHockeyRefreshRoleArn"]) {
      assert.ok(template.findOutputs(key)[key], `missing output ${key}`);
    }
  });

  it("restricts the youth publisher to its feed, drive cache, routing and site invalidation", () => {
    const template = synthTemplate().toJSON();
    const resources = Object.values(template.Resources) as { Type: string; Properties: any }[];
    const role = resources.find(r => r.Type === "AWS::IAM::Role" && r.Properties.RoleName === "OpenIceFinderGitHubYouthHockeyRefresh")!;
    assert.equal(role.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"], "repo:Lcarey@7055619/OpenIceFinder@1368862512:ref:refs/heads/main");
    const policy = resources.find(r => r.Type === "AWS::IAM::Policy" && JSON.stringify(r.Properties.Roles).includes("GitHubYouthHockeyRefreshRole"))!;
    const statements = policy.Properties.PolicyDocument.Statement;
    assert.deepEqual(statements.flatMap((s: { Action: string | string[] }) => s.Action).sort(), ["cloudfront:CreateInvalidation", "geo-routes:CalculateRoutes", "s3:GetObject", "s3:ListBucket", "s3:PutObject", "s3:PutObject"]);
    const cache = statements.find((s: { Action: string | string[] }) => Array.isArray(s.Action) && s.Action.includes("s3:GetObject"));
    assert.match(JSON.stringify(cache.Resource), /\/data\/drive-times\/\*/);
    const list = statements.find((s: { Action: string }) => s.Action === "s3:ListBucket");
    assert.equal(list.Condition.StringLike["s3:prefix"], "data/drive-times/*");
    assert.match(JSON.stringify(statements.find((s: { Action: string }) => s.Action === "s3:PutObject").Resource), /\/data\/youth-hockey\.json/);
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
