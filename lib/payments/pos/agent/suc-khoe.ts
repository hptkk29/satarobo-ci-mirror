// lib/payments/pos/agent/suc-khoe.ts — CHỌN nguồn + SỨC KHOẺ máy đồng bộ (GĐ4 POS — T15). THUẦN. §6.1.
//
// "Cơ sở có PosAgent active ⇒ agent, không có ⇒ provider file" (đặc tả mục 4) theo DỮ LIỆU, MỘT hàm, không
// SystemSetting (bài học `PAYMENT_LEDGER_V2`: công tắc chưa nối là cờ chết). Không đoán khi một cơ sở có nhiều
// merchant: máy của phiếu ĐÃ KHAI merchant ⇒ ĐÚNG agent merchant đó, không agent nào khớp ⇒ FILE (rà đối kháng
// RV-08 — bản đầu rơi xuống "agent duy nhất" ⇒ job cho agent không bao giờ thấy giao dịch của merchant ấy, NOT_FOUND /
// FAILED cũ bị coi là tươi); máy CHƯA khai merchant ⇒ agent đang bật DUY NHẤT; 0 / ≥ 2 ⇒ FILE.
import type { PosAgentEventType, PosAgentSessionState } from "@prisma/client";
import { NGUONG_MAT_KET_NOI_MS } from "./hop-dong";
import { chuanMa } from "./may";

export function chonAgentChoPhieu<T extends { id: string; merchantCode: string; active: boolean }>(x: {
  agentsCuaCoSo: readonly T[];
  maNhaCungCapCuaMay: string | null;
}): T | null {
  const bat = x.agentsCuaCoSo.filter((a) => a.active);
  const merchant = chuanMa(x.maNhaCungCapCuaMay);
  if (merchant !== "") {
    const khop = bat.filter((a) => chuanMa(a.merchantCode) === merchant);
    return khop.length === 1 ? khop[0]! : null;
  }
  return bat.length === 1 ? bat[0]! : null;
}

export function chonCheDoNguonPos(agent: { active: boolean } | null): "AGENT" | "FILE" {
  return agent !== null && agent.active ? "AGENT" : "FILE";
}

export type SucKhoeAgent = "SAN_SANG" | "HET_PHIEN" | "MAT_KET_NOI" | "CHUA_KET_NOI" | "CHUA_SAN_SANG";

/**
 * EXPIRED ⇒ HET_PHIEN · chưa gọi lần nào ⇒ CHUA_KET_NOI · im > 180 000 ms ⇒ MAT_KET_NOI (ĐÚNG 180 000 vẫn sẵn
 * sàng) · UNKNOWN ⇒ CHUA_SAN_SANG · còn lại SAN_SANG. "Còn sống" = mọi request đã ký hợp lệ (T4).
 */
export function sucKhoeAgent(a: { sessionState: PosAgentSessionState; lastHeartbeatAt: Date | null }, now: Date): SucKhoeAgent {
  if (a.sessionState === "EXPIRED") return "HET_PHIEN";
  if (a.lastHeartbeatAt === null) return "CHUA_KET_NOI";
  if (now.getTime() - a.lastHeartbeatAt.getTime() > NGUONG_MAT_KET_NOI_MS) return "MAT_KET_NOI";
  if (a.sessionState === "UNKNOWN") return "CHUA_SAN_SANG";
  return "SAN_SANG";
}

/**
 * Thời gian sống của phiên portal (GĐ6 chốt có cần chuông 07:30 không): mỗi cặp SESSION_READY → SESSION_EXPIRED
 * kế tiếp là một phiên; phiên ĐANG sống (READY chưa có EXPIRED sau) không tính vào trung bình.
 */
export function thoiGianSongPhien(
  suKien: readonly { type: PosAgentEventType; createdAt: Date }[],
): { soPhien: number; tbMs: number | null } {
  const ds = [...suKien]
    .filter((e) => e.type === "SESSION_READY" || e.type === "SESSION_EXPIRED")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let batDau: Date | null = null;
  const song: number[] = [];
  for (const e of ds) {
    if (e.type === "SESSION_READY") batDau = batDau ?? e.createdAt;
    else if (batDau !== null) {
      song.push(e.createdAt.getTime() - batDau.getTime());
      batDau = null;
    }
  }
  if (song.length === 0) return { soPhien: 0, tbMs: null };
  return { soPhien: song.length, tbMs: Math.round(song.reduce((s, x) => s + x, 0) / song.length) };
}
