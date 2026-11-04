import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import {
  chonDeThuHoi,
  tinhGiaHan,
  type DongGhiDanh,
  type LyDoBoQua,
} from "@/lib/elearning/extend-revoke";

/**
 * EL-05 — VÒNG ĐỜI LƯỢT GIAO: gia hạn và thu hồi.
 *
 * ⚠️ Cả hai action đều `requireReason: true`. Không phải thủ tục: gia hạn và thu
 * hồi là hai thao tác làm hỏng kỳ vọng của người học, nên phải trả lời được câu
 * "vì sao" ở thời điểm sau. Sổ audit không có lý do là sổ chỉ nói được ai bấm.
 *
 * ⚠️ CẢ HAI action KHÔNG BAO GIỜ ghi `dueAtOriginal`. Xem `extend-revoke.ts`.
 *
 * Nút "sự cố hệ thống" (QĐ-CDA-15 mục 2) chính là `giaHanLuotGiaoAction` với
 * `pham vi = "LUOT_GIAO"`: người trực xác nhận sự cố thì gia hạn CẢ lượt giao cho
 * mọi người, không xét từng đơn. Quyền đã có sẵn (`elearning:assignment:extend`,
 * vai `TRAINING` giữ) nên không tạo key mới, không tạo vai mới.
 *
 * ⚠️ Bảng `TrnIncident` (sổ sự cố có vòng đời) thuộc EL-06, CHƯA tồn tại. Ở đây
 * lý do + sổ audit là bằng chứng; không tự thêm bảng ngoài story được giao.
 */

const phamVi = z.discriminatedUnion("kieu", [
  z.object({ kieu: z.literal("LUOT_GIAO"), assignmentId: z.string().min(1) }),
  z.object({ kieu: z.literal("MOT_NGUOI"), enrollmentId: z.string().min(1) }),
]);

export const giaHanSchema = z
  .object({
    pham: phamVi,
    // Một trong hai, không phải cả hai: mốc tuyệt đối hoặc cộng ngày.
    denNgay: z.union([z.null(), z.coerce.date()]).optional(),
    themNgay: z.union([z.null(), z.number().int().min(1).max(365)]).optional(),
  })
  .strict();

export type GiaHanInput = z.infer<typeof giaHanSchema>;

export type GiaHanKetQua = {
  soGiaHan: number;
  boQua: { id: string; lyDo: LyDoBoQua }[];
};

export const cauHinhGiaHan: ActionConfig<GiaHanInput, GiaHanKetQua> = {
  name: "giaHanLuotGiao",
  permission: "elearning:assignment:extend",
  module: "elearning",
  entityType: "TrnEnrollment",
  auditAction: "UPDATE",
  requireReason: true,
  schema: giaHanSchema,
  handler: async ({ db, actor, input, reason }) => {
    const cach = docCachGiaHan(input);
    const ds = await docGhiDanh(db, input.pham);
    if (!ds.length) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy lượt ghi danh nào để gia hạn");
    }

    const { capNhat, boQua } = tinhGiaHan(ds, cach, new Date());

    // ⚠️ Ghi TỪNG dòng chứ không `updateMany`: mỗi dòng có hạn mới KHÁC nhau khi
    // gia hạn theo số ngày (mốc tính từ `max(hạn riêng, bây giờ)`). `updateMany`
    // sẽ ép cả lô về cùng một hạn — sai với đúng nhóm mà nút này phải cứu.
    if (capNhat.length) {
      await db.$transaction(
        capNhat.map((c) =>
          db.trnEnrollment.update({
            where: { id: c.id },
            data: {
              // KHÔNG đụng `dueAtOriginal`.
              dueAt: c.dueAt,
              extensionReason: reason,
              extendedByUserId: actor.userId,
              // Người đang quá hạn được cứu thì phải RA khỏi trạng thái quá hạn,
              // nếu không hạn mới có mà cổng ghi tiến độ vẫn khoá.
              ...(c.dueAt > new Date() ? { status: "IN_PROGRESS" as const } : {}),
            },
          }),
        ),
      );
    }

    return {
      entityId:
        input.pham.kieu === "LUOT_GIAO" ? input.pham.assignmentId : input.pham.enrollmentId,
      data: { soGiaHan: capNhat.length, boQua },
      newValues: {
        pham: input.pham.kieu,
        soGiaHan: capNhat.length,
        soBoQua: boQua.length,
        denNgay: input.denNgay?.toISOString() ?? null,
        themNgay: input.themNgay ?? null,
      },
    };
  },
};

