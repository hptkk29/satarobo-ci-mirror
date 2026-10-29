import "server-only";
// lib/ai-lead/dich-vu/heartbeat.ts — POST /heartbeats: nhịp sống có ký (L2) + nhận lệnh thăm dò.
//
// Một heartbeat hợp lệ CHỈ chứng minh "agent này, môi trường này, ký đúng, hợp đồng này" — không chứng minh webhook Meta hay E2E. Ghi `AiLeadAgent.last*` (KHÔNG PII).
//
//  · `pages[]` của yêu cầu KHÔNG bị kiểm allowlist (P5): pageId lạ bị BỎ QUA im lặng; phản hồi chỉ liệt kê Page ĐƯỢC CẤP cho agent.
//  · Thăm dò: `probe` = lệnh chưa ack và chưa hết hạn của CHÍNH agent này; `probeAck` khớp (probeId + nonce, đúng agent, chưa ack, chưa hết hạn) ⇒ đóng lệnh +
//    ghi `AiLeadVerificationRun { L2, PROBE, PASS }`. Ack sai/hết hạn/của agent khác ⇒ bỏ qua im lặng (không lỗi, không lộ lệnh nào tồn tại).
//  · Ack làm TRƯỚC khi chọn `probe` để lệnh vừa đóng không bị trả lại trong chính phản hồi này.
import { db } from "@/lib/db";
import { safeEqual } from "@/lib/security/safe-equal";
import { BIEN_HEARTBEAT_GIAY } from "../hop-dong";
import { dungThanOk } from "./idempotency";
import { layCatalogMoiNhat } from "./catalog";
import type { KetQuaXuLy, NguCanhYeuCau } from "../xac-thuc";

/** `nextHeartbeatSeconds` luôn nằm trong biên của hợp đồng dù tham số `ai.heartbeatSeconds` bị cấu hình ngoài biên. */
export function kepNhipHeartbeat(giay: number): number {
  return Math.min(BIEN_HEARTBEAT_GIAY.max, Math.max(BIEN_HEARTBEAT_GIAY.min, Math.floor(giay)));
}

export async function xuLyHeartbeat(ctx: NguCanhYeuCau<"heartbeats">): Promise<KetQuaXuLy> {
  const b = ctx.body;
  const now = new Date(ctx.nowMs);

  // 1) Ghi dấu nhịp sống. Thân heartbeat gần nhất đã CHE: chỉ cái không phải PII (không nonce của probeAck).
  await db.aiLeadAgent.update({
    where: { id: ctx.agent.id },
    data: {
      lastHeartbeatAt: now,
      lastAgentVersion: b.agentVersion,
      lastBuildSha: b.buildSha,
      lastContractHash: b.contractHash,
      lastHeartbeatPayload: {
        environment: b.environment,
        capabilities: b.capabilities,
        catalogVersionSeen: b.catalogVersionSeen ?? null,
        pages: b.pages.map((p) => ({ pageId: p.pageId, lastWebhookEventAt: p.lastWebhookEventAt })),
        probeAck: b.probeAck ? { probeId: b.probeAck.probeId } : null,
        sentAt: b.sentAt,
      },
    },
  });

  // 2) Ack của lệnh thăm dò trước (nếu có).
  if (b.probeAck) {
    const lenh = await db.aiLeadProbe.findFirst({
      where: { probeId: b.probeAck.probeId, agentId: ctx.agent.id },
      select: { id: true, nonce: true },
    });
    if (lenh && safeEqual(lenh.nonce, b.probeAck.nonce)) {
      await db.$transaction(async (tx) => {
        // Có điều kiện (chưa ack · chưa hết hạn): hai heartbeat song song cùng ack ⇒ chỉ MỘT lần ghi bằng chứng.
        const r = await tx.aiLeadProbe.updateMany({ where: { id: lenh.id, ackedAt: null, expiresAt: { gt: now } }, data: { ackedAt: now } });
        if (r.count !== 1) return;
        await tx.aiLeadVerificationRun.create({
          data: {
            agentId: ctx.agent.id,
            level: "L2",
            kind: "PROBE",
            status: "PASS",
            // `environment` + `pageIds` là phần Trung tâm kết nối đòi để phát hiện "đổi môi trường / đổi tập Page" sau khi bằng chứng được ghi.
            evidence: {
              nguon: "HE_THONG",
              agentId: ctx.agent.id,
              buildSha: b.buildSha,
              contractHash: b.contractHash,
              probeId: b.probeAck!.probeId,
              environment: ctx.agent.environment,
              pageIds: ctx.agent.pages.map((p) => p.pageId),
            },
            contractHash: b.contractHash,
            buildSha: b.buildSha,
          },
        });
      });
    }
  }

  // 3) Lệnh thăm dò đang chờ + catalog mới nhất.
  const [probe, snap] = await Promise.all([
    db.aiLeadProbe.findFirst({ where: { agentId: ctx.agent.id, ackedAt: null, expiresAt: { gt: now } }, orderBy: { issuedAt: "desc" }, select: { probeId: true, nonce: true, expiresAt: true } }),
    layCatalogMoiNhat(),
  ]);

  return {
    loai: "ok",
    body: dungThanOk(ctx, {
      serverTime: ctx.nowMs,
      nextHeartbeatSeconds: kepNhipHeartbeat(ctx.cai.heartbeatSeconds),
      contractStatus: ctx.agent.contractStatus,
      // Chưa có bản xuất bản nào ⇒ 1 (hợp đồng đòi ≥ 1). Khớp `GET /catalog` trả 503 cho tới khi HO xuất bản.
      latestCatalogVersion: snap?.version ?? 1,
      pages: ctx.agent.pages.map((p) => ({ pageId: p.pageId, state: p.state })),
      probe: probe ? { probeId: probe.probeId, nonce: probe.nonce, expiresAt: probe.expiresAt.toISOString() } : null,
    }),
  };
}
