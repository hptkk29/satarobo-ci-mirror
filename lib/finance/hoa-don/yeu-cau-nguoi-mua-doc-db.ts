import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { maskPhone } from "@/lib/utils";
import {
  O_NGUOI_MUA,
  O_NHAY_CAM,
  daHetHan,
  docDuLieuLuu,
  duocXuLyYeuCau,
  kiemBoDayDu,
  phamViXuLyYeuCau,
  type NguonO,
  type OKhoa,
  type TrangThaiYeuCau,
} from "./yeu-cau-nguoi-mua";

// lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db.ts — ĐỌC yêu cầu thông tin người mua mới nhất của một đơn cho màn đơn hàng (Invoice Hub S11). Chỉ đọc.
//
// Chỉ người trong phạm vi xử lý yêu cầu (cùng luật với dịch vụ ghi: `phamViXuLyYeuCau` / `duocXuLyYeuCau`) mới thấy — các ô là thông tin cá nhân của người mua. Ngoài tầm ⇒ `null`
// (cùng kết quả với «đơn không có yêu cầu»). KHÔNG trả `tokenHash`, `ipGui`, `uaGui`, `donY`; token thô không bao giờ lưu nên cũng không có ở đây.

export type OHienThi = { giaTri: string; nguon: NguonO };
export type KhoiYeuCauNguoiMua = {
  id: string;
  trangThai: TrangThaiYeuCau;
  hetHanLuc: string;
  /** Liên kết công khai đã hết hạn (đồng hồ máy chủ). Nhân viên vẫn nhập thay / áp dụng được khi yêu cầu còn DANG_MO. */
  linkHetHan: boolean;
  guiLuc: string | null;
  soLanMo: number;
  /** Đang bị khoá do nhập sai token quá số lần (đồng hồ máy chủ). */
  dangKhoa: boolean;
  o: Partial<Record<OKhoa, OHienThi>>;
  /** Đủ để áp dụng vào đơn? `thieu` / `sai` là TÊN ô. */
  duDay: boolean;
  thieu: OKhoa[];
  sai: OKhoa[];
};

/**
 * Che một ô nhạy cảm cho người xem KHÔNG có `orders:view-pii` (cùng quy ước khối «Người mua trên hoá đơn»: CCCD / SĐT giữ 3 đầu + 3 cuối, ngày sinh ẩn hẳn).
 * Kế toán (`payments:confirm`) xử lý được yêu cầu nhưng chưa chắc có quyền xem PII — nên phải che Ở ĐÂY, không để giao diện tự lọc.
 */
const cheO = (o: OKhoa, v: string): string => (o === "ngaySinhHocVien" ? "••/••/••••" : maskPhone(v));

/** `xemPii` BẮT BUỘC (luật 7): quên truyền là lỗi biên dịch, không phải im lặng lộ CCCD. */
export async function docYeuCauMoiNhatChoDon(actor: Actor, orderId: string, now: Date, xemPii: boolean): Promise<KhoiYeuCauNguoiMua | null> {
  const pv = phamViXuLyYeuCau(actor);
  if (pv !== "ALL" && pv.length === 0) return null;
  const row = await db.hoaDonYeuCauNguoiMua.findFirst({
    where: { orderId, ...(pv === "ALL" ? {} : { centerId: { in: pv } }) },
    orderBy: { createdAt: "desc" },
    select: { id: true, centerId: true, trangThai: true, hetHanLuc: true, guiLuc: true, soLanMo: true, khoaDen: true, duLieuGui: true },
  });
  if (!row || !duocXuLyYeuCau(actor, row.centerId)) return null;
  const bang = docDuLieuLuu(row.duLieuGui);
  const kiem = kiemBoDayDu(bang);
  const o: Partial<Record<OKhoa, OHienThi>> = {};
  for (const k of O_NGUOI_MUA) {
    const v = bang[k];
    if (!v) continue;
    o[k] = { giaTri: !xemPii && O_NHAY_CAM.includes(k) ? cheO(k, v.giaTri) : v.giaTri, nguon: v.nguon };
  }
  return {
    id: row.id,
    trangThai: row.trangThai as TrangThaiYeuCau,
    hetHanLuc: row.hetHanLuc.toISOString(),
    linkHetHan: daHetHan(row.hetHanLuc, now),
    guiLuc: row.guiLuc ? row.guiLuc.toISOString() : null,
    soLanMo: row.soLanMo,
    dangKhoa: row.khoaDen !== null && row.khoaDen.getTime() > now.getTime(),
    o,
    duDay: kiem.ok,
    thieu: kiem.ok ? [] : kiem.thieu,
    sai: kiem.ok ? [] : kiem.sai,
  };
}
