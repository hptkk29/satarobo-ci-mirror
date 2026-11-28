import { createHash } from "node:crypto";

import type { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { layKhoaDisc } from "@/lib/disc/phone-key";
import { isDiscEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { dePhatRaTuVe } from "@/lib/disc/so-gia-dinh/bai-lam";
import { nhanTuKieu } from "@/lib/disc/so-gia-dinh/chi-so";
import { cachLamKhaDung, tuoiTuNamSinh } from "@/lib/disc/so-gia-dinh/dinh-tuyen-bai";
import { baiTuHang, docHoatDongDaKiem, docKeHoachDangChay, docPhanTichMoiNhat, laySoCuaChu, type KeHoachDaLuu } from "@/lib/disc/so-gia-dinh/doc";
import {
  camOnViec,
  luuCheckin,
  luuNhap,
  luuThanhVien,
  nopBaiSo,
  phatDeCho,
  taoKeHoach,
  taoSo,
  tickViec,
  xoaBaiLam,
  xoaThanhVien,
  type DeDangLam,
  type KetQuaNopBaiSo,
  type Loi,
  type MaLoi,
} from "@/lib/disc/so-gia-dinh/ghi";
import { hoSoCaNha } from "@/lib/disc/so-gia-dinh/ho-so-dang-dung";
import type { KyKeHoach } from "@/lib/disc/so-gia-dinh/ke-hoach";
import { ngayVN } from "@/lib/disc/so-gia-dinh/kieu";
import { dungLichSu, dungManCaNhan, dungManGiaDinh, dungManTheCap, dungManThanhVien, dungTheThanhVien } from "@/lib/disc/so-gia-dinh/man-hinh";
import { dungManKeHoach, type TabKeHoach } from "@/lib/disc/so-gia-dinh/man-hinh-ke-hoach";
import { hocVienChuaNoi, napMan, soHocVienCua } from "@/lib/disc/so-gia-dinh/nap-man";
import { laTreEm } from "@/lib/disc/so-gia-dinh/vai";
import {
  SO_THANH_VIEN_TOI_DA_SO,
  checkinSchema,
  luuNhapSchema,
  nopBaiSchema,
  phatDeSchema,
  pinSchema,
  taoKeHoachSchema,
  taoSoSchema,
  thanhVienSchema,
  xoaThanhVienSchema,
} from "@/lib/disc/so-gia-dinh/validators";

import { traLoi } from "../cong";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";
import { datHoacDoiPin, docTrangThaiPin, khoaLai, kiemQuyen, moKhoa, vaoCheDoTreEm, type BoiCanhDisc, type YeuCauQuyen } from "@/lib/disc/so-gia-dinh/mo-khoa";

/**
 * DISC trên app (P-Disc*) — lớp MỎNG trên miền «SỔ GIA ĐÌNH DISC» của cổng phụ huynh web (`lib/disc/so-gia-dinh/*`). KHÔNG có engine chấm thứ hai, KHÔNG bảng mới, KHÔNG câu hỏi/điểm/phân loại tự dựng:
 * mọi con số + chữ ở các màn (Gia đình · Cá nhân · Thẻ cặp · Kế hoạch · Thành viên) là do chính các hàm `dungMan*` của web dựng; mọi phép ghi đi qua chính `ghi.ts` của web.
 *
 * ⚠️ MÔ HÌNH SỞ HỮU KHÁC CÁC ROUTE CÒN LẠI: DISC thuộc về SỔ của PHỤ HUYNH (`DiscGiaDinh.ownerUserId` = `userId` từ PHIÊN), KHÔNG thuộc về học viên. Thành viên của sổ (kể cả người lớn) có id RIÊNG (`DiscThanhVien.id`),
 * học viên chỉ là liên kết tuỳ chọn (`studentId`, domain tự kiểm `Student.parentUserId = userId`). Vì vậy route nằm dưới `/parent/disc/**` — không có `/students/:id/disc`.
 * Mọi id nhận từ client (thành viên / bài / việc / kế hoạch) được domain tra KÈM id sổ của người gọi: id lạ ≡ id của sổ người khác ≡ không tồn tại ⇒ cùng một `404`.
 *
 * Chế độ học sinh (H-S3): đường dẫn `/parent/disc/**` KHÔNG khớp `^/students/…` nên `kiemCheDoHocSinh` MẶC ĐỊNH TỪ CHỐI (403) — không sửa danh sách cho phép (xem `disc.test.ts` [MDISC-SM]).
 * Dữ liệu cá nhân của TRẺ: không log câu trả lời / tên / năm sinh ở bất kỳ nhánh lỗi nào; lỗi không lường trước đi qua `traLoi` (không lộ chi tiết).
 */

// ───────────────────────── Cổng cờ ─────────────────────────

/**
 * Cờ `DISC_ENABLED` (mặc định TẮT) — gọi ở DÒNG ĐẦU của MỌI route, TRƯỚC cổng đăng nhập/đọc thân. Khác `parent/income` (kiểm trong dịch vụ, sau xác thực): ở đó thân sai + cờ tắt ⇒ 400 lộ ra rằng
 * tính năng tồn tại; ở đây cờ tắt ⇒ 404 cho mọi yêu cầu, kể cả chưa đăng nhập / thân rác (khớp web: cờ tắt ⇒ 404 trước khi chạm phiên).
 */
export function chanNeuDiscTat(): NextResponse | null {
  return isDiscEnabled() ? null : traLoi(new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy."));
}

// ───────────────────────── Ánh xạ lỗi miền → HTTP ─────────────────────────

type MaApi = ConstructorParameters<typeof LoiApiMobile>[0];
type DongLoi = { readonly code: MaApi; readonly status: number; readonly maChiTiet?: string };

/** `Record<MaLoi, …>`: thêm mã lỗi mới ở `ghi.ts` mà quên ánh xạ ⇒ LỖI BIÊN DỊCH (không rơi về 500 câm). Chỉ dùng mã đã có của `LoiApiMobile` (không sửa tệp đó). */
export const ANH_XA_LOI: Readonly<Record<MaLoi, DongLoi>> = {
  KHONG_CO_SO: { code: "NOT_FOUND", status: 404 },
  KHONG_TIM_THAY: { code: "NOT_FOUND", status: 404 },
  HOC_VIEN_KHONG_THUOC_TAI_KHOAN: { code: "NOT_FOUND", status: 404 },
  DU_LIEU_KHONG_HOP_LE: { code: "VALIDATION", status: 400 },
  NGAY_KHONG_HOP_LE: { code: "VALIDATION", status: 400 },
  NOP_BAI_LOI: { code: "VALIDATION", status: 400 },
  VE_DA_DUNG: { code: "LUOT_DA_NOP", status: 409 },
  DA_CO_SO: { code: "VALIDATION", status: 409, maChiTiet: "SO_DA_TON_TAI" },
  DAY_THANH_VIEN: { code: "VALIDATION", status: 409, maChiTiet: "SO_DAY_THANH_VIEN" },
  KHONG_XOA_DUOC_CHU_SO: { code: "VALIDATION", status: 409, maChiTiet: "KHONG_XOA_CHU_SO" },
  HOC_VIEN_DA_NOI: { code: "VALIDATION", status: 409, maChiTiet: "HOC_VIEN_DA_NOI" },
  KHONG_TICK_DUOC: { code: "VALIDATION", status: 409, maChiTiet: "KHONG_DANH_DAU_DUOC" },
  CHUA_DAT_PIN: { code: "VALIDATION", status: 409, maChiTiet: "CHUA_DAT_PIN" },
  KHONG_CO_BO_DE: { code: "DE_CHUA_HO_TRO", status: 409 },
  QUA_NHIEU_BAI: { code: "HET_LUOT", status: 409 },
  NHAP_KHONG_KHOP: { code: "NOI_DUNG_DA_DOI", status: 409 },
  CHUA_DU_NGUOI: { code: "CHUA_MO", status: 409 },
  KE_HOACH_CHUA_MO: { code: "CHUA_MO", status: 409 },
  PIN_SAI: { code: "FORBIDDEN", status: 403, maChiTiet: "DISC_PIN_SAI" },
  PIN_BI_KHOA: { code: "RATE_LIMITED", status: 429, maChiTiet: "DISC_PIN_BI_KHOA" },
  // V8.31 — PIN ÉP Ở MÁY CHỦ: `code` giữ trong tập B đã biết (FORBIDDEN/VALIDATION/RATE_LIMITED/SERVER/PASSWORD_INCORRECT), trạng thái mới nằm ở `maChiTiet`.
  DISC_CHUA_MO_KHOA: { code: "FORBIDDEN", status: 403, maChiTiet: "DISC_CHUA_MO_KHOA" },
  DISC_PHIEN_HET_HAN: { code: "FORBIDDEN", status: 403, maChiTiet: "DISC_PHIEN_HET_HAN" },
  DISC_PHIEN_THU_HOI: { code: "FORBIDDEN", status: 403, maChiTiet: "DISC_PHIEN_THU_HOI" },
  DISC_KHONG_DU_QUYEN: { code: "FORBIDDEN", status: 403, maChiTiet: "DISC_KHONG_DU_QUYEN" },
  CAN_PIN_CU_HOAC_MAT_KHAU: { code: "VALIDATION", status: 400, maChiTiet: "CAN_PIN_CU_HOAC_MAT_KHAU" },
  DISC_PIN_XUNG_DOT: { code: "VALIDATION", status: 409, maChiTiet: "DISC_PIN_XUNG_DOT" },
  MAT_KHAU_SAI: { code: "PASSWORD_INCORRECT", status: 400, maChiTiet: "DISC_MAT_KHAU_SAI" },
  MAT_KHAU_BI_KHOA: { code: "RATE_LIMITED", status: 429, maChiTiet: "DISC_MAT_KHAU_BI_KHOA" },
  DISC_LOI_HE_THONG: { code: "SERVER", status: 503, maChiTiet: "DISC_LOI_HE_THONG" },
  DISC_CAN_CAP_NHAT_APP: { code: "FORBIDDEN", status: 403, maChiTiet: "DISC_CAN_CAP_NHAT_APP" },
};

const KHOA_PIN_GIAY = 15 * 60;

/** Ngữ cảnh cho guard — CHỈ lấy từ phiên đã xác thực (`nguoi`), không từ thân/header do client khai. */
const boiCanh = (nguoi: NguoiGoi): BoiCanhDisc => ({ userId: nguoi.userId, kenh: "MOBILE", phienDangNhapId: nguoi.sessionId, tokenWeb: null, hocSinhId: nguoi.hocSinhId, phienBanApp: nguoi.phienBanApp ?? null });

/**
 * V8.31 — CỔNG BẢO VỆ DUY NHẤT của mọi dịch vụ DISC nhạy cảm ở Mobile: gọi `kiemQuyen` (cờ TẮT ⇒ cho qua). Chữ ký các hàm dịch vụ nhận `nguoi` (không phải `userId` trần) nên route nào quên truyền
 * phiên là LỖI BIÊN DỊCH; lưới `[PINE-SRC]` quét thư mục route để bảo đảm mọi route đi qua hàm này hoặc nằm trong danh sách bootstrap.
 */
export async function baoVeDisc(nguoi: NguoiGoi, yc: YeuCauQuyen): Promise<void> {
  const k = await kiemQuyen(boiCanh(nguoi), yc);
  if (!k.ok) throw loiTuMien(k);
}

export function loiTuMien(l: Pick<Loi, "loi" | "thongBao">): LoiApiMobile {
  const d = ANH_XA_LOI[l.loi];
  return new LoiApiMobile(d.code, d.status, l.thongBao, l.loi === "PIN_BI_KHOA" || l.loi === "MAT_KHAU_BI_KHOA" ? KHOA_PIN_GIAY : l.loi === "DISC_LOI_HE_THONG" ? 30 : undefined, d.maChiTiet);
}

/** `{ok:true}&T` → T; `{ok:false}` → ném `LoiApiMobile` (route bắt bằng `traLoi`). */
function lay<T extends object>(r: ({ readonly ok: true } & T) | Loi): T {
  if (!r.ok) throw loiTuMien(r);
  const { ok: _bo, ...con } = r;
  return con as unknown as T;
}

const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

// ───────────────────────── Giới hạn tần suất ─────────────────────────

const GIOI_HAN = {
  doc: { max: 120, windowMs: 10 * 60_000 },
  batDau: { max: 30, windowMs: 10 * 60_000 },
  luuNhap: { max: 240, windowMs: 10 * 60_000 },
  nop: { max: 20, windowMs: 10 * 60_000 },
  ghi: { max: 60, windowMs: 10 * 60_000 },
} as const;

async function gioiHan(loai: keyof typeof GIOI_HAN, userId: string): Promise<void> {
  const c = GIOI_HAN[loai];
  const rl = await rateLimit({ key: `m-disc:${loai}:${userId}`, max: c.max, windowMs: c.windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));
}

// ───────────────────────── Bỏ liên kết web khỏi view-model ─────────────────────────

/** Đích điều hướng ĐỌC từ liên kết web của VM (`/portal/disc?muc=the-cap&a=…&b=…`) — app tự điều hướng bằng id, không cầm đường dẫn web. */
export type DichDen = { man: string; nguoi?: string; cach?: string; a?: string; b?: string; ky?: string };

export function hrefSangDich(href: string): DichDen | null {
  let u: URL;
  try {
    u = new URL(href, "https://goc.invalid");
  } catch {
    return null;
  }
  // Chỉ liên kết TƯƠNG ĐỐI của chính web này (`/portal/disc…`): URL tuyệt đối sang nơi khác không bao giờ thành «đích».
  if (u.origin !== "https://goc.invalid" || (u.pathname !== "/portal/disc" && !u.pathname.startsWith("/portal/disc/"))) return null;
  const phu = u.pathname.slice("/portal/disc".length).replace(/^\//, "");
  const man = phu === "lam-bai" ? "lam-bai" : (u.searchParams.get("muc") ?? "gia-dinh");
  const ra: DichDen = { man };
  for (const k of ["nguoi", "cach", "a", "b", "ky"] as const) {
    const v = u.searchParams.get(k);
    if (v) ra[k] = v;
  }
  return ra;
}

const laDoiTuongThuan = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/** Duyệt sâu: khoá `href` / `daoChieuHref` (liên kết `/portal/disc…` của web) ⇒ `dich` / `daoChieuDich` (đối tượng có id). Phần còn lại giữ NGUYÊN (không sao chép VM theo từng trường). */
export function boLienKetWeb(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(boLienKetWeb);
  if (!laDoiTuongThuan(x)) return x;
  const ra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    if ((k === "href" || k === "daoChieuHref") && (typeof v === "string" || v === null)) ra[k === "href" ? "dich" : "daoChieuDich"] = typeof v === "string" ? hrefSangDich(v) : null;
    else ra[k] = boLienKetWeb(v);
  }
  // V8.29 — MỌI view-model có cặp `ten` + `chu` (thành viên, thẻ cặp, kế hoạch…) ra chữ viết tắt không bắt đầu bằng dấu câu (cùng luật `chuVietTatApp`).
  if (typeof ra.ten === "string" && typeof ra.chu === "string") ra.chu = chuVietTatApp(ra.ten);
  return ra;
}

// ───────────────────────── Lược đồ (CHẶT: khoá lạ ⇒ 400) ─────────────────────────

const idChuoi = z.string().trim().min(1).max(64);
const SO_CAU_TOI_DA = 400; // cùng trần `TRAN_DOC_BAI`: một đề không bao giờ dài hơn

/** Dùng LẠI lược đồ của web (ngưỡng/độ dài không gõ lại) + `.strict()`: khoá lạ bị từ chối thay vì bị gỡ im lặng. */
export const taoSoBody = taoSoSchema.strict();
export const thanhVienBody = thanhVienSchema.strict();
export const phatDeBody = phatDeSchema.strict();
export const luuNhapBody = luuNhapSchema.strict().refine((d) => Object.keys(d.traLoi).length <= SO_CAU_TOI_DA, { message: "Quá nhiều câu trả lời." });
export const nopBaiBody = nopBaiSchema.strict().refine((d) => Object.keys(d.traLoi).length <= SO_CAU_TOI_DA, { message: "Quá nhiều câu trả lời." });
export const taoKeHoachBody = taoKeHoachSchema.strict();
/** Lồng nhau cũng CHẶT: phần tử của `diem` (điểm hoà thuận 1–5 từng người) không được mang khoá lạ. */
export const checkinBody = z.strictObject({
  keHoachId: checkinSchema.shape.keHoachId,
  tuan: checkinSchema.shape.tuan,
  diem: z.array(checkinSchema.shape.diem.element.strict()).min(1).max(SO_THANH_VIEN_TOI_DA_SO),
  capDeChiu: checkinSchema.shape.capDeChiu,
});
export const pinBody = pinSchema.strict();
export const xoaThanhVienBody = z.strictObject({ cheDo: xoaThanhVienSchema.shape.cheDo });
/** `viecSchema` của web nhận `viecId` trong thân; ở app id nằm trên đường dẫn ⇒ thân rỗng chặt. */
export const thanRong = z.strictObject({});

const SO_NGUYEN = z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(400));
export const keHoachQuery = z.strictObject({
  tab: z.enum(["NGAY_7", "THANG_1", "NAM_1", "HOAT_DONG", "CHECKIN"]).optional(),
  ngay: SO_NGUYEN.optional(),
  tuan: SO_NGUYEN.optional(),
  plan: z.enum(["NGAY_7", "THANG_1", "NAM_1"] satisfies KyKeHoach[]).optional(),
});
export type KeHoachQuery = z.infer<typeof keHoachQuery>;
export const theCapQuery = z.strictObject({ a: idChuoi.optional(), b: idChuoi.optional() });
export type TheCapQuery = z.infer<typeof theCapQuery>;

export function idHopLe(v: unknown): string {
  const p = idChuoi.safeParse(v);
  if (!p.success) throw khongThay();
  return p.data;
}

// ───────────────────────── ĐỌC ─────────────────────────

export type TongQuanDiscDto =
  | { coSo: false; soHocVienGoiY: number }
  | { coSo: true; tenGiaDinh: string; soThanhVien: number; coPin: boolean; capNhatKeHoach: boolean; manGiaDinh: unknown };

/** P-Disc (tab «Gia đình»): chưa có sổ ⇒ `{ coSo:false }` (app hiện màn lập sổ); có sổ ⇒ view-model `dungManGiaDinh`. */
export async function docTongQuan(nguoi: NguoiGoi, now: Date = new Date()): Promise<TongQuanDiscDto> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "DOC" });
  await gioiHan("doc", userId);
  const nap = await napMan(userId, now);
  if (!nap) return { coSo: false, soHocVienGoiY: await soHocVienCua(userId) };
  return {
    coSo: true,
    tenGiaDinh: nap.so.ten,
    soThanhVien: nap.so.thanhVien.length,
    coPin: nap.so.coPin,
    capNhatKeHoach: nap.capNhatKeHoach && !!nap.pt,
    manGiaDinh: boLienKetWeb(dungManGiaDinh(nap.dv)),
  };
}

