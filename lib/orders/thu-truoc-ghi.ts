import "server-only";
// lib/orders/thu-truoc-ghi.ts — GHI "thu trước" (cọc): tách phiếu thu toàn đơn thành HAI phiếu (cọc + còn lại).
//
// Dùng lõi `recordInstallmentPlan` (đã chạy trên prod, đã có cổng tiền R-01/R-02/R-03/A6) với ĐÚNG hai đợt chưa thu, không hạn,
// không nhắc nợ — KHÔNG dựng lại khối kế hoạch (xem `thu-truoc.ts`). Quyền + phạm vi cơ sở kiểm ở action TRƯỚC khi gọi.
//
// ⚠️ Cổng ĐỨNG TRƯỚC phép ghi: `kiemThuTruoc` chạy trên số đọc NGAY TRƯỚC `recordInstallmentPlan`. Hai lượt bấm song song đều
// qua cổng này, nhưng lõi lấy khoá đơn (`khoaDonTrongTx`) và tự dựng lại phiếu theo kế hoạch cuối cùng — lượt sau KHÔNG nhân đôi phiếu
// mà ghi đè kế hoạch của lượt trước bằng đúng hai đợt cùng hình dạng; và nếu giữa hai lượt đã có tiền về thì cổng R-02 của lõi chặn.
import { writeAudit } from "@/lib/audit/audit-log";
import { InstallmentMoneyBlocked, recordInstallmentPlan } from "@/lib/orders/installments";
import { kiemThuTruoc } from "@/lib/orders/thu-truoc";
import { docTinhTrangThuTruoc } from "@/lib/orders/thu-truoc-db";

export type KetQuaThuTruocGhi =
  | { ok: true; soTien: number; conLai: number }
  | { ok: false; error: string };

export async function thuTruocChoDon(p: {
  orderId: string;
  soTien: unknown;
  hanConLai?: unknown;
  actor: { id: string | null; name: string };
}): Promise<KetQuaThuTruocGhi> {
  const tinhTrang = await docTinhTrangThuTruoc(p.orderId);
  if (!tinhTrang) return { ok: false, error: "Không tìm thấy đơn hàng" };

  const kiem = kiemThuTruoc({ ...tinhTrang, soTien: p.soTien, hanConLai: p.hanConLai, homNay: new Date() });
  if (!kiem.ok) return { ok: false, error: kiem.loi };

  let kq: Awaited<ReturnType<typeof recordInstallmentPlan>>;
  try {
    kq = await recordInstallmentPlan({ orderId: p.orderId, dots: kiem.dots, actorId: p.actor.id, choPhepDonPhamVi: true });
  } catch (e) {
    // Lõi ném `InstallmentMoneyBlocked` khi cổng tiền chặn (có tiền về giữa chừng…): nói nguyên văn, không nuốt.
    if (e instanceof InstallmentMoneyBlocked) return { ok: false, error: e.message };
    throw e;
  }
  if (!kq.ok) return { ok: false, error: kq.error ?? "Không lưu được khoản thu trước" };

  await writeAudit({
    actor: { id: p.actor.id, name: p.actor.name },
    module: "orders",
    entityType: "Order",
    entityId: p.orderId,
    action: "THU_TRUOC_TAO",
    newValues: { soTien: kiem.soTien, conLai: kiem.conLai, hanConLai: kiem.dots[1].dueDate.toISOString() },
  });
  return { ok: true, soTien: kiem.soTien, conLai: kiem.conLai };
}
