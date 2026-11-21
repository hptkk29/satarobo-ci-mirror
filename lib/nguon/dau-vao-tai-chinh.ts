// lib/nguon/dau-vao-tai-chinh.ts — «LEAD NÀY ĐÃ CÓ ĐẦU VÀO TÀI CHÍNH CHƯA» — MỘT câu hỏi, MỘT chỗ trả lời cho mọi cổng đổi nguồn.
//
// Đầu vào tài chính = có THỰC THU (`WHERE_THUC_THU`) HOẶC đã có SỔ HOA HỒNG (ô tính / dòng sổ) của lead.
//
// Vì sao không chỉ đếm thực thu (rà độc lập 20/10/2026): khoản thu bị kế toán TỪ CHỐI (hoặc xoá mềm) rời `WHERE_THUC_THU` NHƯNG tiền hoa hồng đã tính vẫn nằm trong sổ (hàng chờ `PAYMENT_WITHDRAWN` mở,
// «từ chối có thể là bấm nhầm rồi xác nhận lại» — 01 §6.2). Cổng chỉ nhìn thực thu coi lead đó là «chưa thu»: người chỉ có `leads:overwrite` đổi được nguồn, KHÔNG có sự kiện, KHÔNG có đề xuất; khi khoản
// được xác nhận lại, lượt quét sinh INPUT_DRIFT mang phần chênh do nguồn và MỘT người «Áp dụng» chuyển tiền A → B — bỏ qua quyền riêng, ngưỡng hai cấp và tách nhiệm. Fail-closed: có sổ ⇒ coi như đã có tiền.
//
// Sổ được nhìn từ HAI phía: ô tính của khoản thuộc đơn HIỆN CÓ của lead (cùng cách consumer `apDungDoiNguonSauThu` chọn khoản — gộp lead dời đơn sang lead chính nên phải theo `order.leadId` HIỆN TẠI) và dòng sổ
// mang `leadId` LÚC TÍNH (ảnh chụp, gồm cả dòng không có ô như LEGACY_REVERSAL). Không lọc đơn đã xoá mềm: khoản của đơn xoá mềm vẫn có tiền trong sổ.
import type { Prisma, PrismaClient } from "@prisma/client";

import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";

type Khach = Pick<PrismaClient | Prisma.TransactionClient, "payment" | "commissionCalcSlot" | "commissionTransaction">;

export type DauVaoTaiChinh = {
  /** Có khoản thu đang thuộc thực thu. */
  thucThu: boolean;
  /** Đã có ô tính / dòng sổ hoa hồng của lead (kể cả khi khoản gốc đang tạm rời thực thu). */
  soHoaHong: boolean;
};

/** HỢP của hai vế — thứ mọi cổng đổi nguồn phải hỏi. THUẦN. */
export const coDauVaoTaiChinh = (d: DauVaoTaiChinh): boolean => d.thucThu || d.soHoaHong;

/** Lead đã có sổ hoa hồng chưa (vế thứ hai). Chạy được trong transaction. */
export async function coSoHoaHongCuaLead(client: Khach, leadId: string): Promise<boolean> {
  const [o, d] = await Promise.all([
    client.commissionCalcSlot.findFirst({ where: { payment: { order: { leadId } } }, select: { id: true } }),
    client.commissionTransaction.findFirst({ where: { leadId }, select: { id: true } }),
  ]);
  return o !== null || d !== null;
}

/** Cả hai vế trong một lượt. Chạy được trong transaction (`tx`) — chỗ gọi ghi nguồn PHẢI đo TRONG giao dịch ghi. */
export async function docDauVaoTaiChinh(client: Khach, leadId: string): Promise<DauVaoTaiChinh> {
  const [thu, soHoaHong] = await Promise.all([
    client.payment.count({ where: { ...WHERE_THUC_THU, order: { leadId, deletedAt: null } } }),
    coSoHoaHongCuaLead(client, leadId),
  ]);
  return { thucThu: thu > 0, soHoaHong };
}
