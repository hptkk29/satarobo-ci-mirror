/**
 * CHỈ SỐ GIA ĐÌNH — phép tính thuần từ bốn điểm D/I/S/C (0–100) của những người đã có hồ sơ.
 *
 * Nguồn công thức: «Spec Hệ thống DISC Gia đình» mục 4.1–4.6 và 7 (chủ dự án) — đúng thứ các board Disc.dc.html hiển thị:
 *   · Nhịp độ (Pace)  = ((D+I) − (S+C)) / 2     · Trọng tâm (Focus) = ((I+S) − (D+C)) / 2
 *   · Mức va chạm T(A,B) = min(100, khoảng cách Euclid trong mặt phẳng Pace×Focus)   [≥76 cao · 35–75 trung bình · <35 thấp]
 *   · Độ ưu tiên cặp = T × hệ số quan hệ (vợ chồng · cha mẹ–con 1,2 · anh chị em 1,0 · ông bà–cháu 0,9)
 *   · Cặp nóng = tối đa 2 cặp có độ ưu tiên cao nhất và T ≥ 35; không có thì chọn 1 «cặp cần giữ» (cùng nhóm chính ⇒ điểm mù chung)
 *   · Cân bằng B = 100 − 2 × (max M − min M), kẹp 0–100;  B ≥ 70 cân bằng · 40–69 lệch vừa · < 40 lệch mạnh
 *   · Độ phủ: nhóm x được phủ nếu có ≥ 1 người P_x ≥ 60.  Độ tin cậy = số người TỰ LÀM / tổng thành viên.
 *   · Báo cáo mở dần theo bảng 4.6.
 *
 * ⚠️ Đây là phép TOÁN (xu hướng hành vi), không phải lời khuyên. Lời khuyên về trẻ lấy từ engine (config/disc-*).
 * Nhãn hồ sơ (D / Di / Cân bằng) lấy từ `kieu` mà ENGINE đã chấm và lưu — một nguồn duy nhất, không tính lại bằng ngưỡng khác.
 *
 * Thuần, tất định, không đồng hồ.
 */
import { BON_TRUC, type CachLam, type DiemDisc, type Kieu, type MaTruc, type VaiGiaDinh } from "./kieu";

/* ── Một hồ sơ ────────────────────────────────────────────────────────────── */

export type NguoiChiSo = {
  readonly id: string;
  readonly ten: string;
  readonly laTre: boolean;
  readonly vaiTro: VaiGiaDinh;
  readonly diem: DiemDisc;
  readonly kieu: Kieu;
  /** TU_LAM = hồ sơ chính thức · GOC_NHIN = ước lượng (qua mắt chủ sổ). */
  readonly qua: CachLam;
};

export type CuongDo = "rõ" | "vừa" | "nhẹ";

export type HoSoChiSo = {
  readonly chinh: MaTruc;
  /** "D" · "Di" · "Cân bằng". */
  readonly nhan: string;
  readonly cuongDo: CuongDo;
  readonly pace: number;
  readonly focus: number;
};

const lam1 = (x: number) => Math.round(x * 10) / 10;

/** Thứ tự trục giảm dần theo điểm; bằng điểm giữ thứ tự D-I-S-C (khớp engine `xepHangTruc`). */
export function xepHang(diem: DiemDisc): MaTruc[] {
  return [...BON_TRUC].sort((a, b) => diem[b] - diem[a] || BON_TRUC.indexOf(a) - BON_TRUC.indexOf(b));
}

export function nhanTuKieu(kieu: Kieu): string {
  if (kieu.loai === "don") return kieu.truc;
  if (kieu.loai === "pha") return `${kieu.cap[0]}${kieu.cap[1].toLowerCase()}`;
  return "Cân bằng";
}

export function cuongDoCua(diemChinh: number): CuongDo {
  return diemChinh >= 75 ? "rõ" : diemChinh >= 60 ? "vừa" : "nhẹ";
}

