"use server";

import { defineAction } from "@/lib/actions/define";
import {
  cauHinhCapQuyen, cauHinhDatBoCuc, cauHinhDoiTrangThaiBan, cauHinhLuuCaiDat, cauHinhLuuDanhMuc, cauHinhLuuTruKhoa, cauHinhMoBanNhap, cauHinhPhatHanh,
  cauHinhSapXepKhoa, cauHinhSuaBai, cauHinhSuaChuong, cauHinhSuaKhoa, cauHinhTaoKhoa, cauHinhThemBai, cauHinhThemChuong, cauHinhThuHoiQuyen, cauHinhTienQuyet,
  cauHinhCapChungNhanTay, cauHinhChamLaiTay, cauHinhChamTay, cauHinhDocLuotDeCham, cauHinhDocCauHoiDeSua, cauHinhLuuCauHoi, cauHinhLuuDeThi, cauHinhLuuTruCauHoi, cauHinhThuHoiChungNhan,
  cauHinhLichSuGianDoan, cauHinhQuyetBoiHoan, cauHinhCapBuLoiHeThong, cauHinhChamSanPham, cauHinhDuyetMau, cauHinhLuuKhungCham, cauHinhTaoBanMoiBoCuc, cauHinhYeuCauNopLai,
  cauHinhLichSuQuyen, cauHinhTimUngVien, cauHinhKiemTraNhapCauHoi, cauHinhNhapCauHoi, cauHinhXemTruocPhatHanh, cauHinhXoaBai, cauHinhXoaChuong, cauHinhXoaDanhMuc,
} from "@/lib/elearning-online/actions";

/**
 * E-learning ONLINE — Server Actions. Tệp CỐ Ý mỏng: cấu hình nằm ở `lib/elearning-online/actions.ts` (xem lý do ở đó).
 * ⚠️ `"use server"` chỉ được export HÀM async — `defineAction` trả về hàm async nên hợp lệ; KHÔNG `export const` giá trị khác ở đây.
 */
export const taoKhoaAction = defineAction(cauHinhTaoKhoa);
export const suaKhoaAction = defineAction(cauHinhSuaKhoa);
export const doiTrangThaiBanAction = defineAction(cauHinhDoiTrangThaiBan);
export const datTienQuyetAction = defineAction(cauHinhTienQuyet);
export const luuTruKhoaAction = defineAction(cauHinhLuuTruKhoa);
export const sapXepKhoaAction = defineAction(cauHinhSapXepKhoa);
export const luuDanhMucAction = defineAction(cauHinhLuuDanhMuc);
export const xoaDanhMucAction = defineAction(cauHinhXoaDanhMuc);

export const moBanNhapAction = defineAction(cauHinhMoBanNhap);
export const themChuongAction = defineAction(cauHinhThemChuong);
export const suaChuongAction = defineAction(cauHinhSuaChuong);
export const xoaChuongAction = defineAction(cauHinhXoaChuong);
export const themBaiAction = defineAction(cauHinhThemBai);
export const suaBaiAction = defineAction(cauHinhSuaBai);
export const xoaBaiAction = defineAction(cauHinhXoaBai);
export const datBoCucAction = defineAction(cauHinhDatBoCuc);
export const luuCaiDatAction = defineAction(cauHinhLuuCaiDat);

export const xemTruocPhatHanhAction = defineAction(cauHinhXemTruocPhatHanh);
export const phatHanhAction = defineAction(cauHinhPhatHanh);

export const capQuyenAction = defineAction(cauHinhCapQuyen);
export const thuHoiQuyenAction = defineAction(cauHinhThuHoiQuyen);
export const lichSuQuyenAction = defineAction(cauHinhLichSuQuyen);
export const timUngVienAction = defineAction(cauHinhTimUngVien);

export const luuCauHoiAction = defineAction(cauHinhLuuCauHoi);
export const docCauHoiDeSuaAction = defineAction(cauHinhDocCauHoiDeSua);
export const luuTruCauHoiAction = defineAction(cauHinhLuuTruCauHoi);
export const kiemTraNhapCauHoiAction = defineAction(cauHinhKiemTraNhapCauHoi);
export const nhapCauHoiAction = defineAction(cauHinhNhapCauHoi);
export const luuDeThiAction = defineAction(cauHinhLuuDeThi);
export const docLuotDeChamAction = defineAction(cauHinhDocLuotDeCham);
export const chamTayAction = defineAction(cauHinhChamTay);
export const chamLaiTayAction = defineAction(cauHinhChamLaiTay);
export const chamSanPhamAction = defineAction(cauHinhChamSanPham);
export const lichSuGianDoanAction = defineAction(cauHinhLichSuGianDoan);
export const quyetBoiHoanAction = defineAction(cauHinhQuyetBoiHoan);
export const capBuLoiHeThongAction = defineAction(cauHinhCapBuLoiHeThong);
export const duyetMauAction = defineAction(cauHinhDuyetMau);
export const taoBanMoiBoCucAction = defineAction(cauHinhTaoBanMoiBoCuc);
export const yeuCauNopLaiAction = defineAction(cauHinhYeuCauNopLai);
export const luuKhungChamAction = defineAction(cauHinhLuuKhungCham);
export const capChungNhanTayAction = defineAction(cauHinhCapChungNhanTay);
export const thuHoiChungNhanAction = defineAction(cauHinhThuHoiChungNhan);
