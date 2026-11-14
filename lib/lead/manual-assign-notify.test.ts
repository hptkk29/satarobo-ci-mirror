// Gán lead BẰNG TAY phải phát chuông cho sale được giao.
//
// Vì sao có file test này: trước 08/09/2026 đường gán tay là đường CÂM. Quản lý bấm giao lead,
// sổ ghi đủ ba vết (LeadAssignmentLog + audit ASSIGN + LeadActivity) nhưng sale không nhận gì —
// họ chỉ biết khi tự mở danh sách, hoặc khi cron SLA kêu vì họ ĐÃ trễ. Bug đó không có test nào
// bắt được vì hai test duy nhất chạm `manualAssignLead` đều ĐỌC VĂN BẢN NGUỒN chứ không gọi hàm.
//
// UNIT THUẦN, không chạm Postgres — có chủ đích: job required "Unit tests (Vitest)" không có
// service postgres và không bật ALLOW_DB_RESET, nên test chạm DB sẽ SKIP im lặng ở đúng cổng
// đáng lẽ phải canh. Mock theo khuôn `lib/notifications/notify.test.ts`.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const thuTu: string[] = [];
  const leadFindUnique = vi.fn();
  const userFindFirst = vi.fn();
  const leadUpdate = vi.fn(async () => ({}));
  const leadActivityCreate = vi.fn(async () => ({}));
  const leadAssignmentLogCreate = vi.fn(async () => ({}));
  // Khai tham số tường minh: `vi.fn(async () => …)` cho ra kiểu tuple RỖNG, nên
  // `mock.calls[0][0]` không truy cập được và tsc đỏ.
  const notifyStaff = vi.fn(async (_p: Record<string, unknown>) => {
    thuTu.push("notifyStaff");
    return 1;
  });
  const thuHoiThongBao = vi.fn(async (_p: Record<string, unknown>) => {
    thuTu.push("thuHoi");
    return 1;
  });
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    thuTu.push("tx:mo");
    const r = await cb({
      lead: { update: leadUpdate },
      leadActivity: { create: leadActivityCreate },
      leadAssignmentLog: { create: leadAssignmentLogCreate },
    });
    thuTu.push("tx:dong");
    return r;
  });
  return {
    thuTu,
    leadFindUnique,
    userFindFirst,
    leadUpdate,
    leadActivityCreate,
    notifyStaff,
    thuHoiThongBao,
    transaction,
    mockDb: {
      lead: { findUnique: leadFindUnique },
      user: { findFirst: userFindFirst },
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/notifications/notify", () => ({
  notifyStaff: h.notifyStaff,
  thuHoiThongBao: h.thuHoiThongBao,
}));
vi.mock("@/lib/audit/log", () => ({ logLeadAudit: vi.fn(async () => undefined) }));
// Cơ sở chưa gắn cây tổ chức ⇒ không ghi sổ lượt. Giữ nhánh đơn giản: bản vá nằm ngoài
// transaction nên không phụ thuộc nhánh này (có một ca riêng ở dưới kiểm điều đó).
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: vi.fn(async () => null) }));

import { manualAssignLead } from "@/lib/lead/auto-assign";

const ACTOR = { actorId: "usr_quanly", actorName: "Quản lý CS1" };
const LEAD_OK = {
  id: "lead_1",
  assignedToId: null,
  status: "MOI",
  centerId: "cs1",
  parentName: "Chị Lan",
};
const SALE_OK = {
  id: "usr_sale",
  name: "Sale A",
  isActive: true,
  deletedAt: null,
  centerId: "cs1",
};

/** Tham số của lượt gọi chuông đầu tiên — ném lỗi có nghĩa nếu chưa gọi lần nào. */
function thamSoChuong(): Record<string, unknown> {
  const arg = h.notifyStaff.mock.calls[0]?.[0];
  if (!arg) throw new Error("notifyStaff chưa được gọi lần nào");
  return arg;
}

beforeEach(() => {
  h.thuTu.length = 0;
  h.leadFindUnique.mockReset().mockResolvedValue(LEAD_OK);
  h.userFindFirst.mockReset().mockResolvedValue(SALE_OK);
  h.leadUpdate.mockClear();
  h.leadActivityCreate.mockClear();
  h.notifyStaff.mockClear();
  h.thuHoiThongBao.mockClear();
  h.transaction.mockClear();
});