export function nhipDo(diem: DiemDisc): number {
  return lam1(((diem.D + diem.I) - (diem.S + diem.C)) / 2);
}
export function trongTam(diem: DiemDisc): number {
  return lam1(((diem.I + diem.S) - (diem.D + diem.C)) / 2);
}

export function hoSoChiSo(diem: DiemDisc, kieu: Kieu): HoSoChiSo {
  const chinh = xepHang(diem)[0]!;
  return { chinh, nhan: nhanTuKieu(kieu), cuongDo: cuongDoCua(diem[chinh]), pace: nhipDo(diem), focus: trongTam(diem) };
}

/* ── Cặp ──────────────────────────────────────────────────────────────────── */

export type MucVaCham = "cao" | "trung-binh" | "thap";
export const NHAN_MUC: Readonly<Record<MucVaCham, string>> = { cao: "Cao", "trung-binh": "Trung bình", thap: "Thấp" };

export function mucVaCham(T: number): MucVaCham {
  return T >= 76 ? "cao" : T >= 35 ? "trung-binh" : "thap";
}

/** T của hai người: khoảng cách trong mặt phẳng (Pace, Focus), kẹp ≤ 100. Đối xứng: T(A,B) = T(B,A). */
export function mucVaChamCap(a: HoSoChiSo, b: HoSoChiSo): number {
  return lam1(Math.min(100, Math.sqrt((a.pace - b.pace) ** 2 + (a.focus - b.focus) ** 2)));
}

const laOngBa = (v: VaiGiaDinh) => v === "ong" || v === "ba";
const laBoMe = (v: VaiGiaDinh) => v === "bo" || v === "me";

/** Hệ số quan hệ của độ ưu tiên (spec 4.4). Ông/bà–cháu 0,9; cha mẹ–con và vợ chồng 1,2; còn lại 1,0. */
export function heSoQuanHe(a: Pick<NguoiChiSo, "laTre" | "vaiTro">, b: Pick<NguoiChiSo, "laTre" | "vaiTro">): number {
  if (a.laTre !== b.laTre) {
    const lon = a.laTre ? b : a;
    return laOngBa(lon.vaiTro) ? 0.9 : 1.2;
  }
  if (a.laTre) return 1.0;
  if ((laBoMe(a.vaiTro) && laBoMe(b.vaiTro) && a.vaiTro !== b.vaiTro) || (laOngBa(a.vaiTro) && laOngBa(b.vaiTro) && a.vaiTro !== b.vaiTro)) {
    return 1.2;
  }
  return 1.0;
}

/** Nhãn quan hệ ngắn của một cặp ("Vợ chồng", "Cha – con", "Mẹ – con", "Ông – cháu", "Anh chị em", "Người lớn"). */
export function nhanQuanHeCap(a: Pick<NguoiChiSo, "laTre" | "vaiTro">, b: Pick<NguoiChiSo, "laTre" | "vaiTro">): string {
  if (a.laTre !== b.laTre) {
    const lon = a.laTre ? b : a;
    if (lon.vaiTro === "bo") return "Cha – con";
    if (lon.vaiTro === "me") return "Mẹ – con";
    if (lon.vaiTro === "ong") return "Ông – cháu";
    if (lon.vaiTro === "ba") return "Bà – cháu";
    return "Người lớn – trẻ";
  }
  if (a.laTre) return "Anh chị em";
  if (heSoQuanHe(a, b) === 1.2) return "Vợ chồng";
  return "Người lớn";
}

export type CapChiSo = {
  readonly aId: string;
  readonly bId: string;
  readonly aTen: string;
  readonly bTen: string;
  readonly T: number;
  readonly muc: MucVaCham;
  readonly heSo: number;
  readonly uuTien: number;
  readonly nhanQuanHe: string;
  /** Hai người cùng nhóm chính ⇒ «điểm mù chung» (null nếu khác nhóm). */
  readonly diemMuChung: MaTruc | null;
  readonly aChinh: MaTruc;
  readonly bChinh: MaTruc;
};

