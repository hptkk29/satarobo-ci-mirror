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
import {
  ensureFullOrderRequest,
  materializeInstallmentRequests,
  recomputeRequestStatuses,
} from "@/lib/payments/payment-request";
import { InstallmentMoneyBlocked } from "@/lib/payments/plan-money-guard";
import { soatPhieuGopMoTrongTx, type PhieuDaSoat } from "@/lib/finance/soat-phieu-gop-db";
import { thongDiepPhieuDaSoat } from "@/lib/finance/soat-phieu-gop";
import {
  CHO_GHI,
  chuaHapThuKhiMienGiam,
  keHoachMienGiam,
  kiemMienGiam,
  thongDiepDungLaiCapDon,
} from "@/lib/finance/mien-giam";
import { type CachHapThu } from "@/lib/orders/chinh-sach-uu-dai";
import { tienDon, type KhaiGiam } from "@/lib/orders/giam-gia-dong";

/** Nhãn nhận diện khoản miễn giảm trong `OrderItem.discounts` — báo cáo tháng lọc theo nó. */
export const NHAN_MIEN_GIAM = "Miễn giảm";

export type KetQuaMienGiam = {
  soTien: number;
  tenCon: string;
  phaiThuMoi: number;
  /** Số đợt đang mở phải huỷ & tạo lại vì phần nợ giảm đi. */
  soDotDaDoi: number;
  /**
   * Phần miễn mà phiếu thu / mã QR VẪN ĐÒI SỐ CŨ — chỉ còn ở luật cũ (bé có đợt theo con đã nhận
   * tiền; `chuaHapThuKhiMienGiam`). Q-L (bé không có đợt theo con) dựng lại phiếu cấp đơn hoặc CHẶN ⇒ 0.
   */
  chuaHapThu: number;
  /** Phiếu gộp bị huỷ/đóng vì đợt đổi số (rà vòng 4, luật 12) — `null` khi không phiếu nào. */
  thongDiepPhieu: string | null;
  /** Q-L — phiếu thu CẤP ĐƠN đã dựng lại theo số nào (toast). `null` khi không dựng lại gì. */
  thongDiepCapDon: string | null;
};

/**
 * Từ chối SAU phép ghi đầu tiên ⇒ `throw` (luật rollback) — `mienGiamNoChoCon` dịch sang `{ ok: false }`.
 * Chỉ các nhánh phòng thủ ("không thể xảy ra" khi `keHoachMienGiam` đã cho qua) ném lớp này.
 */
