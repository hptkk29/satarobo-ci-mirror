// lib/hoa-hong/tien.ts — TIỀN của hoa hồng: tỉ lệ, trần, làm tròn, chia người, VAT.
//
// Nguồn: docs/source-commission/04 §4.2 (VAT), §8 (trần), §9.1 (làm tròn). THUẦN — không DB, không đồng hồ.
//
// ⚠️ TỈ LỆ LÀ SỐ NGUYÊN "MICRO" (1 = 0,0001%): `rate` là `Decimal(9,6)` trong DB, tối đa 6 chữ số thập phân.
// So trần trên số thực (`0.04 + 0.01 + … <= 0.09`) trôi ở chữ số thứ 17 và buộc phải dùng "epsilon" — thứ mà
// 04 §8 cấm ("không dung sai epsilon"). Quy mọi tỉ lệ về số nguyên micro (BigInt) rồi cộng và so BẰNG SỐ
// NGUYÊN thì 9% đúng bằng 9%, 9,0001% đúng là vượt.
//
// ⚠️ TRẦN SO TRÊN TỈ LỆ, KHÔNG SO TRÊN TIỀN ĐÃ LÀM TRÒN: mỗi vai `Math.round` riêng nên Σ tiền có thể lệch
// vài đồng so với 9% × cơ sở dù Σ tỉ lệ đúng bằng trần (ca `[NHH-POL-04b]`: 111.111đ vs 111.109,5đ).
//
// ⚠️ `tranTongTiLe` là tham số BẮT BUỘC (luật 7). Không có mặc định "0.09" ở đây — chỗ gọi chạm DB phải
// `getSetting("crm.commissionMaxTotalRate")` rồi TRUYỀN vào (lưới `[NHH-W3]`).
import { z } from "zod";

import { chiaDeuTien } from "@/lib/crm/commission";

const MICRO = BigInt(1000000);

/**
 * Tỉ lệ → số nguyên micro (1 = 0,0001%). Nhận số hoặc chuỗi Decimal. Quá 6 chữ số thập phân ⇒ ném
 * (Decimal(9,6) không chứa được; làm tròn im lặng ở đây là đổi tỉ lệ sau lưng người khai).
 */
export function tiLeSangMicro(tiLe: number | string): bigint {
  const s = typeof tiLe === "number" ? tiLe.toString() : tiLe.trim();
  if (typeof tiLe === "number" && !Number.isFinite(tiLe)) throw new Error(`Tỉ lệ không hợp lệ: ${tiLe}`);
  // `toString()` của số nhỏ có thể ra dạng mũ ("1e-7"): chuyển qua toFixed để đọc chữ số thập phân.
  const dang = typeof tiLe === "number" && /e/i.test(s) ? tiLe.toFixed(12) : s;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(dang);
  if (!m) throw new Error(`Tỉ lệ không hợp lệ: "${s}"`);
  const [, dau, nguyen, le = ""] = m;
  const leCat = le.replace(/0+$/, "");
  if (leCat.length > 6) throw new Error(`Tỉ lệ có quá 6 chữ số thập phân: "${s}"`);
  const micro = BigInt(nguyen!) * MICRO + BigInt(leCat.padEnd(6, "0"));
  return dau === "-" ? -micro : micro;
}

/** Làm tròn tiền đối xứng quanh 0 (nửa ra xa 0): dòng đảo luôn đúng bằng âm dòng gốc. */
export function lamTronTien(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`Số tiền không hợp lệ: ${x}`);
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r; // tránh -0
}

/**
 * `PERCENT`: `round(coSo × tỉ lệ)` — làm tròn MỘT lần ở mức vai (04 §9.1), nửa lên, bằng số nguyên.
 * Cơ sở âm bị từ chối: dòng đảo tính theo dòng gốc (04 §11), không đi qua hàm này.
 */
export function tienPhanTram(coSo: number, tiLe: number | string): number {
  if (!Number.isInteger(coSo) || coSo < 0) throw new Error(`Cơ sở tính không hợp lệ: ${coSo}`);
  const micro = tiLeSangMicro(tiLe);
  if (micro < BigInt(0)) throw new Error(`Tỉ lệ âm: ${tiLe}`);
  return Number((BigInt(coSo) * micro + MICRO / BigInt(2)) / MICRO);
}

/**
 * Chia tiền MỘT vai cho nhiều người rồi TÁCH phần của người bị loại (nghỉ việc…): phần ấy TREO, KHÔNG
 * chia lại cho người còn lại (D13: người nghỉ không sinh dòng — nhưng cũng không làm người khác ăn thêm).
 * Σ `duocChi` + Σ `treo` = `tongVai` — đủ để đối soát. Chia theo `chiaDeuTien` (tất định theo id).
 */
export function chiaTienChoVai(
  tongVai: number,
  nguoiHuong: readonly string[],
  biLoai: ReadonlySet<string>,
): {
  cacPhan: { recipientId: string; amount: number }[];
  duocChi: { recipientId: string; amount: number }[];
  treo: { recipientId: string; amount: number }[];
} {
  const cacPhan = chiaDeuTien(tongVai, nguoiHuong);
  return {
    cacPhan,
    duocChi: cacPhan.filter((p) => !biLoai.has(p.recipientId)),
    treo: cacPhan.filter((p) => biLoai.has(p.recipientId)),
  };
}

// ── Trần (04 §8) ────────────────────────────────────────────────────────────

export type QuyTacTheoVai = { roleCode: string } & (
  | { kieuTinh: "PERCENT"; rate: number | string }
  | { kieuTinh: "FIXED_PER_PURCHASE"; fixed: number }
);

