// lib/nguon/wave-c-gan-danh-tinh-db.ts — TẦNG DB của «PHASE C-A · gắn DANH TÍNH cho 18 đơn khoá học legacy» (26/10/2026). Lõi quyết định: `wave-c-gan-danh-tinh.ts` (thuần).
//
// ── QUY ƯỚC (giống `gan-danh-tinh-don-db.ts`) ────────────────────────────────────────────────────────────────
//   · Mọi hàm nhận client làm tham số BẮT BUỘC; `bang` (PHẠM VI + tổng đơn + trạng thái xuất phát) cũng BẮT BUỘC, không mặc định (luật 7). Script truyền hằng `BANG_WAVE_C_A`, ca DB truyền
//     bảng fixture. Số câu đọc CỐ ĐỊNH (7), không theo số đơn.
//
// ── PHÉP GHI DUY NHẤT: BA cột, hai bảng ─────────────────────────────────────────────────────────────────────
//   Order.studentId · OrderItem.studentId · OrderItem.enrollmentId — `order.updateMany` + `orderItem.updateMany`, MỖI lời gọi có điều kiện «đang NULL» trong `where` (chế độ 1 cột: dòng đơn
//   phải đang trỏ ĐÚNG đích, chỉ `Order.studentId` đang NULL). KHÔNG Payment · Enrollment · Student · Lead · Commission* · BankTransaction · Receipt.
//   Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến» (MỌI cột của Order trừ `studentId`/`updatedAt` · MỌI cột dòng đơn trừ `studentId`/`enrollmentId`/`updatedAt` · MỌI Payment ·
//   MỌI cột Enrollment/Student ứng viên · phân bổ + giao dịch ngân hàng · số dòng Receipt/hoa hồng) chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi cuối; khác một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[WCA-W*]` canh) ─────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Enrollment (`FOR UPDATE`, thứ tự id) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 (artifact owner ký) → claim nonce (phép ghi
//   ĐẦU TIÊN) → `order.updateMany` + `orderItem.updateMany` (lệch ⇒ throw) + audit → đọc lại phải ra «cả lô đã gắn ĐÚNG» → ảnh chụp «sau» = «trước» → audit mức lượt.
//   Lô đã gắn đúng từ trước (chạy lại) ⇒ 0 dòng ghi, KHÔNG qua cổng và KHÔNG claim (không có gì để duyệt).
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  HANH_DONG_WAVE_C_A,
  HANH_DONG_WAVE_C_A_LUOT,
  LY_DO_WAVE_C_A,
  khoaBeCuaDon,
  lapKeHoachWaveCA,
  type DuLieuWaveCA,
  type KeHoachWaveCA,
  type MucWaveCA,
} from "./wave-c-gan-danh-tinh";
import { dungBanGhiLuotWaveC, khoaLuotChayWaveC, quyetDinhGhiWaveC, type LuotChayWaveC } from "./wave-c-chung";

export type KhachWaveCA = PrismaClient | Prisma.TransactionClient;
type Bang = Readonly<Record<string, MucWaveCA>>;

export const ACTOR_WAVE_C_A = { id: null, name: "Script PHASE C-A gắn danh tính đơn khoá học legacy (wave-c-gan-danh-tinh)" } as const;

/** Cổng số duyệt của C-A (mỏng): dựng từ kế hoạch + dùng khuôn chung. */
export function quyetDinhGhiWaveCA(i: { soDuyet: number | null; keHoach: KeHoachWaveCA; ghiDuoc: boolean | null }): string | null {
  return quyetDinhGhiWaveC({
    soDuyet: i.soDuyet,
    dung: i.keHoach.dung,
    loiTomTat: i.keHoach.loi.map((x) => `${x.code}:${x.ma}`),
    soGhi: i.keHoach.ghi.length,
    ghiDuoc: i.ghiDuoc,
    tenBang: "Order / OrderItem",
    donViDem: "ĐƠN",
  });
}

