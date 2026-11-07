import { describe, expect, it } from "vitest";
import {
  demNgayLich,
  gomHocPhan,
  nhanConNgay,
  nhanHocPhan,
  nhanHomNay,
  soSanhNangLuc,
  tomTatDiHoc,
  tomTatHocPhi,
  trangThaiKhoanHocPhi,
  type BuoiChoHanhTrinh,
} from "@/lib/portal/tong-quan-thuan";

// Mốc cố định (luật 19: test không đọc đồng hồ thật). 01/11/2026 là Chủ nhật.
const NOW = new Date("2026-11-01T03:00:00.000Z"); // 10:00 giờ VN

describe("[TQ-01] nhãn ngày theo lịch VN", () => {
  it("nhanHomNay in thứ + ngày VN", () => {
    expect(nhanHomNay(NOW)).toBe("CHỦ NHẬT, 01/11/2026");
  });
  it("23:30 UTC vẫn là ngày hôm sau ở VN", () => {
    expect(nhanHomNay(new Date("2026-10-31T23:30:00.000Z"))).toBe("CHỦ NHẬT, 01/11/2026");
  });
  it("demNgayLich đếm ngày LỊCH, không đếm 24 giờ", () => {
    expect(demNgayLich("2026-11-07T13:00:00.000Z", NOW)).toBe(6);
    expect(demNgayLich("2026-11-01T14:00:00.000Z", NOW)).toBe(0);
    expect(demNgayLich("2026-11-02T00:30:00.000Z", NOW)).toBe(1);
  });
  it("nhanConNgay", () => {
    expect(nhanConNgay(0)).toBe("HÔM NAY");
    expect(nhanConNgay(1)).toBe("NGÀY MAI");
    expect(nhanConNgay(6)).toBe("CÒN 6 NGÀY");
  });
  it("nhanHocPhan giữ nguyên mã lạ", () => {
    expect(nhanHocPhan("HP2")).toBe("Học phần 2");
    expect(nhanHocPhan("MODUN-A")).toBe("MODUN-A");
    expect(nhanHocPhan(null)).toBeNull();
  });
});

describe("[TQ-02] tomTatDiHoc — chưa chấm không phải vắng", () => {
  it("mẫu số trừ buổi chưa chấm", () => {
    const r = tomTatDiHoc({ daHoc: 8, coMat: 6, vang: 1, chuaCham: 1, canBu: 0 });
    expect(r.tieuDe).toBe("Có mặt 6/7 buổi");
    expect(r.phu).toContain("Vắng 1 buổi");
    expect(r.phu).toContain("1 buổi chưa chấm");
  });
  it("đã học 12 buổi mà chưa buổi nào được chấm ⇒ không báo 0% / 'chưa có buổi'", () => {
    const r = tomTatDiHoc({ daHoc: 12, coMat: 0, vang: 0, chuaCham: 12, canBu: 0 });
    expect(r.tieuDe).toBe("Chưa chấm điểm danh");
    expect(r.phu).toContain("12 buổi");
  });
  it("chưa học buổi nào", () => {
    expect(tomTatDiHoc({ daHoc: 0, coMat: 0, vang: 0, chuaCham: 0, canBu: 0 }).tieuDe).toBe("Chưa có buổi nào");
  });
  it("cần bù được nói ra", () => {
    expect(tomTatDiHoc({ daHoc: 7, coMat: 6, vang: 1, chuaCham: 0, canBu: 1 }).phu).toContain("chờ chọn giờ bù");
  });
});

