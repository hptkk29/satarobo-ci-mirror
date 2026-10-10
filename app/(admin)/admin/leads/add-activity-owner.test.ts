// @vitest-environment node
/**
 * S-9 (27/08/2026) — ghi chú KHÔNG bị cấm, nhưng chỉ chủ phiếu và cấp quản lý
 * mới làm mới được đồng hồ chăm sóc.
 *
 * ĐẢO CHIỀU CÓ CHỦ ĐÍCH so với S-6 (đợt 1, cùng ngày). Lần đó lỗ hổng "đồng
 * nghiệp tắt hộ đồng hồ SLA" được bịt bằng cách CẤM LUÔN `addLeadActivity` với
 * người không phụ trách. Cách đó đóng được lỗ, nhưng đóng cả một việc hợp lệ:
 * người trực máy nhận cuộc gọi nhỡ, Sale Hội sở vừa nhập phiếu, đồng nghiệp
 * ngồi cạnh nghe máy hộ — họ vẫn cần ghi lại điều khách vừa nói. Ghi lại một
 * câu nói thì không nguy hiểm.
 *
 * Thứ nguy hiểm là HỆ QUẢ ĐI KÈM mà không ai nhìn thấy — `recordLeadActivity`
 * (đường ghi DUY NHẤT) làm hai việc nữa:
 *
 *   · bump `Lead.lastActivityAt` ⇒ cột "số ngày chưa tiếp cận lại" của QLCS bị
 *     đồng nghiệp reset hộ, và chuông SLA-4 im;
 *   · đóng mốc `Lead.firstContactAt` khi loại là CALL/MESSAGE/EMAIL/NOTE
 *     ⇒ **chuông SLA-3 ("Chưa liên hệ khách > 3 giờ") tắt VĨNH VIỄN** — điều
 *     kiện tắt là `firstContactAt != null`, và mốc chỉ ghi được MỘT lần
 *     (`updateMany where firstContactAt: null`), không có đường undo.
 *
 * Nên luật đúng là tách hai thứ đó: dòng nhật ký cứ lưu, đồng hồ thì không.
 *
 * Không mock `recordLeadActivity`: cho nó chạy thật trên tx giả, để test khẳng
 * định được cả hai cú ghi phụ (lastActivityAt + firstContactAt) có/không xảy ra
 * — chứ không chỉ khẳng định "đã truyền đúng cờ".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  leadFindUnique: vi.fn(),
  leadUpdate: vi.fn(),
  leadUpdateMany: vi.fn(),
  activityCreate: vi.fn(),
  taskCreate: vi.fn(),
  transaction: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: h.checkPermission,
  canViewLeadPii: vi.fn(async () => true),
}));
vi.mock("@/lib/auth/permissions", () => ({ hasRole: vi.fn(() => false) }));
vi.mock("@/lib/db", () => ({
  db: {
    lead: {
      create: vi.fn(),
      update: h.leadUpdate,
      updateMany: h.leadUpdateMany,
      findFirst: vi.fn(),
      findUnique: h.leadFindUnique,
    },
    leadChild: { findUnique: vi.fn(), count: vi.fn() },
    trialEnrollment: { count: vi.fn(async () => 0) },
    $transaction: h.transaction,
  },
}));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({})),
}));
vi.mock("@/lib/audit/log", () => ({
  logLeadAudit: vi.fn(),
  getAuditActor: vi.fn(() => ({ actorId: "u-sale-a", actorName: "Sale A" })),
}));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/org/org-service", () => ({ centerIdForOrgUnit: vi.fn() }));
vi.mock("@/lib/enrollment-flow", () => ({ rejectHeadOffice: vi.fn() }));
vi.mock("@/lib/lead/auto-assign", () => ({
  autoAssignNewLead: vi.fn(),
  manualAssignLead: vi.fn(),
  reassignForCenter: vi.fn(),
}));
vi.mock("@/lib/lead/assign", () => ({ autoAssignLead: vi.fn(), reassignOpenLeads: vi.fn() }));
vi.mock("@/lib/lead/assignment", () => ({ assignmentWrite: vi.fn() }));
vi.mock("@/lib/lead/sharing", () => ({ leadSharingEnabled: vi.fn(() => false) }));
vi.mock("@/lib/crm/transfer-validate", () => ({ validateTransferTarget: vi.fn() }));
vi.mock("@/lib/payments/summary", () => ({ getLeadPaymentSummary: vi.fn() }));
vi.mock("@/lib/students/sync-name", () => ({ syncLeadChildNameToStudents: vi.fn() }));
// 26/09 — updateLeadFields/updateLeadChild dội ô chung sang học viên (lib/students/dong-bo-lead-db.ts);
// bộ này canh chuyện khác nên giả lập phần đó — dây nối có lưới riêng [DBL-W*].
vi.mock("@/lib/students/dong-bo-lead-db", () => ({
  dongBoTuLead: vi.fn(async () => ({ leadIds: [], studentIds: [] })),
  dongBoTuCon: vi.fn(async () => ({ leadIds: [], studentIds: [] })),
}));
vi.mock("@/lib/students/prior-history", () => ({
  getPriorHistoryByPhone: vi.fn(async () => []),
  summarizePriorHistory: vi.fn(() => ""),
}));
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));

import { addLeadActivity, addLeadTask } from "./actions";

/** Khách của Sale B, cùng cơ sở CS1 với người đang đăng nhập (Sale A). */
const KHACH_CUA_NGUOI_KHAC = { id: "lead-1", centerId: "cs1", assignedToId: "u-sale-b" };
const MOC_TX = new Date("2026-08-27T03:00:00.000Z");

