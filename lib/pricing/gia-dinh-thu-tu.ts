// lib/pricing/gia-dinh-thu-tu.ts — XÁC ĐỊNH GIA ĐÌNH + THỨ TỰ CON + THỨ TỰ SẢN PHẨM 48. THUẦN: không chạm DB, không đọc đồng hồ.
//
// CHƯA NỐI vào tạo đơn / máy chủ / form (lưới `[GDT-PIN]`). Đây là phần tính; phần đọc DB nằm ở `gia-dinh-thu-tu-db.ts`.
//
// ── CĂN CỨ (đối chiếu ngày 18/10/2026; số liệu "T-Q" là câu hỏi của tờ trình 07/10, chữ đỏ = trả lời của BLĐ) ─────────────
//   · Gia đình  = MỘT hồ sơ phụ huynh đã liên kết (`Student.parentUserId`) — chủ dự án chốt 18/10 (D4).
//   · Thứ tự CON  (T-Q19 đỏ, QĐ-31, SR.QD.233 Đ3.3): "mua cùng một lúc thì PHỤ HUYNH CHỌN; mua hai lần khác nhau thì
//     theo THỨ TỰ MUA (con mua đầu tiên là con thứ nhất…)"; "con đang học từ trước tính là con thứ nhất" (T-Q21 đỏ A);
//     "cùng đợt" = cả chương trình 01/09–31/12/2026 (T-Q20 đỏ C, QĐ-30). Khoá đếm là HỌC VIÊN, bền theo con.
//   · Thứ tự SẢN PHẨM 48 (SR.QD.233 Đ3.2): "theo trình tự thanh toán trọn gói 48 buổi của TOÀN BỘ sản phẩm trong đợt của gia
//     đình, KHÔNG phân biệt sản phẩm đứng tên con nào"; sản phẩm không đủ 48 buổi KHÔNG được tính. Khoá đếm là LẦN MUA 48 buổi,
//     không phải con. Chủ dự án (T-Q22 đỏ): "cũng giống như con thứ nhất, con thứ hai" — hiểu là CÙNG nguyên tắc thứ tự mua,
//     KHÔNG phải cùng khoá đếm (một con mua hai gói 48 thì gói thứ hai là "sản phẩm thứ hai" nhưng vẫn là "con thứ nhất",
//     MT-09c). Hai thứ tự được tính tách bạch ở hai hàm nhánh dưới đây; ĐỪNG gộp.
//
// ── CÁI NÀY KHÔNG ĐOÁN (mỗi chỗ là một câu hỏi mở, xem docs §12) ────────────────────────────────────────────────────────
//   · "Thứ tự mua" là NGÀY TẠO ĐƠN hay NGÀY TIỀN VỀ (MT-09a / D2): `coSo` là tham số BẮT BUỘC, không có mặc định.
//   · Một lần mua có nhiều khoản tiền về (D2): nếu thứ tự phụ thuộc khoản nào thì trả CHO_XAC_MINH, không chọn ngày.
//   · "Con đang học từ trước" = đang học hay từng học (MT-09e): chỉ `CO` mới tính; `KHONG_RO` ⇒ CHO_XAC_MINH.
//   · Mua cùng lúc nhiều con: PHỤ HUYNH chọn thứ tự (T-Q19) — thiếu lựa chọn ⇒ CHO_XAC_MINH, không tự xếp theo tuổi / giá.
//   · Hồ sơ phụ huynh trùng / học viên chưa liên kết / SĐT lệch ⇒ CHO_XAC_MINH, KHÔNG BAO GIỜ tự gộp gia đình.

import { canonicalPhone } from "@/lib/phone";
import type { CuaSoHieuLuc } from "./hieu-luc-chinh-sach";

/** Thứ tự mua tính theo ngày nào. Chưa chốt (D2 / MT-09a) ⇒ người gọi PHẢI chọn, không có mặc định. */
export type CoSoThuTu = "NGAY_TAO_DON" | "NGAY_TIEN_VE";

