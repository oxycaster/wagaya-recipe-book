# CDK infrastructure

`develop` と `production` は別AWSアカウントで管理する。developはS3とデプロイ用OIDCロールだけを作り、API/workerはローカルDockerで実行する。productionは同じS3/OIDCロールに加えて、Lightsail 2GB instance、static IP、日次snapshotを作る。

初回だけ、対象アカウントの管理者権限でCDK bootstrapとstackの作成を行う。GitHub ActionsのOIDCロールはstack作成時に出力されるため、この初回作成をActionsで行わない。

```sh
cd infra/cdk
pnpm install --frozen-lockfile

aws sso login --profile wagaya-recipe-book-develop
develop_account="$(aws sts get-caller-identity --profile wagaya-recipe-book-develop --query Account --output text)"
CDK_DEFAULT_ACCOUNT="$develop_account" \
  ./node_modules/.bin/cdk bootstrap "aws://${develop_account}/ap-northeast-1" --profile wagaya-recipe-book-develop
CDK_DEFAULT_ACCOUNT="$develop_account" \
  ./node_modules/.bin/cdk deploy -c environment=develop --profile wagaya-recipe-book-develop

aws sso login --profile wagaya-recipe-book-production
production_account="$(aws sts get-caller-identity --profile wagaya-recipe-book-production --query Account --output text)"
CDK_DEFAULT_ACCOUNT="$production_account" \
  ./node_modules/.bin/cdk bootstrap "aws://${production_account}/ap-northeast-1" --profile wagaya-recipe-book-production
CDK_DEFAULT_ACCOUNT="$production_account" \
  ./node_modules/.bin/cdk deploy -c environment=production --profile wagaya-recipe-book-production
```

`production` stackの出力 `GitHubDeployRoleArn` をGitHub repository environment `production` のvariable `AWS_DEPLOY_ROLE_ARN` に設定する。ActionsはOIDCでこのroleを引き受け、短期SSH鍵をLightsail APIから取得して更新する。固定のAWS keyやSSH keyはGitHubへ保存しない。

`ApplicationSettingsSecretArn` はAWS Secrets ManagerのJSON secretである。以下の値を入力する。`DATABASE_SSL_CA` は改行を `\\n` として保存できる。AWS資格情報とS3 bucket名は `RuntimeCredentialsSecretArn` にCDKが保存するため、ここへ重複して保存しない。

```json
{
  "APP_ENV": "prod",
  "DATABASE_URL": "",
  "DATABASE_SSL_CA": "",
  "CLERK_ISSUER_URL": "",
  "CLERK_AUTHORIZED_PARTIES": "",
  "CLERK_SECRET_KEY": "",
  "OPENAI_API_KEY": "",
  "OPENAI_MODEL": "",
  "REVENUECAT_WEBHOOK_SECRET": "",
  "REVENUECAT_APP_ID": "",
  "REVENUECAT_ENVIRONMENT": "PRODUCTION",
  "REVENUECAT_PRODUCTS": "{\"recipe_import_10\":10}"
}
```

CloudFormationが管理するS3 access keyは最小権限で、CDK stackの削除時も保持する。Secrets Managerへの閲覧とCloudFormationのstack閲覧を必要な運用者だけに制限する。

`api.wagaya.oxycaster.com` のA recordは、production accountから親hosted zoneを参照できる場合だけ `-c hostedZoneId=...` を付けてCDKで作成する。親zoneが別アカウントにある場合は、親アカウント側でそのrecordだけを作成するか、`wagaya.oxycaster.com` をproduction accountへ委任してからCDKへ渡す。

旧 `prod-wagaya-recipe-book-archives-619330834313` は別アカウントのTerraform管理バケットであり、本CDK stackは変更しない。新しいproduction bucketの実データ保存を受入後、空であることを確認してから旧バケットを別途削除する。
