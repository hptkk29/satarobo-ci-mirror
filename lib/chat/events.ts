// lib/chat/events.ts — TÊN các DomainEvent của module chat.
//
// Module này CỐ Ý không import gì (không Prisma, không `server-only`): nơi PHÁT event
// là `lib/chat/sync-membership.ts` — file bị script ZZTEST và cron import trực tiếp
// dưới `tsx`. Nếu để hằng nằm cùng file handler thì phát sinh chuỗi
// sync-membership → handler → broadcast → `import "server-only"` → MODULE_NOT_FOUND
// ngoài Next (đã cháy một lần khi thêm F-KICK). Handler và publisher chỉ chung nhau
// đúng chuỗi tên này.

/** F-KICK bước 3 — payload: `{ conversationId, userId }`. Handler: lib/chat/_handlers/participant-removed.ts */
export const CHAT_PARTICIPANT_REMOVED = "chat.participant_removed";
