import type { App } from "obsidian";

export interface KokushiPreferences {
  customAccent: boolean;
  accent: string;
}

const DEFAULT_ACCENT = "#7959d4";
const appearances = new WeakMap<App, KokushiAppearance>();

export function readPreferences(value: unknown): KokushiPreferences {
  const data = value as Partial<KokushiPreferences> | null;
  return {
    customAccent: data?.customAccent === true,
    accent: typeof data?.accent === "string" && /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : DEFAULT_ACCENT,
  };
}

export function installAppearance(app: App, preferences: KokushiPreferences): KokushiAppearance {
  const appearance = new KokushiAppearance(preferences);
  appearances.set(app, appearance);
  return appearance;
}

export function bindAppearance(app: App, root: HTMLElement): void {
  appearances.get(app)?.attach(root);
}

export function unbindAppearance(app: App, root: HTMLElement): void {
  appearances.get(app)?.detach(root);
}

class KokushiAppearance {
  private roots = new Set<HTMLElement>();

  constructor(private preferences: KokushiPreferences) {}

  attach(root: HTMLElement): void {
    this.roots.add(root);
    this.apply(root);
  }

  detach(root: HTMLElement): void {
    this.roots.delete(root);
    root.removeClass("kokushi-custom-accent");
  }

  update(preferences: KokushiPreferences): void {
    this.preferences = preferences;
    this.roots.forEach(root => this.apply(root));
  }

  clear(): void {
    this.roots.forEach(root => this.detach(root));
  }

  private apply(root: HTMLElement): void {
    const { accent, customAccent } = this.preferences;
    root.classList.toggle("kokushi-custom-accent", customAccent);
    root.setCssProps({ "--kokushi-accent": accent, "--kokushi-accent-text": accentForeground(accent) });
  }
}

function accentForeground(color: string): string {
  const rgb = [1, 3, 5].map(start => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
  return luminance >= 0.179 ? "#000000" : "#ffffff";
}
