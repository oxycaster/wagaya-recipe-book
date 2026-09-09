# App Store公開計画

作成: 2026-09-08 / 更新: 2026-09-09 / 対象: iOS版「わが家のレシピ帖」 / 状態: 計画初稿完成、M0実機確認中

## 1. 公開目標

利用者が自分のメールアドレスで登録し、家族とレシピ帖を共有し、取り込み権をApp内課金で購入して、保存したHTMLをOpenAIでレシピカード化できるiOSアプリをApp Storeで公開する。

公開候補は、Tailnet内のfixtureへ接続する現在のbuild 3ではなく、prodのClerk、Crunchy Bridge PostgreSQL 18クラスタ `prod-wagaya-recipe-book`、S3、API/worker、OpenAI、RevenueCatへ接続した新しいproduction buildとする。Clerkには本人確認に必要な情報だけを持たせ、レシピデータは保存しない。既存ウェブ版と `data/` は移動・削除・自動移行しない。

## 2. 現在地

### 完了済み

- Expo/EASプロジェクト `@oxycasters-organization/wagaya-recipe` とApp Store Connectアプリを作成済み。
- bundle IDは `com.oxycastersorganization.wagayarecipe`。
- iOS 0.1.0 build 3は内部TestFlightで利用可能。
- ローカルfixtureで認証、一覧、画像、詳細、献立、取り込み、レシピ帖名変更を確認済み。
- Clerk development instanceで実メールOTPによる新規登録・再ログイン、アプリ再起動後のセッション復元、認証付きAPIでのレシピ帖作成をSimulator確認済み。
- Clerk production instanceを `wagaya.oxycaster.com` のSecondary applicationとして作成し、Route 53のCNAME、DNS・SSL・メール検証まで完了。
- devのDocker PostgreSQL 18.6へmigrationし、専用一時DBを使う22件の複数接続統合テストを確認済み。
- prodのCrunchy Bridge PostgreSQL 18.6へTLS 1.3で接続し、`recipe_cloud` schemaのmigration、削除保護、定期メンテナンス枠、全公開firewallの撤去、手動バックアップを確認済み。
- prod S3バケットを作成し、全公開遮断、AES256暗号化、BucketOwnerEnforced、非TLS拒否を確認済み。
- 本番API/workerをLightsailへGitHub Actionsから配備し、独自HTTPS、Route 53、Crunchy Bridge固定IP接続、デプロイ後のSSH閉鎖を確認済み。
- プライバシーポリシー、利用規約、サポートページを本番HTTPSで公開し、アプリ用EAS production環境へURLを登録済み。
- APIの権限、取り込み権台帳、ジョブ再開、アカウント削除をPGlite統合テストで確認済み。

### 公開を止めている事項

- build 3はMac上のfixtureへTailnet経由で接続するため一般公開できない。
- production build 4は本番設定の読込まで成功したが、Apple provisioning profileにSign in with Apple capabilityがなくXcode buildで停止。App IDのcapability有効化とprofile再生成が必要。
- prod Clerkの実メール認証、S3実原本保存、認証付き公開API、実OpenAIは未受入。Crunchy BridgeはHobby plan・HAなし・log drain未設定で、別クラスタへのバックアップ復元も未検証。
- App Store ConnectのConsumable商品は下書き登録済みで、RevenueCatにも同じproduct IDをConsumableとして登録済み。RevenueCatのApp Store Connect APIとIn-App Purchase Keyは有効。両商品は審査用情報が未完了のため `Missing Metadata` で、Sandbox購入、返金、通知再送は未検証。
- App Privacy、年齢区分、コンテンツ権利、ストア説明・スクリーンショットが未確定。価格と販売地域は確定済み。
- 実サービス上のアカウント削除、バックアップ復元、監視通知を確認していない。

## 3. 公開方針として先に決める事項

以下はM1着手前にプロダクト所有者が確定する。未確定のまま課金商品やストア素材を作らない。

