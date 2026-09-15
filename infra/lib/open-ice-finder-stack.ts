import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface OpenIceFinderStackProps extends StackProps {
  /** Override used by assertion tests so they do not require a built Lambda asset. */
  readonly refreshCode?: lambda.Code;
  /** OpenAI model used for classification and document extraction. */
  readonly openAiModel?: string;
  /** EventBridge schedule for the refresh Lambda. */
  readonly refreshSchedule?: events.Schedule;
}

export class OpenIceFinderStack extends Stack {
  constructor(scope: Construct, id: string, props: OpenIceFinderStackProps = {}) {
    super(scope, id, props);

    const webBucket = new s3.Bucket(this, "WebBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const openAiApiKeySecret = new secretsmanager.Secret(this, "OpenAiApiKeySecret", {
      description: "OpenAI API key used by OpenIceFinder to classify rink events and read PDF/image schedules.",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const staticOrigin = origins.S3BucketOrigin.withOriginAccessControl(webBucket);

    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      comment: "Serve index.html for extensionless client-side routes; /rangers keeps its own preview HTML",
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.method === "GET" || request.method === "HEAD") {
    var uri = request.uri;
    if (uri === "/rangers" || uri === "/rangers/") {
      request.uri = "/rangers.html";
      return request;
    }
    if (uri.indexOf("/data/") !== 0) {
      var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
      if (lastSegment.indexOf(".") === -1) {
        request.uri = "/index.html";
      }
    }
  }
  return request;
}
      `),
    });

    const entryPointCachePolicy = new cloudfront.CachePolicy(this, "EntryPointCachePolicy", {
      comment: "Near-zero cache for the SPA shell and other mutable files",
      defaultTtl: Duration.seconds(1),
      minTtl: Duration.seconds(1),
      maxTtl: Duration.seconds(1),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const immutableAssetCachePolicy = new cloudfront.CachePolicy(this, "ImmutableAssetCachePolicy", {
      comment: "Long-lived cache for Vite content-hashed assets",
      defaultTtl: Duration.days(365),
      minTtl: Duration.days(30),
      maxTtl: Duration.days(365),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const dataCachePolicy = new cloudfront.CachePolicy(this, "DataCachePolicy", {
      comment: "Short cache for scraped rink JSON; the refresh Lambda invalidates /data/*",
      defaultTtl: Duration.seconds(60),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.minutes(10),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "OpenIceFinder web app and cached rink schedules",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: staticOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: entryPointCachePolicy,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/assets/*": {
          origin: staticOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: immutableAssetCachePolicy,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
        "/data/*": {
          origin: staticOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: dataCachePolicy,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const refreshBundlePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "scraper", "dist");

    const refreshFunction = new lambda.Function(this, "RefreshFunction", {
      description: "Scrapes rink schedules, classifies open ice, and writes JSON to the web bucket",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      code: props.refreshCode ?? lambda.Code.fromAsset(refreshBundlePath),
      handler: "lambda.handler",
      memorySize: 1024,
      timeout: Duration.minutes(10),
      logGroup: new logs.LogGroup(this, "RefreshLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        BUCKET_NAME: webBucket.bucketName,
        DISTRIBUTION_ID: distribution.distributionId,
        OPENAI_API_KEY_SECRET_ARN: openAiApiKeySecret.secretArn,
        OPENAI_MODEL: props.openAiModel ?? process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
        RANGE_DAYS: "35",
      },
    });
    webBucket.grantReadWrite(refreshFunction, "data/*");
    openAiApiKeySecret.grantRead(refreshFunction);
    refreshFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          Stack.of(this).formatArn({ service: "cloudfront", region: "", resource: "distribution", resourceName: distribution.distributionId }),
        ],
      }),
    );

    new events.Rule(this, "RefreshSchedule", {
      description: "Refresh OpenIceFinder rink schedules",
      schedule: props.refreshSchedule ?? events.Schedule.rate(Duration.hours(6)),
      targets: [new targets.LambdaFunction(refreshFunction, { retryAttempts: 1 })],
    });

    const githubOidcArn = Stack.of(this).formatArn({
      service: "iam",
      region: "",
      resource: "oidc-provider",
      resourceName: "token.actions.githubusercontent.com",
    });
    const rangersGithubRole = new iam.Role(this, "GitHubRangersRefreshRole", {
      roleName: "OpenIceFinderGitHubRangersRefresh",
      description: "GitHub Actions publishes data/rangers.json via OIDC; no long-lived access keys.",
      assumedBy: new iam.WebIdentityPrincipal(githubOidcArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:Lcarey/OpenIceFinder:ref:refs/heads/main",
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    webBucket.grantPut(rangersGithubRole, "data/rangers.json");
    rangersGithubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          Stack.of(this).formatArn({ service: "cloudfront", region: "", resource: "distribution", resourceName: distribution.distributionId }),
        ],
      }),
    );

    new CfnOutput(this, "AppUrl", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "BucketName", { value: webBucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "RefreshFunctionName", { value: refreshFunction.functionName });
    new CfnOutput(this, "OpenAiApiKeySecretArn", { value: openAiApiKeySecret.secretArn });
    new CfnOutput(this, "GitHubRangersRefreshRoleArn", { value: rangersGithubRole.roleArn });
  }
}
