// @vitest-environment node
/**
 * EL-04 — chuỗi 4 điều kiện ở server (luật cứng #7).
 *
 * Điều đáng test nhất ở đây KHÔNG phải "người có quyền thì vào được" — mà là bốn
 * kiểu người KHÔNG được vào, và thứ tự kiểm.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ can: vi.fn(() => true) }));
vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/elearning/policy-acceptance", () => ({
  assertPolicyAccepted: vi.fn(async () => undefined),
  PolicyNotAcceptedError: class extends Error {},
}));

import { checkContentAccess, type CourseForGate } from "./content-gate";

const ACTOR = { userId: "u1" } as never;

const KHOA: CourseForGate = {
  id: "c1",
  visibility: "ASSIGNED_ONLY",
  selfEnrollEnabled: false,
  securityLevel: "INTERNAL",
  hasPublishedVersion: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.can.mockReturnValue(true);
});

describe("(1) quyền vào khu", () => {
  it("không có elearning:portal:access ⇒ từ chối, và từ chối TRƯỚC mọi thứ khác", () => {
    h.can.mockReturnValue(false);
    const r = checkContentAccess({
      actor: ACTOR,
      // Khoá này còn chưa xuất bản và người này cũng chưa ghi danh — nhưng lỗi
      // trả về phải là PERMISSION_DENIED, không phải NOT_PUBLISHED.
      course: { ...KHOA, hasPublishedVersion: false },
      hasEnrollment: false,
    });
    expect(r?.code).toBe("PERMISSION_DENIED");
  });

  it("thứ tự này chặn dò mã khoá", () => {
    // Nếu kiểm (2) trước (1), một người ngoài phân biệt được "khoá không tồn tại"
    // với "khoá tồn tại nhưng chưa xuất bản" qua hai thông báo khác nhau — tức dò
    // được danh mục khoá nội bộ mà không cần quyền nào.
    h.can.mockReturnValue(false);
    const a = checkContentAccess({ actor: ACTOR, course: KHOA, hasEnrollment: true });
    const b = checkContentAccess({
      actor: ACTOR,
      course: { ...KHOA, hasPublishedVersion: false },
      hasEnrollment: false,
    });
    expect(a?.code).toBe(b?.code);
    expect(a?.message).toBe(b?.message);
  });
});

describe("(2) phải có phiên bản ĐÃ XUẤT BẢN", () => {
  it("không phiên bản nào PUBLISHED ⇒ từ chối", () => {
    const r = checkContentAccess({
      actor: ACTOR,
      course: { ...KHOA, hasPublishedVersion: false },
      hasEnrollment: true,
    });
    expect(r?.code).toBe("NOT_PUBLISHED");
  });

  it("kiểm PHIÊN BẢN, không kiểm TrnCourse.status", () => {
    // Hai thứ khác nhau: khoá có thể mang status PUBLISHED trong khi mọi phiên
    // bản còn DRAFT — người học mở ra một khoá RỖNG, không bài nào. Hợp đồng của
    // hàm này chỉ nhận `hasPublishedVersion`, nên không có đường nhầm.
    const keys = Object.keys(KHOA);
    expect(keys).toContain("hasPublishedVersion");
    expect(keys).not.toContain("status");
  });
});

describe("(3) chế độ hiển thị", () => {
  it("ASSIGNED_ONLY + chưa ghi danh ⇒ từ chối", () => {
    expect(
      checkContentAccess({ actor: ACTOR, course: KHOA, hasEnrollment: false })?.code,
    ).toBe("NOT_VISIBLE");
  });

  it("ASSIGNED_ONLY + đã ghi danh ⇒ qua", () => {
    expect(
      checkContentAccess({ actor: ACTOR, course: KHOA, hasEnrollment: true }),
    ).toBeNull();
  });

  it("SELF_ENROLL ⇒ ai qua được (1) đều THẤY, kể cả chưa ghi danh", () => {
    expect(
      checkContentAccess({
        actor: ACTOR,
        course: { ...KHOA, visibility: "SELF_ENROLL" },
        hasEnrollment: false,
      }),
    ).toBeNull();
  });

  it("SELF_ENROLL: THẤY khác TỰ MỞ LƯỢT — selfEnrollEnabled=false vẫn thấy", () => {
    // Ca thật: "thấy được nhưng phải chờ Đào tạo giao". Gộp hai khái niệm là mất
    // đúng ca đó.
    expect(
      checkContentAccess({
        actor: ACTOR,
        course: { ...KHOA, visibility: "SELF_ENROLL", selfEnrollEnabled: false },
        hasEnrollment: false,
      }),
    ).toBeNull();
  });

  it("RULE_BASED ⇒ FAIL-CLOSED khi chưa có bộ giải luật (EL-05)", () => {
    // Bộ giải `catalogRuleJson` dùng CHUNG hàm với `TrnAssignmentRule.filterJson`,
    // mà hàm đó thuộc EL-05 và chưa tồn tại. Viết bộ giải tạm ở đây rồi EL-05 viết
    // bộ thứ hai là thứ đặc tả cấm đích danh. Trong lúc chờ: chặt hơn mức cuối
    // cùng, và chặt là hướng an toàn.
    expect(
      checkContentAccess({
        actor: ACTOR,
        course: { ...KHOA, visibility: "RULE_BASED" },
        hasEnrollment: false,
      })?.code,
    ).toBe("NOT_VISIBLE");
    expect(
      checkContentAccess({
        actor: ACTOR,
        course: { ...KHOA, visibility: "RULE_BASED" },
        hasEnrollment: true,
      }),
    ).toBeNull();
  });
});

describe("(4) mức bảo mật", () => {
  it.each(["RESTRICTED", "CONFIDENTIAL"] as const)(
    "%s + chưa ghi danh ⇒ từ chối, kể cả khi visibility mở",
    (muc) => {
      // Ràng buộc ở tầng ghi đã buộc RESTRICTED+ phải ASSIGNED_ONLY, nhưng dữ liệu
      // cũ hoặc một đường ghi khác có thể lọt. Kiểm lại ở đây là fail-closed thật,
      // không phải kiểm hai lần cho vui.
      expect(
        checkContentAccess({
          actor: ACTOR,
          course: { ...KHOA, visibility: "SELF_ENROLL", securityLevel: muc },
          hasEnrollment: false,
        })?.code,
      ).toBe("SECURITY_LEVEL");
    },
  );

  it.each(["PUBLIC", "INTERNAL"] as const)("%s không đòi ghi danh", (muc) => {
    expect(
      checkContentAccess({
        actor: ACTOR,
        course: { ...KHOA, visibility: "SELF_ENROLL", securityLevel: muc },
        hasEnrollment: false,
      }),
    ).toBeNull();
  });
});

describe("cổng chính sách phải map sang ActionError", () => {
  it("assertPolicyForAction tồn tại và được export", async () => {
    // 🔴 `PolicyNotAcceptedError extends Error`, KHÔNG extends `ActionError`. Mà
    // `runAction` chỉ bắt `ActionError` rồi ném tiếp phần còn lại ⇒ ném thẳng là
    // MÀN 500 TRẮNG cho đúng nhóm người đầu tiên vào ngày mở — nhóm chưa ai kịp
    // chấp nhận chính sách. Gói ở một chỗ để không call-site nào phải nhớ.
    const mod = await import("./content-gate");
    expect(typeof mod.assertPolicyForAction).toBe("function");
  });
});
