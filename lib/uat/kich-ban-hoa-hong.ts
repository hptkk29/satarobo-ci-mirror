// lib/uat/kich-ban-hoa-hong.ts — BỘ KỊCH BẢN UAT của module Nguồn & Hoa hồng (bước 3–10 của docs/source-commission/09-uat-checklist.md). THUẦN.
//
// MỘT nguồn cho ba nơi: (1) bộ nạp `nap-du-lieu-hoa-hong.ts` dựng lead/đơn/khoản thu theo đây; (2) spec
// `tests/hoa-hong/uat-vi-du-so.spec.ts` chạy ENGINE THẬT trên đúng dữ liệu đó rồi so với `kyVong`; (3) lưới
// `doc-so-khop.test.ts` đòi mọi con số trong checklist KHỚP bảng này. Sửa số ở một nơi mà không sửa nơi kia là test đỏ —
// nên con số in trong checklist luôn là con số engine đã tính ra, không phải số người viết tay.
//
// Điều kiện của MỌI con số (đã đo, đừng bỏ):
//   · học phí ròng 10.000.000 đ, không VAT (setting `hoaHong.vatTheoNgay` rỗng) — hoa hồng tính trên số tiền thực thu;
//   · bộ chung SR.QD.208 (loại NEW): Sale 4% · Sale Admin 1% · QLCS 2% · Marketing 1% · GV Trial 1% = 9%;
//   · GV Trial 1% chỉ có khi bé ĐÃ học thử và CÓ MẶT (điểm danh PRESENT) — thiếu thì mọi dòng bớt 1%;
//   · người hưởng QLCS (QL_TT) và Marketing (QC) lấy từ sổ phân công của CƠ SỞ — thiếu thì khoản vào hàng chờ, không có dòng tiền.
//
// "trước" = chỉ chính sách chung đang chạy (chưa kích hoạt nháp nào). "sau" = đã nâng trần lên 0,10 (10%) VÀ kích hoạt các nháp
// nêu ở `canKichHoat`. Đây là hai trạng thái của DỮ LIỆU CẤU HÌNH, không phải hai phiên bản mã.
//
// ⚠️ Tên nhóm nguồn ở đây là DỮ LIỆU của kịch bản (thư mục `lib/uat/` nằm ngoài năm thư mục mà lưới `[DYN-NOHARD]` quét: lõi
// hoa hồng không được so mã nguồn, còn bộ dữ liệu thử thì phải gọi tên nguồn nó thử).

export const TIEN_TO_UAT = "UAT-";
export const HOC_PHI_UAT = 10_000_000;

/** Tài khoản UAT dùng làm người hưởng / người thao tác — email của `prisma/seed-uat/00-tai-khoan.ts`. */
export const EMAIL_UAT = {
  admin: "uat.admin@satarobo.vn", // SUPER_ADMIN — duy nhất trong bộ uat.* giữ settings:edit, commission_policies:activate, sources:override-after-payment
  giamdoc: "uat.giamdoc@satarobo.vn", // CENTER_MANAGER CS1 (tên là "giám đốc" nhưng KHÔNG phải vai GIAM_DOC)
  sale1: "uat.sale1@satarobo.vn", // CENTER_SALES_CSM CS1 — Sale chốt
  sale2: "uat.sale2@satarobo.vn", // CENTER_SALES_CSM CS2 — nhân sự giới thiệu (S04)
  sale3: "uat.sale3@satarobo.vn", // CENTER_SALES_CSM CS1 — Sale phụ trách phụ huynh giới thiệu (S03)
  sale5: "uat.sale5@satarobo.vn", // CENTER_SALES_CSM CS1 — người phụ trách Marketing (QC) của CS1 trong bộ dữ liệu UAT
  saleho: "uat.saleho@satarobo.vn", // HO_SALE — Sale Admin
  giaovien: "uat.giaovien@satarobo.vn", // TEACHER CS1 — GV dạy Trial
  marketing: "uat.marketing@satarobo.vn", // HO_MARKETING — sources:manage; chủ nguồn
  ketoan: "uat.ketoan@satarobo.vn", // HO_ACCOUNTANT — commission_periods:manage, ghi nhận/xác nhận thu, hoàn tiền
  nhansu: "uat.nhansu@satarobo.vn", // HO_HR — commission_policies:manage, commission_disputes:review
  phuhuynh: "uat.phuhuynh@satarobo.vn", // PARENT — phụ huynh giới thiệu (S03)
} as const;
export type KhoaNguoiUat = keyof typeof EMAIL_UAT;

