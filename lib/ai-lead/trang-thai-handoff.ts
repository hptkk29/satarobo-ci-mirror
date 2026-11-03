// lib/ai-lead/trang-thai-handoff.ts — BẢNG CỐ ĐỊNH của POST /handoffs theo `ownerState` của hội thoại (handoff-guide.md §4.3; error-codes.md §6.2). HÀM THUẦN.
//
// KHÔNG suy gì từ lead/CRM (nguyên tắc 6 của gói bàn giao): kết quả chỉ phụ thuộc trạng thái hội thoại.
//   AI_ACTIVE                       → QUEUED              · HANDOFF_REQUESTED · SEND_HOLDING_MESSAGE   (và hội thoại chuyển sang HANDOFF_REQUESTED)
//   HANDOFF_REQUESTED/TAKEOVER_PENDING → ALREADY_QUEUED    · HANDOFF_REQUESTED · STAY_SILENT
//   HUMAN_ACTIVE                    → ALREADY_HUMAN_OWNED · HUMAN_ACTIVE      · STAY_SILENT
//   PAUSED                          → ALREADY_HUMAN_OWNED · PAUSED            · STAY_SILENT
import type { HanhDongHandoff, OwnerMode, OwnerState, TrangThaiHandoff } from "./kieu";

export type KetQuaBangHandoff = { handoffStatus: TrangThaiHandoff; ownerMode: OwnerMode; nextAction: HanhDongHandoff };

export function bangHandoff(ownerState: OwnerState): KetQuaBangHandoff {
  switch (ownerState) {
    case "AI_ACTIVE":
      return { handoffStatus: "QUEUED", ownerMode: "HANDOFF_REQUESTED", nextAction: "SEND_HOLDING_MESSAGE" };
    case "HANDOFF_REQUESTED":
    case "TAKEOVER_PENDING":
      return { handoffStatus: "ALREADY_QUEUED", ownerMode: "HANDOFF_REQUESTED", nextAction: "STAY_SILENT" };
    case "HUMAN_ACTIVE":
      return { handoffStatus: "ALREADY_HUMAN_OWNED", ownerMode: "HUMAN_ACTIVE", nextAction: "STAY_SILENT" };
    case "PAUSED":
      return { handoffStatus: "ALREADY_HUMAN_OWNED", ownerMode: "PAUSED", nextAction: "STAY_SILENT" };
  }
}
