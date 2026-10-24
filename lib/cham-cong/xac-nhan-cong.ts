// lib/cham-cong/xac-nhan-cong.ts — XÁC NHẬN CÔNG + KHIẾU NẠI CÔNG (P2.2, 11/10/2026). Đường đọc/ghi DB.
//
// Ba luật giữ cho phần này đúng (luật thuần ở `xac-nhan-cong-thuan.ts`):
//  1. Xác nhận gắn (người × cơ sở × kỳ) — đúng tập ngày `lockPeriod` đóng băng — và mang vân tay các cột
//     GIÁ TRỊ. "Còn hiệu lực không" SUY RA lúc đọc bằng so vân tay, không móc vào đường ghi nào.
//  2. Bấm xác nhận phải gửi kèm vân tay của bản trang ĐÃ XEM; khác vân tay hiện tại ⇒ từ chối. Đó là ca
//     "NV xem bản A, trong lúc đó HR đổi thành B, NV bấm xác nhận" — chặn đúng lúc bấm.
//  3. Khiếu nại KHÔNG có đường ghi công riêng (xử lý bằng đơn chỉnh công / ghi đè ngày / xác nhận vắng có
//     sẵn). Nó chỉ là luồng trao đổi + cái chặn khoá kỳ. Mở khiếu nại và khoá kỳ cùng lấy khoá tư vấn
//     `ky-cong:<cơ sở>:<kỳ>` nên một khiếu nại không thể lọt vào giữa lúc kỳ đang được khoá.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { vnDateOnly } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap } from "./home-center";
import { periodRange, type PeriodKey } from "./period";
import { demKhieuNaiChanKhoa, khoaKyCong, nguoiTrongKy, xacNhanCongDangBat } from "./khieu-nai-khoa-ky";
import {
  anhChupBangCong,
  chuyenKhieuNai,
  COT_VAN_TAY,
  KHIEU_NAI_DANG_MO,
  laKhieuNaiNghiemTrong,
  NHAN_HANH_DONG,
  canMoiXacNhan,
  trangThaiXacNhan,
  type AnhChupBangCong,
  type DongCong,
  type HanhDongKhieuNai,
  type LoaiKhieuNai,
  type TrangThaiKhieuNai,
  type TrangThaiXacNhan,
} from "./xac-nhan-cong-thuan";
import { vanTayBangCong } from "./van-tay-bang-cong";

type Client = Prisma.TransactionClient | typeof db;
type Actor = { id: string; name: string };
type Ket<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export { demKhieuNaiChanKhoa, khoaKyCong, nguoiTrongKy, xacNhanCongDangBat };

async function orgUnitOf(centerId: string): Promise<string | null> {
  if (centerId === HO_CENTER_ID) return null;
  const map = await loadCenterMap();
  return Object.values(map.byCode).find((c) => c.centerId === centerId)?.orgUnitId ?? null;
}

export async function docBangCong(
  client: Client,
  q: { userIds: readonly string[]; centerId: string; from: Date; to: Date },
): Promise<Map<string, DongCong[]>> {
  const out = new Map<string, DongCong[]>(q.userIds.map((u) => [u, []]));
  if (q.userIds.length === 0) return out;
  const rows = await client.staffAttendanceDay.findMany({
    where: { userId: { in: [...q.userIds] }, centerId: q.centerId, workDate: { gte: q.from, lte: q.to } },
    select: { userId: true, ...COT_VAN_TAY },
  });
  for (const { userId, ...r } of rows) out.get(userId)?.push(r);
  return out;
}

/** Kỳ đã kết thúc chưa (ngày cuối kỳ < hôm nay theo giờ VN) — xác nhận giữa tháng là xác nhận bảng dở. */
function kyDaKetThuc(periodKey: string, now: Date): boolean {
  return periodRange(periodKey).to.getTime() < vnDateOnly(now).getTime();
}

async function kyDaKhoa(client: Client, centerId: string, periodKey: string): Promise<boolean> {
  const p = await client.attendancePeriod.findUnique({
    where: { centerId_periodKey: { centerId, periodKey } },
    select: { status: true },
  });
  return p?.status === "LOCKED";
}

// ─── Xem của nhân sự ────────────────────────────────────────────────────────────────────────────