/**
 * Người nhận từng vai trong bộ dữ liệu UAT (khoá của `EMAIL_UAT`). Sale/Sale Admin/GV Trial lấy từ lead + lớp trial do bộ nạp dựng;
 * QLCS/Marketing lấy từ sổ phân công của CS1 (bộ nạp chỉ BỔ SUNG khi thiếu — nếu CS1 đã có người phụ trách thật thì người nhận là họ, số tiền không đổi).
 */
export const NGUOI_NHAN_THEO_VAI = {
  SALE: "sale1",
  SALE_ADMIN: "saleho",
  CENTER_MANAGER: "giamdoc",
  MARKETING: "sale5",
  TRIAL_TEACHER: "giaovien",
  SOURCE_OWNER: "marketing",
  REFERRER_PARENT_SALE: "sale3",
  REFERRER_EMPLOYEE: "sale2",
} as const;

export const VAI_HUONG = ["SALE", "SALE_ADMIN", "CENTER_MANAGER", "MARKETING", "TRIAL_TEACHER", "SOURCE_OWNER", "REFERRER_PARENT_SALE", "REFERRER_EMPLOYEE"] as const;
export type VaiHuong = (typeof VAI_HUONG)[number];

/** Tiền theo vai (VND, cộng cả các khoản thu của kịch bản; âm = thu hồi). Vai vắng = 0. */
export type TienTheoVai = Partial<Record<VaiHuong, number>>;

/** Nguồn / chính sách MẪU do bộ nạp dựng (bước 1–2). Mã có tiền tố UAT để dọn và để không đụng dữ liệu thật. */
export const NGUON_MAU = { code: "UAT_NGUON_MAU", ten: "UAT — Đối tác Zalo (nguồn mẫu)", cuaSoNgay: 60 } as const;
export const CHINH_SACH_MAU = {
  vanBan: "UAT-VB-01",
  nguon: "UAT-POL-NGUON-MAU", // SOURCE_OWNER 1% cho nguồn mẫu — phạm vi một nguồn, loại NEW
  taiTuc: "UAT-POL-TAI-TUC-MAU", // RENEWAL: Sale 1% + QLCS 1% — phạm vi chung
} as const;

/** Chính sách NHÁP do `scripts/hoa-hong/seed-chinh-sach-v1.ts` tạo, mà kịch bản "sau" cần kích hoạt (mã nhóm nguồn). */
export type NhapCanKichHoat = "PARENT_REFERRAL" | "EMPLOYEE_REFERRAL" | "PAID_ADS" | "WALK_IN" | "EVENT" | "CENTER_ORGANIC";

/** Ngày của một khoản thu, KHÔNG gắn năm/tháng cứng: tính theo tháng cutover T và mốc ghi nhận nguồn. */
export type NgayThu = { loai: "TRONG_KY_T"; ngay: number } | { loai: "SAU_GHI_NHAN"; soNgay: number };

export type KhoanThuUat = { ngay: NgayThu; soTien: number };