/** Điểm mù chung khi hai người cùng nhóm chính (spec 4.3). */
export const DIEM_MU_CHUNG: Readonly<Record<MaTruc, string>> = {
  D: "Dễ tranh quyền quyết.",
  I: "Dễ quên việc, bốc đồng.",
  S: "Dễ né xung đột.",
  C: "Dễ cầu toàn và chậm quyết định.",
};

/* ── Cả nhà ───────────────────────────────────────────────────────────────── */

export type KieuGiaDinh = { readonly ma: string; readonly ten: string; readonly manh: string; readonly rui: string };

export const KIEU_GIA_DINH: Readonly<Record<"hai-hoa" | "hanh-dong" | "le-hoi" | "to-am" | "ngan-nap", KieuGiaDinh>> = {
  "hai-hoa": { ma: "hai-hoa", ten: "Gia đình Hài hoà", manh: "Linh hoạt, đủ các vai", rui: "Dễ thiếu người dẫn dắt rõ ràng" },
  "hanh-dong": { ma: "hanh-dong", ten: "Gia đình Hành động", manh: "Làm được nhiều việc, quyết nhanh", rui: "Ít thời gian lắng nghe cảm xúc" },
  "le-hoi": { ma: "le-hoi", ten: "Gia đình Lễ hội", manh: "Vui, nhiều hoạt động, cởi mở", rui: "Thiếu kế hoạch, dễ vỡ nề nếp" },
  "to-am": { ma: "to-am", ten: "Gia đình Tổ ấm", manh: "Ấm áp, hoà thuận, gắn bó", rui: "Né va chạm, chậm thay đổi" },
  "ngan-nap": { ma: "ngan-nap", ten: "Gia đình Ngăn nắp", manh: "Kỷ luật, chu đáo, tiết kiệm", rui: "Căng thẳng vì tiêu chuẩn cao" },
};

export function kieuGiaDinhTu(pace: number, focus: number): KieuGiaDinh {
  if (Math.abs(pace) <= 10 && Math.abs(focus) <= 10) return KIEU_GIA_DINH["hai-hoa"];
  if (pace > 0 && focus < 0) return KIEU_GIA_DINH["hanh-dong"];
  if (pace > 0) return KIEU_GIA_DINH["le-hoi"];
  if (focus > 0) return KIEU_GIA_DINH["to-am"];
  return KIEU_GIA_DINH["ngan-nap"];
}

export const VAI_TU_NHIEN: Readonly<Record<MaTruc, { readonly vai: string; readonly gop: string }>> = {
  D: { vai: "Người chốt", gop: "Ra quyết định, xử lý việc khó" },
  I: { vai: "Người kết nối", gop: "Tạo niềm vui, khởi xướng hoạt động" },
  S: { vai: "Người giữ nhịp", gop: "Chăm sóc, hoà giải, giữ nề nếp" },
  C: { vai: "Người chuẩn bị", gop: "Lập kế hoạch, kiểm tra, giữ chất lượng" },
};

/** Việc bù khi cả nhà thiếu một nhóm (spec 7). */
export const VIEC_BU_THIEU: Readonly<Record<MaTruc, string>> = {
  D: "Mỗi việc chung có 1 người chốt và hạn chót",
  I: "Một hoạt động vui cố định mỗi tuần, khen nhau trong bữa tối",
  S: "10 phút «chỉ nghe, không khuyên» mỗi tối",
  C: "Bảng việc nhà và lịch chung dán ở bếp",
};

export type NhanCanBang = "can-bang" | "lech-vua" | "lech-manh";

export function nhanCanBang(B: number): NhanCanBang {
  return B >= 70 ? "can-bang" : B >= 40 ? "lech-vua" : "lech-manh";
}
export const CHU_CAN_BANG: Readonly<Record<NhanCanBang, string>> = {
  "can-bang": "cân bằng",
  "lech-vua": "lệch vừa",
  "lech-manh": "lệch mạnh",
};

