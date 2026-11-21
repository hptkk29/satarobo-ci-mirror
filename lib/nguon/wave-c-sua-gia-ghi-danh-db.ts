// lib/nguon/wave-c-sua-gia-ghi-danh-db.ts — TẦNG DB của «PHASE C-B · chuẩn hoá GIÁ GHI DANH cho 16 đơn khoá học legacy» (26/10/2026). Lõi quyết định: `wave-c-sua-gia-ghi-danh.ts` (thuần).
//
// ── QUY ƯỚC (giống `sua-gia-ghi-danh-db.ts`) ───────────────────────────────────────────────────────────────
//   · Mọi hàm nhận client làm tham số BẮT BUỘC; `bang` (PHẠM VI + giá niêm yết + % + snapshot legacy) cũng BẮT BUỘC, không mặc định (luật 7). Script truyền hằng `BANG_WAVE_C_B`, ca DB truyền bảng fixture.
//     Số câu đọc CỐ ĐỊNH, không theo số đơn.
//
// ── PHÉP GHI DUY NHẤT: BỐN cột (hoặc NĂM, với ngoại lệ `ghiListPrice`) của MỘT bảng ─────────────────────────────
//   Enrollment.discountType · discountAmount · finalPrice · tuition (+ listPrice CHỈ cho đơn khai `ghiListPrice`) — qua MỘT lời gọi `enrollment.updateMany` có điều kiện «đang đúng snapshot đã audit».
//   KHÔNG Order, OrderItem, Payment, BankTransaction, Receipt, hoá đơn, Commission*, `Payment.enrollmentId`. Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến» (Order · dòng đơn · MỌI Payment ·
//   phân bổ + giao dịch ngân hàng · Receipt · hoá đơn điện tử · hoa hồng (CẢ NỘI DUNG dòng, không chỉ số đếm — owner: hoa hồng cũ phải đứng yên) · Course · MỌI cột Enrollment trừ các cột được ghi + `updatedAt`)
//   chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi cuối; khác nhau một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[WCB-W*]` canh) ─────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Enrollment (`FOR UPDATE`) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN) →
//   `enrollment.updateMany` (lệch ⇒ throw) + audit → đọc lại phải ra «cả lô đã ở giá đích» → ảnh chụp «sau» = «trước» → audit mức lượt.
//   Lô đã ở giá đích (chạy lại) ⇒ 0 dòng ghi, KHÔNG qua cổng và KHÔNG claim.
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { docKhoaTrenDongWaveC, dungBanGhiLuotWaveC, khoaLuotChayWaveC, quyetDinhGhiWaveC, type LuotChayWaveC } from "./wave-c-chung";
import {
  HANH_DONG_WAVE_C_B,
  HANH_DONG_WAVE_C_B_LUOT,
  LY_DO_WAVE_C_B,
  chuoiGiaWaveCB,
  lapKeHoachWaveCB,
  type DuLieuWaveCB,
  type KeHoachWaveCB,
  type MucWaveCB,
} from "./wave-c-sua-gia-ghi-danh";

export type KhachWaveCB = PrismaClient | Prisma.TransactionClient;
type Bang = Readonly<Record<string, MucWaveCB>>;

export const ACTOR_WAVE_C_B = { id: null, name: "Script PHASE C-B chuẩn hoá giá ghi danh (wave-c-sua-gia-ghi-danh)" } as const;

/** Cổng số duyệt của C-B (mỏng): dựng từ kế hoạch + dùng khuôn chung. */
export function quyetDinhGhiWaveCB(i: { soDuyet: number | null; keHoach: KeHoachWaveCB; ghiDuoc: boolean | null }): string | null {
  return quyetDinhGhiWaveC({
    soDuyet: i.soDuyet,
    dung: i.keHoach.dung,
    loiTomTat: i.keHoach.loi.map((x) => `${x.code}:${x.ma}`),
    soGhi: i.keHoach.ghi.length,
    ghiDuoc: i.ghiDuoc,
    tenBang: "Enrollment",
    donViDem: "GHI DANH",
  });
}

