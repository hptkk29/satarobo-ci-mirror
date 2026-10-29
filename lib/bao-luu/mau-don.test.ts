// Lưới của "Đơn đăng ký bảo lưu" (SR.QD.236.002): chọn mẫu theo cơ sở, điền sẵn, điền .docx, và — quan trọng nhất — bản in
// HTML phải chứa ĐÚNG từng dòng chữ của .docx mẫu (chữ pháp lý nằm ở hai nơi, test này là thứ giữ chúng khớp).
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  CAU_XEM_DANH_SACH,
  CAU_XEM_DANH_SACH_NGAN,
  MA_MAU_DON,
  MAU_DON,
  O_GIAY,
  TIEU_DE_DANH_SACH_KHOA,
  TOI_DA_KHOA_MOT_TRANG,
  coDanhSachKhoa,
  danhSachQuaMotTrang,
  dienSanDon,
  giaTriVuaO,
  mauTheoMaCoSo,
  ngayTrenDon,
  tenNganKhoa,
  vuaOGiay,
  type TruongO,
  type DauVaoDienSan,
  type DonBaoLuu,
} from "./mau-don";
import { doRongPt } from "./mau-don-do-rong";
import { LoiMauDon, O_NHAP, chuTrongDocx, chuTrongXml, dienDonDocx, dienXmlDon, taiMauDocx, themSoTrang } from "./mau-don-docx";
import { dungDonHtml } from "./mau-don-html";

const DON_TRONG: DonBaoLuu = {
  phuHuynh: { hoTen: "", quanHe: "", dienThoai: "", email: "" },
  hocVien: { hoTen: "", ngaySinh: "", ma: "", khoa: "", lop: "", giaoVien: "" },
  lyDo: [],
  lyDoKhac: "",
  danhSachKhoa: [],
  thoiGian: { baoLuuTu: "", hocLaiDuKien: "", nghiTuNgay: "" },
};

const DON_DAY: DonBaoLuu = {
  phuHuynh: { hoTen: "Nguyễn Thị Lan", quanHe: "Mẹ", dienThoai: "0905 123 456", email: "lan@example.com" },
  hocVien: { hoTen: "Trần Minh Khang", ngaySinh: "12/03/2016", ma: "HV0042", khoa: "Sata 3", lop: "sata3.15h45-CN.CS1", giaoVien: "Lê Nhật Thuận" },
  lyDo: ["FAMILY"],
  lyDoKhac: "",
  danhSachKhoa: [],
  thoiGian: { baoLuuTu: "20/10/2026", hocLaiDuKien: "20/01/2027", nghiTuNgay: "10/10/2026" },
};

// Chuẩn hoá để so chữ: bỏ thẻ, giải thực thể, gộp mọi khoảng trắng (tab, nhiều dấu cách, xuống dòng) thành một.
const phang = (s: string) =>
  s
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const duongDanAnh = "https://admin.example/brand/logo-satarobo.png";

/** Bỏ các thuộc tính giữ-liền khối ký mà bộ điền thêm vào — để so phần còn lại với mẫu gốc từng byte. */
const boGiuLien = (x: string) =>
  x
    .replace(/<w:keepNext\/><w:keepLines\/>/g, "")
    .replace(/<w:keepLines\/>/g, "")
    .replace(/<w:trPr><w:cantSplit\/><\/w:trPr>/g, "")
    .replace(/<w:pPr><\/w:pPr>/g, "<w:pPr/>");

describe("[MD-01] mẫu theo cơ sở — không có đường lùi", () => {
  it("CS1/CS2 có mẫu (không phân biệt hoa thường, bỏ khoảng trắng)", () => {
    expect(mauTheoMaCoSo("CS1")).toBe("CS1");
    expect(mauTheoMaCoSo(" cs2 ")).toBe("CS2");
  });
  it("cơ sở chưa có mẫu / chưa có mã ⇒ null, KHÔNG rơi về CS1", () => {
    for (const x of ["CS3", "HO", "", "   ", null, undefined]) expect(mauTheoMaCoSo(x)).toBeNull();
  });
  it("hai cơ sở là hai pháp nhân khác nhau trong bảng mẫu", () => {
    expect(MAU_DON.CS1.congTyHoa).not.toBe(MAU_DON.CS2.congTyHoa);
    expect(MAU_DON.CS1.dauTrang.mst).not.toBe(MAU_DON.CS2.dauTrang.mst);
  });
});

describe("[MD-02] điền sẵn từ form lập", () => {
  const goc = {
    hocVien: { hoTen: "Trần Minh Khang", ma: "HV0042", ngaySinh: "2016-03-12" },
    phuHuynh: { hoTen: "Nguyễn Thị Lan", quanHe: "Mẹ", dienThoai: "0905123456", email: null },
    khoaDaChon: [{ tenKhoa: "Sata 3", tenLop: "L1", maLop: "M1", giaoVien: "GV A" }],
    lyDo: "FAMILY" as const,
    ghiChu: "Về quê",
    ngayHenBatDau: "",
    ngayQuayLai: "2027-01-20",
    ngayNghiDau: "",
  };
  it("ngày đổi sang dd/MM/yyyy; ghi chú KHÔNG chảy vào 'Lý do khác' khi lý do không phải OTHER", () => {
    const d = dienSanDon(goc);
    expect(d.hocVien.ngaySinh).toBe("12/03/2016");
    expect(d.thoiGian.hocLaiDuKien).toBe("20/01/2027");
    expect(d.lyDo).toEqual(["FAMILY"]);
    expect(d.lyDoKhac).toBe("");
  });
  it("'Bảo lưu từ ngày' chỉ có khi Sale HẸN ngày; không hẹn thì để trống", () => {
    expect(dienSanDon(goc).thoiGian.baoLuuTu).toBe("");
    expect(dienSanDon({ ...goc, ngayHenBatDau: "2026-11-01" }).thoiGian.baoLuuTu).toBe("01/11/2026");
  });
  it("lý do OTHER ⇒ ghi chú thành 'Lý do khác'", () => {
    expect(dienSanDon({ ...goc, lyDo: "OTHER" }).lyDoKhac).toBe("Về quê");
  });
  it("ngayTrenDon giữ nguyên chuỗi không đúng hình dạng (người dùng gõ tay)", () => {
    expect(ngayTrenDon("2026-10-05")).toBe("05/10/2026");
    expect(ngayTrenDon("tuần sau")).toBe("tuần sau");
    expect(ngayTrenDon(null)).toBe("");
  });
});