// ═══ BƯỚC 1 — XÁC ĐỊNH GIA ĐÌNH ═════════════════════════════════════════════════════════════════════════════════════════

export interface HocVienGiaDinh {
  readonly studentId: string;
  readonly parentUserId: string | null;
  readonly parentPhone: string | null;
  readonly parent2Phone: string | null;
}

/** Tài khoản phụ huynh (`User` vai PARENT) — chỉ phần cần để nhận ra trùng hồ sơ. */
export interface HoSoPhuHuynh {
  readonly userId: string;
  readonly phone: string | null;
}

export interface DauVaoXacDinhGiaDinh {
  /** Học viên của dòng đang xét. */
  readonly hocVien: HocVienGiaDinh;
  /** Tài khoản phụ huynh tra theo `hocVien.parentUserId`; `null` = không tìm thấy dòng. */
  readonly hoSo: HoSoPhuHuynh | null;
  /** Mọi học viên (chưa xoá) đang cùng `parentUserId` với `hocVien` — gồm cả `hocVien`. */
  readonly cacConCungHoSo: readonly HocVienGiaDinh[];
  /** Học viên KHÁC (parentUserId khác hoặc để trống) mà SĐT phụ huynh trùng SĐT của hồ sơ này. */
  readonly hocVienKhacHoSoCungSdt: readonly HocVienGiaDinh[];
  /** Tài khoản phụ huynh KHÁC cùng SĐT với hồ sơ này. */
  readonly hoSoKhacCungSdt: readonly HoSoPhuHuynh[];
}

export type MaChoXacMinhGiaDinh =
  | "CHUA_LIEN_KET_PHU_HUYNH"
  | "HO_SO_PHU_HUYNH_KHONG_TIM_THAY"
  | "TRUNG_HO_SO_PHU_HUYNH"
  | "HOC_VIEN_KHAC_HO_SO_CUNG_SDT"
  | "LECH_SDT_VOI_HO_SO";

export interface LyDoChoXacMinhGiaDinh {
  readonly ma: MaChoXacMinhGiaDinh;
  readonly hocVienIds: readonly string[];
  readonly hoSoIds: readonly string[];
}

export type KetQuaGiaDinh =
  | { readonly trangThai: "XAC_DINH"; readonly khoaGiaDinh: string; readonly hocVienIds: readonly string[] }
  | { readonly trangThai: "CHO_XAC_MINH"; readonly lyDo: readonly LyDoChoXacMinhGiaDinh[] };

function sdtChuan(v: string | null): string | null {
  return v === null ? null : canonicalPhone(v);
}

function sdtCuaHocVien(h: HocVienGiaDinh): string[] {
  return [sdtChuan(h.parentPhone), sdtChuan(h.parent2Phone)].filter((s): s is string => s !== null);
}

/**
 * Xác định gia đình của một học viên. KHÔNG BAO GIỜ gộp: chỉ trả `XAC_DINH` khi hồ sơ phụ huynh liên kết rõ ràng và không có
 * tín hiệu nào cho thấy có hồ sơ khác của cùng người / nhà khác bị nhập chung. Mọi nghi ngờ ⇒ `CHO_XAC_MINH` kèm danh sách.
 */
