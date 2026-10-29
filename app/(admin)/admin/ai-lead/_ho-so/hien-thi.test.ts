// app/(admin)/admin/ai-lead/_ho-so/hien-thi.test.ts — nhãn, giờ VN, bộ lọc URL. Thuần.
import { describe, expect, it } from "vitest";
import { NHAN_TRANG_THAI, conLai, gioVn } from "./hien-thi";
import { CO_LOC, docBoLoc } from "./doc-bo-loc";

describe("[HT-AI] hien-thi", () => {
  it("[HT-AI-01] mọi trạng thái của enum đều có nhãn tiếng Việt (thiếu ⇒ chip trống)", () => {
    for (const s of ["COLLECTING", "PENDING_INFO", "WAITING_QLCS", "IN_PROGRESS", "READY_FOR_REVIEW", "COMPLETED", "REJECTED", "EXPIRED", "SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING"]) {
      expect(NHAN_TRANG_THAI[s]?.nhan, s).toBeTruthy();
    }
  });
  it("[HT-AI-02] giờ hiển thị theo múi Việt Nam bất kể TZ máy: 00:30 UTC = 07:30 VN", () => {
    expect(gioVn(new Date("2026-11-07T00:30:00.000Z"))).toContain("07:30");
    expect(gioVn(null)).toBe("—");
    expect(gioVn("không phải ngày")).toBe("—");
  });
  it("[HT-AI-03] conLai: còn/quá theo `now` truyền vào", () => {
    const now = new Date("2026-11-07T10:00:00.000Z");
    expect(conLai(new Date("2026-11-07T10:30:00.000Z"), now)).toBe("còn 30 phút");
    expect(conLai(new Date("2026-11-07T07:00:00.000Z"), now)).toBe("quá 3 giờ");
    expect(conLai(null, now)).toBe("—");
  });
});

describe("[BL-AI] docBoLoc", () => {
  it("[BL-AI-01] giá trị lạ bị bỏ, không ném; mảng lấy phần tử đầu", () => {
    expect(docBoLoc({ tt: "gia-tri-la", nx: undefined })).toEqual({});
    expect(docBoLoc({ tt: ["IN_PROGRESS", "x"], han: "1", q: "  lan  " })).toEqual({ trangThai: "IN_PROGRESS", quaHanSla: true, q: "lan" });
    expect(CO_LOC({})).toBe(false);
  });
  it("[BL-AI-02] chuỗi dài bị cắt (không đẩy truy vấn khổng lồ xuống DB)", () => {
    expect(docBoLoc({ q: "x".repeat(500) }).q).toHaveLength(80);
  });
});
