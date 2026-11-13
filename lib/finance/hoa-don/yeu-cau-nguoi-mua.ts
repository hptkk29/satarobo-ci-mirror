// lib/finance/hoa-don/yeu-cau-nguoi-mua.ts — luật THUẦN của "yêu cầu thu thập thông tin người mua" (Invoice Hub đợt 2, lát S11 phần độc lập). Không DB, không đồng hồ, KHÔNG `node:crypto`.
//
// Nội dung: hạn dùng, kiểm hợp lệ dữ liệu người mua TỐI GIẢN (zod), hợp nhất Sale ↔ phụ huynh THEO Ô, luật chống đoán, quyền xử lý. Phần mật mã (token, băm, mã liên kết, dấu vân tay
// giá trị gốc) ở `yeu-cau-nguoi-mua-token.ts` — tách riêng để tệp này an toàn khi một biểu mẫu client import phần kiểm hợp lệ (chỉ kéo zod + kiểu).
//
// ⚠️ ĐÂY KHÔNG PHẢI LUẬT PHÁP. Định dạng MST / email chỉ là kiểm ĐỊNH DẠNG. Ba điểm còn MỞ (OD-11, chờ người có thẩm quyền): tính hợp lệ pháp lý của thông tin người mua,
//    thời hạn giữ dữ liệu, mặc định "người tiêu dùng" — nên mọi con số vận hành (TTL, số lần sai, số lần mở, thời hạn khoá, thời hạn giữ) là THAM SỐ BẮT BUỘC của hàm gọi,
//    không có hằng ẩn trong mã miền. Duy nhất `TTL_MAC_DINH_PHUT` (owner chốt 4 giờ) được export để lead nối vào cấu hình.
// ⚠️ [ĐẢO 02/11/2026 — chủ dự án trong chat] Trước đó «không có trường giấy tờ tuỳ thân nào ở đây». Nay form QR thu THÊM: CCCD ba/mẹ (BẮT BUỘC với cá nhân), SĐT ba/mẹ, và khối học viên
//    (tên · ngày sinh · CCCD học viên — CẢ BA TUỲ CHỌN: nhiều em chưa có CCCD). Lý do: «form thông tin đề xuất hoá đơn thiếu nhiều trường, lấy tương tự khối Người mua trên hoá đơn».
//    Bốn ô nhạy cảm (`O_NHAY_CAM`) được che ở màn nhân viên khi thiếu `orders:view-pii`. [ĐÍNH CHÍNH 03/11/2026] Trang công khai nay điền sẵn từ hồ sơ MỌI ô trừ hai ô CCCD (`O_KHONG_DIEN_SAN`)
//    — lộ link = lộ CCCD là lý do hai ô đó không bao giờ được điền sẵn.
// ⛔ Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm nhận `now`; mã miền không đọc đồng hồ.
import { z } from "zod";
import { actionCenterScope, type ActionScopeActor } from "@/lib/lms/report-card-core";
import { canonicalPhone } from "@/lib/phone";

// ─────────────────────────────────────────────────────────────────────────────
// 2. HẠN DÙNG
// ─────────────────────────────────────────────────────────────────────────────

/** Owner chốt (OD-11): QR mặc định sống 4 giờ, CẤU HÌNH ĐƯỢC. Đây là giá trị mặc định để lead nối vào cấu hình — hàm tạo yêu cầu KHÔNG tự lấy nó. */
export const TTL_MAC_DINH_PHUT = 240;
/** Trần an toàn của TTL (7 ngày). Chặn nhập nhầm đơn vị (giây/ms thành phút) tạo ra liên kết sống hàng năm. */
export const TTL_TOI_DA_PHUT = 7 * 24 * 60;


/** Hạn = now + TTL phút. TTL BẮT BUỘC, nguyên dương, ≤ `TTL_TOI_DA_PHUT`; sai ⇒ ném (nhập nhầm cấu hình không được tạo ra liên kết lạ). */
export function tinhHetHan(now: Date, ttlPhut: number): Date {
  if (!Number.isInteger(ttlPhut) || ttlPhut < 1 || ttlPhut > TTL_TOI_DA_PHUT) {
    throw new RangeError(`TTL phải là số phút nguyên trong [1, ${TTL_TOI_DA_PHUT}]`);
  }
  return new Date(now.getTime() + ttlPhut * 60_000);
}

