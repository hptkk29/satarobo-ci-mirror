import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dongHocVienNoiBo } from "./khoi-hoc-vien-noi-bo";

const HV = { ten: "Hoàng Gia Bảo", ngaySinh: "09/03/2015", cccd: "048215001234" };
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("[KHV] khối «Học viên (nội bộ)» của phiếu chờ", () => {
  it("[KHV-01] BẢN CHỜ (chưa có số phiếu) + đủ ba ô ⇒ ba dòng đúng nhãn", () => {
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: HV })).toEqual([
      { nhan: "Học viên (nội bộ)", giaTri: "Hoàng Gia Bảo" },
      { nhan: "Ngày sinh học viên", giaTri: "09/03/2015" },
      { nhan: "CCCD học viên", giaTri: "048215001234" },
    ]);
  });
  it("[KHV-02] ĐỐI CHỨNG ÂM: tờ CHÍNH THỨC (đã có số RCP, đưa phụ huynh) ⇒ KHÔNG in gì, dù có truyền dữ liệu", () => {
    expect(dongHocVienNoiBo({ maPhieu: "RCP-CS1-26-0001", hocVien: HV })).toEqual([]);
  });
  it("[KHV-03] chưa khai ô nào / ô trắng ⇒ không dòng nào; khai một phần ⇒ chỉ in phần có", () => {
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: null })).toEqual([]);
    expect(dongHocVienNoiBo({ maPhieu: null })).toEqual([]);
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: { ten: " ", ngaySinh: null, cccd: "" } })).toEqual([]);
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: { ten: "A", ngaySinh: null, cccd: null } })).toEqual([{ nhan: "Học viên (nội bộ)", giaTri: "A" }]);
  });
  it("[KHV-W1] tờ PDF vẽ khối này BẰNG hàm trên (không tự viết lại điều kiện)", () => {
    const s = doc("lib/pdf/phieu-thu.tsx");
    expect(s).toMatch(/dongHocVienNoiBo\(data\)/);
  });
  it("[KHV-W2] CHỈ route phiếu chờ gắn `hocVien` vào trang; hai đường phát hành MISA và tờ chính thức KHÔNG đọc ba ô học viên", () => {
    expect(doc("app/(admin)/admin/payments/hoa-don/phieu-cho/route.ts")).toMatch(/hocVien/);
    for (const tep of [
      "lib/finance/hoa-don/phat-hanh-misa.ts",
      "lib/misa/meinvoice/anh-xa.ts",
      "lib/misa/meinvoice/cong.ts",
      "app/(admin)/admin/payments/hoa-don/_actions.ts",
      "app/(admin)/admin/payments/[id]/phieu-thu/route.ts",
    ]) {
      const s = doc(tep);
      expect(s, `${tep} không được đọc ba ô học viên`).not.toMatch(/invoiceStudent|\.hocVien\b|hocVien:/);
    }
  });
});
