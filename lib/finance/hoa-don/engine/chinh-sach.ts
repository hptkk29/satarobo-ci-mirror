// lib/finance/hoa-don/engine/chinh-sach.ts — CHÍNH SÁCH hoá đơn có PHIÊN BẢN + HIỆU LỰC. THUẦN: không Prisma,
// không DB, không env, không đồng hồ (ngày luôn do người gọi truyền vào).
//
// Lát S3 (engine SHADOW, chưa nối luồng nào). Trả lời một câu: "ngày D, pháp nhân P, cơ sở C, loại khoản K thì
// hoá đơn tính thuế/giá/đơn vị/thời điểm lập THEO QUY TẮC NÀO". Hôm nay câu đó nằm rải trong mã
// (`thueChoLoaiDon`, `donViTinhTheoDong`, ngày phát hành do kế toán chốt); policy gom chúng về MỘT dạng có thể
// khai bằng dữ liệu, có hiệu lực từ–đến, đổi mà không sửa mã.
//
// ─────────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED — KHÔNG BAO GIỜ ĐOÁN
//
//   · Không có quy tắc hợp lệ ngày D ⇒ `KHONG_CO`. KHÔNG rơi về "8% đã gồm thuế" như `thueChoLoaiDon` (đó là mặc
//     định NGẦM trong mã; engine liệt nó vào báo cáo chênh lệch chứ không bắt chước).
//   · Hai quy tắc CÙNG độ cụ thể cùng khớp ⇒ `CHONG_HIEU_LUC` kèm id của cả hai. Không chọn "cái mới hơn".
//   · Độ cụ thể = số chiều đích danh (pháp nhân · cơ sở · loại khoản) ≠ `null`/`TAT_CA`. Quy tắc đích danh hơn
//     thắng quy tắc chung (cùng luật `thueChoLoaiDon`: dòng đích danh loại đơn thắng dòng `TAT_CA`). Hai quy tắc
//     cùng điểm nhưng KHÁC chiều (A: đích danh pháp nhân · B: đích danh loại khoản) cũng là chồng — không có
//     thứ tự ưu tiên giữa các chiều, và bịa ra một thứ tự là đoán.
//   · KHÔNG ghi mức thuế pháp lý "đúng" nào làm mặc định (TD-10 / OD-02). Mọi mức thuế đi vào từ dữ liệu.
//     `chinhSachHienHanh` CHỈ chiếu lại cấu hình đang sống để shadow so sánh; quy tắc của nó mang `nguon: "HIEN_HANH"`
//     và KHÔNG có ngày hiệu lực (người đọc không được hiểu là "luật quy định từ ngày nào").

import { laNgayHopLe } from "../cau-hinh-co-so";
import { chuanLoaiKhoan } from "../loai-khoan";
import type { CauHinhHoaDon } from "../phap-nhan";
import {
  khoaNhomThue,
  tinhHoaDon,
  trinhBaySoBuoi,
  type CachThuSoBuoi,
  type KetQuaTinh,
  type KieuGia,
  type LoiTinh,
  type MucThue,
} from "./tien-thue";

export const TAT_CA = "TAT_CA" as const;

export type ThoiDiemLap =
  /** Hôm nay: ngày phát hành do kế toán chốt (OD-05 mặc định an toàn). */
  | "DO_KE_TOAN_CHOT"
  | "KHI_THU_TIEN"
  | "SAU_KE_TOAN_XAC_NHAN"
  | "KHI_HOAN_THANH_DICH_VU";

export type NguonQuyTac =
  /** Bản CHIẾU của cấu hình đang sống trong mã (`CauHinhHoaDon.thue`) — để shadow so sánh, không phải luật mới. */
  | "HIEN_HANH"
  /** Do người vận hành khai (dữ liệu). */
  | "CAU_HINH";

