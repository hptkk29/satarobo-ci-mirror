// lib/hoa-hong/khieu-nai.ts — DỊCH VỤ KHIẾU NẠI hoa hồng: tạo · nhận/giao lại · quyết định · đóng.
//
// Nguồn: docs/source-commission/04 §15, 02 §9.5, 05 AC-DSP-01..07 + §1.2 (đích), §4 (audit), docs/source-commission/06 §5.5.
//
//   OPEN ──nhận──▶ UNDER_REVIEW ──┬─duyệt (sửa nguồn)────▶ APPROVED ──(có dòng SOURCE_CORRECTION)──▶ CLOSED
//                                 ├─duyệt (điều chỉnh tiền)▶ APPROVED ─┐ (cùng giao dịch: dòng DISPUTE_ADJUSTMENT đã ghi ⇒ hệ thống đóng ngay)
//                                 └─từ chối────────────────▶ REJECTED ─┘ (hệ thống đóng ngay sau từ chối)
//
// ⚠️ Service này KHÔNG phải cổng quyền chức năng duy nhất: Server Action (`app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions.ts`) gác
// `assertPermission(KEY)` ngay đầu hàm. Service kiểm LẠI bằng `can(actor, KEY)` (lớp dưới) và tự gác PHẠM VI + QUAN HỆ + DANH TÍNH:
// `scopedDb` không che ghi (CLAUDE.md luật 5), và "người duyệt ≠ người khiếu nại" là phép so danh tính mà quyền không biểu diễn được.
//
// ── Luật bất di bất dịch ───────────────────────────────────────────────────────────────────────────────────
//   1. Từ chối = `throw` TRƯỚC phép ghi đầu tiên (CLAUDE.md "Luật rollback"). Sau phép ghi đầu, chỉ `throw` (rollback).
//   2. NỘI DUNG đã gửi (`reason`, `evidence`) không bao giờ bị ghi lại — không `update` nào chạm hai cột này; DB còn trigger gác.
//   3. Dòng điều chỉnh tiền đi qua `ghiDong` của `ghi-so.ts` (đường ghi sổ DUY NHẤT), CÙNG giao dịch với quyết định ⇒ quyết định và tiền
//      cùng thành hoặc cùng bại. Dòng gốc KHÔNG đổi. Ghi vào kỳ OPEN, KHÔNG mở lại kỳ đã đóng (H22).
//   4. Khiếu nại mở KHÔNG chặn khoá kỳ (04 §12.1) — service này không tạo hàng chờ `CommissionHold` nào.
//   5. Mọi bước có AuditLog trong CÙNG giao dịch. Thông báo gửi SAU commit (ở tầng action), không nằm ở đây.
import { randomUUID } from "node:crypto";

