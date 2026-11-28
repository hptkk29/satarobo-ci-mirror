import { z } from "zod";

import { db } from "@/lib/db";
import { docConCuaPhuHuynh, docDanhSachDonOnline, docDonOnlineCuaPhuHuynh, docKhoaMuaDuocChoCon, huyDonOnlineChuaThanhToan } from "@/lib/online-checkout/phu-huynh";
import { dungHuongDanThanhToan, type HuongDanThanhToan } from "@/lib/online-checkout/huong-dan-thanh-toan";
import { docGio, huyDonKhoiPhucGio } from "@/lib/online-checkout/gio-hang-luu";
import { getSetting } from "@/lib/settings/service";
import { taoDonOnline, xemTruocDonOnline, type MaLoiTaoDon } from "@/lib/online-checkout/tao-don";

import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTatOnline } from "./online-hoc";

/**
 * V8.15 — ONLINE P2 phía phụ huynh: lớp HTTP MỎNG trên `lib/online-checkout/*` (A) — giỏ nhiều khoá · nhiều con → ĐƠN Online. KHÔNG có engine thanh toán/quyền học thứ hai:
 *   · giá/tiên quyết/trọn đời/mã giảm/idempotency do `taoDonOnline` quyết (client KHÔNG gửi số tiền — lược đồ `.strict()`, thêm khoá lạ ⇒ 400);
 *   · quyền học chỉ được CẤP bởi cầu nối thanh toán đã xác minh (webhook/ghi tay → `hichCapQuyenHocChoDon` → `capQuyenHoc` của E) — KHÔNG có route nào ở đây cấp quyền, không tin redirect của trình duyệt/app;
 *   · `parentUserId` từ PHIÊN; mọi `studentId` phải là con của phụ huynh (sai ⇒ 404 không phân biệt «không có»/«của nhà khác»);
 *   · cờ `ELEARNING_ONLINE_ENABLED` tắt ⇒ 404; chế độ học sinh ⇒ 403 (allow-list mặc định từ chối — các route này KHÔNG nằm trong allow-list).
 * CHƯA có (cố ý, `BLOCKED_OWNER`): hướng dẫn chuyển khoản/QR cho đơn Online — phản hồi trả `huongDanThanhToan: null` + `gioiHan` nói rõ; app KHÔNG được vẽ QR/nút «đã chuyển».
 */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const gioHangOnlineSchema = z
  .object({
    dong: z
      .array(
        z
          .object({
            studentId: z.string().min(1, "Chọn con cho từng khoá.").max(64),
            khoaId: z.string().min(1, "Thiếu mã khoá.").max(64),
            voucherId: z.string().min(1).max(64).nullable().optional(),
            /** Mã khuyến mãi người dùng GÕ — máy chủ tra mã, kiểm kênh ONLINE/khoá/thời hạn/lượt/đơn tối thiểu; KHÔNG gửi cùng `voucherId`. */
            maGiamGia: z.string().trim().min(1).max(40).nullable().optional(),
          })
          .strict(),
      )
      .min(1, "Giỏ hàng đang trống.")
      .max(20, "Giỏ hàng quá lớn."),
  })
  .strict();
export type GioHangOnlineBody = z.infer<typeof gioHangOnlineSchema>;

/** Mã lỗi lõi → HTTP. 400 = giỏ sai hình · 404 = không thấy · 422 = hồ sơ/mã giảm/giá cần sửa · 409 = trạng thái hiện tại không cho phép (khoá, đã có đơn chờ, đã trọn đời…). */
export const HTTP_TAO_DON: Record<MaLoiTaoDon, number> = {
  GIO_RONG: 400, QUA_NHIEU_DONG: 400, THIEU_HOC_VIEN: 400, THIEU_KHOA: 400, TRUNG_CAP_KHOA_HOC_VIEN: 400, DU_LIEU_SAI: 400,
  SAI_PHU_HUYNH: 404, KHOA_KHONG_TON_TAI: 404,
  THIEU_HO_SO_PHU_HUYNH: 422, THIEU_HO_SO_HOC_VIEN: 422, GIA_KHONG_HOP_LE: 422, DON_0_DONG: 422, KY_HAN_THIEU: 422, CHUA_DU_TIEN_QUYET: 422,
  MA_KHONG_TON_TAI: 422, MA_KHONG_DUNG_DUOC: 422, MA_HET_LUOT_CUA_CON: 422, MA_HET_SUAT: 409,
  CAU_HINH_THU_TIEN_KHONG_HOP_LE: 409,
  HET_HANG: 409, KHONG_BAN_ONLINE: 409, SAN_PHAM_KHONG_TON_TAI: 404, SO_LUONG_VUOT_TOI_DA: 409, GIA_DA_DOI: 409, THIEU_DIA_CHI: 422, CHUA_CHON_PHUONG_THUC_GIAO: 422, PHUONG_THUC_GIAO_KHONG_HOP_LE: 422,
  KHOA_CHUA_PHAT_HANH: 409, KHOA_KHONG_DANG_BAN: 409, DA_TRON_DOI: 409, KHOA_KHONG_CHO_GIA_HAN: 409, CHUA_CO_QUYEN_DE_GIA_HAN: 409, DA_CO_DON_DANG_CHO: 409,
};