describe.each(MA_MAU_DON)("[MD-PAR] bản in HTML khớp chữ của .docx mẫu — %s", (ma) => {
  it("MỌI dòng chữ trong .docx (thân, đầu trang, chân trang) có mặt trong bản in", async () => {
    const chu = await chuTrongDocx(await taiMauDocx(ma));
    const html = phang(dungDonHtml(DON_TRONG, ma, { logoUrl: duongDanAnh }));
    const thieu: string[] = [];
    for (const doan of [...chu.than, ...chu.dauTrang, ...chu.chanTrang]) {
      const s = phang(doan);
      if (s && !html.includes(s)) thieu.push(s);
    }
    expect(thieu).toEqual([]);
  });
  it("lưới có răng: bản in thiếu một dòng cam kết thì phép so PHẢI thấy", async () => {
    const chu = await chuTrongDocx(await taiMauDocx(ma));
    const html = phang(dungDonHtml(DON_TRONG, ma, { logoUrl: duongDanAnh })).replace("không thu phí bảo lưu", "x");
    const hong = html.replace("Không thu phí bảo lưu và phí học lại.", "");
    const thieu = chu.than.map(phang).filter((s) => s && !hong.includes(s));
    expect(thieu.length).toBeGreaterThan(0);
  });
});

describe.each(MA_MAU_DON)("[MD-DOCX] điền .docx — %s", (ma) => {
  it("đơn trống ⇒ XML ra GIỐNG HỆT từng byte của mẫu, chỉ khác thuộc tính giữ-liền khối ký (không ô nào bị đụng khi không có giá trị)", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(boGiuLien(dienXmlDon(xml, DON_TRONG, ma))).toBe(xml);
  });

  it("mỗi giá trị nằm NGAY TRƯỚC tab của đúng nhãn của nó; chỗ khác giữ nguyên", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    const ra = dienXmlDon(xml, DON_DAY, ma);
    const truoc = chuTrongXml(xml);
    const sau = chuTrongXml(ra);
    expect(sau.length).toBe(truoc.length);
    const doi = new Map<number, string>();
    sau.forEach((s, i) => s !== truoc[i] && doi.set(i, s));
    // Mỗi ô có giá trị: chạy-tab ngay sau nhãn đổi thành `<giá trị>\t`.
    for (const o of O_NHAP) {
      const v = o.giaTri(DON_DAY);
      const i = truoc.findIndex((t) => t.includes(o.nhan));
      expect(i, `nhãn ${o.nhan}`).toBeGreaterThanOrEqual(0);
      if (v) expect(sau[i + 1], `ô ${o.nhan}`).toBe(`${v}\t`);
      else expect(sau[i + 1]).toBe("\t");
    }
    // Ô tích: đúng ô "Gia đình có việc dài ngày" thành ☒; bốn ô kia vẫn ☐.
    const tichSau = sau.join("|");
    expect(tichSau).toContain("☒ Gia đình có việc dài ngày");
    for (const con of ["☐ Ốm đau, sức khỏe (*)", "☐ Đi xa, chuyển nơi ở tạm thời", "☐ Lịch học chính khóa/lịch cá nhân thay đổi", "☐ Lý do khác:"]) {
      expect(tichSau).toContain(con);
    }
    // Không có chạy nào KHÁC bị đổi: tập chỉ số đổi = các tab sau nhãn có giá trị + đúng một ô tích.
    const coGiaTri = O_NHAP.filter((o) => o.giaTri(DON_DAY)).length;
    expect(doi.size).toBe(coGiaTri + 1);
  });

  it("Phần dành cho Trung tâm và ngày ký KHÔNG bao giờ bị điền", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    const sau = chuTrongXml(dienXmlDon(xml, DON_DAY, ma));
    for (const nhan of ["Mã ghi danh: ", "Ngày duyệt: ", "Số buổi còn lại: ", "Giá trị học phí còn lại: ", "Hạn bảo lưu đến ngày: ", "Công nợ quá hạn (số ngày): "]) {
      const i = sau.findIndex((t) => t.includes(nhan));
      expect(i, nhan).toBeGreaterThanOrEqual(0);
      expect(sau[i + 1], nhan).toBe("\t");
    }
    expect(sau.join("|")).toContain("☐ Do phụ huynh");
    expect(sau.join("|")).toContain("Đà Nẵng, ngày …… tháng …… năm 20……");
  });

  it("ký tự XML trong giá trị được thoát; tab/xuống dòng trong giá trị không phá đường chấm", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    const ra = dienXmlDon(xml, { ...DON_DAY, phuHuynh: { ...DON_DAY.phuHuynh, hoTen: "A & B <c>\td\ne" } }, ma);
    expect(ra).toContain("A &amp; B &lt;c&gt; d e\t</w:t>");
    expect(ra).not.toContain("<c>");
    // Ký tự điều khiển (XML 1.0 cấm) bị bỏ: nếu lọt vào, Word từ chối mở cả file.
    const lan = dienXmlDon(xml, { ...DON_DAY, phuHuynh: { ...DON_DAY.phuHuynh, hoTen: "An\u0001\u0008Bình" } }, ma);
    expect(lan).toContain("AnBình\t</w:t>");
    expect(Array.from(lan).some((c) => c.charCodeAt(0) >= 1 && c.charCodeAt(0) <= 8)).toBe(false);
  });

  it("có chữ ở 'Lý do khác' ⇒ ô đó tự được tích dù lý do chọn là ô khác", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    const sau = chuTrongXml(dienXmlDon(xml, { ...DON_DAY, lyDo: ["FAMILY"], lyDoKhac: "Đi công tác" }, ma)).join("|");
    expect(sau).toContain("☒ Lý do khác:");
    expect(sau).toContain("☒ Gia đình có việc dài ngày");
  });

  it("nhãn bị đổi chữ trong mẫu ⇒ NÉM LoiMauDon (không xuất file thiếu ô)", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    const hong = xml.replace("Quan hệ với học viên: ", "Quan hệ với HS: ");
    expect(() => dienXmlDon(hong, DON_DAY, ma)).toThrow(LoiMauDon);
    expect(() => dienXmlDon(hong, DON_DAY, ma)).toThrow(/Quan hệ với học viên/);
  });

  it("nhãn xuất hiện HAI lần ⇒ NÉM (không đoán ô nào)", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    const hong = xml.replace("Dự kiến học lại (nếu có): ", "Email: Dự kiến học lại (nếu có): ");
    expect(() => dienXmlDon(hong, DON_DAY, ma)).toThrow(/Email/);
  });

  it("sau nhãn không phải chạy-tab ⇒ NÉM", async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    const xml = await zip.file("word/document.xml")!.async("string");
    const hong = xml.replace(/(Họ và tên học viên: <\/w:t><\/w:r><w:r>[\s\S]*?<w:t xml:space="preserve">)\t(<\/w:t>)/, "$1$2");
    expect(hong).not.toBe(xml);
    expect(() => dienXmlDon(hong, DON_DAY, ma)).toThrow(LoiMauDon);
  });

  it("file ra vẫn là .docx đọc được: giữ nguyên mọi phần khác của gói (logo, kiểu chữ, đầu/chân trang)", async () => {
    const goc = await taiMauDocx(ma);
    const ra = await dienDonDocx(goc, DON_DAY, ma);
    const zg = await JSZip.loadAsync(goc);
    const zr = await JSZip.loadAsync(ra);
    expect(Object.keys(zr.files).sort()).toEqual(Object.keys(zg.files).sort());
    for (const ten of Object.keys(zg.files)) {
      if (ten === "word/document.xml" || ten === "word/footer1.xml" || zg.files[ten]!.dir) continue; // hai phần này có test riêng
      expect(Buffer.compare(await zg.file(ten)!.async("nodebuffer"), await zr.file(ten)!.async("nodebuffer")), ten).toBe(0);
    }
  });
});

