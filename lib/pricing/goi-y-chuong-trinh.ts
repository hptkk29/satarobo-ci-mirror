// lib/pricing/goi-y-chuong-trinh.ts — "HỆ THỐNG GỢI Ý CHƯƠNG TRÌNH GIẢM, SALE XÁC NHẬN" cho một dòng đơn theo phạm vi học. THUẦN.
//
// 🔴 CHƯA NỐI VÀO ĐÂU CẢ (đợt thiết kế `docs/thu-hoc-phi-pham-vi/CHON-CHUONG-TRINH-GIAM.md`): không đường tạo đơn nào gọi file này, cờ
// `billing.scopePurchaseEnabled` vẫn TẮT, không cột DB nào được thêm. Nó chứng minh MỘT điều trước khi đụng schema: bảng giảm của
// SR.QD.233 (Bảng A/B + anh chị em + trần 25%) biểu diễn được hoàn toàn bằng DỮ LIỆU — danh sách chương trình có ĐIỀU KIỆN — và cho
// đúng từng đồng như hằng `CHINH_SACH_PL02` (xem `goi-y-chuong-trinh.test.ts`, đối chiếu 100 dòng oracle độc lập).
//
// ── PHÂN CHIA VIỆC ───────────────────────────────────────────────────────────────────────────────────
//   · "Chương trình này có DÙNG ĐƯỢC cho dòng không" (đang bật, còn lượt, hiệu lực văn bản, cơ sở, khoá, mức tối thiểu) đã có ở
//     `lib/khuyen-mai/ap-vao-don.ts` (`locMaChoDong`). File này NHẬN danh sách đã lọc, KHÔNG viết lại điều kiện đó.
//   · File này chỉ làm phần MỚI: điều kiện theo SỐ BUỔI / THỨ TỰ CON / THỨ TỰ SẢN PHẨM 48, "một mức nền cao nhất" (Đ4.2), cộng thêm,
//     trần tổng (Đ3.3) và chụp snapshot v2.
//
// ── LUẬT CỘNG (SR.QD.233 Đ3.3 + Đ4.2) ─────────────────────────────────────────────────────────────────
//   · NỀN (`BASE`): chỉ MỘT — mức CAO NHẤT trong các chương trình nền khớp dòng. Hoà ⇒ giữ thứ tự đầu vào.
//   · CỘNG THÊM (`ADD_ON`): cộng TẤT CẢ chương trình khớp, tính trên NIÊM YẾT (không lũy tiến — cùng luật `gopGiamGia`, chốt 15/09).
//   · TRẦN: tổng % bị cắt ở `tranTong` (null = không trần). Cắt theo TIỀN, từng khoản theo thứ tự nền → cộng thêm, nên
//     Σ thành phần LUÔN bằng đúng tổng giảm (như `gopGiamGia`: người đọc cộng tay ra đúng số).
//
// 🔴 KHÔNG LÀM TRÒN (QĐ-34). Một khoản giảm `niêm yết × % ÷ 100` không ra số nguyên đồng ⇒ ném `LoiGoiY("PRICE_NOT_INTEGER")`; không đoán,
// không cắt cụt. Không `Math.round/floor/ceil/trunc` ở đây (`[TGM-PIN-03]` quét cả thư mục này).
//
// ── SNAPSHOT V2 / CHỐNG GIẢM TRÙNG ────────────────────────────────────────────────────────────────────
// `pricingSnapshot` v1 (`bao-gia-dong.ts`) lưu `unitPrice` = số SAU giảm và KHÔNG có `schemaVersion`. Snapshot v2 lưu `unitPrice` = NIÊM YẾT
// kèm danh sách thành phần. Dòng nào là mô hình nào nhận biết bằng DỮ LIỆU (`moHinhCuaSnapshot`), không bằng cờ: v1 ⇒ giá đã giảm ⇒
// `duocGoiYChoDong` = không, không bao giờ gợi ý / cộng thêm lần hai. Dòng KHÔNG có snapshot cũng chỉ được gợi ý khi nó chưa mang khoản giảm nào.

import type { CuaSoHieuLuc } from "./hieu-luc-chinh-sach";

export type NhomGiam = "BASE" | "ADD_ON";

/** Khoảng thứ tự 1-based, hai đầu TÍNH CẢ. `den = null` = "từ `tu` trở đi" (vd "con thứ ba trở đi"). */
export interface KhoangThuTu {
  readonly tu: number;
  readonly den: number | null;
}

