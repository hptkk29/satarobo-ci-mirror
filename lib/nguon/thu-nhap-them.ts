// lib/nguon/thu-nhap-them.ts — «THU NHẬP THÊM» của phụ huynh làm đối tác giới thiệu (12/11/2026). Sau cờ `THU_NHAP_THEM_ENABLED` (mặc định TẮT).
//
// Phụ huynh xem khách MÌNH mang về: số lead, số chốt, tỉ lệ chốt, và danh sách (họ tên PH, tên con, SĐT CHE dạng `09xxxx7098`, trạng thái, ngày nhận) có tìm + lọc.
//
// AN TOÀN DỮ LIỆU (đọc kỹ trước khi sửa):
//  · Nằm ở `lib/nguon/**` theo luật nguồn/lead (đọc `AffiliateReferral`/`Lead` thẳng chỉ ở đây). KHÔNG đặt ở `lib/affiliate/**`: các lưới `[D1-W*]` ở đó canh cổng
//    đối tác `/portal/gioi-thieu` KHÔNG BAO GIỜ trả tên/SĐT/trạng thái khách (R10·D1, 18/10/2026). Màn này là quyết định KHÁC, có chủ ý, của chủ dự án 12/11/2026 và đứng sau cờ.
//  · Quyền = chính phụ huynh đăng nhập: `partyIdsVaoDuoc(userId)` (từ phiên). Chỉ lượt giới thiệu của các đối tác ấy.
//  · SĐT: CHỈ dạng che đi xuống trình duyệt. Tìm theo SĐT chỉ khớp khi gõ ĐÚNG ĐỦ SỐ (chuẩn hoá `0…`/`84…`/`+84…`), khớp ở SERVER — gõ một phần không ra gì,
//    nên không dùng ô tìm để dò số lạ; còn gõ đúng số của khách mình mang về thì ra ngay (không phải «không ra kết quả»).
//  · KHÔNG trả id lead / id lượt giới thiệu / mã nguồn / lý do xếp loại: chỉ các trường hiển thị.
import type { LeadStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { partyIdsVaoDuoc } from "@/lib/affiliate/tai-khoan-truy-cap";
import { isThuNhapThemEnabled } from "@/lib/flags";
import { canonicalPhone, nationalPhone } from "@/lib/phone";

/** `0999997098` → `09xxxx7098` (giữ 2 số đầu + 4 số cuối). Không chuẩn hoá được ⇒ che toàn bộ. */
export function chePhoneThuNhap(raw: unknown): string {
  const n = nationalPhone(raw);
  if (!n || n.length < 8) return "xxxxxxxxxx";
  return `${n.slice(0, 2)}${"x".repeat(n.length - 6)}${n.slice(-4)}`;
}

/**
 * Chuỗi tìm `q` có KHỚP số điện thoại `phone` không: chỉ khi `q` là MỘT SỐ ĐẦY ĐỦ (≥ 9 chữ số sau chuẩn hoá) và bằng số đó. Gõ thiếu ⇒ false —
 * ô tìm không phải công cụ dò số.
 */
export function khopSoDienThoai(q: string, phone: unknown): boolean {
  const so = q.replace(/[\s.-]/g, "");
  if (!/^\+?\d{9,13}$/.test(so)) return false;
  const a = canonicalPhone(so);
  const b = canonicalPhone(phone);
  return a !== null && b !== null && a === b;
}

export const NHAN_TRANG_THAI_LEAD_PH: Readonly<Record<LeadStatus, string>> = {
  MOI: "Mới nhận",
  DA_LIEN_HE: "Đã liên hệ",
  DANG_TU_VAN: "Đang tư vấn",
  DA_HEN_HOC_THU: "Đã hẹn học thử",
  DANG_HOC_THU: "Đang học thử",
  DA_HOC_THU: "Đã học thử",
  CHO_QUYET_DINH: "Chờ quyết định",
  DA_DANG_KY: "Đã đăng ký",
  DANG_NUOI_DUONG: "Đang chăm sóc",
  DA_MAT: "Chưa phù hợp",
};

/** Trạng thái tính là «CHỐT» (khách đã đăng ký học). */
export const TRANG_THAI_CHOT: readonly LeadStatus[] = ["DA_DANG_KY"];

export type DongKhachMangVe = {
  /** Khoá React ổn định — KHÔNG phải id lead (đã băm theo thứ tự trong danh sách). */
  khoa: string;
  tenPhuHuynh: string;
  tenCon: string | null;
  soDienThoaiChe: string;
  trangThai: LeadStatus;
  nhanTrangThai: string;
  /** dd/mm/yyyy theo lịch VN — ngày hệ thống nhận lead. */
  ngayNhan: string;
};

export type ThuNhapThem = {
  tongLead: number;
  daChot: number;
  /** Phần trăm làm tròn 0–100; `null` khi chưa có lead nào (không chia cho 0). */
  tyLeChot: number | null;
  khach: DongKhachMangVe[];
  /** Có bị cắt ở trần danh sách không. */
  biCat: boolean;
};

const TRAN = 300;
const ngayVN = (d: Date): string => {
  const f = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" });
  return f.format(d);
};

export function tyLeChot(tong: number, chot: number): number | null {
  return tong > 0 ? Math.round((chot / tong) * 100) : null;
}

/** Cờ TẮT ⇒ `null` (không đọc DB). Không phải đối tác ⇒ thống kê rỗng. */
export async function docThuNhapThem(p: { userId: string; q?: string; trangThai?: LeadStatus | null }): Promise<ThuNhapThem | null> {
  if (!isThuNhapThemEnabled()) return null;
  const partyIds = await partyIdsVaoDuoc(p.userId);
  if (partyIds.length === 0) return { tongLead: 0, daChot: 0, tyLeChot: null, khach: [], biCat: false };

  const rows = await db.affiliateReferral.findMany({
    where: { partyId: { in: partyIds }, status: "VALID", leadId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: TRAN + 1,
    select: { lead: { select: { parentName: true, childName: true, phone: true, status: true, createdAt: true } } },
  });
  const lead = rows.flatMap((r) => (r.lead ? [r.lead] : []));
  const biCat = lead.length > TRAN;
  const tat = lead.slice(0, TRAN);
  const tongLead = tat.length;
  const daChot = tat.filter((l) => TRANG_THAI_CHOT.includes(l.status)).length;

  const q = (p.q ?? "").trim();
  const qThuong = q.toLowerCase();
  const loc = tat.filter((l) => {
    if (p.trangThai && l.status !== p.trangThai) return false;
    if (!q) return true;
    if (khopSoDienThoai(q, l.phone)) return true;
    return l.parentName.toLowerCase().includes(qThuong) || (l.childName ?? "").toLowerCase().includes(qThuong);
  });

  return {
    tongLead,
    daChot,
    tyLeChot: tyLeChot(tongLead, daChot),
    biCat,
    khach: loc.map((l, i) => ({
      khoa: `k${i}`,
      tenPhuHuynh: l.parentName,
      tenCon: l.childName,
      soDienThoaiChe: chePhoneThuNhap(l.phone),
      trangThai: l.status,
      nhanTrangThai: NHAN_TRANG_THAI_LEAD_PH[l.status],
      ngayNhan: ngayVN(l.createdAt),
    })),
  };
}
