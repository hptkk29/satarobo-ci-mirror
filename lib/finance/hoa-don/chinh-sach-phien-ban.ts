// lib/finance/hoa-don/chinh-sach-phien-ban.ts — CHÍNH SÁCH HOÁ ĐƠN CÓ PHIÊN BẢN: kiểu nội dung (zod là nguồn kiểu), máy trạng thái,
// kiểm chồng/hở hiệu lực, ánh xạ nội dung → `QuyTac[]` cho engine. THUẦN: không Prisma, không DB, không env, không đồng hồ,
// KHÔNG import `node:*` — client component được phép `import type` (và hằng) từ đây. (Hàm băm nằm ở `chinh-sach-mo-phong.ts`.)
//
// Lát S7 Invoice Hub (hợp đồng đợt 2 · 04 §6.1–§6.4). Bảng `HoaDonChinhSach` đã migrate ở S4 (`20261120090000`); tệp này chỉ là
// LUẬT, dịch vụ ghi ở `chinh-sach-db.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA ĐIỀU KHÔNG ĐƯỢC LÀM Ở ĐÂY
//
//   1. KHÔNG viết điều luật / mức thuế / số hiệu văn bản vào mã validate (TD-10, ADR-010). Mọi tham số pháp lý là DỮ LIỆU người
//      vận hành khai; mã chỉ kiểm HÌNH DẠNG (số nguyên 0–100, ngày hợp lệ, chuỗi không rỗng). `vanBan` là chuỗi tự do — không có
//      danh mục văn bản hợp lệ trong mã. Lưới `[CSPB-07]` quét tệp này tìm viện dẫn.
//   2. KHÔNG có mặc định cho tham số pháp lý. Thiếu `thoiDiemLap` / `cheDoToiDa` / `lamTron` / `anhXaThue` ⇒ nội dung SAI (fail-closed),
//      không "điền sẵn 8%". Ngoại lệ DUY NHẤT là hằng `QR_TTL_GIO_MAC_DINH` — owner xác nhận 01/11/2026 ("QR mặc định TTL 4 giờ, cấu hình
//      được"); nó chỉ có nghĩa khi chính sách KHÔNG khai `nguoiMua.qrTtlGio`.
//   3. KHÔNG sửa phiên bản đã `HIEU_LUC`. Sửa = phiên bản mới (máy trạng thái không có cạnh nào đi từ `HIEU_LUC` về `NHAP`/`CHO_DUYET`).

import { z } from "zod";
import { laNgayHopLe } from "./cau-hinh-co-so";
import { idQuyTac, kiemBoQuyTac, type QuyTac, type ThoiDiemLap } from "./engine/chinh-sach";
import type { CachThuSoBuoi } from "./engine/tien-thue";
import { KIEU_GIA, type KieuGia } from "./tinh-hoa-don";
import { TOI_THIEU_LY_DO_HOA_DON } from "./trang-thai-hoa-don";

// ── HẰNG ──────────────────────────────────────────────────────────────────

/** QR người mua: số giờ hiệu lực KHI chính sách không khai. Owner xác nhận 01/11/2026 (00 §2b OD-11). Không phải điều luật. */
export const QR_TTL_GIO_MAC_DINH = 4;
/** Biên hợp lệ của số giờ QR khi chính sách có khai (HÌNH DẠNG dữ liệu, không phải quy định). */
export const QR_TTL_GIO_TOI_THIEU = 1;
export const QR_TTL_GIO_TOI_DA = 168;

export const CAC_TRANG_THAI = ["NHAP", "CHO_DUYET", "HIEU_LUC", "HET_HIEU_LUC", "TU_CHOI"] as const;
export type TrangThaiChinhSach = (typeof CAC_TRANG_THAI)[number];

/** Từ thấp đến cao. `TAT < SHADOW < DE_XUAT < TU_DONG` (04 §2.8). */
export const CAC_CHE_DO = ["TAT", "SHADOW", "DE_XUAT", "TU_DONG"] as const;
export type CheDoHub = (typeof CAC_CHE_DO)[number];
export const bacCheDo = (c: CheDoHub): number => CAC_CHE_DO.indexOf(c);

