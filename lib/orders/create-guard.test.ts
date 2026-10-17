// G-A (biên bản chốt 4 cổng, 21/08/2026) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// Quyền `orders:create` là quyền HẸP: người có nó nhưng KHÔNG có `orders:manage`
// chỉ được tạo đơn GẮN LEAD CỦA CHÍNH MÌNH. Quy tắc đó nằm ở hàm thuần dưới đây
// để test được mà không cần DB — tầng gọi chỉ có việc nạp lead qua scopedDb.
import { describe, it, expect } from "vitest";
import { checkOrderCreateOwnership } from "./create-guard";

const ME = "user-sale-1";
const OTHER = "user-sale-2";

describe("[G-A] checkOrderCreateOwnership — ai được tạo đơn gắn lead nào", () => {
  it("người có orders:manage: tạo đơn không gắn lead vẫn được (đơn vãng lai)", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: true,
      leadId: null,
      lead: null,
      actorUserId: ME,
    });
    expect(r.ok).toBe(true);
  });

  it("người có orders:manage: tạo đơn gắn lead của người khác vẫn được", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: true,
      leadId: "lead-1",
      lead: { id: "lead-1", assignedToId: OTHER },
      actorUserId: ME,
    });
    expect(r.ok).toBe(true);
  });

  it("Sale (chỉ orders:create): tạo đơn gắn lead CỦA MÌNH → cho phép", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: "lead-1",
      lead: { id: "lead-1", assignedToId: ME },
      actorUserId: ME,
    });
    expect(r.ok).toBe(true);
  });

  it("Sale: KHÔNG gắn lead → từ chối (chống tạo đơn vãng lai vượt quyền)", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: null,
      lead: null,
      actorUserId: ME,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEAD_REQUIRED");
  });

  it("Sale: gắn lead của sale KHÁC → từ chối (IDOR)", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: "lead-1",
      lead: { id: "lead-1", assignedToId: OTHER },
      actorUserId: ME,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_LEAD_OWNER");
  });

  it("Sale: lead vô chủ (chưa ai phụ trách) → từ chối, không tự nhận qua đường tạo đơn", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: "lead-1",
      lead: { id: "lead-1", assignedToId: null },
      actorUserId: ME,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_LEAD_OWNER");
  });

  it("Sale: leadId trỏ tới lead KHÔNG đọc được (ngoài cơ sở / không tồn tại) → từ chối", () => {
    // Tầng gọi nạp lead bằng scopedDb ⇒ lead ngoài cơ sở trả về null. Guard phải
    // coi null là TỪ CHỐI, không được coi là "đơn không gắn lead".
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: "lead-cs2",
      lead: null,
      actorUserId: ME,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEAD_NOT_FOUND");
  });

  it("chuỗi rỗng ở leadId được coi như không gắn lead, không phải lead hợp lệ", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: "",
      lead: null,
      actorUserId: ME,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEAD_REQUIRED");
  });

  it("Sale: cơ sở của đơn LẤY TỪ LEAD, không tin giá trị client gửi lên", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: "lead-1",
      lead: { id: "lead-1", assignedToId: ME, centerId: "cs1" },
      actorUserId: ME,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.enforcedCenterId).toBe("cs1");
  });

  it("Sale + lead chưa có cơ sở → ép null tường minh, không để client tự đặt", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: false,
      leadId: "lead-1",
      lead: { id: "lead-1", assignedToId: ME, centerId: null },
      actorUserId: ME,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r).toHaveProperty("enforcedCenterId");
      expect(r.enforcedCenterId).toBeNull();
    }
  });

  it("người có orders:manage: KHÔNG ép cơ sở — giữ nguyên lựa chọn trên form", () => {
    const r = checkOrderCreateOwnership({
      canManageAll: true,
      leadId: "lead-1",
      lead: { id: "lead-1", assignedToId: OTHER, centerId: "cs2" },
      actorUserId: ME,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.enforcedCenterId).toBeUndefined();
  });

  it("mọi nhánh từ chối đều có thông điệp tiếng Việt cho người dùng cuối", () => {
    const cases = [
      { canManageAll: false, leadId: null, lead: null, actorUserId: ME },
      { canManageAll: false, leadId: "l", lead: null, actorUserId: ME },
      {
        canManageAll: false,
        leadId: "l",
        lead: { id: "l", assignedToId: OTHER },
        actorUserId: ME,
      },
    ] as const;
    for (const c of cases) {
      const r = checkOrderCreateOwnership(c);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message.length).toBeGreaterThan(10);
        // Không lộ tên/định danh người đang giữ lead — tránh tranh chấp nội bộ.
        expect(r.message).not.toContain(OTHER);
      }
    }
  });
});
