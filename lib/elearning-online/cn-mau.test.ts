// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { taoJpegDauTep, taoPng } from "../../tests/elearning/_png";
import { chuanHoaDeSoSanh, dungPdfChungNhan, PhoiKhongKhop } from "./cn-pdf";
import { CO_CHU_NHO_NHAT, GIOI_HAN_PHOI, MAU_THU, boCucMacDinh, boCucSchema, chonCoChu, docThongTinAnh, dongChu, kiemPhoi, kiemTruocKhiDuyet, khoaPhoi, sha256Hex, snapshotChoBanCu, taoSnapshot } from "./cn-mau";

const NGAY = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));
const du = { hoTen: "Trần Bảo Minh", tenKhoa: "RoboSim 2 · Vượt mê cung", finalScore: 92, capLuc: NGAY, code: "K7M2N9P4Q8" };
const png = taoPng(2100, 1485);

describe("[CNM-01] phôi: nhận biết bằng CHỮ KÝ TỆP, không tin MIME/đuôi", () => {
  it("PNG và JPEG hợp lệ đọc đúng loại + kích thước", () => {
    expect(docThongTinAnh(png)).toEqual({ mime: "image/png", ext: "png", width: 2100, height: 1485 });
    expect(docThongTinAnh(taoJpegDauTep(3508, 2480))).toEqual({ mime: "image/jpeg", ext: "jpg", width: 3508, height: 2480 });
  });
  it("HTML/GIF/rỗng/cắt cụt không bao giờ được nhận là ảnh (dù đuôi .png)", () => {
    expect(docThongTinAnh(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(docThongTinAnh(new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000"))).toBeNull();
    expect(docThongTinAnh(new Uint8Array())).toBeNull();
    expect(docThongTinAnh(png.slice(0, 20))).toBeNull();
    const hong = Uint8Array.from(png);
    hong[12] = 0x58; // IHDR sai
    expect(docThongTinAnh(hong)).toBeNull();
    const thieuByteDau = Uint8Array.from(png);
    thieuByteDau[0] = 0x41; // sai đúng một byte của chữ ký PNG
    expect(docThongTinAnh(thieuByteDau)).toBeNull();
    const sai2 = Uint8Array.from(png);
    sai2[5] = 0x00;
    expect(docThongTinAnh(sai2)).toBeNull();
  });
});

describe("[CNM-02] phôi: giới hạn", () => {
  it("từ chối quá nhỏ / sai tỉ lệ / quá lớn / không phải ảnh; nhận phôi đúng", () => {
    expect(kiemPhoi(taoPng(1500, 1060))).toMatchObject({ ok: false });
    expect(kiemPhoi(taoPng(2100, 2100))).toMatchObject({ ok: false, thongBao: expect.stringContaining("A4") });
    expect(kiemPhoi(taoPng(1485, 2100))).toMatchObject({ ok: false }); // dọc
    expect(kiemPhoi(new Uint8Array(GIOI_HAN_PHOI.toiDaByte + 1))).toMatchObject({ ok: false, thongBao: expect.stringContaining("10 MB") });
    expect(kiemPhoi(new TextEncoder().encode("khong phai anh"))).toMatchObject({ ok: false });
    expect(kiemPhoi(png)).toMatchObject({ ok: true, anh: { width: 2100 } }); // đối chứng dương
  });
  it("khoá phôi mang mã băm nội dung: nội dung khác ⇒ khoá khác", () => {
    expect(khoaPhoi("c1", sha256Hex(taoPng(2100, 1485, 10)), "png")).not.toBe(khoaPhoi("c1", sha256Hex(taoPng(2100, 1485, 11)), "png"));
  });
});

describe("[CNM-03] bố cục", () => {
  it("mặc định hợp lệ", () => expect(boCucSchema.safeParse(boCucMacDinh()).success).toBe(true));
  it("vượt lề an toàn 5% và khung chồng nhau bị từ chối", () => {
    const b = boCucMacDinh();
    expect(boCucSchema.safeParse({ ...b, hoTen: { ...b.hoTen, x: 3 } }).success).toBe(false);
    expect(boCucSchema.safeParse({ ...b, tenKhoa: { ...b.tenKhoa, y: 52 } }).success).toBe(false); // chồng lên hoTen
    expect(boCucSchema.safeParse({ ...b, ketQua: { ...b.ketQua, color: "đỏ" } }).success).toBe(false);
    expect(boCucSchema.safeParse({ ...b, extra: 1 }).success).toBe(false);
  });
});

describe("[CNM-04] vừa khung: tự thu nhỏ chữ, báo khi không vừa", () => {
  it("tên ngắn giữ nguyên cỡ; tên dài thu nhỏ nhưng không dưới 60%", () => {
    const k = boCucMacDinh().hoTen;
    expect(chonCoChu("Lê An", k)).toMatchObject({ vua: true, heSo: 1 });
    const dai = chonCoChu("Nguyễn Thị Phương Quỳnh Anh Thư", k);
    expect(dai.heSo).toBeGreaterThanOrEqual(CO_CHU_NHO_NHAT);
    expect(dai.heSo).toBeLessThan(1);
  });
  it("khung quá hẹp ⇒ không vừa ⇒ bộ kiểm báo LỖI (và chặn duyệt); khung rộng ⇒ không lỗi", () => {
    const b = boCucMacDinh();
    const hep = { ...b, hoTen: { ...b.hoTen, x: 40, w: 6, h: 3 } };
    const loi = kiemTruocKhiDuyet({ fields: hep, anh: { widthPx: 3508, heightPx: 2480 } }).filter((c) => c.muc === "LOI");
    expect(loi.length).toBeGreaterThan(0);
    expect(loi[0]).toMatchObject({ truong: "hoTen" });
    expect(kiemTruocKhiDuyet({ fields: b, anh: { widthPx: 3508, heightPx: 2480 } }).filter((c) => c.muc === "LOI")).toEqual([]); // dương: mặc định đủ cho cả 3 mẫu thử
    expect(MAU_THU).toHaveLength(3);
    expect(kiemTruocKhiDuyet({ fields: b, anh: { widthPx: 2100, heightPx: 1485 } }).some((c) => c.muc === "CANH_BAO" && c.thongBao.includes("phân giải"))).toBe(true);
  });
});

describe("[CNM-05] dòng chữ + bản chụp", () => {
  it("dòng chữ đúng, mã và ngày giờ Việt Nam", () => {
    const t = dongChu(du);
    expect(t.hoTen).toBe("Trần Bảo Minh");
    expect(t.ketQua).toContain("92/100");
    expect(t.ngayMa).toContain("21/11/2026");
    expect(t.ngayMa).toContain("K7M2N9P4Q8");
    expect(dongChu({ ...du, finalScore: null }).ketQua).toBe("Hoàn thành khoá học");
  });
  it("bản chụp mang mã băm phôi + bố cục; cấp trước V10.0 ⇒ khuôn mặc định không phôi", () => {
    const mau = { id: "t1", backgroundKey: "k", backgroundSha256: sha256Hex(png), backgroundMime: "image/png", widthPx: 2100, heightPx: 1485, fieldsJson: boCucMacDinh() };
    expect(taoSnapshot({ mau, du })).toMatchObject({ templateId: "t1", background: { sha256: sha256Hex(png) } });
    expect(snapshotChoBanCu(du)).toMatchObject({ templateId: null, background: null });
    expect(() => taoSnapshot({ mau: { ...mau, fieldsJson: { hoTen: 1 } }, du })).toThrow();
  });
});

describe("[CNM-06] PDF: dựng từ bản chụp; phôi sai thì từ chối; cùng đầu vào ⇒ cùng byte", () => {
  const mau = { id: "t1", backgroundKey: "k", backgroundSha256: sha256Hex(png), backgroundMime: "image/png", widthPx: 2100, heightPx: 1485, fieldsJson: boCucMacDinh() };
  it("khuôn mặc định (không phôi) ra PDF hợp lệ, KHÔNG nhúng ảnh; có phôi thì nhúng ảnh nền", async () => {
    const a = await dungPdfChungNhan(snapshotChoBanCu(du), null, { ngayTao: NGAY });
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe("%PDF-");
    expect(chuanHoaDeSoSanh(a)).not.toContain("/Subtype /Image");
    const co = await dungPdfChungNhan(taoSnapshot({ mau, du }), png, { ngayTao: NGAY });
    expect(chuanHoaDeSoSanh(co)).toContain("/Subtype /Image");
  }, 60_000);
  it("có phôi: ra PDF; ĐỔI nội dung phôi (mã băm khác) ⇒ ném PhoiKhongKhop, không vẽ nhầm; thiếu phôi ⇒ cũng từ chối", async () => {
    const snap = taoSnapshot({ mau, du });
    const ok = await dungPdfChungNhan(snap, png, { ngayTao: NGAY });
    expect(Buffer.from(ok.slice(0, 5)).toString()).toBe("%PDF-");
    await expect(dungPdfChungNhan(snap, taoPng(2100, 1485, 50), { ngayTao: NGAY })).rejects.toBeInstanceOf(PhoiKhongKhop);
    await expect(dungPdfChungNhan(snap, null, { ngayTao: NGAY })).rejects.toBeInstanceOf(PhoiKhongKhop);
  }, 60_000);
  it("chữ khác ⇒ PDF khác; thu hồi ⇒ PDF khác (đóng dấu)", async () => {
    const a = await dungPdfChungNhan(snapshotChoBanCu(du), null, { ngayTao: NGAY });
    const khac = await dungPdfChungNhan(snapshotChoBanCu({ ...du, hoTen: "Nguyễn Văn A" }), null, { ngayTao: NGAY });
    const thuHoi = await dungPdfChungNhan(snapshotChoBanCu(du), null, { ngayTao: NGAY, daThuHoi: true });
    expect(chuanHoaDeSoSanh(a)).not.toBe(chuanHoaDeSoSanh(khac));
    expect(chuanHoaDeSoSanh(a)).not.toBe(chuanHoaDeSoSanh(thuHoi));
  }, 60_000);
});

describe("[CNM-W1] ranh giới: hệ chứng nhận Online KHÔNG import Nội bộ / Offline", () => {
  const doc = (f: string) => readFileSync(resolve(process.cwd(), "lib/elearning-online", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const TEP = ["cn-mau.ts", "cn-pdf.tsx", "cn-mau-db.ts", "cn-tai-san.ts", "ma-chung-nhan.ts"];
  it.each(TEP)("%s không import lib/pdf/*, lib/elearning/* (Nội bộ), chung-nhan-mau của Nội bộ", (f) => {
    const mn = doc(f);
    expect(mn).not.toMatch(/from\s+["']@\/lib\/pdf\//);
    expect(mn).not.toMatch(/from\s+["']@\/lib\/elearning\//);
    expect(mn).not.toMatch(/from\s+["'](\.\.\/)+(elearning|pdf)\//);
    expect(mn).not.toMatch(/TrnCertificate|trnCertificate/);
  });
  it("[đối chứng dương] bộ dựng PDF import bộ thuần của chính hệ Online", () => {
    expect(doc("cn-pdf.tsx")).toMatch(/from\s+["']\.\/cn-mau["']/);
  });
});
