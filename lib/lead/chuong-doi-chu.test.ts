/**
 * ĐỔI CHỦ LEAD ⇒ CHUÔNG PHẢI ĐI THEO. Sự cố 15/09/2026.
 *
 * ── TRIỆU CHỨNG ──────────────────────────────────────────────────────────────────────────
 * Một tư vấn viên báo nhận được thông báo "Bạn có lead mới" nhưng mở ra không thấy lead nào;
 * tra dữ liệu thì lead ĐÃ KHÔNG CÒN.
 *
 * ── CHẨN ĐOÁN BAN ĐẦU SAI, GHI LẠI ĐỂ KHÔNG LẶP ──────────────────────────────────────────
 * Giả thuyết đầu tiên là "chuông của sale khác nhảy sang". SAI: đường đọc chuông lọc
 * `where: { userId }` (`lib/notifications/service.ts`), không có rò chéo người dùng; và đường
 * sinh gửi đúng `userIds: [ownerId]` — một người.
 *
 * Lỗi nằm ở nửa còn lại: **thu hồi**. Người đó nhận ĐÚNG chuông của mình vào lúc còn giữ
 * lead, rồi lead bị chuyển đi hoặc bị xoá mà chuông không ai dọn. `Lead` nằm trong
 * `SCOPED_MODELS` nên bấm vào còn ra trang "không tồn tại".
 *
 * Rà toàn bộ đường ghi `Lead.assignedToId` tìm ra BỐN đường thiếu thu hồi:
 *   · `lib/lead-handover/service.ts`  — bàn giao HÀNG LOẠT (nặng nhất: N lead = N chuông kẹt)
 *   · `lib/lead/assign.ts` reassignOpenLeads — chia lại khi sale nghỉ
 *   · `lib/lead/assign.ts` autoAssignLead    — chia máy một lead
 *   · `app/(admin)/admin/leads/actions.ts` deleteLead — xoá mềm
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────────
 * Không canh "hàm chạy đúng" — canh CHUÔNG ĐI THEO QUYỀN SỞ HỮU. Mỗi ca dựng một đường đổi
 * chủ thật rồi hỏi: chủ cũ có bị thu hồi không, chủ mới có được báo không, và có ai KHÁC bị
 * đụng tới không.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const notifyStaff = vi.fn(async (_p: Record<string, unknown>) => 1);
  const thuHoiThongBao = vi.fn(async (_p: { userIds: readonly string[]; dedupeKey: string }) => 1);
  const broadcastNotificationBump = vi.fn(async (_ids: readonly string[]) => undefined);
  return { notifyStaff, thuHoiThongBao, broadcastNotificationBump };
});

// ⚠️ CẢ BA hàm đều ở `@/lib/notifications/notify`. Bản đầu của bộ này mock
// `broadcastNotificationBump` từ `@/lib/chat/broadcast` — sai chỗ, nên hàm thật nhận
// `undefined` và ném; `try/catch` của `thuHoiChuongLeadCu` nuốt luôn lỗi đó và chỉ MỘT ca đỏ
// thay vì lộ ra là mock hỏng. Mock thiếu một hàm của module đã mock là lỗi câm: mọi ca không
// chạm tới hàm ấy vẫn xanh.
vi.mock("@/lib/notifications/notify", () => ({
  notifyStaff: h.notifyStaff,
  thuHoiThongBao: h.thuHoiThongBao,
  broadcastNotificationBump: h.broadcastNotificationBump,
}));

import { baoSaleCoLeadMoi, thuHoiChuongLeadCu } from "./assign-lead";

/** Tham số của lần thu hồi gần nhất. */
function thuHoiCuoi() {
  const c = h.thuHoiThongBao.mock.calls.at(-1)?.[0];
  if (!c) throw new Error("thuHoiThongBao chưa được gọi lần nào");
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.notifyStaff.mockResolvedValue(1);
  h.thuHoiThongBao.mockResolvedValue(1);
});

