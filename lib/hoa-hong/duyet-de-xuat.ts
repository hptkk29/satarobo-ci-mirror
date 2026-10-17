// lib/hoa-hong/duyet-de-xuat.ts — SERVICE DUYỆT / TỪ CHỐI một ĐỀ XUẤT ĐIỀU CHỈNH (`CommissionAdjustmentRequest`): cấp 1 · cấp 2 · từ chối.
//
// Nguồn: yêu cầu chủ dự án 10/10/2026 (hướng B+C) · docs/source-commission/08 §16. Quyết "một hay hai người": `quan-tri-dieu-chinh.ts` (thuần) + ngưỡng chụp lúc lập.
//
// ── Luật bất di bất dịch ────────────────────────────────────────────────────────────────────────
//   1. SỔ APPEND-ONLY: duyệt KHÔNG sửa dòng gốc. Nó sinh dòng ĐIỀU CHỈNH MỚI (\`SOURCE_CORRECTION\` ở đây, \`DISPUTE_ADJUSTMENT\` ở \`khieu-nai.ts\`), cùng giao dịch với việc đổi trạng thái đề xuất.
//   2. Mọi cổng (phạm vi · quyền · trạng thái · TÁCH NHIỆM · cảnh báo) đứng TRƯỚC phép ghi đầu tiên; từ chối = \`throw\` (luật rollback của CLAUDE.md). Đổi trạng thái sang STALE là phép ghi DUY NHẤT
//      của lượt "lỗi thời" và commit có chủ đích — không dòng sổ nào được ghi trước nó.
//   3. TÍNH LẠI dưới khoá khi duyệt (engine \`quetKhoan(DOI_NGUON_CO_QUYEN)\`): gói người duyệt đã thấy phải GIỐNG HỆT gói tính lại, nếu không ⇒ STALE, không ghi.
//   4. Cảnh báo gian lận (TU_CLAIM) TÍNH LẠI lúc duyệt, không tin lúc lập (đề xuất nằm chờ nhiều ngày; chủ lead có thể đã đổi).
//   5. Quyền: MỘT bảng \`KHOA_DUYET_DE_XUAT\` cho nút VÀ action (luật 12), không đẻ quyền mới; cùng một khoá cho cả hai cấp — tách NGƯỜI, không tách quyền.
//   6. \`scopedDb\` không che ghi: tự \`passesScope("CommissionAdjustmentRequest", …)\`.
import type { CommissionAdjustmentRequest, Prisma, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { type Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { passesScope } from "@/lib/db-scope";

import type { BoiCanhQuet } from "./boi-canh";
import { tinhCanhBaoGoiDoiNguon } from "./canh-bao-de-xuat";
import { docGoi, type GoiDong } from "./de-xuat-dieu-chinh";
import { HoaHongError, batLyDoToiThieu } from "./kieu";
import { MODULE_AUDIT_HOA_HONG } from "./khieu-nai-ma";
import { duyetCapHaiKhieuNai } from "./khieu-nai";
import { tachKhoaNguoi } from "./khoa-so";
import { KHOA_DUYET_DE_XUAT, lyDoKhongDuocDuyet, type CapDuyet, type NguonGocDeXuat } from "./quan-tri-dieu-chinh";
import { quetKhoan } from "./quet-khoan";

type Tx = Prisma.TransactionClient;

export type NguoiDuyetDeXuat = { userId: string; ten: string; quyen: Actor };

export type KetQuaDuyetDeXuat =
  | { loai: "DA_DUYET_CAP_1"; requestId: string; origin: NguonGocDeXuat }
  | { loai: "DA_GHI"; requestId: string; origin: NguonGocDeXuat; cap: CapDuyet; soDong: number; tong: number; kyGhi: string }
  | { loai: "LOI_THOI"; requestId: string; origin: NguonGocDeXuat; lyDo: string }
  | { loai: "DA_TU_CHOI"; requestId: string; origin: NguonGocDeXuat };

const actorAudit = (n: NguoiDuyetDeXuat) => ({ id: n.userId, name: n.ten });
const HE_THONG = { id: null as string | null, name: "Hệ thống" };
const CAU_KHONG_TIM_THAY = "Không tìm thấy đề xuất điều chỉnh.";

/** Người hưởng (`User.id`) có mặt trong gói — người duyệt không được nằm trong đó. */
export function nguoiHuongTrongGoi(goi: readonly GoiDong[]): Set<string> {
  const ra = new Set<string>();
  for (const d of goi) {
    const t = tachKhoaNguoi(d.key);
    if (t.kind === "USER") ra.add(t.beneficiaryId);
  }
  return ra;
}

/** Cấp duyệt kế tiếp của một đề xuất theo trạng thái; `null` nếu đã kết thúc. */
export const capKeTiep = (status: CommissionAdjustmentRequest["status"]): CapDuyet | null => (status === "PENDING" ? 1 : status === "APPROVED_L1" ? 2 : null);

/**
 * Cổng CHUNG của duyệt và từ chối (không ghi gì): đề xuất tồn tại ∧ trong phạm vi ∧ người này giữ khoá quyền theo nguồn gốc ∧ tách nhiệm. Trả đề xuất + cấp.
 * Một id ngoài phạm vi trả cùng câu "không tìm thấy" (IDOR).
 */
async function docDeXuLy(
  client: PrismaClient | Tx,
  requestId: string,
  nguoi: NguoiDuyetDeXuat,
  nguonGoc: NguonGocDeXuat,
): Promise<{ req: CommissionAdjustmentRequest; goi: GoiDong[]; cap: CapDuyet }> {
  const req = await client.commissionAdjustmentRequest.findUnique({ where: { id: requestId } });
  if (!req || !passesScope("CommissionAdjustmentRequest", { centerId: req.centerId }, nguoi.quyen)) throw new HoaHongError("KHONG_TIM_THAY_DE_XUAT", CAU_KHONG_TIM_THAY);
  // Server Action gác quyền theo `nguonGoc` do CLIENT khai (phải hỏi khoá TRƯỚC khi đọc đề xuất). Đề xuất thật thuộc nguồn gốc khác ⇒ quyền đã kiểm KHÔNG áp cho nó: từ chối bằng cùng câu
  // "không tìm thấy" (không lộ rằng id tồn tại), không rơi sang khoá của nguồn gốc kia.
  if (req.origin !== nguonGoc) throw new HoaHongError("KHONG_TIM_THAY_DE_XUAT", CAU_KHONG_TIM_THAY);
  const khoa = KHOA_DUYET_DE_XUAT[req.origin];
  if (!can(nguoi.quyen, khoa)) throw new HoaHongError("KHONG_CO_QUYEN", `Bạn không có quyền duyệt đề xuất điều chỉnh hoa hồng (${khoa}).`);
  const cap = capKeTiep(req.status);
  if (cap === null) throw new HoaHongError("DE_XUAT_DA_KET_THUC", "Đề xuất này đã kết thúc.");
  const goi = docGoi(req.goi);
  const lyDo = lyDoKhongDuocDuyet({
    nguoiDuyetId: nguoi.userId,
    requestedById: req.requestedById,
    approver1Id: req.approver1Id,
    nguoiHuongTrongGoi: nguoiHuongTrongGoi(goi),
    cap,
    quanTri: req.governance,
    trangThai: req.status,
  });
  if (lyDo) throw new HoaHongError("KHONG_DUOC_DUYET", lyDo);
  return { req, goi, cap };
}

/** Khoá hàng đề xuất `FOR UPDATE` và trả trạng thái HIỆN TẠI — gọi TRONG transaction, TRƯỚC phép ghi đầu tiên. */
async function khoaDeXuat(tx: Tx, id: string): Promise<{ status: string; approver1Id: string | null }> {
  const r = await tx.$queryRaw<{ status: string; approver1Id: string | null }[]>`
    SELECT "status"::text AS "status", "approver1Id" FROM "CommissionAdjustmentRequest" WHERE "id" = ${id} FOR UPDATE`;
  if (r.length === 0) throw new HoaHongError("KHONG_TIM_THAY_DE_XUAT", CAU_KHONG_TIM_THAY);
  return r[0]!;
}

async function dongHangChoCuaDeXuat(tx: Tx, holdId: string | null, nguoi: NguoiDuyetDeXuat | null, now: Date, trangThai: "RESOLVED" | "DISMISSED", ghiChu: string): Promise<void> {
  if (!holdId) return;
  await tx.commissionHold.updateMany({
    where: { id: holdId, status: "OPEN" },
    data: { status: trangThai, resolvedAt: now, resolvedById: nguoi?.userId ?? null, resolutionNote: ghiChu },
  });
}

/**
 * DUYỆT một đề xuất ở cấp kế tiếp. Cấp được suy từ TRẠNG THÁI (PENDING → cấp 1; APPROVED_L1 → cấp 2), không nhận từ client.
 *   · SINGLE_APPROVAL: cấp 1 GHI SỔ ngay.
 *   · SECOND_APPROVAL_REQUIRED: cấp 1 chỉ chuyển APPROVED_L1; cấp 2 mới GHI SỔ.
 * Khiếu nại tiền do \`duyetCapHaiKhieuNai\` ghi (đã qua cấp 1 ngay lúc người xử lý quyết); đổi nguồn do engine ghi (\`quetKhoan(DOI_NGUON_CO_QUYEN)\`).
 */
export async function duyetDeXuat(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { requestId: string; /** Nguồn gốc mà Server Action ĐÃ gác quyền theo (BẮT BUỘC — luật 7). */ nguonGoc: NguonGocDeXuat; nguoi: NguoiDuyetDeXuat; lyDo: string },
): Promise<KetQuaDuyetDeXuat> {
  const lyDo = batLyDoToiThieu(i.lyDo, "Duyệt đề xuất điều chỉnh");
  const { req, goi, cap } = await docDeXuLy(client, i.requestId, i.nguoi, i.nguonGoc);

  if (req.origin === "DISPUTE") {
    if (cap !== 2) throw new HoaHongError("KHONG_DUOC_DUYET", "Khiếu nại tiền chỉ qua cấp 1 khi người xử lý quyết định; đề xuất này chưa tới cấp hai.");
    const r = await duyetCapHaiKhieuNai(client, bc, { requestId: req.id, nguoi: { userId: i.nguoi.userId, ten: i.nguoi.ten, quyen: i.nguoi.quyen }, lyDo });
    return r.loai === "DA_DUYET_TIEN"
      ? { loai: "DA_GHI", requestId: req.id, origin: "DISPUTE", cap: 2, soDong: 1, tong: r.soTien, kyGhi: r.kyGhi }
      : { loai: "LOI_THOI", requestId: req.id, origin: "DISPUTE", lyDo: r.lyDo };
  }

  // ── ĐỔI NGUỒN ──
  if (!req.leadId) throw new HoaHongError("DE_XUAT_THIEU_LEAD", "Đề xuất đổi nguồn không có lead.");
  const canhBaoCu = Array.isArray(req.canhBao) ? (req.canhBao as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const canhBaoNay = await tinhCanhBaoGoiDoiNguon(client, { leadId: req.leadId, goi, requestedById: req.requestedById });
  const moi = canhBaoNay.filter((m) => !canhBaoCu.includes(m));
  if (moi.length > 0) {
    // Cảnh báo MỚI xuất hiện từ lúc lập (vd người hưởng nay là người chăm lead): đề xuất không còn đúng — LỖI THỜI, KHÔNG ghi. Hàng chờ của nó thành DISMISSED nên nếu đầu vào KHÔNG đổi, lượt quét sau không dựng lại gì; nếu đầu vào đổi tiếp thì ra một INPUT_DRIFT thường nhưng "Áp dụng" bằng một người bị chặn (`deXuatDoiNguonKetThucKhongGhi`, 08 §17.x mục 2).
    const lyDoThoi = `Có cảnh báo gian lận mới từ lúc lập đề xuất (${moi.join(", ")}) — không duyệt trên số liệu đã cũ.`;
    await client.$transaction(async (tx) => {
      const cu = await khoaDeXuat(tx, req.id);
      if (cu.status !== req.status) throw new HoaHongError("TRANG_THAI_DA_DOI", "Đề xuất vừa được xử lý ở nơi khác — tải lại trang.");
      await tx.commissionAdjustmentRequest.update({ where: { id: req.id }, data: { status: "STALE", closeReason: lyDoThoi } });
      await dongHangChoCuaDeXuat(tx, req.holdId, null, bc.now, "DISMISSED", lyDoThoi);
      await writeAudit({ actor: HE_THONG, module: MODULE_AUDIT_HOA_HONG, entityType: "CommissionAdjustmentRequest", entityId: req.id, action: "STALE", oldValues: { status: req.status }, newValues: { status: "STALE", canhBao: moi }, reason: lyDoThoi, orgUnitId: req.orgUnitId, tx });
    });
    return { loai: "LOI_THOI", requestId: req.id, origin: "SOURCE_CHANGE", lyDo: lyDoThoi };
  }

  const ghiSo = req.governance === "SINGLE_APPROVAL" || cap === 2;
  if (!ghiSo) {
    // Cấp 1 của đề xuất cần cấp hai: chỉ đổi trạng thái, KHÔNG ghi sổ.
    await client.$transaction(async (tx) => {
      const cu = await khoaDeXuat(tx, req.id);
      if (cu.status !== "PENDING") throw new HoaHongError("TRANG_THAI_DA_DOI", "Đề xuất vừa được xử lý ở nơi khác — tải lại trang.");
      await tx.commissionAdjustmentRequest.update({ where: { id: req.id }, data: { status: "APPROVED_L1", approver1Id: i.nguoi.userId, approver1At: bc.now, approver1Reason: lyDo } });
      await writeAudit({ actor: actorAudit(i.nguoi), module: MODULE_AUDIT_HOA_HONG, entityType: "CommissionAdjustmentRequest", entityId: req.id, action: "APPROVE_L1", oldValues: { status: "PENDING" }, newValues: { status: "APPROVED_L1" }, reason: lyDo, orgUnitId: req.orgUnitId, tx });
    });
    return { loai: "DA_DUYET_CAP_1", requestId: req.id, origin: "SOURCE_CHANGE" };
  }

  // Ghi sổ: engine tính lại dưới khoá, đối chiếu gói, ghi SOURCE_CORRECTION; các callback ghi trạng thái đề xuất CÙNG giao dịch.
  const ket = await quetKhoan(client, bc, req.paymentId, {
    cheDo: "DOI_NGUON_CO_QUYEN",
    refEventId: req.id,
    duyet: {
      requestId: req.id,
      goi,
      kiemTruoc: async (h) => {
        const cu = await khoaDeXuat(h.tx, req.id);
        if (cu.status !== req.status || cu.approver1Id !== req.approver1Id) throw new HoaHongError("TRANG_THAI_DA_DOI", "Đề xuất vừa được xử lý ở nơi khác — tải lại trang.");
      },
      khiGhi: async (h, kq) => {
        const dong = await h.tx.commissionTransaction.findMany({ where: { idempotencyKey: { in: [...kq.khoaDong] } }, select: { id: true } });
        const dau1 = cap === 1 ? { approver1Id: i.nguoi.userId, approver1At: bc.now, approver1Reason: lyDo } : {};
        const dau2 = cap === 2 ? { approver2Id: i.nguoi.userId, approver2At: bc.now, approver2Reason: lyDo } : {};
        await h.tx.commissionAdjustmentRequest.update({
          where: { id: req.id },
          data: { status: "POSTED", ...dau1, ...dau2, postedEntryIds: dong.map((d) => d.id), postingPeriodId: kq.kyId },
        });
        await dongHangChoCuaDeXuat(h.tx, req.holdId, i.nguoi, bc.now, "RESOLVED", `Đề xuất ${req.id} đã duyệt và ghi sổ: ${lyDo}`);
        await writeAudit({
          actor: actorAudit(i.nguoi),
          module: MODULE_AUDIT_HOA_HONG,
          entityType: "CommissionAdjustmentRequest",
          entityId: req.id,
          action: cap === 1 ? "APPROVE_POST" : "APPROVE_L2_POST",
          oldValues: { status: req.status },
          newValues: { status: "POSTED", soDong: kq.soDong, tong: kq.tong, kyGhi: kq.kyGhi, dong: dong.map((d) => d.id) },
          reason: lyDo,
          orgUnitId: req.orgUnitId,
          tx: h.tx,
        });
      },
      khiLoiThoi: async (h, lyDoThoi) => {
        await h.tx.commissionAdjustmentRequest.update({ where: { id: req.id }, data: { status: "STALE", closeReason: lyDoThoi } });
        await dongHangChoCuaDeXuat(h.tx, req.holdId, null, bc.now, "DISMISSED", lyDoThoi);
        await writeAudit({ actor: HE_THONG, module: MODULE_AUDIT_HOA_HONG, entityType: "CommissionAdjustmentRequest", entityId: req.id, action: "STALE", oldValues: { status: req.status }, newValues: { status: "STALE" }, reason: lyDoThoi, orgUnitId: req.orgUnitId, tx: h.tx });
      },
    },
  });
  if (ket.loai === "DA_DIEU_CHINH") return { loai: "DA_GHI", requestId: req.id, origin: "SOURCE_CHANGE", cap, soDong: ket.soDong, tong: ket.tong, kyGhi: ket.kyGhi };
  if (ket.loai === "STALE_DE_XUAT") return { loai: "LOI_THOI", requestId: req.id, origin: "SOURCE_CHANGE", lyDo: ket.lyDo };
  // Engine không dựng được kỳ vọng hôm nay (thiếu dữ liệu · ngoài phạm vi · giữ): KHÔNG đổi gì, để người duyệt biết.
  throw new HoaHongError("KHONG_GHI_DUOC", `Không dựng được kỳ vọng hôm nay cho khoản của đề xuất (${ket.loai}) — sửa dữ liệu rồi duyệt lại, hoặc từ chối đề xuất.`);
}

/**
 * TỪ CHỐI một đề xuất ở bất kỳ cấp nào. Cùng cổng với duyệt (quyền · phạm vi · tách nhiệm). Không ghi sổ.
 *   · Đổi nguồn: hàng chờ của đề xuất thành DISMISSED = "giữ nguyên" ⇒ hash đầu vào vào \`hashDaChapNhan\` ⇒ lượt quét sau KHÔNG dựng lại cùng chênh lệch thành INPUT_DRIFT thường.
 *   · Khiếu nại: đề xuất REJECTED, khiếu nại ở lại UNDER_REVIEW để người xử lý quyết lại (chỉ mục "một yêu cầu mở mỗi khiếu nại" đã nhả).
 */
export async function tuChoiDeXuat(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { requestId: string; nguonGoc: NguonGocDeXuat; nguoi: NguoiDuyetDeXuat; lyDo: string },
): Promise<KetQuaDuyetDeXuat> {
  const lyDo = batLyDoToiThieu(i.lyDo, "Từ chối đề xuất điều chỉnh");
  const { req } = await docDeXuLy(client, i.requestId, i.nguoi, i.nguonGoc);
  await client.$transaction(async (tx) => {
    const cu = await khoaDeXuat(tx, req.id);
    if (cu.status !== req.status) throw new HoaHongError("TRANG_THAI_DA_DOI", "Đề xuất vừa được xử lý ở nơi khác — tải lại trang.");
    await tx.commissionAdjustmentRequest.update({ where: { id: req.id }, data: { status: "REJECTED", rejectedById: i.nguoi.userId, rejectedAt: bc.now, rejectedReason: lyDo } });
    await dongHangChoCuaDeXuat(tx, req.holdId, i.nguoi, bc.now, "DISMISSED", `Đề xuất ${req.id} bị từ chối: ${lyDo}`);
    await writeAudit({ actor: actorAudit(i.nguoi), module: MODULE_AUDIT_HOA_HONG, entityType: "CommissionAdjustmentRequest", entityId: req.id, action: "REJECT", oldValues: { status: req.status }, newValues: { status: "REJECTED" }, reason: lyDo, orgUnitId: req.orgUnitId, tx });
  });
  return { loai: "DA_TU_CHOI", requestId: req.id, origin: req.origin };
}