/** Điều kiện MỚI của chương trình. Trường rỗng / null = KHÔNG giới hạn theo chiều đó. */
export interface DieuKienGiam {
  /** Các số buổi được áp. RỖNG = mọi số buổi. */
  readonly soBuoi: readonly number[];
  readonly thuTuCon: KhoangThuTu | null;
  /** Thứ tự sản phẩm gói 48 (Bảng B). Dòng KHÔNG mua đủ 48 buổi có `thuTuSanPham48 = null` ⇒ không khớp điều kiện này. */
  readonly thuTuSanPham48: KhoangThuTu | null;
}

/** Một chương trình ứng viên — đã qua lọc "dùng được cho dòng" của `locMaChoDong`. */
export interface UngVienGiam {
  /** `Voucher.id`. */
  readonly id: string;
  readonly ma: string;
  /** `PromotionPolicy.documentCode`. */
  readonly maVanBan: string;
  readonly ten: string;
  readonly nhom: NhomGiam;
  /** Số NGUYÊN 1..100. */
  readonly phanTram: number;
  readonly dieuKien: DieuKienGiam;
  /** Dấu vết phiên bản văn bản lúc gợi ý (vd `updatedAt` + băm nội dung). Chụp NGUYÊN vào snapshot. */
  readonly phienBan: string;
}

/** Bối cảnh của MỘT dòng — máy chủ tự suy, không tin client. */
export interface NguCanhGoiY {
  readonly soBuoi: number;
  /** Thứ tự CON trong gia đình, 1-based. */
  readonly thuTuCon: number;
  /** Thứ tự sản phẩm gói 48; `null` khi dòng không mua đủ 48 buổi. */
  readonly thuTuSanPham48: number | null;
  /** Giá niêm yết tại mốc (nguyên đồng) = `gia48 × số buổi ÷ 48`. */
  readonly niemYet: number;
}

export type MaLoiGoiY = "NGU_CANH_KHONG_HOP_LE" | "UNG_VIEN_KHONG_HOP_LE" | "PRICE_NOT_INTEGER" | "NGAY_KHONG_HOP_LE";

export class LoiGoiY extends Error {
  constructor(
    public readonly ma: MaLoiGoiY,
    message: string,
  ) {
    super(message);
    this.name = "LoiGoiY";
  }
}

export interface ThanhPhanGiam {
  readonly id: string;
  readonly ma: string;
  readonly maVanBan: string;
  readonly ten: string;
  readonly nhom: NhomGiam;
  readonly phienBan: string;
  /** % ghi trong chương trình. */
  readonly phanTram: number;
  /** Số tiền thật sự trừ (đã kẹp theo trần). */
  readonly soTien: number;
  /** `true` khi khoản này bị cắt bớt (hoặc về 0) vì chạm trần. */
  readonly biCat: boolean;
  /** Điều kiện đã khớp — để Sale đọc "vì sao" và để đối soát. */
  readonly dieuKienKhop: { readonly soBuoi: number; readonly thuTuCon: number; readonly thuTuSanPham48: number | null };
}

export interface LoaiTruGiam {
  readonly id: string;
  readonly ten: string;
  readonly phanTram: number;
  readonly lyDo: "CO_MUC_NEN_CAO_HON";
}

export interface KetQuaGoiY {
  readonly niemYet: number;
  readonly thanhPhan: readonly ThanhPhanGiam[];
  /** Σ % trước khi cắt trần. */
  readonly tongPhanTramDanhNghia: number;
  /** % thật sự áp = MIN(danh nghĩa, trần). */
  readonly phanTramApDung: number;
  readonly tranTong: number | null;
  readonly biCatTran: boolean;
  readonly giamGia: number;
  /** Niêm yết − giảm. */
  readonly thanhTien: number;
  /** Chương trình nền khớp nhưng thua mức nền cao hơn (Đ4.2) — hiện ra để Sale hiểu vì sao không được cộng. */
  readonly loaiTru: readonly LoaiTruGiam[];
}

const laNguyenDuong = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1;

function trongKhoang(k: KhoangThuTu, v: number): boolean {
  return v >= k.tu && (k.den === null || v <= k.den);
}

