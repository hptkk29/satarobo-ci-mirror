import "server-only";
// lib/ai-lead/dich-vu/handoff.ts — POST /handoffs: Agent xin chuyển hội thoại cho nhân viên. MỘT CHIỀU từ phía Agent; Meta (thread control) mới quyết ai được nhắn.
//
// · Bảng kết quả CỐ ĐỊNH theo `ownerState` (`bangHandoff`) — không suy từ lead/CRM.
// · Chuyển `AI_ACTIVE → HANDOFF_REQUESTED` bằng UPDATE CÓ ĐIỀU KIỆN (`ownerState = AI_ACTIVE`) dưới KHOÁ HÀNG hội thoại: hai handoff song song chỉ MỘT được `QUEUED`
//   (một tin chờ duy nhất); đổi 0 dòng ⇒ chạy lại cả giao dịch (không bao giờ trả QUEUED hai lần).
// · PAGE_PAUSED KHÔNG chặn handoff (xac-thuc.ts chỉ áp cho /lead-intakes): khách vẫn xin gặp người được khi Page tạm dừng nhận hồ sơ.
// · Hồ sơ đang `COLLECTING` của hội thoại này chuyển sang trạng thái cần người (Agent không còn hỏi khách nữa) — và có thông báo SAU commit.
import { db } from "@/lib/db";
import { taoReceiptId } from "../phan-hoi";
import { bangHandoff } from "../trang-thai-handoff";
import type { OwnerState } from "../kieu";
import type { KetQuaXuLy, NguCanhYeuCau } from "../xac-thuc";
import { capNhatHoiThoai, khoaHoiThoai } from "./hoi-thoai";
import { ChayLaiGiaoDich, dungThanOk, ghiPhanHoiTrongTx, giaoDichCoThuLai, giuKhoaTrongTx, bamNoiDung } from "./idempotency";
import type { LenLichNen } from "./nen";
import { baoHoSoCanXuLy } from "./thong-bao";
import { thieuDieuKien } from "./dieu-kien";
import { canNguoiXuLy, danhSachThieu, tinhHanSla, tinhTrangThaiThuThap } from "./tinh-ho-so";
import { hanSlaTheoQuyTac } from "./bo-quy-tac";
import { docBoHienHanh } from "./bo-quy-tac-db";
import { maLoiNoiBo } from "../loi-he-thong";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Hồ sơ `COLLECTING` của hội thoại ⇒ tính lại khi AI thôi giữ hội thoại. Trả các hồ sơ vừa chuyển sang trạng thái CẦN NGƯỜI (để báo sau commit).
 * `updateMany … where state = COLLECTING` — nhân viên (lát C) có thể vừa đổi trạng thái hồ sơ; đổi 0 dòng là vô hại.
 */
export async function chuyenHoSoThuThapSangNguoi(
  tx: Tx,
  x: {
    conversationId: string;
    ownerState: OwnerState;
    now: Date;
    /** Hạn SLA theo BỘ QUY TẮC (cơ sở > Page > mặc định > tham số ai.*) — cùng nguồn với `/lead-intakes`, không tính riêng bằng tham số trần. BẮT BUỘC (luật 7). */
    hanSla: (centerId: string | null) => ReturnType<typeof tinhHanSla>;
    ruleSetVersion: number | null;
  },
): Promise<{ draftId: string; centerId: string | null }[]> {
  const ds = await tx.aiLeadDraft.findMany({
    where: { conversationId: x.conversationId, state: "COLLECTING" },
    select: { id: true, centerId: true, fbName: true, fbNameSource: true, phoneCanonical: true, phoneRaw: true, campusCenterId: true, evidence: true, slaClaimDueAt: true },
  });
  const ra: { draftId: string; centerId: string | null }[] = [];
  for (const d of ds) {
    const thieu = thieuDieuKien(d);
    const moi = tinhTrangThaiThuThap({ thieu, ownerState: x.ownerState });
    if (moi === "COLLECTING") continue;
    const r = await tx.aiLeadDraft.updateMany({
      where: { id: d.id, state: "COLLECTING" },
      data: {
        state: moi,
        missingFields: danhSachThieu(thieu),
        version: { increment: 1 },
        ...(canNguoiXuLy(moi) && d.slaClaimDueAt === null ? { ...x.hanSla(d.centerId), ruleSetVersion: x.ruleSetVersion } : {}),
      },
    });
    if (r.count === 1 && canNguoiXuLy(moi)) ra.push({ draftId: d.id, centerId: d.centerId });
  }
  return ra;
}

