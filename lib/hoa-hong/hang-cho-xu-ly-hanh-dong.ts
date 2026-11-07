// lib/hoa-hong/hang-cho-xu-ly-hanh-dong.ts — ĐIỀU PHỐI thao tác «Hàng chờ cần xử lý» (R9 · T1) giữa Server Action và `hang-cho-xu-ly-service`.
// Server Action (`.../so/_actions-hang-cho.ts`) CHỈ làm: auth → quyền `commission_periods:manage` → zod → gọi các hàm này → làm mới trang. Mọi luật (một/hai người · tiền · phạm vi · cổng của
// `giaiHangCho`) nằm ở service — ở đây chỉ: cờ engine/mốc cutover (hàng chờ chỉ tồn tại khi engine bật), dịch lỗi về câu tiếng Việt + mã máy, và biến kết quả thành dữ liệu SERIALIZE được cho client.
//
// ⚠️ KHÔNG kiểm QUYỀN CHỨC NĂNG — việc của Server Action ngay đầu hàm (luật cứng Nền #1). `now` và `PhuThuoc` BẮT BUỘC (luật 7 + 19).
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import type { BoiCanhQuet } from "./boi-canh";
import type { QuyetDinhGiai } from "./dieu-chinh";
import { chuCapDuyet, type CapDuyet, type TrangThaiXuLy } from "./hang-cho-xu-ly";
import { chuyenXemTay, deNghiXuLy, quyetXuLy, xemTruocXuLy, type XemTruocXuLy } from "./hang-cho-xu-ly-service";
import { HoaHongError } from "./kieu";
import type { KetQua, KetQuaThatBai, PhuThuoc } from "./ky-hanh-dong";
import type { NguoiThaoTacKy } from "./ky-service";
import { dinhDangDong } from "./vi-sao";

const thatBai = (ma: string, loi: string): KetQuaThatBai => ({ ok: false, ma, loi });
const ENGINE_TAT = thatBai("ENGINE_TAT", "Hoa hồng theo kỳ mới đang tắt — chưa xử lý được hàng chờ.");
const CHUA_CO_MOC = thatBai("CHUA_CO_MOC_CUTOVER", "Chưa đặt mốc chuyển sang hoa hồng mới — chưa có hàng chờ nào để xử lý.");

async function bao<T>(fn: () => Promise<KetQua<T>>): Promise<KetQua<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HoaHongError) return thatBai(e.ma, e.message);
    // Lỗi lạ ⇒ KHÔNG đưa chi tiết ra client (có thể chứa SQL/tên bảng); chỉ log tên lỗi.
    console.error("[hoa-hong/hang-cho-xu-ly] thao tác lỗi", e instanceof Error ? e.name : "?", e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "");
    return thatBai("LOI_LA", "Có lỗi khi thực hiện — thử lại, hoặc báo bộ phận kỹ thuật.");
  }
}

/** Dạng gửi xuống client: ngày là chuỗi ISO, không có Date/BigInt. */
export type XemTruocView = {
  holdId: string;
  code: string;
  giaiPhong: { ok: true; tongTuyetDoi: number; tongRong: number; chenh: { khoa: string; chenh: number }[]; kyDuKien: string } | { ok: false; ma: string; loi: string };
  tien: number | null;
  nguong: number | null;
  cap: CapDuyet;
  /** Câu giải thích VÌ SAO một hay hai người — dựng ở server từ cùng `chuCapDuyet`. */
  chuCap: string;
  trangThai: TrangThaiXuLy;
  deNghi: { nguoiId: string | null; tenNguoi: string; luc: string; quyetDinh: QuyetDinhGiai; tien: number; lyDo: string; bangChung: string } | null;
  xemTay: { tenNguoi: string; luc: string; lyDo: string } | null;
  /** Người đang xem chính là người đã đề nghị ⇒ KHÔNG được tự duyệt (UI nói rõ thay vì để bấm rồi bị từ chối). */
  laNguoiDeNghi: boolean;
};

function thanhView(x: XemTruocXuLy, nguoiId: string | null): XemTruocView {
  return {
    holdId: x.holdId,
    code: x.code,
    giaiPhong: x.giaiPhong,
    tien: x.tien,
    nguong: x.nguong,
    cap: x.cap,
    chuCap: chuCapDuyet(x.lyDoCap, dinhDangDong, x.nguong),
    trangThai: x.trangThai,
    deNghi: x.deNghi
      ? { nguoiId: x.deNghi.nguoiId, tenNguoi: x.deNghi.tenNguoi, luc: x.deNghi.luc.toISOString(), quyetDinh: x.deNghi.quyetDinh, tien: x.deNghi.tien, lyDo: x.deNghi.lyDo, bangChung: x.deNghi.bangChung }
      : null,
    xemTay: x.xemTay ? { tenNguoi: x.xemTay.tenNguoi, luc: x.xemTay.luc.toISOString(), lyDo: x.xemTay.lyDo } : null,
    laNguoiDeNghi: x.deNghi !== null && nguoiId !== null && x.deNghi.nguoiId === nguoiId,
  };
}

