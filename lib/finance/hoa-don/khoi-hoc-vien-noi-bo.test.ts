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

describe("[KHV-MA] mã khách hàng trên PHIẾU CHỜ nội bộ", () => {
  it("[KHV-MA-01] bản chờ + có mã ⇒ dòng «Mã khách hàng» đứng ĐẦU, trước ba ô học viên", () => {
    const ra = dongHocVienNoiBo({ maPhieu: null, hocVien: { ...HV, maKhachHang: " CS1-26-AB12CD " } });
    expect(ra[0]).toEqual({ nhan: "Mã khách hàng", giaTri: "CS1-26-AB12CD" });
    expect(ra).toHaveLength(4);
  });
  it("[KHV-MA-02] ĐỐI CHỨNG ÂM: tờ CHÍNH THỨC (đã có số RCP) ⇒ không in mã; mã trắng ⇒ không dòng", () => {
    expect(dongHocVienNoiBo({ maPhieu: "RCP-CS1-26-0001", hocVien: { ...HV, maKhachHang: "KH-1" } })).toEqual([]);
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: { ...HV, maKhachHang: "  " } })).toHaveLength(3);
  });
  it("[KHV-MA-03] chỉ có mã (chưa khai ô học viên nào) vẫn in được dòng mã", () => {
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: { ten: null, ngaySinh: null, cccd: null, maKhachHang: "KH-1" } })).toEqual([
      { nhan: "Mã khách hàng", giaTri: "KH-1" },
    ]);
  });
});

describe("[KHV-THEM] các em còn lại của đơn nhiều con trên phiếu chờ nội bộ (09/11/2026)", () => {
  const hv = { ten: "Bé Một", ngaySinh: "03/08/2016", cccd: null, them: [{ ten: "Bé Hai", ngaySinh: "02/01/2018", cccd: "048222222222" }, { ten: "Bé Ba", ngaySinh: null, cccd: null }] };
  it("mỗi em thêm một cụm dòng, đánh số từ 2; ô trống không có dòng", () => {
    const d = dongHocVienNoiBo({ maPhieu: null, hocVien: hv });
    expect(d.map((x) => [x.nhan, x.giaTri])).toEqual([
      ["Học viên (nội bộ)", "Bé Một"],
      ["Ngày sinh học viên", "03/08/2016"],
      ["Học viên thứ 2 (nội bộ)", "Bé Hai"],
      ["Ngày sinh học viên thứ 2", "02/01/2018"],
      ["CCCD học viên thứ 2", "048222222222"],
      ["Học viên thứ 3 (nội bộ)", "Bé Ba"],
    ]);
  });
  it("tờ CHÍNH THỨC (đã có số phiếu) KHÔNG BAO GIỜ in khối này — kể cả các em thêm; đối chứng: bản chờ thì có", () => {
    expect(dongHocVienNoiBo({ maPhieu: "PT-001", hocVien: hv })).toEqual([]);
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: hv }).length).toBeGreaterThan(0);
  });
  it("bên gọi cũ không khai `them` ⇒ như trước", () => {
    expect(dongHocVienNoiBo({ maPhieu: null, hocVien: { ten: "Bé Một", ngaySinh: null, cccd: null } }).map((x) => x.nhan)).toEqual(["Học viên (nội bộ)"]);
  });
});