export type VaiTuNhien = {
  readonly id: string;
  readonly ten: string;
  readonly truc: MaTruc;
  readonly vai: string;
  readonly gop: string;
  /** false = người cùng nhóm nhưng điểm thấp hơn ⇒ vai phụ. */
  readonly vaiChinh: boolean;
  readonly oc: boolean;
};

export type ChiSoGiaDinh = {
  readonly nguoi: readonly (NguoiChiSo & { readonly hoSo: HoSoChiSo })[];
  readonly cap: readonly CapChiSo[];
  /** Mọi cặp, xếp theo độ ưu tiên giảm dần. */
  readonly capTheoUuTien: readonly CapChiSo[];
  readonly capNong: readonly CapChiSo[];
  /** Chỉ có khi không cặp nào đạt T ≥ 35 mà có cặp cùng nhóm chính. */
  readonly capCanGiu: CapChiSo | null;
  readonly trungBinh: DiemDisc;
  readonly canBang: number;
  readonly nhanCanBang: NhanCanBang;
  readonly diemGiaDinh: { readonly pace: number; readonly focus: number };
  readonly kieu: KieuGiaDinh;
  readonly phu: Readonly<Record<MaTruc, readonly string[]>>;
  readonly thieu: readonly MaTruc[];
  readonly vai: readonly VaiTuNhien[];
  readonly soCapVaChamCao: number;
};

export function tinhChiSoGiaDinh(nguoi: readonly NguoiChiSo[]): ChiSoGiaDinh | null {
  if (nguoi.length === 0) return null;
  const co = nguoi.map((n) => ({ ...n, hoSo: hoSoChiSo(n.diem, n.kieu) }));

  const cap: CapChiSo[] = [];
  for (let i = 0; i < co.length; i++) {
    for (let j = i + 1; j < co.length; j++) {
      const a = co[i]!;
      const b = co[j]!;
      const T = mucVaChamCap(a.hoSo, b.hoSo);
      const heSo = heSoQuanHe(a, b);
      cap.push({
        aId: a.id,
        bId: b.id,
        aTen: a.ten,
        bTen: b.ten,
        T,
        muc: mucVaCham(T),
        heSo,
        uuTien: lam1(T * heSo),
        nhanQuanHe: nhanQuanHeCap(a, b),
        diemMuChung: a.hoSo.chinh === b.hoSo.chinh ? a.hoSo.chinh : null,
        aChinh: a.hoSo.chinh,
        bChinh: b.hoSo.chinh,
      });
    }
  }
  // Bằng độ ưu tiên: giữ thứ tự xuất hiện (ổn định).
  const capTheoUuTien = cap.map((c, i) => ({ c, i })).sort((x, y) => y.c.uuTien - x.c.uuTien || x.i - y.i).map((x) => x.c);
  const capNong = capTheoUuTien.filter((c) => c.T >= 35).slice(0, 2);
  const capCanGiu = capNong.length === 0 ? (capTheoUuTien.find((c) => c.diemMuChung !== null) ?? null) : null;

  const trungBinh = Object.fromEntries(
    BON_TRUC.map((x) => [x, lam1(co.reduce((s, m) => s + m.diem[x], 0) / co.length)]),
  ) as Record<MaTruc, number>;
  const gt = BON_TRUC.map((x) => trungBinh[x]);
  const canBang = Math.max(0, Math.min(100, Math.round(100 - 2 * (Math.max(...gt) - Math.min(...gt)))));
  const diemGiaDinh = {
    pace: lam1(co.reduce((s, m) => s + m.hoSo.pace, 0) / co.length),
    focus: lam1(co.reduce((s, m) => s + m.hoSo.focus, 0) / co.length),
  };

  const phu = Object.fromEntries(
    BON_TRUC.map((x) => [x, co.filter((m) => m.diem[x] >= 60).map((m) => m.ten)]),
  ) as Record<MaTruc, string[]>;
  const thieu = BON_TRUC.filter((x) => phu[x].length === 0);

  const vaiDs = [...co].sort((a, b) => b.diem[b.hoSo.chinh] - a.diem[a.hoSo.chinh]);
  const daCo = new Set<MaTruc>();
  const vai: VaiTuNhien[] = vaiDs.map((m) => {
    const k = m.hoSo.chinh;
    const chinh = !daCo.has(k);
    daCo.add(k);
    return { id: m.id, ten: m.ten, truc: k, vai: VAI_TU_NHIEN[k].vai, gop: VAI_TU_NHIEN[k].gop, vaiChinh: chinh, oc: m.qua === "GOC_NHIN" };
  });

  return {
    nguoi: co,
    cap,
    capTheoUuTien,
    capNong,
    capCanGiu,
    trungBinh,
    canBang,
    nhanCanBang: nhanCanBang(canBang),
    diemGiaDinh,
    kieu: kieuGiaDinhTu(diemGiaDinh.pace, diemGiaDinh.focus),
    phu,
    thieu,
    vai,
    soCapVaChamCao: cap.filter((c) => c.muc === "cao").length,
  };
}

