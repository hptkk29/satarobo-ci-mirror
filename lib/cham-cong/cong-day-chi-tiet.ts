// lib/cham-cong/cong-day-chi-tiet.ts — dựng dữ liệu cho màn "Công dạy giáo viên" từ công dạy ĐÃ quy đổi.
//
// THUẦN — không `@/lib/db`, không `next/*`. KHÔNG có luật quy đổi nào ở đây: công của từng buổi lấy từ
// `chiTietCongDay`, tổng lấy từ `congDayCuaNguoi` (cùng file `cong-day.ts`). File này chỉ CHIA NHÓM,
// GẮN CỜ, LỌC, GOM THEO NGÀY và CHE dòng ngoài phạm vi.
//
// ── Ba điều đã cân nhắc ────────────────────────────────────────────────────────────────
//  1. Nhóm (Lớp chính / Dạy thay / Học bù / Khác) chia theo `source` + `role` của BUỔI — đúng hai
//     chiều mà `loaiCua` dùng để chọn dòng danh mục — không theo mã hay tên dòng danh mục (người vận
//     hành đổi tên được, đổi mã được).
//  2. Tổng của mọi lát cắt (ngày, tháng, bộ lọc) gọi lại `congDayCuaNguoi` trên đúng tập buổi của lát
//     đó, không tự cộng `cong` của từng dòng: hàm kia làm tròn theo LOẠI rồi mới cộng, cộng thẳng từng
//     dòng lệch được 0,01 và màn sẽ in hai con số khác nhau cho cùng một tháng.
//  3. Buổi ở cơ sở NGOÀI phạm vi người xem: vẫn tính vào công của giáo viên (công hỏi theo NGƯỜI — xem
//     `cong-day-db.ts`), nhưng dòng chi tiết bị CHE tên lớp/phòng. Mặc định đóng — người quản lý CS1
//     không đọc được lịch lớp của CS2 qua đường này.
import {
  chiTietCongDay,
  congDayCuaNguoi,
  type BuoiDay,
  type DongChiTietCongDay,
  type LoaiCongDay,
  type LyDoKhongTinh,
} from "./cong-day";

export type NhomCongDay = "LOP_CHINH" | "DAY_THAY" | "HOC_BU" | "KHAC";

export const NHAN_NHOM: Record<NhomCongDay, string> = {
  LOP_CHINH: "Lớp chính",
  DAY_THAY: "Dạy thay",
  HOC_BU: "Học bù",
  KHAC: "Loại khác",
};

/** Nhóm của một buổi theo nguồn + vai. Trải nghiệm và trợ giảng ⇒ "Loại khác". */
export function nhomCua(b: Pick<BuoiDay, "source" | "role">): NhomCongDay {
  if (b.source === "MAKEUP") return "HOC_BU";
  if (b.role === "SUBSTITUTE") return "DAY_THAY";
  if (b.source === "CLASS" && b.role === "MAIN") return "LOP_CHINH";
  return "KHAC";
}

export type CanhBao =
  | "KHONG_KHOP_LOAI"
  | "THIEU_GIO"
  | "THAY_NHUNG_CONG_VE_GV_CHINH"
  | "KHONG_CO_GV_CHINH";

export const NHAN_CANH_BAO: Record<CanhBao, string> = {
  KHONG_KHOP_LOAI: "Danh mục KHÔNG có dòng nào cho loại buổi này (kể cả dòng đã tắt) — buổi không có công, thiếu cấu hình",
  THIEU_GIO: "Loại tính theo giờ nhưng buổi không suy được giờ — chưa tính công",
  THAY_NHUNG_CONG_VE_GV_CHINH: "Buổi có ghi người dạy thay nhưng công về giáo viên chính (đã ghi người đứng lớp thực tế)",
  KHONG_CO_GV_CHINH: "Lớp chưa gán giáo viên chính",
};

