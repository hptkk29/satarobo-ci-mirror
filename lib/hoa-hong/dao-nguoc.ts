// lib/hoa-hong/dao-nguoc.ts — ĐẢO hoa hồng khi một khoản bị HOÀN / điều chỉnh giảm (A3, L8). THUẦN.
//
// Nguồn: docs/source-commission/04 §11.1. Ví dụ bắt buộc (V1): thu 10.000.000, Sale 3% = 300.000; hoàn 4.000.000 ⇒ −120.000;
// hoàn tiếp 6.000.000 ⇒ đảo sạch −180.000, tổng về đúng 0.
//
// ĐẢO THEO DÒNG GỐC, KHÔNG THEO BÚT TOÁN HOÀN: `refundPayment`/`adjustPayment` KHÔNG chép `orderItemId` sang bút toán mới, nên
// khớp theo `orderItemId` của R làm hoàn tiền không thu hồi hoa hồng. Nhóm đảo = MỌI ô của gốc G.
//
// MỘT CÔNG THỨC cho mọi kiểu tính — tỉ lệ TIỀN CỦA CHÍNH DÒNG trên cơ sở còn lại, KHÔNG nhân lại `rate` của cả vai:
//   coSoDao_o ≥ coSoConLai(o)  ⇒  dao_p = −rong_p                              (đảo sạch, không lệch 1đ)
//   ngược lại                  ⇒  dao_p = −min( round(rong_p × coSoDao_o / coSoConLai(o)), rong_p )
// Vì sao không nhân `rate`: dòng sổ là "một vai × một người", tiền vai đã chia đều cho n người, còn `rate` là tỉ lệ của CẢ
// vai ⇒ 2 QC mỗi người 50.000, hoàn 4/10 ⇒ nhân rate cho −80.000 (gấp đôi); công thức này cho −40.000 (V3, Nhật ký #3).
//
// Người, rate, version, vai CHÉP từ dòng của ô — kể cả khi người đó đã nghỉ (đòi lại tiền của người đã nhận).
import { tachVat } from "./tien";
import type { KhoaNguoi } from "./khoa-so";
import type { TrangThaiO } from "./o-tinh";

export type OCuaGoc = {
  o: TrangThaiO;
  /** (vai × người) → id dòng gốc (dòng đầu tiên của người đó trong ô) — để dòng đảo tham chiếu `refEntryId`. */
  dongGoc: ReadonlyMap<KhoaNguoi, string>;
};

export type DongDao = { key: KhoaNguoi; amount: number; refEntryId: string };

export type KetQuaDao = {
  /** Cơ sở bị hoàn, đã bỏ VAT bằng `vatRate` CỦA DÒNG GỐC. */
  coSoDao: number;
  theoO: { calcSlotId: string; coSoDao: number; dong: DongDao[] }[];
};

/** `round(a × b / c)` bằng số nguyên (nửa lên), `a,b ≥ 0`, `c > 0`. */
function nhanChiaLamTron(a: number, b: number, c: number): number {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  return Number((num * BigInt(2) + den) / (BigInt(2) * den));
}

/** Chia `tong` theo trọng số `w` (Hamilton), Σ = tong; trọng số ≤ 0 nhận 0; tất cả 0 ⇒ chia đều. */
function chiaTheoTrongSo(tong: number, w: readonly number[]): number[] {
  const n = w.length;
  if (n === 0) return [];
  if (n === 1) return [tong];
  const wn = w.map((x) => Math.max(0, Math.round(x)));
  const mau = wn.reduce((a, b) => a + b, 0);
  const trong = mau === 0 ? wn.map(() => 1) : wn;
  const tm = mau === 0 ? n : mau;
  const san = trong.map((x) => Math.floor((tong * x) / tm));
  const du = trong.map((x) => (tong * x) % tm);
  let con = tong - san.reduce((a, b) => a + b, 0);
  const thuTu = du.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  const ra = san.slice();
  for (let k = 0; k < thuTu.length && con > 0; k++, con--) ra[thuTu[k]!.i]! += 1;
  return ra;
}

export function tinhDaoNguoc(input: {
  /** |amount| của bút toán âm R (VND > 0). */
  absAmountAm: number;
  /** `vatRate` chụp trên dòng gốc — KHÔNG tra lại hôm nay (V6). */
  vatRateGoc: number;
  nhomO: readonly OCuaGoc[];
}): KetQuaDao {
  if (!Number.isInteger(input.absAmountAm) || input.absAmountAm <= 0) throw new Error(`Số tiền hoàn không hợp lệ: ${input.absAmountAm}`);
  const coSoDao = tachVat(input.absAmountAm, input.vatRateGoc).netBase;
  const cacO = [...input.nhomO].sort((a, b) => (a.o.calcSlotId < b.o.calcSlotId ? -1 : 1));
  const phanBo = chiaTheoTrongSo(
    coSoDao,
    cacO.map((x) => x.o.coSoConLai),
  );

  const theoO = cacO.map(({ o, dongGoc }, i) => {
    const daoO = phanBo[i]!;
    const dong: DongDao[] = [];
    for (const [key, rong] of [...o.rong.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (rong <= 0) continue; // đã đảo hết / sửa nguồn đã rút về 0 ⇒ không đòi thêm
      const ref = dongGoc.get(key);
      if (!ref) throw new Error(`Ô ${o.calcSlotId}: người ${key} có số ròng ${rong} nhưng không có dòng gốc để tham chiếu.`);
      const conLai = o.coSoConLai;
      const du = daoO >= conLai ? rong : Math.min(nhanChiaLamTron(rong, daoO, conLai), rong);
      if (du > 0) dong.push({ key, amount: -du, refEntryId: ref });
    }
    return { calcSlotId: o.calcSlotId, coSoDao: daoO, dong };
  });
  return { coSoDao, theoO };
}
