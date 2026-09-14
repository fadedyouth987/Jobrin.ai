import { Router } from "express";
import { z } from "zod";
import { asyncRoute, validateBody } from "../security";
import {
  createUserClient,
  requireActiveSubscription,
  requireAuth,
  requireRole,
  requireSensitiveAuth,
  requireWorkspace,
  supabaseAdmin,
  type AuthenticatedRequest,
  writeAudit,
} from "../supabase";
import { normalizeE164, requireTwilioConfig, twilioConfigured } from "../providers/twilio";
import { stripeConfigured } from "../providers/stripe";
import { emailConfigured } from "../providers/email";
import { openaiConfigured } from "../providers/openai";
import { PHONE_NUMBER_E164 } from "../phoneNumbers";

const router = Router();
router.use(
  requireAuth,
  requireWorkspace,
  requireActiveSubscription("crm.core"),
);

router.get(
  "/",
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    // SELECT on `integrations` is server-only (migration 0005 revoked it from
    // authenticated), so the list is read through the admin client, scoped to
    // the caller's workspace — the user client fails here with 42501.
    const { data, error } = await supabaseAdmin
      .from("integrations")
      .select(
        "id,provider,status,external_account_id,scopes,last_success_at,last_error_at,error_code,connected_at,updated_at",
      )
      .eq("workspace_id", req.workspaceId!)
      .order("provider");
    if (error)
      return res.status(500).json({ error: "INTEGRATION_LIST_FAILED" });
    res.json({
      integrations: data ?? [],
      readiness: {
        stripe: stripeConfigured(),
        twilio: twilioConfigured(),
        email: emailConfigured(),
        openai: openaiConfigured(),
      },
    });
  }),
);

router.post(
  "/twilio/activate",
  requireRole("owner", "admin"),
  requireSensitiveAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    if (!twilioConfigured())
      return res.status(503).json({ error: "TWILIO_NOT_CONFIGURED" });
    const { phoneNumber } = requireTwilioConfig();
    const { data: owner, error: ownerError } = await supabaseAdmin
      .from("integrations")
      .select("workspace_id")
      .eq("provider", "twilio")
      .eq("external_account_id", phoneNumber)
      .in("status", ["connecting", "connected", "degraded"])
      .neq("workspace_id", req.workspaceId!)
      .maybeSingle();
    if (ownerError)
      return res.status(500).json({ error: "TWILIO_NUMBER_CHECK_FAILED" });
    if (owner)
      return res.status(409).json({ error: "TWILIO_NUMBER_ALREADY_ASSIGNED" });

    const { data, error } = await supabaseAdmin
      .from("integrations")
      .upsert(
        {
          workspace_id: req.workspaceId!,
          provider: "twilio",
          status: "connected",
          external_account_id: phoneNumber,
          scopes: ["messaging"],
          encrypted_credentials: null,
          connected_by: req.auth!.userId,
          connected_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          error_code: null,
        },
        { onConflict: "workspace_id,provider,external_account_id" },
      )
      .select("id,provider,status,external_account_id,scopes,connected_at")
      .single();
    if (error)
      return res.status(500).json({ error: "TWILIO_ACTIVATION_FAILED" });
    // Keep workspace_phone_numbers (the table that supports more than one
    // number per workspace and drives inbound call/SMS routing) in sync with
    // this legacy single-number activation path, so a workspace that has
    // only ever used this button still shows up correctly in the numbers
    // list and continues to route exactly as before.
    await supabaseAdmin.from("workspace_phone_numbers").upsert(
      {
        workspace_id: req.workspaceId!,
        phone_number: phoneNumber,
        label: "Primary line",
        is_primary: true,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number" },
    );
    await writeAudit(
      req,
      "integration.twilio_activated",
      "integration",
      data.id,
      { phoneNumber: data.external_account_id },
    );
    res.status(201).json({ integration: data });
  }),
);

const phoneNumberCreateSchema = z
  .object({
    phone_number: z.string().trim().regex(PHONE_NUMBER_E164),
    label: z.string().trim().min(1).max(80).default("Untitled line"),
  })
  .strict();

const phoneNumberUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    display_name_override: z.string().trim().min(2).max(80).nullable().optional(),
    greeting_override: z.string().trim().min(10).max(500).nullable().optional(),
    voice_provider_override: z.enum(["Google", "Amazon", "ElevenLabs"]).nullable().optional(),
    voice_id_override: z.string().trim().min(2).max(120).nullable().optional(),
    language_override: z.string().trim().min(2).max(20).nullable().optional(),
    after_hours_message_override: z.string().trim().min(10).max(500).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

// Multiple phone numbers per workspace: list, add, label/deactivate, and
// assign per-number receptionist overrides (greeting/voice/hours/name).
// Reads go through the user's own client -- RLS on workspace_phone_numbers
// allows any workspace member to see the numbers list, matching
// receptionist_profiles' visibility. Writes are owner/admin + step-up,
// consistent with every other tenant-configuration mutation in this file.
router.get(
  "/numbers",
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const db = createUserClient(req.auth!.accessToken);
    const { data, error } = await db
      .from("workspace_phone_numbers")
      .select(
        "id,phone_number,label,is_primary,status,display_name_override,greeting_override,voice_provider_override,voice_id_override,language_override,after_hours_message_override,created_at,updated_at",
      )
      .eq("workspace_id", req.workspaceId!)
      .order("is_primary", { ascending: false })
      .order("created_at");
    if (error) return res.status(500).json({ error: "PHONE_NUMBER_LIST_FAILED" });
    res.json({ numbers: data ?? [] });
  }),
);

router.post(
  "/numbers",
  requireRole("owner", "admin"),
  requireSensitiveAuth,
  validateBody(phoneNumberCreateSchema),
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const phoneNumber = normalizeE164(req.body.phone_number);
    if (!PHONE_NUMBER_E164.test(phoneNumber))
      return res.status(400).json({ error: "PHONE_NUMBER_INVALID" });
    // A Twilio number can only ever route to one workspace -- guard against
    // hijacking a number another workspace (or this one, twice) already owns.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("workspace_phone_numbers")
      .select("id")
      .eq("phone_number", phoneNumber)
      .maybeSingle();
    if (existingError) return res.status(500).json({ error: "PHONE_NUMBER_CHECK_FAILED" });
    if (existing) return res.status(409).json({ error: "PHONE_NUMBER_ALREADY_ASSIGNED" });
    const db = createUserClient(req.auth!.accessToken);
    const { count } = await db
      .from("workspace_phone_numbers")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", req.workspaceId!);
    const { data, error } = await db
      .from("workspace_phone_numbers")
      .insert({
        workspace_id: req.workspaceId!,
        phone_number: phoneNumber,
        label: req.body.label,
        is_primary: !count,
        status: "active",
      })
      .select("*")
      .single();
    if (error) return res.status(500).json({ error: "PHONE_NUMBER_CREATE_FAILED" });
    await writeAudit(req, "integration.phone_number_added", "workspace_phone_number", data.id, {
      phoneNumber: data.phone_number,
    });
    res.status(201).json({ number: data });
  }),
);

router.patch(
  "/numbers/:id",
  requireRole("owner", "admin"),
  requireSensitiveAuth,
  validateBody(phoneNumberUpdateSchema),
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const db = createUserClient(req.auth!.accessToken);
    const { data: existing, error: existingError } = await db
      .from("workspace_phone_numbers")
      .select("id,is_primary")
      .eq("workspace_id", req.workspaceId!)
      .eq("id", req.params.id)
      .maybeSingle();
    if (existingError) return res.status(500).json({ error: "PHONE_NUMBER_LOAD_FAILED" });
    if (!existing) return res.status(404).json({ error: "PHONE_NUMBER_NOT_FOUND" });
    if (existing.is_primary && req.body.status === "inactive") {
      return res.status(409).json({
        error: "PHONE_NUMBER_PRIMARY_CANNOT_DEACTIVATE",
        message: "Set another number as primary before deactivating this one.",
      });
    }
    const { data, error } = await db
      .from("workspace_phone_numbers")
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq("workspace_id", req.workspaceId!)
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) return res.status(500).json({ error: "PHONE_NUMBER_UPDATE_FAILED" });
    await writeAudit(req, "integration.phone_number_updated", "workspace_phone_number", data.id, {
      status: data.status,
    });
    res.json({ number: data });
  }),
);

export default router;
