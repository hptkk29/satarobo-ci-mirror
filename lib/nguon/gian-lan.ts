/**
 * lib/nguon/gian-lan.ts — PHÁT HIỆN GIAN LẬN khi ĐỔI nguồn của lead đã có (03 §4). THUẦN.
 *
 *   TU_CLAIM           BLOCK    NGƯỜI SẼ HƯỞNG hoa hồng theo nguồn (nhân sự giới thiệu · Sale phụ trách phụ huynh · người phụ trách nguồn)
 *                               TRÙNG một CHỦ CỦA LEAD (người bấm · người chăm · người chốt đơn · Sale Admin).
 *   SDT_NHAN_VIEN      WARNING  SĐT khách trùng SĐT một nhân viên (mọi `status`) ⇒ vào xem tay, KHÔNG chặn
 *   NGUOI_GT_LA_KHACH  WARNING  SĐT người giới thiệu trùng SĐT khách
 *
 * ── TU_CLAIM — CHỈ Ở ĐƯỜNG ĐỔI NGUỒN ─────────────────────────────────────────────────────────────────────────
 * Chủ dự án chốt 09/10/2026: đường TẠO lead KHÔNG soi tự nhận — lead nhập từ form nội bộ có phiên đăng nhập ghi NGƯỜI GÕ làm nhân sự giới thiệu (D12) để luôn biết nguồn từ
 * nhân sự là ai nhập. Tự nhận chỉ bị chặn khi lead ĐÃ CÓ SẴN rồi người ta chuyển nó sang nơi mình hưởng (`doiNguonLead`).
 *
 * Bản đầu đòi bốn vế (actor = chủ `assignedToId` ∧ người nhận = chính actor ∧ nguồn cũ ≠ UNKNOWN ∧ nhận kiểu NHÂN SỰ): reviewer 09/10/2026 (res3-1/2) chỉ ra ba hở — chủ lead chỉ
 * lấy `assignedToId` trong khi engine trả tiền Sale theo `convertedById`/`adminId`; nguồn cũ UNKNOWN và hai kiểu người nhận mới (`REFERRER_PARENT_SALE`, `SOURCE_OWNER`) lọt qua.
 * Nay: gian lận = hai tập DANH TÍNH giao nhau, bất kể ai bấm nút và bất kể nguồn cũ. Hai tập so ở CẢ HAI không gian id (`User.id` · `Employee.id`):
 * người giới thiệu và chủ nguồn là `Employee.id`, Sale phụ trách PH là `User.id`, còn chủ lead là `User.id` — phải quy cả hai về một bên mới so được.
 *
 * SĐT so theo `canonicalPhone` (0905… ≡ 84905… ≡ +84905…), không so chuỗi trần. Dữ liệu SĐT nhân viên do tầng DB nạp qua `db` KHÔNG scope
 * (T11: nhân viên cơ sở khác vẫn phải bị thấy).
 */
import { canonicalPhone } from "@/lib/phone";

export type CoGianLan = {
  ma: "TU_CLAIM" | "SDT_NHAN_VIEN" | "NGUOI_GT_LA_KHACH";
  muc: "BLOCK" | "WARNING";
};

/** Một người hay một nhóm người, mô tả bằng CẢ HAI id. Rỗng ở cả hai ⇒ không ai (không bao giờ "trùng" với ai). */
export type DanhTinh = { userIds: readonly string[]; employeeIds: readonly string[] };

export const DANH_TINH_TRONG: DanhTinh = Object.freeze({ userIds: Object.freeze([] as string[]), employeeIds: Object.freeze([] as string[]) });

const coGiaTri = (v: string | null | undefined): v is string => typeof v === "string" && v !== "";

/** Dựng danh tính từ các id có thể vắng. */
export function danhTinhTu(p: { userIds?: readonly (string | null | undefined)[]; employeeIds?: readonly (string | null | undefined)[] }): DanhTinh {
  return { userIds: [...new Set((p.userIds ?? []).filter(coGiaTri))], employeeIds: [...new Set((p.employeeIds ?? []).filter(coGiaTri))] };
}

/** Hai danh tính có chung ít nhất một người (so trong từng không gian id). */
export function giaoNhauDanhTinh(a: DanhTinh, b: DanhTinh): boolean {
  const u = new Set(a.userIds);
  const e = new Set(a.employeeIds);
  return b.userIds.some((x) => u.has(x)) || b.employeeIds.some((x) => e.has(x));
}

/**
 * Những người SẼ ĐƯỢC HƯỞNG nếu nguồn/người giới thiệu này được ghi: nhân sự giới thiệu (`Employee.id`) · Sale phụ trách phụ huynh giới thiệu (`User.id`) ·
 * người phụ trách nguồn (`Employee.id`). Thêm một kiểu người hưởng mới là thêm MỘT tham số ở đây.
 */
export function danhTinhNguoiNhan(p: {
  referrerEmployeeId: string | null;
  referrerSaleUserId: string | null;
  chuNguonEmployeeId: string | null;
}): DanhTinh {
  return danhTinhTu({ employeeIds: [p.referrerEmployeeId, p.chuNguonEmployeeId], userIds: [p.referrerSaleUserId] });
}

export function phatHienGianLan(input: {
  /** CHỦ CỦA LEAD: người bấm · người đang chăm (`assignedToId`) · người chốt đơn (`convertedById`) · Sale Admin (`adminId`) — đã quy về cả hai id. */
  chuLead: DanhTinh;
  /** Người SẼ hưởng nếu lượt gán này được ghi (`danhTinhNguoiNhan`). */
  nguoiNhan: DanhTinh;
  sdtKhach: string | null;
  /** canonical → employeeId. */
  sdtNhanVien: ReadonlyMap<string, string>;
  sdtNguoiGioiThieu: string | null;
}): CoGianLan[] {
  const ra: CoGianLan[] = [];

  if (giaoNhauDanhTinh(input.chuLead, input.nguoiNhan)) ra.push({ ma: "TU_CLAIM", muc: "BLOCK" });

  const khach = canonicalPhone(input.sdtKhach);
  if (khach !== null && input.sdtNhanVien.has(khach)) ra.push({ ma: "SDT_NHAN_VIEN", muc: "WARNING" });

  const gt = canonicalPhone(input.sdtNguoiGioiThieu);
  if (khach !== null && gt !== null && gt === khach) ra.push({ ma: "NGUOI_GT_LA_KHACH", muc: "WARNING" });

  return ra;
}
