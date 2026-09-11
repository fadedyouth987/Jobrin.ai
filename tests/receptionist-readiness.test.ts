import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGoLiveChecklist } from "../server/ai/receptionistReadiness";

const technical = { twilio: true, ai: true, securePublicUrl: true, conversationRelay: true };
const fullProfile = { transfer_number: "+61400000000", recording_enabled: false };
const fullBusiness = { trading_name: "Bradley Plumbing", phone: "0400000000", suburb: "Salisbury", state: "SA" };

test("go-live checklist blocks on technical dependencies and the missing sign-off", () => {
  const result = evaluateGoLiveChecklist({
    profile: fullProfile,
    businessProfile: fullBusiness,
    approvedKnowledgeCount: 3,
    technical: { twilio: false, ai: true, securePublicUrl: true, conversationRelay: false },
  });
  assert.equal(result.ready, false);
  const missing = result.items.filter((item) => !item.ok).map((item) => item.key);
  assert.deepEqual(missing, ["twilio", "engine", "signoff"]);
});

test("go-live checklist requires a complete business profile and approved knowledge", () => {
  const result = evaluateGoLiveChecklist({
    profile: fullProfile,
    businessProfile: { trading_name: "X", phone: null, suburb: null, state: null },
    approvedKnowledgeCount: 0,
    technical,
  });
  const missing = result.items.filter((item) => !item.ok).map((item) => item.key);
  assert.deepEqual(missing, ["profile", "knowledge", "signoff"]);
});

test("go-live checklist requires a transfer number and recording consent when recording is enabled", () => {
  const noTransfer = evaluateGoLiveChecklist({
    profile: { transfer_number: null, recording_enabled: false },
    businessProfile: fullBusiness,
    approvedKnowledgeCount: 1,
    technical,
  });
  const missing = noTransfer.items.filter((item) => !item.ok).map((item) => item.key);
  assert.deepEqual(missing, ["transfer", "signoff"]);

  const recording = evaluateGoLiveChecklist({
    profile: { transfer_number: "+61400000000", recording_enabled: true, recording_consent_prompt: "" },
    businessProfile: fullBusiness,
    approvedKnowledgeCount: 1,
    technical,
  });
  const recordingMissing = recording.items.filter((item) => !item.ok).map((item) => item.key);
  assert.deepEqual(recordingMissing, ["recording_consent", "signoff"]);
});

test("owner sign-off is required and reported once recorded", () => {
  const unsigned = evaluateGoLiveChecklist({
    profile: fullProfile,
    businessProfile: fullBusiness,
    approvedKnowledgeCount: 2,
    technical,
  });
  assert.equal(unsigned.ready, false);
  assert.equal(unsigned.signoff, null);

  const signed = evaluateGoLiveChecklist({
    profile: fullProfile,
    businessProfile: fullBusiness,
    approvedKnowledgeCount: 2,
    technical,
    signoff: { decided_at: "2026-09-11T00:00:00Z", decided_by: "owner-1", decision_note: "Reviewed with the team." },
  });
  assert.equal(signed.ready, true);
  assert.equal(signed.signoff?.decided_by, "owner-1");
  assert.equal(signed.signoff?.decision_note, "Reviewed with the team.");
});