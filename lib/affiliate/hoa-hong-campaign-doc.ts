/**
 * lib/affiliate/hoa-hong-campaign-doc.ts — ĐỌC mục «Hoa hồng» của trang chi tiết campaign (AFF-L1): các phiên bản chính sách phạm vi CAMPAIGN trỏ vào campaign này.
 *
 * Đọc qua `scopedDb(actor)`: chính sách của một cơ sở nằm ngoài tầm nhìn người xem thì không hiện (cùng luật với tab Chính sách). Hệ quả cần biết: người chỉ thấy một cơ sở có thể không thấy hết
 * phiên bản của campaign — phần cổng kích hoạt (`docDuLieuCongKichHoat`) vì thế đọc KHÔNG scope, còn danh sách hiển thị này thì không. Chỉ ĐỌC.
 * Số tiền hoa hồng là dữ liệu nhạy cảm: người gọi chỉ gọi hàm này khi người xem có `commission_policies:view`.
 */
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { NHAN_LOAI_GD, type LoaiGdSoan } from "@/lib/hoa-hong/chinh-sach-form";
import { dinhDangPhanTram } from "@/lib/hoa-hong/phan-tram";
import { trangThaiPhienBanHienThi } from "@/lib/hoa-hong/trang-thai-phien-ban";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import type { TrangThaiPhienBan } from "@/lib/hoa-hong/chon-quy-tac";
import type { PhienBanCuaCampaignView } from "./hoa-hong-campaign-dau-vao";

const nhanLoai = (code: string): string => (code === "NEW" || code === "RENEWAL" ? NHAN_LOAI_GD[code as LoaiGdSoan] : code);

export async function docPhienBanChinhSachCuaCampaign(actor: Actor, campaignId: string, now: Date): Promise<PhienBanCuaCampaignView[]> {
  const sdb = scopedDb(actor);
  const rows = await sdb.commissionPolicyVersion.findMany({
    where: { scopeType: "CAMPAIGN", scopeCampaignId: campaignId },
    orderBy: [{ policyId: "asc" }, { versionNo: "desc" }],
    take: 100,
    select: {
      id: true,
      policyId: true,
      versionNo: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
      documentId: true,
      updatedAt: true,
      policy: { select: { policyCode: true } },
      rules: { orderBy: { createdAt: "asc" }, select: { transactionTypeCode: true, calcKind: true, rate: true, fixedAmount: true, beneficiaryRole: { select: { name: true } } } },
    },
  });
  return rows.map((v) => {
    const tt = trangThaiPhienBanHienThi({ status: v.status as TrangThaiPhienBan, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo }, now);
    return {
      versionId: v.id,
      policyId: v.policyId,
      policyCode: v.policy.policyCode,
      versionNo: v.versionNo,
      khoa: tt.khoa,
      nhan: tt.nhan,
      tone: tt.tone,
      tuNgay: v.effectiveFrom.toISOString(),
      denNgay: v.effectiveTo?.toISOString() ?? null,
      mucTien: v.rules.map((r) => ({
        loaiGd: nhanLoai(r.transactionTypeCode),
        vai: r.beneficiaryRole.name,
        mucTien:
          r.calcKind === "PERCENT"
            ? `${dinhDangPhanTram(r.rate?.toString() ?? "0")}%`
            : r.calcKind === "FIXED_PER_PURCHASE"
              ? `${dinhDangDong(r.fixedAmount ?? 0)} mỗi lần mua`
              : r.calcKind === "EXCLUDE"
                ? "không trả"
                : "theo bậc",
      })),
      coVanBan: v.documentId !== null,
      capNhatLuc: v.updatedAt.toISOString(),
    };
  });
}