/** ĐỌC dữ liệu cho các mã trong `bang` (kể cả đơn đã xoá mềm — lõi sẽ từ chối). 7 câu, cố định. */
export async function docDuLieuWaveCA(c: KhachWaveCA, bang: Bang): Promise<DuLieuWaveCA[]> {
  const ma = Object.keys(bang);
  const donList = await c.order.findMany({
    where: { code: { in: ma } },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, type: true, deletedAt: true, studentId: true, leadId: true, leadChildId: true, centerId: true, totalAmount: true,
      items: { select: { id: true, type: true, studentId: true, enrollmentId: true, metadata: true }, orderBy: { id: "asc" } },
    },
  });
  const khoaBeTheoDon = new Map(
    donList.map((d) => {
      const dong = d.items.find((i) => i.type === "COURSE_ENROLLMENT");
      return [d.id, khoaBeCuaDon(d.leadChildId, dong?.metadata).khoa] as const;
    }),
  );
  const leadIds = [...new Set(donList.flatMap((d) => (d.leadId ? [d.leadId] : [])))];
  const beIds = [...new Set([...khoaBeTheoDon.values()].flatMap((k) => (k ? [k] : [])))];
  const [leads, bes, hocVienTho] = await Promise.all([
    c.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, centerId: true, deletedAt: true } }),
    c.leadChild.findMany({ where: { id: { in: beIds } }, select: { id: true, leadId: true } }),
    c.student.findMany({ where: { deletedAt: null, leadChildId: { in: beIds } }, select: { id: true, leadId: true, leadChildId: true, centerId: true } }),
  ]);
  const ghiDanhTho = await c.enrollment.findMany({
    where: { studentId: { in: hocVienTho.map((h) => h.id) }, deletedAt: null },
    select: { id: true, studentId: true, courseId: true, status: true, leadChildId: true, centerId: true },
  });
  const dongTro = await c.orderItem.findMany({ where: { enrollmentId: { in: ghiDanhTho.map((g) => g.id) } }, select: { id: true, orderId: true, enrollmentId: true } });

  return donList.map((d): DuLieuWaveCA => {
    const ck = khoaBeTheoDon.get(d.id) ?? null;
    const hv = ck === null ? [] : hocVienTho.filter((h) => h.leadChildId === ck);
    const hvIds = new Set(hv.map((h) => h.id));
    const gd = ghiDanhTho.filter((g) => hvIds.has(g.studentId));
    const gdIds = new Set(gd.map((g) => g.id));
    return {
      don: {
        id: d.id, code: d.code, type: d.type, deletedAt: d.deletedAt, studentId: d.studentId, leadId: d.leadId, leadChildId: d.leadChildId, centerId: d.centerId, totalAmount: d.totalAmount,
        items: d.items.map((i) => ({ id: i.id, type: i.type, studentId: i.studentId, enrollmentId: i.enrollmentId, metadata: i.metadata })),
      },
      lead: leads.find((l) => l.id === d.leadId) ?? null,
      be: ck === null ? null : (bes.find((b) => b.id === ck) ?? null),
      hocVien: hv.map((h) => ({ id: h.id, leadId: h.leadId, leadChildId: h.leadChildId, centerId: h.centerId })),
      ghiDanh: gd.map((g) => ({ id: g.id, studentId: g.studentId, courseId: g.courseId, status: g.status, leadChildId: g.leadChildId, centerId: g.centerId })),
      dongTroVaoGhiDanh: dongTro.filter((x) => x.enrollmentId !== null && gdIds.has(x.enrollmentId)).map((x) => ({ orderItemId: x.id, orderId: x.orderId, enrollmentId: x.enrollmentId! })),
    };
  });
}

export async function docKeHoachWaveCA(c: KhachWaveCA, bang: Bang): Promise<KeHoachWaveCA> {
  return lapKeHoachWaveCA({ bang, du: await docDuLieuWaveCA(c, bang) });
}

const boKhoa = <T extends Record<string, unknown>>(o: T, ...khoa: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !khoa.includes(k)));

/**
 * ẢNH CHỤP BẤT BIẾN: mọi thứ chủ dự án CẤM đổi. Order (MỌI cột TRỪ `studentId` + `updatedAt`) · dòng đơn (MỌI cột TRỪ `studentId` + `enrollmentId` + `updatedAt`) · MỌI Payment (cả đã xoá) ·
 * Enrollment + Student ứng viên (MỌI cột) · giao dịch + phân bổ ngân hàng · số dòng phụ (Receipt · hoa hồng · hoàn tiền · StudentTransaction). sha256 của JSON ổn định (sắp theo id).
 * Chụp TRƯỚC và SAU phép ghi, trong CÙNG transaction.
 */