/** Hết hạn khi `now >= hetHan` (đúng giây hạn là đã hết). */
export const daHetHan = (hetHan: Date, now: Date): boolean => now.getTime() >= hetHan.getTime();

// ─────────────────────────────────────────────────────────────────────────────
// 3. DỮ LIỆU NGƯỜI MUA TỐI GIẢN — THEO Ô
// ─────────────────────────────────────────────────────────────────────────────

/** Thứ tự CỐ ĐỊNH của các ô — hợp nhất duyệt theo thứ tự này nên kết quả tất định. */
export const O_NGUOI_MUA = ["loai", "ten", "diaChi", "email", "maSoThue", "cccd", "sdt", "tenHocVien", "ngaySinhHocVien", "cccdHocVien"] as const;
export type OKhoa = (typeof O_NGUOI_MUA)[number];
/** Ô là dữ liệu cá nhân nhạy cảm: không điền sẵn lên trang công khai, che ở màn nhân viên thiếu `orders:view-pii`. */
export const O_NHAY_CAM: readonly OKhoa[] = ["cccd", "sdt", "ngaySinhHocVien", "cccdHocVien"];
/**
 * [03/11/2026] Ô KHÔNG BAO GIỜ điền sẵn lên trang công khai: hai ô CCCD. Trang công khai nay điền sẵn từ hồ sơ (tên · địa chỉ · email · SĐT · tên + ngày sinh học viên) để phụ huynh khỏi gõ lại — chủ dự án
 * chốt; CCCD thì KHÔNG: lộ liên kết (bị chuyển tiếp, nằm trong lịch sử trình duyệt) mà trang điền sẵn CCCD là biến liên kết thành bản sao của chính CCCD. TÁCH khỏi `O_NHAY_CAM` vì tập kia còn
 * quyết định che ở màn nhân viên — thu nhỏ nó là lộ SĐT / ngày sinh cho người thiếu `orders:view-pii`.
 */
export const O_KHONG_DIEN_SAN: readonly OKhoa[] = ["cccd", "cccdHocVien"];
/** Ô CHỈ có nghĩa khi người mua là cá nhân (ba/mẹ + học viên). Doanh nghiệp: các ô này bị BỎ (không gửi lên, không lưu). */
export const O_CHI_CA_NHAN: readonly OKhoa[] = ["cccd", "sdt", "tenHocVien", "ngaySinhHocVien", "cccdHocVien"];
export const LOAI_NGUOI_MUA = ["CA_NHAN", "DOANH_NGHIEP"] as const;
export type LoaiNguoiMua = (typeof LOAI_NGUOI_MUA)[number];
export const NGUON_O = ["PHU_HUYNH", "SALE_NHAP_THAY"] as const;
export type NguonO = (typeof NGUON_O)[number];

/** Một ô: giá trị đã chuẩn hoá + AI ghi + LÚC nào (ISO, từ `now` truyền vào). */
export type ONguoiMua = { giaTri: string; nguon: NguonO; luc: string };
export type BangO = Partial<Record<OKhoa, ONguoiMua>>;
export type DauVaoO = Partial<Record<OKhoa, string | null | undefined>>;

/** Chuẩn hoá một ô: NFC, cắt trắng, gộp khoảng trắng; email chữ thường; MST bỏ khoảng trắng và gạch nối. Rỗng ⇒ "". */
export function chuanHoaO(o: OKhoa, raw: unknown): string {
  if (typeof raw !== "string") return "";
  const gon = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (o === "email") return gon.toLowerCase();
  if (o === "maSoThue" || o === "cccd" || o === "cccdHocVien" || o === "sdt") return gon.replace(/[\s.-]/g, "");
  return gon;
}

