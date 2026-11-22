// lib/payments/pos/agent/agent-chon.ts — HÌNH DẠNG một máy đồng bộ đã xác thực (GĐ4 POS). Chỉ kiểu + câu chọn.
//
// Tách khỏi `xac-thuc.ts` để `phien.ts` (mà `xac-thuc.ts` gọi `chamSong`) đọc được kiểu này mà không tạo vòng
// import xac-thuc → phien → xac-thuc (dependency-cruiser `no-circular` là lỗi chặn CI).
import type { Prisma } from "@prisma/client";

/** Phần của PosAgent mà mọi tầng sau xác thực cần — một câu đọc cho cả request. */
export const CHON_AGENT = {
  id: true,
  centerId: true,
  orgUnitId: true,
  merchantCode: true,
  secretVersion: true,
  active: true,
  lastHeartbeatAt: true,
  matKetNoiTuLuc: true,
  sessionState: true,
  sessionDoiLuc: true,
  sessionExpiresAt: true,
  extensionVersion: true,
  profileName: true,
  lastSyncedAt: true,
  center: { select: { code: true, name: true } },
} as const satisfies Prisma.PosAgentSelect;

export type AgentDaXacThuc = Prisma.PosAgentGetPayload<{ select: typeof CHON_AGENT }>;