export type BangCongCuaToi = {
  centerId: string;
  tenCoSo: string;
  periodKey: string;
  vanTay: string;
  anhChup: AnhChupBangCong;
  trangThai: TrangThaiXacNhan;
  /** Ảnh chụp lúc xác nhận (để màn "cần xác nhận lại" nói bản cũ là gì). */
  anhChupDaXacNhan: AnhChupBangCong | null;
  kyDaKhoa: boolean;
  kyDaKetThuc: boolean;
  khieuNai: {
    id: string;
    category: string;
    status: TrangThaiKhieuNai;
    workDate: Date | null;
    description: string;
    resolutionNote: string | null;
    messages: { body: string; statusTo: string; createdAt: Date; laCuaToi: boolean }[];
  }[];
};

/** Bảng công + trạng thái xác nhận + khiếu nại của CHÍNH người xem, mỗi cơ sở họ có ngày công trong kỳ. */
export async function docBangCongCuaToi(userId: string, periodKey: PeriodKey, now: Date): Promise<BangCongCuaToi[]> {
  const { from, to } = periodRange(periodKey);
  const coSo = await db.staffAttendanceDay.findMany({
    where: { userId, workDate: { gte: from, lte: to } },
    select: { centerId: true },
    distinct: ["centerId"],
  });
  const ten = new Map(
    (await db.center.findMany({ where: { id: { in: coSo.map((c) => c.centerId) } }, select: { id: true, code: true, name: true } })).map(
      (c) => [c.id, c.code ? `${c.code} · ${c.name}` : c.name],
    ),
  );
  const out: BangCongCuaToi[] = [];
  for (const { centerId } of coSo) {
    const [bang, xn, khoa, kn] = await Promise.all([
      docBangCong(db, { userIds: [userId], centerId, from, to }),
      db.attendanceConfirmation.findUnique({ where: { userId_centerId_periodKey: { userId, centerId, periodKey } } }),
      kyDaKhoa(db, centerId, periodKey),
      db.attendanceDispute.findMany({
        where: { userId, centerId, periodKey },
        orderBy: { createdAt: "desc" },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      }),
    ]);
    const rows = bang.get(userId) ?? [];
    const vanTay = vanTayBangCong(rows);
    out.push({
      centerId,
      tenCoSo: ten.get(centerId) ?? (centerId === HO_CENTER_ID ? "Hội sở" : centerId),
      periodKey,
      vanTay,
      anhChup: anhChupBangCong(rows),
      trangThai: trangThaiXacNhan(xn, vanTay),
      anhChupDaXacNhan: (xn?.snapshotJson as AnhChupBangCong | null) ?? null,
      kyDaKhoa: khoa,
      kyDaKetThuc: kyDaKetThuc(periodKey, now),
      khieuNai: kn.map((k) => ({
        id: k.id,
        category: k.category,
        status: k.status as TrangThaiKhieuNai,
        workDate: k.workDate,
        description: k.description,
        resolutionNote: k.resolutionNote,
        messages: k.messages.map((m) => ({ body: m.body, statusTo: m.statusTo, createdAt: m.createdAt, laCuaToi: m.authorId === userId })),
      })),
    });
  }
  return out;
}

// ─── Xác nhận ───────────────────────────────────────────────────────────────────────────────────

