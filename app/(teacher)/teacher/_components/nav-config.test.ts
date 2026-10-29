// [NAV-GV-*] — menu site GV sáng ĐÚNG MỘT mục. Thêm "Công tháng của tôi" (`/teacher/phan-cong/thang`) dưới "Công việc của tôi"
// (`/teacher/phan-cong`) thì phép khớp tiền tố làm CẢ HAI cùng sáng — mở Công tháng mà menu vẫn chỉ vào màn cũ.
import { describe, expect, it } from "vitest";
import { mucDangMo, navGroups } from "./nav-config";

const moi = navGroups.flatMap((g) => g.items.map((i) => i.href));
const khongParttime = navGroups.flatMap((g) => g.items.filter((i) => !i.parttime).map((i) => i.href));

describe("[NAV-GV] mucDangMo — mục dài nhất thắng", () => {
  it("[NAV-GV-01] /teacher/phan-cong/thang (cả clean URL) ⇒ CHỈ 'Công tháng của tôi'", () => {
    expect(mucDangMo("/teacher/phan-cong/thang", moi)).toBe("/teacher/phan-cong/thang");
    expect(mucDangMo("/phan-cong/thang", moi)).toBe("/teacher/phan-cong/thang");
  });
  it("[NAV-GV-02] /teacher/phan-cong và trang con khác ⇒ 'Công việc của tôi' (đối chứng cho ca trên)", () => {
    expect(mucDangMo("/phan-cong", moi)).toBe("/teacher/phan-cong");
    expect(mucDangMo("/phan-cong?tab=can-xac-nhan".split("?")[0], moi)).toBe("/teacher/phan-cong");
  });
  it("[NAV-GV-03] trang chủ chỉ sáng 'Tổng quan'; trang con của lớp sáng 'Lớp của tôi'", () => {
    expect(mucDangMo("/", moi)).toBe("/teacher");
    expect(mucDangMo("/lop/abc", moi)).toBe("/teacher/lop");
  });
  it("[NAV-GV-04] mục Parttime bị ẩn thì không mục nào sáng ở trang Parttime (không 'giành' trạng thái)", () => {
    expect(mucDangMo("/phan-cong/thang", khongParttime)).toBeNull();
  });
});
