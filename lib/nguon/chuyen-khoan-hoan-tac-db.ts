// lib/nguon/chuyen-khoan-hoan-tac-db.ts — TẦNG DB của «HOÀN TÁC sau COMMIT» cho P7-B v2. Lõi quyết định: `chuyen-khoan-hoan-tac.ts` (thuần).
//
// Cùng khuôn với `chuyen-khoan-ghi-danh-db.ts`: khoá (`FOR UPDATE`, chỉ hàng của cặp được chọn) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt → trả sớm khi không còn gì → ảnh chụp «trước» → cổng Wave 1 RIÊNG
// (workflow `chuyen-khoan-ghi-danh-hoan-tac`) → claim nonce (phép ghi ĐẦU TIÊN) → ghi có điều kiện (lệch ⇒ throw) + audit → ảnh chụp «sau» = «trước» → audit mức lượt.
// Nguồn sự thật của «trước lượt ghi» là NHẬT KÝ (AuditLog `ChuyenKhoanGhiDanh`, cùng transaction với lượt ghi): không có nhật ký ⇒ không hoàn tác.
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { dungBanGhiLuotWaveC, khoaLuotChayWaveC, quyetDinhGhiWaveC, type LuotChayWaveC } from "./wave-c-chung";
import type { GiaGhiDanh } from "./wave-c-sua-gia-ghi-danh";
import { ENTITY_LUOT_CHUYEN_KHOAN, GIA_TRONG, HANH_DONG_CHUYEN_KHOAN_LUOT, cungGiaChuyen, type GhiDanhChuyen } from "./chuyen-khoan-ghi-danh";
import { anhChupBatBienChuyenKhoan, type KhachChuyenKhoan } from "./chuyen-khoan-ghi-danh-db";
import {
  ENTITY_LUOT_HOAN_TAC,
  HANH_DONG_HOAN_TAC_GIA,
  HANH_DONG_HOAN_TAC_KHOAN,
  HANH_DONG_HOAN_TAC_LUOT,
  LY_DO_HOAN_TAC,
  lapKeHoachHoanTac,
  type CapHoanTac,
  type CapTrongNhatKy,
  type KeHoachHoanTac,
  type TrangThaiHoanTac,
} from "./chuyen-khoan-hoan-tac";

export const ACTOR_HOAN_TAC = { id: null, name: "Script P7-B v2 hoàn tác chuyển khoản và giá (chuyen-khoan-hoan-tac)" } as const;

export function quyetDinhGhiHoanTac(i: { soDuyet: number | null; keHoach: KeHoachHoanTac; ghiDuoc: boolean | null }): string | null {
  return quyetDinhGhiWaveC({
    soDuyet: i.soDuyet,
    dung: i.keHoach.dung,
    loiTomTat: i.keHoach.loiLo.map((x) => `${x.cuId}:${x.ma}`),
    soGhi: i.keHoach.ghi.length,
    ghiDuoc: i.ghiDuoc,
    tenBang: "Enrollment",
    donViDem: "CẶP GHI DANH",
  });
}

const SEL_ENR = { id: true, studentId: true, courseId: true, centerId: true, status: true, deletedAt: true, transferredToId: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } as const;
type EnrRow = { id: string; studentId: string; courseId: string | null; centerId: string | null; status: string; deletedAt: Date | null; transferredToId: string | null; listPrice: number | null; discountType: string | null; discountAmount: number | null; tuition: number | null; finalPrice: number | null };
const gia = (e: Pick<EnrRow, "listPrice" | "discountType" | "discountAmount" | "tuition" | "finalPrice">): GiaGhiDanh => ({
  listPrice: e.listPrice, discountType: e.discountType, discountAmount: e.discountAmount, tuition: e.tuition, finalPrice: e.finalPrice,
});
const toGD = (e: EnrRow): GhiDanhChuyen => ({ id: e.id, studentId: e.studentId, courseId: e.courseId, centerId: e.centerId, status: e.status, deletedAt: e.deletedAt, transferredToId: e.transferredToId, gia: gia(e) });

type NhatKyRaw = { chiTiet?: { cap?: unknown }; cap?: unknown } | null;
const laCapGhi = (x: unknown): x is Omit<CapTrongNhatKy, "luotKhoa"> & { cu: string; moi: string } => {
  const o = x as Record<string, unknown> | null;
  return !!o && typeof o.cu === "string" && typeof o.moi === "string" && Array.isArray(o.khoan) && typeof o.tongTien === "number" && !!o.giaCu && !!o.giaMoi;
};

