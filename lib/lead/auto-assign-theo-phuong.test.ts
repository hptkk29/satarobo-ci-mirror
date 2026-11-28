// [CTP-A*] `autoAssignNewLead` chia cơ sở theo PHƯỜNG/XÃ trước, chia đều sau.
//
// UNIT THUẦN, không chạm Postgres (job "Unit tests (Vitest)" không có service postgres). Chế độ cơ sở đặt MANUAL để hàm dừng ngay sau khi định
// cơ sở và trả `centerId` — thứ duy nhất ca này cần quan sát (chọn người nhận là việc của các ca khác).
//
//   [CTP-A01] bật + phường đã đặt cho cơ sở B ⇒ lead vào B, DÙ A ít lead mở hơn (chia đều sẽ chọn A) — và ghi centerId vào lead
//   [CTP-A02] công tắc TẮT ⇒ chia đều như cũ (A)
//   [CTP-A03] chưa có dòng cấu hình ⇒ chia đều như cũ (A)
//   [CTP-A04] phường chưa đặt ⇒ chia đều như cũ
//   [CTP-A05] cơ sở của phường không còn nhận lead (đóng / không ghi danh) ⇒ chia đều, không đẩy lead về nơi không có sale
//   [CTP-A06] lead ĐÃ có cơ sở ⇒ giữ nguyên, KHÔNG đọc cấu hình
//   [CTP-A07] lead thiếu phường ⇒ KHÔNG đọc cấu hình (đỡ một câu truy vấn cho phần lớn lead nhập tay/Excel)
//   [CTP-A08] tên phường viết lệch dấu / tiền tố vẫn khớp
//   [CTP-A09] cấu hình hỏng ⇒ chia đều, không ném

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const leadFindUnique = vi.fn();
  const leadUpdate = vi.fn(async (_a: unknown) => ({}));
  const leadGroupBy = vi.fn(async (_a: unknown) => [] as unknown[]);
  const centerFindMany = vi.fn(async (_a: unknown) => [{ id: "cs_a" }, { id: "cs_b" }]);
  const cfgFindUnique = vi.fn(async (_a: unknown) => null as unknown);
  const nonEnrollable = vi.fn(async () => [] as string[]);
  return { leadFindUnique, leadUpdate, leadGroupBy, centerFindMany, cfgFindUnique, nonEnrollable };
});

vi.mock("@/lib/db", () => ({
  db: {
    lead: { findUnique: h.leadFindUnique, groupBy: h.leadGroupBy, update: h.leadUpdate },
    center: { findMany: h.centerFindMany },
    integrationConfig: { findUnique: h.cfgFindUnique },
    leadActivity: { count: vi.fn(async () => 0) },
    leadAssignmentConfig: { findUnique: vi.fn(async () => ({ mode: "MANUAL" })) },
  },
}));
vi.mock("@/lib/enrollment-flow", () => ({ getNonEnrollableCenterIds: h.nonEnrollable }));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: vi.fn(async () => "ou") }));
vi.mock("@/lib/audit/log", () => ({ logLeadAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/lead/pool", () => ({ layPoolDangBat: vi.fn(async () => []), orgUnitIdCuaCoSo: vi.fn(async () => "ou") }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: vi.fn(async () => 0), thuHoiThongBao: vi.fn(async () => 0), broadcastNotificationBump: vi.fn(async () => undefined) }));

import { autoAssignNewLead } from "@/lib/lead/auto-assign";
import { PROVIDER_PHUONG_CO_SO } from "@/lib/lead/chia-theo-phuong";

const ACTOR = { actorId: null, actorName: "Hệ thống (web)" };
const LEAD_MOI = { id: "lead_1", centerId: null, status: "MOI", assignedToId: null, parentName: "Chị Lan", city: "Tp Đà Nẵng", ward: "Phường Hải Châu" };
const BANG_BAT = { isEnabled: true, settings: { phienBan: 1, map: { "da nang|hai chau": "cs_b" } } };

beforeEach(() => {
  h.leadFindUnique.mockReset().mockResolvedValue(LEAD_MOI);
  h.leadUpdate.mockClear();
  // Cơ sở B đang ĐÔNG hơn (5 lead mở), A trống ⇒ chia đều sẽ chọn A.
  h.leadGroupBy.mockReset().mockResolvedValue([{ centerId: "cs_b", _count: { id: 5 } }]);
  h.centerFindMany.mockClear().mockResolvedValue([{ id: "cs_a" }, { id: "cs_b" }]);
  h.nonEnrollable.mockReset().mockResolvedValue([]);
  h.cfgFindUnique.mockReset().mockResolvedValue(BANG_BAT);
});

describe("[CTP-A01] bật + phường đã đặt", () => {
  it("lead vào cơ sở của phường dù cơ sở khác ít lead hơn; ghi centerId", async () => {
    const kq = await autoAssignNewLead("lead_1", ACTOR);
    expect(kq.centerId).toBe("cs_b");
    expect(h.cfgFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { provider: PROVIDER_PHUONG_CO_SO } }));
    expect(h.leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ centerId: "cs_b" }) }));
  });
});