describe("[TQ-03] tomTatHocPhi — chỉ HAI trạng thái «Đã nộp» / «Chưa nộp»; giá chưa chốt KHÔNG phải «đã nộp»", () => {
  const base = { nextDueDate: null, tamHoanThu: null };
  it("không ghi danh nào ⇒ không phải trạng thái nộp (không vẽ chip)", () => {
    const r = tomTatHocPhi({ ...base, rows: [], outstanding: 0 });
    expect(r.trangThai).toBe("CHUA_CO");
    expect(r.tieuDe).not.toMatch(/nộp/);
  });
  it("mọi ghi danh chưa chốt giá ⇒ «Chưa nộp» (lỗi 1 của bản ánh xạ), KHÔNG «Đã nộp»", () => {
    const r = tomTatHocPhi({ ...base, rows: [{ chuaChotGia: true }], outstanding: 0 });
    expect(r.trangThai).toBe("CHUA_NOP");
    expect(r.tieuDe).toBe("Chưa nộp");
    expect(r.phu).toContain("chưa chốt học phí");
  });
  it("còn nợ ⇒ «Chưa nộp», số còn nợ nằm ở dòng phụ", () => {
    const r = tomTatHocPhi({ ...base, rows: [{ chuaChotGia: false }], outstanding: 5_040_000 });
    expect(r.trangThai).toBe("CHUA_NOP");
    expect(r.tieuDe).toBe("Chưa nộp");
    expect(r.phu).toContain("5.040.000");
  });
  it("[HP-01] còn nợ nhưng đã đóng một phần ⇒ VẪN «Chưa nộp» (không có nhãn «đóng một phần»); dòng phụ nói số đã đóng", () => {
    const r = tomTatHocPhi({ ...base, rows: [{ chuaChotGia: false }], outstanding: 2_520_000, paid: 2_520_000 });
    expect(r.trangThai).toBe("CHUA_NOP");
    expect(r.tieuDe).toBe("Chưa nộp");
    expect(r.phu).toBe("Còn 2.520.000đ · Đã đóng 2.520.000đ");
    expect(tomTatHocPhi({ ...base, rows: [{ chuaChotGia: false }], outstanding: 2_520_000, paid: 0 }).phu).toBe("Còn 2.520.000đ");
  });
  it("hết nợ và có giá ⇒ «Đã nộp»", () => {
    const r = tomTatHocPhi({ ...base, rows: [{ chuaChotGia: false }], outstanding: 0 });
    expect(r.trangThai).toBe("DA_NOP");
    expect(r.tieuDe).toBe("Đã nộp");
  });
  it("[HP-02] quá hạn KHÔNG có nhãn riêng: còn nợ + hạn đã qua vẫn chỉ «Chưa nộp»", () => {
    const r = tomTatHocPhi({ nextDueDate: "2020-01-01T00:00:00.000Z", tamHoanThu: null, rows: [{ chuaChotGia: false }], outstanding: 1_000_000 });
    expect(r.tieuDe).toBe("Chưa nộp");
    expect(`${r.tieuDe}`).not.toMatch(/[Qq]uá hạn/);
    expect(r.phu).toContain("Hạn gần nhất 01/01/2020");
  });
  it("[HP-03] bảo lưu KHÔNG còn là trạng thái: còn nợ ⇒ «Chưa nộp» + dòng phụ nói tạm hoãn; hết nợ ⇒ «Đã nộp»", () => {
    const co = tomTatHocPhi({
      nextDueDate: null,
      rows: [{ chuaChotGia: false }],
      outstanding: 1_000_000,
      tamHoanThu: { denNgay: "2026-12-31T00:00:00.000Z" },
    });
    expect(co.trangThai).toBe("CHUA_NOP");
    expect(co.tieuDe).toBe("Chưa nộp");
    expect(co.tieuDe).not.toMatch(/hoãn/i);
    expect(co.phu).toContain("Tạm hoãn thu do bảo lưu đến 31/12/2026");
    expect(co.phu).toContain("1.000.000");
    const het = tomTatHocPhi({ nextDueDate: null, rows: [{ chuaChotGia: false }], outstanding: 0, tamHoanThu: { denNgay: null } });
    expect(het.trangThai).toBe("DA_NOP");
    expect(het.phu).toBe("Tạm hoãn thu do bảo lưu");
  });
  it("[HP-04] mọi tổ hợp đầu vào chỉ cho ra ba tiêu đề được phép", () => {
    const duoc = new Set(["Đã nộp", "Chưa nộp", "Chưa có khoản học phí"]);
    for (const rows of [[], [{ chuaChotGia: true }], [{ chuaChotGia: false }], [{ chuaChotGia: true }, { chuaChotGia: false }]])
      for (const outstanding of [0, 1_000_000])
        for (const tamHoanThu of [null, { denNgay: null }, { denNgay: "2027-01-01T00:00:00.000Z" }])
          for (const paid of [0, 500_000])
            expect(duoc.has(tomTatHocPhi({ rows, outstanding, nextDueDate: "2026-01-01T00:00:00.000Z", tamHoanThu, paid }).tieuDe)).toBe(true);
  });
});

