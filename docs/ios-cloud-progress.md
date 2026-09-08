# 進捗・引き継ぎ

更新: 2026-09-09

## 現在地

P1〜P4のローカル実装・検証まで完了。iOS native simulator build成功。P5の内部TestFlight用ビルド番号3はAppleの処理を完了し、内部グループで利用可能。このbuild 3はClerk移行前のfixture版なので、UI確認専用として扱い再ビルドしない。Expo/EASは個人側の `oxycaster` で認証し、プロジェクトは `@oxycasters-organization/wagaya-recipe`。認証はClerk、DBはdevのDocker PostgreSQL 18とprodのCrunchy Bridge PostgreSQL 18 `prod-wagaya-recipe-book` に確定し、stagingは設けない。Clerk developmentの実メールOTP・セッション復元、Clerk production domainのDNS/SSL、dev PostgreSQL 18、prod PostgreSQL 18のTLS接続とmigration、非公開prod S3の基盤受入は完了。公開API/worker、実OpenAI、実課金、S3実原本保存・prodバックアップ復元は未実施。既存ローカル版のdataは変更していない。

## 引き継ぎ規則

最初に docs/ios-cloud-plan.md と本書、git status を確認。完了条件を検証してからチェックを付ける。実サービス未接続を「動作確認済み」と扱わない。秘密をログ/文書/コミットに含めない。既存dataは移動しない。

## 作業記録

