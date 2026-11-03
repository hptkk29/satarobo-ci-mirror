import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { chanGhiBanGhiChung } from "@/lib/elearning/global-write-guard";

/**
 * EL-16 — THU HỒI chứng nhận (BR-007).
 *
 * Đây là thao tác nặng nhất của cả ticket: nó vô hiệu một chứng từ đã phát ra tay
 * một con người và có thể đã được nộp cho bên thứ ba. Vì vậy:
 *
 *  · quyền HẸP — `elearning:certificate:revoke`, chỉ SUPER_ADMIN và HO_HR (đọc từ
 *    `prisma/seed-roles.ts`; nó KHÔNG nằm trong bộ quyền của Đào tạo);
 *  · LÝ DO bắt buộc, và lý do ấy đi vào cả bản ghi lẫn AuditLog;
 *  · trang xác minh công khai vẫn TRẢ LỜI sau khi thu hồi — nói "đã thu hồi" kèm
 *    ngày, chứ không 404. Im lặng ở đó là để người cầm bản PDF cũ tin vào tờ giấy.
 */

const thuHoiSchema = z
  .object({
    certificateId: z.string().min(1),
  })
  .strict();

export type ThuHoiInput = z.infer<typeof thuHoiSchema>;

export const cauHinhThuHoiChungNhan: ActionConfig<
  ThuHoiInput,
  { certificateId: string; certCode: string }
> = {
  name: "thuHoiChungNhan",
  permission: "elearning:certificate:revoke",
  module: "elearning",
  entityType: "TrnCertificate",
  auditAction: "UPDATE",
  // BR-007 nói đích danh: bắt buộc lý do. Factory trả `VALIDATION` field `reason`
  // khi thiếu, nên không có đường vòng nào bỏ qua được.
  requireReason: true,
  schema: thuHoiSchema,
  handler: async ({ db, actor, input, reason }) => {
    const cn = await db.trnCertificate.findFirst({
      where: { id: input.certificateId },
      select: {
        id: true,
        certCode: true,
        status: true,
        centerId: true,
        revokedAt: true,
        enrollmentId: true,
      },
    });
    // Đọc qua `scopedDb` là hàng rào IDOR của đường này: `certificateId` đến thẳng
    // từ biểu mẫu, nên người cấp cơ sở không thu hồi được chứng nhận cơ sở khác.
    if (!cn) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy chứng nhận này");
    }

    // ⚠️ `centerId = null` trên bảng này KHÔNG nghĩa là "dùng chung": chứng nhận luôn
    // thuộc cơ sở của người được cấp (`TrnCertificate` không nằm trong
    // `NULL_IS_GLOBAL_MODELS`). Nhưng lượt đọc scoped vẫn cho qua bản ghi `null` như
    // một dòng chưa backfill, nên phải chặn GHI tường minh — đúng bài học đã đo được
    // trên Postgres thật ở EL-14: một người cấp cơ sở sửa được đề thi toàn công ty.
    chanGhiBanGhiChung({
      actor,
      centerId: cn.centerId,
      permission: "elearning:certificate:revoke",
      viec: "thu hồi",
    });

    if (cn.revokedAt != null) {
      // Thu hồi lần hai không phải lỗi hệ thống, nhưng cũng không được im lặng ghi
      // đè: ngày thu hồi ĐẦU TIÊN là mốc pháp lý, và đè lên nó là xoá dấu vết của
      // lần quyết định thật.
      throw new ActionError(
        "CONFLICT",
        `Chứng nhận ${cn.certCode} đã bị thu hồi trước đó rồi`,
      );
    }

    await db.trnCertificate.update({
      where: { id: cn.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByUserId: actor.userId,
        revokeReason: reason,
      },
    });

    // ⚠️ CỐ Ý không tự giao lại khoá cho người bị thu hồi.
    //
    // Hết hạn và bị thu hồi là hai việc khác nhau: hết hạn là đồng hồ chạy, nên giao
    // lại tự động là đúng. Thu hồi là một QUYẾT ĐỊNH về một con người — có thể vì
    // gian lận, có thể vì cấp nhầm. Tự giao lại khoá ngay sau đó là hệ thống thay
    // người ra quyết định trả lời câu "người này có phải học lại không", trong khi
    // câu trả lời đúng còn tuỳ vì sao thu hồi. Ai thu hồi thì giao lại bằng đường
    // giao bài thường (EL-05), có tên và có dấu vết.

    return {
      entityId: cn.id,
      data: { certificateId: cn.id, certCode: cn.certCode },
      // Trang đề cương của người học hiện thẻ chứng nhận — phải dựng lại, nếu không
      // họ còn thấy "đã có chứng nhận" sau khi nó đã bị thu hồi.
      paths: [`/elearning/hoc/${cn.enrollmentId}`],
    };
  },
};
