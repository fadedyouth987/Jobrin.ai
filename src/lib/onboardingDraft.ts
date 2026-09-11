// Draft persistence for the onboarding wizard: typed answers survive a failed
// save or a page refresh instead of disappearing. Storage is injected so the
// merge logic is unit-testable without a DOM.

export type OnboardingDraft = {
  workspaceId?: string;
  workspace?: string;
  business?: Record<string, unknown>;
  service?: Record<string, unknown>;
};

const DRAFT_KEY = 'jobrin.onboarding.draft.v1';

type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function loadDraft(storage: DraftStorage | null): OnboardingDraft {
  if (!storage) return {};
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as OnboardingDraft) : {};
  } catch {
    return {};
  }
}

export function saveDraft(storage: DraftStorage | null, patch: OnboardingDraft): OnboardingDraft {
  if (!storage) return loadDraft(null);
  const merged = { ...loadDraft(storage), ...patch };
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable or full — draft is best-effort */
  }
  return merged;
}

export function clearDraft(storage: DraftStorage | null, steps?: Array<keyof OnboardingDraft>): void {
  if (!storage) return;
  if (!steps) {
    try {
      storage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const draft = loadDraft(storage);
  for (const step of steps) delete draft[step];
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

// Server values win once they exist; the draft only fills fields the server
// has never saved, so a completed profile is never clobbered by stale typing.
export function hydrateFromDraft<T extends Record<string, unknown>>(serverValues: T, draft: Record<string, unknown> | undefined): T {
  if (!draft || typeof draft !== 'object') return serverValues;
  const merged: Record<string, unknown> = { ...serverValues };
  for (const [key, value] of Object.entries(draft)) {
    const current = merged[key];
    if (current === undefined || current === null || current === '') merged[key] = value;
  }
  return merged as T;
}