/** ĐỌC dữ liệu cho các mã trong `bang` (kể cả đơn đã xoá mềm — lõi sẽ từ chối). 6 câu, cố định. */
export async function docDuLieuWaveCB(c: KhachWaveCB, bang: Bang): Promise<DuLieuWaveCB[]> {
  const donList = await c.order.findMany({
    where: { code: { in: Object.keys(bang) } },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, type: true, deletedAt: true, createdAt: true, studentId: true, centerId: true, subtotal: true, discountAmount: true, discountPercent: true, totalAmount: true,
      discountApprovalStatus: true,
      items: {
        select: { id: true, type: true, studentId: true, enrollmentId: true, metadata: true, quantity: true, unitPrice: true, totalPrice: true, discountAmount: true, discountPercent: true, discounts: true },
        orderBy: { id: "asc" },
      },
    },
  });
  const orderIds = donList.map((d) => d.id);
  const enrIds = [...new Set(donList.flatMap((d) => d.items.flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : []))))];
  const khoaIds = [...new Set(donList.flatMap((d) => d.items.flatMap((i) => { const k = docKhoaTrenDongWaveC(i.metadata); return k ? [k] : []; })))];

  const [ghiDanh, khoaTho, payments, phanBo] = await Promise.all([
    c.enrollment.findMany({
      where: { id: { in: enrIds } },
      select: { id: true, studentId: true, courseId: true, status: true, centerId: true, deletedAt: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true },
    }),
    c.course.findMany({ where: { id: { in: khoaIds } }, select: { id: true, price: true, updatedAt: true } }),
    c.payment.findMany({
      where: { orderId: { in: orderIds }, deletedAt: null },
      select: { id: true, orderId: true, amount: true, paymentType: true, saleStatus: true, accountantStatus: true, adjustmentOfId: true, enrollmentId: true, centerId: true },
    }),
    c.$queryRaw<{ orderId: string; tong: number }[]>`
      SELECT pr."orderId" AS "orderId", COALESCE(SUM(pa.amount), 0)::int AS tong
      FROM "PaymentAllocation" pa
      JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId"
      JOIN "BankTransaction" bt ON bt.id = pa."bankTransactionId"
      WHERE pr."orderId" = ANY(${orderIds}::text[]) AND bt.status::text = 'MATCHED'
      GROUP BY pr."orderId"`,
  ]);

  return donList.map((d): DuLieuWaveCB => {
    const dong = d.items.find((i) => i.type === "COURSE_ENROLLMENT") ?? null;
    const ge = dong?.enrollmentId ? (ghiDanh.find((g) => g.id === dong.enrollmentId) ?? null) : null;
    const khoaId = dong === null ? null : docKhoaTrenDongWaveC(dong.metadata);
    const khoa = khoaId === null ? null : (khoaTho.find((k) => k.id === khoaId) ?? null);
    return {
      don: {
        id: d.id, code: d.code, type: d.type, deletedAt: d.deletedAt, createdAt: d.createdAt, studentId: d.studentId, centerId: d.centerId, subtotal: d.subtotal, discountAmount: d.discountAmount,
        discountPercent: d.discountPercent, totalAmount: d.totalAmount, discountApprovalStatus: d.discountApprovalStatus,
        items: d.items.map((i) => ({
          id: i.id, type: i.type, studentId: i.studentId, enrollmentId: i.enrollmentId, metadata: i.metadata, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice,
          discountAmount: i.discountAmount, discountPercent: i.discountPercent, discounts: i.discounts,
        })),
      },
      ghiDanh:
        ge === null
          ? null
          : {
              id: ge.id, studentId: ge.studentId, courseId: ge.courseId, status: ge.status, centerId: ge.centerId, deletedAt: ge.deletedAt,
              gia: { listPrice: ge.listPrice, discountType: ge.discountType, discountAmount: ge.discountAmount, tuition: ge.tuition, finalPrice: ge.finalPrice },
            },
      khoa: khoa === null ? null : { id: khoa.id, price: khoa.price, updatedAt: khoa.updatedAt },
      paymentSong: payments.filter((p) => p.orderId === d.id).map((p) => ({ id: p.id, amount: p.amount, paymentType: p.paymentType, saleStatus: p.saleStatus, accountantStatus: p.accountantStatus, adjustmentOfId: p.adjustmentOfId, enrollmentId: p.enrollmentId, centerId: p.centerId })),
      tongPhanBoNganHang: phanBo.find((x) => x.orderId === d.id)?.tong ?? 0,
    };
  });
}

