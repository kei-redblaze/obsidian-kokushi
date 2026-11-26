[日本語のガイド](question-set-guide.md) · [README](../README.md#english)

# Question Set Guide

## Files and Folders

Create one Markdown file per standalone question or sequential set. Put each source folder directly under `01_Questions/`. Use unique question numbers within a source. Different sources can reuse the same number, including numbers with leading zeros.

```text
01_Questions/
└── Mock exam/
    ├── 001.md
    ├── sequence-01.md
    └── images/
        └── case.png
```

Use relative image paths such as `![Case image](./images/case.png)`. Files can share the same image. If you distribute a ZIP archive, extract the source folders under `01_Questions/`.

## Single and Multiple Choice

Use `## Question`, `## Options`, and `## Answer`. Start each choice with a lowercase letter, a period, and a space. Repeat the choice labels and text under `## Answer`.

```markdown
## Question

Which instrument records an electrocardiogram? Select one.

## Options

a. Electrocardiograph
b. Spirometer

## Answer

a. Electrocardiograph
```

List choices in the same answer combination on consecutive lines. Use a blank line to separate alternatives. For example, this answer section accepts either **a alone** or **a and b together**.

```markdown
## Answer

a. Option A

a. Option A
b. Option B
```

When alternatives contain different numbers of choices, the interface allows any positive number of selections. Grading matches the entire selected combination in any order.

## Numeric Answers

Omit `## Options` and put one value per line in `## Answer`. Use digits 0–9 and separate alternative values with a blank line. Leading zeros are significant.

```markdown
## Question

Enter the value twelve using three digits.

## Answer

012
```

## Exclusions and Annotations

For an excluded question, leave the contents of `## Answer` blank or use the literal `採点除外`. Explicitly writing the marker is recommended for generated questions. If options are present, the reader can select one or more. Otherwise, the view shows a numeric input.

Add an optional `## Annotation` to explain an exclusion or describe uncertainty about the source’s answer key. Kokushi shows it after grading. An annotation does not alter grading.

## Independent and Sequential Questions

If each question can be presented independently, put it in its own file and include any necessary shared findings and image links in each file. To reveal information gradually or require a particular order, put the entire set in one file.

Keep the literal headings `## 共通症例` for optional shared case material and `## 小問` followed by each original question number. Use level-three headings for the question, options, answers, and optional annotation within each numbered item.

```markdown
## 共通症例

Blood pressure was measured lying down and standing.

## 小問 Q37

### Question

Systolic pressure fell from 130 to 110 mmHg. Enter the fall in mmHg.

### Answer

20

## 小問 Q38

### Question

Diastolic pressure fell from 80 to 65 mmHg. Enter the fall in mmHg.

### Answer

15
```

Kokushi presents the items in file order and reveals results after the last item is submitted. If one item matches the scope filters, the whole set is eligible. Each item counts as one question, and the set is skipped if it does not fit the remaining count.

## Before Sharing

Use **Settings → Kokushi → Check question sets** to look for duplicate question numbers, broken image links, missing headings, and invalid answer choices. Then open a practice session to confirm images, answer combinations, and the order of each sequential set.
