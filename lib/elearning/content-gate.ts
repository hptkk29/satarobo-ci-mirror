import "server-only";

import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { ActionError } from "@/lib/actions/factory";
import {
  assertPolicyAccepted,
  PolicyNotAcceptedError,
} from "@/lib/elearning/policy-acceptance";

/**
 * EL-04 — CHUỖI 4 ĐIỀU KIỆN Ở SERVER cho mọi endpoint trả nội dung.
 *
 * Luật cứng #7 của CLAUDE.md, KHÔNG có ngoại lệ cho môi trường dev. Gom vào MỘT
 * hàm chứ không rải: rải ra thì mỗi endpoint kiểm một tập con, và cái bị bỏ sót
 * sẽ là cái ít ai nghĩ tới — thường là điều kiện (2) hoặc (4).
 *
 * Lọc ở client là TRANG TRÍ. Nội dung đã rời server thì DevTools đọc được.
 */

/** Kết quả từ chối, tách khỏi việc ném — để trang có thể hiện màn phù hợp. */
export type ContentDenial = {
  code:
    | "PERMISSION_DENIED"
    | "NOT_PUBLISHED"
    | "NOT_VISIBLE"
    | "SECURITY_LEVEL";
  message: string;
};

/** Tối thiểu cần biết về khoá để quyết định — bên gọi tự nạp. */
export type CourseForGate = {
  id: string;
  visibility: "ASSIGNED_ONLY" | "SELF_ENROLL" | "RULE_BASED";
  selfEnrollEnabled: boolean;
  securityLevel: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";
  /** Có ÍT NHẤT một phiên bản `PUBLISHED` hay không. */
  hasPublishedVersion: boolean;
};

export type ContentGateInput = {
  actor: Actor;
  course: CourseForGate;
  /** Người này có lượt ghi danh còn hiệu lực trên khoá không. */
  hasEnrollment: boolean;
};

/**
 * Trả `null` nếu ĐƯỢC XEM, hoặc lý do từ chối.
 *
 * Thứ tự kiểm là CÓ CHỦ ĐÍCH: rẻ trước, và quan trọng hơn — không tiết lộ sự tồn
 * tại của khoá cho người không có quyền vào khu. Đảo thứ tự thì một người ngoài
 * có thể dò xem mã khoá nào tồn tại qua việc phân biệt hai thông báo lỗi.
 */
export function checkContentAccess(input: ContentGateInput): ContentDenial | null {
  const { actor, course } = input;

  // (1) Vào được khu đào tạo nội bộ.
  if (!can(actor, "elearning:portal:access")) {
    return {
      code: "PERMISSION_DENIED",
      message: "Bạn không có quyền vào khu đào tạo nội bộ",
    };
  }

  // (2) Khoá phải có phiên bản ĐÃ XUẤT BẢN.
  // ⚠️ Kiểm phiên bản, KHÔNG kiểm `TrnCourse.status`. Hai thứ khác nhau: khoá có
  // thể mang status PUBLISHED trong khi mọi phiên bản của nó còn DRAFT — và khi
  // đó người học mở ra một khoá rỗng, không có bài nào.
  if (!course.hasPublishedVersion) {
    return {
      code: "NOT_PUBLISHED",
      message: "Khoá học chưa được xuất bản",
    };
  }

  // (3) Chế độ hiển thị có cho phép CHÍNH NGƯỜI NÀY không.
  const thay = ((): boolean => {
    switch (course.visibility) {
      case "ASSIGNED_ONLY":
        return input.hasEnrollment;
      case "SELF_ENROLL":
        // Đã qua (1) nghĩa là có `elearning:portal:access` — đúng điều kiện của
        // chế độ này. `selfEnrollEnabled` là quyền TỰ MỞ LƯỢT, khác quyền THẤY:
        // có ca thật "thấy được nhưng phải chờ Đào tạo giao".
        return true;
      case "RULE_BASED":
        // 🔴 FAIL-CLOSED CÓ CHỦ ĐÍCH. Bộ giải `catalogRuleJson` dùng CHUNG hàm
        // thuần `ruleToWhere()` với `TrnAssignmentRule.filterJson`, mà hàm đó
        // thuộc EL-05 và CHƯA TỒN TẠI. Viết một bộ giải tạm ở đây rồi EL-05 viết
        // bộ thứ hai chính là thứ đặc tả cấm đích danh — hai bộ dịch lệch nhau là
        // loại lỗi không ai phát hiện được bằng mắt.
        // Trong lúc chờ: chỉ ai ĐÃ có lượt ghi danh mới xem được. Chặt hơn mức
        // cuối cùng, và chặt là hướng an toàn.
        return input.hasEnrollment;
    }
  })();
  if (!thay) {
    return {
      code: "NOT_VISIBLE",
      message: "Khoá học này chưa được mở cho bạn",
    };
  }

  // (4) Mức bảo mật.
  // ⚠️ CHƯA CÓ NGUỒN DỮ LIỆU "người này được xem tới mức nào" — không có cột nào
  // trên `User`, `Employee` hay `RoleDef` mang thông tin đó. Nên điều kiện này
  // hiện thi hành bằng ràng buộc ĐÃ CÓ ở tầng ghi: `securityLevel` từ `RESTRICTED`
  // trở lên BUỘC `visibility = ASSIGNED_ONLY` (chặn ở Zod, xem
  // `lib/validators/elearning.ts`), tức nội dung nhạy cảm chỉ tới được người có
  // lượt ghi danh — và điều kiện (3) đã kiểm đúng điều đó.
  //
  // Ghi lại ở đây thay vì để trống, để người sau không đọc "chỉ có 3 điều kiện"
  // rồi bỏ luôn ô thứ tư khi nguồn dữ liệu xuất hiện.
  if (
    (course.securityLevel === "RESTRICTED" ||
      course.securityLevel === "CONFIDENTIAL") &&
    !input.hasEnrollment
  ) {
    return {
      code: "SECURITY_LEVEL",
      message: "Nội dung này chỉ dành cho người được giao",
    };
  }

  return null;
}

/** Ném `ActionError` khi bị từ chối — dùng trong Server Action. */
export function assertContentAccess(input: ContentGateInput): void {
  const tuChoi = checkContentAccess(input);
  if (tuChoi) throw new ActionError(tuChoi.code, tuChoi.message);
}

/**
 * Cổng chính sách cho ĐƯỜNG GHI, đã map sẵn sang `ActionError`.
 *
 * 🔴 Vì sao phải có hàm này thay vì gọi thẳng `assertPolicyAccepted`:
 * `PolicyNotAcceptedError extends Error`, KHÔNG extends `ActionError`. Mà
 * `runAction` chỉ `catch (e) { if (e instanceof ActionError) ... ; throw e }` —
 * nên ném thẳng sẽ rơi ra ngoài thành lỗi hệ thống và người dùng nhận MÀN 500
 * TRẮNG thay vì lời nhắc xác nhận chính sách.
 *
 * Lỗi đó chỉ lộ đúng ngày mở, với đúng nhóm người đầu tiên — nhóm chưa ai kịp
 * chấp nhận chính sách. Gói sẵn ở một chỗ để không call-site nào phải nhớ.
 */
export async function assertPolicyForAction(userId: string): Promise<void> {
  try {
    await assertPolicyAccepted(userId);
  } catch (e) {
    if (e instanceof PolicyNotAcceptedError) {
      throw new ActionError("POLICY_NOT_ACCEPTED", e.message);
    }
    throw e;
  }
}
