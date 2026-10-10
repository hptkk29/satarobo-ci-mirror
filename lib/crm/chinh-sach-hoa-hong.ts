// lib/crm/chinh-sach-hoa-hong.ts — CHÍNH SÁCH HOA HỒNG DO NGƯỜI VẬN HÀNH KHAI.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI, KHI ĐÃ CÓ `lib/crm/commission.ts`
//
// Chủ dự án 14/09/2026: "có thể thêm hoặc bớt các chính sách, thêm bớt các role nhận hoa
// hồng riêng chứ không khoá cứng 1 vài chính sách duy nhất làm lần sau nếu BGĐ ra chính
// sách mới thì dev phải code chính sách mới nữa… làm sao sau khi bàn giao thì dev không
// cần phải đụng gì nhiều nữa."
//
// `commission.ts` khoá cứng bốn tầng bằng union TypeScript:
//   `export type CommissionTier = "QC" | "SALE_ADMIN" | "SALE" | "QL_TT"`
// Thêm một vai nhận hoa hồng = sửa union = dev phải code. Và bốn tầng đó không mô tả nổi
// chính sách đã ban hành (SR.QD.208): có BỐN trục biến thiên — (vai nhận) × (sự kiện) ×
// (loại đơn) × (cách tính) — trong đó hai cách tính KHÔNG phải phần trăm.
//
// ─────────────────────────────────────────────────────────────────────────────
// MỘT CHÍNH SÁCH MANG NHIỀU KHOẢN NHẬN — và đây là phần đã sửa 14/09/2026
//
// Bản đầu để mỗi dòng là (một vai × một tỉ lệ), nên riêng "học viên mới" đã thành NĂM
// dòng rời rạc trông như năm chính sách khác nhau. Chủ dự án: "có thể chọn 1 hoặc nhiều
// thì sẽ giảm bớt được các dòng… có thể gom thành 1 hàng tên chính sách khi có học viên
// mới: trần chính sách bao nhiêu %, loại đơn, các vai nhận, cách tính, nguồn".
//
// Nên MỘT chính sách = một SỰ KIỆN + một LOẠI ĐƠN + danh sách `khoan`, mỗi khoản là
// (vai nhận, giá trị). Gộp đúng cách nghiệp vụ nói: "khi có học viên mới thì chi tổng 9%,
// chia cho năm vai" là MỘT quyết định, không phải năm.
//
// ⚠️ Tỉ lệ nằm trên TỪNG KHOẢN, không phải trên chính sách: TVV 4% · Sale Admin 1% ·
// QL 2% · Marketing 1% · GV 1%. Đặt một tỉ lệ chung rồi chia đều là bịa ra một chính sách
// công văn không hề ban hành.
//
// ─────────────────────────────────────────────────────────────────────────────
// LƯU Ở ĐÂU — và vì sao KHÔNG tạo bảng mới
//
// Chính sách là DỮ LIỆU CẤU HÌNH nhỏ, không phải dữ liệu giao dịch. Nó đi qua
// `SystemSetting` key `crm.commissionPolicies`, nên thừa hưởng sẵn ba thứ mà một bảng mới
// phải tự làm lại: đường ghi BẮT BUỘC LÝ DO, nhật ký kiểm toán, và override theo cơ sở.
//
// ─────────────────────────────────────────────────────────────────────────────
// TRẦN TỔNG TÍNH THEO SỰ KIỆN, KHÔNG CỘNG CHUNG MỘT RỔ
//
// `commission.ts` cộng cả bốn tầng rồi so `crm.commissionMaxTotalRate`. Với chính sách
// thật, cộng tất cả là cộng cả "học viên mới" (9%) lẫn "tái tục" (2%) — ra 11% và báo
// vượt trần, trong khi KHÔNG có đồng học phí nào chịu cả hai sự kiện. Xem `[CSH-04]`.
//
// THUẦN — không Prisma, không DB, không `getSetting`. Người gọi nạp chính sách rồi truyền vào.
// ─────────────────────────────────────────────────────────────────────────────