export type ThongSoQuyTac = {
  mucThue: MucThue;
  kieuGia: KieuGia;
  donViTinh: string;
  donViTinhBuoi: string;
  cachThuSoBuoi: CachThuSoBuoi;
  /** Có `{n}`. Chỉ dùng khi `cachThuSoBuoi = MOT_KHOA_MO_TA_SO_BUOI`. */
  mauMoTaSoBuoi: string;
  thoiDiemLap: ThoiDiemLap;
};

export type QuyTac = {
  /** Mã chính sách (ổn định qua các phiên bản). */
  ma: string;
  /** Số nguyên ≥ 1. Phiên bản mới ĐÓNG hiệu lực phiên bản cũ — hai phiên bản cùng độ cụ thể không được chồng ngày. */
  phienBan: number;
  /** `null` = mọi pháp nhân. */
  phapNhanMa: string | null;
  /** `null` = mọi cơ sở. */
  centerId: string | null;
  /** `TAT_CA` hoặc mã loại khoản (cấu hình hiện hành khoá theo mã `OrderType`: COURSE · PACKAGE · EXAM · PRODUCT · COMBO). */
  loaiKhoan: string;
  /** yyyy-mm-dd (lịch VN), gồm cả hai đầu. `null` = không có mốc đó. */
  hieuLucTu: string | null;
  hieuLucDen: string | null;
  dangBat: boolean;
  nguon: NguonQuyTac;
  /** Tham chiếu văn bản (chuỗi tự do, do kế toán/pháp lý điền). KHÔNG BAO GIỜ dùng để validate hay rẽ nhánh (TD-10). */
  canCuPhapLy: string | null;
  thongSo: ThongSoQuyTac;
};

export type KhoaChinhSach = { phapNhanMa: string; centerId: string; loaiKhoan: string };

export const idQuyTac = (q: Pick<QuyTac, "ma" | "phienBan">): string => `${q.ma}@v${q.phienBan}`;

// ── NGÀY ──────────────────────────────────────────────────────────────────

const MIN = "0000-00-00";
const MAX = "9999-99-99";
const tu = (q: QuyTac) => q.hieuLucTu ?? MIN;
const den = (q: QuyTac) => q.hieuLucDen ?? MAX;

/** Số ngày giữa hai ngày yyyy-mm-dd hợp lệ (b − a). */
function soNgayGiua(a: string, b: string): number {
  const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return (ms(b) - ms(a)) / 86_400_000;
}

function ngayKeTiep(s: string): string {
  const d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) + 1));
  return d.toISOString().slice(0, 10);
}

// ── ĐỘ CỤ THỂ + TƯƠNG THÍCH ───────────────────────────────────────────────

const doCuThe = (q: QuyTac): number => (q.phapNhanMa != null ? 1 : 0) + (q.centerId != null ? 1 : 0) + (q.loaiKhoan !== TAT_CA ? 1 : 0);

const khopChieu = (a: string | null, b: string | null) => a === null || b === null || a === b;

/** Hai quy tắc có thể cùng khớp MỘT khoá nào đó không (mỗi chiều: bằng nhau hoặc một bên là "mọi"). */
function tuongThich(a: QuyTac, b: QuyTac): boolean {
  return (
    khopChieu(a.phapNhanMa, b.phapNhanMa) &&
    khopChieu(a.centerId, b.centerId) &&
    khopChieu(a.loaiKhoan === TAT_CA ? null : a.loaiKhoan, b.loaiKhoan === TAT_CA ? null : b.loaiKhoan)
  );
}

const trungNgay = (a: QuyTac, b: QuyTac) => tu(a) <= den(b) && tu(b) <= den(a);

const khoaPhamVi = (q: QuyTac) => `${q.phapNhanMa ?? "*"}|${q.centerId ?? "*"}|${q.loaiKhoan}`;

// ── RESOLVE ───────────────────────────────────────────────────────────────

export type LoiResolve =
  | { ma: "NGAY_KHONG_HOP_LE"; thongDiep: string }
  | { ma: "KHONG_CO"; thongDiep: string }
  | { ma: "CHONG_HIEU_LUC"; thongDiep: string; cacQuyTac: string[] };

