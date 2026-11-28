import { db } from "@/lib/db";
import { ghiDongYQuyDinh } from "@/lib/legal/quy-dinh-dao-tao";
import {
  QUY_DINH_KEY,
  QUY_DINH_MA_VAN_BAN,
  QUY_DINH_MUC,
  QUY_DINH_PHIEN_BAN,
  QUY_DINH_TIEU_DE,
} from "@/lib/legal/quy-dinh-dao-tao-content";

/**
 * «Quy định đào tạo» cho app — dùng lại đúng nguồn của web (`lib/legal/quy-dinh-dao-tao*.ts`), KHÔNG chép nội dung vào app và KHÔNG nhận phiên bản từ
 * client: máy chủ tự lấy phiên bản ĐANG PHÁT HÀNH khi ghi (đồng ý một bản khác với bản được ghi sổ là điều không được xảy ra).
 */
export type QuyDinhDto = { phienBan: string; maVanBan: string; tieuDe: string; muc: Array<{ ten: string; dong: string[] }> };

export function layQuyDinh(): QuyDinhDto {
  return {
    phienBan: QUY_DINH_PHIEN_BAN,
    maVanBan: QUY_DINH_MA_VAN_BAN,
    tieuDe: QUY_DINH_TIEU_DE,
    muc: QUY_DINH_MUC.map((m) => ({ ten: m.ten, dong: [...m.dong] })),
  };
}

/**
 * Ghi mốc đồng ý (idempotent; mốc cần giữ là lần ĐẦU). `parentUserId` chỉ từ phiên đã xác thực.
 *
 * ⚠️ `upsert` của Prisma KHÔNG nguyên tử khi hai yêu cầu chồng nhau: cả hai cùng thấy "chưa có" rồi cùng `create` ⇒ một yêu cầu nhận `P2002` (vi phạm khoá duy nhất `userId, policyKey, version`) ⇒ 500.
 * Gặp thật trên máy ảo 17/11/2026: lượt đầu chạy 100 giây (biên dịch lần đầu), app hết thời gian chờ 15 giây rồi bấm lại ⇒ lượt hai 500 dù mốc ĐÃ ghi. Ngoài đời tương đương: mạng chậm + bấm hai lần.
 * "Đã có mốc" chính là kết quả mong muốn của một thao tác idempotent ⇒ coi P2002 là THÀNH CÔNG (đọc lại để chắc dòng có thật; không có ⇒ ném lại lỗi).
 */
export async function dongYQuyDinh(parentUserId: string, meta: { ip: string; userAgent: string | null }): Promise<void> {
  try {
    await ghiDongYQuyDinh(parentUserId, { ip: meta.ip, userAgent: meta.userAgent });
  } catch (e) {
    if (laViPhamKhoaDuyNhat(e) && (await daCoMocDongY(parentUserId))) return;
    throw e;
  }
}

function laViPhamKhoaDuyNhat(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

async function daCoMocDongY(userId: string): Promise<boolean> {
  const dong = await db.sitePolicyAcceptance.findFirst({ where: { userId, policyKey: QUY_DINH_KEY, version: QUY_DINH_PHIEN_BAN }, select: { id: true } });
  return dong !== null;
}