export function xacDinhGiaDinh(vao: DauVaoXacDinhGiaDinh): KetQuaGiaDinh {
  const lyDo: LyDoChoXacMinhGiaDinh[] = [];
  const { hocVien, hoSo } = vao;

  if (hocVien.parentUserId === null) {
    // Không có hồ sơ để tra tiếp: các tín hiệu dưới đây đều lấy hồ sơ làm gốc.
    return {
      trangThai: "CHO_XAC_MINH",
      lyDo: [{ ma: "CHUA_LIEN_KET_PHU_HUYNH", hocVienIds: [hocVien.studentId], hoSoIds: [] }],
    };
  }
  if (hoSo === null || hoSo.userId !== hocVien.parentUserId) {
    return {
      trangThai: "CHO_XAC_MINH",
      lyDo: [{ ma: "HO_SO_PHU_HUYNH_KHONG_TIM_THAY", hocVienIds: [hocVien.studentId], hoSoIds: [hocVien.parentUserId] }],
    };
  }

  if (vao.hoSoKhacCungSdt.length > 0) {
    lyDo.push({
      ma: "TRUNG_HO_SO_PHU_HUYNH",
      hocVienIds: [],
      hoSoIds: [hoSo.userId, ...vao.hoSoKhacCungSdt.map((h) => h.userId)].sort(),
    });
  }
  if (vao.hocVienKhacHoSoCungSdt.length > 0) {
    lyDo.push({
      ma: "HOC_VIEN_KHAC_HO_SO_CUNG_SDT",
      hocVienIds: vao.hocVienKhacHoSoCungSdt.map((h) => h.studentId).sort(),
      hoSoIds: [],
    });
  }

  const sdtHoSo = sdtChuan(hoSo.phone);
  if (sdtHoSo !== null) {
    // Học viên có SĐT phụ huynh hợp lệ mà KHÔNG số nào khớp hồ sơ ⇒ nhiều khả năng bị gắn nhầm vào hồ sơ này.
    const lech = vao.cacConCungHoSo
      .filter((h) => {
        const so = sdtCuaHocVien(h);
        return so.length > 0 && !so.includes(sdtHoSo);
      })
      .map((h) => h.studentId)
      .sort();
    if (lech.length > 0) lyDo.push({ ma: "LECH_SDT_VOI_HO_SO", hocVienIds: lech, hoSoIds: [hoSo.userId] });
  }

  if (lyDo.length > 0) return { trangThai: "CHO_XAC_MINH", lyDo };
  return {
    trangThai: "XAC_DINH",
    khoaGiaDinh: hoSo.userId,
    hocVienIds: vao.cacConCungHoSo.map((h) => h.studentId).sort(),
  };
}

// ═══ BƯỚC 2 — THỨ TỰ CON + THỨ TỰ SẢN PHẨM 48 ═══════════════════════════════════════════════════════════════════════════

/** "Đang học từ trước" (QĐ-31). `KHONG_RO` = có dấu vết ghi danh nhưng chưa đủ để nói "đang học" (MT-09e). */
export type DangHocTuTruoc = "CO" | "KHONG" | "KHONG_RO";

export interface ConTrongGiaDinh {
  readonly studentId: string;
  readonly dangHocTuTruoc: DangHocTuTruoc;
}

/** Một lần mua ĐÃ CÓ của gia đình, ở đơn KHÁC đơn đang xét (mọi dòng của đơn đang xét nằm ở `cungDon`, không ở đây). */
export interface LanMuaLichSu {
  readonly orderItemId: string;
  readonly orderId: string;
  /** `null` = dòng chưa gắn học viên (khách vãng lai / dữ liệu cũ) — không biết là con nào. */
  readonly studentId: string | null;
  /** `null` = không biết số buổi của lần mua. */
  readonly soBuoi: number | null;
  /** Đơn kế hoạch nhiều đợt (mô hình cũ) — KHÔNG phải "trọn gói trong 01 lần" (SR.QD.233 Đ3.2). */
  readonly traGopNhieuDot: boolean;
  /** Đơn đã bị huỷ / hoàn ⇒ `false`: không tính vào lịch sử. */
  readonly conHieuLuc: boolean;
  readonly taoLuc: Date;
  /** Ngày từng khoản tiền ĐÃ GHI NHẬN của đơn. Rỗng = chưa có tiền. */
  readonly ngayTienVe: readonly Date[];
}

/** Dòng đang xét (chưa lưu hoặc đã lưu, nhưng mọi dòng cùng đơn không nằm trong lịch sử). */
export interface DongDangXetThuTu {
  readonly orderItemId: string;
  readonly orderId: string;
  readonly studentId: string;
  readonly soBuoi: number;
  readonly taoLuc: Date;
}

/** Dòng khác CÙNG ĐƠN với dòng đang xét. */
export interface DongCungDon {
  readonly orderItemId: string;
  readonly studentId: string | null;
  readonly soBuoi: number | null;
}