export async function xuLyHandoff(ctx: NguCanhYeuCau<"handoffs">, deps: { lenLichNen: LenLichNen }): Promise<KetQuaXuLy> {
  const b = ctx.body;
  const now = new Date(ctx.nowMs);
  const hash = bamNoiDung("handoffs", b);
  const hoiThoai = await capNhatHoiThoai(ctx.agent.id, b.conversation, ctx.nowMs);
  // Bộ quy tắc đọc NGOÀI giao dịch; lỗi/hỏng ⇒ hạn rơi về tham số ai.* (handoff của khách không bao giờ hỏng vì quy tắc).
  let boQuyTac: Awaited<ReturnType<typeof docBoHienHanh>> = null;
  try {
    boQuyTac = await docBoHienHanh();
  } catch (err) {
    console.error(`[ai-lead:handoff] doc bo quy tac loi=${maLoiNoiBo(err)}`);
  }
  const hanSla = (centerId: string | null) => {
    const h = hanSlaTheoQuyTac(boQuyTac?.bo ?? null, { pageId: b.conversation.pageId, centerId }, ctx.cai);
    return tinhHanSla(now, { slaClaimMinutes: h.claimMinutes, slaResolveMinutes: h.resolveMinutes });
  };

  const kq = await giaoDichCoThuLai(async (tx) => {
    const g = await giuKhoaTrongTx(tx, { agentId: ctx.agent.id, key: b.idempotencyKey, endpoint: "handoffs", hash });
    if (g.loai === "xung-dot") return { loai: "xung-dot" as const };
    if (g.loai === "phat-lai") return { loai: "phat-lai" as const, body: g.body };

    const h = await khoaHoiThoai(tx, hoiThoai.id);
    const bang = bangHandoff(h.ownerState);
    let canBao: { draftId: string; centerId: string | null }[] = [];
    if (h.ownerState === "AI_ACTIVE") {
      const r = await tx.aiLeadConversation.updateMany({
        where: { id: h.id, ownerState: "AI_ACTIVE" },
        data: { ownerState: "HANDOFF_REQUESTED", holdingSentAt: now },
      });
      // Dưới khoá hàng thì không thể 0 — nhưng nếu có đường ghi không khoá nào đổi trạng thái giữa chừng, chạy lại để bảng được tính trên trạng thái THẬT.
      if (r.count !== 1) throw new ChayLaiGiaoDich("ownerState đổi giữa chừng");
      canBao = await chuyenHoSoThuThapSangNguoi(tx, { conversationId: h.id, ownerState: "HANDOFF_REQUESTED", now, hanSla, ruleSetVersion: boQuyTac?.version ?? null });
    }
    const body = dungThanOk(ctx, { receiptId: taoReceiptId(), ...bang });
    await ghiPhanHoiTrongTx(tx, { agentId: ctx.agent.id, key: b.idempotencyKey, status: 200, body });
    return { loai: "ok" as const, body, canBao };
  });

  if (kq.loai === "xung-dot") return { loai: "xung-dot" };
  if (kq.loai === "phat-lai") return { loai: "phat-lai", body: kq.body };
  if (kq.canBao.length > 0) {
    deps.lenLichNen(async () => {
      for (const d of kq.canBao) await baoHoSoCanXuLy({ draftId: d.draftId, centerId: d.centerId, now });
    });
  }
  return { loai: "ok", body: kq.body };
}
