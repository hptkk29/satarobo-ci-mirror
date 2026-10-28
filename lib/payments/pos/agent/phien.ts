import "server-only";
// lib/payments/pos/agent/phien.ts — CÒN SỐNG · PHIÊN PORTAL · LỖI của máy đồng bộ (GĐ4 POS). Thiết kế: §4.4, §8.1.
//
// MỘT hàm đổi trạng thái phiên (`chuyenTrangThaiPhien`) cho cả `/status` lẫn `/heartbeat`: `updateMany` CÓ
// ĐIỀU KIỆN `sessionState ≠ mới` ⇒ chỉ lượt ĐỔI (count = 1) mới ghi sự kiện + báo — hai request đua không
// đôi chuông. Heartbeat KHÔNG ghi sự kiện mỗi lượt (T19) và `UNKNOWN` không hạ trạng thái đang có.
import type { PosAgentSessionState } from "@prisma/client";
import { db } from "@/lib/db";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { CHAM_SONG_TOI_THIEU_MS } from "./hop-dong";
import { ghiLoiGop, ghiSuKien } from "./su-kien";
import { baoHetPhien, baoLoiAgent } from "./canh-bao";
import { mocHetHanTinDuoc, nhanCoSo } from "./canh-bao-luat";
import { docNextPollMs } from "./nhip-doc";
import type { ThanHeartbeat, ThanStatus } from "./schema";
import type { AgentDaXacThuc } from "./agent-chon";

type AgentPhien = Pick<
  AgentDaXacThuc,
  "id" | "centerId" | "orgUnitId" | "lastHeartbeatAt" | "matKetNoiTuLuc" | "extensionVersion" | "sessionState" | "center"
>;

/**
 * "Còn sống" (T4) — MỌI request đã ký hợp lệ chạm vào đây, không chỉ `/heartbeat`: GĐ5 gửi heartbeat 10′/lần
 * nhưng ngưỡng gác sale là 3′ — `GET /jobs` mỗi 60″ là nhịp sống. Ghi `lastHeartbeatAt` tối đa 1 lần / 15″
 * (`updateMany` có điều kiện — đổi 0 dòng là vừa ghi, vô hại).
 *  · lần đầu tiên (`lastHeartbeatAt` null) ⇒ sự kiện `HEARTBEAT/LAN_DAU` (chỉ lượt thắng);
 *  · đang bị cron đánh dấu mất kết nối ⇒ xoá dấu + `HEARTBEAT/KET_NOI_LAI { matTuLuc, phut }` (chỉ lượt thắng).
 */
export async function chamSong(agent: AgentPhien, now: Date): Promise<void> {
  if (agent.lastHeartbeatAt === null) {
    const u = await db.posAgent.updateMany({ where: { id: agent.id, lastHeartbeatAt: null }, data: { lastHeartbeatAt: now } });
    if (u.count === 1) {
      await ghiSuKien({ agent, type: "HEARTBEAT", ma: "LAN_DAU", detail: { extensionVersion: agent.extensionVersion }, now });
    }
  } else {
    await db.posAgent.updateMany({
      where: { id: agent.id, lastHeartbeatAt: { lt: new Date(now.getTime() - CHAM_SONG_TOI_THIEU_MS) } },
      data: { lastHeartbeatAt: now },
    });
  }
  if (agent.matKetNoiTuLuc !== null) {
    const u = await db.posAgent.updateMany({ where: { id: agent.id, matKetNoiTuLuc: { not: null } }, data: { matKetNoiTuLuc: null } });
    if (u.count === 1) {
      await ghiSuKien({
        agent,
        type: "HEARTBEAT",
        ma: "KET_NOI_LAI",
        detail: {
          matTuLuc: gioVN(agent.matKetNoiTuLuc),
          phut: Math.max(0, Math.round((now.getTime() - agent.matKetNoiTuLuc.getTime()) / 60_000)),
        },
        now,
      });
    }
  }
}

/**
 * Đổi trạng thái phiên portal — CHỈ lượt đổi thắng ghi sự kiện + báo. `EXPIRED` ⇒ chuông `pos.agent-het-phien:`
 * (mọi giờ, `reopen` — lần hết phiên mới trong ngày rung lại với giờ mới). `sessionExpiresAt` (khi có) ghi
 * kèm, kể cả khi trạng thái không đổi.
 */
export async function chuyenTrangThaiPhien(x: {
  agent: AgentPhien;
  moi: Exclude<PosAgentSessionState, "UNKNOWN">;
  lyDo: string;
  occurredAt: string | null;
  profileName: string | null;
  sessionExpiresAt?: Date | null;
  now: Date;
}): Promise<{ doi: boolean }> {
  const exp = x.sessionExpiresAt !== undefined ? { sessionExpiresAt: x.sessionExpiresAt } : {};
  const u = await db.posAgent.updateMany({
    where: { id: x.agent.id, sessionState: { not: x.moi } },
    data: { sessionState: x.moi, sessionDoiLuc: x.now, sessionLyDo: x.lyDo.slice(0, 64), ...exp },
  });
  if (u.count === 0) {
    if (x.sessionExpiresAt !== undefined) await db.posAgent.update({ where: { id: x.agent.id }, data: exp });
    return { doi: false };
  }
  const xay = x.occurredAt ? Date.parse(x.occurredAt) : NaN;
  await ghiSuKien({
    agent: x.agent,
    type: x.moi === "EXPIRED" ? "SESSION_EXPIRED" : "SESSION_READY",
    ma: null,
    detail: {
      reason: x.lyDo.slice(0, 64),
      occurredAt: x.occurredAt,
      lechGioMs: Number.isNaN(xay) ? null : x.now.getTime() - xay,
      profileName: x.profileName,
    },
    now: x.now,
  });
  if (x.moi === "EXPIRED") {
    await baoHetPhien({ centerId: x.agent.centerId, coSo: nhanCoSo(x.agent.center), luc: x.now, now: x.now, reopen: true });
  }
  return { doi: true };
}

