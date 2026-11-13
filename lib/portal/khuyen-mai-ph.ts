// lib/portal/khuyen-mai-ph.ts — chương trình KHUYẾN MÃI đang áp dụng, hiển thị cho PHỤ HUYNH (12/11/2026).
//
// «Còn hiệu lực không» hỏi ĐÚNG MỘT chỗ: `lib/khuyen-mai/hieu-luc.ts` (`dangHieuLuc` + `apDungTrongPhamVi`) — cùng nguồn với màn quản trị,
// Tra cứu của Sale và đường chọn mã khi tạo đơn. Không viết lại điều kiện ngày ở đây.
//
// AN TOÀN HIỂN THỊ — chỉ đưa ra tên, lợi ích, điều kiện và hạn áp dụng. TUYỆT ĐỐI KHÔNG đưa ra: mã văn bản nội bộ (`documentCode`), tệp
// đính kèm, lý do thu hồi, người tạo, và KHÔNG bao giờ mã voucher (`Voucher.code` là mã giảm giá thật — lộ ra là ai cũng dùng được).
// Hàm chọn cột `select` tường minh bên dưới ⇒ thêm cột nhạy cảm vào model không tự chảy sang cổng phụ huynh.
import { db } from "@/lib/db";
import { apDungTrongPhamVi, dangHieuLuc, ngayKetThuc } from "@/lib/khuyen-mai/hieu-luc";
import { ngayVN } from "@/lib/format/thoi-gian-vn";

export type KhuyenMaiChoPhuHuynh = {
  id: string;
  ten: string;
  loiIch: string;
  dieuKien: string | null;
  /** dd/mm/yyyy — ngày áp dụng cuối cùng (đã tính thu hồi). */
  hetHan: string;
  /** Mới ra trong `SO_NGAY_MOI` ngày gần đây (tính từ ngày bắt đầu áp dụng) — dùng cho nhãn «N MỚI» ở ô Khuyến mãi. */
  moi: boolean;
};

/** Chương trình bắt đầu áp dụng trong khoảng này được coi là «mới». */
export const SO_NGAY_MOI = 14;

const ddmmyyyy = (iso: string): string => iso.split("-").reverse().join("/");

/**
 * Khuyến mãi ĐANG ÁP DỤNG hôm nay (lịch VN). `maCoSo` = `Center.code` của cơ sở con đang học; `null` (tài khoản chưa có bé) ⇒ chỉ các
 * chương trình áp TOÀN HỆ THỐNG. Chương trình giới hạn theo cơ sở khác ⇒ không hiện.
 */
export async function docKhuyenMaiChoPhuHuynh(maCoSo: string | null, now: Date = new Date()): Promise<KhuyenMaiChoPhuHuynh[]> {
  const hom = ngayVN(now);
  const rows = await db.promotionPolicy.findMany({
    // Lọc thô theo DB (đỡ kéo cả bảng); quyết định cuối cùng vẫn là `dangHieuLuc` bên dưới.
    where: { revokedAt: null, validUntil: { gte: new Date(`${hom}T00:00:00.000Z`) }, validFrom: { lte: new Date(`${hom}T00:00:00.000Z`) } },
    select: {
      id: true,
      name: true,
      benefitText: true,
      conditionText: true,
      validFrom: true,
      validUntil: true,
      revokedAt: true,
      orgUnitIds: true,
    },
    orderBy: { validUntil: "asc" },
    take: 50,
  });
  const phamVi = maCoSo ? [maCoSo] : [];
  // `PromotionPolicy.orgUnitIds` lưu ID đơn vị, còn `apDungTrongPhamVi` so theo MÃ (OrgUnit.code = Center.code) — đổi id→mã trước khi so,
  // đúng như đường chọn mã khi tạo đơn (`lib/khuyen-mai/chon-cho-don.ts`). FAIL-CLOSED: chương trình CÓ khai cơ sở mà không id nào còn trên cây
  // thì LOẠI, không được coi là «toàn hệ thống» (mở rộng phạm vi mà BLĐ không ban hành).
  const idCoSo = [...new Set(rows.flatMap((p) => p.orgUnitIds))];
  const don = idCoSo.length ? await db.orgUnit.findMany({ where: { id: { in: idCoSo } }, select: { id: true, code: true } }) : [];
  const maTheoId = new Map(don.map((u) => [u.id, u.code]));
  const maCuaChuongTrinh = (ids: readonly string[]): string[] | null => {
    if (ids.length === 0) return [];
    const ma = ids.map((i) => maTheoId.get(i)).filter((m): m is string => !!m);
    return ma.length > 0 ? ma : null;
  };
  return rows
    .filter((p) => {
      if (!dangHieuLuc(p, hom)) return false;
      const ma = maCuaChuongTrinh(p.orgUnitIds);
      return ma !== null && apDungTrongPhamVi(ma, phamVi);
    })
    .map((p) => ({
      id: p.id,
      ten: p.name,
      loiIch: p.benefitText,
      dieuKien: p.conditionText,
      hetHan: ddmmyyyy(ngayKetThuc(p)),
      moi: now.getTime() - p.validFrom.getTime() <= SO_NGAY_MOI * 86_400_000,
    }));
}

/** `Center.id` (slug) → `Center.code` ("CS1"/"CS2") — phạm vi khuyến mãi khai theo MÃ, không theo id. Không có cơ sở ⇒ null. */
export async function docMaCoSo(centerId: string | null | undefined): Promise<string | null> {
  if (!centerId) return null;
  const c = await db.center.findUnique({ where: { id: centerId }, select: { code: true } });
  return c?.code ?? null;
}
