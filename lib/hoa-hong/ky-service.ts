// lib/hoa-hong/ky-service.ts — CommissionPeriodService: Tính · chuyển rà soát · trả lại · KHOÁ · dời hàng chờ sang kỳ sau.
// (Xuất bảng chi + đánh dấu đã chi: `xuat-ky.ts`.)
//
// Nguồn: docs/source-commission/04 §12.1 (vòng đời + cổng), §10.5 (hàng chờ chặn khoá), 05 §4 (audit).
//
// ⚠️ Service này KHÔNG kiểm quyền và KHÔNG phải Server Action (khuôn `chinh-sach-service.ts`): chỗ gọi (action PR9) PHẢI `auth()` +
// `assertCan(…, "commission_periods:manage")` ở đầu hàm. Service nhận `actor` chỉ để ghi audit.
//
// Cổng KHOÁ (04 §12.1), tất cả đứng TRƯỚC phép ghi đầu tiên và từ chối = `throw`:
//   (a) không còn hàng chờ CHẶN có `blockingPeriodId` = kỳ này (hàng chờ treo + khiếu nại KHÔNG chặn);
//   (b) KHÔNG có dấu thời gian đầu vào nào của tập Q mới hơn `lastCalculatedAt` — kể cả đầu vào KHÔNG chạm `Payment.updatedAt`
//       (Lead, OrderItem, Student, người phụ trách, nhân sự, nguồn). Chỉ so `Payment.updatedAt` là cổng mù với phần lớn lý do trôi.
import { Prisma, type PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/actor";
import { khoangKy } from "@/lib/crm/commission-thuc-thu";
import { passesScope } from "@/lib/db-scope";
import { nguonCapNhatMoiNhat } from "@/lib/nguon/doc-nguon-hoa-hong";

import type { BoiCanhQuet } from "./boi-canh";
import type { MaHold } from "./hang-cho";
import { HoaHongError, LY_DO_TOI_THIEU, batLyDoToiThieu } from "./kieu";
import { congThang, kiemChuyenTrangThaiKy, type TrangThaiKy } from "./ky-hoa-hong";
import { bamKy, khoaKy } from "./ky-db";
import { quetKy, type TongKetQuet } from "./quet-ky";
import type { Khach } from "./nap-khoan";

/**
 * Người thao tác trên KỲ. `quyen` là Actor đã resolve (RBAC v2) và BẮT BUỘC: `scopedDb` KHÔNG che ghi (CLAUDE.md luật 5), nên MỌI thao tác
 * ghi lên một kỳ phải tự `passesScope` — để `quyen` là trường bắt buộc thì `tsc` liệt kê chỗ gọi nào quên (luật 7), và QLCS CS1 không thể
 * khoá/xuất/đánh dấu chi kỳ của CS2 dù gõ đúng id (IDOR). Quyền *chức năng* (`commission_periods:manage`) vẫn do action gác ở đầu hàm.
 */
export type NguoiThaoTacKy = { userId: string | null; ten: string; quyen: Actor };
const actorAudit = (a: NguoiThaoTacKy) => ({ id: a.userId, name: a.ten });

/** Cổng phạm vi GHI lên kỳ. Gọi TRƯỚC phép ghi đầu tiên; từ chối = `throw`. */
export function batPhamViKy(k: { period: string; centerId: string }, nguoi: NguoiThaoTacKy): void {
  if (!passesScope("CommissionPeriod", { centerId: k.centerId }, nguoi.quyen)) {
    throw new HoaHongError("NGOAI_PHAM_VI", `Kỳ ${k.period} thuộc cơ sở ngoài phạm vi của bạn.`);
  }
}
const MODULE_AUDIT = "hoa-hong";
// `LY_DO_TOI_THIEU` / `batLyDoToiThieu` dời sang `kieu.ts` (dùng chung với `giai-hang-cho`, `cutover`); re-export để import cũ vẫn chạy.
export { LY_DO_TOI_THIEU, batLyDoToiThieu };

async function docKyHoacNem(client: Khach, periodId: string) {
  const k = await client.commissionPeriod.findUnique({ where: { id: periodId } });
  if (!k) throw new HoaHongError("KY_KHONG_TON_TAI", `Kỳ ${periodId} không tồn tại.`);
  return k;
}

/** Số hàng chờ chặn khoá, tách theo mã (mã không có hàng chờ thì vắng khoá). */
export type HangChoChanTheoMa = Partial<Record<MaHold, number>>;

/**
 * MỘT ĐỊNH NGHĨA DUY NHẤT của "hàng chờ chặn khoá kỳ": `CommissionHold` ĐANG MỞ có `blockingPeriodId` = kỳ. (Khiếu nại mở và vai "treo" KHÔNG nằm ở
 * đây — chúng không mang `blockingPeriodId`, CHECK DB.) Cổng khoá (`demHangChoChan` → `kiemChuyenTrangThaiKy`) và MỌI số hiện trên màn Kỳ (ô "Chặn" của
 * bảng, "Việc còn dang dở", hộp thoại khoá, pill tab) đều đi qua hàm này — không ai viết điều kiện thứ hai (luật 12b). Cố ý KHÔNG qua scope: đây là phép đếm
 * của cổng; kỳ nào đã nằm trong tầm nhìn của người xem thì hàng chờ chặn nó cũng là việc của họ.
 */
export async function demHangChoChanTheoMa(client: Khach, periodIds: readonly string[]): Promise<Map<string, HangChoChanTheoMa>> {
  const ra = new Map<string, HangChoChanTheoMa>(periodIds.map((id) => [id, {}]));
  if (periodIds.length === 0) return ra;
  const nhom = await client.commissionHold.groupBy({
    by: ["blockingPeriodId", "code"],
    where: { blockingPeriodId: { in: [...periodIds] }, status: "OPEN" },
    _count: { _all: true },
  });
  for (const r of nhom) if (r.blockingPeriodId) ra.get(r.blockingPeriodId)![r.code] = r._count._all;
  return ra;
}

export const tongHangChoChan = (theoMa: HangChoChanTheoMa): number => Object.values(theoMa).reduce((s, n) => s + (n ?? 0), 0);

/** Số hàng chờ ĐANG MỞ mà kỳ này phải chờ (chặn khoá) — con số mà cổng khoá so với 0. */
export async function demHangChoChan(client: Khach, periodId: string): Promise<number> {
  return tongHangChoChan((await demHangChoChanTheoMa(client, [periodId])).get(periodId) ?? {});
}

/**
 * Mốc thời gian MỚI NHẤT của mọi đầu vào thuộc tập Q của kỳ (04 §12.1 bảng "Dấu thời gian"): Payment · Order · Lead · LeadAttribution (qua lib/nguon) ·
 * OrderItem · Student · CenterCommissionAssignee · Employee. Tập Q của kỳ = ô của cơ sở mà khoản thu có paidDate trong tháng kỳ HOẶC có dòng
 * sổ trong kỳ. `null` = không có ô nào.
 */
export async function dauVaoMoiNhat(client: Khach, k: { id: string; period: string; centerId: string }): Promise<Date | null> {
  const { start, end } = khoangKy(k.period);
  const r = await client.$queryRaw<{ moi: Date | null }[]>`
    SELECT max(GREATEST(
      p."updatedAt", o."updatedAt",
      COALESCE(l."updatedAt", 'epoch'::timestamptz),
      COALESCE(oi."updatedAt", 'epoch'::timestamptz), COALESCE(st."updatedAt", 'epoch'::timestamptz),
      COALESCE((SELECT max(c."updatedAt") FROM "CenterCommissionAssignee" c WHERE c."centerId" = s."centerId"), 'epoch'::timestamptz),
      COALESCE((
        SELECT max(e."updatedAt") FROM "CommissionTransaction" t
        JOIN "User" u ON u."id" = t."beneficiaryUserId" JOIN "Employee" e ON e."id" = u."employeeId"
        WHERE t."calcSlotId" = s."id"
      ), 'epoch'::timestamptz)
    )) AS moi
    FROM "CommissionCalcSlot" s
    JOIN "Payment" p ON p."id" = s."paymentId"
    JOIN "Order" o ON o."id" = p."orderId"
    LEFT JOIN "Lead" l ON l."id" = o."leadId"
    LEFT JOIN "OrderItem" oi ON oi."id" = NULLIF(s."orderItemKey", '-')
    LEFT JOIN "Student" st ON st."id" = oi."studentId"
    WHERE s."centerId" = ${k.centerId}
      AND (
        (p."paidDate" >= ${start} AND p."paidDate" < ${end})
        OR EXISTS (SELECT 1 FROM "CommissionTransaction" t2 WHERE t2."calcSlotId" = s."id" AND t2."periodId" = ${k.id})
      )`;
  const moi = r[0]?.moi ? new Date(r[0].moi) : null;

  // Nguồn của lead (LeadAttribution.updatedAt) — đọc qua `lib/nguon/**` (`[QN-W11]` cấm SQL thô tới bảng nguồn ở đây).
  const slots = await client.commissionCalcSlot.findMany({
    where: {
      centerId: k.centerId,
      payment: { order: { leadId: { not: null } } },
      OR: [{ payment: { paidDate: { gte: start, lt: end } } }, { entries: { some: { periodId: k.id } } }],
    },
    select: { payment: { select: { order: { select: { leadId: true } } } } },
  });
  const nguon = await nguonCapNhatMoiNhat(
    client,
    slots.map((s) => s.payment.order.leadId!).filter(Boolean),
  );
  return moi && nguon ? (moi.getTime() >= nguon.getTime() ? moi : nguon) : (moi ?? nguon);
}

export type KetQuaTinhKy = { tongKet: TongKetQuet; trangThai: "CALCULATED"; lastCalculatedAt: Date };

/**
 * TÍNH kỳ: quét tập Q1–Q6 của kỳ rồi đặt CALCULATED + `lastCalculatedAt`. `lastCalculatedAt = now` là thời điểm BẮT ĐẦU đọc (không phải lúc
 * xong): đầu vào đổi trong lúc đang tính có dấu thời gian MỚI HƠN ⇒ cổng khoá từ chối.
 * Khoản nào lỗi ⇒ KHÔNG đặt CALCULATED (kỳ thiếu khoản là kỳ không được xem như đã tính) — ném `TINH_CO_LOI` kèm danh sách.
 */
export async function tinhKy(
  client: PrismaClient,
  bc: BoiCanhQuet,
  input: { periodId: string; soThangDoiSoat: number; actor: NguoiThaoTacKy },
): Promise<KetQuaTinhKy> {
  const k0 = await docKyHoacNem(client, input.periodId);
  batPhamViKy(k0, input.actor);
  // Cổng TRƯỚC lượt quét (tốn kém và GHI sổ): bảng chuyển trạng thái coi REVIEWING → CALCULATED là "Trả lại" nên cho qua, nhưng Tính không phải Trả lại —
  // kỳ đang rà soát mà vẫn quét thì dòng mới trôi sang kỳ OPEN kế (đã ghi) rồi transaction cuối mới từ chối. Chỉ OPEN/CALCULATED mới Tính được.
  if (k0.status !== "OPEN" && k0.status !== "CALCULATED") {
    throw new HoaHongError("KY_CHUYEN_KHONG_HOP_LE", `Kỳ ${k0.period} đang ${k0.status}; chỉ Tính được kỳ đang mở hoặc đã tính. Muốn tính lại kỳ đang rà soát, hãy Trả lại trước.`);
  }
  const chan = kiemChuyenTrangThaiKy({ tu: k0.status, den: "CALCULATED", soHangChoChan: 0, lastCalculatedAt: k0.lastCalculatedAt, dauVaoMoiNhat: null });
  if (chan) throw new HoaHongError("KY_CHUYEN_KHONG_HOP_LE", chan);
  if (k0.period < bc.kyCutover) throw new HoaHongError("KY_TRUOC_MOC", `Kỳ ${k0.period} < mốc cutover ${bc.kyCutover}: engine mới không tính kỳ cũ.`);

  const batDau = bc.now;
  const tongKet = await quetKy(client, bc, { thang: k0.period, centerId: k0.centerId, soThangDoiSoat: input.soThangDoiSoat });
  if (tongKet.loi.length > 0) {
    throw new HoaHongError("TINH_CO_LOI", `${tongKet.loi.length} khoản không tính được — kỳ chưa thể đặt "đã tính".`, tongKet.loi);
  }

  await client.$transaction(async (tx) => {
    const khoa = await khoaKy(tx, [k0.id]);
    const k = khoa.get(k0.id);
    // Cổng (trước phép ghi): kỳ còn ở trạng thái cho Tính, và Tính không lùi (một lượt Tính chạy chậm không đè lượt mới hơn).
    if (!k || (k.status !== "OPEN" && k.status !== "CALCULATED")) throw new HoaHongError("KY_DA_DONG", `Kỳ ${k0.period} đã chuyển sang ${k?.status ?? "?"} trong lúc tính.`);
    const cu = await tx.commissionPeriod.findUniqueOrThrow({ where: { id: k0.id }, select: { lastCalculatedAt: true } });
    const lastCalculatedAt = cu.lastCalculatedAt && cu.lastCalculatedAt.getTime() > batDau.getTime() ? cu.lastCalculatedAt : batDau;
    await tx.commissionPeriod.update({ where: { id: k0.id }, data: { status: "CALCULATED", lastCalculatedAt, lastCalculatedById: input.actor.userId } });
    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPeriod",
      entityId: k0.id,
      action: "CALCULATE",
      oldValues: { status: k.status },
      newValues: { status: "CALCULATED", soKhoan: tongKet.soKhoan, ketQua: tongKet.theoKetQua },
      orgUnitId: k0.orgUnitId,
      tx,
    });
  });
  return { tongKet, trangThai: "CALCULATED", lastCalculatedAt: batDau };
}

