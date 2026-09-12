# iOS・クラウド版 実装計画

判定方針更新: 2026-09-12

作成: 2026-09-06 / 更新: 2026-09-11 / 状態: P1〜P4のローカル実装・検証済み。内部TestFlight build 3とproduction build 5を配信済み。本番API/worker、HTTPS、DNS、Clerk production domain、dev Docker PostgreSQL 18、prod Crunchy Bridge PostgreSQL 18、非公開prod S3、法務・サポートページの初期受入は完了。EAS production環境の必須8項目も登録済み。production build 5はiPhoneへインストール・起動済み。実機で判明したS3認証情報未注入は修正・本番配備し、コンテナからS3 put/get/deleteを確認済み。App Store Connectの2商品は不足していた審査画像と10回商品の日本配信設定を補い、RevenueCatで両方ともReady to Submit。実OpenAI・Sandbox購入・本番でのカード化完了は未確認。取り込み権は10回150円、50回600円で開始する。App Store公開までの工程は [app-store-release-plan.md](app-store-release-plan.md) を参照。

## 目的と前提

lyrical-library の Expo 55 / React Native / EAS 構成を参考に、本リポジトリに独立した iOS アプリを追加する。既存 Vite + Express と data/ はローカル版として維持する。原本の自動移動・上書きはしない。

認証はClerkのメールOTP（利用者はAPIキー不要）、APIはExpress、永続化はdevのDocker PostgreSQL 18またはprodのCrunchy Bridge PostgreSQL 18、HTMLは非公開S3、カード化はサーバー側OpenAI Responses API、購入はStoreKitを扱うRevenueCat SDK + 認証付きWebhookを採用する。Clerkは本人確認とセッショントークン発行を担当し、レシピ帖の権限はアプリDBで管理する。環境はdevとprodの2つだけとし、stagingは設けない。これらは現時点の実装上の選択。既存の別製品のユーザー・課金・データは流用しない。

## HTML取り込みの基本原則

- あらゆるサイト構造へ柔軟に対応することを優先し、サイト固有のセレクタ、要素名、文言、既知サイト一覧による抽出や、広告・ナビゲーションと推定した要素を機械的に削除する前処理へ依存しない。
- 保存した原本HTMLは改変せず保持する。入力がモデル上限を超える場合も、内容を機械的に捨てて解決せず、原本を欠落なく分割してLLMで段階的に判定・統合するなど、未知の構造を保持できる方式を採る。
- JSON-LDなどの構造化情報は有力な根拠として利用できるが、それが存在することを前提にしない。出典HTMLは保持し、抽出結果の確認・編集に利用者が戻れるようにする。原文との文字列一致はカード化の必須条件にしない。
- 完全な `Recipe` JSON-LDが単一候補として得られる場合は、それをLLMの主対象にして、関連レシピ・FAQ・広告などを別候補と誤認する確率を下げる。ただしJSON-LDの材料配列は見出しを欠落させる場合があるため、原本HTMLの全断片も低価格モデルで主対象との関連と材料グループを判定し、必要な原文断片を最終抽出へ添える。構造化情報がない、不完全、または複数候補の場合は、原本全体の欠落なき断片判定へ戻す。
- 完全なRecipe JSON-LDを主対象とする際は、材料グループがJSON-LDから抜けても読めるよう、原本を変更せず抽出した可視テキストを最終LLM入力へ優先して添える。見出しと材料の並びは改行で保持し、モデルが不定形なグループ名と所属を判断する。可視テキストと関連HTML断片が入力上限を超えた場合は可視テキストを優先し、それでも超えるときだけRecipe JSON-LD単体に戻す。
- 完全なRecipe JSON-LDがないページでは、各HTML断片の判定にページ全体の先頭見出し（なければタイトル）を参考情報として付ける。関連記事だけの断片を別の主レシピと誤認しないためであり、一覧ページ等ではこの見出しだけで単一レシピと決めない。候補が本当に複数残れば `needs_review` を維持する。
- 複数レシピから主対象を特定できない場合、または題名・材料・作り方が揃わない場合は自動確定せず `needs_review` とし、失敗・要確認では取り込み権を消費しない。
- 断片の広告・関連レシピ・単独では判別不能なHTMLによって主レシピ全体を機械的に要確認にしない。単一の完全なRecipe JSON-LDがある場合はそれを主レシピの根拠とし、本文断片は材料グループ等の補完に使う。構造化情報がない場合も、同じ候補に属する非連続断片を統合できるようにする。最終出力はStructured Outputsで型を確認し、レシピ判定と題名・材料・作り方の最低限の成立だけをカード化ゲートとする。原本との不一致や根拠文不足のみで拒否せず、利用者が出典を参照して編集できるカードとして渡す。
- `needs_review` 後は無条件の再実行を唯一の選択肢にせず、理由を伝え、原本を保持したまま現在の作業一覧から見送れるようにする。再試行は利用者が原本を確認して選ぶ任意の操作とする。
- 材料は名前・分量に加えて、原文に見出しがある場合は不定形なグループ名（例: `（A）`、`☆バッター液`、`★付け合わせ`）をLLMで抽出して各材料へ関連付ける。グループなしの材料も同じ配列内で扱い、見出しと材料の原文順を保持する。手順中のグループ参照は言い換えず残す。
- OpenAIへ送る断片判定・最終抽出の指示文とHTML断片の説明ラベルは日本語で記述する。Structured Outputsのスキーマキー・分類値はAPI契約として維持する。
- 対象HTMLの言語・文字体系・料理文化は限定しない。モデルへの指示は日本語のまま、料理名、材料名・分量・グループ名、手順は原文の言語・表記・単位・順序を保持して構造化し、翻訳・単位換算・別文化圏の料理への置き換えはしない。HTMLの `lang` 属性や日本語の見出しに依存せず、分類 `category` だけは既存のスキーマ選択肢へ対応させる。

