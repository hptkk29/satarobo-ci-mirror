import "server-only";
// lib/entitlements/da-tieu-thu.ts — "quyền học này ĐÃ CÓ BUỔI NÀO TIÊU THỤ CHƯA?" — nhìn sổ cái trong transaction của người gọi.
//
// Chiều ngược của tiền (tiền bị đảo / hoàn / từ chối SAU khi đã cấp quyền học) chia hai ngả theo ĐÚNG câu hỏi này:
//   · chưa buổi nào tiêu thụ ⇒ dòng xử lý CAN_THU_HOI (có thể thu hồi theo luật an toàn);
//   · đã có buổi tiêu thụ     ⇒ dòng xử lý TREO_DUYET_TAY (người có quyền quyết — không tự đụng vào quyền học).
//
// Nguồn thật là `StudyEntitlementUsage` (dòng chưa vô hiệu); `consumedSessions` chỉ là CACHE nên chỉ dùng để nghiêng về phía THẬN TRỌNG:
// cache > 0 mà sổ cái trống thì vẫn coi là ĐÃ tiêu thụ (treo duyệt tay tốt hơn thu hồi nhầm).
//
// Đặt ở `lib/entitlements/**` vì `[ENT-USAGE-PIN-01]` chỉ cho thư mục này chạm bảng sổ cái; KHÔNG sửa `dich-vu.ts` (thuộc PR nền N1).
import type { Prisma } from "@prisma/client";

export async function daTieuThuBuoi(tx: Prisma.TransactionClient, entitlementId: string, consumedSessions: number): Promise<boolean> {
  if (consumedSessions > 0) return true;
  const n = await tx.studyEntitlementUsage.count({ where: { entitlementId, voidedAt: null } });
  return n > 0;
}
