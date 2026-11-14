// Ca [DCT-*] — LUẬT THUẦN của chứng từ ngân hàng cần kế toán bổ sung (P7-E, 06/11/2026). Không DB, không R2, không đồng hồ.
// Mỗi ca đã được CẤY LẠI lỗi (luật 14) — xem commit message. Máy trạng thái là nơi DUY NHẤT quyết định "làm được gì": nút trên màn đọc từ đây.
import { describe, expect, it } from "vitest";
import {
  LOAI_TEP_CHUNG_TU,
  NHAN_TRANG_THAI_CHUNG_TU,
  TRANG_THAI_CHUNG_TU,
  TRAN_CO_TEP_CHUNG_TU,
  chuyenTrangThai,
  khoaChungTu,
  khoaThuocKhoan,
  laLoaiTepChungTu,
  loaiTepTuTen,
  lyDoKhongDanhDau,
  nutDuocPhep,
  tenTaiVeChungTu,
  tenTepChungTuSach,
  vanTayChungTu,
  type HanhDongChungTu,
  type KhoanDeDanhDau,
  type TrangThaiChungTu,
} from "./chung-tu-ngan-hang";
import { laKhoaChungTuNganHang, laKhoaTepHoaDon } from "./tep-mo-coi";

const HANH_DONG: HanhDongChungTu[] = ["TAI_LEN", "KIEM_TRA", "YEU_CAU_BO_SUNG_LAI", "HUY_DANH_DAU"];

describe("[DCT-01] máy trạng thái: bốn trạng thái, bốn hành động, mỗi ô một đáp án", () => {
  // Bảng đáp án viết TAY (không suy từ hàm) — cấy lỗi vào bất kỳ nhánh nào của máy là một ô lệch.
  const MONG_DOI: Record<TrangThaiChungTu, Record<HanhDongChungTu, TrangThaiChungTu | "HUY" | null>> = {
    CHO_BO_SUNG: { TAI_LEN: "DA_TAI_LEN", KIEM_TRA: null, YEU_CAU_BO_SUNG_LAI: null, HUY_DANH_DAU: "HUY" },
    DA_TAI_LEN: { TAI_LEN: "DA_TAI_LEN", KIEM_TRA: "DA_KIEM_TRA", YEU_CAU_BO_SUNG_LAI: "CAN_BO_SUNG_LAI", HUY_DANH_DAU: null },
    DA_KIEM_TRA: { TAI_LEN: null, KIEM_TRA: null, YEU_CAU_BO_SUNG_LAI: "CAN_BO_SUNG_LAI", HUY_DANH_DAU: null },
    CAN_BO_SUNG_LAI: { TAI_LEN: "DA_TAI_LEN", KIEM_TRA: null, YEU_CAU_BO_SUNG_LAI: null, HUY_DANH_DAU: null },
  };

  for (const tu of TRANG_THAI_CHUNG_TU) {
    for (const hd of HANH_DONG) {
      it(`${tu} + ${hd}`, () => {
        const kq = chuyenTrangThai(tu, hd);
        const mong = MONG_DOI[tu][hd];
        if (mong === null) {
          expect(kq.ok).toBe(false);
          if (!kq.ok) expect(kq.lyDo.length).toBeGreaterThan(5);
        } else {
          expect(kq).toEqual({ ok: true, den: mong });
        }
      });
    }
  }

  it("có đủ nhãn tiếng Việt cho cả bốn trạng thái (đúng bốn tên yêu cầu P7-E)", () => {
    expect(NHAN_TRANG_THAI_CHUNG_TU).toEqual({
      CHO_BO_SUNG: "Chờ bổ sung",
      DA_TAI_LEN: "Đã tải lên",
      DA_KIEM_TRA: "Đã kiểm tra",
      CAN_BO_SUNG_LAI: "Cần bổ sung lại",
    });
  });
});

describe("[DCT-02] nút nói thật: `nutDuocPhep` ≡ máy trạng thái (luật 12)", () => {
  it("mỗi nút = kết quả `chuyenTrangThai` của hành động tương ứng, ở cả bốn trạng thái", () => {
    for (const t of TRANG_THAI_CHUNG_TU) {
      const nut = nutDuocPhep(t, true);
      expect(nut.taiLen, t).toBe(chuyenTrangThai(t, "TAI_LEN").ok);
      expect(nut.kiemTra, t).toBe(chuyenTrangThai(t, "KIEM_TRA").ok);
      expect(nut.yeuCauBoSungLai, t).toBe(chuyenTrangThai(t, "YEU_CAU_BO_SUNG_LAI").ok);
      expect(nut.huyDanhDau, t).toBe(chuyenTrangThai(t, "HUY_DANH_DAU").ok);
    }
  });

  it("đối chứng DƯƠNG + ÂM cụ thể: chờ bổ sung chỉ tải lên / huỷ; đã tải lên kiểm được; đã kiểm tra KHÔNG thay tệp trực tiếp", () => {
    expect(nutDuocPhep("CHO_BO_SUNG", false)).toEqual({ taiLen: true, taiVe: false, kiemTra: false, yeuCauBoSungLai: false, huyDanhDau: true });
    expect(nutDuocPhep("DA_TAI_LEN", true)).toEqual({ taiLen: true, taiVe: true, kiemTra: true, yeuCauBoSungLai: true, huyDanhDau: false });
    expect(nutDuocPhep("DA_KIEM_TRA", true)).toEqual({ taiLen: false, taiVe: true, kiemTra: false, yeuCauBoSungLai: true, huyDanhDau: false });
    expect(nutDuocPhep("CAN_BO_SUNG_LAI", true)).toEqual({ taiLen: true, taiVe: true, kiemTra: false, yeuCauBoSungLai: false, huyDanhDau: false });
  });

  it("nút tải về chỉ theo việc có tệp hay chưa, không theo trạng thái", () => {
    for (const t of TRANG_THAI_CHUNG_TU) {
      expect(nutDuocPhep(t, true).taiVe).toBe(true);
      expect(nutDuocPhep(t, false).taiVe).toBe(false);
    }
  });
});

