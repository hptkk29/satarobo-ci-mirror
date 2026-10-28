// lib/hoa-hong/quet-ky.ts — QUÉT THEO KỲ: gom tập khoản cần xét (Q1–Q6 của 04 §12.1) rồi cho từng khoản đi qua `quetKhoan`.
//
// Nguồn: docs/source-commission/04 §12.1 (tập Q), §10.5 (hàng chờ tự giải), 05 PR5a (cron quét + đối soát tuần).
//
// Vì sao KHÔNG chỉ quét "khoản có paidDate trong kỳ hoặc Payment.updatedAt mới": phần lớn đầu vào TRÔI không chạm `Payment.updatedAt`
// (người hưởng đọc từ `Lead`, học viên từ `Student`/`OrderItem`, nguồn từ `LeadAttribution`…). Quét như vậy thì `INPUT_DRIFT` không bao
// giờ nổ với khoản kỳ trước, hàng chờ `CHO_HOC_VIEN` không có gì kích hoạt tự giải, và kỳ được khoá trên số cũ mà cổng không biết.
//
//   Q1  khoản thực thu có paidDate trong kỳ, của cơ sở kỳ
//   Q2  khoản của kỳ tự nhiên TRƯỚC, chưa có ô, đến muộn (xác nhận/tạo sau mốc cutover)
//   Q3  khoản đang có hàng chờ OPEN của cơ sở (mọi mã tự giải được + INPUT_DRIFT)
//   Q4  khoản có ô mà một bảng đầu vào đổi SAU lần so gần nhất của ô
//   Q5  đối soát nền: mọi khoản có ô trong `hoaHong.soThangDoiSoat` tháng gần nhất
//   Q6  quét NGƯỢC từ sổ: ô còn tiền mà khoản thu nay rời `WHERE_THUC_THU` ⇒ `PAYMENT_WITHDRAWN`
//
// Sắp theo (paidDate, id): khoản gốc luôn được xử lý TRƯỚC khoản hoàn của nó trong cùng lượt.
import { Prisma, type PrismaClient } from "@prisma/client";

