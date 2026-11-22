// Ca [BMC-*] — KIỂM BIỂU MẪU công khai "thông tin người mua hoá đơn" (S11, phía phụ huynh). Thuần: không DB, không đồng hồ.
// Mọi ca "KHÔNG được" kèm đối chứng dương (cùng đầu vào, chỉ đổi đúng một thứ ⇒ hợp lệ).
//
// [02/11/2026 — chủ dự án] Luật mới: CÁ NHÂN bắt buộc họ tên ba/mẹ · CCCD ba/mẹ · địa chỉ (tuỳ chọn: email, SĐT, khối học viên);
// DOANH NGHIỆP bắt buộc tên · MST · email · địa chỉ. Ô của cá nhân bị BỎ khi chọn doanh nghiệp.
import { describe, expect, it } from "vitest";
import { O_NGUOI_MUA, O_NHAY_CAM } from "./yeu-cau-nguoi-mua";
import { THONG_DIEP_BIEU_MAU, docBieuMauTho, kiemBieuMau } from "./yeu-cau-nguoi-mua-bieu-mau";

const TRONG = { email: "", maSoThue: "", cccd: "", sdt: "", tenHocVien: "", ngaySinhHocVien: "", cccdHocVien: "" };
const CA_NHAN = { ...TRONG, loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "048123456789", dongY: true };
const DOANH_NGHIEP = { ...TRONG, loai: "DOANH_NGHIEP", ten: "Công ty TNHH Sata", diaChi: "211 Nguyễn Hữu Thọ, Đà Nẵng", email: "ke.toan@example.com", maSoThue: "0401234567", dongY: true };

