import "server-only";
// lib/ai-lead/dich-vu/don-dep.ts — CRON `ai-lead-don-dep` (10 phút/lần): dọn nonce · dọn bản ghi idempotency · hết hạn hồ sơ · nhắc SLA.
//
// KHÔNG ghi tiền, KHÔNG ghi quyền, KHÔNG tạo/đổi lead. Mỗi giai đoạn tự bắt lỗi và ghi MÃ (không ghi nội dung lỗi: lỗi Prisma có thể kèm giá trị cột) — một giai đoạn hỏng
// không được bỏ qua các giai đoạn sau; route trả `ok:false` kèm danh sách giai đoạn lỗi để cron giám sát thấy.
//
//  · nonce      : xoá cũ hơn `nonceTtlHieuLucMs` (= max(ai.nonceTtlMinutes, 2×ai.clockSkewMs)) — KHÔNG dùng riêng nonceTtlMinutes: nhớ ngắn hơn cửa sổ phát lại là hở khe.
//  · request    : xoá `AiLeadRequest` quá 7 ngày (khung idempotency của hợp đồng; thân đã lưu không có PII ngoài receiptId).
//  · hết hạn    : hồ sơ THU THẬP (chỉ COLLECTING; KHÔNG gồm PENDING_INFO/WAITING_QLCS/READY_FOR_REVIEW — đó là hồ sơ chờ người, chỉ nhắc SLA) chưa ai nhận (`claimedById` null), chưa ra lead (`leadId` null), không có cập nhật quá
//                 `ai.draftExpireHours` (đo theo `updatedAt`, không phải `createdAt`) ⇒ EXPIRED + audit hệ thống. UPDATE có điều kiện lặp lại đúng `where` — nhân viên vừa nhận
//                 giữa chừng thì đổi 0 dòng, không bị đóng dưới chân.
//  · lead đã có chủ (FIX-04): hồ sơ ASSIGNMENT_PENDING mà lead của nó ĐÃ có sale phụ trách hợp lệ (CRM: `Lead.assignedToId` trỏ user còn hoạt động, lead chưa xoá) ⇒ COMPLETED + audit hệ thống
//                 `CLOSE_EXCEPTION_AUTO`. KHÔNG chia sale, KHÔNG sửa lead; chưa xác minh được (lead mất / đã xoá / chưa chủ / chủ đã nghỉ) ⇒ hồ sơ Ở NGUYÊN hàng chờ. UPDATE có điều kiện
//                 (id + version + state) và đọc lại lead TRONG giao dịch ⇒ người vừa đóng tay / vừa gỡ chủ giữa chừng thì đổi 0 dòng, không đóng nhầm. Chạy lặp ⇒ 0.
//  · SLA        : theo BẬC của quy tắc NOTIFY (bộ quy tắc có version; không có quy tắc ⇒ mặc định = hành vi cũ). (a) hồ sơ cần người, chưa ai nhận, quá `slaClaimDueAt` ⇒ SLA_CLAIM_OVERDUE;
//                 (b) hồ sơ ĐÃ nhận (IN_PROGRESS) mà quá `slaResolveDueAt` chưa ra lead ⇒ SLA_RESOLVE_OVERDUE (trước đây nhận rồi bỏ dở thì không ai được báo). Bậc `afterMinutes > 0` = LEO THANG tới nhóm khác.
//                 Khoá thông báo theo (hồ sơ, sự kiện, bậc) ⇒ chạy lặp không rung lại.
//  · sự cố      : sự cố Agent HIGH/CRITICAL còn OPEN (chưa ai ACK) ⇒ các bậc leo thang `afterMinutes > 0` của quy tắc INCIDENT (bậc 0 gửi ngay lúc nhận sự cố).
import type { AiLeadDraftState, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { docCaiDat, nonceTtlHieuLucMs } from "../cai-dat";
import { maLoiNoiBo } from "../loi-he-thong";
import { donBoDemCu, xaBoDem } from "../tu-choi";
import { cacBacDenHan, cacBacThongBao, cuaSoQuetPhut, hanSlaTheoQuyTac } from "./bo-quy-tac";
import { docBoHienHanh } from "./bo-quy-tac-db";
import { baoHoSoCanXuLy, baoQuaHan, baoSuCoAgent } from "./thong-bao";

const NGAY_MS = 24 * 3_600_000;
/** Số bản ghi MỖI TRANG; quét nhiều trang bằng con trỏ `id` (xem `quetTheoTrang`). */
const TRAN_MOI_LUOT = 200;
/** Trần số trang mỗi vòng/lượt: 10 × 200 = 2000 bản ghi. Quá trần ⇒ `catNgan` + cảnh báo, lượt cron kế tiếp quét tiếp (bản ghi chưa báo vẫn còn trong cửa sổ). */
const TRANG_TOI_DA = 10;

export type KetQuaDonDep = {
  ok: boolean;
  nonceXoa: number;
  requestXoa: number;
  /** Số dòng bộ đếm từ chối đã xoá vì quá `ai.rejectLogRetentionDays` (0 khi cờ ghi tắt). */
  tuChoiXoa: number;
  hetHan: number;
  /** FIX-04: số hồ sơ ASSIGNMENT_PENDING đã tự đóng vì lead đã có sale phụ trách. */
  assignmentDong: number;
  slaNhac: number;
  /** Số lượt báo LEO THANG sự cố Agent đã đến hạn trong lượt này (khoá trùng được bỏ qua khi gửi). */
  suCoNhac: number;
  /** Số vòng quét bị CẮT vì chạm trần trang (còn bản ghi chưa xét — lượt sau xét tiếp). 0 là bình thường. */
  catNgan: number;
  /** Giai đoạn lỗi — CHỈ mã. */
  loi: string[];
};

/**
 * Quét NHIỀU TRANG bằng con trỏ `id` (truy vấn phải sắp theo `(khoá thời gian, id)` để thứ tự ổn định). Trước đây mỗi vòng chỉ lấy `take: 200` một lần: hàng đợi ứ > 200 bản ghi thì phần sau
 * không bao giờ được xét trong lượt đó (review độc lập 28/10). Nay đi hết các trang tới `TRANG_TOI_DA`; chạm trần thì GHI NHẬN (`catNgan`) thay vì cắt im lặng.
 */
async function quetTheoTrang<T extends { id: string }>(
  lay: (p: { take: number; cursor?: { id: string }; skip?: number }) => Promise<T[]>,
  xuLy: (d: T) => Promise<void>,
  kq: KetQuaDonDep,
  ten: string,
): Promise<void> {
  let con: { id: string } | undefined;
  for (let trang = 0; trang < TRANG_TOI_DA; trang++) {
    const dong = await lay({ take: TRAN_MOI_LUOT, ...(con ? { cursor: con, skip: 1 } : {}) });
    for (const d of dong) await xuLy(d);
    if (dong.length < TRAN_MOI_LUOT) return;
    con = { id: dong[dong.length - 1]!.id };
  }
  // Trang cuối ĐẦY không có nghĩa là còn nữa (đúng 2000 bản ghi thì trang thứ 10 vừa đủ đầy): dò thêm MỘT bản ghi sau con trỏ rồi mới kết luận cắt, kẻo lượt nào cũng báo cắt oan.
  const conSau = await lay({ take: 1, cursor: con!, skip: 1 });
  if (conSau.length === 0) return;
  kq.catNgan += 1;
  // Mỗi lượt cron bắt đầu lại từ trang đầu (không nhớ con trỏ): bản ghi đã xử lý vẫn nằm trong cửa sổ cho tới khi được xử lý xong / ra khỏi cửa sổ, nên phần SAU trần chỉ được xét khi phần trước rời cửa sổ.
  console.warn(`[ai-lead:don-dep] vong=${ten} chạm trần ${TRANG_TOI_DA * TRAN_MOI_LUOT} bản ghi — phần sau trần chỉ được xét khi các bản ghi trước rời cửa sổ quét`);
}

/**
 * Hồ sơ còn được Gateway tự đóng: CHỈ khi Agent bỏ dở việc thu thập (COLLECTING — chưa ai nhận, chưa ra lead).
 * CỐ Ý không gồm PENDING_INFO / WAITING_QLCS / READY_FOR_REVIEW: ba trạng thái đó đã giao cho NGƯỜI (có thông báo + SLA) — tự đóng im lặng là MẤT khách
 * (khách xin gặp người nhưng thiếu SĐT sẽ biến mất sau vài ngày). Chúng chỉ bị nhắc SLA, người xử lý quyết định đóng.
 */
export const TRANG_THAI_CO_THE_HET_HAN: AiLeadDraftState[] = ["COLLECTING"];
const TRANG_THAI_CAN_NHAC = ["PENDING_INFO", "WAITING_QLCS", "READY_FOR_REVIEW"] as const;

export async function chayDonDep(deps: { dongHo: () => Date }): Promise<KetQuaDonDep> {
  const now = deps.dongHo();
  const kq: KetQuaDonDep = { ok: true, nonceXoa: 0, requestXoa: 0, tuChoiXoa: 0, hetHan: 0, assignmentDong: 0, slaNhac: 0, suCoNhac: 0, catNgan: 0, loi: [] };
  const giaiDoan = async (ten: string, viec: () => Promise<void>) => {
    try {
      await viec();
    } catch (err) {
      kq.ok = false;
      kq.loi.push(`${ten}:${maLoiNoiBo(err)}`);
      console.error(`[ai-lead:don-dep] giai doan=${ten} loi=${maLoiNoiBo(err)}`);
    }
  };

  let cai: Awaited<ReturnType<typeof docCaiDat>> | null = null;
  await giaiDoan("cai-dat", async () => {
    cai = await docCaiDat();
  });
  if (cai === null) return kq; // không đọc được tham số ⇒ không đoán ngưỡng (xoá nhầm nonce còn hiệu lực là mở khe phát lại)
  const c = cai as Awaited<ReturnType<typeof docCaiDat>>;

  await giaiDoan("nonce", async () => {
    const r = await db.aiLeadNonce.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - nonceTtlHieuLucMs(c)) } } });
    kq.nonceXoa = r.count;
  });

  await giaiDoan("request", async () => {
    const r = await db.aiLeadRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - c.requestRetentionDays * NGAY_MS) } } });
    kq.requestXoa = r.count;
  });

  // Bộ đếm từ chối: xả phần còn trong bộ đệm của tiến trình này, rồi dọn dòng quá hạn. Cờ TẮT ⇒ vẫn dọn (đã bật rồi tắt: dữ liệu cũ phải hết hạn), nhưng không xả gì mới.
  await giaiDoan("tu-choi", async () => {
    await xaBoDem();
    kq.tuChoiXoa = await donBoDemCu(now.getTime(), c.rejectLogRetentionDays);
  });

  await giaiDoan("het-han", async () => {
    const cat = new Date(now.getTime() - c.draftExpireHours * 3_600_000);
    const dk = { state: { in: [...TRANG_THAI_CO_THE_HET_HAN] }, claimedById: null, leadId: null, updatedAt: { lt: cat } } satisfies Prisma.AiLeadDraftWhereInput;
    const ds = await db.aiLeadDraft.findMany({ where: dk, select: { id: true, state: true, orgUnitId: true, centerId: true }, orderBy: { updatedAt: "asc" }, take: TRAN_MOI_LUOT });
    for (const d of ds) {
      const daDong = await db.$transaction(async (tx) => {
        const r = await tx.aiLeadDraft.updateMany({
          where: { ...dk, id: d.id },
          data: { state: "EXPIRED", closedAt: now, version: { increment: 1 } },
        });
        if (r.count !== 1) return false; // đã đổi giữa chừng (nhân viên nhận / có cập nhật mới)
        await writeAudit({
          tx,
          actor: { id: null, name: "Hệ thống (AI Lead)" },
          module: "ai-lead",
          entityType: "AiLeadDraft",
          entityId: d.id,
          action: "EXPIRE",
          oldValues: { state: d.state },
          newValues: { state: "EXPIRED" },
          changedFields: ["state"],
          reason: `Quá ${c.draftExpireHours} giờ không có cập nhật và chưa ai nhận`,
          orgUnitId: d.orgUnitId ?? d.centerId,
        });
        return true;
      });
      if (daDong) kq.hetHan += 1;
    }
  });

  await giaiDoan("assignment-pending", async () => {
    // Quét theo KHOÁ `id` (không theo `updatedAt`, không dùng con trỏ Prisma): hồ sơ đóng được đổi `updatedAt` ngay trong vòng quét nên con trỏ theo thời gian sẽ nhảy mất phần còn lại.
    // Trước đây chỉ lấy MỘT trang 200 theo `updatedAt` tăng dần: ≥ 200 hồ sơ mà lead VẪN vô chủ (ở lại hàng chờ mãi) che mất mọi hồ sơ mới hơn đã có sale ⇒ không bao giờ tự đóng.
    await quetTheoTrang(
      (pg) =>
        db.aiLeadDraft.findMany({
          where: { state: "ASSIGNMENT_PENDING", leadId: { not: null }, ...(pg.cursor ? { id: { gt: pg.cursor.id } } : {}) },
          select: { id: true, version: true, leadId: true, orgUnitId: true, centerId: true },
          orderBy: { id: "asc" },
          take: pg.take,
        }),
      async (d) => {
      const leadId = d.leadId as string; // lọc `not: null` ở truy vấn
      const daDong = await db.$transaction(async (tx) => {
        // Đọc LẠI trong giao dịch: «có sale hợp lệ» là điều kiện đóng, không phải ảnh chụp cũ. Sale phải còn hoạt động (một chủ đã nghỉ không phải người đang chăm khách).
        const lead = await tx.lead.findFirst({
          where: { id: leadId, deletedAt: null, assignedToId: { not: null }, assignedTo: { is: { isActive: true, deletedAt: null } } },
          select: { assignedToId: true },
        });
        if (!lead) return false;
        const r = await tx.aiLeadDraft.updateMany({
          where: { id: d.id, version: d.version, state: "ASSIGNMENT_PENDING" },
          data: { state: "COMPLETED", closedAt: now, version: { increment: 1 } },
        });
        if (r.count !== 1) return false; // người vừa đóng tay / có thay đổi khác
        await writeAudit({
          tx,
          actor: { id: null, name: "Hệ thống (AI Lead)" },
          module: "ai-lead",
          entityType: "AiLeadDraft",
          entityId: d.id,
          action: "CLOSE_EXCEPTION_AUTO",
          oldValues: { state: "ASSIGNMENT_PENDING" },
          newValues: { state: "COMPLETED", leadId, assignedToId: lead.assignedToId },
          changedFields: ["state"],
          reason: "Lead đã có sale phụ trách — hệ thống tự đóng ngoại lệ chờ phân công",
          orgUnitId: d.orgUnitId ?? d.centerId,
        });
        return true;
      });
      if (daDong) kq.assignmentDong += 1;
      },
      kq,
      "assignment-pending",
    );
  });

  await giaiDoan("sla", async () => {
    // Bộ quy tắc đọc MỘT lần/lượt. Lỗi đọc ⇒ bậc mặc định (cacBacThongBao nhận null) — SLA không bao giờ im lặng vì quy tắc hỏng.
    let bo: Awaited<ReturnType<typeof docBoHienHanh>> = null;
    try {
      bo = await docBoHienHanh();
    } catch (err) {
      console.error(`[ai-lead:don-dep] doc bo quy tac loi=${maLoiNoiBo(err)}`);
    }
    const nowMs = now.getTime();
    await quetTheoTrang(
      (pg) =>
        db.aiLeadDraft.findMany({
          where: { state: { in: [...TRANG_THAI_CAN_NHAC] }, claimedById: null, leadId: null, slaClaimDueAt: { lt: now, gt: new Date(nowMs - cuaSoQuetPhut(bo?.bo ?? null, "SLA_CLAIM_OVERDUE") * 60_000) } },
          select: { id: true, centerId: true, slaClaimDueAt: true },
          orderBy: [{ slaClaimDueAt: "asc" }, { id: "asc" }],
          ...pg,
        }),
      async (d) => {
        const bacs = cacBacThongBao(bo?.bo ?? null, "SLA_CLAIM_OVERDUE", d.centerId);
        for (const { bac } of cacBacDenHan(bacs, (d.slaClaimDueAt as Date).getTime(), nowMs)) {
          await baoQuaHan({ draftId: d.id, centerId: d.centerId, event: "SLA_CLAIM_OVERDUE", bac, now });
          kq.slaNhac += 1;
        }
      },
      kq,
      "sla-nhan",
    );
    // Leo thang «hồ sơ cần người»: bậc afterMinutes > 0 của DRAFT_NEEDS_STAFF tính từ lúc hồ sơ VÀO trạng thái cần người, chỉ khi chưa ai nhận. Bậc 0 đã gửi lúc đó (baoHoSoCanXuLy) nên bỏ qua.
    // Mốc = `slaClaimDueAt − hạn nhận theo quy tắc`: cột hạn nhận được đặt ĐÚNG lúc hồ sơ cần người (không phải `createdAt` — hồ sơ có thể COLLECTING hàng giờ trước đó,
    // dùng createdAt thì vừa chuyển sang cần người đã bị leo thang ngay; review độc lập 28/10). Gồm cả PENDING_INFO (handoff thiếu thông tin cũng cần người, như `canNguoiXuLy`).
    // Không có dòng NOTIFY nào cho sự kiện này ⇒ không quét. Cửa sổ quét có đáy (tối đa bậc + 24 giờ kể từ hạn) và đi từ CŨ nhất ⇒ hồ sơ ứ không chiếm hết `take` mãi mãi.
    const bacLeo = (bo?.bo.rules ?? []).filter((r) => r.kind === "NOTIFY" && r.event === "DRAFT_NEEDS_STAFF" && r.afterMinutes > 0).map((r) => (r.kind === "NOTIFY" ? r.afterMinutes : 0));
    if (bacLeo.length > 0) {
      const daySo = new Date(nowMs - cuaSoQuetPhut(bo?.bo ?? null, "DRAFT_NEEDS_STAFF") * 60_000);
      await quetTheoTrang(
        (pg) =>
          db.aiLeadDraft.findMany({
            where: { state: { in: [...TRANG_THAI_CAN_NHAC] }, claimedById: null, leadId: null, slaClaimDueAt: { not: null, gt: daySo } },
            select: { id: true, centerId: true, slaClaimDueAt: true, conversation: { select: { pageId: true } } },
            orderBy: [{ slaClaimDueAt: "asc" }, { id: "asc" }],
            ...pg,
          }),
        async (d) => {
          const han = hanSlaTheoQuyTac(bo?.bo ?? null, { pageId: d.conversation.pageId, centerId: d.centerId }, c);
          const moc = (d.slaClaimDueAt as Date).getTime() - han.claimMinutes * 60_000;
          const bacs = cacBacThongBao(bo?.bo ?? null, "DRAFT_NEEDS_STAFF", d.centerId);
          for (const { bac } of cacBacDenHan(bacs, moc, nowMs)) {
            if (bac.afterMinutes === 0) continue;
            await baoHoSoCanXuLy({ draftId: d.id, centerId: d.centerId, now, bac });
            kq.slaNhac += 1;
          }
        },
        kq,
        "leo-thang-ho-so",
      );
    }
    await quetTheoTrang(
      (pg) =>
        db.aiLeadDraft.findMany({
          where: { state: "IN_PROGRESS", claimedById: { not: null }, leadId: null, slaResolveDueAt: { lt: now, gt: new Date(nowMs - cuaSoQuetPhut(bo?.bo ?? null, "SLA_RESOLVE_OVERDUE") * 60_000) } },
          select: { id: true, centerId: true, slaResolveDueAt: true },
          orderBy: [{ slaResolveDueAt: "asc" }, { id: "asc" }],
          ...pg,
        }),
      async (d) => {
        const bacs = cacBacThongBao(bo?.bo ?? null, "SLA_RESOLVE_OVERDUE", d.centerId);
        for (const { bac } of cacBacDenHan(bacs, (d.slaResolveDueAt as Date).getTime(), nowMs)) {
          await baoQuaHan({ draftId: d.id, centerId: d.centerId, event: "SLA_RESOLVE_OVERDUE", bac, now });
          kq.slaNhac += 1;
        }
      },
      kq,
      "sla-xu-ly",
    );
  });

  await giaiDoan("su-co", async () => {
    let bo: Awaited<ReturnType<typeof docBoHienHanh>> = null;
    try {
      bo = await docBoHienHanh();
    } catch (err) {
      console.error(`[ai-lead:don-dep] doc bo quy tac loi=${maLoiNoiBo(err)}`);
    }
    const bacs = cacBacThongBao(bo?.bo ?? null, "INCIDENT", null);
    if (bacs.every((b) => b.afterMinutes === 0)) return; // không có bậc leo thang nào ⇒ không cần quét
    // Mốc leo thang = lần MỞ LẠI gần nhất nếu có, không thì lúc phát hiện đầu (`firstSeenAt`). Sự cố mở lại sau nhiều giờ KHÔNG bị leo thang ngay bằng mốc cũ, và khoá thông báo mang số lần mở lại
    // (`lanMoLai`) nên bậc đã gửi ở lần trước không nuốt bậc của lần này. Cửa sổ quét tính theo CHÍNH mốc ấy.
    const day = new Date(now.getTime() - cuaSoQuetPhut(bo?.bo ?? null, "INCIDENT") * 60_000);
    await quetTheoTrang(
      (pg) =>
        db.aiLeadIncident.findMany({
          where: { state: "OPEN", severity: { in: ["HIGH", "CRITICAL"] }, OR: [{ moLaiLuc: { gt: day } }, { moLaiLuc: null, firstSeenAt: { gt: day } }] },
          select: { id: true, severity: true, firstSeenAt: true, moLaiLuc: true, soLanMoLai: true },
          orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
          ...pg,
        }),
      async (s) => {
        const moc = (s.moLaiLuc ?? s.firstSeenAt).getTime();
        for (const { bac } of cacBacDenHan(bacs, moc, now.getTime())) {
          if (bac.afterMinutes === 0) continue; // bậc 0 đã gửi lúc nhận sự cố / lúc mở lại
          await baoSuCoAgent({ incidentId: s.id, severity: s.severity === "CRITICAL" ? "CRITICAL" : "HIGH", now, bac, ...(s.soLanMoLai > 0 ? { lanMoLai: s.soLanMoLai } : {}) });
          kq.suCoNhac += 1;
        }
      },
      kq,
      "su-co",
    );
  });

  return kq;
}