/** Lựa chọn của phụ huynh khi mua cùng lúc (T-Q19). Phải truy được ai ghi, lúc nào. */
export interface PhuHuynhChonThuTu {
  /** Thứ tự các CON (mua lần đầu trong đơn này), con thứ nhất đứng đầu. */
  readonly thuTuCon: readonly string[];
  /** Thứ tự các DÒNG 48 buổi trong đơn này, sản phẩm thứ nhất đứng đầu. */
  readonly thuTuSanPham48: readonly string[];
  readonly ghiBoiUserId: string;
  readonly ghiLuc: Date;
}

export interface DauVaoThuTu {
  readonly coSo: CoSoThuTu;
  readonly cuaSo: CuaSoHieuLuc;
  readonly dong: DongDangXetThuTu;
  readonly cacConGiaDinh: readonly ConTrongGiaDinh[];
  readonly lichSu: readonly LanMuaLichSu[];
  readonly cungDon: readonly DongCungDon[];
  /** `null` = phụ huynh chưa chọn. Chỉ cần khi có ≥2 con / ≥2 gói 48 buổi cùng mua lần đầu trong đơn này. */
  readonly phuHuynhChon: PhuHuynhChonThuTu | null;
}

export type MaChoXacMinhThuTu =
  | "NGAY_KHONG_HOP_LE"
  | "CON_DANG_HOC_TU_TRUOC_KHONG_RO"
  | "NHIEU_CON_DANG_HOC_TU_TRUOC"
  | "DONG_CHUA_GAN_HOC_VIEN"
  | "HOC_VIEN_NGOAI_GIA_DINH"
  | "CUNG_LUC_CHUA_CHON_THU_TU"
  | "LUA_CHON_KHONG_HOP_LE"
  | "THU_TU_KHONG_PHAN_BIET_DUOC"
  | "DON_CU_TRA_GOP_CO_THE_LA_48_BUOI"
  | "SO_BUOI_KHONG_RO";

export interface LyDoChoXacMinhThuTu {
  readonly ma: MaChoXacMinhThuTu;
  readonly hocVienIds: readonly string[];
  readonly orderItemIds: readonly string[];
}

export interface CanCuThuTu {
  readonly coSo: CoSoThuTu;
  /** Đã tính theo thứ tự nào: con đã đứng trước (gồm con đang học từ trước). */
  readonly conDungTruoc: readonly string[];
  /** Lần mua 48 buổi đã đứng trước. */
  readonly sanPham48DungTruoc: readonly string[];
  /** Phụ huynh đã chọn thứ tự (chép nguyên để chụp vào snapshot). */
  readonly phuHuynhChon: PhuHuynhChonThuTu | null;
  /** Cơ sở `NGAY_TIEN_VE`: đơn chưa có tiền ⇒ thứ tự có thể đổi khi tiền về. */
  readonly donChuaCoTien: readonly string[];
  readonly tamTinh: boolean;
}

export type KetQuaThuTu =
  | {
      readonly trangThai: "XAC_DINH";
      readonly thuTuCon: number;
      readonly thuTuSanPham48: number | null;
      readonly canCu: CanCuThuTu;
    }
  | { readonly trangThai: "CHO_XAC_MINH"; readonly lyDo: readonly LyDoChoXacMinhThuTu[] };

interface Khoang {
  readonly min: number;
  readonly max: number;
}

const TUONG_LAI: Khoang = { min: Number.POSITIVE_INFINITY, max: Number.POSITIVE_INFINITY };

function dungTruoc(a: Khoang, b: Khoang): boolean {
  return a.max < b.min;
}

function trongCuaSo(k: Khoang, cuaSo: CuaSoHieuLuc): boolean {
  return k.min >= cuaSo.tu.getTime() && k.max < cuaSo.den.getTime();
}

const hopLeNgay = (d: Date) => !Number.isNaN(d.getTime());

