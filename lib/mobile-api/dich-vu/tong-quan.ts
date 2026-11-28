import { getParentNotificationFeed } from "@/lib/portal/notification-feed";
import { portalDb } from "@/lib/portal/db";
import { getTongQuan, type TongQuan } from "@/lib/portal/tong-quan";

import { lienHeCuaCoSo, type LienHeDto } from "../lien-he";

import type { MaHocVienDaKiem } from "../so-huu";

/**
 * `GET /students/:id/overview` — dùng lại `getTongQuan` của web (cùng nguồn với trang Tổng quan của cổng phụ huynh; mỗi con số lấy từ loader sẵn có,
 * KHÔNG tính lại ở đây). Chỉ nhận `MaHocVienDaKiem` + `parentUserId` từ phiên.
 *
 * Bỏ khỏi phản hồi (chưa thuộc phạm vi / có đường dẫn web / nhạy cảm): `sanPham` (ảnh), `nangLuc`, `viecCanLam` (có `href` web), `sapHetKhoa`,
 * `hocPhiChiTiet` (tài chính — chưa có quyết định hiển thị trên app), `nhomLop` (tin nhắn), `giaoVienNhan`, `luotCon`, `href`.
 * Trường nào không có dữ liệu thật ⇒ `null` / rỗng (không tự sinh số để làm đầy card).
 */
export type TongQuanDto = {
  homNay: string;
  tenCon: string;
  soThongBaoChuaDoc: number;
  tiepTheo: {
    nhanDemNgay: string;
    tieuDe: string;
    nhanBuoi: string;
    ngayNhan: string;
    gio: string | null;
    phong: string | null;
    giaoVien: string | null;
  } | null;
  hanhTrinh: {
    tenKhoa: string | null;
    dongTieuDe: string;
    hocPhan: Array<{ ma: string; ten: string; tong: number; daHoc: number; ong: Array<"xong" | "tiep" | "chua"> }>;
  };
  nhanXet: {
    giaoVien: string | null;
    nhan: string;
    noiDung: string;
    khenLuyen: { khen: string | null; luyen: string | null };
    moi: boolean;
  } | null;
  /** B4.5: chỉ SỐ buổi cần bù — KHÔNG có `tieuDe` (nguồn web ghép "Gửi yêu cầu học bù …", app chưa có luồng gửi yêu cầu). */
  hocBu: { canBu: number } | null;
  /** B4.7: liên hệ trung tâm (số chung + Zalo chung + giờ mở cửa của cơ sở của con) — dữ liệu tĩnh, không lộ thông tin ai khác. */
  lienHe: LienHeDto;
};

export function doiTongQuan(t: TongQuan, maCoSo: string | null = null): TongQuanDto {
  return {
    homNay: t.homNay,
    tenCon: t.tenCon,
    soThongBaoChuaDoc: t.soThongBao,
    tiepTheo: t.tiepTheo
      ? {
          nhanDemNgay: t.tiepTheo.nhanDemNgay,
          tieuDe: t.tiepTheo.tieuDe,
          nhanBuoi: t.tiepTheo.nhanBuoi,
          ngayNhan: t.tiepTheo.ngayNhan,
          gio: t.tiepTheo.gio,
          phong: t.tiepTheo.phong,
          giaoVien: t.tiepTheo.giaoVien,
        }
      : null,
    hanhTrinh: {
      tenKhoa: t.hanhTrinh.tenKhoa,
      dongTieuDe: t.hanhTrinh.dongTieuDe,
      hocPhan: t.hanhTrinh.hocPhan.map((h) => ({ ma: h.ma, ten: h.ten, tong: h.tong, daHoc: h.daHoc, ong: [...h.ong] })),
    },
    nhanXet: t.nhanXet
      ? { giaoVien: t.nhanXet.giaoVien, nhan: t.nhanXet.nhan, noiDung: t.nhanXet.noiDung, khenLuyen: { khen: t.nhanXet.khenLuyen.khen, luyen: t.nhanXet.khenLuyen.luyen }, moi: t.nhanXet.moi }
      : null,
    hocBu: t.hocBu ? { canBu: t.hocBu.canBu } : null,
    lienHe: lienHeCuaCoSo(maCoSo),
  };
}

/**
 * `soThongBaoChuaDoc` KHÔNG lấy từ `getTongQuan().soThongBao` (số của riêng trang Tổng quan web: không đọc sổ `PortalFeedRead`): đo trên APK 17/11/2026 — sau "Đọc hết"
 * `/notifications.unreadTotal = 0` nhưng `/overview.soThongBaoChuaDoc = 3` ⇒ chuông ở Tổng quan nói 3 còn danh sách nói 0. App chỉ có MỘT chuông và MỘT danh sách (của cả phụ huynh)
 * nên số trên chuông phải là CHÍNH số của danh sách: `getParentNotificationFeed(...).unreadTotal` — cùng hàm với `GET /notifications` (`[MA-38]`).
 */
export async function layTongQuan(hocVienId: MaHocVienDaKiem, parentUserId: string, now: Date = new Date()): Promise<TongQuanDto> {
  const [tong, feed, hv] = await Promise.all([
    getTongQuan(hocVienId, parentUserId, now),
    getParentNotificationFeed(parentUserId),
    // Cơ sở của con: đọc qua `portalDb` (chỉ trả học viên của chính phụ huynh) — chỉ lấy MÃ cơ sở, không lấy cột nào khác.
    portalDb({ parentUserId, childIds: [hocVienId] }).student.findUnique({ where: { id: hocVienId }, select: { center: { select: { code: true } } } }),
  ]);
  return { ...doiTongQuan(tong, hv?.center?.code ?? null), soThongBaoChuaDoc: feed.unreadTotal };
}