本番API/workerは AWS CDK 管理のLightsail 2GB instance（Docker）に配置する。static IPを固定送信元とし、Crunchy Bridgeの接続許可はこのIPだけにする。APIと既存のDBリース型workerを同じイメージで稼働し、OpenAI・S3・Clerkへの外向き通信もこのホストから行う。GitHub ActionsはGitHub OIDCで限定IAMロールを引き受け、Lightsail APIから短期SSH鍵を取得して更新する。固定のAWSアクセスキーやSSH秘密鍵はGitHubへ置かない。S3、Lightsail、static IP、IAM、Secrets Manager、GitHub OIDC、Route 53のAPIレコードはCDKで管理する。developは `wagaya-recipe-book-develop` AWS account、prodは `wagaya-recipe-book-production` AWS accountを使用する。旧Terraform S3バケットは別アカウントに残したままにし、新しいprod CDKバケットの受入後に別途廃止する。

## データ境界

- user: Clerkの認証sub（文字列ID）。購入権・HTML原本は本人に所属。JWTの署名/issuer/audience/期限を検証する。
- book: 複数の参加者で使える共有レシピ帖。owner/editor/viewer。ownerのみ招待・権限変更・退会処理、editorはカード化・献立編集、viewerは閲覧のみ。
- invite: 一回限り・有効期限付き・宛先メール固定。DBにはトークンのハッシュのみ。発行したリンクはOS共有画面で本人が送る。
- archive: `user/{sub}/archives/{uuid}.html` と代表画像。HTMLから Recipe JSON-LD、OGP、記事本文画像の順に候補を選び、公開IP固定・容量/形式検査を通った画像だけを非公開S3へ保存する。原本は本人のみダウンロード可。カード化成功時は画像を `books/{book}/recipes/` へ複製し、参加者は認証付きAPIでカードと画像を閲覧する。公開URLや外部サイトへの画像直リンクは作らない。
- import_job: queued -> processing -> succeeded / needs_review / failed。DBをキューとして使い、ワーカーがリースで取得。原本を欠落なく約12,000トークン単位へ分け、低価格モデルが全断片を判定した後、単一候補の断片だけを高精度モデルでカード化する。各モデル呼び出しを断片ハッシュ付きで保存し、リース再取得時は完了地点から再開する。LLMの指示としてHTMLを信用しない。複数候補を一つに特定できない場合や、必須情報が揃わない結果は要確認。
- wallet/ledger: 購入者単位。保存HTMLのトークン見積もりとモデル単価から最大必要権数を事前提示し、同意後にその権数を予約する。カード保存と同じDB transactionで実usage相当だけを消費し、予約差分を返却する。失敗/要確認は全予約を解除する。リトライ、二重送信、購入通知の再配信は一意制約で冪等化する。
- purchase: store/environment/transaction_id 単位で一度だけ付与。返金は取り消しを記録し残高から減算。使用済み返金で負残高になった場合は新規取り込みを止める。購入権に有効期限を設けない。

