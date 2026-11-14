import { describe, it, expect } from "vitest";
import {
  isPendingSyncKey,
  pendingSyncKey,
  PENDING_SYNC_TYPES,
} from "./pending-sync";

// BUG-1 — bộ test này là lưới chặn cho đúng một câu hỏi: vòng đồng bộ việc tồn có được
// phép đụng vào dedupeKey này không? Nhận nhầm = quay lại lỗi cũ (thông báo của cron bị
// dập đã-đọc trước khi người dùng kịp thấy).

describe("pendingSyncKey", () => {
  it("nối đúng mẫu <loại>:<pending|overdue>", () => {
    expect(pendingSyncKey("lead_followup", "pending")).toBe("lead_followup:pending");
    expect(pendingSyncKey("session_incomplete", "overdue")).toBe("session_incomplete:overdue");
  });

  it("mọi khoá do chính nó sinh ra đều được nhận lại", () => {
    for (const type of PENDING_SYNC_TYPES) {
      expect(isPendingSyncKey(pendingSyncKey(type, "pending"))).toBe(true);
      expect(isPendingSyncKey(pendingSyncKey(type, "overdue"))).toBe(true);
    }
  });
});

describe("isPendingSyncKey — khoá THUỘC vòng đồng bộ", () => {
  it.each([
    "class_approval:pending",
    "timesheet_adjust:overdue",
    "parent_request:pending",
    "media_approval:pending",
    "center_checklist:overdue",
    "report_card_milestone:pending",
  ])("%s → true", (key) => {
    expect(isPendingSyncKey(key)).toBe(true);
  });
});

describe("isPendingSyncKey — khoá của NGUỒN SỰ KIỆN phải được để yên", () => {
  // Lấy đúng từ code đang chạy prod, không bịa:
  //   lib/notify/attendance.ts · lib/lms/session-teacher-notify.ts · lib/crm/sla.ts
  //   lib/_handlers/conversation-notif.ts · lib/lead/intake/health.ts
  it.each([
    ["attendance.edited:ckz1", "điểm danh bị sửa hồi tố"],
    ["session.close-reminder:ckz2", "nhắc chốt buổi"],
    ["session.substitute:ckz3", "dạy thay"],
    ["sla:first_touch:ckz4", "SLA lead — khoá 3 đoạn"],
    ["sla:idle:ckz5", "SLA lead idle"],
    ["conversation.message_posted:ckz6", "tin nhắn phụ huynh"],
    ["intake-failing:facebook:2026081910", "nguồn lead hỏng"],
    ["intake-silent:zalo:20260819", "nguồn lead im lặng"],
    ["homework.assigned:s1:hv1", "giao bài tập"],
    ["makeup.requested:m1", "học bù"],
  ])("%s → false (%s)", (key) => {
    expect(isPendingSyncKey(key)).toBe(false);
  });
});

describe("isPendingSyncKey — biên", () => {
  it("hậu tố đúng nhưng loại việc không tồn tại → false", () => {
    expect(isPendingSyncKey("khong_ton_tai:pending")).toBe(false);
    expect(isPendingSyncKey("sla:pending")).toBe(false);
  });

  it("loại việc đúng nhưng hậu tố lạ → false", () => {
    expect(isPendingSyncKey("lead_followup:done")).toBe(false);
    expect(isPendingSyncKey("lead_followup")).toBe(false);
  });

  it("cắt ở dấu hai chấm CUỐI, không phải dấu đầu", () => {
    // Nếu cắt ở dấu đầu tiên thì "x:lead_followup:pending" sẽ bị nhận nhầm là hợp lệ.
    expect(isPendingSyncKey("x:lead_followup:pending")).toBe(false);
  });

  it("chuỗi rỗng / chỉ có dấu hai chấm → false", () => {
    expect(isPendingSyncKey("")).toBe(false);
    expect(isPendingSyncKey(":pending")).toBe(false);
    expect(isPendingSyncKey(":")).toBe(false);
  });

  it("phân biệt hoa thường (khoá sinh bằng máy, không chuẩn hoá)", () => {
    expect(isPendingSyncKey("Lead_Followup:Pending")).toBe(false);
  });
});