/** Sale thường: sửa được lead, KHÔNG điều phối, KHÔNG nhìn toàn cơ sở. */
function quyenSaleThuong() {
  h.checkPermission.mockImplementation(async (action: string) => action === "leads:edit");
}
/** Quản lý cơ sở: có thêm `leads:assign` (điều phối lead) + `leads:view-all`. */
function quyenQuanLy() {
  h.checkPermission.mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale-a", name: "Sale A", centerId: "cs1" } });
  quyenSaleThuong();
  h.leadFindUnique.mockResolvedValue({ ...KHACH_CUA_NGUOI_KHAC });
  h.activityCreate.mockResolvedValue({ id: "act-1", createdAt: MOC_TX });
  h.leadUpdate.mockResolvedValue({ id: "lead-1" });
  h.leadUpdateMany.mockResolvedValue({ count: 1 });
  h.taskCreate.mockResolvedValue({ id: "task-1" });
  h.resolveActor.mockResolvedValue({ userId: "u-sale-a" });
  h.passesScope.mockReturnValue(true);
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      lead: { update: h.leadUpdate, updateMany: h.leadUpdateMany },
      leadActivity: { create: h.activityCreate },
      leadTask: { create: h.taskCreate },
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[S-9] người lạ ghi chú — ghi chú LƯU, đồng hồ KHÔNG đổi", () => {
  it("đồng nghiệp cùng cơ sở ghi được một dòng nhật ký", async () => {
    const res = await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "Gọi thử" });

    expect(res.ok).toBe(true);
    expect(h.activityCreate).toHaveBeenCalledTimes(1);
    expect(h.activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: "lead-1", content: "Gọi thử" }),
      }),
    );
  });

  it("…nhưng KHÔNG bump lastActivityAt (cột 'chưa tiếp cận lại' giữ nguyên)", async () => {
    await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "Gọi thử" });

    expect(h.leadUpdate).not.toHaveBeenCalled();
  });

  it("…và KHÔNG đóng mốc firstContactAt (chuông SLA-3 vẫn kêu)", async () => {
    await addLeadActivity({ leadId: "lead-1", type: "MESSAGE", content: "Nhắn thử" });

    // `updateMany where { firstContactAt: null }` là cú đóng mốc DUY NHẤT.
    expect(h.leadUpdateMany).not.toHaveBeenCalled();
  });

  it("nói thẳng cho người ghi biết đồng hồ không đổi — không im lặng thành công một nửa", async () => {
    // Báo "Đã ghi nhận" xong mà mốc SLA không đổi thì người ghi tưởng đã xử lý
    // xong phiếu. Một dòng chữ ở đây rẻ hơn nhiều so với một khách bị bỏ quên.
    const res = await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "Gọi thử" });

    expect(res.dongHoKhongDoi).toBe(true);
  });
});