import type { CommissionDispute, Prisma, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { resolveActorUncached, type Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { passesScope } from "@/lib/db-scope";

import type { BoiCanhQuet } from "./boi-canh";
import { kyTuNhienCua } from "./but-toan";
import { chayTrongKhoa } from "./ghi-so";
import { khoaNguoi } from "./khoa-so";
import { demDongDoiNguonSauKhiGui, docDichDeTao } from "./khieu-nai-dich";
import { dungDongDieuChinhKhieuNai } from "./khieu-nai-dieu-chinh";
import { kiemDauVaoQuyet, kiemDauVaoTao, type DauVaoQuyet, type LoiTruong } from "./khieu-nai-dau-vao";
import { ENTITY_KHIEU_NAI, HANH_DONG_KHIEU_NAI, KEY_DUYET_KHIEU_NAI, KEY_TAO_KHIEU_NAI, MODULE_AUDIT_HOA_HONG } from "./khieu-nai-ma";
import { batChuyenTrangThai, type TrangThaiKhieuNai } from "./khieu-nai-trang-thai";
import { HoaHongError } from "./kieu";
import { docTrangThaiO } from "./o-tinh-db";
import { kyChanCua } from "./quet-khoan";

/** Người thao tác khiếu nại — `userId` BẮT BUỘC (khác `NguoiThaoTacKy` của kỳ: ở đây không có thao tác của hệ thống do người gọi). */
export type NguoiKhieuNai = { userId: string; ten: string; quyen: Actor };

const HE_THONG = { id: null as string | null, name: "Hệ thống" };
const actorAudit = (n: NguoiKhieuNai) => ({ id: n.userId, name: n.ten });

type Tx = Prisma.TransactionClient;

export const CAU_KHONG_TIM_THAY_KHIEU_NAI = "Không tìm thấy khiếu nại.";

const loiDuLieu = (loi: LoiTruong[]) => new HoaHongError("DU_LIEU_KHONG_HOP_LE", loi[0]?.thongBao ?? "Dữ liệu không hợp lệ.", loi);
const loiO = (truong: string, thongBao: string) => loiDuLieu([{ truong, thongBao }]);

/** Khoá hàng khiếu nại `FOR UPDATE` và trả trạng thái HIỆN TẠI — gọi TRONG transaction, TRƯỚC phép ghi đầu tiên. */
async function khoaHang(tx: Tx, id: string): Promise<{ status: TrangThaiKhieuNai; assignedToUserId: string | null }> {
  const r = await tx.$queryRaw<{ status: TrangThaiKhieuNai; assignedToUserId: string | null }[]>`
    SELECT "status"::text AS "status", "assignedToUserId" FROM "CommissionDispute" WHERE "id" = ${id} FOR UPDATE`;
  if (r.length === 0) throw new HoaHongError("KHONG_TIM_THAY_KHIEU_NAI", CAU_KHONG_TIM_THAY_KHIEU_NAI);
  return r[0]!;
}

// ═══════════════════════════ TẠO ═══════════════════════════

export type KetQuaTao = {
  disputeId: string;
  centerId: string;
  orgUnitId: string;
  dich: { loai: "DONG" | "KHOAN"; id: string };
  /** Kỳ hiệu lực của đích — cho thông báo. */
  ky: string;
};

/**
 * Mở một khiếu nại. Đích: dòng sổ CỦA MÌNH, hoặc khoản thu "lẽ ra tôi được hưởng" mà mình có quan hệ (05 §1.2).
 * Cùng người + cùng đích mà còn khiếu nại ĐANG MỞ ⇒ từ chối (không đẻ bản thứ hai); khoá advisory theo (người × đích) để hai cú bấm đồng thời không lọt.
 */
export async function taoKhieuNai(client: PrismaClient, i: { nguoi: NguoiKhieuNai; dauVao: unknown }): Promise<KetQuaTao> {
  // Lớp dưới của cổng action: người gửi phải GIỮ quyền xem hoa hồng của mình — người không có (vd phụ huynh, tài khoản chưa neo vai) không có "dòng của mình" để khiếu nại.
  if (!can(i.nguoi.quyen, KEY_TAO_KHIEU_NAI)) {
    throw new HoaHongError("KHONG_CO_QUYEN", `Bạn không có quyền gửi khiếu nại hoa hồng (${KEY_TAO_KHIEU_NAI}).`);
  }
  const kiem = kiemDauVaoTao(i.dauVao);
  if (!kiem.ok) throw loiDuLieu(kiem.loi);
  const { dich, lyDo, bangChung } = kiem.value;

  const d = await docDichDeTao(client, i.nguoi.userId, dich);

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hoa-hong:khieu-nai:${i.nguoi.userId}:${dich.loai}:${dich.id}`})::bigint)`;
    const dangMo = await tx.commissionDispute.count({
      where: {
        raisedByUserId: i.nguoi.userId,
        status: { in: ["OPEN", "UNDER_REVIEW"] },
        ...(d.transactionId ? { transactionId: d.transactionId } : { paymentId: d.paymentId }),
      },
    });
    if (dangMo > 0) {
      throw new HoaHongError("DA_CO_KHIEU_NAI_DANG_MO", "Bạn đã có một khiếu nại đang xử lý cho mục này — chờ kết quả trước khi gửi thêm.");
    }
    const ban = await tx.commissionDispute.create({
      data: {
        transactionId: d.transactionId,
        paymentId: d.paymentId,
        raisedByUserId: i.nguoi.userId,
        reason: lyDo,
        evidence: bangChung as unknown as Prisma.InputJsonValue,
        status: "OPEN",
        centerId: d.centerId,
        orgUnitId: d.orgUnitId,
      },
      select: { id: true },
    });
    await writeAudit({
      actor: actorAudit(i.nguoi),
      module: MODULE_AUDIT_HOA_HONG,
      entityType: ENTITY_KHIEU_NAI,
      entityId: ban.id,
      action: HANH_DONG_KHIEU_NAI.TAO,
      oldValues: null,
      // CỐ Ý không ghi `reason`/`evidence` vào audit: nội dung có thể chứa PII, và nó đã nằm bất biến ở chính bảng khiếu nại.
      newValues: { status: "OPEN", dich: dich.loai, ...(d.transactionId ? { transactionId: d.transactionId } : { paymentId: d.paymentId }), centerId: d.centerId },
      orgUnitId: d.orgUnitId,
      tx,
    });
    return { disputeId: ban.id, centerId: d.centerId, orgUnitId: d.orgUnitId, dich, ky: d.ky };
  });
}

