/**
 * lib/affiliate/cong-kich-hoat-doc.ts — ĐỌC phần dữ liệu của cổng kích hoạt campaign mà KHÔNG nằm trên hàng campaign (AFF-L1): quy tắc quy nguồn kèm trạng thái loại/nhãn và liên kết `policyId`,
 * và các phiên bản chính sách phạm vi CAMPAIGN. MỘT hàm cho cả hai nơi hỏi cổng — hàm ghi (trong transaction, dưới khoá campaign) và hàm đọc chi tiết (nút «Kích hoạt» nói thật) —
 * nên hai bên không thể đọc hai tập khác nhau (luật 12).
 *
 * Client KHÔNG scope có chủ đích: campaign và chính sách campaign là danh mục toàn hệ; ai kích hoạt campaign phải thấy trọn bộ chính sách của nó, không chỉ phần cơ sở mình.
 * `client` nhận cả `db` lẫn `tx` — hàm ghi truyền `tx` để đọc CÙNG snapshot với phép kiểm.
 */
import type { Prisma } from "@prisma/client";
import type { db } from "@/lib/db";
import type { PhienBanCuaCampaign, QuyTacChoCong } from "./ghi-campaign-dau-vao";

type Khach = Prisma.TransactionClient | typeof db;

export type DuLieuCongTuDb = { quyTac: QuyTacChoCong[]; phienBanChinhSach: PhienBanCuaCampaign[] };

export async function docDuLieuCongKichHoat(client: Khach, campaignId: string): Promise<DuLieuCongTuDb> {
  const [rules, versions] = await Promise.all([
    client.affiliateCampaignRule.findMany({
      where: { campaignId },
      select: { sourceGroupId: true, policyId: true, typeId: true, tagId: true, type: { select: { isActive: true } }, tag: { select: { isActive: true } } },
    }),
    // Phiên bản bị HUỶ là bản nháp bỏ đi — không phải chính sách của campaign; mọi trạng thái còn lại đưa cho cổng, cổng tự lọc `ACTIVE`/chưa hết hạn.
    client.commissionPolicyVersion.findMany({
      where: { scopeType: "CAMPAIGN", scopeCampaignId: campaignId, status: { not: "CANCELLED" } },
      select: { policyId: true, status: true, effectiveFrom: true, effectiveTo: true },
    }),
  ]);
  // Liên kết policyId của quy tắc đúng khi chính sách đó có một phiên bản phạm vi CAMPAIGN trỏ vào chính campaign này (`CommissionPolicy` không mang phạm vi — phạm vi nằm trên phiên bản).
  // `versions` đã lọc đúng điều kiện đó nên không cần câu tra thứ hai.
  const policyCuaCampaign = new Set(versions.map((v) => v.policyId));
  return {
    quyTac: rules.map((r) => ({
      sourceGroupId: r.sourceGroupId,
      loaiConDung: r.typeId === null ? null : (r.type?.isActive ?? false),
      nhanConDung: r.tagId === null ? null : (r.tag?.isActive ?? false),
      policyId: r.policyId,
      policyCoPhienBanCuaCampaign: r.policyId !== null && policyCuaCampaign.has(r.policyId),
    })),
    phienBanChinhSach: versions.map((v) => ({ status: v.status, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo })),
  };
}
