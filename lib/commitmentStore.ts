// AsyncStorage-Anbindung für Commitment (Persistenz, keine UI).
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as C from "./commitment";

const KEY = "pb-commitment";

let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function loadCommitment(): Promise<C.CommitmentState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return C.normalizeCommitment(parsed) ?? C.emptyCommitment();
  } catch {
    return C.emptyCommitment();
  }
}

// Guard für andere Einstellungs-Screens (Limits, Zeitfenster).
export async function loadSettingsLock(now = Date.now()): Promise<C.SettingsLockInfo> {
  return C.settingsLockInfo(await loadCommitment(), now);
}

async function save(s: C.CommitmentState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

function mutate(
  fn: (s: C.CommitmentState, now: number) => C.CommitmentState,
): Promise<C.CommitmentState> {
  return withLock(async () => {
    const s = await loadCommitment();
    const next = fn(s, Date.now());
    await save(next);
    return next;
  });
}

export function lockSettings(): Promise<C.CommitmentState> {
  return mutate((s, now) => C.lockSettings(s, now));
}
export function unlockSettings(viaRecovery: boolean): Promise<C.CommitmentState> {
  return mutate((s, now) => C.unlockSettings(s, now, viaRecovery));
}
export function startRecovery(): Promise<C.CommitmentState> {
  return mutate((s, now) => C.startRecovery(s, now));
}
export function cancelRecovery(): Promise<C.CommitmentState> {
  return mutate((s) => C.cancelRecovery(s));
}
export function requestDisable(): Promise<C.CommitmentState> {
  return mutate((s, now) => C.requestDisable(s, now));
}
export function cancelDisable(): Promise<C.CommitmentState> {
  return mutate((s) => C.cancelDisable(s));
}
export function lockFilter(platform: string, days: number): Promise<C.CommitmentState> {
  return mutate((s, now) => C.lockFilter(s, platform, days, now));
}
