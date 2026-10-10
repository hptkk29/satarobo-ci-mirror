import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { LoiLuatLoc } from "@/lib/elearning/assignment-rule";
import { traTapNguoiHoc } from "@/lib/elearning/audience-query";
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
});

export type XemTruocInput = z.infer<typeof xemTruocSchema>;

export const cauHinhXemTruoc: ActionConfig<XemTruocInput, TapNguoiHoc> = {
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

    return {
      entityId: "preview",
      data: tap,
      // Ghi lại HÌNH DẠNG kết quả, không ghi cả danh sách tên vào sổ audit: sổ
      // audit không phải nơi nhân bản dữ liệu nhân sự.
      newValues: {
        soNhan: tap.tong,
        soThieuCoSo: tap.thieuCoSo.length,
        soThieuTaiKhoan: tap.thieuTaiKhoan.length,
        soLoaiTru: tap.biLoaiTru.length,
        mode: input.mode,
        soLuat: input.luat.length,
      },
    };
  },
};