describe("[MD-FILE] tệp mẫu có mặt và được mang vào image", () => {
  it("mỗi mẫu khai trong MAU_DON có tệp .docx; không có .docx nào mồ côi (có tệp mà không khai = không ai dùng)", async () => {
    const { readdirSync, existsSync } = await import("node:fs");
    const path = await import("node:path");
    const thuMuc = path.join(process.cwd(), "lib", "bao-luu", "mau-don");
    for (const ma of MA_MAU_DON) expect(existsSync(path.join(thuMuc, MAU_DON[ma].tep)), MAU_DON[ma].tep).toBe(true);
    const khai = new Set(MA_MAU_DON.map((ma) => MAU_DON[ma].tep));
    expect(readdirSync(thuMuc).filter((t) => t.endsWith(".docx") && !khai.has(t))).toEqual([]);
  });

  it("next.config.ts mang thư mục mẫu vào gói standalone cho đúng route — thiếu dòng này thì chạy local xanh, lên VPS ENOENT", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const cfg = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8")
      .split("\n")
      .filter((d) => !d.trim().startsWith("//"))
      .join("\n");
    expect(cfg).toMatch(/"\/api\/admin\/bao-luu\/mau-don":\s*\["\.\/lib\/bao-luu\/mau-don\/\*\.docx"\]/);
  });
});

// ── Nhiều khoá: mỗi khoá kèm lớp; ô quá dài ⇒ "Xem danh sách khoá bên dưới" + danh sách đủ dưới mục II ─────────────────────────
const K_LA = { tenKhoa: "Sata 3", tenLop: "Sata 3 — T7 chiều (CS1.03)", maLop: "CS1.03", giaoVien: "Lê Nhật Thuận" };
const K_LB = { tenKhoa: "Sata 4", tenLop: "Sata 4 — CN sáng (CS1.05)", maLop: "CS1.05", giaoVien: "Thanh Hiền" };
// Hai khoá NGẮN theo nghĩa của giấy: mã lớp ngắn + cùng một giáo viên ⇒ mọi ô còn vừa (đo bằng Word, 13/10/2026).
const K_NGAN_A = { tenKhoa: "Sata 3", tenLop: "Sata 3 — T7", maLop: "03", giaoVien: "Lê Nhật Thuận" };
const K_NGAN_B = { tenKhoa: "Sata 4", tenLop: "Sata 4 — CN", maLop: "05", giaoVien: "Lê Nhật Thuận" };
// Ba khoá DÀI: tên khoá dài + ba giáo viên khác nhau ⇒ khoá và giáo viên đều vượt ô.
const K_DAI = [
  { tenKhoa: "Sata 3 — Cơ cấu chuyển động", tenLop: "L1", maLop: "CS1.20", giaoVien: "Lê Nhật Thuận" },
  { tenKhoa: "Sata 4 — Lập trình khối", tenLop: "L2", maLop: "CS1.03", giaoVien: "Nguyễn Bích Trà" },
  { tenKhoa: "Sata 5 — Điện tử cơ bản", tenLop: "L3", maLop: "CS1.07", giaoVien: "Trần Tuấn Kiệt" },
];
const dauVao = (khoaDaChon: DauVaoDienSan["khoaDaChon"]): DauVaoDienSan => ({
  hocVien: { hoTen: "Trần Minh Khang", ma: "HV0042", ngaySinh: "2016-03-12" },
  phuHuynh: { hoTen: "Nguyễn Thị Lan", quanHe: "Mẹ", dienThoai: "0905123456", email: null },
  khoaDaChon,
  lyDo: "FAMILY",
  ghiChu: "",
  ngayHenBatDau: "",
  ngayQuayLai: "",
  ngayNghiDau: "",
});

