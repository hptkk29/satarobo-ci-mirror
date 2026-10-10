// @vitest-environment node
/**
 * C-06 — luật ghi/xoá LÝ DO RỚT khi trạng thái rớt nằm ở TỪNG CON còn lý do nằm ở
 * PHỤ HUYNH (quyết định B5 + 12(b), 24/08/2026).
 *
 * Hai tầng lệch nhau đẻ ra đúng một bẫy mất dữ liệu: phiếu có hai con cùng rớt, gỡ
 * một đứa ra khỏi trạng thái rớt mà xoá luôn `Lead.lostNote` thì LÝ DO CỦA ĐỨA CÒN
 * LẠI biến mất — bảng "Lead rớt" (C-05) từ đó hiện một dòng rớt không lý do, và
 * không có đường nào dựng lại. Luật vì vậy: chỉ xoá khi KHÔNG CÒN con nào rớt.
 *
 * Đặt quyết định này thành hàm THUẦN thay vì mấy dòng `if` trong Server Action là có
 * chủ đích — nó là chỗ duy nhất trong C-06 mà làm sai sẽ mất dữ liệu chứ không chỉ
 * hiện sai, nên nó phải kiểm được mà không cần DB, không cần phiên đăng nhập.
 */
import { describe, expect, it } from "vitest";
import {
  decideLeadLostFields,
  markChildLostSchema,
  unmarkChildLostSchema,
  LEAD_CHILD_STATUS_LABEL,
} from "./lost-status";

const NOW = new Date("2026-08-25T10:00:00.000Z");

describe("[C-06] decideLeadLostFields — đánh dấu rớt", () => {
  it("đánh dấu rớt → ghi lý do + mốc thời gian ở cấp phụ huynh", () => {
    const patch = decideLeadLostFields({
      intent: "mark",
      lostChildCount: 1,
      lostNote: "Nhà xa, phụ huynh chọn trung tâm gần nhà",
      now: NOW,
    });

    expect(patch).toEqual({
      lostNote: "Nhà xa, phụ huynh chọn trung tâm gần nhà",
      lostAt: NOW,
    });
  });

  it("con thứ hai rớt → ĐÈ lý do của con thứ nhất (hệ quả đã chấp nhận của B5)", () => {
    // Không phải "bug được ghi lại cho có": lý do là của cả phụ huynh nên bản mới
    // nhất thắng. Đường lần ra lý do từng con là nhật ký (test ở action), không phải
    // cột này — nếu đổi ý sau này thì đó là thêm bảng, không phải sửa hàm này.
    const patch = decideLeadLostFields({
      intent: "mark",
      lostChildCount: 2,
      lostNote: "Học phí cao hơn dự tính",
      now: NOW,
    });

    expect(patch).toEqual({ lostNote: "Học phí cao hơn dự tính", lostAt: NOW });
  });

  it("lý do rỗng/toàn khoảng trắng → ném lỗi, KHÔNG lặng lẽ ghi chuỗi rỗng", () => {
    // Ghi được chuỗi rỗng là hỏng đúng thứ C-05 cần: một dòng rớt "có lý do" mà đọc
    // ra không có gì, lại không phân biệt được với dòng chưa từng nhập.
    expect(() =>
      decideLeadLostFields({ intent: "mark", lostChildCount: 1, lostNote: "   ", now: NOW }),
    ).toThrow();
  });

  it("lý do có khoảng trắng thừa hai đầu → cắt trước khi ghi", () => {
    const patch = decideLeadLostFields({
      intent: "mark",
      lostChildCount: 1,
      lostNote: "  Đã học nơi khác  ",
      now: NOW,
    });

    expect(patch).toEqual({ lostNote: "Đã học nơi khác", lostAt: NOW });
  });
});

describe("[C-06] decideLeadLostFields — gỡ một con khỏi trạng thái rớt", () => {
  it("🔴 CÒN con khác đang rớt → KHÔNG đụng vào lý do (giữ lý do của đứa còn lại)", () => {
    const patch = decideLeadLostFields({ intent: "unmark", lostChildCount: 1, now: NOW });

    // `null` = "không có gì để ghi", khác hẳn `{ lostNote: null }` = "xoá đi".
    expect(patch).toBeNull();
  });

  it("KHÔNG còn con nào rớt → xoá cả lý do lẫn mốc thời gian", () => {
    const patch = decideLeadLostFields({ intent: "unmark", lostChildCount: 0, now: NOW });

    expect(patch).toEqual({ lostNote: null, lostAt: null });
  });

  it("phiếu 3 con rớt, gỡ 1 → vẫn còn 2 ⇒ giữ nguyên lý do", () => {
    expect(decideLeadLostFields({ intent: "unmark", lostChildCount: 2, now: NOW })).toBeNull();
  });

  it("số con rớt âm (đếm hỏng) → ném lỗi thay vì xoá lý do", () => {
    // Đếm hỏng mà mặc định "xoá" là chọn đúng hướng mất dữ liệu. Thà đỏ.
    expect(() => decideLeadLostFields({ intent: "unmark", lostChildCount: -1, now: NOW })).toThrow();
  });
});

describe("[C-06] cửa vào của Server Action", () => {
  it("đánh dấu rớt mà bỏ trống ô lý do → zod chặn ngay ở cửa", () => {
    const res = markChildLostSchema.safeParse({ leadChildId: "c1", lostNote: "" });
    expect(res.success).toBe(false);
  });

  it("lý do quá 2000 ký tự → chặn (ô ghi chú, không phải nơi dán cả cuộc hội thoại)", () => {
    const res = markChildLostSchema.safeParse({ leadChildId: "c1", lostNote: "x".repeat(2001) });
    expect(res.success).toBe(false);
  });

  it("🔴 đường GỠ rớt không nhận `LOST` — nếu không nó thành cửa hậu đánh dấu rớt KHÔNG cần lý do", () => {
    const res = unmarkChildLostSchema.safeParse({ leadChildId: "c1", status: "LOST" });
    expect(res.success).toBe(false);
  });

  it("đường gỡ nhận các bước phễu bình thường", () => {
    for (const status of ["NEW", "CONSULTING", "TRIAL_SCHEDULED", "TRIAL_ATTENDED", "ENROLLED"]) {
      expect(unmarkChildLostSchema.safeParse({ leadChildId: "c1", status }).success).toBe(true);
    }
  });

  it("mọi giá trị trạng thái con đều có nhãn tiếng Việt (không lọt mã enum ra màn hình)", () => {
    for (const key of ["NEW", "CONSULTING", "TRIAL_SCHEDULED", "TRIAL_ATTENDED", "ENROLLED", "LOST"] as const) {
      expect(LEAD_CHILD_STATUS_LABEL[key]).toBeTruthy();
    }
  });
});
