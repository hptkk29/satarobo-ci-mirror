/**
 * lib/nguon/doc-nhom-sau-tao.ts — đọc MÃ NHÓM nguồn của một lead VỪA TẠO, cho hệ thống (không có actor/người xem).
 *
 * Vì sao ở đây: `LeadAttribution` không có cột đơn vị (ngoại lệ luật Nền #3, chỉ đọc/ghi thẳng trong `lib/nguon/**`, lưới `[QN-W11]`). Cổng tạo lead của AI Lead cần biết SAU ingest
 * nguồn thật ra là gì (cổng chạy thử trước đó không có SĐT nên có thể lệch với kết quả thật khi luật kế thừa theo SĐT thắng). Chỉ trả MÃ NHÓM — không id người giới thiệu, không cảnh báo, không lý do.
 * ⚠️ Không có cổng quyền/cơ sở: CHỈ gọi từ đường hệ thống vừa tự tạo chính lead đó (leadId lấy từ kết quả ingest ngay trước), không từ đầu vào người dùng.
 */
import { db } from "@/lib/db";

/** `{ coDong: false }` = lead chưa có dòng quy nguồn nào (cờ nguồn tắt hoặc ingest không ghi). */
export async function docMaNhomNguonSauTao(leadId: string): Promise<{ coDong: false } | { coDong: true; maNhom: string }> {
  const r = await db.leadAttribution.findUnique({ where: { leadId }, select: { group: { select: { code: true } } } });
  return r ? { coDong: true, maNhom: r.group.code } : { coDong: false };
}