/** Khoảng thời gian của một lần mua theo cơ sở thứ tự; `null` = chưa xếp được (chưa có tiền khi tính theo ngày tiền về). */
function khoangCuaLan(l: LanMuaLichSu, coSo: CoSoThuTu): Khoang | null {
  if (coSo === "NGAY_TAO_DON") {
    const t = l.taoLuc.getTime();
    return { min: t, max: t };
  }
  if (l.ngayTienVe.length === 0) return null;
  const ts = l.ngayTienVe.map((d) => d.getTime());
  return { min: Math.min(...ts), max: Math.max(...ts) };
}

function khoangCuaDong(d: DongDangXetThuTu, coSo: CoSoThuTu): Khoang {
  // Dòng đang xét chưa có tiền ở thời điểm báo giá ⇒ đứng SAU mọi lần mua đã có tiền.
  if (coSo === "NGAY_TIEN_VE") return TUONG_LAI;
  const t = d.taoLuc.getTime();
  return { min: t, max: t };
}

function duocDemLaConDaMua(l: LanMuaLichSu, coSo: CoSoThuTu, cuaSo: CuaSoHieuLuc): Khoang | null {
  if (!l.conHieuLuc) return null;
  const k = khoangCuaLan(l, coSo);
  return k !== null && trongCuaSo(k, cuaSo) ? k : null;
}

const sapXep = (xs: readonly string[]) => [...xs].sort();

/**
 * Tính thứ tự con + thứ tự sản phẩm 48 cho MỘT dòng. Hai thứ tự tính tách bạch (khoá đếm khác nhau — xem đầu tệp).
 * Không đủ căn cứ ở BẤT KỲ chỗ nào ⇒ `CHO_XAC_MINH` cho cả dòng, không trả một nửa.
 */