describe("[BMC-01] cá nhân / doanh nghiệp hợp lệ ⇒ ô đã chuẩn hoá, đúng tập ô", () => {
  it("cá nhân tối thiểu: loai · ten · diaChi · cccd; doanh nghiệp: loai · ten · diaChi · email · maSoThue", () => {
    expect(kiemBieuMau(CA_NHAN)).toEqual({ ok: true, du: { loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "048123456789" }, hocVienThem: [] });
    expect(kiemBieuMau(DOANH_NGHIEP)).toEqual({
      ok: true,
      du: { loai: "DOANH_NGHIEP", ten: "Công ty TNHH Sata", diaChi: "211 Nguyễn Hữu Thọ, Đà Nẵng", email: "ke.toan@example.com", maSoThue: "0401234567" },
      hocVienThem: [],
    });
  });
  it("cá nhân ĐỦ ô tuỳ chọn: SĐT + email + khối học viên đều vào `du`, đã chuẩn hoá", () => {
    const r = kiemBieuMau({ ...CA_NHAN, email: "A@B.vn", sdt: "0905 123 456", tenHocVien: "  Nguyễn  Văn Bé ", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048 987 654 321" });
    expect(r).toEqual({
      ok: true,
      du: {
        loai: "CA_NHAN",
        ten: "Nguyễn Thị Phụ Huynh",
        diaChi: "114 Hoàng Diệu, Đà Nẵng",
        cccd: "048123456789",
        email: "a@b.vn",
        sdt: "0905123456",
        tenHocVien: "Nguyễn Văn Bé",
        ngaySinhHocVien: "2016-08-03",
        cccdHocVien: "048987654321",
      },
      hocVienThem: [],
    });
  });
  it("chuẩn hoá: gộp khoảng trắng, email chữ thường, MST bỏ khoảng trắng + gạch nối", () => {
    const r = kiemBieuMau({ ...DOANH_NGHIEP, ten: "  Công   ty  TNHH Sata ", email: "KE.Toan@Example.COM", maSoThue: "0401-234 567" });
    expect(r).toMatchObject({ ok: true, du: { ten: "Công ty TNHH Sata", email: "ke.toan@example.com", maSoThue: "0401234567" } });
  });
});

describe("[BMC-02] MST: bắt buộc khi doanh nghiệp, BỊ BỎ khi cá nhân", () => {
  it("doanh nghiệp thiếu MST ⇒ lỗi theo ô maSoThue; đối chứng: có MST ⇒ hợp lệ", () => {
    const r = kiemBieuMau({ ...DOANH_NGHIEP, maSoThue: "" });
    expect(r).toMatchObject({ ok: false, loi: { theoO: { maSoThue: THONG_DIEP_BIEU_MAU.THIEU_MST } } });
    expect(kiemBieuMau(DOANH_NGHIEP).ok).toBe(true);
  });
  it("doanh nghiệp MST sai định dạng ⇒ lỗi định dạng (không phải lỗi thiếu)", () => {
    const r = kiemBieuMau({ ...DOANH_NGHIEP, maSoThue: "12345" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi.theoO.maSoThue).toMatch(/10 hoặc 13/);
  });
  it("cá nhân mà lỡ có MST ⇒ vẫn hợp lệ nhưng `du` KHÔNG mang maSoThue; đối chứng: đổi sang doanh nghiệp ⇒ MST được mang theo", () => {
    const ca = kiemBieuMau({ ...CA_NHAN, maSoThue: "0401234567" });
    expect(ca.ok && "maSoThue" in ca.du).toBe(false);
    const dn = kiemBieuMau({ ...DOANH_NGHIEP, maSoThue: "0401234567" });
    expect(dn.ok && dn.du.maSoThue).toBe("0401234567");
  });
  it("cá nhân mà MST rác (không phải số) ⇒ KHÔNG chặn (ô không có nghĩa với cá nhân)", () => {
    expect(kiemBieuMau({ ...CA_NHAN, maSoThue: "abc" }).ok).toBe(true);
  });
});

describe("[BMC-03] ô bắt buộc + lời thường ngày, nhãn tên theo loại", () => {
  it("thiếu tên ⇒ lời khác nhau giữa cá nhân (ba/mẹ) và doanh nghiệp; thiếu địa chỉ ⇒ lời riêng", () => {
    const a = kiemBieuMau({ ...CA_NHAN, ten: "", diaChi: "" });
    expect(a).toMatchObject({ ok: false, loi: { theoO: { ten: THONG_DIEP_BIEU_MAU.THIEU_TEN_CA_NHAN, diaChi: THONG_DIEP_BIEU_MAU.THIEU_DIA_CHI } } });
    expect(THONG_DIEP_BIEU_MAU.THIEU_TEN_CA_NHAN).toMatch(/ba\/mẹ/);
    const b = kiemBieuMau({ ...DOANH_NGHIEP, ten: "" });
    expect(b).toMatchObject({ ok: false, loi: { theoO: { ten: THONG_DIEP_BIEU_MAU.THIEU_TEN_DOANH_NGHIEP } } });
  });
  it("chưa chọn loại / loại lạ ⇒ lỗi ô loai; đối chứng: loại đúng ⇒ không lỗi ô loai", () => {
    for (const loai of ["", "CONG_TY", "ca_nhan"]) expect(kiemBieuMau({ ...CA_NHAN, loai })).toMatchObject({ ok: false, loi: { theoO: { loai: THONG_DIEP_BIEU_MAU.CHUA_CHON_LOAI } } });
    expect(kiemBieuMau(CA_NHAN).ok).toBe(true);
  });
  it("tên 1 ký tự / ký tự điều khiển ⇒ lỗi theo ô tên (luật `kiemODon` được tái dùng, không chép)", () => {
    expect(kiemBieuMau({ ...CA_NHAN, ten: "A" }).ok).toBe(false);
    expect(kiemBieuMau({ ...CA_NHAN, ten: "Nguyễn\u0007Văn" }).ok).toBe(false);
  });
});

describe("[BMC-03b] CCCD ba/mẹ BẮT BUỘC với cá nhân (luật mới 02/11/2026) — đối chứng âm từng ô", () => {
  it("cá nhân thiếu CCCD ⇒ lỗi ô cccd bằng lời thường ngày; có CCCD ⇒ hợp lệ", () => {
    expect(kiemBieuMau({ ...CA_NHAN, cccd: "" })).toMatchObject({ ok: false, loi: { theoO: { cccd: THONG_DIEP_BIEU_MAU.THIEU_CCCD } } });
    expect(kiemBieuMau({ ...CA_NHAN, cccd: "   " })).toMatchObject({ ok: false, loi: { theoO: { cccd: THONG_DIEP_BIEU_MAU.THIEU_CCCD } } });
    expect(kiemBieuMau(CA_NHAN).ok).toBe(true);
  });
  it("CCCD sai định dạng ⇒ lỗi định dạng (không phải lỗi thiếu); 12 hoặc 9 chữ số đúng", () => {
    for (const x of ["12345", "04812345678", "0481234567890", "04812345678A"]) {
      const r = kiemBieuMau({ ...CA_NHAN, cccd: x });
      expect(r.ok, x).toBe(false);
      expect(!r.ok && r.loi.theoO.cccd, x).toMatch(/CCCD/);
      expect(!r.ok && r.loi.theoO.cccd, x).not.toBe(THONG_DIEP_BIEU_MAU.THIEU_CCCD);
    }
    expect(kiemBieuMau({ ...CA_NHAN, cccd: "123456789" }).ok).toBe(true);
  });
  it("doanh nghiệp KHÔNG bị đòi CCCD; nếu gửi CCCD / SĐT / học viên thì BỊ BỎ khỏi `du` (không lưu thứ vô nghĩa với doanh nghiệp)", () => {
    expect(kiemBieuMau({ ...DOANH_NGHIEP, cccd: "" }).ok).toBe(true);
    const r = kiemBieuMau({ ...DOANH_NGHIEP, cccd: "048123456789", sdt: "0905123456", tenHocVien: "Bé", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" });
    expect(r.ok).toBe(true);
    if (r.ok) for (const o of ["cccd", "sdt", "tenHocVien", "ngaySinhHocVien", "cccdHocVien"]) expect(o in r.du, o).toBe(false);
  });
});

describe("[BMC-03c] doanh nghiệp: EMAIL BẮT BUỘC; cá nhân: email tuỳ chọn", () => {
  it("doanh nghiệp thiếu email ⇒ lỗi ô email bằng lời riêng; email sai ⇒ lỗi định dạng; email đúng ⇒ hợp lệ", () => {
    expect(kiemBieuMau({ ...DOANH_NGHIEP, email: "" })).toMatchObject({ ok: false, loi: { theoO: { email: THONG_DIEP_BIEU_MAU.THIEU_EMAIL_DOANH_NGHIEP } } });
    const sai = kiemBieuMau({ ...DOANH_NGHIEP, email: "khong-phai-email" });
    expect(sai.ok).toBe(false);
    expect(!sai.ok && sai.loi.theoO.email).not.toBe(THONG_DIEP_BIEU_MAU.THIEU_EMAIL_DOANH_NGHIEP);
    expect(kiemBieuMau(DOANH_NGHIEP).ok).toBe(true);
  });
  it("cá nhân: email trống ⇒ bỏ qua; email sai ⇒ lỗi ô email; đối chứng: email đúng ⇒ vào `du`", () => {
    expect(kiemBieuMau({ ...CA_NHAN, email: "   " }).ok).toBe(true);
    expect(kiemBieuMau({ ...CA_NHAN, email: "khong-phai-email" })).toMatchObject({ ok: false, loi: { theoO: { email: expect.any(String) } } });
    const ok = kiemBieuMau({ ...CA_NHAN, email: "a@b.vn" });
    expect(ok.ok && ok.du.email).toBe("a@b.vn");
  });
});

describe("[BMC-03d] ô tuỳ chọn của cá nhân (SĐT, khối học viên): trống ⇒ bỏ qua; CÓ thì phải đúng định dạng", () => {
  it("SĐT sai ⇒ lỗi ô sdt; ngày sinh không có thật / sai dạng ⇒ lỗi; CCCD học viên sai ⇒ lỗi; đối chứng: để trống ⇒ hợp lệ", () => {
    expect(kiemBieuMau({ ...CA_NHAN, sdt: "12345" })).toMatchObject({ ok: false, loi: { theoO: { sdt: expect.any(String) } } });
    expect(kiemBieuMau({ ...CA_NHAN, ngaySinhHocVien: "2016-02-30" })).toMatchObject({ ok: false, loi: { theoO: { ngaySinhHocVien: expect.any(String) } } });
    expect(kiemBieuMau({ ...CA_NHAN, ngaySinhHocVien: "03/08/2016" })).toMatchObject({ ok: false, loi: { theoO: { ngaySinhHocVien: expect.any(String) } } });
    expect(kiemBieuMau({ ...CA_NHAN, cccdHocVien: "abc" })).toMatchObject({ ok: false, loi: { theoO: { cccdHocVien: expect.any(String) } } });
    expect(kiemBieuMau({ ...CA_NHAN, sdt: "", tenHocVien: "", ngaySinhHocVien: "", cccdHocVien: "" }).ok).toBe(true);
  });
});

describe("[BMC-04] đồng ý là BẮT BUỘC", () => {
  it("không tick ⇒ lỗi `dongY` kể cả khi mọi ô đúng; đối chứng: tick ⇒ hợp lệ", () => {
    const r = kiemBieuMau({ ...CA_NHAN, dongY: false });
    expect(r).toMatchObject({ ok: false, loi: { theoO: {}, dongY: THONG_DIEP_BIEU_MAU.CHUA_DONG_Y } });
    expect(kiemBieuMau({ ...CA_NHAN, dongY: true }).ok).toBe(true);
  });
  it("chỉ `true` thật mới là đồng ý: chuỗi 'true', 1, 'on' đều KHÔNG", () => {
    for (const dongY of ["true", 1, "on", {}, null, undefined]) expect(kiemBieuMau({ ...CA_NHAN, dongY }).ok).toBe(false);
  });
});

describe("[BMC-05] đầu vào KHÔNG TIN CẬY: kiểu sai, ô lạ, gói to", () => {
  it("không phải object / null / mảng ⇒ coi như rỗng, không ném", () => {
    for (const v of [null, undefined, "chuỗi", 42, []]) expect(kiemBieuMau(v).ok).toBe(false);
  });
  it("ô lạ (soCanCuoc, hộ chiếu, idParent…) KHÔNG bao giờ xuất hiện trong `du`; đối chứng: các ô khai vẫn qua", () => {
    const r = kiemBieuMau({ ...CA_NHAN, soCanCuoc: "x", hoChieu: "B1234567", centerId: "cs-khac", orderId: "don-khac" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.du).sort()).toEqual(["cccd", "diaChi", "loai", "ten"]);
  });
  it("mọi khoá của `du` luôn nằm trong `O_NGUOI_MUA` (không có đường nào đẻ ô mới)", () => {
    for (const f of [DOANH_NGHIEP, { ...CA_NHAN, sdt: "0905123456", tenHocVien: "Bé", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321", email: "a@b.vn" }]) {
      const r = kiemBieuMau(f);
      expect(r.ok && Object.keys(r.du).every((k) => (O_NGUOI_MUA as readonly string[]).includes(k))).toBe(true);
    }
  });
  it("ô quá dài bị cắt ở trần thô rồi vẫn bị luật độ dài của ô từ chối (không tràn)", () => {
    const r = kiemBieuMau({ ...CA_NHAN, ten: "A".repeat(100_000) });
    expect(r.ok).toBe(false);
    expect(docBieuMauTho({ ten: "A".repeat(100_000) }).ten.length).toBe(500);
  });
  it("[BMC-06] bốn ô nhạy cảm đều là ô CỦA CÁ NHÂN: gửi qua biểu mẫu doanh nghiệp không để lại dấu vết nào (đối chứng cho việc che ở màn nhân viên)", () => {
    const r = kiemBieuMau({ ...DOANH_NGHIEP, cccd: "048123456789", sdt: "0905123456", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" });
    expect(r.ok && O_NHAY_CAM.some((o) => o in r.du)).toBe(false);
  });
});

describe("[BMC-HVT] các EM CÒN LẠI của đơn nhiều con (09/11/2026)", () => {
  const em = (ten: string, ngaySinh = "", cccd = "") => ({ ten, ngaySinh, cccd });
  it("cá nhân có em thêm ⇒ `hocVienThem` đã chuẩn hoá đi cùng `du`; ba ô học viên cũ (em thứ nhất) KHÔNG đổi", () => {
    const r = kiemBieuMau({ ...CA_NHAN, tenHocVien: "Bé Một", hocVienThem: [em("  Bé  Hai ", "2018-01-02", "048 222 222 222"), em("")] });
    expect(r).toEqual({
      ok: true,
      du: { loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "048123456789", tenHocVien: "Bé Một" },
      hocVienThem: [{ ten: "Bé Hai", ngaySinh: "2018-01-02", cccd: "048222222222" }],
    });
  });
  it("em thêm sai ⇒ lỗi THEO CHỈ SỐ khối trên màn (không lẫn với lỗi ô khác), kể cả khi có dòng trống ở trước", () => {
    const r = kiemBieuMau({ ...CA_NHAN, hocVienThem: [em(""), em("", "2018-01-02"), em("Bé Ba", "02/01/2018", "123")] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.loi.hocVienThem?.[1]).toEqual({ ten: "Nhập họ và tên học viên" });
      expect(r.loi.hocVienThem?.[2]?.ngaySinh).toMatch(/năm-tháng-ngày/);
      expect(r.loi.hocVienThem?.[2]?.cccd).toMatch(/12 chữ số/);
      expect(r.loi.hocVienThem?.[0]).toBeUndefined();
      expect(r.loi.theoO).toEqual({});
    }
  });
  it("quá số em cho phép ⇒ lỗi chung, KHÔNG cắt lặng lẽ", () => {
    const sau = Array.from({ length: 6 }, (_, i) => em(`Bé số ${i}`));
    const r = kiemBieuMau({ ...CA_NHAN, hocVienThem: sau });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi.hocVienThemChung).toMatch(/tối đa 6 học viên/);
    expect(kiemBieuMau({ ...CA_NHAN, hocVienThem: sau.slice(0, 5) }).ok).toBe(true); // đối chứng: đúng trần thì qua
  });
  it("DOANH NGHIỆP: em thêm BỊ BỎ (không gửi, không lưu, kể cả khi sai định dạng); đối chứng: cùng danh sách ở cá nhân thì được giữ", () => {
    const ds = [em("Bé Hai", "2018-01-02")];
    expect(kiemBieuMau({ ...DOANH_NGHIEP, hocVienThem: ds })).toMatchObject({ ok: true, hocVienThem: [] });
    expect(kiemBieuMau({ ...DOANH_NGHIEP, hocVienThem: [em("", "rác")] })).toMatchObject({ ok: true, hocVienThem: [] });
    expect(kiemBieuMau({ ...CA_NHAN, hocVienThem: ds })).toMatchObject({ ok: true, hocVienThem: [{ ten: "Bé Hai" }] });
  });
  it("đầu vào không tin cậy: `hocVienThem` không phải mảng / phần tử lạ ⇒ rỗng, không ném", () => {
    expect(docBieuMauTho({ ...CA_NHAN, hocVienThem: "rác" }).hocVienThem).toEqual([]);
    expect(docBieuMauTho({ ...CA_NHAN, hocVienThem: [1, null, { ten: 7 }] }).hocVienThem).toEqual([{ ten: "", ngaySinh: "", cccd: "" }]);
    expect(docBieuMauTho(null).hocVienThem).toEqual([]);
  });
});
