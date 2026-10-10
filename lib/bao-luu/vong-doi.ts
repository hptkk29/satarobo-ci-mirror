import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { writeAudit } from "@/lib/audit/audit-log";
import { vnAddDays, vnStartOfDay } from "@/lib/time/vn";
import { laBaoLuuBat, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { chanTuDuyet, soNgayLich } from "@/lib/bao-luu/hoso";
import { kiemGiaHan } from "@/lib/bao-luu/gia-han";
import {
  chuyenTrangThai,
  datPausedKhiBatDau,
  dongGhiDanhKhiChamDut,
  ghiSuKien,
  moLaiGhiDanhKhiKhoiPhuc,
  type NguoiThucHien,
} from "@/lib/bao-luu/chuyen-trang-thai";
import { docChinhSach, docChinhSachCron } from "@/lib/bao-luu/ngu-canh-db";
import { dungAnhChupKhiBatDau } from "@/lib/bao-luu/anh-chup-db";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { dich, LoiNhieu, type KetQua, type NguoiLam } from "@/lib/bao-luu/dich-vu";

// =============================================================================
// VÒNG ĐỜI SAU KHI BẮT ĐẦU — liên hệ · thông báo chính thức · gia hạn · quá hạn · chấm dứt · khôi phục (Phiên 5).
// Cùng khuôn `dich-vu.ts`: người gọi ĐÃ kiểm đăng nhập/quyền/tầm nhìn cơ sở; hàm ở đây kiểm CÔNG TẮC `pause.enabled` + luật nghiệp vụ,
// mọi cổng đứng TRƯỚC phép ghi đầu tiên, từ chối sau khi đã ghi = `throw`. `now` là tham số (luật 19). KHÔNG hàm nào ghi dòng tiền.
//
// Hàm do CRON gọi (`quaHan`, `chamDut`, `batDauKhiDenNgay`) nhận `nguoi = null` (hệ thống) và CŨNG kiểm công tắc: tắt cờ ⇒ cron KHÔNG
// tự chấm dứt ai (chấm dứt là phép ghi huỷ quyền lợi — không được chạy khi người vận hành đã rút cờ).
// =============================================================================

type Tx = Prisma.TransactionClient;

const COT_HO_SO = {
  id: true, status: true, type: true, studentId: true, enrollmentId: true, centerId: true, orgUnitId: true,
  startedAt: true, expectedEndAt: true, standardEndDate: true, extendedEndDate: true, extendCount: true, extendRequest: true,
  createdByUserId: true, lastContactAt: true, responseDeadline: true,
} as const;

async function nap(tx: Tx, id: string) {
  const hs = await tx.studentReserve.findUnique({ where: { id }, select: COT_HO_SO });
  if (!hs) throw new LoiNhieu(["Không tìm thấy hồ sơ bảo lưu."]);
  if (!(await laBaoLuuBat(hs.orgUnitId))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);
  return hs;
}

const nguoiThucHien = (n: NguoiLam | null): NguoiThucHien => (n ? { id: n.id, name: n.name } : null);
const TX = { timeout: 30_000, maxWait: 10_000 } as const;

// ─────────────────────────────────────────────────────────────────────────────
// LIÊN HỆ
// ─────────────────────────────────────────────────────────────────────────────

const TRANG_THAI_LIEN_HE_DUOC = ["ACTIVE", "OVERDUE", "NOTICE_SENT", "RESUME_PENDING"] as const;

/** Ghi "đã liên hệ phụ huynh". Dừng leo thang tối đa 7 ngày (Q6, `cron-ke-hoach.ts`). */
export async function ghiLienHe(
  input: { reserveId: string; ghiChu: string; henNgay: Date | null },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string }>> {
  const ghiChu = input.ghiChu.trim();
  if (ghiChu.length < 5) return { ok: false, loi: ["Ghi nội dung liên hệ (ít nhất 5 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      if (!(TRANG_THAI_LIEN_HE_DUOC as readonly string[]).includes(hs.status)) {
        throw new LoiNhieu(["Chỉ ghi liên hệ cho hồ sơ đang bảo lưu."]);
      }
      const upd = await tx.studentReserve.updateMany({ where: { id: hs.id, status: hs.status }, data: { lastContactAt: now } });
      if (upd.count !== 1) throw new LoiNhieu(["Hồ sơ vừa được người khác xử lý — tải lại trang rồi thử lại."]);
      await ghiSuKien(tx, {
        hoSo: hs, kind: "CONTACT", actor: nguoiThucHien(nguoi), at: now,
        after: { henNgay: input.henNgay ? input.henNgay.toISOString() : null }, note: ghiChu,
      });
      await writeAudit({
        tx, actor: nguoi, module: "students", entityType: "StudentReserve", entityId: hs.id, action: "BAO_LUU_CONTACT",
        newValues: { lastContactAt: now.toISOString() }, reason: ghiChu, orgUnitId: hs.orgUnitId ?? hs.centerId,
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THÔNG BÁO CHÍNH THỨC (BR-19) — OVERDUE → NOTICE_SENT, đồng hồ phản hồi bắt đầu chạy
// ─────────────────────────────────────────────────────────────────────────────

export const KENH_THONG_BAO = ["ZNS", "EMAIL", "THU_TAY"] as const;
export type KenhThongBao = (typeof KENH_THONG_BAO)[number];

/**
 * GHI NHẬN đã gửi thông báo chính thức. Hàm này KHÔNG tự gửi: nó ghi sự thật "đã gửi bằng kênh X lúc Y" và bắt đầu đồng hồ phản hồi;
 * việc gửi ZNS thật là consumer của sự kiện `bao-luu.thong-bao-chinh-thuc` (mẫu ZNS chờ Zalo duyệt — spec §G, Q5). Chỉ loại
 * PARENT/LEGACY ở trạng thái OVERDUE: CENTER không bao giờ vào nhánh quá hạn → chấm dứt (BR-23).
 */
export async function ghiThongBaoChinhThuc(
  input: { reserveId: string; kenh: KenhThongBao; ghiChu?: string | null },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string; hanPhanHoi: Date }>> {
  if (!(KENH_THONG_BAO as readonly string[]).includes(input.kenh)) return { ok: false, loi: ["Kênh thông báo không hợp lệ."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      if (hs.type === "CENTER") throw new LoiNhieu(["Bảo lưu do Trung tâm không có thông báo quá hạn."]);
      if (hs.status !== "OVERDUE") throw new LoiNhieu(["Chỉ ghi thông báo chính thức cho hồ sơ đã QUÁ HẠN (chưa gửi)."]);
      const cs = await docChinhSachCron(hs.orgUnitId);
      // Hạn phản hồi = NGÀY CUỐI còn được trả lời. Cron chấm dứt khi ngày SAU ngày này.
      const hanPhanHoi = vnStartOfDay(vnAddDays(now, cs.noticeResponseDays));
      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "NOTICE_SENT", actor: nguoiThucHien(nguoi), now, kind: "NOTICE", note: input.ghiChu?.trim() || null,
        patch: { officialNoticeSentAt: now, officialNoticeChannel: input.kenh, responseDeadline: hanPhanHoi },
        sauThem: { kenh: input.kenh, hanPhanHoi: hanPhanHoi.toISOString() },
      });
      await publishEvent(
        "bao-luu.thong-bao-chinh-thuc",
        { reserveId: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, kenh: input.kenh, hanPhanHoi: hanPhanHoi.toISOString() },
        { tx, dedupeKey: `bao-luu.notice:${hs.id}:${now.toISOString().slice(0, 10)}` },
      );
      return { ok: true as const, data: { reserveId: hs.id, hanPhanHoi } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GIA HẠN (BR-11) — đề nghị → duyệt/từ chối, hai người khác nhau (maker–checker)
// ─────────────────────────────────────────────────────────────────────────────

type DeNghiGiaHan = { requestedById: string; requestedByName: string; requestedAt: string; newEndDate: string; reason: string; vuotTran: { lyDo: string } | null };

function docDeNghi(j: Prisma.JsonValue | null): DeNghiGiaHan | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (typeof o.requestedById !== "string" || typeof o.newEndDate !== "string" || typeof o.reason !== "string") return null;
  return o as unknown as DeNghiGiaHan;
}

export async function deNghiGiaHan(
  input: { reserveId: string; denNgay: Date; lyDo: string; vuotTranLyDo?: string | null },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string }>> {
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      const cs = await docChinhSach(hs.orgUnitId);
      const kq = kiemGiaHan(
        { type: hs.type, status: hs.status, startedAt: hs.startedAt, standardEndDate: hs.standardEndDate, extendedEndDate: hs.extendedEndDate, extendCount: hs.extendCount, coDeNghiDangCho: docDeNghi(hs.extendRequest) !== null },
        { denNgay: input.denNgay, lyDo: input.lyDo, vuotTran: !!input.vuotTranLyDo },
        cs,
      );
      if (!kq.ok) throw new LoiNhieu(kq.loi);
      const de: DeNghiGiaHan = {
        requestedById: nguoi.id, requestedByName: nguoi.name, requestedAt: now.toISOString(),
        newEndDate: input.denNgay.toISOString(), reason: input.lyDo.trim(), vuotTran: input.vuotTranLyDo ? { lyDo: input.vuotTranLyDo } : null,
      };
      const upd = await tx.studentReserve.updateMany({
        where: { id: hs.id, status: hs.status, extendRequest: { equals: Prisma.DbNull } },
        data: { extendRequest: de as unknown as Prisma.InputJsonValue },
      });
      if (upd.count !== 1) throw new LoiNhieu(["Hồ sơ vừa có đề nghị gia hạn khác hoặc vừa đổi trạng thái — tải lại trang."]);
      await ghiSuKien(tx, { hoSo: hs, kind: "EXTEND_REQUEST", actor: nguoiThucHien(nguoi), at: now, after: { newEndDate: de.newEndDate }, note: de.reason });
      await writeAudit({
        tx, actor: nguoi, module: "students", entityType: "StudentReserve", entityId: hs.id, action: "BAO_LUU_EXTEND_REQUEST",
        newValues: { newEndDate: de.newEndDate }, reason: de.reason, orgUnitId: hs.orgUnitId ?? hs.centerId,
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

/** Duyệt đề nghị gia hạn. Người duyệt KHÁC người đề nghị (TC-08/09 + maker–checker). Từ OVERDUE/NOTICE_SENT thì đưa về ACTIVE. */
export async function duyetGiaHan(
  input: { reserveId: string },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string; denNgay: Date }>> {
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      const de = docDeNghi(hs.extendRequest);
      if (!de) throw new LoiNhieu(["Hồ sơ không có đề nghị gia hạn nào đang chờ."]);
      const mc = chanTuDuyet(nguoi.id, de.requestedById);
      if (mc) throw new LoiNhieu([mc.replace("duyệt hồ sơ", "duyệt đề nghị gia hạn")]);

      const cs = await docChinhSach(hs.orgUnitId);
      const denNgay = new Date(de.newEndDate);
      // Kiểm LẠI tại lúc duyệt (chính sách / hạn có thể đã đổi từ lúc đề nghị): `coDeNghiDangCho` = false vì đề nghị này chính là thứ đang duyệt.
      const kq = kiemGiaHan(
        { type: hs.type, status: hs.status, startedAt: hs.startedAt, standardEndDate: hs.standardEndDate, extendedEndDate: hs.extendedEndDate, extendCount: hs.extendCount, coDeNghiDangCho: false },
        { denNgay, lyDo: de.reason, vuotTran: !!de.vuotTran },
        cs,
      );
      if (!kq.ok) throw new LoiNhieu(kq.loi);

      const patch = {
        extendedEndDate: denNgay,
        extendCount: { increment: 1 },
        extendedById: nguoi.id,
        extendRequest: Prisma.DbNull,
        // Thông báo chính thức cũ không còn hiệu lực sau gia hạn — đồng hồ phản hồi PHẢI dừng, kẻo cron chấm dứt một hồ sơ đã được gia hạn.
        responseDeadline: null,
      } satisfies Prisma.StudentReserveUncheckedUpdateManyInput;

      if (hs.status === "ACTIVE") {
        const upd = await tx.studentReserve.updateMany({ where: { id: hs.id, status: "ACTIVE", extendCount: hs.extendCount }, data: patch });
        if (upd.count !== 1) throw new LoiNhieu(["Hồ sơ vừa được người khác xử lý — tải lại trang rồi thử lại."]);
        await ghiSuKien(tx, {
          hoSo: hs, kind: "EXTEND", actor: nguoiThucHien(nguoi), at: now,
          before: { han: (hs.extendedEndDate ?? hs.standardEndDate)?.toISOString() ?? null }, after: { han: denNgay.toISOString(), lan: hs.extendCount + 1 }, note: de.reason,
        });
        await writeAudit({
          tx, actor: nguoi, module: "students", entityType: "StudentReserve", entityId: hs.id, action: "BAO_LUU_EXTEND",
          oldValues: { han: (hs.extendedEndDate ?? hs.standardEndDate)?.toISOString() ?? null }, newValues: { han: denNgay.toISOString() }, reason: de.reason, orgUnitId: hs.orgUnitId ?? hs.centerId,
        });
      } else {
        await chuyenTrangThai(tx, {
          reserveId: hs.id, den: "ACTIVE", actor: nguoiThucHien(nguoi), now, kind: "EXTEND", note: de.reason, patch,
          sauThem: { han: denNgay.toISOString(), lan: hs.extendCount + 1 },
        });
      }
      return { ok: true as const, data: { reserveId: hs.id, denNgay } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

/** Từ chối đề nghị gia hạn — hoặc NGƯỜI ĐỀ NGHỊ tự rút. Không đổi trạng thái hồ sơ. */
export async function tuChoiGiaHan(
  input: { reserveId: string; lyDo: string },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string }>> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: ["Ghi lý do (ít nhất 5 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      const de = docDeNghi(hs.extendRequest);
      if (!de) throw new LoiNhieu(["Hồ sơ không có đề nghị gia hạn nào đang chờ."]);
      const upd = await tx.studentReserve.updateMany({ where: { id: hs.id, status: hs.status }, data: { extendRequest: Prisma.DbNull } });
      if (upd.count !== 1) throw new LoiNhieu(["Hồ sơ vừa được người khác xử lý — tải lại trang rồi thử lại."]);
      await ghiSuKien(tx, {
        hoSo: hs, kind: "EXTEND_REQUEST", actor: nguoiThucHien(nguoi), at: now,
        before: { newEndDate: de.newEndDate }, after: { tuChoi: true, rut: de.requestedById === nguoi.id }, note: lyDo,
      });
      await writeAudit({
        tx, actor: nguoi, module: "students", entityType: "StudentReserve", entityId: hs.id, action: "BAO_LUU_EXTEND_REJECT",
        oldValues: { newEndDate: de.newEndDate }, reason: lyDo, orgUnitId: hs.orgUnitId ?? hs.centerId,
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRON: QUÁ HẠN · BẮT ĐẦU · CHẤM DỨT
// ─────────────────────────────────────────────────────────────────────────────

/** ACTIVE + hạn < hôm nay ⇒ OVERDUE (BR-19). Idempotent: hồ sơ đã sang trạng thái khác thì `{ ok:false, ma:"DA_THAY_DOI" }`. */
export async function quaHan(input: { reserveId: string }, now: Date): Promise<KetQua<{ reserveId: string }>> {
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      if (hs.type === "CENTER") throw new LoiNhieu(["Bảo lưu do Trung tâm không chuyển sang quá hạn."]);
      if (hs.status !== "ACTIVE") throw new LoiNhieu(["Hồ sơ không còn ở trạng thái đang bảo lưu."]);
      const han = hs.extendedEndDate ?? hs.standardEndDate;
      if (!han || soNgayLich(now, han) >= 0) throw new LoiNhieu(["Hồ sơ chưa quá hạn."]);
      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "OVERDUE", actor: null, now, kind: "EXPIRE", note: "Hết hạn bảo lưu, chưa phục học / gia hạn",
        sauThem: { han: han.toISOString() },
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

/** APPROVED có ngày bắt đầu ≤ hôm nay ⇒ START (lưới an toàn của cron). */
export async function batDauKhiDenNgay(input: { reserveId: string }, now: Date): Promise<KetQua<{ reserveId: string }>> {
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      if (hs.status !== "APPROVED") throw new LoiNhieu(["Hồ sơ không còn ở trạng thái đã duyệt."]);
      if (vnStartOfDay(hs.startedAt).getTime() > vnStartOfDay(now).getTime()) throw new LoiNhieu(["Chưa tới ngày bắt đầu."]);
      const pc = await datPausedKhiBatDau(tx, {
        hoSo: { id: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, orgUnitId: hs.orgUnitId },
        actor: null, now, lyDo: "Bắt đầu bảo lưu",
      });
      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "ACTIVE", actor: null, now, kind: "START",
        patch: await dungAnhChupKhiBatDau(tx, { enrollmentId: hs.enrollmentId, studentId: hs.studentId, startedAt: hs.startedAt }),
        sauThem: { enrollmentStatusTruoc: pc.enrollmentTruoc },
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

/**
 * NOTICE_SENT + hết hạn phản hồi ⇒ TERMINATED (BR-20). Ghi danh ĐÓNG (`WITHDREW`), KHÔNG sinh yêu cầu hoàn, phát sự kiện
 * `bao-luu.cham-dut` cho consumer huỷ quà tặng / khoá tặng kèm / sao tích luỹ + việc thu hồi kit (TODO(bao-luu Q8): chưa có consumer).
 */
export async function chamDut(input: { reserveId: string }, now: Date): Promise<KetQua<{ reserveId: string; classId: string | null }>> {
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      if (hs.type === "CENTER") throw new LoiNhieu(["Bảo lưu do Trung tâm không tự chấm dứt."]);
      if (hs.status !== "NOTICE_SENT") throw new LoiNhieu(["Chỉ chấm dứt hồ sơ đã gửi thông báo chính thức."]);
      if (!hs.responseDeadline || soNgayLich(hs.responseDeadline, now) <= 0) throw new LoiNhieu(["Chưa hết hạn phản hồi."]);
      // Đóng ghi danh TRƯỚC, rồi ghi hệ quả vào chính sự kiện TERMINATE — để KHÔI PHỤC đọc lại đúng "học viên trước đó ở trạng thái gì"
      // (không đoán). Thứ tự này an toàn: cả hai nằm trong một giao dịch, hàm chuyển trạng thái ném thì mọi thứ cuộn ngược.
      const dong = await dongGhiDanhKhiChamDut(tx, {
        hoSo: { id: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, orgUnitId: hs.orgUnitId },
        actor: null, now, lyDo: "Chấm dứt bảo lưu: hết hạn phản hồi thông báo chính thức",
      });
      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "TERMINATED", actor: null, now, kind: "TERMINATE", note: "Hết hạn phản hồi thông báo chính thức",
        patch: { endKind: "TERMINATED", endReason: "Hết hạn phản hồi thông báo chính thức" },
        sauThem: { enrollmentTruoc: dong.enrollmentTruoc, studentTruoc: dong.studentTruoc, studentSau: dong.studentSau, khongSinhYeuCauHoan: true },
      });
      await publishEvent(
        "bao-luu.cham-dut",
        { reserveId: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, khongSinhYeuCauHoan: true },
        { tx, dedupeKey: `bao-luu.cham-dut:${hs.id}` },
      );
      return { ok: true as const, data: { reserveId: hs.id, classId: dong.classId } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KHÔI PHỤC sau chấm dứt (Q7) — ngoại lệ có chữ ký: `bao-luu:exception` + lý do ≥ 10 ký tự
// ─────────────────────────────────────────────────────────────────────────────

export async function khoiPhuc(
  input: { reserveId: string; denNgay: Date; lyDo: string },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string }>> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 10) return { ok: false, loi: ["Ghi lý do khôi phục (ít nhất 10 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await nap(tx, input.reserveId);
      if (hs.status !== "TERMINATED") throw new LoiNhieu(["Chỉ khôi phục được hồ sơ đã bị chấm dứt."]);
      const cs = await docChinhSach(hs.orgUnitId);
      const tran = hanToiDaBaoLuu(now, cs.maxMonths);
      if (soNgayLich(now, input.denNgay) <= 0) throw new LoiNhieu(["Hạn mới phải sau hôm nay."]);
      if (input.denNgay.getTime() > tran.getTime()) throw new LoiNhieu([`Hạn mới tối đa ${cs.maxMonths} tháng kể từ hôm nay.`]);

      // Trạng thái học viên TRƯỚC khi chấm dứt: đọc từ sự kiện TERMINATE (không đoán).
      const sk = await tx.studentReserveEvent.findFirst({
        where: { reserveId: hs.id, kind: "TERMINATE" }, orderBy: { at: "desc" }, select: { after: true },
      });
      const after = (sk?.after ?? null) as { studentTruoc?: string | null } | null;
      const studentTruoc = typeof after?.studentTruoc === "string" ? after.studentTruoc : null;

      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "ACTIVE", actor: nguoiThucHien(nguoi), now, kind: "RESTORE", note: lyDo,
        patch: { extendedEndDate: input.denNgay, officialNoticeSentAt: null, officialNoticeChannel: null, responseDeadline: null, lastContactAt: null },
        sauThem: { han: input.denNgay.toISOString() },
      });
      await moLaiGhiDanhKhiKhoiPhuc(tx, {
        hoSo: { id: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, orgUnitId: hs.orgUnitId },
        actor: nguoiThucHien(nguoi), now, lyDo: `Khôi phục bảo lưu: ${lyDo}`, studentTruoc,
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

