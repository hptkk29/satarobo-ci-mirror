// lib/hoa-hong/khieu-nai-thong-bao.ts — DỰNG nội dung thông báo của khiếu nại. THUẦN (không DB, không gửi).
//
// Nguồn: docs/source-commission/05 §3 (bảng thông báo): `hoa-hong.khieu-nai-moi:<id>` và `hoa-hong.khieu-nai-ket-qua:<id>`.
//
// ⚠️ KHÔNG SỐ TIỀN trong title/body (05 §3, PRD T5 — panel chuông mở giữa chỗ đông người): `lib/notifications/pii.ts` xếp "thông tin học phí lọt vào
// dòng xem trước" là rủi ro CHẶN PHÁT HÀNH, mà `ghiThongBaoNhanSu` chỉ `console.warn` chứ không chặn. Nên chặn ở ĐÂY: lý do quyết định là chữ HR gõ
// tay và có thể chứa "bù 80.000đ" hay một số điện thoại — nếu `kiemPii` thấy thì KHÔNG chép lý do vào thân tin, chỉ chỉ người đọc sang màn có kiểm quyền.
// Lý do khiếu nại (của người gửi) KHÔNG BAO GIỜ vào thân tin: nó có thể chứa thông tin cá nhân (05 §3).
import { kiemPii } from "@/lib/notifications/pii";

import type { KetQuaKhieuNai } from "./khieu-nai-trang-thai";

export type TinKhieuNai = { dedupeKey: string; title: string; body: string; href: string };

/** Đường mở thẳng khiếu nại (Sheet) — đường admin clean-URL, KHÔNG tiền tố `/admin`. */
export const hrefKhieuNai = (disputeId: string): string => `/nguon-hoa-hong/khieu-nai?mo=${encodeURIComponent(disputeId)}`;

const maNgan = (id: string): string => id.slice(-6).toUpperCase();

export function dungTinKhieuNaiMoi(i: { disputeId: string; ky: string; laKhoanThu: boolean }): TinKhieuNai {
  return {
    dedupeKey: `hoa-hong.khieu-nai-moi:${i.disputeId}`,
    title: "Có khiếu nại hoa hồng mới",
    body: i.laKhoanThu
      ? `Khiếu nại ${maNgan(i.disputeId)} về một khoản thu kỳ ${i.ky} đang chờ nhận xử lý.`
      : `Khiếu nại ${maNgan(i.disputeId)} về một dòng hoa hồng kỳ ${i.ky} đang chờ nhận xử lý.`,
    href: hrefKhieuNai(i.disputeId),
  };
}

const NHAN_KET_QUA_TIN: Readonly<Partial<Record<KetQuaKhieuNai, string>>> = {
  DUOC_DUYET_DIEU_CHINH_TIEN: "được duyệt — hoa hồng được điều chỉnh",
  DUOC_DUYET_DOI_NGUON: "được duyệt — nguồn của lead sẽ được sửa",
  TU_CHOI: "không được duyệt",
};

const LY_DO_TOI_DA = 160;

export function dungTinKhieuNaiKetQua(i: { disputeId: string; ketQua: KetQuaKhieuNai; lyDoQuyetDinh: string }): TinKhieuNai {
  const ketQua = NHAN_KET_QUA_TIN[i.ketQua] ?? "đã có kết quả";
  const lyDo = i.lyDoQuyetDinh.trim();
  const p = kiemPii(lyDo);
  const phanLyDo =
    lyDo.length > 0 && !p.coTien && !p.coSdt
      ? ` Lý do: ${lyDo.length > LY_DO_TOI_DA ? `${lyDo.slice(0, LY_DO_TOI_DA - 1)}…` : lyDo}`
      : " Xem lý do quyết định trong màn Khiếu nại.";
  return {
    dedupeKey: `hoa-hong.khieu-nai-ket-qua:${i.disputeId}`,
    title: "Khiếu nại hoa hồng của bạn đã có kết quả",
    body: `Khiếu nại ${maNgan(i.disputeId)} ${ketQua}.${phanLyDo}`,
    href: hrefKhieuNai(i.disputeId),
  };
}