/**
 * ĐỌC nhật ký: với mỗi cặp trong `cap`, lượt ghi GẦN NHẤT chứa đúng cặp đó, kèm thời điểm; và có bản ghi hoàn tác MỚI HƠN hay không. Hai câu đọc cố định (không theo số cặp).
 */
export async function docNhatKyGhiCap(c: KhachChuyenKhoan, cap: readonly CapHoanTac[]): Promise<{ nhatKy: Map<string, CapTrongNhatKy>; daHoanTac: Set<string> }> {
  const luot = await c.auditLog.findMany({
    where: { entityType: ENTITY_LUOT_CHUYEN_KHOAN, action: HANH_DONG_CHUYEN_KHOAN_LUOT },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entityId: true, createdAt: true, newValues: true },
  });
  const hoan = await c.auditLog.findMany({
    where: { entityType: ENTITY_LUOT_HOAN_TAC, action: HANH_DONG_HOAN_TAC_LUOT },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, newValues: true },
  });
  const nhatKy = new Map<string, CapTrongNhatKy>();
  const thoiDiem = new Map<string, Date>();
  for (const l of luot) {
    const nv = (l.newValues ?? null) as NhatKyRaw;
    const ds = nv?.chiTiet?.cap ?? nv?.cap;
    if (!Array.isArray(ds)) continue;
    for (const p of ds) {
      if (!laCapGhi(p)) continue;
      const khoa = `${p.cu}>${p.moi}`;
      if (nhatKy.has(khoa)) continue; // đã sắp mới → cũ: lượt đầu gặp là gần nhất
      nhatKy.set(khoa, { luotKhoa: l.entityId, cu: p.cu, moi: p.moi, khoan: p.khoan as string[], tongTien: p.tongTien, giaCu: p.giaCu as GiaGhiDanh, giaMoi: p.giaMoi as GiaGhiDanh });
      thoiDiem.set(khoa, l.createdAt);
    }
  }
  const daHoanTac = new Set<string>();
  for (const h of hoan) {
    const nv = (h.newValues ?? null) as NhatKyRaw;
    const ds = nv?.chiTiet?.cap ?? nv?.cap;
    if (!Array.isArray(ds)) continue;
    for (const p of ds as { cu?: unknown; moi?: unknown }[]) {
      if (typeof p.cu !== "string" || typeof p.moi !== "string") continue;
      const khoa = `${p.cu}>${p.moi}`;
      const t = thoiDiem.get(khoa);
      if (t !== undefined && h.createdAt.getTime() >= t.getTime()) daHoanTac.add(khoa);
    }
  }
  // chỉ trả đúng cặp được yêu cầu
  const can = new Set(cap.map((x) => `${x.cuId}>${x.moiId}`));
  for (const k of [...nhatKy.keys()]) if (!can.has(k)) nhatKy.delete(k);
  return { nhatKy, daHoanTac };
}

export async function docKeHoachHoanTac(c: KhachChuyenKhoan, cap: readonly CapHoanTac[]): Promise<KeHoachHoanTac> {
  if (cap.length === 0) return lapKeHoachHoanTac([], new Map(), new Map());
  const { nhatKy, daHoanTac } = await docNhatKyGhiCap(c, cap);
  const cuIds = cap.map((x) => x.cuId);
  const moiIds = cap.map((x) => x.moiId);
  const tat = [...cuIds, ...moiIds];
  const [enrs, khoanMoi, khoanCu, bl, hh, hoan, bao] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: tat } }, select: SEL_ENR }),
    c.payment.findMany({
      where: { deletedAt: null, enrollmentId: { in: moiIds } },
      select: { id: true, enrollmentId: true, amount: true, paymentType: true, saleStatus: true, accountantStatus: true, adjustmentOfId: true },
      orderBy: { id: "asc" },
    }),
    c.payment.groupBy({ by: ["enrollmentId"], where: { deletedAt: null, enrollmentId: { in: cuIds } }, _count: { _all: true } }),
    c.receipt.groupBy({ by: ["enrollmentId"], where: { deletedAt: null, enrollmentId: { in: moiIds } }, _count: { _all: true } }),
    c.commissionLine.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: moiIds } }, _count: { _all: true } }),
    c.refundRequest.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: moiIds } }, _count: { _all: true } }),
    c.studentReserve.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: moiIds } }, _count: { _all: true } }),
  ]);
  const dem = (rows: { enrollmentId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.enrollmentId === id)?._count._all ?? 0;
  const tt = new Map<string, TrangThaiHoanTac>();
  for (const y of cap) {
    const cu = enrs.find((e) => e.id === y.cuId);
    const moi = enrs.find((e) => e.id === y.moiId);
    if (!cu || !moi) continue;
    tt.set(y.cuId, {
      cu: toGD(cu),
      moi: toGD(moi),
      khoanMoi: khoanMoi.filter((k) => k.enrollmentId === moi.id).map((k) => ({ id: k.id, amount: k.amount, paymentType: k.paymentType, saleStatus: k.saleStatus, accountantStatus: k.accountantStatus, adjustmentOfId: k.adjustmentOfId })),
      soKhoanSongCu: dem(khoanCu, cu.id),
      moiCo: { bienLai: dem(bl, moi.id), hoaHong: dem(hh, moi.id), hoanTien: dem(hoan, moi.id), baoLuu: dem(bao, moi.id) },
      daHoanTac: daHoanTac.has(`${y.cuId}>${y.moiId}`),
    });
  }
  return lapKeHoachHoanTac(cap, nhatKy, tt);
}

