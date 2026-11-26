[日本語はこちら](#日本語) · [README](../README.md)

# Kokushi Usage

## English

### Practice and Review

Open **Kokushi: Open practice** from the command palette.

- Choose a **Source**, **Order**, **Rating**, and **Count**. Ratings use each question’s latest self-rating. By default, all ratings except **◎** are selected. Questions without an attempt are **Unanswered**.
- For **Count**, choose **All**, the preset, or **Custom**. The preset starts at **10** and can be changed in **Settings → Kokushi**. When there are 21 or more sources, use **Select** to open the source list. **Refresh** reloads the questions, ratings, counts, and unfinished sessions.
- Select **Submit answer** to see your result, the answer key, and any annotation. To skip guessing, choose **I don’t know** and submit the answer. The default self-rating is **◯** for correct or excluded questions and **×** for incorrect ones. Changes to the self-rating are saved automatically.
- Tap an image to enlarge it. **Copy image** copies the image if supported by the device. At the top of the question, **Copy** copies the question number, text, and options. **Edit**, available after grading, opens the Markdown in another pane or a phone tab.
- For a sequential set, submit each answer to proceed. The answer keys appear after you submit the last question. **Back to practice scope** preserves an unfinished session. Select **Details → Resume** under **Unfinished sessions** to continue.
- **End session** opens the results. **Practice this set again** uses all the same questions, while **Review missed questions** selects incorrect and ungraded items. A sequential set stays together.

#### Practice by Subject

After classifying questions in **Settings → Kokushi**, use **Subjects → Select** to choose one or more subjects. **All subjects** includes unclassified questions. A question matches if it belongs to any selected subject and satisfies the source and rating filters. A sequential set stays together. A question can receive up to two subjects. When there are new questions, Kokushi offers to classify them on the dashboard or practice scope. New or edited questions appear as **Unclassified** until classified.

### Dashboard and History

Open **Kokushi: Open dashboard** from the command palette. Use **Last 7 days**, **Last 30 days**, or **All time** to change the daily charts. The overview shows up to five records in each history section. Select **View all** to open the full list.

Select a question in the attempt history to preview the original answer, grade, and rating alongside the current question and answer key. The preview does not start a session. In session history, select a status to open the details. An interrupted session, or a completed session with ungraded questions, can be resumed from those details.

Accuracy uses the recorded grade. A submitted question marked **Excluded** counts as correct for this calculation. Deleting a session leaves its individual answers in history unless **Also delete answers from this session** is checked.

### Memos and Linked Notes

- Enter a multiline memo after grading. It saves automatically when typing stops or you leave the field.
- In **Notes**, select **New** to create and link a note in `02_Notes/`. Use **Edit** to link an existing note or unlink it. The same note can be linked to several questions.
- Links open in another pane or a phone tab. If you rename or move a note within `02_Notes/` in Obsidian, Kokushi updates its links.

Related notes appear with a pin when linked and with a dot when the local model finds a match at or above the relevance threshold. **Mark all** links the displayed suggestions. In **Edit**, change the checked items and choose **Done** to save, or **Cancel** to discard that edit. **Mark other notes** saves the current checks first, then opens the note picker.

## 日本語

### 演習と復習

コマンドパレットで **Kokushi: 演習を開く** を選択します。

- 出題範囲は **出典・順序・評価・出題数** の4ブロックで設定します。**評価** は問題ごとの最新評価 **◎・◯・△・×・未解答** で絞り込み、初期状態では◎以外の4つを選択します。解答履歴のない問題は未解答です。出題数は **すべて・固定件数・任意** の3つから選びます。固定件数は初期値が10問で、設定から変更できます。
- 出典が21件以上あるときは、**選択** から出典一覧を開きます。画面上部の **更新** で、今の設定を保ちながら出典・評価・件数・未完了の演習を再読み込みできます。
- **解答・採点** を押すと正誤と正答、注記がある場合は注記を表示します。正解・採点除外では **◯**、不正解では **×** が初期評価です。評価は **◎・◯・△・×・未解答** から選び直せ、自動保存されます。**わからない** を選んで採点することもできます。**コピー** は問題番号・問題文・選択肢をテキストとしてコピーします。正答・注記・画像はコピー対象外です。
- **出題範囲の選択に戻る** で中断した演習は、出題範囲画面の **未完了の演習 → 詳細 → 再開** から続けられます。
- **演習を終了する** と結果が表示されます。**同じ問題でもう一度** で全問、**間違えた問題を復習** でその回の不正解と未採点の問題を、元の順番で演習できます。
- 問題画像をタップすると拡大表示します。拡大画面の **画像をコピー** で画像1枚をコピーできます。画像コピーの可否は端末環境に依存します。
- 採点後の **編集** から、問題Markdownを別ペインで開きます。スマートフォンでは別タブで開きます。順次出題の連問では最後の小問の確定後に採点し、セット全体のMarkdownを開けるようになります。

#### 分野別演習

**設定 → Kokushi → 分類を更新** で分類すると、出題範囲に **分野** が表示されます。**すべての分野** には未分類も含まれます。複数の分野を選ぶと、そのいずれかに該当し、出典・評価の条件も満たす問題が候補になります。条件に合う小問がある順次出題の連問はセットごと出題します。1問に最大2つの分野が付きます。追加された問題がある場合は、ダッシュボードまたは出題範囲選択画面で分類を案内します。追加・編集した問題は、分類されるまで **未分類** として扱います。

### ダッシュボードと履歴

コマンドパレットの **Kokushi: ダッシュボードを開く** で、学習進捗、正答率、日別推移、演習履歴、解答履歴を確認できます。日別学習推移は **直近7日・直近30日・全期間** のボタンで切り替えます。履歴は各5件まで表示し、6件以上ある場合は **すべて表示** で一覧を開けます。解答履歴から問題番号を押すと、その回の解答・採点結果・評価を閲覧できます。現在の問題文や正答は区別して表示します。履歴を開いても演習は始まりません。

演習履歴の状態ボタンから詳細を開くと、問題ごとの解答、本人の評価、採点結果を確認できます。正答率は採点時の結果を使い、採点済みの採点除外問題は正解として集計します。中断した演習は **再開** で続行でき、完了済みの演習も未採点の問題があれば再開できます。完了済みの詳細では **このセットで再演習** で当時の全問を新しい演習として開始できます。**この回の誤答を再演習** は、採点結果が不正解だった問題が対象です。

**演習履歴を破棄** の確認画面では、初期状態で演習履歴だけを削除します。**この回の解答履歴も削除する** にチェックを入れると、その回の解答も削除され、ダッシュボードの集計から外れます。

### メモと関連ノート

- 採点後のメモ欄に複数行のメモを入力できます。入力が止まったときや欄を離れたときに自動保存されます。
- 採点後の **ノート → 新規** で `02_Notes/` にノートを作成し、問題に関連付けます。**編集** から既存ノートの追加や関連付けの解除ができます。複数の問題に同じノートを関連付けられます。
- 関連ノートはリンクから別ペインで開き、スマートフォンでは別タブで開きます。Obsidian 内で `02_Notes/` 配下のノートを改名・移動すると、関連付け先も更新されます。

関連付け済みのノートはピンで表示します。関連度が閾値以上のAI候補は、続けてドット付きで表示します。**全てマーク** を押すと表示中の候補をまとめて関連付けます。**編集** ではチェックを変更して **決定** で保存でき、**キャンセル** で取り消せます。**その他のノートをマーク** はチェックを先に保存し、ノート選択画面を開きます。