/* ── Độ tin cậy + báo cáo mở dần (spec 4.5–4.6) ───────────────────────────── */

/** Độ tin cậy (%) = số người có hồ sơ TỰ LÀM / tổng thành viên. */
export function doTinCay(soTuLam: number, tongThanhVien: number): number {
  if (tongThanhVien <= 0) return 0;
  return Math.round((soTuLam / tongThanhVien) * 100);
}

export const NGUONG_TIN_CAY = 60;

export type TangBaoCao = {
  /** Tầng 1 — báo cáo cá nhân: mở khi ≥ 1 người có hồ sơ. */
  readonly t1: boolean;
  /** Tầng 2 — thẻ cặp hai chiều: mở khi ≥ 2 người TỰ LÀM. */
  readonly t2: boolean;
  /** Tầng 3 — báo cáo gia đình: mở khi ≥ 3 hồ sơ, trong đó ≥ 2 tự làm. */
  readonly t3: boolean;
  /** Đã mở nhưng độ tin cậy < 60% ⇒ gắn «Bản nháp». */
  readonly nhap: boolean;
  /** Số thẻ chiều cần sinh: n × (n − 1) với n = số người có hồ sơ. */
  readonly soTheChieu: number;
  /** Kế hoạch 7 ngày: cần ≥ 2 người có hồ sơ (kế hoạch sinh từ lát cắt giữa hai người). */
  readonly ke7: boolean;
  /** Kế hoạch 1 tháng: cùng điều kiện tầng 3. */
  readonly ke30: boolean;
  /** Kế hoạch 1 năm: tầng 3 và độ tin cậy ≥ 60%. */
  readonly ke365: boolean;
  readonly tinCay: number;
};

export function tangBaoCaoMo(soTuLam: number, soCoHoSo: number, tongThanhVien: number): TangBaoCao {
  const tinCay = doTinCay(soTuLam, tongThanhVien);
  const t1 = soCoHoSo >= 1;
  const t2 = soTuLam >= 2;
  const t3 = soCoHoSo >= 3 && soTuLam >= 2;
  return {
    t1,
    t2,
    t3,
    nhap: t3 && tinCay < NGUONG_TIN_CAY,
    soTheChieu: soCoHoSo * (soCoHoSo - 1),
    ke7: soCoHoSo >= 2,
    ke30: t3,
    ke365: t3 && tinCay >= NGUONG_TIN_CAY,
    tinCay,
  };
}

/* ── Bản đồ: toạ độ SVG (viewBox 0 0 400 400) ─────────────────────────────── */

/** Trọng tâm → x, nhịp độ → y trên khung 400 (tâm 200). Khớp board Disc.dc.html (±100 → ±180). */
export function toaDoBanDo(pace: number, focus: number): { readonly x: number; readonly y: number } {
  const k = (v: number) => Math.round(v * 10) / 10;
  const kep = (v: number) => Math.max(-100, Math.min(100, v));
  return { x: k(200 + kep(focus) * 1.8), y: k(200 - kep(pace) * 1.8) };
}
