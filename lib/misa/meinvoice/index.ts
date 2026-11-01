// lib/misa/meinvoice/index.ts — lối vào DUY NHẤT để lấy cổng phát hành hoá đơn MISA meInvoice.
//
//   const cong = congHoaDonTuEnv();   // null ⇒ cổng TẮT (off / thiếu biến / cấu hình sai)
//
// Hợp đồng ở `./cong.ts`. Màn Cấu hình/Tích hợp đọc `moTaCauHinhMisa()` — chỉ TÊN biến, không giá trị.

import type { CongHoaDon } from "./cong";
import { docCauHinhMisa, type CheDoMisa, type EnvMisa } from "./cau-hinh";
import { taoCongGiaLap } from "./gia-lap";
import { taoCongHsm, type FetchLike } from "./http";

export type { CongHoaDon } from "./cong";

export function congHoaDonTuEnv(
  env: EnvMisa = process.env,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): CongHoaDon | null {
  const { cauHinh } = docCauHinhMisa(env);
  if (!cauHinh) return null;
  if (cauHinh.cheDo === "gia-lap") return taoCongGiaLap();
  return taoCongHsm({ cauHinh, fetchImpl });
}

export type MoTaCauHinhMisa = {
  /** Chế độ ĐANG CÓ HIỆU LỰC ("off" khi khai bật mà thiếu/sai biến). */
  cheDo: CheDoMisa;
  /** Chế độ người vận hành khai. */
  cheDoKhai: CheDoMisa;
  moiTruong: CongHoaDon["moiTruong"] | null;
  /** TÊN biến thiếu. */
  thieu: string[];
  /** Câu lỗi cấu hình (không chứa giá trị secret). */
  loi: string | null;
};

export function moTaCauHinhMisa(env: EnvMisa = process.env): MoTaCauHinhMisa {
  const { cheDoKhai, cauHinh, thieu, loi } = docCauHinhMisa(env);
  const cheDo: CheDoMisa = cauHinh ? cauHinh.cheDo : "off";
  return { cheDo, cheDoKhai, moiTruong: cheDo === "off" ? null : cheDo, thieu, loi };
}