/** Sự kiện sinh hoa hồng. CHUỖI, không enum Prisma — thêm sự kiện không cần migration. */
export const SU_KIEN = {
  HOC_VIEN_MOI: "HOC_VIEN_MOI",
  TAI_TUC: "TAI_TUC",
  CHUYEN_TRUNG_TAM: "CHUYEN_TRUNG_TAM",
  BAN_THIET_BI: "BAN_THIET_BI",
} as const;
export type SuKienHoaHong = (typeof SU_KIEN)[keyof typeof SU_KIEN];

export const NHAN_SU_KIEN: Record<SuKienHoaHong, string> = {
  HOC_VIEN_MOI: "Học viên mới",
  TAI_TUC: "Tái tục",
  CHUYEN_TRUNG_TAM: "Chuyển trung tâm",
  BAN_THIET_BI: "Bán thiết bị",
};

/** Câu trả lời cho "khoản này chi KHI NÀO" — in thẳng lên màn, không bắt ai suy. */
export const KHI_NAO_CHI: Record<SuKienHoaHong, string> = {
  HOC_VIEN_MOI:
    "Khi một học viên MỚI đóng học phí và kế toán xác nhận đã thu.",
  TAI_TUC:
    "Khi học viên đang học đóng tiếp kỳ sau (tái tục), không phải học viên mới.",
  CHUYEN_TRUNG_TAM:
    "Khi học viên chuyển sang trung tâm khác — chi MỘT LẦN cho nhân sự của trung tâm cũ.",
  BAN_THIET_BI: "Khi bán được thiết bị robot, tính theo số bộ bán ra.",
};

export const KIEU_TINH = {
  /** Giá trị từng khoản là tỉ lệ 0..1 trên số tiền thực thu. */
  PHAN_TRAM: "PHAN_TRAM",
  /** Giá trị từng khoản là SỐ TIỀN mỗi đơn vị hàng (PL05 — Robot Beta 100.000đ/bộ). */
  SO_TIEN_CO_DINH: "SO_TIEN_CO_DINH",
  /** Thưởng theo NGƯỠNG doanh thu kỳ; số tiền nằm ở `bac`, không ở từng khoản. */
  THUONG_THEO_BAC: "THUONG_THEO_BAC",
} as const;
export type KieuTinhHoaHong = (typeof KIEU_TINH)[keyof typeof KIEU_TINH];

export const NHAN_KIEU_TINH: Record<KieuTinhHoaHong, string> = {
  PHAN_TRAM: "% trên số tiền thực thu",
  SO_TIEN_CO_DINH: "Số tiền cố định mỗi đơn vị",
  THUONG_THEO_BAC: "Thưởng theo bậc doanh thu",
};

export const LOAI_DON = { TAT_CA: "TAT_CA", COURSE: "COURSE", PRODUCT: "PRODUCT" } as const;
export type LoaiDonHoaHong = (typeof LOAI_DON)[keyof typeof LOAI_DON];

export const NHAN_LOAI_DON: Record<LoaiDonHoaHong, string> = {
  TAT_CA: "Mọi loại đơn",
  COURSE: "Đơn khoá học",
  PRODUCT: "Đơn sản phẩm",
};

export type BacThuong = {
  /** Doanh thu kỳ ĐẠT TỪ mức này (công văn ghi "≥"). */
  nguong: number;
  thuong: number;
  danhHieu?: string;
};

/** Một khoản chi trong chính sách: ai nhận, nhận bao nhiêu. */
export type KhoanNhan = {
  /**
   * Mã vai nhận — CHUỖI TỰ DO (khớp `RoleDef.code` nếu muốn, nhưng không bắt buộc).
   *
   * ⚠️ Cố ý KHÔNG ràng vào enum/khoá ngoại: đó đúng là thứ chủ dự án bảo bỏ. Màn khai
   * chọn từ danh sách vai CÓ THẬT (kèm tên tiếng Việt), nhưng tầng thuần này chỉ chặn
   * chuỗi rỗng — chính sách mới thường ban hành TRƯỚC khi vai tương ứng được tạo.
   */
  vaiNhan: string;
  /** `PHAN_TRAM`: 0..1 · `SO_TIEN_CO_DINH`: VND · `THUONG_THEO_BAC`: bỏ qua. */
  giaTri: number;
};

