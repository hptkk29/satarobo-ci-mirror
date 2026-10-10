import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { tinhGiaHan, type DongGhiDanh, type LyDoBoQua } from "@/lib/elearning/extend-revoke";

/**
 * EL-06 — GHI NHẬN SỰ CỐ HỆ THỐNG và gia hạn CẢ lượt giao (QĐ-CDA-15 mục 2).
 *
 * Kịch bản chắc chắn xảy ra tuần đầu: 16h50 ngày hạn, video không chạy trên điện
 * thoại của bốn người. Không có đường này thì cách xử duy nhất là sửa tay từng
 * dòng — và không để lại dấu vết nào.
 *
 * ⚠️ Vì sao KHÔNG gộp vào `giaHanLuotGiaoAction` (EL-05): gia hạn là một thao tác
 * hành chính bình thường, còn sự cố là một SỰ KIỆN có vòng đời — nó có mốc phát
 * hiện, mốc xử lý xong, và tên người xác nhận. Trộn hai thứ thì sổ sự cố hoặc
 * đầy những dòng không phải sự cố, hoặc rỗng vì chẳng ai bấm đúng nút.
 *
 * ⚠️ `confirmedByUserId` lấy từ ACTOR, không nhận từ input: người bấm nút chính
 * là người xác nhận. Cho phép truyền vào là mở đường ghi tên người khác.
 */

export const suCoSchema = z
  .object({
    title: z.string().trim().min(1, "Mô tả sự cố không được trống"),
    scope: z.enum(["ASSIGNMENT", "GLOBAL"]),
    assignmentId: z.union([z.null(), z.string().min(1)]).optional(),
    extendDays: z.number().int().min(1).max(60),
    // Mốc phát hiện có thể lùi về quá khứ — sự cố thường được xác nhận SAU khi
    // nó xảy ra. Nhưng không cho ghi ở tương lai.
    detectedAt: z.union([z.null(), z.coerce.date()]).optional(),
  })
  .strict();

export type SuCoInput = z.infer<typeof suCoSchema>;

export type SuCoKetQua = {
  incidentId: string;
  soGiaHan: number;
  boQua: { id: string; lyDo: LyDoBoQua }[];
};

export const cauHinhGhiNhanSuCo: ActionConfig<SuCoInput, SuCoKetQua> = {
  name: "ghiNhanSuCo",
  permission: "elearning:assignment:extend",
  module: "elearning",
  entityType: "TrnIncident",
  auditAction: "CREATE",
  requireReason: true,
  schema: suCoSchema,
  handler: async ({ db, actor, input, reason }) => {
    if (input.scope === "ASSIGNMENT" && !input.assignmentId) {
      throw new ActionError(
        "VALIDATION",
        "Sự cố phạm vi một lượt giao thì phải chọn lượt giao",
        "assignmentId",
      );
    }

    const now = new Date();
    const detectedAt = input.detectedAt ?? now;
    if (detectedAt.getTime() > now.getTime()) {
      // Mốc phát hiện ở tương lai làm mọi phép đo thời gian xử lý ra số âm.
      throw new ActionError(
        "VALIDATION",
        "Mốc phát hiện sự cố không thể ở tương lai",
        "detectedAt",
      );
    }

    // Đọc qua `scopedDb`: `assignmentId` đến từ client, nên đây cũng là hàng rào
    // IDOR — người cấp cơ sở không gia hạn được lượt giao của cơ sở khác.
    const ds = (await db.trnEnrollment.findMany({
      where:
        input.scope === "ASSIGNMENT"
          ? { assignmentId: input.assignmentId! }
          : { status: { in: ["NOT_STARTED", "IN_PROGRESS", "OVERDUE"] } },
      select: { id: true, status: true, dueAt: true },
      take: 5000,
    })) as DongGhiDanh[];

    const { capNhat, boQua } = tinhGiaHan(ds, { themNgay: input.extendDays }, now);

    const ketQua = await db.$transaction(async (tx) => {
      const sc = await tx.trnIncident.create({
        data: {
          title: input.title,
          detectedAt,
          confirmedByUserId: actor.userId,
          scope: input.scope,
          assignmentId: input.assignmentId ?? null,
          extendDays: input.extendDays,
          // `appliedAt` đặt NGAY vì việc gia hạn xảy ra trong cùng giao dịch này.
          // Để trống rồi cập nhật sau là mở ra một trạng thái "đã ghi nhận nhưng
          // chưa áp dụng" mà không có gì đảm bảo sẽ có ai đóng lại.
          appliedAt: now,
          appliedCount: capNhat.length,
        },
        select: { id: true },
      });

      // Ghi TỪNG dòng: hạn mới tính từ `max(hạn riêng, bây giờ)` nên mỗi người
      // một giá trị. `updateMany` ép cả lô về một hạn.
      for (const c of capNhat) {
        await tx.trnEnrollment.update({
          where: { id: c.id },
          data: {
            // KHÔNG đụng `dueAtOriginal` — xem `extend-revoke.ts`.
            dueAt: c.dueAt,
            extensionReason: `Sự cố hệ thống: ${input.title}${reason ? ` — ${reason}` : ""}`,
            extendedByUserId: actor.userId,
            ...(c.dueAt > now ? { status: "IN_PROGRESS" as const } : {}),
          },
        });
      }

      return sc.id;
    });

    return {
      entityId: ketQua,
      data: { incidentId: ketQua, soGiaHan: capNhat.length, boQua },
      newValues: {
        title: input.title,
        scope: input.scope,
        extendDays: input.extendDays,
        soGiaHan: capNhat.length,
        soBoQua: boQua.length,
      },
    };
  },
};
