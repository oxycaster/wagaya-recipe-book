# クラウド・iOS版 起動と公開手順

設計: [ios-cloud-plan.md](../ios-cloud-plan.md) / 公開計画: [app-store-release-plan.md](../app-store-release-plan.md) / 最新の状況: [ios-cloud-progress.md](../ios-cloud-progress.md)

## ローカル検証（外部課金なし）

リポジトリ直下:

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- node --test tests/quantities.test.mjs
cd services/api
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm test
cd ../../apps/mobile
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm check
mise exec -- pnpm exec expo install --check
mise exec -- pnpm export:ios
```

テストは外部通信しないPGliteデータベースと注入したS3/LLMを使用。実サービスの認証・課金成功を証明するものではない。

実PostgreSQLの複数接続で同じテストを行う場合は、専用のローカルDBを起動し `TEST_POSTGRES_URL=postgresql://recipe:recipe@127.0.0.1:54329/recipe mise exec -- pnpm test` をservices/apiから実行する。テストはランダム名の一時DBを作成し、終了時にそのDBだけを削除する。localhost以外は拒否する。テスト用DBロールにCREATEDB権限が必要。

## シミュレーターのClerk開発確認

Clerk development instanceの実メール認証と、メモリ上だけのAPIサーバーを組み合わせて画面を確認する。本番Dockerにtestディレクトリは含めない。`services/api/.env` にdevelopment instanceの `CLERK_ISSUER_URL` を設定してから起動する。初回ログイン後は空の状態なので、画面からレシピ帖を作成する。

```sh
# ターミナル1: services/api。build 3用fixtureの4329と分離する
DEMO_PORT=4330 mise exec -- node --env-file-if-exists=.env test/demo-server.mjs
# ターミナル2: apps/mobile
NODE_OPTIONS=--dns-result-order=ipv4first EXPO_PUBLIC_API_URL=http://127.0.0.1:4330 EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<development publishable key> mise exec -- pnpm exec expo start --dev-client --localhost --port 8093
# ターミナル3: apps/mobile
mise exec -- pnpm exec expo run:ios --no-bundler
```

開発クライアントの接続先は `http://127.0.0.1:8093`。自分のメールアドレスへ届くClerkの確認コードでログインする。ローカルfixtureは認証済みユーザーへ起動中一度だけテスト用取り込み権10回分を自動付与するため、StoreKit購入なしで取り込みを確認できる。APIデータとテスト用権利はプロセス終了時に消え、実課金・S3・OpenAIは実行しない。development instanceの成功をproduction instanceの検証済みとは扱わない。終了時は各プロセスをCtrl-Cで停止する。

### Simulatorから実URL・実OpenAIを試す

上記fixtureを停止し、`services/api/.env`（Git管理外）へdevelopment Clerkの `CLERK_ISSUER_URL`、サーバー専用の `OPENAI_API_KEY`、`OPENAI_MODEL` を設定する。値をコマンド行やアプリの `EXPO_PUBLIC_*` に書かない。`OPENAI_SCAN_MODEL` は必要な場合だけ指定する。API側は通常と同じ公開IP・リダイレクト・HTML容量検査を使い、原本とカードはこのプロセスのメモリにだけ置く。

```sh
# services/api。旧TestFlight用の4329では起動できない
SIMULATOR_REAL_EXTRACTION=1 DEMO_PORT=4330 mise exec -- node --env-file-if-exists=.env test/demo-server.mjs
# apps/mobile。development Clerk publishable keyはGit管理外の apps/mobile/.env に設定する
NODE_OPTIONS=--dns-result-order=ipv4first EXPO_PUBLIC_API_URL=http://127.0.0.1:4330 mise exec -- pnpm exec expo start --dev-client --localhost --port 8093
```

Simulatorのdevelopment buildを開いてClerkでログインし、レシピ帖を作成してURLを保存する。保存時に実HTMLを取得し、同意・最大権数の確認後にサーバー側からOpenAIへ送信する。初期の固定カードは生成せず、成功したカードだけ表示する。取り込み権10回分はあくまでテスト用で、OpenAI側の実料金は発生する。1プロセス最大30回のモデル呼び出しで停止し、超過時のジョブは失敗・権利返還となる。S3・RevenueCat・本番DBは使わず、終了時にテストカードと原本は消える。実OpenAIを通したローカル検証と本番配備の受入は別に記録する。

