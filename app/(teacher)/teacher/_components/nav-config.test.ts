// [NAV-GV-*] — menu site GV sáng ĐÚNG MỘT mục (mục dài nhất thắng). 09/11/2026: "Công việc của tôi" + "Công tháng của tôi" ĐÃ GỠ khỏi
// menu (chủ dự án — Lịch làm việc + Bảng công đã đáp ứng); route cũ chỉ còn chuyển hướng.
import { describe, expect, it } from "vitest";
import { mucDangMo, navGroups } from "./nav-config";

const moi = navGroups.flatMap((g) => g.items.map((i) => i.href));
const khongParttime = navGroups.flatMap((g) => g.items.filter((i) => !i.parttime).map((i) => i.href));

describe("[NAV-GV] mucDangMo — mục dài nhất thắng", () => {
  it("[NAV-GV-01] hai mục đã gỡ KHÔNG còn trong menu; Lịch làm việc + Bảng công còn (đối chứng dương)", () => {
    expect(moi).not.toContain("/teacher/phan-cong");
    expect(moi).not.toContain("/teacher/phan-cong/thang");
    expect(moi).toContain("/teacher/lich");
    expect(moi).toContain("/teacher/bang-cong");
  });
  it("[NAV-GV-02] Lịch / Bảng công sáng đúng mục (cả clean URL)", () => {
    expect(mucDangMo("/lich", moi)).toBe("/teacher/lich");
    expect(mucDangMo("/teacher/bang-cong", moi)).toBe("/teacher/bang-cong");
  });
  it("[NAV-GV-03] trang chủ chỉ sáng 'Tổng quan'; trang con của lớp sáng 'Lớp của tôi'", () => {
    expect(mucDangMo("/", moi)).toBe("/teacher");
    expect(mucDangMo("/lop/abc", moi)).toBe("/teacher/lop");
  });
  it("[NAV-GV-04] trang chuyển hướng cũ (/phan-cong/*) không làm mục nào sáng", () => {
    expect(mucDangMo("/phan-cong/thang", khongParttime)).toBeNull();
    expect(mucDangMo("/phan-cong", moi)).toBeNull();
  });
});
