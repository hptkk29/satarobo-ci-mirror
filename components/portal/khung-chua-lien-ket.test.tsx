// @vitest-environment jsdom
/**
 * [KCL-*] — ngoại lệ N2: phụ huynh chưa có học viên vẫn mở được /portal/disc. Dữ liệu giả.
 *   [KCL-01] hàm thuần: chỉ (choPhepDisc ∧ đoạn đầu = "disc") mới cho xem
 *   [KCL-02] phần tử thật: /disc ⇒ thấy page, KHÔNG thấy thông báo (đối chứng âm: đoạn khác ⇒ thông báo, KHÔNG thấy page)
 *   [KCL-03] cờ/vai không cho (choPhepDisc=false) ⇒ ngay cả trên /disc vẫn là thông báo
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const doan = vi.hoisted(() => ({ gia: null as string | null }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => doan.gia }));

import { KhungChuaLienKet, duocXemKhiChuaCoCon } from "./khung-chua-lien-ket";

beforeEach(() => {
  doan.gia = null;
});
afterEach(cleanup);

const dung = (choPhepDisc: boolean) =>
  render(
    <KhungChuaLienKet choPhepDisc={choPhepDisc} thongBao={<p>Chưa liên kết học viên</p>}>
      <p>Trang DISC</p>
    </KhungChuaLienKet>,
  );

describe("[KCL-01] hàm thuần", () => {
  it("chỉ disc + được phép", () => {
    expect(duocXemKhiChuaCoCon("disc", true)).toBe(true);
    expect(duocXemKhiChuaCoCon("disc", false)).toBe(false);
    expect(duocXemKhiChuaCoCon("hoc-phi", true)).toBe(false);
    expect(duocXemKhiChuaCoCon("disc-gia", true)).toBe(false);
    expect(duocXemKhiChuaCoCon(null, true)).toBe(false);
  });
});

describe("[KCL-02] phần tử thật", () => {
  it("/portal/disc ⇒ page; đối chứng: trang khác ⇒ thông báo", () => {
    doan.gia = "disc";
    dung(true);
    expect(screen.getByText("Trang DISC")).toBeTruthy();
    expect(screen.queryByText("Chưa liên kết học viên")).toBeNull();
    cleanup();
    for (const d of ["hoc-phi", "ho-so", "tin-nhan", null]) {
      doan.gia = d;
      dung(true);
      expect(screen.getByText("Chưa liên kết học viên"), String(d)).toBeTruthy();
      expect(screen.queryByText("Trang DISC"), String(d)).toBeNull();
      cleanup();
    }
  });
});

describe("[KCL-03] không được phép", () => {
  it("choPhepDisc=false ⇒ /disc vẫn là thông báo", () => {
    doan.gia = "disc";
    dung(false);
    expect(screen.getByText("Chưa liên kết học viên")).toBeTruthy();
    expect(screen.queryByText("Trang DISC")).toBeNull();
  });
});

describe("[KCL-04] gói miễn phí (08/11/2026): đoạn `doanThem` cũng được xem khi chưa có bé", () => {
  const dung2 = (choPhepDisc: boolean, doanThem: readonly string[]) =>
    render(
      <KhungChuaLienKet choPhepDisc={choPhepDisc} doanThem={doanThem} thongBao={<p>Chưa liên kết học viên</p>}>
        <p>Trang miễn phí</p>
      </KhungChuaLienKet>,
    );
  it("hàm thuần: đoạn trong `doanThem` ⇒ xem được, KHÔNG phụ thuộc cờ DISC; đoạn ngoài mảng ⇒ không", () => {
    expect(duocXemKhiChuaCoCon("tu-sach", false, ["tu-sach", "suc-khoe"])).toBe(true);
    expect(duocXemKhiChuaCoCon("suc-khoe", false, ["tu-sach"])).toBe(false); // cờ Sức khỏe tắt ⇒ đoạn không có trong mảng
    expect(duocXemKhiChuaCoCon("tu-sach-gia", false, ["tu-sach"])).toBe(false); // so khớp NGUYÊN đoạn, không so tiền tố
    expect(duocXemKhiChuaCoCon("hoc-phi", true, ["tu-sach"])).toBe(false);
    expect(duocXemKhiChuaCoCon(null, true, ["tu-sach"])).toBe(false);
    expect(duocXemKhiChuaCoCon("disc", true, [])).toBe(true); // DISC giữ nguyên hành vi cũ
  });
  it("phần tử thật: /tu-sach ⇒ page; đối chứng: /hoc-phi ⇒ thông báo", () => {
    doan.gia = "tu-sach";
    dung2(false, ["tu-sach"]);
    expect(screen.getByText("Trang miễn phí")).toBeTruthy();
    expect(screen.queryByText("Chưa liên kết học viên")).toBeNull();
    cleanup();
    doan.gia = "hoc-phi";
    dung2(false, ["tu-sach"]);
    expect(screen.getByText("Chưa liên kết học viên")).toBeTruthy();
    expect(screen.queryByText("Trang miễn phí")).toBeNull();
  });
});