describe("[DCT-03] khoản nào được đánh dấu — KHÔNG hỏi nguồn lịch sử, KHÔNG hỏi PENDING", () => {
  const ok: KhoanDeDanhDau = { deletedAt: null, paymentType: "PAYMENT", accountantStatus: "PENDING", amount: 3_920_000, centerId: "cs1" };

  it("khoản PENDING (ca khoản nhập lịch sử đang chờ kế toán) ĐƯỢC đánh dấu", () => {
    expect(lyDoKhongDanhDau(ok)).toBeNull();
    // trạng thái khác (đã xác nhận…) cũng đánh dấu được — chỉ REJECTED bị chặn; viết qua tham số để lưới trục A không đọc là «điều kiện tự gõ»
    for (const trangThai of ["CONFIRMED", "REFUNDED"]) expect(lyDoKhongDanhDau({ ...ok, accountantStatus: trangThai }), trangThai).toBeNull();
  });

  it("từ chối: đã xoá · hoàn tiền/điều chỉnh · đã bị từ chối · số tiền không dương · chưa gán cơ sở", () => {
    expect(lyDoKhongDanhDau({ ...ok, deletedAt: new Date("2026-10-01T00:00:00Z") })).toMatch(/xoá/);
    expect(lyDoKhongDanhDau({ ...ok, paymentType: "ADJUSTMENT" })).toMatch(/hoàn tiền/);
    expect(lyDoKhongDanhDau({ ...ok, accountantStatus: "REJECTED" })).toMatch(/từ chối/);
    expect(lyDoKhongDanhDau({ ...ok, amount: 0 })).toMatch(/số tiền/);
    expect(lyDoKhongDanhDau({ ...ok, amount: -5 })).toMatch(/số tiền/);
    expect(lyDoKhongDanhDau({ ...ok, centerId: null })).toMatch(/cơ sở/);
  });
});