type DoiTrangThai = { periodId: string; den: TrangThaiKy; actor: NguoiThaoTacKy; now: Date; lyDo: string | null; action: string; capNhat: Prisma.CommissionPeriodUpdateInput };

/** Chuyển trạng thái có cổng — khoá hàng kỳ, nạp lại, kiểm, rồi mới ghi (từ chối = throw trước phép ghi đầu). */
async function chuyen(client: PrismaClient, i: DoiTrangThai, tuKyVong: readonly TrangThaiKy[], duocBoQuaCongDuLieu = false) {
  const k0 = await docKyHoacNem(client, i.periodId);
  batPhamViKy(k0, i.actor);
  return client.$transaction(async (tx) => {
    const khoa = (await khoaKy(tx, [i.periodId])).get(i.periodId);
    if (!khoa) throw new HoaHongError("KY_KHONG_TON_TAI", `Kỳ ${i.periodId} không tồn tại.`);
    if (!tuKyVong.includes(khoa.status)) {
      throw new HoaHongError("KY_CHUYEN_KHONG_HOP_LE", `Kỳ ${khoa.period} đang ${khoa.status}; thao tác này chỉ làm được khi kỳ ở ${tuKyVong.join(" / ")}.`);
    }
    const hienTai = await tx.commissionPeriod.findUniqueOrThrow({ where: { id: i.periodId } });
    const cuoi = duocBoQuaCongDuLieu ? null : await dauVaoMoiNhat(tx, hienTai);
    const loi = kiemChuyenTrangThaiKy({
      tu: hienTai.status,
      den: i.den,
      soHangChoChan: i.den === "LOCKED" ? await demHangChoChan(tx, i.periodId) : 0,
      lastCalculatedAt: hienTai.lastCalculatedAt,
      dauVaoMoiNhat: cuoi,
    });
    if (loi) throw new HoaHongError("KY_CHUYEN_KHONG_HOP_LE", loi);

    await tx.commissionPeriod.update({ where: { id: i.periodId }, data: { status: i.den, ...i.capNhat } });
    if (i.den === "LOCKED") {
      // PENDING → APPROVED: dòng của kỳ khoá thành "đã duyệt chi" (04 §13). Trigger chỉ cho 3 cột chi trả đổi, và chỉ TIẾN.
      await tx.commissionTransaction.updateMany({ where: { periodId: i.periodId, payoutStatus: "PENDING" }, data: { payoutStatus: "APPROVED", payoutStatusAt: i.now } });
    }
    await writeAudit({
      actor: actorAudit(i.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPeriod",
      entityId: i.periodId,
      action: i.action,
      oldValues: { status: hienTai.status },
      newValues: { status: i.den },
      reason: i.lyDo ?? undefined,
      orgUnitId: k0.orgUnitId,
      tx,
    });
    return { tu: hienTai.status, den: i.den };
  });
}

/** CALCULATED → REVIEWING. */
export async function chuyenRaSoat(client: PrismaClient, i: { periodId: string; actor: NguoiThaoTacKy; now: Date }) {
  return await chuyen(client, { ...i, den: "REVIEWING", lyDo: null, action: "REVIEW", capNhat: { reviewStartedAt: i.now, reviewStartedById: i.actor.userId } }, ["CALCULATED"]);
}

/** REVIEWING → CALCULATED ("Trả lại" — lý do bắt buộc). */
export async function traLaiKy(client: PrismaClient, i: { periodId: string; actor: NguoiThaoTacKy; now: Date; lyDo: string }) {
  const lyDo = batLyDoToiThieu(i.lyDo, "Trả lại kỳ");
  return await chuyen(client, { ...i, den: "CALCULATED", lyDo, action: "RETURN", capNhat: { reviewStartedAt: null, reviewStartedById: null } }, ["REVIEWING"], true);
}

/** REVIEWING → LOCKED. Lý do bắt buộc (05 §4). Hai cổng (a)(b) ở đầu tệp. */
export async function khoaKyHoaHong(client: PrismaClient, i: { periodId: string; actor: NguoiThaoTacKy; now: Date; lyDo: string }) {
  const lyDo = batLyDoToiThieu(i.lyDo, "Khoá kỳ");
  return await chuyen(client, { ...i, den: "LOCKED", lyDo, action: "LOCK", capNhat: { lockedAt: i.now, lockedById: i.actor.userId } }, ["REVIEWING"]);
}

/**
 * "Dời sang kỳ sau" (04 §10.5): hàng chờ cứng đang chặn khoá một kỳ mà còn chờ văn bản/quyết định ⇒ đổi `blockingPeriodId` sang kỳ kế tiếp
 * của cùng đơn vị. Lý do bắt buộc + audit. KHÔNG xoá hàng chờ, KHÔNG sinh dòng sổ — chỉ chuyển chỗ chặn.
 */
export async function doiHangChoSangKySau(
  client: PrismaClient,
  bc: Pick<BoiCanhQuet, "kyCutover">,
  i: { holdId: string; actor: NguoiThaoTacKy; now: Date; lyDo: string },
): Promise<{ kySau: string }> {
  const lyDo = batLyDoToiThieu(i.lyDo, "Dời hàng chờ sang kỳ sau");
  const h = await client.commissionHold.findUnique({ where: { id: i.holdId }, include: { blockingPeriod: true } });
  if (!h || h.status !== "OPEN") throw new HoaHongError("HANG_CHO_KHONG_MO", "Hàng chờ không tồn tại hoặc đã đóng.");
  if (!h.blockingPeriod) throw new HoaHongError("HANG_CHO_KHONG_CHAN", "Hàng chờ này không chặn kỳ nào — không có gì để dời.");
  const k = h.blockingPeriod;
  batPhamViKy(k, i.actor);
  const tuThang = congThang(k.period, 1);
  const kySau = await bamKy(client, { thang: tuThang < bc.kyCutover ? bc.kyCutover : tuThang, centerId: k.centerId, orgUnitId: k.orgUnitId, kyCutover: bc.kyCutover });
  await client.$transaction(async (tx) => {
    const lai = await tx.commissionHold.findUniqueOrThrow({ where: { id: i.holdId } });
    if (lai.status !== "OPEN" || lai.blockingPeriodId !== k.id) throw new HoaHongError("TRANG_THAI_DA_DOI", "Hàng chờ vừa được xử lý ở nơi khác.");
    await tx.commissionHold.update({ where: { id: i.holdId }, data: { blockingPeriodId: kySau.id } });
    await writeAudit({
      actor: actorAudit(i.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionHold",
      entityId: i.holdId,
      action: "DEFER",
      oldValues: { blockingPeriodId: k.id, period: k.period },
      newValues: { blockingPeriodId: kySau.id, period: kySau.period },
      reason: lyDo,
      orgUnitId: k.orgUnitId,
      tx,
    });
  });
  return { kySau: kySau.period };
}
