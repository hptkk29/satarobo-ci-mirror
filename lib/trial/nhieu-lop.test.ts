import { describe, expect, it } from "vitest";
import { kiemKhoaTrialMoi, kiemThemLopTrialThuHai } from "./nhieu-lop";

describe("[NL-01] thêm bé vào lớp trial thứ hai", () => {
  it("bé chưa ở lớp nào khác ⇒ ai cũng được (đường cũ không đổi)", () => {
    expect(kiemThemLopTrialThuHai({ soLopDangO: 0, coQuyenNhieuLop: false })).toEqual({ duoc: true });
  });

  it("bé đang ở 1 lớp khác, KHÔNG có quyền ⇒ chặn và nói ai làm được", () => {
    const r = kiemThemLopTrialThuHai({ soLopDangO: 1, coQuyenNhieuLop: false });
    expect(r.duoc).toBe(false);
    if (!r.duoc) expect(r.lyDo).toMatch(/Quản lý cơ sở/);
  });

  it("đối chứng dương: bé đang ở 1 lớp khác, CÓ quyền ⇒ được", () => {
    expect(kiemThemLopTrialThuHai({ soLopDangO: 2, coQuyenNhieuLop: true })).toEqual({ duoc: true });
  });
});

describe("[NL-02] trial khoá chưa trial", () => {
  const sata3 = { status: "ACTIVE", courseId: "sata3" } as const;

  it("trùng khoá với một lượt ACTIVE khác ⇒ chặn (QLCS)", () => {
    const r = kiemKhoaTrialMoi({ khoaMoi: "sata3", trialKhac: [sata3], coQuyenMoRong: false });
    expect(r.duoc).toBe(false);
  });

  it("trùng khoá với lượt COMPLETED ⇒ vẫn chặn", () => {
    const r = kiemKhoaTrialMoi({
      khoaMoi: "sata3",
      trialKhac: [{ status: "COMPLETED", courseId: "sata3" }],
      coQuyenMoRong: false,
    });
    expect(r.duoc).toBe(false);
  });

  it("khoá khác ⇒ được (đối chứng dương: buổi 1 Sata 3, buổi 2 Sata 4)", () => {
    expect(kiemKhoaTrialMoi({ khoaMoi: "sata4", trialKhac: [sata3], coQuyenMoRong: false })).toEqual({
      duoc: true,
    });
  });

  it("lượt WITHDRAWN cùng khoá KHÔNG tính — bé chưa học thật", () => {
    expect(
      kiemKhoaTrialMoi({
        khoaMoi: "sata3",
        trialKhac: [{ status: "WITHDRAWN", courseId: "sata3" }],
        coQuyenMoRong: false,
      }),
    ).toEqual({ duoc: true });
  });

  it("lượt cũ chưa biết khoá (null) KHÔNG bị coi là trùng — không đoán", () => {
    expect(
      kiemKhoaTrialMoi({
        khoaMoi: "sata3",
        trialKhac: [{ status: "ACTIVE", courseId: null }],
        coQuyenMoRong: false,
      }),
    ).toEqual({ duoc: true });
  });

  it("Quản trị tối cao (mở rộng) được trial lại CÙNG khoá", () => {
    expect(kiemKhoaTrialMoi({ khoaMoi: "sata3", trialKhac: [sata3], coQuyenMoRong: true })).toEqual({
      duoc: true,
    });
  });
});
