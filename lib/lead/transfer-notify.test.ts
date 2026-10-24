// CHUYỂN LEAD (`transferLead`) phải báo cho người nhận, và THU HỒI chuông của người cũ.
//
// Trước 08/09/2026 đường này câm hoàn toàn: sổ ghi đủ ba vết (LeadActivity HANDOVER,
// LeadTransfer, audit ASSIGN) nhưng sale nhận không biết gì — tên người nhận thậm chí đã được
// tra rồi vứt đi bằng `void toSale`.
//
// UNIT THUẦN, không chạm Postgres: job required "Unit tests (Vitest)" không có service postgres
// nên test chạm DB sẽ SKIP im lặng ở đúng cổng đáng lẽ phải canh.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const thuTu: string[] = [];
  const leadFindFirst = vi.fn();
  const userFindFirst = vi.fn();
  const userFindUnique = vi.fn(async () => ({ name: "Sale B" }));
  const centerFindUnique = vi.fn(async () => ({ name: "CS2" }));
  const notifyStaff = vi.fn(async (_p: Record<string, unknown>) => {
    thuTu.push("notifyStaff");
    return 1;
  });
  const thuHoiThongBao = vi.fn(async (_p: Record<string, unknown>) => {
    thuTu.push("thuHoi");
    return 1;
  });
  const reassignForCenter = vi.fn(async () => "usr_saleB" as string | null);
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    thuTu.push("tx:mo");
    const r = await cb({
      // `updateMany` — thêm 16/09/2026 khi hợp nhất: `transferLead` nay ghi dòng hoạt
      // động qua `recordLeadActivity` (cổng N-4), và hàm đó đóng mốc `firstContactAt`
      // bằng `updateMany` có điều kiện "chỉ khi còn trống". Thiếu khoá này trong mock là
      // cả tệp đổ với `input.tx.lead.updateMany is not a function`.
      lead: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
      leadActivity: { create: vi.fn(async () => ({})) },
      leadTransfer: { create: vi.fn(async () => ({})) },
    });
    thuTu.push("tx:dong");
    return r;
  });
  return {
    thuTu,
    leadFindFirst,
    userFindFirst,
    userFindUnique,
    centerFindUnique,
    notifyStaff,
    thuHoiThongBao,
    reassignForCenter,
    transaction,
    mockDb: {
      lead: { findFirst: leadFindFirst, findUnique: vi.fn(async () => null) },
      user: {
        findFirst: userFindFirst,
        findUnique: userFindUnique,
        // `baoPoolRong` tra quản lý cơ sở đích + quản trị hệ thống.
        findMany: vi.fn(async () => [{ id: "usr_qlcs2" }]),
      },
      center: { findUnique: centerFindUnique, findMany: vi.fn(async () => []) },
      orgUnit: { findMany: vi.fn(async () => []) },
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/notifications/notify", () => ({
  notifyStaff: h.notifyStaff,
  thuHoiThongBao: h.thuHoiThongBao,
  ghiThongBaoNhanSu: vi.fn(),
  broadcastNotificationBump: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "usr_ql", name: "QL" } })) }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: vi.fn(async () => true),
  canViewLeadPii: vi.fn(async () => true),
}));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: vi.fn(async () => ({ userId: "usr_ql" })) }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: vi.fn(() => true),
  scopedDb: vi.fn(() => h.mockDb),
}));
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({
  logLeadAudit: vi.fn(async () => undefined),
  getAuditActor: vi.fn(() => ({ actorId: "usr_ql", actorName: "QL" })),
}));
vi.mock("@/lib/lead/auto-assign", () => ({
  reassignForCenter: h.reassignForCenter,
  autoAssignNewLead: vi.fn(),
  manualAssignLead: vi.fn(),
}));

import { transferLead } from "@/app/(admin)/admin/leads/actions";

const LEAD = {
  id: "lead_1",
  assignedToId: "usr_saleA",
  centerId: "cs1",
  status: "MOI",
  parentName: "Chị Lan",
};

function dauVao(ghiDe: Record<string, unknown> = {}) {
  return {
    leadId: "lead_1",
    toSaleId: "usr_saleB",
    handoverNote: "Đã tư vấn gói Sata 1, khách hẹn gọi lại chiều mai.",
    ...ghiDe,
  };
}

beforeEach(() => {
  h.thuTu.length = 0;
  h.leadFindFirst.mockReset().mockResolvedValue(LEAD);
  // Sale nhận mang ĐỦ hình dạng thật mà transferLead nay đọc (còn làm + cơ sở = cơ sở của lead).
  h.userFindFirst.mockReset().mockResolvedValue({ id: "usr_saleB", isActive: true, centerId: "cs1" });
  h.notifyStaff.mockClear();
  h.thuHoiThongBao.mockClear();
  h.transaction.mockClear();
  h.reassignForCenter.mockReset().mockResolvedValue("usr_saleB");
});

