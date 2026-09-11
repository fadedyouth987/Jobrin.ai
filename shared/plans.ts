export type PlanKey = "starter" | "growth" | "operator";

export const PLAN_CATALOG: Record<
  PlanKey,
  {
    key: PlanKey;
    name: string;
    monthlyAud: number;
    description: string;
    featured?: boolean;
    entitlements: Record<string, number | boolean>;
    highlights: string[];
  }
> = {
  starter: {
    key: "starter",
    name: "Starter",
    monthlyAud: 149,
    description: "Essential operations for a small trade-services team.",
    entitlements: {
      "crm.core": true,
      "lead.capture": true,
      "ai.basic": true,
      "booking.core": true,
      "hiring.core": true,
      "automations.advanced": false,
      "campaigns.revenue": false,
      "operator.full": false,
      "usage.users": 2,
      "usage.sms": 250,
      "usage.ai_actions": 250,
    },
    highlights: [
      "2 team members",
      "250 SMS actions per month",
      "250 AI Admin actions per month",
      "CRM, jobs, quotes, invoices and hiring",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    monthlyAud: 299,
    description: "Coordinated operations and automations for a growing team.",
    featured: true,
    entitlements: {
      "crm.core": true,
      "lead.capture": true,
      "ai.basic": true,
      "booking.core": true,
      "hiring.core": true,
      "automations.advanced": true,
      "campaigns.revenue": true,
      "operator.full": false,
      "usage.users": 8,
      "usage.sms": 1000,
      "usage.ai_actions": 1500,
    },
    highlights: [
      "8 team members",
      "1,000 SMS actions per month",
      "1,500 AI Admin actions per month",
      "Advanced automations and campaigns",
    ],
  },
  operator: {
    key: "operator",
    name: "Operator",
    monthlyAud: 599,
    description: "Higher limits and the complete Operator capability set.",
    entitlements: {
      "crm.core": true,
      "lead.capture": true,
      "ai.basic": true,
      "booking.core": true,
      "hiring.core": true,
      "automations.advanced": true,
      "campaigns.revenue": true,
      "operator.full": true,
      "usage.users": 25,
      "usage.sms": 4000,
      "usage.ai_actions": 10000,
    },
    highlights: [
      "25 team members",
      "4,000 SMS actions per month",
      "10,000 AI Admin actions per month",
      "Full Operator capability set",
    ],
  },
};

export const PLAN_KEYS = Object.keys(PLAN_CATALOG) as PlanKey[];
export const PLAN_ENTITLEMENTS = Object.fromEntries(
  PLAN_KEYS.map((key) => [key, PLAN_CATALOG[key].entitlements]),
) as Record<PlanKey, Record<string, number | boolean>>;

