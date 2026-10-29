// A0-03 — điểm vào runtime: evaluatePermission (v1↔v2 + shadow + flag). Pure.
import { describe, it, expect, vi } from "vitest";
import { evaluatePermission } from "@/lib/auth/permission-eval";
import { buildActor } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";

const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "ho", code: "HO", type: "HO", parentId: "root", centerId: null },
];

// Actor v2 = true (SUPER_ADMIN@HO).
const saActor = buildActor({
  userId: "u1",
  orgNodes: ORG,
  rows: [
    {
      orgUnitId: "ho",
      status: "ACTIVE",
      effectiveFrom: new Date("2000-01-01"),
      effectiveTo: null,
      role: { code: "SUPER_ADMIN", isActive: true, permissions: [] },
    },
  ],
});
// Actor v2 = false (không role).
const emptyActor = buildActor({ userId: "u2", orgNodes: ORG, rows: [] });

describe("[A0-03] evaluatePermission (runtime entry)", () => {
  it("[A0-03-T12-01] flag OFF → dùng v1 (matrix)", () => {
    // v1: SUPER_ADMIN matrix cho leads:view-all = true; v2 (emptyActor) = false.
    const r = evaluatePermission({
      sessionUser: { role: "SUPER_ADMIN" },
      actor: emptyActor,
      action: "leads:view-all",
      flagOn: false,
      logger: { warn: vi.fn() },
    });
    expect(r).toBe(true); // theo v1
  });

  it("[A0-03-T12-03] flag ON → dùng v2 (actor)", () => {
    // v1 (sessionUser null) = false; v2 (saActor SUPER_ADMIN) = true.
    const r = evaluatePermission({
      sessionUser: null,
      actor: saActor,
      action: "leads:view-all",
      flagOn: true,
      logger: { warn: vi.fn() },
    });
    expect(r).toBe(true); // theo v2
  });

  it("[A0-03-T12-02] v1≠v2 → log shadow", () => {
    const logger = { warn: vi.fn() };
    evaluatePermission({
      sessionUser: { role: "SUPER_ADMIN" }, // v1 true
      actor: emptyActor, // v2 false
      action: "leads:view-all",
      flagOn: false,
      logger,
    });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("action ngoài registry → v1=false (không crash)", () => {
    const r = evaluatePermission({
      sessionUser: { role: "SUPER_ADMIN" },
      actor: emptyActor,
      action: "evil:hack",
      flagOn: false,
      logger: { warn: vi.fn() },
    });
    expect(r).toBe(false);
  });

  it("sessionUser null + actor null → false", () => {
    expect(
      evaluatePermission({ sessionUser: null, actor: null, action: "leads:view-all", flagOn: true }),
    ).toBe(false);
  });
});