export type KichBanUat = {
  /** "S03" — khoá ổn định; checklist, spec và bảng số cùng gọi tên này. */
  ma: string;
  /** Các bước của checklist dùng kịch bản này. */
  buoc: readonly number[];
  tieuDe: string;
  /** Mã nhóm nguồn của lead (hoặc `NGUON_MAU.code`). */
  nhom: string;
  nguoiGioiThieu: "PHU_HUYNH" | "NHAN_SU" | null;
  /** Bé ĐÃ học thử và có mặt ⇒ vai GV Trial có người nhận. */
  coGvTrial: boolean;
  /** Ghi nhận nguồn khi nguồn PAID_ADS CHƯA có chủ (đối chứng của bước 5): bộ nạp tạo lead này TRƯỚC khi khai chủ nguồn. Chủ nguồn chỉ áp cho khoản thu TỪ ngày hiệu lực (`hieuLucChuNguonUat`) nên khoản thu đầu của lead này phải rơi TRƯỚC ngày đó. */
  truocKhiKhaiChuNguon: boolean;
  /** Lần mua thứ hai của một học viên đã có lần mua trước (RENEWAL). */
  lanMuaThuHai: boolean;
  thanhToan: readonly KhoanThuUat[];
  /** Hoàn tiền một phần do bộ nạp dựng khi bật `--hoan-tien-san` (bước 10); nếu không, người nghiệm thu tự hoàn bằng màn Đơn hàng. */
  hoanTienSan: { soTien: number; ngay: NgayThu } | null;
  canKichHoat: readonly NhapCanKichHoat[] | "CHINH_SACH_MAU";
  /** Hoa hồng TỪNG khoản (ghi chú `UAT:<mã>:<số>`; khoản hoàn: `UAT:<mã>:hoan`) — chỉ khai cho kịch bản mà checklist đọc từng khoản. Cộng lại phải bằng `kyVong`. */
  tungKhoan?: readonly { ghiChu: string; truoc: number; sau: number }[];
  kyVong: {
    truoc: TienTheoVai;
    sau: TienTheoVai;
    /** Mã hàng chờ kỳ vọng ở trạng thái "sau" (không có ⇒ không có hàng chờ). */
    holdSau?: string;
  };
};

/** Bộ chung SR.QD.208 loại NEW, trên số tiền `x`. Làm tròn từng vai (số kịch bản đều chia hết). */
const bo = (x: number, p: { sale: number; admin: number; qlcs: number; mkt: number; gv: number }): TienTheoVai => ({
  SALE: (x * p.sale) / 100,
  SALE_ADMIN: (x * p.admin) / 100,
  CENTER_MANAGER: (x * p.qlcs) / 100,
  ...(p.mkt > 0 ? { MARKETING: (x * p.mkt) / 100 } : {}),
  TRIAL_TEACHER: (x * p.gv) / 100,
});
const CHUNG_9 = bo(HOC_PHI_UAT, { sale: 4, admin: 1, qlcs: 2, mkt: 1, gv: 1 }); // 900.000
const KHONG_MKT_8 = bo(HOC_PHI_UAT, { sale: 4, admin: 1, qlcs: 2, mkt: 0, gv: 1 }); // 800.000
const THEM = (v: TienTheoVai, them: TienTheoVai): TienTheoVai => ({ ...v, ...them });

