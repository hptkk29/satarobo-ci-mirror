// lib/nguon/xu-ly-don-backfill-sai-db.ts — TẦNG DB của «PHASE X · xử lý đơn backfill SAI ORD-260913-000041» (27/10/2026). Lõi quyết định + lý do: `xu-ly-don-backfill-sai.ts`.
//
// ── PHÉP GHI (đúng 3 dòng owner ký) ──────────────────────────────────────────────────────────────────────────
//   2 × `payment.updateMany` CÓ ĐIỀU KIỆN → `deletedAt = mốc lượt chạy`, `enrollmentId = NULL`  (xoá mềm + gỡ liên kết sai)
//   1 × `order.updateMany` CÓ ĐIỀU KIỆN   → `status = CANCELLED`  (+ MỘT dòng `OrderStatusHistory` CONFIRMED→CANCELLED, đúng như đường huỷ chuẩn của app)
//   KHÔNG xoá cứng gì (không `delete`/`deleteMany` ở tệp này — lưới `[XDS-W*]` canh), KHÔNG `Order.deletedAt`, KHÔNG đụng đơn ĐÚNG.
//   Bằng chứng KHÔNG đụng gì khác: «ảnh chụp bất biến» TRƯỚC và SAU trong cùng transaction — đơn ĐÚNG (đơn · dòng đơn · MỌI khoản kể cả xoá mềm · ghi danh · giao dịch ngân hàng · phân bổ ·
//   phiếu yêu cầu · học viên · lead) VÀ phần còn lại của đơn SAI (mọi cột đơn trừ status/updatedAt, dòng đơn, mọi cột khoản trừ deletedAt/enrollmentId/updatedAt).
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[XDS-W*]` canh) ──────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Payment → Enrollment (`FOR UPDATE`) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN)
//   → ghi (khoản rồi đơn; count≠1 ⇒ throw) → đọc lại phải ra «ĐÃ XỬ LÝ» → ảnh chụp «sau» = «trước» → audit mức lượt. Đã xử lý (chạy lại) ⇒ 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { dungBanGhiLuotWaveC, khoaLuotChayWaveC, quyetDinhGhiWaveC, type LuotChayWaveC } from "./wave-c-chung";
import {
  HANH_DONG_XU_LY_DON_SAI_LUOT,
  LY_DO_XU_LY_DON_SAI,
  MA_DON_DUNG,
  MA_DON_SAI,
  NGUON_GHI_XU_LY_DON_SAI,
  SO_KHOAN_DUNG_SONG,
  SO_KHOAN_DUNG_XOA_MEM,
  lapKeHoachXuLy,
  type DonDoc,
  type DonDungDoc,
  type DuLieuXuLy,
  type KeHoachXuLy,
  type KhoanDoc,
} from "./xu-ly-don-backfill-sai";

export type KhachXuLy = PrismaClient | Prisma.TransactionClient;

export const ACTOR_XU_LY_DON_SAI = { id: null, name: "Script PHASE X xử lý đơn backfill sai (xu-ly-don-backfill-sai)" } as const;

/** Bảng script đọc/ghi — thiếu `SELECT` bảng nào thì mọi số đọc từ bảng đó là 0 GIẢ (script dùng để cảnh báo). */
export const BANG_DOC_XU_LY: readonly string[] = [
  "Order", "OrderItem", "OrderStatusHistory", "Payment", "PaymentRequest", "PaymentAllocation", "QrSession", "PaymentBill", "PaymentBillLine", "OrderInstallment", "VoucherRedemption",
  "StudentTransaction", "HoaDonDienTu", "HoaDonKhoan", "Receipt", "CommissionTransaction", "CommissionHold", "CommissionDispute", "CommissionCalcSlot", "CommissionAdjustmentRequest",
  "CommissionExplainLine", "RefundRequest", "CreditBalance", "ProductMovement", "MakeupNeed", "BankTransaction", "Enrollment", "Student", "Lead",
];

/** MỌI phép đếm phụ thuộc của đơn SAI trong MỘT câu — tên khớp `TEN_PHU_THUOC` (lõi coi thiếu tên là KHÔNG an toàn). */
async function demPhuThuoc(c: KhachXuLy): Promise<Record<string, number>> {
  const rows = await c.$queryRaw<{ ten: string; so: number }[]>`
    WITH o AS (SELECT id FROM "Order" WHERE code = ${MA_DON_SAI}),
         oi AS (SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM o)),
         py AS (SELECT id FROM "Payment" WHERE "orderId" IN (SELECT id FROM o)),
         pr AS (SELECT id FROM "PaymentRequest" WHERE "orderId" IN (SELECT id FROM o))
    SELECT 'PaymentRequest' AS ten, count(*)::int AS so FROM pr
    UNION ALL SELECT 'PaymentAllocation', count(*)::int FROM "PaymentAllocation" WHERE "paymentRequestId" IN (SELECT id FROM pr)
    UNION ALL SELECT 'QrSession', count(*)::int FROM "QrSession" WHERE "paymentRequestId" IN (SELECT id FROM pr)
    UNION ALL SELECT 'PaymentBill', count(*)::int FROM "PaymentBill" WHERE "orderId" IN (SELECT id FROM o)
    UNION ALL SELECT 'PaymentBillLine', count(*)::int FROM "PaymentBillLine" WHERE "paymentRequestId" IN (SELECT id FROM pr)
    UNION ALL SELECT 'OrderInstallment', count(*)::int FROM "OrderInstallment" WHERE "orderId" IN (SELECT id FROM o)
    UNION ALL SELECT 'VoucherRedemption', count(*)::int FROM "VoucherRedemption" WHERE "orderId" IN (SELECT id FROM o) OR "orderItemId" IN (SELECT id FROM oi)
    UNION ALL SELECT 'StudentTransaction', count(*)::int FROM "StudentTransaction" WHERE "orderId" IN (SELECT id FROM o) OR "orderItemId" IN (SELECT id FROM oi)
    UNION ALL SELECT 'HoaDonDienTu', count(*)::int FROM "HoaDonDienTu" WHERE "orderId" IN (SELECT id FROM o)
    UNION ALL SELECT 'HoaDonKhoan', count(*)::int FROM "HoaDonKhoan" WHERE "paymentId" IN (SELECT id FROM py)
    UNION ALL SELECT 'Receipt', count(*)::int FROM "Receipt" WHERE "paymentId" IN (SELECT id FROM py)
    UNION ALL SELECT 'CommissionTransaction', count(*)::int FROM "CommissionTransaction" WHERE "orderId" IN (SELECT id FROM o) OR "paymentId" IN (SELECT id FROM py) OR "orderItemId" IN (SELECT id FROM oi)
    UNION ALL SELECT 'CommissionHold', count(*)::int FROM "CommissionHold" WHERE "orderId" IN (SELECT id FROM o) OR "orderItemId" IN (SELECT id FROM oi) OR "paymentId" IN (SELECT id FROM py)
    UNION ALL SELECT 'CommissionDispute', count(*)::int FROM "CommissionDispute" WHERE "paymentId" IN (SELECT id FROM py)
    UNION ALL SELECT 'CommissionCalcSlot', count(*)::int FROM "CommissionCalcSlot" WHERE "paymentId" IN (SELECT id FROM py)
    UNION ALL SELECT 'CommissionAdjustmentRequest', count(*)::int FROM "CommissionAdjustmentRequest" WHERE "paymentId" IN (SELECT id FROM py)
    UNION ALL SELECT 'CommissionExplainLine', count(*)::int FROM "CommissionExplainLine" WHERE "paymentId" IN (SELECT id FROM py)
    UNION ALL SELECT 'RefundRequest', count(*)::int FROM "RefundRequest" WHERE "orderItemId" IN (SELECT id FROM oi)
    UNION ALL SELECT 'Payment.adjustmentOf', count(*)::int FROM "Payment" WHERE "adjustmentOfId" IN (SELECT id FROM py)
    UNION ALL SELECT 'CreditBalance', count(*)::int FROM "CreditBalance" WHERE "orderId" IN (SELECT id FROM o)
    UNION ALL SELECT 'ProductMovement', count(*)::int FROM "ProductMovement" WHERE "orderId" IN (SELECT id FROM o)
    UNION ALL SELECT 'MakeupNeed.feeOrderItem', count(*)::int FROM "MakeupNeed" WHERE "feeOrderItemId" IN (SELECT id FROM oi)`;
  return Object.fromEntries(rows.map((r) => [r.ten, Number(r.so)]));
}

/** Nạp dữ liệu cho lõi. Đơn SAI + khoản SAI đọc KHÔNG lọc `deletedAt` (khoản xoá mềm vẫn là lịch sử tiền, và là dấu hiệu «đã xử lý»). */
export async function docDuLieuXuLy(c: KhachXuLy): Promise<DuLieuXuLy> {
  const sai = await c.order.findUnique({
    where: { code: MA_DON_SAI },
    select: {
      id: true, code: true, type: true, status: true, deletedAt: true, studentId: true, leadId: true, totalAmount: true,
      items: { select: { id: true, type: true, quantity: true, totalPrice: true, studentId: true, enrollmentId: true }, orderBy: { id: "asc" } },
    },
  });
  const khoan = sai
    ? await c.payment.findMany({
        where: { orderId: sai.id },
        select: { id: true, amount: true, paymentType: true, saleStatus: true, accountantStatus: true, method: true, enrollmentId: true, orderItemId: true, adjustmentOfId: true, refundRequestId: true, deletedAt: true },
        orderBy: { id: "asc" },
      })
    : [];
  const lichSu = sai ? await c.orderStatusHistory.findMany({ where: { orderId: sai.id }, select: { fromStatus: true, toStatus: true }, orderBy: { createdAt: "asc" } }) : [];
  const dungRaw = await c.order.findUnique({
    where: { code: MA_DON_DUNG },
    select: { id: true, code: true, studentId: true, leadId: true, items: { select: { type: true, enrollmentId: true } } },
  });
  // Ghi danh đích = ghi danh DUY NHẤT mà dòng COURSE_ENROLLMENT của đơn đúng trỏ tới; không duy nhất ⇒ null (lõi báo `DON_DUNG_KHONG_CO_GHI_DANH`).
  const enr = new Set((dungRaw?.items ?? []).filter((i) => i.type === "COURSE_ENROLLMENT" && i.enrollmentId !== null).map((i) => i.enrollmentId as string));
  const donDung: DonDungDoc | null = dungRaw
    ? { id: dungRaw.id, code: dungRaw.code, studentId: dungRaw.studentId, leadId: dungRaw.leadId, enrollmentId: enr.size === 1 ? [...enr][0]! : null }
    : null;
  const donSai: DonDoc | null = sai
    ? { id: sai.id, code: sai.code, type: sai.type, status: sai.status, deletedAt: sai.deletedAt, studentId: sai.studentId, leadId: sai.leadId, totalAmount: sai.totalAmount }
    : null;
  return {
    donSai,
    dongDonSai: sai?.items ?? [],
    khoanSai: khoan as KhoanDoc[],
    donDung,
    phuThuoc: await demPhuThuoc(c),
    lichSu: lichSu.map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus })),
  };
}

export async function docKeHoachXuLy(c: KhachXuLy): Promise<KeHoachXuLy> {
  return lapKeHoachXuLy(await docDuLieuXuLy(c));
}

const thayThe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const bo = (o: object, ks: readonly string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)));

/**
 * ẢNH CHỤP BẤT BIẾN (chuỗi JSON ổn định). Phải GIỐNG HỆT trước và sau phép ghi:
 *  · đơn ĐÚNG: đơn + dòng đơn + MỌI khoản (kể cả xoá mềm) + ghi danh + giao dịch ngân hàng + phân bổ + phiếu yêu cầu + học viên + lead + số Receipt/hoa hồng;
 *  · đơn SAI: mọi cột đơn TRỪ `status`/`updatedAt`, dòng đơn, mọi cột khoản TRỪ `deletedAt`/`enrollmentId`/`updatedAt`.
 * Không chứa tên/SĐT/email ra ngoài (chuỗi chỉ để SO SÁNH, không in).
 */
export async function anhChupBatBienXuLy(c: KhachXuLy): Promise<string> {
  const dung = await c.order.findUnique({ where: { code: MA_DON_DUNG }, include: { items: { orderBy: { id: "asc" } } } });
  const sai = await c.order.findUnique({ where: { code: MA_DON_SAI }, include: { items: { orderBy: { id: "asc" } } } });
  const idDung = dung ? [dung.id] : [];
  const enrIds = [...new Set((dung?.items ?? []).flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : [])))];
  const [ghiDanh, khoanDung, khoanSai, nganHang, phanBo, phieu, hocVien, lead, soPhu] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.payment.findMany({ where: { orderId: { in: idDung } }, orderBy: { id: "asc" } }),
    sai ? c.payment.findMany({ where: { orderId: sai.id }, orderBy: { id: "asc" } }) : Promise.resolve([]),
    c.$queryRaw<unknown[]>`
      SELECT bt.* FROM "BankTransaction" bt
      WHERE bt.id IN (SELECT pa."bankTransactionId" FROM "PaymentAllocation" pa JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId" WHERE pr."orderId" = ANY(${idDung}::text[]))
      ORDER BY bt.id`,
    c.$queryRaw<unknown[]>`
      SELECT pa.* FROM "PaymentAllocation" pa
      WHERE pa."paymentRequestId" IN (SELECT id FROM "PaymentRequest" WHERE "orderId" = ANY(${idDung}::text[]))
      ORDER BY pa.id`,
    c.$queryRaw<unknown[]>`SELECT pr.* FROM "PaymentRequest" pr WHERE pr."orderId" = ANY(${idDung}::text[]) ORDER BY pr.id`,
    dung?.studentId ? c.student.findUnique({ where: { id: dung.studentId } }) : Promise.resolve(null),
    dung?.leadId ? c.lead.findUnique({ where: { id: dung.leadId } }) : Promise.resolve(null),
    Promise.all([
      c.receipt.count({ where: { payment: { orderId: { in: idDung } } } }),
      c.commissionTransaction.count({ where: { OR: [{ orderId: { in: idDung } }, { payment: { orderId: { in: idDung } } }] } }),
    ]),
  ]);
  return JSON.stringify(
    {
      donDung: dung,
      khoanDung,
      ghiDanh,
      nganHang,
      phanBo,
      phieu,
      hocVien,
      lead,
      soPhu,
      donSaiBatBien: sai ? bo(sai, ["status", "updatedAt", "items"]) : null,
      dongDonSai: sai?.items ?? [],
      khoanSaiBatBien: khoanSai.map((k) => bo(k, ["deletedAt", "enrollmentId", "updatedAt"])),
    },
    thayThe,
  );
}

type Tx = Prisma.TransactionClient;

export type DauVaoGhiXuLy = {
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** Quyền UPDATE trên Payment VÀ Order (cả hai); `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiXuLy = { daGhi: number; daXuLy: boolean; keHoachSha: string };

const congSoDuyet = (i: { soDuyet: number | null; kh: KeHoachXuLy; ghiDuoc: boolean | null }) =>
  quyetDinhGhiWaveC({
    soDuyet: i.soDuyet,
    dung: i.kh.dung,
    loiTomTat: i.kh.loi.map((x) => `${x.ma}: ${x.chiTiet}`),
    soGhi: i.kh.ghi.length,
    ghiDuoc: i.ghiDuoc,
    tenBang: "Payment và Order",
    donViDem: "DÒNG (khoản + đơn)",
  });

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiXuLyTrongTx`). MỘT transaction cho cả lô. */
export async function ghiXuLy(c: PrismaClient, input: DauVaoGhiXuLy): Promise<KetQuaGhiXuLy> {
  const kh0 = await docKeHoachXuLy(c);
  // Đã xử lý rồi (chạy lại) thì để transaction trả «0 dòng»; còn lại thì báo sớm.
  if (!kh0.daXuLy) {
    const truoc = congSoDuyet({ soDuyet: input.soDuyet, kh: kh0, ghiDuoc: input.ghiDuoc });
    if (truoc !== null) throw new Error(truoc);
  }
  return c.$transaction((tx) => ghiXuLyTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiXuLyTrongTx(tx: Tx, input: DauVaoGhiXuLy): Promise<KetQuaGhiXuLy> {
  const ma = [MA_DON_SAI, MA_DON_DUNG];
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Enrollment" WHERE id IN (SELECT "enrollmentId" FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ${MA_DON_DUNG}) AND "enrollmentId" IS NOT NULL) ORDER BY id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần.
  const kh = await docKeHoachXuLy(tx);
  // Cả lô đã xử lý (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.daXuLy) return { daGhi: 0, daXuLy: true, keHoachSha: kh.sha };
  const loi = congSoDuyet({ soDuyet: input.soDuyet, kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienXuLy(tx);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.xuLyDonBackfillSai, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «còn đúng hình dạng đã audit» nằm trong `where`; count ≠ 1 ⇒ THROW cả lô — không `continue`.
  const mocGhi = input.congGhi.now;
  let daGhi = 0;
  for (const g of kh.ghi) {
    if (g.loai === "KHOAN") {
      const r = await tx.payment.updateMany({
        // `...KHOAN_DA_GHI_NHAN` = «khoản đã ghi nhận, còn sống» (nguồn MỘT NHÀ của trục B: saleStatus đã ghi nhận · không bị từ chối · deletedAt null); `accountantStatus: "PENDING"` thu hẹp xuống
        // đúng hình dạng đã audit. Hình dạng CHÍNH XÁC (RECORDED/PENDING/backfill) đã được lõi thuần kiểm trong cùng transaction dưới khoá hàng; `where` này là lớp phòng thủ thứ hai.
        where: {
          ...KHOAN_DA_GHI_NHAN,
          id: g.paymentId, orderId: g.orderId, orderItemId: g.orderItemId, amount: g.amount, enrollmentId: g.enrollmentId,
          paymentType: "PAYMENT", accountantStatus: "PENDING", method: "backfill", adjustmentOfId: null,
        },
        data: { deletedAt: mocGhi, enrollmentId: null },
      });
      if (r.count !== 1) throw new Error(`Xoá mềm khoản ${g.paymentId}: khoản không còn «sống · PENDING backfill · gắn ghi danh đã audit» giữa chừng — lùi cả lô.`);
      daGhi++;
      await writeAudit({
        actor: input.actor,
        module: "finance",
        entityType: "Payment",
        entityId: g.paymentId,
        action: "UPDATE",
        oldValues: { deletedAt: null, enrollmentId: g.enrollmentId },
        newValues: { deletedAt: mocGhi.toISOString(), enrollmentId: null, soTien: g.amount, maDon: MA_DON_SAI, source: NGUON_GHI_XU_LY_DON_SAI },
        changedFields: ["deletedAt", "enrollmentId"],
        reason: LY_DO_XU_LY_DON_SAI,
        orgUnitId: null,
        tx,
      });
    } else {
      const r = await tx.order.updateMany({
        where: { id: g.orderId, code: g.code, status: "CONFIRMED", deletedAt: null, totalAmount: g.tongDon },
        data: { status: "CANCELLED" },
      });
      if (r.count !== 1) throw new Error(`Huỷ đơn ${g.code}: đơn không còn «CONFIRMED · chưa xoá mềm · đúng tổng đã audit» giữa chừng — lùi cả lô.`);
      daGhi++;
      await tx.orderStatusHistory.create({
        data: {
          orderId: g.orderId,
          fromStatus: "CONFIRMED",
          toStatus: "CANCELLED",
          changedByUserId: input.actor.id,
          changedByName: input.actor.name,
          reason: LY_DO_XU_LY_DON_SAI,
          metadata: { source: NGUON_GHI_XU_LY_DON_SAI, runId: input.luotChay.nguonChay.runId },
          createdAt: mocGhi,
        },
      });
      await writeAudit({
        actor: input.actor,
        module: "finance",
        entityType: "Order",
        entityId: g.orderId,
        action: "UPDATE",
        oldValues: { status: "CONFIRMED" },
        newValues: { status: "CANCELLED", maDon: g.code, tongDon: g.tongDon, source: NGUON_GHI_XU_LY_DON_SAI },
        changedFields: ["status"],
        reason: LY_DO_XU_LY_DON_SAI,
        orgUnitId: null,
        tx,
      });
    }
  }

  // 6) ĐỌC LẠI: phải ra «ĐÃ XỬ LÝ», và không bất biến nào bị đổi.
  const sau = await docKeHoachXuLy(tx);
  if (sau.dung || !sau.daXuLy) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «đã xử lý» (${sau.loi.map((x) => x.ma).join(" · ") || sau.trangThai}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienXuLy(tx);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (đơn ĐÚNG · khoản · ghi danh · ngân hàng · phân bổ · phần còn lại của đơn SAI) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction.
  if (input.soDuyet === null) throw new Error("ghiXuLyTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: "WaveXXuLyDonSai",
    entityId: khoaLuotChayWaveC(input.luotChay.nguonChay),
    action: HANH_DONG_XU_LY_DON_SAI_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay,
      soDuyet: input.soDuyet,
      soKeHoach: kh.ghi.length,
      daGhi,
      keHoachSha: kh.sha,
      chiTiet: { khoanDaXoaMem: kh.ghi.flatMap((g) => (g.loai === "KHOAN" ? [g.paymentId] : [])), donDaHuy: MA_DON_SAI, lyDo: LY_DO_XU_LY_DON_SAI },
    }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy PHASE X xử lý đơn backfill sai: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daXuLy: true, keHoachSha: kh.sha };
}

export type KetQuaKiemSauXuLy = {
  keHoach: KeHoachXuLy;
  donSaiTrangThai: string | null;
  khoanSaiSong: number;
  khoanNgoaiTrenGhiDanhDich: number;
  khoanDungSong: number;
  khoanDungXoaMem: number;
  dat: boolean;
};

/**
 * KIỂM SAU GHI (chỉ đọc). PASS khi: kế hoạch ra «ĐÃ XỬ LÝ» · đơn sai CANCELLED · 0 khoản SỐNG của đơn sai · 0 Payment sống NGOÀI đơn đúng đang gắn ghi danh đích ·
 * đơn đúng vẫn còn ĐÚNG số khoản đã audit (2 sống + 1 xoá mềm) — không mất khoản thật.
 */
export async function kiemSauGhiXuLy(c: KhachXuLy): Promise<KetQuaKiemSauXuLy> {
  const keHoach = await docKeHoachXuLy(c);
  const sai = await c.order.findUnique({ where: { code: MA_DON_SAI }, select: { id: true, status: true } });
  const dung = await c.order.findUnique({ where: { code: MA_DON_DUNG }, select: { id: true, items: { select: { enrollmentId: true } } } });
  const khoanSaiSong = sai ? await c.payment.count({ where: { orderId: sai.id, deletedAt: null } }) : 0;
  const enrDich = keHoach.enrollmentDich;
  const khoanNgoai = enrDich && dung ? await c.payment.count({ where: { enrollmentId: enrDich, deletedAt: null, orderId: { not: dung.id } } }) : 0;
  const khoanDungSong = dung ? await c.payment.count({ where: { orderId: dung.id, deletedAt: null } }) : 0;
  const khoanDungXoaMem = dung ? await c.payment.count({ where: { orderId: dung.id, deletedAt: { not: null } } }) : 0;
  const dat =
    keHoach.daXuLy && sai?.status === "CANCELLED" && khoanSaiSong === 0 && khoanNgoai === 0 && khoanDungSong === SO_KHOAN_DUNG_SONG && khoanDungXoaMem === SO_KHOAN_DUNG_XOA_MEM;
  return { keHoach, donSaiTrangThai: sai?.status ?? null, khoanSaiSong, khoanNgoaiTrenGhiDanhDich: khoanNgoai, khoanDungSong, khoanDungXoaMem, dat };
}