/** Lượt gọi chuông đầu tiên. Ném lỗi có nghĩa nếu chưa gọi lần nào. */
function chuong(): Record<string, unknown> {
  const a = h.notifyStaff.mock.calls[0]?.[0];
  if (!a) throw new Error("notifyStaff chưa được gọi lần nào");
  return a;
}

describe("[LEAD-CHUYEN-T01] người NHẬN được báo", () => {
  it("chuyển cho một sale → notifyStaff đúng người, đúng khoá sẵn có", async () => {
    const kq = await transferLead(dauVao());
    expect(kq.ok).toBe(true);
    const c = chuong();
    expect(c.userIds).toEqual(["usr_saleB"]);
    expect(c.dedupeKey).toBe("lead.moi:lead_1");
    expect(c.href).toBe("/leads/lead_1");
    expect(String(c.body)).toContain("Chị Lan");
  });

  it("chuông chạy SAU khi transaction đóng", async () => {
    // `notifyStaff` cố ý không nhận `tx` — broadcast phải chạy sau commit.
    await transferLead(dauVao());
    const iTx = h.thuTu.indexOf("tx:dong");
    const iChuong = h.thuTu.indexOf("notifyStaff");
    expect(iTx).toBeGreaterThanOrEqual(0);
    expect(iChuong).toBeGreaterThan(iTx);
  });
});

describe("[LEAD-CHUYEN-T02] cơ sở đích KHÔNG còn ai nhận lead", () => {
  it("không im lặng — báo quản lý cơ sở đích theo khuôn pool rỗng", async () => {
    // `reassignForCenter` trả null khi pool cơ sở đích rỗng. Lead vừa chuyển sang đó và
    // KHÔNG có chủ: có khách đang chờ mà không ai được giao — kiểu hỏng đắt nhất của module.
    h.reassignForCenter.mockResolvedValue(null);
    const kq = await transferLead(dauVao({ toSaleId: "", toCenterId: "cs2" }));
    expect(kq.ok).toBe(true);
    const c = chuong();
    expect(c.dedupeKey).toBe("lead.pool_rong:lead_1");
    expect(String(c.title)).toContain("chưa được phân công");
  });
});

describe("[LEAD-CHUYEN-T03] thu hồi chuông của CHỦ CŨ", () => {
  it("đổi chủ → chuông cũ của người cũ bị thu hồi, đúng khoá", async () => {
    // Không thu hồi thì người cũ giữ một dòng "Bạn có lead mới" trỏ tới lead họ không còn giữ —
    // và nếu chuyển xuyên cơ sở thì `scopedDb` lọc mất, bấm vào ra trang "không tồn tại".
    await transferLead(dauVao());
    expect(h.thuHoiThongBao).toHaveBeenCalledTimes(1);
    expect(h.thuHoiThongBao.mock.calls[0]?.[0]).toEqual({
      userIds: ["usr_saleA"],
      dedupeKey: "lead.moi:lead_1",
    });
  });

  it("chuyển cho ĐÚNG người đang giữ → validator chặn TRƯỚC, không đụng chuông lẫn thu hồi", async () => {
    // Ca này KHÔNG chạm tới guard của thuHoiChuongLeadCu: `validateTransferTarget` trả
    // SAME_SALE và hàm return sớm. Khẳng định đúng thứ nó đo — lượt chuyển bị chặn — thay vì
    // giả vờ đang kiểm guard. Guard được kiểm thật ở `manual-assign-notify.test.ts`
    // ([LEAD-GANTAY-T05] ca thứ hai), nơi không có validator SAME_SALE.
    h.leadFindFirst.mockResolvedValue({ ...LEAD, assignedToId: "usr_saleB" });
    const kq = await transferLead(dauVao());
    expect(kq.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
    expect(h.thuHoiThongBao).not.toHaveBeenCalled();
  });

  it("lead CHƯA có chủ → không có gì để thu hồi", async () => {
    h.leadFindFirst.mockResolvedValue({ ...LEAD, assignedToId: null });
    await transferLead(dauVao());
    expect(h.thuHoiThongBao).not.toHaveBeenCalled();
  });
});

describe("[LEAD-CHUYEN-T04] không báo khi lượt chuyển KHÔNG xảy ra", () => {
  it("lead không tồn tại", async () => {
    h.leadFindFirst.mockResolvedValue(null);
    const kq = await transferLead(dauVao());
    expect(kq.ok).toBe(false);
    expect(h.notifyStaff).not.toHaveBeenCalled();
    expect(h.thuHoiThongBao).not.toHaveBeenCalled();
  });

  it("sale nhận không hợp lệ", async () => {
    h.userFindFirst.mockResolvedValue(null);
    const kq = await transferLead(dauVao());
    expect(kq.ok).toBe(false);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("ghi chú bàn giao quá ngắn → chặn ở validator, không đụng gì", async () => {
    const kq = await transferLead(dauVao({ handoverNote: "ok" }));
    expect(kq.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });
});
