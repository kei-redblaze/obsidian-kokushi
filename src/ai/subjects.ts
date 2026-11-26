export const JAPANESE_SUBJECTS = [
  "循環器", "呼吸器", "消化管", "肝胆膵", "腎・泌尿器", "代謝・内分泌・栄養",
  "脳・神経", "精神", "血液・腫瘍", "アレルギー・膠原病", "感染症", "整形外科",
  "皮膚科", "眼科", "耳鼻咽喉科", "小児科", "産科", "婦人科・乳腺", "老年・リハ",
  "麻酔・緩和", "救急・外傷・中毒", "医療面接・症候学", "診察・検査", "治療総論",
  "予防・健康管理", "保健医療制度", "医療倫理",
] as const;

export const ENGLISH_SUBJECTS = [
  "Cardiology", "Respiratory medicine", "Gastrointestinal medicine", "Hepatobiliary and pancreatic medicine",
  "Nephrology and urology", "Metabolism, endocrinology, and nutrition", "Neurology", "Psychiatry",
  "Hematology and oncology", "Allergy and rheumatology", "Infectious diseases", "Orthopedics",
  "Dermatology", "Ophthalmology", "Otolaryngology", "Pediatrics", "Obstetrics", "Gynecology and breast disease",
  "Geriatrics and rehabilitation", "Anesthesiology and palliative care", "Emergency medicine, trauma, and toxicology",
  "Medical interviewing and symptoms", "Physical examination and diagnostic tests", "Principles of treatment",
  "Prevention and health promotion", "Health systems", "Medical ethics",
] as const;

export const UNCLASSIFIED = "";

export function parseSubjects(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

export function matchesSubjects(assigned: readonly string[], selected: readonly string[] | null): boolean {
  if (selected === null) return true;
  return assigned.length ? assigned.some(subject => selected.includes(subject)) : selected.includes(UNCLASSIFIED);
}
