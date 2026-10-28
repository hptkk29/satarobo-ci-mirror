// lib/nguon/sua-gia-theo-don-db.ts — TẦNG DB của «chuẩn hoá GIÁ GHI DANH theo đơn đã duyệt và đã đóng đủ — phạm vi suy từ bằng chứng» (P7-A, nhóm G1a, 26/10/2026). Lõi quyết định: `sua-gia-theo-don.ts` (thuần).
//
// ── QUY ƯỚC ───────────────────────────────────────────────────────────────────────────────────────────────
//   · Mọi hàm nhận client làm tham số BẮT BUỘC; KHÔNG có tham số nào đưa mã đơn vào: phạm vi do QUY TẮC bằng chứng suy ra từ DB (đơn khoá học còn sống), không từ dòng lệnh / ô workflow / hằng mã đơn.
//     Số câu đọc CỐ ĐỊNH, không theo số đơn. Đọc dữ liệu từng đơn dùng lại `docDuLieuWaveCB` (đã chạy ở C-B), phần bổ sung chỉ thêm 3 câu (ghi danh của học viên · dòng đơn đã trỏ ghi danh · bé của đơn).
//
// ── PHÉP GHI: HAI bảng, mỗi bảng đúng MỘT lời gọi `updateMany` CÓ ĐIỀU KIỆN ──────────────────────────────────
//   · Enrollment.discountType · discountAmount · finalPrice · tuition (+ listPrice CHỈ cho ghi danh có cả năm cột giá NULL) — đang đúng snapshot legacy đã suy ra;
//   · OrderItem.enrollmentId (NULL → ghi danh) — CHỈ cho dòng đơn mà lõi chứng minh được (4 bằng chứng), `where` đòi `enrollmentId = null` + đúng học viên.
//   KHÔNG Order, Payment, BankTransaction, PaymentAllocation, Receipt, hoá đơn điện tử, hoa hồng, `Payment.enrollmentId`. Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến» (Order · dòng đơn trừ
//   `enrollmentId` của dòng được gắn · MỌI Payment · phân bổ + giao dịch ngân hàng · Receipt · hoá đơn · hoa hồng (CẢ NỘI DUNG) · Course · MỌI cột Enrollment trừ các cột được ghi) chụp TRƯỚC phép ghi đầu tiên và SAU phép
//   ghi cuối; khác nhau một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[SGT-W*]` canh) ─────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Enrollment (`FOR UPDATE`) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → trả sớm khi không còn gì ghi → ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN) →
//   `orderItem.updateMany` (nếu cần gắn) + `enrollment.updateMany` (lệch ⇒ throw) + audit → đọc lại phải ra «cả lô đã ở giá đích» → ảnh chụp «sau» = «trước» → audit mức lượt.
//
// ── VÌ SAO KHÔNG GỌI `ghiWaveCBTrongTx` CỦA C-B ────────────────────────────────────────────────────────────
//   Hàm đó khoá cứng danh tính `WORKFLOW_WAVE1.waveCSuaGia` + hành động audit của C-B (lưới `[WCW-13]` đếm đúng một lần) và ảnh chụp của nó coi `OrderItem.enrollmentId` là bất biến. Lệnh này có workflow, chữ ký owner, hành
//   động audit RIÊNG và được phép gắn MỘT cột của dòng đơn, nên có khung ghi riêng (cùng thứ tự bước, lưới `[SGT-W*]` ghim). Phần ĐỌC (`docDuLieuWaveCB`) và LÕI QUYẾT ĐỊNH (`lapKeHoachWaveCB`) dùng chung, không chép.
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { docKhoaTrenDongWaveC, dungBanGhiLuotWaveC, khoaLuotChayWaveC, quyetDinhGhiWaveC, type LuotChayWaveC } from "./wave-c-chung";
import { COT_GHI_WAVE_C_B, docDuLieuWaveCB } from "./wave-c-sua-gia-ghi-danh-db";
import type { MucWaveCB } from "./wave-c-sua-gia-ghi-danh";
import {
  ENTITY_LUOT_SUA_GIA_THEO_DON,
  HANH_DONG_GAN_DONG_THEO_DON,
  HANH_DONG_SUA_GIA_THEO_DON,
  HANH_DONG_SUA_GIA_THEO_DON_LUOT,
  LY_DO_GAN_DONG_THEO_DON,
  LY_DO_SUA_GIA_THEO_DON,
  lapKeHoachSuaGiaTheoDon,
  type DuLieuTheoDon,
  type KeHoachSuaGiaTheoDon,
} from "./sua-gia-theo-don";

