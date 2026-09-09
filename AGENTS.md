@/Users/hiro/.codex/RTK.md

# 作業の引き継ぎ

- iOS/クラウド版の作業は、最初に `docs/ios-cloud-plan.md` と `docs/ios-cloud-progress.md` を読む。
- 各作業区切りで進捗文書に変更点・検証コマンドと結果・未完了・次の手順を記録する。設計を変更したら計画書も更新する。
- `apps/mobile` はExpoアプリ、`services/api` はクラウドAPI/worker、ルートの `src` / `server.mjs` は既存ローカル版。起動・設定は `docs/cloud/runbook.md` を参照する。
- 既存の `data/` は利用者の原本。テスト、サンプル生成、自動移行の対象にしない。
- ローカルfixtureの成功と外部サービスでの成功を区別する。実課金、実メール、外部保存、TestFlightの未検証を完了扱いにしない。
- キーやトークンをコード・文書・ログへ保存しない。環境変数の例は空欄または明示したダミーだけにする。