export type KetQuaResolve = { ok: true; quyTac: QuyTac } | ({ ok: false } & LoiResolve);

/**
 * Quy tắc áp cho (pháp nhân, cơ sở, loại khoản) vào `ngay`. Xem "FAIL-CLOSED" đầu tệp. `ngay` là yyyy-mm-dd do
 * người gọi truyền — hàm không đọc đồng hồ.
 */
export function resolve(chinhSach: readonly QuyTac[], khoa: KhoaChinhSach, ngay: string): KetQuaResolve {
  if (!laNgayHopLe(ngay)) return { ok: false, ma: "NGAY_KHONG_HOP_LE", thongDiep: `Ngày áp chính sách không hợp lệ: "${ngay}".` };
  const loaiCuaKhoan = chuanLoaiKhoan(khoa.loaiKhoan);
  const khop = chinhSach.filter(
    (q) =>
      q.dangBat &&
      (q.phapNhanMa === null || q.phapNhanMa === khoa.phapNhanMa) &&
      (q.centerId === null || q.centerId === khoa.centerId) &&
      (q.loaiKhoan === TAT_CA || chuanLoaiKhoan(q.loaiKhoan) === loaiCuaKhoan) &&
      tu(q) <= ngay &&
      ngay <= den(q),
  );
  if (khop.length === 0) {
    return {
      ok: false,
      ma: "KHONG_CO",
      thongDiep: `Chưa có quy tắc hoá đơn nào hiệu lực ngày ${ngay} cho pháp nhân ${khoa.phapNhanMa} · cơ sở ${khoa.centerId} · loại khoản ${khoa.loaiKhoan}.`,
    };
  }
  const diemCao = Math.max(...khop.map(doCuThe));
  const dau = khop.filter((q) => doCuThe(q) === diemCao);
  if (dau.length > 1) {
    return {
      ok: false,
      ma: "CHONG_HIEU_LUC",
      cacQuyTac: dau.map(idQuyTac).sort(),
      thongDiep: `Có ${dau.length} quy tắc cùng độ cụ thể cùng hiệu lực ngày ${ngay}: ${dau.map(idQuyTac).sort().join(", ")} — sửa chính sách trước khi lập hoá đơn.`,
    };
  }
  return { ok: true, quyTac: dau[0]! };
}

// ── KIỂM BỘ QUY TẮC ───────────────────────────────────────────────────────

export type VanDeChinhSach = {
  ma: "HIEU_LUC_NGUOC" | "NGAY_KHONG_HOP_LE" | "CHONG_HIEU_LUC" | "KHOANG_HO" | "THONG_SO_SAI" | "TRUNG_PHIEN_BAN";
  cap: "LOI" | "CANH_BAO";
  cacQuyTac: string[];
  thongDiep: string;
};

/**
 * Kiểm tính hợp lệ của CẢ BỘ (đường ghi chính sách sau này PHẢI gọi trước khi lưu — xem `kiemCauHinhHoaDon`, hôm nay
 * chưa đường ghi nào gọi nó). Rỗng ⇔ sạch. `KHOANG_HO` chỉ là CẢNH BÁO: hở ngày giữa hai phiên bản cùng phạm vi
 * không sai về dữ liệu, nhưng `resolve` sẽ trả `KHONG_CO` đúng trong khoảng đó.
 */