export async function docKeHoachWaveCB(c: KhachWaveCB, bang: Bang): Promise<KeHoachWaveCB> {
  return lapKeHoachWaveCB({ bang, du: await docDuLieuWaveCB(c, bang) });
}

const boKhoa = <T extends Record<string, unknown>>(o: T, ...khoa: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !khoa.includes(k)));

/** Các cột Enrollment mà lệnh này ĐƯỢC đổi (loại khỏi ảnh chụp). `listPrice` chỉ được loại cho ghi danh của đơn khai `ghiListPrice`. */
export const COT_GHI_WAVE_C_B = ["discountType", "discountAmount", "finalPrice", "tuition", "updatedAt"] as const;

/**
 * ẢNH CHỤP BẤT BIẾN: mọi thứ chủ dự án CẤM đổi. Order + dòng đơn (MỌI cột) · MỌI Payment (cả đã xoá) · phân bổ + giao dịch ngân hàng · Receipt · hoá đơn điện tử · hoa hồng (dòng cũ NỘI DUNG) · Course ·
 * Enrollment (MỌI cột TRỪ `COT_GHI_WAVE_C_B`, và trừ `listPrice` của ghi danh ngoại lệ). sha256 của JSON ổn định (sắp theo id). Chụp TRƯỚC và SAU phép ghi, trong CÙNG transaction.
 */
export async function anhChupBatBienWaveCB(c: KhachWaveCB, bang: Bang): Promise<string> {
  const donList = await c.order.findMany({ where: { code: { in: Object.keys(bang) } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
  const orderIds = donList.map((d) => d.id);
  const leadIds = donList.flatMap((d) => (d.leadId ? [d.leadId] : []));
  const dacBiet = new Set(
    donList.filter((d) => bang[d.code]?.ghiListPrice === true).flatMap((d) => d.items.flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : []))),
  );
  const enrIds = [...new Set(donList.flatMap((d) => d.items.flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : []))))];
  const ghiDanhTho = await c.enrollment.findMany({ where: { id: { in: enrIds } }, orderBy: { id: "asc" } });
  const ghiDanh = ghiDanhTho.map((e) => boKhoa(e, ...COT_GHI_WAVE_C_B, ...(dacBiet.has(e.id) ? ["listPrice"] : [])));
  const khoaIds = [...new Set(donList.flatMap((d) => d.items.flatMap((i) => { const k = docKhoaTrenDongWaveC(i.metadata); return k ? [k] : []; })))];
  const paymentIds = (await c.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })).map((p) => p.id);
  const [khoa, payments, phanBo, nganHang, hoaDonKhoan, bienLai, hhLine, hhTrx, hhKhac] = await Promise.all([
    c.course.findMany({ where: { id: { in: khoaIds } }, orderBy: { id: "asc" } }),
    c.payment.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    c.$queryRaw<unknown[]>`
      SELECT pa.* FROM "PaymentAllocation" pa
      WHERE pa."paymentRequestId" IN (SELECT id FROM "PaymentRequest" WHERE "orderId" = ANY(${orderIds}::text[]))
         OR pa."bankTransactionId" IN (SELECT pa2."bankTransactionId" FROM "PaymentAllocation" pa2 JOIN "PaymentRequest" pr2 ON pr2.id = pa2."paymentRequestId" WHERE pr2."orderId" = ANY(${orderIds}::text[]))
      ORDER BY pa.id`,
    c.$queryRaw<unknown[]>`
      SELECT bt.* FROM "BankTransaction" bt
      WHERE bt.id IN (SELECT pa."bankTransactionId" FROM "PaymentAllocation" pa JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId" WHERE pr."orderId" = ANY(${orderIds}::text[]))
      ORDER BY bt.id`,
    c.$queryRaw<unknown[]>`
      SELECT hk.*, hd."trangThai"::text AS "hd_trangThai", hd."tongTien" AS "hd_tongTien", hd."soHoaDon" AS "hd_soHoaDon", hd."updatedAt" AS "hd_updatedAt"
      FROM "HoaDonKhoan" hk JOIN "HoaDonDienTu" hd ON hd.id = hk."hoaDonId"
      WHERE hk."paymentId" IN (SELECT id FROM "Payment" WHERE "orderId" = ANY(${orderIds}::text[])) ORDER BY hk."hoaDonId", hk."paymentId"`,
    c.receipt.findMany({ where: { paymentId: { in: paymentIds } }, orderBy: { id: "asc" } }),
    c.commissionLine.findMany({ where: { OR: [{ enrollmentId: { in: enrIds } }, { leadId: { in: leadIds } }] }, orderBy: { id: "asc" } }),
    c.commissionTransaction.findMany({ where: { OR: [{ orderId: { in: orderIds } }, { leadId: { in: leadIds } }] }, orderBy: { id: "asc" } }),
    Promise.all([
      c.commissionHold.count({ where: { paymentId: { in: paymentIds } } }),
      c.commissionDispute.count({ where: { paymentId: { in: paymentIds } } }),
      c.commissionCalcSlot.count({ where: { paymentId: { in: paymentIds } } }),
      c.commissionAdjustmentRequest.count({ where: { paymentId: { in: paymentIds } } }),
      c.studentTransaction.count({ where: { orderId: { in: orderIds } } }),
      c.refundRequest.count({ where: { enrollmentId: { in: enrIds } } }),
    ]),
  ]);
  return createHash("sha256")
    .update(JSON.stringify({ donList, ghiDanh, khoa, payments, phanBo, nganHang, hoaDonKhoan, bienLai, hhLine, hhTrx, hhKhac }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), "utf8")
    .digest("hex");
}