/**
 * `/status ERROR` (T20) — mã lý do, không chữ tự do. KHÔNG đổi trạng thái phiên. Sự kiện gộp (agent, mã, ngày);
 * chuông `pos.agent-loi:` chỉ khi sự kiện MỚI (mã mới trong ngày) ⇒ cùng mã gửi lặp không rung lại.
 */
export async function ghiLoiAgent(x: { agent: AgentPhien; ma: string; httpStatus: number | null; now: Date }): Promise<void> {
  await db.posAgent.update({ where: { id: x.agent.id }, data: { loiGanNhat: x.ma, loiGanNhatLuc: x.now } });
  const { moi } = await ghiLoiGop({ agent: x.agent, ma: x.ma, detail: x.httpStatus !== null ? { httpStatus: x.httpStatus } : {}, now: x.now });
  if (moi) await baoLoiAgent({ centerId: x.agent.centerId, coSo: nhanCoSo(x.agent.center), ma: x.ma, now: x.now });
}

/** `POST /heartbeat` (hợp đồng §4.1). */
export async function nhanHeartbeat(x: {
  agent: AgentDaXacThuc;
  than: ThanHeartbeat;
  now: Date;
}): Promise<{ nextPollMs: number; serverTime: number; merchantCode: string; sessionState: PosAgentSessionState }> {
  const { agent, than, now } = x;
  let sessionState: PosAgentSessionState = agent.sessionState;
  // Chốt hợp đồng 1.1 (RV5.4 #5): nguồn `SESSION` ⇒ KHÔNG rõ hạn (null) — không lưu một hạn trượt +30 ngày, 07:30
  // không báo theo nó ([POS4-HD-05], [POS4-CHOT-04]).
  const exp = mocHetHanTinDuoc(than);
  // READY/EXPIRED khác trạng thái lưu ⇒ đổi y như `/status`. UNKNOWN KHÔNG hạ trạng thái đang có.
  if (than.sessionState !== "UNKNOWN") {
    if (than.sessionState !== agent.sessionState) {
      await chuyenTrangThaiPhien({
        agent,
        moi: than.sessionState,
        lyDo: "HEARTBEAT",
        occurredAt: null,
        profileName: than.profileName ?? agent.profileName,
        now,
      });
    }
    sessionState = than.sessionState;
  }
  // Mốc hết hạn phiên + hồ sơ: ghi khi ĐỔI (heartbeat 10′/lần không đẻ phép ghi vô ích). UNKNOWN ⇒ agent
  // chưa kiểm được, không xoá mốc đang biết.
  const doiExp = than.sessionState !== "UNKNOWN" && (exp?.getTime() ?? null) !== (agent.sessionExpiresAt?.getTime() ?? null);
  const doiHoSo = than.profileName !== undefined && than.profileName !== agent.profileName;
  if (doiExp || doiHoSo) {
    await db.posAgent.update({
      where: { id: agent.id },
      data: { ...(doiExp ? { sessionExpiresAt: exp } : {}), ...(doiHoSo ? { profileName: than.profileName } : {}) },
    });
  }
  // Đổi phiên bản extension ⇒ MỘT sự kiện (lượt thắng `updateMany` theo giá trị cũ). Lần đầu khai (cũ null)
  // không phải "đổi" — LAN_DAU đã ghi lúc chạm sống.
  if (than.extensionVersion !== agent.extensionVersion) {
    const u = await db.posAgent.updateMany({
      where: { id: agent.id, extensionVersion: agent.extensionVersion },
      data: { extensionVersion: than.extensionVersion },
    });
    if (u.count === 1 && agent.extensionVersion !== null) {
      await ghiSuKien({ agent, type: "HEARTBEAT", ma: "DOI_PHIEN_BAN", detail: { tu: agent.extensionVersion, den: than.extensionVersion }, now });
    }
  }
  return { nextPollMs: await docNextPollMs(agent, now), serverTime: now.getTime(), merchantCode: agent.merchantCode, sessionState };
}

/** `POST /status` (hợp đồng §4.2). */
export async function nhanStatus(x: {
  agent: AgentDaXacThuc;
  than: ThanStatus;
  now: Date;
}): Promise<{ sessionState: PosAgentSessionState; nextPollMs: number; serverTime: number }> {
  const { agent, than, now } = x;
  let sessionState: PosAgentSessionState = agent.sessionState;
  if (than.state === "ERROR") {
    await ghiLoiAgent({ agent, ma: than.reason, httpStatus: than.httpStatus ?? null, now });
  } else {
    const moi = than.state === "SESSION_EXPIRED" ? "EXPIRED" : "READY";
    await chuyenTrangThaiPhien({
      agent,
      moi,
      lyDo: than.reason,
      occurredAt: than.occurredAt,
      profileName: than.profileName ?? agent.profileName,
      ...(moi === "READY" && than.sessionExpiresAt !== undefined
        ? { sessionExpiresAt: than.sessionExpiresAt === null ? null : new Date(than.sessionExpiresAt) }
        : {}),
      now,
    });
    sessionState = moi;
    if (than.profileName !== undefined && than.profileName !== agent.profileName) {
      await db.posAgent.update({ where: { id: agent.id }, data: { profileName: than.profileName } });
    }
  }
  return { sessionState, nextPollMs: await docNextPollMs(agent, now), serverTime: now.getTime() };
}
