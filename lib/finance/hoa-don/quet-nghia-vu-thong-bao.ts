// lib/finance/hoa-don/quet-nghia-vu-thong-bao.ts — DỰNG thông báo ngoại lệ của scanner bóng (Invoice Hub S8). THUẦN.
//
// Người chạy DB (`quet-nghia-vu-db.ts`) đếm ngoại lệ MỚI theo cơ sở và tra người giữ quyền của TỪNG cơ sở (`nguoiGiuQuyenTaiCoSo` — dữ liệu
// quyền, leo cây tổ chức; không gõ cứng vai). Ở đây chỉ hai quyết định, kiểm được không cần DB:
//   1. cơ sở nào có chuông (chỉ cơ sở có ngoại lệ MỚI trong lượt này — chạy lại không bão chuông);
//   2. chuông mang gì (chỉ SỐ ĐẾM: panel chuông mở giữa chỗ đông người — không PII, không số tiền, không mã đơn; `pii.ts`).
//
// ⚠️ Người nhận của MỘT cơ sở = người giữ `payments:confirm` tại cơ sở đó (kể cả người neo vai ở đơn vị cha). Kế toán CS1 không nhận bản CS2.

/** Tiền tố `dedupeKey` — khai ở `lib/notifications/catalog.ts`. Khoá: `<tiền tố><centerId>:<ngày>`. */
export const TIEN_TO_NGOAI_LE = "hoa-don.ngoai-le:" as const;

/** Mở thẳng tab Cảnh báo của màn hoá đơn. */
export const HREF_NGOAI_LE = "/payments/hoa-don/canh-bao" as const;

export type MoiTheoCoSo = {
  centerId: string;
  ten: string;
  /** Ngoại lệ MỞ MỚI trong lượt quét này. */
  moi: number;
  /** Trong số mới, bao nhiêu mức KHẨN. */
  khan: number;
  /** Tổng ngoại lệ đang mở của cơ sở (sau lượt quét). */
  dangMo: number;
};

export type ThongBaoNgoaiLe = { userIds: string[]; dedupeKey: string; title: string; body: string; href: string };

const TIEU_DE = "Ngoại lệ hoá đơn điện tử cần xem";

export function dungThongBaoNgoaiLe(input: {
  coSo: readonly MoiTheoCoSo[];
  /** centerId → người giữ quyền kế toán tại cơ sở đó. */
  nguoiNhanTheoCoSo: ReadonlyMap<string, readonly string[]>;
  /** `YYYY-MM-DD` — khoá chống trùng theo ngày. */
  ngay: string;
}): ThongBaoNgoaiLe[] {
  const ra: ThongBaoNgoaiLe[] = [];
  const coViec = [...input.coSo].filter((c) => c.moi > 0).sort((a, b) => a.ten.localeCompare(b.ten, "vi") || a.centerId.localeCompare(b.centerId));
  for (const c of coViec) {
    const userIds = [...new Set(input.nguoiNhanTheoCoSo.get(c.centerId) ?? [])];
    if (userIds.length === 0) continue;
    const khan = c.khan > 0 ? ` (${c.khan} khẩn)` : "";
    ra.push({
      userIds,
      dedupeKey: `${TIEN_TO_NGOAI_LE}${c.centerId}:${input.ngay}`,
      title: TIEU_DE,
      body: `${c.moi} ngoại lệ hoá đơn mới tại ${c.ten}${khan}; hiện có ${c.dangMo} đang mở.`,
      href: HREF_NGOAI_LE,
    });
  }
  return ra;
}
