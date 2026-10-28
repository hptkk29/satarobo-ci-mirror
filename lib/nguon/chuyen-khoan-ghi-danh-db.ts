// lib/nguon/chuyen-khoan-ghi-danh-db.ts — TẦNG DB của «P7-B · khoản thu và giá đi theo ghi danh đang học» (nhóm G2, 26/10/2026). Lõi quyết định: `chuyen-khoan-ghi-danh.ts` (thuần).
//
// ── QUY ƯỚC ───────────────────────────────────────────────────────────────────────────────────────────────
//   · Mọi hàm nhận client làm tham số BẮT BUỘC; KHÔNG có tham số nào đưa mã/id vào: ứng viên do QUY TẮC dò từ DB (ghi danh đã đóng còn giữ khoản thu sống), đơn trượt quy tắc bị loại.
//   · Số câu đọc CỐ ĐỊNH, không theo số ứng viên.
//
// ── PHÉP GHI: HAI bảng, MỖI phép một `updateMany` CÓ ĐIỀU KIỆN ───────────────────────────────────────────────
//   · Payment.enrollmentId (ghi danh cũ → ghi danh mới) — `where` đòi đang gắn ghi danh cũ, PAYMENT đã xác nhận (`KHOAN_DA_XAC_NHAN`, chưa xoá), không điều chỉnh; số dòng đổi PHẢI bằng số khoản đã ký (`saleStatus` do kế hoạch thuần kiểm lại dưới khoá hàng);
//   · Enrollment: năm cột giá của ghi danh MỚI (CẢ NĂM NULL → giá cũ) và của ghi danh CŨ (giá cũ → CẢ NĂM NULL) — `where` đòi đang đúng snapshot.
//   KHÔNG Order, OrderItem, Receipt, hoá đơn điện tử, hoa hồng, ngân hàng, số tiền/trạng thái/ngày thu của Payment. Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến» chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi
//   cuối; khác nhau một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ (lưới `[CKG-W*]` canh) ───────────────────────────────────────────────────────────────────────────
//   khoá Payment → Enrollment (`FOR UPDATE`) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt → trả sớm khi không còn gì (KHÔNG cổng, KHÔNG claim) → ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN) →
//   chuyển khoản + chuyển giá (lệch ⇒ throw) + audit → đọc lại phải ra «không còn gì để chuyển» và đúng trạng thái đích → ảnh chụp «sau» = «trước» → audit mức lượt.
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { dungBanGhiLuotWaveC, khoaLuotChayWaveC, quyetDinhGhiWaveC, type LuotChayWaveC } from "./wave-c-chung";
import {
  ENTITY_LUOT_CHUYEN_KHOAN,
  GIA_TRONG,
  HANH_DONG_CHUYEN_GIA,
  HANH_DONG_CHUYEN_KHOAN,
  HANH_DONG_CHUYEN_KHOAN_LUOT,
  LY_DO_CHUYEN_KHOAN,
  TRANG_THAI_GHI_DANH_DONG,
  cungGiaChuyen,
  lapKeHoachChuyenKhoan,
  type GhiDanhChuyen,
  type KeHoachChuyenKhoan,
  type KhoanChuyen,
  type UngVienChuyen,
} from "./chuyen-khoan-ghi-danh";

export type KhachChuyenKhoan = PrismaClient | Prisma.TransactionClient;

export const ACTOR_CHUYEN_KHOAN = { id: null, name: "Script P7-B khoản thu và giá đi theo ghi danh đang học (chuyen-khoan-ghi-danh)" } as const;

