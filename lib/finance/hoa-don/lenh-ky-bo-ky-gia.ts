// lib/finance/hoa-don/lenh-ky-bo-ky-gia.ts — BỘ KÝ GIẢ, CHỈ DÙNG TRONG TEST. Không ký, không mạng, không đồng hồ, không PIN/khoá.
// Ba kịch bản: thành công / từ chối / ném. Đếm số lần gọi và ghi hash đã nhận để test kiểm "chỉ hash đi qua".

import { laHashHopLe, type BoKy, type KetQuaKy } from "./lenh-ky-bo-ky";

export type KichBanKyGia = "THANH_CONG" | "TU_CHOI" | "NEM";

export type BoKyGia = BoKy & { readonly soLanGoi: number; readonly cacHashDaNhan: readonly string[] };

export function taoBoKyGia(
  kichBan: KichBanKyGia,
  opts: {
    /** Dấu nhận dạng nhét vào thông điệp lỗi được NÉM — test khẳng định nó không lọt ra bảng / audit / giá trị trả về. */
    dauThongDiepNem?: string;
    /** Cờ năng lực của bộ giả; mặc định "đã nối" để kịch bản chạy được. */
    nangLuc?: BoKy["nangLuc"];
  } = {},
): BoKyGia {
  let soLanGoi = 0;
  const cacHashDaNhan: string[] = [];
  return {
    nangLuc: opts.nangLuc ?? { providerSupports: "CO", adapterImplements: true, ghiChu: "[R] bộ ký GIẢ cho test — không nối nhà ký thật" },
    get soLanGoi() {
      return soLanGoi;
    },
    get cacHashDaNhan() {
      return cacHashDaNhan;
    },
    async ky(duLieuCanKyHash: string): Promise<KetQuaKy> {
      soLanGoi += 1;
      if (!laHashHopLe(duLieuCanKyHash)) throw new Error("Bộ ký giả chỉ nhận hash SHA-256.");
      cacHashDaNhan.push(duLieuCanKyHash);
      if (kichBan === "NEM") throw new Error(`Lỗi nội bộ của bộ ký giả ${opts.dauThongDiepNem ?? ""}`.trim());
      if (kichBan === "TU_CHOI") return { ok: false, ma: "TU_CHOI", thongDiepNgan: `Từ chối ${opts.dauThongDiepNem ?? ""}`.trim() };
      return { ok: true, maGiaoDich: `GD-GIA-${soLanGoi}`, chungThuHetHan: "2027-11-02" };
    },
  };
}