describe("[MD-KHOA] ghi nhiều khoá lên đơn", () => {
  it("MỘT khoá: ghi như cũ (tên khoá, tên lớp), không danh sách", () => {
    const d = dienSanDon(dauVao([K_LA]));
    expect(d.hocVien).toMatchObject({ khoa: "Sata 3", lop: "Sata 3 — T7 chiều (CS1.03)", giaoVien: "Lê Nhật Thuận" });
    expect(d.danhSachKhoa).toEqual([]);
    expect(coDanhSachKhoa(d)).toBe(false);
  });

  it("HAI khoá ngắn: mỗi khoá kèm lớp 'Sata 3 (lớp 03); Sata 4 (lớp 05)', mọi ô vừa ⇒ không danh sách", () => {
    const d = dienSanDon(dauVao([K_NGAN_A, K_NGAN_B]));
    expect(d.hocVien.khoa).toBe("Sata 3 (lớp 03); Sata 4 (lớp 05)");
    expect(d.hocVien.lop).toBe("03; 05");
    expect(d.hocVien.giaoVien).toBe("Lê Nhật Thuận"); // cùng một giáo viên ⇒ gộp
    expect(d.danhSachKhoa).toEqual([]);
    expect(coDanhSachKhoa(d)).toBe(false);
  });

  it("HAI khoá với mã lớp thật (CS1.03) + hai giáo viên: ô khoá và giáo viên KHÔNG vừa ⇒ trỏ + danh sách (ca thường gặp nhất)", () => {
    const d = dienSanDon(dauVao([K_LA, K_LB]));
    expect(d.hocVien.khoa).toBe(CAU_XEM_DANH_SACH);
    expect(d.hocVien.giaoVien).toBe(CAU_XEM_DANH_SACH_NGAN); // ô giáo viên quá hẹp cho câu đầy đủ
    expect(d.hocVien.lop).toBe("CS1.03; CS1.05");
    expect(d.danhSachKhoa).toEqual(["Sata 3 (lớp CS1.03) — GV: Lê Nhật Thuận", "Sata 4 (lớp CS1.05) — GV: Thanh Hiền"]);
  });

  it("BA khoá dài: ô vượt ghi 'Xem danh sách khoá bên dưới', ô còn vừa giữ nguyên, danh sách đủ từng khoá kèm lớp + giáo viên", () => {
    const d = dienSanDon(dauVao(K_DAI));
    expect(d.hocVien.khoa).toBe(CAU_XEM_DANH_SACH);
    expect(d.hocVien.giaoVien).toBe(CAU_XEM_DANH_SACH_NGAN);
    expect(d.hocVien.lop).toBe("CS1.20; CS1.03; CS1.07"); // vừa ô ⇒ KHÔNG bị thay bằng câu trỏ
    expect(d.danhSachKhoa).toEqual([
      "Sata 3 — Cơ cấu chuyển động (lớp CS1.20) — GV: Lê Nhật Thuận",
      "Sata 4 — Lập trình khối (lớp CS1.03) — GV: Nguyễn Bích Trà",
      "Sata 5 — Điện tử cơ bản (lớp CS1.07) — GV: Trần Tuấn Kiệt",
    ]);
    expect(coDanhSachKhoa(d)).toBe(true);
  });

  it("ranh giới: chuỗi dài nhất còn VỪA ô thì giữ nguyên, thêm một chữ nữa thì trỏ", () => {
    let n = 1;
    while (vuaOGiay("hv.khoa", "k".repeat(n + 1))) n++;
    const vua = dienSanDon(dauVao([{ ...K_LA, tenKhoa: "k".repeat(n) }]));
    expect(vua.hocVien.khoa).toBe("k".repeat(n));
    expect(vua.danhSachKhoa).toEqual([]);
    const qua = dienSanDon(dauVao([{ ...K_LA, tenKhoa: "k".repeat(n + 1) }]));
    expect(qua.hocVien.khoa).toBe(CAU_XEM_DANH_SACH);
    expect(qua.danhSachKhoa).toHaveLength(1);
  });

  it("một khoá, tên lớp quá dài nhưng MÃ LỚP vừa ⇒ lùi về mã lớp, KHÔNG cần danh sách (dữ liệu thật: «Sata 2 — Cơ cấu chuyển động — CN sáng (CS1.02)»)", () => {
    const tenLopDai = "Sata 2 — Cơ cấu chuyển động — CN sáng (CS1.02)";
    expect(vuaOGiay("hv.lop", tenLopDai)).toBe(false);
    const d = dienSanDon(dauVao([{ ...K_LA, tenKhoa: "Sata 2 — Cơ cấu chuyển động", tenLop: tenLopDai, maLop: "CS1.SATA-2.002" }]));
    expect(d.hocVien.lop).toBe("CS1.SATA-2.002");
    expect(d.danhSachKhoa).toEqual([]);
  });

  it("[MD-TEN-NGAN] tenNganKhoa: lấy phần trước « — », tên không có dấu ấy giữ nguyên, không bao giờ rỗng", () => {
    expect(tenNganKhoa("Sata 3 — Cảm biến & điều khiển")).toBe("Sata 3");
    expect(tenNganKhoa("  Sata 1 – Nhập môn Robotics ")).toBe("Sata 1"); // gạch vừa
    expect(tenNganKhoa("Combo Sata 1 & 2")).toBe("Combo Sata 1 & 2");
    expect(tenNganKhoa("Sata-3 Robot")).toBe("Sata-3 Robot"); // gạch nối không khoảng trắng không phải dấu tách
    expect(tenNganKhoa("— Chỉ có phần sau")).toBe("— Chỉ có phần sau"); // phần đầu rỗng ⇒ giữ tên đầy đủ
    expect(tenNganKhoa("Sata 2 — A — B")).toBe("Sata 2");
  });

  it("[MD-TEN-NGAN] MỘT khoá tên thật dài: ô khoá ghi tên ngắn NGAY (không phải câu trỏ); danh sách vẫn ghi tên đầy đủ khi ô khác phải trỏ", () => {
    const tenDay = "Sata 3 — Cảm biến & điều khiển";
    expect(vuaOGiay("hv.khoa", tenDay)).toBe(false); // trước đây ô này phải trỏ
    const d = dienSanDon(dauVao([{ ...K_LA, tenKhoa: tenDay, tenLop: tenDay + " — Thứ bảy chiều — P302", maLop: "CS1.SATA-3.008", giaoVien: "Nguyễn Bích Trà Anh Thư" }]));
    expect(d.hocVien.khoa).toBe("Sata 3");
    expect(d.hocVien.lop).toBe("CS1.SATA-3.008");
    expect(d.hocVien.giaoVien).toBe(CAU_XEM_DANH_SACH_NGAN); // giáo viên dài vẫn trỏ ⇒ danh sách có
    expect(d.danhSachKhoa).toEqual([`${tenDay} (lớp CS1.SATA-3.008) — GV: Nguyễn Bích Trà Anh Thư`]);
  });

  it("[MD-TEN-NGAN] nhiều khoá: ô ghi tên ngắn kèm lớp (không còn trỏ khi vừa)", () => {
    const d = dienSanDon(dauVao([
      { ...K_NGAN_A, tenKhoa: "Sata 3 — Cảm biến & điều khiển" },
      { ...K_NGAN_B, tenKhoa: "Sata 4 — Lập trình khối" },
    ]));
    expect(d.hocVien.khoa).toBe("Sata 3 (lớp 03); Sata 4 (lớp 05)");
    expect(d.danhSachKhoa).toEqual([]);
  });

  it("một khoá, cả tên lớp lẫn mã lớp đều quá dài ⇒ trỏ + danh sách một dòng (luật theo ô, không theo số khoá)", () => {
    const d = dienSanDon(dauVao([{ ...K_LA, tenLop: "Sata 3 — Cơ cấu chuyển động — Thứ bảy chiều — Phòng 302", maLop: "CS1.SATA-3.CO-CAU-CHUYEN-DONG.002" }]));
    expect(d.hocVien.lop).toBe(CAU_XEM_DANH_SACH);
    expect(d.hocVien.khoa).toBe("Sata 3");
    expect(d.danhSachKhoa).toEqual(["Sata 3 (lớp CS1.SATA-3.CO-CAU-CHUYEN-DONG.002) — GV: Lê Nhật Thuận"]);
  });

  it("Sale sửa tay ô khỏi câu trỏ ⇒ danh sách KHÔNG in (không ô nào nhắc tới nó)", () => {
    const d = dienSanDon(dauVao(K_DAI));
    const sua: DonBaoLuu = { ...d, hocVien: { ...d.hocVien, khoa: "Sata 3; Sata 4; Sata 5", giaoVien: "Nhiều giáo viên" } };
    expect(coDanhSachKhoa(sua)).toBe(false);
    expect(coDanhSachKhoa({ ...d, danhSachKhoa: ["", "  "] })).toBe(false);
  });
});

