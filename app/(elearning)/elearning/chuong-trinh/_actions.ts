"use server";

import { defineAction } from "@/lib/actions/define";
import {
  cauHinhTaoPhieuNhuCau,
  cauHinhDuyetPhieuNhuCau,
} from "@/lib/elearning/training-need";
import { cauHinhTaoChuongTrinh } from "@/lib/elearning/program-create";
import {
  cauHinhTaoKhoa,
  cauHinhTaoChuong,
  cauHinhTaoBai,
  cauHinhSapThuTu,
  cauHinhDatBatBuoc,
  cauHinhDatTuanTu,
  cauHinhVongDoiKhoa,
  cauHinhNhanBanKhoa,
} from "@/lib/elearning/course-authoring";
import {
  cauHinhCongNhanTuongDuong,
  cauHinhDiemDanhBuoi,
} from "@/lib/elearning/equivalence";

/**
 * EL-08 — phiếu nhu cầu + chương trình đào tạo.
 *
 * ⚠️ Tệp mỏng có chủ đích: cấu hình action nằm ở `lib/elearning/*` (quy ước 10)
 * để test chạy đúng cái máy chủ chạy, không phải một bản chép sang test.
 */
export const taoPhieuNhuCauAction = defineAction(cauHinhTaoPhieuNhuCau);

export const duyetPhieuNhuCauAction = defineAction(cauHinhDuyetPhieuNhuCau);

export const taoChuongTrinhAction = defineAction(cauHinhTaoChuongTrinh);

export const taoKhoaAction = defineAction(cauHinhTaoKhoa);

export const taoChuongAction = defineAction(cauHinhTaoChuong);

export const taoBaiAction = defineAction(cauHinhTaoBai);

export const sapThuTuAction = defineAction(cauHinhSapThuTu);

export const datBatBuocAction = defineAction(cauHinhDatBatBuoc);

export const datTuanTuAction = defineAction(cauHinhDatTuanTu);

export const vongDoiKhoaAction = defineAction(cauHinhVongDoiKhoa);

export const nhanBanKhoaAction = defineAction(cauHinhNhanBanKhoa);

export const congNhanTuongDuongAction = defineAction(cauHinhCongNhanTuongDuong);

export const diemDanhBuoiAction = defineAction(cauHinhDiemDanhBuoi);