export function quyetDinhGhiChuyenKhoan(i: { soDuyet: number | null; keHoach: KeHoachChuyenKhoan; ghiDuoc: boolean | null }): string | null {
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

const gia = (e: { listPrice: number | null; discountType: string | null; discountAmount: number | null; tuition: number | null; finalPrice: number | null }) => ({
  listPrice: e.listPrice, discountType: e.discountType, discountAmount: e.discountAmount, tuition: e.tuition, finalPrice: e.finalPrice,
});
const SEL_ENR = { id: true, studentId: true, courseId: true, centerId: true, status: true, deletedAt: true, transferredToId: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } as const;
type EnrRow = { id: string; studentId: string; courseId: string | null; centerId: string | null; status: string; deletedAt: Date | null; transferredToId: string | null; listPrice: number | null; discountType: string | null; discountAmount: number | null; tuition: number | null; finalPrice: number | null };
const toGD = (e: EnrRow): GhiDanhChuyen => ({ id: e.id, studentId: e.studentId, courseId: e.courseId, centerId: e.centerId, status: e.status, deletedAt: e.deletedAt, transferredToId: e.transferredToId, gia: gia(e) });

/** ĐỌC ứng viên: ghi danh ĐÃ ĐÓNG còn giữ ít nhất một khoản thu sống. Cố định 9 câu. */
export async function docUngVienChuyen(c: KhachChuyenKhoan): Promise<UngVienChuyen[]> {
  const khoan = await c.payment.findMany({
    where: { deletedAt: null, enrollmentId: { not: null }, enrollment: { status: { in: [...TRANG_THAI_GHI_DANH_DONG] }, deletedAt: null } },
    select: { id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true, paidDate: true, paymentType: true, saleStatus: true, accountantStatus: true, adjustmentOfId: true },
    orderBy: { id: "asc" },
  });
  const cuIds = [...new Set(khoan.map((k) => k.enrollmentId as string))];
  const donIds = [...new Set(khoan.map((k) => k.orderId))];
  const dongIds = [...new Set(khoan.flatMap((k) => (k.orderItemId ? [k.orderItemId] : [])))];
  const [cuRows, dongDon, dongCuaDon] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: cuIds } }, select: SEL_ENR }),
    c.orderItem.findMany({ where: { id: { in: dongIds } }, select: { id: true, enrollmentId: true } }),
    c.orderItem.findMany({ where: { orderId: { in: donIds }, type: "COURSE_ENROLLMENT" }, select: { id: true, orderId: true, enrollmentId: true } }),
  ]);
  const dongCuaDonTheo = new Map<string, { id: string; enrollmentId: string | null }[]>();
  for (const d of dongCuaDon) dongCuaDonTheo.set(d.orderId, [...(dongCuaDonTheo.get(d.orderId) ?? []), d]);

  const r1Cua = new Map<string, Set<string>>();
  const khoanTheoCu = new Map<string, KhoanChuyen[]>();
  for (const k of khoan) {
    const cu = k.enrollmentId as string;
    const dong = k.orderItemId ? dongDon.find((d) => d.id === k.orderItemId) ?? null : null;
    // R1: dòng đơn của khoản; nếu khoản không gắn dòng thì chỉ nhận khi đơn có ĐÚNG MỘT dòng khoá học.
    const donDong = dongCuaDonTheo.get(k.orderId) ?? [];
    const diem = dong !== null ? dong.enrollmentId : donDong.length === 1 ? donDong[0]!.enrollmentId : null;
    if (diem !== null && diem !== cu) r1Cua.set(cu, (r1Cua.get(cu) ?? new Set()).add(diem));
    khoanTheoCu.set(cu, [
      ...(khoanTheoCu.get(cu) ?? []),
      {
        id: k.id, orderId: k.orderId, amount: k.amount, paidDate: k.paidDate, paymentType: k.paymentType, saleStatus: k.saleStatus, accountantStatus: k.accountantStatus, adjustmentOfId: k.adjustmentOfId,
        dongDonTroToi: dong === null ? null : dong.enrollmentId, coDongDon: dong !== null,
      },
    ]);
  }
  const moiIds = [...new Set([...cuRows.flatMap((e) => (e.transferredToId ? [e.transferredToId] : [])), ...[...r1Cua.values()].flatMap((s) => [...s])])];
  const tatCa = [...new Set([...cuIds, ...moiIds])];
  const [moiRows, khoanMoiDem, bienLai, hoaHong, hoanTien, baoLuu] = await Promise.all([
    c.enrollment.findMany({ where: { id: { in: moiIds } }, select: SEL_ENR }),
    c.payment.groupBy({ by: ["enrollmentId"], where: { deletedAt: null, enrollmentId: { in: moiIds } }, _count: { _all: true } }),
    c.receipt.groupBy({ by: ["enrollmentId"], where: { deletedAt: null, enrollmentId: { in: tatCa } }, _count: { _all: true } }),
    c.commissionLine.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: tatCa } }, _count: { _all: true } }),
    c.refundRequest.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: tatCa } }, _count: { _all: true } }),
    c.studentReserve.groupBy({ by: ["enrollmentId"], where: { enrollmentId: { in: tatCa } }, _count: { _all: true } }),
  ]);
  const dem = (rows: { enrollmentId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.enrollmentId === id)?._count._all ?? 0;
  const co = (id: string) => ({ bienLai: dem(bienLai, id), hoaHong: dem(hoaHong, id), hoanTien: dem(hoanTien, id), baoLuu: dem(baoLuu, id) });

  return cuRows
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e): UngVienChuyen => {
      const r1 = [...(r1Cua.get(e.id) ?? [])];
      const dich = new Set<string>([...r1, ...(e.transferredToId ? [e.transferredToId] : [])]);
      const moiId = dich.size === 1 ? [...dich][0]! : null;
      const moi = moiId === null ? null : moiRows.find((m) => m.id === moiId) ?? null;
      return {
        cu: toGD(e),
        r1,
        r2: e.transferredToId,
        moi: moi === null ? null : toGD(moi),
        khoanCu: khoanTheoCu.get(e.id) ?? [],
        khoanMoi: moi === null ? 0 : dem(khoanMoiDem, moi.id),
        moiCo: moi === null ? { bienLai: 0, hoaHong: 0, hoanTien: 0, baoLuu: 0 } : co(moi.id),
        cuCo: co(e.id),
      };
    });
}