/** Đủ bốn giá trị của `ThoiDiemLap` — `satisfies` buộc `tsc` đỏ nếu engine thêm giá trị mà đây quên. */
export const CAC_THOI_DIEM_LAP = ["DO_KE_TOAN_CHOT", "KHI_THU_TIEN", "SAU_KE_TOAN_XAC_NHAN", "KHI_HOAN_THANH_DICH_VU"] as const satisfies readonly ThoiDiemLap[];
const _DuThoiDiemLap: ThoiDiemLap extends (typeof CAC_THOI_DIEM_LAP)[number] ? true : never = true;
void _DuThoiDiemLap;

const CAC_CACH_THU_SO_BUOI = ["MOT_KHOA_MO_TA_SO_BUOI", "SO_BUOI_LA_SO_LUONG"] as const satisfies readonly CachThuSoBuoi[];
const CAC_KIEU_GIA = [KIEU_GIA.DA_GOM_THUE, KIEU_GIA.CHUA_GOM_THUE] as const satisfies readonly KieuGia[];

/**
 * Mức thông tin người mua. NHÃN TẠM — OD-11 (phần pháp lý người mua) chưa chốt: mã KHÔNG đặt mặc định và KHÔNG gắn ý nghĩa pháp lý
 * nào cho hai giá trị; chúng chỉ là cái người vận hành chọn. Người đọc sau đừng suy "NGUOI_TIEU_DUNG" là quy định.
 */
export const CAC_MUC_NGUOI_MUA = ["NGUOI_TIEU_DUNG", "THONG_TIN_DAY_DU"] as const;
/** Làm tròn: engine S3 chỉ có MỘT quy tắc (`lamTronChia`, nửa lên). Không nhận giá trị mà engine không thực hiện được. */
export const CAC_CACH_LAM_TRON = ["HALF_UP"] as const;
export const CAC_DO_TIN_CAY = ["CAO", "TRUNG", "THAP"] as const;

export const NHAN_TRANG_THAI: Record<TrangThaiChinhSach, string> = {
  NHAP: "Bản nháp",
  CHO_DUYET: "Chờ duyệt",
  HIEU_LUC: "Đang hiệu lực",
  HET_HIEU_LUC: "Đã hết hiệu lực",
  TU_CHOI: "Bị từ chối",
};

export const NHAN_CHE_DO: Record<CheDoHub, string> = {
  TAT: "Tắt",
  SHADOW: "Chạy thử (không phát hành)",
  DE_XUAT: "Đề xuất, kế toán bấm",
  TU_DONG: "Tự động",
};

// ── NỘI DUNG (zod là nguồn kiểu) ──────────────────────────────────────────

const chuoi = (ten: string, toiDa: number) =>
  z
    .string({ message: `${ten} phải là chữ` })
    .trim()
    .min(1, { message: `${ten} không được để trống` })
    .max(toiDa, { message: `${ten} tối đa ${toiDa} ký tự` });

const chuoiTuyChon = (ten: string, toiDa: number) =>
  z
    .string({ message: `${ten} phải là chữ` })
    .trim()
    .max(toiDa, { message: `${ten} tối đa ${toiDa} ký tự` })
    .nullish()
    .transform((v) => (v == null || v === "" ? null : v));

const mucThueSchema = z.discriminatedUnion(
  "kieu",
  [
    z.object({ kieu: z.literal("SUAT"), phanTram: z.number({ message: "Thuế suất phải là số" }).int({ message: "Thuế suất phải là số nguyên" }).min(0, { message: "Thuế suất từ 0 đến 100" }).max(100, { message: "Thuế suất từ 0 đến 100" }) }),
    z.object({ kieu: z.literal("KCT") }),
    z.object({ kieu: z.literal("KKKNT") }),
  ],
  { message: "Mức thuế phải là một suất (SUAT), KCT hoặc KKKNT" },
);

