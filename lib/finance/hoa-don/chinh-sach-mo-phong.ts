// lib/finance/hoa-don/chinh-sach-mo-phong.ts — MÔ PHỎNG BẮT BUỘC TRƯỚC KHI DUYỆT chính sách hoá đơn + BĂM chứng minh "đã xem mô phỏng
// của CHÍNH nội dung này". THUẦN (không Prisma/DB/env/đồng hồ) nhưng dùng `node:crypto` ⇒ CHỈ server import — client component nhận
// kết quả đã tính + chuỗi băm qua props và `import type` từ `chinh-sach-phien-ban.ts` (tsc xanh mà `next build` đỏ nếu client import tệp này).
//
// ─────────────────────────────────────────────────────────────────────────────
// BA LUẬT
//
//   1. KHÔNG có bản "mô phỏng" riêng: mỗi mẫu đi qua ĐÚNG `moPhong` của engine S3 (`engine/chinh-sach.ts`) — cùng `resolve`, cùng
//      `tinhHoaDon`. Lưới `[CSMP-W1]` canh: tệp này gọi `moPhong(` và KHÔNG import `tinhHoaDon`/`resolve` trực tiếp.
//   2. TẬP MẪU DO SERVER DỰNG, client không bao giờ gửi. Nếu client gửi tập mẫu thì băm chỉ chứng minh người đó đã xem THỨ NGƯỜI ĐÓ TỰ
//      CHỌN. `dungTapMau` là hàm tất định theo danh sách loại khoản của ứng viên ∪ chính sách đang hiệu lực.
//   3. Băm gắn với CẢ nội dung chuẩn hoá, tập mẫu, VÀ bối cảnh (id bản ghi, phiên bản, phạm vi, khoảng hiệu lực, ngày xét, danh sách
//      quy tắc đang hiệu lực làm mốc "trước"). Một bản nháp giống hệt ở phạm vi/ngày khác, hay chính sách đang hiệu lực vừa đổi, cho
//      băm KHÁC ⇒ duyệt bị từ chối, người duyệt phải xem lại.
//
// ⚠️ Tập mẫu là SỐ MINH HOẠ để so trước/sau, KHÔNG phải dữ liệu thật của khách. Màn phải nói thẳng điều đó.

import { createHash } from "node:crypto";
import { moPhong, type QuyTac } from "./engine/chinh-sach";
import { phanTichNoiDung, sangQuyTac, type NoiDungChinhSach, type PhamViBan } from "./chinh-sach-phien-ban";

/** Quy ước `centerId` khi mô phỏng chính sách DÙNG CHUNG (không có cơ sở cụ thể): chỉ khớp quy tắc `centerId = null`. */
export const CO_SO_MO_PHONG_DUNG_CHUNG = "*";
/** Ngưỡng cảnh báo "sắp hết hiệu lực" trong mô phỏng — ĐỀ XUẤT, chờ OD-14 (04 §6.2). */
export const CANH_BAO_HET_HAN_MO_PHONG_NGAY = 60;
export const TOI_DA_MAU_MO_PHONG = 60;

export type MauMoPhong = { ma: string; tenGoc: string; loaiKhoan: string; soTien: number; soBuoi: number | null };

/** Số liệu minh hoạ (hình dạng như học phí thật, không tròn trịa ở phần lẻ khi chia thuế). */
const MAU_KHOA_HOC = { tenGoc: "Khoá học (mẫu)", soTien: 8_976_000, soBuoi: 48 as number | null };
const MAU_KHAC = { tenGoc: "Khoản thu (mẫu)", soTien: 1_234_567, soBuoi: null as number | null };

/** Mỗi loại khoản một mẫu, sắp theo tên (tất định). `COURSE` có số buổi để mô phỏng cách thể hiện số buổi. */
export function dungTapMau(cacLoaiKhoan: readonly string[]): MauMoPhong[] {
  return [...new Set(cacLoaiKhoan)]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, TOI_DA_MAU_MO_PHONG)
    .map((loaiKhoan) => {
      const m = loaiKhoan === "COURSE" ? MAU_KHOA_HOC : MAU_KHAC;
      return { ma: `mau-${loaiKhoan}`, tenGoc: m.tenGoc, loaiKhoan, soTien: m.soTien, soBuoi: m.soBuoi };
    });
}

// ── KẾT QUẢ ───────────────────────────────────────────────────────────────

