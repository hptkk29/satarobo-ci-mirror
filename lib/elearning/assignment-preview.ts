import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { LoiLuatLoc } from "@/lib/elearning/assignment-rule";
import { traTapNguoiHoc } from "@/lib/elearning/audience-query";
import { CHU_KY_MAC_DINH } from "@/lib/elearning/enrollment-rows";
import type { TapNguoiHoc } from "@/lib/elearning/audience";

/**
 * EL-05 — CẤU HÌNH ACTION "XEM TRƯỚC TẬP NGƯỜI HỌC" (luật 5 + luật 6).
 *
 * ⚠️ Cấu hình nằm ở lib (không phải trong tệp `"use server"`) là CÓ CHỦ ĐÍCH.
 * Tệp `"use server"` không nạp được trong vitest, nên khuôn cũ của repo là chép
 * lại cấu hình sang test kèm một guard so nguồn. Hai bản chép tay thì sớm muộn
 * cũng trôi khỏi nhau, và guard chỉ bắt được phần chữ nó nghĩ tới. Đặt cấu hình ở
 * đây thì test chạy ĐÚNG cái sẽ chạy trên máy chủ, không cần bản sao nào.
 *
 * ⚠️ Vì sao xem trước vẫn ghi AuditLog dù chỉ là ĐỌC: nó đọc danh sách nhân sự
 * (tên, chức danh, cơ sở) theo một luật lọc tuỳ ý — biết ai đã dò tập người nào
 * là dữ liệu đáng giữ. Đổi lại, xem trước phải do người dùng BẤM NÚT, không chạy
 * theo từng phím gõ, nếu không sổ audit ngập.
 */

export const xemTruocSchema = z.object({
  luat: z.array(z.unknown()).max(20),
  mode: z.enum(["STATIC", "DYNAMIC"]),
  themTayUserId: z.array(z.string().min(1)).max(500).default([]),
  loaiTruUserId: z.array(z.string().min(1)).max(500).default([]),
  /**
   * Khoá sắp giao (tuỳ chọn). Có ⇒ kết quả kèm `daCoGhiDanh`: người ĐÃ có lượt học khoá này cùng chu kỳ (kể cả lượt đã thu hồi) —
   * lượt giao sẽ BỎ QUA họ, và bước xác nhận phải nói đích danh TRƯỚC khi bấm giao (thiết kế QtGiaoKhoa4), không đợi toast sau khi giao.
   */
  courseId: z.string().min(1).optional(),
});

export type XemTruocInput = z.infer<typeof xemTruocSchema>;

export type TapXemTruoc = TapNguoiHoc & {
  /** Người trong `nhan` ∪ `biLoaiTru` đã có ghi danh cùng khoá + cùng chu kỳ. Rỗng nếu không gửi `courseId`. */
  daCoGhiDanh: { userId: string; fullName: string; employeeCode: string }[];
};

export const cauHinhXemTruoc: ActionConfig<XemTruocInput, TapXemTruoc> = {
  name: "xemTruocTapNguoiHoc",
  permission: "elearning:assignment:create",
  module: "elearning",
  entityType: "TrnAssignment",
  auditAction: "READ",
  schema: xemTruocSchema,
  handler: async ({ db, input }) => {
    let tap: TapNguoiHoc;
    try {
      tap = await traTapNguoiHoc(db, {
        luat: input.luat,
        mode: input.mode,
        now: new Date(),
        themTayUserId: input.themTayUserId,
        loaiTruUserId: input.loaiTruUserId,
      });
    } catch (e) {
      // Lỗi luật lọc là lỗi NGƯỜI DÙNG SỬA ĐƯỢC (chọn nhầm chiều, luật tự tham
      // chiếu). Để nó rơi ra thành 500 là biến một câu hướng dẫn thành "Có lỗi
      // xảy ra" — và người giao bài không biết sửa gì.
      if (e instanceof LoiLuatLoc) {
        throw new ActionError(e.code, e.message, e.field);
      }
      throw e;
    }

    // Cùng khoá duy nhất với lúc tạo lượt giao (`courseId, userId, cycle`; dòng mới mang `CHU_KY_MAC_DINH`) — hai nơi PHẢI cùng cách đo.
    // Đo trên nhận ∪ bị loại trừ: người dùng có thể chọn LẠI một người bị loại trừ ngay trên danh sách xem trước, và khi đó họ cũng phải được nêu "sẽ bỏ qua".
    const duKien = [...tap.nhan, ...tap.biLoaiTru];
    const userIdNhan = duKien.map((x) => x.userId).filter((u): u is string => u !== null);
    const daCoRows =
      input.courseId && userIdNhan.length
        ? await db.trnEnrollment.findMany({
            where: { courseId: input.courseId, userId: { in: userIdNhan }, cycle: CHU_KY_MAC_DINH },
            select: { userId: true },
          })
        : [];
    const daCoUser = new Set(daCoRows.map((e: { userId: string }) => e.userId));
    const daCoGhiDanh = duKien
      .filter((x) => x.userId !== null && daCoUser.has(x.userId))
      .map((x) => ({ userId: x.userId as string, fullName: x.fullName, employeeCode: x.employeeCode }));

    return {
      entityId: "preview",
      data: { ...tap, daCoGhiDanh },
      // Ghi lại HÌNH DẠNG kết quả, không ghi cả danh sách tên vào sổ audit: sổ
      // audit không phải nơi nhân bản dữ liệu nhân sự.
      newValues: {
        soNhan: tap.tong,
        soThieuCoSo: tap.thieuCoSo.length,
        soThieuTaiKhoan: tap.thieuTaiKhoan.length,
        soLoaiTru: tap.biLoaiTru.length,
        soDaCoGhiDanh: daCoGhiDanh.length,
        mode: input.mode,
        soLuat: input.luat.length,
      },
    };
  },
};
