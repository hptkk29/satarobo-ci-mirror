import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import {
  chuyenTrangThaiCo,
  hanTraLoi,
  hetCuaSoKhieuNai,
} from "@/lib/elearning/watch-flag-rules";

/**
 * EL-13 — ĐƯỜNG KHIẾU NẠI CỜ NGHI NGỜ.
 *
 * ⚠️ Đặc tả gọi đường này là BẮT BUỘC, không phải tuỳ chọn (QĐ-CDA-04 mục 4).
 * Gắn cờ nghi ngờ mà không có đường nói lại là rủi ro quan hệ lao động: hệ thống
 * ghi một cáo buộc về hành vi người lao động, và người bị ghi không có cách nào
 * phản hồi trong chính hệ thống đó.
 *
 * ⚠️ Đây là một trong số ít đường ghi của module ĐI QUA action factory (tức CÓ
 * audit). Nhịp xem thì không — nhịp 15 giây sẽ nhấn chìm bảng audit. Nhưng khiếu
 * nại là một dòng chứng từ, và nó ĐÁNG được audit.
 */

export const khieuNaiCoSchema = z
  .object({
    flagId: z.string().min(1),
    /**
     * Nội dung khiếu nại. Bắt buộc và có sàn độ dài: một khiếu nại rỗng thì người
     * xử không có gì để xét, và họ sẽ giữ cờ chỉ vì không biết phải xét cái gì.
     */
    noiDung: z
      .string()
      .trim()
      .min(10, "Hãy nói rõ vì sao số liệu này không đúng (ít nhất 10 ký tự)")
      .max(2000),
  })
  .strict();

export type KhieuNaiCoInput = z.infer<typeof khieuNaiCoSchema>;

export const cauHinhKhieuNaiCo: ActionConfig<KhieuNaiCoInput, { status: string }> = {
  name: "khieuNaiCo",
  // Quyền HỌC, không phải quyền quản trị: người khiếu nại chính là người bị gắn cờ.
  permission: "elearning:lesson:learn",
  module: "elearning",
  entityType: "TrnWatchFlag",
  auditAction: "UPDATE",
  schema: khieuNaiCoSchema,
  handler: async ({ db, actor, input }) => {
    const co = await db.trnWatchFlag.findFirst({
      // ⚠️ Khoá theo CHÍNH `userId` của actor. Thiếu vế này thì bất kỳ ai đoán
      // được một id cờ đều khiếu nại thay người khác — và bản ghi khiếu nại đó
      // mang tên họ trong một hồ sơ không phải của họ.
      where: { id: input.flagId, userId: actor.userId },
      select: {
        id: true,
        status: true,
        appealDeadline: true,
        ruleCode: true,
      },
    });
    if (!co) throw new ActionError("NOT_FOUND", "Không tìm thấy cờ này");

    const now = new Date();
    if (hetCuaSoKhieuNai({ appealDeadline: co.appealDeadline, now })) {
      throw new ActionError(
        "APPEAL_WINDOW_CLOSED",
        "Đã hết cửa sổ khiếu nại 14 ngày cho cờ này",
      );
    }

    const chuyen = chuyenTrangThaiCo({ hienTai: co.status, hanhDong: "KHIEU_NAI" });
    if (!chuyen.ok) throw new ActionError(chuyen.code, chuyen.message);

    await db.trnWatchFlag.update({
      where: { id: co.id },
      data: {
        status: chuyen.status,
        appealedAt: now,
        appealNote: input.noiDung,
        // Thời hạn trả lời tính bằng NGÀY LÀM VIỆC — xem `hanTraLoi`.
        decisionDueAt: hanTraLoi(now),
      },
    });

    return {
      entityId: co.id,
      data: { status: chuyen.status },
      oldValues: { status: co.status },
      newValues: { status: chuyen.status, ruleCode: co.ruleCode },
    };
  },
};

export const quyetCoSchema = z
  .object({
    flagId: z.string().min(1),
    giuCo: z.boolean(),
    /** Bắt buộc khi GỠ cờ — máy trạng thái tự chặn nếu thiếu. */
    lyDo: z.union([z.null(), z.string().trim().max(2000)]).optional(),
  })
  .strict();

export type QuyetCoInput = z.infer<typeof quyetCoSchema>;

export const cauHinhQuyetCo: ActionConfig<QuyetCoInput, { status: string }> = {
  name: "quyetCo",
  // ⚠️ Khoá CÓ THẬT trong `prisma/seed-roles.ts`. Bản đầu viết
  // `elearning:report:view` — một khoá không tồn tại, tức `can()` luôn trả false
  // và không ai quyết được cờ nào. Sai kiểu này không văng lỗi ở đâu cả: quyền chỉ
  // im lặng không khớp.
  permission: "elearning:video-analytics:view",
  module: "elearning",
  entityType: "TrnWatchFlag",
  auditAction: "UPDATE",
  schema: quyetCoSchema,
  handler: async ({ db, actor, input }) => {
    const co = await db.trnWatchFlag.findFirst({
      where: { id: input.flagId },
      select: { id: true, status: true, handlerUserId: true, ruleCode: true },
    });
    if (!co) throw new ActionError("NOT_FOUND", "Không tìm thấy cờ này");

    const chuyen = chuyenTrangThaiCo({
      hienTai: co.status,
      hanhDong: input.giuCo ? "GIU_CO" : "GO_CO",
      lyDo: input.lyDo ?? null,
    });
    if (!chuyen.ok) throw new ActionError(chuyen.code, chuyen.message);

    await db.trnWatchFlag.update({
      where: { id: co.id },
      data: {
        status: chuyen.status,
        decidedAt: new Date(),
        // Ghi AI quyết, không ghi `handlerUserId`: người được giao không nhất
        // thiết là người bấm nút (họ nghỉ, việc chuyển tay). Ghi người được giao
        // vào đây là gán một quyết định cho người có thể chưa từng đọc hồ sơ.
        decidedByUserId: actor.userId,
        decisionNote: input.lyDo ?? null,
      },
    });

    return {
      entityId: co.id,
      data: { status: chuyen.status },
      oldValues: { status: co.status },
      newValues: { status: chuyen.status, ruleCode: co.ruleCode },
    };
  },
};
