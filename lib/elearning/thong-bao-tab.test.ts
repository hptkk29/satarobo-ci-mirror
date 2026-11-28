/** [TBT-*] Tab Thông báo ⇄ bộ lọc `status` dùng chung. */
import { describe, expect, it } from "vitest";
import { chuanHoaThongBao, tabThongBaoKhaiBao } from "./thong-bao-tab";

describe("[TBT-02] khai báo tab", () => {
  it("'Chưa đọc' mang status=unread và số chưa đọc thật; 'Tất cả' không mang gì (không bịa số tổng)", () => {
    const [tatCa, chuaDoc] = tabThongBaoKhaiBao(7);
    expect(chuaDoc).toMatchObject({ id: "chua-doc", dem: 7, them: { status: "unread" } });
    expect(tatCa).toEqual({ id: "tat-ca", nhan: "Tất cả" });
  });
});

describe("[TBT-01] ánh xạ tab ⇄ status", () => {
  it("không tham số ⇒ tab Tất cả và ĐÃ là dạng chuẩn (đích 'Xem tất cả' của chuông không bị chuyển hướng thừa)", () => {
    const r = chuanHoaThongBao({});
    expect(r).toMatchObject({ tab: "tat-ca", status: "all", canChuyenHuong: false, query: "tab=tat-ca" });
  });
  it("liên kết CŨ ?status=unread ⇒ tab Chưa đọc, giữ status=unread", () => {
    const r = chuanHoaThongBao({ status: "unread" });
    expect(r).toMatchObject({ tab: "chua-doc", status: "unread" });
    expect(r.query).toBe("tab=chua-doc&status=unread");
  });
  it("?tab=chua-doc thiếu status ⇒ phải bổ sung (API tải thêm chỉ hiểu status)", () => {
    const r = chuanHoaThongBao({ tab: "chua-doc" });
    expect(r.canChuyenHuong).toBe(true);
    expect(r.query).toContain("status=unread");
  });
  it("URL đã chuẩn ⇒ không chuyển hướng (không vòng lặp)", () => {
    expect(chuanHoaThongBao({ tab: "chua-doc", status: "unread" }).canChuyenHuong).toBe(false);
    expect(chuanHoaThongBao({ tab: "tat-ca" }).canChuyenHuong).toBe(false);
  });
  it("tab=tat-ca mà status=unread (gõ tay mâu thuẫn) ⇒ tab THẮNG, status bị gỡ", () => {
    const r = chuanHoaThongBao({ tab: "tat-ca", status: "unread" });
    expect(r).toMatchObject({ tab: "tat-ca", status: "all", canChuyenHuong: true });
    expect(r.query).not.toContain("status=");
  });
  it("tab lạ ⇒ rơi về suy từ status; giữ group/range/q, bỏ cursor", () => {
    const r = chuanHoaThongBao({ tab: "bậy", group: "elearning", range: "7d", q: "an toàn", cursor: "x" });
    expect(r.tab).toBe("tat-ca");
    expect(r.query).toBe("tab=tat-ca&group=elearning&range=7d&q=an+to%C3%A0n");
  });
  it("chuẩn hoá luôn cho ra URL ổn định: chuẩn hoá MỘT lần nữa không đổi gì", () => {
    for (const sp of [{}, { status: "unread" }, { tab: "chua-doc" }, { tab: "tat-ca", status: "unread" }]) {
      const a = chuanHoaThongBao(sp);
      const b = chuanHoaThongBao(Object.fromEntries(new URLSearchParams(a.query)));
      expect(b.canChuyenHuong).toBe(false);
      expect(b.query).toBe(a.query);
    }
  });
});