describe("[CTP-A02..A05] không quyết được theo phường ⇒ chia đều như cũ (A)", () => {
  it("[CTP-A02] công tắc TẮT", async () => {
    h.cfgFindUnique.mockResolvedValue({ ...BANG_BAT, isEnabled: false });
    expect((await autoAssignNewLead("lead_1", ACTOR)).centerId).toBe("cs_a");
  });
  it("[CTP-A03] chưa có dòng cấu hình", async () => {
    h.cfgFindUnique.mockResolvedValue(null);
    expect((await autoAssignNewLead("lead_1", ACTOR)).centerId).toBe("cs_a");
  });
  it("[CTP-A04] phường chưa đặt", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD_MOI, ward: "Phường Thanh Khê" });
    expect((await autoAssignNewLead("lead_1", ACTOR)).centerId).toBe("cs_a");
  });
  it("[CTP-A05] cơ sở của phường không còn nhận lead", async () => {
    h.nonEnrollable.mockResolvedValue(["cs_b"]);
    expect((await autoAssignNewLead("lead_1", ACTOR)).centerId).toBe("cs_a");
    h.nonEnrollable.mockResolvedValue([]);
    h.centerFindMany.mockResolvedValue([{ id: "cs_a" }]); // cs_b đã đóng cửa (isActive=false)
    expect((await autoAssignNewLead("lead_1", ACTOR)).centerId).toBe("cs_a");
  });
});

describe("[CTP-A06] lead đã có cơ sở", () => {
  it("giữ nguyên, không đọc cấu hình", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD_MOI, centerId: "cs_a" });
    const kq = await autoAssignNewLead("lead_1", ACTOR);
    expect(kq.centerId).toBe("cs_a");
    expect(h.cfgFindUnique).not.toHaveBeenCalled();
  });
});

describe("[CTP-A07] lead thiếu phường", () => {
  it.each([[{ ward: null }], [{ city: null }], [{ ward: null, city: null }]])("%j ⇒ không đọc cấu hình", async (thieu) => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD_MOI, ...thieu });
    const kq = await autoAssignNewLead("lead_1", ACTOR);
    expect(kq.centerId).toBe("cs_a");
    expect(h.cfgFindUnique).not.toHaveBeenCalled();
  });
});

describe("[CTP-A08] tên phường viết lệch", () => {
  it.each([["hải châu"], ["HAI CHAU"], ["Phường  Hải Châu"], ["Hải Châu"]])("%j vẫn khớp", async (ward) => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD_MOI, city: "Đà Nẵng", ward });
    expect((await autoAssignNewLead("lead_1", ACTOR)).centerId).toBe("cs_b");
  });
});

describe("[CTP-A09] cấu hình hỏng", () => {
  it.each([[{ isEnabled: true, settings: "hỏng" }], [{ isEnabled: true, settings: { phienBan: 9 } }], [{ isEnabled: true, settings: null }]])("%j ⇒ chia đều, không ném", async (cfg) => {
    h.cfgFindUnique.mockResolvedValue(cfg);
    expect((await autoAssignNewLead("lead_1", ACTOR)).centerId).toBe("cs_a");
  });
});