describe.each(MA_MAU_DON)("[MD-KHOA-DOCX] danh sách khoá trong .docx — %s", (ma) => {
  const xmlGoc = async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    return zip.file("word/document.xml")!.async("string");
  };
  const soDoan = (x: string) => ({ mo: (x.match(/<w:p[ >]/g) ?? []).length, dong: (x.match(/<\/w:p>/g) ?? []).length });

  it("ba khoá dài: ô ghi câu trỏ; tiêu đề + 3 dòng nằm NGAY SAU đoạn 'Lớp đang học…Giáo viên', TRƯỚC mục III; XML cân thẻ", async () => {
    const xml = await xmlGoc();
    const don = { ...DON_DAY, ...dienSanDon(dauVao(K_DAI)) };
    const ra = dienXmlDon(xml, don, ma);
    const chu = chuTrongXml(ra);
    const kh = chu.findIndex((t) => t.includes("Khóa học: "));
    expect(chu[kh + 1]).toBe(`${CAU_XEM_DANH_SACH}\t`);
    const gv = chu.findIndex((t) => t.includes("Giáo viên phụ trách: "));
    expect(chu[gv + 1]).toBe(`${CAU_XEM_DANH_SACH_NGAN}\t`);
    expect(chu.slice(gv + 2, gv + 7)).toEqual([
      TIEU_DE_DANH_SACH_KHOA,
      "1. Sata 3 — Cơ cấu chuyển động (lớp CS1.20) — GV: Lê Nhật Thuận",
      "2. Sata 4 — Lập trình khối (lớp CS1.03) — GV: Nguyễn Bích Trà",
      "3. Sata 5 — Điện tử cơ bản (lớp CS1.07) — GV: Trần Tuấn Kiệt",
      "III. LÝ DO BẢO LƯU",
    ]);
    const truoc = soDoan(xml);
    const sau = soDoan(ra);
    expect(sau.mo - truoc.mo).toBe(4);
    expect(sau.mo).toBe(sau.dong);
  });

  it("đoạn mới mượn phông + cỡ chữ của mẫu; tiêu đề in đậm đúng thứ tự phần tử (rFonts → b → sz)", async () => {
    const ra = dienXmlDon(await xmlGoc(), { ...DON_DAY, ...dienSanDon(dauVao(K_DAI)) }, ma);
    const i = ra.indexOf(TIEU_DE_DANH_SACH_KHOA);
    const chay = ra.slice(ra.lastIndexOf("<w:r>", i), i);
    expect(chay).toMatch(/<w:rFonts[^>]*Times New Roman[^>]*\/><w:b\/><w:bCs\/><w:sz w:val="18"\/>/);
    const j = ra.indexOf("1. Sata 3");
    expect(ra.slice(ra.lastIndexOf("<w:r>", j), j)).not.toContain("<w:b/>");
  });

  it("MỘT khoá và HAI khoá ngắn: KHÔNG chèn đoạn nào (số đoạn y nguyên mẫu)", async () => {
    const xml = await xmlGoc();
    for (const k of [[K_LA], [K_NGAN_A, K_NGAN_B]]) {
      const ra = dienXmlDon(xml, { ...DON_DAY, ...dienSanDon(dauVao(k)) }, ma);
      expect(soDoan(ra)).toEqual(soDoan(xml));
      expect(chuTrongXml(ra)).not.toContain(TIEU_DE_DANH_SACH_KHOA);
    }
  });

  it("ô đã sửa khỏi câu trỏ ⇒ không chèn danh sách", async () => {
    const xml = await xmlGoc();
    const d = { ...DON_DAY, ...dienSanDon(dauVao(K_DAI)) };
    const ra = dienXmlDon(xml, { ...d, hocVien: { ...d.hocVien, khoa: "Sata 3; 4; 5", giaoVien: "Nhiều GV" } }, ma);
    expect(soDoan(ra)).toEqual(soDoan(xml));
  });

  it("mẫu mất đoạn 'Lớp đang học' ⇒ NÉM (không chèn đại vào chỗ khác)", async () => {
    const hong = (await xmlGoc()).replace("Lớp đang học: ", "Lớp: ");
    expect(() => dienXmlDon(hong, { ...DON_DAY, ...dienSanDon(dauVao(K_DAI)) }, ma)).toThrow(LoiMauDon);
  });

  it("dienDonDocx ra file đọc lại được và có đủ dòng danh sách", async () => {
    const out = await dienDonDocx(await taiMauDocx(ma), { ...DON_DAY, ...dienSanDon(dauVao(K_DAI)) }, ma);
    const chu = (await chuTrongDocx(out)).than;
    expect(chu).toContain("3. Sata 5 — Điện tử cơ bản (lớp CS1.07) — GV: Trần Tuấn Kiệt");
  });
});