const dongAnhXaSchema = z
  .object({
    /** `TAT_CA` hoặc mã loại khoản (cấu hình hiện hành khoá theo `OrderType`). Tên luật KHÔNG nằm ở đây. */
    loaiKhoan: chuoi("Loại khoản", 40),
    mucThue: mucThueSchema,
    kieuGia: z.enum(CAC_KIEU_GIA, { message: "Kiểu giá phải là DA_GOM_THUE hoặc CHUA_GOM_THUE" }),
    donViTinh: chuoi("Đơn vị tính", 30),
    donViTinhBuoi: chuoi("Đơn vị tính theo buổi", 30),
    cachThuSoBuoi: z.enum(CAC_CACH_THU_SO_BUOI, { message: "Cách thể hiện số buổi không hợp lệ" }),
    mauMoTaSoBuoi: z.string({ message: "Mẫu mô tả số buổi phải là chữ" }).trim().max(60, { message: "Mẫu mô tả số buổi tối đa 60 ký tự" }),
  })
  .superRefine((d, ctx) => {
    if (d.cachThuSoBuoi === "MOT_KHOA_MO_TA_SO_BUOI" && !d.mauMoTaSoBuoi.includes("{n}")) {
      ctx.addIssue({ code: "custom", path: ["mauMoTaSoBuoi"], message: "Mẫu mô tả số buổi phải có {n} (chỗ điền số buổi)" });
    }
  });

const ngayTuyChon = (ten: string) =>
  z
    .string({ message: `${ten} phải là ngày yyyy-mm-dd` })
    .nullish()
    .transform((v) => (v == null || v === "" ? null : v))
    .refine((v) => v === null || laNgayHopLe(v), { message: `${ten} phải là ngày yyyy-mm-dd hợp lệ` });

const canCuSchema = z
  .object({
    vanBan: chuoi("Tên văn bản", 200),
    dieu: chuoiTuyChon("Điều", 60),
    khoan: chuoiTuyChon("Khoản", 60),
    doTinCay: z.enum(CAC_DO_TIN_CAY, { message: "Độ tin cậy phải là CAO, TRUNG hoặc THAP" }),
    canKeToanXacNhan: z.boolean({ message: "Cần kế toán xác nhận: đúng/sai" }),
    daKyDuyetBoi: chuoiTuyChon("Người ký duyệt", 120),
    daKyDuyetLuc: ngayTuyChon("Ngày ký duyệt"),
  })
  .superRefine((r, ctx) => {
    if (r.daKyDuyetBoi !== null && r.daKyDuyetLuc === null) {
      ctx.addIssue({ code: "custom", path: ["daKyDuyetLuc"], message: "Đã ghi người ký duyệt thì phải ghi ngày ký" });
    }
    if (r.daKyDuyetBoi === null && r.daKyDuyetLuc !== null) {
      ctx.addIssue({ code: "custom", path: ["daKyDuyetBoi"], message: "Có ngày ký thì phải ghi người ký duyệt" });
    }
  });