export const thuHoiSchema = z
  .object({ pham: phamVi })
  .strict();

export type ThuHoiInput = z.infer<typeof thuHoiSchema>;

export const cauHinhThuHoi: ActionConfig<
  ThuHoiInput,
  { soThuHoi: number; boQua: { id: string; lyDo: string }[] }
> = {
  name: "thuHoiLuotGiao",
  permission: "elearning:assignment:create",
  module: "elearning",
  entityType: "TrnEnrollment",
  auditAction: "UPDATE",
  requireReason: true,
  schema: thuHoiSchema,
  handler: async ({ db, input, reason }) => {
    const ds = await docGhiDanh(db, input.pham);
    if (!ds.length) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy lượt ghi danh nào để thu hồi");
    }
    const { thuHoi, boQua } = chonDeThuHoi(ds);

    if (thuHoi.length) {
      // Ở đây `updateMany` ĐÚNG: mọi dòng nhận cùng một giá trị.
      await db.trnEnrollment.updateMany({
        where: { id: { in: thuHoi } },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
          revokeReason: reason,
        },
      });
    }

    // Lượt giao bị thu hồi TOÀN BỘ thì bản thân lượt giao cũng đóng, nếu không
    // đường ĐỘNG đêm sau lại nở ra đúng những người vừa bị thu hồi.
    if (input.pham.kieu === "LUOT_GIAO") {
      await db.trnAssignment.update({
        where: { id: input.pham.assignmentId },
        data: { status: "REVOKED", revokedAt: new Date(), revokeReason: reason },
      });
    }

    return {
      entityId:
        input.pham.kieu === "LUOT_GIAO" ? input.pham.assignmentId : input.pham.enrollmentId,
      data: { soThuHoi: thuHoi.length, boQua },
      newValues: { pham: input.pham.kieu, soThuHoi: thuHoi.length, soBoQua: boQua.length },
    };
  },
};

function docCachGiaHan(input: GiaHanInput): { denNgay: Date } | { themNgay: number } {
  const coNgay = input.denNgay instanceof Date;
  const coSo = typeof input.themNgay === "number";
  if (coNgay === coSo) {
    // Cả hai hoặc không cái nào: im lặng chọn một bên là đoán ý người vận hành
    // trên đúng thứ họ đang cố điều khiển.
    throw new ActionError(
      "VALIDATION",
      "Chọn MỘT trong hai: gia hạn đến ngày cụ thể, hoặc cộng thêm số ngày",
      "denNgay",
    );
  }
  return coNgay ? { denNgay: input.denNgay as Date } : { themNgay: input.themNgay as number };
}

async function docGhiDanh(
  db: ScopedDb,
  pham: GiaHanInput["pham"],
): Promise<DongGhiDanh[]> {
  // Đọc qua `scopedDb` — không bypass. Người cấp cơ sở chỉ gia hạn/thu hồi được
  // cho nhân sự cơ sở mình; đây cũng chính là hàng rào IDOR của hai action này,
  // vì `assignmentId`/`enrollmentId` đến thẳng từ client.
  const rows = await db.trnEnrollment.findMany({
    where:
      pham.kieu === "LUOT_GIAO"
        ? { assignmentId: pham.assignmentId }
        : { id: pham.enrollmentId },
    select: { id: true, status: true, dueAt: true },
  });
  return rows as DongGhiDanh[];
}
