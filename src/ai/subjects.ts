import definitions from "./subjects-ja.yaml";

const ENGLISH_LABELS: Readonly<Record<string, string>> = {
  cardiology: "Cardiology",
  respiratory: "Respiratory medicine",
  gastrointestinal: "Gastrointestinal medicine",
  "hepatobiliary-pancreas": "Hepatobiliary and pancreatic medicine",
  "nephrology-urology": "Nephrology and urology",
  "endocrinology-metabolism-nutrition": "Metabolism, endocrinology, and nutrition",
  neurology: "Neurology",
  psychiatry: "Psychiatry",
  "hematology-oncology": "Hematology and medical oncology",
  "allergy-rheumatology": "Allergy and rheumatology",
  "infectious-disease": "Infectious diseases",
  orthopedics: "Orthopedics",
  dermatology: "Dermatology",
  ophthalmology: "Ophthalmology",
  otolaryngology: "Otolaryngology",
  pediatrics: "Pediatrics",
  obstetrics: "Obstetrics",
  "gynecology-breast": "Gynecology and breast disease",
  "geriatrics-rehabilitation": "Geriatrics and rehabilitation",
  "anesthesiology-palliative-care": "Anesthesiology and palliative care",
  "emergency-trauma-toxicology": "Emergency medicine and toxicology",
  "interview-symptomatology": "Medical interviewing and symptoms",
  "examination-diagnostics": "Physical examination and diagnostic tests",
  "principles-of-treatment": "Principles of treatment",
  "prevention-health-promotion": "Prevention and health promotion",
  "health-systems": "Health systems",
  "medical-ethics": "Medical ethics",
};

export const SUBJECTS = definitions.entries;
export const SUBJECT_REVISION = `1:${definitions.revision}`;
export const UNCLASSIFIED = "";
export const SUBJECT_IDS = SUBJECTS.map(subject => subject.id);
const japaneseLabels = new Map(SUBJECTS.map(subject => [subject.id, subject.name]));
const legacyIds = new Map(SUBJECTS.flatMap(({ id, name }) => [[name, id], [ENGLISH_LABELS[id], id]]));
legacyIds.set("救急・外傷・中毒", "emergency-trauma-toxicology");
legacyIds.set("Emergency medicine, trauma, and toxicology", "emergency-trauma-toxicology");
legacyIds.set("Hematology and oncology", "hematology-oncology");

export function subjectName(id: string, language: "ja" | "en"): string {
  const japanese = japaneseLabels.get(id) ?? id;
  return language === "ja" ? japanese : ENGLISH_LABELS[id] ?? japanese;
}

export function normalizeSubjectSelection(subjects: readonly string[]): string[] {
  return [...new Set(subjects.map(subject => legacyIds.get(subject) ?? subject))];
}

export function matchesSubjects(assigned: readonly string[], selected: readonly string[] | null): boolean {
  if (selected === null) return true;
  return assigned.length ? assigned.some(subject => selected.includes(subject)) : selected.includes(UNCLASSIFIED);
}