const khongKyTuDieuKhien = (s: string) => !/\p{Cc}/u.test(s);
const tenSchema = z.string().min(2, "Tên quá ngắn").max(150, "Tên quá dài").refine(khongKyTuDieuKhien, "Tên có ký tự không hợp lệ");
const diaChiSchema = z.string().min(5, "Địa chỉ quá ngắn").max(250, "Địa chỉ quá dài").refine(khongKyTuDieuKhien, "Địa chỉ có ký tự không hợp lệ");
const emailSchema = z.email("Email không hợp lệ").max(120, "Email quá dài");
/** ĐỊNH DẠNG, không phải luật pháp: 10 chữ số, hoặc 13 chữ số (10 + 3 của đơn vị phụ thuộc). */
const mstSchema = z.string().regex(/^\d{10}(\d{3})?$/, "Mã số thuế gồm 10 hoặc 13 chữ số");

/** ĐỊNH DẠNG, không phải luật pháp: 12 chữ số (CCCD) hoặc 9 chữ số (CMND cũ). */
const cccdSchema = z.string().regex(/^(\d{9}|\d{12})$/, "Số CCCD gồm 12 chữ số (hoặc 9 chữ số của chứng minh thư cũ)");
/** SĐT dùng ĐÚNG luật chuẩn hoá chung của repo (`lib/phone.ts`, nguồn duy nhất) — cùng hộp thoại «Người mua trên hoá đơn», không có bản luật thứ hai. */
const sdtSchema = z.string().refine((s) => canonicalPhone(s) !== null, "Số điện thoại chưa đúng (ví dụ 0905123456)");
/** Ngày sinh yyyy-mm-dd có thật trên lịch (không có đồng hồ ở đây — luật 19; giao diện chặn ngày tương lai bằng thuộc tính `max`). */
const ngaySinhSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày sinh theo dạng năm-tháng-ngày")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return y >= 1900 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "Ngày sinh không hợp lệ");

const SCHEMA_O: Readonly<Record<OKhoa, z.ZodType<string>>> = {
  loai: z.enum(LOAI_NGUOI_MUA),
  ten: tenSchema,
  diaChi: diaChiSchema,
  email: emailSchema,
  maSoThue: mstSchema,
  cccd: cccdSchema,
  sdt: sdtSchema,
  tenHocVien: tenSchema,
  ngaySinhHocVien: ngaySinhSchema,
  cccdHocVien: cccdSchema,
};

export type KetQuaKiemO = { ok: true; giaTri: string } | { ok: false; loi: string };
/** Kiểm MỘT ô đã có giá trị (chuẩn hoá trước). Ô rỗng không phải lỗi ở đây — người gọi bỏ ô rỗng trước. */
export function kiemODon(o: OKhoa, raw: unknown): KetQuaKiemO {
  const v = chuanHoaO(o, raw);
  const r = SCHEMA_O[o].safeParse(v);
  return r.success ? { ok: true, giaTri: v } : { ok: false, loi: r.error.issues[0]?.message ?? "Giá trị không hợp lệ" };
}

// Cá nhân (người mua = ba/mẹ): BẮT BUỘC tên ba/mẹ · CCCD ba/mẹ · địa chỉ; tuỳ chọn email, SĐT, khối học viên (tên · ngày sinh · CCCD).
const nguoiMuaCaNhan = z.strictObject({
  loai: z.literal("CA_NHAN"),
  ten: tenSchema,
  diaChi: diaChiSchema,
  cccd: cccdSchema,
  email: emailSchema.optional(),
  sdt: sdtSchema.optional(),
  tenHocVien: tenSchema.optional(),
  ngaySinhHocVien: ngaySinhSchema.optional(),
  cccdHocVien: cccdSchema.optional(),
});
// Doanh nghiệp: BẮT BUỘC tên đơn vị · MST · email nhận hoá đơn · địa chỉ.
const nguoiMuaDoanhNghiep = z.strictObject({ loai: z.literal("DOANH_NGHIEP"), ten: tenSchema, diaChi: diaChiSchema, email: emailSchema, maSoThue: mstSchema });
/** Người mua. MST CHỈ có và BẮT BUỘC khi DOANH_NGHIEP; CCCD ba/mẹ CHỈ có và BẮT BUỘC khi CA_NHAN (strict: ô của loại kia mà có ⇒ không hợp lệ). */
export const nguoiMuaToiGianSchema = z.discriminatedUnion("loai", [nguoiMuaCaNhan, nguoiMuaDoanhNghiep]);