export type DauVaoGhiHoanTac = {
  cap: readonly CapHoanTac[];
  soDuyet: number | null;
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiHoanTac = { soCap: number; soKhoan: number; keHoachSha: string };

export async function ghiHoanTac(c: PrismaClient, input: DauVaoGhiHoanTac): Promise<KetQuaGhiHoanTac> {
  const truoc = quyetDinhGhiHoanTac({ soDuyet: input.soDuyet, keHoach: await docKeHoachHoanTac(c, input.cap), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiHoanTacTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

export async function ghiHoanTacTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiHoanTac): Promise<KetQuaGhiHoanTac> {
  const cuIds = input.cap.map((x) => x.cuId);
  const moiIds = input.cap.map((x) => x.moiId);
  // 1) KHOÁ, CHỈ hàng của cặp được chọn, theo thứ tự cố định: khoản thu sống của ghi danh MỚI → hai ghi danh.
  await tx.$queryRaw`SELECT p.id FROM "Payment" p WHERE p."deletedAt" IS NULL AND (p."enrollmentId" = ANY(${moiIds}::text[]) OR p."enrollmentId" = ANY(${cuIds}::text[])) ORDER BY p.id FOR UPDATE OF p`;
  await tx.$queryRaw`SELECT e.id FROM "Enrollment" e WHERE e.id = ANY(${cuIds}::text[]) OR e.id = ANY(${moiIds}::text[]) ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt.
  const kh = await docKeHoachHoanTac(tx, input.cap);
  const loi = quyetDinhGhiHoanTac({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);
  if (kh.ghi.length === 0) return { soCap: 0, soKhoan: 0, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước» (cùng hàm với lệnh chuyển: trừ Payment.enrollmentId/updatedAt của khoản được dời và năm cột giá).
  const truoc = await anhChupBatBienChuyenKhoan(tx, kh);

  // 4) CỔNG WAVE 1 RIÊNG — TRƯỚC phép ghi đầu tiên; claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.chuyenKhoanGhiDanhHoanTac, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI ngược. Mọi điều kiện «đang đúng trạng thái sau lượt ghi» nằm trong `where`: lệch ⇒ THROW cả lô.
  let soKhoan = 0;
  for (const g of kh.ghi) {
    const r = await tx.payment.updateMany({
      where: { id: { in: [...g.khoanIds] }, enrollmentId: g.moiId, ...KHOAN_DA_XAC_NHAN, paymentType: "PAYMENT", adjustmentOfId: null },
      data: { enrollmentId: g.cuId },
    });
    if (r.count !== g.khoanIds.length) throw new Error(`Hoàn tác khoản ${g.moiId}→${g.cuId}: đổi ${r.count}/${g.khoanIds.length} khoản — trạng thái không còn như lúc lập kế hoạch — lùi cả lô.`);
    soKhoan += r.count;
    for (const id of g.khoanIds) {
      await writeAudit({
        actor: input.actor, module: "finance", entityType: "Payment", entityId: id, action: HANH_DONG_HOAN_TAC_KHOAN,
        oldValues: { enrollmentId: g.moiId }, newValues: { enrollmentId: g.cuId }, changedFields: ["enrollmentId"], reason: LY_DO_HOAN_TAC, orgUnitId: null, tx,
      });
    }
    const moi = await tx.enrollment.updateMany({
      where: { id: g.moiId, deletedAt: null, listPrice: g.giaMoiHienTai.listPrice, discountType: g.giaMoiHienTai.discountType, discountAmount: g.giaMoiHienTai.discountAmount, tuition: g.giaMoiHienTai.tuition, finalPrice: g.giaMoiHienTai.finalPrice },
      data: { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null },
    });
    if (moi.count !== 1) throw new Error(`Hoàn tác giá ${g.moiId}→${g.cuId}: giá ghi danh mới không còn đúng snapshot — lùi cả lô.`);
    const cu = await tx.enrollment.updateMany({
      where: { id: g.cuId, deletedAt: null, listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null },
      data: { listPrice: g.giaCuKhoiPhuc.listPrice, discountType: g.giaCuKhoiPhuc.discountType, discountAmount: g.giaCuKhoiPhuc.discountAmount, tuition: g.giaCuKhoiPhuc.tuition, finalPrice: g.giaCuKhoiPhuc.finalPrice },
    });
    if (cu.count !== 1) throw new Error(`Hoàn tác giá ${g.moiId}→${g.cuId}: ghi danh cũ không còn trống giá — lùi cả lô.`);
    for (const [id, cu0, moi0] of [[g.moiId, g.giaMoiHienTai, GIA_TRONG], [g.cuId, GIA_TRONG, g.giaCuKhoiPhuc]] as const) {
      await writeAudit({
        actor: input.actor, module: "finance", entityType: "Enrollment", entityId: id, action: HANH_DONG_HOAN_TAC_GIA,
        oldValues: cu0, newValues: moi0, changedFields: ["listPrice", "discountType", "discountAmount", "tuition", "finalPrice"], reason: LY_DO_HOAN_TAC, orgUnitId: null, tx,
      });
    }
  }

  // 6) ĐỌC LẠI: từng cặp đúng trạng thái TRƯỚC lượt ghi.
  for (const g of kh.ghi) {
    const [moi, cu, nCu, nMoi] = await Promise.all([
      tx.enrollment.findUniqueOrThrow({ where: { id: g.moiId }, select: SEL_ENR }),
      tx.enrollment.findUniqueOrThrow({ where: { id: g.cuId }, select: SEL_ENR }),
      tx.payment.count({ where: { id: { in: [...g.khoanIds] }, enrollmentId: g.cuId, deletedAt: null } }),
      tx.payment.count({ where: { enrollmentId: g.moiId, deletedAt: null } }),
    ]);
    if (!cungGiaChuyen(gia(moi), GIA_TRONG) || !cungGiaChuyen(gia(cu), g.giaCuKhoiPhuc) || nCu !== g.khoanIds.length || nMoi !== 0) {
      throw new Error(`Sau hoàn tác, cặp ${g.cuId}→${g.moiId} chưa về trạng thái trước lượt ghi — lùi cả lô.`);
    }
  }
  const anhSau = await anhChupBatBienChuyenKhoan(tx, kh);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến ĐỔI sau hoàn tác (Order · dòng đơn · Payment trừ enrollmentId · ngân hàng · Receipt · hoá đơn · hoa hồng · hoàn tiền · bảo lưu · quyền học · Enrollment trừ cột giá) — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction; `cap` để nhật ký biết cặp nào đã hoàn tác (cặp đó không hoàn tác lần hai).
  if (input.soDuyet === null) throw new Error("ghiHoanTacTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor, module: "finance", entityType: ENTITY_LUOT_HOAN_TAC, entityId: khoaLuotChayWaveC(input.luotChay.nguonChay), action: HANH_DONG_HOAN_TAC_LUOT, oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay, soDuyet: input.soDuyet, soKeHoach: kh.ghi.length, daGhi: kh.ghi.length, keHoachSha: kh.sha,
      chiTiet: { cap: kh.ghi.map((g) => ({ cu: g.cuId, moi: g.moiId, khoan: g.khoanIds, tuLuot: g.luotKhoa })), soKhoan },
    }),
    changedFields: ["expectedCount", "actualCount"], reason: "Lượt HOÀN TÁC P7-B v2: người bấm · số đã duyệt · số thực ghi", tx,
  });
  return { soCap: kh.ghi.length, soKhoan, keHoachSha: kh.sha };
}
