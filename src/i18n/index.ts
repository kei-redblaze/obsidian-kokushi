import { getLanguage, moment, requireApiVersion } from "obsidian";
import { english } from "./english";

export type LanguagePreference = "system" | "ja" | "en";
type Locale = Exclude<LanguagePreference, "system">;
type Message = keyof typeof english;

let language: Locale = "en";

export function setLanguagePreference(preference: LanguagePreference): void {
  if (preference !== "system") {
    language = preference;
    return;
  }
  // Older supported Obsidian builds expose the application locale through Moment.
  let system = moment.locale();
  if (requireApiVersion("1.8.7")) {
    system = getLanguage();
  }
  language = /^ja(?:[-_]|$)/i.test(system) ? "ja" : "en";
}

export function locale(): Locale {
  return language;
}

export function t(message: Message, ...values: (string | number)[]): string {
  const text = locale() === "ja" ? message : english[message];
  return text.replace(/\{(\d+)\}/g, (_placeholder, index: string) => String(values[Number(index)] ?? ""));
}