/**
 * `huongDanThanhToan` CHỈ khác null khi `trangThai === "SAN_SANG"` (cấu hình do chủ dự án duyệt). Mọi trạng thái khác ⇒ null + `huongDanTrangThai`/`huongDanLyDo`
 * (+ `thongTinCanOwnerCungCap` khi chưa cấu hình): app KHÔNG vẽ QR. Ở chế độ TEST `choPhepChuyenTien:false` + `nhan` — app chỉ hiện nhãn, không cho chuyển.
 */
export async function huongDanChoDon(orderId: string) {
  const h: HuongDanThanhToan = await dungHuongDanThanhToan(db as never, orderId);
  return {
    huongDanThanhToan: h.trangThai === "SAN_SANG" ? h : null,
    huongDanTrangThai: h.trangThai,
    huongDanLyDo: h.trangThai === "SAN_SANG" ? null : h.lyDo,
    thongTinCanOwnerCungCap: h.trangThai === "CHUA_CAU_HINH" ? h.thongTinCanOwnerCungCap : null,
  };
}

export const GIOI_HAN_THANH_TOAN = [
  "Hướng dẫn chuyển khoản/QR cho đơn Online chưa có: chờ chủ dự án chốt tài khoản nhận và khuôn nội dung chuyển khoản. App không được hiển thị QR hay nút «đã chuyển».",
  "Quyền học chỉ được cấp sau khi tiền được xác minh (webhook ngân hàng/ghi nhận của kế toán), không cấp theo thao tác trên app.",
];

/** GET /students/:id/online/purchasable — khoá ĐANG BÁN mà con này mua/gia hạn được + giá (cùng luật với tạo đơn). */
export async function khoaMuaDuocChoCon(parentUserId: string, hs: MaHocVienDaKiem) {
  batNeuTatOnline();
  const ds = await docKhoaMuaDuocChoCon(db as never, { parentUserId, studentId: hs, now: new Date() });
  if (ds === null) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  return { muc: ds.map((k) => ({ ...k, hetHanHienTai: iso(k.hetHanHienTai) })) };
}

/** GET /parent/online/students — con của phụ huynh + cờ «chỉ học Online» (để chọn con khi mua). */
export async function conDeMuaOnline(parentUserId: string) {
  batNeuTatOnline();
  return { muc: await docConCuaPhuHuynh(db as never, { parentUserId, now: new Date() }) };
}

/** POST /parent/online-orders — tạo đơn từ giỏ. Bấm đúp/thử lại cùng giỏ ⇒ trả lại ĐƠN CŨ (`daCo:true`). */
export async function taoDonOnlineMobile(parentUserId: string, body: GioHangOnlineBody) {
  batNeuTatOnline();
  const r = await taoDonOnline(db as never, {
    parentUserId,
    gioHang: body.dong.map((d) => ({ courseId: d.khoaId, studentId: d.studentId, voucherId: d.voucherId ?? null, maGiamGia: d.maGiamGia ?? null })),
    now: new Date(),
  });
  if (!r.ok) {
    const status = HTTP_TAO_DON[r.ma];
    if (status === undefined) throw new LoiApiMobile("SERVER", 500, "Lỗi tạo đơn (mã chưa được ánh xạ).");
    if (r.ma === "SAI_PHU_HUYNH") throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    throw Object.assign(new LoiApiMobile(r.ma as never, status, r.thongBao), r.viTri !== undefined ? { viTri: r.viTri } : {});
  }
  return {
    orderId: r.orderId,
    orderCode: r.orderCode,
    daCo: r.daCo,
    trangThaiThanhToan: "CHO_THANH_TOAN" as const,
    tongTien: r.tongTien,
    giamTong: r.giamTong,
    dong: r.dong,
    ...(await huongDanChoDon(r.orderId)),
    gioiHan: GIOI_HAN_THANH_TOAN,
  };
}

/**
 * POST /parent/online-orders/preview — XEM TRƯỚC GIÁ: cùng giỏ, cùng cổng, cùng mã giảm như tạo đơn nhưng KHÔNG tạo đơn, KHÔNG dùng lượt mã.
 * Kết quả chỉ để HIỂN THỊ — giá thật vẫn do máy chủ chốt lại lúc tạo đơn (mã có thể hết suất giữa hai lần gọi ⇒ 409 MA_HET_SUAT lúc tạo).
 */
