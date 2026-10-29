// @vitest-environment node
/**
 * EL-16 — cấp chứng nhận BẰNG TAY: hợp đồng cấu hình.
 *
 * Đường này tồn tại vì hai lý do, và test canh cả hai không bị gỡ mất:
 *  · `elearning:certificate:issue` là một trong 17 khoá quyền của module và trước đó
 *    KHÔNG mã nào dùng tới — một dòng trong bảng phân quyền không ai gọi được;
 *  · lượt hoàn thành TRƯỚC khi EL-16 lên chạy không bao giờ có chứng nhận: sự kiện
 *    của chúng đã chạy xong và `verifiedAt` còn NULL.
 */
import { describe, it, expect } from "vitest";
import { cauHinhCapChungNhanTay } from "@/lib/elearning/certificate-issue-manual";

describe("cấu hình action cấp tay", () => {
  it("dùng đúng khoá `elearning:certificate:issue`", () => {
    // Nếu đổi sang một khoá rộng hơn thì mã vẫn chạy và test thân hàm vẫn xanh, chỉ
    // là một vai không nên có quyền bỗng phát được chứng từ.
    expect(cauHinhCapChungNhanTay.permission).toBe("elearning:certificate:issue");
  });

  it("BẮT BUỘC lý do — cấp ngoài luồng tự động phải trả lời được vì sao", () => {
    expect(cauHinhCapChungNhanTay.requireReason).toBe(true);
  });

  it("ghi AuditLog dạng CREATE trên TrnCertificate", () => {
    expect(cauHinhCapChungNhanTay.auditAction).toBe("CREATE");
    expect(cauHinhCapChungNhanTay.entityType).toBe("TrnCertificate");
  });

  it("schema `.strict()` — `reason` không lọt vào input", () => {
    expect(
      cauHinhCapChungNhanTay.schema.safeParse({ enrollmentId: "e1", reason: "x" })
        .success,
    ).toBe(false);
    expect(cauHinhCapChungNhanTay.schema.safeParse({ enrollmentId: "e1" }).success).toBe(
      true,
    );
  });
});
