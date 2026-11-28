import { z } from "zod";

import { danhDauDaDoc, idsDaDoc } from "@/lib/portal/feed-read";
import { getParentNotificationFeed, type FeedCategory as DanhMucNguon } from "@/lib/portal/notification-feed";

import { nhanThoiDiem } from "../dinh-dang";
import { boMenhDeHuongDan } from "../bo-huong-dan";

/**
 * `GET /notifications` · `POST /notifications/read` — dùng lại feed tổng hợp của web (`getParentNotificationFeed`: gom nhận xét · học bù · học phí · học bạ ·
 * khảo sát · thông báo trung tâm CHỈ của các con thuộc phụ huynh gọi — nguồn tự lấy con theo `parentUserId`) và sổ đã-đọc `PortalFeedRead` của web.
 *
 * Khoá mục là id tổng hợp có tiền tố (`nt-`, `fb-`, …), KHÔNG phải id bảng thông báo. Danh mục mà app chưa có (`LICH_HOC`, `HOC_PHI`) quy về `THONG_BAO`
 * (hợp đồng app chỉ 5 danh mục) — nội dung học phí không bị bỏ nhưng cũng không được dựng thêm số tiền: web đã bỏ mục «còn nợ / hạn đóng» khỏi feed.
 * Đánh dấu đã đọc: chỉ nhận id THẬT có trong feed của người gọi (id lạ bị bỏ, không ghi), tối đa 100 id mỗi lần.
 */
export type DanhMucDto = "NHAN_XET" | "HOC_BU" | "HOC_BA" | "KHAO_SAT" | "THONG_BAO";
/** LOẠI CÓ CẤU TRÚC (BR-NOTIF-01) suy từ danh mục NGUỒN của web (không đoán từ chữ): `lich` đổi lịch học · `hoc-phi` · `yeu-cau` (học bù/yêu cầu) · `nhan-xet` (nhận xét + học bạ) · `he-thong` (thông báo trung tâm/khảo sát) · `coin` (V8.24: thông báo SataCoin — cộng coin / yêu cầu đổi quà được duyệt, từ chối, trao; suy từ tiền tố dedupeKey `coin.`, KHÔNG từ chữ). */
export const LOAI_THONG_BAO = ["lich", "hoc-phi", "yeu-cau", "nhan-xet", "he-thong", "coin"] as const;
export type LoaiThongBao = (typeof LOAI_THONG_BAO)[number];
const LOAI_TU_NGUON: Record<DanhMucNguon, LoaiThongBao> = { NHAN_XET: "nhan-xet", HOC_BA: "nhan-xet", LICH_HOC: "lich", HOC_BU: "yeu-cau", HOC_PHI: "hoc-phi", KHAO_SAT: "he-thong", THONG_BAO: "he-thong" };
export type MucThongBaoDto = {
  id: string;
  category: DanhMucDto;
  loai: LoaiThongBao;
  title: string;
  body: string;
  childName: string | null;
  nhanLuc: string;
  read: boolean;
};
export type ThongBaoDto = { items: MucThongBaoDto[]; unreadTotal: number; tong: number; trang: number; coTrangSau: boolean };

/**
 * LỌC + PHÂN TRANG (V8.2, BR-NOTIF-01) — tất cả TUỲ CHỌN; không tham số ⇒ như cũ (tối đa 100 mục, trang 1). `unreadTotal` luôn là tổng chưa đọc TOÀN BỘ feed (không phụ thuộc bộ lọc),
 * `tong` = số mục thoả bộ lọc. Lọc/phân trang làm SAU khi feed đã giới hạn theo các con của người gọi ⇒ không thể lấy mục của nhà khác.
 */
export const DANH_MUC_LOC = ["NHAN_XET", "HOC_BU", "HOC_BA", "KHAO_SAT", "THONG_BAO"] as const;
export const locThongBaoSchema = z
  .object({
    danhMuc: z.enum(DANH_MUC_LOC).optional(),
    loai: z.enum(LOAI_THONG_BAO).optional(),
    chuaDoc: z.enum(["true", "false"]).optional(),
    trang: z.coerce.number().int().min(1).max(100).default(1),
    soLuong: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
export type LocThongBao = z.infer<typeof locThongBaoSchema>;

/** THUẦN — lọc + cắt trang trên danh sách đã dựng. */
export function locVaPhanTrang(items: readonly MucThongBaoDto[], loc: LocThongBao): { items: MucThongBaoDto[]; tong: number; coTrangSau: boolean } {
  const du = items.filter((i) => (loc.danhMuc ? i.category === loc.danhMuc : true) && (loc.loai ? i.loai === loc.loai : true) && (loc.chuaDoc === "true" ? !i.read : loc.chuaDoc === "false" ? i.read : true));
  const tu = (loc.trang - 1) * loc.soLuong;
  return { items: du.slice(tu, tu + loc.soLuong), tong: du.length, coTrangSau: tu + loc.soLuong < du.length };
}

const DANH_MUC: Record<DanhMucNguon, DanhMucDto> = {
  NHAN_XET: "NHAN_XET",
  HOC_BU: "HOC_BU",
  HOC_BA: "HOC_BA",
  KHAO_SAT: "KHAO_SAT",
  THONG_BAO: "THONG_BAO",
  LICH_HOC: "THONG_BAO",
  HOC_PHI: "THONG_BAO",
};
export const TOI_DA_DANH_DAU = 100;
const TOI_DA_MUC = 300; // trần của feed trước khi lọc/phân trang (mặc định trả 100 mục đầu như cũ)

export async function layThongBao(parentUserId: string, now: Date = new Date(), loc: LocThongBao = { trang: 1, soLuong: 100 }): Promise<ThongBaoDto> {
  const feed = await getParentNotificationFeed(parentUserId);
  const items = feed.items
    .slice(0, TOI_DA_MUC)
    .map((i) => ({ id: i.id, category: DANH_MUC[i.category] ?? "THONG_BAO", loai: i.loai ?? LOAI_TU_NGUON[i.category] ?? "he-thong", title: i.title, body: DANH_MUC[i.category] === "HOC_BU" ? boMenhDeHuongDan(i.body) : i.body, childName: i.childName, nhanLuc: nhanThoiDiem(i.at, now), read: i.read }));
  const kq = locVaPhanTrang(items, loc);
  return { items: kq.items, unreadTotal: feed.unreadTotal, tong: kq.tong, trang: loc.trang, coTrangSau: kq.coTrangSau };
}

/** Trả số mục THỰC SỰ được ghi mới (id không có trong feed của người gọi bị loại, không báo lỗi). */
export async function danhDauThongBaoDaDoc(parentUserId: string, ids: string[]): Promise<number> {
  const duoc = [...new Set(ids)].slice(0, TOI_DA_DANH_DAU);
  if (duoc.length === 0) return 0;
  const feed = await getParentNotificationFeed(parentUserId);
  const coThat = new Set(feed.items.map((i) => i.id));
  const daDoc = await idsDaDoc(parentUserId);
  const can = duoc.filter((id) => coThat.has(id) && !daDoc.has(id));
  return danhDauDaDoc(parentUserId, can);
}
