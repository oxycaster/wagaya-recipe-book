# iOS・クラウド版 実装計画

作成: 2026-09-06 / 更新: 2026-09-08 / 状態: P1〜P4のローカル実装・検証済み。P5の内部TestFlight build 3を配信済み。実クラウド・実課金の受入と公開は未実施。App Store公開までの工程は [app-store-release-plan.md](app-store-release-plan.md) を参照。

## 目的と前提

lyrical-library の Expo 55 / React Native / EAS 構成を参考に、本リポジトリに独立した iOS アプリを追加する。既存 Vite + Express と data/ はローカル版として維持する。原本の自動移動・上書きはしない。

認証はClerkのメールOTP（利用者はAPIキー不要）、APIはExpress、永続化はdevのDocker PostgreSQL 18またはprodのCrunchy Bridge PostgreSQL 18、HTMLは非公開S3、カード化はサーバー側OpenAI Responses API、購入はStoreKitを扱うRevenueCat SDK + 認証付きWebhookを採用する。Clerkは本人確認とセッショントークン発行を担当し、レシピ帖の権限はアプリDBで管理する。環境はdevとprodの2つだけとし、stagingは設けない。これらは現時点の実装上の選択。既存の別製品のユーザー・課金・データは流用しない。

## データ境界

- user: 認証 sub (UUID)。購入権・HTML原本は本人に所属。JWTの署名/issuer/audience/期限を検証する。
- book: 家族の共有レシピ帖。owner/editor/viewer。ownerのみ招待・権限変更・退会処理、editorはカード化・献立編集、viewerは閲覧のみ。
- invite: 一回限り・有効期限付き・宛先メール固定。DBにはトークンのハッシュのみ。発行したリンクはOS共有画面で本人が送る。
- archive: `user/{sub}/archives/{uuid}.html` と代表画像。HTMLから Recipe JSON-LD、OGP、記事本文画像の順に候補を選び、公開IP固定・容量/形式検査を通った画像だけを非公開S3へ保存する。原本は本人のみダウンロード可。カード化成功時は画像を `books/{book}/recipes/` へ複製し、家族は認証付きAPIでカードと画像を閲覧する。公開URLや外部サイトへの画像直リンクは作らない。
- import_job: queued -> processing -> succeeded / needs_review / failed。DBをキューとして使い、ワーカーがリースで取得。LLMの指示としてHTMLを信用しない。出典・根拠不明は要確認。
- wallet/ledger: 購入者単位。取り込み受付で1権利を予約し、カード保存と同じDB transactionで消費。失敗/要確認は予約解除。リトライ、二重送信、購入通知の再配信は一意制約で冪等化する。
- purchase: store/environment/transaction_id 単位で一度だけ付与。返金は取り消しを記録し残高から減算。使用済み返金で負残高になった場合は新規取り込みを止める。購入権に有効期限を設けない。

## API・アプリの範囲

メールOTPログイン、レシピ帖作成/切替/名前変更、家族招待/参加/削除、URLまたはHTML保存、取り込み要求/進捗/再試行、画像付きカード一覧/詳細/メモ編集、献立日付/人数/残り物編集、残高/購入、サインアウト、アカウント削除。レシピ帖名の変更はownerだけに許可する。画像が保存できないレシピには分類別のアートワークを表示する。クライアント指定の所有者・価格・権利数は採用しない。献立更新はversion比較で競合を検知する。

## セキュリティと運用

- URL取得は公開IPだけにDNS解決を固定し、各リダイレクトも検証。HTML上限2MB、応答時間制限、同時ジョブ/保存件数上限を設ける。
- S3 public access block + SSE + TLS。HTMLは添付ファイルで返す。料理画像は会員資格を再検証するAPIから配信し、端末ではメモリキャッシュだけを使う。HTML内の画像/スクリプトをアプリ内で実行しない。
- APIキー、DB URL、Webhook秘密はサーバー環境変数。モバイルには公開キーとAPI URLだけ。
- DBの専用schemaに保存し、Clerkにはレシピデータを持たせない。全クエリで会員資格を検証する。
- アカウント削除はまずアクセス無効化、ジョブ停止、所有レシピ帖は家族がいる場合は所有権移譲を要求。S3/認証削除は再試行可能な処理にする。会計台帳は最小限の監査記録を保持。
- HTMLと抽出結果に個人情報が含まれうる。OpenAI送信について取り込み前に明示し、原文の欠落や誤抽出は利用者が確認できるようにする。
- 料金・商品ID・本番リージョン・bundle ID・正式な利用規約/プライバシーポリシーURLは公開前に確定。S3/AWS、Clerk、OpenAI、RevenueCat、Apple/EASの新規有料リソースや提出はこの実装では実行しない。

## 実装順と完了条件

1. [x] P1 DB/API: migration、認証、共有/招待、原本保存、権限テスト。
2. [x] P2 LLM/権利: OpenAI adapter、永続ジョブ、予約/消費/返還、購入通知、重複/失敗/返金テスト。
3. [x] P3 iOS: Expo、ログイン、レシピ帖、取り込み、カード、献立、家族、購入、削除導線。型検査とiOS bundle export。
4. [x] P4 運用: env例、Docker、S3設定、起動手順、引き継ぎ、既存版build/test。
5. [ ] P5 外部環境での受入: 実メールOTP、S3、実OpenAI、RevenueCat Sandbox、TestFlight実機、削除/返金/復旧、審査資料。

P5は二段階に分ける。最初の内部TestFlightは画面と端末操作の確認用で、devのTailnet内ローカルfixtureへ接続する。続いてprodのClerk、Crunchy Bridge PostgreSQL 18、S3、API/worker、OpenAI、RevenueCatへ切り替え、実サービス受入を完了してから外部テスター配布や審査へ進む。fixture版を実クラウド受入済みとは扱わない。

P5以降の公開作業は `docs/app-store-release-plan.md` のM0〜M7とG0〜G7で管理する。App Reviewへ提出するproduction buildは、fixture用 `testflight` profileと分離し、公開可否ゲートをすべて満たすこと。

実装済みと実サービス検証済みは区別する。進捗は docs/ios-cloud-progress.md に、各区切りの変更・実行コマンド・結果・未完了・次の手順を追記する。

P1〜P4のチェックはコードとローカル検証の完了を表す。S3、Auth、OpenAI、課金の外部アダプターが実際のアカウントで成功したことを意味しない。Docker image実ビルドと実PostgreSQL接続もP5環境で確認する。

## 外部受入シナリオ

AとBは別アカウント。Aの原本をB/Cは取得できない。AがBをviewer招待するとカード/献立のみ閲覧できる。editor昇格で編集可、削除後すぐAPI拒否。CによるID差し替えを拒否する。
同じ購入通知を2回送っても1回分付与。同時2ジョブで残高1なら1件のみ受付。LLMタイムアウトで権利を失わない。ワーカー強制終了後リース切れで再開しカードは1件。返金の先着/後着で同じ最終残高。再インストール後も同じ認証アカウントで残高復旧する。

## 参照（2026-09-06確認）

- https://developers.openai.com/api/docs/guides/structured-outputs : スキーマ準拠とrefusal/incompleteを区別する。
- https://clerk.com/docs/expo/getting-started/quickstart : Expo認証とセッション保存。
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields : NON_RENEWING_PURCHASE、CANCELLATION、取引識別子。
- https://docs.expo.dev/guides/in-app-purchases/ : 課金はdevelopment buildで検証。
- https://developer.apple.com/app-store/review/guidelines/ : デジタル機能のIAP、購入権の失効禁止、アカウント削除、プライバシー開示を提出前に再確認。
