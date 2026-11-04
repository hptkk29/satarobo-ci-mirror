import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";

/**
 * EL-08 — PHIẾU NHU CẦU ĐÀO TẠO (B1, §8.1).
 *
 * Bản tối giản có chủ đích: 8 trường, HAI trạng thái. Thêm trạng thái thứ ba
 * ("đang xem xét", "trả lại") nghe hợp lý nhưng mỗi giá trị mới là một nhánh
 * phải nhớ ở mọi câu truy vấn về sau, đổi lấy một thông tin mà ô lý do đã nói
 * được.
 */

const QUY = /^\d{4}-Q[1-4]$/;

export const phieuNhuCauSchema = z
  .object({
    title: z.string().trim().min(1, "Tên nhu cầu không được trống"),
    targetGroupText: z.string().trim().min(1, "Ghi rõ nhóm người học cần đào tạo"),
    reason: z.string().trim().min(10, "Lý do cần ít nhất 10 ký tự"),
    expectedOutcome: z.string().trim().min(10, "Kết quả mong đợi cần ít nhất 10 ký tự"),
    proposedQuarter: z
      .string()
      .trim()
      .regex(QUY, "Quý dự kiến ghi dạng 2026-Q3"),
  })
  .strict();

export type PhieuNhuCauInput = z.infer<typeof phieuNhuCauSchema>;

export const cauHinhTaoPhieuNhuCau: ActionConfig<
  PhieuNhuCauInput,
  { needId: string; code: string }
> = {
  name: "taoPhieuNhuCau",
  // Ai cũng có thể ĐỀ NGHỊ đào tạo — đó là ý nghĩa của một phiếu nhu cầu. Quyền
  // hẹp nằm ở bước DUYỆT, không ở bước đề nghị.
  permission: "elearning:portal:access",
  module: "elearning",
  entityType: "TrnTrainingNeed",
  auditAction: "CREATE",
  schema: phieuNhuCauSchema,
  handler: async ({ db, actor, input }) => {
    const nam = new Date().getFullYear();

    // Mã sinh theo năm, đếm trong năm. Va khoá `code` là chuyện có thật khi hai
    // người bấm cùng lúc — bắt và thử lại một lần, chứ không để lỗi Prisma thô
    // rơi ra màn hình người dùng.
    let code = "";
    for (let lan = 0; lan < 5; lan += 1) {
      const dem = await db.trnTrainingNeed.count({
        where: { code: { startsWith: `NC.${nam}.` } },
      });
      code = `NC.${nam}.${String(dem + 1 + lan).padStart(3, "0")}`;
      const trung = await db.trnTrainingNeed.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!trung) break;
      code = "";
    }
    if (!code) {
      throw new ActionError("CONFLICT", "Không sinh được mã phiếu, thử lại giúp tôi");
    }

    const n = await db.trnTrainingNeed.create({
      data: {
        code,
        title: input.title,
        requesterUserId: actor.userId,
        targetGroupText: input.targetGroupText,
        reason: input.reason,
        expectedOutcome: input.expectedOutcome,
        proposedQuarter: input.proposedQuarter,
        status: "NEW",
      },
      select: { id: true, code: true },
    });

    return {
      entityId: n.id,
      data: { needId: n.id, code: n.code },
      newValues: { code: n.code, title: input.title, quy: input.proposedQuarter },
    };
  },
};

export const duyetPhieuSchema = z.object({ needId: z.string().min(1) }).strict();

export const cauHinhDuyetPhieuNhuCau: ActionConfig<
  z.infer<typeof duyetPhieuSchema>,
  { needId: string }
> = {
  name: "duyetPhieuNhuCau",
  // Duyệt là bước quyết định — dùng khoá quản lý chương trình, KHÔNG dùng khoá
  // truy cập chung như bước đề nghị.
  permission: "elearning:program:manage",
  module: "elearning",
  entityType: "TrnTrainingNeed",
  auditAction: "UPDATE",
  requireReason: true,
  schema: duyetPhieuSchema,
  handler: async ({ db, actor, input, reason }) => {
    const n = await db.trnTrainingNeed.findFirst({
      where: { id: input.needId, deletedAt: null },
      select: { id: true, status: true, requesterUserId: true, code: true },
    });
    if (!n) throw new ActionError("NOT_FOUND", "Không tìm thấy phiếu nhu cầu");

    if (n.status === "APPROVED") {
      // Duyệt lại không đổi gì nhưng sẽ ghi đè `approvedByUserId`/`approvedAt` —
      // tức xoá dấu vết ai duyệt THẬT SỰ lần đầu.
      throw new ActionError("ALREADY_DONE", "Phiếu này đã được duyệt rồi");
    }

    // ⚠️ Người đề nghị KHÔNG tự duyệt phiếu của mình. Đây là điểm duy nhất của
    // luồng có tính kiểm soát; bỏ nó đi thì "phải có phiếu đã duyệt" chỉ còn là
    // một thao tác bấm thêm một nút.
    if (n.requesterUserId === actor.userId) {
      throw new ActionError(
        "SELF_APPROVAL",
        "Không tự duyệt phiếu do chính mình đề nghị",
      );
    }

    await db.trnTrainingNeed.update({
      where: { id: n.id },
      data: {
        status: "APPROVED",
        approvedByUserId: actor.userId,
        approvedAt: new Date(),
      },
    });

    return {
      entityId: n.id,
      data: { needId: n.id },
      oldValues: { status: n.status },
      newValues: { status: "APPROVED", code: n.code, lyDo: reason },
    };
  },
};
