import { describe, expect, it } from "vitest";
import { kiemTraHoSo, nguoiLonQuanSat, namHienTaiVN, namSinhDuKien } from "./ho-so";

const NAM = 2026;
const ph = { hoTen: "Nguyễn Thị Mai", vaiTro: "ME", namSinh: 1988 };
const hs = { hoTen: "Trần Bảo Minh", namSinh: 2016, bacHoc: "4" };

describe("[DISC-HS-01] bắt buộc đủ cặp 1 phụ huynh + 1 học sinh", () => {
  it("đủ cặp, khớp lớp ⇒ ok, không cảnh báo", () => {
    expect(kiemTraHoSo({ phuHuynh: ph, hocSinh: hs }, NAM)).toEqual({ ok: true, canhBao: [], nguoiLonQuanSatHocSinh: false, phuHuynh: ph, hocSinh: hs });
  });
  it("chỉ có phụ huynh ⇒ thiếu HOC_SINH", () => {
    expect(kiemTraHoSo({ phuHuynh: ph }, NAM)).toMatchObject({ ok: false, thieu: ["HOC_SINH"] });
  });
  it("chỉ có học sinh ⇒ thiếu PHU_HUYNH", () => {
    expect(kiemTraHoSo({ hocSinh: hs }, NAM)).toMatchObject({ ok: false, thieu: ["PHU_HUYNH"] });
  });
  it("không có gì ⇒ thiếu cả hai", () => {
    expect(kiemTraHoSo({}, NAM)).toMatchObject({ ok: false, thieu: ["PHU_HUYNH", "HOC_SINH"] });
  });
});

describe("[DISC-HS-02] kiểm tra giá trị", () => {
  it("tên rỗng bị chặn", () => {
    expect(kiemTraHoSo({ phuHuynh: { ...ph, hoTen: " " }, hocSinh: hs }, NAM).ok).toBe(false);
  });
  it("vai trò lạ bị chặn", () => {
    expect(kiemTraHoSo({ phuHuynh: { ...ph, vaiTro: "CHU_NHA" }, hocSinh: hs }, NAM).ok).toBe(false);
  });
  it("năm sinh phụ huynh vô lý (2015) bị chặn", () => {
    expect(kiemTraHoSo({ phuHuynh: { ...ph, namSinh: 2015 }, hocSinh: hs }, NAM).ok).toBe(false);
  });
  it("phụ huynh chỉ hơn con 5 tuổi ⇒ lỗi cứng", () => {
    expect(kiemTraHoSo({ phuHuynh: { ...ph, namSinh: 2011 }, hocSinh: hs }, NAM).ok).toBe(false);
  });
  it("năm sinh là chuỗi bị chặn (không ép kiểu ngầm)", () => {
    expect(kiemTraHoSo({ phuHuynh: { ...ph, namSinh: "1988" }, hocSinh: hs }, NAM).ok).toBe(false);
  });
});

describe("[DISC-HS-03] năm sinh ↔ lớp: lệch thì HỎI LẠI, không tự đoán", () => {
  it("lớp 4 nhưng sinh 2012 ⇒ ok kèm cảnh báo NAM_SINH_LECH_LOP", () => {
    const r = kiemTraHoSo({ phuHuynh: ph, hocSinh: { ...hs, namSinh: 2012 } }, NAM);
    expect(r.ok).toBe(true);
    expect(r.ok && r.canhBao.map((c) => c.ma)).toEqual(["NAM_SINH_LECH_LOP"]);
  });
  it("lệch đúng 1 năm vẫn chấp nhận (cách tính năm học)", () => {
    const r = kiemTraHoSo({ phuHuynh: ph, hocSinh: { ...hs, namSinh: 2018 } }, NAM);
    expect(r.ok && r.canhBao).toEqual([]);
  });
});

describe("[DISC-HS-04] bé nhỏ do người lớn quan sát (ngưỡng ADR-002 của DISC)", () => {
  it("mầm non ⇒ quan sát", () => expect(nguoiLonQuanSat({ bacHoc: "MN", namSinh: 2022 }, NAM)).toBe(true));
  it("lớp 1 và lớp 2 ⇒ quan sát", () => {
    expect(nguoiLonQuanSat({ bacHoc: "1", namSinh: 2020 }, NAM)).toBe(true);
    expect(nguoiLonQuanSat({ bacHoc: "2", namSinh: 2019 }, NAM)).toBe(true);
  });
  it("lớp 3 (9 tuổi) tự làm", () => expect(nguoiLonQuanSat({ bacHoc: "3", namSinh: 2017 }, NAM)).toBe(false));
  it("dưới 8 tuổi dù ghi lớp cao ⇒ vẫn quan sát (không tin lớp một mình)", () => {
    expect(nguoiLonQuanSat({ bacHoc: "5", namSinh: 2019 }, NAM)).toBe(true);
  });
  it("namSinhDuKien: lớp 1 ≈ 2020, MN ≈ 2022", () => {
    expect(namSinhDuKien("1", NAM)).toBe(2020);
    expect(namSinhDuKien("MN", NAM)).toBe(2022);
  });
});

describe("[DISC-HS-10] trả dữ liệu ĐÃ parse (F-16)", () => {
  it("tên được trim, khoá lạ bị bỏ — nơi gọi dùng bản này chứ không dùng object thô của client", () => {
    const r = kiemTraHoSo({ phuHuynh: { ...ph, hoTen: "  Nguyễn Thị Mai ", cheDau: "x" }, hocSinh: { ...hs, hoTen: " Minh  ", rac: 1 } }, NAM);
    expect(r.ok && r.phuHuynh).toEqual(ph);
    expect(r.ok && r.hocSinh).toEqual({ ...hs, hoTen: "Minh" });
  });
});

describe("[DISC-HS-11] namHienTaiVN — năm theo giờ Việt Nam từ `now` tiêm", () => {
  it.each([
    ["2026-12-31T16:59:59Z", 2026], // 23:59:59 31/12 giờ VN
    ["2026-12-31T17:00:00Z", 2027], // 00:00:00 01/01 giờ VN
    ["2027-01-01T03:00:00Z", 2027],
    ["2026-01-01T00:00:00Z", 2026],
  ])("%s ⇒ %i", (iso, nam) => {
    expect(namHienTaiVN(new Date(iso))).toBe(nam);
  });
});