export async function docKeHoachChuyenKhoan(c: KhachChuyenKhoan): Promise<KeHoachChuyenKhoan> {
  return lapKeHoachChuyenKhoan(await docUngVienChuyen(c));
}

const boKhoa = <T extends Record<string, unknown>>(o: T, ...khoa: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !khoa.includes(k)));
export const COT_GIA_CHUYEN = ["listPrice", "discountType", "discountAmount", "tuition", "finalPrice", "updatedAt"] as const;

/**
 * ẢNH CHỤP BẤT BIẾN của đúng phạm vi kế hoạch: Order + dòng đơn (MỌI cột) · MỌI Payment của các đơn (cả đã xoá; TRỪ `enrollmentId` + `updatedAt` của đúng các khoản được chuyển) · phân bổ + giao dịch ngân hàng · Receipt ·
 * hoá đơn điện tử · hoa hồng (NỘI DUNG dòng) · yêu cầu hoàn · bảo lưu · Enrollment của cả hai phía (MỌI cột TRỪ năm cột giá + `updatedAt`). Tập đơn / khoản / ghi danh lấy từ KẾ HOẠCH nên không đổi giữa «trước» và «sau».
 */
export async function anhChupBatBienChuyenKhoan(c: KhachChuyenKhoan, kh: KeHoachChuyenKhoan): Promise<string> {
  const khoanIds = new Set(kh.ghi.flatMap((g) => g.khoanIds));
  const enrIds = [...new Set(kh.ghi.flatMap((g) => [g.cuId, g.moiId]))];
  const donTho = await c.payment.findMany({ where: { id: { in: [...khoanIds] } }, select: { orderId: true } });
  const orderIds = [...new Set(donTho.map((p) => p.orderId))];
  const [orders, paymentsTho, ghiDanhTho, phanBo, nganHang, hoaDonKhoan, bienLai, hhLine, hhTrx, hoan, baoLuu, thuc] = await Promise.all([
    c.order.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } }),
    c.payment.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    c.enrollment.findMany({ where: { id: { in: enrIds } }, orderBy: { id: "asc" } }),
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
    c.receipt.findMany({ where: { OR: [{ paymentId: { in: [...khoanIds] } }, { enrollmentId: { in: enrIds } }] }, orderBy: { id: "asc" } }),
    c.commissionLine.findMany({ where: { enrollmentId: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.commissionTransaction.findMany({ where: { orderId: { in: orderIds } }, orderBy: { id: "asc" } }),
    c.refundRequest.findMany({ where: { enrollmentId: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.studentReserve.findMany({ where: { enrollmentId: { in: enrIds } }, orderBy: { id: "asc" } }),
    c.studyEntitlement.findMany({ where: { enrollmentId: { in: enrIds } }, orderBy: { id: "asc" } }),
  ]);
  const payments = paymentsTho.map((p) => (khoanIds.has(p.id) ? boKhoa(p, "enrollmentId", "updatedAt") : p));
  const ghiDanh = ghiDanhTho.map((e) => boKhoa(e, ...COT_GIA_CHUYEN));
  return createHash("sha256")
    .update(JSON.stringify({ orders, payments, ghiDanh, phanBo, nganHang, hoaDonKhoan, bienLai, hhLine, hhTrx, hoan, baoLuu, thuc }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), "utf8")
    .digest("hex");
}

export type DauVaoGhiChuyenKhoan = {
  soDuyet: number | null;
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiChuyenKhoan = { soCap: number; soKhoan: number; keHoachSha: string };

export async function ghiChuyenKhoan(c: PrismaClient, input: DauVaoGhiChuyenKhoan): Promise<KetQuaGhiChuyenKhoan> {
  const truoc = quyetDinhGhiChuyenKhoan({ soDuyet: input.soDuyet, keHoach: await docKeHoachChuyenKhoan(c), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiChuyenKhoanTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

export async function ghiChuyenKhoanTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiChuyenKhoan): Promise<KetQuaGhiChuyenKhoan> {
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định: khoản thu sống gắn ghi danh đã đóng → ghi danh (cả đóng lẫn đích ứng viên).
  await tx.$queryRaw`
    SELECT p.id FROM "Payment" p JOIN "Enrollment" e ON e.id = p."enrollmentId"
    WHERE p."deletedAt" IS NULL AND e.status::text IN ('WITHDREW','TRANSFERRED','CANCELLED') AND e."deletedAt" IS NULL ORDER BY p.id FOR UPDATE OF p`;
  await tx.$queryRaw`
    SELECT e.id FROM "Enrollment" e
    WHERE e.id IN (SELECT p."enrollmentId" FROM "Payment" p JOIN "Enrollment" e2 ON e2.id = p."enrollmentId" WHERE p."deletedAt" IS NULL AND e2.status::text IN ('WITHDREW','TRANSFERRED','CANCELLED') AND e2."deletedAt" IS NULL)
       OR e.id IN (SELECT e3."transferredToId" FROM "Enrollment" e3 WHERE e3."transferredToId" IS NOT NULL AND e3.status::text IN ('WITHDREW','TRANSFERRED','CANCELLED'))
       OR e.id IN (SELECT oi."enrollmentId" FROM "OrderItem" oi WHERE oi."enrollmentId" IS NOT NULL AND oi."orderId" IN (SELECT p2."orderId" FROM "Payment" p2 JOIN "Enrollment" e4 ON e4.id = p2."enrollmentId" WHERE p2."deletedAt" IS NULL AND e4.status::text IN ('WITHDREW','TRANSFERRED','CANCELLED')))
    ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachChuyenKhoan(tx);
  const loi = quyetDinhGhiChuyenKhoan({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Không còn gì để chuyển (chạy lại) ⇒ 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { soCap: 0, soKhoan: 0, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienChuyenKhoan(tx, kh);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.chuyenKhoanGhiDanh, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Mọi điều kiện «đang đúng trạng thái đã lập kế hoạch» nằm trong `where`: lệch ⇒ THROW cả lô — không `continue`.
  let soKhoan = 0;
  for (const g of kh.ghi) {
    const r = await tx.payment.updateMany({
      where: { id: { in: [...g.khoanIds] }, enrollmentId: g.cuId, ...KHOAN_DA_XAC_NHAN, paymentType: "PAYMENT", adjustmentOfId: null },
      data: { enrollmentId: g.moiId },
    });
    if (r.count !== g.khoanIds.length) throw new Error(`Chuyển khoản ${g.cuId}→${g.moiId}: đổi ${r.count}/${g.khoanIds.length} khoản — trạng thái không còn như lúc lập kế hoạch — lùi cả lô.`);
    soKhoan += r.count;
    for (const id of g.khoanIds) {
      await writeAudit({
        actor: input.actor, module: "finance", entityType: "Payment", entityId: id, action: HANH_DONG_CHUYEN_KHOAN,
        oldValues: { enrollmentId: g.cuId }, newValues: { enrollmentId: g.moiId, orderCode: g.code }, changedFields: ["enrollmentId"], reason: LY_DO_CHUYEN_KHOAN, orgUnitId: null, tx,
      });
    }

    const moi = await tx.enrollment.updateMany({
      where: { id: g.moiId, deletedAt: null, listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null },
      data: { listPrice: g.giaCu.listPrice, discountType: g.giaCu.discountType, discountAmount: g.giaCu.discountAmount, tuition: g.giaCu.tuition, finalPrice: g.giaCu.finalPrice },
    });
    if (moi.count !== 1) throw new Error(`Chuyển giá ${g.cuId}→${g.moiId}: ghi danh mới không còn trống giá lúc lập kế hoạch — lùi cả lô.`);
    const cu = await tx.enrollment.updateMany({
      where: { id: g.cuId, deletedAt: null, listPrice: g.giaCu.listPrice, discountType: g.giaCu.discountType, discountAmount: g.giaCu.discountAmount, tuition: g.giaCu.tuition, finalPrice: g.giaCu.finalPrice },
      data: { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null },
    });
    if (cu.count !== 1) throw new Error(`Chuyển giá ${g.cuId}→${g.moiId}: giá ghi danh cũ không còn đúng snapshot lúc lập kế hoạch — lùi cả lô.`);
    for (const [id, cu0, moi0] of [[g.cuId, g.giaCu, GIA_TRONG], [g.moiId, GIA_TRONG, g.giaCu]] as const) {
      await writeAudit({
        actor: input.actor, module: "finance", entityType: "Enrollment", entityId: id, action: HANH_DONG_CHUYEN_GIA,
        oldValues: cu0, newValues: moi0, changedFields: ["listPrice", "discountType", "discountAmount", "tuition", "finalPrice"], reason: LY_DO_CHUYEN_KHOAN, orgUnitId: null, tx,
      });
    }
  }

  // 6) ĐỌC LẠI: không còn cặp nào để chuyển, và từng cặp đúng trạng thái đích.
  const sau = await docKeHoachChuyenKhoan(tx);
  if (sau.dung || sau.ghi.length !== 0) throw new Error(`Sau khi ghi, kế hoạch không ra «không còn gì để chuyển» (${sau.loiLo.map((x) => `${x.cuId}:${x.ma}`).join(" · ") || `còn ${sau.ghi.length} cặp`}) — lùi cả lô.`);
  for (const g of kh.ghi) {
    const [moi, cu, n] = await Promise.all([
      tx.enrollment.findUniqueOrThrow({ where: { id: g.moiId }, select: SEL_ENR }),
      tx.enrollment.findUniqueOrThrow({ where: { id: g.cuId }, select: SEL_ENR }),
      tx.payment.count({ where: { id: { in: [...g.khoanIds] }, enrollmentId: g.moiId, deletedAt: null } }),
    ]);
    if (!cungGiaChuyen(gia(moi), g.giaCu) || !cungGiaChuyen(gia(cu), GIA_TRONG) || n !== g.khoanIds.length) throw new Error(`Sau khi ghi, cặp ${g.cuId}→${g.moiId} chưa đúng trạng thái đích — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienChuyenKhoan(tx, kh);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order · dòng đơn · Payment trừ enrollmentId · ngân hàng · Receipt · hoá đơn · hoa hồng · hoàn tiền · bảo lưu · quyền học · Enrollment trừ cột giá) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction.
  if (input.soDuyet === null) throw new Error("ghiChuyenKhoanTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor, module: "finance", entityType: ENTITY_LUOT_CHUYEN_KHOAN, entityId: khoaLuotChayWaveC(input.luotChay.nguonChay), action: HANH_DONG_CHUYEN_KHOAN_LUOT, oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay, soDuyet: input.soDuyet, soKeHoach: kh.ghi.length, daGhi: kh.ghi.length, keHoachSha: kh.sha,
      chiTiet: { cap: kh.ghi.map((g) => ({ cu: g.cuId, moi: g.moiId, khoan: g.khoanIds, giaCu: g.giaCu })), soKhoan },
    }),
    changedFields: ["expectedCount", "actualCount"], reason: "Lượt chạy P7-B chuyển khoản thu và giá sang ghi danh đang học: người bấm · số đã duyệt · số thực ghi", tx,
  });
  return { soCap: kh.ghi.length, soKhoan, keHoachSha: kh.sha };
}

/**
 * KIỂM SAU GHI (chỉ đọc): đọc dấu vết lượt ghi gần nhất; mọi cặp của lượt đó phải ở trạng thái đích (khoản ở ghi danh mới, giá ở ghi danh mới, ghi danh cũ không giá); không còn cặp nào SẼ CHUYỂN.
 */
export async function kiemSauGhiChuyenKhoan(
  c: KhachChuyenKhoan,
): Promise<{ keHoach: KeHoachChuyenKhoan; luotCuoi: { entityId: string; soCap: number } | null; capSai: string[]; conSeChuyen: number }> {
  const keHoach = await docKeHoachChuyenKhoan(c);
  const luot = await c.auditLog.findFirst({ where: { entityType: ENTITY_LUOT_CHUYEN_KHOAN, action: HANH_DONG_CHUYEN_KHOAN_LUOT }, orderBy: { createdAt: "desc" }, select: { entityId: true, newValues: true } });
  const nv = (luot?.newValues ?? null) as { cap?: unknown } | null;
  const cap = Array.isArray(nv?.cap) ? (nv.cap as { cu: string; moi: string; khoan: string[]; giaCu: ReturnType<typeof gia> }[]) : [];
  const capSai: string[] = [];
  for (const p of cap) {
    const [moi, cu, n] = await Promise.all([
      c.enrollment.findUnique({ where: { id: p.moi }, select: SEL_ENR }),
      c.enrollment.findUnique({ where: { id: p.cu }, select: SEL_ENR }),
      c.payment.count({ where: { id: { in: p.khoan }, enrollmentId: p.moi, deletedAt: null } }),
    ]);
    if (moi === null || cu === null || !cungGiaChuyen(gia(moi), p.giaCu) || !cungGiaChuyen(gia(cu), GIA_TRONG) || n !== p.khoan.length) capSai.push(`${p.cu}→${p.moi}`);
  }
  return { keHoach, luotCuoi: luot === null ? null : { entityId: luot.entityId, soCap: cap.length }, capSai, conSeChuyen: keHoach.ghi.filter((g) => cap.some((p) => p.cu === g.cuId)).length };
}