export const KICH_BAN_UAT: readonly KichBanUat[] = [
  {
    ma: "S02",
    buoc: [1, 2],
    tieuDe: "Nguồn mẫu do admin tạo + chính sách riêng SOURCE_OWNER 1%",
    nhom: NGUON_MAU.code,
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 12 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: "CHINH_SACH_MAU",
    kyVong: { truoc: CHUNG_9, sau: THEM(CHUNG_9, { SOURCE_OWNER: 100_000 }) },
  },
  {
    ma: "S03",
    buoc: [3],
    tieuDe: "Phụ huynh giới thiệu — Sale phụ trách phụ huynh nhận 2%",
    nhom: "PARENT_REFERRAL",
    nguoiGioiThieu: "PHU_HUYNH",
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 14 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: ["PARENT_REFERRAL"],
    kyVong: { truoc: CHUNG_9, sau: THEM(KHONG_MKT_8, { REFERRER_PARENT_SALE: 200_000 }) },
  },
  {
    ma: "S04",
    buoc: [4],
    tieuDe: "Nhân sự giới thiệu — nhân sự nhận 2%",
    nhom: "EMPLOYEE_REFERRAL",
    nguoiGioiThieu: "NHAN_SU",
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 15 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: ["EMPLOYEE_REFERRAL"],
    kyVong: { truoc: CHUNG_9, sau: THEM(KHONG_MKT_8, { REFERRER_EMPLOYEE: 200_000 }) },
  },
  {
    ma: "S05B",
    buoc: [5],
    tieuDe: "Quảng cáo — khoản thu TRƯỚC ngày hiệu lực của chủ nguồn (đối chứng ÂM)",
    nhom: "PAID_ADS",
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: true,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 16 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: ["PAID_ADS"],
    // Chủ nguồn theo LỊCH SỬ (08 §16.4): ngày thu đầu (16) nằm TRƯỚC ngày hiệu lực của chủ (18) và bản chụp lúc ghi nhận là «chưa có chủ» ⇒ không ai nhận 1% chủ nguồn, Marketing cơ sở bị loại ⇒ 8% + hàng chờ.
    // Khai chủ «từ hôm nay» thì lead này cũng được trả (900.000, không hàng chờ) — đã đo, xem [UAT-SO-05] và 09 §4 bước 5.
    kyVong: { truoc: CHUNG_9, sau: KHONG_MKT_8, holdSau: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" },
  },
  {
    ma: "S05",
    buoc: [5],
    tieuDe: "Quảng cáo trong cửa sổ ghi công — 1% Marketing chuyển sang chủ nguồn",
    nhom: "PAID_ADS",
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 20 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: ["PAID_ADS"],
    kyVong: { truoc: CHUNG_9, sau: THEM(KHONG_MKT_8, { SOURCE_OWNER: 100_000 }) },
  },
  {
    ma: "S06",
    buoc: [6],
    tieuDe: "Quảng cáo — khoản thu NGOÀI cửa sổ ghi công (ngày thứ 101)",
    nhom: "PAID_ADS",
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "SAU_GHI_NHAN", soNgay: 101 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: ["PAID_ADS"],
    kyVong: { truoc: CHUNG_9, sau: KHONG_MKT_8 },
  },
  {
    ma: "S07",
    buoc: [7],
    tieuDe: "Khách tự đến — NEW, nguồn không trả Marketing",
    nhom: "WALK_IN",
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 18 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: ["WALK_IN"],
    kyVong: { truoc: CHUNG_9, sau: KHONG_MKT_8 },
  },
  {
    ma: "S08",
    buoc: [8],
    tieuDe: "Lần mua thứ hai của cùng học viên — RENEWAL (Sale 1% + QLCS 1%)",
    nhom: "WALK_IN",
    nguoiGioiThieu: null,
    coGvTrial: false,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: true,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 21 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: null,
    canKichHoat: "CHINH_SACH_MAU",
    // Chưa có chính sách RENEWAL đang chạy ⇒ 0 đ (D16), KHÔNG phải lỗi. Bộ chung chỉ áp loại NEW.
    kyVong: { truoc: {}, sau: { SALE: 100_000, CENTER_MANAGER: 100_000 } },
  },
  {
    ma: "S09",
    buoc: [9],
    tieuDe: "Một đơn, ba lần thanh toán 4tr + 3tr + 3tr — cả ba cùng NEW",
    nhom: "EVENT",
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [
      { ngay: { loai: "TRONG_KY_T", ngay: 5 }, soTien: 4_000_000 },
      { ngay: { loai: "TRONG_KY_T", ngay: 15 }, soTien: 3_000_000 },
      { ngay: { loai: "TRONG_KY_T", ngay: 25 }, soTien: 3_000_000 },
    ],
    hoanTienSan: null,
    canKichHoat: ["EVENT"],
    tungKhoan: [
      { ghiChu: "UAT:S09:1", truoc: 360_000, sau: 320_000 },
      { ghiChu: "UAT:S09:2", truoc: 270_000, sau: 240_000 },
      { ghiChu: "UAT:S09:3", truoc: 270_000, sau: 240_000 },
    ],
    kyVong: { truoc: CHUNG_9, sau: KHONG_MKT_8 },
  },
  {
    ma: "S10",
    buoc: [10],
    tieuDe: "Hoàn một phần 4tr trên khoản thu 10tr — dòng ÂM thu hồi theo đúng tỉ lệ",
    nhom: "CENTER_ORGANIC",
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 8 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: { soTien: 4_000_000, ngay: { loai: "TRONG_KY_T", ngay: 28 } },
    canKichHoat: ["CENTER_ORGANIC"],
    tungKhoan: [
      { ghiChu: "UAT:S10:1", truoc: 900_000, sau: 800_000 },
      { ghiChu: "UAT:S10:hoan", truoc: -360_000, sau: -320_000 },
    ],
    // −40% của từng dòng gốc: engine tính, không suy bằng tay ở checklist (xem [UAT-SO-10]).
    kyVong: { truoc: bo(HOC_PHI_UAT * 0.6, { sale: 4, admin: 1, qlcs: 2, mkt: 1, gv: 1 }), sau: bo(HOC_PHI_UAT * 0.6, { sale: 4, admin: 1, qlcs: 2, mkt: 0, gv: 1 }) },
  },
  {
    ma: "S10B",
    buoc: [10],
    tieuDe: "Hoàn TOÀN BỘ khoản 10tr — mọi dòng gốc bị đảo sạch, ròng về 0 (đường `/payments` → Hoàn)",
    nhom: "WALK_IN",
    nguoiGioiThieu: null,
    coGvTrial: true,
    truocKhiKhaiChuNguon: false,
    lanMuaThuHai: false,
    thanhToan: [{ ngay: { loai: "TRONG_KY_T", ngay: 9 }, soTien: HOC_PHI_UAT }],
    hoanTienSan: { soTien: HOC_PHI_UAT, ngay: { loai: "TRONG_KY_T", ngay: 29 } },
    canKichHoat: ["WALK_IN"],
    tungKhoan: [
      { ghiChu: "UAT:S10B:1", truoc: 900_000, sau: 800_000 },
      { ghiChu: "UAT:S10B:hoan", truoc: -900_000, sau: -800_000 },
    ],
    // Đảo sạch, không lệch 1 đồng (`dao-nguoc.ts`: hoàn hết cơ sở ⇒ dao = −rong). Ròng 0 ở cả hai trạng thái.
    kyVong: { truoc: {}, sau: {} },
  },
] as const;

/**
 * Nháp của seed v1 mà bước 3–10 cần KÍCH HOẠT — suy ra từ `canKichHoat` của từng kịch bản (một nguồn duy nhất cho spec `[UAT-SO-*]` và cho tài liệu).
 * Sửa `canKichHoat` của một kịch bản là đổi danh sách này; spec kích hoạt đúng danh sách này nên con số "sau" đổi theo và ca đo đỏ.
 */
export const NHAP_CAN_KICH_HOAT: readonly NhapCanKichHoat[] = [
  ...new Set(KICH_BAN_UAT.flatMap((k) => (k.canKichHoat === "CHINH_SACH_MAU" ? [] : k.canKichHoat))),
];

/** Tổng hoa hồng ròng của CẢ bộ UAT theo kỳ "YYYY-MM" (kỳ của kịch bản = kỳ của khoản thu đầu tiên). `khiNao` = "truoc" (chưa kích hoạt nháp nào) | "sau". */
export function tongTheoKy(kyCutover: string, khiNao: "truoc" | "sau"): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const k of KICH_BAN_UAT) {
    const ky = kyCuaNgay(ngayThuCuaUat(kyCutover, k.thanhToan[0]!.ngay));
    ra[ky] = (ra[ky] ?? 0) + tongTien(k.kyVong[khiNao]);
  }
  return ra;
}

