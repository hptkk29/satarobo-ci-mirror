// Map sai là GV bấm thông báo mà KHÔNG đi đâu — và hỏng theo kiểu im lặng, không có lỗi nào nổi lên.
// Hai lỗi đã từng xảy ra và bộ test này giữ cửa:
//   1. Trả clean URL (`/hoc-ba`) thay vì `/teacher/hoc-ba`: 5 tên trùng segment admin nên trên host
//      giaovien bị `decideRoute` coi là "lạc khu" → ném về trang chủ GV.
//   2. Vứt id khi đổi path (`/classes/c1` → `/lop`): tới được màn nhưng là màn trống.
import { describe, it, expect } from "vitest";
import { teacherHref } from "./notification-href";

describe("teacherHref — luôn trả đường có tiền tố /teacher", () => {
  it.each([
    "/attendance",
    "/sessions/s1",
    "/lich",
    "/classes/c1/edit",
    "/assignments",
    "/report-cards/e1",
    "/hoan-thanh-khoa",
    "/tin-nhan?c=abc",
    "/don-tu",
    "/cham-cong/lich-ca",
    "/trials",
    "/trial-classes/t1",
  ])("%s → có tiền tố /teacher", (href) => {
    const out = teacherHref(href);
    expect(out).not.toBeNull();
    expect(out!.startsWith("/teacher/")).toBe(true);
  });

  // Đây là bốn tên đã hỏng từ trước bản vá, cộng `lich` mới thêm.
  it.each([
    ["/report-cards/e1", "/teacher/hoc-ba"],
    ["/don-tu", "/teacher/don-tu"],
    ["/tin-nhan", "/teacher/tin-nhan"],
    ["/cham-cong", "/teacher/bang-cong"],
    ["/lich", "/teacher/lich"],
  ])("%s không được trả clean URL trùng segment admin", (href, base) => {
    expect(teacherHref(href)!.startsWith(base)).toBe(true);
  });
});

describe("teacherHref — không được làm rơi id", () => {
  it("lớp: id trong path đổi thành tham số ?classId=", () => {
    expect(teacherHref("/classes/c1")).toBe("/teacher/lop?classId=c1");
    expect(teacherHref("/classes/c1/edit")).toBe("/teacher/lop?classId=c1");
  });

  it("học bạ: id là enrollmentId", () => {
    expect(teacherHref("/report-cards/e1")).toBe("/teacher/hoc-ba?enrollmentId=e1");
  });

  it("bài tập: id là assignmentId", () => {
    expect(teacherHref("/assignments/a1")).toBe("/teacher/cham-bai?assignmentId=a1");
  });

  it("id được escape — không cho ký tự lạ chui vào query", () => {
    expect(teacherHref("/classes/a b&c")).toBe("/teacher/lop?classId=a%20b%26c");
  });
});

describe("teacherHref — giữ query gốc", () => {
  it("query đi kèm được giữ nguyên", () => {
    expect(teacherHref("/attendance?sessionId=abc")).toBe("/teacher/diem-danh?sessionId=abc");
    expect(teacherHref("/tin-nhan?c=conv1")).toBe("/teacher/tin-nhan?c=conv1");
  });

  it("id suy từ path đứng TRƯỚC query gốc", () => {
    expect(teacherHref("/classes/c1?tab=sessions")).toBe("/teacher/lop?classId=c1&tab=sessions");
  });

  it("không có gì thì không đẻ ra dấu ? thừa", () => {
    expect(teacherHref("/don-tu")).toBe("/teacher/don-tu");
  });
});

describe("teacherHref — segment con của admin KHÔNG phải id", () => {
  it("/cham-cong/lich-ca: 'lich-ca' là màn con, không được biến thành tham số", () => {
    expect(teacherHref("/cham-cong/lich-ca")).toBe("/teacher/bang-cong");
  });

  it("/trial-classes/t1: id là TrialClass, khác khoá của màn GV → bỏ, về danh sách", () => {
    expect(teacherHref("/trial-classes/t1")).toBe("/teacher/trial");
    expect(teacherHref("/trials")).toBe("/teacher/trial");
  });
});

describe("teacherHref — đường không có màn GV", () => {
  it.each(["/users", "/orders/o1", "/leads/l1", "/students/s1/edit", "/bien-dong-so-du", "/cong-no"])(
    "%s → null (hiện text thuần, KHÔNG đẩy GV sang host admin)",
    (href) => {
      expect(teacherHref(href)).toBeNull();
    },
  );

  it("null vào thì null ra", () => {
    expect(teacherHref(null)).toBeNull();
  });

  it("chuỗi rỗng không làm vỡ", () => {
    expect(teacherHref("")).toBeNull();
  });
});