/** Điều kiện khớp dòng? Chiều nào để trống thì không xét. Chiều có khai mà dòng thiếu dữ liệu (`null`) ⇒ KHÔNG khớp (fail-closed). */
export function khopDieuKien(dk: DieuKienGiam, ctx: NguCanhGoiY): boolean {
  if (dk.soBuoi.length > 0 && !dk.soBuoi.includes(ctx.soBuoi)) return false;
  if (dk.thuTuCon !== null && !trongKhoang(dk.thuTuCon, ctx.thuTuCon)) return false;
  if (dk.thuTuSanPham48 !== null) {
    if (ctx.thuTuSanPham48 === null || !trongKhoang(dk.thuTuSanPham48, ctx.thuTuSanPham48)) return false;
  }
  return true;
}

function kiemKhoang(k: KhoangThuTu | null, ten: string, id: string): void {
  if (k === null) return;
  if (!laNguyenDuong(k.tu) || (k.den !== null && (!laNguyenDuong(k.den) || k.den < k.tu))) {
    throw new LoiGoiY("UNG_VIEN_KHONG_HOP_LE", `Chương trình ${id}: khoảng ${ten} không hợp lệ.`);
  }
}

function tienTheoPhanTram(niemYet: number, phanTram: number, ten: string): number {
  const tu = niemYet * phanTram;
  if (tu % 100 !== 0) {
    throw new LoiGoiY("PRICE_NOT_INTEGER", `Giảm ${phanTram}% của ${niemYet}đ (${ten}) không ra số nguyên đồng.`);
  }
  return tu / 100;
}

/**
 * Gợi ý các chương trình áp cho MỘT dòng. `ungVien` là danh sách ĐÃ lọc bằng `locMaChoDong`.
 * Hàm thuần, kết quả KHÔNG phụ thuộc thứ tự đầu vào (ngoài việc phân xử hoà ở nền cao nhất và thứ tự in thành phần).
 */
export function goiYChuongTrinh(ctx: NguCanhGoiY, ungVien: readonly UngVienGiam[], tranTong: number | null): KetQuaGoiY {
  if (!laNguyenDuong(ctx.soBuoi) || !laNguyenDuong(ctx.thuTuCon) || !laNguyenDuong(ctx.niemYet)) {
    throw new LoiGoiY("NGU_CANH_KHONG_HOP_LE", "Số buổi, thứ tự con và giá niêm yết phải là số nguyên dương.");
  }
  if (ctx.thuTuSanPham48 !== null && !laNguyenDuong(ctx.thuTuSanPham48)) {
    throw new LoiGoiY("NGU_CANH_KHONG_HOP_LE", "Thứ tự sản phẩm 48 phải là số nguyên dương hoặc để trống.");
  }
  if (tranTong !== null && (!Number.isInteger(tranTong) || tranTong < 1 || tranTong > 100)) {
    throw new LoiGoiY("NGU_CANH_KHONG_HOP_LE", "Trần tổng phải là số nguyên 1..100 hoặc để trống.");
  }
  for (const u of ungVien) {
    if (!Number.isInteger(u.phanTram) || u.phanTram < 1 || u.phanTram > 100) {
      throw new LoiGoiY("UNG_VIEN_KHONG_HOP_LE", `Chương trình ${u.id}: phần trăm phải là số nguyên 1..100.`);
    }
    kiemKhoang(u.dieuKien.thuTuCon, "thứ tự con", u.id);
    kiemKhoang(u.dieuKien.thuTuSanPham48, "thứ tự sản phẩm 48", u.id);
  }

  const khop = ungVien.filter((u) => khopDieuKien(u.dieuKien, ctx));
  const nen = khop.filter((u) => u.nhom === "BASE");
  // Một mức nền DUY NHẤT — mức cao nhất; hoà giữ thứ tự đầu vào (Array.sort ổn định, nhưng ở đây chỉ cần lấy phần tử đầu của ≥ lớn nhất).
  let nenChon: UngVienGiam | null = null;
  for (const u of nen) if (nenChon === null || u.phanTram > nenChon.phanTram) nenChon = u;
  const loaiTru: LoaiTruGiam[] = nen.filter((u) => u !== nenChon).map((u) => ({ id: u.id, ten: u.ten, phanTram: u.phanTram, lyDo: "CO_MUC_NEN_CAO_HON" as const }));
  const chon: UngVienGiam[] = [...(nenChon ? [nenChon] : []), ...khop.filter((u) => u.nhom === "ADD_ON")];

  const tongDanhNghia = chon.reduce((s, u) => s + u.phanTram, 0);
  const phanTramApDung = tranTong === null ? tongDanhNghia : tongDanhNghia > tranTong ? tranTong : tongDanhNghia;
  // Trần tính bằng TIỀN, rồi cắt dần từng khoản theo thứ tự nền → cộng thêm.
  let conTrongTran = tienTheoPhanTram(ctx.niemYet, phanTramApDung, "tổng sau trần");
  const thanhPhan: ThanhPhanGiam[] = chon.map((u) => {
    const muon = tienTheoPhanTram(ctx.niemYet, u.phanTram, u.ma);
    const soTien = muon < conTrongTran ? muon : conTrongTran;
    conTrongTran -= soTien;
    return {
      id: u.id,
      ma: u.ma,
      maVanBan: u.maVanBan,
      ten: u.ten,
      nhom: u.nhom,
      phienBan: u.phienBan,
      phanTram: u.phanTram,
      soTien,
      biCat: soTien < muon,
      dieuKienKhop: { soBuoi: ctx.soBuoi, thuTuCon: ctx.thuTuCon, thuTuSanPham48: ctx.thuTuSanPham48 },
    };
  });
  const giamGia = thanhPhan.reduce((s, t) => s + t.soTien, 0);
  return {
    niemYet: ctx.niemYet,
    thanhPhan,
    tongPhanTramDanhNghia: tongDanhNghia,
    phanTramApDung,
    tranTong,
    biCatTran: tranTong !== null && tongDanhNghia > tranTong,
    giamGia,
    thanhTien: ctx.niemYet - giamGia,
    loaiTru,
  };
}

