// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/han-test-lai.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * HẠN TEST LẠI (28.6) — hàm thuần, không đọc đồng hồ (nhận `bayGio` từ ngoài).
 *
 * Mỗi người có một hạn = ngày bản hợp lệ gần nhất + `THANG_NHAC_LAI` tháng. Cả nhà lấy hạn
 * SỚM NHẤT, kèm danh sách người đã đến hạn — để khung nhắc nói được "ai nên làm lại".
 *
 * 🔴 Cộng THÁNG theo lịch, không cộng 183 ngày: 31/08 + 6 tháng là 28/02 (hoặc 29/02), không
 * phải 03/03. Ngày không tồn tại ở tháng đích thì lùi về ngày cuối tháng.
 *
 * 🔴 Không có bản hợp lệ nào ⇒ `null`. Không bịa một hạn cho người chưa làm bài.
 */

import { THANG_NHAC_LAI } from "@/lib/disc/engine-goc/config/disc-nguong";

export type HanMotNguoi = {
  readonly id: string;
  readonly ten: string;
  /** `yyyy-mm-dd`, theo ngày của máy. */
  readonly ngayDen: string;
  /** Số ngày còn lại; ÂM nghĩa là đã quá hạn bấy nhiêu ngày; 0 là đúng hôm nay. */
  readonly conNgay: number;
  readonly denHan: boolean;
};

export type HanCaNha = {
  /** Hạn sớm nhất trong nhà. */
  readonly som: HanMotNguoi;
  readonly tatCa: readonly HanMotNguoi[];
  /** Những người đã đến hạn (kể cả hôm nay). */
  readonly nguoiDenHan: readonly HanMotNguoi[];
};

const hai = (n: number) => String(n).padStart(2, "0");
const ngayChuoi = (d: Date) => `${d.getFullYear()}-${hai(d.getMonth() + 1)}-${hai(d.getDate())}`;
const dauNgay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Cộng `thang` tháng theo lịch; ngày không có ở tháng đích thì lùi về ngày cuối tháng. */
export function congThang(goc: Date, thang: number): Date {
  const ngay = goc.getDate();
  const ra = new Date(goc.getFullYear(), goc.getMonth() + thang, 1);
  const cuoiThang = new Date(ra.getFullYear(), ra.getMonth() + 1, 0).getDate();
  ra.setDate(Math.min(ngay, cuoiThang));
  return ra;
}

export function hanCuaMotNguoi(
  nguoi: { readonly id: string; readonly ten: string },
  ganNhatIso: string | undefined,
  bayGio: Date,
  thang: number = THANG_NHAC_LAI,
): HanMotNguoi | null {
  if (!ganNhatIso) return null;
  const luc = new Date(ganNhatIso);
  if (Number.isNaN(luc.getTime())) return null;
  const den = dauNgay(congThang(luc, thang));
  const conNgay = Math.round((den.getTime() - dauNgay(bayGio).getTime()) / 86_400_000);
  return { id: nguoi.id, ten: nguoi.ten, ngayDen: ngayChuoi(den), conNgay, denHan: conNgay <= 0 };
}

export function hanCaNha(
  ds: readonly { readonly id: string; readonly ten: string; readonly ganNhat?: string }[],
  bayGio: Date,
  thang: number = THANG_NHAC_LAI,
): HanCaNha | null {
  const tatCa = ds
    .map((n) => hanCuaMotNguoi(n, n.ganNhat, bayGio, thang))
    .filter((h): h is HanMotNguoi => h !== null)
    .sort((a, b) => a.ngayDen.localeCompare(b.ngayDen) || a.id.localeCompare(b.id));
  if (tatCa.length === 0) return null;
  return { som: tatCa[0], tatCa, nguoiDenHan: tatCa.filter((h) => h.denHan) };
}
