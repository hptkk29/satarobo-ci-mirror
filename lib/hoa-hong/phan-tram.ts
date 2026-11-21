// lib/hoa-hong/phan-tram.ts — Ô PHẦN TRĂM (`PercentageInput`): gõ "3" = 3%, lưu "0.03". THUẦN.
//
// Vì sao tách khỏi component: lỗi ×100 (gõ 3 mà lưu 3 = 300%, hoặc lưu 0.03 rồi hiện 0,03) không ném lỗi, không đỏ
// test nào, chỉ ra tiền sai. Nên phép đổi nằm ở MỘT hàm thuần có ca `[NHH-FE-05*]`, và component chỉ gọi nó.
//
// ⚠️ KHÔNG dùng số thực: 4,35 × 0,01 trôi ở chữ số cuối. Mọi phép đi qua SỐ NGUYÊN micro (1 = 0,0001% = 1e-6 của tỉ lệ)
// — cùng đơn vị với `tiLeSangMicro` (`tien.ts`), nên cái ô này nhận được đúng cái service nhận được, không hơn.
import { tiLeSangMicro } from "./tien";

const MICRO = BigInt(1_000_000);
const MOT_PHAN_TRAM = BigInt(10_000);

export type KetQuaDocPhanTram =
  | { kieu: "trong" }
  | { kieu: "loi"; loi: string }
  | { kieu: "ok"; /** Tỉ lệ để LƯU, vd "0.03". */ tiLe: string; /** Số người dùng gõ đã chuẩn hoá, vd "3,5". */ phanTram: string };

/** Micro → chuỗi tỉ lệ ("0.03", "1"): bỏ số 0 thừa, không bao giờ ở dạng mũ. */
export function microSangTiLe(micro: bigint): string {
  const nguyen = micro / MICRO;
  const le = (micro % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return le === "" ? nguyen.toString() : `${nguyen}.${le}`;
}

/** Micro → phần trăm đọc được ("3", "3,5"): tối đa 4 chữ số thập phân, dấu phẩy kiểu Việt. */
export function microSangPhanTram(micro: bigint): string {
  const nguyen = micro / MOT_PHAN_TRAM;
  const le = (micro % MOT_PHAN_TRAM).toString().padStart(4, "0").replace(/0+$/, "");
  return le === "" ? nguyen.toString() : `${nguyen},${le}`;
}

/**
 * Chữ người dùng gõ → tỉ lệ để lưu. Chấp nhận `3`, `3,5`, `3.5`, ` 4 % `. Không nhận dấu, số mũ, chữ số lạ.
 * Quá 4 chữ số thập phân của PHẦN TRĂM (= 6 của tỉ lệ, giới hạn `Decimal(9,6)`) bị TỪ CHỐI — làm tròn im lặng ở đây
 * là đổi tỉ lệ sau lưng người khai.
 */
export function docPhanTram(raw: string): KetQuaDocPhanTram {
  const s = raw.trim().replace(/\s*%$/, "").trim();
  if (s === "") return { kieu: "trong" };
  const m = /^(\d{1,3})(?:[.,](\d+))?$/.exec(s);
  if (!m) return { kieu: "loi", loi: "Nhập số phần trăm, ví dụ 3 hoặc 3,5." };
  const le = (m[2] ?? "").replace(/0+$/, "");
  if (le.length > 4) return { kieu: "loi", loi: "Tối đa 4 chữ số thập phân (ví dụ 3,1234)." };
  const micro = BigInt(m[1]!) * MOT_PHAN_TRAM + BigInt(le.padEnd(4, "0"));
  if (micro <= BigInt(0)) return { kieu: "loi", loi: "Tỉ lệ phải lớn hơn 0%." };
  if (micro > MICRO) return { kieu: "loi", loi: "Tỉ lệ không được quá 100%." };
  return { kieu: "ok", tiLe: microSangTiLe(micro), phanTram: microSangPhanTram(micro) };
}

/** Tỉ lệ đã lưu ("0.03" / số / Decimal.toString) → chữ cho ô phần trăm ("3"). */
export function dinhDangPhanTram(tiLe: number | string): string {
  return microSangPhanTram(tiLeSangMicro(tiLe));
}

/** Dòng in lại dưới ô: "= 0,03 trên mỗi đồng thực thu" — để người gõ thấy ngay con số sẽ được lưu. */
export function loiGiaiThichTiLe(tiLe: number | string): string {
  return `= ${microSangTiLe(tiLeSangMicro(tiLe)).replace(".", ",")} trên mỗi đồng thực thu`;
}