// ── SNAPSHOT V2 ──────────────────────────────────────────────────────────────────────────────────────

export const PHIEN_BAN_SNAPSHOT_V2 = 2 as const;
export const MO_HINH_V2 = "NIEM_YET_CONG_GIAM_DONG" as const;

export type MocNgayXet = "ORDER_CREATED" | "PAYMENT_RECEIVED";

export interface SnapshotGoiYV2 {
  readonly schemaVersion: typeof PHIEN_BAN_SNAPSHOT_V2;
  readonly moHinh: typeof MO_HINH_V2;
  readonly gia48: number;
  readonly nguonGia48: string;
  readonly soBuoi: number;
  readonly thuTuCon: number;
  readonly thuTuSanPham48: number | null;
  readonly niemYet: number;
  /** Chép GIÁ TRỊ từng thành phần (không chỉ tham chiếu id): văn bản khuyến mãi sửa tại chỗ được. */
  readonly thanhPhan: readonly ThanhPhanGiam[];
  readonly tongPhanTramDanhNghia: number;
  readonly phanTramApDung: number;
  readonly tranTong: number | null;
  readonly biCatTran: boolean;
  readonly giamGia: number;
  readonly thanhTien: number;
  /** Mốc ngày dùng để chọn phiên bản chính sách, và ngày thật (ISO). */
  readonly moc: MocNgayXet;
  readonly ngayXet: string;
  readonly goiYLuc: string;
  readonly nguoiXacNhan: string | null;
  readonly xacNhanLuc: string | null;
  /** Các lần xét lại khi tiền về (QĐ-33). CHỈ THÊM, không sửa các trường trên: số tiền của báo giá không bao giờ tự đổi. */
  readonly cacLanXetLai: readonly LanXetLaiKhiTienVe[];
}

export interface DauVaoSnapshotV2 {
  readonly gia48: number;
  readonly nguonGia48: string;
  readonly ctx: NguCanhGoiY;
  readonly ketQua: KetQuaGoiY;
  readonly moc: MocNgayXet;
  readonly ngayXet: Date;
  readonly goiYLuc: Date;
  readonly nguoiXacNhan?: string | null;
  readonly xacNhanLuc?: Date | null;
}

/** Sao chép SÂU rồi đóng băng: sửa chương trình / kết quả gốc về sau không được làm đổi snapshot đã chụp. */
export function dungSnapshotV2(v: DauVaoSnapshotV2): SnapshotGoiYV2 {
  const k = v.ketQua;
  const snap: SnapshotGoiYV2 = {
    schemaVersion: PHIEN_BAN_SNAPSHOT_V2,
    moHinh: MO_HINH_V2,
    gia48: v.gia48,
    nguonGia48: v.nguonGia48,
    soBuoi: v.ctx.soBuoi,
    thuTuCon: v.ctx.thuTuCon,
    thuTuSanPham48: v.ctx.thuTuSanPham48,
    niemYet: k.niemYet,
    thanhPhan: k.thanhPhan.map((t) => Object.freeze({ ...t, dieuKienKhop: Object.freeze({ ...t.dieuKienKhop }) })),
    tongPhanTramDanhNghia: k.tongPhanTramDanhNghia,
    phanTramApDung: k.phanTramApDung,
    tranTong: k.tranTong,
    biCatTran: k.biCatTran,
    giamGia: k.giamGia,
    thanhTien: k.thanhTien,
    moc: v.moc,
    ngayXet: v.ngayXet.toISOString(),
    goiYLuc: v.goiYLuc.toISOString(),
    nguoiXacNhan: v.nguoiXacNhan ?? null,
    xacNhanLuc: v.xacNhanLuc ? v.xacNhanLuc.toISOString() : null,
    cacLanXetLai: [],
  };
  return Object.freeze({ ...snap, thanhPhan: Object.freeze(snap.thanhPhan), cacLanXetLai: Object.freeze([]) });
}