async function napHoacKhongThay(userId: string, now: Date) {
  const nap = await napMan(userId, now);
  if (!nap) throw new LoiApiMobile("NOT_FOUND", 404, "Chưa có sổ gia đình.");
  return nap;
}

/** P-Disc-gia-dinh («Thành viên và quyền xem»): danh sách + bộ đề khả dụng + quan hệ từng cặp + học viên chưa nối. */
export async function docThanhVien(nguoi: NguoiGoi, now: Date = new Date()): Promise<{ manThanhVien: unknown }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "DOC" });
  await gioiHan("doc", userId);
  const { so, dv } = await napHoacKhongThay(userId, now);
  const chua = await hocVienChuaNoi(userId, so.thanhVien.map((t) => t.studentId));
  return { manThanhVien: boLienKetWeb(dungManThanhVien(dv, so.ten, chua, so.coPin, laTreEm, SO_THANH_VIEN_TOI_DA_SO)) };
}

export type NguoiLamBaiDto = {
  id: string;
  ten: string;
  studentId: string | null;
  chu: string;
  phu: string;
  nhanTrangThai: string;
  chinh: string | null;
  tuLam: { duoc: true; boDe: string } | { duoc: false; lyDo: string };
  gocNhin: { duoc: true; boDe: string } | { duoc: false; lyDo: string };
  coNhap: boolean;
  lichSu: unknown;
};