/** Nhân sự xác nhận bảng công của chính mình. `vanTayDaXem` = vân tay trang đã hiển thị. */
export async function xacNhanCong(input: {
  userId: string;
  userName: string;
  centerId: string;
  periodKey: PeriodKey;
  vanTayDaXem: string;
  now: Date;
}): Promise<Ket<{ doiMoi?: boolean }>> {
  if (!(await xacNhanCongDangBat())) return { ok: false, error: "Chức năng xác nhận công đang tắt" };
  if (!kyDaKetThuc(input.periodKey, input.now)) return { ok: false, error: "Kỳ chưa kết thúc — xác nhận sau ngày cuối tháng" };
  if (await kyDaKhoa(db, input.centerId, input.periodKey)) return { ok: false, error: "Kỳ đã chốt sổ — không xác nhận được nữa" };
  const dangMo = await db.attendanceDispute.count({
    where: { userId: input.userId, centerId: input.centerId, periodKey: input.periodKey, status: { in: [...KHIEU_NAI_DANG_MO] } },
  });
  if (dangMo > 0) return { ok: false, error: "Bạn còn khiếu nại chưa có kết luận — chờ kết luận rồi xác nhận" };
  const { from, to } = periodRange(input.periodKey);
  const orgUnitId = await orgUnitOf(input.centerId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`xac-nhan-cong:${input.userId}:${input.centerId}:${input.periodKey}`}))`;
    const rows = (await docBangCong(tx, { userIds: [input.userId], centerId: input.centerId, from, to })).get(input.userId) ?? [];
    if (rows.length === 0) return { ok: false as const, error: "Không có ngày công nào ở cơ sở này trong kỳ" };
    const vanTay = vanTayBangCong(rows);
    // Cổng đứng TRƯỚC phép ghi đầu tiên ⇒ `return` an toàn (không có gì để rollback).
    if (vanTay !== input.vanTayDaXem) {
      return { ok: false as const, error: "Bảng công vừa thay đổi — xem lại bản mới rồi xác nhận", doiMoi: true };
    }
    const anhChup = anhChupBangCong(rows);
    const xn = await tx.attendanceConfirmation.upsert({
      where: { userId_centerId_periodKey: { userId: input.userId, centerId: input.centerId, periodKey: input.periodKey } },
      create: {
        userId: input.userId, centerId: input.centerId, orgUnitId, periodKey: input.periodKey, status: "CONFIRMED",
        snapshotHash: vanTay, snapshotJson: anhChup as unknown as Prisma.InputJsonValue, confirmedAt: input.now, confirmedById: input.userId,
      },
      update: {
        status: "CONFIRMED", snapshotHash: vanTay, snapshotJson: anhChup as unknown as Prisma.InputJsonValue,
        confirmedAt: input.now, confirmedById: input.userId, overrideReason: null,
      },
      select: { id: true },
    });
    await writeAudit({
      actor: { id: input.userId, name: input.userName },
      module: "hr_attendance",
      entityType: "AttendanceConfirmation",
      entityId: xn.id,
      action: "CONFIRM_ATTENDANCE",
      newValues: { centerId: input.centerId, periodKey: input.periodKey, vanTay, cong: anhChup.tong.cong },
      orgUnitId,
      tx,
    });
    return { ok: true as const };
  });
}

/** HR / quản lý xác nhận THAY (người nghỉ việc, không vào được hệ thống…). Lý do bắt buộc, có audit. */
export async function xacNhanThay(input: {
  userId: string;
  centerId: string;
  periodKey: PeriodKey;
  lyDo: string;
  actor: Actor;
  now: Date;
}): Promise<Ket> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, error: "Ghi lý do xác nhận thay (tối thiểu 5 ký tự)" };
  if (!(await xacNhanCongDangBat())) return { ok: false, error: "Chức năng xác nhận công đang tắt" };
  const { from, to } = periodRange(input.periodKey);
  const orgUnitId = await orgUnitOf(input.centerId);
  return db.$transaction(async (tx) => {
    const rows = (await docBangCong(tx, { userIds: [input.userId], centerId: input.centerId, from, to })).get(input.userId) ?? [];
    if (rows.length === 0) return { ok: false as const, error: "Người này không có ngày công nào ở cơ sở trong kỳ" };
    const vanTay = vanTayBangCong(rows);
    const anhChup = anhChupBangCong(rows);
    const xn = await tx.attendanceConfirmation.upsert({
      where: { userId_centerId_periodKey: { userId: input.userId, centerId: input.centerId, periodKey: input.periodKey } },
      create: {
        userId: input.userId, centerId: input.centerId, orgUnitId, periodKey: input.periodKey, status: "OVERRIDDEN",
        snapshotHash: vanTay, snapshotJson: anhChup as unknown as Prisma.InputJsonValue, confirmedAt: input.now,
        confirmedById: input.actor.id, overrideReason: lyDo,
      },
      update: {
        status: "OVERRIDDEN", snapshotHash: vanTay, snapshotJson: anhChup as unknown as Prisma.InputJsonValue,
        confirmedAt: input.now, confirmedById: input.actor.id, overrideReason: lyDo,
      },
      select: { id: true },
    });
    await writeAudit({
      actor: input.actor,
      module: "hr_attendance",
      entityType: "AttendanceConfirmation",
      entityId: xn.id,
      action: "OVERRIDE_ATTENDANCE_CONFIRMATION",
      newValues: { userId: input.userId, centerId: input.centerId, periodKey: input.periodKey, vanTay },
      reason: lyDo,
      orgUnitId,
      tx,
    });
    return { ok: true as const };
  });
}

// ─── Khiếu nại ──────────────────────────────────────────────────────────────────────────────────

export async function moKhieuNai(input: {
  userId: string;
  userName: string;
  centerId: string;
  periodKey: PeriodKey;
  workDate: Date | null;
  category: LoaiKhieuNai;
  moTa: string;
  now: Date;
}): Promise<Ket<{ id: string }>> {
  const moTa = input.moTa.trim();
  if (moTa.length < 10) return { ok: false, error: "Mô tả khiếu nại (tối thiểu 10 ký tự)" };
  if (!(await xacNhanCongDangBat())) return { ok: false, error: "Chức năng khiếu nại công đang tắt" };
  const { from, to } = periodRange(input.periodKey);
  if (input.workDate && (input.workDate < from || input.workDate > to)) {
    return { ok: false, error: "Ngày khiếu nại không thuộc kỳ này" };
  }
  if (!(await nguoiTrongKy(db, input.centerId, from, to)).includes(input.userId)) {
    return { ok: false, error: "Bạn không có ngày công ở cơ sở này trong kỳ" };
  }
  const orgUnitId = await orgUnitOf(input.centerId);
  return db.$transaction(async (tx) => {
    await khoaKyCong(tx, input.centerId, input.periodKey);
    if (await kyDaKhoa(tx, input.centerId, input.periodKey)) {
      return { ok: false as const, error: "Kỳ đã chốt sổ — liên hệ quản lý để mở lại kỳ" };
    }
    const kn = await tx.attendanceDispute.create({
      data: {
        userId: input.userId, centerId: input.centerId, orgUnitId, periodKey: input.periodKey, workDate: input.workDate,
        category: input.category, critical: laKhieuNaiNghiemTrong(input.category), status: "OPEN", description: moTa,
        messages: { create: { authorId: input.userId, body: moTa, statusFrom: null, statusTo: "OPEN" } },
      },
      select: { id: true },
    });
    await writeAudit({
      actor: { id: input.userId, name: input.userName },
      module: "hr_attendance",
      entityType: "AttendanceDispute",
      entityId: kn.id,
      action: "OPEN_ATTENDANCE_DISPUTE",
      newValues: { centerId: input.centerId, periodKey: input.periodKey, category: input.category },
      reason: moTa,
      orgUnitId,
      tx,
    });
    return { ok: true as const, id: kn.id };
  });
}

/** Đọc một khiếu nại (cho action kiểm quyền theo `centerId` / chủ sở hữu trước khi chuyển trạng thái). */
export function docKhieuNai(id: string) {
  return db.attendanceDispute.findUnique({ where: { id }, select: { id: true, userId: true, centerId: true, periodKey: true, status: true } });
}

/**
 * Chuyển trạng thái. Quyền (QL: quyền ở `centerId` của khiếu nại · NV: chính chủ) do ACTION kiểm. Ở đây:
 * bảng chuyển trạng thái thuần + ghi CÓ ĐIỀU KIỆN theo trạng thái đã đọc (hai người cùng bấm ⇒ đúng một
 * người thắng, người kia nhận "vừa có người cập nhật").
 */
export async function chuyenTrangThaiKhieuNai(input: {
  disputeId: string;
  hanhDong: HanhDongKhieuNai;
  vai: "NV" | "QL";
  ghiChu: string;
  linkedRequestId: string | null;
  actor: Actor;
  now: Date;
}): Promise<Ket<{ den: TrangThaiKhieuNai; messageId: string }>> {
  const kn = await db.attendanceDispute.findUnique({ where: { id: input.disputeId } });
  if (!kn) return { ok: false, error: "Không tìm thấy khiếu nại" };
  if (input.vai === "NV" && kn.userId !== input.actor.id) return { ok: false, error: "Đây không phải khiếu nại của bạn" };
  const hienTai = kn.status as TrangThaiKhieuNai;
  const kq = chuyenKhieuNai({ hienTai, hanhDong: input.hanhDong, vai: input.vai, ghiChu: input.ghiChu });
  if (!kq.ok) return kq;
  if (input.vai === "NV" && input.hanhDong !== "RUT" && input.hanhDong !== "DONG_Y") {
    if (!(await xacNhanCongDangBat())) return { ok: false, error: "Chức năng khiếu nại công đang tắt" };
  }
  const ghiChu = input.ghiChu.trim();
  const ketLuan = kq.den === "RESOLVED" || kq.den === "REJECTED";
  return db.$transaction(async (tx) => {
    if (input.hanhDong === "KHIEU_NAI_TIEP") {
      // Mở lại khiếu nại = lại chặn khoá kỳ ⇒ cùng khoá với `lockPeriod`, và không mở lại trên kỳ đã chốt.
      await khoaKyCong(tx, kn.centerId, kn.periodKey);
      if (await kyDaKhoa(tx, kn.centerId, kn.periodKey)) return { ok: false as const, error: "Kỳ đã chốt sổ — không mở lại khiếu nại được" };
    }
    const upd = await tx.attendanceDispute.updateMany({
      where: { id: kn.id, status: hienTai },
      data: {
        status: kq.den,
        ...(input.vai === "QL" ? { handledById: input.actor.id } : {}),
        ...(ketLuan ? { resolvedAt: input.now, resolutionNote: ghiChu } : {}),
        ...(input.hanhDong === "KHIEU_NAI_TIEP" ? { reopenCount: { increment: 1 }, resolvedAt: null } : {}),
        ...(input.linkedRequestId ? { linkedRequestId: input.linkedRequestId } : {}),
      },
    });
    // Mẫu chống-đua: ghi CÓ ĐIỀU KIỆN đổi 0 dòng ⇒ commit vô hại, `return` an toàn.
    if (upd.count === 0) return { ok: false as const, error: "Khiếu nại vừa được người khác cập nhật — tải lại trang" };
    const msg = await tx.attendanceDisputeMessage.create({
      data: { disputeId: kn.id, authorId: input.actor.id, body: ghiChu || NHAN_HANH_DONG[input.hanhDong], statusFrom: hienTai, statusTo: kq.den },
      select: { id: true },
    });
    await writeAudit({
      actor: input.actor,
      module: "hr_attendance",
      entityType: "AttendanceDispute",
      entityId: kn.id,
      action: `DISPUTE_${input.hanhDong}`,
      oldValues: { status: hienTai },
      newValues: { status: kq.den, linkedRequestId: input.linkedRequestId },
      reason: ghiChu || undefined,
      orgUnitId: kn.orgUnitId,
      tx,
    });
    // `messageId` = khoá chống trùng của thông báo / ZNS cho đúng lượt chuyển này (P2.6) — thay `Date.now()`.
    return { ok: true as const, den: kq.den, messageId: msg.id };
  });
}

// ─── Báo cáo cho quản lý ────────────────────────────────────────────────────────────────────────

export type DongBaoCaoXacNhan = {
  userId: string;
  ten: string;
  trangThai: TrangThaiXacNhan;
  soKhieuNaiMo: number;
  xacNhanLuc: Date | null;
  cong: number;
};

/** Ai đã / chưa / cần xác nhận lại — tập người = `nguoiTrongKy` (đúng tập `lockPeriod` khoá). */
export async function baoCaoXacNhan(centerId: string, periodKey: PeriodKey) {
  const { from, to } = periodRange(periodKey);
  const userIds = await nguoiTrongKy(db, centerId, from, to);
  const [bang, xns, users, kns] = await Promise.all([
    docBangCong(db, { userIds, centerId, from, to }),
    db.attendanceConfirmation.findMany({ where: { centerId, periodKey, userId: { in: userIds } } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    db.attendanceDispute.findMany({
      where: { centerId, periodKey },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  const xnOf = new Map(xns.map((x) => [x.userId, x]));
  const ten = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const dong: DongBaoCaoXacNhan[] = userIds.map((uid) => {
    const rows = bang.get(uid) ?? [];
    const xn = xnOf.get(uid) ?? null;
    return {
      userId: uid,
      ten: ten.get(uid) ?? uid,
      trangThai: trangThaiXacNhan(xn, vanTayBangCong(rows)),
      soKhieuNaiMo: kns.filter((k) => k.userId === uid && (KHIEU_NAI_DANG_MO as readonly string[]).includes(k.status)).length,
      xacNhanLuc: xn?.confirmedAt ?? null,
      cong: anhChupBangCong(rows).tong.cong,
    };
  });
  return {
    dong,
    khieuNai: kns.map((k) => ({ ...k, ten: ten.get(k.userId) ?? k.userId })),
    /** P2.6 — số người nút "Mời xác nhận" sẽ mời (cùng luật với đường gửi). */
    soCanMoi: tinhCanMoi(userIds, bang, xnOf).length,
  };
}


/** Kỳ đã kết thúc / đã chốt chưa — để màn quản lý chỉ vẽ nút "Mời xác nhận" khi server sẽ nhận (luật 12). */
export async function trangThaiKyXacNhan(centerId: string, periodKey: PeriodKey, now: Date) {
  return { daKetThuc: kyDaKetThuc(periodKey, now), daKhoa: await kyDaKhoa(db, centerId, periodKey) };
}

// ─── P2.6 Mời xác nhận kỳ ────────────────────────────────────────────────────────────────────────

/**
 * MỘT luật "ai cần mời" cho cả con số trên nút (`baoCaoXacNhan`) lẫn danh sách gửi (`nguoiCanMoiXacNhan`).
 * Người không có ngày công nào ở cơ sở bị LOẠI: `xacNhanCong` từ chối họ ("Không có ngày công nào"), mời họ là
 * mời vào việc không làm được.
 */
function tinhCanMoi(
  userIds: readonly string[],
  bang: Map<string, DongCong[]>,
  xnOf: Map<string, { status: string; snapshotHash: string | null }>,
): { userId: string; vanTay: string }[] {
  const moi: { userId: string; vanTay: string }[] = [];
  for (const uid of userIds) {
    const rows = bang.get(uid) ?? [];
    if (rows.length === 0) continue;
    const vanTay = vanTayBangCong(rows);
    if (canMoiXacNhan(trangThaiXacNhan(xnOf.get(uid) ?? null, vanTay))) moi.push({ userId: uid, vanTay });
  }
  return moi;
}

/**
 * Ai cần được MỜI xác nhận kỳ — người trong kỳ (`nguoiTrongKy`, đúng tập `lockPeriod` khoá) còn
 * CHƯA_XAC_NHAN / CAN_XAC_NHAN_LAI. Mỗi người kèm VÂN TAY bảng công hiện tại: nơi gọi gắn nó vào khoá chống
 * trùng, nên bấm "mời" hai lần khi số liệu không đổi KHÔNG kêu chuông lần hai, còn số liệu đổi (người đó thành
 * "cần xác nhận lại") thì lời mời mới là một mục mới.
 *
 * Không có lịch tự động: chính sách nhắc (giờ nào, mấy lần) CHƯA chốt (D-03) ⇒ chỉ chạy khi người chốt kỳ bấm.
 * Cổng y hệt `xacNhanCong`: công tắc bật · kỳ đã kết thúc · kỳ chưa chốt — mời vào việc không làm được là lời
 * hứa suông (luật 12).
 */
export async function nguoiCanMoiXacNhan(input: {
  centerId: string;
  periodKey: PeriodKey;
  actor: Actor;
  now: Date;
}): Promise<Ket<{ moi: { userId: string; vanTay: string }[] }>> {
  if (!(await xacNhanCongDangBat())) return { ok: false, error: "Chức năng xác nhận công đang tắt" };
  if (!kyDaKetThuc(input.periodKey, input.now)) return { ok: false, error: "Kỳ chưa kết thúc — mời xác nhận sau ngày cuối tháng" };
  if (await kyDaKhoa(db, input.centerId, input.periodKey)) return { ok: false, error: "Kỳ đã chốt sổ — không mời xác nhận nữa" };
  const { from, to } = periodRange(input.periodKey);
  const userIds = await nguoiTrongKy(db, input.centerId, from, to);
  const [bang, xns] = await Promise.all([
    docBangCong(db, { userIds, centerId: input.centerId, from, to }),
    db.attendanceConfirmation.findMany({ where: { centerId: input.centerId, periodKey: input.periodKey, userId: { in: userIds } } }),
  ]);
  const moi = tinhCanMoi(userIds, bang, new Map(xns.map((x) => [x.userId, x])));
  await writeAudit({
    actor: input.actor,
    module: "hr_attendance",
    entityType: "AttendancePeriod",
    entityId: `${input.centerId}:${input.periodKey}`,
    action: "INVITE_CONFIRM_ATTENDANCE",
    newValues: { centerId: input.centerId, periodKey: input.periodKey, soNguoi: moi.length },
    orgUnitId: await orgUnitOf(input.centerId),
  });
  return { ok: true, moi };
}