export type NguoiMuaToiGian = {
  loai: LoaiNguoiMua;
  ten: string;
  diaChi: string;
  email: string | null;
  maSoThue: string | null;
  cccd: string | null;
  sdt: string | null;
  tenHocVien: string | null;
  ngaySinhHocVien: string | null;
  cccdHocVien: string | null;
};
export type KetQuaKiemDayDu = { ok: true; nguoiMua: NguoiMuaToiGian } | { ok: false; thieu: OKhoa[]; sai: OKhoa[] };

/**
 * Kiểm cả bộ ô đã hợp nhất có ĐỦ để chốt không. Cá nhân: bỏ qua MST nếu lỡ có (loại quyết định MST có nghĩa hay không). Doanh nghiệp: MST bắt buộc.
 * Trả `thieu` (ô bắt buộc chưa có) tách khỏi `sai` (có nhưng sai định dạng), theo thứ tự `O_NGUOI_MUA`.
 */
export function kiemBoDayDu(bang: BangO): KetQuaKiemDayDu {
  const gia = (o: OKhoa): string => chuanHoaO(o, bang[o]?.giaTri);
  const loai = gia("loai");
  if (loai === "") return { ok: false, thieu: ["loai"], sai: [] };
  if (!(LOAI_NGUOI_MUA as readonly string[]).includes(loai)) return { ok: false, thieu: [], sai: ["loai"] };
  const obj: Record<string, string> = { loai };
  for (const o of ["ten", "diaChi", "email"] as const) if (gia(o) !== "") obj[o] = gia(o);
  if (loai === "DOANH_NGHIEP" && gia("maSoThue") !== "") obj.maSoThue = gia("maSoThue");
  // Ô của CÁ NHÂN (CCCD, SĐT, khối học viên): doanh nghiệp lỡ có thì BỎ (loại quyết định ô nào có nghĩa).
  if (loai === "CA_NHAN") for (const o of O_CHI_CA_NHAN) if (gia(o) !== "") obj[o] = gia(o);
  const r = nguoiMuaToiGianSchema.safeParse(obj);
  if (r.success) {
    const d = r.data;
    const caNhan = d.loai === "CA_NHAN" ? d : null;
    return {
      ok: true,
      nguoiMua: {
        loai: d.loai,
        ten: d.ten,
        diaChi: d.diaChi,
        email: d.email ?? null,
        maSoThue: d.loai === "DOANH_NGHIEP" ? d.maSoThue : null,
        cccd: caNhan ? caNhan.cccd : null,
        sdt: caNhan?.sdt ?? null,
        tenHocVien: caNhan?.tenHocVien ?? null,
        ngaySinhHocVien: caNhan?.ngaySinhHocVien ?? null,
        cccdHocVien: caNhan?.cccdHocVien ?? null,
      },
    };
  }
  const thieu = new Set<OKhoa>();
  const sai = new Set<OKhoa>();
  for (const is of r.error.issues) {
    const k = is.path[0];
    if (typeof k !== "string" || !(O_NGUOI_MUA as readonly string[]).includes(k)) continue;
    (obj[k] === undefined ? thieu : sai).add(k as OKhoa);
  }
  return { ok: false, thieu: O_NGUOI_MUA.filter((o) => thieu.has(o)), sai: O_NGUOI_MUA.filter((o) => sai.has(o)) };
}

// ── Dạng LƯU trong cột `duLieuGui` (Json) ───────────────────────────────────

export type DuLieuLuu = { phienBan: 1; o: BangO };
const oLuuSchema = z.object({ giaTri: z.string(), nguon: z.enum(NGUON_O), luc: z.string() });
const duLieuLuuSchema = z.object({ phienBan: z.literal(1), o: z.partialRecord(z.enum(O_NGUOI_MUA), oLuuSchema) });

/** Đọc lại cột Json một cách phòng thủ: hỏng / null / lạ ⇒ bảng rỗng (không ném — dữ liệu sửa tay không được làm sập đường công khai). */
export function docDuLieuLuu(json: unknown): BangO {
  const r = duLieuLuuSchema.safeParse(json);
  return r.success ? (r.data.o as BangO) : {};
}
export const dungDuLieuLuu = (o: BangO): DuLieuLuu => ({ phienBan: 1, o });