/** P-Disc-chon: mỗi người của sổ + hai cách làm (tự làm / góc nhìn của ba mẹ) có dùng được không (kèm lý do) + còn bản nháp không + lịch sử các lần làm. */
export async function docLuaChonLamBai(nguoi: NguoiGoi, now: Date = new Date()): Promise<{ tenGiaDinh: string; coPin: boolean; chuSoId: string | null; nguoi: NguoiLamBaiDto[] }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "DOC" });
  await gioiHan("doc", userId);
  const { so, dv } = await napHoacKhongThay(userId, now);
  const { the } = dungTheThanhVien(dv);
  const namNay = Number(ngayVN(now).slice(0, 4));
  const dsNguoi = so.thanhVien.map((tv, i): NguoiLamBaiDto => {
    const k = cachLamKhaDung({ vaiTro: tv.vaiTro, lop: tv.lop, tuoi: tuoiTuNamSinh(tv.namSinh, namNay) });
    const t = the[i]!;
    return {
      id: tv.id,
      ten: tv.ten,
      studentId: tv.studentId,
      chu: chuVietTatApp(tv.ten),
      phu: t.phu,
      nhanTrangThai: t.nhanTrangThai,
      chinh: t.chinh,
      tuLam: k.tuLam.duoc ? { duoc: true, boDe: k.tuLam.boDe } : { duoc: false, lyDo: k.tuLam.lyDo },
      gocNhin: k.gocNhin.duoc ? { duoc: true, boDe: k.gocNhin.boDe } : { duoc: false, lyDo: k.gocNhin.lyDo },
      coNhap: dv.dangNhap.has(tv.id),
      lichSu: dungLichSu(so.bai.filter((b) => b.thanhVienId === tv.id)),
    };
  });
  return { tenGiaDinh: so.ten, coPin: so.coPin, chuSoId: so.chuSoId, nguoi: dsNguoi };
}