export type MoHinhGiaDong = "V1_GIA_DA_GIAM" | "V2_NIEM_YET_CONG_GIAM_DONG" | "KHONG_CO";

/**
 * Dòng này đang ở mô hình giá nào — suy từ DỮ LIỆU của snapshot (`unknown` vì đọc từ JSON).
 *   · không có snapshot            ⇒ KHONG_CO (dòng mới / không phải phạm vi);
 *   · `schemaVersion === 2` đúng mô hình ⇒ V2;
 *   · CÒN LẠI (v1 không có `schemaVersion`, hoặc phiên bản lạ) ⇒ V1 — fail-closed: coi là ĐÃ giảm.
 */
export function moHinhCuaSnapshot(snapshot: unknown): MoHinhGiaDong {
  if (snapshot === null || snapshot === undefined) return "KHONG_CO";
  if (typeof snapshot !== "object") return "V1_GIA_DA_GIAM";
  const s = snapshot as { schemaVersion?: unknown; moHinh?: unknown };
  return s.schemaVersion === PHIEN_BAN_SNAPSHOT_V2 && s.moHinh === MO_HINH_V2 ? "V2_NIEM_YET_CONG_GIAM_DONG" : "V1_GIA_DA_GIAM";
}

export type LyDoKhongGoiY =
  | "KHONG_PHAI_DONG_PHAM_VI"
  | "SNAPSHOT_V1_GIA_DA_GIAM"
  | "DONG_DA_CO_KHOAN_GIAM"
  | "SNAPSHOT_V2_KHONG_NHAT_QUAN";

export type QuyetDinhGoiY = { readonly duoc: true } | { readonly duoc: false; readonly lyDo: LyDoKhongGoiY };

export interface DongDeXetGoiY {
  /** Máy chủ biết dòng này là dòng phạm vi (12/24/36/48) hay không — KHÔNG mặc định, người gọi phải khai. */
  readonly laDongPhamVi: boolean;
  /** `OrderItem.metadata.pricingSnapshot` đọc từ JSON (`unknown`). */
  readonly snapshot: unknown;
  /** Số khoản giảm tay + mã khuyến mãi ĐÃ nằm trên dòng. Chỉ có nghĩa với dòng CHƯA có snapshot (xem bên dưới). */
  readonly soKhoanGiamGhiSan: number;
  readonly unitPrice: number;
}

/** Snapshot v2 phải tự nhất quán VÀ khớp dòng: `unitPrice` = niêm yết, Σ thành phần = tổng giảm, thành tiền = niêm yết − giảm. */
function snapshotV2NhatQuan(snapshot: unknown, unitPrice: number): boolean {
  const s = snapshot as { niemYet?: unknown; giamGia?: unknown; thanhTien?: unknown; thanhPhan?: unknown };
  if (typeof s.niemYet !== "number" || typeof s.giamGia !== "number" || typeof s.thanhTien !== "number") return false;
  if (!Array.isArray(s.thanhPhan)) return false;
  let tong = 0;
  for (const p of s.thanhPhan as readonly { soTien?: unknown }[]) {
    if (typeof p?.soTien !== "number") return false;
    tong += p.soTien;
  }
  return s.niemYet === unitPrice && tong === s.giamGia && s.thanhTien === s.niemYet - s.giamGia;
}

/**
 * Dòng này có được gợi ý chương trình không? Chặn GIẢM TRÙNG theo DỮ LIỆU của dòng, không theo cờ:
 *   · không phải dòng phạm vi            ⇒ không (đường cũ nguyên văn);
 *   · snapshot v1 / phiên bản lạ        ⇒ không: `unitPrice` ĐÃ là số sau giảm (fail-closed, xem `moHinhCuaSnapshot`);
 *   · CHƯA có snapshot mà đã có khoản giảm tay / mã ⇒ không: gợi ý nữa là cộng chồng lên khoản người ta đã chọn;
 *   · snapshot v2 ⇒ chỉ khi tự nhất quán và `unitPrice` = niêm yết (nếu không, giá trong dòng không còn là niêm yết).
 * KHÔNG quy định ở đây: khoản giảm khác được cộng THÊM trên dòng v2 hay không, và có vượt trần 25% không — đó là D3/D5, chưa chốt.
 */