export type DauVaoGhiWaveCB = {
  /** PHẠM VI CỨNG + giá niêm yết + snapshot. BẮT BUỘC khai (luật 7). */
  bang: Bang;
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"Enrollment"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiWaveCB = { daGhi: number; daSuaHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiWaveCBTrongTx`). MỘT transaction cho cả lô. */
export async function ghiWaveCB(c: PrismaClient, input: DauVaoGhiWaveCB): Promise<KetQuaGhiWaveCB> {
  const truoc = quyetDinhGhiWaveCB({ soDuyet: input.soDuyet, keHoach: await docKeHoachWaveCB(c, input.bang), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiWaveCBTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiWaveCBTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiWaveCB): Promise<KetQuaGhiWaveCB> {
  const ma = Object.keys(input.bang);
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`
    SELECT e.id FROM "Enrollment" e
    WHERE e.id IN (SELECT oi."enrollmentId" FROM "OrderItem" oi WHERE oi."orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) AND oi."enrollmentId" IS NOT NULL)
    ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachWaveCB(tx, input.bang);
  const loi = quyetDinhGhiWaveCB({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Cả lô đã ở giá đích (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daSuaHet: kh.daSuaHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienWaveCB(tx, input.bang);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng (digest + số dòng tính lại ở đây). Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.waveCSuaGia, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «đang đúng snapshot đã audit» trong `where`: lệch (ai đó vừa sửa giá) ⇒ THROW cả lô — không `continue`.
  let daGhi = 0;
  for (const g of kh.ghi) {
    const { discountType, discountAmount, finalPrice, tuition } = g.sau;
    if (discountType === null || discountAmount === null || finalPrice === null || tuition === null) throw new Error(`Sửa giá ${g.code}: giá đích thiếu cột — lùi cả lô.`);
    if (g.ghiListPrice && g.sau.listPrice === null) throw new Error(`Sửa giá ${g.code}: giá đích thiếu listPrice của ngoại lệ — lùi cả lô.`);
    const r = await tx.enrollment.updateMany({
      where: {
        id: g.enrollmentId,
        deletedAt: null,
        listPrice: g.truoc.listPrice,
        discountType: g.truoc.discountType,
        discountAmount: g.truoc.discountAmount,
        tuition: g.truoc.tuition,
        finalPrice: g.truoc.finalPrice,
      },
      data: g.ghiListPrice ? { listPrice: g.sau.listPrice, discountType, discountAmount, finalPrice, tuition } : { discountType, discountAmount, finalPrice, tuition },
    });
    if (r.count !== 1) throw new Error(`Sửa giá ${g.code}: giá ghi danh không còn đúng snapshot lúc lập kế hoạch giữa chừng — lùi cả lô.`);
    daGhi++;
    await writeAudit({
      actor: input.actor,
      module: "finance",
      entityType: "Enrollment",
      entityId: g.enrollmentId,
      action: HANH_DONG_WAVE_C_B,
      oldValues: { listPrice: g.truoc.listPrice, discountType: g.truoc.discountType, discountAmount: g.truoc.discountAmount, tuition: g.truoc.tuition, finalPrice: g.truoc.finalPrice },
      newValues: { listPrice: g.sau.listPrice, discountType, discountAmount, tuition, finalPrice, orderCode: g.code, ghiListPrice: g.ghiListPrice },
      changedFields: g.ghiListPrice ? ["listPrice", "discountType", "discountAmount", "finalPrice", "tuition"] : ["discountType", "discountAmount", "finalPrice", "tuition"],
      reason: LY_DO_WAVE_C_B,
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: cả lô phải ra «đã ở giá đích», và không bất biến nào bị đổi.
  const sau = await docKeHoachWaveCB(tx, input.bang);
  if (sau.dung || !sau.daSuaHet) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «cả lô đã ở giá đích» (${sau.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || "chưa đủ"}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienWaveCB(tx, input.bang);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order · dòng đơn · Payment · ngân hàng · Receipt · hoá đơn · hoa hồng · Course · cột không phải giá của ghi danh) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction: có phép ghi thì có dấu vết, lùi thì lùi cùng.
  if (input.soDuyet === null) throw new Error("ghiWaveCBTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: "WaveCSuaGia",
    entityId: khoaLuotChayWaveC(input.luotChay.nguonChay),
    action: HANH_DONG_WAVE_C_B_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay,
      soDuyet: input.soDuyet,
      soKeHoach: kh.ghi.length,
      daGhi,
      keHoachSha: kh.sha,
      chiTiet: { donDaSua: kh.ghi.map((g) => g.code), soGhiListPrice: kh.ghi.filter((g) => g.ghiListPrice).length, noGiaTruoc: kh.noGiaTruoc, noGiaSau: kh.noGiaSau },
    }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy PHASE C-B chuẩn hoá giá ghi danh: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daSuaHet: true, keHoachSha: kh.sha };
}

/** KIỂM SAU GHI (chỉ đọc): cả lô ở giá đích + nợ giả SAU (báo cáo) + số khoản sống của phạm vi còn NULL ghi danh (báo cho C-C, KHÔNG phải điều kiện PASS của C-B). */
export async function kiemSauGhiWaveCB(
  c: KhachWaveCB,
  bang: Bang,
): Promise<{ keHoach: KeHoachWaveCB; khoanChuaGanGhiDanh: number; soGhiDanhDungGia: number; chuoiGiaSau: string[] }> {
  const keHoach = await docKeHoachWaveCB(c, bang);
  const khoanChuaGanGhiDanh = await c.payment.count({ where: { order: { code: { in: Object.keys(bang) } }, deletedAt: null, enrollmentId: null } });
  const soGhiDanhDungGia = keHoach.muc.filter((m) => m.trangThai === "DA_SUA").length;
  return { keHoach, khoanChuaGanGhiDanh, soGhiDanhDungGia, chuoiGiaSau: keHoach.muc.map((m) => (m.dong ? `${m.code}:${chuoiGiaWaveCB(m.dong.sau)}` : `${m.code}:—`)) };
}
