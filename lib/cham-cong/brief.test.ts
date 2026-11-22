import { describe, expect, it } from "vitest";
import { catalogByCode } from "./catalog";
import { buildBrief, dateLabelVi } from "./brief";

const asg = (code: string, placeLabel = "CS1 - 211 Nguyễn Hữu Thọ") => {
  const e = catalogByCode(code)!;
  return { templateCode: e.code, templateName: e.name, segments: e.segments, placeLabel, isOff: e.code === "X", isLeave: e.isLeave };
};
const base = { dateLabel: "Thứ Ba 08/09", personName: "Thầy Khôi", notes: [], holiday: null, earlyArrivalMinutes: 10 };

describe("buildBrief — tin 19:00 cho ngày mai", () => {
  // ⚠️ Đổi 09/09/2026: `CT` nay khai 3 đoạn (WORK + PAID_BREAK 16:30–17:30 + WORK) cho
  // khớp bảng chốt, nên tin nhắn in HAI khoảng thay vì một. Đây là thông tin ĐÚNG HƠN —
  // người nhận biết có nghỉ giữa giờ; giờ kế hoạch vẫn 435 phút (PAID_BREAK vẫn tính).
  it("ca CT: mã + giờ + nơi + nhắc trước ca 10′", () => {
    const b = buildBrief({ ...base, assignment: asg("CT") });
    expect(b.send).toBe(true);
    expect(b.title).toBe("Lịch ngày mai — Thứ Ba 08/09");
    expect(b.body).toContain("Ca CT (Ca chiều + tối): 13:45–16:30 & 17:30–21:00 · CS1 - 211 Nguyễn Hữu Thọ");
    expect(b.body).toContain("Có mặt trước ca 10 phút");
  });
  it("X → 'KHÔNG có ca — nghỉ'; P → nghỉ phép; không ca → nghỉ", () => {
    expect(buildBrief({ ...base, assignment: asg("X") }).body).toContain("KHÔNG có ca");
    expect(buildBrief({ ...base, assignment: asg("P") }).body).toContain("nghỉ phép");
    expect(buildBrief({ ...base, assignment: null }).body).toContain("KHÔNG có ca");
  });
  it("việc cố định APPEND nối thêm dòng; SUPPRESS thì không gửi", () => {
    const b = buildBrief({ ...base, assignment: asg("CG"), notes: [{ mode: "APPEND", text: "15:00–16:00 HỌP TỔNG KẾT TUẦN" }] });
    expect(b.body).toContain("• 15:00–16:00 HỌP TỔNG KẾT TUẦN");
    expect(buildBrief({ ...base, assignment: asg("CG"), notes: [{ mode: "SUPPRESS", text: "" }] }).send).toBe(false);
  });
  it("REPLACE thay toàn bộ; lễ REPLACE có văn bản thắng", () => {
    const b = buildBrief({ ...base, assignment: asg("CG"), notes: [{ mode: "REPLACE", text: "Mai họp toàn công ty 08:00" }] });
    expect(b.body).toBe("Mai họp toàn công ty 08:00");
    const h = buildBrief({ ...base, assignment: asg("CG"), holiday: { name: "Quốc khánh", briefMode: "REPLACE", briefText: "NGHỈ LỄ 02/9" } });
    expect(h.body).toBe("NGHỈ LỄ 02/9");
  });
  it("lễ không ghi đè: dòng 🎌 + 'Nghỉ lễ.'; lễ SUPPRESS → không gửi", () => {
    const b = buildBrief({ ...base, assignment: asg("SC"), holiday: { name: "Quốc khánh", briefMode: null, briefText: null } });
    expect(b.body.split("\n")[0]).toBe("🎌 Quốc khánh");
    expect(buildBrief({ ...base, assignment: asg("SC"), holiday: { name: "Quốc khánh", briefMode: "SUPPRESS", briefText: null } }).send).toBe(false);
  });
  it("LD: không giờ → không nhắc 'có mặt trước ca'", () => {
    const b = buildBrief({ ...base, assignment: asg("LD", "linh động") });
    expect(b.body).toContain("Ca LD (Linh động) · linh động");
    expect(b.body).not.toContain("Có mặt trước ca");
  });
  it("dateLabelVi", () => {
    expect(dateLabelVi(new Date(Date.UTC(2026, 8, 8)))).toBe("Thứ Ba 08/09");
    expect(dateLabelVi(new Date(Date.UTC(2026, 8, 6)))).toBe("Chủ Nhật 06/09");
  });
});
