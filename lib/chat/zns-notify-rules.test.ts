import { describe, it, expect } from "vitest";
import {
  isStaffSender,
  isVnQuietHour,
  pickAnchorMessage,
  type AnchorCandidate,
} from "./zns-notify-rules";

// =============================================================================
// US-14 — mỗi tin ZNS là 400đ và không thu hồi được, nên 3 cổng chặn phải có lưới
// riêng: gửi thừa là tốn tiền + phiền khách, gửi thiếu là phụ huynh không biết tin.
// =============================================================================

const HOUR = 3_600_000;
/** 2026-08-10T03:00:00Z = 10:00 giờ VN. */
const NOON_ISH = new Date("2026-08-10T03:00:00.000Z");

describe("isVnQuietHour — khung cấm CSKH 22:00–06:00 giờ VN (mã -133)", () => {
  it("10:00 giờ VN → gửi được", () => {
    expect(isVnQuietHour(NOON_ISH)).toBe(false);
  });

  it("22:00 và 23:30 giờ VN → cấm", () => {
    expect(isVnQuietHour(new Date("2026-08-10T15:00:00.000Z"))).toBe(true);
    expect(isVnQuietHour(new Date("2026-08-10T16:30:00.000Z"))).toBe(true);
  });

  it("05:59 giờ VN cấm, 06:00 giờ VN mở lại", () => {
    expect(isVnQuietHour(new Date("2026-08-09T22:59:00.000Z"))).toBe(true);
    expect(isVnQuietHour(new Date("2026-08-09T23:00:00.000Z"))).toBe(false);
  });

  it("KHÔNG phụ thuộc đồng hồ tiến trình: 23:00 UTC là 06:00 VN, không phải nửa đêm", () => {
    // Vercel chạy UTC, máy dev chạy +07. Dùng getHours() thì hàm này đúng ở máy dev và
    // sai trên prod — đúng vết bug lệch 1 ngày của lịch buổi học (lib/time/vn.ts).
    expect(isVnQuietHour(new Date("2026-08-09T23:00:00.000Z"))).toBe(false);
  });
});

describe("isStaffSender — chỉ tin của GV/QLCS mới đáng 400đ", () => {
  it("tư cách trong nhóm thắng vai tài khoản", () => {
    expect(isStaffSender({ derivedFrom: "CLASS_TEACHER", role: "PARENT" })).toBe(true);
    // Người vừa là GV vừa là PH nhưng đứng trong nhóm với tư cách PH → tin của họ
    // KHÔNG kích hoạt ZNS cho cả lớp.
    expect(isStaffSender({ derivedFrom: "CLASS_STUDENT_PARENT", role: "TEACHER" })).toBe(false);
  });

  it("quản lý cơ sở tính là nhân sự", () => {
    expect(isStaffSender({ derivedFrom: "CENTER_MANAGER" })).toBe(true);
    expect(isStaffSender({ derivedFrom: null, role: "CENTER_MANAGER" })).toBe(true);
  });

  it("participant thêm tay → rơi về vai tài khoản (kể cả vai phụ)", () => {
    expect(isStaffSender({ derivedFrom: null, role: "SALES_CSM", roles: ["TEACHER"] })).toBe(true);
    expect(isStaffSender({ derivedFrom: null, role: "PARENT", roles: ["PARENT"] })).toBe(false);
  });

  it("FAIL-CLOSED: không nhận ra là gì → không phải nhân sự", () => {
    expect(isStaffSender({})).toBe(false);
    expect(isStaffSender({ derivedFrom: "MOT_TU_CACH_MOI" })).toBe(false);
  });
});

function msg(over: Partial<AnchorCandidate> & { id: string; createdAt: Date }): AnchorCandidate {
  return { kind: "CHAT", senderIsStaff: true, ...over };
}

describe("pickAnchorMessage — chọn tin mốc để nhắc", () => {
  const base = {
    lastReadAt: null,
    muted: false,
    now: NOON_ISH,
    chatDelayMs: 6 * HOUR,
    announcementDelayMs: 6 * HOUR,
  };

  it("chọn tin CŨ NHẤT đủ ngưỡng — mốc phải tất định giữa các lượt quét", () => {
    // Lấy tin mới nhất thì mốc trôi theo từng lượt cron ⇒ khoá UNIQUE của sổ gửi
    // (conversationId,userId,messageId) hết tác dụng và phụ huynh bị nhắc lặp.
    const anchor = pickAnchorMessage({
      ...base,
      messages: [
        msg({ id: "cu", createdAt: new Date(NOON_ISH.getTime() - 9 * HOUR) }),
        msg({ id: "moi", createdAt: new Date(NOON_ISH.getTime() - 7 * HOUR) }),
      ],
    });
    expect(anchor?.id).toBe("cu");
  });

  it("chưa đủ 6 tiếng → không gửi", () => {
    const anchor = pickAnchorMessage({
      ...base,
      messages: [msg({ id: "m", createdAt: new Date(NOON_ISH.getTime() - 5 * HOUR) })],
    });
    expect(anchor).toBeNull();
  });

  it("tin của phụ huynh khác trong nhóm KHÔNG kích hoạt", () => {
    const anchor = pickAnchorMessage({
      ...base,
      messages: [
        msg({ id: "ph", createdAt: new Date(NOON_ISH.getTime() - 9 * HOUR), senderIsStaff: false }),
        msg({ id: "gv", createdAt: new Date(NOON_ISH.getTime() - 8 * HOUR) }),
      ],
    });
    expect(anchor?.id).toBe("gv");
  });

  it("đã đọc rồi thì thôi — mốc đọc mới hơn tin", () => {
    const anchor = pickAnchorMessage({
      ...base,
      lastReadAt: new Date(NOON_ISH.getTime() - 7 * HOUR),
      messages: [msg({ id: "m", createdAt: new Date(NOON_ISH.getTime() - 9 * HOUR) })],
    });
    expect(anchor).toBeNull();
  });

  it("mute: bỏ qua tin thường, THÔNG BÁO vẫn nhắc (AC2)", () => {
    const messages = [
      msg({ id: "chat", createdAt: new Date(NOON_ISH.getTime() - 9 * HOUR) }),
      msg({ id: "ann", createdAt: new Date(NOON_ISH.getTime() - 8 * HOUR), kind: "ANNOUNCEMENT" }),
    ];
    expect(pickAnchorMessage({ ...base, muted: true, messages })?.id).toBe("ann");
    expect(pickAnchorMessage({ ...base, muted: false, messages })?.id).toBe("chat");
  });

  it("THÔNG BÁO dùng ngưỡng RIÊNG — hạ 30 phút không đụng tin thường", () => {
    const messages = [
      msg({ id: "chat", createdAt: new Date(NOON_ISH.getTime() - 1 * HOUR) }),
      msg({ id: "ann", createdAt: new Date(NOON_ISH.getTime() - 40 * 60_000), kind: "ANNOUNCEMENT" }),
    ];
    const anchor = pickAnchorMessage({ ...base, announcementDelayMs: 30 * 60_000, messages });
    expect(anchor?.id).toBe("ann");
  });

  it("tin SYSTEM không bao giờ là mốc", () => {
    const anchor = pickAnchorMessage({
      ...base,
      messages: [msg({ id: "sys", createdAt: new Date(NOON_ISH.getTime() - 9 * HOUR), kind: "SYSTEM" })],
    });
    expect(anchor).toBeNull();
  });
});