describe.each(MA_MAU_DON)("[MD-KHOA-HTML] danh sách khoá trong bản in — %s", (ma) => {
  const html = (k: DauVaoDienSan["khoaDaChon"]) => phang(dungDonHtml({ ...DON_DAY, ...dienSanDon(dauVao(k)) }, ma, { logoUrl: duongDanAnh }));

  it("ba khoá dài: câu trỏ trong ô + danh sách NGAY SAU 'Lớp đang học', TRƯỚC 'III. LÝ DO BẢO LƯU'", () => {
    const h = html(K_DAI);
    const giua = h.slice(h.indexOf("Lớp đang học:"), h.indexOf("III. LÝ DO BẢO LƯU"));
    expect(giua.indexOf(TIEU_DE_DANH_SACH_KHOA)).toBeGreaterThan(giua.indexOf("Giáo viên phụ trách:"));
    expect(giua).toContain("1. Sata 3 — Cơ cấu chuyển động (lớp CS1.20) — GV: Lê Nhật Thuận");
    expect(giua).toContain("3. Sata 5 — Điện tử cơ bản (lớp CS1.07) — GV: Trần Tuấn Kiệt");
    expect(h).toContain(`Khóa học: ${CAU_XEM_DANH_SACH}`);
  });

  it("một khoá / hai khoá ngắn: không có khối danh sách", () => {
    expect(html([K_LA])).not.toContain(TIEU_DE_DANH_SACH_KHOA);
    expect(html([K_NGAN_A, K_NGAN_B])).not.toContain(TIEU_DE_DANH_SACH_KHOA);
    expect(html([K_NGAN_A, K_NGAN_B])).toContain("Sata 3 (lớp 03); Sata 4 (lớp 05)");
  });

  it("giá trị trong danh sách được thoát HTML", () => {
    const d = dienSanDon(dauVao([{ ...K_DAI[0]!, tenKhoa: "<b>x</b> " + "k".repeat(50) }]));
    const raw = dungDonHtml({ ...DON_DAY, ...d }, ma, { logoUrl: duongDanAnh });
    expect(raw).not.toContain("<b>x</b>");
    expect(raw).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("[MD-DORONG] mô hình độ rộng khớp những gì Word đã in thật (13/10/2026)", () => {
  it("nhãn của O_GIAY khớp từng nhãn điền của .docx (một nguồn: đổi nhãn ở một nơi mà quên nơi kia thì đỏ)", () => {
    const nhanDocx = new Set(O_NHAP.map((o) => o.nhan));
    for (const [khoa, o] of Object.entries(O_GIAY)) {
      // "☐ Lý do khác: " là chữ của ô tích + nhãn; bộ điền .docx khớp phần "Lý do khác: ".
      expect(nhanDocx.has(o.nhan.replace("☐ ", "")), khoa).toBe(true);
    }
    expect(Object.keys(O_GIAY)).toHaveLength(O_NHAP.length);
  });

  // Mỗi dòng dưới là một sự kiện ĐO bằng Word thật: ô có bị xuống dòng không.
  it.each<[TruongO, string, boolean]>([
    ["hv.khoa", "Sata 3; Sata 4", true],
    ["hv.khoa", "Sata 3 (lớp CS1.03); Sata 4 (lớp CS1.05)", false], // Word xuống dòng ở "CS1.05)"
    ["hv.lop", "sata3.15h45-CN.CS1-P302", true],
    ["hv.lop", "CS1.03; CS1.05", true],
    ["hv.giaoVien", "Lê Nhật Thuận", true],
    ["hv.giaoVien", "Lê Nhật Thuận; Thanh Hiền", false], // Word xuống dòng ở "Hiền"
    ["hv.ma", "CS1.HV.0042", true],
    ["ph.email", "lan.nguyen@example.com", true],
    ["ph.dienThoai", "0905 123 456", true],
  ])("%s ⇐ %j vừa ô = %s", (truong, giaTri, vua) => {
    expect(vuaOGiay(truong, giaTri)).toBe(vua);
  });

  it("nhãn dài ăn chỗ của giá trị: 'Giáo viên phụ trách' chừa ít hơn 'Mã học viên' (lý do không dùng ngưỡng ký tự chung)", () => {
    expect(doRongPt(O_GIAY["hv.giaoVien"].nhan)).toBeGreaterThan(doRongPt(O_GIAY["hv.ma"].nhan));
    const giaTri = "x".repeat(25);
    expect(vuaOGiay("hv.ma", giaTri)).toBe(true);
    expect(vuaOGiay("hv.giaoVien", giaTri)).toBe(false);
  });

  it("dấu thanh không đổi độ rộng; Đ/đ tính riêng", () => {
    expect(doRongPt("Nguyen")).toBe(doRongPt("Nguyễn"));
    expect(doRongPt("Đ")).toBe(doRongPt("D"));
    expect(doRongPt("đ")).toBe(doRongPt("d"));
  });
});

describe("[MD-TRO] câu trỏ không được tự làm ô xuống dòng", () => {
  it.each<TruongO>(["hv.khoa", "hv.lop", "hv.giaoVien"])("%s: giá trị ghi vào ô LUÔN vừa ô (chuỗi dài đến đâu cũng vậy)", (truong) => {
    for (const dai of ["", "x", "k".repeat(400)]) expect(vuaOGiay(truong, giaTriVuaO(truong, dai))).toBe(true);
  });

  it("ô đủ rộng dùng câu đầy đủ; ô giáo viên (hẹp nhất) dùng bản rút gọn — đúng điều Word đã đo", () => {
    const dai = "k".repeat(400);
    expect(giaTriVuaO("hv.khoa", dai)).toBe(CAU_XEM_DANH_SACH);
    expect(giaTriVuaO("hv.lop", dai)).toBe(CAU_XEM_DANH_SACH);
    expect(giaTriVuaO("hv.giaoVien", dai)).toBe(CAU_XEM_DANH_SACH_NGAN);
    expect(vuaOGiay("hv.giaoVien", CAU_XEM_DANH_SACH)).toBe(false); // Word xuống dòng nếu nhét câu đầy đủ vào ô này
  });

  it("chỉ MỘT ô là câu rút gọn cũng đủ để in danh sách (không đòi cả ba ô)", () => {
    const d = dienSanDon(dauVao([K_LA, { ...K_LB, maLop: "05", giaoVien: "Nguyễn Bích Trà Anh Thư" }]));
    expect(d.hocVien.giaoVien).toBe(CAU_XEM_DANH_SACH_NGAN);
    expect(coDanhSachKhoa(d)).toBe(true);
  });
});

describe.each(MA_MAU_DON)("[MD-NEN] có danh sách thì nén chỗ cho vừa một trang, không có thì giữ NGUYÊN mẫu — %s", (ma) => {
  const xmlGoc = async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    return zip.file("word/document.xml")!.async("string");
  };
  const khoangTruoc = (x: string) => (x.match(/w:before="\d+"/g) ?? []).map((m) => Number(m.replace(/\D/g, "")));

  it("không danh sách (một khoá / hai khoá ngắn): MỌI khoảng 'trước đoạn' của mẫu giữ nguyên", async () => {
    const xml = await xmlGoc();
    for (const k of [[K_LA], [K_NGAN_A, K_NGAN_B]]) {
      expect(khoangTruoc(dienXmlDon(xml, { ...DON_DAY, ...dienSanDon(dauVao(k)) }, ma))).toEqual(khoangTruoc(xml));
    }
  });

  it("có danh sách: bỏ khoảng nhỏ (<10pt) quanh tiêu đề mục; chỗ ký GIỮ NGUYÊN 32pt (640) như mẫu gốc; khối danh sách không thêm khoảng", async () => {
    const xml = await xmlGoc();
    const ra = khoangTruoc(dienXmlDon(xml, { ...DON_DAY, ...dienSanDon(dauVao(K_DAI)) }, ma));
    expect(ra.filter((v) => v > 0 && v < 200)).toEqual([]);
    expect(ra.filter((v) => v === 640)).toHaveLength(3); // ba ô ký: KHÔNG nén
    expect(ra.filter((v) => v === 480 || v === 360)).toEqual([]);
    expect(ra.length).toBe(khoangTruoc(xml).length + 4); // + tiêu đề và 3 dòng, mỗi đoạn một khoảng (=0)
  });

  it("dưới ngưỡng thì vừa một trang, quá ngưỡng thì báo: 4 khoá vừa, 5 khoá thì không", () => {
    const them = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ tenKhoa: `Sata ${i + 3} — Cơ cấu chuyển động`, tenLop: "L", maLop: `CS1.${20 + i}`, giaoVien: `Giáo viên số ${i}` }));
    expect(TOI_DA_KHOA_MOT_TRANG).toBe(4);
    expect(danhSachQuaMotTrang(dienSanDon(dauVao(them(4))))).toBe(false);
    expect(danhSachQuaMotTrang(dienSanDon(dauVao(them(5))))).toBe(true);
    expect(danhSachQuaMotTrang(dienSanDon(dauVao([K_LA])))).toBe(false); // không danh sách ⇒ không có gì tràn
  });
});