describe("[HP-05] trangThaiKhoanHocPhi — một khoản chỉ có «Đã nộp» / «Chưa nộp»", () => {
  it("giá chưa chốt ⇒ Chưa nộp", () => {
    expect(trangThaiKhoanHocPhi({ chuaChotGia: true, outstanding: 0 })).toEqual({ nhan: "Chưa nộp", phu: "Chưa chốt học phí" });
  });
  it("còn nợ ⇒ Chưa nộp + số còn", () => {
    expect(trangThaiKhoanHocPhi({ chuaChotGia: false, outstanding: 2_520_000 })).toEqual({ nhan: "Chưa nộp", phu: "Còn 2.520.000đ" });
  });
  it("hết nợ ⇒ Đã nộp, không dòng phụ", () => {
    expect(trangThaiKhoanHocPhi({ chuaChotGia: false, outstanding: 0 })).toEqual({ nhan: "Đã nộp", phu: null });
  });
});

describe("[TQ-04] gomHocPhan", () => {
  const b = (id: string, ngay: string, hp: string | null, past: boolean, cancelled = false): BuoiChoHanhTrinh => ({
    id,
    order: 1,
    title: id,
    dateISO: ngay,
    past,
    cancelled,
    hocPhan: hp,
  });
  it("khoá không chia học phần ⇒ không bịa thanh", () => {
    expect(gomHocPhan([b("a", "2026-10-01T10:00:00Z", null, true)], null)).toEqual([]);
  });
  it("đếm đã học, đánh dấu buổi tiếp, bỏ buổi huỷ", () => {
    const r = gomHocPhan(
      [
        b("a", "2026-10-01T10:00:00Z", "HP1", true),
        b("x", "2026-10-02T10:00:00Z", "HP1", false, true),
        b("c", "2026-11-05T10:00:00Z", "HP1", false),
        b("d", "2026-12-01T10:00:00Z", "HP2", false),
      ],
      "c",
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ ma: "HP1", tong: 2, daHoc: 1, ong: ["xong", "tiep"] });
    expect(r[1]).toMatchObject({ ma: "HP2", daHoc: 0, batDau: "01/12" });
  });
});

describe("[TQ-05] soSanhNangLuc", () => {
  it("không có rubric ⇒ null (không vẽ thanh bịa)", () => {
    expect(soSanhNangLuc([{ dateISO: "2026-10-05T10:00:00Z", rubric: null }])).toBeNull();
  });
  it("so tháng gần nhất có dữ liệu với tháng liền trước; rubric thấp hơn = tốt hơn", () => {
    const r = soSanhNangLuc([
      { dateISO: "2026-10-20T10:00:00Z", rubric: { "kt-cu": 1, "kt-moi": 1 } },
      { dateISO: "2026-09-20T10:00:00Z", rubric: { "kt-cu": 3, "kt-moi": 3 } },
    ]);
    expect(r?.thang).toBe(10);
    expect(r?.thangTruoc).toBe(9);
    expect(r?.dong[0]).toMatchObject({ nhom: "Kiến thức", bac: 3, nhanBac: "Tích cực", xuHuong: "tang" });
  });
  it("tháng trước trống ⇒ không có xu hướng", () => {
    const r = soSanhNangLuc([{ dateISO: "2026-10-20T10:00:00Z", rubric: { "kt-cu": 2 } }]);
    expect(r?.dong[0]?.xuHuong).toBeNull();
  });
});