- 2026-09-06: 現行React/Vite/Express/JSONとlyrical-libraryのExpo 55構成を確認。設計/受入条件を文書化。
- 2026-09-06 P1/P2: services/api に専用PostgreSQL schema、JWT認証、レシピ帖/家族/招待、S3原本、公開IP固定URL取得、OpenAI structured outputs、DBリースワーカー、購入/返金台帳、アカウント削除を追加。
- 検証: `cd services/api && mise exec -- pnpm test` → 12/12成功。PGliteで実際のPostgreSQL SQLを実行し、HTTP・権限・重複・予約/返還・ワーカー再開を検証。実PostgreSQLの複数接続ロックと実プロバイダーは別途受入が必要。
- 2026-09-06 P3: apps/mobile にExpo 55、OTPログイン、帖切替、URL/HTML保存、取り込み同意、カード編集/人数換算、献立、家族招待/権限/所有権移譲、購入、削除画面を実装。`pnpm check` 成功。Expo整合検査がReact Native 0.83.10を要求したため、参考アプリの0.83.4から互換パッチへ更新中。
- 中断直前: React Native 0.83.10へ更新済み。Metroの共有src監視を設定し、iOS bundle export成功。既存ウェブbuildと人数換算5テスト成功。JWT/削除競合の追加テストは未実行だった。
- 環境エラー: native buildは `No space left on device` で停止。Docker PostgreSQLもdaemonのmetadata.dbへのI/Oエラーで起動失敗。アプリコードの失敗とは区別する。
- 2026-09-07 再開: 変更と文書が保存されていることを確認。デモAPI/Metro/Xcodeの前回プロセスは停止済み。空き容量5.2GiBを確認し、追加テストとnative buildを再開する。他プロジェクトのプロセスやデータは変更しない。
- 再開後検証: API 14/14、mobile typecheck、Expo dependency check 成功。Docker daemonは停止状態のため既存Docker環境を起動・変更せず、実PostgreSQL検証は未実施として残す。
- P3 native: `pnpm exec expo run:ios --device 3A0CAAAF-665D-45D7-A5F3-829E17975952 --no-bundler` → Build Succeeded、0 errors / 2 dependency build warnings。iPhone 17e / iOS 26.5にインストール成功。
- UIで検出/修正: LegalLinksのView直下の空白文字を除去。React Native互換のAbortControllerタイマーへ変更。当時の認証SDK向けSecureStore処理を修正。この認証実装は後のClerk移行で削除した。
- UI確認（ローカルfixtureのみ）: demo@example.testのOTPログイン、レシピ一覧/詳細、2→4人分で小松菜1→2束/油揚げ1→2枚/だし200→400ml、献立に小松菜を追加して残り物/3人分を保存しタブ再表示でも保持、URL保存→カード化→完了、残高7→6回分/予約0を確認。端末再起動後のセッション復元は未検証。家族の権限/招待はAPI統合テストで確認し、実招待送信はしていない。
- P4: `terraform fmt infra`、`terraform init -backend=false`、`terraform validate` 成功。AWS provider 6.63.0をlockfileに固定。apply/リモート変更は実施していない。Docker起動は前述の環境障害により未検証。
- 容量: この作業で生成したinfra/.terraformキャッシュ（778MB）とXcodeの該当DerivedData内Build/Intermediates.noindex（907MB）だけ削除。他のプロジェクト/原本/既存アプリのキャッシュは削除していない。nativeの再コンパイルには空き容量を確保すること。
- 後半の追加UI操作はComputer Useの「user changed app」およびScreenCaptureKitエラーで中止。上記確認済み操作の結果とは分ける。新しいレシピ帖の作成UIや実購入/実削除を確認済みとは扱わない。
- 最終差分で `apps/mobile: pnpm check` と `pnpm export:ios` を再実行し成功（4.4MB Hermes bundle）。S3 adapterの初期化も成功。`git diff --check` に問題なし。
- 2026-09-07 画像表示改善: HTMLのRecipe JSON-LD/OGP/本文から代表画像を選び、SSRF対策を共有した取得処理でJPEG/PNG/WebP/GIFを最大5MBまで検査してユーザー領域へ保存。カード化成功時に共有帖領域へ複製し、会員だけが `/v1/recipes/:id/image` から取得できるようにした。アプリは一覧カード、詳細、献立に `expo-image` で表示し、端末への永続キャッシュは行わない。画像なし/取得失敗時も分類色のアートワークを表示する。
- 画像改善の検証: `services/api: pnpm test` → 16/16成功（候補選択、相対URL、共有メンバーの画像取得、部外者拒否、HTTP画像配信を含む）。`apps/mobile: pnpm check`、Expo依存関係検査、`pnpm export:ios` 成功。iPhone 17eシミュレーターで、一覧3件と詳細画面に画像領域/分類別アートワーク、分類・所要時間のオーバーレイが表示されることを確認した。既に保存済みで画像メタデータのないカードは分類別アートワークになり、元画像を付けるには再取り込みまたは将来のバックフィルが必要。
- 2026-09-07 レシピ帖名変更: owner限定の `PATCH /v1/books/:book` と、「設定」タブの名前編集欄を追加。前後の空白を除去し、1〜100文字に制限する。viewer/editorは説明だけを表示し、APIでも拒否する。統合テストでownerの変更が家族の一覧へ反映され、viewerの変更が拒否されることを確認。API 16/16、モバイル型検査に成功。iPhone 17eシミュレーターで「わが家の一冊」から「週末のレシピ」へ変更し、画面見出し・帖切替ボタン・入力欄へ即時反映されることも確認した。
- 2026-09-08 TestFlight準備: 誤って使った企業側Expoセッションをログアウトし、`oxycaster` / `oxycaster@gmail.com` へ切替確認。`oxycasters-organization` 所有のEAS project `wagaya-recipe` を新規作成し、専用bundle ID `com.oxycastersorganization.wagayarecipe` と内部TestFlight profileを設定。1024px・不透明PNGのアプリアイコンを追加した。
- 実機UI用接続: 既存の443/4310配信を維持したまま、Tailnet限定HTTPS 8443をfixtureの4329へ追加。ローカルとTailnet URLの `/health` がともに200を返すことを確認し、fixtureをlaunchdの `com.oxycaster.wagaya-recipe-fixture` として起動した。fixtureは実サービスではなく、Mac停止/再起動やプロセス停止時には利用できない。
- TestFlight提出前検証: 既存ウェブbuild、人数換算5/5、クラウドAPI 16/16、モバイル型検査、Expo依存関係検査、EAS testflight設定解決がすべて成功。次はApple配布証明書/Provisioning ProfileをEASで確定し、ビルドとApp Store Connectへのアップロードを行う。
- 2026-09-08 TestFlight提出: Apple ID `oxycaster@gmail.com`、Apple Team `Hironao Sekine (N8FN3LCG22)` で認証。bundle IDをApple Developerへ登録し、既存の配布証明書と新規Provisioning Profileを使用した。EAS build `f82a3a9a-b524-4731-baa3-7a0fbd6d8efc`（version 0.1.0、build 3）は成功。
- App Store Connectにアプリ `わが家のレシピ帖`（ASC App ID `6809590497`）と内部グループ `Team (Expo)` を作成し、`oxycaster@gmail.com` を有効化。EAS submission `c7e8ecec-148e-4166-a6f3-34c5a7694628` は `FINISHED` となり、バイナリのアップロードに成功した。現在はApple側の処理待ちで、TestFlight上でのインストール・起動はまだ未検証。
- 初回の自動提出はテスト説明文（changelog）がExpo Enterprise限定だったため提出予約だけ失敗した。ビルド自体への影響はなく、説明文を外した `eas submit --platform ios --id f82a3a9a-b524-4731-baa3-7a0fbd6d8efc --profile testflight` で提出を完了した。
- 2026-09-08 TestFlight配信確認: App Store Connectでbuild 3が「提出準備完了」、内部グループ `Team (Expo)` に1ビルド・1テスターが設定されていることを確認。`oxycaster@gmail.com` の状態は「招待済み」で、同アドレスのGmailにAppleの招待メールが到着済み。招待コードは秘密情報として文書・コミットに保存しない。
- 2026-09-08 公開計画: `docs/app-store-release-plan.md` を追加。内部実機確認から公開仕様、本番クラウド、実OpenAI、課金、法務/Privacy、ストア素材、production TestFlight、App Review、公開後確認までをM0〜M7に分割し、G0〜G7の公開可否ゲートと即時中止条件を定義した。公開作業自体は未着手。
- 2026-09-08 DB/環境設計更新: 環境をdev/prodの2つに限定。devはDocker PostgreSQL 18、prodはCrunchy Bridge PostgreSQL 18クラスタ `prod-wagaya-recipe-book` とした。Composeを18へ更新し、17系データ領域の直接再利用を避ける `recipe-postgres-18` volumeへ変更。APIは `APP_ENV` を検証し、prodではsecret managerから渡すCrunchy BridgeチームCAを必須にして証明書検証を有効化した。実クラスタへの接続、migration、バックアップ復元は未実施。
- DB設定検証: `cd services/api && mise exec -- pnpm test` → 22/22成功。devでTLSを暗黙に有効化しないこと、prodでCA必須・証明書検証有効、未知の環境名拒否を含む。`docker compose -f infra/compose.yaml config` と `git diff --check` も成功。実コンテナ起動はDocker Desktop停止中（`docker.sock` なし）のため未実施であり、PostgreSQL 18への実接続成功とは扱わない。
- 2026-09-08 Clerk移行: 認証基盤をClerkに確定。Expoへ `@clerk/expo` とSecureStore token cacheを追加し、既存画面のメールOTPサインイン/初回サインアップをClerk custom flowへ変更。APIはRS256署名、issuer、期限、authorized party、Clerk user ID、email custom claimを検証する。workerの退会処理は `@clerk/backend` のユーザー削除へ変更。DB/RevenueCatのuser ID列をClerkの文字列IDへ変更し、旧認証SDK依存を削除した。
- Clerk development設定: 個人側 `oxycaster@gmail.com` の専用application `わが家のレシピ帖`（application ID `app_3J2juS9C8sR1rgcUe5PqwVskwsS`、development instance `ins_3J2juSKSvtjScLxuXWCAegfg2vh`）を作成してリポジトリへリンク。メールコードのみ、パスワード/Googleログイン無効、primary email変更不可、session tokenの `email` claim、Native API有効をCLIで確認した。Publishable Keyは公開設定としてdev/TestFlightへ使用し、Secret Keyはignoredのローカルenvへ保存した。この時点では実メール受信と実機ログインは未検証で、9月9日にSimulator受入を実施した。企業側Clerk workspaceへ誤作成した同名application `app_3J2jPxM3Di6eKuSNRMqIAovb4H1` は、ユーザー承認後に削除し、企業側のapplication一覧から消えたことを確認した。
- Clerk移行検証: `services/api: pnpm test` → 22/22、`apps/mobile: pnpm check`、`expo install --check`、`pnpm export:ios` が成功。iOS bundleは5.4MB。実際のClerk形式のユーザーIDで家族権限と所有権移譲を検証し、所有権移譲APIに残っていたUUID検証も文字列IDへ修正した。development issuerを読み込んだメモリAPIは別ポートで起動し、`/health` 200を確認。コード・追跡対象文書・lockfileから旧認証サービスの依存と参照が0件であることも確認。この時点ではClerkの実メールと端末セッション復元は未検証で、9月9日にSimulator受入を実施した。production instance、prod秘密設定、退会後のClerkユーザー削除は引き続き未検証。
- 2026-09-09 Clerk development受入: `expo prebuild --platform ios --clean` でClerk native packageを含むiOS生成物を作り直し、iPhone 17e / iOS 26.5 Simulator向けのnative buildに成功（0 errors / dependency warnings 2件）。生成されたdeployment targetは17.0。起動時に検出したReact 19.2.0 / React DOM 19.2.8の不一致は `react-dom` 19.2.0固定で解消した。
- 認証UIで検出/修正: Clerkの結果エラーコードが `errors[0].code` に入る形式へ対応し、未登録メールがサインアップへ進まず停止する問題を修正。確認コードやトークンは文書・コミットへ記録していない。
- 実メール認証確認（Clerk development + Simulator + メモリAPI）: 運営者メールで新規登録し、確認メール受信、OTP検証、認証付きAPIでレシピ帖作成まで成功。アプリを完全終了・再起動してもログイン状態を復元し、ログアウト後の既存ユーザー再ログインで同じレシピ帖を再表示できた。物理iPhone、production instance、アカウント削除後のClerkユーザー消去は未検証。
- 2026-09-09 再検証: `apps/mobile: pnpm check`、`expo install --check`、`pnpm export:ios` が成功。iOS bundleは5.4MB。development APIは4329のbuild 3 fixtureと分離して127.0.0.1:4330、Metroは127.0.0.1:8093で起動した。
- 2026-09-09 dev PostgreSQL 18受入: Docker Desktopは古いbackendプロセスが残ってAPI socketを作れない状態だったため、停止済みdaemonの残存プロセスを終了して再起動した。`postgres:18-alpine`を取得し、専用volume `infra_recipe-postgres-18` のコンテナを起動。PostgreSQL 18.6、healthy、127.0.0.1:54329だけでlistenしていることを確認した。
- 実DB検証: `APP_ENV=dev DATABASE_URL=postgresql://recipe:recipe@127.0.0.1:54329/recipe pnpm migrate` → `Schema ready`。`TEST_POSTGRES_URL=postgresql://recipe:recipe@127.0.0.1:54329/recipe pnpm test` → 実PostgreSQL上の専用一時DBで22/22成功。家族権限、台帳の冪等性、残高1の同時予約、lease、削除競合、Clerk JWT、dev/prod DB設定を含む。prodクラスタへの接続・migration・復元は未実施。
- 2026-09-09 prod DB作成開始: Crunchy Bridgeの個人team `wagaya-recipe-book` にクラスタが存在しないことを確認。ユーザー承認後、`prod-wagaya-recipe-book`、AWS Tokyo、PostgreSQL 18、Hobby-0（0.5GB / 2 vCPU）、10GB、HAなし、月額12.70 USDで作成を開始した。チームに支払い方法がないためStripeの支払い情報入力画面で停止しており、クラスタはまだ作成されていない。カード情報は入力・取得・保存していない。
- 2026-09-09 prod DB初期受入: ユーザーによる支払い情報登録後、Crunchy Bridgeクラスタ `prod-wagaya-recipe-book`（cluster ID `wzxlazzkdfbqlntlndganmzn4q`）がreadyになった。`application` ロールとチームCAを使い `APP_ENV=prod pnpm migrate` → `Schema ready`。PostgreSQL 18.6、TLS 1.3、`recipe_cloud` の12テーブル、`public` の業務テーブル0件、実行時search_pathが `recipe_cloud` であることを実接続で確認した。接続URL、CA、パスワードは文書・リポジトリ・ログへ保存していない。
- prod DB保護: クラスタ削除保護を有効化し、メンテナンス枠を18:00〜21:00 UTC（日本時間03:00〜06:00）へ固定。初期のIPv4/IPv6全公開ルールを削除し、暫定的に作業端末のIPv4 1件だけへ制限した。マイグレーション後の手動バックアップ `20260908-171430F` が完了したことを確認。公開API配置時は作業端末ルールをAPIの固定egressへ置換する。
- Crunchy Bridge Production Check: 保護、メンテナンス枠、statement timeout、query log threshold、pgbouncer、Postgresユーザー非使用、主キー枯渇検査は合格。Hobby planのためproduction instanceとHAが不合格で、log drainも未設定。費用増を伴うプラン/HA変更、ログ転送先の選定、別クラスタへのバックアップ復元は未実施であり、App Store公開ゲートG2は未完了。
- Clerk production準備確認: `clerk doctor --json` は認証・個人applicationへのlink・CLI 3.3.0を正常確認。当初は所有ドメイン未確定のためwizardを停止したが、後続作業で `oxycaster.com` に確定した。
- 2026-09-09 Clerk production受入: production instance `ins_3J3T9d1wKbtkYPlVhRH8W9xXwju` の本番ドメインを `wagaya.oxycaster.com` に変更し、Secondary applicationとして認証基盤も同じサブドメインに隔離した。Route 53へClerk指定CNAME 5件を追加し、DNS・SSL・mailがすべてcomplete。prod設定はdevと同一で、メールコードのみ、primary email必須/変更不可、sessionの `email` claimを確認した。production keyはまだファイルへ取得していない。
- 2026-09-09 prod S3基盤受入: AWS Tokyoに `prod-wagaya-recipe-book-archives-619330834313` をTerraformで作成。Public Access Block 4項目、BucketOwnerEnforced、AES256 SSE、非TLS拒否のbucket policyを実設定で確認し、匿名head requestは拒否された。バケットversioningは導入していない。API/worker用IAMロール、S3への実HTML/画像保存・削除、孤立object棚卸しは未実施。
- Terraform stateは現時点でignoredの `infra/terraform.tfstate` にだけ存在する。次のインフラ変更前に、専用のversioning有効・暗号化済みstate bucketとS3 backendへ移行し、stateを共有可能にする。stateやcredentialをGitへ追加しない。