export function xetThuTuChoDong(vao: DauVaoThuTu): KetQuaThuTu {
  const lyDo: LyDoChoXacMinhThuTu[] = [];
  const { coSo, cuaSo, dong, lichSu, cungDon, phuHuynhChon } = vao;

  // Lỗi LẬP TRÌNH (không phải dữ liệu xấu): lịch sử chứa dòng của chính đơn đang xét sẽ đếm một lần mua hai lần.
  if (lichSu.some((l) => l.orderId === dong.orderId)) {
    throw new Error("xetThuTuChoDong: lichSu không được chứa dòng của đơn đang xét — đưa chúng vào cungDon");
  }

  const ngayXau = [...lichSu.flatMap((l) => [l.taoLuc, ...l.ngayTienVe]), dong.taoLuc, cuaSo.tu, cuaSo.den].some(
    (d) => !hopLeNgay(d),
  );
  if (ngayXau) {
    return { trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "NGAY_KHONG_HOP_LE", hocVienIds: [], orderItemIds: [] }] };
  }

  // ── Con đang học từ trước ────────────────────────────────────────────────────────────────────────────────────────
  const khongRo = vao.cacConGiaDinh.filter((c) => c.dangHocTuTruoc === "KHONG_RO").map((c) => c.studentId);
  if (khongRo.length > 0) {
    lyDo.push({ ma: "CON_DANG_HOC_TU_TRUOC_KHONG_RO", hocVienIds: sapXep(khongRo), orderItemIds: [] });
  }
  const dangHoc = vao.cacConGiaDinh.filter((c) => c.dangHocTuTruoc === "CO").map((c) => c.studentId);
  const laDangHoc = new Set(dangHoc);

  // ── Dòng cùng đơn phải biết là con nào ───────────────────────────────────────────────────────────────────────────
  const dongKhongRoCon = cungDon.filter((d) => d.studentId === null).map((d) => d.orderItemId);
  if (dongKhongRoCon.length > 0) {
    lyDo.push({ ma: "DONG_CHUA_GAN_HOC_VIEN", hocVienIds: [], orderItemIds: sapXep(dongKhongRoCon) });
  }
  const conCungDon = new Set(cungDon.map((d) => d.studentId).filter((s): s is string => s !== null));
  conCungDon.add(dong.studentId);

  // ── Lịch sử theo con ─────────────────────────────────────────────────────────────────────────────────────────────
  // Mỗi con: lần mua ĐẦU TIÊN (theo cơ sở) trong cửa sổ. Lần mua của dòng chưa gắn học viên không quy được cho con nào.
  const dauTienCuaCon = new Map<string, Khoang>();
  const donChuaCoTien = new Set<string>();
  const lichSuKhongRoCon: string[] = [];
  // Học viên có mặt trong lịch sử/đơn nhưng KHÔNG nằm trong danh sách con đã liên kết của gia đình (vd. đơn khớp theo SĐT phụ huynh mà dòng đứng tên
  // cháu/bạn): không biết có phải anh chị em hay không ⇒ KHÔNG đếm là "con đứng trước" và KHÔNG đoán — cả kết quả thành CHO_XAC_MINH.
  const thuocGiaDinh = new Set(vao.cacConGiaDinh.map((c) => c.studentId));
  const ngoaiGiaDinh = new Set<string>();
  for (const l of lichSu) {
    if (!l.conHieuLuc) continue;
    const k = khoangCuaLan(l, coSo);
    if (k === null) {
      donChuaCoTien.add(l.orderId);
      continue;
    }
    if (!trongCuaSo(k, cuaSo)) continue;
    if (l.studentId === null) {
      lichSuKhongRoCon.push(l.orderItemId);
      continue;
    }
    if (!thuocGiaDinh.has(l.studentId)) {
      ngoaiGiaDinh.add(l.studentId);
      continue;
    }
    const cu = dauTienCuaCon.get(l.studentId);
    if (cu === undefined || k.min < cu.min) dauTienCuaCon.set(l.studentId, k);
  }
  for (const d of cungDon) if (d.studentId !== null && !thuocGiaDinh.has(d.studentId)) ngoaiGiaDinh.add(d.studentId);
  if (!thuocGiaDinh.has(dong.studentId)) ngoaiGiaDinh.add(dong.studentId);
  if (ngoaiGiaDinh.size > 0) {
    lyDo.push({ ma: "HOC_VIEN_NGOAI_GIA_DINH", hocVienIds: sapXep([...ngoaiGiaDinh]), orderItemIds: [] });
  }
  if (lichSuKhongRoCon.length > 0) {
    // Có thể là một con KHÁC đã mua trước ⇒ ảnh hưởng thứ hạng; không đoán.
    lyDo.push({ ma: "DONG_CHUA_GAN_HOC_VIEN", hocVienIds: [], orderItemIds: sapXep(lichSuKhongRoCon) });
  }

  // ── THỨ TỰ CON ───────────────────────────────────────────────────────────────────────────────────────────────────
  let thuTuCon: number | null = null;
  const conDungTruoc: string[] = [];
  const mine = dauTienCuaCon.get(dong.studentId) ?? null;

  if (laDangHoc.has(dong.studentId)) {
    if (dangHoc.length > 1) {
      lyDo.push({ ma: "NHIEU_CON_DANG_HOC_TU_TRUOC", hocVienIds: sapXep(dangHoc), orderItemIds: [] });
    } else {
      thuTuCon = 1;
    }
  } else {
    // Con đang học từ trước luôn đứng trước (QĐ-31).
    for (const id of dangHoc) conDungTruoc.push(id);

    const khoangCuaS = mine ?? khoangCuaDong(dong, coSo);
    const chong: string[] = [];
    for (const [id, k] of dauTienCuaCon) {
      if (id === dong.studentId || laDangHoc.has(id)) continue;
      if (dungTruoc(k, khoangCuaS)) conDungTruoc.push(id);
      else if (!dungTruoc(khoangCuaS, k)) chong.push(id);
    }
    if (chong.length > 0) {
      lyDo.push({ ma: "THU_TU_KHONG_PHAN_BIET_DUOC", hocVienIds: sapXep([dong.studentId, ...chong]), orderItemIds: [] });
    }

    // Nhóm "mua lần đầu CÙNG LÚC trong đơn này": phụ huynh chọn (T-Q19).
    let viTriTrongNhom = 1;
    if (mine === null) {
      const nhom = [...conCungDon].filter((id) => !laDangHoc.has(id) && !dauTienCuaCon.has(id));
      if (nhom.length >= 2) {
        const chon = phuHuynhChon?.thuTuCon ?? null;
        const du = chon !== null && chon.length === nhom.length && new Set(chon).size === chon.length && nhom.every((id) => chon.includes(id));
        if (chon === null) {
          lyDo.push({ ma: "CUNG_LUC_CHUA_CHON_THU_TU", hocVienIds: sapXep(nhom), orderItemIds: [] });
        } else if (!du) {
          lyDo.push({ ma: "LUA_CHON_KHONG_HOP_LE", hocVienIds: sapXep(nhom), orderItemIds: [] });
        } else {
          viTriTrongNhom = chon.indexOf(dong.studentId) + 1;
        }
      }
    }
    if (!lyDo.some((l) => l.ma === "THU_TU_KHONG_PHAN_BIET_DUOC")) {
      thuTuCon = conDungTruoc.length + viTriTrongNhom;
    }
  }

  // ── THỨ TỰ SẢN PHẨM 48 ───────────────────────────────────────────────────────────────────────────────────────────
  let thuTuSanPham48: number | null = null;
  const sanPham48DungTruoc: string[] = [];
  if (dong.soBuoi === 48) {
    const lan48: { id: string; k: Khoang }[] = [];
    const nghi: string[] = [];
    for (const l of lichSu) {
      const k = duocDemLaConDaMua(l, coSo, cuaSo);
      if (k === null) continue;
      if (l.soBuoi === null) {
        // Không biết có phải 48 buổi hay không ⇒ có thể đứng trước dòng này.
        nghi.push(l.orderItemId);
      } else if (l.soBuoi === 48) {
        if (l.traGopNhieuDot) nghi.push(l.orderItemId);
        else lan48.push({ id: l.orderItemId, k });
      }
    }
    if (nghi.length > 0) {
      const traGop = lichSu.some((l) => nghi.includes(l.orderItemId) && l.traGopNhieuDot);
      lyDo.push({
        ma: traGop ? "DON_CU_TRA_GOP_CO_THE_LA_48_BUOI" : "SO_BUOI_KHONG_RO",
        hocVienIds: [],
        orderItemIds: sapXep(nghi),
      });
    }

    const khoangDong = khoangCuaDong(dong, coSo);
    const chong: string[] = [];
    for (const { id, k } of lan48) {
      if (dungTruoc(k, khoangDong)) sanPham48DungTruoc.push(id);
      else if (!dungTruoc(khoangDong, k)) chong.push(id);
    }
    if (chong.length > 0) {
      lyDo.push({ ma: "THU_TU_KHONG_PHAN_BIET_DUOC", hocVienIds: [], orderItemIds: sapXep([dong.orderItemId, ...chong]) });
    }

    // Nhiều gói 48 buổi trong CÙNG đơn: không có "trình tự thanh toán" giữa chúng ⇒ phụ huynh chọn (cùng nguyên tắc T-Q19).
    // Dòng cùng đơn KHÔNG biết số buổi có thể là một gói 48 nữa (cùng bất định như nhánh lịch sử ở trên) ⇒ chờ xác minh, không xếp dòng này "thứ nhất".
    const khongRoSoBuoiCungDon = cungDon.filter((d) => d.soBuoi === null).map((d) => d.orderItemId);
    if (khongRoSoBuoiCungDon.length > 0) {
      lyDo.push({ ma: "SO_BUOI_KHONG_RO", hocVienIds: [], orderItemIds: sapXep(khongRoSoBuoiCungDon) });
    }
    const nhom48 = [dong.orderItemId, ...cungDon.filter((d) => d.soBuoi === 48).map((d) => d.orderItemId)];
    let viTri = 1;
    if (nhom48.length >= 2) {
      const chon = phuHuynhChon?.thuTuSanPham48 ?? null;
      if (chon === null) {
        lyDo.push({ ma: "CUNG_LUC_CHUA_CHON_THU_TU", hocVienIds: [], orderItemIds: sapXep(nhom48) });
      } else if (chon.length !== nhom48.length || new Set(chon).size !== chon.length || !nhom48.every((id) => chon.includes(id))) {
        lyDo.push({ ma: "LUA_CHON_KHONG_HOP_LE", hocVienIds: [], orderItemIds: sapXep(nhom48) });
      } else {
        viTri = chon.indexOf(dong.orderItemId) + 1;
      }
    }
    thuTuSanPham48 = sanPham48DungTruoc.length + viTri;
  }

  if (lyDo.length > 0 || thuTuCon === null) {
    return { trangThai: "CHO_XAC_MINH", lyDo };
  }
  return {
    trangThai: "XAC_DINH",
    thuTuCon,
    thuTuSanPham48,
    canCu: {
      coSo,
      conDungTruoc: sapXep(conDungTruoc),
      sanPham48DungTruoc: sapXep(sanPham48DungTruoc),
      phuHuynhChon,
      donChuaCoTien: sapXep([...donChuaCoTien]),
      tamTinh: coSo === "NGAY_TIEN_VE" && donChuaCoTien.size > 0,
    },
  };
}

