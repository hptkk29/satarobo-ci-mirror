// @vitest-environment node
/**
 * EL-04 — khoá ghi tiến độ sau hạn.
 *
 * Ba bẫy của luật này đều nằm ở BIÊN hoặc ở MẶC ĐỊNH, không nằm ở luồng chính:
 * `>` hay `>=`, đọc `dueAt` hay `dueAtOriginal`, và `allowLate` mặc định gì khi
 * lượt ghi danh không gắn lượt giao nào.
 */
import { describe, it, expect } from "vitest";
import {
  isProgressWriteLocked,
  effectiveAllowLate,
  OVERDUE_LOCKED,
  OVERDUE_LOCKED_MESSAGE,
} from "./due-lock";

const HAN = new Date("2026-09-01T17:00:00+07:00");

describe("biên thời gian — ba mốc", () => {
  it("trước hạn 1 giây ⇒ KHÔNG khoá", () => {
    expect(
      isProgressWriteLocked({
        dueAt: HAN,
        allowLate: false,
        now: new Date(HAN.getTime() - 1000),
      }),
    ).toBe(false);
  });

  it("ĐÚNG mốc hạn ⇒ KHÔNG khoá (biên là `>`, không phải `>=`)", () => {
    // Hạn chót là "hết thời điểm đó", không phải "trước thời điểm đó". Dùng `>=`
    // là cắt mất đúng giây cuối mà người ta vẫn có quyền học.
    expect(
      isProgressWriteLocked({ dueAt: HAN, allowLate: false, now: new Date(HAN) }),
    ).toBe(false);
  });

  it("sau hạn 1 giây ⇒ KHOÁ", () => {
    expect(
      isProgressWriteLocked({
        dueAt: HAN,
        allowLate: false,
        now: new Date(HAN.getTime() + 1000),
      }),
    ).toBe(true);
  });
});

describe("hai đường thoát khoá", () => {
  it("không có hạn ⇒ không bao giờ khoá", () => {
    expect(
      isProgressWriteLocked({ dueAt: null, allowLate: false, now: new Date("2099-01-01") }),
    ).toBe(false);
  });

  it("allowLate bật ⇒ quá hạn vẫn ghi được", () => {
    expect(
      isProgressWriteLocked({
        dueAt: HAN,
        allowLate: true,
        now: new Date(HAN.getTime() + 86_400_000),
      }),
    ).toBe(false);
  });
});

describe("effectiveAllowLate — FAIL-CLOSED", () => {
  it("không gắn lượt giao ⇒ false, KỂ CẢ khi cờ truyền vào là true", () => {
    // 🔴 Đây là chỗ đảo ngược cả quyết định. Viết `assignment?.allowLate ?? true`
    // thì MỌI lượt không gắn lượt giao được học vô hạn sau hạn — mà đó lại đúng là
    // nhóm sinh tự động (công nhận tương đương, auto từ yêu cầu, tự ghi danh),
    // tức nhóm ĐÔNG NHẤT.
    expect(
      effectiveAllowLate({ assignmentId: null, assignmentAllowLate: true }),
    ).toBe(false);
  });

  it("có lượt giao + cờ true ⇒ true", () => {
    expect(
      effectiveAllowLate({ assignmentId: "a1", assignmentAllowLate: true }),
    ).toBe(true);
  });

  it("có lượt giao + cờ false/null/undefined ⇒ false", () => {
    for (const v of [false, null, undefined]) {
      expect(effectiveAllowLate({ assignmentId: "a1", assignmentAllowLate: v })).toBe(
        false,
      );
    }
  });
});

describe("một mã lỗi, một câu chữ", () => {
  it("mã là OVERDUE_LOCKED — không có tên thứ hai", () => {
    // Đặc tả dùng hai tên (`OVERDUE_LOCKED` và `DUE_PASSED`) cho cùng một tình
    // huống. Hai tên nghĩa là client bắt một mã còn server trả mã kia, và nhánh
    // xử lý lỗi chết câm.
    expect(OVERDUE_LOCKED).toBe("OVERDUE_LOCKED");
  });

  it("câu chữ nói ĐÚNG việc phải làm, không doạ hệ quả chưa tồn tại", () => {
    // Giai đoạn này CHƯA có chế tài. Doạ "sẽ ảnh hưởng đánh giá" là cách nhanh
    // nhất làm người ta hết tin mọi thông báo khác của hệ thống.
    expect(OVERDUE_LOCKED_MESSAGE).toContain("liên hệ Đào tạo");
    expect(OVERDUE_LOCKED_MESSAGE).not.toMatch(/kỷ luật|đánh giá|lương|nhắc nhở/i);
  });
});