describe.each(MA_MAU_DON)("[MD-KY] khối ký trọn một trang + 'Trang x/y' — %s", (ma) => {
  const xmlGoc = async () => {
    const zip = await JSZip.loadAsync(await taiMauDocx(ma));
    return zip.file("word/document.xml")!.async("string");
  };
  const doan = (x: string) => x.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? [];
  const chuCua = (d: string) => (d.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) ?? []).join("");

  for (const [ten, don] of [
    ["đơn trống", DON_TRONG],
    ["một khoá", { ...DON_DAY, ...dienSanDon(dauVao([K_LA])) }],
    ["ba khoá dài (có danh sách)", { ...DON_DAY, ...dienSanDon(dauVao(K_DAI)) }],
  ] as const) {
    it(`${ten}: từ mục V đến hết thân, mọi đoạn trừ đoạn cuối giữ liền (keepNext+keepLines); trước mục V thì không; hàng bảng chữ ký không tách`, async () => {
      const ra = dienXmlDon(await xmlGoc(), don, ma);
      const ds = doan(ra);
      const iV = ds.findIndex((d) => chuCua(d).includes("V. CAM KẾT CỦA PHỤ HUYNH"));
      expect(iV).toBeGreaterThan(5);
      ds.forEach((d, i) => {
        const giu = d.includes("<w:keepNext/><w:keepLines/>");
        if (i < iV) expect(giu, `đoạn ${i} trước mục V`).toBe(false);
        else if (i < ds.length - 1) expect(giu, `đoạn ${i}`).toBe(true);
        else {
          expect(d.includes("<w:keepNext/>")).toBe(false); // đoạn cuối không kéo thêm gì
          expect(d.includes("<w:keepLines/>")).toBe(true);
        }
      });
      expect(ra.match(/<w:trPr><w:cantSplit\/><\/w:trPr>/g)).toHaveLength(1); // bảng chữ ký: một hàng
    });
  }

  it("mẫu không có mục V ⇒ NÉM (không giữ-liền đại một khúc khác)", async () => {
    const hong = (await xmlGoc()).replace("V. CAM KẾT CỦA PHỤ HUYNH", "V. CAM KET");
    expect(() => dienXmlDon(hong, DON_DAY, ma)).toThrow(LoiMauDon);
  });

  it("chân trang: THÊM 'Trang x/y' (PAGE, NUMPAGES) trên CÙNG dòng, KHÔNG thêm đoạn; chữ cũ giữ nguyên; số trang dùng cỡ chữ của chân trang", async () => {
    const goc = await JSZip.loadAsync(await taiMauDocx(ma));
    const chanGoc = await goc.file("word/footer1.xml")!.async("string");
    const ra = await JSZip.loadAsync(await dienDonDocx(await taiMauDocx(ma), DON_DAY, ma));
    const chan = await ra.file("word/footer1.xml")!.async("string");
    expect(doan(chan)).toHaveLength(doan(chanGoc).length); // không thêm dòng ⇒ không đổi chỗ của thân
    expect(chuTrongXml(chan).join("")).toContain(MAU_DON[ma].chanTrang.replace(/\s+/g, " ").slice(0, 20));
    expect(chuTrongXml(chan).slice(0, chuTrongXml(chanGoc).length)).toEqual(chuTrongXml(chanGoc));
    expect(chan).toContain("<w:instrText xml:space=\"preserve\"> PAGE </w:instrText>");
    expect(chan).toContain("<w:instrText xml:space=\"preserve\"> NUMPAGES </w:instrText>");
    expect(chuTrongXml(chan).join("")).toMatch(/Trang 1\/1$/);
    // Mọi chạy chữ của phần thêm mang rPr (cỡ 10pt): không rơi về mặc định 12pt.
    const them = chan.slice(chan.indexOf("<w:tab/>"));
    expect((them.match(/<w:r>/g) ?? []).length).toBe((them.match(/<w:r><w:rPr>/g) ?? []).length);
    expect(them).not.toMatch(/<w:sz w:val="24"/);
  });

  it("chân trang đổi cấu trúc ⇒ NÉM", () => {
    expect(() => themSoTrang("<w:ftr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:ftr>", ma)).toThrow(LoiMauDon);
  });
});

