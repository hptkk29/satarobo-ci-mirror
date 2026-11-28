import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { thongBaoGiaHan } from "@/lib/elearning/thong-bao-nguoi-hoc";
import { TRAN_THAO_TAC_HANG_LOAT } from "@/lib/elearning/chon-nhieu";
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
  // Một NHÓM người đã chọn trong MỘT lượt giao (màn chi tiết lượt giao). Danh sách id từ client KHÔNG phải nguồn tin cậy: server chỉ thao
  // tác trên dòng THẬT SỰ thuộc `assignmentId` VÀ nằm trong tầm nhìn `scopedDb` của người bấm; id còn lại trả về `khongThay` (không phân biệt
  // "không tồn tại" với "không thuộc quyền" — không để dò id).
  z.object({
    kieu: z.literal("NHIEU_NGUOI"),
    assignmentId: z.string().min(1),
    enrollmentIds: z.array(z.string().min(1)).min(1).max(TRAN_THAO_TAC_HANG_LOAT),
  }),
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
  /** Id được yêu cầu (phạm vi NHIEU_NGUOI) nhưng KHÔNG thấy/không thuộc lượt giao — không thao tác gì với chúng. */
  khongThay: string[];
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
    const khongThay = idKhongThay(input.pham, ds);

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

    // Báo người học hạn được nới (in-app) — sau khi đã ghi, nuốt lỗi.
    await thongBaoGiaHan(capNhat).catch(() => 0);

    return {
      entityId: input.pham.kieu === "MOT_NGUOI" ? input.pham.enrollmentId : input.pham.assignmentId,
      data: { soGiaHan: capNhat.length, boQua, khongThay },
      newValues: {
        pham: input.pham.kieu,
        soGiaHan: capNhat.length,
        soBoQua: boQua.length,
        soKhongThay: khongThay.length,
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
  { soThuHoi: number; boQua: { id: string; lyDo: string }[]; khongThay: string[] }
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
    const khongThay = idKhongThay(input.pham, ds);
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
    //
    // 🔴 CHỈ đóng khi chính người thu hồi NHÌN THẤY lượt giao [kiểm toán 23/10/2026].
    // `scopedDb` không che ghi: `update({ where: { id } })` đóng lượt giao của BẤT KỲ cơ sở nào.
    // Quản lý CS1 thu hồi phần nhân sự CS1 của một lượt giao do Hội sở tạo sẽ đóng luôn lượt
    // giao đó cho CẢ CS2 và đường ĐỘNG đêm sau không còn nở người nữa. Đọc lại qua `db` đã
    // scope (HO-level thấy mọi cơ sở nên vẫn đóng được): thấy thì đóng, không thấy thì chỉ
    // thu hồi phần ghi danh trong tầm nhìn của mình.
    if (input.pham.kieu === "LUOT_GIAO") {
      const thayDuoc = await db.trnAssignment.findFirst({
        where: { id: input.pham.assignmentId },
        select: { id: true },
      });
      if (thayDuoc) {
        await db.trnAssignment.update({
          where: { id: input.pham.assignmentId },
          data: { status: "REVOKED", revokedAt: new Date(), revokeReason: reason },
        });
      }
    }

    return {
      entityId: input.pham.kieu === "MOT_NGUOI" ? input.pham.enrollmentId : input.pham.assignmentId,
      data: { soThuHoi: thuHoi.length, boQua, khongThay },
      newValues: { pham: input.pham.kieu, soThuHoi: thuHoi.length, soBoQua: boQua.length, soKhongThay: khongThay.length },
    };
  },
};

/** Id được yêu cầu mà KHÔNG có trong tập đã đọc (qua scopedDb + đúng lượt giao). Phạm vi khác ⇒ rỗng. */
function idKhongThay(pham: GiaHanInput["pham"], ds: DongGhiDanh[]): string[] {
  if (pham.kieu !== "NHIEU_NGUOI") return [];
  const co = new Set(ds.map((d) => d.id));
  return [...new Set(pham.enrollmentIds)].filter((id) => !co.has(id));
}

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
        : pham.kieu === "NHIEU_NGUOI"
          ? // `assignmentId` + `id in` ĐỒNG THỜI: id của lượt giao KHÁC không lọt vào chỉ vì nằm trong cùng tầm nhìn cơ sở.
            { assignmentId: pham.assignmentId, id: { in: [...new Set(pham.enrollmentIds)] } }
          : { id: pham.enrollmentId },
    select: { id: true, status: true, dueAt: true },
  });
  return rows as DongGhiDanh[];
}