const noiDungSchema = z
  .object({
    anhXaThue: z.array(dongAnhXaSchema, { message: "Phải khai ít nhất một dòng ánh xạ thuế" }).min(1, { message: "Phải khai ít nhất một dòng ánh xạ thuế" }).max(50, { message: "Tối đa 50 dòng ánh xạ thuế" }),
    thoiDiemLap: z.enum(CAC_THOI_DIEM_LAP, { message: "Phải chọn thời điểm lập hoá đơn" }),
    cheDoToiDa: z.enum(CAC_CHE_DO, { message: "Phải chọn chế độ tối đa" }),
    nguoiMua: z.object({
      buyerInfoLevel: z.enum(CAC_MUC_NGUOI_MUA, { message: "Phải chọn mức thông tin người mua" }),
      qrTtlGio: z
        .number({ message: "Số giờ hiệu lực QR phải là số" })
        .int({ message: "Số giờ hiệu lực QR phải là số nguyên" })
        .min(QR_TTL_GIO_TOI_THIEU, { message: `Số giờ hiệu lực QR từ ${QR_TTL_GIO_TOI_THIEU} đến ${QR_TTL_GIO_TOI_DA}` })
        .max(QR_TTL_GIO_TOI_DA, { message: `Số giờ hiệu lực QR từ ${QR_TTL_GIO_TOI_THIEU} đến ${QR_TTL_GIO_TOI_DA}` })
        .nullish()
        .transform((v) => v ?? null),
    }),
    lamTron: z.enum(CAC_CACH_LAM_TRON, { message: "Cách làm tròn không hợp lệ" }),
    legalBasisRef: z.array(canCuSchema).max(30, { message: "Tối đa 30 căn cứ" }),
  })
  .superRefine((nd, ctx) => {
    const daGap = new Set<string>();
    nd.anhXaThue.forEach((d, i) => {
      if (daGap.has(d.loaiKhoan)) ctx.addIssue({ code: "custom", path: ["anhXaThue", i, "loaiKhoan"], message: `Loại khoản "${d.loaiKhoan}" bị khai hai lần trong cùng một phiên bản` });
      daGap.add(d.loaiKhoan);
    });
    // Căn cứ cần kế toán xác nhận mà chưa ai ký ⇒ chỉ được chạy thử (04 §6.2, §6.3 mục 4).
    if (coCanCuChuaKy(nd.legalBasisRef) && bacCheDo(nd.cheDoToiDa) > bacCheDo("SHADOW")) {
      ctx.addIssue({ code: "custom", path: ["cheDoToiDa"], message: `Có căn cứ cần kế toán xác nhận mà chưa ai ký duyệt — chế độ tối đa chỉ được là "${NHAN_CHE_DO.SHADOW}" hoặc "${NHAN_CHE_DO.TAT}"` });
    }
  })
  .transform((nd) => ({ ...nd, anhXaThue: [...nd.anhXaThue].sort((a, b) => a.loaiKhoan.localeCompare(b.loaiKhoan)) }));

export type NoiDungChinhSach = z.output<typeof noiDungSchema>;
export type DongAnhXaThue = NoiDungChinhSach["anhXaThue"][number];
export type CanCuPhapLy = NoiDungChinhSach["legalBasisRef"][number];

/** Có căn cứ nào "cần kế toán xác nhận" mà chưa có người ký duyệt không. */
export function coCanCuChuaKy(refs: readonly Pick<CanCuPhapLy, "canKeToanXacNhan" | "daKyDuyetBoi">[]): boolean {
  return refs.some((r) => r.canKeToanXacNhan && !r.daKyDuyetBoi);
}

export type KetQuaPhanTich = { ok: true; noiDung: NoiDungChinhSach } | { ok: false; loi: string[] };

const duongDan = (p: readonly PropertyKey[]) => p.map((x) => (typeof x === "number" ? `#${x + 1}` : String(x))).join(" › ");

/** Phân tích nội dung chưa tin cậy (Json từ DB hoặc từ client). Không ném. Lỗi bằng tiếng Việt, kèm vị trí. */
export function phanTichNoiDung(raw: unknown): KetQuaPhanTich {
  const r = noiDungSchema.safeParse(raw);
  if (r.success) return { ok: true, noiDung: r.data };
  return { ok: false, loi: r.error.issues.map((i) => (i.path.length > 0 ? `${duongDan(i.path)}: ${i.message}` : i.message)) };
}

/** Số giờ hiệu lực QR của một chính sách: giá trị chính sách khai, thiếu ⇒ `QR_TTL_GIO_MAC_DINH`. */
export function qrTtlGioHieuLuc(nd: Pick<NoiDungChinhSach, "nguoiMua">): number {
  return nd.nguoiMua.qrTtlGio ?? QR_TTL_GIO_MAC_DINH;
}

