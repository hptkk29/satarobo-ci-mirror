import { describe, expect, it } from "vitest";
import {
  daDoiTieuChi,
  diemToiDaNhap,
  diemTuChuoi,
  loiTieuChiNhap,
  lyDoChuaKichHoat,
  nhapTuTieuChi,
  tieuChiMoi,
  tongDiemNhap,
  trangThaiTongDiem,
  type TieuChiNhap,
} from "./khung-cham-soan";

const tc = (label: string, ...diem: string[]): TieuChiNhap => ({
  criterionId: "x",
  label,
  description: "",
  levels: diem.map((p, i) => ({ label: `Mức ${i + 1}`, points: p })),
});

describe("[KCS-01] điểm nhập: số nguyên không âm, và chỉ vậy", () => {
  it("nhận số nguyên; từ chối rỗng · thập phân · chữ · âm · số mũ", () => {
    expect(diemTuChuoi("4")).toBe(4);
    expect(diemTuChuoi(" 12 ")).toBe(12);
    for (const xau of ["", " ", "1.5", "1,5", "abc", "-2", "1e3", "０"]) expect(diemTuChuoi(xau), xau).toBeNull();
  });
});

describe("[KCS-02] loiTieuChiNhap dùng ĐÚNG luật của máy chủ (dsMucSchema)", () => {
  it("hợp lệ ⇒ null", () => expect(loiTieuChiNhap(tc("Mở đầu đúng kịch bản", "0", "2", "4"))).toBeNull());
  it("🔴 tên ngắn · một mức · điểm không tăng dần · ô điểm hỏng đều có câu riêng", () => {
    expect(loiTieuChiNhap(tc("A", "0", "4"))).toMatch(/2 ký tự/);
    expect(loiTieuChiNhap(tc("Tiêu chí", "5"))).toMatch(/hai mức/);
    expect(loiTieuChiNhap(tc("Tiêu chí", "4", "2"))).toMatch(/tăng dần/);
    expect(loiTieuChiNhap(tc("Tiêu chí", "2", "2"))).toMatch(/tăng dần/); // bằng nhau cũng là không tăng
    expect(loiTieuChiNhap(tc("Tiêu chí", "0", "x"))).toMatch(/số nguyên/);
    expect(loiTieuChiNhap(tc("Tiêu chí", "0", "1.5"))).toMatch(/số nguyên/);
  });
  it("mức có tên rỗng bị chặn (mức phải có tên)", () => {
    const t = tc("Tiêu chí", "0", "4");
    t.levels[1]!.label = "  ";
    expect(loiTieuChiNhap(t)).toMatch(/tên/i);
  });
  it("tiêu chí MỚI mặc định hợp lệ (Chưa đạt 0 / Đạt 10) — nút Lưu không bị khoá oan", () => {
    const m = tieuChiMoi();
    m.label = "Tiêu chí mới";
    expect(loiTieuChiNhap(m)).toBeNull();
    expect(diemToiDaNhap(m.levels)).toBe(10);
  });
});

describe("[KCS-03] tổng điểm = Σ mức CAO NHẤT của từng tiêu chí", () => {
  it("cộng theo mức cao nhất, không theo mức cuối mảng", () => {
    expect(tongDiemNhap([tc("a", "0", "2", "4"), tc("b", "0", "2", "4"), tc("c", "0", "2", "4")])).toEqual({ tong: 12, hopLe: true });
    expect(diemToiDaNhap([{ label: "x", points: "9" }, { label: "y", points: "3" }])).toBe(9); // mức cuối thấp hơn
  });
  it("🔴 một tiêu chí chưa đọc được ⇒ hopLe=false (không im lặng cộng thiếu)", () => {
    const r = tongDiemNhap([tc("a", "0", "4"), tc("b", "0", "zz")]);
    expect(r.hopLe).toBe(false);
    expect(r.tong).toBe(4);
  });
});

describe("[KCS-04] dòng tổng điểm nói đúng lệch bao nhiêu", () => {
  it("khớp / thừa / thiếu / rỗng / hỏng", () => {
    expect(trangThaiTongDiem({ tong: 12, thang: 12, soTieuChi: 3, hopLe: true })).toEqual({ sac: "success", cau: "Tổng điểm các tiêu chí 12/12 — khớp thang điểm" });
    expect(trangThaiTongDiem({ tong: 14, thang: 12, soTieuChi: 3, hopLe: true }).cau).toMatch(/thừa 2/);
    expect(trangThaiTongDiem({ tong: 9, thang: 12, soTieuChi: 3, hopLe: true }).cau).toMatch(/thiếu 3/);
    expect(trangThaiTongDiem({ tong: 0, thang: 12, soTieuChi: 0, hopLe: true }).sac).toBe("warning");
    expect(trangThaiTongDiem({ tong: 4, thang: 12, soTieuChi: 2, hopLe: false }).sac).toBe("danger");
  });
  it("🔴 tổng bằng thang nhưng có tiêu chí hỏng ⇒ KHÔNG được báo 'khớp'", () => {
    expect(trangThaiTongDiem({ tong: 12, thang: 12, soTieuChi: 3, hopLe: false }).sac).toBe("danger");
  });
});

describe("[KCS-05] phát hiện thay đổi + lý do chưa kích hoạt được", () => {
  const goc = nhapTuTieuChi({ criterionId: "k1", label: "Tiêu chí", description: null, levels: [{ label: "Chưa đạt", points: 0 }, { label: "Đạt", points: 4 }] });
  it("giống hệt ⇒ không đổi; đổi nhãn / điểm / số mức / mô tả ⇒ đổi", () => {
    expect(daDoiTieuChi(goc, structuredClone(goc))).toBe(false);
    expect(daDoiTieuChi(goc, { ...goc, label: "Khác" })).toBe(true);
    expect(daDoiTieuChi(goc, { ...goc, description: "mô tả" })).toBe(true);
    const d = structuredClone(goc);
    d.levels[1]!.points = "5";
    expect(daDoiTieuChi(goc, d)).toBe(true);
    expect(daDoiTieuChi(goc, { ...goc, levels: [...goc.levels, { label: "Giỏi", points: "8" }] })).toBe(true);
  });
  it("🔴 thứ tự ưu tiên lý do: chưa lưu > không có tiêu chí > hỏng > lệch thang; đủ hết ⇒ null", () => {
    const base = { soTieuChi: 3, lechThang: false, coTieuChiHong: false, conChuaLuu: false };
    expect(lyDoChuaKichHoat(base)).toBeNull();
    expect(lyDoChuaKichHoat({ ...base, conChuaLuu: true, lechThang: true })).toMatch(/chưa lưu/);
    expect(lyDoChuaKichHoat({ ...base, soTieuChi: 0 })).toMatch(/chưa có tiêu chí/);
    expect(lyDoChuaKichHoat({ ...base, coTieuChiHong: true })).toMatch(/không đọc được/);
    expect(lyDoChuaKichHoat({ ...base, lechThang: true })).toMatch(/chưa khớp/);
  });
});
