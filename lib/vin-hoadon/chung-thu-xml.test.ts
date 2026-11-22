import { describe, expect, it } from "vitest";
import { chuanHoaSerial, cungSerial, docChungThuTuXmlDaKy } from "./ky-usb";
import { CHUNG_THU_GIA_B64, CHUNG_THU_KHAC_B64, kyXmlGiaChoTest, SERIAL_CHUNG_THU_GIA, SERIAL_CHUNG_THU_KHAC } from "./may-chu-vin-gia";

const XML = "<HDon><DLHDon Id=\"data\"></DLHDon><DSCKS><NBan></NBan></DSCKS></HDon>";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("[CTX] đọc chứng thư THỰC TẾ từ chữ ký trong XML đã ký", () => {
  it("[CTX-01] XML đã ký mang chứng thư ⇒ đọc đúng serial + ngày hết hạn", () => {
    const ct = docChungThuTuXmlDaKy(b64(kyXmlGiaChoTest(XML)));
    expect(ct).toEqual({ serial: SERIAL_CHUNG_THU_GIA, hetHan: "2126-10-11" });
  });
  it("[CTX-02] hai chứng thư khác nhau ⇒ hai serial khác nhau (cơ sở của việc chặn dùng nhầm chứng thư)", () => {
    const khac = docChungThuTuXmlDaKy(b64(kyXmlGiaChoTest(XML, CHUNG_THU_KHAC_B64)));
    expect(khac?.serial).toBe(SERIAL_CHUNG_THU_KHAC);
    expect(cungSerial(khac!.serial, SERIAL_CHUNG_THU_GIA)).toBe(false);
  });
  it("[CTX-03] không có chứng thư / chứng thư hỏng / không phải XML ⇒ null (người gọi coi là KHÔNG ĐẠT, không đoán)", () => {
    expect(docChungThuTuXmlDaKy(b64(kyXmlGiaChoTest(XML, null)))).toBeNull();
    expect(docChungThuTuXmlDaKy(b64(kyXmlGiaChoTest(XML, "AAAA")))).toBeNull();
    expect(docChungThuTuXmlDaKy(b64(kyXmlGiaChoTest(XML, "!!không-phải-base64!!")))).toBeNull();
    expect(docChungThuTuXmlDaKy("")).toBeNull();
    expect(docChungThuTuXmlDaKy(b64("không phải xml"))).toBeNull();
  });
  it("[CTX-04] khối chứng thư có tiền tố không gian tên (ds:) và xuống dòng giữa base64 vẫn đọc được", () => {
    const cat = CHUNG_THU_GIA_B64.replace(/(.{64})/g, "$1\n");
    const xml = `<HDon><ds:Signature xmlns:ds="x"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>\n${cat}\n</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature></HDon>`;
    expect(docChungThuTuXmlDaKy(b64(xml))?.serial).toBe(SERIAL_CHUNG_THU_GIA);
  });
  it("[CTX-05] so serial bỏ qua hoa/thường, dấu «:» và số 0 đầu; khác chữ số cuối thì khác", () => {
    expect(chuanHoaSerial("54:00:fa:1b:2c:3d")).toBe("5400FA1B2C3D");
    expect(cungSerial("0054 00FA 1B2C 3D", "5400fa1b2c3d")).toBe(true);
    expect(cungSerial("5400FA1B2C3D", "5400FA1B2C3E")).toBe(false);
    expect(chuanHoaSerial("")).toBe("0");
  });
});