export type KetQuaKiemTran =
  | { ok: true; tiLeTuongDuong: number }
  | { ok: false; tiLeTuongDuong: number; tran: number };

/**
 * Σ tỉ lệ tương đương của các rule THẮNG (mỗi vai một rule, TRƯỚC lọc tư cách — kể cả vai treo) so với trần.
 *
 *   tiLeTuongDuong = Σ rate(PERCENT) + Σ fixed ÷ coSo
 *
 * So `≤ trần` bằng SỐ NGUYÊN (nhân chéo, BigInt): `Σ rateMicro·coSo + Σ fixed·1e6 ≤ tranMicro·coSo`. Không
 * epsilon. Cơ sở ≤ 0 mà còn khoản cố định ⇒ không có tỉ lệ để so ⇒ chặn (fail-closed). Vượt ⇒ người gọi ghi 0
 * dòng cho khoản đó + hàng chờ `CAP_EXCEEDED`; KHÔNG tự cắt vai nào (D1, PRD).
 */
export function kiemTran(input: {
  coSo: number;
  quyTacTheoVai: readonly QuyTacTheoVai[];
  /** BẮT BUỘC — `getSetting("crm.commissionMaxTotalRate")`. */
  tranTongTiLe: number | string;
}): KetQuaKiemTran {
  const { coSo, quyTacTheoVai, tranTongTiLe } = input;
  if (tranTongTiLe === undefined || tranTongTiLe === null) throw new Error("Thiếu trần tổng tỉ lệ hoa hồng");
  const tranMicro = tiLeSangMicro(tranTongTiLe);
  if (tranMicro < BigInt(0)) throw new Error(`Trần tổng tỉ lệ không hợp lệ: ${tranTongTiLe}`);
  if (!Number.isInteger(coSo) || coSo < 0) throw new Error(`Cơ sở tính không hợp lệ: ${coSo}`);

  let sumRateMicro = BigInt(0);
  let sumFixed = BigInt(0);
  for (const q of quyTacTheoVai) {
    if (q.kieuTinh === "PERCENT") {
      const m = tiLeSangMicro(q.rate);
      if (m < BigInt(0)) throw new Error(`Tỉ lệ âm ở vai ${q.roleCode}`);
      sumRateMicro += m;
    } else {
      if (!Number.isInteger(q.fixed) || q.fixed < 0) throw new Error(`Số tiền cố định không hợp lệ ở vai ${q.roleCode}`);
      sumFixed += BigInt(q.fixed);
    }
  }
  const tran = Number(tranMicro) / 1e6;
  const tuongDuong = (): number => {
    if (coSo === 0) return sumFixed > BigInt(0) ? Number.POSITIVE_INFINITY : Number(sumRateMicro) / 1e6;
    return (Number(sumRateMicro) + (Number(sumFixed) * 1e6) / coSo) / 1e6;
  };
  const co = BigInt(coSo);
  // coSo = 0: chỉ còn so Σ rate; có khoản cố định ⇒ vượt (không chia được).
  const vuot = coSo === 0 ? sumFixed > BigInt(0) || sumRateMicro > tranMicro : sumRateMicro * co + sumFixed * MICRO > tranMicro * co;
  return vuot ? { ok: false, tiLeTuongDuong: tuongDuong(), tran } : { ok: true, tiLeTuongDuong: tuongDuong() };
}

// ── VAT (04 §4.2, D15) ──────────────────────────────────────────────────────

/** `hoaHong.vatTheoNgay`: `{ tuNgay: "YYYY-MM-DD"; tiLe }[]` tăng dần, `0 ≤ tiLe < 1`. Rỗng ⇒ 0. */
export const vatTheoNgaySchema = z
  .array(z.object({ tuNgay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tiLe: z.number().min(0).lt(1) }))
  .refine((a) => a.every((m, i) => i === 0 || a[i - 1]!.tuNgay < m.tuNgay), { message: "Các mốc VAT phải tăng dần theo ngày" });

export type MucVat = z.infer<typeof vatTheoNgaySchema>[number];

/**
 * VAT hiệu lực tại NGÀY GỐC của tiền (`rateDate`, ngày VN). Rỗng ⇒ 0 — mặc định cho tới khi kế toán chốt
 * (D15). Bảng sai hình dạng bị TỪ CHỐI chứ không đoán.
 */
export function vatHieuLuc(bang: readonly MucVat[], ngayGoc: string): number {
  const ok = vatTheoNgaySchema.safeParse(bang);
  if (!ok.success) throw new Error(`Bảng VAT theo ngày không hợp lệ: ${ok.error.issues[0]?.message ?? "sai hình dạng"}`);
  let ra = 0;
  for (const m of bang) if (m.tuNgay <= ngayGoc) ra = m.tiLe;
  return ra;
}

/** Ảnh chụp `gross / vatRate / net` trên MỖI dòng sổ. `net = round(gross ÷ (1 + vat))`, đối xứng quanh 0. */
export function tachVat(
  gross: number,
  vatRate: number,
): { grossAmount: number; vatRate: number; netBase: number } {
  if (!Number.isInteger(gross)) throw new Error(`Số tiền gộp không hợp lệ: ${gross}`);
  if (!(vatRate >= 0 && vatRate < 1)) throw new Error(`VAT không hợp lệ: ${vatRate}`);
  return { grossAmount: gross, vatRate, netBase: vatRate === 0 ? gross : lamTronTien(gross / (1 + vatRate)) };
}