## API・アプリの範囲

メールOTPログイン、レシピ帖作成/切替/名前変更、参加者の招待/参加/削除、URLまたはHTML保存、取り込み費用見積もり/同意/進捗/再試行、画像付きカード一覧/詳細/共有メモ編集、献立日付/人数/残り物編集、残高/購入、サインアウト、アカウント削除。レシピ帖名の変更はownerだけに許可する。画像が保存できないレシピには分類別のアートワークを表示する。クライアント指定の所有者・モデル単価・権利数は採用しない。献立更新はversion比較で競合を検知する。

iOSの初期表示は本日の献立とし、献立・レシピ・取り込み・共有・設定はSF Symbols付きの下部タブで移動する。現在のレシピ帖は画面上部に名前を表示し、複数ある場合だけ名前からチェック付きの選択シートを開いて切り替える。レシピ帖を横並びのボタン列にはしない。画面はライト/ダーク外観、Dynamic Type、Safe Areaへ追従し、タブはコンテンツの有無にかかわらず表示を維持する。

取り込み件数が増えても入力画面を圧迫しないよう、「取り込み」直下は新規保存と未処理・処理中・要対応の項目に限定する。完了済みを含む原本一覧は同タブから開く階層画面「取り込み履歴」に分離し、URL検索、状態絞り込み、カーソル方式の追加読み込み、HTML原本の共有を提供する。履歴を第6の最上位タブにはしない。

## セキュリティと運用

- URL取得は公開IPだけにDNS解決を固定し、各リダイレクトも検証。HTML上限2MB、応答時間制限、同時ジョブ/保存件数上限を設ける。
- S3 public access block + SSE + TLS。HTMLは添付ファイルで返す。料理画像は会員資格を再検証するAPIから配信し、端末ではメモリキャッシュだけを使う。HTML内の画像/スクリプトをアプリ内で実行しない。
- APIキー、DB URL、Webhook秘密はサーバー環境変数。モバイルには公開キーとAPI URLだけ。
- DBの専用schemaに保存し、Clerkにはレシピデータを持たせない。全クエリで会員資格を検証する。
- アカウント削除はまずアクセス無効化、ジョブ停止、所有レシピ帖に他の参加者がいる場合は所有権移譲を要求。S3/認証削除は再試行可能な処理にする。会計台帳は最小限の監査記録を保持。
- HTMLと抽出結果に個人情報が含まれうる。OpenAI送信について取り込み前に明示し、原文の欠落や誤抽出は利用者が確認できるようにする。
- 料金・商品ID・正式な利用規約/プライバシーポリシーURLは公開前に確定。本番DBはユーザー承認を経て東京リージョンに作成済み。今後の新規有料リソースや費用増を伴う変更は、具体的な構成と金額を確認してから実行する。

## 実装順と完了条件

1. [x] P1 DB/API: migration、認証、共有/招待、原本保存、権限テスト。
2. [x] P2 LLM/権利: OpenAI adapter、永続ジョブ、予約/消費/返還、購入通知、重複/失敗/返金テスト。
3. [x] P3 iOS: Expo、ログイン、レシピ帖、取り込み、カード、献立、共有、購入、削除導線。型検査とiOS bundle export。
4. [x] P4 運用: env例、Docker、S3設定、起動手順、引き継ぎ、既存版build/test。
5. [ ] P5 外部環境での受入: 実メールOTP、S3、実OpenAI、RevenueCat Sandbox、TestFlight実機、削除/返金/復旧、審査資料。