export function duocGoiYChoDong(dong: DongDeXetGoiY): QuyetDinhGoiY {
  if (!dong.laDongPhamVi) return { duoc: false, lyDo: "KHONG_PHAI_DONG_PHAM_VI" };
  const mo = moHinhCuaSnapshot(dong.snapshot);
  if (mo === "V1_GIA_DA_GIAM") return { duoc: false, lyDo: "SNAPSHOT_V1_GIA_DA_GIAM" };
  if (mo === "V2_NIEM_YET_CONG_GIAM_DONG") {
    return snapshotV2NhatQuan(dong.snapshot, dong.unitPrice) ? { duoc: true } : { duoc: false, lyDo: "SNAPSHOT_V2_KHONG_NHAT_QUAN" };
  }
  return dong.soKhoanGiamGhiSan > 0 ? { duoc: false, lyDo: "DONG_DA_CO_KHOAN_GIAM" } : { duoc: true };
}

// ── ĐỔI CHÍNH SÁCH GIỮA BÁO GIÁ VÀ TIỀN VỀ (QĐ-33 vs Q24, MT-02) ────────────────────────────────────

export type LyDoLech = "PHIEN_BAN" | "THANH_PHAN" | "PHAN_TRAM" | "SO_TIEN" | "NIEM_YET";

export interface KetQuaSoLech {
  readonly khac: boolean;
  readonly lyDo: readonly LyDoLech[];
  /** `xetLai.giamGia − snapshot.giamGia`: dương = xét lại giảm NHIỀU hơn lúc báo giá (khách phải đóng ÍT hơn). */
  readonly chenhLechGiamGia: number;
}

/**
 * So kết quả xét lại (vd lúc tiền về) với snapshot lúc báo giá. CHỈ BÁO — không đổi số tiền nào: người gọi đưa kết quả
 * cho kế toán / QLCS (`CHENH_LECH_CHINH_SACH`), vì luật vận hành thu thiếu / thừa / nhiều lần chưa chốt (D2).
 */
export function phatHienDoiChinhSach(snapshot: SnapshotGoiYV2, xetLai: KetQuaGoiY): KetQuaSoLech {
  const lyDo: LyDoLech[] = [];
  const khoa = (t: { id: string; phanTram: number; phienBan: string }) => `${t.id}\u0000${t.phanTram}\u0000${t.phienBan}`;
  const cu = snapshot.thanhPhan;
  const moi = xetLai.thanhPhan;
  const idCu = [...cu.map((t) => t.id)].sort().join(",");
  const idMoi = [...moi.map((t) => t.id)].sort().join(",");
  if (idCu !== idMoi) lyDo.push("THANH_PHAN");
  else {
    if ([...cu.map(khoa)].sort().join("|") !== [...moi.map(khoa)].sort().join("|")) {
      // Cùng tập chương trình nhưng khác nội dung: tách "đổi % " với "chỉ đổi phiên bản văn bản".
      const phanTramCu = [...cu.map((t) => `${t.id}:${t.phanTram}`)].sort().join(",");
      const phanTramMoi = [...moi.map((t) => `${t.id}:${t.phanTram}`)].sort().join(",");
      lyDo.push(phanTramCu !== phanTramMoi ? "PHAN_TRAM" : "PHIEN_BAN");
    }
  }
  // Giá niêm yết đổi (Course.price sửa giữa báo giá và tiền về) cũng là chênh lệch, kể cả khi chương trình y nguyên.
  if (snapshot.niemYet !== xetLai.niemYet) lyDo.push("NIEM_YET");
  if (snapshot.giamGia !== xetLai.giamGia && !lyDo.includes("PHAN_TRAM") && !lyDo.includes("THANH_PHAN") && !lyDo.includes("NIEM_YET")) lyDo.push("SO_TIEN");
  return { khac: lyDo.length > 0, lyDo, chenhLechGiamGia: xetLai.giamGia - snapshot.giamGia };
}