export const tongTien = (v: TienTheoVai): number => Object.values(v).reduce((s, x) => s + (x ?? 0), 0);

/** "1.000.000" — đúng khuôn số tiền in trong checklist. */
export function dinhDangVnd(n: number): string {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 ? `−${s}` : s; // dấu trừ thật (U+2212), đúng khuôn tài liệu
}

// ── Lịch ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Tháng đứng ngay sau tháng của `now` theo giờ VN (UTC+7) — tháng cutover SỚM NHẤT đặt được (`datMocCutover` đòi mốc > tháng hiện tại). */
export function thangCutoverSomNhat(now: Date): string {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth() + 1;
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const cong = (ky: string, soThang: number): string => {
  const [y, m] = ky.split("-").map(Number) as [number, number];
  const t = (y * 12 + (m - 1)) + soThang;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/** Mốc ghi nhận nguồn của MỌI lead UAT: ngày 01 của tháng đứng TRƯỚC tháng cutover, 03:00 UTC (10:00 VN). */
export function mocGhiNhanUat(kyCutover: string): Date {
  return new Date(`${cong(kyCutover, -1)}-01T03:00:00.000Z`);
}

/** Ngày của một khoản thu (03:00 UTC = 10:00 VN: tháng VN luôn trùng tháng UTC). */
export function ngayThuCuaUat(kyCutover: string, n: NgayThu): Date {
  if (n.loai === "TRONG_KY_T") return new Date(`${kyCutover}-${String(n.ngay).padStart(2, "0")}T03:00:00.000Z`);
  return new Date(mocGhiNhanUat(kyCutover).getTime() + n.soNgay * 86_400_000);
}

/** Ngày (trong tháng cutover T) mà chủ nguồn PAID_ADS có hiệu lực. S05B thu ngày 16 (TRƯỚC), S05 thu ngày 20 (SAU) — đây là cặp đối chứng ÂM/DƯƠNG của bước 5. */
export const NGAY_HIEU_LUC_CHU_NGUON_UAT = 18;

/** Mốc hiệu lực chủ nguồn PAID_ADS: 00:00 giờ VN của ngày `NGAY_HIEU_LUC_CHU_NGUON_UAT` tháng T (luôn SAU hôm nay vì T ≥ tháng kế tiếp). */
export function hieuLucChuNguonUat(kyCutover: string): Date {
  return new Date(`${kyCutover}-${String(NGAY_HIEU_LUC_CHU_NGUON_UAT).padStart(2, "0")}T00:00:00+07:00`);
}

/** "YYYY-MM" của một ngày theo giờ VN. */
export const kyCuaNgay = (d: Date): string => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);

/** Số thứ tự (từ 1) của kịch bản trong bộ — gốc của SĐT giả mà bộ nạp gán cho lead. */
export const soThuTuKichBan = (ma: string): number => {
  const i = KICH_BAN_UAT.findIndex((k) => k.ma === ma);
  if (i < 0) throw new Error(`Không có kịch bản ${ma}`);
  return i + 1;
};
/** SĐT giả của lead khách (`09901NNNNN`) và của lead gốc của phụ huynh giới thiệu (`09902NNNNN`) — tiền tố hiếm để không đụng khách thật. */
export const phoneKhachUat = (ma: string): string => `09901${String(soThuTuKichBan(ma)).padStart(5, "0")}`;
export const phonePhUat = (ma: string): string => `09902${String(soThuTuKichBan(ma)).padStart(5, "0")}`;

/** Mã đơn / mã khoản của kịch bản — tiền tố UAT để bộ nạp nhận ra "đã nạp" và để không bao giờ đụng dữ liệu thật. */
export const maDonUat = (ma: string): string => `${TIEN_TO_UAT}${ma}-DON`;
export const maDonGocUat = (ma: string): string => `${TIEN_TO_UAT}${ma}-DON0`;
