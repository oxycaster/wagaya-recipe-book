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

## シミュレーターの画面検証用デモ

実メール/API課金を使わない、メモリ上だけのテストサーバーを同梱している。本番Dockerにtestディレクトリは含めない。

```sh
# ターミナル1: services/api
mise exec -- node test/demo-server.mjs
# ターミナル2: apps/mobile
NODE_OPTIONS=--dns-result-order=ipv4first EXPO_PUBLIC_API_URL=http://127.0.0.1:4329 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:4329 EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-fixture mise exec -- pnpm exec expo start --dev-client --localhost --port 8093
# ターミナル3: apps/mobile
mise exec -- pnpm exec expo run:ios --no-bundler
```

開発クライアントの接続先は `http://127.0.0.1:8093`。デモログインは `demo@example.test` / コード `123456`。ここに表示する残高・レシピは架空のもの。デモの認証はlocalhostのテスト専用で、本番認証の検証には使わない。終了時は各プロセスをCtrl-Cで停止する。

`expo run:ios --no-bundler` が別の8081ポートを開いた場合は、開発クライアントで上記8093を選ぶ。localhostがIPv6のみでlistenされる環境では上記NODE_OPTIONSを使う（端末が要求する127.0.0.1と一致させる）。

## 内部TestFlightの実機UI確認用fixture

`testflight` build profileは、実サービス構築前の端末UI確認専用。`https://hiro-mac.tail6a2f57.ts.net:8443` を認証/API接続先にし、同じTailnetの端末だけが利用できる。MacとTailscale、fixtureプロセスが動作している間だけ利用可能で、データはfixture再起動で消える。実メール、S3、OpenAI、RevenueCat購入の検証には使わない。

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8443 http://127.0.0.1:4329
launchctl submit -l com.oxycaster.wagaya-recipe-fixture -- "$(mise which node)" "$(pwd)/services/api/test/demo-server.mjs"
curl -fsS https://hiro-mac.tail6a2f57.ts.net:8443/health
cd apps/mobile
mise exec -- eas build --platform ios --profile testflight --auto-submit
```

デモログインは `demo@example.test` / `123456`。停止時は `launchctl remove com.oxycaster.wagaya-recipe-fixture` と `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=8443 off` を実行する。通常のウェブ版を配信する443/4310設定は変更しない。

## 環境を用意する順序

1. **Supabase**: このアプリ専用プロジェクト。Email Auth有効、匿名ログイン無効、ES256/RS256署名鍵を有効にする（旧HS256キーはこのAPIでは拒否）。Email OTPテンプレートで `{{ .Token }}` を表示し、メール内リンクを踏まずコード入力で完結させる。正式SMTP、送信レート制限、CAPTCHA/濫用対策はリリース前に設定する。公開キーはモバイル、secret/service-roleキーはワーカーだけへ。
2. **PostgreSQL**: Supabaseの直接接続またはsession pooler（transaction poolerは接続オプションの動作を確認するまで使わない）。`recipe_cloud` schemaをPostgRESTの公開schemaに追加しない。専用DBロールとTLS検証を設定する。ローカルのみ `docker compose -f infra/compose.yaml up -d` が使える。既存の製品DBにmigrationをかけない。
3. **S3**: `infra/storage.tf` は新規の非公開バケット用。`terraform init` → `terraform plan -var bucket_name=...` を確認してから適用する。原本は `users/{auth-sub}/archives/{archive-id}.html`、サーバー経由の本人認証付き添付ダウンロードだけを提供。API/workerロールへ出力policyを付与。バージョニングやオブジェクトロックは削除実装を拡張するまで有効にしない。
4. **OpenAI**: 運営者のAPIキーとStructured Outputs対応のモデルIDをワーカーへ設定。利用者にはキーを要求しない。`store:false`でもプロバイダーの保持条件がゼロになるとは限らないため、正式プライバシーポリシーには実契約に従い送信/保持を記載。単一入力120,000文字、出力8,000トークン、90秒。長すぎる原文は切り捨てずエラーにし、権利を返す。
5. **RevenueCat / App Store Connect**: 新規iOSアプリとConsumable商品を作成。商品ID→権利数をサーバーの `REVENUECAT_PRODUCTS` に登録。価格はStoreKitの商品情報から表示し、サーバーに価格を固定しない。RevenueCat app IDとSANDBOX/PRODUCTIONを指定。SDKは必ずSupabase subでログインした後に購入し、匿名購入は行わない。異なるApp User IDへの購入転送を許可しない設定にする。Webhookは `POST /webhooks/revenuecat`、Authorizationを `Bearer <32文字以上の秘密>` に設定。App Store Server NotificationsもRevenueCatへ設定する。SandboxとProductionはAPI/DB/S3/認証を分ける。
6. **API / worker**: services/api/.env.example を `.env` にコピーし必要な値を設定。`pnpm migrate` → `pnpm start` と別プロセスの `pnpm worker`。本番はDockerfileで同じimageを使い、APIは `node index.mjs`、workerは `node worker.mjs`。APIの前にTLS終端/アクセス制限/分散レート制限を置く。APIは認証後のJSONエンドポイントだけを公開し、既存 `server.mjs` は本番に公開しない。`/health` はDB疎通を確認する。
7. **Expo**: apps/mobile/.env.example を `.env` にコピー。API/Supabase URL、公開キー、RevenueCat iOS SDK公開キー、正式な規約URL、bundle ID、EAS project IDを設定。参考アプリのbundle ID/EAS IDをコピーしない。`pnpm exec expo run:ios` でネイティブ開発ビルド。課金検証はExpo Goでは行わない。正式アイコン/スクリーンショット/サポートURLを作成し、EAS production build、TestFlightで受入後に提出。

## API概要

すべて `/v1` はSupabaseアクセストークンのBearer認証。UUIDパラメーターはサーバー検証。内部DB/S3キーは画面に渡さない。

| 操作 | エンドポイント |
|---|---|
| 本人・削除 | GET /me、DELETE /me `{confirm:"DELETE"}` |
| レシピ帖 | GET/POST /books、PATCH /books/:book `{name}` |
| 招待 | POST /books/:book/invites、POST /invites/accept、DELETE /books/:book/invites/:id |
| 家族 | GET /books/:book/family、PATCH /books/:book/members/:user `{role:null/editor/viewer}`、POST /books/:book/owner |
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
- アカウント削除は即時アクセス停止、workerがS3 prefix・Authを削除、DB原本を削除。失敗はpendingに残し再試行。共有カードは家族に残す。課金監査用のUUID/取引/台帳は匿名化メールとともに保持し、正式な保持期間をポリシーで決める。

## 既存データの移行

現行のdataとCodex skillはそのまま利用できる。自動移行はしない。HTML原本を必要なユーザー/レシピ帖へiOSのファイル選択で保存できる。従来カード/献立の一括移行は、対象ユーザー・所有権・出典・既存カードを再課金しないルールを決めて別途実施する。

## 公開前に未完了の事項

実メール、S3/IAM、OpenAI、RevenueCat/Apple Sandbox、TestFlight、アプリからの削除後の外部データ消去を確認する。App Privacy、第三者AIへの送信同意、サイトコンテンツの利用条件、サポート/規約/返金問い合わせ、購入権商品の価格を整備する。ネイティブShare Extension（Safariの共有先に直接出す機能）は本実装に含めず、URL貼り付けとHTMLファイル選択を提供する。
