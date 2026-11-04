// lib/nguon/wave-c-gan-payment-ghi-danh-db.ts — TẦNG GHI của «PHASE C-C · gắn Payment.enrollmentId cho 3 khoản thu sống của 2 đơn nhóm C» (26/10/2026).
//
// ── Dùng LẠI tầng ĐỌC + ẢNH CHỤP + KIỂM SAU của PHASE B.2 (`gan-payment-ghi-danh-db.ts`, đã chạy thật trên PROD) ────────────────────────────────────────
//   `docKeHoachGanPayment` (nạp dữ liệu + chạy CHÍNH planner chuẩn `lapKeHoachGanGhiDanh` + lõi `lapKeHoachGanPayment`) · `anhChupBatBienGanPayment` · `kiemSauGhiGanPayment`.
//   Tệp này chỉ thêm PHẦN GHI với tên workflow / audit RIÊNG của PHASE C-C (artifact B.2 không dùng được ở đây: `WORKFLOW_WAVE1.waveCGanPayment` ≠ `ganPaymentGhiDanh`).
//   B.2 KHÔNG bị sửa: nó đã ghi PROD và có lưới `[GPG-W*]` ghim từng dòng.
//
// ── PHÉP GHI DUY NHẤT: MỘT cột của MỘT bảng ────────────────────────────────────────────────────────────────
//   Payment.enrollmentId (NULL → ghi danh đích) qua `payment.updateMany` CÓ ĐIỀU KIỆN `{ id, enrollmentId: null, amount, deletedAt: null, orderItemId, orderId }`. Không Receipt, không số tiền.
//   Bằng chứng KHÔNG đụng gì khác: «ảnh chụp bất biến» của B.2 (Order · dòng đơn · Enrollment · MỌI cột Payment trừ enrollmentId/updatedAt · ngân hàng · hoá đơn · số dòng phụ) TRƯỚC và SAU, trong cùng transaction.
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[WCC-W*]` canh) ─────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Enrollment → Payment (`FOR UPDATE`) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN)
//   → `payment.updateMany` (count≠1 ⇒ throw) + audit → đọc lại phải ra «cả lô đã gắn ĐÚNG» → ảnh chụp «sau» = «trước» → audit mức lượt. Lô đã gắn đúng (chạy lại) ⇒ 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { quyetDinhGhiGanPayment, type KeHoachGanPayment, type MucGanPayment } from "./gan-payment-ghi-danh";
import { anhChupBatBienGanPayment, docKeHoachGanPayment } from "./gan-payment-ghi-danh-db";
import { HANH_DONG_WAVE_C_C_LUOT, LY_DO_WAVE_C_C, NGUON_GHI_WAVE_C_C } from "./wave-c-gan-payment-ghi-danh";
import { dungBanGhiLuotWaveC, khoaLuotChayWaveC, type LuotChayWaveC } from "./wave-c-chung";

export { docKeHoachGanPayment as docKeHoachWaveCC, kiemSauGhiGanPayment as kiemSauGhiWaveCC } from "./gan-payment-ghi-danh-db";

export const ACTOR_WAVE_C_C = { id: null, name: "Script PHASE C-C gắn khoản thu vào ghi danh (wave-c-gan-payment-ghi-danh)" } as const;

type Bang = Readonly<Record<string, MucGanPayment>>;

export type DauVaoGhiWaveCC = {
  /** PHẠM VI CỨNG + giá đích + số đếm. BẮT BUỘC khai (luật 7). */
  bang: Bang;
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"Payment"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiWaveCC = { daGhi: number; daGanHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiWaveCCTrongTx`). MỘT transaction cho cả lô. */
export async function ghiWaveCC(c: PrismaClient, input: DauVaoGhiWaveCC): Promise<KetQuaGhiWaveCC> {
  const truoc = quyetDinhGhiGanPayment({ soDuyet: input.soDuyet, keHoach: await docKeHoachGanPayment(c, input.bang), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiWaveCCTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiWaveCCTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiWaveCC): Promise<KetQuaGhiWaveCC> {
  const ma = Object.keys(input.bang);
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Enrollment" WHERE id IN (SELECT "enrollmentId" FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) AND "enrollmentId" IS NOT NULL) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachGanPayment(tx, input.bang);
  const loi = quyetDinhGhiGanPayment({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Cả lô đã gắn đúng (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daGanHet: kh.daGanHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienGanPayment(tx, input.bang);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.waveCGanPayment, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «khoản vẫn chưa gắn · đúng số tiền · còn sống · đúng dòng đơn» trong `where`; count ≠ 1 ⇒ THROW cả lô — không `continue`, không tách.
  let daGhi = 0;
  for (const g of kh.ghi) {
    const r = await tx.payment.updateMany({
      where: { id: g.paymentId, enrollmentId: null, amount: g.amount, deletedAt: null, orderItemId: g.orderItemId, orderId: g.orderId },
      data: { enrollmentId: g.enrollmentId },
    });
    if (r.count !== 1) throw new Error(`Gắn khoản ${g.paymentId} (${g.code}): khoản không còn «chưa gắn · đúng số tiền · còn sống» giữa chừng — lùi cả lô.`);
    daGhi++;
    await writeAudit({
      actor: input.actor,
      module: "finance",
      entityType: "Payment",
      entityId: g.paymentId,
      action: "UPDATE",
      oldValues: { enrollmentId: null },
      newValues: { enrollmentId: g.enrollmentId, soTien: g.amount, maDon: g.code, maGiaoDich: g.providerTxnId, source: NGUON_GHI_WAVE_C_C },
      changedFields: ["enrollmentId"],
      reason: LY_DO_WAVE_C_C,
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: cả lô phải ra «đã gắn ĐÚNG», và không bất biến nào bị đổi.
  const sau = await docKeHoachGanPayment(tx, input.bang);
  if (sau.dung || !sau.daGanHet) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «cả lô đã gắn đúng» (${sau.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || "chưa đủ"}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienGanPayment(tx, input.bang);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order · dòng đơn · Enrollment · mọi cột Payment trừ enrollmentId · giao dịch ngân hàng · hoá đơn · số dòng phụ) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction.
  if (input.soDuyet === null) throw new Error("ghiWaveCCTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: "WaveCGanPayment",
    entityId: khoaLuotChayWaveC(input.luotChay.nguonChay),
    action: HANH_DONG_WAVE_C_C_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay,
      soDuyet: input.soDuyet,
      soKeHoach: kh.ghi.length,
      daGhi,
      keHoachSha: kh.sha,
      chiTiet: { khoanDaGan: kh.ghi.map((g) => g.paymentId), lyDo: LY_DO_WAVE_C_C },
    }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy PHASE C-C gắn khoản thu vào ghi danh: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daGanHet: true, keHoachSha: kh.sha };
}

export type { KeHoachGanPayment };