export type KetQuaMotMau =
  | { ok: true; thanhTienTruocThue: number; tienThue: number; congTien: number; nhomThue: string; quyTac: string; canhBao: string[] }
  | { ok: false; ma: string; thongDiep: string };

export type DongMoPhong = { mau: MauMoPhong; truoc: KetQuaMotMau; sau: KetQuaMotMau; doi: boolean };

export type KetQuaMoPhongChinhSach = {
  /** Cố định: bản XEM TRƯỚC, không phát hành, không chạm sổ tiền. */
  xemTruoc: true;
  ngay: string;
  dong: DongMoPhong[];
  soMau: number;
  soMauDoiKetQua: number;
  /** Mẫu "sau" KHÔNG tính được (thiếu/chồng quy tắc) — chính sách mới để hở loại khoản mà chính sách cũ có. */
  soMauSauLoi: number;
  /** Σ (thuế sau − thuế trước) trên các mẫu tính được ở CẢ HAI bên; `null` khi không mẫu nào so được. */
  chenhLechThue: number | null;
};

const MOT_DONG = (m: MauMoPhong) => [{ ma: m.ma, tenGoc: m.tenGoc, loaiKhoan: m.loaiKhoan, soTien: m.soTien, soBuoi: m.soBuoi }];

function chayMotMau(chinhSach: readonly QuyTac[], phapNhanMa: string, centerId: string | null, ngay: string, m: MauMoPhong): KetQuaMotMau {
  const r = moPhong({
    chinhSach,
    phapNhanMa,
    centerId: centerId ?? CO_SO_MO_PHONG_DUNG_CHUNG,
    ngay,
    dong: MOT_DONG(m),
    tongChietKhau: 0,
    laDieuChinh: false,
    canhBaoHetHanTrongNgay: CANH_BAO_HET_HAN_MO_PHONG_NGAY,
  });
  if (!r.ok) {
    const l = r.loi[0]!;
    return { ok: false, ma: l.ma, thongDiep: l.thongDiep };
  }
  const nhom = r.tinh.tong.theoNhomThue[0];
  return {
    ok: true,
    thanhTienTruocThue: r.tinh.tong.thanhTienTruocThue,
    tienThue: r.tinh.tong.tienThue,
    congTien: r.tinh.tong.congTienThanhToan,
    nhomThue: nhom ? nhom.khoa : "",
    quyTac: r.quyTacDaDung[0]?.quyTac ?? "",
    canhBao: r.canhBao,
  };
}

const giongNhau = (a: KetQuaMotMau, b: KetQuaMotMau): boolean => {
  if (!a.ok && !b.ok) return a.ma === b.ma;
  if (a.ok && b.ok) return a.tienThue === b.tienThue && a.thanhTienTruocThue === b.thanhTienTruocThue && a.congTien === b.congTien && a.nhomThue === b.nhomThue;
  return false;
};

/**
 * Chạy trước/sau trên tập mẫu. "Trước" = chính sách đang hiệu lực (`hienHanh`). "Sau" = ứng viên + các quy tắc đang hiệu lực của
 * phạm vi KHÁC (quy tắc cùng phạm vi với ứng viên bị phiên bản mới thay — nếu chúng còn phủ ngày xét thì ứng viên sẽ bị từ chối chồng
 * ở bước duyệt, nên mô phỏng không giả vờ chúng còn tồn tại).
 */
export function chayMoPhong(input: { ungVien: readonly QuyTac[]; hienHanh: readonly QuyTac[]; phamVi: PhamViBan; ngay: string; tapMau: readonly MauMoPhong[] }): KetQuaMoPhongChinhSach {
  const { phamVi, ngay } = input;
  const khacPhamVi = input.hienHanh.filter((q) => !(q.phapNhanMa === phamVi.phapNhanMa && q.centerId === phamVi.centerId));
  const sauBo = [...input.ungVien, ...khacPhamVi];
  const dong: DongMoPhong[] = input.tapMau.map((mau) => {
    const truoc = chayMotMau(input.hienHanh, phamVi.phapNhanMa, phamVi.centerId, ngay, mau);
    const sau = chayMotMau(sauBo, phamVi.phapNhanMa, phamVi.centerId, ngay, mau);
    return { mau, truoc, sau, doi: !giongNhau(truoc, sau) };
  });
  let chenh = 0;
  let soSoDuoc = 0;
  for (const d of dong) {
    if (d.truoc.ok && d.sau.ok) {
      chenh += d.sau.tienThue - d.truoc.tienThue;
      soSoDuoc += 1;
    }
  }
  return {
    xemTruoc: true,
    ngay,
    dong,
    soMau: dong.length,
    soMauDoiKetQua: dong.filter((d) => d.doi).length,
    soMauSauLoi: dong.filter((d) => !d.sau.ok).length,
    chenhLechThue: soSoDuoc > 0 ? chenh : null,
  };
}

