[日本語はこちら](#日本語)

# Kokushi

Kokushi is an Obsidian plugin for practicing past exams and mock questions. Choose questions by source and self-rating, track your results, and attach memos or notes.

## English

### Installation

Requires Obsidian 1.7.2 or later.

#### Using BRAT

1. In **Settings → Community plugins → Browse**, install and enable **BRAT**.
2. Open **Settings → BRAT** and select **Add beta plugin**.
3. Enter `https://github.com/kei-redblaze/obsidian-kokushi`, select the latest version, and add it.
4. In **Settings → Community plugins**, verify that **Kokushi** is enabled. [BRAT documentation](https://github.com/TfTHacker/obsidian42-brat)

#### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css`. [GitHub Releases](https://github.com/kei-redblaze/obsidian-kokushi/releases/latest)
2. Put the files in `.obsidian/plugins/obsidian-kokushi/` inside your vault.
3. Reload Obsidian and enable **Kokushi** in **Settings → Community plugins**.

In **Settings → Kokushi → Initial setup**, select **Create folders** to prepare your vault.

### Question Set Format

Put each source folder directly under `01_Questions/`, with its Markdown files and referenced images. A question is identified by its source and question number. For a standalone question, the number comes from the filename.

```markdown
## Question

Which instrument records an electrocardiogram?

## Options

a. Electrocardiograph
b. Spirometer

## Answer

a. Electrocardiograph
```

Separate alternative answers with a blank line. An optional `## Annotation` appears after grading. For a sequential set, use one Markdown file and keep each original question number in a heading such as `## 小問 Q37`. [Question set guide](docs/question-set-guide.en.md)

See [Usage](docs/usage.md#english) for practice, the dashboard, and linked notes.

### Settings

- **Language** follows Obsidian by default. You can also choose English or Japanese. Reload Obsidian to apply a language change.
- **Question count preset** sets the fixed count in the practice scope. The default is 10.
- **Custom color** reveals an accent color picker when turned on.
- **Initial setup** creates any missing folders among `01_Questions`, `02_Notes`, and `03_Data`.
- **Check question sets** reports duplicate IDs, invalid headings or answers, and missing local images.

### Vault Data

| Data | Location |
| --- | --- |
| Questions, answer keys, and images | `01_Questions/` |
| Linked notes | `02_Notes/` |
| Attempts, grades, and self-ratings | `03_Data/Attempts/attempts.jsonl` |
| Session progress and results | `03_Data/Attempts/sessions/` |
| Question memos and note links | `03_Data/YAML/<source>/<question-id>.yaml` |

The study YAML is created when a memo or note link is first saved. Updating the answer key in `## Answer` affects future grading. History preserves the grade recorded for each attempt.

### Development and Releases

Use Node.js 24 to match GitHub Actions.

```bash
npm ci
npm run build
npm run lint
```

`npm run dev` rebuilds the plugin as files change. To release, run `npm version <version> --no-git-tag-version` and update `master`. When the version in `manifest.json` is newer than the latest tag, GitHub Actions builds and publishes the three plugin files.

[License](LICENSE)

## 日本語

Kokushiは、試験の過去問や模擬試験をObsidianのVaultで演習するプラグインです。出典や評価で出題範囲を絞り、採点結果を記録しながら、問題ごとにメモや知識ノートを残せます。

### インストール

Obsidian 1.7.2 以降に対応しています。

#### BRATでインストール

1. Obsidianの **設定 → コミュニティプラグイン → 閲覧** で **BRAT** を検索し、インストールして有効にします。
2. **設定 → BRAT** を開き、**Add beta plugin** を選びます。
3. リポジトリのURL `https://github.com/kei-redblaze/obsidian-kokushi` を入力し、最新バージョンを選んで追加します。
4. **設定 → コミュニティプラグイン** で **Kokushi** が有効になっていることを確認します。[BRATの公式README](https://github.com/TfTHacker/obsidian42-brat)

#### 手動インストール

1. GitHub Releases から `main.js`、`manifest.json`、`styles.css` をダウンロードします。[GitHub Releases](https://github.com/kei-redblaze/obsidian-kokushi/releases/latest)
2. Vault の `.obsidian/plugins/obsidian-kokushi/` に3ファイルを置きます。フォルダーがなければ作成します。
3. Obsidian を開き直し、**設定 → コミュニティプラグイン** で **Kokushi** を有効にします。

インストール後に **設定 → Kokushi → 初期セットアップ** から必要なフォルダーを作成します。

### 問題セットの形式

出典ごとのフォルダーをVaultの `01_Questions/` 直下に置き、各問題の `.md` と参照画像を入れます。出典名と問題番号で問題を識別します。単独問題ではファイル名が問題番号です。

```markdown
## Question

心電図の記録に用いる機器はどれか。1つ選べ。

## Options

a. 心電計
b. 肺活量計

## Answer

a. 心電計
```

複数の正答候補は空行で区切ります。任意の `## Annotation` セクションには、採点後に表示する注記を記述できます。問題タイプ別の例、画像付きの連問、配布前の確認項目は、[問題セット作成ガイド](docs/question-set-guide.md)を参照してください。

順次出題する連問は1セットを1つのMarkdownにまとめ、`## 小問 Q37` のように出典元の問題番号を付けます。書式と出題順の詳細は[順次出題する連問](docs/question-set-guide.md#順次出題する連問)を参照してください。

詳しい操作は[使い方](docs/usage.md#日本語)を参照してください。

### 設定

**設定 → Kokushi** で次の項目を設定できます。

- **表示言語**から、Obsidianに従う、日本語、Englishを選択できます。変更はObsidianの再読み込み後に反映されます。
- **出題数のプリセット**で、出題範囲の固定件数を変更します。初期値は10問です。
- **カスタムカラー**をONにすると、アクセント色を指定できます。
- **初期セットアップ**で、`01_Questions`、`02_Notes`、`03_Data` のうち存在しないフォルダーを作成します。
- **問題セットをチェック**で、番号の重複、見出しや正答の書式、画像の参照先を確認できます。

### データの保存場所

| データ | Vault内の保存場所 |
| --- | --- |
| 問題文・選択肢・正答・画像 | `01_Questions/` |
| 関連ノートの本文 | `02_Notes/` |
| 選んだ解答・採点結果・本人の評価 | `03_Data/Attempts/attempts.jsonl` |
| 出題順・演習の進行状況・採点結果 | `03_Data/Attempts/sessions/` |
| 問題ごとのメモ・関連ノートへのリンク | `03_Data/YAML/<出典>/<問題番号>.yaml` |

YAMLはメモや関連ノートを初めて保存したときに作成します。正答は問題Markdownの `## Answer` で管理します。正答を訂正すると次回の採点から反映され、過去の履歴には当時の採点結果が残ります。問題文や入力形式も変更した場合は、更新された問題を表示して解答をやり直せます。

### 開発・リリース

GitHub Actions と同じ Node.js 24 を使う場合の手順です。

```bash
npm ci
npm run build
npm run lint
```

`npm run dev` で変更を監視し、`main.js` を再ビルドできます。動作確認する場合は、生成された `main.js` と `manifest.json`、`styles.css` をテスト用 Vault のプラグインフォルダーに配置します。

リリース時は `npm version <新しいバージョン> --no-git-tag-version` でバージョンを更新し、変更を `master` に反映します。`manifest.json` のバージョンが最新タグより新しい場合、GitHub Actions がビルドし、バージョンと同名のタグを作成して3ファイル付きのリリースを公開します。

### ライセンス

[ライセンス条文](LICENSE)
