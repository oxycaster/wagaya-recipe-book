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

production stackの出力 `GitHubDeployRoleArn` をGitHub repository environment `production` のvariable `AWS_DEPLOY_ROLE_ARN` に設定する。ActionsはOIDCでこのroleを引き受け、短期SSH鍵をLightsail APIから取得して更新する。固定のAWS keyやSSH keyはGitHubへ保存しない。

初回bootstrapとCDK stackはdev/prodおよび親DNS accountで作成済み。GitHub environment `develop` と `production` のrole ARN variablesも設定済みである。application settings secretの値と、最初のGitHub Actions runtime deployは未完了。

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

親zone `oxycaster.com` は `oxycaster` accountのpublic hosted zone `Z07405471OEYVNVS2TQ3H` で管理する。このためDNSはproduction stackに含めず、同じCDK appの親account用stack `WagayaRecipeBookDns-production` で管理する。production stack作成後、出力したstatic IPを使って初回だけ次を実行する。

```sh
aws sso login --profile oxycaster
dns_account="$(aws sts get-caller-identity --profile oxycaster --query Account --output text)"
CDK_DEFAULT_ACCOUNT="$dns_account" \
  ./node_modules/.bin/cdk bootstrap "aws://${dns_account}/ap-northeast-1" --profile oxycaster
CDK_DEFAULT_ACCOUNT="$dns_account" \
  ./node_modules/.bin/cdk deploy WagayaRecipeBookDns-production \
  -c environment=production -c target=dns -c apiStaticIp=<production static IP> --profile oxycaster
```

DNS stackの出力 `GitHubDnsDeployRoleArn` を同じGitHub environmentの `AWS_DNS_DEPLOY_ROLE_ARN` に設定する。以後のworkflowはproduction stackの更新後にこのroleへ切り替え、`api.wagaya.oxycaster.com` のA recordをstatic IPへ同期する。

旧 `prod-wagaya-recipe-book-archives-619330834313` は別アカウントのTerraform管理バケットであり、本CDK stackは変更しない。新しいproduction bucketの実データ保存を受入後、空であることを確認してから旧バケットを別途削除する。
