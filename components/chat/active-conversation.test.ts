// @vitest-environment jsdom
// components/chat/active-conversation.test.ts — bộ lọc "bump này có phải hội thoại tôi ĐANG NHÌN".
//
// Mẩu trạng thái bé nhưng gánh AC5: nó là thứ duy nhất ngăn badge tổng cộng thêm cho hội
// thoại đang mở (tin đó được `markConversationRead` đánh dấu đã đọc ngay, badge phải đứng
// yên — cộng vào rồi tụt về 0 nhìn như lỗi).
//
// Hai bẫy đã ghi chú trong source và được khoá ở đây:
//   1. TAB ẨN thì `markConversationRead` KHÔNG chạy ⇒ unread server CÓ tăng thật ⇒ phải trả
//      `false` dù đúng hội thoại đó (bỏ điều kiện foreground = badge chết cứng khi tab ẩn).
//   2. Rời hội thoại A sang B: React mount effect của B TRƯỚC khi chạy cleanup của A, nên
//      `clearActiveConversation` phải chỉ nhả khi CHÍNH mình đang giữ (xoá vô điều kiện =
//      mất đăng ký của hội thoại mới ⇒ AC5 hỏng ngay lần chuyển hội thoại đầu tiên).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearActiveConversation,
  getActiveConversation,
  isBumpOfOpenConversation,
  setActiveConversation,
} from "./active-conversation";

const A = "conv-a";
const B = "conv-b";

/** Ép `document.visibilityState` trong jsdom (thuộc tính chỉ-đọc trên prototype). */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  setActiveConversation(null);
  setVisibility("visible");
});

afterEach(() => {
  setActiveConversation(null);
  setVisibility("visible");
});

describe("active-conversation", () => {
  it("ghi nhận và đọc lại hội thoại đang mở", () => {
    expect(getActiveConversation()).toBeNull();
    setActiveConversation(A);
    expect(getActiveConversation()).toBe(A);
    setActiveConversation(null);
    expect(getActiveConversation()).toBeNull();
  });

  it("đúng hội thoại + tab đang hiện ⇒ true (badge sẽ bỏ qua bump này)", () => {
    setActiveConversation(A);
    expect(isBumpOfOpenConversation(A, () => true)).toBe(true);
  });

  it("hội thoại KHÁC ⇒ false (bump lạ vẫn phải làm badge nhảy)", () => {
    setActiveConversation(A);
    expect(isBumpOfOpenConversation(B, () => true)).toBe(false);
  });

  it("không mở hội thoại nào ⇒ false", () => {
    expect(isBumpOfOpenConversation(A, () => true)).toBe(false);
  });

  it("TAB ẨN ⇒ false dù đúng hội thoại đang mở (markRead không chạy, unread server có tăng)", () => {
    setActiveConversation(A);
    expect(isBumpOfOpenConversation(A, () => false)).toBe(false);
  });

  it("mặc định đọc `document.visibilityState` (không phải chỉ tin vào tham số bơm vào)", () => {
    setActiveConversation(A);
    expect(isBumpOfOpenConversation(A)).toBe(true);

    setVisibility("hidden");
    expect(isBumpOfOpenConversation(A)).toBe(false);
  });

  it("clear chỉ nhả khi CHÍNH mình đang giữ — chuyển A→B không xoá mất đăng ký của B", () => {
    setActiveConversation(A);
    // React: effect mount của B chạy TRƯỚC cleanup của A.
    setActiveConversation(B);
    clearActiveConversation(A);

    expect(getActiveConversation()).toBe(B);
    expect(isBumpOfOpenConversation(B, () => true)).toBe(true);
  });

  it("clear đúng chủ ⇒ nhả thật (rời màn chat thì mọi bump lại làm badge nhảy)", () => {
    setActiveConversation(A);
    clearActiveConversation(A);
    expect(getActiveConversation()).toBeNull();
    expect(isBumpOfOpenConversation(A, () => true)).toBe(false);
  });
});