`expo run:ios --no-bundler` が別の8081ポートを開いた場合は、開発クライアントで上記8093を選ぶ。localhostがIPv6のみでlistenされる環境では上記NODE_OPTIONSを使う（端末が要求する127.0.0.1と一致させる）。

`@clerk/expo` を追加・更新した後は、ignoredのnative生成物にClerk pod/packageを反映するため `pnpm exec expo prebuild --platform ios --clean` を実行してからnative buildする。現在の生成結果はiOS deployment target 17.0。React本体と異なるpatch版の `react-dom` が解決されると起動時に互換性エラーになるため、`react` と `react-dom` は同じ19.2.0へ固定する。

## 内部TestFlightの実機UI確認用fixture

`testflight` build profileは、実サービス構築前の端末UI確認専用。`https://hiro-mac.tail6a2f57.ts.net:8443` を認証/API接続先にし、同じTailnetの端末だけが利用できる。MacとTailscale、fixtureプロセスが動作している間だけ利用可能で、データはfixture再起動で消える。実メール、S3、OpenAI、RevenueCat購入の検証には使わない。

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8443 http://127.0.0.1:4329
launchctl submit -l com.oxycaster.wagaya-recipe-fixture -- "$(mise which node)" "$(pwd)/services/api/test/demo-server.mjs"
curl -fsS https://hiro-mac.tail6a2f57.ts.net:8443/health
cd apps/mobile
mise exec -- eas build --platform ios --profile testflight --auto-submit
```

build 3だけは旧fixtureログイン `demo@example.test` / `123456` を使う。現在のClerk版をこの手順で再ビルドしない。停止時は `launchctl remove com.oxycaster.wagaya-recipe-fixture` と `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=8443 off` を実行する。通常のウェブ版を配信する443/4310設定は変更しない。

## 環境を用意する順序

環境は次の2つだけとし、stagingは作らない。

| 環境 | API/worker | PostgreSQL | 課金イベント |
|---|---|---|---|
| dev | ローカル実行またはTailnet内fixture | Docker `postgres:18-alpine` | RevenueCat SANDBOX |
| prod | 公開HTTPSの本番サービス | Crunchy Bridge PostgreSQL 18 `prod-wagaya-recipe-book` | RevenueCat PRODUCTION |

Clerkは本人確認とセッショントークン発行だけに使い、レシピ、レシピ帖、課金台帳、取り込みジョブを保存しない。dev/prodでClerk instance、S3 prefixまたはbucket、Webhook秘密を混在させない。

1. **Clerk**: このアプリ専用のClerk applicationを使い、development instanceをdev、production instanceをprodへ対応させる。メールアドレスのverification codeによるサインイン/サインアップとNative APIを有効にする。session tokenへ `email` claimを追加し、APIの `CLERK_ISSUER_URL` と `CLERK_AUTHORIZED_PARTIES` をinstanceごとに設定する。Publishable Keyだけをモバイルへ渡し、Secret Keyは退会処理を行うworkerだけへ渡す。新規登録・コード再送のレート制限とNative APIの濫用監視を公開前に確認する。
2. **PostgreSQL**: devはリポジトリ直下で `docker compose -f infra/compose.yaml up -d postgres` を実行し、`APP_ENV=dev` とローカルの `DATABASE_URL` を使う。PostgreSQL 17の既存データディレクトリを18へ直接マウントしないため、Composeは新しい `recipe-postgres-18` volumeを18系の永続化先 `/var/lib/postgresql` へマウントする。prodはCrunchy Bridge PostgreSQL 18クラスタ `prod-wagaya-recipe-book` の直接接続URLをsecret managerへ保存し、`APP_ENV=prod` を設定する。Crunchy BridgeのチームCA PEMを `DATABASE_SSL_CA` に保存し、API/workerは `rejectUnauthorized: true` でサーバー証明書を検証する。URL、CA、パスワードをリポジトリやログへ残さない。`recipe_cloud` schemaには専用DBロールだけを許可し、既存製品DBへmigrationしない。
3. **S3 / hosting**: `infra/cdk` はdevelop/prodの非公開S3をCDKで作成する。prodにはLightsail 2GB、static IP、日次snapshotを追加する。原本は `users/{auth-sub}/archives/{archive-id}.html`、サーバー経由の本人認証付き添付ダウンロードだけを提供する。runtimeは専用IAM userの最小権限credentialsをCDK管理secretから受け取り、GitHub ActionsはOIDCと一時SSH鍵を使う。初回bootstrap、運用secret、DNS、旧Terraform bucketの扱いは [infra/cdk/README.md](../../infra/cdk/README.md) を参照する。バージョニングやオブジェクトロックは削除実装を拡張するまで有効にしない。
4. **OpenAI**: 運営者のAPIキーとStructured Outputs対応のモデルIDをワーカーへ設定。利用者にはキーを要求しない。`store:false`でもプロバイダーの保持条件がゼロになるとは限らないため、正式プライバシーポリシーには実契約に従い送信/保持を記載。単一入力120,000文字、出力8,000トークン、90秒。長すぎる原文は切り捨てずエラーにし、権利を返す。
5. **RevenueCat / App Store Connect**: 新規iOSアプリとConsumable商品を作成。商品ID→権利数をサーバーの `REVENUECAT_PRODUCTS` に登録。価格はStoreKitの商品情報から表示し、サーバーに価格を固定しない。SDKは必ずClerk user IDでログインした後に購入し、匿名購入は行わない。異なるApp User IDへの購入転送を許可しない設定にする。Webhookは `POST /webhooks/revenuecat`、Authorizationを `Bearer <32文字以上の秘密>` に設定。App Store Server NotificationsもRevenueCatへ設定する。devはSANDBOXだけを受け入れ、prodはApp Store公開購入のPRODUCTIONとTestFlight購入のSANDBOXを受け入れるため `REVENUECAT_ENVIRONMENT=PRODUCTION,SANDBOX` とする。取引の一意性はstore・environment・transaction IDの組で維持し、Webhook秘密は環境ごとに分離する。
6. **API / worker**: services/api/.env.example を `.env` にコピーし必要な値を設定。`pnpm migrate` → `pnpm start` と別プロセスの `pnpm worker`。本番はDockerfileで同じimageを使い、APIは `node index.mjs`、workerは `node worker.mjs`。GitHub ActionsはSecrets ManagerからAPI用 `.env.api` とworker用 `.env.worker` を個別に生成し、OpenAI API keyとClerk Secret Keyをworkerだけに渡す。APIの前にTLS終端/アクセス制限/分散レート制限を置く。APIは認証後のJSONエンドポイントだけを公開し、既存 `server.mjs` は本番に公開しない。APIの4320番はホストの `127.0.0.1` だけに割り当て、デプロイ時の `/health` 確認に使う。公開通信はCaddyの80/443番を経由する。`/health` はDB疎通を確認する。
7. **Expo**: apps/mobile/.env.example を `.env` にコピー。API URL、Clerk Publishable Key、RevenueCat iOS SDK公開キー、正式な規約URL、bundle ID、EAS project IDを設定。Clerk DashboardのNative applicationsへTeam IDとbundle IDを登録する。参考アプリのbundle ID/EAS IDをコピーしない。`pnpm exec expo run:ios` でネイティブ開発ビルド。課金検証はExpo Goでは行わない。正式アイコン/スクリーンショット/サポートURLを作成し、EAS production build、TestFlightで受入後に提出。

## PostgreSQLの受入

devではComposeを起動後、`services/api` からmigrationと実PostgreSQL統合テストを行う。`TEST_POSTGRES_URL` は安全のためlocalhost以外を拒否する。

```sh
docker compose -f infra/compose.yaml up -d postgres
cd services/api
APP_ENV=dev mise exec -- pnpm migrate
TEST_POSTGRES_URL=postgresql://recipe:recipe@127.0.0.1:54329/recipe mise exec -- pnpm test
```

prodでは、ホスティング先のsecret managerから `APP_ENV=prod`、`DATABASE_URL`、`DATABASE_SSL_CA` をAPI、worker、migrationジョブへ注入する。migration前に対象クラスタ名が `prod-wagaya-recipe-book` であることを管理画面で再確認する。接続後は `SHOW server_version` が18系であること、`pg_stat_ssl` の現在接続で `ssl = true` かつTLS 1.2以上であること、`recipe_cloud` schemaだけにmigrationされたことを記録する。バックアップから一時的な別クラスタへ復元し、件数と主要参照を確認してからG2を完了とする。本番URL、証明書、ユーザー名、復元先の秘密は進捗文書へ記録しない。

## API概要

すべて `/v1` はClerkセッショントークンのBearer認証。署名、issuer、有効期限、authorized party、`user_...`形式のsubject、email claimをサーバー検証する。内部DB/S3キーは画面に渡さない。

| 操作 | エンドポイント |
|---|---|
| 本人・削除 | GET /me、DELETE /me `{confirm:"DELETE"}` |
| レシピ帖 | GET/POST /books、PATCH /books/:book `{name}` |
| 招待 | POST /books/:book/invites、POST /invites/accept、DELETE /books/:book/invites/:id |
| 共有 | GET /books/:book/family、PATCH /books/:book/members/:user `{role:null/editor/viewer}`、POST /books/:book/owner |
| 原本 | GET/POST /books/:book/archives、GET /archives/:id/html |
| カード化 | POST /books/:book/imports `{archiveId,requestKey,consent:true}` |
| カード | GET /books/:book/recipes、PUT /books/:book/recipes/:id `{version,card,memo}` |
| 献立 | GET/PUT /books/:book/plans/:YYYY-MM-DD `{version,items}` |
| 残高・商品 | GET /wallet、GET /products |

## 課金・ワーカーの復旧

- 購入確認の真実はDB台帳。SDKの購入結果やクライアントの金額で付与しない。Webhookを受け取れない場合は同じイベントをRevenueCatから再配信する。未登録userは503で再送を要求し、eventは記録しない。
- 購入のイベントIDと、store/environment/transaction IDをそれぞれ一意化する。返金先着にも対応。返金取消はevent_timestamp_msで新旧を判定。購入者が違う既知transactionは409として運用調査し、別ユーザーに付け替えない。
- 販売済み商品IDの権利数を変更しない。権利数を変える場合は新商品IDを作る。販売終了商品の対応表も返金/遅延通知のためサーバーに残す。
- 購入通知遅延中は画面に確認待ちを出し、残高を更新する。Consumableの端末復元に依存せず同じ認証アカウントの残高で復旧。自動reconciliationは未実装なのでWebhook失敗監視・再送が公開条件。
- ジョブは3分のリース。強制終了後は別workerが取得でき、lease tokenが異なる古いworkerの保存を拒否。最大3回実行、次の取得で失敗確定し予約を戻す。APIエラーはユーザーが原本確認後に再試行できる。外部LLMへの呼び出し自体はクラッシュ境界で再実行される可能性がある（運営者コストはat-least-once、利用者権利は一度だけ）。
- 監視項目: 最古queued時刻、期限切れprocessing、deletion_pending件数/経過、Webhook非2xx、負残高、LLMエラー率/usage、DB/S3容量。メール/HTML/トークンをログに出さない。
- DB backup/PITR、復元演習、秘密ローテーション、S3とDBの孤立原本棚卸しを公開前に設定。S3書き込み後DB commit前のクラッシュでは孤立原本が残りうる。アカウント削除時のprefix削除で回収されるが、通常の定期棚卸しは別途必要。
- アカウント削除は即時アクセス停止、workerがS3 prefix・Authを削除、DB原本を削除。失敗はpendingに残し再試行。共有カードは他の参加者に残す。課金監査用のUUID/取引/台帳は匿名化メールとともに保持し、正式な保持期間をポリシーで決める。

## 既存データの移行

現行のdataとCodex skillはそのまま利用できる。自動移行はしない。HTML原本を必要なユーザー/レシピ帖へiOSのファイル選択で保存できる。従来カード/献立の一括移行は、対象ユーザー・所有権・出典・既存カードを再課金しないルールを決めて別途実施する。

## 公開前に未完了の事項

実メール、S3/IAM、OpenAI、RevenueCat/Apple Sandbox、TestFlight、アプリからの削除後の外部データ消去を確認する。App Privacy、第三者AIへの送信同意、サイトコンテンツの利用条件、サポート/規約/返金問い合わせ、購入権商品の価格を整備する。ネイティブShare Extension（Safariの共有先に直接出す機能）は本実装に含めず、URL貼り付けとHTMLファイル選択を提供する。