| 項目 | 推奨する初回公開案 | 決定状態 |
|---|---|---|
| 販売地域・言語 | 日本、ja-JP | 決定。商品配信地域も日本だけに設定済み |
| 対応端末 | iPhoneのみ。iPad対応する場合は専用QAと画像を追加 | 未決定。現在は `supportsTablet: true` |
| 最低OS | iOS 17以上 | 現在のClerk native buildの実装要件。M1で公開仕様として確定 |
| 公開方法 | 審査承認後に手動公開 | 未決定 |
| 初回バージョン | 1.0.0へ更新 | 未決定。現在は0.1.0 |
| 取り込み権 | Consumable 10回分: 150円、50回分: 600円。商品IDは `com.oxycastersorganization.wagayarecipe.import10` / `com.oxycastersorganization.wagayarecipe.import50`。販売地域は日本のみ | App Store ConnectとRevenueCatへ登録済み。API連携は有効。本番の商品対応表も保存済み。審査用メタデータとSandbox受入は未完了 |
| 初回データ移行 | なし。新規アカウントから開始 | 提案 |
| Safari共有拡張 | 初回公開には含めない | 提案 |
| 問い合わせ窓口 | 専用メールとWebフォーム | 未決定 |
| データ保持 | 原本、カード、課金監査、削除待ちの保持期間を明文化 | 未決定 |

## 4. マイルストーン

| ID | 工程 | 主な成果物 | 完了条件 | 目安 |
|---|---|---|---|---|
| M0 | build 3実機確認 | 不具合一覧、端末スクリーンショット | 招待受諾、主要画面・画像・帖名変更・再起動後セッションを実機確認 | 0.5〜1日 |
| M1 | 公開仕様確定 | 上表の決定、価格表、保持方針 | 未決定項目に責任者と確定値がある | 0.5〜1日 |
| M2 | 本番クラウド構築 | dev/prod環境、秘密管理、監視、バックアップ | 実サービスの疎通・権限境界・復元演習が成功 | 2〜4日 |
| M3 | 認証・AI受入 | 実OTP、S3原本、OpenAIカード化 | 実HTMLで成功/要確認/失敗を確認し、権利残高が正しい | 1〜2日 |
| M4 | 課金受入 | Consumable商品、RevenueCat、Webhook | Sandbox購入・重複通知・返金・再ログイン後残高を確認 | 2〜3日 |
| M5 | 法務・ストア素材 | 規約、Privacy、Support、説明、画像、審査メモ | App Store Connectの必須項目とprivacy manifest監査が完了 | 2〜4日 |
| M6 | Release Candidate | production TestFlight build | 回帰・実機・障害系・削除を本番相当環境で合格 | 2〜3日 |
| M7 | 審査・公開 | App Review提出、公開版 | 審査承認後、手動公開し本番監視と購入確認が正常 | Apple審査期間を除き0.5〜1日 |

順調な場合の作業量は10〜18営業日を見込む。Apple審査、規約レビュー、外部サービス契約、DNS反映は別に変動する。

## 5. 作業詳細

### M0 内部TestFlight実機確認

- iPhoneのTestFlightで招待を受諾し、build 3をインストールする。
- iPhoneとMacを同じTailnetへ接続し、fixtureの `/health` を確認する。
- OTPログイン、セッション復元、レシピ一覧の画像、詳細、人数変更、献立、URL/HTML取り込み、帖作成・切替・名前変更、家族画面、購入画面、削除確認画面を確認する。
- 文字切れ、Dynamic Type、VoiceOverの主要ラベル、ダークモード設定との不整合、オフライン時の表示を確認する。
- build 3で見つけた不具合はproduction設定と混ぜずに修正し、必要ならfixture版buildを更新する。

完了条件: P0/P1相当の表示・操作不具合がなく、実機の記録を `docs/ios-cloud-progress.md` に残している。

### M1 公開仕様と責任範囲