/**
 * P-Disc-ca-nhan: báo cáo ĐẦY ĐỦ của một người (VM `dungManCaNhan`). «Bản cho con» / «Bản cho ba mẹ» là cách TRÌNH BÀY ở giao diện web (`page.tsx` truyền `ban` cho component, không cho `dungManCaNhan`) —
 * API trả đủ dữ liệu cho cả hai (`dg`, `nhanVat`, `motDong`); việc ẩn mục nào ở «bản cho con» là của app.
 * Id không thuộc sổ của người gọi ≡ chưa có báo cáo ⇒ cùng `404` (không dò được id của gia đình khác).
 */
/** Bản CÓ cổng: dành cho route. */
export async function docBaoCaoCaNhan(nguoi: NguoiGoi, memberId: string, now: Date = new Date()): Promise<{ nguoi: Array<{ id: string; ten: string; coHoSo: boolean }>; baoCao: unknown }> {
  await baoVeDisc(nguoi, { phamVi: "DOC" });
  return docBaoCaoCaNhanKhongKiem(nguoi.userId, memberId, now);
}

/** Bản KHÔNG kiểm — CHỈ gọi sau khi người gọi ĐÃ qua `baoVeDisc` (vd. Robot tính cách). */
export async function docBaoCaoCaNhanKhongKiem(userId: string, memberId: string, now: Date = new Date()): Promise<{ nguoi: Array<{ id: string; ten: string; coHoSo: boolean }>; baoCao: unknown }> {
  await gioiHan("doc", userId);
  const id = idHopLe(memberId);
  const { so, dv } = await napHoacKhongThay(userId, now);
  const hs = hoSoCaNha(so.thanhVien, so.bai);
  const tv = so.thanhVien.find((t) => t.id === id);
  if (!tv || !hs.get(id)) throw new LoiApiMobile("NOT_FOUND", 404, "Chưa có báo cáo cá nhân.");
  const vm = dungManCaNhan(dv, id);
  if (!vm) throw new LoiApiMobile("NOT_FOUND", 404, "Chưa có báo cáo cá nhân.");
  return { nguoi: so.thanhVien.map((t) => ({ id: t.id, ten: t.ten, coHoSo: !!hs.get(t.id) })), baoCao: boLienKetWeb(vm) };
}

