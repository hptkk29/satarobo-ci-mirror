// @vitest-environment jsdom
/**
 * [MSV-*] — màn Cổng học sinh DỰNG THẬT, đọc phần tử (04/11/2026):
 *   [MSV-01] «SataCoin» ẩn (coin = null) ⇒ không còn chữ/ô/chip coin ở vỏ · Hôm nay · Hành trình · Thêm; có số ⇒ còn (đối chứng dương)
 *   [MSV-02] «Hôm nay»: thẻ «Việc của em» chỉ có khi «Bài tập & bài thi» mở; «Nhớ mang theo nhé» không còn ở bất kỳ trạng thái nào
 *   [MSV-03] «Hôm nay»: khung «Lời thầy cô dặn em» vẫn hiện khi bài tập ẩn
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/hoc-sinh",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/components/portal/appearance-provider", () => ({
  usePortalAppearance: () => ({ isDark: false, setTheme: () => undefined, mounted: true }),
}));

import { HvShell } from "@/components/portal/hv-shell";
import { HvHomNayTrang } from "@/components/portal/hv-hom-nay";
import { HvHanhTrinhTrang } from "@/components/portal/hv-hanh-trinh";
import { HvThemTrang } from "@/components/portal/hv-them";
import type { HvHomNay } from "@/lib/portal/hv-du-lieu";

afterEach(cleanup);

const homNay = (v: Partial<HvHomNay> = {}): HvHomNay => ({
  ten: "An",
  nhanHomNay: "THỨ BA, 04/11",
  chao: "Chào em!",
  xong: 3,
  huyHieu: 2,
  huyHieuTong: 8,
  coin: 120,
  tiep: null,
  baiTap: null,
  coBaiTap: false,
  danhGia: null,
  loiDan: null,
  tienDo: { pct: 25, hocPhan: 1, trong: 3, o: Array.from({ length: 12 }, (_, i) => i < 3), conLai: null },
  tin: [],
  tinMoi: 0,
  ...v,
});

describe("[MSV-01] SataCoin ẩn / hiện", () => {
  it("vỏ: coin = null ⇒ không chip coin (menu bên lẫn thanh trên); có số ⇒ còn cả hai", () => {
    const dung = (coin: number | null) =>
      render(
        <HvShell ten="Nguyễn An" tat="NA" anhUrl={null} phu="Sata 3" coin={coin} mauAv={0} tinMoi={0} baiTap={0} danhGia={0} coBaiTap={false}>
          <p>nội dung</p>
        </HvShell>,
      );
    const a = dung(null);
    expect(screen.queryByText("SataCoin")).toBeNull();
    expect(a.container.querySelector('[aria-label^="SataCoin"]')).toBeNull();
    cleanup();
    dung(120);
    expect(screen.getByText("SataCoin")).toBeTruthy();
    expect(document.querySelector('[aria-label^="SataCoin của em"]')).not.toBeNull();
  });
  it("Hôm nay: coin = null ⇒ không ô SataCoin, hero còn 2 ô; có số ⇒ 3 ô", () => {
    const a = render(<HvHomNayTrang d={homNay({ coin: null })} />);
    expect(screen.queryByText("SataCoin")).toBeNull();
    expect(a.container.querySelector(".grid-cols-2")).not.toBeNull();
    cleanup();
    const b = render(<HvHomNayTrang d={homNay({ coin: 120 })} />);
    expect(screen.getByText("SataCoin")).toBeTruthy();
    expect(b.container.querySelector(".grid-cols-3")).not.toBeNull();
  });
  it("Hành trình: coin = null ⇒ không thẻ «SataCoin của em»; có số ⇒ còn", () => {
    const du = (coin: number | null) => ({
      ten: "An",
      tenKhoa: "Sata3",
      soHocPhan: 0,
      soChang: 0,
      xong: 0,
      pct: 0,
      banDo: [],
      changMo: 0,
      huyHieu: [],
      huyHieuDa: 0,
      kyNang: [],
      coin,
      giaoDich: [],
    });
    render(<HvHanhTrinhTrang d={du(null)} />);
    expect(screen.queryByText("SataCoin của em")).toBeNull();
    expect(screen.queryByText("Coin gần đây")).toBeNull();
    cleanup();
    render(<HvHanhTrinhTrang d={du(120)} />);
    expect(screen.getByText("SataCoin của em")).toBeTruthy();
  });
  it("Thêm: coin = null ⇒ dòng «Huy hiệu» (không nhắc coin); có số ⇒ «SataCoin & huy hiệu»", () => {
    render(<HvThemTrang ten="An" khoa={null} coin={null} danhGia={0} tinMoi={0} />);
    expect(screen.queryByText("SataCoin & huy hiệu")).toBeNull();
    expect(screen.getByText("Huy hiệu")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/coin/i);
    cleanup();
    render(<HvThemTrang ten="An" khoa={null} coin={120} danhGia={0} tinMoi={0} />);
    expect(screen.getByText("SataCoin & huy hiệu")).toBeTruthy();
  });
});

describe("[MSV-02] Việc của em + Nhớ mang theo", () => {
  const buoiTiep: HvHomNay["tiep"] = { so: 5, ten: "Robot đua", ngayNhan: "T3, 04/11", gio: "17:30–19:00", conNgay: "Hôm nay", giaoVien: "Cô Lan", noi: "P302" };
  it("bài tập ẩn ⇒ không thẻ «Việc của em» (kể cả khi có lời mời đánh giá); bài tập mở ⇒ có (đối chứng dương)", () => {
    const dg = { giaoVien: "Cô Lan", dot: "Đợt 3" };
    // Có lời dặn ⇒ cột phải VẪN được dựng (nếu không, cổng riêng của thẻ «Việc của em» không bao giờ được kiểm — lỗ của bản đầu).
    const loi = { noiDung: "Em làm tốt lắm.", giaoVien: "Cô Lan", buoi: 3 };
    render(<HvHomNayTrang d={homNay({ coBaiTap: false, danhGia: dg, loiDan: loi })} />);
    expect(screen.getByText("Lời thầy cô dặn em")).toBeTruthy(); // đối chứng: cột có dựng
    expect(screen.queryByText("Việc của em")).toBeNull();
    expect(screen.queryByText(/Em thấy giờ học với/)).toBeNull();
    expect(screen.queryByText(/Em chưa có việc nào cần làm/)).toBeNull();
    cleanup();
    render(<HvHomNayTrang d={homNay({ coBaiTap: true, danhGia: dg, loiDan: loi })} />);
    expect(screen.getByText("Việc của em")).toBeTruthy();
    expect(screen.getByText(/Em thấy giờ học với Cô Lan thế nào/)).toBeTruthy();
  });
  it("«Nhớ mang theo nhé» không còn, dù có buổi tiếp theo, dù bài tập mở hay ẩn", () => {
    for (const coBaiTap of [false, true]) {
      render(<HvHomNayTrang d={homNay({ coBaiTap, tiep: buoiTiep })} />);
      expect(screen.getByText("BUỔI HỌC TIẾP THEO")).toBeTruthy(); // đối chứng: thẻ buổi học vẫn vẽ
      expect(screen.queryByText("Nhớ mang theo nhé")).toBeNull();
      expect(screen.queryByText("Bình nước")).toBeNull();
      expect(screen.queryByText("Thẻ học viên")).toBeNull();
      expect(document.querySelector('input[type="checkbox"]')).toBeNull();
      cleanup();
    }
  });
});

describe("[MSV-03] Lời thầy cô dặn em", () => {
  it("bài tập ẩn mà có lời dặn ⇒ vẫn hiện đúng nội dung + tên thầy cô; không lời dặn ⇒ không khung", () => {
    render(<HvHomNayTrang d={homNay({ coBaiTap: false, loiDan: { noiDung: "Nhớ làm bài tập về nhà đấy nhé!", giaoVien: "UAT — Giáo viên CS1", buoi: 32 } })} />);
    expect(screen.getByText("Lời thầy cô dặn em")).toBeTruthy();
    expect(screen.getByText(/Nhớ làm bài tập về nhà đấy nhé!/)).toBeTruthy();
    expect(screen.getByText(/UAT — Giáo viên CS1/)).toBeTruthy();
    cleanup();
    render(<HvHomNayTrang d={homNay({ coBaiTap: false, loiDan: null })} />);
    expect(screen.queryByText("Lời thầy cô dặn em")).toBeNull();
  });
});
