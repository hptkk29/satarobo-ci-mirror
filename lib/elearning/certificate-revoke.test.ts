// @vitest-environment node
/**
 * EL-16 — thu hồi chứng nhận: hợp đồng của cấu hình action.
 *
 * Kiểm CẤU HÌNH chứ không chỉ thân hàm, vì ba thứ dễ mất nhất nằm ở đó và mất một
 * cách im lặng: khoá quyền, `requireReason`, và `auditAction`. Đổi nhầm khoá quyền
 * sang một khoá rộng hơn thì mã vẫn chạy, test thân hàm vẫn xanh, và một vai không
 * nên có quyền bỗng vô hiệu được chứng từ của người khác.
 */
import { describe, it, expect } from "vitest";
import { cauHinhThuHoiChungNhan } from "@/lib/elearning/certificate-revoke";

describe("cấu hình action thu hồi", () => {
  it("dùng khoá quyền HẸP `elearning:certificate:revoke`", () => {
    // KHÔNG dùng `program:manage` hay `progress:view-all`: phòng Đào tạo xem được ai
    // đã có chứng nhận gì, nhưng vô hiệu một chứng từ là quyết định của Nhân sự Hội
    // sở. Hai việc, hai khoá.
    expect(cauHinhThuHoiChungNhan.permission).toBe("elearning:certificate:revoke");
  });

  it("BẮT BUỘC lý do (BR-007)", () => {
    // Thiếu cờ này thì factory không đòi `reason`, và cột `revokeReason` nhận `null`
    // — một chứng từ bị vô hiệu mà không ai biết vì sao.
    expect(cauHinhThuHoiChungNhan.requireReason).toBe(true);
  });

  it("có ghi AuditLog, đúng loại thực thể", () => {
    expect(cauHinhThuHoiChungNhan.auditAction).toBe("UPDATE");
    expect(cauHinhThuHoiChungNhan.entityType).toBe("TrnCertificate");
  });

  it("schema `.strict()` — không nuốt trường lạ", () => {
    // `reason` đi ở tham số thứ hai của action, KHÔNG nằm trong input. Nhét vào
    // input phải bị bác, nếu không sẽ có hai đường truyền lý do và một trong hai
    // không đi vào AuditLog.
    const r = cauHinhThuHoiChungNhan.schema.safeParse({
      certificateId: "c1",
      reason: "nhét sai chỗ",
    });
    expect(r.success).toBe(false);
  });

  it("thiếu certificateId thì bác", () => {
    expect(cauHinhThuHoiChungNhan.schema.safeParse({}).success).toBe(false);
    expect(
      cauHinhThuHoiChungNhan.schema.safeParse({ certificateId: "" }).success,
    ).toBe(false);
  });
});