// ═══ PHÂN LOẠI "ĐANG HỌC TỪ TRƯỚC" TỪ GHI DANH (QĐ-31) ═══════════════════════════════════════════════════════════════════
// Chủ dự án chốt (T-Q21 đỏ A): "con đang học từ trước được tính là con thứ nhất". Chữ "đang học" CHƯA nói rõ có gồm con đã học xong / đã nghỉ
// hay không (MT-09e) — nên chỉ trạng thái ghi danh THẬT SỰ đang học mới cho `CO`; mọi dấu vết khác ⇒ `KHONG_RO` (hàng chờ xác minh), không đoán.

/** Trạng thái ghi danh coi là "đang học". `PENDING` (chưa xác nhận) và `PAUSED` (bảo lưu) KHÔNG nằm ở đây. */
export const TRANG_THAI_GHI_DANH_DANG_HOC: ReadonlySet<string> = new Set(["ACTIVE", "CONFIRMED", "STUDYING"]);

export interface GhiDanhDeXet {
  readonly status: string;
  readonly createdAt: Date;
}

/**
 * Một học viên có phải "đang học từ trước" không.
 *
 * - Có ghi danh đang học TẠO TRƯỚC khi chương trình mở (`cuaSo.tu`) ⇒ `CO`.
 * - Ghi danh đang học tạo TRONG đợt: nếu con đã có lần mua trong đợt thì thứ hạng đã tính theo lần mua (`KHONG`, tránh đếm hai lần);
 *   chưa có lần mua nào ⇒ `KHONG_RO` (đang học mà không rõ vì sao không có đơn).
 * - Chỉ có ghi danh đã kết thúc / chờ / bảo lưu / chuyển lớp ⇒ `KHONG_RO`. Chỉ có ghi danh `CANCELLED` ⇒ `KHONG` (chưa từng học).
 * - Không ghi danh nào ⇒ `KHONG`.
 */
export function phanLoaiDangHocTuTruoc(ghiDanh: readonly GhiDanhDeXet[], coMuaTrongDot: boolean, cuaSo: CuaSoHieuLuc): DangHocTuTruoc {
  if (ghiDanh.length === 0) return "KHONG";
  const dangHoc = ghiDanh.filter((g) => TRANG_THAI_GHI_DANH_DANG_HOC.has(g.status));
  if (dangHoc.some((g) => g.createdAt.getTime() < cuaSo.tu.getTime())) return "CO";
  if (dangHoc.length > 0) return coMuaTrongDot ? "KHONG" : "KHONG_RO";
  return ghiDanh.every((g) => g.status === "CANCELLED") ? "KHONG" : "KHONG_RO";
}