import { khoangKy, kyCuaButToan } from "@/lib/crm/commission-thuc-thu";
import { TRANG_THAI_THUC_THU, WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { nguonCapNhatTheoLead } from "@/lib/nguon/doc-nguon-hoa-hong";

import type { BoiCanhQuet } from "./boi-canh";
import { HoaHongError } from "./kieu";
import { congThang } from "./ky-hoa-hong";
import { quetKhoan, type KetQuaQuetKhoan } from "./quet-khoan";

export type LoiQuetKhoan = { paymentId: string; ma: string; thongDiep: string };

export type TongKetQuet = {
  soKhoan: number;
  theoKetQua: Record<string, number>;
  loi: LoiQuetKhoan[];
};

/** Khoản KHÔNG còn thuộc thực thu (xoá mềm / bị từ chối / chưa duyệt lại). Một chỗ cho cả hai chân Q6 và đối soát nền. */
const DIEU_KIEN_RUT: Prisma.PaymentWhereInput[] = [{ deletedAt: { not: null } }, { accountantStatus: { notIn: [...TRANG_THAI_THUC_THU] } }];

const theoCoSo = (centerId: string): Prisma.PaymentWhereInput => ({
  OR: [
    { centerId },
    { centerId: null, order: { centerId } },
    { centerId: null, order: { centerId: null, lead: { centerId } } },
  ],
});

/** Mọi nguồn của tập quét cho MỘT cơ sở, hợp lại thành danh sách `paymentId` sắp theo (paidDate, id). */
export async function docTapQuet(
  client: PrismaClient,
  bc: Pick<BoiCanhQuet, "kyCutover">,
  p: { thang: string; centerId: string; soThangDoiSoat: number },
): Promise<string[]> {
  const { start, end } = khoangKy(p.thang);
  const batDauCutover = khoangKy(bc.kyCutover).start;
  const tapIds = new Set<string>();

  // Q1 + Q2 + Q3 + Q5 + Q6 qua ORM; Q4 qua SQL (cần so sánh cột giữa các bảng).
  const [q1, q2, q3, q5, q6, q6hoan, q4] = await Promise.all([
    client.payment.findMany({ where: { ...WHERE_THUC_THU, ...theoCoSo(p.centerId), paidDate: { gte: start, lt: end } }, select: { id: true } }),
    client.payment.findMany({
      where: {
        ...WHERE_THUC_THU,
        ...theoCoSo(p.centerId),
        paidDate: { lt: start },
        commissionCalcSlots: { none: {} },
        amount: { gt: 0 },
        AND: [{ OR: [{ confirmedAt: { gte: batDauCutover } }, { createdAt: { gte: batDauCutover } }] }],
      },
      select: { id: true },
    }),
    client.commissionHold.findMany({ where: { status: "OPEN", centerId: p.centerId, paymentId: { not: null } }, select: { paymentId: true } }),
    p.soThangDoiSoat > 0
      ? client.commissionCalcSlot.findMany({
          where: { centerId: p.centerId, payment: { paidDate: { gte: khoangKy(congThang(p.thang, -(p.soThangDoiSoat - 1))).start } } },
          select: { paymentId: true },
        })
      : Promise.resolve([] as { paymentId: string }[]),
    // Q6: ô của cơ sở mà khoản thu nay KHÔNG còn thuộc thực thu.
    client.commissionCalcSlot.findMany({
      where: { centerId: p.centerId, payment: { OR: DIEU_KIEN_RUT } },
      select: { paymentId: true },
    }),
    // Q6 (chân hoàn): khoản HOÀN mà engine đã đảo theo (có dòng REVERSAL hoặc LEGACY_REVERSAL — gốc thuộc sổ cũ) nay rời thực thu. Khoản âm không có ô nên chân trên mù với nó.
    client.commissionTransaction.findMany({
      where: { centerId: p.centerId, entryKind: { in: ["REVERSAL", "LEGACY_REVERSAL"] }, payment: { OR: DIEU_KIEN_RUT } },
      select: { paymentId: true },
      distinct: ["paymentId"],
    }),
    docQ4(client, p.centerId),
  ]);
  for (const x of q1) tapIds.add(x.id);
  for (const x of q2) tapIds.add(x.id);
  for (const x of q3) if (x.paymentId) tapIds.add(x.paymentId);
  for (const x of q5) tapIds.add(x.paymentId);
  for (const x of q6) tapIds.add(x.paymentId);
  for (const x of q6hoan) if (x.paymentId) tapIds.add(x.paymentId);
  for (const id of q4) tapIds.add(id);
  return sapTheoNgay(client, [...tapIds]);
}

/** Q4 — khoản có ô mà một trong các bảng đầu vào đổi SAU lần so gần nhất của ô (04 §12.1, bảng tập Q). */
async function docQ4(client: PrismaClient, centerId: string): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT s."paymentId" AS id
    FROM "CommissionCalcSlot" s
    JOIN "Payment" p ON p."id" = s."paymentId"
    JOIN "Order" o ON o."id" = p."orderId"
    LEFT JOIN "Lead" l ON l."id" = o."leadId"
    LEFT JOIN "OrderItem" oi ON oi."id" = NULLIF(s."orderItemKey", '-')
    LEFT JOIN "Student" st ON st."id" = oi."studentId"
    WHERE s."centerId" = ${centerId}
      AND (
        p."updatedAt" > s."lastCheckedAt" OR o."updatedAt" > s."lastCheckedAt" OR l."updatedAt" > s."lastCheckedAt"
        OR oi."updatedAt" > s."lastCheckedAt" OR st."updatedAt" > s."lastCheckedAt"
        OR EXISTS (SELECT 1 FROM "CenterCommissionAssignee" c WHERE c."centerId" = s."centerId" AND c."updatedAt" > s."lastCheckedAt")
        OR EXISTS (
          SELECT 1 FROM "CommissionTransaction" t
          JOIN "User" u ON u."id" = t."beneficiaryUserId"
          JOIN "Employee" e ON e."id" = u."employeeId"
          WHERE t."calcSlotId" = s."id" AND e."updatedAt" > s."lastCheckedAt"
        )
      )`;
  const ids = new Set(rows.map((r) => r.id));

  // Chân thứ bảy — NGUỒN đổi sau lần so gần nhất của ô. So trong JS vì bảng nguồn chỉ được đọc qua `lib/nguon/**` (`[QN-W11]`).
  const slots = await client.commissionCalcSlot.findMany({
    where: { centerId, payment: { order: { leadId: { not: null } } } },
    select: { paymentId: true, lastCheckedAt: true, payment: { select: { order: { select: { leadId: true } } } } },
  });
  const capNhat = await nguonCapNhatTheoLead(
    client,
    slots.map((s) => s.payment.order.leadId!).filter(Boolean),
  );
  for (const s of slots) {
    const t = capNhat.get(s.payment.order.leadId!);
    if (t && t.getTime() > s.lastCheckedAt.getTime()) ids.add(s.paymentId);
  }
  return [...ids];
}

async function sapTheoNgay(client: PrismaClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  // `deletedAt: undefined` — có khoá `deletedAt` trong where ⇒ tiện ích soft-delete KHÔNG chèn `deletedAt: null`; Prisma coi `undefined` là
  // không lọc. Cần vậy vì Q6 CHÍNH LÀ tìm khoản đã xoá mềm.
  const rows = await client.payment.findMany({
    where: { id: { in: ids }, deletedAt: undefined },
    select: { id: true },
    orderBy: [{ paidDate: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => r.id);
}

/** Cho từng khoản đi qua `quetKhoan`. Lỗi của MỘT khoản không dừng cả lượt — nó được gom lại để người gọi quyết (không im lặng). */
export async function quetCacKhoan(client: PrismaClient, bc: BoiCanhQuet, ids: readonly string[]): Promise<TongKetQuet> {
  const theoKetQua: Record<string, number> = {};
  const loi: LoiQuetKhoan[] = [];
  for (const id of ids) {
    try {
      const r: KetQuaQuetKhoan = await quetKhoan(client, bc, id);
      const nhan = r.loai === "BO_QUA" ? `BO_QUA:${r.lyDo}` : r.loai;
      theoKetQua[nhan] = (theoKetQua[nhan] ?? 0) + 1;
    } catch (e) {
      loi.push({
        paymentId: id,
        ma: e instanceof HoaHongError ? e.ma : "LOI_KHONG_LUONG_TRUOC",
        thongDiep: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { soKhoan: ids.length, theoKetQua, loi };
}

/** Quét MỘT kỳ (tháng × cơ sở). */
export async function quetKy(
  client: PrismaClient,
  bc: BoiCanhQuet,
  p: { thang: string; centerId: string; soThangDoiSoat: number },
): Promise<TongKetQuet> {
  if (p.thang < bc.kyCutover) {
    throw new HoaHongError("KY_TRUOC_MOC", `Kỳ ${p.thang} < mốc cutover ${bc.kyCutover}: engine mới không quét kỳ cũ.`);
  }
  return quetCacKhoan(client, bc, await docTapQuet(client, bc, p));
}

/**
 * ĐỐI SOÁT NỀN (Q5 + Q3 + Q6, toàn hệ) — chạy bằng cron: phát hiện trôi đầu vào / hàng chờ tự giải / khoản bị rút
 * mà KHÔNG ai bấm Tính. `soThang = 0` ⇒ tắt (chỉ còn Q3/Q6 qua khoản có hàng chờ / ô rút).
 */
export async function doiSoatNen(client: PrismaClient, bc: BoiCanhQuet, p: { soThang: number; gioiHan: number }): Promise<TongKetQuet & { biCat: boolean }> {
  // Cửa sổ đối soát: `soThang` tháng gần nhất tính từ tháng của `bc.now`, KHÔNG lùi quá mốc cutover (engine mới không đụng kỳ cũ).
  const thangNay = kyCuaButToan(bc.now);
  const thangDau = congThang(thangNay, -(p.soThang - 1));
  const tu = p.soThang > 0 ? khoangKy(thangDau < bc.kyCutover ? bc.kyCutover : thangDau).start : null;
  const ids = new Set<string>();
  const [slots, holds, rut, rutHoan, q4] = await Promise.all([
    tu ? client.commissionCalcSlot.findMany({ where: { payment: { paidDate: { gte: tu } } }, select: { paymentId: true, lastCheckedAt: true } }) : Promise.resolve([] as { paymentId: string; lastCheckedAt: Date }[]),
    client.commissionHold.findMany({ where: { status: "OPEN", paymentId: { not: null } }, select: { paymentId: true } }),
    client.commissionCalcSlot.findMany({ where: { payment: { OR: DIEU_KIEN_RUT } }, select: { paymentId: true } }),
    client.commissionTransaction.findMany({ where: { entryKind: { in: ["REVERSAL", "LEGACY_REVERSAL"] }, payment: { OR: DIEU_KIEN_RUT } }, select: { paymentId: true }, distinct: ["paymentId"] }),
    docQ4Toan(client),
  ]);
  const uuTien = new Set<string>(); // khoản ĐÃ có tín hiệu cần xử lý: hàng chờ mở · rời thực thu · đầu vào đổi sau lần so gần nhất
  const tuoi = new Map<string, number>(); // khoản chỉ có mặt vì cửa sổ Q5: lần so gần nhất CỦA Ô CŨ NHẤT của khoản
  for (const x of slots) {
    ids.add(x.paymentId);
    tuoi.set(x.paymentId, Math.min(tuoi.get(x.paymentId) ?? Infinity, x.lastCheckedAt.getTime()));
  }
  const themUuTien = (id: string | null): void => {
    if (!id) return;
    ids.add(id);
    uuTien.add(id);
  };
  for (const x of holds) themUuTien(x.paymentId);
  for (const x of rut) themUuTien(x.paymentId);
  for (const x of rutHoan) themUuTien(x.paymentId);
  for (const x of q4) themUuTien(x);
  const sap = await sapTheoNgay(client, [...ids]);
  const biCat = sap.length > p.gioiHan;
  const tong = await quetCacKhoan(client, bc, biCat ? chonKhoanKhiBiCat(sap, uuTien, tuoi, p.gioiHan) : sap);
  return { ...tong, biCat };
}

/**
 * Khi tập đối soát vượt `gioiHan`: lấy khoản CÓ TÍN HIỆU trước, rồi tới khoản có lần so gần nhất CŨ NHẤT (chưa từng so = cũ nhất), hoà thì theo id. Giữ nguyên thứ tự `sap`
 * (paidDate, id) trong phần được chọn — khoản gốc vẫn được xử lý trước khoản hoàn của nó.
 *
 * Vì sao không `sap.slice(0, gioiHan)`: tập Q5 sắp theo ngày thu tăng dần và mỗi tuần cắt cùng một đầu ⇒ khoản mới hơn vị trí `gioiHan` KHÔNG BAO GIỜ được đối soát nền — đúng nhóm
 * dễ trôi nhất. Theo "cũ nhất trước", mỗi lượt cắt đẩy phần chưa so lên đầu hàng của lượt sau, nên ⌈N / gioiHan⌉ lượt phủ hết.
 */
export function chonKhoanKhiBiCat(sap: readonly string[], uuTien: ReadonlySet<string>, tuoi: ReadonlyMap<string, number>, gioiHan: number): string[] {
  const hang = [...sap].sort((a, b) => {
    const ua = uuTien.has(a) ? 0 : 1;
    const ub = uuTien.has(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const ta = tuoi.get(a) ?? Number.NEGATIVE_INFINITY;
    const tb = tuoi.get(b) ?? Number.NEGATIVE_INFINITY;
    return ta !== tb ? ta - tb : a < b ? -1 : a > b ? 1 : 0;
  });
  const chon = new Set(hang.slice(0, gioiHan));
  return sap.filter((id) => chon.has(id));
}

async function docQ4Toan(client: PrismaClient): Promise<string[]> {
  const cs = await client.commissionCalcSlot.findMany({ distinct: ["centerId"], select: { centerId: true } });
  const ra: string[] = [];
  for (const c of cs) ra.push(...(await docQ4(client, c.centerId)));
  return ra;
}