class LoiDungLaiCapDon extends Error {}

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
  const ghi = ghiTienChoDon(input.orderId, async (tx, so) => {
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
        order: { select: { code: true, centerId: true, orgUnitId: true, shippingFee: true, totalAmount: true } },
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

    // MỌI phiếu thu của đơn (kèm số đã rót) + kế hoạch đợt — ĐỌC TRONG KHOÁ đơn. Phiếu nào bị VOID &
    // dựng lại, hay miễn giảm bị CHẶN, là việc của `keHoachMienGiam` — CÙNG hàm màn nói-trước gọi.
    const phieuTho = await tx.paymentRequest.findMany({
      where: { orderId: input.orderId },
      select: {
        id: true,
        orderItemId: true,
        installmentNo: true,
        amountDue: true,
        dueDate: true,
        status: true,
        allocations: { select: { amount: true } },
      },
    });
    const keHoachDon = await tx.orderInstallment.findMany({
      where: { orderId: input.orderId },
      select: { soDot: true, amount: true, status: true },
    });
    const kh = keHoachMienGiam({
      orderItemId: dong.id,
      phieuThu: phieuTho.map((p) => ({
        id: p.id,
        orderItemId: p.orderItemId,
        installmentNo: p.installmentNo,
        amountDue: p.amountDue,
        dueDate: p.dueDate,
        status: p.status,
        daRot: p.allocations.reduce((s, a) => s + a.amount, 0),
      })),
      keHoachDon,
      canGiam: kiem.soTien,
      cach: input.hapThu,
      daDungHoc: dong.status === "STOPPED",
      // Rà vòng 6 — vế ĐƠN đọc còn nợ cả đơn DƯỚI KHOÁ (`so` của `ghiTienChoDon`); nhánh R0 tính trên tổng
      // đơn hiện tại (số `ensureFullOrderRequest` dựng lại theo). Cùng hai số trang truyền cho màn nói-trước.
      conNoDon: so.conNoDon,
      tongDon: dong.order.totalAmount,
    });
    // Q-L — không có đường an toàn (phiếu cấp đơn đã có tiền, kế hoạch lệch, bé đã dừng, vượt còn nợ cả
    // đơn…) ⇒ CHẶN TRƯỚC phép ghi đầu tiên.
    if (kh.cach === "CHAN") return { ok: false as const, error: kh.loi };

    // ── HẾT CỔNG. Từ đây là phép ghi. ────────────────────────────────────────

    /** `Order.totalAmount` sau miễn giảm — nhánh R0 dựng lại phiếu thu toàn đơn theo đúng số này. */
    let tongDonMoi: number | null = null;

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
      tongDonMoi = tongTamTinh - tongGiam + (dong.order?.shippingFee ?? 0);
      await tx.order.update({
        where: { id: input.orderId },
        data: {
          subtotal: tongTamTinh,
          discountAmount: tongGiam,
          totalAmount: tongDonMoi,
        },
      });
    }

    /** Phiếu gộp đã bị soát trong lượt — gom lại cho MỘT câu báo sau. */
    const phieuDaSoat: PhieuDaSoat[] = [];
    /** Q-L — phiếu cấp đơn đã dựng lại theo số nào (câu báo sau). */
    let dungLaiCapDon: { toanDon: boolean; dot: { installmentNo: number; soMoi: number }[] } | null = null;

    if (kh.cach === "THEO_CON") {
      // Luật cũ: đợt theo con đang mở tụt theo phần nợ vừa miễn — VOID rồi TẠO LẠI (`matchKey` bền
      // theo đời phiếu — đổi số mà giữ phiếu là mã QR cũ vẫn khớp vào số mới).
      for (const d of kh.ke.doi) {
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
              dueDate: phieuTho.find((x) => x.id === d.id)?.dueDate ?? null,
              status: "PENDING",
            },
          });
        }
      }
    } else if (kh.cach === "CAP_DON") {
      // Q-L "Huỷ mã cũ, phát lại": (1) VOID phiếu cấp đơn CHƯA có tiền mà phần miễn chạm tới + hết hạn
      // QR đời cũ của nó; (2) soát phiếu gộp đang mở trên nó — mã của CẢ NHÀ HUỶ (chưa nhận đồng nào)
      // / ĐÓNG (đã nhận), đúng luật `quyetPhieuMo`; (3) dựng lại theo số mới bằng CHÍNH hàm dựng sẵn có.
      for (const d of kh.ke.doi) {
        await tx.paymentRequest.update({ where: { id: d.id }, data: { status: "VOID" } });
        await tx.qrSession.updateMany({
          where: { paymentRequestId: d.id, status: "ACTIVE" },
          data: { status: "EXPIRED" },
        });
      }
      phieuDaSoat.push(...(await soatPhieuGopMoTrongTx(tx, input.orderId)));

      if (kh.toanDon) {
        // R0 = `Order.totalAmount` — định nghĩa của `ensureFullOrderRequest` (nó làm sống lại CHÍNH
        // phiếu số 0 vừa VOID với số mới). Đơn về 0đ (miễn hết) ⇒ không còn gì để thu, R0 ở lại VOID.
        if (tongDonMoi == null) throw new LoiDungLaiCapDon("Không tính được tổng đơn mới — không dựng lại phiếu thu toàn đơn");
        // Rà vòng 6 — MỘT nguồn số: màn đã nói trước (và nhật ký sẽ ghi) `ke.doi[0].soMoi` = tổng đơn − phần
        // miễn. Tổng tính lại từ dòng lệch số đó (tổng đơn lệch Σ dòng, trần giảm giá cắt bớt phần miễn…) ⇒
        // KHÔNG ghi một số khác số đã nói: throw ⇒ rollback cả lượt.
        const soMoiDaNoi = kh.ke.doi[0]?.soMoi;
        if (tongDonMoi !== soMoiDaNoi) {
          throw new LoiDungLaiCapDon(
            `Tổng đơn sau miễn (${tongDonMoi.toLocaleString("vi-VN")}đ) lệch số đã báo trước ` +
              `(${(soMoiDaNoi ?? 0).toLocaleString("vi-VN")}đ) — chưa miễn giảm; tải lại trang, hoặc báo kế toán đối chiếu tổng đơn.`,
          );
        }
        if (tongDonMoi > 0) {
          const r0 = await ensureFullOrderRequest(tx, {
            id: input.orderId,
            code: dong.order.code,
            totalAmount: tongDonMoi,
            centerId: dong.order?.centerId ?? null,
          });
          if (!r0) {
            throw new LoiDungLaiCapDon(
              "Không dựng lại được phiếu thu toàn đơn (đơn vừa có đợt khác còn sống) — chưa miễn giảm; báo kế toán",
            );
          }
        }
        dungLaiCapDon = { toanDon: true, dot: [{ installmentNo: 0, soMoi: Math.max(0, tongDonMoi) }] };
      } else {
        // Đợt đơn: kế hoạch (`OrderInstallment`) là ĐẦU VÀO của `materializeInstallmentRequests` — đổi
        // đúng các dòng phần miễn chạm tới (đợt về 0đ ⇒ bỏ khỏi kế hoạch, phiếu của nó ở lại VOID), rồi
        // để CHÍNH `materialize` làm sống lại phiếu với số mới. `keHoachMienGiam` đã bảo đảm kế hoạch
        // khớp phiếu, nên `materialize` không đổi gì ngoài phần miễn.
        for (const d of kh.ke.doi) {
          const doi =
            d.soMoi > 0
              ? await tx.orderInstallment.updateMany({
                  where: { orderId: input.orderId, soDot: d.installmentNo, status: "PENDING" },
                  data: { amount: d.soMoi },
                })
              : await tx.orderInstallment.deleteMany({
                  where: { orderId: input.orderId, soDot: d.installmentNo, status: "PENDING" },
                });
          if (doi.count !== 1) {
            throw new LoiDungLaiCapDon(`Kế hoạch Đợt ${d.installmentNo} vừa đổi — chưa miễn giảm, tải lại trang`);
          }
        }
        const mat = await materializeInstallmentRequests(tx, input.orderId, { id: input.actor.id, name: input.actor.name });
        phieuDaSoat.push(...mat.phieuGopDaSoat);
        dungLaiCapDon = { toanDon: false, dot: kh.ke.doi.map((d) => ({ installmentNo: d.installmentNo, soMoi: d.soMoi })) };
      }
    }

    const { phieuGopDaSoat } = await recomputeRequestStatuses(tx, input.orderId);
    phieuDaSoat.push(...phieuGopDaSoat);

    const sau = await docSoTheoCon(tx, input.orderId);
    const conSau = sau.con.find((c) => c.orderItemId === dong.id);
    /** Σ còn phải thu của phiếu CẤP ĐƠN đang mở, đọc SAU ghi — câu báo sau so nó với còn nợ đơn (rà vòng 6). */
    const phieuConDoi = sau.dotChuaGanCon.reduce((s, d) => s + Math.max(0, d.amountDue - d.daRot), 0);

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
        // Q-L: đợt theo con của bé (luật cũ) hay phiếu CẤP ĐƠN dựng lại (`capDon`).
        cachTru: kh.cach,
        doiDot: kh.cach === "THEO_CON" || kh.cach === "CAP_DON" ? kh.ke.doi : [],
        capDon: dungLaiCapDon,
        chuaHapThu: chuaHapThuKhiMienGiam(kh),
      },
      reason: input.lyDo.trim(),
      orgUnitId: dong.order?.orgUnitId ?? null,
    });

    return {
      ok: true as const,
      soTien: kiem.soTien,
      tenCon: dong.itemName,
      phaiThuMoi: conSau?.phaiThu ?? kiem.phaiThuMoi,
      soDotDaDoi: kh.cach === "THEO_CON" || kh.cach === "CAP_DON" ? kh.ke.doi.length : 0,
      chuaHapThu: chuaHapThuKhiMienGiam(kh),
      thongDiepPhieu: thongDiepPhieuDaSoat(phieuDaSoat),
      thongDiepCapDon: thongDiepDungLaiCapDon(dungLaiCapDon, { phieuConDoi, conNoDon: sau.conNoDon }),
    };
  });
  // Từ chối SAU phép ghi (nhánh phòng thủ, hoặc cổng A6 của `materialize`) đi ra bằng `throw` — transaction
  // ĐÃ rollback ở đây; chỉ còn việc dịch sang kênh `{ ok, error }` cho toast.
  return ghi.catch((e: unknown) => {
    if (e instanceof LoiDungLaiCapDon || e instanceof InstallmentMoneyBlocked) {
      return { ok: false as const, error: e.message };
    }
    throw e;
  });
}