P5のホスティング工程では、CDKアプリ、GitHub OIDC信頼ポリシー（対象repository・production environmentに限定）、非公開S3、Lightsail 2GB/static IP/日次snapshot、Secrets Managerをproduction accountへ作成する。`api.wagaya.oxycaster.com` のA recordは親Route 53 accountの別CDK stackで管理する。2026-09-09にGitHub Actionsからruntimeと両CDK stackを更新し、公開HTTPS health、固定IPのDNS、DB firewall、SSH閉鎖まで受入済み。次に実認証付きAPI、S3、OpenAIの受入を行う。

P5は二段階に分ける。最初の内部TestFlightは画面と端末操作の確認用で、devのTailnet内ローカルfixtureへ接続する。ローカルfixtureは認証済み開発ユーザーへ起動中一度だけ10回分のテスト用取り込み権を付与し、StoreKit購入なしで保存・見積もり・カード化を検証できるようにする。続いてprodのClerk、Crunchy Bridge PostgreSQL 18、S3、API/worker、OpenAI、RevenueCatへ切り替え、実サービス受入を完了してから外部テスター配布や審査へ進む。fixture版を実課金・実クラウド受入済みとは扱わない。

Simulatorの開発用fixtureには、明示的な起動設定でだけ有効になる実抽出モードを用意する。このモードでは公開URLの安全な取得とサーバー側OpenAI抽出を本番と同じ実装で行い、Clerk development認証を必須とする。データと取り込み権は従来どおりプロセス内のテスト用に限定し、S3・RevenueCat・本番DBへは接続しない。旧TestFlight向けTailnet fixtureのポートでは起動せず、モデル呼び出し回数を制限する。外部のOpenAI料金が発生し、ローカルfixture検証と本番サービス受入は分けて記録する。

P5以降の公開作業は `docs/app-store-release-plan.md` のM0〜M7とG0〜G7で管理する。App Reviewへ提出するproduction buildは、fixture用 `testflight` profileと分離し、公開可否ゲートをすべて満たすこと。

現在の `@clerk/expo` を含むnative development buildはiOS deployment target 17.0で生成される。初回公開の最低OSはiOS 17以上を前提にM1で確定し、それより古いOSを対象にする場合は認証SDK構成を変更してnative buildと認証受入をやり直す。

実装済みと実サービス検証済みは区別する。進捗は docs/ios-cloud-progress.md に、各区切りの変更・実行コマンド・結果・未完了・次の手順を追記する。

P1〜P4のチェックはコードとローカル検証の完了を表す。Clerk development/production、dev/prod PostgreSQL、prod S3の基盤受入以外のOpenAI、課金の外部アダプターが実際のアカウントで成功したことを意味しない。S3への実原本保存と削除、Docker image実ビルドはP5環境で確認する。

## 外部受入シナリオ

AとBは別アカウント。Aの原本をB/Cは取得できない。AがBをviewer招待するとカード/献立のみ閲覧できる。editor昇格で編集可、削除後すぐAPI拒否。CによるID差し替えを拒否する。
同じ購入通知を2回送っても1回分付与。同時2ジョブで残高1なら1件のみ受付。LLMタイムアウトで権利を失わない。ワーカー強制終了後リース切れで再開しカードは1件。返金の先着/後着で同じ最終残高。再インストール後も同じ認証アカウントで残高復旧する。

## 参照（2026-09-06確認）

- https://developers.openai.com/api/docs/guides/structured-outputs : スキーマ準拠とrefusal/incompleteを区別する。
- https://clerk.com/docs/expo/getting-started/quickstart : Expo認証とセッション保存。
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields : NON_RENEWING_PURCHASE、CANCELLATION、取引識別子。
- https://docs.expo.dev/guides/in-app-purchases/ : 課金はdevelopment buildで検証。
- https://developer.apple.com/app-store/review/guidelines/ : デジタル機能のIAP、購入権の失効禁止、アカウント削除、プライバシー開示を提出前に再確認。