/** P-Disc-cap («Thẻ cặp»): ma trận hai chiều + thẻ của cặp a→b (mặc định: cặp cần chú ý nhất). `a`/`b` lạ được domain bỏ qua (chọn lại mặc định) — không lộ id. */
export async function docTheCap(nguoi: NguoiGoi, q: TheCapQuery, now: Date = new Date()): Promise<{ theCap: unknown }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "DOC" });
  await gioiHan("doc", userId);
  const { dv } = await napHoacKhongThay(userId, now);
  return { theCap: boLienKetWeb(dungManTheCap(dv, q.a, q.b)) };
}

/** P-Disc-ke-hoach: dựng lại ĐÚNG như `page.tsx?muc=ke-hoach` (ba kỳ đang chạy + thư viện hoạt động đã kiểm + bản phân tích mới nhất). */
export async function docKeHoach(nguoi: NguoiGoi, q: KeHoachQuery, now: Date = new Date()): Promise<{ tenGiaDinh: string; keHoach: unknown }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "DOC" });
  await gioiHan("doc", userId);
  const nap = await napHoacKhongThay(userId, now);
  const { so, pt } = nap;
  const hs = hoSoCaNha(so.thanhVien, so.bai);
  const ds = [...hs.values()].filter((b) => b !== null);
  const tab: TabKeHoach = q.tab ?? "NGAY_7";
  const [kh7, kh30, kh365, hoatDong, ptMoi] = await Promise.all([
    docKeHoachDangChay(so.id, "NGAY_7"),
    docKeHoachDangChay(so.id, "THANG_1"),
    docKeHoachDangChay(so.id, "NAM_1"),
    docHoatDongDaKiem(now),
    docPhanTichMoiNhat(so.id),
  ]);
  const keHoach: Partial<Record<KyKeHoach, KeHoachDaLuu>> = { ...(kh7 ? { NGAY_7: kh7 } : {}), ...(kh30 ? { THANG_1: kh30 } : {}), ...(kh365 ? { NAM_1: kh365 } : {}) };
  const vm = dungManKeHoach({
    tab,
    ngayChon: q.ngay ?? null,
    tuanChon: q.tuan ?? null,
    kyCheckin: q.plan ?? null,
    soTuLam: ds.filter((b) => b.cachLam === "TU_LAM").length,
    soCoHoSo: ds.length,
    tongThanhVien: so.thanhVien.length,
    chup: pt?.chup ?? null,
    soBanMoiNhat: ptMoi?.soBan ?? null,
    keHoach,
    phanTichIdMoiNhat: ptMoi?.id ?? null,
    hoatDong,
    thanhVien: so.thanhVien.map((t) => ({ id: t.id, ten: t.ten })),
    homNay: ngayVN(now),
  });
  return { tenGiaDinh: so.ten, keHoach: boLienKetWeb(vm) };
}