// ── XÉT LẠI KHI TIỀN VỀ (QĐ-33: chính sách theo NGÀY TIỀN VỀ) ───────────────────────────────────────
// Chủ dự án chốt "23, 24: theo câu 23" (18/10/2026) ⇒ nguyên tắc ngày = ngày tiền về. Còn MỞ (D2): số tiền in trên QR, thu thiếu / thừa /
// nhiều lần (ngày của khoản ĐẦU hay khoản ĐỦ SỐ), đơn tạo 30/12 tiền về 02/01, thứ tự con theo đơn hay theo tiền. Vì vậy hàm dưới đây
// nhận `ngayTienVe` do NGƯỜI GỌI quyết định (không mặc định, không suy), và chỉ GHI NHẬN kết quả — không đổi số tiền nào.

export type TrangThaiXetLai = "KHOP" | "CHENH_LECH_CHINH_SACH" | "NGOAI_HIEU_LUC";

export interface LanXetLaiKhiTienVe {
  /** Ngày tiền về mà người gọi chọn để xét (ISO). */
  readonly ngayTienVe: string;
  readonly xetLaiLuc: string;
  readonly trangThai: TrangThaiXetLai;
  readonly lyDo: readonly LyDoLech[];
  /** `giảm lúc xét lại − giảm lúc báo giá`; `null` khi ngày tiền về nằm ngoài hiệu lực nên không có kết quả xét lại. */
  readonly chenhLechGiamGia: number | null;
  /** Bản chép giá trị các thành phần lúc xét lại (rỗng khi NGOAI_HIEU_LUC). */
  readonly thanhPhanXetLai: readonly ThanhPhanGiam[];
}

export interface DauVaoXetLai {
  readonly ngayTienVe: Date;
  readonly xetLaiLuc: Date;
  readonly hieuLuc: CuaSoHieuLuc;
  /** Kết quả `goiYChuongTrinh` tính bằng chính sách hiệu lực NGÀY TIỀN VỀ. Bỏ qua khi ngày nằm ngoài hiệu lực (có thể `null`). */
  readonly ketQuaXetLai: KetQuaGoiY | null;
}

/**
 * Ghi thêm MỘT lần xét lại vào snapshot v2, trả snapshot MỚI (đóng băng); snapshot gốc và các trường giá của nó KHÔNG đổi.
 *   · ngày tiền về ngoài cửa sổ hiệu lực ⇒ `NGOAI_HIEU_LUC` — không tự chọn giữ giá cũ hay từ chối; đó là việc của người duyệt (D2);
 *   · còn lại: `KHOP` hoặc `CHENH_LECH_CHINH_SACH` theo `phatHienDoiChinhSach`.
 */
export function xetLaiKhiTienVe(snapshot: SnapshotGoiYV2, vao: DauVaoXetLai): SnapshotGoiYV2 {
  const ve = vao.ngayTienVe.getTime();
  if (Number.isNaN(ve) || Number.isNaN(vao.xetLaiLuc.getTime())) {
    throw new LoiGoiY("NGAY_KHONG_HOP_LE", "Ngày tiền về / ngày xét lại không hợp lệ.");
  }
  // Nửa mở [tu, den) — khẳng định dạng dương để mốc hỏng rơi vào NGOÀI hiệu lực, không lọt qua.
  const trongHieuLuc = ve >= vao.hieuLuc.tu.getTime() && ve < vao.hieuLuc.den.getTime();
  let lan: LanXetLaiKhiTienVe;
  if (!trongHieuLuc) {
    lan = { ngayTienVe: vao.ngayTienVe.toISOString(), xetLaiLuc: vao.xetLaiLuc.toISOString(), trangThai: "NGOAI_HIEU_LUC", lyDo: [], chenhLechGiamGia: null, thanhPhanXetLai: [] };
  } else {
    if (vao.ketQuaXetLai === null) throw new LoiGoiY("NGU_CANH_KHONG_HOP_LE", "Ngày tiền về còn trong hiệu lực nhưng thiếu kết quả xét lại.");
    const so = phatHienDoiChinhSach(snapshot, vao.ketQuaXetLai);
    lan = {
      ngayTienVe: vao.ngayTienVe.toISOString(),
      xetLaiLuc: vao.xetLaiLuc.toISOString(),
      trangThai: so.khac ? "CHENH_LECH_CHINH_SACH" : "KHOP",
      lyDo: so.lyDo,
      chenhLechGiamGia: so.chenhLechGiamGia,
      thanhPhanXetLai: vao.ketQuaXetLai.thanhPhan.map((p) => Object.freeze({ ...p, dieuKienKhop: Object.freeze({ ...p.dieuKienKhop }) })),
    };
  }
  const daDong = Object.freeze({ ...lan, lyDo: Object.freeze([...lan.lyDo]), thanhPhanXetLai: Object.freeze([...lan.thanhPhanXetLai]) });
  return Object.freeze({ ...snapshot, cacLanXetLai: Object.freeze([...snapshot.cacLanXetLai, daDong]) });
}

