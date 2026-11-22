// lib/entitlements/cho-chuyen-doi.ts — VÒNG ĐỜI CỦA MỘT DÒNG "CHỜ CHUYỂN ĐỔI". THUẦN, không DB.
//
// Chủ dự án chốt 11/10/2026: tiền đã xác nhận mà CHƯA có học viên ⇒ KHÔNG cấp quyền active, ghi trạng thái chờ
// (`StudyEntitlementXuLy`, loại CHO_CHUYEN_DOI); sau khi có học viên thì tự cấp và đóng dòng chờ.
//
// Hàm này chỉ trả LỜI KHUYÊN "làm gì với dòng chờ hiện có" cho một tình huống — cap-tu-don.ts thi hành. Tách ra để
// khẳng định các chuyển trạng thái mà không cần DB, đặc biệt hai điều dễ sai im lặng:
//   · gọi lại bao nhiêu lần cũng KHÔNG ghi thêm gì khi không có gì đổi (`updatedAt` không nhấp nháy, không dòng thứ hai);
//   · dòng đã đóng mà lại phải chờ thì LẬT MỞ LẠI cùng dòng, không chèn dòng mới (khoá duy nhất là (orderItemId, loai)).

export type TinhHuongCho =
  /** Đủ tiền, chưa xác định được học viên. */
  | { readonly kieu: "PHAI_CHO"; readonly lyDo: string }
  /** Quyền học đã có (vừa cấp hoặc có sẵn). */
  | { readonly kieu: "DA_CO_QUYEN" }
  /** Điều kiện chờ không còn đúng: tiền không còn đủ / dòng không còn hợp lệ / quyền bị huỷ. */
  | { readonly kieu: "KHONG_CON_HOP_LE"; readonly lyDo: string };

export interface DongChoHienCo {
  readonly trangThai: "OPEN" | "DA_XU_LY" | "HUY";
  readonly lyDo: string;
  /**
   * Dấu vân của quyết định NGƯỜI XỬ LÝ nếu dòng đang đóng do người quyết (`da-quyet.ts`); `null` = đóng bởi máy hoặc chưa đóng.
   * BẮT BUỘC (luật 7): thiếu nó thì mọi chỗ gọi tự động lại mở lại dòng người đã quyết — lỗi câm, đúng cái PR hàng đợi sinh ra để chặn.
   */
  readonly daQuyetDauVan: string | null;
}

export type HanhDongCho =
  | { readonly viec: "KHONG_LAM_GI" }
  | { readonly viec: "TAO_MOI"; readonly lyDo: string }
  | { readonly viec: "MO_LAI"; readonly lyDo: string }
  | { readonly viec: "CAP_NHAT_LY_DO"; readonly lyDo: string }
  | { readonly viec: "DONG"; readonly trangThai: "DA_XU_LY" | "HUY"; readonly lyDo: string };

export function hanhDongChoChuyenDoi(hienCo: DongChoHienCo | null, tinhHuong: TinhHuongCho): HanhDongCho {
  const dangMo = hienCo?.trangThai === "OPEN";
  switch (tinhHuong.kieu) {
    case "PHAI_CHO":
      if (!hienCo) return { viec: "TAO_MOI", lyDo: tinhHuong.lyDo };
      // Người đã quyết đúng điều kiện này (cùng dấu vân) ⇒ không mở lại. Điều kiện đổi ⇒ lyDo đổi ⇒ mở lại CHÍNH dòng này.
      if (!dangMo) return hienCo.daQuyetDauVan !== null && hienCo.daQuyetDauVan === tinhHuong.lyDo ? { viec: "KHONG_LAM_GI" } : { viec: "MO_LAI", lyDo: tinhHuong.lyDo };
      return hienCo.lyDo === tinhHuong.lyDo ? { viec: "KHONG_LAM_GI" } : { viec: "CAP_NHAT_LY_DO", lyDo: tinhHuong.lyDo };
    case "DA_CO_QUYEN":
      return dangMo ? { viec: "DONG", trangThai: "DA_XU_LY", lyDo: "Đã có học viên — quyền học đã được cấp." } : { viec: "KHONG_LAM_GI" };
    case "KHONG_CON_HOP_LE":
      return dangMo ? { viec: "DONG", trangThai: "HUY", lyDo: tinhHuong.lyDo } : { viec: "KHONG_LAM_GI" };
  }
}