export function kiemBoQuyTac(chinhSach: readonly QuyTac[]): VanDeChinhSach[] {
  const vd: VanDeChinhSach[] = [];
  const daGap = new Map<string, string>();
  for (const q of chinhSach) {
    const id = idQuyTac(q);
    if (!Number.isInteger(q.phienBan) || q.phienBan < 1 || q.ma.trim() === "") {
      vd.push({ ma: "THONG_SO_SAI", cap: "LOI", cacQuyTac: [id], thongDiep: `${id}: mã chính sách rỗng hoặc phiên bản không phải số nguyên ≥ 1.` });
    }
    if (daGap.has(id)) vd.push({ ma: "TRUNG_PHIEN_BAN", cap: "LOI", cacQuyTac: [id], thongDiep: `${id}: trùng (mã, phiên bản).` });
    daGap.set(id, id);

    const tuOk = q.hieuLucTu === null || laNgayHopLe(q.hieuLucTu);
    const denOk = q.hieuLucDen === null || laNgayHopLe(q.hieuLucDen);
    if (!tuOk || !denOk) vd.push({ ma: "NGAY_KHONG_HOP_LE", cap: "LOI", cacQuyTac: [id], thongDiep: `${id}: ngày hiệu lực không hợp lệ.` });
    else if (q.hieuLucTu !== null && q.hieuLucDen !== null && q.hieuLucTu > q.hieuLucDen) {
      vd.push({ ma: "HIEU_LUC_NGUOC", cap: "LOI", cacQuyTac: [id], thongDiep: `${id}: ngày kết thúc (${q.hieuLucDen}) trước ngày bắt đầu (${q.hieuLucTu}).` });
    }
    const m = q.thongSo.mucThue;
    if (m.kieu === "SUAT" && (!Number.isInteger(m.phanTram) || m.phanTram < 0 || m.phanTram > 100)) {
      vd.push({ ma: "THONG_SO_SAI", cap: "LOI", cacQuyTac: [id], thongDiep: `${id}: thuế suất ${m.phanTram} phải là số nguyên 0–100.` });
    }
    if (q.thongSo.donViTinh.trim() === "") vd.push({ ma: "THONG_SO_SAI", cap: "LOI", cacQuyTac: [id], thongDiep: `${id}: thiếu đơn vị tính.` });
  }

  const bat = chinhSach.filter((q) => q.dangBat && (q.hieuLucTu === null || laNgayHopLe(q.hieuLucTu)) && (q.hieuLucDen === null || laNgayHopLe(q.hieuLucDen)));
  for (let i = 0; i < bat.length; i++) {
    for (let j = i + 1; j < bat.length; j++) {
      const a = bat[i]!;
      const b = bat[j]!;
      if (doCuThe(a) === doCuThe(b) && tuongThich(a, b) && trungNgay(a, b)) {
        const ids = [idQuyTac(a), idQuyTac(b)].sort();
        vd.push({ ma: "CHONG_HIEU_LUC", cap: "LOI", cacQuyTac: ids, thongDiep: `${ids.join(" và ")} chồng hiệu lực ở cùng phạm vi.` });
      }
    }
  }

  // Khoảng hở: trong CÙNG phạm vi đích danh, giữa hai quy tắc kế tiếp theo ngày.
  const theoPhamVi = new Map<string, QuyTac[]>();
  for (const q of bat) theoPhamVi.set(khoaPhamVi(q), [...(theoPhamVi.get(khoaPhamVi(q)) ?? []), q]);
  for (const ds of theoPhamVi.values()) {
    const xep = [...ds].sort((a, b) => tu(a).localeCompare(tu(b)));
    for (let i = 0; i + 1 < xep.length; i++) {
      const truoc = xep[i]!;
      const sau = xep[i + 1]!;
      if (truoc.hieuLucDen !== null && sau.hieuLucTu !== null && ngayKeTiep(truoc.hieuLucDen) < sau.hieuLucTu) {
        const ids = [idQuyTac(truoc), idQuyTac(sau)];
        vd.push({ ma: "KHOANG_HO", cap: "CANH_BAO", cacQuyTac: ids, thongDiep: `Hở ngày giữa ${ids[0]} (đến ${truoc.hieuLucDen}) và ${ids[1]} (từ ${sau.hieuLucTu}) — trong khoảng đó không có quy tắc nào.` });
      }
    }
  }
  return vd;
}

