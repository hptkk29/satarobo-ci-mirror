// lib/finance/mien-giam-db.ts — MIỄN GIẢM NỢ: phần chạm DB. PHIÊN G1 · US-22.
//
// ⚠️ Tiền miễn giảm là tiền KHÔNG BAO GIỜ VỀ. Không có bước duyệt nào phía sau, không có
// đường hoàn tác — nên mọi thứ ở đây đều phải để lại dấu: lý do BẮT BUỘC, `AuditLog` ghi
// cả số trước lẫn số sau, và khoản giảm mang `loai: "KHAC"` kèm chữ "Miễn giảm" trong lý do
// để báo cáo tháng lọc ra được (AC4).
import "server-only";
import { Prisma } from "@prisma/client";

import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { docSoTheoCon } from "@/lib/finance/debt";
import { ghiTienChoDon, type KetQuaGhi } from "@/lib/finance/ghi-tien-don";
import { recomputeRequestStatuses } from "@/lib/payments/payment-request";
import { CHO_GHI, kiemMienGiam } from "@/lib/finance/mien-giam";
import { keHoachHapThu, type CachHapThu } from "@/lib/orders/chinh-sach-uu-dai";
import { tienDon, type KhaiGiam } from "@/lib/orders/giam-gia-dong";

/** Nhãn nhận diện khoản miễn giảm trong `OrderItem.discounts` — báo cáo tháng lọc theo nó. */
export const NHAN_MIEN_GIAM = "Miễn giảm";

export type KetQuaMienGiam = {
  soTien: number;
  tenCon: string;
  phaiThuMoi: number;
  /** Số đợt đang mở phải huỷ & tạo lại vì phần nợ giảm đi. */
  soDotDaDoi: number;
  /** Phần miễn KHÔNG hấp thụ được vào đợt nào — bé sẽ hiện "đóng thừa" đúng số này. */
  chuaHapThu: number;
};

function khaiLai(discounts: Prisma.JsonValue): KhaiGiam[] {
  if (!Array.isArray(discounts)) return [];
  const ra: KhaiGiam[] = [];
  for (const k of discounts) {
    if (!k || typeof k !== "object") continue;
    const o = k as Record<string, unknown>;
    const giaTri = Number(o.giaTri);
    if (!Number.isFinite(giaTri)) continue;
    ra.push({
      kieu: o.kieu === "PHAN_TRAM" ? "PHAN_TRAM" : "SO_TIEN",
      giaTri,
      lyDo: typeof o.lyDo === "string" ? o.lyDo : null,
      loai: typeof o.loai === "string" ? (o.loai as KhaiGiam["loai"]) : null,
    });
  }
  return ra;
}

/**
 * Miễn một phần nợ của một con.
 *
 * ⚠️ Mọi cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback).
 *
 * ⚠️ `hapThu` là chính sách "giảm muộn trừ vào đợt nào" — THAM SỐ VẬN HÀNH mà quản lý tự cài
 * (F3, `billing.lateDiscountAbsorb`). Người gọi đọc rồi TRUYỀN VÀO; không có mặc định (luật 7),
 * để quản lý đổi chính sách thì mọi đường ghi đổi theo.
 */
