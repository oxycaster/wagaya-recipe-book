# 進捗・引き継ぎ

更新: 2026-09-08

## 現在地

P1〜P4のローカル実装・検証まで完了。iOS native simulator build成功。P5の内部TestFlight用ビルド番号3はAppleの処理を完了し、内部グループで利用可能。このbuild 3はClerk移行前のfixture版なので、UI確認専用として扱い再ビルドしない。Expo/EASは個人側の `oxycaster` で認証し、プロジェクトは `@oxycasters-organization/wagaya-recipe`。認証はClerk、DBはdevのDocker PostgreSQL 18とprodのCrunchy Bridge PostgreSQL 18 `prod-wagaya-recipe-book` に確定し、stagingは設けない。Clerk development instanceは設定済み。production instance、prod DB接続、公開、実課金、実メール、実OpenAI/S3は未実施。既存ローカル版のdataは変更していない。

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
- Clerk development設定: 個人側 `oxycaster@gmail.com` の専用application `わが家のレシピ帖`（application ID `app_3J2juS9C8sR1rgcUe5PqwVskwsS`、development instance `ins_3J2juSKSvtjScLxuXWCAegfg2vh`）を作成してリポジトリへリンク。メールコードのみ、パスワード/Googleログイン無効、primary email変更不可、session tokenの `email` claim、Native API有効をCLIで確認した。Publishable Keyは公開設定としてdev/TestFlightへ使用し、Secret Keyはignoredのローカルenvへ保存した。実メール受信と実機ログインは未検証。企業側Clerk workspaceへ誤作成した同名application `app_3J2jPxM3Di6eKuSNRMqIAovb4H1` は削除未実施。
- Clerk移行検証: `services/api: pnpm test` → 22/22、`apps/mobile: pnpm check`、`expo install --check`、`pnpm export:ios` が成功。iOS bundleは5.4MB。実際のClerk形式のユーザーIDで家族権限と所有権移譲を検証し、所有権移譲APIに残っていたUUID検証も文字列IDへ修正した。development issuerを読み込んだメモリAPIは別ポートで起動し、`/health` 200を確認。コード・追跡対象文書・lockfileから旧認証サービスの依存と参照が0件であることも確認。Clerkのproduction instance、prod秘密設定、実メール、端末セッション復元、退会後のClerkユーザー削除は未検証。

## 次のエージェントが行うこと

1. `git status`、`docs/app-store-release-plan.md`、本書を読む。主要実装は `codex/ios-cloud-testflight` の `53708da` にコミット済み。文書の更新履歴は後続commitを確認する。`.codex/environments/environment.toml` は本実装に含めていない。
2. Clerkのproduction instanceへメールコード認証、Native API、`email` session claim、authorized partyを設定する。development instanceでは新しいdevelopment buildを使い、登録・再送・ログイン・再起動・退会を実機確認する。
3. devのDocker PostgreSQL 18で複数接続テストを行う。続いてprodの `prod-wagaya-recipe-book` へmigrationし、PG18/TLS/権限、バックアップ復元を確認する。外部環境ではA/B/Cユーザーのアクセス境界、実メールOTP、実HTMLの保存と抽出、Sandbox購入の重複/返金/復元、アカウント削除のS3/Auth消去を検証する。
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

TestFlight実機確認用のデモAPI（127.0.0.1:4329）はlaunchd `com.oxycaster.wagaya-recipe-fixture` で起動し、Tailscale ServeのTailnet限定HTTPS 8443から転送中。Mac停止・再起動後は状態を再確認する。Metro（127.0.0.1:8093）は停止済み。シミュレーターにアプリはインストール済み。デモの再起動手順はrunbookに記載。テスト用DBはメモリ上なので再起動で初期化される。
