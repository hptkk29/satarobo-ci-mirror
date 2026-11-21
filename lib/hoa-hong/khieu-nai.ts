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

import type { CommissionDispute, CommissionTransaction, Prisma, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { resolveActorUncached, type Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { coQuyenTaiCoSo } from "@/lib/auth/quyen-tai-co-so";
import { passesScope } from "@/lib/db-scope";

import type { BoiCanhQuet } from "./boi-canh";
import { kyTuNhienCua } from "./but-toan";
import { chayTrongKhoa } from "./ghi-so";
import { khoaNguoi } from "./khoa-so";
import { demDongDoiNguonSauKhiGui, docDichDeTao, doiNguonDaXuLyXong } from "./khieu-nai-dich";
import { dungDongDieuChinhKhieuNai } from "./khieu-nai-dieu-chinh";
import { kiemDauVaoQuyet, kiemDauVaoTao, type DauVaoQuyet, type LoiTruong } from "./khieu-nai-dau-vao";
import { ENTITY_KHIEU_NAI, HANH_DONG_KHIEU_NAI, KEY_DUYET_KHIEU_NAI, KEY_TAO_KHIEU_NAI, MODULE_AUDIT_HOA_HONG } from "./khieu-nai-ma";
import { batChuyenTrangThai, type TrangThaiKhieuNai } from "./khieu-nai-trang-thai";
import { HoaHongError, batLyDoToiThieu } from "./kieu";
import { docTrangThaiO } from "./o-tinh-db";
import { docGoi, luuDeXuat, quyetDinhQuanTriTrongTx, type GoiDong } from "./de-xuat-dieu-chinh";
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
  // `passesScope("CommissionDispute")` gộp `commission_disputes:` + `commission:`; `can` trần luôn đúng với quyền GLOBAL ⇒ phải giữ ĐÚNG khoá xử lý TẠI cơ sở của khiếu nại (N9).
  if (!coQuyenTaiCoSo(nguoi.quyen, KEY_DUYET_KHIEU_NAI, d.centerId)) {
    throw new HoaHongError("NGOAI_PHAM_VI", `Bạn không giữ quyền xử lý khiếu nại hoa hồng (${KEY_DUYET_KHIEU_NAI}) tại cơ sở của khiếu nại này.`);
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
    if (!can(a, KEY_DUYET_KHIEU_NAI) || !passesScope("CommissionDispute", { centerId: d.centerId }, a) || !coQuyenTaiCoSo(a, KEY_DUYET_KHIEU_NAI, d.centerId)) {
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
    await chanKhiDangChoCapHai(tx, d.id);
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
    }
  /** Số điều chỉnh đạt ngưỡng / vượt cận ⇒ người cấp 1 đã quyết nhưng SỔ CHƯA GHI; chờ người duyệt cấp hai. Khiếu nại đứng ở UNDER_REVIEW. */
  | { loai: "CHO_CAP_HAI"; disputeId: string; centerId: string; raisedByUserId: string; requestId: string; soTien: number };

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
    await chanKhiDangChoCapHai(tx, d.id);
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

/** Khiếu nại đang CHỜ CẤP HAI thì không nhận lại / giao lại / quyết lại: người cấp 1 đã quyết, đề xuất đang chờ — quyết thêm lần nữa là hai quyết định cho một khiếu nại. */
async function chanKhiDangChoCapHai(tx: Tx, disputeId: string): Promise<void> {
  const n = await tx.commissionAdjustmentRequest.count({ where: { disputeId, status: { in: ["PENDING", "APPROVED_L1"] } } });
  if (n > 0) throw new HoaHongError("DANG_CHO_CAP_HAI", "Khiếu nại đang chờ người duyệt cấp hai — chưa nhận lại, giao lại hay quyết định lại được.");
}

/** Người nhận điều chỉnh của khiếu nại đích KHOẢN THU (đích DÒNG thì `null`: giữ người + vai của dòng mẫu). Dùng chung cho cấp 1 và cấp 2 — dựng lại ĐÚNG như cấp 1 đã thấy. */
async function docNguoiNhanDieuChinh(
  client: PrismaClient | Tx,
  d: CommissionDispute,
  roleCode: string | null,
): Promise<Parameters<typeof dungDongDieuChinhKhieuNai>[0]["nguoiNhan"]> {
  if (d.transactionId !== null) return null;
  if (!roleCode) throw loiO("roleCode", "Chọn vai mà người khiếu nại lẽ ra được hưởng.");
  const [vai, nguoiKn] = await Promise.all([
    client.beneficiaryRole.findUnique({ where: { code: roleCode }, select: { id: true, code: true, resolverType: true, isActive: true } }),
    client.user.findUnique({ where: { id: d.raisedByUserId }, select: { id: true, name: true, email: true, employeeId: true } }),
  ]);
  if (!vai || !vai.isActive) throw loiO("roleCode", "Vai hưởng không hợp lệ hoặc đã tắt.");
  if (!nguoiKn) throw new HoaHongError("NGUOI_KHIEU_NAI_KHONG_TON_TAI", "Không đọc được người khiếu nại.");
  return {
    nguoi: { userId: nguoiKn.id, employeeId: nguoiKn.employeeId, ten: nguoiKn.name ?? nguoiKn.email ?? nguoiKn.id },
    vai: { id: vai.id, code: vai.code, resolverType: vai.resolverType },
  };
}

const khoaCuaDong = (mau: CommissionTransaction, nguoiNhan: Awaited<ReturnType<typeof docNguoiNhanDieuChinh>>) =>
  nguoiNhan
    ? khoaNguoi(nguoiNhan.vai.code, "USER", nguoiNhan.nguoi.userId)
    : khoaNguoi(mau.roleCode, mau.beneficiaryKind, (mau.beneficiaryKind === "USER" ? mau.beneficiaryUserId : mau.beneficiaryAffiliateId) ?? "-");

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
  const nguoiNhan = await docNguoiNhanDieuChinh(client, d, qd.roleCode);
  if (qd.soTien < 0 && mau.calcSlotId === null) {
    throw loiO("soTien", "Không đòi lại (số âm) trên dòng không có ô tính — không có số ròng nào để đối chiếu.");
  }
  // Đề xuất cần khoản thu để gắn (FK). Dòng không gắn khoản thu (thưởng kỳ…) chưa có đường khiếu nại tiền.
  const paymentId = mau.paymentId ?? d.paymentId;
  if (!paymentId) throw loiO("mauDongId", "Dòng hoa hồng này không gắn khoản thu nào nên chưa điều chỉnh tiền qua khiếu nại được.");

  const kyNatural = kyTuNhienCua(bc.now);
  const ky = await kyChanCua(client, bc, kyNatural, { centerId: d.centerId, orgUnitId: d.orgUnitId });
  const idDong = randomUUID();

  // ── GHI (một giao dịch: [dòng điều chỉnh + quyết định + đóng | chỉ đề xuất cấp hai] + audit) ──────────────────────────────
  return chayTrongKhoa(client, { khoaKhoan: [paymentId], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaQuyet> => {
    const tx = h.tx;
    // Cổng (không ghi gì):
    const cu = await khoaHang(tx, d.id);
    if (cu.status !== "UNDER_REVIEW" || cu.assignedToUserId !== nguoi.userId) {
      throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    }
    await chanKhiDangChoCapHai(tx, d.id);
    const khoa = khoaCuaDong(mau, nguoiNhan);
    let rong = 0;
    if (mau.calcSlotId) {
      await h.khoaO([mau.calcSlotId]);
      const o = (await docTrangThaiO(tx, [mau.calcSlotId])).get(mau.calcSlotId);
      rong = o?.rong.get(khoa) ?? 0;
      if (qd.soTien < 0 && rong + qd.soTien < 0) {
        // Không đòi lại quá số ròng đã ghi của (ô × vai × người) — DB cũng có trigger; ở đây trả câu người đọc hiểu được.
        throw loiO("soTien", `Không đòi lại quá số đã ghi: số ròng hiện tại của người này ở ô tính là ${rong} đồng.`);
      }
    }
    const goi: GoiDong[] = [{ key: khoa, chenh: qd.soTien, kyVong: rong + qd.soTien, rong, mauDongId: mau.id, roleCode: qd.roleCode }];
    // QUẢN TRỊ: ngưỡng đọc THẲNG từ cấu hình trong transaction rồi chụp; TÍCH LUỸ với các điều chỉnh đã ghi / đang mở của cùng ô, và cận = hoa hồng GỐC engine tính (không phải số ròng
    // đã bị điều chỉnh) — nhiều khiếu nại nhỏ lần lượt không leo qua ngưỡng mà không ai nhìn vào. Đạt ngưỡng / vượt cận / không tính được cận ⇒ CẤP HAI (không im lặng cho qua).
    // Đọc SAU `khoaO` ở trên: hai khiếu nại đồng thời trên cùng ô xếp hàng qua khoá ấy.
    // Yêu cầu logic = CHÍNH khiếu nại này (`disputeId`). Khiếu nại chỉ có MỘT gói/ô (đo 18/10: `goi` đúng một dòng, chỉ mục một-đề-xuất-mở-mỗi-khiếu-nại) nên không có dự báo gói chưa lập; việc cộng
    // các đề xuất anh em của cùng khiếu nại (đã bị bác thì không đếm) vẫn đi qua MỘT cửa đọc để lược đồ đổi thì luật không hở.
    const quanTri = await quyetDinhQuanTriTrongTx(tx, { goi, calcSlotId: mau.calcSlotId, yeuCau: { khoa: { origin: "DISPUTE", disputeId: d.id }, duBaoTong: 0 }, canhBao: [] });
    const dau = { userId: nguoi.userId, at: bc.now, lyDo: qd.lyDo };
    const chung = {
      origin: "DISPUTE" as const,
      disputeId: d.id,
      leadId: null,
      paymentId,
      calcSlotId: mau.calcSlotId,
      refEventType: "DISPUTE",
      refEventId: d.id,
      goi,
      qd: quanTri,
      canhBao: [] as string[],
      requestedById: d.raisedByUserId,
      centerId: d.centerId,
      orgUnitId: d.orgUnitId,
      holdId: null,
    };

    if (quanTri.quanTri === "SECOND_APPROVAL_REQUIRED") {
      // CHƯA ghi sổ, CHƯA đụng khiếu nại (đứng ở UNDER_REVIEW — không đổi trigger/CHECK của CommissionDispute). Đề xuất vào thẳng APPROVED_L1: người xử lý chính là cấp 1.
      const { id: requestId } = await luuDeXuat(tx, { ...chung, trangThai: { loai: "DA_QUA_CAP_1", approver1: dau } });
      await writeAudit({
        actor: actorAudit(nguoi),
        module: MODULE_AUDIT_HOA_HONG,
        entityType: ENTITY_KHIEU_NAI,
        entityId: d.id,
        action: HANH_DONG_KHIEU_NAI.QUYET,
        oldValues: { status: "UNDER_REVIEW" },
        newValues: { status: "UNDER_REVIEW", choCapHai: true, deXuat: requestId, soTien: qd.soTien, lyDoQuanTri: quanTri.lyDo.map((l) => l.ma) },
        reason: qd.lyDo,
        orgUnitId: d.orgUnitId,
        tx,
      });
      return { loai: "CHO_CAP_HAI", disputeId: d.id, centerId: d.centerId, raisedByUserId: d.raisedByUserId, requestId, soTien: qd.soTien };
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
    // Một người duyệt cũng đi qua MỘT đường kiểm toán: đề xuất vào thẳng POSTED, mang ngưỡng/cận đã chụp và lý do.
    await luuDeXuat(tx, { ...chung, trangThai: { loai: "DA_GHI", approver1: dau, postedEntryIds: [idDong], postingPeriodId: ky.id } });
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

// ═══════════════════════════ DUYỆT CẤP HAI (khiếu nại tiền vượt ngưỡng / cận) ═══════════════════════════

export type KetQuaCapHaiKhieuNai =
  | { loai: "DA_DUYET_TIEN"; disputeId: string; centerId: string; raisedByUserId: string; requestId: string; dongDieuChinhId: string; soTien: number; kyGhi: string; lateArrival: boolean }
  | { loai: "LOI_THOI"; disputeId: string; requestId: string; lyDo: string };

/**
 * Cấp 2 của khiếu nại tiền: GHI dòng `DISPUTE_ADJUSTMENT` đúng như cấp 1 đã thấy (`goi` đóng băng) rồi mới quyết/đóng khiếu nại. Cổng quyền + tách nhiệm đã kiểm ở `duyet-de-xuat.ts`
 * (MỘT hàm cho nút và action); hàm này chỉ giữ phần GHI. Số ròng của người hưởng đổi từ lúc lập ⇒ đề xuất LỖI THỜI (STALE), KHÔNG ghi, khiếu nại ở lại UNDER_REVIEW để người xử lý quyết lại.
 * Khiếu nại KHÔNG đổi trigger/CHECK: nó đi UNDER_REVIEW → APPROVED (decidedById = người cấp 1) → CLOSED trong cùng giao dịch ghi.
 */
export async function duyetCapHaiKhieuNai(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { requestId: string; nguoi: NguoiKhieuNai; lyDo: string },
): Promise<KetQuaCapHaiKhieuNai> {
  const lyDo = batLyDoToiThieu(i.lyDo, "Duyệt cấp hai");
  const req = await client.commissionAdjustmentRequest.findUnique({ where: { id: i.requestId } });
  if (!req || req.origin !== "DISPUTE" || !req.disputeId) throw new HoaHongError("KHONG_TIM_THAY_DE_XUAT", "Không tìm thấy đề xuất của khiếu nại.");
  const d = await client.commissionDispute.findUnique({ where: { id: req.disputeId } });
  if (!d) throw new HoaHongError("KHONG_TIM_THAY_KHIEU_NAI", CAU_KHONG_TIM_THAY_KHIEU_NAI);
  const goi = docGoi(req.goi);
  const dong1 = goi[0];
  if (goi.length !== 1 || !dong1?.mauDongId) throw new HoaHongError("GOI_KHONG_HOP_LE", "Gói điều chỉnh của khiếu nại phải đúng một dòng có dòng mẫu.");
  const mau = await client.commissionTransaction.findUnique({ where: { id: dong1.mauDongId } });
  if (!mau) throw new HoaHongError("DONG_KHONG_TON_TAI", "Dòng mẫu của đề xuất không còn tồn tại.");
  const nguoiNhan = await docNguoiNhanDieuChinh(client, d, dong1.roleCode ?? null);
  const paymentId = req.paymentId;
  const ky = await kyChanCua(client, bc, kyTuNhienCua(bc.now), { centerId: d.centerId, orgUnitId: d.orgUnitId });
  const idDong = randomUUID();

  return chayTrongKhoa(client, { khoaKhoan: [paymentId], kyCutoverDaDoc: bc.kyCutover }, async (h): Promise<KetQuaCapHaiKhieuNai> => {
    const tx = h.tx;
    // Cổng — KHÔNG ghi gì trước khi qua hết.
    const r = await tx.$queryRaw<{ status: string; approver1Id: string | null }[]>`
      SELECT "status"::text AS "status", "approver1Id" FROM "CommissionAdjustmentRequest" WHERE "id" = ${req.id} FOR UPDATE`;
    if (r.length === 0 || r[0]!.status !== "APPROVED_L1" || r[0]!.approver1Id !== req.approver1Id) {
      throw new HoaHongError("TRANG_THAI_DA_DOI", "Đề xuất vừa được xử lý ở nơi khác — tải lại trang.");
    }
    const cu = await khoaHang(tx, d.id);
    if (cu.status !== "UNDER_REVIEW") throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");

    // Lỗi thời? Số ròng của (ô × vai × người) phải còn ĐÚNG số người cấp 1 đã thấy.
    let lyDoThoi: string | null = null;
    if (mau.calcSlotId) {
      await h.khoaO([mau.calcSlotId]);
      const o = (await docTrangThaiO(tx, [mau.calcSlotId])).get(mau.calcSlotId);
      const rong = o?.rong.get(dong1.key) ?? 0;
      if (rong !== dong1.rong) lyDoThoi = `Số ròng của người hưởng đã đổi từ ${dong1.rong} sang ${rong} đồng giữa hai lần duyệt.`;
    }
    if (lyDoThoi) {
      await tx.commissionAdjustmentRequest.update({ where: { id: req.id }, data: { status: "STALE", closeReason: lyDoThoi } });
      await writeAudit({
        actor: HE_THONG,
        module: MODULE_AUDIT_HOA_HONG,
        entityType: "CommissionAdjustmentRequest",
        entityId: req.id,
        action: "STALE",
        oldValues: { status: "APPROVED_L1" },
        newValues: { status: "STALE", khieuNai: d.id },
        reason: lyDoThoi,
        orgUnitId: d.orgUnitId,
        tx,
      });
      return { loai: "LOI_THOI", disputeId: d.id, requestId: req.id, lyDo: lyDoThoi };
    }

    await h.khoaKyDeGhi([ky.id]);
    const dong = dungDongDieuChinhKhieuNai({
      id: idDong,
      disputeId: d.id,
      mau,
      nguoiNhan,
      soTien: dong1.chenh,
      lyDoQuyetDinh: req.approver1Reason ?? lyDo,
      periodId: ky.id,
      lateArrival: ky.period !== mau.naturalPeriod,
    });
    const g = await h.ghiDong([dong]);
    if (g.daGhi !== 1) throw new HoaHongError("DA_QUYET_TRUOC", "Dòng điều chỉnh của khiếu nại này đã được ghi — không ghi lần hai.");

    const upd = await tx.commissionDispute.updateMany({
      where: { id: d.id, status: "UNDER_REVIEW" },
      data: { status: "APPROVED", resolution: "MONEY_ADJUSTMENT", decisionReason: req.approver1Reason ?? lyDo, decidedById: req.approver1Id, decidedAt: bc.now, resolutionEntryId: idDong },
    });
    if (upd.count === 0) throw new HoaHongError("TRANG_THAI_DA_DOI", "Khiếu nại vừa được xử lý ở nơi khác — tải lại trang.");
    await tx.commissionAdjustmentRequest.update({
      where: { id: req.id },
      data: { status: "POSTED", approver2Id: i.nguoi.userId, approver2At: bc.now, approver2Reason: lyDo, postedEntryIds: [idDong], postingPeriodId: ky.id },
    });
    await writeAudit({
      actor: actorAudit(i.nguoi),
      module: MODULE_AUDIT_HOA_HONG,
      entityType: ENTITY_KHIEU_NAI,
      entityId: d.id,
      action: HANH_DONG_KHIEU_NAI.QUYET,
      oldValues: { status: "UNDER_REVIEW" },
      newValues: { status: "APPROVED", resolution: "MONEY_ADJUSTMENT", dongDieuChinhId: idDong, kyGhi: ky.period, capHai: true, deXuat: req.id },
      reason: lyDo,
      orgUnitId: d.orgUnitId,
      tx,
    });
    await dongTuDong(tx, d, "APPROVED", bc.now);
    return {
      loai: "DA_DUYET_TIEN",
      disputeId: d.id,
      centerId: d.centerId,
      raisedByUserId: d.raisedByUserId,
      requestId: req.id,
      dongDieuChinhId: idDong,
      soTien: dong1.chenh,
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
  const dem = await demDongDoiNguonSauKhiGui(client, d);
  const { khoanThu, soDong, khongAnhHuongTien, dangChoDuyet } = dem;
  if (!khoanThu) throw new HoaHongError("KHONG_DONG_DUOC", "Không xác định được khoản thu của khiếu nại để đối chiếu dòng điều chỉnh do đổi nguồn.");
  if (dangChoDuyet > 0) {
    throw new HoaHongError("DE_XUAT_DANG_CHO_DUYET", "Đổi nguồn đã tạo đề xuất điều chỉnh nhưng đề xuất đang chờ duyệt — đóng khiếu nại sau khi đề xuất được duyệt hoặc bị từ chối.");
  }
  if (!doiNguonDaXuLyXong(dem)) {
    throw new HoaHongError("CHUA_CO_DONG_DOI_NGUON", "Chưa thấy đổi nguồn nào của khoản thu này được xử lý — hãy đổi nguồn ở màn lead rồi đóng khiếu nại.");
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
      reason:
        soDong > 0
          ? "Đã có dòng điều chỉnh do đổi nguồn (đề xuất đã được duyệt)"
          : khongAnhHuongTien > 0
            ? "Đã đổi nguồn — không có chênh lệch tiền nào cần điều chỉnh"
            : "Đề xuất điều chỉnh do đổi nguồn đã bị từ chối — tiền không đổi",
      orgUnitId: d.orgUnitId,
      tx,
    });
  });
  return { disputeId: d.id, centerId: d.centerId, raisedByUserId: d.raisedByUserId };
}
