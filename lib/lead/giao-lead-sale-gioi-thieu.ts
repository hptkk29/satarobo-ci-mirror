/**
 * lib/lead/giao-lead-sale-gioi-thieu.ts — LINK GIỚI THIỆU CỦA SALE ⇒ LEAD GIAO THẲNG CHO SALE ĐÓ, KHÔNG TIÊU LƯỢT CHIA (chủ dự án 20/11/2026).
 *
 * «Nếu là link aff của nhân sự role sale thì đưa lead vào cho sale đó luôn, và không tính lượt chia lead, hay còn gọi là lead sale tự kiếm nhưng được quy về nguồn do nhân sự
 * giới thiệu.» Khách chọn cơ sở KHÁC cơ sở của Sale ⇒ «chia theo cơ sở khách chọn» (luật sẵn có của ma trận).
 *
 * Không có luật chia thứ hai: quyết định vẫn là `resolveAssignment` ca LANDING (đúng người · là Sale · cùng cơ sở khách chọn ⇒ OWNER, `consumedTurn: false`; thiếu vế nào ⇒ vòng chia),
 * đi qua `chiaChoLead` (cửa duy nhất ghi sổ lượt). Hàm này chỉ thêm MỘT việc mà `chiaChoLead` cố ý không làm: khách KHÔNG chọn cơ sở ⇒ lấy cơ sở của Sale làm cơ sở của lead
 * (chỉ khi cơ sở đó còn NHẬN LEAD), rồi mới chia.
 *
 * Trả `true` khi đã xử lý chia (giao thẳng HOẶC vòng chia ở cơ sở khách chọn); `false` ⇒ không phải link của Sale — nơi gọi đi đường chia cũ của mình. Không ném.
 */
import { db } from "@/lib/db";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { chiaChoLead } from "./assign-lead";
import type { AffiliateActor } from "./assign-resolve";
import { layCoSoNhanLead } from "./chia-theo-phuong-ghi";

export async function giaoLeadChoSaleGioiThieu(p: {
  leadId: string;
  /** Cơ sở KHÁCH chọn (đã kiểm còn nhận lead), hoặc null nếu khách không chọn. */
  coSoKhachChon: string | null;
  /** Tài khoản của nhân sự sở hữu link (`chuanBiReferral(...).nguoiNhanLead`); null = không phải link nhân sự. */
  nguoiGioiThieu: AffiliateActor | null;
  nhanLog: string;
}): Promise<boolean> {
  const sale = p.nguoiGioiThieu;
  if (!sale?.isSale) return false;
  try {
    let dich = p.coSoKhachChon;
    if (!dich) {
      if (!sale.centerId) return false;
      const nhanLead = await layCoSoNhanLead();
      if (!nhanLead.some((c) => c.id === sale.centerId)) return false; // Sale ở Hội sở / cơ sở đã đóng ⇒ để đường chia cũ chọn cơ sở
      dich = sale.centerId;
    }
    // `chiaChoLead` không tự ghi cơ sở của lead (nó đòi biết cơ sở TRƯỚC) ⇒ đặt cơ sở đích cho lead nếu chưa đúng (vd phiếu Tủ sách không lưu cơ sở khách chọn).
    const lead = await db.lead.findUnique({ where: { id: p.leadId }, select: { centerId: true } });
    if (lead && lead.centerId !== dich) {
      const orgUnitId = await orgUnitIdForCenter(dich).catch(() => null);
      await db.lead.update({ where: { id: p.leadId }, data: { centerId: dich, ...(orgUnitId ? { orgUnitId } : {}) } });
    }
    await chiaChoLead(p.leadId, { targetCenterId: dich, createdById: null, entryPoint: "LANDING", aff: sale });
    return true;
  } catch (e) {
    console.error(`[${p.nhanLog}] giao lead cho Sale giới thiệu:`, e instanceof Error ? e.name : "lỗi");
    return false;
  }
}

/** Mã cơ sở khách chọn («CS1»…) → `Center.id`, CHỈ khi cơ sở đó đang nhận lead mới; ngược lại null. */
export async function coSoNhanLeadTheoMa(ma: string | null): Promise<string | null> {
  if (!ma) return null;
  const [co, nhanLead] = await Promise.all([db.center.findFirst({ where: { code: ma, isActive: true }, select: { id: true } }), layCoSoNhanLead()]);
  return co && nhanLead.some((c) => c.id === co.id) ? co.id : null;
}