- アプリ名、サブタイトル、カテゴリ、販売地域、対応端末、最低OS、問い合わせ先を確定する。
- 10回分150円・50回分600円（税込）の商品を、上記の商品IDで登録する。失敗、要確認、タイムアウト、処理中断では取り込み権を返還する。返金はAppleの手続きを案内し、RevenueCat通知で残高を調整する。
- URLから取得した第三者サイトのHTML・画像を、利用者の指示で私的なレシピカードに変換する機能について、対象サイトの利用条件、著作権、削除依頼対応を確認する。
- 家族共有時に共有されるカード・画像・メモと、共有されない原本HTMLの境界を規約と画面説明で一致させる。
- 招待制の家族共有をユーザー生成コンテンツとして扱い、規約同意、メンバー削除、通報・ブロック、運営問い合わせの必要範囲を確定する。
- 課金台帳など法令上保持する情報と、アカウント削除時に消す情報の保持期間を決める。

完了条件: 価格・地域・端末・問い合わせ・保持期間・コンテンツ方針が文書化され、App内表示とストア説明に同じ内容を使える。

### M2 専用クラウド環境

環境はdevとprodの2つだけとし、stagingは作らない。devはローカルDocker PostgreSQL 18、prodはCrunchy Bridge PostgreSQL 18クラスタ `prod-wagaya-recipe-book` を使い、既存製品の環境や利用者を流用しない。

1. Clerkアプリのdevelopment/production instanceをdev/prodへ対応させ、メールOTP、Native API、濫用対策、JWT issuer/公開鍵/authorized party、`email`カスタムsession claimを設定する。Clerkにはレシピデータを保存しない。
2. `prod-wagaya-recipe-book` へ `recipe_cloud` schemaをmigrationする。アプリ用の最小権限ロール、接続数上限、チームCAによるTLS証明書検証、バックアップ/PITRを設定する。
3. 非公開S3バケットとAPI/worker用IAMロールを作り、Public Access Block、TLS、暗号化、CORS不要を確認する。
4. APIとworkerを常時稼働環境へ配置し、独自HTTPSドメイン、分散レート制限、secret managerを設定する。
5. DBのPITR/backup、復元手順、S3孤立原本の棚卸し、秘密ローテーション手順を作る。
6. queued滞留、lease切れ、削除待ち、Webhook非2xx、負残高、LLM失敗率、DB/S3容量へ通知を設定する。

完了条件:

- 本番相当の複数DB接続でAPI統合テストが通る。
- A/B/Cユーザーでowner/editor/viewer/部外者のアクセス境界が通る。
- API停止、worker停止、DB再接続、ジョブ再取得を確認する。
- バックアップから別の検証DBへ復元できる。
- ログにメール本文、HTML、JWT、APIキーが出ない。

### M3 実認証・S3・OpenAI

- 運営者所有のOpenAI Projectをこのアプリ専用に作り、workerだけにAPIキーを渡す。利用者にはキーを要求しない。
- Responses APIは `store: false`、Structured Outputs、固定したモデルsnapshotで実行する。モデル変更は抽出fixtureと実サイト標本で回帰してから反映する。
- OpenAIの標準APIでは、APIデータは学習に使われない一方、標準のabuse monitoring logsは最長30日保持され得る。ZDR/MAMの契約有無を確定し、実際の条件を同意文とプライバシーポリシーへ記載する。
- 代表的な20〜50サイトと、複数レシピ、ログイン必須、巨大HTML、画像なし、拒否、タイムアウトを受入標本にする。原本は保存し、複数候補を自動確定しない。成功した各リクエストのOpenAI usageを集計し、取り込み1回あたりのP50/P95原価を確認する。
- 初回公開の原価上限は、モデル入力40,000文字・出力2,000トークンとする。P95原価がApple手数料控除後の販売額を継続して上回る場合、販売を止め、上限または価格を見直す。
- S3の本人専用原本、共有カード画像、退会後prefix削除を実データで確認する。

完了条件: 成功時だけ1権利を消費し、`needs_review`、失敗、タイムアウト、worker再起動では権利を失わない。原本を他ユーザーが取得できない。

### M4 App内課金