// ═══════════════════════════ CỔNG CHUNG CỦA NGƯỜI DUYỆT ═══════════════════════════

/**
 * Đọc khiếu nại + gác người duyệt: (1) khiếu nại tồn tại VÀ trong phạm vi (id ngoài phạm vi ⇒ cùng câu "không tìm thấy" — IDOR),
 * (2) người này giữ quyền duyệt, (3) người này KHÔNG phải người khiếu nại. Mọi lỗi ném TRƯỚC phép ghi đầu tiên.
 */
async function docDeXuLy(client: PrismaClient | Tx, id: string, nguoi: NguoiKhieuNai): Promise<CommissionDispute> {
  const d = await client.commissionDispute.findUnique({ where: { id } });
  if (!d || !passesScope("CommissionDispute", { centerId: d.centerId }, nguoi.quyen)) {
    throw new HoaHongError("KHONG_TIM_THAY_KHIEU_NAI", CAU_KHONG_TIM_THAY_KHIEU_NAI);
  }
  if (!can(nguoi.quyen, KEY_DUYET_KHIEU_NAI)) {
    throw new HoaHongError("KHONG_CO_QUYEN", `Bạn không có quyền xử lý khiếu nại hoa hồng (${KEY_DUYET_KHIEU_NAI}).`);
  }
  if (d.raisedByUserId === nguoi.userId) {
    throw new HoaHongError("NGUOI_DUYET_LA_NGUOI_KHIEU_NAI", "Bạn không thể xử lý khiếu nại do chính mình gửi — nhờ một người duyệt khác.");
  }
  return d;
}

// ═══════════════════════════ NHẬN · GIAO LẠI ═══════════════════════════

export type KetQuaNhan = { loai: "DA_NHAN" | "DA_GIAO_LAI"; disputeId: string; nguoiXuLyId: string; centerId: string; raisedByUserId: string };

/**
 * Nhận xử lý (OPEN → UNDER_REVIEW) hoặc GIAO LẠI cho HR khác (đang UNDER_REVIEW, đổi người, giữ trạng thái).
 * Người được giao phải GIỮ quyền duyệt trong phạm vi của khiếu nại và không phải người khiếu nại.
 */
