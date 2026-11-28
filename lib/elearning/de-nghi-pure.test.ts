/** [DNP-*] Đề nghị đào tạo — phần thuần. Ngày TUYỆT ĐỐI (luật 19). */
import { describe, expect, it } from "vitest";
import { phieuNhuCauSchema } from "./training-need";
import { cacQuyDeNghi, dongThoiGianPhieu, nhanQuy, nhanTrangThaiPhieu } from "./de-nghi-pure";

describe("[DNP-01] quý", () => {
  it("nhanQuy: 2027-Q1 → Q1/2027; lạ thì giữ nguyên", () => {
    expect(nhanQuy("2027-Q1")).toBe("Q1/2027");
    expect(nhanQuy("quý sau")).toBe("quý sau");
  });
  it("cacQuyDeNghi bắt đầu từ quý hiện tại THEO GIỜ VN, qua năm đúng", () => {
    // 17/11/2026 03:00 UTC = 10:00 VN ⇒ Q4/2026
    const ds = cacQuyDeNghi(new Date("2026-11-17T03:00:00.000Z"), 3);
    expect(ds.map((q) => q.gia)).toEqual(["2026-Q4", "2027-Q1", "2027-Q2"]);
    expect(ds[1]!.nhan).toBe("Q1/2027");
  });
  it("biên múi giờ: 31/12 20:00 UTC đã là 01/01 VN ⇒ Q1 năm sau", () => {
    expect(cacQuyDeNghi(new Date("2026-12-31T20:00:00.000Z"), 1)[0]!.gia).toBe("2027-Q1");
  });
  it("MỌI giá trị chọn được đều qua schema của máy chủ (UI không đưa ra giá trị server từ chối)", () => {
    for (const q of cacQuyDeNghi(new Date("2026-11-17T03:00:00.000Z"), 8)) {
      const r = phieuNhuCauSchema.safeParse({
        title: "Đào tạo X",
        targetGroupText: "Nhóm Y",
        reason: "Lý do đủ dài để qua",
        expectedOutcome: "Kết quả đủ dài để qua",
        proposedQuarter: q.gia,
      });
      expect(r.success, q.gia).toBe(true);
    }
  });
});

describe("[DNP-02] nhãn trạng thái", () => {
  it("chỉ hai trạng thái mô hình biết; lạ thì không đoán", () => {
    expect(nhanTrangThaiPhieu("NEW").nhan).toBe("Chờ duyệt");
    expect(nhanTrangThaiPhieu("APPROVED").nhan).toBe("Đã duyệt");
    expect(nhanTrangThaiPhieu("REJECTED")).toEqual({ nhan: "REJECTED", nhom: "chua-bat-dau" });
  });
});

describe("[DNP-03] dòng thời gian — chỉ thứ dữ liệu biết", () => {
  const goc = { createdAt: new Date("2026-11-14T03:22:00.000Z"), approvedAt: null, nguoiDuyet: null, tenChuongTrinh: [] as string[] };
  it("phiếu mới: Đã gửi → Chờ phòng Đào tạo xem xét (không có bước 'đang xem' bịa)", () => {
    const b = dongThoiGianPhieu({ ...goc, status: "NEW" });
    expect(b.map((x) => x.nhan)).toEqual(["Đã gửi", "Chờ phòng Đào tạo xem xét"]);
    expect(b.map((x) => x.xong)).toEqual([true, false]);
  });
  it("đã duyệt: có người duyệt + ngày; chưa có chương trình ⇒ 'Chờ lập chương trình'", () => {
    const b = dongThoiGianPhieu({ ...goc, status: "APPROVED", approvedAt: new Date("2026-11-15T03:00:00.000Z"), nguoiDuyet: "Chị Lan" });
    expect(b[1]).toMatchObject({ nhan: "Đã duyệt", chiTiet: "Bởi Chị Lan", xong: true });
    expect(b[2]).toMatchObject({ nhan: "Chờ lập chương trình", xong: false });
  });
  it("đã thành chương trình: liệt kê tên", () => {
    const b = dongThoiGianPhieu({ ...goc, status: "APPROVED", approvedAt: goc.createdAt, nguoiDuyet: null, tenChuongTrinh: ["An toàn 2027"] });
    expect(b[2]).toMatchObject({ nhan: "Đã thành chương trình", chiTiet: "An toàn 2027", xong: true });
  });
});