// ── NGÀY ──────────────────────────────────────────────────────────────────

const MAX_NGAY = "9999-99-99";

export function ngayKeTiep(s: string): string {
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) + 1)).toISOString().slice(0, 10);
}

/** Khoảng hiệu lực của một phiên bản khi tạo: `den` null = mở. Khoảng ĐÓNG hai đầu. Trả lỗi hoặc null. */
export function kiemKhoangHieuLuc(tu: string, den: string | null): string | null {
  if (!laNgayHopLe(tu)) return "Ngày bắt đầu hiệu lực phải là ngày yyyy-mm-dd hợp lệ.";
  if (den !== null) {
    if (!laNgayHopLe(den)) return "Ngày kết thúc hiệu lực phải là ngày yyyy-mm-dd hợp lệ.";
    if (den < tu) return `Ngày kết thúc (${den}) trước ngày bắt đầu (${tu}).`;
  }
  return null;
}

// ── MÁY TRẠNG THÁI ────────────────────────────────────────────────────────

/** Bảng chuyển hợp lệ — NGUỒN DUY NHẤT (action, dịch vụ, UI cùng hỏi `kiemChuyen`). */
export const BANG_CHUYEN: Readonly<Record<TrangThaiChinhSach, readonly TrangThaiChinhSach[]>> = {
  NHAP: ["CHO_DUYET"],
  CHO_DUYET: ["HIEU_LUC", "TU_CHOI"],
  HIEU_LUC: ["HET_HIEU_LUC"],
  HET_HIEU_LUC: [],
  TU_CHOI: [],
};

export type CtxChuyen = {
  lyDo: string | null;
  /** Chỉ cần khi `to === "HIEU_LUC"`: băm UI đã gửi + băm server tự tính lại. */
  moPhong: { hashUi: string | null; hashServer: string } | null;
};

export type KetQuaChuyen =
  | { ok: true }
  | { ok: false; ma: "KHONG_HOP_LE" | "DA_HIEU_LUC_KHONG_SUA" | "THIEU_LY_DO" | "CHUA_MO_PHONG" | "MO_PHONG_LECH"; thongDiep: string };

/** Lý do tối thiểu — dùng chung ngưỡng với phần hoá đơn khác. */
export const toiThieuLyDo = TOI_THIEU_LY_DO_HOA_DON;
export const lyDoDuDai = (s: string | null | undefined): boolean => (s ?? "").trim().length >= TOI_THIEU_LY_DO_HOA_DON;

/**
 * Có được chuyển `from → to` không — trả LÝ DO từ chối bằng tiếng Việt. Thứ tự kiểm: cạnh hợp lệ → lý do → mô phỏng.
 * `moPhong` là điều kiện của riêng cạnh `CHO_DUYET → HIEU_LUC`: người duyệt chỉ được duyệt khi băm UI gửi lên KHỚP băm server tự tính
 * lại (= đã xem mô phỏng của CHÍNH nội dung này).
 *
 * ⚠️ KHÔNG còn luật «người duyệt ≠ người soạn» (chủ dự án chốt 02/11/2026: «bỏ phần duyệt bằng người khác, không cần phiền phức như vậy»).
 * Một kế toán Hội sở tự duyệt được bản mình soạn. Phần còn lại của ý định cũ vẫn giữ: lý do bắt buộc + phải xem mô phỏng trước khi duyệt +
 * ghi `nguoiDuyetId` (truy vết). Đừng dựng lại cổng này ở tầng nút / dịch vụ / DB mà không có quyết định mới của chủ dự án.
 */