export async function nhanKhieuNai(
  client: PrismaClient,
  i: { disputeId: string; nguoi: NguoiKhieuNai; nguoiNhanId?: string | null; now: Date },
): Promise<KetQuaNhan> {
  const d = await docDeXuLy(client, i.disputeId, i.nguoi);
  const nguoiNhanId = i.nguoiNhanId && i.nguoiNhanId.length > 0 ? i.nguoiNhanId : i.nguoi.userId;

  if (nguoiNhanId === d.raisedByUserId) {
    throw new HoaHongError("NGUOI_DUYET_LA_NGUOI_KHIEU_NAI", "Không giao khiếu nại cho chính người đã gửi nó.");
  }
  if (nguoiNhanId !== i.nguoi.userId) {
    const a = await resolveActorUncached(nguoiNhanId);
    if (!can(a, KEY_DUYET_KHIEU_NAI) || !passesScope("CommissionDispute", { centerId: d.centerId }, a)) {
      throw new HoaHongError("NGUOI_NHAN_KHONG_DU_QUYEN", `Người được giao không giữ quyền xử lý khiếu nại hoa hồng (${KEY_DUYET_KHIEU_NAI}) ở cơ sở này.`);
    }
  }

  const giaoLai = d.status === "UNDER_REVIEW";
  if (giaoLai) {
    if (d.assignedToUserId === nguoiNhanId) throw new HoaHongError("DA_DANG_XU_LY", "Khiếu nại đang do người này xử lý rồi.");
  } else {
    batChuyenTrangThai(d.status, "UNDER_REVIEW");
  }

  await client.$transaction(async (tx) => {
    const cu = await khoaHang(tx, d.id);
    if (cu.status !== d.status) throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    const r = await tx.commissionDispute.updateMany({
      where: { id: d.id, status: d.status },
      data: { status: "UNDER_REVIEW", assignedToUserId: nguoiNhanId, assignedAt: i.now },
    });
    if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    await writeAudit({
      actor: actorAudit(i.nguoi),
      module: MODULE_AUDIT_HOA_HONG,
      entityType: ENTITY_KHIEU_NAI,
      entityId: d.id,
      action: giaoLai ? HANH_DONG_KHIEU_NAI.GIAO_LAI : HANH_DONG_KHIEU_NAI.NHAN,
      oldValues: { status: d.status, assignedToUserId: d.assignedToUserId },
      newValues: { status: "UNDER_REVIEW", assignedToUserId: nguoiNhanId },
      orgUnitId: d.orgUnitId,
      tx,
    });
  });
  return { loai: giaoLai ? "DA_GIAO_LAI" : "DA_NHAN", disputeId: d.id, nguoiXuLyId: nguoiNhanId, centerId: d.centerId, raisedByUserId: d.raisedByUserId };
}

// ═══════════════════════════ QUYẾT ĐỊNH ═══════════════════════════

export type KetQuaQuyet =
  | { loai: "DA_TU_CHOI"; disputeId: string; centerId: string; raisedByUserId: string }
  | { loai: "DA_DUYET_DOI_NGUON"; disputeId: string; centerId: string; raisedByUserId: string }
  | {
      loai: "DA_DUYET_TIEN";
      disputeId: string;
      centerId: string;
      raisedByUserId: string;
      dongDieuChinhId: string;
      soTien: number;
      kyGhi: string;
      lateArrival: boolean;
    };

/**
 * Quyết định một khiếu nại ĐANG XEM XÉT (UNDER_REVIEW). Chỉ NGƯỜI ĐANG XỬ LÝ được quyết — người khác muốn quyết phải nhận lại (giao lại) trước.
 * `bc` (bối cảnh quét) cấp mốc cutover + đồng hồ + id vai; chỉ DUYỆT_TIỀN dùng tới nó nhưng tham số BẮT BUỘC (luật 7).
 */
export async function quyetDinhKhieuNai(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { disputeId: string; nguoi: NguoiKhieuNai; dauVao: unknown },
): Promise<KetQuaQuyet> {
  const kiem = kiemDauVaoQuyet(i.dauVao);
  if (!kiem.ok) throw loiDuLieu(kiem.loi);
  const qd = kiem.value;

  const d = await docDeXuLy(client, i.disputeId, i.nguoi);
  if (d.status === "OPEN") throw new HoaHongError("CHUA_NHAN", "Hãy nhận xử lý khiếu nại này trước khi quyết định.");
  batChuyenTrangThai(d.status, qd.loai === "TU_CHOI" ? "REJECTED" : "APPROVED");
  if (d.assignedToUserId !== i.nguoi.userId) {
    throw new HoaHongError("KHONG_PHAI_NGUOI_XU_LY", "Khiếu nại đang do người khác xử lý — nhận lại khiếu nại trước khi quyết định.");
  }

  if (qd.loai === "DUYET_TIEN") return duyetTien(client, bc, d, i.nguoi, qd);
  return quyetKhongTien(client, bc.now, d, i.nguoi, qd);
}