describe("[DCT-04] tệp: loại · vân tay BYTE · trần cỡ", () => {
  it("chỉ pdf / png / jpg; trần 10 MB", () => {
    expect([...LOAI_TEP_CHUNG_TU]).toEqual(["pdf", "png", "jpg"]);
    expect(TRAN_CO_TEP_CHUNG_TU).toBe(10 * 1024 * 1024);
    for (const x of ["pdf", "png", "jpg"]) expect(laLoaiTepChungTu(x)).toBe(true);
    for (const x of ["xml", "exe", "svg", "html", "", null, undefined, 1]) expect(laLoaiTepChungTu(x), String(x)).toBe(false);
  });

  it("loại tệp suy từ đuôi tên, không phân biệt hoa thường; jpeg = jpg; đuôi lạ = null", () => {
    expect(loaiTepTuTen("sao-ke.PDF")).toBe("pdf");
    expect(loaiTepTuTen("anh.Png")).toBe("png");
    expect(loaiTepTuTen("anh.jpeg")).toBe("jpg");
    expect(loaiTepTuTen("anh.JPG")).toBe("jpg");
    for (const x of ["script.exe", "trang.html", "ghi-chu.txt", "khong-duoi", "pdf"]) expect(loaiTepTuTen(x), x).toBeNull();
  });

  it("vân tay: tin BYTE, không tin đuôi — PDF `%PDF-`, PNG 8 byte, JPEG FF D8 FF; tệp đổi đuôi bị bắt", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ
    expect(vanTayChungTu("pdf", pdf)).toBe(true);
    expect(vanTayChungTu("png", png)).toBe(true);
    expect(vanTayChungTu("jpg", jpg)).toBe(true);
    // chéo: mỗi vân tay chỉ đúng với loại của nó
    expect(vanTayChungTu("pdf", png)).toBe(false);
    expect(vanTayChungTu("png", jpg)).toBe(false);
    expect(vanTayChungTu("jpg", pdf)).toBe(false);
    for (const l of LOAI_TEP_CHUNG_TU) expect(vanTayChungTu(l, exe), l).toBe(false);
    expect(vanTayChungTu("pdf", new Uint8Array())).toBe(false);
    // PNG thiếu một byte của chữ ký 8 byte
    expect(vanTayChungTu("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]))).toBe(false);
  });
});

describe("[DCT-05] khoá tệp: sinh đúng hình dạng, không thoát thư mục, gắn đúng khoản + cơ sở", () => {
  const dau = { centerCode: "CS1", paymentId: "cmpay0000000001", loai: "pdf" as const, nam: 2026, uuid: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" };

  it("khoá sinh ra đạt `laKhoaChungTuNganHang`, KHÔNG đạt `laKhoaTepHoaDon` (hai luồng không lẫn)", () => {
    const k = khoaChungTu(dau);
    expect(k).toBe("chung-tu-ngan-hang/CS1/2026/cmpay0000000001/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf");
    expect(laKhoaChungTuNganHang(k)).toBe(true);
    expect(laKhoaTepHoaDon(k)).toBe(false);
    for (const loai of LOAI_TEP_CHUNG_TU) expect(laKhoaChungTuNganHang(khoaChungTu({ ...dau, loai })), loai).toBe(true);
  });

  it("NÉM khi thành phần không an toàn / năm sai / loại lạ", () => {
    expect(() => khoaChungTu({ ...dau, centerCode: "CS1/../x" })).toThrow();
    expect(() => khoaChungTu({ ...dau, paymentId: "a/b" })).toThrow();
    expect(() => khoaChungTu({ ...dau, uuid: "..%2f" })).toThrow();
    expect(() => khoaChungTu({ ...dau, nam: 1999 })).toThrow();
    expect(() => khoaChungTu({ ...dau, loai: "xml" as never })).toThrow();
  });

  it("`khoaThuocKhoan`: khoá đến từ trình duyệt phải nằm dưới ĐÚNG khoản + cơ sở", () => {
    const k = khoaChungTu(dau);
    expect(khoaThuocKhoan(k, "CS1", "cmpay0000000001")).toBe(true);
    expect(khoaThuocKhoan(k, "CS2", "cmpay0000000001")).toBe(false); // cơ sở khác
    expect(khoaThuocKhoan(k, "CS1", "cmpay0000000002")).toBe(false); // khoản khác
    expect(khoaThuocKhoan(k.replace("chung-tu-ngan-hang/", "hoa-don/"), "CS1", "cmpay0000000001")).toBe(false); // luồng hoá đơn
    expect(khoaThuocKhoan("chung-tu-ngan-hang/CS1/2026/cmpay0000000001/../x.pdf", "CS1", "cmpay0000000001")).toBe(false);
    expect(khoaThuocKhoan(k.replace(/\.pdf$/, ".xml"), "CS1", "cmpay0000000001")).toBe(false); // đuôi lạ
  });

  it("hình dạng khoá lạ bị `laKhoaChungTuNganHang` từ chối (cron mồ côi không động tới thứ không phải của ta)", () => {
    for (const la of [
      "chung-tu-ngan-hang/CS1/2026/x/y.xml",
      "chung-tu-ngan-hang/CS1/26/x/y.pdf",
      "chung-tu-ngan-hang-cu/CS1/2026/x/y.pdf",
      "chung-tu-ngan-hang/CS1/2026/x/../y.pdf",
      "chung-tu-ngan-hang/ghi-chu.txt",
      "",
    ]) {
      expect(laKhoaChungTuNganHang(la), la).toBe(false);
    }
  });
});

describe("[DCT-06] tên tệp: sạch, không mang PII khi tải về", () => {
  it("tên hiển thị bỏ đường dẫn + ký tự điều khiển, cắt 120, giữ đuôi đúng loại; sai đuôi ⇒ tên mặc định", () => {
    expect(tenTepChungTuSach("C:\\Users\\kt\\sao-ke.pdf", "pdf")).toBe("sao-ke.pdf");
    expect(tenTepChungTuSach("a/b/c.PNG", "png")).toBe("c.PNG");
    expect(tenTepChungTuSach("x\u0000y\u001f.pdf", "pdf")).toBe("xy.pdf");
    expect(tenTepChungTuSach(`${"a".repeat(300)}.pdf`, "pdf")).toBe("chung-tu-ngan-hang.pdf"); // cắt 120 làm mất đuôi ⇒ mặc định
    expect(tenTepChungTuSach("sao-ke.pdf", "png")).toBe("chung-tu-ngan-hang.png");
    expect(tenTepChungTuSach("", "jpg")).toBe("chung-tu-ngan-hang.jpg");
  });

  it("tên TẢI VỀ chỉ gồm 8 ký tự cuối id khoản + đuôi — không tên học viên, không mã đơn", () => {
    expect(tenTaiVeChungTu("cmpay0000000001abcdef12", "pdf")).toBe("chung-tu-ngan-hang-abcdef12.pdf");
    expect(tenTaiVeChungTu("cmpay0000000001abcdef12", "jpg")).toBe("chung-tu-ngan-hang-abcdef12.jpg");
  });
});
