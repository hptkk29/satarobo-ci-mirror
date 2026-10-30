// lib/parttime/chinh-sach.ts — đọc tham số chính sách thù lao Parttime (CompensationPolicyVersion.paramsJson).
//
// THUẦN — không `@/lib/db`. MỘT parser cho mọi chỗ đọc: số trong văn bản (100'/10'/90', khung ca, đơn giá,
// ngưỡng trợ giảng) KHÔNG được chép thành hằng ở nơi khác, kẻo người vận hành sửa chính sách mà một đường tính
// vẫn chạy theo số cũ (bài học trần hoa hồng, CLAUDE.md).
//
// Ngày hiệu lực là CHUỖI "YYYY-MM-DD" giờ VN — so chuỗi được vì định dạng cố định, và tránh hẳn bẫy múi giờ của
// `Date` (ClassSession.date mang giờ thật, các cột @db.Date là nửa đêm UTC).
import { z } from "zod";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "giờ phải dạng HH:mm");

export const ThamSoSrQd238 = z.object({
  loai: z.literal("SR_QD_238"),
  tiet: z.object({
    chuanBiPhut: z.number().int().min(0),
    dayPhut: z.number().int().positive(),
    chuanPhut: z.number().int().positive(),
  }),
  ca: z
    .array(z.object({ ma: z.string().min(1), tu: HHMM, den: HHMM }))
    .min(1),
  toiDaTietMoiCa: z.number().int().positive(),
  donGia: z.object({
    mainTheoRank: z.record(z.string(), z.number().int().nonnegative()),
    troGiang: z.number().int().nonnegative(),
    trucCa: z.number().int().nonnegative(),
    nuaCaTruc: z.number().int().nonnegative(),
  }),
  rankMacDinh: z.number().int().min(1).max(4),
  nguongTroGiang: z.array(z.object({ khoa: z.string().min(1), tuHocVien: z.number().int().positive() })),
});
export type ThamSoSrQd238 = z.infer<typeof ThamSoSrQd238>;

export const ThamSoLegacy = z.object({ loai: z.literal("LEGACY") });

export const ThamSoChinhSach = z.discriminatedUnion("loai", [ThamSoSrQd238, ThamSoLegacy]);
export type ThamSoChinhSach = z.infer<typeof ThamSoChinhSach>;

export type BanChinhSach = {
  id: string;
  code: string;
  /** "YYYY-MM-DD" */
  hieuLucTu: string;
  /** "YYYY-MM-DD" hoặc null = còn hiệu lực */
  hieuLucDen: string | null;
  thamSo: ThamSoChinhSach;
};

/** Đọc paramsJson — sai hình dạng thì NÉM: bộ tính tiền không được chạy trên tham số đoán. */
export function docThamSo(raw: unknown): ThamSoChinhSach {
  const r = ThamSoChinhSach.safeParse(raw);
  if (!r.success) throw new Error(`Tham số chính sách sai hình dạng: ${r.error.issues[0]?.path.join(".")} — ${r.error.issues[0]?.message}`);
  const t = r.data;
  if (t.loai === "SR_QD_238") {
    if (t.tiet.chuanBiPhut + t.tiet.dayPhut !== t.tiet.chuanPhut) {
      throw new Error(`Tham số chính sách sai: chuẩn bị ${t.tiet.chuanBiPhut}' + dạy ${t.tiet.dayPhut}' ≠ tiết ${t.tiet.chuanPhut}'`);
    }
    if (t.donGia.nuaCaTruc * 2 !== t.donGia.trucCa) {
      throw new Error(`Tham số chính sách sai: nửa ca ${t.donGia.nuaCaTruc} × 2 ≠ ca ${t.donGia.trucCa}`);
    }
    for (const r of ["1", "2", "3", "4"]) {
      if (!(r in t.donGia.mainTheoRank)) throw new Error(`Tham số chính sách thiếu đơn giá Rank ${r}`);
    }
  }
  return t;
}

/**
 * Bản chính sách áp cho NGÀY `ymd` (giờ VN). Không bản nào phủ ⇒ null (bộ tính phải dừng, không đoán).
 * Hai bản cùng phủ một ngày là cấu hình sai ⇒ NÉM, vì chọn bừa một bản là trả nhầm tiền.
 */
export function chinhSachTaiNgay(ds: readonly BanChinhSach[], ymd: string): BanChinhSach | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Ngày phải dạng YYYY-MM-DD: ${ymd}`);
  const phu = ds.filter((b) => b.hieuLucTu <= ymd && (b.hieuLucDen == null || ymd <= b.hieuLucDen));
  if (phu.length > 1) throw new Error(`Hai bản chính sách cùng hiệu lực ngày ${ymd}: ${phu.map((b) => b.code).join(", ")}`);
  return phu[0] ?? null;
}

/** "HH:mm" → phút trong ngày. */
export function phutTrongNgay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Giờ sai định dạng: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Đơn giá tiết đứng chính theo Rank (tham số chính sách). Rank ngoài 1–4 ⇒ NÉM.
 * Chỉ trả SỐ — tầng tiền (phase sau) mới nhân với số tiết đã xác nhận.
 */
export function donGiaMain(t: ThamSoSrQd238, rank: number): number {
  const v = t.donGia.mainTheoRank[String(rank)];
  if (v == null) throw new Error(`Không có đơn giá cho Rank ${rank}`);
  return v;
}
