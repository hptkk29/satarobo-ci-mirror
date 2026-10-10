import "server-only";
import type { Prisma, StudentReserveEventKind } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { canTransition } from "@/lib/enrollments/status";
import {
  kiemChuyen,
  suyRaIsActive,
  type TrangThai,
} from "@/lib/bao-luu/trang-thai";

// =============================================================================
// HÀM CHUYỂN TRẠNG THÁI CỦA HỒ SƠ BẢO LƯU — NƠI DUY NHẤT ghi `status` / `isActive` của `StudentReserve` và đặt/gỡ
// `PAUSED` của `Enrollment` / `Student` (chốt 07–08/10/2026; lưới `[BL2-ISACTIVE]` + `[BL2-PAUSED]`).
//
// Luật của file này (đều có test):
//   1. MỌI chuyển đi qua `kiemChuyen` (máy trạng thái thuần) — không có cạnh nào ngoài `CHO_PHEP`.
//   2. Ghi CÓ ĐIỀU KIỆN (`updateMany … where status = trạng-thái-vừa-đọc`): hai người cùng bấm thì chỉ MỘT người
//      thắng, người kia nhận `DA_THAY_DOI` — không ghi đè lặng lẽ.
//   3. `isActive` LẤY TỪ `suyRaIsActive(status)`, người gọi không có đường truyền nó vào.
//   4. MỖI chuyển ghi MỘT `StudentReserveEvent` + MỘT `AuditLog` trong CÙNG transaction. Lỗi ở bất kỳ bước nào ⇒
//      NÉM ⇒ transaction cuộn ngược TRỌN (luật rollback: `return` không rollback, chỉ `throw`).
//   5. Người gọi ĐÃ kiểm quyền / cơ sở / công tắc / maker–checker TRƯỚC khi vào đây (mọi cổng đứng trước phép ghi đầu).
//
// `tx` PHẢI là transaction KHÔNG-scope (`db.$transaction`): qua `scopedDb` thì phép ghi vào ghi danh/học viên ở cơ sở
// khác bị bỏ sót lặng lẽ. Cổng cơ sở nằm ở cửa vào của action.
// =============================================================================

type Tx = Prisma.TransactionClient;

export type MaLoiBaoLuu =
  | "KHONG_THAY"
  | "CHUYEN_KHONG_HOP_LE"
  | "DA_THAY_DOI"
  | "GHI_DANH_KHONG_HOP_LE"
  | "DU_LIEU_KHONG_HOP_LE";

/** Lỗi nghiệp vụ có mã — action dịch sang câu tiếng Việt cho người dùng; mọi lỗi khác cứ để nổi lên (rollback). */
export class LoiBaoLuu extends Error {
  constructor(
    public readonly ma: MaLoiBaoLuu,
    message: string,
  ) {
    super(message);
    this.name = "LoiBaoLuu";
  }
}

/** Người thực hiện. `null` = hệ thống (cron). */
export type NguoiThucHien = { id: string; name: string } | null;

type CotHoSo = { id: string; centerId: string | null; orgUnitId: string | null };