/**
 * Cờ "Cần kiểm tra" của một dòng — CHỈ đánh dấu, không sửa gì. Hai cờ đầu là lý do buổi rơi khỏi
 * công; hai cờ sau là dữ liệu đáng xem lại dù công vẫn tính.
 *
 * `LOAI_DANG_TAT` KHÔNG phải cờ: người vận hành tắt "Đang dùng" là cách cố ý bỏ một nhóm buổi — cảnh báo
 * cho nó là báo động giả trên mọi buổi của nhóm đó, và người ta sẽ học cách bỏ qua cột "Cần kiểm tra".
 */
export function canhBaoCua(d: DongChiTietCongDay): CanhBao[] {
  const ra: CanhBao[] = [];
  if (d.lyDo === "KHONG_KHOP_LOAI") ra.push("KHONG_KHOP_LOAI");
  if (d.lyDo === "THIEU_GIO") ra.push("THIEU_GIO");
  const h = d.buoi.hienThi;
  if (d.buoi.source === "CLASS" && h) {
    // `actualTeacherId` thắng `substituteTeacherId` theo luật cả module. Ghi cả hai mà người thực tế
    // lại là GV chính thì hai cột đang nói ngược nhau — công đi theo một cột, người đọc nhìn cột kia.
    if (h.gvThayId && d.buoi.role === "MAIN" && d.buoi.userId !== h.gvThayId) ra.push("THAY_NHUNG_CONG_VE_GV_CHINH");
    if (h.gvChinhId == null && d.buoi.role !== "ASSISTANT") ra.push("KHONG_CO_GV_CHINH");
  }
  return ra;
}

/** Trạng thái tính công của dòng — field RIÊNG, không suy từ trạng thái buổi. */
export type TrangThaiCong = "TINH" | "KHONG_TINH";
export const trangThaiCong = (d: DongChiTietCongDay): TrangThaiCong => (d.tinhVaoKy ? "TINH" : "KHONG_TINH");

export const NHAN_LY_DO: Record<LyDoKhongTinh, string> = {
  KHONG_KHOP_LOAI: "Không khớp loại công",
  LOAI_DANG_TAT: "Loại đang tắt",
  THIEU_GIO: "Thiếu giờ",
  KHONG_CONG_VAO_KY: "Loại chỉ theo dõi",
};

/** Bộ lọc của màn — mọi giá trị đến từ `searchParams`, nên giá trị lạ phải rơi về "tất cả". */
export type BoLoc = {
  /** Mã dòng danh mục; null = mọi loại. */
  loai: string | null;
  /** TINH | KHONG_TINH | CAN_KIEM_TRA; null = mọi dòng. */
  trangThai: "TINH" | "KHONG_TINH" | "CAN_KIEM_TRA" | null;
};

export function docBoLoc(sp: { loai?: string; tt?: string }, maLoaiHopLe: readonly string[]): BoLoc {
  const loai = sp.loai && maLoaiHopLe.includes(sp.loai) ? sp.loai : null;
  const tt = sp.tt === "TINH" || sp.tt === "KHONG_TINH" || sp.tt === "CAN_KIEM_TRA" ? sp.tt : null;
  return { loai, trangThai: tt };
}

export function khopBoLoc(d: DongChiTietCongDay, loc: BoLoc): boolean {
  if (loc.loai && d.loai?.code !== loc.loai) return false;
  if (loc.trangThai === "TINH" && !d.tinhVaoKy) return false;
  if (loc.trangThai === "KHONG_TINH" && d.tinhVaoKy) return false;
  if (loc.trangThai === "CAN_KIEM_TRA" && canhBaoCua(d).length === 0) return false;
  return true;
}

/** Tổng của một tập dòng — gọi lại `congDayCuaNguoi` trên đúng các buổi đó (điều 2 ở đầu file). */
export type TongLat = { buoi: number; phut: number; cong: number };
export function tongCua(dongs: readonly DongChiTietCongDay[], danhMuc: readonly LoaiCongDay[]): TongLat {
  const t = congDayCuaNguoi(
    dongs.map((d) => d.buoi),
    danhMuc,
  );
  return {
    buoi: t.tongBuoi,
    phut: t.dong.reduce((s, x) => s + x.phut, 0),
    cong: t.tongCong,
  };
}

// ─── Tổng hợp theo giáo viên ─────────────────────────────────────────────────────────────

