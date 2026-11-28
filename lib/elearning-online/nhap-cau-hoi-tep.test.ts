/**
 * [QIM-06] Đọc tệp .xlsx của QoImport: tệp hỏng / quá lớn / không phải xlsx / rỗng ⇒ bị từ chối ở CỬA với thông báo tiếng Việt; bộ mẫu thật đọc lại được (đối chứng dương).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { MAU_THEO_LOAI, TOI_DA_BYTE, kiemBangTinh } from "./nhap-cau-hoi";
import { docTepXlsx, taoTepMau } from "./nhap-cau-hoi-tep";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

describe("[QIM-06] cửa vào của tệp", () => {
  it("đối chứng dương: bộ mẫu sinh ra đọc lại được, đủ 13 sheet dạng + HUONG-DAN", () => {
    const s = docTepXlsx(b64(taoTepMau()));
    expect(Object.keys(s)).toHaveLength(14);
    expect(s["Tự luận"][0]).toEqual(["Đề bài", "Điểm", "Giải thích"]);
  });
  it("🔴 mẫu RIÊNG từng dạng: đúng MỘT sheet dạng + HUONG-DAN; dòng ví dụ của chính nó hợp lệ; đối chứng: bộ đầy đủ có đủ 13", () => {
    for (const m of MAU_THEO_LOAI) {
      const s = docTepXlsx(b64(taoTepMau(m.loai)));
      expect(Object.keys(s), m.loai).toEqual([m.sheet, "HUONG-DAN"]);
      expect(kiemBangTinh(s), m.loai).toMatchObject({ tongDong: 1, hopLe: 1, loi: 0 });
    }
    expect(Object.keys(docTepXlsx(b64(taoTepMau()))).length).toBe(MAU_THEO_LOAI.length + 1);
  });
  it("rỗng ⇒ 'Tệp rỗng'", () => {
    expect(() => docTepXlsx("")).toThrow("Tệp rỗng");
  });
  it("văn bản/CSV đổi đuôi .xlsx (byte rác — XLSX.read sẽ KHÔNG ném) ⇒ bị chặn bằng chữ ký tệp", () => {
    expect(() => docTepXlsx(b64("Đề bài,Điểm\nCâu 1,1\n"))).toThrow(/Chỉ nhận tệp Excel \.xlsx/);
    expect(() => docTepXlsx(b64("<html>x</html>"))).toThrow(/Chỉ nhận tệp Excel/);
  });
  it("tệp ZIP hỏng (có chữ ký PK nhưng thân cụt) ⇒ thông báo tiếng Việt, không ném lỗi thô", () => {
    const hong = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("khong-phai-zip-hop-le")]);
    expect(() => docTepXlsx(b64(hong))).toThrow(/Không đọc được tệp/);
  });
  it("quá dung lượng ⇒ từ chối TRƯỚC khi đọc; đúng trần thì qua cổng dung lượng (biên)", () => {
    expect(() => docTepXlsx(b64(Buffer.alloc(TOI_DA_BYTE + 1, 0x50)))).toThrow(/quá lớn/);
    // đúng trần: qua cổng dung lượng, rồi chết ở cổng chữ ký/giải nén (không phải 'quá lớn')
    expect(() => docTepXlsx(b64(Buffer.alloc(TOI_DA_BYTE, 0x41)))).not.toThrow(/quá lớn/);
  });
  it("xlsx hợp lệ nhưng KHÔNG có sheet nào đúng dạng ⇒ đọc được (lỗi nghiệp vụ nằm ở bước kiểm, không ở cửa)", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "Lạ");
    expect(Object.keys(docTepXlsx(b64(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer)))).toEqual(["Lạ"]);
  });
});