export async function mienGiamNoChoCon(input: {
  orderId: string;
  orderItemId: string;
  soTien: number;
  lyDo: string;
  hapThu: CachHapThu;
  tranPhanTram: number;
  actor: AuditActor;
}): Promise<KetQuaGhi<KetQuaMienGiam>> {
  return ghiTienChoDon(input.orderId, async (tx, so) => {
    const dong = await tx.orderItem.findFirst({
      where: { id: input.orderItemId, orderId: input.orderId, order: { deletedAt: null } },
      select: {
        id: true,
        itemName: true,
        quantity: true,
        unitPrice: true,
        totalPrice: true,
        discountAmount: true,
        discounts: true,
        status: true,
        usedValue: true,
        order: { select: { centerId: true, orgUnitId: true, shippingFee: true } },
      },
    });
    if (!dong) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    const conNay = so.con.find((c) => c.orderItemId === dong.id);
    if (!conNay) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    const kiem = kiemMienGiam({
      soTien: input.soTien,
      conNo: conNay.conNo,
      phaiThu: conNay.phaiThu,
      daDungHoc: dong.status === "STOPPED",
      lyDo: input.lyDo,
      tenCon: dong.itemName,
    });
    if (!kiem.ok) return { ok: false as const, error: kiem.loi };

    // Đợt đang mở của CHÍNH bé này, kèm số đã rót — phép hấp thụ cần cả hai.
    const dotTho = await tx.paymentRequest.findMany({
      where: { orderItemId: dong.id, status: { in: ["PENDING", "PARTIAL"] } },
      select: {
        id: true,
        installmentNo: true,
        amountDue: true,
        dueDate: true,
        allocations: { select: { amount: true } },
      },
    });
    const ke = keHoachHapThu({
      dot: dotTho.map((d) => ({
        id: d.id,
        installmentNo: d.installmentNo,
        amountDue: d.amountDue,
        dueDate: d.dueDate,
        daRot: d.allocations.reduce((s, a) => s + a.amount, 0),
      })),
      canGiam: kiem.soTien,
      cach: input.hapThu,
    });

    // ── HẾT CỔNG. Từ đây là phép ghi. ────────────────────────────────────────

    if (kiem.choGhi === CHO_GHI.QUYET_TOAN) {
      // Bé ĐÃ DỪNG: `phaiThu` đọc `usedValue`, nên miễn giảm phải hạ ĐÚNG cột đó. Đây là
      // "quyết toán âm" mà AC1 gọi tên. Hạ `discountAmount` ở đây thì màn hình KHÔNG nhúc
      // nhích trong khi nhật ký nói đã miễn.
      await tx.orderItem.update({
        where: { id: dong.id },
        data: { usedValue: Math.max(0, (dong.usedValue ?? 0) - kiem.soTien) },
      });
    } else {
      // Bé còn học: một khoản giảm muộn, gắn nhãn để báo cáo tháng lọc ra được (AC4).
      const giam: KhaiGiam[] = [
        ...khaiLai(dong.discounts),
        {
          kieu: "SO_TIEN",
          giaTri: kiem.soTien,
          loai: "KHAC",
          lyDo: `${NHAN_MIEN_GIAM}: ${input.lyDo.trim()}`,
        },
      ];
      const t = tienDon([{ unitPrice: dong.unitPrice, quantity: dong.quantity, giam }], {
        tranPhanTram: input.tranPhanTram,
      }).dong[0]!;
      await tx.orderItem.update({
        where: { id: dong.id },
        data: {
          discountAmount: t.giam,
          discountPercent: t.phanTram,
          discountReason:
            t.khoan
              .filter((k) => k.giam > 0 && k.lyDo)
              .map((k) => k.lyDo)
              .join(" · ") || null,
          discounts: t.khoan as unknown as Prisma.InputJsonValue,
        },
      });

      // `Order.discountAmount` phải là ĐÚNG tổng các dòng — hai đường nhập cho cùng một con
      // tiền là định nghĩa của sổ lệch.
      const moiDong = await tx.orderItem.findMany({
        where: { orderId: input.orderId },
        select: { id: true, totalPrice: true, discountAmount: true },
      });
      const tongTamTinh = moiDong.reduce((s, d) => s + d.totalPrice, 0);
      const tongGiam = moiDong.reduce(
        (s, d) => s + (d.id === dong.id ? t.giam : d.discountAmount),
        0,
      );
      await tx.order.update({
        where: { id: input.orderId },
        data: {
          subtotal: tongTamTinh,
          discountAmount: tongGiam,
          totalAmount: tongTamTinh - tongGiam + (dong.order?.shippingFee ?? 0),
        },
      });
    }

    // Đợt đang mở phải tụt theo phần nợ vừa miễn: VOID rồi TẠO LẠI (`matchKey` bền theo đời
    // phiếu — đổi số mà giữ phiếu là mã QR cũ vẫn khớp vào số mới).
    for (const d of ke.doi) {
      await tx.paymentRequest.update({ where: { id: d.id }, data: { status: "VOID" } });
      await tx.qrSession.updateMany({
        where: { paymentRequestId: d.id, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
      if (d.soMoi > 0) {
        const max = await tx.paymentRequest.aggregate({
          where: { orderItemId: dong.id },
          _max: { installmentNo: true },
        });
        await tx.paymentRequest.create({
          data: {
            orderId: input.orderId,
            orderItemId: dong.id,
            centerId: dong.order?.centerId ?? null,
            installmentNo: (max._max.installmentNo ?? 0) + 1,
            amountDue: d.soMoi,
            dueDate: dotTho.find((x) => x.id === d.id)?.dueDate ?? null,
            status: "PENDING",
          },
        });
      }
    }

    await recomputeRequestStatuses(tx, input.orderId);

    const sau = await docSoTheoCon(tx, input.orderId);
    const conSau = sau.con.find((c) => c.orderItemId === dong.id);

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "MIEN_GIAM_NO",
      changedFields: [kiem.choGhi === CHO_GHI.QUYET_TOAN ? "usedValue" : "discountAmount"],
      oldValues: {
        orderItemId: dong.id,
        ten: dong.itemName,
        phaiThu: conNay.phaiThu,
        conNo: conNay.conNo,
      },
      newValues: {
        soTien: kiem.soTien,
        choGhi: kiem.choGhi,
        phaiThu: conSau?.phaiThu ?? kiem.phaiThuMoi,
        conNo: conSau?.conNo ?? 0,
        doiDot: ke.doi,
        chuaHapThu: ke.chuaHapThuDuoc,
      },
      reason: input.lyDo.trim(),
      orgUnitId: dong.order?.orgUnitId ?? null,
    });

    return {
      ok: true as const,
      soTien: kiem.soTien,
      tenCon: dong.itemName,
      phaiThuMoi: conSau?.phaiThu ?? kiem.phaiThuMoi,
      soDotDaDoi: ke.doi.length,
      chuaHapThu: ke.chuaHapThuDuoc,
    };
  });
}