/** Quy tắc sắp hết hiệu lực trong `soNgay` ngày kể từ `ngay`? (`soNgay` BẮT BUỘC — hạn cảnh báo là quyết định vận hành, không phải hằng.) */
export function canhBaoSapHetHan(q: QuyTac, ngay: string, soNgay: number): string | null {
  if (q.hieuLucDen === null || !laNgayHopLe(ngay) || !laNgayHopLe(q.hieuLucDen)) return null;
  const con = soNgayGiua(ngay, q.hieuLucDen);
  if (con < 0 || con > soNgay) return null;
  return `Quy tắc ${idQuyTac(q)} hết hiệu lực ngày ${q.hieuLucDen} (còn ${con} ngày) — kiểm tra phiên bản kế tiếp trước khi hết hạn.`;
}

// ── CHIẾU CẤU HÌNH HIỆN HÀNH ──────────────────────────────────────────────

/**
 * Bản CHIẾU của `CauHinhHoaDon.thue` đang sống trong mã, dưới dạng quy tắc — để shadow so sánh với
 * `thueChoLoaiDon`. Mỗi dòng `thue` ⇒ một quy tắc khoá theo `loaiDon`, không ngày hiệu lực, `nguon: "HIEN_HANH"`.
 *
 * ⚠️ `cauHinh` là THAM SỐ (luật `[PNT-W1]`: chỉ `phap-nhan.ts` được nhắc hằng cấu hình; mọi nơi khác nhận nó qua
 * `cauHinhHoaDonChoMoiTruong()`). Ngoài thuế, cấu hình hiện hành KHÔNG chứa đơn vị tính / cách thể hiện số buổi
 * (chúng nằm rải ở `phieu-thu-data.ts`), nên các tham số đó ở đây là NHÃN TẠM của bản chiếu — "Lần" là nhãn mặc định
 * của `donViTinhTheoDong` — chưa phải chính sách.
 */
export function chinhSachHienHanh(cauHinh: Pick<CauHinhHoaDon, "thue">): QuyTac[] {
  return cauHinh.thue.map((t) => ({
    ma: `HIEN_HANH:${t.loaiDon}`,
    phienBan: 1,
    phapNhanMa: null,
    centerId: null,
    loaiKhoan: t.loaiDon,
    hieuLucTu: null,
    hieuLucDen: null,
    dangBat: true,
    nguon: "HIEN_HANH" as const,
    canCuPhapLy: null,
    thongSo: {
      mucThue: { kieu: "SUAT" as const, phanTram: t.thueSuat },
      kieuGia: t.kieuGia,
      donViTinh: "Lần",
      donViTinhBuoi: "Buổi",
      cachThuSoBuoi: "MOT_KHOA_MO_TA_SO_BUOI" as const,
      mauMoTaSoBuoi: "({n} buổi)",
      thoiDiemLap: "DO_KE_TOAN_CHOT" as const,
    },
  }));
}

// ── MÔ PHỎNG (KHÔNG PHÁT HÀNH) ────────────────────────────────────────────

export type DauVaoMoPhong = {
  ma: string;
  tenGoc: string;
  loaiKhoan: string;
  soTien: number;
  /** Số buổi của dòng (khoá học) — `null` nếu không có. BẮT BUỘC khai (luật 7): quên là mất mô tả số buổi. */
  soBuoi: number | null;
};

export type LoiMoPhong = { ma: string; dong: string | null; thongDiep: string };

export type KetQuaMoPhong =
  | {
      ok: true;
      /** Cố định: đây là bản XEM TRƯỚC. Không có đường nào từ đây tới nhà cung cấp hay sổ tiền. */
      xemTruoc: true;
      daPhatHanh: false;
      ngay: string;
      tinh: Extract<KetQuaTinh, { ok: true }>;
      quyTacDaDung: { dong: string; quyTac: string; nguon: NguonQuyTac; thoiDiemLap: ThoiDiemLap }[];
      canhBao: string[];
    }
  | { ok: false; xemTruoc: true; daPhatHanh: false; loi: LoiMoPhong[] };