describe.each(MA_MAU_DON)("[MD-KY-HTML] bản in: khối ký liền, số trang, ô ký không bị nén — %s", (ma) => {
  const raw = (k: DauVaoDienSan["khoaDaChon"]) => dungDonHtml({ ...DON_DAY, ...dienSanDon(dauVao(k)) }, ma, { logoUrl: duongDanAnh });

  it("mục V + chữ ký + phần dành cho Trung tâm nằm trong MỘT khối không tách ngang trang; có 'Trang x/y' ở lề dưới", () => {
    const h = raw(K_DAI);
    expect(h).toMatch(/\.khoi-ky \{ break-inside: avoid; \}/);
    expect(h).toContain("@bottom-right");
    expect(h).toContain('counter(page) "/" counter(pages)');
    const i = h.indexOf('<div class="khoi-ky">');
    const khoi = h.slice(i, h.indexOf('<div class="chan">'));
    for (const can of ["V. CAM KẾT CỦA PHỤ HUYNH", "NGƯỜI LẬP HỒ SƠ", "QUẢN LÝ TRUNG TÂM", "PHẦN DÀNH CHO TRUNG TÂM"]) expect(khoi, can).toContain(can);
    expect(h.slice(0, i)).not.toContain("V. CAM KẾT");
  });

  it("có danh sách: KHÔNG có luật nào nén chỗ ký (.co-ds .ky); danh sách cỡ 9pt", () => {
    const h = raw(K_DAI);
    expect(h).not.toMatch(/\.co-ds \.ky/);
    expect(h).toMatch(/\.co-ds \.ds-khoa \{ font-size: 9pt; \}/);
    expect(h).toMatch(/\.ky \.tc div:last-child \{ height: 16mm; \}/); // chỗ ký mặc định, không bị ghi đè
  });
});