/** Ghi MỘT sự kiện bất biến. Dùng cả cho việc KHÔNG đổi trạng thái (CONTACT, EXTEND_REQUEST, CONVERT_CENTER…). */
export async function ghiSuKien(
  tx: Tx,
  p: {
    hoSo: CotHoSo;
    kind: StudentReserveEventKind;
    actor: NguoiThucHien;
    at: Date;
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.studentReserveEvent.create({
    data: {
      reserveId: p.hoSo.id,
      centerId: p.hoSo.centerId,
      orgUnitId: p.hoSo.orgUnitId,
      kind: p.kind,
      actorId: p.actor?.id ?? null,
      at: p.at,
      before: p.before ?? undefined,
      after: p.after ?? undefined,
      note: p.note ?? null,
    },
  });
}

/** Cột nào người gọi KHÔNG được truyền qua `patch` — chỉ hàm này ghi chúng. */
const COT_CAM = ["status", "isActive"] as const;

export type KetQuaChuyen = { truoc: TrangThai; sau: TrangThai };

export async function chuyenTrangThai(
  tx: Tx,
  p: {
    reserveId: string;
    den: TrangThai;
    actor: NguoiThucHien;
    now: Date;
    kind: StudentReserveEventKind;
    note?: string | null;
    /** Các cột khác ghi CÙNG LÚC (approvedAt, startedAt, snap*…). KHÔNG chứa `status` / `isActive`. */
    patch?: Omit<Prisma.StudentReserveUncheckedUpdateManyInput, "status" | "isActive">;
    /** Dữ liệu thêm cho cột `after` của sự kiện. */
    sauThem?: Record<string, Prisma.InputJsonValue | null>;
  },
): Promise<KetQuaChuyen> {
  for (const cot of COT_CAM) {
    if (p.patch && cot in p.patch) throw new Error(`chuyenTrangThai: patch không được chứa "${cot}"`);
  }
  const hs = await tx.studentReserve.findUnique({
    where: { id: p.reserveId },
    select: { id: true, status: true, type: true, centerId: true, orgUnitId: true },
  });
  if (!hs) throw new LoiBaoLuu("KHONG_THAY", "Không tìm thấy hồ sơ bảo lưu.");

  const kt = kiemChuyen(hs.status, p.den, hs.type);
  if (!kt.ok) throw new LoiBaoLuu("CHUYEN_KHONG_HOP_LE", kt.ly);

  const dongLai = p.den === "ENDED" || p.den === "TERMINATED";
  const khoiPhuc = hs.status === "TERMINATED" && p.den === "ACTIVE";
  const upd = await tx.studentReserve.updateMany({
    // Điều kiện `status` là KHOÁ CHỐNG ĐUA: hai người cùng bấm, chỉ MỘT người đổi được 1 dòng.
    where: { id: p.reserveId, status: hs.status },
    data: {
      ...(p.patch ?? {}),
      status: p.den,
      isActive: suyRaIsActive(p.den),
      ...(dongLai
        ? { endedAt: p.now, endedByUserId: p.actor?.id ?? null, endedByName: p.actor?.name ?? "Hệ thống" }
        : {}),
      ...(khoiPhuc ? { endedAt: null, endedByUserId: null, endedByName: null, endKind: null } : {}),
    },
  });
  if (upd.count !== 1) {
    throw new LoiBaoLuu("DA_THAY_DOI", "Hồ sơ vừa được người khác xử lý — tải lại trang rồi thử lại.");
  }

  await ghiSuKien(tx, {
    hoSo: hs,
    kind: p.kind,
    actor: p.actor,
    at: p.now,
    before: { status: hs.status },
    after: { status: p.den, ...(p.sauThem ?? {}) },
    note: p.note ?? null,
  });
  await writeAudit({
    tx,
    actor: { id: p.actor?.id ?? null, name: p.actor?.name ?? "Hệ thống" },
    module: "students",
    entityType: "StudentReserve",
    entityId: hs.id,
    action: `BAO_LUU_${p.kind}`,
    oldValues: { status: hs.status },
    newValues: { status: p.den },
    changedFields: ["status"],
    reason: p.note ?? undefined,
    orgUnitId: hs.orgUnitId ?? hs.centerId,
  });
  return { truoc: hs.status, sau: p.den };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHẢN CHIẾU `PAUSED` xuống ghi danh / học viên
// ─────────────────────────────────────────────────────────────────────────────

type HoSoPhanChieu = CotHoSo & { studentId: string; enrollmentId: string | null };

/** Học viên có CÒN ghi danh nào đang học (chưa nghỉ) không — để quyết định `Student.status`. */
const TRANG_THAI_DANG_HOC_HOAC_CHO: readonly string[] = ["ACTIVE", "STUDYING", "CONFIRMED", "PENDING"];

/**
 * START: ghi danh → `PAUSED`; học viên → `PAUSED` KHI KHÔNG CÒN ghi danh nào đang học (một bé học hai khoá, bảo lưu
 * một khoá thì bé vẫn "Đang học"). Trả trạng thái ghi danh TRƯỚC đó để `goPausedKhiKetThuc` khôi phục ĐÚNG (ACTIVE vs STUDYING).
 */
export async function datPausedKhiBatDau(
  tx: Tx,
  p: { hoSo: HoSoPhanChieu; actor: NguoiThucHien; now: Date; lyDo: string },
): Promise<{ enrollmentTruoc: string | null; classId: string | null }> {
  const actor = { id: p.actor?.id ?? null, name: p.actor?.name ?? "Hệ thống" };
  if (!p.hoSo.enrollmentId) {
    throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Hồ sơ bảo lưu mới phải gắn một ghi danh.");
  }
  const gd = await tx.enrollment.findUnique({
    where: { id: p.hoSo.enrollmentId },
    select: { id: true, status: true, classId: true, deletedAt: true },
  });
  if (!gd || gd.deletedAt) throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Không tìm thấy ghi danh để bảo lưu.");
  if (gd.status !== "ACTIVE" && gd.status !== "STUDYING") {
    throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Ghi danh không còn ở trạng thái đang học — không bảo lưu được.");
  }

  await tx.enrollment.update({ where: { id: gd.id }, data: { status: "PAUSED" } });
  await tx.enrollmentAuditLog.create({
    data: {
      enrollmentId: gd.id,
      fromStatus: gd.status,
      toStatus: "PAUSED",
      changedByUserId: actor.id,
      changedByName: actor.name,
      reason: p.lyDo,
    },
  });
  await writeAudit({
    tx,
    actor,
    module: "students",
    entityType: "Enrollment",
    entityId: gd.id,
    action: "STATUS_CHANGE",
    oldValues: { status: gd.status },
    newValues: { status: "PAUSED" },
    changedFields: ["status"],
    reason: p.lyDo,
    orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
  });

  const hv = await tx.student.findUnique({ where: { id: p.hoSo.studentId }, select: { status: true } });
  if (hv?.status === "ACTIVE") {
    const conHoc = await tx.enrollment.count({
      where: { studentId: p.hoSo.studentId, deletedAt: null, status: { in: [...TRANG_THAI_DANG_HOC_HOAC_CHO] as never[] } },
    });
    if (conHoc === 0) {
      await tx.student.update({ where: { id: p.hoSo.studentId }, data: { status: "PAUSED" } });
      await writeAudit({
        tx,
        actor,
        module: "students",
        entityType: "Student",
        entityId: p.hoSo.studentId,
        action: "STATUS_CHANGE",
        oldValues: { status: "ACTIVE" },
        newValues: { status: "PAUSED" },
        changedFields: ["status"],
        reason: p.lyDo,
        orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
      });
    }
  }

  // Chat (luật cứng chat #5): đổi học viên của lớp ⇒ đồng bộ thành viên TRONG CÙNG giao dịch.
  await syncConversationMembership(tx, gd.classId);
  return { enrollmentTruoc: gd.status, classId: gd.classId };
}

/**
 * KẾT THÚC bảo lưu (phục học / huỷ khi đã bắt đầu / chấm dứt…): ghi danh `PAUSED` → trạng thái cũ (`truoc`, mặc định
 * `STUDYING`); học viên `PAUSED` → `ACTIVE` KHI KHÔNG CÒN hồ sơ nào khác đang nghỉ. Ghi danh KHÔNG ở `PAUSED` (đã bị
 * đổi đi chỗ khác) thì không đụng — không kéo một ghi danh đã rút lớp về đang học.
 */
export async function goPausedKhiKetThuc(
  tx: Tx,
  p: { hoSo: HoSoPhanChieu; actor: NguoiThucHien; now: Date; lyDo: string; truoc?: string | null },
): Promise<{ classId: string | null }> {
  const actor = { id: p.actor?.id ?? null, name: p.actor?.name ?? "Hệ thống" };
  let classId: string | null = null;
  if (p.hoSo.enrollmentId) {
    const gd = await tx.enrollment.findUnique({
      where: { id: p.hoSo.enrollmentId },
      select: { id: true, status: true, classId: true },
    });
    if (gd) {
      classId = gd.classId;
      if (gd.status === "PAUSED") {
        const dich = p.truoc === "ACTIVE" ? "ACTIVE" : "STUDYING";
        if (!canTransition("PAUSED", dich)) throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Không khôi phục được ghi danh.");
        await tx.enrollment.update({ where: { id: gd.id }, data: { status: dich } });
        await tx.enrollmentAuditLog.create({
          data: {
            enrollmentId: gd.id,
            fromStatus: "PAUSED",
            toStatus: dich,
            changedByUserId: actor.id,
            changedByName: actor.name,
            reason: p.lyDo,
          },
        });
        await writeAudit({
          tx,
          actor,
          module: "students",
          entityType: "Enrollment",
          entityId: gd.id,
          action: "STATUS_CHANGE",
          oldValues: { status: "PAUSED" },
          newValues: { status: dich },
          changedFields: ["status"],
          reason: p.lyDo,
          orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
        });
      }
    }
  }

  const hv = await tx.student.findUnique({ where: { id: p.hoSo.studentId }, select: { status: true } });
  if (hv?.status === "PAUSED") {
    const conHoSoKhac = await tx.studentReserve.count({
      where: { studentId: p.hoSo.studentId, isActive: true, NOT: { id: p.hoSo.id } },
    });
    const conGhiDanhPaused = await tx.enrollment.count({
      where: { studentId: p.hoSo.studentId, deletedAt: null, status: "PAUSED" },
    });
    if (conHoSoKhac === 0 && conGhiDanhPaused === 0) {
      await tx.student.update({ where: { id: p.hoSo.studentId }, data: { status: "ACTIVE" } });
      await writeAudit({
        tx,
        actor,
        module: "students",
        entityType: "Student",
        entityId: p.hoSo.studentId,
        action: "STATUS_CHANGE",
        oldValues: { status: "PAUSED" },
        newValues: { status: "ACTIVE" },
        changedFields: ["status"],
        reason: p.lyDo,
        orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
      });
    }
  }
  if (classId) await syncConversationMembership(tx, classId);
  return { classId };
}

// ─────────────────────────────────────────────────────────────────────────────
// TẠO hồ sơ — cũng ở đây để `isActive` chỉ có MỘT nơi ghi (lưới `[BL2-ISACTIVE]`)
// ─────────────────────────────────────────────────────────────────────────────

export type DuLieuTaoHoSo = Omit<Prisma.StudentReserveUncheckedCreateInput, "status" | "isActive">;

/**
 * Tạo hồ sơ ở `PENDING` (chờ duyệt) + sự kiện `REQUEST` + audit. `centerId` BẮT BUỘC (khai ở kiểu: bảng ∈
 * SCOPED_MODELS, thiếu `centerId` là hồ sơ vô hình với người cấp cơ sở — CLAUDE.md luật 5).
 */
export async function taoHoSoCho(
  tx: Tx,
  p: { data: DuLieuTaoHoSo & { centerId: string }; actor: NguoiThucHien; now: Date; note?: string | null },
): Promise<{ id: string }> {
  const hs = await tx.studentReserve.create({
    data: { ...p.data, status: "PENDING", isActive: suyRaIsActive("PENDING"), requestedAt: p.now },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  await ghiSuKien(tx, { hoSo: hs, kind: "REQUEST", actor: p.actor, at: p.now, after: { status: "PENDING" }, note: p.note ?? null });
  await writeAudit({
    tx,
    actor: { id: p.actor?.id ?? null, name: p.actor?.name ?? "Hệ thống" },
    module: "students",
    entityType: "StudentReserve",
    entityId: hs.id,
    action: "BAO_LUU_REQUEST",
    newValues: { status: "PENDING", studentId: p.data.studentId, enrollmentId: p.data.enrollmentId ?? null },
    reason: p.note ?? undefined,
    orgUnitId: hs.orgUnitId ?? hs.centerId,
  });
  return { id: hs.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHẤM DỨT (TERMINATED) · KHÔI PHỤC (RESTORE) — Phiên 5. Cũng nằm Ở ĐÂY vì chúng ghi `Enrollment.status` quanh `PAUSED`
// (lưới `[BL2-PAUSED]` chỉ cho file này mở lại `PAUSED`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CHẤM DỨT bảo lưu (BR-20): ghi danh `PAUSED` → `WITHDREW` (ghi danh ĐÓNG). Học viên → `INACTIVE` KHI KHÔNG CÒN ghi danh nào đang
 * sống (cùng quy tắc "chỉ khi hết khoá nào để học" của `datPausedKhiBatDau`). KHÔNG sinh yêu cầu hoàn (loại PARENT/LEGACY) — việc đó
 * không nằm ở đây và không được thêm vào đây.
 *
 * Trả trạng thái học viên TRƯỚC khi đổi để `moLaiGhiDanhKhiKhoiPhuc` khôi phục ĐÚNG, không đoán.
 */
export async function dongGhiDanhKhiChamDut(
  tx: Tx,
  p: { hoSo: HoSoPhanChieu; actor: NguoiThucHien; now: Date; lyDo: string },
): Promise<{ classId: string | null; enrollmentTruoc: string | null; studentTruoc: string | null; studentSau: string | null }> {
  const actor = { id: p.actor?.id ?? null, name: p.actor?.name ?? "Hệ thống" };
  let classId: string | null = null;
  let enrollmentTruoc: string | null = null;
  if (p.hoSo.enrollmentId) {
    const gd = await tx.enrollment.findUnique({ where: { id: p.hoSo.enrollmentId }, select: { id: true, status: true, classId: true } });
    if (gd) {
      classId = gd.classId;
      enrollmentTruoc = gd.status;
      if (gd.status === "PAUSED") {
        if (!canTransition("PAUSED", "WITHDREW")) throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Không đóng được ghi danh.");
        await tx.enrollment.update({ where: { id: gd.id }, data: { status: "WITHDREW" } });
        await tx.enrollmentAuditLog.create({
          data: { enrollmentId: gd.id, fromStatus: "PAUSED", toStatus: "WITHDREW", changedByUserId: actor.id, changedByName: actor.name, reason: p.lyDo },
        });
        await writeAudit({
          tx, actor, module: "students", entityType: "Enrollment", entityId: gd.id, action: "STATUS_CHANGE",
          oldValues: { status: "PAUSED" }, newValues: { status: "WITHDREW" }, changedFields: ["status"], reason: p.lyDo,
          orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
        });
      }
    }
  }

  let studentTruoc: string | null = null;
  let studentSau: string | null = null;
  const hv = await tx.student.findUnique({ where: { id: p.hoSo.studentId }, select: { status: true } });
  if (hv) {
    studentTruoc = hv.status;
    const conSong = await tx.enrollment.count({
      where: { studentId: p.hoSo.studentId, deletedAt: null, status: { in: [...TRANG_THAI_DANG_HOC_HOAC_CHO, "PAUSED"] as never[] } },
    });
    if (conSong === 0 && hv.status !== "INACTIVE") {
      await tx.student.update({ where: { id: p.hoSo.studentId }, data: { status: "INACTIVE" } });
      studentSau = "INACTIVE";
      await writeAudit({
        tx, actor, module: "students", entityType: "Student", entityId: p.hoSo.studentId, action: "STATUS_CHANGE",
        oldValues: { status: hv.status }, newValues: { status: "INACTIVE" }, changedFields: ["status"], reason: p.lyDo,
        orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
      });
    } else {
      studentSau = hv.status;
    }
  }
  if (classId) await syncConversationMembership(tx, classId);
  return { classId, enrollmentTruoc, studentTruoc, studentSau };
}

/**
 * KHÔI PHỤC sau chấm dứt (Q7: BGĐ khôi phục được): ghi danh `WITHDREW` → `PAUSED`; học viên về trạng thái TRƯỚC khi chấm dứt nếu hàm
 * chấm dứt đã đổi nó. `Enrollment` `WITHDREW` là trạng thái CUỐI của máy trạng thái (`ENROLLMENT_TRANSITIONS`) nên đây là NGOẠI LỆ
 * có chủ đích, chỉ gọi từ đường `bao-luu:exception` kèm lý do — và chỉ mở lại khi lớp còn sống (lớp đã `COMPLETED`/`CANCELLED`/xoá
 * thì phải ghi danh lại, không "sống lại" vào lớp đã đóng). TODO(bao-luu K6).
 */
export async function moLaiGhiDanhKhiKhoiPhuc(
  tx: Tx,
  p: { hoSo: HoSoPhanChieu; actor: NguoiThucHien; now: Date; lyDo: string; studentTruoc: string | null },
): Promise<{ classId: string }> {
  const actor = { id: p.actor?.id ?? null, name: p.actor?.name ?? "Hệ thống" };
  if (!p.hoSo.enrollmentId) throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Hồ sơ không gắn ghi danh nên không khôi phục được.");
  const gd = await tx.enrollment.findUnique({
    where: { id: p.hoSo.enrollmentId },
    select: { id: true, status: true, classId: true, deletedAt: true, class: { select: { status: true, deletedAt: true } } },
  });
  if (!gd || gd.deletedAt) throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Ghi danh không còn — hãy ghi danh lại.");
  if (gd.status !== "WITHDREW") {
    throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Ghi danh không còn ở trạng thái đã đóng do chấm dứt bảo lưu — kiểm tra lại trước khi khôi phục.");
  }
  if (!gd.class || gd.class.deletedAt || gd.class.status === "COMPLETED" || gd.class.status === "CANCELLED") {
    throw new LoiBaoLuu("GHI_DANH_KHONG_HOP_LE", "Lớp đã kết thúc — không mở lại ghi danh được, hãy ghi danh vào lớp khác.");
  }
  await tx.enrollment.update({ where: { id: gd.id }, data: { status: "PAUSED" } });
  await tx.enrollmentAuditLog.create({
    data: { enrollmentId: gd.id, fromStatus: "WITHDREW", toStatus: "PAUSED", changedByUserId: actor.id, changedByName: actor.name, reason: p.lyDo },
  });
  await writeAudit({
    tx, actor, module: "students", entityType: "Enrollment", entityId: gd.id, action: "STATUS_CHANGE",
    oldValues: { status: "WITHDREW" }, newValues: { status: "PAUSED" }, changedFields: ["status"], reason: p.lyDo,
    orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
  });

  const hv = await tx.student.findUnique({ where: { id: p.hoSo.studentId }, select: { status: true } });
  if (hv?.status === "INACTIVE" && p.studentTruoc && p.studentTruoc !== "INACTIVE") {
    await tx.student.update({ where: { id: p.hoSo.studentId }, data: { status: p.studentTruoc as never } });
    await writeAudit({
      tx, actor, module: "students", entityType: "Student", entityId: p.hoSo.studentId, action: "STATUS_CHANGE",
      oldValues: { status: "INACTIVE" }, newValues: { status: p.studentTruoc }, changedFields: ["status"], reason: p.lyDo,
      orgUnitId: p.hoSo.orgUnitId ?? p.hoSo.centerId,
    });
  }
  await syncConversationMembership(tx, gd.classId);
  return { classId: gd.classId };
}

// ────────────────────────────────────────────────────────────────
// NHẬP CA LEGACY (Phiên 8, K14) — cũng ở đây vì nó GHI `status`/`isActive` (lưới `[BL2-ISACTIVE]`).
// Dòng cũ / ghi danh PAUSED không hồ sơ trở thành hồ sơ ĐỜI MỚI (`approvedAt ≠ NULL`, ACTIVE) NGAY — không qua PENDING/APPROVED vì chính người
// duyệt là người nhập, đơn đã ký nằm trong tay, và ca đã xảy ra trước quy chế. Mọi cổng (quyền, cờ, đơn, ngày hiệu lực) đứng ở `legacy-nhap.ts`.
// ────────────────────────────────────────────────────────────────

export async function ghiHoSoNhapLegacy(
  tx: Tx,
  p: {
    /** `null` = tạo dòng mới (nhóm B, C); có id = bổ sung dòng cũ còn mở (nhóm A). */
    reserveId: string | null;
    nhom: "A" | "B" | "C";
    data: {
      studentId: string;
      enrollmentId: string;
      centerId: string;
      orgUnitId: string | null;
      startedAt: Date;
      standardEndDate: Date;
      applicationFileKey: string;
      policySnapshot: Prisma.InputJsonValue;
      /** Cột ảnh chụp quyền lợi (BR-14) — phục học dùng `snapStoppedAtLessonOrder` để gợi ý lớp. */
      anhChup: Prisma.StudentReserveUncheckedUpdateInput;
      hieuLucQuyChe: string;
    };
    actor: { id: string; name: string };
    now: Date;
  },
): Promise<{ id: string }> {
  const d = p.data;
  const chung = {
    type: "LEGACY" as const,
    status: "ACTIVE" as const,
    isActive: suyRaIsActive("ACTIVE"),
    enrollmentId: d.enrollmentId,
    centerId: d.centerId,
    orgUnitId: d.orgUnitId,
    startedAt: d.startedAt,
    standardEndDate: d.standardEndDate,
    approvedAt: p.now,
    approvedById: p.actor.id,
    applicationFileKey: d.applicationFileKey,
    policySnapshot: d.policySnapshot,
    ...d.anhChup,
  };
  let id: string;
  if (p.reserveId) {
    // CÓ ĐIỀU KIỆN: chỉ dòng còn mở và chưa từng được xử lý — hai người nhập cùng lúc thì một người thắng.
    const r = await tx.studentReserve.updateMany({
      where: { id: p.reserveId, isActive: true, endedAt: null, approvedAt: null },
      data: chung as Prisma.StudentReserveUncheckedUpdateManyInput,
    });
    if (r.count !== 1) throw new LoiBaoLuu("DA_THAY_DOI", "Dòng bảo lưu cũ vừa được xử lý hoặc đã kết thúc — tải lại trang.");
    id = p.reserveId;
  } else {
    const hs = await tx.studentReserve.create({
      data: {
        ...(chung as Prisma.StudentReserveUncheckedCreateInput),
        studentId: d.studentId,
        reason: "Nhập ca bảo lưu cũ (LEGACY) theo thoả thuận trước quy chế",
        requestedAt: p.now,
        createdByUserId: p.actor.id,
        createdByName: p.actor.name,
      },
      select: { id: true },
    });
    id = hs.id;
  }
  const cot = { id, centerId: d.centerId, orgUnitId: d.orgUnitId };
  await ghiSuKien(tx, {
    hoSo: cot,
    kind: "START",
    actor: p.actor,
    at: p.now,
    before: p.reserveId ? { approvedAt: null } : null,
    after: { status: "ACTIVE", nguon: "NHAP_LEGACY", nhom: p.nhom, ngayBatDau: d.startedAt.toISOString(), hieuLucQuyChe: d.hieuLucQuyChe },
    note: "Nhập ca LEGACY",
  });
  await writeAudit({
    tx,
    actor: p.actor,
    module: "students",
    entityType: "StudentReserve",
    entityId: id,
    action: "BAO_LUU_NHAP_LEGACY",
    newValues: { nhom: p.nhom, studentId: d.studentId, enrollmentId: d.enrollmentId, startedAt: d.startedAt.toISOString(), standardEndDate: d.standardEndDate.toISOString() },
    reason: "Nhập ca bảo lưu cũ vào quy chế SR.QD.236",
    orgUnitId: d.orgUnitId ?? d.centerId,
  });
  return { id };
}