export function kiemChuyen(from: TrangThaiChinhSach, to: TrangThaiChinhSach, ctx: CtxChuyen): KetQuaChuyen {
  if (!BANG_CHUYEN[from].includes(to)) {
    if (from === "HIEU_LUC") {
      return { ok: false, ma: "DA_HIEU_LUC_KHONG_SUA", thongDiep: "Phiên bản đang hiệu lực không sửa được — muốn đổi, tạo phiên bản mới (rồi kết thúc phiên bản này)." };
    }
    return { ok: false, ma: "KHONG_HOP_LE", thongDiep: `Không thể chuyển chính sách từ "${NHAN_TRANG_THAI[from]}" sang "${NHAN_TRANG_THAI[to]}".` };
  }
  if (!lyDoDuDai(ctx.lyDo)) return { ok: false, ma: "THIEU_LY_DO", thongDiep: `Ghi lý do (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự).` };
  if (to === "HIEU_LUC") {
    const m = ctx.moPhong;
    if (!m || !m.hashUi) return { ok: false, ma: "CHUA_MO_PHONG", thongDiep: "Chưa xem mô phỏng của phiên bản này — mở mô phỏng rồi mới duyệt." };
    if (m.hashUi !== m.hashServer) return { ok: false, ma: "MO_PHONG_LECH", thongDiep: "Mô phỏng bạn đã xem không còn khớp với nội dung hiện tại (nội dung hoặc chính sách đang hiệu lực đã đổi). Mở lại mô phỏng rồi duyệt." };
  }
  return { ok: true };
}

/** Kết thúc hiệu lực: ngày kết thúc phải nằm trong khoảng [từ, đến] hiện có. Trả lỗi hoặc null. */
export function kiemNgayKetThuc(ban: { hieuLucTu: string; hieuLucDen: string | null }, ngayKetThuc: string): string | null {
  if (!laNgayHopLe(ngayKetThuc)) return "Ngày kết thúc phải là ngày yyyy-mm-dd hợp lệ.";
  if (ngayKetThuc < ban.hieuLucTu) return `Ngày kết thúc (${ngayKetThuc}) trước ngày bắt đầu hiệu lực (${ban.hieuLucTu}).`;
  if (ban.hieuLucDen !== null && ngayKetThuc > ban.hieuLucDen) return `Ngày kết thúc (${ngayKetThuc}) sau ngày hết hạn đã khai (${ban.hieuLucDen}).`;
  return null;
}

// ── CHỒNG / HỞ HIỆU LỰC CÙNG PHẠM VI ──────────────────────────────────────

export type BanTrongPhamVi = { id: string; phienBan: number; hieuLucTu: string; hieuLucDen: string | null };

const den = (b: { hieuLucDen: string | null }) => b.hieuLucDen ?? MAX_NGAY;

/**
 * Ứng viên (phiên bản sắp HIEU_LUC) với các bản ĐANG/ĐÃ có hiệu lực CÙNG phạm vi (cùng pháp nhân + cùng cơ sở — người gọi lọc).
 * Khoảng ĐÓNG hai đầu (`resolve` so `ngay <= den`): hai bản dùng chung đúng MỘT ngày là chồng; bản sau bắt đầu đúng ngày kế tiếp ngày
 * cuối của bản trước là liền nhau, không hở. Hở ⇒ TỪ CHỐI (khác `kiemBoQuyTac` chỉ cảnh báo): trong khoảng hở `resolve` trả `KHONG_CO`.
 */