// ── BĂM ───────────────────────────────────────────────────────────────────

export type BoiCanhMoPhong = {
  id: string;
  phienBan: number;
  phapNhanMa: string;
  centerId: string | null;
  hieuLucTu: string;
  hieuLucDen: string | null;
  ngay: string;
  /** `idQuyTac` của các quy tắc đang hiệu lực làm mốc "trước", đã sắp. */
  hienHanh: readonly string[];
};

/** Chuỗi chuẩn: khoá object sắp, mảng giữ thứ tự, chuỗi NFC, không `undefined`. KHÔNG phải `JSON.stringify` thường (thứ tự khoá). */
export function chuoiChuan(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(chuoiChuan).join(",")}]`;
  switch (typeof v) {
    case "string":
      return JSON.stringify(v.normalize("NFC"));
    case "number":
      if (!Number.isFinite(v)) throw new Error("Không băm được số không hữu hạn");
      return String(v);
    case "boolean":
      return v ? "true" : "false";
    case "object": {
      const o = v as Record<string, unknown>;
      const khoa = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      return `{${khoa.map((k) => `${JSON.stringify(k.normalize("NFC"))}:${chuoiChuan(o[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`Không băm được kiểu ${typeof v}`);
  }
}

/** sha256 (hex) của nội dung chuẩn hoá + tập mẫu + bối cảnh. */
export function tinhMoPhongHash(noiDung: NoiDungChinhSach, tapMau: readonly MauMoPhong[], boiCanh: BoiCanhMoPhong): string {
  return createHash("sha256").update(chuoiChuan({ noiDung, tapMau, boiCanh })).digest("hex");
}

// ── MỘT HÀM CHO CẢ TRANG VÀ BƯỚC DUYỆT ────────────────────────────────────

export type BanMoPhong = { id: string; phienBan: number; phapNhanMa: string; centerId: string | null; hieuLucTu: string; hieuLucDen: string | null };

export type KetQuaDungMoPhong =
  | { ok: true; noiDung: NoiDungChinhSach; tapMau: MauMoPhong[]; ketQua: KetQuaMoPhongChinhSach; hash: string; boiCanh: BoiCanhMoPhong }
  | { ok: false; loi: string[] };

/**
 * Dựng mô phỏng của MỘT phiên bản: phân tích nội dung → quy tắc → tập mẫu → chạy engine → băm. Trang (để HIỆN) và bước duyệt
 * (để KIỂM) cùng gọi hàm này với CÙNG đầu vào ⇒ người duyệt thấy đúng thứ server sẽ băm. Ngày xét = ngày bắt đầu hiệu lực.
 */
export function dungMoPhong(input: { ban: BanMoPhong; noiDungTho: unknown; hienHanh: readonly QuyTac[] }): KetQuaDungMoPhong {
  const p = phanTichNoiDung(input.noiDungTho);
  if (!p.ok) return { ok: false, loi: p.loi };
  const { ban } = input;
  const ungVien = sangQuyTac(ban, p.noiDung);
  const tapMau = dungTapMau([...ungVien.map((q) => q.loaiKhoan), ...input.hienHanh.map((q) => q.loaiKhoan)]);
  const ngay = ban.hieuLucTu;
  const phamVi = { phapNhanMa: ban.phapNhanMa, centerId: ban.centerId };
  const ketQua = chayMoPhong({ ungVien, hienHanh: input.hienHanh, phamVi, ngay, tapMau });
  const boiCanh: BoiCanhMoPhong = {
    id: ban.id,
    phienBan: ban.phienBan,
    phapNhanMa: ban.phapNhanMa,
    centerId: ban.centerId,
    hieuLucTu: ban.hieuLucTu,
    hieuLucDen: ban.hieuLucDen,
    ngay,
    hienHanh: input.hienHanh.map((q) => `${q.ma}@v${q.phienBan}`).sort(),
  };
  return { ok: true, noiDung: p.noiDung, tapMau, ketQua, hash: tinhMoPhongHash(p.noiDung, tapMau, boiCanh), boiCanh };
}
