import { ActionError } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";

/**
 * CỔNG GHI cho bản ghi TOÀN CÔNG TY (`centerId = null`).
 *
 * ⚠️ ĐỌC ĐƯỢC KHÔNG CÓ NGHĨA LÀ GHI ĐƯỢC — và cả module này từng lẫn hai thứ đó.
 *
 * `TrnRubric`, `TrnExam`, `TrnQuestion` nằm trong `NULL_IS_GLOBAL_MODELS`, nên
 * `injectScope` CỐ Ý nới lượt đọc thành `centerId IS NULL OR centerId IN (...)`:
 * khung/đề/câu hỏi dùng chung phải nhìn thấy được từ mọi cơ sở, nếu không thì kho
 * chung tàng hình với người cấp cơ sở. Đó là hành vi đúng, và không được đổi.
 *
 * Nhưng `scopedDb` KHÔNG che đường ghi. Mượn chính lượt đọc đó làm cổng ghi — đúng
 * việc `napKhung`/`napDe` đã làm — biến "ai cũng ĐỌC được bản ghi chung" thành "ai
 * cũng GHI được bản ghi chung". Đo trên Postgres thật: một actor cấp cơ sở sửa được
 * tên, thang điểm và ngưỡng đạt của đề dùng chung toàn công ty (`passScore` 80 → 1,
 * `maxAttempts` 2 → 99), rồi kích hoạt luôn — không lỗi, không cảnh báo, và
 * `createdByUserId` vẫn ghi tên người Hội sở.
 *
 * Vì sao hỏng nặng: kích hoạt là ĐÓNG BĂNG và không có đường đảo lại trong ứng dụng.
 * Một lượt sửa nhầm trên bản ghi dùng chung chỉ gỡ được bằng tay trên DB, và trong
 * lúc đó mọi cơ sở chấm bằng cái thước sai đó — trên điểm đi vào hồ sơ nhân sự.
 *
 * ⚠️ Đây KHÔNG phải phát minh mới: repo đã xử đúng bẫy này cho `EvaluationRound`
 * bằng `roundCenterInScope` (`app/(admin)/admin/evaluations/_actions.ts`), kèm chú
 * thích nói thẳng "semantics NULL_IS_GLOBAL cho ĐỌC → KHÔNG dùng làm guard ghi".
 * Hàm dưới đây là bản dùng chung của đúng luật đó cho module đào tạo.
 *
 * ⚠️ KHÔNG đẻ khoá quyền thứ 18. Điều kiện là chính khoá đang dùng cho việc đó,
 * nhưng ở phạm vi `ALL` — tức người được cấp quyền TOÀN HỆ THỐNG, không phải người
 * được cấp quyền tại một cơ sở.
 */
export function chanGhiBanGhiChung(input: {
  actor: Actor;
  /** `centerId` của bản ghi đang sửa. */
  centerId: string | null;
  /** Khoá quyền của chính việc đang làm, vd `elearning:content:author`. */
  permission: string;
  /** Cụm động từ cho câu thông báo, vd "sửa khung này". */
  viec: string;
}): void {
  // Bản ghi CÓ cơ sở: lượt đọc qua `scopedDb` đã lọc đúng rồi.
  if (input.centerId !== null) return;

  const { actor } = input;
  const duoc =
    actor.isSuperAdmin ||
    // Per-user grant ALLOW là ngoại lệ toàn cục — đồng bộ với
    // `getModelVisibleCenterIds`, không phải một đường vòng riêng ở đây.
    actor.grantsAllow.has(input.permission) ||
    actor.permissions.some(
      (p) => p.action === input.permission && p.centerScope === "ALL",
    );

  if (duoc) return;

  throw new ActionError(
    "BAN_GHI_DUNG_CHUNG",
    `Đây là bản ghi dùng chung toàn công ty — bạn xem được nhưng không ${input.viec} được. Liên hệ Hội sở nếu cần thay đổi.`,
  );
}