## 次のエージェントが行うこと

1. `git status`、`docs/app-store-release-plan.md`、本書を読む。主要実装は `codex/ios-cloud-testflight` の `53708da` にコミット済み。文書の更新履歴は後続commitを確認する。`.codex/environments/environment.toml` は本実装に含めていない。
2. Clerk production domainは受入済み。API/workerホスティング先のsecret managerへ新しいproduction publishable/secret keyを保存し、Native API、`email` session claim、authorized partyを本番buildで再確認する。development instanceの登録・再送・ログイン・再起動はSimulatorで確認済み。物理iPhoneと、隔離したテストユーザーによる退会後のClerkユーザー消去を確認する。
3. dev Docker PostgreSQL、prod Crunchy Bridge PostgreSQL、prod S3の基盤受入は完了。次はAPI/workerのホスティング先、最小権限IAMロール、固定egress/secret managerを決め、DBの暫定operator IPを置換する。Production Checkで残るproduction instance/HA/log drain、別クラスタへのバックアップ復元はG2完了前に判断・検証する。外部環境ではA/B/Cユーザーのアクセス境界、実HTMLの保存と抽出、Sandbox購入の重複/返金/復元、アカウント削除のS3/Auth消去を確認する。
4. iPhoneのTestFlightで `oxycaster@gmail.com` 宛ての招待コードを引き換え、build 3をインストールする。iPhoneとMacを同じTailnetへ接続した状態でfixture版のUIを検証する。その後、商品価格/規約/プライバシー/サポートURL、監視・バックアップ・Webhook再送手順を確定し、実クラウド接続版のTestFlightへ進む。
5. 現行カード/献立の一括移行、Safari Share Extensionは本実装の対象外。現在のiOSはURL貼り付け・保存HTMLファイル選択で取り込む。追加する場合は計画を更新する。

