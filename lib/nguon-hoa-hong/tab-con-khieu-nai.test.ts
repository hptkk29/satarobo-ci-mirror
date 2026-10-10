// @vitest-environment node
/** [NHH-DSP-TC*] — luật tab con của tab Khiếu nại & lịch sử (THUẦN): mỗi tab con gác RIÊNG; mỗi ca "không thấy" có đối chứng dương (CLAUDE.md luật 11). */
import { describe, it, expect } from "vitest";

import { chonTabCon, KEY_TAB_CON, tabConMoDuoc, tabConUngVien, TAB_CON } from "./tab-con-khieu-nai";

const voi = (keys: string[], coNguon = true) => ({ coQuyen: (ks: readonly string[]) => ks.some((k) => keys.includes(k)), coNguon });

describe("[NHH-DSP-TC1] tabConMoDuoc / tabConUngVien", () => {
  it("chỉ view-self (Sale): chỉ tab Khiếu nại — KHÔNG thấy ba tab lịch sử (đối chứng: HR thấy cả Khiếu nại lẫn Nhật ký)", () => {
    expect(tabConUngVien(voi(["commission:view-self"]))).toEqual(["khieu-nai"]);
    expect(tabConUngVien(voi(["commission:view-self", "commission_disputes:review"]))).toEqual(["khieu-nai", "nhat-ky"]);
  });

  it("mỗi key mở ĐÚNG tab con của nó (quét hết bảng KEY_TAB_CON, không tab nào mở bằng key của tab khác)", () => {
    for (const t of TAB_CON) {
      for (const k of KEY_TAB_CON[t]) {
        const mo = tabConUngVien(voi([k]));
        expect(mo, `${k} mở ${t}`).toContain(t);
        for (const khac of mo) expect(KEY_TAB_CON[khac], `${k} mở nhầm ${khac}`).toContain(k);
      }
    }
  });

  it("Đổi nguồn: cần CẢ sources:view lẫn cờ nguồn (tắt cờ ⇒ ẩn dù có quyền; đối chứng: bật cờ ⇒ hiện)", () => {
    expect(tabConMoDuoc("doi-nguon", voi(["sources:view"], false))).toBe(false);
    expect(tabConMoDuoc("doi-nguon", voi(["sources:view"], true))).toBe(true);
  });

  it("không key nào ⇒ không ứng viên", () => {
    expect(tabConUngVien(voi([]))).toEqual([]);
  });
});

describe("[NHH-DSP-TC2] chonTabCon", () => {
  it("?con= hợp lệ và mở được ⇒ dùng; thiếu / rác / không mở được ⇒ ứng viên đầu tiên; không ứng viên ⇒ null", () => {
    const hr = voi(["commission:view-self", "commission_disputes:review", "commission_policies:view", "sources:view"]);
    expect(chonTabCon("chinh-sach", hr)).toBe("chinh-sach");
    expect(chonTabCon(null, hr)).toBe("khieu-nai");
    expect(chonTabCon("rac", hr)).toBe("khieu-nai");
    // tab con người xem KHÔNG mở được ⇒ KHÔNG rơi vào đó (không dò được tab nào có thật)
    expect(chonTabCon("nhat-ky", voi(["commission:view-self"]))).toBe("khieu-nai");
    expect(chonTabCon("khieu-nai", voi([]))).toBeNull();
  });
});
