#!/usr/bin/env bash
#
# Deploy AutoLedger as a Cloud Function (2nd gen) and point Telegram at it.
#
# The two secrets come from Secret Manager, never from a file in the repo or a
# --set-env-vars flag (which would leave them readable in the function's config
# and in deploy logs). The Google credential is not a secret at all here: the
# service account is attached to the function, so Application Default
# Credentials supply it and no key is stored anywhere.
#
# Usage:  ./deploy.sh
# Prereqs: gcloud CLI, authenticated, with the project set.
set -euo pipefail

PROJECT="${PROJECT:-ivan-project-508512}"
REGION="${REGION:-asia-southeast2}"          # Jakarta
FUNCTION="${FUNCTION:-autoledger}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-ledger-bot@${PROJECT}.iam.gserviceaccount.com}"
SPREADSHEET_ID="${SPREADSHEET_ID:?set SPREADSHEET_ID or export it from .env}"
ALLOWED_TELEGRAM_IDS="${ALLOWED_TELEGRAM_IDS:?set ALLOWED_TELEGRAM_IDS}"
TIMEZONE="${TIMEZONE:-Asia/Jakarta}"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-5}"

echo "==> Enabling the APIs this needs (idempotent)"
gcloud services enable \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  sheets.googleapis.com \
  --project "$PROJECT"

echo "==> Letting the function's service account read the secrets"
for SECRET in anthropic-api-key telegram-bot-token telegram-webhook-secret; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" \
    --role roles/secretmanager.secretAccessor \
    --project "$PROJECT" >/dev/null
done

echo "==> Compiling TypeScript to dist/"
# Cloud Functions runs plain `node`, which cannot load .ts, and package.json
# "main" points at dist/webhook.js. Build here, upload dist, and tell the
# buildpack not to run npm scripts (GOOGLE_NODE_RUN_SCRIPTS= below): src/ is
# deliberately not uploaded, so a remote `npm run build` fails with TS18003
# "no inputs were found". Shipping the locally built tree also means the
# artifact that runs is the one verified with functions-framework.
npm run build

echo "==> Deploying $FUNCTION to $REGION"
# --allow-unauthenticated is required: Telegram cannot present a Google identity
# token. The webhook secret is what authenticates callers instead, which is why
# the function refuses to start without TELEGRAM_WEBHOOK_SECRET.
gcloud functions deploy "$FUNCTION" \
  --gen2 \
  --runtime nodejs22 \
  --region "$REGION" \
  --source . \
  --entry-point telegram \
  --trigger-http \
  --allow-unauthenticated \
  --service-account "$SERVICE_ACCOUNT" \
  --timeout 120s \
  --memory 512Mi \
  --max-instances 3 \
  --set-env-vars "SPREADSHEET_ID=${SPREADSHEET_ID},ALLOWED_TELEGRAM_IDS=${ALLOWED_TELEGRAM_IDS},TIMEZONE=${TIMEZONE},CLAUDE_MODEL=${CLAUDE_MODEL}" \
  --set-secrets "ANTHROPIC_API_KEY=anthropic-api-key:latest,TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_WEBHOOK_SECRET=telegram-webhook-secret:latest" \
  --set-build-env-vars GOOGLE_NODE_RUN_SCRIPTS= \
  --project "$PROJECT"

URL="$(gcloud functions describe "$FUNCTION" --region "$REGION" --gen2 \
        --format 'value(serviceConfig.uri)' --project "$PROJECT")"
echo "==> Deployed at $URL"

echo "==> Registering the webhook with Telegram"
npm run webhook:set -- "$URL"

echo
echo "Done. Watch it work with:"
echo "  gcloud functions logs read $FUNCTION --region $REGION --gen2 --project $PROJECT"
