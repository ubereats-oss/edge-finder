#!/usr/bin/env bash
set +x
set -uo pipefail

mode=$1
(
  set -e
  umask 077
  [[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
  scratch=$(mktemp -d "$RUNNER_TEMP/edge-deploy.XXXXXXXX")
  trap 'rm -rf -- "$scratch"' EXIT
  trap 'exit 1' HUP INT TERM

  export CLOUDSDK_CONFIG="$scratch/gcloud"
  export NPM_CONFIG_CACHE="$scratch/npm"
  export GOOGLE_APPLICATION_CREDENTIALS="$scratch/oidc.json"
  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$GOOGLE_APPLICATION_CREDENTIALS"
  mkdir "$scratch/checkout"
  git archive HEAD | tar -x -C "$scratch/checkout"
  cd "$scratch/checkout"

  case "$mode" in
    rules) target=firestore:rules ;;
    functions)
      target="$EDGE_FIREBASE_ONLY"
      printf '%s\n' "$GITHUB_SHA" > functions/.deploy_commit
      npm --prefix functions ci
      ;;
    *) exit 1 ;;
  esac

  oidc_url=$(node -e '
    const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
    url.searchParams.set("audience", "https://iam.googleapis.com/" + process.env.EDGE_WIF_PROVIDER);
    process.stdout.write(url.href);
  ')
  gcloud --quiet iam workload-identity-pools create-cred-config "$EDGE_WIF_PROVIDER" \
    --service-account="$EDGE_DEPLOY_SERVICE_ACCOUNT" \
    --credential-source-url="$oidc_url" \
    --credential-source-headers="Authorization=Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    --credential-source-type=json --credential-source-field-name=value \
    --output-file="$GOOGLE_APPLICATION_CREDENTIALS"

  npx -y firebase-tools@latest deploy --non-interactive --project "$EDGE_FIREBASE_PROJECT" --only "$target"

  if [[ "$mode" == functions ]]; then
    IFS=',' read -ra functions <<< "$EDGE_FUNCTIONS"
    [[ ${#functions[@]} -gt 0 ]]
    for fn in "${functions[@]}"; do
      source_uri=$(gcloud --quiet functions describe "$fn" --gen2 \
        --region="$EDGE_FUNCTIONS_REGION" --project="$EDGE_FIREBASE_PROJECT" --format=json |
        node -e '
          const doc = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
          const source = doc.buildConfig.sourceProvenance.resolvedStorageSource;
          if (!source.bucket || !source.object || !source.generation) process.exit(1);
          process.stdout.write("gs://" + source.bucket + "/" + source.object + "#" + source.generation);
        ')
      gcloud --quiet storage cp "$source_uri" "$scratch/source.zip"
      deployed_sha=$(unzip -p "$scratch/source.zip" .deploy_commit | tr -d '\r\n')
      [[ "$deployed_sha" == "$GITHUB_SHA" ]]
    done
  fi
) >/dev/null 2>&1
status=$?

printf 'SHA %s\n' "$GITHUB_SHA"
if [[ "$status" -eq 0 ]]; then
  printf 'Validacao: passou\n'
else
  printf '::error::Validacao falhou.\n'
  exit 1
fi