export type TongHopGiaoVien = {
  userId: string;
  /**
   * Số buổi theo từng nhóm — cộng lại bằng `tongBuoi`. Đếm buổi KHỚP một loại đang dùng và không thiếu giờ,
   * KỂ CẢ loại "chỉ theo dõi" (tắt "Cộng vào kỳ") — đúng tập `congDayCuaNguoi` đếm vào `tongBuoi`. Vì vậy
   * Tổng buổi có thể lớn hơn số buổi góp vào công; số buổi chỉ theo dõi ở `buoiChiTheoDoi`.
   */
  theoNhom: Record<NhomCongDay, number>;
  tongBuoi: number;
  /** Trong `tongBuoi`, số buổi thuộc loại "chỉ theo dõi" — không góp vào `tongCong`. */
  buoiChiTheoDoi: number;
  /** Tổng phút của các buổi trong `tongBuoi` (buổi không suy được giờ góp 0). */
  tongPhut: number;
  /** Công dạy của kỳ — ĐÚNG số `congDayCuaNguoi(...).tongCong`. */
  tongCong: number;
  canKiemTra: number;
};

export function tongHopGiaoVien(
  userId: string,
  buoi: readonly BuoiDay[],
  danhMuc: readonly LoaiCongDay[],
): TongHopGiaoVien {
  const tong = congDayCuaNguoi(buoi, danhMuc);
  const theoNhom: Record<NhomCongDay, number> = { LOP_CHINH: 0, DAY_THAY: 0, HOC_BU: 0, KHAC: 0 };
  let canKiemTra = 0;
  let buoiChiTheoDoi = 0;
  for (const d of chiTietCongDay(buoi, danhMuc)) {
    // Đúng tập mà `congDayCuaNguoi` đếm vào `tongBuoi`: khớp loại đang dùng, không thiếu giờ.
    if (d.loai && d.lyDo !== "THIEU_GIO") theoNhom[nhomCua(d.buoi)] += 1;
    if (d.lyDo === "KHONG_CONG_VAO_KY") buoiChiTheoDoi += 1;
    if (canhBaoCua(d).length > 0) canKiemTra += 1;
  }
  return {
    userId,
    theoNhom,
    tongBuoi: tong.tongBuoi,
    buoiChiTheoDoi,
    tongPhut: tong.dong.reduce((s, x) => s + x.phut, 0),
    tongCong: tong.tongCong,
    canKiemTra,
  };
}

// ─── Chi tiết một giáo viên ──────────────────────────────────────────────────────────────

export type DongHienThi = {
  /** Khoá ổn định cho React + neo của dòng. */
  key: string;
  nguon: BuoiDay["source"];
  buoiId: string;
  ymd: string;
  gioBatDau: string | null;
  gioKetThuc: string | null;
  gioThuc: boolean;
  nhom: NhomCongDay;
  /** Buổi ở cơ sở người xem KHÔNG có quyền xem ⇒ che tên lớp, phòng, liên kết. */
  biChe: boolean;
  lopId: string | null;
  tenLop: string | null;
  centerId: string | null;
  phong: string | null;
  trangThaiBuoi: string;
  vai: BuoiDay["role"];
  gvChinhId: string | null;
  gvThayId: string | null;
  nguoiDayThucId: string | null;
  phut: number | null;
  loaiCode: string | null;
  loaiTen: string | null;
  coSo: "PER_SESSION" | "PER_HOUR" | null;
  heSo: number | null;
  /** Công của riêng buổi, làm tròn 2 chữ số — chỉ để đọc; tổng KHÔNG cộng từ cột này. */
  cong: number;
  tinhVaoKy: boolean;
  lyDo: LyDoKhongTinh | null;
  canhBao: CanhBao[];
};

export type NgayChiTiet = { ymd: string; dongs: DongHienThi[]; tong: TongLat };

export type ChiTietGiaoVien = {
  ngays: NgayChiTiet[];
  /** Tổng của các dòng ĐANG HIỆN (sau lọc). Không lọc ⇒ bằng đúng dòng của người này ở bảng tổng hợp. */
  tong: TongLat;
  soDong: number;
};

