/**
 * [CTT-PH-*] Phiếu «để lại thông tin» của Tủ sách + Sức khỏe.
 *   [CTT-PH-01] phiếu hợp lệ ⇒ SĐT chuẩn hoá 84…, tên/số nhà làm sạch, địa chỉ đúng danh mục
 *   [CTT-PH-02] phường/xã BẮT BUỘC và phải thuộc ĐÚNG thành phố; thiếu/sai ⇒ lỗi ở đúng trường
 *   [CTT-PH-03] thiếu đồng ý xử lý · SĐT/tên hỏng ⇒ từ chối, báo đủ mọi trường sai một lượt
 *   [CTT-PH-04] phiếu KHÔNG chở câu trả lời/kết quả sức khỏe: khoá lạ bị gỡ, không lọt ra đầu ra
 *   [CTT-PH-05] ô bẫy (honeypot) có chữ ⇒ laMay; ngữ cảnh chỉ nhận ký tự an toàn
 */
import { describe, expect, it } from "vitest";
import { kiemTraPhieu } from "./phieu";

const OK = {
  hoTen: "  Nguyễn  Thị Lan ",
  soDienThoai: "0905 123 456",
  thanhPho: "Tp Đà Nẵng",
  phuong: "Phường Hải Châu",
  soNha: " 12  Nguyễn Văn Linh ",
  dongY: { xuLyHoSo: true, tiepThi: false },
  nguon: "tu-sach",
  nguCanh: "ebook:12",
};

const loiTruong = (raw: unknown) => {
  const r = kiemTraPhieu(raw);
  return r.ok ? [] : r.loi.map((l) => l.truong);
};

describe("[CTT-PH-01] phiếu hợp lệ", () => {
  it("chuẩn hoá SĐT, làm sạch tên + số nhà, giữ nguồn và ngữ cảnh", () => {
    const r = kiemTraPhieu(OK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.phieu).toEqual({
      hoTen: "Nguyễn Thị Lan",
      soDienThoai: "84905123456",
      diaChi: { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: "12 Nguyễn Văn Linh", coSoGanNha: null },
      tiepThi: false,
      nguon: "tu-sach",
      nguCanh: "ebook:12",
    });
    expect(r.laMay).toBe(false);
  });
  it.each([["+84905123456"], ["84905123456"], ["0905.123.456"]])("SĐT %s ⇒ cùng một số chuẩn", (sdt) => {
    const r = kiemTraPhieu({ ...OK, soDienThoai: sdt });
    expect(r.ok && r.phieu.soDienThoai).toBe("84905123456");
  });
  it("số nhà trống ⇒ null; tiếp thị tích ⇒ true (chỉ là ý muốn của người gõ — adapter lead quyết cách dùng)", () => {
    const r = kiemTraPhieu({ ...OK, soNha: "  ", dongY: { xuLyHoSo: true, tiepThi: true }, nguCanh: null });
    expect(r.ok && [r.phieu.diaChi.soNha, r.phieu.tiepThi, r.phieu.nguCanh]).toEqual([null, true, null]);
  });
  it("nguồn suc-khoe được nhận", () => {
    expect(kiemTraPhieu({ ...OK, nguon: "suc-khoe", nguCanh: undefined }).ok).toBe(true);
  });
});

describe("[CTT-PH-02] phường/xã bắt buộc, đúng thành phố", () => {
  it.each([
    ["thiếu phường", { ...OK, phuong: "" }],
    ["phường chỉ khoảng trắng", { ...OK, phuong: "   " }],
    ["phường không có trong danh mục", { ...OK, phuong: "Phường Không Có" }],
  ])("%s ⇒ lỗi ở phuong", (_t, raw) => {
    expect(loiTruong(raw)).toContain("phuong");
  });
  it("phường của tỉnh KHÁC ⇒ từ chối (đối chứng: đúng tỉnh ⇒ qua)", () => {
    expect(loiTruong({ ...OK, thanhPho: "Hà Nội" })).toContain("phuong");
    expect(loiTruong(OK)).toEqual([]);
  });
  it("thành phố lạ ⇒ lỗi ở thanhPho", () => {
    expect(loiTruong({ ...OK, thanhPho: "Tp Không Có" })).toContain("thanhPho");
  });
  it("câu báo lỗi phường nói đúng lý do (kết nối cơ sở gần nhà)", () => {
    const r = kiemTraPhieu({ ...OK, phuong: "" });
    expect(!r.ok && r.loi.find((l) => l.truong === "phuong")?.thongBao).toMatch(/cơ sở gần nhà/);
  });
});

describe("[CTT-PH-03] từ chối và báo đủ", () => {
  it("không đồng ý xử lý ⇒ lỗi dongY", () => {
    expect(loiTruong({ ...OK, dongY: { xuLyHoSo: false, tiepThi: true } })).toEqual(["dongY"]);
  });
  it.each([["", "soDienThoai"], ["12345", "soDienThoai"], ["02363123456", "soDienThoai"], ["abcdef", "soDienThoai"]])("SĐT %j ⇒ lỗi", (sdt, truong) => {
    expect(loiTruong({ ...OK, soDienThoai: sdt })).toContain(truong);
  });
  it("tên quá ngắn ⇒ lỗi hoTen", () => {
    expect(loiTruong({ ...OK, hoTen: " a " })).toContain("hoTen");
  });
  it("nhiều lỗi một lượt: báo đủ để form tô đỏ cùng lúc", () => {
    expect(loiTruong({ ...OK, hoTen: "", soDienThoai: "1", phuong: "", dongY: { xuLyHoSo: false, tiepThi: false } }).sort()).toEqual(["dongY", "hoTen", "phuong", "soDienThoai"]);
  });
  it.each([[null], [undefined], ["x"], [5], [{}]])("đầu vào sai hình %j ⇒ lỗi, không ném", (raw) => {
    expect(kiemTraPhieu(raw).ok).toBe(false);
  });
});

describe("[CTT-PH-04] không chở dữ liệu sức khỏe", () => {
  it("khoá lạ (ketQua · traLoi · diem · thanhVien) bị gỡ khỏi đầu ra", () => {
    const r = kiemTraPhieu({ ...OK, ketQua: { bmi: 31 }, traLoi: { a: 1 }, diem: 9, thanhVien: [{ ten: "Bé An" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = JSON.stringify(r.phieu);
    expect(s).not.toMatch(/ketQua|traLoi|diem|thanhVien|Bé An|bmi/);
    expect(Object.keys(r.phieu).sort()).toEqual(["diaChi", "hoTen", "nguCanh", "nguon", "soDienThoai", "tiepThi"]);
  });
});

describe("[CTT-PH-05] ô bẫy và ngữ cảnh", () => {
  it("ô bẫy có chữ ⇒ laMay (route sẽ trả thành công giả); để trống/khoảng trắng ⇒ người thật", () => {
    expect(kiemTraPhieu({ ...OK, bay: "http://spam" })).toMatchObject({ ok: true, laMay: true });
    expect(kiemTraPhieu({ ...OK, bay: "   " })).toMatchObject({ ok: true, laMay: false });
    expect(kiemTraPhieu({ ...OK, bay: "" })).toMatchObject({ ok: true, laMay: false });
  });
  it.each([["ebook:12 \nDROP"], ["a b"], ["<script>"], ["x".repeat(41)]])("ngữ cảnh lạ %j ⇒ từ chối", (nc) => {
    expect(kiemTraPhieu({ ...OK, nguCanh: nc }).ok).toBe(false);
  });
});