- App Store ConnectでConsumable商品を新規作成する。販売済み商品の権利数は後から変えず、変更時は新商品IDを追加する。
- Paid Apps Agreement、税務情報、銀行口座、販売地域を確認する。
- RevenueCatにiOSアプリ、商品、公開SDKキー、App Store Connect連携を設定する。Sandboxイベントはdev、Productionイベントはprodだけで受け入れ、Webhook秘密を分離する。
- RevenueCat WebhookのBearer secret、App Store Server Notifications、再送手順、アラートを設定する。
- Clerk user IDをRevenueCat App User IDとして使用し、匿名購入や別ユーザーへの購入転送を許可しない。

Sandbox受入:

- 10回分・50回分の購入、キャンセル、保留、失敗、重複タップ。
- 同じevent/transactionの再送で二重付与されない。
- 購入直後にアプリを終了してもWebhook後に残高が反映される。
- 再インストールまたは別端末で同じアカウントへログインするとサーバー残高が復旧する。
- 返金通知の先着・後着で同じ残高になり、負残高では新規取り込みを止める。

完了条件: クライアントの申告や表示価格を根拠に付与せず、App Store取引とサーバー台帳だけで最終残高が確定する。

### M5 法務、プライバシー、ストア情報

公開HTTPSで次を用意し、アプリ設定画面とApp Store Connectに登録する。

- プライバシーポリシー: メール、認証ID、HTML/画像、家族共有、OpenAI送信、S3、RevenueCat、ログ、保持期間、削除、問い合わせ。
- 利用規約: 取り込み権、返金、禁止利用、第三者コンテンツ、抽出誤り、家族共有、サービス変更。
- サポートページ: 連絡先、よくある質問、障害情報、削除/返金手順。
- `EXPO_PUBLIC_SUPPORT_URL` をproduction必須設定に追加し、アプリの設定画面からサポートページを開けるようにする。

App Store Connect:

- ja-JPの名称、サブタイトル、説明、キーワード、カテゴリ、プロモーション文、サポートURL、プライバシーURL、著作権表記。
- App Privacyは自社サーバーとClerk、OpenAI、RevenueCatを含む実際のデータフローから回答する。
- メールアドレス、ユーザーID、ユーザーコンテンツ、購入履歴、診断情報について、収集・本人との関連付け・利用目的をデータフロー表と照合する。
- 年齢区分質問票、コンテンツ権利、輸出コンプライアンス、広告ID/追跡なしを確認する。
- privacy manifestと全SDKのPrivacy Nutrition Label材料をXcodeのprivacy reportで照合する。
- iPhoneの最大必要サイズで、実際のproduction相当画面から1〜10枚のスクリーンショットを作る。iPad対応を残す場合はiPadもQAし、必要画像を用意する。
- 審査メモに、メールOTP、レシピ取り込み、OpenAI送信同意、家族共有、Consumableの用途、アカウント削除場所を説明する。
- 審査用アカウントまたはOTP確認手段、十分な取り込み権、安定したサンプル原本を用意する。ローカルfixtureやTailnetを審査に使わない。

完了条件: App Store Connectの必須項目に警告がなく、プライバシーポリシー、App Privacy、実装のデータフローが一致する。

### M6 Release Candidate

production profileにはEASの環境変数/secretを使い、`eas.json` に秘密を記録しない。fixture用 `testflight` profileと本番profileを混同しない。

リリース前検証:

```sh
mise exec -- pnpm build
mise exec -- node --test tests/quantities.test.mjs
cd services/api && mise exec -- pnpm test
cd ../../apps/mobile && mise exec -- pnpm check
mise exec -- pnpm exec expo install --check
mise exec -- pnpm export:ios
mise exec -- eas config -p ios -e production --non-interactive
mise exec -- eas build --platform ios --profile production
```

production TestFlightで次を確認する。