// ── SALE XÁC NHẬN TỪNG DÒNG + GIẢI THÍCH GIÁ ─────────────────────────────────────────────────────────
// Hai hàm THUẦN, không quyết định gì về hành vi tài chính: `soSanhXacNhan` chỉ LIỆT KÊ chỗ khác giữa gợi ý của máy chủ và tập Sale gửi lên;
// còn khác thì từ chối, đẩy duyệt hay cho qua là D5 (chưa chốt) — người gọi quyết, hàm này không có mặc định cho việc đó.

export interface SoSanhXacNhan {
  /** `true` chỉ khi tập Sale xác nhận TRÙNG KHÍT tập gợi ý và không mã nào lặp. */
  readonly khop: boolean;
  /** Gợi ý mà Sale KHÔNG xác nhận (bỏ bớt). */
  readonly boBot: readonly string[];
  /** Mã Sale xác nhận mà máy chủ KHÔNG gợi ý (thêm vào). */
  readonly themVao: readonly string[];
  /** Mã bị gửi lặp — nếu không bắt, một mã có thể bị trừ hai lần. */
  readonly lap: readonly string[];
}

export function soSanhXacNhan(goiY: KetQuaGoiY, idDaXacNhan: readonly string[]): SoSanhXacNhan {
  const goiYIds = new Set(goiY.thanhPhan.map((t) => t.id));
  const dem = new Map<string, number>();
  for (const id of idDaXacNhan) dem.set(id, (dem.get(id) ?? 0) + 1);
  const lap = [...dem.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort();
  const xacNhan = new Set(dem.keys());
  const boBot = [...goiYIds].filter((id) => !xacNhan.has(id)).sort();
  const themVao = [...xacNhan].filter((id) => !goiYIds.has(id)).sort();
  return { khop: boBot.length === 0 && themVao.length === 0 && lap.length === 0, boBot, themVao, lap };
}

/** Nhóm chữ số bằng dấu chấm, số nguyên không âm — cố định, không phụ thuộc ICU / locale của tiến trình. */
function dongVN(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Giải thích giá bằng chữ cho Sale: mỗi dòng một ý, đọc từ KẾT QUẢ (không tự tính lại). Dùng để hiện cạnh "Giảm giá dòng này" và để
 * người duyệt đọc lại căn cứ. Không nêu con số trần nào ngoài `ketQua.tranTong` mà máy chủ đã dùng.
 */
export function giaiThichGia(ketQua: KetQuaGoiY, ctx: NguCanhGoiY): readonly string[] {
  const dong: string[] = [];
  const canCu = [`${ctx.soBuoi} buổi`, `con thứ ${ctx.thuTuCon}`];
  if (ctx.thuTuSanPham48 !== null) canCu.push(`sản phẩm gói 48 thứ ${ctx.thuTuSanPham48}`);
  dong.push(`Căn cứ: ${canCu.join(", ")}. Giá niêm yết ${dongVN(ketQua.niemYet)}đ.`);
  if (ketQua.thanhPhan.length === 0) {
    dong.push("Chưa có chương trình nào khớp dòng này — giá bằng niêm yết.");
  }
  for (const t of ketQua.thanhPhan) {
    dong.push(`• ${t.ten} (${t.maVanBan}) — ${t.phanTram}%: −${dongVN(t.soTien)}đ${t.biCat ? " (bị cắt bớt vì chạm trần)" : ""}.`);
  }
  for (const l of ketQua.loaiTru) {
    dong.push(`• Không cộng ${l.ten} (${l.phanTram}%): đã áp mức nền cao hơn — mỗi sản phẩm chỉ một mức nền.`);
  }
  if (ketQua.biCatTran && ketQua.tranTong !== null) {
    dong.push(`Tổng ${ketQua.tongPhanTramDanhNghia}% vượt trần ${ketQua.tranTong}% nên chỉ giảm ${ketQua.phanTramApDung}%.`);
  }
  dong.push(`Tổng giảm ${dongVN(ketQua.giamGia)}đ → thành tiền ${dongVN(ketQua.thanhTien)}đ.`);
  return dong;
}
