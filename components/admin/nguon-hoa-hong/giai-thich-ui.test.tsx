// @vitest-environment jsdom
/**
 * [GTK-UI-*] — «VÌ SAO 0đ» trên PHẦN TỬ THẬT (jsdom): mục trong ngăn «Vì sao» · ngăn riêng · công tắc góc nhìn · bảng «Không đủ điều kiện» · dòng ở chi tiết nguồn · khối ở thử tính.
 *
 * Vì sao có tệp này: các màn này chỉ được bao bằng `tsc`, mà `tsc` không thấy chuỗi sai nghĩa. Yêu cầu chủ dự án — «không để user chỉ thấy tổng giảm 1% mà không biết lý do» — là
 * một câu về CHỮ TRÊN MÀN; ca nào khẳng định "không thấy X" đều kèm đối chứng dương (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Server Action không chạy ở đây — `GiaiThichSheet` nhận hàm tiêm; module chỉ cần tồn tại.
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/so/_actions", () => ({ moViSaoAction: vi.fn(), moGiaiThichAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { DongGiaiThichTrang } from "@/lib/hoa-hong/giai-thich-doc";
import { chiTietCuaSo, dungNhanGiaiThich } from "@/lib/hoa-hong/giai-thich-khong-tien";
import type { GiaiThichMo, KetQuaMoGiaiThich } from "@/lib/hoa-hong/giai-thich-ket-qua";
import type { ViSaoDayDu } from "@/lib/hoa-hong/vi-sao-day-du";
import { BangGiaiThich } from "../../../app/(admin)/admin/nguon-hoa-hong/so/_components/bang-giai-thich";
import { BoLocGiaiThichForm } from "../../../app/(admin)/admin/nguon-hoa-hong/so/_components/bo-loc-giai-thich";
import { DongKhoanNgoaiCuaSo, GiaiThichBang } from "./giai-thich-noi-dung";
import { GiaiThichSheet, GiaiThichThan } from "./giai-thich-sheet";
import { QueueToggle } from "./queue-toggle";
import { ViSaoNoiDung } from "./vi-sao-noi-dung";

afterEach(cleanup);

const CHI_TIET = chiTietCuaSo({ attributedAt: new Date("2026-09-12T03:00:00.000Z"), ngayThuDau: new Date("2026-12-20T03:00:00.000Z"), cuaSoNgay: 90 });

const dongGt = (p: Partial<DongGiaiThichTrang> = {}): DongGiaiThichTrang => ({
  id: "g1",
  reasonCode: "ATTRIBUTION_WINDOW_EXPIRED",
  roleCode: "SOURCE_OWNER",
  tenVai: "Người phụ trách nguồn",
  tenNhom: "Quảng cáo",
  tenChinhSach: "Marketing",
  documentNumber: "SR.QD.208",
  versionNo: 1,
  calcKind: "PERCENT",
  rate: 0.01,
  fixedAmount: null,
  wouldBeAmount: 440_000,
  chiTiet: CHI_TIET,
  daCoTien: false,
  calcSlotId: "s1",
  paymentId: "p1",
  centerId: "c1",
  naturalPeriod: "2026-12",
  nguoiHuong: { kind: "USER", id: "u1", ten: "Lê Thị Phương Liên" },
  tenHocVien: "Nguyễn Bảo Minh — MAKEUP",
  netBase: 44_000_000,
  taoLuc: "2026-12-21T01:00:00.000Z",
  ...p,
});

const viSao = (p: Partial<ViSaoDayDu> = {}): ViSaoDayDu => ({
  tieuDe: "Hoa hồng phát sinh từ khoản thu · Sale",
  tomTat: { nguoiHuong: "Trần Văn Sale", vai: "Sale", soTien: 1_760_000 },
  muc: [{ nhan: "Cơ sở tính", giaTri: "44.000.000đ" }],
  canhBao: [],
  dieuChinh: [],
  thoiGian: [{ luc: "2026-12-21T01:00:00.000Z", nhan: "Ghi vào sổ", nguoi: null, lyDo: null }],
  khongPhatSinh: [],
  ...p,
});

describe("[GTK-UI-1] ngăn «Vì sao»: mục «Vai không phát sinh tiền ở khoản này» nói ĐỦ năm điều", () => {
  const nhan = dungNhanGiaiThich(dongGt());
  it("có mục: tên vai · người, Nguồn, Chính sách + tỉ lệ, Điều kiện «Không đủ điều kiện», Lý do + mã máy, Hoa hồng 0đ + «Lẽ ra» — theo đúng thứ tự đọc", () => {
    render(<ViSaoNoiDung du={viSao({ khongPhatSinh: [{ id: "g1", nguoiHuong: "Lê Thị Phương Liên", vai: "Người phụ trách nguồn", nhan }] })} />);
    const muc = screen.getByRole("heading", { name: "Vai không phát sinh tiền ở khoản này" }).closest("section")!;
    expect(muc.textContent).toContain("Người phụ trách nguồn · Lê Thị Phương Liên");
    const nhanDt = Array.from(muc.querySelectorAll("dt")).map((e) => e.textContent);
    expect(nhanDt).toEqual(["Nguồn", "Chính sách", "Điều kiện", "Lý do", "Hoa hồng"]);
    const dd = Array.from(muc.querySelectorAll("dd")).map((e) => e.textContent ?? "");
    expect(dd[0]).toBe("Quảng cáo");
    expect(dd[1]).toContain("Marketing");
    expect(dd[1]).toContain("1%");
    expect(dd[2]).toBe("Không đủ điều kiện");
    expect(dd[3]).toContain("Khoản thu đầu tiên 20/12/2026 sau hạn ghi công 11/12/2026");
    expect(dd[3]).toContain("ATTRIBUTION_WINDOW_EXPIRED");
    expect(dd[4]).toContain("0đ");
    expect(dd[4]).toContain("Lẽ ra: 440.000đ");
    expect(dd[4]).toContain("không phải khoản nợ");
  });
  it("chip «Không đủ điều kiện» TRUNG TÍNH (không đỏ/cam): đây là kết quả bình thường của luật, không phải lỗi", () => {
    render(<GiaiThichBang nhan={nhan} />);
    const chip = screen.getByText("Không đủ điều kiện");
    expect(chip.className).toContain("text-muted-foreground");
    expect(chip.className).not.toMatch(/danger|warning/);
  });
  it("đối chứng dương: ngăn KHÔNG có vai nào để nói ⇒ KHÔNG vẽ mục (không khung rỗng)", () => {
    render(<ViSaoNoiDung du={viSao()} />);
    expect(screen.queryByRole("heading", { name: "Vai không phát sinh tiền ở khoản này" })).toBeNull();
    expect(screen.getByText("Cơ sở tính")).toBeTruthy(); // ngăn vẫn vẽ phần còn lại
  });
  it("giải thích đã bị THAY THẾ (có dòng sổ thật) ⇒ nói «Đã được thay thế»", () => {
    const thay = dungNhanGiaiThich(dongGt({ daCoTien: true }));
    render(<ViSaoNoiDung du={viSao({ khongPhatSinh: [{ id: "g1", nguoiHuong: null, vai: "Người phụ trách nguồn", nhan: thay }] })} />);
    expect(screen.getByText(/Đã được thay thế/)).toBeTruthy();
  });
});

describe("[GTK-UI-2] góc nhìn Sổ: công tắc và bảng «Không đủ điều kiện»", () => {
  it("công tắc có mục «Không đủ điều kiện (N)» ĐÚNG đường dẫn; vắng prop ⇒ không vẽ (đối chứng: các tab khác dùng cũ giữ nguyên)", () => {
    const { rerender } = render(<QueueToggle basePath="/nguon-hoa-hong/so" dangXem="tat-ca" soCanXuLy={3} giu={{ coSo: "c1" }} khongDuDieuKien={{ so: 7 }} />);
    const link = screen.getByRole("link", { name: /Không đủ điều kiện/ });
    expect(link.textContent).toContain("(7)");
    expect(link.getAttribute("href")).toBe("/nguon-hoa-hong/so?coSo=c1&xem=khong-du-dieu-kien");
    expect(screen.getByRole("link", { name: /Cần xử lý/ })).toBeTruthy();
    rerender(<QueueToggle basePath="/nguon-hoa-hong/so" dangXem="tat-ca" soCanXuLy={3} giu={{ coSo: "c1" }} />);
    expect(screen.queryByRole("link", { name: /Không đủ điều kiện/ })).toBeNull();
  });
  it("người chỉ có view-self (`anCanXuLy`): KHÔNG vẽ «Cần xử lý» (nút dẫn vào màn trang không mở cho họ là lời hứa suông); vẫn có «Tất cả» và «Không đủ điều kiện»", () => {
    render(<QueueToggle basePath="/nguon-hoa-hong/so" dangXem="khong-du-dieu-kien" soCanXuLy={null} anCanXuLy khongDuDieuKien={{ so: 2 }} />);
    expect(screen.queryByRole("link", { name: /Cần xử lý/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Tất cả" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Không đủ điều kiện/ }).getAttribute("aria-current")).toBe("page");
  });
  it("bảng: dòng có Người hưởng dự kiến · vai · học viên · nguồn · chính sách · chip · lý do ngắn · «0đ» + «Lẽ ra» ở dòng phụ; cả dòng là vùng bấm có nhãn đầy đủ", () => {
    render(<BangGiaiThich dong={[dongGt()]} tong={1} trang={1} kichThuoc={50} hrefTrang={(t) => `/x?trang=${t}`} />);
    const hang = document.querySelector("tbody tr")!;
    expect(hang.textContent).toContain("Lê Thị Phương Liên");
    expect(hang.textContent).toContain("Nguyễn Bảo Minh — MAKEUP");
    expect(hang.textContent).toContain("Quảng cáo");
    expect(hang.textContent).toContain("SR.QD.208 v1");
    expect(hang.textContent).toContain("Không đủ điều kiện");
    expect(hang.textContent).toContain("Quá hạn 9 ngày");
    expect(hang.textContent).toContain("0đ");
    expect(hang.textContent).toContain("Lẽ ra 440.000đ");
    expect(hang.className).toContain("cursor-pointer");
    expect(within(hang as HTMLElement).getByRole("button", { name: /Xem vì sao Lê Thị Phương Liên không có hoa hồng, lẽ ra 440\.000đ/ })).toBeTruthy();
    expect(screen.getByText(/Hiển thị/).textContent).toContain("1–1");
  });
  it("dòng đã có tiền thật ⇒ cột Điều kiện nói «Đã được thay thế», không còn «Quá hạn…»", () => {
    render(<BangGiaiThich dong={[dongGt({ daCoTien: true })]} tong={1} trang={1} kichThuoc={50} hrefTrang={(t) => `/x?trang=${t}`} />);
    const hang = document.querySelector("tbody tr")!;
    expect(hang.textContent).toContain("Đã được thay thế");
    expect(hang.textContent).not.toContain("Quá hạn");
  });
  it("bộ lọc chỉ có BỐN ô mà bảng đọc được (Kỳ · Vai · Người · Nguồn) — không Loại GD / Trạng thái; view-self không có ô Người", () => {
    const lua = { thang: ["2026-12"], vai: [{ code: "SOURCE_OWNER", ten: "Người phụ trách nguồn" }], nguoiHuong: [{ id: "u1", ten: "Lê Thị Phương Liên" }], nhomNguon: [{ code: "Q", ten: "Quảng cáo" }] };
    const gia = { thang: "", vai: "", nguoi: "", nguon: "Q" };
    const { rerender } = render(<BoLocGiaiThichForm basePath="/nguon-hoa-hong/so" giu={{ xem: "khong-du-dieu-kien" }} lua={lua} gia={gia} coLoc />);
    expect(Array.from(document.querySelectorAll("select")).map((s) => s.getAttribute("name"))).toEqual(["thang", "vai", "nguoi", "nguon"]);
    expect((document.querySelector("select[name=nguon]") as HTMLSelectElement).value).toBe("Q");
    expect(screen.getByRole("link", { name: "Bỏ lọc" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?xem=khong-du-dieu-kien");
    rerender(<BoLocGiaiThichForm basePath="/nguon-hoa-hong/so" giu={{ xem: "khong-du-dieu-kien" }} lua={{ ...lua, nguoiHuong: [] }} gia={gia} coLoc={false} />);
    expect(Array.from(document.querySelectorAll("select")).map((s) => s.getAttribute("name"))).toEqual(["thang", "vai", "nguon"]);
    expect(screen.queryByRole("link", { name: "Bỏ lọc" })).toBeNull();
  });
});

describe("[GTK-UI-3] ngăn riêng: bốn trạng thái và nội dung", () => {
  const du: GiaiThichMo = { id: "g1", vai: "Người phụ trách nguồn", nguoiHuong: "Lê Thị Phương Liên", tenHocVien: "Bé Na", ky: "2026-12", nhan: dungNhanGiaiThich(dongGt()) };
  const mo = (r: KetQuaMoGiaiThich) => vi.fn(async () => r);
  const mocNgan = (tai: ReturnType<typeof mo>) => (
    <GiaiThichSheet id="g1" moTa="Lê Thị Phương Liên · Người phụ trách nguồn" mo={tai} triggerAriaLabel="mở">
      <span>mở</span>
    </GiaiThichSheet>
  );
  it("mở ⇒ gọi `mo(id)` ĐÚNG MỘT lần với id dòng; sẵn sàng: 0đ + đủ năm điều; header nói người · vai", async () => {
    const tai = mo({ ok: true, du });
    render(mocNgan(tai));
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    await waitFor(() => expect(screen.getByText("Khoản thu đầu tiên 20/12/2026 sau hạn ghi công 11/12/2026 (trễ 9 ngày; cửa sổ 90 ngày kể từ 12/09/2026).")).toBeTruthy());
    expect(tai).toHaveBeenCalledTimes(1);
    expect(tai).toHaveBeenCalledWith("g1");
    expect(screen.getByText("Vì sao không có hoa hồng")).toBeTruthy();
    expect(screen.getByText(/Lê Thị Phương Liên · vai Người phụ trách nguồn/)).toBeTruthy();
    expect(screen.getByText("ATTRIBUTION_WINDOW_EXPIRED")).toBeTruthy();
  });
  it("lỗi: câu tiếng Việt từ máy chủ + «Thử lại» gọi lại; dòng ngoài tầm nhìn nói y như dòng không tồn tại", async () => {
    const tai = vi.fn().mockResolvedValueOnce({ ok: false, error: "Không tìm thấy khoản này." }).mockResolvedValueOnce({ ok: true, du });
    render(mocNgan(tai));
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Không tìm thấy khoản này."));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(screen.getByText("ATTRIBUTION_WINDOW_EXPIRED")).toBeTruthy());
    expect(tai).toHaveBeenCalledTimes(2);
  });
  it("hàm tải ném ⇒ vẫn ra câu lỗi, không treo ở «Đang tải»", async () => {
    render(mocNgan(vi.fn().mockRejectedValue(new Error("mạng"))));
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Không tải được ngăn này"));
  });
  it("thân ngăn thuần: «thay thế» hiện khi đã có tiền; vắng khi chưa (đối chứng dương)", () => {
    const { rerender } = render(<GiaiThichThan du={du} />);
    expect(screen.queryByText(/Đã được thay thế/)).toBeNull();
    rerender(<GiaiThichThan du={{ ...du, nhan: dungNhanGiaiThich(dongGt({ daCoTien: true })) }} />);
    expect(screen.getByText(/Đã được thay thế/)).toBeTruthy();
  });
});

describe("[GTK-UI-4] chi tiết nguồn: «Khoản ngoài cửa sổ» chỉ khi có khoản; có liên kết khi tab Sổ mở được", () => {
  it("N > 0: nói số khoản, 0đ hoa hồng thu hút, lẽ ra X, không phải khoản nợ + liên kết «Xem các khoản này» tới góc nhìn đã lọc nguồn", () => {
    render(<DongKhoanNgoaiCuaSo soKhoan={3} leRa={1_320_000} href="/nguon-hoa-hong/so?xem=khong-du-dieu-kien&nguon=PAID_ADS" />);
    const p = document.querySelector("[data-ngoai-cua-so]")!;
    expect(p.textContent).toContain("3");
    expect(p.textContent).toContain("1.320.000đ");
    expect(p.textContent).toContain("không phải khoản nợ");
    expect(within(p as HTMLElement).getByRole("link", { name: "Xem các khoản này" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?xem=khong-du-dieu-kien&nguon=PAID_ADS");
  });
  it("N = 0 ⇒ KHÔNG vẽ gì (đối chứng dương ở ca trên); href null (bộ máy tắt) ⇒ vẫn nói số, KHÔNG vẽ liên kết chết", () => {
    const { container, rerender } = render(<DongKhoanNgoaiCuaSo soKhoan={0} leRa={0} href="/x" />);
    expect(container.textContent).toBe("");
    rerender(<DongKhoanNgoaiCuaSo soKhoan={2} leRa={500_000} href={null} />);
    expect(container.textContent).toContain("500.000đ");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