// ─────────────────────────────────────────────────────────────────────────────
// 4. HỢP NHẤT SALE ↔ PHỤ HUYNH THEO Ô
// ─────────────────────────────────────────────────────────────────────────────

export type OXungDot = {
  o: OKhoa;
  /** Nguồn có giá trị được GIỮ — luôn là nguồn GHI SAU. */
  thang: NguonO;
  /** Nguồn có giá trị bị ghi đè. */
  thua: NguonO;
};
export type KetQuaHopNhat = { ketQua: BangO; oXungDot: OXungDot[]; oDaDoi: OKhoa[] };

/**
 * Hợp nhất `moi` vào `hienTai` THEO Ô, tất định (duyệt theo `O_NGUOI_MUA`, không đọc đồng hồ ngoài `now`). Ô rỗng trong `moi` = "không cung cấp" ⇒ bỏ qua, KHÔNG xoá gì.
 *
 * ⚠️ [ĐẢO 03/11/2026 — chủ dự án: «ai ghi sau thì thắng, lỡ PH ghi sai và nhờ sale sửa thì sửa được»] TRƯỚC ĐÂY phụ huynh luôn thắng Sale ở ô tranh chấp. NAY AI GHI SAU THẮNG,
 * bất kể nguồn: PH gửi lại thì đè ô Sale đã sửa; Sale nhập thay thì đè ô PH đã điền. Khác giá trị VÀ khác nguồn ⇒ ghi nhận xung đột (`thang` = nguồn ghi sau) để nhật ký nói được ô nào bị đè.
 * Ô nhận lại đúng giá trị cũ từ cùng nguồn không tính là đổi (không đổi `luc`). Cùng giá trị nhưng khác nguồn ⇒ ô chuyển sang nguồn mới (tính là đổi, KHÔNG phải xung đột).
 * Đầu vào `moi` PHẢI đã qua `kiemODon`; hàm chuẩn hoá lại để so sánh nhưng không kiểm định dạng.
 */