## 主なファイル

| 場所 | 役割 |
|---|---|
| services/api/schema.sql、domain.mjs | DB、共有/招待、権限、原本メタデータ、カード、献立、権利予約 |
| services/api/auth.mjs、app.mjs | JWT検証、HTTP API、入力・Webhook認証 |
| services/api/billing.mjs、jobs.mjs | 冪等な付与/返金、リースと一回消費、削除再試行 |
| services/api/extractor.mjs、storage.mjs、fetch-html.mjs | 外部サービス境界、出典照合、SSRF対策 |
| services/api/test/cloud.test.mjs | 22件の統合テスト。PGliteまたは専用ローカルPostgreSQL |
| services/api/test/demo-server.mjs | localhost限定・メモリ上の画面テスト用fixture。Dockerから除外 |
| apps/mobile/app/index.tsx、src/client.ts | ネイティブ画面、Clerkセッション、API・課金SDK |
| apps/mobile/app.config.ts、eas.json | iOS/ビルド設定。本番に必要な環境変数を検証 |
| infra/storage.tf、services/api/Dockerfile | S3とAPI/workerの配置用構成 |

## ローカル実行状態（最終検証時）

TestFlight実機確認用の旧デモAPI（127.0.0.1:4329）はlaunchd `com.oxycaster.wagaya-recipe-fixture` で起動し、Tailscale ServeのTailnet限定HTTPS 8443から転送中。Clerk development確認用API（127.0.0.1:4330）とMetro（127.0.0.1:8093）も起動中。dev PostgreSQL 18.6コンテナは127.0.0.1:54329でhealthy。Mac停止・再起動後は状態を再確認する。シミュレーターにClerk native development buildをインストール済み。デモの再起動手順はrunbookに記載。両fixtureのDBはメモリ上なのでプロセス再起動で初期化され、PostgreSQLデータは専用Docker volumeに残る。