// ───────────────────────── GHI: sổ + thành viên ─────────────────────────

export async function taoSoGiaDinh(userId: string, input: z.infer<typeof taoSoBody>, now: Date = new Date()): Promise<{ giaDinhId: string; soGoiY: number }> {
  await gioiHan("ghi", userId);
  return lay(await taoSo(userId, input, now));
}

/**
 * V8.28 — chữ viết tắt trong ô tròn cho APP: cùng luật `chuVietTat` của web (1 từ ⇒ tối đa 3 chữ; nhiều từ ⇒ chữ đầu của 2 từ cuối) NHƯNG bỏ dấu câu ở đầu mỗi từ
 * (tên «Ông (Ngoại)» / «(Bố)» ở web ra «(O»). Chỉ khác web khi từ bắt đầu bằng ký tự không phải chữ/số; không có chữ nào ⇒ «?».
 */
export function chuVietTatApp(ten: string): string {
  const tu = ten.split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
  if (tu.length === 0) return "?";
  if (tu.length === 1) return [...tu[0]!].slice(0, 3).join("").toUpperCase();
  return tu.slice(-2).map((t) => [...t][0] ?? "").join("").toUpperCase();
}

export async function luuThanhVienSo(nguoi: NguoiGoi, input: z.infer<typeof thanhVienBody>, now: Date = new Date()): Promise<{ id: string; moi: boolean }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "GHI" });
  await gioiHan("ghi", userId);
  // V8.28 — app KHÔNG hiển thị/gửi `ghiChu`; domain hiểu «không gửi» là XOÁ. Sửa thành viên có sẵn mà thiếu khoá `ghiChu` ⇒ giữ nguyên ghi chú hiện có (web vẫn gửi đủ nên không đổi).
  let dauVao = input;
  if (input.id && input.ghiChu === undefined) {
    const so = await laySoCuaChu(userId);
    const cu = so ? await db.discThanhVien.findFirst({ where: { id: input.id, giaDinhId: so.id, deletedAt: null }, select: { ghiChu: true } }) : null;
    if (cu) dauVao = { ...input, ghiChu: cu.ghiChu };
  }
  return lay(await luuThanhVien(userId, dauVao, now));
}

export async function xoaThanhVienSo(nguoi: NguoiGoi, memberId: string, input: z.infer<typeof xoaThanhVienBody>, now: Date = new Date()): Promise<{ daXoaBai: number; daGiuBai: number }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "GHI" });
  await gioiHan("ghi", userId);
  return lay(await xoaThanhVien(userId, { id: idHopLe(memberId), cheDo: input.cheDo }, now));
}

export async function xoaLanLam(nguoi: NguoiGoi, baiId: string, now: Date = new Date()): Promise<Record<string, never>> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "GHI" });
  await gioiHan("ghi", userId);
  lay(await xoaBaiLam(userId, idHopLe(baiId), now));
  return {};
}

// ───────────────────────── GHI: làm bài ─────────────────────────

/** Phát đề (hoặc làm TIẾP đề đã phát nếu còn bản nháp hợp lệ). Bộ đề do SERVER định tuyến theo tuổi/lớp — client chỉ nói người nào + cách nào. */
export async function batDauLamBai(nguoi: NguoiGoi, input: z.infer<typeof phatDeBody>, now: Date = new Date()): Promise<{ de: DeDangLam }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "LAM_BAI", thanhVienId: input.thanhVienId });
  await gioiHan("batDau", userId);
  return lay(await phatDeCho(userId, input, now));
}

export async function luuBanNhap(nguoi: NguoiGoi, input: z.infer<typeof luuNhapBody>, now: Date = new Date()): Promise<{ daLam: number }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "LAM_BAI", thanhVienId: input.thanhVienId });
  await gioiHan("luuNhap", userId);
  return lay(await luuNhap(userId, input, now));
}

export type KetQuaNopDto = KetQuaNopBaiSo & { lapLai: boolean };

