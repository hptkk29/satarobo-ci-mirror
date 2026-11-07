// lib/vin-hoadon/index.ts — lối vào DUY NHẤT để lấy cổng phát hành hoá đơn VIN-HOADON.
//
//   const cong = congHoaDonVinTuEnv();   // null ⇒ cổng TẮT (off / thiếu biến / cấu hình sai)
//
// Hợp đồng cổng dùng chung với MISA (`CongHoaDon`, lib/misa/meinvoice/cong.ts). Màn Cấu hình/Tích hợp đọc
// `moTaCauHinhVin()` — chỉ TÊN biến, không giá trị. Chưa được nối vào luồng phát hành: việc đó là bước sau
// (registry theo pháp nhân + OD-06), và không được làm trước khi chủ dự án cấp sandbox VIN.

import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { docCauHinhVin, type CheDoVin, type EnvVin } from "./cau-hinh";
import { taoCongVin, type FetchLike } from "./http";

export type { CongHoaDon } from "@/lib/misa/meinvoice/cong";

export function congHoaDonVinTuEnv(
  env: EnvVin = process.env,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): CongHoaDon | null {
  const { cauHinh } = docCauHinhVin(env);
  if (!cauHinh) return null;
  return taoCongVin({ cauHinh, fetchImpl });
}

export type MoTaCauHinhVin = {
  /** Chế độ ĐANG CÓ HIỆU LỰC ("off" khi khai bật mà thiếu/sai biến). */
  cheDo: CheDoVin;
  /** Chế độ người vận hành khai. */
  cheDoKhai: CheDoVin;
  /** TÊN biến thiếu. */
  thieu: string[];
  /** Câu lỗi cấu hình (không chứa giá trị secret). */
  loi: string | null;
};

export function moTaCauHinhVin(env: EnvVin = process.env): MoTaCauHinhVin {
  const { cheDoKhai, cauHinh, thieu, loi } = docCauHinhVin(env);
  return { cheDo: cauHinh ? cauHinh.cheDo : "off", cheDoKhai, thieu, loi };
}