export type ChinhSachHoaHong = {
  /** Mã duy nhất, tự sinh từ tên. Dùng làm khoá dòng hoa hồng. */
  ma: string;
  ten: string;
  suKien: SuKienHoaHong;
  loaiDon: LoaiDonHoaHong;
  kieuTinh: KieuTinhHoaHong;
  /** Các khoản chi của chính sách này. Rỗng = chính sách không chi cho ai. */
  khoan: KhoanNhan[];
  bac?: BacThuong[];
  /** Trích dẫn văn bản ban hành. Số tiền không được vô danh — xem `[CSH-06]`. */
  nguon?: string;
  /** Ghi chú của người vận hành — hiện trong dấu ⓘ cạnh tên. */
  ghiChu?: string;
  bat: boolean;
};

export type DongHoaHong = {
  ma: string;
  ten: string;
  vaiNhan: string;
  soTien: number;
};

function so(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Tiền hợp lệ: không âm, không NaN/Infinity, tròn về đồng. */
function tien(n: unknown): number {
  return Math.max(0, Math.round(so(n)));
}

/** Σ giá trị các khoản của MỘT chính sách. Với `PHAN_TRAM` đây là "trần" của chính sách đó. */
export function tongCuaChinhSach(c: ChinhSachHoaHong): number {
  return (c.khoan ?? []).reduce((s, k) => s + so(k.giaTri), 0);
}

/**
 * Sinh các dòng hoa hồng cho MỘT khoản tiền thực thu.
 *
 * Chỉ xét chính sách ĐANG BẬT, khớp `suKien`, và khớp `loaiDon` (hoặc `TAT_CA`).
 * `THUONG_THEO_BAC` KHÔNG sinh dòng ở đây — nó tính trên doanh thu KỲ, không trên từng
 * đơn; dùng `tinhThuongBac`.
 */
export function tinhHoaHongDon(
  don: {
    /** Số tiền THỰC THU của đơn/khoản. */
    soTien: number;
    /** Số đơn vị hàng — chỉ có nghĩa với `SO_TIEN_CO_DINH`. Bỏ trống = 1. */
    soLuong?: number;
    suKien: SuKienHoaHong;
    loaiDon: LoaiDonHoaHong;
  },
  chinhSach: ChinhSachHoaHong[],
): DongHoaHong[] {
  const soTien = tien(don.soTien);
  const soLuongRaw = so(don.soLuong);
  const soLuong = soLuongRaw > 0 ? Math.floor(soLuongRaw) : 1;

  return chinhSach
    .filter(
      (c) =>
        c.bat &&
        c.suKien === don.suKien &&
        (c.loaiDon === LOAI_DON.TAT_CA || c.loaiDon === don.loaiDon) &&
        c.kieuTinh !== KIEU_TINH.THUONG_THEO_BAC,
    )
    .flatMap((c) =>
      (c.khoan ?? []).map((k) => ({
        ma: c.ma,
        ten: c.ten,
        vaiNhan: k.vaiNhan,
        soTien:
          c.kieuTinh === KIEU_TINH.SO_TIEN_CO_DINH
            ? tien(so(k.giaTri) * soLuong)
            : tien(soTien * so(k.giaTri)),
      })),
    );
}

/**
 * Thưởng theo bậc doanh thu kỳ — lấy bậc CAO NHẤT đạt được.
 *
 * ⚠️ KHÔNG cộng dồn các bậc. Công văn: "TVV nhận mức thưởng cao nhất đạt được"; cộng dồn
 * năm bậc là chi gấp ~3,3 lần. Và không phụ thuộc thứ tự người nhập — bảng khai lộn xộn
 * vẫn phải ra đúng, vì đây là ô người vận hành tự gõ.
 */
export function tinhThuongBac(
  doanhThuKy: number,
  bac: BacThuong[] | undefined,
): { thuong: number; danhHieu: string | null } {
  const dt = tien(doanhThuKy);
  const dat = (bac ?? [])
    .filter((b) => dt >= so(b.nguong))
    .sort((a, b) => so(b.nguong) - so(a.nguong))[0];
  return dat
    ? { thuong: tien(dat.thuong), danhHieu: dat.danhHieu ?? null }
    : { thuong: 0, danhHieu: null };
}

/** Σ tỉ lệ % của MỘT rổ (sự kiện × loại đơn). Chỉ cộng `PHAN_TRAM`. */
export function tongTiLeTheoSuKien(
  chinhSach: ChinhSachHoaHong[],
  suKien: SuKienHoaHong,
  loaiDon: LoaiDonHoaHong,
): number {
  return chinhSach
    .filter(
      (c) =>
        c.bat &&
        c.kieuTinh === KIEU_TINH.PHAN_TRAM &&
        c.suKien === suKien &&
        (c.loaiDon === LOAI_DON.TAT_CA || loaiDon === LOAI_DON.TAT_CA || c.loaiDon === loaiDon),
    )
    .reduce((s, c) => s + tongCuaChinhSach(c), 0);
}

/**
 * Kiểm bộ chính sách TRƯỚC khi lưu. Trả danh sách lỗi tiếng Việt (rỗng = hợp lệ).
 *
 * Đây là cổng duy nhất đứng giữa ô nhập của người vận hành và tiền chi ra, nên nó chặn cả
 * những lỗi "trông vô hại": gõ `4` thay vì `0,04` là chi 400% học phí.
 */
export function kiemChinhSach(
  chinhSach: ChinhSachHoaHong[],
  opts: { tranTongTiLe: number },
): string[] {
  const loi: string[] = [];

  const daThay = new Set<string>();
  for (const c of chinhSach) {
    const ten = c.ten?.trim() || c.ma || "(chưa đặt tên)";
    if (!c.ma?.trim()) loi.push("Có chính sách thiếu mã.");
    else if (daThay.has(c.ma)) loi.push(`Mã "${c.ma}" bị trùng.`);
    daThay.add(c.ma);

    if (!c.ten?.trim()) loi.push(`${c.ma || "(thiếu mã)"}: chưa đặt tên chính sách.`);

    const khoan = c.khoan ?? [];
    if (c.kieuTinh !== KIEU_TINH.THUONG_THEO_BAC && khoan.length === 0) {
      loi.push(`${ten}: chưa chọn vai nào nhận khoản này.`);
    }

    const vaiDaThay = new Set<string>();
    for (const k of khoan) {
      if (!k.vaiNhan?.trim()) {
        loi.push(`${ten}: có khoản chưa chọn vai nhận.`);
        continue;
      }
      if (vaiDaThay.has(k.vaiNhan)) {
        // Cùng một vai hai lần trong một chính sách là chi đôi cho cùng một người.
        loi.push(`${ten}: vai "${k.vaiNhan}" bị khai hai lần.`);
      }
      vaiDaThay.add(k.vaiNhan);

      if (c.kieuTinh === KIEU_TINH.PHAN_TRAM) {
        const v = so(k.giaTri);
        if (v < 0 || v > 1) {
          loi.push(
            `${ten} · ${k.vaiNhan}: tỉ lệ phải trong khoảng 0–100% (đang là ${(v * 100).toFixed(2)}%).`,
          );
        }
      } else if (c.kieuTinh === KIEU_TINH.SO_TIEN_CO_DINH) {
        if (so(k.giaTri) < 0) loi.push(`${ten} · ${k.vaiNhan}: số tiền không được âm.`);
      }
    }

    if (c.kieuTinh === KIEU_TINH.THUONG_THEO_BAC) {
      if (!c.bac || c.bac.length === 0) {
        loi.push(`${ten}: kiểu "thưởng theo bậc" nhưng chưa khai bậc nào.`);
      } else if (c.bac.some((b) => so(b.nguong) < 0 || so(b.thuong) < 0)) {
        loi.push(`${ten}: ngưỡng và mức thưởng không được âm.`);
      }
    }
  }

  // Trần theo TỪNG RỔ. Cộng chung mọi sự kiện là báo vượt trần giả — xem đầu file.
  for (const sk of Object.values(SU_KIEN)) {
    for (const ld of [LOAI_DON.COURSE, LOAI_DON.PRODUCT] as LoaiDonHoaHong[]) {
      const tong = tongTiLeTheoSuKien(chinhSach, sk, ld);
      if (tong > opts.tranTongTiLe + 1e-9) {
        loi.push(
          `Tổng tỉ lệ của "${NHAN_SU_KIEN[sk]}" (${NHAN_LOAI_DON[ld]}) là ` +
            `${(tong * 100).toFixed(2)}%, vượt trần ${(opts.tranTongTiLe * 100).toFixed(2)}%. ` +
            `[${sk}]`,
        );
      }
    }
  }

  return loi;
}

/**
 * BỘ MẶC ĐỊNH — chép nguyên văn từ SR.QD.208 (ban hành 01/03/2026).
 *
 * Đây chỉ là GIÁ TRỊ KHỞI ĐẦU khi `SystemSetting` chưa có gì. Người vận hành sửa ở màn
 * Cấu hình vận hành, và từ lúc đó bản trong DB thắng — dev không phải đụng file này nữa.
 *
 * Σ học viên mới = 4% + 1% + 2% + 1% + 1% = 9%, đúng bằng trần `crm.commissionMaxTotalRate`
 * sau lần nới 27/08/2026. Đó không phải trùng hợp: trần được nới lên 9% chính vì tầng
 * giáo viên +1% không còn chỗ dưới trần 8% cũ.
 */
/**
 * ⚠️ MÃ VAI Ở ĐÂY LÀ `RoleDef.code` (RBAC v2), KHÔNG PHẢI enum `Role` của Prisma.
 *
 * Hai hệ mã tồn tại song song và TRÔNG GIỐNG NHAU: enum `Role` có `SALES_CSM`, còn
 * `RoleDef` — thứ màn cấu hình tra tên tiếng Việt — dùng `CENTER_SALES_CSM` và `HO_SALE`.
 * Bản đầu 14/09 gõ theo enum, và hậu quả KHÔNG phải lỗi: màn lặng lẽ in ra mã máy
 * "SALES_CSM" cạnh các vai khác đã dịch, còn dòng hoa hồng thì treo không ai nhận.
 * Ca `[CSH-08]` đối chiếu ngược với `prisma/seed-roles.ts` để lần sau gõ sai là ĐỎ.
 */
export const CHINH_SACH_MAC_DINH: ChinhSachHoaHong[] = [
  {
    ma: "HV_MOI",
    ten: "Hoa hồng học viên mới",
    suKien: "HOC_VIEN_MOI",
    loaiDon: "COURSE",
    kieuTinh: "PHAN_TRAM",
    khoan: [
      { vaiNhan: "CENTER_SALES_CSM", giaTri: 0.04 },
      { vaiNhan: "HO_SALE", giaTri: 0.01 },
      { vaiNhan: "CENTER_MANAGER", giaTri: 0.02 },
      { vaiNhan: "HO_MARKETING", giaTri: 0.01 },
      { vaiNhan: "TEACHER", giaTri: 0.01 },
    ],
    nguon: "SR.QD.208 · PL04 Điều 1 + PL08 Điều 3 + PL04(2) Điều 2",
    ghiChu:
      "Ghi nhận khi học viên hoàn tất thanh toán và kế toán xác nhận. KHÔNG tính trên " +
      "phần miễn/giảm từ ngân sách công ty. Nếu Trung tâm tự khai thác lead thì 1% của " +
      "Sale Admin Hội sở chuyển vào Quỹ chung Trung tâm, và Marketing Hội sở không nhận.",
    bat: true,
  },
  {
    ma: "TAI_TUC",
    ten: "Hoa hồng tái tục",
    suKien: "TAI_TUC",
    loaiDon: "COURSE",
    kieuTinh: "PHAN_TRAM",
    khoan: [
      { vaiNhan: "CENTER_SALES_CSM", giaTri: 0.01 },
      { vaiNhan: "CENTER_MANAGER", giaTri: 0.01 },
    ],
    nguon: "SR.QD.208 · PL04 Điều 1 + PL08 Điều 3",
    ghiChu:
      "Tư vấn viên chỉ nhận nếu VẪN đang chăm sóc khách này. Nghiêm cấm xúi phụ huynh " +
      "cắt hợp đồng rồi đăng ký lại để hưởng mức học viên mới — PL08 Điều 5: chấm dứt " +
      "hợp đồng lao động ngay lập tức.",
    bat: true,
  },
  {
    ma: "CHUYEN_TRUNG_TAM",
    ten: "Hoa hồng khi học viên chuyển trung tâm",
    suKien: "CHUYEN_TRUNG_TAM",
    loaiDon: "COURSE",
    kieuTinh: "PHAN_TRAM",
    khoan: [
      { vaiNhan: "CENTER_SALES_CSM", giaTri: 0.01 },
      { vaiNhan: "CENTER_MANAGER", giaTri: 0.01 },
      { vaiNhan: "TEACHER", giaTri: 0.02 },
    ],
    nguon: "SR.QD.208 · PL08 Điều 4",
    ghiChu:
      "Chi cho nhân sự của trung tâm CŨ, MỘT LẦN tại thời điểm chuyển và khi học viên đã " +
      "đóng đủ tiền. Giáo viên nhận 2% là người đã đào tạo học viên trước đó. Nhân sự " +
      "trung tâm MỚI không nhận hoa hồng lần này, chỉ được tính doanh số.",
    bat: true,
  },
  {
    ma: "BAN_THIET_BI",
    ten: "Hoa hồng bán thiết bị",
    suKien: "BAN_THIET_BI",
    loaiDon: "PRODUCT",
    kieuTinh: "SO_TIEN_CO_DINH",
    khoan: [{ vaiNhan: "MOI_NHAN_SU", giaTri: 50_000 }],
    nguon: "SR.QD.208 · PL05",
    ghiChu:
      "Áp dụng cho TẤT CẢ nhân sự bán được thiết bị, không riêng bộ phận nào. Công văn " +
      "chia hai mức: Bộ Robot Beta 100.000đ/bộ, các thiết bị còn lại 50.000đ/bộ — mức ở " +
      "đây là mức chung; muốn tách riêng Robot Beta thì thêm một chính sách nữa cho đơn " +
      "sản phẩm đó. Cá nhân nhận hoa hồng tự đóng thuế thu nhập cá nhân.",
    bat: true,
  },
  {
    ma: "THUONG_DANH_HIEU_TVV",
    ten: "Thưởng danh hiệu — Tư vấn viên",
    suKien: "HOC_VIEN_MOI",
    loaiDon: "TAT_CA",
    kieuTinh: "THUONG_THEO_BAC",
    khoan: [{ vaiNhan: "CENTER_SALES_CSM", giaTri: 0 }],
    bac: [
      { nguong: 110_000_000, thuong: 1_000_000, danhHieu: "SILVER" },
      { nguong: 150_000_000, thuong: 1_500_000, danhHieu: "GOLD" },
      { nguong: 200_000_000, thuong: 2_000_000, danhHieu: "PLATINUM" },
      { nguong: 250_000_000, thuong: 2_500_000, danhHieu: "TITANIUM" },
      { nguong: 300_000_000, thuong: 3_000_000, danhHieu: "DIAMOND" },
    ],
    nguon: "SR.QD.208 · PL04 Điều 2",
    ghiChu:
      "Thưởng theo doanh thu THÁNG, cộng dồn VỚI hoa hồng chứ không thay thế. Nhận mức " +
      "CAO NHẤT đạt được, không cộng dồn nhiều bậc.",
    bat: true,
  },
  {
    ma: "THUONG_DANH_HIEU_QUAN_LY",
    ten: "Thưởng danh hiệu — Quản lý Trung tâm",
    suKien: "HOC_VIEN_MOI",
    loaiDon: "TAT_CA",
    kieuTinh: "THUONG_THEO_BAC",
    khoan: [{ vaiNhan: "CENTER_MANAGER", giaTri: 0 }],
    bac: [
      { nguong: 220_000_000, thuong: 2_000_000, danhHieu: "SILVER" },
      { nguong: 300_000_000, thuong: 3_000_000, danhHieu: "GOLD" },
      { nguong: 400_000_000, thuong: 4_000_000, danhHieu: "PLATINUM" },
      { nguong: 500_000_000, thuong: 5_000_000, danhHieu: "TITANIUM" },
      { nguong: 600_000_000, thuong: 6_000_000, danhHieu: "DIAMOND" },
    ],
    nguon: "SR.QD.208 · PL08 Điều 2",
    ghiChu:
      "Áp dụng cho Giám đốc và Phó Giám đốc Trung tâm. Ngưỡng CAO HƠN bảng của Tư vấn " +
      "viên — đó là lý do hai bảng bậc phải tách riêng, không dùng chung.",
    bat: true,
  },
];
