## Kokushi の演習履歴と再開

演習中の出題順、現在の問題、解答と採点状態は自動保存されます。タブを閉じたり **戻る** を選んだりした場合は、出題範囲の **未完了の演習** → **詳細** → **再開** から続けられます。当時の問題ファイルがすべて揃っていると再開できます。

最後の問題で **演習終了** を選ぶか、途中で **演習を終了する** を選ぶと、演習は履歴に移ります。結果から問題に戻り、再び結果を開くと、同じ履歴が更新されます。**同じ問題でもう一度** から開始した演習は別のセッションです。

ダッシュボードの **演習履歴** の状態ボタンから詳細を開くと、出題順に自分の解答と採点結果を確認できます。**この回の誤答を再演習** では、当時不正解だった問題で新しいセッションを開始します。削除などで見つからない問題がある場合は、読み込めた誤答を出題します。**中断** の詳細から **再開** または **演習履歴を破棄** を選べます。未採点の問題が残っている完了済みの演習は、詳細の **再開** で最初の未採点問題から続けられます。完了済みの履歴は、詳細や演習結果から破棄できます。ダッシュボードには演習履歴と解答履歴を各5件まで表示し、6件以上ある場合は **すべて表示** でそれぞれの一覧画面に移動できます。演習履歴は開始日時、解答履歴は解答日時が新しい順です。

演習は Vault 内の `02_Attempts/sessions/` に JSON 形式で保存されます。v0.1.10 の演習履歴もそのまま開けます。個別解答は `02_Attempts/attempts.jsonl` に保存され、日別グラフなどの学習統計に使われます。表示中のダッシュボードは **更新** で再読み込みできます。

**演習履歴を破棄** の確認画面で **この回の解答履歴も削除する** を選ぶと、そのセッションの解答履歴も削除されます。初期状態のまま削除すると、演習履歴だけが削除されます。

## 出題対象とダッシュボード

**正解・不正解・未解答** から任意の組み合わせを選べます。初期状態は3つとも選択済みです。解答履歴のない採点除外問題は未解答、履歴のある採点除外問題は出題対象の正解に含みます。採点結果と統計では採点除外として集計します。

出題範囲画面の **ダッシュボードを見る** で、出題条件を保ったままダッシュボードの概要へ移動できます。ダッシュボードの **出題範囲を選択** で範囲選択画面を開きます。

## 問題画像・コピー・再演習

演習画面の問題画像は、縦横比を保ち、長辺を300 pxにそろえます。複数の画像は横並びになり、幅の狭い画面では横スクロールできます。

演習画面上部の **コピー** で、採点前後を問わず問題番号、問題文、選択肢をテキストとしてコピーします。

演習履歴の詳細で **このセットで再演習** を選ぶと、当時の全問題を同じ順序で新しい演習として開始します。問題ファイルがすべて揃っている必要があります。

## 問題メモと関連知識ノート

採点後の **メモ** は複数行で入力できます。入力が止まって約0.5秒後や、入力欄を離れたり別の問題へ移動したりしたときに自動保存されます。メモは問題ごとに保存され、再演習時も同じ内容を編集できます。

**新規** で `03_Notes/` にMarkdownファイルを作成し、現在の問題に関連付けて開きます。**編集** → **既存ノートを関連付け** では `03_Notes/` のサブフォルダーを含めて検索できます。同じノートを複数の問題に関連付けられます。関連ノートは下線付きリンクから別ペインで開き、スマートフォンでは別タブで開きます。**編集** では、選択したノートとの関連付けを外せます。

メモと関連付けは、`01_Questions/` にある問題の既存YAMLに書き込みます。ほかの項目もそのYAMLに残ります。メモには常に引用符を付け、数値や真偽値に見える入力も文字列として保存します。

```yaml
memo: "01"
relatedNotes:
  - 03_Notes/亜鉛欠乏症候群.md
```

Obsidian内でノートやサブフォルダーの名前・位置を変えると、`03_Notes/` 内の移動に合わせて関連付け先を更新します。

# Obsidian Sample Plugin

This is a sample plugin for Obsidian (https://obsidian.md).

This project uses TypeScript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in TypeScript Definition format, which contains TSDoc comments describing what it does.

This sample plugin demonstrates some of the basic functionality the plugin API can do.

- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open modal (simple)" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and outputs a Notice on click.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `src/main.ts` to `main.js`.
- Make changes to `src/main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## リリース

`manifest.json` の `version` を上げ、`versions.json` に対応する最小Obsidianバージョンを追加して、変更を `master` に反映します。GitHub Actionsがビルドし、そのコミットにバージョンと同じタグを作成します。リリースには `main.js`、`manifest.json`、`styles.css` が添付され、公開されます。

リリースワークフローを更新したときも、最新タグより新しいバージョンが `master` にあれば公開されます。発行済みのタグは再作成されません。

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v18 (`node --version`).
- `npm i` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint

- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code.
- This project already has eslint preconfigured, you can invoke a check by running`npm run lint`
- Together with a custom eslint [plugin](https://github.com/obsidianmd/eslint-plugin) for Obsidan specific code guidelines.
- A GitHub action is preconfigured to automatically lint every commit on all branches.

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
	"fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
	"fundingUrl": {
		"Buy Me a Coffee": "https://buymeacoffee.com",
		"GitHub Sponsor": "https://github.com/sponsors",
		"Patreon": "https://www.patreon.com/"
	}
}
```

## API Documentation

See https://docs.obsidian.md