export function kiemChongHoPhienBan(cacBan: readonly BanTrongPhamVi[], ungVien: BanTrongPhamVi): string[] {
  const loi: string[] = [];
  const khac = cacBan.filter((b) => b.id !== ungVien.id);
  for (const b of khac) {
    if (ungVien.hieuLucTu <= den(b) && b.hieuLucTu <= den(ungVien)) {
      loi.push(`Chồng hiệu lực với phiên bản ${b.phienBan} (${b.hieuLucTu} → ${b.hieuLucDen ?? "không giới hạn"}). Kết thúc phiên bản cũ trước khi bắt đầu phiên bản mới.`);
    }
  }
  if (loi.length > 0) return loi;
  const truoc = khac.filter((b) => b.hieuLucDen !== null && b.hieuLucDen < ungVien.hieuLucTu).sort((a, b) => den(b).localeCompare(den(a)))[0];
  if (truoc && ngayKeTiep(truoc.hieuLucDen as string) < ungVien.hieuLucTu) {
    loi.push(`Hở ngày giữa phiên bản ${truoc.phienBan} (đến ${truoc.hieuLucDen}) và phiên bản này (từ ${ungVien.hieuLucTu}) — trong khoảng đó không có chính sách nào.`);
  }
  if (ungVien.hieuLucDen !== null) {
    const sau = khac.filter((b) => b.hieuLucTu > ungVien.hieuLucDen!).sort((a, b) => a.hieuLucTu.localeCompare(b.hieuLucTu))[0];
    if (sau && ngayKeTiep(ungVien.hieuLucDen) < sau.hieuLucTu) {
      loi.push(`Hở ngày giữa phiên bản này (đến ${ungVien.hieuLucDen}) và phiên bản ${sau.phienBan} (từ ${sau.hieuLucTu}) — trong khoảng đó không có chính sách nào.`);
    }
  }
  return loi;
}

// ── NỘI DUNG → QUY TẮC CHO ENGINE ─────────────────────────────────────────

export type PhamViBan = { phapNhanMa: string; centerId: string | null };
export type BanDeChieu = PhamViBan & { phienBan: number; hieuLucTu: string; hieuLucDen: string | null };

/** Mã quy tắc ổn định qua các phiên bản của cùng (pháp nhân · cơ sở · loại khoản) — để `kiemBoQuyTac`/`idQuyTac` đúng nghĩa. */
export const maQuyTac = (p: PhamViBan, loaiKhoan: string): string => `${p.phapNhanMa}|${p.centerId ?? "*"}|${loaiKhoan}`;

/**
 * Một dòng `anhXaThue` ⇒ một `QuyTac` (không dòng nào bị gộp hay bỏ). Khoảng hiệu lực là của PHIÊN BẢN (04 §6.1 từng gợi ý ngày riêng
 * từng dòng; bản này không có — một nguồn ngày duy nhất để hai phiên bản không chồng ở cấp dòng). `canCuPhapLy` chỉ là chuỗi để IN.
 */
export function sangQuyTac(ban: BanDeChieu, nd: NoiDungChinhSach): QuyTac[] {
  const canCu =
    nd.legalBasisRef.length === 0
      ? null
      : nd.legalBasisRef.map((r) => [r.vanBan, r.dieu, r.khoan].filter((x) => x !== null && x !== "").join(" ")).join("; ");
  return nd.anhXaThue.map((d) => ({
    ma: maQuyTac(ban, d.loaiKhoan),
    phienBan: ban.phienBan,
    phapNhanMa: ban.phapNhanMa,
    centerId: ban.centerId,
    loaiKhoan: d.loaiKhoan,
    hieuLucTu: ban.hieuLucTu,
    hieuLucDen: ban.hieuLucDen,
    dangBat: true,
    nguon: "CAU_HINH" as const,
    canCuPhapLy: canCu,
    thongSo: {
      mucThue: d.mucThue,
      kieuGia: d.kieuGia,
      donViTinh: d.donViTinh,
      donViTinhBuoi: d.donViTinhBuoi,
      cachThuSoBuoi: d.cachThuSoBuoi,
      mauMoTaSoBuoi: d.mauMoTaSoBuoi,
      thoiDiemLap: nd.thoiDiemLap,
    },
  }));
}

/**
 * Kiểm cả bộ quy tắc CÙNG phạm vi (các bản đã hiệu lực ∪ ứng viên) bằng `kiemBoQuyTac` của engine — không viết bộ kiểm thứ hai.
 * Mọi vấn đề (kể cả `KHOANG_HO`, vốn engine chỉ cảnh báo) đều là lý do từ chối ở bước duyệt.
 */
export function kiemBoSauKhiThem(daCo: readonly QuyTac[], ungVien: readonly QuyTac[]): string[] {
  return kiemBoQuyTac([...daCo, ...ungVien]).map((v) => v.thongDiep);
}

export { idQuyTac };