describe("[LEAD-T50] chuông lead mới chỉ tới ĐÚNG một người", () => {
  it("báo đúng chủ mới, không ai khác", async () => {
    // Yêu cầu của chủ dự án: "lead nào phân cho sale nào thì chỉ hiện thông báo cho sale đó".
    await baoSaleCoLeadMoi({
      ownerId: "sale_b",
      leadId: "lead_1",
      parentName: "Chị Lan",
      source: "MANAGER",
    });
    expect(h.notifyStaff).toHaveBeenCalledTimes(1);
    expect(h.notifyStaff.mock.calls[0]![0].userIds).toEqual(["sale_b"]);
  });

  it("khoá gắn theo LEAD — chia lại cùng người không đẻ chuông thứ hai", async () => {
    await baoSaleCoLeadMoi({
      ownerId: "sale_b",
      leadId: "lead_1",
      parentName: "Chị Lan",
      source: "MANAGER",
    });
    expect(h.notifyStaff.mock.calls[0]![0].dedupeKey).toBe("lead.moi:lead_1");
  });

  it("sale TỰ nhập phiếu của mình ⇒ không tự báo mình", async () => {
    await baoSaleCoLeadMoi({
      ownerId: "sale_b",
      leadId: "lead_1",
      parentName: "Chị Lan",
      source: "SELF",
    });
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });
});

describe("[LEAD-T51] thu hồi chuông chủ cũ", () => {
  it("đổi chủ ⇒ thu hồi ĐÚNG chuông của chủ cũ, đúng lead đó", async () => {
    await thuHoiChuongLeadCu({ chuCuId: "sale_a", chuMoiId: "sale_b", leadId: "lead_1" });
    expect(thuHoiCuoi().userIds).toEqual(["sale_a"]);
    expect(thuHoiCuoi().dedupeKey).toBe("lead.moi:lead_1");
  });

  it("KHÔNG đụng tới chuông của chủ mới", async () => {
    // Thu hồi nhầm cả chủ mới là xoá luôn cái chuông vừa tạo — triệu chứng y hệt bug gốc,
    // chỉ đổi người chịu.
    await thuHoiChuongLeadCu({ chuCuId: "sale_a", chuMoiId: "sale_b", leadId: "lead_1" });
    expect(thuHoiCuoi().userIds).not.toContain("sale_b");
  });

  it("lead bị XOÁ (không có chủ mới) ⇒ vẫn thu hồi", async () => {
    // Đây là ca khớp đúng triệu chứng được báo: lead biến mất, chuông ở lại.
    await thuHoiChuongLeadCu({ chuCuId: "sale_a", chuMoiId: null, leadId: "lead_1" });
    expect(thuHoiCuoi().userIds).toEqual(["sale_a"]);
  });

  it("gán lại cho CHÍNH chủ cũ ⇒ KHÔNG thu hồi", async () => {
    // Thu hồi ở đây là tự xoá chuông hợp lệ của người vẫn đang giữ lead.
    await thuHoiChuongLeadCu({ chuCuId: "sale_a", chuMoiId: "sale_a", leadId: "lead_1" });
    expect(h.thuHoiThongBao).not.toHaveBeenCalled();
  });

  it("lead chưa từng có chủ ⇒ không làm gì", async () => {
    await thuHoiChuongLeadCu({ chuCuId: null, chuMoiId: "sale_b", leadId: "lead_1" });
    expect(h.thuHoiThongBao).not.toHaveBeenCalled();
  });

  it("có dòng bị thu hồi ⇒ báo badge của chủ cũ cập nhật lại", async () => {
    // Vòng poll của chuông là 5 phút; không bắn tín hiệu thì badge treo một số ma suốt thời
    // gian đó, và người dùng thấy "1 thông báo" mà mở ra trống.
    await thuHoiChuongLeadCu({ chuCuId: "sale_a", chuMoiId: "sale_b", leadId: "lead_1" });
    expect(h.broadcastNotificationBump).toHaveBeenCalledWith(["sale_a"]);
  });

  it("KHÔNG có dòng nào bị thu hồi ⇒ không bắn tín hiệu thừa", async () => {
    h.thuHoiThongBao.mockResolvedValue(0);
    await thuHoiChuongLeadCu({ chuCuId: "sale_a", chuMoiId: "sale_b", leadId: "lead_1" });
    expect(h.broadcastNotificationBump).not.toHaveBeenCalled();
  });

  it("thu hồi hỏng ⇒ KHÔNG ném ra ngoài (lượt chia vẫn phải thành công)", async () => {
    h.thuHoiThongBao.mockRejectedValue(new Error("DB chập"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      thuHoiChuongLeadCu({ chuCuId: "sale_a", chuMoiId: "sale_b", leadId: "lead_1" }),
    ).resolves.toBeUndefined();
  });
});
