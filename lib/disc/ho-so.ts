/**
 * Hồ sơ gia đình DISC — luật THUẦN (không DB, không DOM), PRD v2.0 §Bước 2.
 *
 * Bắt buộc tối thiểu MỘT phụ huynh/người giám hộ + MỘT học sinh. Chỉ hỏi NĂM sinh
 * (không ngày/tháng). Năm sinh ↔ lớp lệch nhau thì ĐÒI XÁC NHẬN, không tự đoán tuổi.
 * Luật "trẻ nhỏ do người lớn quan sát" chép đúng ngưỡng ADR-002 của repo DISC
 * (tuổi < 8 hoặc lớp ≤ 2 hoặc mầm non) — đây là SỰ KIỆN nghiệp vụ, không phải mã DISC.
 */
import { z } from "zod";

export const VAI_TRO_PHU_HUYNH = ["BO", "ME", "NGUOI_GIAM_HO"] as const;
export type VaiTroPhuHuynh = (typeof VAI_TRO_PHU_HUYNH)[number];

/** "MN" = mầm non; còn lại là số lớp 1–12. */
export const BAC_HOC = ["MN", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
export type BacHoc = (typeof BAC_HOC)[number];

/**
 * S-09 — vệ sinh tên (dữ liệu của trẻ em, đi tiếp vào Lead.parentName · thông báo cho Sale · email · PDF). THUẦN.
 *  · NFC (cùng một chữ có dấu chỉ có một dạng lưu);
 *  · ký tự điều khiển (\p{Cc}: xuống dòng, tab…) và dấu phân tách dòng/đoạn (U+2028/2029) → khoảng trắng;
 *  · ký tự ĐỊNH DẠNG (\p{Cf}: bidi override U+202A–202E / U+2066–2069, LRM/RLM, zero-width U+200B–200D · U+2060 · U+FEFF, soft hyphen)
 *    và vùng dùng riêng (\p{Co}) → BỎ HẲN;
 *  · gộp mọi dãy khoảng trắng thành một dấu cách, cắt hai đầu.
 * Không chặn emoji ở đây (không gây lỗi bảo mật); nếu glyph làm PDF lỗi thì route tải rơi về HTML.
 */
export function chuanHoaTen(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/[\p{Cf}\p{Co}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Tên trông như liên kết/địa chỉ liên lạc (http(s):, "://", www., tên miền phổ biến, "@") — không phải tên người. */
const MAU_LIEN_KET = /(?:https?|ftp|file|javascript|data):|:\/\/|www\.|[\p{L}\p{N}-]\.(?:com|net|org|vn|info|xyz|io|me|co|link|top|site|online|club|click|biz|app|ly|gl)(?![\p{L}\p{N}])|@/iu;
export function tenCoLienKet(ten: string): boolean {
  return MAU_LIEN_KET.test(ten);
}

const TEN = z
  .string()
  .transform(chuanHoaTen)
  .pipe(
    z
      .string()
      .min(2, "Vui lòng nhập họ và tên")
      .max(80, "Tên quá dài")
      .refine((t) => !tenCoLienKet(t), "Tên không được chứa liên kết hoặc địa chỉ liên lạc"),
  );

export const phuHuynhSchema = z.object({
  hoTen: TEN,
  vaiTro: z.enum(VAI_TRO_PHU_HUYNH),
  namSinh: z.number().int(),
});

export const hocSinhSchema = z.object({
  hoTen: TEN,
  namSinh: z.number().int(),
  bacHoc: z.enum(BAC_HOC),
});

export type PhuHuynh = z.infer<typeof phuHuynhSchema>;
export type HocSinh = z.infer<typeof hocSinhSchema>;

export type CanhBao = { truong: string; ma: "NAM_SINH_LECH_LOP"; thongBao: string };

export type KetQuaHoSo =
  /** `phuHuynh`/`hocSinh` = dữ liệu ĐÃ parse + trim — nơi gọi dùng chúng, KHÔNG ép kiểu lại object thô của client. */
  | { ok: true; canhBao: CanhBao[]; nguoiLonQuanSatHocSinh: boolean; phuHuynh: PhuHuynh; hocSinh: HocSinh }
  | { ok: false; thieu: Array<"PHU_HUYNH" | "HOC_SINH">; loi: Array<{ truong: string; thongBao: string }> };

/** Năm sinh hợp lý để vào hồ sơ. Ngoài khoảng ⇒ lỗi cứng (gõ nhầm), không phải cảnh báo. */
const NAM_SINH_PH = (namNay: number) => ({ min: namNay - 90, max: namNay - 16 });
const NAM_SINH_HS = (namNay: number) => ({ min: namNay - 20, max: namNay - 2 });

/** Năm sinh dự kiến của bậc `bac` tại năm `namNay` (xấp xỉ theo năm dương lịch). Mầm non ≈ 4 tuổi. */
export function namSinhDuKien(bac: BacHoc, namNay: number): number {
  return bac === "MN" ? namNay - 4 : namNay - (5 + Number(bac));
}

/** Bé nhỏ: do người lớn quan sát và trả lời hộ. Không bắt trẻ nhỏ tự đánh giá. */
export function nguoiLonQuanSat(hs: Pick<HocSinh, "bacHoc" | "namSinh">, namNay: number): boolean {
  if (hs.bacHoc === "MN") return true;
  if (Number(hs.bacHoc) <= 2) return true;
  return namNay - hs.namSinh < 8;
}

export function kiemTraHoSo(input: { phuHuynh?: unknown; hocSinh?: unknown }, namNay: number): KetQuaHoSo {
  const thieu: Array<"PHU_HUYNH" | "HOC_SINH"> = [];
  if (input.phuHuynh == null) thieu.push("PHU_HUYNH");
  if (input.hocSinh == null) thieu.push("HOC_SINH");
  if (thieu.length) return { ok: false, thieu, loi: [] };

  const loi: Array<{ truong: string; thongBao: string }> = [];
  const ph = phuHuynhSchema.safeParse(input.phuHuynh);
  const hs = hocSinhSchema.safeParse(input.hocSinh);
  if (!ph.success) for (const i of ph.error.issues) loi.push({ truong: `phuHuynh.${i.path.join(".")}`, thongBao: i.message });
  if (!hs.success) for (const i of hs.error.issues) loi.push({ truong: `hocSinh.${i.path.join(".")}`, thongBao: i.message });
  if (!ph.success || !hs.success) return { ok: false, thieu: [], loi };

  const rph = NAM_SINH_PH(namNay);
  if (ph.data.namSinh < rph.min || ph.data.namSinh > rph.max) {
    loi.push({ truong: "phuHuynh.namSinh", thongBao: "Năm sinh của ba/mẹ chưa hợp lý, vui lòng kiểm tra lại" });
  }
  const rhs = NAM_SINH_HS(namNay);
  if (hs.data.namSinh < rhs.min || hs.data.namSinh > rhs.max) {
    loi.push({ truong: "hocSinh.namSinh", thongBao: "Năm sinh của con chưa hợp lý, vui lòng kiểm tra lại" });
  }
  if (!loi.length && ph.data.namSinh > hs.data.namSinh - 12) {
    // Phụ huynh không thể hơn con dưới 12 tuổi: gõ nhầm năm.
    loi.push({ truong: "phuHuynh.namSinh", thongBao: "Năm sinh của ba/mẹ và của con chưa khớp, vui lòng kiểm tra lại" });
  }
  if (loi.length) return { ok: false, thieu: [], loi };

  const canhBao: CanhBao[] = [];
  if (Math.abs(namSinhDuKien(hs.data.bacHoc, namNay) - hs.data.namSinh) > 1) {
    canhBao.push({
      truong: "hocSinh.bacHoc",
      ma: "NAM_SINH_LECH_LOP",
      thongBao: "Năm sinh và lớp của con có vẻ chưa khớp. Vui lòng xác nhận lại để chọn đúng bộ câu hỏi.",
    });
  }
  return { ok: true, canhBao, nguoiLonQuanSatHocSinh: nguoiLonQuanSat(hs.data, namNay), phuHuynh: ph.data, hocSinh: hs.data };
}

/**
 * Năm hiện tại theo GIỜ VIỆT NAM (UTC+7, không DST) từ `now` được tiêm — MỘT nguồn cho kiểm hồ sơ,
 * chọn bộ đề (`/api/disc/bo-de`) và chấm khi lưu. Mỗi nơi tự lấy năm theo múi giờ máy chủ thì lệch
 * nhau suốt 7 tiếng mỗi đêm giao thừa. (Bài bắt đầu trước và lưu sau 00:00 01/01 giờ VN vẫn có thể bị
 * từ chối nếu năm sinh nằm đúng biên bậc học — hiếm, chấp nhận; client làm lại bộ đề.)
 */
export function namHienTaiVN(now: Date): number {
  return new Date(now.getTime() + 7 * 3_600_000).getUTCFullYear();
}

/**
 * Năm bắt đầu của NĂM HỌC đang diễn ra theo giờ VN: năm học chạy từ tháng 9 đến hết tháng 8 năm sau
 * (01/09/2026–31/08/2027 ⇒ 2026). Vì vậy tháng 1/2027 vẫn thuộc năm học 2026–2027, KHÔNG nhảy lớp theo năm dương lịch.
 */
export function namHocBatDauVN(now: Date): number {
  const t = new Date(now.getTime() + 7 * 3_600_000);
  return t.getUTCMonth() >= 8 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
}

/**
 * Lớp hiện tại suy từ năm sinh: trẻ vào lớp 1 năm học mà tuổi dương lịch (năm học − năm sinh) = 6.
 * Sinh 2017 ⇒ lớp 1 năm học 2023–24 ⇒ lớp 4 suốt năm học 2026–27 (kể cả tháng 1–8/2027), lớp 5 từ 09/2027.
 * Mầm non: 3–5 tuổi. Ngoài khoảng ⇒ null (để người dùng tự chọn). Trẻ học lệch lớp thì người dùng sửa tay.
 */
export function bacHocTuNamSinh(namSinh: number, now: Date): BacHoc | null {
  if (!Number.isInteger(namSinh)) return null;
  const lop = namHocBatDauVN(now) - namSinh - 5;
  if (lop >= 1 && lop <= 12) return String(lop) as BacHoc;
  if (lop >= -2 && lop <= 0) return "MN";
  return null;
}