export function hopNhatTheoO(hienTai: BangO, moi: DauVaoO, nguonMoi: NguonO, now: Date): KetQuaHopNhat {
  const luc = now.toISOString();
  const ketQua: BangO = { ...hienTai };
  const oXungDot: OXungDot[] = [];
  const oDaDoi: OKhoa[] = [];
  for (const o of O_NGUOI_MUA) {
    const gia = chuanHoaO(o, moi[o]);
    if (gia === "") continue;
    const cu = hienTai[o];
    const cuCoGiaTri = cu !== undefined && cu.giaTri !== "";
    if (cuCoGiaTri && cu.giaTri === gia && cu.nguon === nguonMoi) continue; // không đổi gì
    if (cuCoGiaTri && cu.giaTri !== gia && cu.nguon !== nguonMoi) oXungDot.push({ o, thang: nguonMoi, thua: cu.nguon });
    ketQua[o] = { giaTri: gia, nguon: nguonMoi, luc };
    oDaDoi.push(o);
  }
  return { ketQua, oXungDot, oDaDoi };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CHỐNG ĐOÁN (khoá cứng ở DB — rate-limit Upstash là fail-open)
// ─────────────────────────────────────────────────────────────────────────────

export type GioiHanChongDoan = {
  /** Số lần gửi sai token tối đa trước khi khoá. */
  toiDaSaiToken: number;
  /** Số lần MỞ thành công tối đa của một liên kết. */
  toiDaLanMo: number;
  /** Khoá bao lâu (phút) khi vượt `toiDaSaiToken`. */
  khoaPhut: number;
};

/** Cả ba số BẮT BUỘC nguyên dương — cấu hình hỏng (0, âm, NaN) ném thay vì trở thành "không bao giờ khoá" hoặc "luôn khoá". */
export function kiemGioiHan(g: GioiHanChongDoan): GioiHanChongDoan {
  for (const [k, v] of Object.entries(g)) {
    if (!Number.isInteger(v) || v < 1) throw new RangeError(`Giới hạn chống đoán "${k}" phải là số nguyên dương`);
  }
  return g;
}

export type TrangThaiYeuCau = "DANG_MO" | "DA_GUI" | "DA_AP_DUNG" | "TU_CHOI" | "HET_HAN" | "THU_HOI";

/**
 * Sau một lần gửi SAI token vào yêu cầu: có tăng bộ đếm không, và có khoá không.
 *  · Đang khoá (`khoaDen > now`) ⇒ KHÔNG đếm thêm, KHÔNG gia hạn khoá (kẻ đoán không kéo dài khoá của người thật bằng cách gõ tiếp).
 *  · Ngoài khoá: đếm +1; đạt ngưỡng ⇒ khoá tới `now + khoaPhut`.
 */
export function sauTokenSai(
  tt: { soLanSai: number; khoaDen: Date | null },
  now: Date,
  g: GioiHanChongDoan,
): { tang: boolean; soLanSaiMoi: number; khoaDenMoi: Date | null } {
  kiemGioiHan(g);
  if (tt.khoaDen !== null && tt.khoaDen.getTime() > now.getTime()) return { tang: false, soLanSaiMoi: tt.soLanSai, khoaDenMoi: tt.khoaDen };
  const moi = tt.soLanSai + 1;
  return { tang: true, soLanSaiMoi: moi, khoaDenMoi: moi >= g.toiDaSaiToken ? new Date(now.getTime() + g.khoaPhut * 60_000) : null };
}

export type QuyetDinhMo = "CHO_MO" | "DA_DONG" | "HET_HAN" | "KHOA" | "VUOT_SO_LAN_MO";

/** Token ĐÚNG — liên kết có cho mở / gửi không. Thứ tự: đã đóng → hết hạn → đang khoá → vượt số lần mở. */
export function quyetDinhMo(
  tt: { trangThai: string; hetHanLuc: Date; khoaDen: Date | null; soLanMo: number },
  now: Date,
  g: GioiHanChongDoan,
  /** Gửi dữ liệu không tính vào số lần MỞ nhưng vẫn phải qua mọi cổng khác. */
  dem: "MO" | "GUI",
): QuyetDinhMo {
  kiemGioiHan(g);
  if (tt.trangThai !== "DANG_MO") return "DA_DONG";
  if (daHetHan(tt.hetHanLuc, now)) return "HET_HAN";
  if (tt.khoaDen !== null && tt.khoaDen.getTime() > now.getTime()) return "KHOA";
  if (dem === "MO" && tt.soLanMo >= g.toiDaLanMo) return "VUOT_SO_LAN_MO";
  return "CHO_MO";
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. QUYỀN XỬ LÝ YÊU CẦU (nhân viên) — qua `permissions` của Actor, không so vai
// ─────────────────────────────────────────────────────────────────────────────

const giao = (a: "ALL" | string[], b: "ALL" | string[]): "ALL" | string[] => (a === "ALL" ? b : b === "ALL" ? a : a.filter((c) => b.includes(c)));
const hop = (a: "ALL" | string[], b: "ALL" | string[]): "ALL" | string[] => (a === "ALL" || b === "ALL" ? "ALL" : [...new Set([...a, ...b])]);

/**
 * Tập cơ sở người này được tạo / nhập thay / xác nhận / huỷ yêu cầu người mua: kế toán (`payments:confirm`) HOẶC sale ghi thu (`payments:record` ∧ `orders:view-pii`).
 * Hai quyền của sale phải CÙNG phủ một cơ sở (giao tập), rồi hợp với tập của kế toán. `[]` ⇒ không ở đâu (fail-closed).
 */
export function phamViXuLyYeuCau(actor: ActionScopeActor): "ALL" | string[] {
  const keToan = actionCenterScope(actor, "payments:confirm");
  const sale = giao(actionCenterScope(actor, "payments:record"), actionCenterScope(actor, "orders:view-pii"));
  return hop(keToan, sale);
}

export function duocXuLyYeuCau(actor: ActionScopeActor, centerId: string | null): boolean {
  if (!centerId) return false;
  const tap = phamViXuLyYeuCau(actor);
  return tap === "ALL" || tap.includes(centerId);
}
