import assert from "node:assert/strict";
import test from "node:test";
import { clearDraft, hydrateFromDraft, loadDraft, saveDraft } from "../src/lib/onboardingDraft";

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

test("onboarding draft persists typed answers and merges patches", () => {
  const storage = new FakeStorage();
  assert.deepEqual(loadDraft(storage), {});
  saveDraft(storage, { workspace: "Bradley Plumbing" });
  saveDraft(storage, { business: { trading_name: "Bradley Plumbing & Maintenance" } });
  const draft = loadDraft(storage);
  assert.equal(draft.workspace, "Bradley Plumbing");
  assert.equal((draft.business as Record<string, unknown>).trading_name, "Bradley Plumbing & Maintenance");
  clearDraft(storage, ["workspace"]);
  assert.equal(loadDraft(storage).workspace, undefined);
  assert.equal((loadDraft(storage).business as Record<string, unknown>).trading_name, "Bradley Plumbing & Maintenance");
  clearDraft(storage);
  assert.deepEqual(loadDraft(storage), {});
});

test("onboarding draft ignores corrupt or missing storage content", () => {
  const storage = new FakeStorage();
  storage.setItem("jobrin.onboarding.draft.v1", "{not json");
  assert.deepEqual(loadDraft(storage), {});
  assert.deepEqual(loadDraft(null), {});
  saveDraft(null, { workspace: "ignored" });
  assert.deepEqual(loadDraft(null), {});
});

test("onboarding drafts are replaceable per patch and scoped by the caller", () => {
  const storage = new FakeStorage();
  saveDraft(storage, { workspaceId: "ws-1", business: { trading_name: "A" } });
  saveDraft(storage, { workspaceId: "ws-2", business: { trading_name: "B" } });
  const draft = loadDraft(storage);
  assert.equal(draft.workspaceId, "ws-2");
  assert.equal((draft.business as Record<string, unknown>).trading_name, "B");
});

test("hydrateFromDraft fills only fields the server has never saved", () => {
  const server = { trading_name: "Saved Co", abn: "", suburb: null as unknown as string, state: "SA" };
  const merged = hydrateFromDraft(server, { trading_name: "Typed Over", abn: "12 345 678 901", suburb: "Salisbury" });
  assert.equal(merged.trading_name, "Saved Co");
  assert.equal(merged.abn, "12 345 678 901");
  assert.equal(merged.suburb, "Salisbury");
  assert.equal(merged.state, "SA");
  assert.deepEqual(hydrateFromDraft(server, undefined), server);
});