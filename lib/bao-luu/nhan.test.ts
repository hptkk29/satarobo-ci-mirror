import { describe, it, expect } from "vitest";
import { NHAN_TRANG_THAI, TAB_DANH_SACH, chonTab } from "@/lib/bao-luu/nhan";
import { CHO_PHEP } from "@/lib/bao-luu/trang-thai";

describe("[BL3-NHAN] nhãn & tab danh sách", () => {
  it("[BL3-NHAN-01] mọi trạng thái nằm trong ĐÚNG MỘT tab — một trạng thái không tab là hồ sơ biến mất khỏi màn", () => {
    for (const tt of Object.keys(CHO_PHEP) as (keyof typeof NHAN_TRANG_THAI)[]) {
      const tab = TAB_DANH_SACH.filter((t) => (t.trangThai as readonly string[]).includes(tt));
      expect(tab.map((t) => t.ma), tt).toHaveLength(1);
    }
  });

  it("[BL3-NHAN-02] mọi trạng thái có nhãn tiếng Việt, không lặp nhãn", () => {
    const nhan = Object.values(NHAN_TRANG_THAI);
    expect(new Set(nhan).size).toBe(nhan.length);
    expect(nhan.every((n) => n.length > 0)).toBe(true);
  });

  it("[BL3-NHAN-03] tab mặc định: người duyệt vào hàng đợi chờ duyệt; người khác vào 'đang bảo lưu'; tham số lạ rơi về mặc định", () => {
    expect(chonTab(undefined, true)).toBe("cho-duyet");
    expect(chonTab(undefined, false)).toBe("dang");
    expect(chonTab("ket-thuc", true)).toBe("ket-thuc");
    expect(chonTab("<script>", true)).toBe("cho-duyet");
  });
});
