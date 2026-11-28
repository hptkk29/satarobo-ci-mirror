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
import { ActionError } from "@/lib/actions/factory";
import { cauHinhCapChungNhanTay, LY_DO_TOI_THIEU } from "@/lib/elearning/certificate-issue-manual";

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

describe("[CTL-Q13] lý do cấp tay tối thiểu 10 ký tự — kiểm Ở SERVER, trước mọi phép đọc/ghi", () => {
  const dbCamDung = new Proxy({}, { get: () => { throw new Error("DB bị chạm tới"); } });
  const goi = (reason: string | null) =>
    cauHinhCapChungNhanTay.handler({ db: dbCamDung, actor: { userId: "u1" }, input: { enrollmentId: "e1" }, reason, actorName: "t" } as never);

  it("ngưỡng là 10", () => {
    expect(LY_DO_TOI_THIEU).toBe(10);
  });

  it("🔴 lý do 9 ký tự (hoặc toàn khoảng trắng / null) ⇒ VALIDATION trên `reason` và KHÔNG chạm DB", async () => {
    for (const r of ["123456789", "   a   ", "         ", "", null]) {
      const e = await goi(r).catch((x) => x);
      expect(e).toBeInstanceOf(ActionError);
      expect((e as ActionError).code).toBe("VALIDATION");
      expect((e as ActionError).field).toBe("reason");
    }
  });

  it("đối chứng dương: đúng 10 ký tự thì QUA cổng này (lỗi tiếp theo là do chạm DB giả)", async () => {
    const e = await goi("1234567890").catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe("DB bị chạm tới");
  });
});