export type KhachSuaGiaTheoDon = PrismaClient | Prisma.TransactionClient;

export const ACTOR_SUA_GIA_THEO_DON = { id: null, name: "Script P7-A chuẩn hoá giá ghi danh theo đơn (sua-gia-theo-don)" } as const;

/** Cổng số duyệt (mỏng): dựng từ kế hoạch + khuôn chung của PHASE C. */
export function quyetDinhGhiSuaGiaTheoDon(i: { soDuyet: number | null; keHoach: KeHoachSuaGiaTheoDon; ghiDuoc: boolean | null }): string | null {
  return quyetDinhGhiWaveC({
    soDuyet: i.soDuyet,
    dung: i.keHoach.dung,
    loiTomTat: i.keHoach.keHoach.loi.map((x) => `${x.code}:${x.ma}`),
    soGhi: i.keHoach.ghi.length,
    ghiDuoc: i.ghiDuoc,
    tenBang: "Enrollment",
    donViDem: "GHI DANH",
  });
}

/** Mã của MỌI đơn khoá học còn sống có đúng một dòng COURSE_ENROLLMENT hoặc nhiều dòng (lõi tự loại) — tập ỨNG VIÊN, chưa phải phạm vi. */
async function docMaUngVien(c: KhachSuaGiaTheoDon): Promise<string[]> {
  const r = await c.order.findMany({ where: { type: "COURSE", deletedAt: null, items: { some: { type: "COURSE_ENROLLMENT" } } }, orderBy: { code: "asc" }, select: { code: true } });
  return r.map((x) => x.code);
}

/** `docDuLieuWaveCB` chỉ dùng KHOÁ của bảng để chọn đơn; ứng viên chưa có `MucWaveCB` nên truyền khoá với giá trị rỗng (ép kiểu có chủ đích, không bao giờ đọc giá trị). */
const bangKhoaRong = (ma: readonly string[]) => Object.fromEntries(ma.map((m) => [m, null])) as unknown as Record<string, MucWaveCB>;

/** ĐỌC dữ liệu ứng viên: dữ liệu từng đơn (C-B) + 3 câu bổ sung. Cố định 9 câu. */
export async function docDuLieuTheoDon(c: KhachSuaGiaTheoDon): Promise<DuLieuTheoDon[]> {
  const ma = await docMaUngVien(c);
  const co = await docDuLieuWaveCB(c, bangKhoaRong(ma));
  const hocVienIds = [...new Set(co.flatMap((d) => (d.don.studentId ? [d.don.studentId] : [])))];
  const [ghiDanh, dongTro, beDon] = await Promise.all([
    c.enrollment.findMany({
      where: { studentId: { in: hocVienIds } },
      select: { id: true, studentId: true, courseId: true, centerId: true, status: true, deletedAt: true, leadChildId: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true },
    }),
    c.orderItem.findMany({ where: { enrollmentId: { not: null }, order: { type: "COURSE", deletedAt: null } }, select: { id: true, enrollmentId: true } }),
    c.order.findMany({ where: { code: { in: ma } }, select: { id: true, leadChildId: true } }),
  ]);
  return co.map((d): DuLieuTheoDon => {
    const idDongCuaDon = new Set(d.don.items.map((i) => i.id));
    return {
      ...d,
      beTrenDon: beDon.find((x) => x.id === d.don.id)?.leadChildId ?? null,
      ghiDanhCuaHocVien: ghiDanh
        .filter((g) => g.studentId === d.don.studentId)
        .map((g) => ({
          id: g.id, studentId: g.studentId, courseId: g.courseId, centerId: g.centerId, status: g.status, deletedAt: g.deletedAt, leadChildId: g.leadChildId,
          gia: { listPrice: g.listPrice, discountType: g.discountType, discountAmount: g.discountAmount, tuition: g.tuition, finalPrice: g.finalPrice },
        })),
      ghiDanhDaCoDongKhac: dongTro.filter((x) => x.enrollmentId !== null && !idDongCuaDon.has(x.id)).map((x) => x.enrollmentId as string),
    };
  });
}