export async function anhChupBatBienWaveCA(c: KhachWaveCA, bang: Bang): Promise<string> {
  const donList = await c.order.findMany({ where: { code: { in: Object.keys(bang) } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
  const orderIds = donList.map((d) => d.id);
  const leadIds = donList.flatMap((d) => (d.leadId ? [d.leadId] : []));
  const beIds = donList.flatMap((d) => {
    const k = khoaBeCuaDon(d.leadChildId, d.items.find((i) => i.type === "COURSE_ENROLLMENT")?.metadata).khoa;
    return k ? [k] : [];
  });
  const hocVien = await c.student.findMany({ where: { leadChildId: { in: beIds } }, orderBy: { id: "asc" } });
  const hvIds = hocVien.map((h) => h.id);
  const ghiDanh = await c.enrollment.findMany({ where: { studentId: { in: hvIds } }, orderBy: { id: "asc" } });
  const enrIds = ghiDanh.map((e) => e.id);
  const [payments, phanBo, soPhu] = await Promise.all([
    c.payment.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    c.$queryRaw<unknown[]>`
      SELECT pa.id AS id, pa.amount AS amount, pa."paymentRequestId" AS "paymentRequestId", pa."bankTransactionId" AS "bankTransactionId", bt.status::text AS status, bt.amount AS "btAmount"
      FROM "PaymentAllocation" pa JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId" JOIN "BankTransaction" bt ON bt.id = pa."bankTransactionId"
      WHERE pr."orderId" = ANY(${orderIds}::text[]) ORDER BY pa.id`,
    Promise.all([
      c.receipt.count({ where: { payment: { orderId: { in: orderIds } } } }),
      c.commissionTransaction.count({ where: { OR: [{ orderId: { in: orderIds } }, { leadId: { in: leadIds } }] } }),
      c.commissionLine.count({ where: { OR: [{ leadId: { in: leadIds } }, { enrollmentId: { in: enrIds } }] } }),
      c.studentTransaction.count({ where: { orderId: { in: orderIds } } }),
      c.refundRequest.count({ where: { enrollmentId: { in: enrIds } } }),
    ]),
  ]);
  const don = donList.map((d) => ({ ...boKhoa(d, "studentId", "updatedAt", "items"), items: d.items.map((i) => boKhoa(i, "studentId", "enrollmentId", "updatedAt")) }));
  return createHash("sha256")
    .update(JSON.stringify({ don, hocVien, ghiDanh, payments, phanBo, soPhu }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), "utf8")
    .digest("hex");
}

export type DauVaoGhiWaveCA = {
  /** PHẠM VI CỨNG. BẮT BUỘC khai (luật 7). */
  bang: Bang;
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege` UPDATE trên Order VÀ OrderItem; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiWaveCA = { daGhi: number; daGanHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiWaveCATrongTx`). MỘT transaction cho cả lô (đơn lệch ⇒ lùi cả lô). */
export async function ghiWaveCA(c: PrismaClient, input: DauVaoGhiWaveCA): Promise<KetQuaGhiWaveCA> {
  const truoc = quyetDinhGhiWaveCA({ soDuyet: input.soDuyet, keHoach: await docKeHoachWaveCA(c, input.bang), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiWaveCATrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiWaveCATrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiWaveCA): Promise<KetQuaGhiWaveCA> {
  const ma = Object.keys(input.bang);
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`
    SELECT e.id FROM "Enrollment" e
    WHERE e."deletedAt" IS NULL
      AND e."studentId" IN (
        SELECT s.id FROM "Student" s
        WHERE s."leadChildId" IN (
          SELECT COALESCE(oi.metadata->>'leadChildId', o."leadChildId")
          FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
          WHERE o.code = ANY(${ma}::text[]) AND oi.type::text = 'COURSE_ENROLLMENT'))
    ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachWaveCA(tx, input.bang);
  const loi = quyetDinhGhiWaveCA({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Cả lô đã gắn ĐÚNG (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daGanHet: kh.daGanHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienWaveCA(tx, input.bang);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.waveCGanDanhTinh, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «đang NULL / đang đúng đích» trong `where`: lệch (ai đó vừa gắn) ⇒ THROW cả lô — không `continue`.
  let daGhi = 0;
  for (const g of kh.ghi) {
    if (g.che === "3COT") {
      const i = await tx.orderItem.updateMany({
        where: { id: g.orderItemId, orderId: g.orderId, type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null },
        data: { studentId: g.studentId, enrollmentId: g.enrollmentId },
      });
      if (i.count !== 1) throw new Error(`Gắn danh tính ${g.code}: dòng đơn không còn «chưa gắn» giữa chừng — lùi cả lô.`);
    } else {
      // Chế độ 1 cột: dòng đơn KHÔNG bị ghi. Chỉ xác nhận (dòng đã khoá FOR UPDATE ở trên) rằng nó vẫn trỏ ĐÚNG đích trước khi gắn Order.studentId.
      const dongDung = await tx.orderItem.count({
        where: { id: g.orderItemId, orderId: g.orderId, type: "COURSE_ENROLLMENT", studentId: g.studentId, enrollmentId: g.enrollmentId },
      });
      if (dongDung !== 1) throw new Error(`Gắn danh tính ${g.code}: dòng đơn không còn trỏ đúng học viên + ghi danh giữa chừng — lùi cả lô.`);
    }
    const o = await tx.order.updateMany({ where: { id: g.orderId, studentId: null, deletedAt: null }, data: { studentId: g.studentId } });
    if (o.count !== 1) throw new Error(`Gắn danh tính ${g.code}: Order.studentId không còn NULL/đơn đã xoá giữa chừng — lùi cả lô.`);
    daGhi++;
    await writeAudit({
      actor: input.actor,
      module: "nguon-hoa-hong",
      entityType: "Order",
      entityId: g.orderId,
      action: HANH_DONG_WAVE_C_A,
      oldValues: { studentId: null, orderItemId: g.orderItemId, orderItemStudentId: g.che === "3COT" ? null : g.studentId, orderItemEnrollmentId: g.che === "3COT" ? null : g.enrollmentId },
      newValues: { studentId: g.studentId, orderItemId: g.orderItemId, orderItemStudentId: g.studentId, orderItemEnrollmentId: g.enrollmentId, che: g.che, maDon: g.code },
      changedFields: g.che === "3COT" ? ["Order.studentId", "OrderItem.studentId", "OrderItem.enrollmentId"] : ["Order.studentId"],
      reason: LY_DO_WAVE_C_A,
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: cả lô phải ra «đã gắn ĐÚNG», và không bất biến nào bị đổi.
  const sau = await docKeHoachWaveCA(tx, input.bang);
  if (sau.dung || !sau.daGanHet) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «cả lô đã gắn đúng» (${sau.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || "chưa đủ"}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienWaveCA(tx, input.bang);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order trừ studentId · dòng đơn trừ studentId/enrollmentId · Payment · Enrollment · Student · ngân hàng · số dòng phụ) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction: có phép ghi thì có dấu vết, lùi thì lùi cùng.
  if (input.soDuyet === null) throw new Error("ghiWaveCATrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "nguon-hoa-hong",
    entityType: "WaveCGanDanhTinh",
    entityId: khoaLuotChayWaveC(input.luotChay.nguonChay),
    action: HANH_DONG_WAVE_C_A_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay,
      soDuyet: input.soDuyet,
      soKeHoach: kh.ghi.length,
      daGhi,
      keHoachSha: kh.sha,
      chiTiet: { donDaGan: kh.ghi.map((g) => g.code), che3Cot: kh.ghi.filter((g) => g.che === "3COT").length, che1Cot: kh.ghi.filter((g) => g.che === "1COT").length },
    }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy PHASE C-A gắn danh tính đơn: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daGanHet: true, keHoachSha: kh.sha };
}

/** KIỂM SAU GHI (chỉ đọc): cả lô đã gắn đúng + số đơn trong phạm vi còn thiếu một trong ba cột (PHẢI = 0). */
export async function kiemSauGhiWaveCA(c: KhachWaveCA, bang: Bang): Promise<{ keHoach: KeHoachWaveCA; donConThieu: number }> {
  const keHoach = await docKeHoachWaveCA(c, bang);
  const donConThieu = await c.order.count({
    where: {
      code: { in: Object.keys(bang) },
      OR: [{ studentId: null }, { items: { some: { type: "COURSE_ENROLLMENT", OR: [{ studentId: null }, { enrollmentId: null }] } } }],
    },
  });
  return { keHoach, donConThieu };
}
