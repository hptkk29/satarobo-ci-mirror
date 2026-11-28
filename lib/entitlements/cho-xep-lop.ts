// lib/entitlements/cho-xep-lop.ts — VÒNG ĐỜI CỦA MỘT DÒNG "CHỜ XẾP LỚP" (loại CHO_XEP_LOP). THUẦN, không DB.
//
// Cùng khuôn `cho-chuyen-doi.ts` (mở / mở lại / đổi lý do / đóng — một dòng cho mỗi (orderItemId, loai), lật trạng thái chứ không chèn dòng),
// nhưng KHÁC ở lời đóng: dòng này đóng `DA_XU_LY` khi quyền học ĐÃ được chốt phạm vi (không phải "đã có học viên"), và `HUY` khi dòng
// không còn gì để xếp (tiền không còn đủ / quyền học bị huỷ / đơn bị huỷ). Tách file riêng vì `hanhDongChoChuyenDoi` nhồi sẵn câu
// "Đã có học viên — quyền học đã được cấp." vào lúc đóng — dùng lại là ghi sai lý do vào hàng đợi người vận hành đọc.
//
// Hai điều dễ sai im lặng (cùng bài học của `cho-chuyen-doi.ts`):
//   · gọi lại bao nhiêu lần cũng KHÔNG ghi thêm gì khi không có gì đổi (`updatedAt` không nhấp nháy, không dòng thứ hai);
//   · dòng đã đóng mà lại phải chờ thì LẬT MỞ LẠI cùng dòng (khoá duy nhất là (orderItemId, loai)).

export type TinhHuongXepLop =
  /** Chưa chốt được phạm vi bài — kèm lý do cho người đọc. */
  | { readonly kieu: "PHAI_CHO"; readonly lyDo: string }
  /** Quyền học đã được chốt phạm vi và không còn việc phải xem. */
  | { readonly kieu: "DA_XEP_XONG" }
  /** Không còn gì để xếp: tiền không còn đủ, quyền học bị huỷ, đơn huỷ/hoàn. */
  | { readonly kieu: "KHONG_CON_HOP_LE"; readonly lyDo: string };

export interface DongChoXepLopHienCo {
  readonly trangThai: "OPEN" | "DA_XU_LY" | "HUY";
  readonly lyDo: string;
  /** Như `DongChoHienCo.daQuyetDauVan` (cho-chuyen-doi.ts): dấu vân quyết định của người xử lý, `null` nếu dòng không đóng do người. BẮT BUỘC (luật 7). */
  readonly daQuyetDauVan: string | null;
}

export type HanhDongChoXepLop =
  | { readonly viec: "KHONG_LAM_GI" }
  | { readonly viec: "TAO_MOI"; readonly lyDo: string }
  | { readonly viec: "MO_LAI"; readonly lyDo: string }
  | { readonly viec: "CAP_NHAT_LY_DO"; readonly lyDo: string }
  | { readonly viec: "DONG"; readonly trangThai: "DA_XU_LY" | "HUY"; readonly lyDo: string };

export const LY_DO_DA_XEP_XONG = "Đã chốt phạm vi bài theo quyền học — không còn gì để xem.";

export function hanhDongChoXepLop(hienCo: DongChoXepLopHienCo | null, tinhHuong: TinhHuongXepLop): HanhDongChoXepLop {
  const dangMo = hienCo?.trangThai === "OPEN";
  switch (tinhHuong.kieu) {
    case "PHAI_CHO":
      if (!hienCo) return { viec: "TAO_MOI", lyDo: tinhHuong.lyDo };
      if (!dangMo) return hienCo.daQuyetDauVan !== null && hienCo.daQuyetDauVan === tinhHuong.lyDo ? { viec: "KHONG_LAM_GI" } : { viec: "MO_LAI", lyDo: tinhHuong.lyDo };
      return hienCo.lyDo === tinhHuong.lyDo ? { viec: "KHONG_LAM_GI" } : { viec: "CAP_NHAT_LY_DO", lyDo: tinhHuong.lyDo };
    case "DA_XEP_XONG":
      return dangMo ? { viec: "DONG", trangThai: "DA_XU_LY", lyDo: LY_DO_DA_XEP_XONG } : { viec: "KHONG_LAM_GI" };
    case "KHONG_CON_HOP_LE":
      return dangMo ? { viec: "DONG", trangThai: "HUY", lyDo: tinhHuong.lyDo } : { viec: "KHONG_LAM_GI" };
  }
}