export async function xemTruocGiaOnlineMobile(parentUserId: string, body: GioHangOnlineBody) {
  batNeuTatOnline();
  const r = await xemTruocDonOnline(db as never, {
    parentUserId,
    gioHang: body.dong.map((d) => ({ courseId: d.khoaId, studentId: d.studentId, voucherId: d.voucherId ?? null, maGiamGia: d.maGiamGia ?? null })),
    now: new Date(),
  });
  if (!r.ok) {
    const status = HTTP_TAO_DON[r.ma];
    if (status === undefined) throw new LoiApiMobile("SERVER", 500, "Lỗi xem trước giá (mã chưa được ánh xạ).");
    if (r.ma === "SAI_PHU_HUYNH") throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    throw new LoiApiMobile(r.ma as never, status, r.thongBao);
  }
  return { tongTien: r.tongTien, giamTong: r.giamTong, dong: r.dong, chiXemTruoc: true as const };
}

/** GET /parent/online-orders — các đơn Online của phụ huynh (mới nhất trước). */
export async function danhSachDonOnlineMobile(parentUserId: string) {
  batNeuTatOnline();
  const ds = await docDanhSachDonOnline(db as never, { parentUserId });
  return { muc: ds.map((d) => ({ ...d, taoLuc: d.taoLuc.toISOString() })) };
}

/** GET /parent/online-orders/:orderId — chi tiết + trạng thái cấp quyền từng dòng (DANG_CHO_THANH_TOAN → DA_CAP_QUYEN / CAN_NHAN_VIEN_XU_LY). Đơn của người khác/không có ⇒ 404. */
export async function chiTietDonOnlineMobile(parentUserId: string, orderId: string) {
  batNeuTatOnline();
  if (!orderId || orderId.length > 64) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const d = await docDonOnlineCuaPhuHuynh(db as never, { parentUserId, orderId, choPhepGuiYeuCauHoan: await choPhepGuiYeuCauHoan() });
  if (!d) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  return { ...d, taoLuc: d.taoLuc.toISOString(), lichSuThanhToan: d.lichSuThanhToan.map((k) => ({ ...k, ngay: k.ngay.toISOString() })), bienNhan: d.bienNhan.map((r) => ({ ...r, phatHanhLuc: r.phatHanhLuc.toISOString() })), dong: d.dong.map((x) => ({ ...x, hetHan: iso(x.hetHan), thuLaiLuc: iso(x.thuLaiLuc) })), giuKho: d.giuKho ? { trangThai: d.giuKho.trangThai, hanGiuLuc: d.giuKho.hanGiuLuc.toISOString() } : null, gioMayChu: new Date().toISOString(), ...(await huongDanChoDon(orderId)), gioiHan: GIOI_HAN_THANH_TOAN };
}

const HTTP_HUY = { KHONG_TIM_THAY: 404, DA_CO_TIEN: 409, DA_CAP_QUYEN: 409, SAI_TRANG_THAI: 409 } as const;

/**
 * POST /parent/online-orders/:orderId/cancel — huỷ đơn CHƯA có đồng nào/CHƯA cấp quyền (idempotent: huỷ lại ⇒ `daHuyTruocDo:true`).
 * `khoiPhucVaoGio:true` (V8.34) ⇒ trả các dòng của đơn về giỏ đã lưu (Owner: «không xoá giỏ») và trả `gio` + `soDongKhoiPhuc`; mặc định false = hành vi cũ.
 */
const choPhepGuiYeuCauHoan = async (): Promise<boolean> => (await getSetting("onlineRefund.parentRequestEnabled")) === true;

export async function huyDonOnlineMobile(parentUserId: string, orderId: string, khoiPhucVaoGio = false) {
  batNeuTatOnline();
  if (!orderId || orderId.length > 64) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const r = khoiPhucVaoGio
    ? await huyDonKhoiPhucGio(db as never, { parentUserId, orderId, now: new Date() })
    : await huyDonOnlineChuaThanhToan(db as never, { parentUserId, orderId, now: new Date() });
  if (!r.ok) {
    if (r.ma === "KHONG_TIM_THAY") throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    throw new LoiApiMobile(r.ma as never, HTTP_HUY[r.ma], r.thongBao);
  }
  if (!khoiPhucVaoGio) return { daHuy: true, daHuyTruocDo: r.daHuyTruocDo };
  return { daHuy: true, daHuyTruocDo: r.daHuyTruocDo, khoiPhucVaoGio: true as const, soDongKhoiPhuc: "soDongKhoiPhuc" in r ? r.soDongKhoiPhuc : 0, gio: await docGio(db as never, { parentUserId, now: new Date() }) };
}