const tuLoiTinh = (l: LoiTinh): LoiMoPhong => ({ ma: l.ma, dong: l.dong, thongDiep: l.thongDiep });

/**
 * Xem trước một hoá đơn theo chính sách: resolve TỪNG dòng (hoá đơn nhiều loại khoản ⇒ nhiều mức thuế) → dựng
 * dòng → `tinhHoaDon`. Một dòng không resolve được ⇒ cả bản xem trước thất bại, kèm lỗi của MỌI dòng hỏng.
 */
export function moPhong(input: {
  chinhSach: readonly QuyTac[];
  phapNhanMa: string;
  centerId: string;
  ngay: string;
  dong: readonly DauVaoMoPhong[];
  tongChietKhau: number;
  laDieuChinh: boolean;
  /** Cảnh báo quy tắc sắp hết hạn trong bấy nhiêu ngày. BẮT BUỘC. */
  canhBaoHetHanTrongNgay: number;
}): KetQuaMoPhong {
  const loi: LoiMoPhong[] = [];
  const dauVao: Parameters<typeof tinhHoaDon>[0]["dong"][number][] = [];
  const dung: { dong: string; quyTac: QuyTac }[] = [];
  for (const d of input.dong) {
    const r = resolve(input.chinhSach, { phapNhanMa: input.phapNhanMa, centerId: input.centerId, loaiKhoan: d.loaiKhoan }, input.ngay);
    if (!r.ok) {
      loi.push({ ma: r.ma, dong: d.ma, thongDiep: r.thongDiep });
      continue;
    }
    const ts = r.quyTac.thongSo;
    const tb = trinhBaySoBuoi({ tenGoc: d.tenGoc, soBuoi: d.soBuoi, cach: ts.cachThuSoBuoi, donViTinhKhoa: ts.donViTinh, donViTinhBuoi: ts.donViTinhBuoi, mauMoTaSoBuoi: ts.mauMoTaSoBuoi });
    if (!tb.ok) {
      loi.push({ ma: tb.loi.ma, dong: d.ma, thongDiep: tb.loi.thongDiep });
      continue;
    }
    dung.push({ dong: d.ma, quyTac: r.quyTac });
    dauVao.push({
      ma: d.ma,
      ten: tb.dong.ten,
      donViTinh: tb.dong.donViTinh,
      soLuong: tb.dong.soLuong,
      soTien: d.soTien,
      mucThue: ts.mucThue,
      kieuGia: ts.kieuGia,
      moTaSoBuoi: tb.dong.moTaSoBuoi,
      thamChieuChinhSach: idQuyTac(r.quyTac),
    });
  }
  if (loi.length > 0) return { ok: false, xemTruoc: true, daPhatHanh: false, loi };

  const tinh = tinhHoaDon({ dong: dauVao, tongChietKhau: input.tongChietKhau, laDieuChinh: input.laDieuChinh });
  if (!tinh.ok) return { ok: false, xemTruoc: true, daPhatHanh: false, loi: tinh.loi.map(tuLoiTinh) };

  const canhBao: string[] = [];
  const daBao = new Set<string>();
  for (const { quyTac } of dung) {
    const id = idQuyTac(quyTac);
    if (daBao.has(id)) continue;
    daBao.add(id);
    const cb = canhBaoSapHetHan(quyTac, input.ngay, input.canhBaoHetHanTrongNgay);
    if (cb) canhBao.push(cb);
  }
  return {
    ok: true,
    xemTruoc: true,
    daPhatHanh: false,
    ngay: input.ngay,
    tinh,
    quyTacDaDung: dung.map((x) => ({ dong: x.dong, quyTac: idQuyTac(x.quyTac), nguon: x.quyTac.nguon, thoiDiemLap: x.quyTac.thongSo.thoiDiemLap })),
    canhBao,
  };
}

export { khoaNhomThue };
