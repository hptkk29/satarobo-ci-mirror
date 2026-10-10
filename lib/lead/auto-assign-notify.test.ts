// Chia lead TỰ ĐỘNG bằng đường lùi (`autoAssignNewLead`) phải báo cho sale được chia.
//
// Vì sao đây không phải một nhánh hiếm: `POST /api/leads` (form web /lien-he) và
// `ingestIntakeLead` (quatang, form Sale) đều rơi vào hàm này khi `centerId` không giải được —
// khách bỏ trống ô cơ sở, hoặc chuỗi cơ sở trên phiếu không khớp cơ sở nào trong DB. Đường
// chính (`chiaChoLead`) có chuông từ 30/08, đường lùi thì câm, nên đúng những phiếu KHÓ NHẤT
// lại là phiếu không ai được báo.
//
// UNIT THUẦN, không chạm Postgres: job required "Unit tests (Vitest)" không có service postgres.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const thuTu: string[] = [];
  const leadFindUnique = vi.fn();
  const leadGroupBy = vi.fn(async (_a: unknown) => [] as unknown[]);
  const leadActivityCount = vi.fn(async (_a: unknown) => 0);
  const cfgFindUnique = vi.fn(async (_a: unknown) => ({ mode: "CLOSE_RATE" }));
  const userFindUnique = vi.fn(async (_a: unknown) => ({ name: "Sale A" }));
  const notifyStaff = vi.fn(async (_p: Record<string, unknown>) => {
    thuTu.push("notifyStaff");
    return 1;
  });
  const layPoolDangBat = vi.fn(async () => [{ userId: "usr_sale" }]);
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    thuTu.push("tx:mo");
    const r = await cb({
      lead: { update: vi.fn(async () => ({})) },
      leadActivity: { create: vi.fn(async () => ({})) },
    });
    thuTu.push("tx:dong");
    return r;
  });
  return {
    thuTu,
    leadFindUnique,
    notifyStaff,
    layPoolDangBat,
    transaction,
    mockDb: {
      lead: { findUnique: leadFindUnique, groupBy: leadGroupBy, update: vi.fn(async () => ({})) },
      leadActivity: { count: leadActivityCount },
      leadAssignmentConfig: { findUnique: cfgFindUnique },
      user: { findUnique: userFindUnique, findMany: vi.fn(async () => []) },
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/notifications/notify", () => ({
  notifyStaff: h.notifyStaff,
  thuHoiThongBao: vi.fn(async () => 0),
  broadcastNotificationBump: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audit/log", () => ({ logLeadAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: vi.fn(async () => "ou_cs1") }));
vi.mock("@/lib/lead/pool", () => ({
  layPoolDangBat: h.layPoolDangBat,
  orgUnitIdCuaCoSo: vi.fn(async () => "ou_cs1"),
}));

import { autoAssignNewLead } from "@/lib/lead/auto-assign";

const ACTOR = { actorId: null, actorName: "Hệ thống (web)" };
const LEAD = {
  id: "lead_1",
  centerId: "cs1",
  status: "MOI",
  assignedToId: null,
  parentName: "Chị Lan",
};

beforeEach(() => {
  h.thuTu.length = 0;
  h.leadFindUnique.mockReset().mockResolvedValue(LEAD);
  h.notifyStaff.mockClear();
  h.transaction.mockClear();
  h.layPoolDangBat.mockClear().mockResolvedValue([{ userId: "usr_sale" }]);
});

function chuong(): Record<string, unknown> {
  const a = h.notifyStaff.mock.calls[0]?.[0];
  if (!a) throw new Error("notifyStaff chưa được gọi lần nào");
  return a;
}

describe("[LEAD-AUTO-T01] đường lùi cũng phải báo", () => {
  it("chia được cho một sale → notifyStaff đúng người, đúng khoá sẵn có", async () => {
    const kq = await autoAssignNewLead("lead_1", ACTOR);
    expect(kq.assignedToId).toBe("usr_sale");
    const c = chuong();
    expect(c.userIds).toEqual(["usr_sale"]);
    expect(c.dedupeKey).toBe("lead.moi:lead_1");
    expect(c.href).toBe("/leads/lead_1");
    expect(String(c.body)).toContain("Chị Lan");
  });

  it("chuông chạy SAU khi transaction đóng", async () => {
    await autoAssignNewLead("lead_1", ACTOR);
    const iTx = h.thuTu.indexOf("tx:dong");
    expect(iTx).toBeGreaterThanOrEqual(0);
    expect(h.thuTu.indexOf("notifyStaff")).toBeGreaterThan(iTx);
  });
});

describe("[LEAD-AUTO-T02] không báo khi KHÔNG chia được", () => {
  it("lead đã có chủ → thoát sớm, không chuông", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD, assignedToId: "usr_khac" });
    const kq = await autoAssignNewLead("lead_1", ACTOR);
    expect(kq.skipped).toBe(true);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("cơ sở không còn sale nào → để CHƯA PHÂN, không chuông", async () => {
    // Đợt D (22/08) đã bỏ fallback chia xuyên cơ sở: không có sale trong cơ sở thì để trống
    // cho quản lý xử, chứ không giao cho người ở cơ sở khác (họ không mở nổi lead).
    h.layPoolDangBat.mockResolvedValue([]);
    const kq = await autoAssignNewLead("lead_1", ACTOR);
    expect(kq.assignedToId).toBeNull();
    expect(h.notifyStaff).not.toHaveBeenCalled();
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("lead không tồn tại", async () => {
    h.leadFindUnique.mockResolvedValue(null);
    const kq = await autoAssignNewLead("lead_x", ACTOR);
    expect(kq.ok).toBe(false);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });
});