describe("[S-9] chủ phiếu ghi chú — đồng hồ được làm mới", () => {
  beforeEach(() => {
    h.leadFindUnique.mockResolvedValue({ ...KHACH_CUA_NGUOI_KHAC, assignedToId: "u-sale-a" });
  });

  it("bump lastActivityAt đúng mốc transaction của dòng vừa ghi", async () => {
    const res = await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "Đã gọi" });

    expect(res.ok).toBe(true);
    expect(h.leadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastActivityAt: MOC_TX } }),
    );
  });

  it("đóng mốc 'liên hệ lần đầu' — và chỉ khi mốc còn trống", async () => {
    await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "Đã gọi" });

    expect(h.leadUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lead-1", firstContactAt: null } }),
    );
  });

  it("không gắn cờ 'đồng hồ không đổi'", async () => {
    const res = await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "Đã gọi" });
    expect(res.dongHoKhongDoi).toBeUndefined();
  });
});

describe("[S-9] cấp quản lý ghi hộ — đồng hồ ĐƯỢC làm mới", () => {
  it("người có quyền điều phối lead làm mới được đồng hồ trên phiếu người khác", async () => {
    quyenQuanLy();

    const res = await addLeadActivity({ leadId: "lead-1", type: "NOTE", content: "QL ghi chú" });

    expect(res.ok).toBe(true);
    expect(h.leadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastActivityAt: MOC_TX } }),
    );
    expect(res.dongHoKhongDoi).toBeUndefined();
  });

  it("hỏi ĐÚNG quyền điều phối, kèm cơ sở của phiếu", async () => {
    // Hỏi `leads:assign` chứ không phải `leads:view-all`: quyền ĐỌC đó đang cấp
    // cho cả Marketing, lấy nó làm cửa tắt đồng hồ là để Marketing tắt SLA của
    // Sale. Và phải kèm `centerId` để scope CENTER của RBAC v2 xét đúng cơ sở.
    quyenQuanLy();
    await addLeadActivity({ leadId: "lead-1", type: "NOTE", content: "QL ghi chú" });

    expect(h.checkPermission).toHaveBeenCalledWith("leads:assign", { centerId: "cs1" });
  });
});

describe("[S-9] phiếu CHƯA GIAO cho ai", () => {
  it("Sale thường không đóng hộ mốc liên hệ đầu của phiếu vô chủ", async () => {
    // Phiếu chưa có người phụ trách thì không ai là chủ đồng hồ. Cho người đầu
    // tiên đi ngang qua đóng mốc là tắt chuông của phiếu chưa ai gọi.
    h.leadFindUnique.mockResolvedValue({ ...KHACH_CUA_NGUOI_KHAC, assignedToId: null });

    const res = await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "Gọi thử" });

    expect(res.ok).toBe(true);
    expect(h.activityCreate).toHaveBeenCalledTimes(1);
    expect(h.leadUpdateMany).not.toHaveBeenCalled();
  });
});

describe("[S-9] các cổng cũ KHÔNG bị nới theo", () => {
  it("thiếu leads:edit → vẫn chặn ở cổng quyền trước, không ghi được gì", async () => {
    h.checkPermission.mockResolvedValue(false);

    const res = await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "x" });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Không có quyền");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("lead ngoài tầm nhìn cơ sở → 'không tồn tại', không ghi được gì", async () => {
    h.passesScope.mockReturnValue(false);

    const res = await addLeadActivity({ leadId: "lead-1", type: "CALL", content: "x" });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Lead không tồn tại");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("TẠO VIỆC follow-up vẫn đòi chủ sở hữu — nới ghi chú không nới việc", async () => {
    // Một dòng ghi chú là lời kể; một việc follow-up là GIAO VIỆC cho người
    // khác và nó cũng bump `lastActivityAt`. Hai thứ khác nhau, giữ khác nhau.
    const task = await addLeadTask({
      leadId: "lead-1",
      title: "Gọi lại",
      dueAt: "2026-09-01T02:00:00.000Z",
    });

    expect(task.ok).toBe(false);
    expect(task.error).toMatch(/người phụ trách/i);
    expect(h.taskCreate).not.toHaveBeenCalled();
  });
});
