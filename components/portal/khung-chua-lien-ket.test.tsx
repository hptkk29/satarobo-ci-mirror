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