/** Nộp lại cùng vé chỉ được «trả lại kết quả cũ» trong cửa sổ ngắn này (mất mạng / bấm đúp) — không phải suốt hạn vé 24 giờ. */
const CUA_SO_LAP_LAI_PHUT = 15;

/**
 * NỘP BÀI — MỘT LẦN cho mỗi phiên làm bài (vé `ve`).
 * ⚠️ Web KHÔNG có cổng này: `nopBaiSo` chỉ kiểm vé (chữ ký + hạn + đúng người), KHÔNG kiểm bản nháp còn tồn tại và vé không bị "đốt" — nộp CÙNG một vé hai lần ghi HAI dòng `DiscBaiLam`
 * (đo bằng đọc `ghi.ts`/`de-ky.ts::nopBai`; ca [MDISC-DB-05] của app chứng minh bằng DB). Chống nhấn đúp ở web là ở NÚT, không ở máy chủ.
 * Cổng ở ĐÂY (không sửa `ghi.ts` — xem đề xuất ở docs/mobile-integration/DISC-API-V823.md): «giành» bản nháp bằng MỘT câu `updateMany` có điều kiện (`ve` còn nguyên) — đúng một yêu cầu thắng,
 * kể cả hai yêu cầu đồng thời; yêu cầu thua KHÔNG ghi gì. Nộp lỗi (thiếu câu, trả lời phẳng…) ⇒ trả lại tên bản nháp để làm tiếp.
 *  · Thắng ⇒ chạy `nopBaiSo` của web (nó tự xoá bản nháp trong giao dịch ghi bài).
 *  · Thua ⇒ vé đã dùng HOẶC chưa từng có bản nháp: nếu vé hợp lệ + có lần làm của chính người này, CÙNG bộ câu hỏi (`maDe`), nộp trong 15 phút ⇒ trả lại kết quả đó (`lapLai: true`, KHÔNG ghi thêm); không có ⇒ 409 `LUOT_DA_NOP`.
 *    Giới hạn đã biết: khi tắt ngân hàng câu hỏi (mặc định) mọi lần làm dùng ĐÚNG MỘT đề gốc ⇒ `maDe` không phân biệt được hai lần làm trong 15 phút — «trả lại» có thể là lần làm trước; cổng đúng là ở máy chủ (đề xuất trong tài liệu).
 */
export async function nopBaiLamBai(nguoi: NguoiGoi, input: z.infer<typeof nopBaiBody>, now: Date = new Date()): Promise<KetQuaNopDto> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "LAM_BAI", thanhVienId: input.thanhVienId });
  await gioiHan("nop", userId);
  const so = await laySoCuaChu(userId);
  if (!so) throw new LoiApiMobile("NOT_FOUND", 404, "Chưa có sổ gia đình.");
  // V8.28 — cổng «nộp một lần» nằm Ở GỐC domain (`nopBaiSo`: xoá bản nháp theo vé TRONG giao dịch ghi bài). Adapter chỉ dịch kết quả:
  //  · thắng ⇒ kết quả mới; · vé đã dùng (`VE_DA_DUNG`: nộp lại sau timeout / hai yêu cầu đồng thời) ⇒ tra lại kết quả đã ghi (`lapLai: true`) hoặc 409 `LUOT_DA_NOP`.
  const r = await nopBaiSo(userId, input, now);
  if (r.ok) {
    const { ok: _bo, ...kq } = r;
    return { ...kq, lapLai: false };
  }
  if (r.loi === "VE_DA_DUNG") return lapLaiNop(so.id, userId, input, now);
  throw loiTuMien(r);
}

async function lapLaiNop(giaDinhId: string, userId: string, input: z.infer<typeof nopBaiBody>, now: Date): Promise<KetQuaNopDto> {
  const tv = await db.discThanhVien.findFirst({ where: { id: input.thanhVienId, giaDinhId, deletedAt: null }, select: { id: true } });
  if (!tv) throw khongThay();
  const ve = dePhatRaTuVe({ ve: input.ve, thanhVienId: tv.id, khoa: layKhoaDisc(), bayGio: now });
  if (!ve.ok) {
    if (ve.lyDo === "HET_HAN") throw new LoiApiMobile("HET_HAN", 409, "Phiên làm bài đã hết hạn. Hãy mở lại bài.");
    throw new LoiApiMobile("VALIDATION", 400, "Phiên làm bài không hợp lệ. Hãy mở lại bài.");
  }
  // Bài phải là bài của CHÍNH BỘ CÂU HỎI mà vé này mang (`maDe` = băm danh sách mã câu — cùng công thức `ghi.ts`; [MDISC-NOP-08] ghim) VÀ mới nộp (cửa sổ ngắn).
  const maDe = createHash("sha256").update(ve.maCau.join("|")).digest("hex");
  const gan = await db.discBaiLam.findFirst({
    where: { giaDinhId, thanhVienId: tv.id, cachLam: input.cachLam, nguoiTraLoiId: userId, maDe, createdAt: { gte: new Date(now.getTime() - CUA_SO_LAP_LAI_PHUT * 60_000) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, thanhVienId: true, tenLuc: true, boDe: true, phienBanBoDe: true, cachLam: true, diem: true, kieu: true, canhBao: true, createdAt: true },
  });
  const bai = gan ? baiTuHang(gan) : null;
  if (!gan || !bai) throw new LoiApiMobile("LUOT_DA_NOP", 409, "Phiên làm bài này đã kết thúc. Hãy mở lại bài nếu muốn làm lần mới.");
  const pt = await docPhanTichMoiNhat(giaDinhId);
  return {
    baiId: gan.id,
    thanhVienId: tv.id,
    ten: gan.tenLuc,
    cachLam: bai.cachLam,
    boDe: bai.boDe,
    nhan: nhanTuKieu(bai.kieu),
    diem: bai.diem,
    truoc: null,
    daCoPhanTich: pt !== null,
    lapLai: true,
  };
}

// ───────────────────────── GHI: kế hoạch ─────────────────────────

export async function taoKeHoachSo(nguoi: NguoiGoi, input: z.infer<typeof taoKeHoachBody>, now: Date = new Date()): Promise<{ keHoachId: string; soViec: number }> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "GHI" });
  await gioiHan("ghi", userId);
  return lay(await taoKeHoach(userId, input, now));
}

