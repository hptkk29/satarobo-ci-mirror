// @vitest-environment node
/**
 * EL-17 — khai / đóng yêu cầu đào tạo: hợp đồng cấu hình.
 *
 * Ba thứ dễ mất nhất và mất im lặng: khoá quyền, `requireReason`, và việc ĐÓNG chứ
 * không xoá. Đổi nhầm khoá quyền sang một khoá rộng hơn thì mã vẫn chạy, test thân
 * hàm vẫn xanh, và một vai không nên có quyền bỗng ra được nghĩa vụ cho người khác.
 */
import { describe, it, expect } from "vitest";
import {
  cauHinhKhaiYeuCau,
  cauHinhDongYeuCau,
} from "@/lib/elearning/requirement-authoring";

describe("cấu hình action yêu cầu đào tạo", () => {
  it("cả hai dùng khoá HẸP `elearning:requirement:manage`", () => {
    expect(cauHinhKhaiYeuCau.permission).toBe("elearning:requirement:manage");
    expect(cauHinhDongYeuCau.permission).toBe("elearning:requirement:manage");
  });

  it("cả hai BẮT BUỘC lý do", () => {
    // Khai một yêu cầu là ra nghĩa vụ cho người khác; đóng nó là gỡ nghĩa vụ ấy.
    // Cả hai phải trả lời được "vì sao" khi có người hỏi sáu tháng sau.
    expect(cauHinhKhaiYeuCau.requireReason).toBe(true);
    expect(cauHinhDongYeuCau.requireReason).toBe(true);
  });

  it("đóng là UPDATE, không phải DELETE", () => {
    // Xoá một yêu cầu đã áp làm mọi báo cáo cũ đổi nghĩa hồi tố.
    expect(cauHinhDongYeuCau.auditAction).toBe("UPDATE");
    expect(cauHinhKhaiYeuCau.auditAction).toBe("CREATE");
  });

  it("schema đóng là `.strict()` — `reason` không lọt vào input", () => {
    expect(
      cauHinhDongYeuCau.schema.safeParse({ requirementId: "r1", reason: "x" }).success,
    ).toBe(false);
    expect(cauHinhDongYeuCau.schema.safeParse({ requirementId: "r1" }).success).toBe(
      true,
    );
  });

  it("ALL_STAFF thì KHÔNG được gắn đơn vị — hai câu trái nhau", () => {
    const r = cauHinhKhaiYeuCau.schema.safeParse({
      courseId: "k1",
      scopeKind: "ALL_STAFF",
      dueDays: 30,
      orgUnitId: "ou1",
    });
    expect(r.success).toBe(false);
  });

  it("DEPARTMENT mà bỏ trống phòng ban thì bác", () => {
    const r = cauHinhKhaiYeuCau.schema.safeParse({
      courseId: "k1",
      scopeKind: "DEPARTMENT",
      dueDays: 30,
    });
    expect(r.success).toBe(false);
  });
});