/** Từ chối · duyệt "sửa nguồn": không ghi sổ, chỉ đổi khiếu nại (+ đóng ngay nếu từ chối). */
async function quyetKhongTien(
  client: PrismaClient,
  now: Date,
  d: CommissionDispute,
  nguoi: NguoiKhieuNai,
  qd: Extract<DauVaoQuyet, { loai: "TU_CHOI" | "DUYET_DOI_NGUON" }>,
): Promise<KetQuaQuyet> {
  const tuChoi = qd.loai === "TU_CHOI";
  await client.$transaction(async (tx) => {
    const cu = await khoaHang(tx, d.id);
    if (cu.status !== "UNDER_REVIEW" || cu.assignedToUserId !== nguoi.userId) {
      throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    }
    const r = await tx.commissionDispute.updateMany({
      where: { id: d.id, status: "UNDER_REVIEW", assignedToUserId: nguoi.userId },
      data: {
        status: tuChoi ? "REJECTED" : "APPROVED",
        resolution: tuChoi ? null : "SOURCE_CORRECTION",
        decisionReason: qd.lyDo,
        decidedById: nguoi.userId,
        decidedAt: now,
      },
    });
    if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    await writeAudit({
      actor: actorAudit(nguoi),
      module: MODULE_AUDIT_HOA_HONG,
      entityType: ENTITY_KHIEU_NAI,
      entityId: d.id,
      action: HANH_DONG_KHIEU_NAI.QUYET,
      oldValues: { status: "UNDER_REVIEW" },
      newValues: { status: tuChoi ? "REJECTED" : "APPROVED", resolution: tuChoi ? null : "SOURCE_CORRECTION" },
      reason: qd.lyDo,
      orgUnitId: d.orgUnitId,
      tx,
    });
    if (tuChoi) await dongTuDong(tx, d, "REJECTED", now);
  });
  return { loai: tuChoi ? "DA_TU_CHOI" : "DA_DUYET_DOI_NGUON", disputeId: d.id, centerId: d.centerId, raisedByUserId: d.raisedByUserId };
}

/** Hệ thống đóng khiếu nại ngay trong giao dịch quyết định (04 §15: "khi dòng điều chỉnh đã ghi, hoặc sau từ chối"). */
async function dongTuDong(tx: Tx, d: CommissionDispute, tu: "APPROVED" | "REJECTED", now: Date): Promise<void> {
  batChuyenTrangThai(tu, "CLOSED");
  const r = await tx.commissionDispute.updateMany({ where: { id: d.id, status: tu }, data: { status: "CLOSED", closedAt: now } });
  if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
  await writeAudit({
    actor: HE_THONG,
    module: MODULE_AUDIT_HOA_HONG,
    entityType: ENTITY_KHIEU_NAI,
    entityId: d.id,
    action: HANH_DONG_KHIEU_NAI.DONG,
    oldValues: { status: tu },
    newValues: { status: "CLOSED" },
    reason: tu === "REJECTED" ? "Đóng sau khi từ chối" : "Đóng sau khi dòng điều chỉnh đã ghi",
    orgUnitId: d.orgUnitId,
    tx,
  });
}