/**
 * Chi tiết tháng của MỘT giáo viên, đã lọc, gom theo ngày, sắp `ngày ↑, giờ bắt đầu ↑`.
 *
 * @param coSoXemDuoc tập cơ sở người xem có quyền — buổi ở cơ sở khác bị che (điều 3 ở đầu file).
 *   Buổi không suy được cơ sở (null) cũng bị che: không biết thuộc đâu thì không chứng minh được là
 *   người xem được phép đọc.
 */
export function chiTietGiaoVien(
  buoi: readonly BuoiDay[],
  danhMuc: readonly LoaiCongDay[],
  loc: BoLoc,
  coSoXemDuoc: ReadonlySet<string>,
): ChiTietGiaoVien {
  const dongs = chiTietCongDay(buoi, danhMuc).filter((d) => khopBoLoc(d, loc));
  const theoNgay = new Map<string, DongChiTietCongDay[]>();
  for (const d of dongs) {
    const ds = theoNgay.get(d.buoi.ymd) ?? [];
    ds.push(d);
    theoNgay.set(d.buoi.ymd, ds);
  }
  const gio = (d: DongChiTietCongDay) => d.buoi.hienThi?.gioBatDau ?? "99:99";
  const ngays: NgayChiTiet[] = [...theoNgay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ymd, ds]) => {
      const sx = [...ds].sort((a, b) => gio(a).localeCompare(gio(b)) || a.buoi.id.localeCompare(b.buoi.id));
      return { ymd, dongs: sx.map((d) => hienThiDong(d, coSoXemDuoc)), tong: tongCua(sx, danhMuc) };
    });
  return { ngays, tong: tongCua(dongs, danhMuc), soDong: dongs.length };
}

function hienThiDong(d: DongChiTietCongDay, coSoXemDuoc: ReadonlySet<string>): DongHienThi {
  const h = d.buoi.hienThi;
  const centerId = h?.centerId ?? null;
  const biChe = !centerId || !coSoXemDuoc.has(centerId);
  return {
    key: `${d.buoi.source}|${d.buoi.id}|${d.buoi.userId}`,
    nguon: d.buoi.source,
    buoiId: d.buoi.id,
    ymd: d.buoi.ymd,
    gioBatDau: h?.gioBatDau ?? null,
    gioKetThuc: h?.gioKetThuc ?? null,
    gioThuc: h?.gioThuc ?? false,
    nhom: nhomCua(d.buoi),
    biChe,
    lopId: biChe ? null : (h?.lopId ?? null),
    tenLop: biChe ? null : (h?.tenLop ?? null),
    centerId,
    phong: biChe ? null : (h?.phong ?? null),
    trangThaiBuoi: h?.trangThai ?? "COMPLETED",
    vai: d.buoi.role,
    // Người dạy chính/thay của buổi ở cơ sở khác cũng là thông tin của cơ sở đó.
    gvChinhId: biChe ? null : (h?.gvChinhId ?? null),
    gvThayId: biChe ? null : (h?.gvThayId ?? null),
    nguoiDayThucId: biChe ? null : (h?.nguoiDayThucId ?? null),
    phut: d.buoi.minutes,
    loaiCode: d.loai?.code ?? null,
    loaiTen: d.loai?.name ?? null,
    coSo: d.loai?.basis ?? null,
    heSo: d.loai?.factor ?? null,
    cong: Math.round(d.cong * 100) / 100,
    tinhVaoKy: d.tinhVaoKy,
    lyDo: d.lyDo,
    canhBao: canhBaoCua(d),
  };
}

// ─── Phạm vi người xem ───────────────────────────────────────────────────────────────────

/**
 * Giáo viên được chọn qua `?gv=` CHỈ hợp lệ khi nằm trong tập người của khối đang xem (tập mà trang
 * đã dựng bằng `scopedDb`). Nhận thẳng chuỗi trên URL là để QLCS CS1 gõ id một giáo viên chỉ dạy
 * CS2 rồi đọc lịch của người đó.
 */
export function gvHopLe(gv: string | null | undefined, nguoiCuaKhoi: ReadonlySet<string>): string | null {
  return gv && nguoiCuaKhoi.has(gv) ? gv : null;
}
