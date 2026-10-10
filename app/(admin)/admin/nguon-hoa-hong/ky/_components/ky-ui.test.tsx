// @vitest-environment jsdom
/**
 * [NHH-KY-UI-*] — các mảnh TRÌNH BÀY của tab Kỳ trên phần tử thật: ChonThang · DaiSo · ViecDangDo · BangKy · TrangThaiKyPill.
 *
 * Canh những thứ `tsc` không thấy: mũi tên ở biên là nút TẮT thật (không phải liên kết mờ vẫn điều hướng được), số tiền âm in dấu trừ thật và đọc ra là khoản trừ,
 * liên kết sang tab Sổ chỉ có khi người xem MỞ ĐƯỢC tab Sổ, vai "treo" nằm ở nhóm KHÔNG CHẶN (không bao giờ lẫn vào nhóm chặn khoá), cả dòng của bảng là vùng bấm.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { TrangThaiKyPill } from "@/components/admin/nguon-hoa-hong/trang-thai-ky-pill";
import { TRANG_THAI_KY } from "@/lib/hoa-hong/ky-hoa-hong";
import { gomChan, NHAN_TRANG_THAI_KY } from "@/lib/hoa-hong/ky-man-hinh";
import type { DanhSachKy, DongKy } from "@/lib/hoa-hong/ky-doc";
import { BangKy } from "./bang-ky";
import { ChonThang } from "./chon-thang";
import { DaiSo } from "./dai-so";
import { ViecDangDo, type DuLieuViecDangDo } from "./viec-dang-do";

afterEach(cleanup);

describe("[NHH-KY-UI-20] ChonThang", () => {
  it("có cả hai hướng ⇒ hai liên kết thật, đúng địa chỉ; ở biên ⇒ <button disabled>, KHÔNG có liên kết mờ", () => {
    const { unmount } = render(<ChonThang thangNhan="10/2026" hrefTruoc="/x?thang=2026-09" hrefTiep="/x?thang=2026-11" />);
    expect(screen.getByRole("link", { name: "Tháng trước" }).getAttribute("href")).toBe("/x?thang=2026-09");
    expect(screen.getByRole("link", { name: "Tháng sau" }).getAttribute("href")).toBe("/x?thang=2026-11");
    expect(screen.getByText("Tháng 10/2026")).toBeTruthy();
    unmount();
    render(<ChonThang thangNhan="10/2026" hrefTruoc={null} hrefTiep={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect((screen.getByRole("button", { name: "Tháng trước" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Tháng sau" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[NHH-KY-UI-21] DaiSo — bốn ô số", () => {
  it("in đủ bốn nhãn + giá trị; số phải chi ròng ở dòng phụ của ô Tổng hoa hồng; điều chỉnh âm in dấu trừ thật", () => {
    render(<DaiSo coSoTinh={100_000_000} hoaHong={3_000_000} dieuChinh={-120_000} soNguoi={4} chuaTinh={false} />);
    for (const [nhan, gia] of [
      ["Tổng cơ sở tính", "100.000.000đ"],
      ["Tổng hoa hồng", "3.000.000đ"],
      ["Điều chỉnh", "−120.000đ"],
      ["Số người hưởng", "4"],
    ] as const) {
      const the = screen.getByText(nhan).closest("div.flex")!.parentElement ?? document.body;
      expect(within(the as HTMLElement).getByText(gia)).toBeTruthy();
    }
    expect(screen.getByText("Phải chi ròng 2.880.000đ")).toBeTruthy();
    expect(screen.queryByText(/Kỳ chưa được Tính/)).toBeNull();
  });

  it("kỳ chưa Tính ⇒ nói thẳng số có thể chưa đủ; đối chứng: đã Tính ⇒ không nói", () => {
    render(<DaiSo coSoTinh={0} hoaHong={0} dieuChinh={0} soNguoi={0} chuaTinh />);
    expect(screen.getByText(/Kỳ chưa được Tính: các số trên chỉ là phần đã ghi vào sổ/)).toBeTruthy();
  });
});

function viec(p: Partial<DuLieuViecDangDo> = {}): DuLieuViecDangDo {
  return {
    trangThai: "REVIEWING",
    mucChan: [],
    troi: null,
    hrefSo: () => "/nguon-hoa-hong/so?thang=2026-10",
    loChoChi: [],
    treo: 0,
    hrefSoTreo: "/nguon-hoa-hong/so?thang=2026-10&van-de=UNRESOLVED_BENEFICIARY",
    nguon: null,
    chinhSach: null,
    doiDuoc: null,
    ...p,
  };
}

describe("[NHH-KY-UI-22] ViecDangDo", () => {
  it("không còn gì chặn ⇒ một dòng thành công; có chặn ⇒ câu nêu từng loại + từng dòng có liên kết sang tab Sổ", () => {
    const { unmount } = render(<ViecDangDo d={viec()} />);
    expect(screen.getByText("Không còn gì chặn khoá kỳ này.")).toBeTruthy();
    unmount();
    const muc = gomChan({ MANUAL_REVIEW_REQUIRED: 3, CAP_EXCEEDED: 1 });
    render(<ViecDangDo d={viec({ mucChan: muc })} />);
    const nhom = document.querySelector('[data-nhom="chan"]')!;
    expect(nhom.textContent).toMatch(/Chặn khoá kỳ/);
    expect(within(nhom as HTMLElement).getAllByRole("listitem").map((l) => l.textContent?.replace("Xem ở tab Sổ", ""))).toEqual(["3 khoản chờ duyệt tay", "1 khoản vượt trần"]);
    expect(within(nhom as HTMLElement).getAllByRole("link", { name: "Xem ở tab Sổ" })).toHaveLength(2);
    expect(screen.queryByText("Không còn gì chặn khoá kỳ này.")).toBeNull();
  });

  it("người xem KHÔNG mở được tab Sổ ⇒ vẫn thấy số, nhưng KHÔNG có liên kết chết", () => {
    render(<ViecDangDo d={viec({ mucChan: gomChan({ CAP_EXCEEDED: 2 }), hrefSo: () => null, hrefSoTreo: null, treo: 1 })} />);
    expect(document.querySelector('[data-nhom="chan"]')!.textContent).toMatch(/2 khoản vượt trần/);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("đầu vào trôi ⇒ là việc CHẶN (dù không có hàng chờ nào), nêu ngày Tính", () => {
    render(<ViecDangDo d={viec({ troi: { ngayTinh: "31/10/2026" } })} />);
    const nhom = document.querySelector('[data-nhom="chan"]')!;
    expect(nhom.textContent).toMatch(/Đầu vào đã đổi sau lần Tính/);
    expect(nhom.textContent).toMatch(/31\/10\/2026/);
    expect(screen.queryByText("Không còn gì chặn khoá kỳ này.")).toBeNull();
  });

  it("vai 'treo' + việc ở tab khác nằm ở nhóm KHÔNG CHẶN, không lẫn vào nhóm chặn; khiếu nại không có dòng nào (chưa có bảng)", () => {
    render(
      <ViecDangDo
        d={viec({ treo: 3, nguon: { so: 5, lienKet: { href: "/nguon-hoa-hong/nguon", nhan: "Mở tab Nguồn" } }, chinhSach: { so: 2, lienKet: null } })}
      />,
    );
    const chan = document.querySelector('[data-nhom="chan"]')!;
    const khong = document.querySelector('[data-nhom="khong-chan"]')!;
    expect(chan.textContent).toBe("Không còn gì chặn khoá kỳ này."); // treo KHÔNG làm kỳ có việc chặn
    expect(khong.textContent).toMatch(/3 vai chưa có người nhận/);
    expect(khong.textContent).toMatch(/Tab Nguồn còn 5 việc/);
    expect(khong.textContent).toMatch(/Tab Chính sách còn 2 việc/);
    expect(within(khong as HTMLElement).getByRole("link", { name: "Mở tab Nguồn" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/khiếu nại/i);
  });

  it("nhóm không chặn VẮNG khi mọi số bằng 0; kỳ đã khoá ⇒ không vẽ nhóm chặn nữa, chỉ còn nhóm chờ chi", () => {
    const { unmount } = render(<ViecDangDo d={viec({ treo: 0, nguon: { so: 0, lienKet: null } })} />);
    expect(document.querySelector('[data-nhom="khong-chan"]')).toBeNull();
    unmount();
    render(<ViecDangDo d={viec({ trangThai: "EXPORTED", loChoChi: [{ nhan: "Bảng lương (nội bộ)", soDong: 3, tongTien: 900_000, taoLuc: "31/10/2026 14:05" }] })} />);
    expect(document.querySelector('[data-nhom="chan"]')).toBeNull();
    const cho = document.querySelector('[data-nhom="cho-chi"]')!;
    expect(cho.textContent).toMatch(/Bảng lương \(nội bộ\).*3 dòng/);
    expect(cho.textContent).toMatch(/900\.000đ/);
  });
});

function dong(p: Partial<DongKy> = {}): DongKy {
  return {
    id: "k1",
    period: "2026-10",
    centerId: "cs1",
    coSo: "CS1",
    status: "LOCKED",
    coSoTinh: 100_000_000,
    hoaHong: 3_000_000,
    dieuChinh: -120_000,
    soNguoi: 4,
    soChan: 0,
    lastCalculatedAt: new Date("2026-10-31T10:00:00.000Z"),
    lockedAt: new Date("2026-11-02T07:05:00.000Z"),
    khoaBoi: "Lan Kế Toán",
    exportedAt: null,
    paidAt: null,
    ...p,
  };
}
const ds = (dongs: DongKy[], p: Partial<DanhSachKy> = {}): DanhSachKy => ({ dong: dongs, tong: dongs.length, trang: 1, soTrang: 1, coTrang: 25, ...p });
const bang = (d: DanhSachKy, p: Partial<React.ComponentProps<typeof BangKy>> = {}) =>
  render(<BangKy ds={d} basePath="/nguon-hoa-hong/ky" kyCutover="2026-10" thangDangChon="2026-10" coSoDangChon="cs1" trangThai={null} {...p} />);

describe("[NHH-KY-UI-22b] ViecDangDo — gợi ý 'dời sang kỳ sau' chỉ khi nút THẬT SỰ có ở tab Sổ", () => {
  it("có hàng chờ dời được ∧ người xem có quyền ⇒ nêu số khoản + liên kết sang tab Sổ; đối chứng: doiDuoc=null ⇒ KHÔNG câu nào nhắc 'dời sang kỳ sau' (cả khi vẫn có hàng chờ chặn)", () => {
    const muc = gomChan({ PENDING_REGULATION: 2, CAP_EXCEEDED: 1 });
    const { unmount } = render(<ViecDangDo d={viec({ mucChan: muc, doiDuoc: { so: 2, href: "/nguon-hoa-hong/so?nhom=CHO_CHINH_SACH&ky=2026-10" } })} />);
    const nhom = document.querySelector('[data-nhom="chan"]')!;
    const goiY = nhom.querySelector("[data-doi-duoc]")!;
    expect(goiY.textContent).toContain("2 khoản trong số này có thể dời sang kỳ sau");
    expect(within(goiY as HTMLElement).getByRole("link", { name: "Mở tab Sổ để dời" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?nhom=CHO_CHINH_SACH&ky=2026-10");
    unmount();
    render(<ViecDangDo d={viec({ mucChan: muc, doiDuoc: null })} />);
    expect(document.querySelector("[data-doi-duoc]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/dời sang kỳ sau/);
    expect(document.querySelector('[data-nhom="chan"]')!.textContent).toMatch(/2 khoản chờ văn bản/); // hàng chờ chặn vẫn được nêu
  });

  it("không hàng chờ chặn nào ⇒ gợi ý không hiện dù doiDuoc có giá trị (không gợi ý dời khi chẳng có gì để dời)", () => {
    render(<ViecDangDo d={viec({ doiDuoc: { so: 1, href: "/x" } })} />);
    expect(document.querySelector("[data-doi-duoc]")).toBeNull();
  });
});

describe("[NHH-KY-UI-23] BangKy", () => {
  it("mười cột đúng tên; dòng: tiền định dạng, điều chỉnh âm tô danger, mốc chỉ in NGÀY (ngày giờ đủ ở title), chưa có mốc ⇒ gạch", () => {
    bang(ds([dong()]));
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Kỳ", "Cơ sở", "Trạng thái", "Cơ sở tính", "Hoa hồng", "Điều chỉnh", "Chặn", "Đã tính", "Đã khoá", "Đã xuất",
    ]);
    const hang = screen.getAllByRole("row")[1]!;
    const o = within(hang).getAllByRole("cell");
    expect(o.map((c) => c.textContent)).toEqual(["10/2026", "CS1", "Đã khoá", "100.000.000đ", "3.000.000đ", "−120.000đ", "0", "31/10", "02/11 · Lan Kế Toán", "—"]);
    expect(o[5]!.className).toMatch(/text-state-danger-ink/);
    expect(o[8]!.querySelector("time")!.getAttribute("title")).toBe("02/11/2026 14:05"); // 07:05Z = 14:05 giờ VN
    expect(o[8]!.querySelector("[data-nguoi-khoa]")!.getAttribute("title")).toBe("Khoá bởi Lan Kế Toán");
    expect(o[9]!.querySelector('[aria-label="chưa có"]')).not.toBeNull();
  });

  it("cả dòng là vùng bấm (luật 12): ô Kỳ là liên kết thật tới đúng tháng × cơ sở, phủ cả dòng bằng after:inset-0; dòng đang chọn có aria-current", () => {
    bang(ds([dong(), dong({ id: "k2", centerId: "cs2", coSo: "CS2", period: "2026-09" })]), { kyCutover: "2026-09" });
    const lk = screen.getByRole("link", { name: "09/2026" });
    expect(lk.getAttribute("href")).toBe("/nguon-hoa-hong/ky?coSo=cs2&thang=2026-09");
    expect(lk.className).toMatch(/after:absolute/);
    expect(lk.className).toMatch(/after:inset-0/);
    const [, h1, h2] = screen.getAllByRole("row");
    expect(h1!.getAttribute("aria-current")).toBe("true");
    expect(h2!.getAttribute("aria-current")).toBeNull();
  });

  it("kỳ có hàng chờ chặn ⇒ số tô cảnh báo; kỳ TRƯỚC mốc cutover ⇒ dòng mờ, nhãn 'Sổ cũ' thay trạng thái", () => {
    bang(ds([dong({ soChan: 3, status: "REVIEWING" }), dong({ id: "k0", period: "2026-09" })]));
    const [, h1, h2] = screen.getAllByRole("row");
    expect(within(h1!).getByText("3").className).toMatch(/text-state-warning-ink/);
    expect(h2!.className).toMatch(/text-muted-foreground/);
    expect(within(h2!).getByText("Sổ cũ").getAttribute("title")).toMatch(/\/crm\/commission/);
    expect(within(h2!).queryByText("Đã khoá")).toBeNull();
  });

  it("bộ lọc trạng thái nằm trên URL: chip đang chọn có aria-current, giữ tháng + cơ sở; bỏ lọc là liên kết", () => {
    bang(ds([dong()]), { trangThai: "LOCKED" });
    const nav = screen.getByRole("navigation", { name: "Lọc theo trạng thái kỳ" });
    expect(within(nav).getByRole("link", { name: "Đã khoá" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Đã khoá" }).getAttribute("href")).toBe("/nguon-hoa-hong/ky?coSo=cs1&trangthai=LOCKED&thang=2026-10");
    expect(within(nav).getByRole("link", { name: "Mọi trạng thái" }).getAttribute("href")).toBe("/nguon-hoa-hong/ky?coSo=cs1&thang=2026-10");
    expect(within(nav).getAllByRole("link")).toHaveLength(1 + TRANG_THAI_KY.length);
  });

  it("rỗng: nói vì sao + đường ra; rỗng do bộ lọc có nút 'Xem mọi trạng thái'", () => {
    const { unmount } = bang(ds([], { tong: 0 }));
    expect(screen.getByText("Chưa có kỳ hoa hồng nào")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    unmount();
    bang(ds([], { tong: 0 }), { trangThai: "PAID" });
    expect(screen.getByText("Không có kỳ nào ở trạng thái này")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Xem mọi trạng thái" }).length).toBeGreaterThan(0);
  });

  it("phân trang ở URL: dải 'từ–đến / tổng' đúng ở trang 2; giữ bộ lọc khi sang trang", () => {
    const nhieu = Array.from({ length: 25 }, (_, i) => dong({ id: `k${i}`, period: "2026-10" }));
    bang(ds(nhieu, { tong: 60, trang: 2, soTrang: 3 }), { trangThai: "LOCKED" });
    expect(screen.getByText("26–50 / 60 kỳ")).toBeTruthy();
    const trang3 = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.includes("trang=3"));
    expect(trang3?.getAttribute("href")).toBe("/nguon-hoa-hong/ky?coSo=cs1&trangthai=LOCKED&trang=3&thang=2026-10");
  });
});

describe("[NHH-KY-UI-25] BangKy — người khoá trong ô 'Đã khoá'", () => {
  const oKhoa = () => within(screen.getAllByRole("row")[1]!).getAllByRole("cell")[8]!;

  it("đã khoá + biết người ⇒ 'dd/MM · Tên', ngày giờ đủ ở title của <time>, tên đầy đủ ở title của tên; tên dài bị cắt bằng CSS chứ không xuống dòng", () => {
    bang(ds([dong({ khoaBoi: "Nguyễn Thị Thanh Huyền Kế Toán Trưởng Hội Sở" })]));
    const o = oKhoa();
    expect(o.textContent).toBe("02/11 · Nguyễn Thị Thanh Huyền Kế Toán Trưởng Hội Sở");
    const ten = o.querySelector("[data-nguoi-khoa]")!;
    expect(ten.getAttribute("title")).toBe("Khoá bởi Nguyễn Thị Thanh Huyền Kế Toán Trưởng Hội Sở");
    expect(ten.closest(".truncate"), "tên dài cắt bằng CSS (truncate) chứ không xuống dòng làm cao dòng bảng").not.toBeNull();
  });

  it("kỳ cũ có lockedAt mà không có người (lockedById NULL / người không còn) ⇒ 'dd/MM · —' có nhãn đọc ra; CHƯA khoá ⇒ chỉ một gạch, không 'người'", () => {
    const { unmount } = bang(ds([dong({ khoaBoi: null })]));
    const o = oKhoa();
    expect(o.textContent).toBe("02/11 · —");
    expect(o.querySelector('[aria-label="chưa rõ người khoá"]')).not.toBeNull();
    unmount();
    bang(ds([dong({ status: "REVIEWING", lockedAt: null, khoaBoi: null })]));
    expect(oKhoa().textContent).toBe("—");
    expect(oKhoa().querySelector('[aria-label="chưa có"]')).not.toBeNull();
    expect(oKhoa().querySelector("[data-nguoi-khoa]")).toBeNull();
  });
});

describe("[NHH-KY-UI-26] BangKy — danh sách thẻ dưới xl (375/768/1024px) bên cạnh bảng mười cột", () => {
  const cacThe = () => within(screen.getByRole("list", { name: "Các kỳ hoa hồng, dạng thẻ" })).getAllByRole("listitem");

  it("bảng chỉ hiện từ xl (hidden xl:block), danh sách thẻ chỉ hiện dưới xl (xl:hidden); cả hai cùng có mặt trong cây, cùng số dòng", () => {
    bang(ds([dong(), dong({ id: "k2", centerId: "cs2", coSo: "CS2", period: "2026-09" })]), { kyCutover: "2026-09" });
    const bangCss = screen.getByRole("table").closest('[class*="xl:block"]');
    expect(bangCss, "vỏ bảng phải ẩn dưới md").not.toBeNull();
    expect(bangCss!.className).toMatch(/\bhidden\b/);
    const ul = screen.getByRole("list", { name: "Các kỳ hoa hồng, dạng thẻ" });
    expect(ul.className).toMatch(/\bxl:hidden\b/);
    expect(cacThe()).toHaveLength(2);
    expect(screen.getAllByRole("columnheader")).toHaveLength(10); // bảng 10 cột nguyên vẹn
  });

  it("mỗi thẻ: tháng + trạng thái, cơ sở, hoa hồng đậm, Chặn N tô cảnh báo CHỈ khi N > 0, cơ sở tính, 'Khoá dd/MM · Tên'", () => {
    bang(ds([dong({ soChan: 3, status: "REVIEWING" }), dong({ id: "k2", period: "2026-10", centerId: "cs2", coSo: "CS2", soChan: 0, khoaBoi: null })]));
    const [a, b] = cacThe();
    expect(a!.textContent).toMatch(/10\/2026/);
    expect(within(a!).getByText("Đang rà soát")).toBeTruthy();
    expect(a!.textContent).toMatch(/CS1/);
    expect(within(a!).getByText("3.000.000đ").className).toMatch(/font-semibold/);
    expect(within(a!).getByText("Chặn 3").className).toMatch(/text-state-warning-ink/);
    expect(a!.textContent).toMatch(/Cơ sở tính 100\.000\.000đ/);
    expect(a!.textContent).toMatch(/Khoá 02\/11 · Lan Kế Toán/);
    expect(within(b!).queryByText(/^Chặn/)).toBeNull(); // đối chứng: 0 ⇒ không in "Chặn 0"
    expect(b!.textContent).toMatch(/Khoá 02\/11 · —/);
  });

  it("thẻ giữ link chọn kỳ (đúng địa chỉ với bảng, tên riêng, phủ cả thẻ) + aria-current ở thẻ đang chọn; kỳ trước cutover ⇒ 'Sổ cũ', thẻ mờ", () => {
    bang(ds([dong(), dong({ id: "k2", centerId: "cs2", coSo: "CS2", period: "2026-09" })]), { kyCutover: "2026-10", trangThai: "LOCKED" });
    const [a, b] = cacThe();
    const lk = within(b!).getByRole("link", { name: "Mở kỳ 09/2026 · CS2" });
    expect(lk.getAttribute("href")).toBe("/nguon-hoa-hong/ky?coSo=cs2&trangthai=LOCKED&thang=2026-09");
    expect(lk.getAttribute("href")).toBe(screen.getByRole("link", { name: "09/2026" }).getAttribute("href")); // cùng địa chỉ với link của bảng
    expect(lk.className).toMatch(/after:inset-0/);
    expect(a!.getAttribute("aria-current")).toBe("true");
    expect(b!.getAttribute("aria-current")).toBeNull();
    expect(b!.className).toMatch(/text-muted-foreground/);
    expect(within(b!).getByText("Sổ cũ")).toBeTruthy();
    expect(within(b!).queryByText("Đã khoá")).toBeNull();
  });

  it("rỗng ⇒ không vẽ danh sách thẻ nào (chỉ EmptyState)", () => {
    bang(ds([], { tong: 0 }));
    expect(screen.queryByRole("list", { name: "Các kỳ hoa hồng, dạng thẻ" })).toBeNull();
  });
});

describe("[NHH-KY-UI-24] TrangThaiKyPill", () => {
  it("mỗi trạng thái có nhãn của MỘT bảng; kỳ chưa mở ≠ lỗi (nhãn riêng); trạng thái đã khoá có biểu tượng khoá", () => {
    for (const t of TRANG_THAI_KY) {
      const { container, unmount } = render(<TrangThaiKyPill status={t} />);
      expect(container.textContent).toBe(NHAN_TRANG_THAI_KY[t]);
      expect(container.querySelector("svg") !== null, t).toBe(t === "LOCKED" || t === "EXPORTED" || t === "PAID");
      unmount();
    }
    expect(render(<TrangThaiKyPill status={null} />).container.textContent).toBe("Chưa mở kỳ");
  });
});