export async function docKeHoachSuaGiaTheoDon(c: KhachSuaGiaTheoDon): Promise<KeHoachSuaGiaTheoDon> {
  return lapKeHoachSuaGiaTheoDon(await docDuLieuTheoDon(c));
}

const boKhoa = <T extends Record<string, unknown>>(o: T, ...khoa: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !khoa.includes(k)));

/**
 * ẢNH CHỤP BẤT BIẾN của đúng phạm vi đã suy: mọi thứ chủ dự án CẤM đổi. Order + dòng đơn (MỌI cột, TRỪ `enrollmentId`/`updatedAt` của đúng dòng được gắn) · MỌI Payment (cả đã xoá) · phân bổ + giao dịch ngân hàng ·
 * Receipt · hoá đơn điện tử · hoa hồng (dòng cũ NỘI DUNG) · Course · Enrollment (MỌI cột TRỪ `COT_GHI_WAVE_C_B`, và trừ `listPrice` của ghi danh ngoại lệ). Tập đơn / ghi danh lấy từ KẾ HOẠCH (không từ dòng đơn) để tập không
 * đổi giữa «trước» và «sau» khi dòng đơn vừa được gắn. sha256 của JSON ổn định (sắp theo id).
 */
export async function anhChupBatBienSuaGiaTheoDon(c: KhachSuaGiaTheoDon, kh: KeHoachSuaGiaTheoDon): Promise<string> {
  const maDon = Object.keys(kh.ketQuaBang.bang);
  const dongDuocGan = new Set(Object.values(kh.ketQuaBang.gan).map((g) => g.orderItemId));
  const enrIds = [...new Set(kh.ghi.map((g) => g.enrollmentId))];
  const dacBiet = new Set(kh.ghi.filter((g) => g.ghiListPrice).map((g) => g.enrollmentId));
  const donTho = await c.order.findMany({ where: { code: { in: maDon } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
  const donList = donTho.map((d) => ({ ...d, items: d.items.map((i) => (dongDuocGan.has(i.id) ? boKhoa(i, "enrollmentId", "updatedAt") : i)) }));
  const orderIds = donTho.map((d) => d.id);
  const leadIds = donTho.flatMap((d) => (d.leadId ? [d.leadId] : []));
  const ghiDanhTho = await c.enrollment.findMany({ where: { id: { in: enrIds } }, orderBy: { id: "asc" } });
  const ghiDanh = ghiDanhTho.map((e) => boKhoa(e, ...COT_GHI_WAVE_C_B, ...(dacBiet.has(e.id) ? ["listPrice"] : [])));
  const khoaIds = [...new Set(donTho.flatMap((d) => d.items.flatMap((i) => { const k = docKhoaTrenDongWaveC(i.metadata); return k ? [k] : []; })))];
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

export type DauVaoGhiSuaGiaTheoDon = {
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"Enrollment"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiSuaGiaTheoDon = { daGhi: number; daGan: number; daSuaHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiSuaGiaTheoDonTrongTx`). MỘT transaction cho cả lô. */
export async function ghiSuaGiaTheoDon(c: PrismaClient, input: DauVaoGhiSuaGiaTheoDon): Promise<KetQuaGhiSuaGiaTheoDon> {
  const truoc = quyetDinhGhiSuaGiaTheoDon({ soDuyet: input.soDuyet, keHoach: await docKeHoachSuaGiaTheoDon(c), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiSuaGiaTheoDonTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiSuaGiaTheoDonTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiSuaGiaTheoDon): Promise<KetQuaGhiSuaGiaTheoDon> {
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo): mọi đơn khoá học còn sống, dòng đơn của chúng, ghi danh của các học viên đó.
  await tx.$queryRaw`SELECT id FROM "Order" WHERE type::text = 'COURSE' AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE type::text = 'COURSE' AND "deletedAt" IS NULL) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`
    SELECT e.id FROM "Enrollment" e
    WHERE e."studentId" IN (SELECT "studentId" FROM "Order" WHERE type::text = 'COURSE' AND "deletedAt" IS NULL AND "studentId" IS NOT NULL)
    ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachSuaGiaTheoDon(tx);
  const loi = quyetDinhGhiSuaGiaTheoDon({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Không còn gì để ghi (chạy lại) ⇒ 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daGan: 0, daSuaHet: kh.keHoach.daSuaHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienSuaGiaTheoDon(tx, kh);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.suaGiaTheoDon, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «đang đúng trạng thái đã lập kế hoạch» trong `where`: lệch ⇒ THROW cả lô — không `continue`.
  let daGhi = 0;
  let daGan = 0;
  for (const g of kh.ghi) {
    if (g.gan !== null) {
      const hocVien = await tx.order.findUnique({ where: { id: g.orderId }, select: { studentId: true } });
      if (hocVien?.studentId == null) throw new Error(`Gắn dòng đơn ${g.code}: đơn không còn học viên — lùi cả lô.`);
      const l = await tx.orderItem.updateMany({
        where: { id: g.gan.orderItemId, orderId: g.orderId, type: "COURSE_ENROLLMENT", enrollmentId: null, studentId: hocVien.studentId },
        data: { enrollmentId: g.gan.enrollmentId },
      });
      if (l.count !== 1) throw new Error(`Gắn dòng đơn ${g.code}: dòng đơn không còn ở trạng thái chưa gắn lúc lập kế hoạch — lùi cả lô.`);
      daGan++;
      await writeAudit({
        actor: input.actor,
        module: "finance",
        entityType: "OrderItem",
        entityId: g.gan.orderItemId,
        action: HANH_DONG_GAN_DONG_THEO_DON,
        oldValues: { enrollmentId: null },
        newValues: { enrollmentId: g.gan.enrollmentId, orderCode: g.code },
        changedFields: ["enrollmentId"],
        reason: LY_DO_GAN_DONG_THEO_DON,
        orgUnitId: null,
        tx,
      });
    }
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
      action: HANH_DONG_SUA_GIA_THEO_DON,
      oldValues: { listPrice: g.truoc.listPrice, discountType: g.truoc.discountType, discountAmount: g.truoc.discountAmount, tuition: g.truoc.tuition, finalPrice: g.truoc.finalPrice },
      newValues: { listPrice: g.sau.listPrice, discountType, discountAmount, tuition, finalPrice, orderCode: g.code, ghiListPrice: g.ghiListPrice },
      changedFields: g.ghiListPrice ? ["listPrice", "discountType", "discountAmount", "finalPrice", "tuition"] : ["discountType", "discountAmount", "finalPrice", "tuition"],
      reason: LY_DO_SUA_GIA_THEO_DON,
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: không còn dòng nào để ghi, mọi đơn vừa ghi phải ra «đã ở giá đích», và không bất biến nào bị đổi.
  const sau = await docKeHoachSuaGiaTheoDon(tx);
  const maDaGhi = kh.ghi.map((g) => g.code);
  const chuaDung = maDaGhi.filter((m) => !sau.ketQuaBang.daDung.includes(m));
  if (sau.dung || sau.ghi.length !== 0 || chuaDung.length > 0) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «cả lô đã ở giá đích» (${sau.keHoach.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || `còn ${sau.ghi.length} dòng chưa đúng`}${chuaDung.length > 0 ? ` · chưa đúng: ${chuaDung.join(",")}` : ""}) — lùi cả lô.`);
  }
  // Cùng KẾ HOẠCH «trước» (cùng tập đơn / ghi danh / dòng được gắn) — kế hoạch «sau» đã rỗng nên không dùng để chụp.
  const anhSau = await anhChupBatBienSuaGiaTheoDon(tx, kh);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order · dòng đơn · Payment · ngân hàng · Receipt · hoá đơn · hoa hồng · Course · cột không phải giá của ghi danh) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction: có phép ghi thì có dấu vết, lùi thì lùi cùng.
  if (input.soDuyet === null) throw new Error("ghiSuaGiaTheoDonTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: ENTITY_LUOT_SUA_GIA_THEO_DON,
    entityId: khoaLuotChayWaveC(input.luotChay.nguonChay),
    action: HANH_DONG_SUA_GIA_THEO_DON_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay,
      soDuyet: input.soDuyet,
      soKeHoach: kh.ghi.length,
      daGhi,
      keHoachSha: kh.sha,
      chiTiet: { donDaSua: maDaGhi, soGanDong: daGan, soGhiListPrice: kh.ghi.filter((g) => g.ghiListPrice).length, noGiaTruoc: kh.keHoach.noGiaTruoc, noGiaSau: kh.keHoach.noGiaSau },
    }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy P7-A chuẩn hoá giá ghi danh theo đơn: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daGan, daSuaHet: true, keHoachSha: kh.sha };
}