- 新規登録、OTP、再起動、サインアウト、再ログイン。
- レシピ帖の作成・切替・名前変更、owner/editor/viewer、招待取消、メンバー削除、所有権移譲。
- URL/HTML保存、画像、カード化、要確認、再試行、人数変更、献立、競合表示。
- 全課金ケース、通信切断、API 429/5xx、OpenAIタイムアウト、worker再起動。
- アカウント削除後の即時アクセス拒否と、S3/Auth/DB削除完了。
- 対象OSの実機、VoiceOver、Dynamic Type、低速回線、バックグラウンド復帰。

完了条件: 重大度P0/P1が0件、P2には公開可否判断と回避策があり、監視画面で一連の処理を追跡できる。

### M7 App Reviewと公開

1. リリース対象commit、EAS Build ID、version/build番号を記録して変更を凍結する。
2. App Store Connectで正しいbuildと初回IAP商品を同じ審査提出へ追加する。
3. 「Add for Review」後に提出内容を再確認し、「Submit for Review」を実行する。
4. 審査質問・却下理由は原文と回答、修正commit、再検証結果を進捗文書へ残す。
5. 承認後は手動公開し、公開ページ、初回インストール、OTP、購入、カード化、削除導線を確認する。
6. 問題時に販売停止、商品停止、worker停止、権利返還を行う手順を事前に用意する。

完了条件: App Store公開ページから新規端末へインストールでき、実購入1件とレシピ取り込み1件が正常に完了し、監視・サポート窓口が稼働している。

## 6. 公開可否ゲート

次のすべてが満たされるまでApp Reviewへ提出しない。

- [ ] G0: build 3のiPhone実機UI確認が完了。
- [ ] G1: 公開仕様、価格、保持期間、問い合わせ先が確定。
- [ ] G2: dev/prodの接続分離と、prodのバックアップ復元を実証。
- [ ] G3: 実OTP、S3、OpenAI、家族権限、削除の外部受入に合格。
- [ ] G4: RevenueCat Sandboxの購入・重複・返金・残高復旧に合格。
- [ ] G5: 規約、Privacy、Support、App Privacy、年齢区分、権利確認が完了。
- [ ] G6: production TestFlightの回帰に合格し、審査用アカウントが安定稼働。
- [ ] G7: App Store Connectの契約・税務・銀行・メタデータ・IAPに未解決警告がない。

## 7. 即時中止条件

- Tailnet、localhost、fixtureキーを含むbuildが公開候補になっている。
- 原本HTMLまたはJWT/APIキーがログ、クラッシュレポート、分析SDKへ送られている。
- viewerや部外者がカード、画像、献立、原本へ権限外アクセスできる。
- 失敗した取り込みで権利を失う、または購入/通知再送で二重付与される。
- アカウント削除がアクセス無効化だけで終わり、削除対象データが残り続ける。
- プライバシーポリシー、App Privacy、OpenAIの実契約上の保持条件が一致しない。
- 審査担当者がログイン、課金、取り込み、削除を再現できない。

## 8. 進捗記録

各マイルストーン終了時に `docs/ios-cloud-progress.md` へ次を追記する。

- 実施日、対象環境、変更commit。
- 実行コマンドと結果。
- 外部サービスのproject/app ID。秘密、招待コード、署名付きURLは記録しない。
- 合格した受入シナリオと残る不具合。
- 次のゲート、担当、手順。

## 9. 公式要件の確認先

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- App Review提出: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app
- App Privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- アカウント削除: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- スクリーンショット: https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots
- OpenAI APIデータ管理: https://developers.openai.com/api/docs/guides/your-data
- Crunchy Bridge接続とTLS: https://docs.crunchybridge.com/connecting
- Crunchy Bridgeチーム証明書: https://docs.crunchybridge.com/api/certificate
- Crunchy Bridge PostgreSQLバージョン: https://docs.crunchybridge.com/concepts/postgres-versions
- Docker PostgreSQL 18の永続化先: https://hub.docker.com/_/postgres
- Clerk Expo Quickstart: https://clerk.com/docs/expo/getting-started/quickstart
- Clerk session tokenのカスタムclaim: https://clerk.com/docs/guides/sessions/customize-session-tokens
- Clerk JWT検証: https://clerk.com/docs/guides/sessions/manual-jwt-verification