async function boiCanh(pt: PhuThuoc, now: Date): Promise<KetQuaThatBai | { bc: BoiCanhQuet }> {
  const b = await pt.dungBoiCanh(now);
  if (b.loai === "TAT") return b.lyDo === "ENGINE_TAT" ? ENGINE_TAT : CHUA_CO_MOC;
  return { bc: b.bc };
}

export async function xemTruocHanhDong(pt: PhuThuoc, i: { nguoi: NguoiThaoTacKy; now: Date; holdId: string }): Promise<KetQua<{ xem: XemTruocView }>> {
  return bao<{ xem: XemTruocView }>(async () => {
    const b = await boiCanh(pt, i.now);
    if ("ok" in b) return b;
    const x = await xemTruocXuLy(db, b.bc, { holdId: i.holdId, nguoi: i.nguoi, now: i.now });
    return { ok: true, thongBao: "", xem: thanhView(x, i.nguoi.userId) };
  });
}

export async function deNghiHanhDong(
  pt: PhuThuoc,
  i: { nguoi: NguoiThaoTacKy; now: Date; holdId: string; quyetDinh: QuyetDinhGiai; lyDo: string; bangChung: string },
): Promise<KetQua<{ daCoTruoc: boolean }>> {
  return bao<{ daCoTruoc: boolean }>(async () => {
    const b = await boiCanh(pt, i.now);
    if ("ok" in b) return b;
    const r = await deNghiXuLy(db, b.bc, i);
    return r.loai === "DA_CO_TRUOC"
      ? { ok: true, thongBao: "Đề nghị này đã được lập trước đó — đang chờ người khác duyệt.", daCoTruoc: true }
      : { ok: true, thongBao: "Đã lập đề nghị. Hàng chờ vẫn mở — cần MỘT NGƯỜI KHÁC duyệt để ghi.", daCoTruoc: false };
  });
}

export async function quyetHanhDong(
  pt: PhuThuoc,
  i: { nguoi: NguoiThaoTacKy; now: Date; holdId: string; quyetDinh: QuyetDinhGiai; lyDo: string; bangChung: string; tienDaThay: number },
): Promise<KetQua<{ daXuLyTruoc: boolean; soDong: number; tong: number }>> {
  return bao<{ daXuLyTruoc: boolean; soDong: number; tong: number }>(async () => {
    const b = await boiCanh(pt, i.now);
    if ("ok" in b) return b;
    const r = await quyetXuLy(db, b.bc, i);
    if (r.loai === "DA_XU_LY_TRUOC") return { ok: true, thongBao: "Hàng chờ này đã được bạn xử lý trước đó — không ghi lần hai.", daXuLyTruoc: true, soDong: 0, tong: 0 };
    const k = r.ketQua;
    if (k.loai === "DA_AP_DUNG") return { ok: true, thongBao: `Đã giải phóng: ghi ${k.soDong} dòng điều chỉnh (${dinhDangDong(k.tong)}) vào kỳ ${k.kyGhi}.`, daXuLyTruoc: false, soDong: k.soDong, tong: k.tong };
    if (k.loai === "KHONG_CAN_DIEU_CHINH") return { ok: true, thongBao: "Đã đóng hàng chờ — không còn chênh lệch nào cần điều chỉnh.", daXuLyTruoc: false, soDong: 0, tong: 0 };
    return { ok: true, thongBao: "Đã từ chối điều chỉnh (giữ nguyên) — hàng chờ đã đóng, sổ không đổi.", daXuLyTruoc: false, soDong: 0, tong: 0 };
  });
}

export async function chuyenXemTayHanhDong(pt: PhuThuoc, i: { nguoi: NguoiThaoTacKy; now: Date; holdId: string; lyDo: string }): Promise<KetQua<{ daCoTruoc: boolean }>> {
  return bao<{ daCoTruoc: boolean }>(async () => {
    const b = await boiCanh(pt, i.now);
    if ("ok" in b) return b;
    const r = await chuyenXemTay(db, i);
    return r.loai === "DA_CO_TRUOC"
      ? { ok: true, thongBao: "Hàng chờ này đã được chuyển xem tay trước đó.", daCoTruoc: true }
      : { ok: true, thongBao: "Đã chuyển xem tay. Hàng chờ vẫn mở và vẫn chặn khoá kỳ cho tới khi được giải.", daCoTruoc: false };
  });
}
