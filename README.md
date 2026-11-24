## Kokushi の演習履歴と再開

演習中の出題順、現在の問題、解答と採点状態は自動保存されます。タブを閉じたり **戻る** を選んだりした場合は、出題範囲の **中断した演習** から再開できます。当時の問題ファイルがすべて揃っていると再開できます。

最後の問題で **演習終了** を選ぶか、途中で **演習結果を見る** を選ぶと、演習は履歴に移ります。結果から問題に戻り、再び結果を開くと、同じ履歴が更新されます。**同じ問題でもう一度** から開始した演習は別のセッションです。

ダッシュボードの **演習履歴** から **詳細** を開くと、出題順に自分の解答と採点結果を確認できます。**この回の誤答を再演習** では、当時不正解だった問題で新しいセッションを開始します。削除などで見つからない問題がある場合は、読み込めた誤答を出題します。演習履歴には中断した演習も表示され、行の **再開** から続けられます。ダッシュボードには演習履歴と解答履歴を各5件まで表示し、6件以上ある場合は **すべて表示** でそれぞれの一覧画面に移動できます。演習履歴は開始日時、解答履歴は解答日時が新しい順です。

演習は Vault 内の `02_Attempts/sessions/` に JSON 形式で保存されます。v0.1.10 の演習履歴もそのまま開けます。個別解答は `02_Attempts/attempts.jsonl` に保存され、日別グラフなどの学習統計に使われます。表示中のダッシュボードは **統計を更新** で再読み込みできます。

## 問題画像・コピー・再演習

演習画面の問題画像は、縦横比を保ち、長辺を300 pxにそろえます。複数の画像は横並びになり、幅の狭い画面では横スクロールできます。

演習画面上部の **コピー** で、採点前後を問わず問題番号、問題文、選択肢をテキストとしてコピーします。

演習履歴の詳細で **このセットで再演習** を選ぶと、当時の全問題を同じ順序で新しい演習として開始します。問題ファイルがすべて揃っている必要があります。

## 問題メモと関連知識ノート

採点後の **メモ** に1行を入力し、**保存** または Enter キーで確定します。メモは問題ごとに保存され、再演習時も同じ内容を編集できます。

**新規ノート** で `03_Notes/` にMarkdownファイルを作成し、現在の問題に関連付けて開きます。**既存ノートを関連付け** では `03_Notes/` のサブフォルダーを含めて検索できます。同じノートを複数の問題に関連付けられます。関連ノートは別ペインで開き、スマートフォンでは別タブで開きます。

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

## Releasing new releases

- Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
- Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
- Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases
- Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
- Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`

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
