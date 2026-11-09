// Persistenz der Filter-Konfiguration (welche Feed-Bestandteile blockiert werden).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_FILTER_CONFIG, type FilterConfig } from "./browser";

const KEY = "pb-filter-config";

const BOOL_KEYS = Object.keys(DEFAULT_FILTER_CONFIG).filter(
  (k) => typeof (DEFAULT_FILTER_CONFIG as Record<string, unknown>)[k] === "boolean",
) as (keyof FilterConfig)[];

// Nur bekannte Boolean-Flags übernehmen — fremde/kaputte Werte fallen auf den
// Default zurück (fail-closed: Blockieren bleibt an, wenn etwas fehlt).
export function normalizeFilterConfig(x: unknown): FilterConfig {
  const out: FilterConfig = { ...DEFAULT_FILTER_CONFIG };
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  const r = x as Record<string, unknown>;
  for (const k of BOOL_KEYS) {
    if (typeof r[k as string] === "boolean") {
      (out as Record<string, unknown>)[k as string] = r[k as string];
    }
  }
  return out;
}

export async function loadFilterConfig(): Promise<FilterConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return normalizeFilterConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_FILTER_CONFIG };
  }
}

export async function saveFilterConfig(cfg: FilterConfig): Promise<FilterConfig> {
  const next = normalizeFilterConfig(cfg);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best effort — UI fällt auf Defaults zurück */
  }
  return next;
}
