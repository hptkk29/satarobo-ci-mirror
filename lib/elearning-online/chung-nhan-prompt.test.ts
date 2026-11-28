/**
 * [CNP-*] Prompt phôi giấy chứng nhận (QoCNPrompt) — hàm thuần. Mỗi ca ÂM có đối chứng DƯƠNG.
 */
import { describe, it, expect } from "vitest";
import { MAU_CAM, MAU_TIM, taoPromptPhoiChungNhan } from "./chung-nhan-prompt";

describe("[CNP-01] nội dung theo thiết kế", () => {
  const p = taoPromptPhoiChungNhan({ tenKhoa: "RoboSim 2 · Vượt mê cung" });
  it("mang tên khoá và đối tượng mặc định 'Học viên'; khổ A4 ngang 3508×2480 300 dpi", () => {
    expect(p).toContain("Khoá học: RoboSim 2 · Vượt mê cung · Đối tượng nhận: Học viên.");
    expect(p).toContain("A4 nằm ngang, 3508 × 2480 px (300 dpi)");
  });
  it("đủ BỐN ô chừa trống và các điều CẤM (tên, khoá, kết quả, góc ngày/mã; không viết tên mẫu; lề 5%)", () => {
    for (const k of ["1. Dải tên người nhận", "2. Ô tên khoá học", "3. Ô kết quả", "4. Góc dưới trái"]) expect(p).toContain(k);
    expect(p).toContain("KHÔNG được: viết tên người mẫu");
    expect(p).toContain("chừa lề an toàn 5%");
  });
  it("màu thương hiệu từ thiết kế", () => {
    expect(p).toContain(MAU_TIM);
    expect(p).toContain(MAU_CAM);
  });
});

describe("[CNP-02] người ký: KHÔNG chép con người từ thiết kế vào mã", () => {
  it("không truyền người ký ⇒ KHÔNG có dòng chữ ký và KHÔNG có tên người nào", () => {
    const p = taoPromptPhoiChungNhan({ tenKhoa: "K" });
    expect(p).not.toContain("chữ ký");
    expect(p).not.toMatch(/Ngô Thảo Vy|Trưởng phòng/);
    expect(p).toContain('tiêu đề "GIẤY CHỨNG NHẬN HOÀN THÀNH KHOÁ HỌC".');
  });
  it("chỉ có tên HOẶC chỉ có chức danh ⇒ vẫn bỏ (không in nửa dòng)", () => {
    expect(taoPromptPhoiChungNhan({ tenKhoa: "K", nguoiKy: "A" })).not.toContain("chữ ký");
    expect(taoPromptPhoiChungNhan({ tenKhoa: "K", chucDanh: "B" })).not.toContain("chữ ký");
  });
  it("đủ cả hai ⇒ có dòng 'Tên – Chức danh' ở góc dưới phải (đối chứng dương)", () => {
    const p = taoPromptPhoiChungNhan({ tenKhoa: "K", nguoiKy: "Nguyễn Văn A", chucDanh: "Giám đốc" });
    expect(p).toContain('chữ ký và dòng "Nguyễn Văn A – Giám đốc" ở góc dưới phải');
  });
});

describe("[CNP-03] chuẩn hoá đầu vào", () => {
  it("khoảng trắng thừa/xuống dòng trong tên khoá bị gộp (không phá cấu trúc nhiều dòng của prompt)", () => {
    const p = taoPromptPhoiChungNhan({ tenKhoa: "  Robo\n\n  Sim   2  ", doiTuong: "  " });
    expect(p).toContain("Khoá học: Robo Sim 2 · Đối tượng nhận: Học viên.");
    expect(p.split("\n")).toHaveLength(12);
  });
});