describe("[LEAD-GANTAY-T01] gán tay phát chuông cho sale được giao", () => {
  it("gọi notifyStaff đúng một lần, đúng người nhận", async () => {
    const kq = await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(kq).toEqual({ ok: true });
    expect(h.notifyStaff).toHaveBeenCalledTimes(1);
    expect(thamSoChuong()).toMatchObject({ userIds: ["usr_sale"] });
  });

  it("dùng ĐÚNG dedupeKey và href sẵn có, không đẻ quy ước thứ hai", async () => {
    // `lib/notifications/catalog.ts` phân loại theo TIỀN TỐ của khoá này (nhóm action_required,
    // mức P1). Khoá lệch một ký tự là thông báo rơi xuống "Hệ thống/P3" mà không ai báo lỗi.
    await manualAssignLead("lead_1", "usr_sale", ACTOR);
    const arg = thamSoChuong();
    expect(arg.dedupeKey).toBe("lead.moi:lead_1");
    expect(arg.href).toBe("/leads/lead_1");
    expect(arg.entityId).toBe("lead_1");
  });

  it("nội dung mang tên phụ huynh lấy từ chính lead", async () => {
    await manualAssignLead("lead_1", "usr_sale", ACTOR);
    const arg = thamSoChuong();
    expect(String(arg.body)).toContain("Chị Lan");
  });
});

describe("[LEAD-GANTAY-T02] chuông chạy SAU COMMIT", () => {
  it("notifyStaff gọi sau khi transaction đã đóng", async () => {
    // `notifyStaff` cố ý không nhận `tx` (lib/notifications/notify.ts:18) — broadcast phải chạy
    // sau commit. Kéo lời gọi vào trong transaction là bắn tín hiệu cho một lượt gán có thể còn
    // rollback. Test này khoá ranh giới đó.
    await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(h.thuTu).toEqual(["tx:mo", "tx:dong", "notifyStaff"]);
  });
});

describe("[LEAD-GANTAY-T03] không phát chuông khi lượt gán KHÔNG xảy ra", () => {
  it("lead không tồn tại", async () => {
    h.leadFindUnique.mockResolvedValue(null);
    const kq = await manualAssignLead("lead_x", "usr_sale", ACTOR);
    expect(kq.ok).toBe(false);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("sale không hợp lệ", async () => {
    h.userFindFirst.mockResolvedValue(null);
    const kq = await manualAssignLead("lead_1", "usr_khong_phai_sale", ACTOR);
    expect(kq.ok).toBe(false);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("sale đã nghỉ việc — guard chặn trước khi ghi", async () => {
    h.userFindFirst.mockResolvedValue({ ...SALE_OK, isActive: false });
    const kq = await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(kq.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("sale khác cơ sở và người gán KHÔNG ở cấp Hội sở", async () => {
    // Ca này từng gây sự cố 21/08: sale CS2 nhận lead CS1 thì scopedDb lọc mất, lead biến khỏi
    // tầm nhìn cả hai bên. Phát chuông cho một lead họ không mở được còn tệ hơn im lặng.
    h.userFindFirst.mockResolvedValue({ ...SALE_OK, centerId: "cs2" });
    const kq = await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(kq.ok).toBe(false);
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });
});

describe("[LEAD-GANTAY-T05] thu hồi chuông của CHỦ CŨ", () => {
  it("gán tay từ A sang B → chuông của A bị thu hồi, đúng khoá", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD_OK, assignedToId: "usr_saleA" });
    await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(h.thuHoiThongBao).toHaveBeenCalledTimes(1);
    expect(h.thuHoiThongBao.mock.calls[0]?.[0]).toEqual({
      userIds: ["usr_saleA"],
      dedupeKey: "lead.moi:lead_1",
    });
  });

  it("gán lại cho ĐÚNG người đang giữ → không tự thu hồi chuông của chính họ", async () => {
    h.leadFindUnique.mockResolvedValue({ ...LEAD_OK, assignedToId: "usr_sale" });
    await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(h.thuHoiThongBao).not.toHaveBeenCalled();
  });

  it("lead chưa có chủ → không có gì để thu hồi", async () => {
    await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(h.thuHoiThongBao).not.toHaveBeenCalled();
  });
});

describe("[LEAD-GANTAY-T04] chuông hỏng KHÔNG cuốn theo lượt gán", () => {
  it("notifyStaff ném lỗi thì hàm vẫn trả ok và lead vẫn đã đổi chủ", async () => {
    // `baoSaleCoLeadMoi` tự nuốt lỗi (assign-lead.ts). Để một lỗi mạng của cái chuông làm
    // hỏng cả lượt gán mới là hỏng nặng.
    h.notifyStaff.mockRejectedValueOnce(new Error("mạng chập"));
    const kq = await manualAssignLead("lead_1", "usr_sale", ACTOR);
    expect(kq).toEqual({ ok: true });
    // Đo NỘI DUNG, không đếm lượt: từ 16/09/2026 lượt gán còn ghi một dòng hoạt động qua
    // `recordLeadActivity` (cổng N-4), và hàm đó cũng chạm `lead.update` để dời đồng hồ.
    // Đếm lượt là khoá vào chi tiết cài đặt; thứ ca này thật sự hỏi là "lead ĐÃ đổi chủ
    // và không bị cuốn theo lỗi chuông".
    const luotGan = (h.leadUpdate.mock.calls as unknown[][]).filter((c) =>
      JSON.stringify(c[0] ?? {}).includes("usr_sale"),
    );
    expect(luotGan.length).toBeGreaterThan(0);
  });
});
