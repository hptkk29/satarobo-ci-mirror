/**
 * NẠP NGÂN HÀNG MỞ RỘNG — cửa duy nhất để phần còn lại đọc câu của ngân hàng.
 *
 * Sinh một lần mỗi tiến trình (hàm thuần, tất định) rồi giữ trong bộ nhớ. Không đọc file:
 * nguồn sự thật là nguyên liệu trong `khung.ts` · `boi-canh.ts` · `mau-hanh-vi.ts`, và
 * `checksum.json` khoá nó lại (test `[NH-07]`).
 *
 * 🔴 KHOÁ CHẤM: câu ở đây mang `truc` và `dao`. Không một trường nào trong số đó được đi ra
 * trình duyệt — xem `deChoKhach()` ở `boc-de.ts`.
 */

import { THU_TU } from "@/lib/disc/engine-goc/config/disc-thu-tu";
import { type MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import { sinhNganHang, type CauNganHang } from "./sinh";

type BoNho = {
  readonly tatCa: readonly CauNganHang[];
  readonly theoMa: ReadonlyMap<string, CauNganHang>;
  /** `${boDe}|${oKhung}` → các câu thay được cho ô đó, theo thứ tự sinh. */
  readonly theoO: ReadonlyMap<string, readonly CauNganHang[]>;
};

let boNho: BoNho | null = null;

export function napNganHang(): BoNho {
  if (boNho) return boNho;
  const tatCa = sinhNganHang();
  const theoMa = new Map<string, CauNganHang>();
  const theoO = new Map<string, CauNganHang[]>();
  for (const c of tatCa) {
    if (theoMa.has(c.ma)) throw new Error(`Ngân hàng trùng mã câu: ${c.ma}`);
    theoMa.set(c.ma, c);
    const k = `${c.boDe}|${c.oKhung}`;
    const ds = theoO.get(k);
    if (ds) ds.push(c);
    else theoO.set(k, [c]);
  }
  boNho = { tatCa, theoMa, theoO };
  return boNho;
}

/** Các ô khung của một bộ đề, ĐÚNG thứ tự hiển thị của đề gốc. */
export function oKhungCua(boDe: MaBoDe): readonly string[] {
  return THU_TU[boDe];
}

export function cauThayChoO(boDe: MaBoDe, oKhung: string): readonly CauNganHang[] {
  return napNganHang().theoO.get(`${boDe}|${oKhung}`) ?? [];
}

export function timCauNganHang(ma: string): CauNganHang | undefined {
  return napNganHang().theoMa.get(ma);
}