export async function danhDauViecXong(nguoi: NguoiGoi, viecId: string, now: Date = new Date()): Promise<Record<string, never>> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "GHI" });
  await gioiHan("ghi", userId);
  lay(await tickViec(userId, { viecId: idHopLe(viecId) }, now));
  return {};
}

export async function camOnViecSo(nguoi: NguoiGoi, viecId: string, now: Date = new Date()): Promise<Record<string, never>> {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "GHI" });
  await gioiHan("ghi", userId);
  lay(await camOnViec(userId, { viecId: idHopLe(viecId) }, now));
  return {};
}

export async function luuCheckinSo(nguoi: NguoiGoi, input: z.infer<typeof checkinBody>, now: Date = new Date()) {
  const userId = nguoi.userId;
  await baoVeDisc(nguoi, { phamVi: "GHI" });
  await gioiHan("ghi", userId);
  return lay(await luuCheckin(userId, input, now));
}

// ───────────────────────── PIN «chế độ trẻ em» của sổ ─────────────────────────

export async function docTrangThaiPinSo(nguoi: NguoiGoi): Promise<{ trangThai: unknown }> {
  await gioiHan("doc", nguoi.userId);
  const r = await docTrangThaiPin(boiCanh(nguoi));
  if (!r.ok) throw loiTuMien(r);
  return { trangThai: r.trangThai };
}

/** ĐẶT lần đầu (chỉ cần đăng nhập + chủ sổ) hoặc ĐỔI (thân `{pin, pinCu}` HOẶC `{pin, matKhau}`; PIN đang khoá ⇒ CHỈ `matKhau`). Thân do domain kiểm CHẶT. */
export async function datPinSo(nguoi: NguoiGoi, input: unknown): Promise<{ hanhDong: "DAT" | "DOI"; goKhoa: boolean }> {
  await gioiHan("ghi", nguoi.userId);
  const r = await datHoacDoiPin(boiCanh(nguoi), input);
  if (!r.ok) throw loiTuMien(r);
  return { hanhDong: r.hanhDong, goKhoa: r.goKhoa };
}

/** MỞ KHOÁ bằng `{pin}` hoặc `{matKhau}` ⇒ tạo phiên mở khoá GẮN phiên đăng nhập này ở máy chủ (client KHÔNG giữ token mở khoá). Sai nhiều lần ⇒ 429 + Retry-After. */
export async function xacNhanPinSo(nguoi: NguoiGoi, input: unknown, now: Date = new Date()): Promise<{ daMoKhoa: true; cheDo: "DAY_DU"; hetHanTuyetDoiLuc: string; idleGiay: number; cachXacMinh: "PIN" | "MAT_KHAU"; goKhoa: boolean }> {
  await gioiHan("ghi", nguoi.userId);
  const r = await moKhoa(boiCanh(nguoi), input, now);
  if (!r.ok) throw loiTuMien(r);
  return { daMoKhoa: true, cheDo: r.cheDo, hetHanTuyetDoiLuc: r.hetHanTuyetDoiLuc, idleGiay: r.idleGiay, cachXacMinh: r.cachXacMinh, goKhoa: r.goKhoa };
}

/** KHOÁ LẠI: thu hồi phiên mở khoá của phiên đăng nhập này (đăng nhập vẫn còn). */
export async function khoaLaiSo(nguoi: NguoiGoi): Promise<{ soPhien: number }> {
  await gioiHan("ghi", nguoi.userId);
  const r = await khoaLai(boiCanh(nguoi));
  if (!r.ok) throw loiTuMien(r);
  return { soPhien: r.soPhien };
}

/** CHẾ ĐỘ TRẺ EM: hạ phiên xuống «chỉ làm bài của MỘT thành viên»; thoát = mở khoá lại bằng PIN. */
export async function cheDoTreEmSo(nguoi: NguoiGoi, input: unknown): Promise<{ thanhVienId: string }> {
  await gioiHan("ghi", nguoi.userId);
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if (Object.keys(o).some((k) => k !== "thanhVienId")) throw new LoiApiMobile("VALIDATION", 400, "Yêu cầu không hợp lệ.");
  const r = await vaoCheDoTreEm(boiCanh(nguoi), o.thanhVienId);
  if (!r.ok) throw loiTuMien(r);
  return { thanhVienId: r.thanhVienId };
}
