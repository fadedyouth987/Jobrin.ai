import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("the public hero demo never promises a booking the receptionist cannot make", async () => {
  const source = await read("../src/pages/PublicHome.tsx");
  assert.doesNotMatch(source, /I can book one of our plumbers/i);
  assert.match(source, /Can I take your name and a callback number\?/);
  assert.doesNotMatch(source, /suggests bookings/i);
});

test("the AI Command Centre is reachable from the truth-in-UI navigation", async () => {
  const navigation = await read("../src/app/workspaceNavigation.tsx");
  assert.match(navigation, /\['\/app\/command','Command Centre',Sparkles\]/);
});

test("dashboard navigation label matches the page it renders", async () => {
  const navigation = await read("../src/app/workspaceNavigation.tsx");
  assert.match(navigation, /\['\/app','Today',Home\]/);
});

test("live answering stays locked without an auditable owner sign-off", async () => {
  const route = await read("../server/routes/receptionist.ts");
  assert.match(route, /RECEPTIONIST_SIGNOFF_REQUIRED/);
  assert.match(route, /receptionist\.go_live/);
  assert.match(route, /receptionist\.go_live_signed/);
  const readiness = await read("../server/ai/receptionistReadiness.ts");
  assert.match(readiness, /Owner sign-off recorded/);
});

test("the receptionist page gates the go-live switch on full readiness", async () => {
  const pages = await read("../src/pages/AppPages.tsx");
  assert.match(pages, /go-live-signoff/);
  assert.match(pages, /Owner sign-off required before live answering/);
  assert.doesNotMatch(pages, /a test call has succeeded/);
});

test("pricing states AUD with GST treatment and a contact path for the founding offer", async () => {
  const pricing = await read("../src/pages/PricingPage.tsx");
  assert.match(pricing, /includes GST/);
  assert.match(pricing, /href="\/support"/);
});

test("automation approvals raise owner notifications", async () => {
  const runner = await read("../server/automation/runner.ts");
  assert.match(runner, /automation\.approval_needed/);
  const pages = await read("../src/pages/AppPages.tsx");
  assert.match(pages, /Every alert in one place: new leads, online bookings, messages taken by the AI receptionist and approvals waiting\./);
});

test("onboarding answers persist across refreshes and completed steps are navigable", async () => {
  const onboarding = await read("../src/pages/OnboardingPage.tsx");
  assert.match(onboarding, /onboardingDraft/);
  assert.match(onboarding, /hydrateFromDraft/);
  assert.match(onboarding, /disabled=\{index >= step\}/);
});

test("shared surfaces carry the zero-context and accessibility affordances", async () => {
  const ui = await read("../src/components/saas/ui.tsx");
  assert.match(ui, /pendingNote/);
  assert.match(ui, /focus-visible:ring-2/);
  const shell = await read("../src/pages/AppShell.tsx");
  assert.match(shell, /aria-label="Notifications"/);
  assert.match(shell, /aria-label="Log out"/);
  const navigation = await read("../src/app/workspaceNavigation.tsx");
  assert.match(navigation, /import \{ HiringPage \} from '..\/pages\/HiringPage'/);
  const css = await read("../src/index.css");
  assert.match(css, /scroll-margin-top/);
});
