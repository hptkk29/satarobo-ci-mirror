/**
 * lib/affiliate/doc-loc-campaign.ts — DANH SÁCH CAMPAIGN cho các bộ lọc «Campaign Affiliate» ở tab Sổ và tab Kỳ (AFF-L1, LOW §35).
 *
 * Trước đây danh sách chỉ suy từ dòng sổ nên một campaign CÓ THẬT mà chưa có dòng sổ nào (mới kích hoạt, chưa sinh tiền) không có trong ô chọn, và URL mang mã của nó bị dán nhãn «(không còn trong
 * danh sách)» — nói sai: campaign vẫn còn, chỉ là chưa có tiền. Nay người xem có quyền XEM CAMPAIGN (`affiliate_campaigns:view`) lấy danh sách từ MASTER; người không có quyền đó giữ danh sách suy từ
 * sổ (không lộ «có campaign nào» ngoài tầm nhìn của họ). Hệ quả cần biết: nhãn «không còn trong danh sách» với người KHÔNG có quyền xem campaign chỉ có nghĩa «không có trong phần bạn thấy».
 *
 * Mã đang lọc trên URL được tra riêng bằng MỘT `findUnique` (không phụ thuộc trần của danh sách) — nên nhãn «không còn trong danh sách» chỉ còn cho mã KHÔNG tồn tại trong master.
 */
import { db } from "@/lib/db";

export type CampaignChoLoc = { code: string; ten: string };

/** Trần số campaign trong ô chọn. Vượt ⇒ cắt; mã đang lọc vẫn có mặt nhờ phép tra riêng. */
export const TRAN_CAMPAIGN_O_LOC = 300;

/**
 * Cách người xem lấy danh sách: BẮT BUỘC khai (luật 7) — quên là bộ lọc lặng lẽ rơi về danh sách suy từ sổ và campaign chưa có tiền biến mất khỏi ô chọn.
 * `xem` = người xem có `affiliate_campaigns:view`; `dangChon` = mã trên URL (đã qua `MA_DANH_MUC_RE`) hoặc `null`.
 */
export type CachLayCampaign = { xem: boolean; dangChon: string | null };

export async function docCampaignMaster(dangChon: string | null): Promise<CampaignChoLoc[]> {
  const ds = await db.affiliateCampaign.findMany({ select: { code: true, name: true }, orderBy: [{ name: "asc" }, { code: "asc" }], take: TRAN_CAMPAIGN_O_LOC });
  const ra: CampaignChoLoc[] = ds.map((c) => ({ code: c.code, ten: c.name }));
  if (dangChon !== null && !ra.some((c) => c.code === dangChon)) {
    const them = await db.affiliateCampaign.findUnique({ where: { code: dangChon }, select: { code: true, name: true } });
    if (them) ra.push({ code: them.code, ten: them.name });
  }
  return ra;
}
