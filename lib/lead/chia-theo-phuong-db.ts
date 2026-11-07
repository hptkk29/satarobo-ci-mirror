import { db } from "@/lib/db";
import { chonCoSoTheoPhuong, docBangPhuong, PROVIDER_PHUONG_CO_SO, type BangPhuongCoSo } from "./chia-theo-phuong";

/**
 * Bảng «phường → cơ sở» đang BẬT, hoặc `null` (chưa có dòng cấu hình / đang tắt). Một câu truy vấn theo khoá duy nhất `provider`.
 * Lưu ở `IntegrationConfig` (cùng chỗ với các cấu hình JSON khác như VIETQR:*) nên KHÔNG cần migration trên PROD; công tắc là `isEnabled`.
 *
 * Tệp này là ĐƯỜNG NÓNG (mỗi lead mới đi qua) nên chỉ có phần ĐỌC; phần ghi của màn quản trị ở `chia-theo-phuong-ghi.ts`.
 */
export async function layBangPhuongDangBat(): Promise<BangPhuongCoSo | null> {
  const dong = await db.integrationConfig.findUnique({ where: { provider: PROVIDER_PHUONG_CO_SO }, select: { isEnabled: true, settings: true } });
  if (!dong || !dong.isEnabled) return null;
  return docBangPhuong(dong.settings);
}

/**
 * Cơ sở gần nhà khách theo phường/xã của lead, hoặc `null` (không quyết được ⇒ người gọi chia đều như cũ).
 * Thiếu thành phố hoặc phường ⇒ trả `null` NGAY, không truy vấn gì (phần lớn lead nhập tay/Excel không có địa chỉ).
 */
export async function chonCoSoLeadTheoPhuong(
  lead: { city: string | null; ward: string | null },
  hopLe: ReadonlySet<string>,
): Promise<string | null> {
  if (!lead.city || !lead.ward) return null;
  const bang = await layBangPhuongDangBat();
  if (!bang) return null;
  return chonCoSoTheoPhuong({ thanhPho: lead.city, phuong: lead.ward }, bang, hopLe);
}
