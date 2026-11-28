import { vnParts, vnYmd } from "@/lib/time/vn";
import { demNgayLich } from "@/lib/portal/tong-quan-thuan";
import { thuNgan } from "@/lib/portal/hanh-trinh-thuan";
import type { FeedCategory, FeedItem } from "@/lib/portal/notification-feed";

// Cổng phụ huynh — phần THUẦN của màn "Thông báo" (artifact Thong-bao.dc.html): tab lọc, nhóm theo thời gian, nhãn ô vuông.

export type TabThongBao = "tat-ca" | "hoc-tap" | "lich" | "hoc-bu" | "hoc-phi" | "trung-tam";

export const TAB_THONG_BAO: { id: TabThongBao; nhan: string }[] = [
  { id: "tat-ca", nhan: "Tất cả" },
  { id: "hoc-tap", nhan: "Học tập" },
  { id: "lich", nhan: "Lịch học" },
  { id: "hoc-bu", nhan: "Học bù" },
  { id: "hoc-phi", nhan: "Học phí" },
  { id: "trung-tam", nhan: "Trung tâm" },
];

/** Danh mục của feed → tab của thiết kế. Nhận xét + học bạ là "Học tập"; khảo sát đến từ trung tâm. */
export const TAB_CUA_DANH_MUC: Record<FeedCategory, Exclude<TabThongBao, "tat-ca">> = {
  NHAN_XET: "hoc-tap",
  HOC_BA: "hoc-tap",
  LICH_HOC: "lich",
  HOC_BU: "hoc-bu",
  HOC_PHI: "hoc-phi",
  KHAO_SAT: "trung-tam",
  THONG_BAO: "trung-tam",
};

export type KieuO = "hoc" | "lich" | "bu" | "phi";

/** Chữ trong ô vuông + màu (kiểu). */
export const O_VUONG: Record<FeedCategory, { chu: string; kieu: KieuO }> = {
  NHAN_XET: { chu: "NX", kieu: "hoc" },
  HOC_BA: { chu: "HB", kieu: "hoc" },
  LICH_HOC: { chu: "LỊCH", kieu: "lich" },
  HOC_BU: { chu: "BÙ", kieu: "bu" },
  HOC_PHI: { chu: "PHÍ", kieu: "phi" },
  KHAO_SAT: { chu: "KS", kieu: "hoc" },
  THONG_BAO: { chu: "TT", kieu: "hoc" },
};

/** Nút trên mỗi thông báo: nhãn + đích. Thông báo trung tâm (nội dung tự do) KHÔNG có trang đích ⇒ không vẽ nút. */
export const NUT_THONG_BAO: Partial<Record<FeedCategory, { nhan: string; href: string }>> = {
  NHAN_XET: { nhan: "Đọc", href: "/portal/nhan-xet" },
  HOC_BA: { nhan: "Xem", href: "/portal/nhan-xet" },
  LICH_HOC: { nhan: "Lịch học", href: "/portal/lich" },
  HOC_BU: { nhan: "Xem", href: "/portal/yeu-cau" },
  HOC_PHI: { nhan: "Xem", href: "/portal/hoc-phi" },
  KHAO_SAT: { nhan: "Làm khảo sát", href: "/portal/khao-sat" },
};

export function loc(items: FeedItem[], tab: TabThongBao): FeedItem[] {
  return tab === "tat-ca" ? items : items.filter((i) => TAB_CUA_DANH_MUC[i.category] === tab);
}

export type NhomThoiGian = "HÔM NAY" | "TUẦN NÀY" | "TRƯỚC ĐÓ";

/** Hôm nay = cùng NGÀY theo lịch VN; tuần này = trong 7 ngày gần nhất; còn lại = trước đó. Mốc tương lai vẫn tính "hôm nay"/"tuần này". */
export function nhomThoiGian(iso: string, now: Date): NhomThoiGian {
  const t = new Date(iso);
  if (vnYmd(t) === vnYmd(now)) return "HÔM NAY";
  return demNgayLich(iso, now) > -7 ? "TUẦN NÀY" : "TRƯỚC ĐÓ";
}

export function gomNhom(items: FeedItem[], now: Date): { ten: NhomThoiGian; items: FeedItem[] }[] {
  const thuTu: NhomThoiGian[] = ["HÔM NAY", "TUẦN NÀY", "TRƯỚC ĐÓ"];
  const sx = [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return thuTu
    .map((ten) => ({ ten, items: sx.filter((i) => nhomThoiGian(i.at, now) === ten) }))
    .filter((g) => g.items.length > 0);
}

const hai = (n: number) => String(n).padStart(2, "0");

/** `08:30` nếu hôm nay; ngược lại `T7 31/10, 21:10`. */
export function nhanGio(iso: string, now: Date): string {
  const t = new Date(iso);
  const p = vnParts(t);
  const gio = `${hai(p.hour)}:${hai(p.minute)}`;
  if (vnYmd(t) === vnYmd(now)) return gio;
  return `${thuNgan(iso)} ${hai(p.day)}/${hai(p.month + 1)}, ${gio}`;
}