/**
 * KIỂM SAU GHI (chỉ đọc): lượt ghi gần nhất có dấu vết; mọi đơn nó ghi nay ở giá đích; không còn dòng nào SẼ GHI trong phạm vi suy được từ các đơn đó; (báo cáo) số khoản của các đơn đó còn NULL ghi danh.
 * KHÔNG đòi «không có đơn ứng viên mới» — đơn mới đủ điều kiện sau này là việc của lượt chạy sau, có chữ ký riêng.
 */
export async function kiemSauGhiSuaGiaTheoDon(
  c: KhachSuaGiaTheoDon,
): Promise<{ keHoach: KeHoachSuaGiaTheoDon; luotCuoi: { entityId: string; donDaSua: string[] } | null; chuaDung: string[]; conSeGhi: number; khoanChuaGanGhiDanh: number }> {
  const keHoach = await docKeHoachSuaGiaTheoDon(c);
  const luot = await c.auditLog.findFirst({ where: { entityType: ENTITY_LUOT_SUA_GIA_THEO_DON, action: HANH_DONG_SUA_GIA_THEO_DON_LUOT }, orderBy: { createdAt: "desc" }, select: { entityId: true, newValues: true } });
  const nv = (luot?.newValues ?? null) as { donDaSua?: unknown } | null;
  const donDaSua = Array.isArray(nv?.donDaSua) ? (nv.donDaSua as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const luotCuoi = luot === null ? null : { entityId: luot.entityId, donDaSua };
  const chuaDung = donDaSua.filter((m) => !keHoach.ketQuaBang.daDung.includes(m));
  const conSeGhi = keHoach.ghi.filter((g) => donDaSua.includes(g.code)).length;
  const khoanChuaGanGhiDanh = donDaSua.length === 0 ? 0 : await c.payment.count({ where: { order: { code: { in: donDaSua } }, deletedAt: null, enrollmentId: null } });
  return { keHoach, luotCuoi, chuaDung, conSeGhi, khoanChuaGanGhiDanh };
}