async function duyetTien(
  client: PrismaClient,
  bc: BoiCanhQuet,
  d: CommissionDispute,
  nguoi: NguoiKhieuNai,
  qd: Extract<DauVaoQuyet, { loai: "DUYET_TIEN" }>,
): Promise<KetQuaQuyet> {
  // ── ĐỌC (ngoài giao dịch; số liệu quyết định được NẠP LẠI sau khoá) ──────────────────────────────
  const laDichDong = d.transactionId !== null;
  if (laDichDong && (qd.mauDongId !== null || qd.roleCode !== null)) {
    throw loiDuLieu([{ truong: qd.mauDongId !== null ? "mauDongId" : "roleCode", thongBao: "Khiếu nại về một dòng hoa hồng điều chỉnh đúng người và vai của dòng đó — không chọn thêm." }]);
  }
  const mau = laDichDong
    ? await client.commissionTransaction.findUnique({ where: { id: d.transactionId! } })
    : qd.mauDongId
      ? await client.commissionTransaction.findFirst({ where: { id: qd.mauDongId, paymentId: d.paymentId } })
      : null;
  if (!mau) {
    throw laDichDong
      ? new HoaHongError("DONG_KHONG_TON_TAI", "Dòng sổ bị khiếu nại không còn tồn tại.")
      : loiO("mauDongId", "Chọn một dòng hoa hồng của khoản thu này để lấy ngữ cảnh (đơn, học viên, kỳ hiệu lực).");
  }

  let nguoiNhan: Parameters<typeof dungDongDieuChinhKhieuNai>[0]["nguoiNhan"] = null;
  if (!laDichDong) {
    if (!qd.roleCode) throw loiO("roleCode", "Chọn vai mà người khiếu nại lẽ ra được hưởng.");
    const [vai, nguoiKn] = await Promise.all([
      client.beneficiaryRole.findUnique({ where: { code: qd.roleCode }, select: { id: true, code: true, resolverType: true, isActive: true } }),
      client.user.findUnique({ where: { id: d.raisedByUserId }, select: { id: true, name: true, email: true, employeeId: true } }),
    ]);
    if (!vai || !vai.isActive) throw loiO("roleCode", "Vai hưởng không hợp lệ hoặc đã tắt.");
    if (!nguoiKn) throw new HoaHongError("NGUOI_KHIEU_NAI_KHONG_TON_TAI", "Không đọc được người khiếu nại.");
    nguoiNhan = {
      nguoi: { userId: nguoiKn.id, employeeId: nguoiKn.employeeId, ten: nguoiKn.name ?? nguoiKn.email ?? nguoiKn.id },
      vai: { id: vai.id, code: vai.code, resolverType: vai.resolverType },
    };
  }
  if (qd.soTien < 0 && mau.calcSlotId === null) {
    throw loiO("soTien", "Không đòi lại (số âm) trên dòng không có ô tính — không có số ròng nào để đối chiếu.");
  }

  const kyNatural = kyTuNhienCua(bc.now);
  const ky = await kyChanCua(client, bc, kyNatural, { centerId: d.centerId, orgUnitId: d.orgUnitId });
  const idDong = randomUUID();

  // ── GHI (một giao dịch: dòng điều chỉnh + quyết định + đóng + audit) ──────────────────────────────
  return chayTrongKhoa(client, { khoaKhoan: mau.paymentId ? [mau.paymentId] : [], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaQuyet> => {
    const tx = h.tx;
    // Cổng (không ghi gì):
    const cu = await khoaHang(tx, d.id);
    if (cu.status !== "UNDER_REVIEW" || cu.assignedToUserId !== nguoi.userId) {
      throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    }
    if (mau.calcSlotId) {
      await h.khoaO([mau.calcSlotId]);
      if (qd.soTien < 0) {
        // Không đòi lại quá số ròng đã ghi của (ô × vai × người) — DB cũng có trigger; ở đây trả câu người đọc hiểu được.
        const o = (await docTrangThaiO(tx, [mau.calcSlotId])).get(mau.calcSlotId);
        const khoa = nguoiNhan
          ? khoaNguoi(nguoiNhan.vai.code, "USER", nguoiNhan.nguoi.userId)
          : khoaNguoi(mau.roleCode, mau.beneficiaryKind, (mau.beneficiaryKind === "USER" ? mau.beneficiaryUserId : mau.beneficiaryAffiliateId) ?? "-");
        const rong = o?.rong.get(khoa) ?? 0;
        if (rong + qd.soTien < 0) {
          throw loiO("soTien", `Không đòi lại quá số đã ghi: số ròng hiện tại của người này ở ô tính là ${rong} đồng.`);
        }
      }
    }
    await h.khoaKyDeGhi([ky.id]);

    // Phép ghi đầu tiên.
    const dong = dungDongDieuChinhKhieuNai({
      id: idDong,
      disputeId: d.id,
      mau,
      nguoiNhan,
      soTien: qd.soTien,
      lyDoQuyetDinh: qd.lyDo,
      periodId: ky.id,
      lateArrival: ky.period !== mau.naturalPeriod,
    });
    const g = await h.ghiDong([dong]);
    if (g.daGhi !== 1) throw new HoaHongError("DA_QUYET_TRUOC", "Dòng điều chỉnh của khiếu nại này đã được ghi — không ghi lần hai.");

    const r = await tx.commissionDispute.updateMany({
      where: { id: d.id, status: "UNDER_REVIEW", assignedToUserId: nguoi.userId },
      data: { status: "APPROVED", resolution: "MONEY_ADJUSTMENT", decisionReason: qd.lyDo, decidedById: nguoi.userId, decidedAt: bc.now, resolutionEntryId: idDong },
    });
    if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    await writeAudit({
      actor: actorAudit(nguoi),
      module: MODULE_AUDIT_HOA_HONG,
      entityType: ENTITY_KHIEU_NAI,
      entityId: d.id,
      action: HANH_DONG_KHIEU_NAI.QUYET,
      oldValues: { status: "UNDER_REVIEW" },
      newValues: { status: "APPROVED", resolution: "MONEY_ADJUSTMENT", dongDieuChinhId: idDong, kyGhi: ky.period },
      reason: qd.lyDo,
      orgUnitId: d.orgUnitId,
      tx,
    });
    await dongTuDong(tx, d, "APPROVED", bc.now);
    return {
      loai: "DA_DUYET_TIEN",
      disputeId: d.id,
      centerId: d.centerId,
      raisedByUserId: d.raisedByUserId,
      dongDieuChinhId: idDong,
      soTien: qd.soTien,
      kyGhi: ky.period,
      lateArrival: ky.period !== mau.naturalPeriod,
    };
  });
}

// ═══════════════════════════ ĐÓNG (đường "sửa nguồn") ═══════════════════════════

/**
 * Đóng khiếu nại đã duyệt theo cách "SỬA NGUỒN": chỉ đóng được khi ĐÃ CÓ dòng `SOURCE_CORRECTION` của khoản thu sinh ra SAU lúc khiếu nại được GỬI — tức
 * luồng đổi nguồn (03) thật sự đã chạy và đã ghi tiền. Mốc là `createdAt` của khiếu nại (giờ DB), KHÔNG phải `decidedAt` (giờ ứng dụng): so hai đồng hồ
 * khác nhau thì lệch vài mili-giây giữa máy ứng dụng và máy DB là đủ để một dòng đúng bị coi là "cũ" và khiếu nại không đóng được. Dòng đổi nguồn xảy ra
 * giữa lúc gửi và lúc duyệt vẫn tính: người duyệt thấy nó đã được sửa rồi mới bấm "duyệt — sửa nguồn", và việc cần làm đã xong. Không có dòng ⇒ từ chối (đóng khống là xoá dấu vết một việc chưa làm).
 * Hai đường kia (điều chỉnh tiền, từ chối) do hệ thống đóng ngay trong giao dịch quyết định, không qua hàm này.
 */
export async function dongKhieuNaiDoiNguon(
  client: PrismaClient,
  i: { disputeId: string; nguoi: NguoiKhieuNai; now: Date },
): Promise<{ disputeId: string; centerId: string; raisedByUserId: string }> {
  const d = await docDeXuLy(client, i.disputeId, i.nguoi);
  batChuyenTrangThai(d.status, "CLOSED");
  if (d.resolution !== "SOURCE_CORRECTION" || !d.decidedAt) {
    throw new HoaHongError("KHONG_DONG_DUOC", "Chỉ khiếu nại duyệt theo cách sửa nguồn mới đóng bằng tay; các loại khác hệ thống đã đóng sẵn.");
  }
  const { khoanThu, soDong } = await demDongDoiNguonSauKhiGui(client, d);
  if (!khoanThu) throw new HoaHongError("KHONG_DONG_DUOC", "Không xác định được khoản thu của khiếu nại để đối chiếu dòng điều chỉnh do đổi nguồn.");
  if (soDong === 0) {
    throw new HoaHongError("CHUA_CO_DONG_DOI_NGUON", "Chưa thấy dòng điều chỉnh do đổi nguồn của khoản thu này — hãy đổi nguồn ở màn lead rồi đóng khiếu nại.");
  }
  await client.$transaction(async (tx) => {
    const cu = await khoaHang(tx, d.id);
    if (cu.status !== "APPROVED") throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    const r = await tx.commissionDispute.updateMany({ where: { id: d.id, status: "APPROVED" }, data: { status: "CLOSED", closedAt: i.now } });
    if (r.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    await writeAudit({
      actor: actorAudit(i.nguoi),
      module: MODULE_AUDIT_HOA_HONG,
      entityType: ENTITY_KHIEU_NAI,
      entityId: d.id,
      action: HANH_DONG_KHIEU_NAI.DONG,
      oldValues: { status: "APPROVED" },
      newValues: { status: "CLOSED" },
      reason: "Đã có dòng điều chỉnh do đổi nguồn",
      orgUnitId: d.orgUnitId,
      tx,
    });
  });
  return { disputeId: d.id, centerId: d.centerId, raisedByUserId: d.raisedByUserId };
}
