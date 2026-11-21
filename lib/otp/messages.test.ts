import { describe, expect, it } from "vitest";
import { describeOtpSendError } from "./messages";

describe("[AUTH-SDT-P6-D] describeOtpSendError — lỗi ZNS thành câu có đường thoát", () => {
  it("-118 (số chưa có Zalo) → lỗi VĨNH VIỄN, không xui thử lại", () => {
    const a = describeOtpSendError("ZNS_NO_ZALO_ACCOUNT:ZNS_ERR_-118:User not found");
    expect(a.permanent).toBe(true);
    expect(a.message).toContain("chưa có tài khoản Zalo");
    // Bất biến quan trọng: KHÔNG được khuyên "thử lại sau" cho nhóm vĩnh viễn —
    // gửi lại chỉ đốt thêm tin mà kết quả y hệt.
    expect(a.message).not.toContain("thử lại sau");
  });

  it("-139/-141 (tắt nhận tin OA) → nói rõ trung tâm KHÔNG bật hộ được", () => {
    for (const raw of ["ZNS_USER_REFUSED:ZNS_ERR_-139:x", "ZNS_USER_REFUSED:ZNS_ERR_-141:x"]) {
      const a = describeOtpSendError(raw);
      expect(a.permanent).toBe(true);
      expect(a.message).toContain("không bật hộ được");
    }
  });

  it("-147 (chạm giới hạn nhận) → KHÔNG vĩnh viễn, có thể chờ", () => {
    const a = describeOtpSendError("ZNS_USER_LIMIT:ZNS_ERR_-147:x");
    expect(a.permanent).toBe(false);
  });

  it("chuỗi lạ / rỗng → câu chung, không vĩnh viễn (không doạ người dùng quá tay)", () => {
    for (const raw of ["", undefined, null, "cái gì đó"]) {
      const a = describeOtpSendError(raw);
      expect(a.permanent).toBe(false);
      expect(a.message.length).toBeGreaterThan(0);
    }
  });

  it("không bao giờ ném chuỗi kỹ thuật ra ngoài", () => {
    const a = describeOtpSendError("ZNS_NO_ZALO_ACCOUNT:ZNS_ERR_-118:User not found");
    expect(a.message).not.toContain("ZNS_ERR");
    expect(a.message).not.toContain("ZNS_NO_ZALO_ACCOUNT");
  });
});
