#!/usr/bin/env bash
# Build once, deploy infrastructure, publish the web bundle to S3, push the OpenAI key into Secrets Manager, and run the first refresh.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

STACK_NAME=${STACK_NAME:-OpenIceFinderStack}
REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}
OUTPUTS_FILE="$PROJECT_ROOT/infra/cdk-outputs.json"
WEB_DIST="$PROJECT_ROOT/apps/web/dist"
SKIP_REFRESH=${SKIP_REFRESH:-0}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' was not found." >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command aws

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if (( NODE_MAJOR < 22 )); then
  echo "Error: Node.js 22 or newer is required (found $(node --version))." >&2
  exit 1
fi

if [[ ! -x "$PROJECT_ROOT/node_modules/.bin/cdk" ]]; then
  echo "Error: dependencies are not installed. Run 'npm install' first." >&2
  exit 1
fi

echo "Checking AWS credentials in $REGION..."
aws sts get-caller-identity --region "$REGION" >/dev/null

echo "Building shared code, refresh Lambda, and web app..."
npm run build

if [[ ! -f "$PROJECT_ROOT/packages/scraper/dist/lambda.mjs" ]]; then
  echo "Error: scraper build did not create packages/scraper/dist/lambda.mjs." >&2
  exit 1
fi
if [[ ! -f "$WEB_DIST/index.html" ]]; then
  echo "Error: web build did not create apps/web/dist/index.html." >&2
  exit 1
fi

echo "Deploying CDK stack $STACK_NAME in $REGION..."
STACK_NAME="$STACK_NAME" AWS_REGION="$REGION" \
  npm run deploy -w @openice/infra -- \
  "$STACK_NAME" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE"

stack_output() {
  local output_key=$1
  aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
    --output text
}

BUCKET_NAME=$(stack_output BucketName)
DISTRIBUTION_ID=$(stack_output DistributionId)
APP_URL=$(stack_output AppUrl)
REFRESH_FUNCTION_NAME=$(stack_output RefreshFunctionName)
OPENAI_SECRET_ARN=$(stack_output OpenAiApiKeySecretArn)

for pair in "BucketName:$BUCKET_NAME" "DistributionId:$DISTRIBUTION_ID" "AppUrl:$APP_URL" "RefreshFunctionName:$REFRESH_FUNCTION_NAME"; do
  key=${pair%%:*}
  value=${pair#*:}
  if [[ -z "$value" || "$value" == "None" ]]; then
    echo "Error: stack output $key is missing." >&2
    exit 1
  fi
done

if [[ -n "${OPENAI_API_KEY:-}" && -n "$OPENAI_SECRET_ARN" && "$OPENAI_SECRET_ARN" != "None" ]]; then
  echo "Updating OpenAI API key secret..."
  aws secretsmanager put-secret-value \
    --region "$REGION" \
    --secret-id "$OPENAI_SECRET_ARN" \
    --secret-string "$OPENAI_API_KEY" >/dev/null
else
  echo "OPENAI_API_KEY is not set; skipping production secret update."
fi

if [[ -d "$WEB_DIST/assets" ]]; then
  echo "Uploading immutable content-hashed assets..."
  aws s3 sync "$WEB_DIST/assets/" "s3://$BUCKET_NAME/assets/" \
    --region "$REGION" \
    --cache-control "public, max-age=31536000, immutable" \
    --delete \
    --only-show-errors
fi

echo "Uploading mutable app entry files..."
# data/* is owned by the refresh Lambda; never delete it from here.
aws s3 sync "$WEB_DIST/" "s3://$BUCKET_NAME/" \
  --region "$REGION" \
  --cache-control "public, max-age=0, must-revalidate" \
  --exclude "assets/*" \
  --exclude "data/*" \
  --delete \
  --only-show-errors

echo "Invalidating the SPA entry point..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/" "/index.html" "/rangers" "/rangers.html" \
  --query "Invalidation.Id" \
  --output text >/dev/null

if [[ "$SKIP_REFRESH" != "1" ]]; then
  echo "Running the refresh Lambda so schedule data exists immediately (this can take a few minutes)..."
  REFRESH_OUT=$(mktemp)
  aws lambda invoke \
    --region "$REGION" \
    --function-name "$REFRESH_FUNCTION_NAME" \
    --cli-read-timeout 900 \
    --payload '{}' \
    "$REFRESH_OUT" >/dev/null
  cat "$REFRESH_OUT"
  echo
  rm -f "$REFRESH_OUT"
fi

echo "Deployment complete: $APP_URL"
