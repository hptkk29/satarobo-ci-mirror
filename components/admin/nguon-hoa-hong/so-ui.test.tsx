// @vitest-environment jsdom
/**
 * [NHH-SO-FE-*] — TAB SỔ HOA HỒNG trên PHẦN TỬ THẬT (jsdom): bảng sổ · bảng hàng chờ · ngăn "Vì sao" · khối "dự kiến của bạn" · bộ lọc · pill.
 *
 * Vì sao có tệp này: các màn này chỉ được bao bằng `tsc`, mà `tsc` không thấy chuỗi sai nghĩa — dòng bấm vào ra sai đích, tiền âm không tô đỏ, mũi tên trỏ lộn,
 * "0đ" thay cho "chưa tính được", ô lọc nói "Mọi kỳ" trong khi bảng đã bị lọc. Mỗi ca "KHÔNG thấy X" có đối chứng dương (CLAUDE.md luật 11).
 *
 * Fixture CỐ Ý LỆCH: số tiền 9 chữ số, kỳ ghi ≠ kỳ hiệu lực, tổng không chia hết cho cỡ trang.
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
// Server Action không chạy ở đây — `ViSaoSheet` nhận hàm tiêm; module chỉ cần tồn tại.
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/so/_actions", () => ({ moViSaoAction: vi.fn() }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions", () => ({ taoKhieuNaiAction: vi.fn() }));
// Nút "Dời sang kỳ sau" (HangChoSoBang) import action của tab Kỳ — kéo next-auth + Prisma nên phải giả; ca của nút ở `nut-doi-ky-sau.test.tsx`.
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/ky/_actions", () => ({ doiHangChoSangKySauAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CommissionHoldCode } from "@prisma/client";
import type { DongSoTrang } from "@/lib/hoa-hong/doc-so-giao-dien";
import type { DongHangChoSo } from "@/lib/hoa-hong/hang-cho-so-doc";
import type { DuKienManHinh } from "@/lib/hoa-hong/du-kien-man-hinh";
import type { LuaChonBoLocSo } from "@/lib/hoa-hong/doc-so-giao-dien";
import type { ViSaoDayDu } from "@/lib/hoa-hong/vi-sao-day-du";
import { BangSo } from "../../../app/(admin)/admin/nguon-hoa-hong/so/_components/bang-so";
import { BoLocSoForm, ChipNhomHangCho } from "../../../app/(admin)/admin/nguon-hoa-hong/so/_components/bo-loc";
import { DaiSoCu } from "../../../app/(admin)/admin/nguon-hoa-hong/so/_components/dai-so-cu";
import { nutKhieuNaiDong } from "../../../app/(admin)/admin/nguon-hoa-hong/so/_components/nut-khieu-nai-dong";
import { HangChoSoBang } from "../../../app/(admin)/admin/nguon-hoa-hong/so/_components/hang-cho-so-bang";
import { HangChoPill, NHAN_TRANG_THAI_CHI_NGAN, TONE_HANG_CHO, TONE_TRANG_THAI_CHI, TrangThaiChiPill } from "./commission-status-pill";
import { NHAN_TRANG_THAI_CHI } from "@/lib/hoa-hong/vi-sao-day-du";
import { HoaHongDuKien } from "./hoa-hong-du-kien";
import { ViSaoNoiDung } from "./vi-sao-noi-dung";
import { ViSaoSheet } from "./vi-sao-sheet";

afterEach(cleanup);

const dongSo = (p: Partial<DongSoTrang> = {}): DongSoTrang => ({
  id: "e1",
  kyGhi: "2026-11",
  kyHieuLuc: "2026-10",
  lateArrival: false,
  kind: "ORIGINAL",
  paymentId: "p1",
  orderId: "o1",
  studentId: "s1",
  leadId: "l1",
  roleCode: "SALE",
  nguoiHuong: { kind: "USER", id: "u1", ten: "Lê Thị Phương Liên" },
  amount: 80_000,
  grossAmount: 4_000_000,
  netBase: 4_000_000,
  vatRate: 0,
  rate: 0.02,
  nhomNguon: "EMPLOYEE_REFERRAL",
  tenNhomNguon: "Nguồn từ nhân sự giới thiệu",
  tenVai: "Sale",
  vanBan: "SR.QD.231",
  versionNo: 2,
  loaiGiaoDich: "RENEWAL",
  lyDo: "x",
  maLyDo: null,
  centerId: "c1",
  payoutStatus: "PENDING",
  refEntryId: null,
  taoLuc: new Date("2026-11-02T00:00:00Z"),
  tenHocVien: "Nguyễn Bảo Minh — MAKEUP",
  ...p,
});

const hangCuaBang = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr"));
const hrefTrang = (t: number) => `/nguon-hoa-hong/so?xem=tat-ca&trang=${t}`;

describe("[NHH-SO-FE-01] BangSo — dòng bấm được, đúng đích, không nói dối", () => {
  it("[NHH-SO-FE-01] nút 'Vì sao' nêu SỐ TIỀN và TÊN người hưởng; vùng bấm phủ kín hàng (kể cả ô dính); title mang đủ ngữ cảnh; không có link trong tbody", () => {
    render(<BangSo dong={[dongSo()]} tong={1} trang={1} kichThuoc={50} hrefTrang={hrefTrang} />);
    const nut = screen.getByRole("button", { name: "Xem vì sao 80.000đ của Lê Thị Phương Liên" });
    expect(nut.className).toContain("after:inset-0");
    expect(nut.className).toContain("after:z-20"); // trên ô dính (z-10) để lớp phủ che CẢ ô "Người hưởng"
    expect(hangCuaBang()[0]!.className).toContain("relative");
    expect(hangCuaBang()[0]!.className).toContain("cursor-pointer");
    expect(nut.getAttribute("title")).toBe("Lê Thị Phương Liên · Sale · Nguyễn Bảo Minh — MAKEUP · Nguồn từ nhân sự giới thiệu · SR.QD.231 v2");
    expect(document.querySelectorAll("tbody a")).toHaveLength(0);
    // nút KHÔNG tự định vị (nếu `relative` thì lớp phủ co về đúng ô nút — hàng thôi là vùng bấm)
    expect(nut.className).not.toMatch(/(^|\s)(relative|absolute|sticky)(\s|$)/);
  });

  it("[NHH-SO-FE-02] cột theo bố cục đã chốt (Vai nằm dưới tên, Chính sách dưới Nguồn); ô 'Người hưởng' dính trái (tablet); điện thoại chỉ còn Người hưởng · Hoa hồng · chevron", () => {
    render(<BangSo dong={[dongSo()]} tong={1} trang={1} kichThuoc={50} hrefTrang={hrefTrang} />);
    const heads = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent || th.getAttribute("aria-label"));
    expect(heads).toEqual(["Kỳ", "Người hưởng", "Học viên", "Nguồn", "Loại GD", "Tiền gốc", "Tỷ lệ", "Hoa hồng", "Trạng thái", "Xem vì sao"]);
    // vai + chính sách KHÔNG mất: nằm ở dòng thứ hai của ô
    const tr = hangCuaBang()[0]!;
    expect(tr.querySelectorAll("td")[1]!.textContent).toContain("Sale");
    expect(tr.querySelectorAll("td")[3]!.textContent).toContain("SR.QD.231 v2");
    // điện thoại (< md): chỉ Người hưởng · Hoa hồng · chevron không bị `hidden`; mọi cột còn lại có `hidden md:table-cell`
    const hien = Array.from(document.querySelectorAll("thead th")).filter((th) => !th.className.includes("hidden")).map((th) => th.textContent || th.getAttribute("aria-label"));
    expect(hien).toEqual(["Người hưởng", "Hoa hồng", "Xem vì sao"]);
    const o = tr.querySelectorAll("td")[1]!;
    expect(o.className).toContain("sticky");
    expect(o.className).toContain("left-0");
    expect(document.querySelectorAll("thead th")[1]!.className).toContain("sticky");
  });

  it("[NHH-SO-FE-03] tiền: căn phải, tabular-nums, 9 chữ số đủ; dòng ÂM in '−' tô danger, dòng dương thì KHÔNG; mọi ô nowrap", () => {
    render(
      <BangSo
        dong={[
          dongSo({ id: "a", amount: 955_563_000, netBase: 955_563_000 }),
          dongSo({ id: "b", amount: -32_000, netBase: -1_600_000, grossAmount: -1_600_000, kind: "REVERSAL", refEntryId: "a" }),
        ]}
        tong={2}
        trang={1}
        kichThuoc={50}
        hrefTrang={hrefTrang}
      />,
    );
    const [duong, am] = hangCuaBang() as [HTMLElement, HTMLElement];
    const cell = (tr: HTMLElement, i: number) => tr.querySelectorAll("td")[i]!;
    expect(cell(duong, 7).textContent).toBe("955.563.000đ");
    expect(cell(duong, 7).className).toContain("text-right");
    expect(cell(duong, 7).querySelector(".tabular-nums")).not.toBeNull();
    expect(cell(duong, 7).querySelector(".text-state-danger-ink")).toBeNull(); // đối chứng dương: tiền dương KHÔNG đỏ
    expect(cell(am, 7).textContent).toBe("−32.000đ");
    expect(cell(am, 7).querySelector(".text-state-danger-ink")).not.toBeNull();
    expect(cell(am, 5).textContent).toBe("−1.600.000đ");
    expect(cell(am, 5).querySelector(".text-state-danger-ink")).not.toBeNull();
    // Hoa hồng KHÔNG bị `hidden` ở điện thoại: đó là con số người ta mở sổ để xem
    expect(cell(duong, 7).className).not.toContain("hidden");
    for (const td of Array.from(document.querySelectorAll("tbody td"))) expect(td.className, td.textContent ?? "").toContain("whitespace-nowrap");
    for (const th of Array.from(document.querySelectorAll("thead th"))) expect(th.className).toContain("whitespace-nowrap");
  });

  it("[NHH-SO-FE-04] mũi tên ↳ CHỈ ở dòng điều chỉnh (có refEntryId); dòng gốc không có", () => {
    render(
      <BangSo
        dong={[dongSo({ id: "a" }), dongSo({ id: "b", kind: "REVERSAL", refEntryId: "a", amount: -1000 })]}
        tong={2}
        trang={1}
        kichThuoc={50}
        hrefTrang={hrefTrang}
      />,
    );
    const [goc, dc] = hangCuaBang() as [HTMLElement, HTMLElement];
    expect(within(goc).queryByRole("img", { name: /Điều chỉnh của một dòng gốc/ })).toBeNull();
    expect(within(dc).getByRole("img", { name: /Điều chỉnh của một dòng gốc/ })).toBeTruthy();
    expect(dc.textContent).toContain("Thu hồi");
  });

  it("[NHH-SO-FE-05] kỳ đến muộn: kỳ ghi sổ ≠ kỳ hiệu lực được nói ra; loại giao dịch dùng chữ Việt", () => {
    render(<BangSo dong={[dongSo({ lateArrival: true, kind: "LATE_ARRIVAL" })]} tong={1} trang={1} kichThuoc={50} hrefTrang={hrefTrang} />);
    const tr = hangCuaBang()[0]!;
    expect(tr.querySelectorAll("td")[0]!.textContent).toBe("11/2026HL 10/2026");
    expect(tr.querySelectorAll("td")[4]!.textContent).toBe("Tái tục");
    expect(tr.querySelectorAll("td")[1]!.textContent).toContain("Đến muộn"); // nhãn loại dòng nằm dưới tên người hưởng
  });

  it("[NHH-SO-FE-08] ô tên: nhãn loại dòng đứng TRƯỚC vai (bị cắt thì cắt vai, không cắt 'Thu hồi'); nhóm nguồn UNKNOWN in 'Chưa rõ nguồn' chứ không câu dài lặp ở mọi dòng", () => {
    render(<BangSo dong={[dongSo({ kind: "REVERSAL", refEntryId: "a", amount: -1000 }), dongSo({ id: "u", nhomNguon: "UNKNOWN", tenNhomNguon: "Không rõ nguồn (hệ thống)" })]} tong={2} trang={1} kichThuoc={50} hrefTrang={hrefTrang} />);
    const [dc, u] = hangCuaBang() as [HTMLElement, HTMLElement];
    const dong2 = dc.querySelectorAll("td")[1]!.querySelectorAll("span.block")[0]!.textContent!.replace(/^\d{2}\/\d{4} · /, ""); // bỏ phần kỳ chỉ hiện ở điện thoại
    expect(dong2.indexOf("Thu hồi")).toBeLessThan(dong2.indexOf("Sale"));
    expect(dong2.startsWith("Thu hồi")).toBe(true);
    expect(u.querySelectorAll("td")[3]!.textContent).toContain("Chưa rõ nguồn");
    expect(u.querySelectorAll("td")[3]!.textContent).not.toContain("hệ thống");
    // đối chứng: nhóm thật vẫn in đúng tên
    expect(dc.querySelectorAll("td")[3]!.textContent).toContain("Nguồn từ nhân sự giới thiệu");
  });

  it("[NHH-SO-FE-09] ô tên dùng tên vai NGẮN (bỏ phần chú thích trong ngoặc) để nhãn loại + vai vừa một dòng; tên ĐẦY ĐỦ nằm ở title của nút (và trong ngăn 'Vì sao')", () => {
    render(<BangSo dong={[dongSo({ kind: "REVERSAL", refEntryId: "a", amount: -1000, tenVai: "Sale (người chốt đơn)" }), dongSo({ id: "q", tenVai: "Quản lý cơ sở" })]} tong={2} trang={1} kichThuoc={50} hrefTrang={hrefTrang} />);
    const [dc, q] = hangCuaBang() as [HTMLElement, HTMLElement];
    const dong2 = (tr: HTMLElement) => tr.querySelectorAll("td")[1]!.querySelectorAll("span.block")[0]!.textContent!.replace(/^\d{2}\/\d{4} · /, "");
    expect(dong2(dc)).toBe("Thu hồi · Sale");
    expect(dong2(q)).toBe("Quản lý cơ sở"); // tên không có ngoặc giữ nguyên
    expect(dc.querySelector("[data-nut-hang]")!.getAttribute("title")).toContain("Sale (người chốt đơn)");
  });

  it("[NHH-SO-FE-06] 'Hiển thị từ–đến / tổng' đúng cho trang giữa; tổng không chia hết cỡ trang; thiếu ô ⇒ '—' chứ không trống", () => {
    render(<BangSo dong={[dongSo({ tenHocVien: null, vanBan: null, versionNo: null, rate: null })]} tong={123} trang={2} kichThuoc={50} hrefTrang={hrefTrang} />);
    expect(screen.getByText(/Hiển thị/).textContent).toBe("Hiển thị 51–100 / 123 dòng");
    const tr = hangCuaBang()[0]!;
    expect(tr.querySelectorAll("td")[2]!.textContent).toBe("—"); // học viên
    expect(tr.querySelectorAll("td")[6]!.textContent).toBe("—"); // tỷ lệ
    expect(tr.querySelectorAll("td")[3]!.textContent).toContain("—"); // chính sách (dòng hai của ô Nguồn)
  });

  it("[NHH-SO-FE-07] ↑/↓ chuyển giữa các nút dòng; hai đầu đứng yên (06 §7)", () => {
    render(<BangSo dong={[dongSo({ id: "a" }), dongSo({ id: "b" })]} tong={2} trang={1} kichThuoc={50} hrefTrang={hrefTrang} />);
    const nut = Array.from(document.querySelectorAll<HTMLElement>("[data-nut-hang]"));
    expect(nut).toHaveLength(2);
    nut[0]!.focus();
    fireEvent.keyDown(nut[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(nut[1]);
    fireEvent.keyDown(nut[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(nut[1]);
    fireEvent.keyDown(nut[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(nut[0]);
  });
});

const dongHC = (p: Partial<DongHangChoSo> = {}): DongHangChoSo => ({
  id: "h1",
  ma: "UNRESOLVED_BENEFICIARY",
  holdKey: "hk1",
  tenMa: "Chưa phân giải người hưởng",
  nhom: "CHUA_PHAN_GIAI_NGUOI_HUONG",
  loai: "CHUA_PHAN_GIAI_NGUOI_HUONG",
  chanKhoa: false,
  paymentId: "pay_1",
  orderId: "ord_9",
  orderItemId: null,
  studentId: "stu_1",
  centerId: "cs2",
  vai: "SALE",
  lyDoMa: "KHONG_CO_LEAD",
  khongCoLead: true,
  lyDo: "Vai Sale: Đơn chưa nối lead — chưa biết ai chốt khách nên chưa có người nhận phần này",
  buoc: "Nối đơn với lead rồi Tính lại kỳ",
  lienKet: { nhan: "Mở đơn", href: "/orders/ord_9" },
  kyChan: null,
  doiDuoc: false,
  coSo: { code: "CS2", ten: "Cơ sở 114 Hoàng Diệu" },
  tenHocVien: "Nguyễn Bảo Minh",
  tienVai: 955_563_000,
  taoLuc: new Date("2026-11-02T00:00:00Z"),
  ...p,
});

describe("[NHH-SO-FE-10] HangChoSoBang — lý do + việc tiếp theo, không phát minh trạng thái", () => {
  it("[NHH-SO-FE-10] ĐƠN KHÔNG LEAD: pill 'Đơn chưa nối lead' (không phải mã), lý do bằng chữ, link ĐƠN, KHÔNG có chữ 'nguồn' trong việc tiếp theo; không chặn khoá", () => {
    render(<HangChoSoBang dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} coTheDoiKy={false} />);
    const tr = hangCuaBang()[0]!;
    expect(within(tr).getByText("Đơn chưa nối lead")).toBeTruthy();
    expect(within(tr).queryByText("Chưa có người nhận")).toBeNull();
    expect(tr.textContent).toContain("Không chặn khoá");
    expect(tr.textContent).toContain("Nối đơn với lead rồi Tính lại kỳ");
    // MỘT component, hai chỗ vẽ (cột ≥ lg + dưới lý do < lg): cả hai cùng đích — và đúng HAI link, không ba
    const lienKet = within(tr).getAllByRole("link", { name: /Mở đơn/ });
    expect(lienKet.map((a) => a.getAttribute("href"))).toEqual(["/orders/ord_9", "/orders/ord_9"]);
    expect(tr.textContent).not.toMatch(/gán nguồn/i);
    expect(tr.textContent).not.toContain("UNRESOLVED");
  });

  it("[NHH-SO-FE-11] tiền 9 chữ số không tràn; thiếu tiền/học viên/cơ sở ⇒ nói thẳng, không để trống; việc chặn khoá nêu kỳ", () => {
    render(
      <HangChoSoBang
        dong={[
          dongHC(),
          dongHC({ id: "h2", ma: "INPUT_DRIFT", nhom: "CHAN_KHOA_KY", loai: "CHO_DIEU_CHINH", khongCoLead: false, chanKhoa: true, kyChan: "2026-10", tienVai: null, tenHocVien: null, coSo: null, lienKet: null, lyDo: "Dữ liệu đổi.", buoc: "Người duyệt chọn áp dụng thay đổi hoặc giữ nguyên" }),
        ]}
        tong={2}
        trang={1}
        kichThuoc={25}
        hrefTrang={hrefTrang}
        coTheDoiKy={false}
      />,
    );
    const [a, b] = hangCuaBang() as [HTMLElement, HTMLElement];
    expect(a.querySelectorAll("td")[3]!.textContent).toBe("955.563.000đ");
    expect(a.querySelectorAll("td")[3]!.className).toContain("tabular-nums");
    expect(b.querySelectorAll("td")[3]!.textContent).toBe("—");
    expect(b.querySelectorAll("td")[2]!.textContent).toContain("—"); // không có học viên ⇒ "—", không bịa
    expect(b.querySelectorAll("td")[2]!.textContent).toContain("Chưa quy được cơ sở");
    expect(b.textContent).toContain("Chặn kỳ 10/2026");
    expect(a.textContent).toContain("Không chặn khoá"); // chỉ NGOẠI LỆ được đánh dấu ở dưới pill (mọi dòng "Chặn khoá kỳ" y hệt nhau là nhiễu)
    expect(within(a).queryByText(/^Chặn/)).toBeNull();
    // thiếu quyền mở trang đích ⇒ KHÔNG có link, vẫn có việc bằng chữ (đối chứng dương: dòng a có link)
    expect(within(b).queryByRole("link")).toBeNull();
    expect(within(a).getAllByRole("link").length).toBe(2);
    expect(b.textContent).toContain("Người duyệt chọn áp dụng thay đổi");
  });

  it("[NHH-SO-FE-12] mọi ô nowrap trừ ô chữ dài; chiều cao dòng cố định (ngoại lệ 'dòng là văn bản'); không dòng nào là vùng bấm giả", () => {
    render(<HangChoSoBang dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} coTheDoiKy={false} />);
    const tr = hangCuaBang()[0]!;
    expect(tr.className).toContain("h-[3.75rem]");
    expect(tr.className).not.toContain("cursor-pointer");
    expect(tr.className).not.toMatch(/(^|\s)relative(\s|$)/);
    for (const th of Array.from(document.querySelectorAll("thead th"))) expect(th.className).toContain("whitespace-nowrap");
  });

  it("[NHH-SO-FE-14] bề rộng đáp ứng: dưới lg chỉ còn hai cột (Việc | Vì sao) và phần còn lại nằm DƯỚI lý do; từ lg đủ năm cột — không cột nào mất hẳn ở mức nào", () => {
    render(<HangChoSoBang dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} coTheDoiKy={false} />);
    const heads = Array.from(document.querySelectorAll("thead th")).map((th) => ({ nhan: th.textContent, an: th.className.includes("hidden lg:table-cell") }));
    expect(heads).toEqual([
      { nhan: "Việc", an: false },
      { nhan: "Vì sao chưa ghi sổ", an: false },
      { nhan: "Học viên · Cơ sở", an: true },
      { nhan: "Tiền treo", an: true },
      { nhan: "Việc tiếp theo", an: true },
    ]);
    const duoi = document.querySelector("[data-viec-duoi-ly-do]") as HTMLElement;
    expect(duoi.className).toContain("lg:hidden");
    expect(duoi.textContent).toContain("Nối đơn với lead rồi Tính lại kỳ"); // việc tiếp theo
    expect(duoi.textContent).toContain("Nguyễn Bảo Minh"); // học viên
    expect(duoi.textContent).toContain("CS2"); // cơ sở
    const treo = duoi.querySelector("[data-tien-treo]") as HTMLElement; // tiền treo: DÒNG RIÊNG, không nằm cuối một dòng bị cắt (chụp thật 768/375: số tiền cụt ngay chỗ này)
    expect(treo.textContent).toBe("Tiền treo 955.563.000đ");
    expect(treo.className).not.toContain("truncate");
    // pill được xuống dòng trên điện thoại (cột Việc hẹp 7.5rem)
    expect(screen.getAllByText("Đơn chưa nối lead")[0]!.className).toContain("max-md:whitespace-normal");
  });

  it("[NHH-SO-FE-13] phân trang: 'Hiển thị 26–50 / 53 việc' và có điều hướng khi nhiều trang", () => {
    render(<HangChoSoBang dong={[dongHC()]} tong={53} trang={2} kichThuoc={25} hrefTrang={hrefTrang} coTheDoiKy={false} />);
    expect(screen.getByText(/Hiển thị/).textContent).toBe("Hiển thị 26–50 / 53 việc");
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/nguon-hoa-hong/so?xem=tat-ca&trang=3")).toBe(true);
  });
});

describe("[NHH-SO-FE-20] pill — tông ở MỘT chỗ", () => {
  it("[NHH-SO-FE-20] mọi mã hàng chờ và mọi trạng thái chi đều có tông; lỗi cấu hình/tiền bị rút = danger; đã chi = success", () => {
    expect(Object.keys(TONE_HANG_CHO).sort()).toEqual(Object.values(CommissionHoldCode).sort());
    expect(TONE_HANG_CHO.CAP_EXCEEDED).toBe("danger");
    expect(TONE_HANG_CHO.PAYMENT_WITHDRAWN).toBe("danger");
    expect(TONE_HANG_CHO.INPUT_DRIFT).toBe("warning");
    expect(TONE_HANG_CHO.UNRESOLVED_BENEFICIARY).toBe("muted");
    expect(TONE_TRANG_THAI_CHI.PAID).toBe("success");
    expect(TONE_TRANG_THAI_CHI.PENDING).toBe("muted");
  });

  it("[NHH-SO-FE-21] pill nowrap + chữ ink (không chữ sáng trượt AA)", () => {
    render(
      <>
        <TrangThaiChiPill trangThai="PAID" />
        <HangChoPill ma="CAP_EXCEEDED" />
      </>,
    );
    expect(screen.getByText("Đã chi").className).toContain("whitespace-nowrap");
    expect(screen.getByText("Đã chi").className).toContain("text-state-success-ink");
    expect(screen.getByText("Vượt trần tổng tỉ lệ").className).toContain("text-state-danger-ink");
  });

  it("[NHH-SO-FE-22] nhãn trạng thái chi: ô bảng dùng nhãn NGẮN (cột chỉ rộng 6rem), ô lọc/ngăn dùng nhãn đầy đủ — hai bộ phủ ĐỦ bốn trạng thái, không cái nào trùng nhãn khác", () => {
    const tat = ["PENDING", "APPROVED", "EXPORTED", "PAID"] as const;
    expect(new Set(tat.map((t) => NHAN_TRANG_THAI_CHI_NGAN[t])).size).toBe(4);
    render(
      <>
        <TrangThaiChiPill trangThai="EXPORTED" ngan />
        <TrangThaiChiPill trangThai="PAID" />
      </>,
    );
    expect(screen.getByText("Đã xuất")).toBeTruthy(); // ngắn
    expect(screen.getByText("Đã chi")).toBeTruthy();
    expect(screen.queryByText("Đã xuất bảng chi")).toBeNull();
    for (const t of tat) expect(NHAN_TRANG_THAI_CHI_NGAN[t].length).toBeLessThanOrEqual(NHAN_TRANG_THAI_CHI[t].length);
  });
});

const viSao = (p: Partial<ViSaoDayDu> = {}): ViSaoDayDu => ({
  tieuDe: "Hoa hồng phát sinh từ khoản thu · SALE",
  tomTat: { nguoiHuong: "Lê Thị Phương Liên", vai: "Sale", soTien: 80_000 },
  muc: [
    { nhan: "Khoản thu gốc", giaTri: "12/10/2026 · 4.000.000đ", ghiChu: "Kế toán xác nhận 12/10/2026" },
    { nhan: "Cơ sở tính", giaTri: "4.000.000đ" },
    { nhan: "Chính sách", giaTri: "SR.QD.231 · phiên bản 2", ghiChu: "thắng GLOBAL v3" },
    { nhan: "Hoa hồng", giaTri: "4.000.000đ × 2% = 80.000đ" },
  ],
  canhBao: [],
  dieuChinh: [],
  thoiGian: [{ luc: "2026-10-12T05:00:00.000Z", nhan: "Ghi vào sổ", nguoi: null, lyDo: null }],
  ...p,
});

describe("[NHH-SO-FE-30] ViSaoNoiDung — danh sách định nghĩa theo thứ tự nhân quả", () => {
  it("[NHH-SO-FE-30] <dl> dọc: mỗi bước một dt/dd đúng thứ tự, ghi chú nằm trong dd; số tiền tóm tắt đầu ngăn", () => {
    render(<ViSaoNoiDung du={viSao()} />);
    const dts = Array.from(document.querySelectorAll("dl dt")).map((e) => e.textContent);
    expect(dts).toEqual(["Khoản thu gốc", "Cơ sở tính", "Chính sách", "Hoa hồng"]);
    const dd = document.querySelectorAll("dl dd");
    expect(dd[0]!.textContent).toContain("Kế toán xác nhận 12/10/2026");
    expect(dd[3]!.textContent).toBe("4.000.000đ × 2% = 80.000đ");
    expect(screen.getByText("80.000đ")).toBeTruthy();
  });

  it("[NHH-SO-FE-31] điều chỉnh liên quan: mũi tên ↳, tiền âm đỏ, kỳ hiệu lực ≠ ghi sổ, dòng đang xem KHÔNG có nút; dòng khác có nút gọi onXemDong", () => {
    const onXem = vi.fn();
    render(
      <ViSaoNoiDung
        du={viSao({
          dieuChinh: [
            { id: "e0", nhan: "Hoa hồng phát sinh từ khoản thu", soTien: 400_000, ky: "Kỳ 10/2026", lyDo: null, laDongNay: false, laDongGoc: true, muiTen: false },
            { id: "e1", nhan: "Thu hồi do hoàn tiền / điều chỉnh giảm", soTien: -160_000, ky: "Hiệu lực 10/2026 · ghi vào kỳ 11/2026", lyDo: "Vì khoản thu bị hoàn hoặc điều chỉnh giảm", laDongNay: true, laDongGoc: false, muiTen: true },
          ],
        })}
        dangXem="e1"
        onXemDong={onXem}
      />,
    );
    const muc = screen.getByRole("heading", { name: "Điều chỉnh liên quan" }).closest("section")!;
    expect(within(muc).getByText("−160.000đ").className).toContain("text-state-danger-ink");
    expect(within(muc).getByText("400.000đ").className).not.toContain("text-state-danger-ink");
    expect(muc.textContent).toContain("Hiệu lực 10/2026 · ghi vào kỳ 11/2026");
    expect(muc.querySelectorAll("svg")).toHaveLength(1); // chỉ dòng điều chỉnh có mũi tên
    const nut = within(muc).getAllByRole("button", { name: "Xem dòng này" });
    expect(nut).toHaveLength(1); // dòng đang xem KHÔNG có nút
    fireEvent.click(nut[0]!);
    expect(onXem).toHaveBeenCalledWith("e0");
  });

  it("[NHH-SO-FE-32] không có điều chỉnh ⇒ không in mục 'Điều chỉnh liên quan' (đối chứng với FE-31); cảnh báo hiện khi có", () => {
    const { rerender } = render(<ViSaoNoiDung du={viSao()} />);
    expect(screen.queryByRole("heading", { name: "Điều chỉnh liên quan" })).toBeNull();
    rerender(<ViSaoNoiDung du={viSao({ canhBao: ["Dòng này ghi vào kỳ khác kỳ hiệu lực của khoản thu — kỳ cũ không bị mở lại."] })} />);
    expect(screen.getByText(/kỳ cũ không bị mở lại/)).toBeTruthy();
  });

  it("[NHH-SO-FE-33] dòng thời gian: giờ Việt Nam (UTC+7), có người + lý do khi có", () => {
    render(<ViSaoNoiDung du={viSao({ thoiGian: [{ luc: "2026-10-12T05:00:00.000Z", nhan: "Áp dụng thay đổi", nguoi: "Trần Kế Toán", lyDo: "Khách đổi nguồn" }] })} />);
    const muc = screen.getByRole("heading", { name: "Dòng thời gian" }).closest("section")!;
    expect(muc.textContent).toContain("12/10/2026 12:00");
    expect(muc.textContent).toContain("Trần Kế Toán");
    expect(muc.textContent).toContain("Khách đổi nguồn");
  });
});

describe("[NHH-SO-FE-40] ViSaoSheet — mở ⇒ tải ⇒ nội dung; mỗi lần mở là một lần tải mới", () => {
  const dung = (mo: (id: string) => Promise<{ ok: true; du: ViSaoDayDu } | { ok: false; error: string }>) =>
    render(
      <ViSaoSheet entryId="e1" moTa="Lê Thị Phương Liên · Sale" mo={mo} triggerAriaLabel="Xem vì sao">
        mở
      </ViSaoSheet>,
    );

  it("[NHH-SO-FE-40] bấm ⇒ gọi máy chủ ĐÚNG MỘT LẦN với id dòng ⇒ khung chờ role=status ⇒ nội dung; Esc đóng", async () => {
    let xong!: (v: { ok: true; du: ViSaoDayDu }) => void;
    const mo = vi.fn(() => new Promise<{ ok: true; du: ViSaoDayDu }>((r) => (xong = r)));
    dung(mo);
    expect(mo).not.toHaveBeenCalled(); // KHÔNG nạp sẵn khi chưa mở
    fireEvent.click(screen.getByRole("button", { name: "Xem vì sao" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(mo).toHaveBeenCalledTimes(1);
    expect(mo).toHaveBeenCalledWith("e1");
    xong({ ok: true, du: viSao() });
    await waitFor(() => expect(screen.getByText("4.000.000đ × 2% = 80.000đ")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Vì sao con số này")).toBeNull());
  });

  it("[NHH-SO-FE-41] lỗi máy chủ ⇒ câu tiếng Việt role=alert + 'Thử lại' gọi LẠI; ném lỗi mạng ⇒ cùng đường lỗi", async () => {
    const mo = vi.fn().mockResolvedValueOnce({ ok: false, error: "Không tìm thấy dòng hoa hồng này." }).mockResolvedValueOnce({ ok: true, du: viSao() });
    dung(mo);
    fireEvent.click(screen.getByRole("button", { name: "Xem vì sao" }));
    const loi = await screen.findByRole("alert");
    expect(loi.textContent).toContain("Không tìm thấy dòng hoa hồng này.");
    fireEvent.click(within(loi).getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(screen.getByText("4.000.000đ × 2% = 80.000đ")).toBeTruthy());
    expect(mo).toHaveBeenCalledTimes(2);
  });

  it("[NHH-SO-FE-42] ném lỗi (mất mạng) ⇒ KHÔNG treo ở khung chờ: có câu lỗi", async () => {
    dung(vi.fn().mockRejectedValue(new Error("network")));
    fireEvent.click(screen.getByRole("button", { name: "Xem vì sao" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Không tải được");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("[NHH-SO-FE-43] 'Xem dòng này' nạp dòng LIÊN QUAN; đóng rồi mở lại luôn bắt đầu từ dòng được bấm", async () => {
    const du1 = viSao({
      dieuChinh: [
        { id: "e0", nhan: "Gốc", soTien: 400_000, ky: "Kỳ 10/2026", lyDo: null, laDongNay: false, laDongGoc: true, muiTen: false },
        { id: "e1", nhan: "Thu hồi", soTien: -160_000, ky: "Kỳ 11/2026", lyDo: null, laDongNay: true, laDongGoc: false, muiTen: true },
      ],
    });
    const mo = vi.fn(async (id: string) => ({ ok: true as const, du: id === "e0" ? viSao({ tomTat: { nguoiHuong: "Lê Thị Phương Liên", vai: "Sale", soTien: 400_000 } }) : du1 }));
    dung(mo);
    fireEvent.click(screen.getByRole("button", { name: "Xem vì sao" }));
    fireEvent.click(await screen.findByRole("button", { name: "Xem dòng này" }));
    await waitFor(() => expect(mo).toHaveBeenLastCalledWith("e0"));
    await waitFor(() => expect(screen.getAllByText("400.000đ").length).toBeGreaterThan(0));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Vì sao con số này")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Xem vì sao" }));
    await waitFor(() => expect(mo).toHaveBeenLastCalledWith("e1"));
  });

  it("[NHH-SO-FE-44] chỗ neo hành động: chỉ vẽ khi ĐÃ tải xong VÀ đang xem chính dòng được bấm; không truyền ⇒ ngăn không có chân (đối chứng dương: truyền thì thấy)", async () => {
    const du1 = viSao({
      dieuChinh: [
        { id: "e0", nhan: "Gốc", soTien: 400_000, ky: "Kỳ 10/2026", lyDo: null, laDongNay: false, laDongGoc: true, muiTen: false },
        { id: "e1", nhan: "Thu hồi", soTien: -160_000, ky: "Kỳ 11/2026", lyDo: null, laDongNay: true, laDongGoc: false, muiTen: true },
      ],
    });
    const mo = vi.fn(async () => ({ ok: true as const, du: du1 }));
    // Không truyền ⇒ không có chân.
    const khong = render(
      <ViSaoSheet entryId="e1" moTa="x" mo={mo} triggerAriaLabel="Xem vì sao">
        mở
      </ViSaoSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xem vì sao" }));
    await screen.findByText("Điều chỉnh liên quan");
    expect(document.querySelector("[data-cho-neo-hanh-dong]")).toBeNull();
    khong.unmount();
    cleanup();
    // Có truyền ⇒ chưa tải xong thì CHƯA vẽ; tải xong thì vẽ.
    let xong!: (v: { ok: true; du: ViSaoDayDu }) => void;
    const cham = vi.fn(() => new Promise<{ ok: true; du: ViSaoDayDu }>((r) => (xong = r)));
    render(
      <ViSaoSheet entryId="e1" moTa="x" mo={cham} triggerAriaLabel="Xem vì sao" hanhDong={<button type="button">Khiếu nại dòng này</button>}>
        mở
      </ViSaoSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xem vì sao" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Khiếu nại dòng này" })).toBeNull();
    xong({ ok: true, du: du1 });
    expect(await screen.findByRole("button", { name: "Khiếu nại dòng này" })).toBeTruthy();
    // Sang dòng LIÊN QUAN (e0) ⇒ nút neo biến mất: nó nói về dòng ban đầu, đứng cạnh căn cứ của dòng khác là nói dối.
    cham.mockImplementation(() => Promise.resolve({ ok: true as const, du: viSao() }));
    fireEvent.click(screen.getByRole("button", { name: "Xem dòng này" }));
    await waitFor(() => expect(cham).toHaveBeenLastCalledWith("e0"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Khiếu nại dòng này" })).toBeNull());
  });

  it("[NHH-SO-FE-45] BangSo chuyển `hanhDong(dòng)` đúng cho TỪNG dòng tới ngăn của dòng đó (không dòng nào nhận nút của dòng khác); không truyền ⇒ không có chân", async () => {
    const { moViSaoAction } = await import("@/app/(admin)/admin/nguon-hoa-hong/so/_actions");
    vi.mocked(moViSaoAction).mockResolvedValue({ ok: true, du: viSao() });
    render(
      <BangSo dong={[dongSo({ id: "a1" }), dongSo({ id: "b2" })]} tong={2} trang={1} kichThuoc={50} hrefTrang={hrefTrang} hanhDong={(d) => <button type="button">{`Neo ${d.id}`}</button>} />,
    );
    const nut = Array.from(document.querySelectorAll<HTMLElement>("[data-nut-hang]"));
    fireEvent.click(nut[1]!);
    expect(await screen.findByRole("button", { name: "Neo b2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Neo a1" })).toBeNull();
  });

  it("[NHH-SO-FE-46] NÚT KHIẾU NẠI nối vào chỗ neo của BangSo: có ở dòng CỦA MÌNH, KHÔNG ở dòng của người khác / vai AFFILIATE trùng id / khi thiếu key (đối chứng dương: ca đầu có)", async () => {
    const { moViSaoAction } = await import("@/app/(admin)/admin/nguon-hoa-hong/so/_actions");
    vi.mocked(moViSaoAction).mockResolvedValue({ ok: true, du: viSao() });
    const dong = [
      dongSo({ id: "cua-toi", nguoiHuong: { kind: "USER", id: "u-xem", ten: "Tôi" } }),
      dongSo({ id: "cua-nguoi-khac", nguoiHuong: { kind: "USER", id: "u-khac", ten: "Người khác" } }),
      dongSo({ id: "cong-tac-vien", nguoiHuong: { kind: "AFFILIATE", id: "u-xem", ten: "CTV trùng id" } }),
    ];
    const ve = (coKey: boolean) => <BangSo dong={dong} tong={3} trang={1} kichThuoc={50} hrefTrang={hrefTrang} hanhDong={(d) => nutKhieuNaiDong(d, "u-xem", coKey)} />;
    const moDong = async (i: number) => {
      vi.mocked(moViSaoAction).mockClear();
      fireEvent.click(Array.from(document.querySelectorAll<HTMLElement>("[data-nut-hang]"))[i]!);
      await screen.findByRole("dialog");
      await waitFor(() => expect(moViSaoAction).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("status")).toBeNull()); // ngăn đã tải xong: nếu nút có thì nó đã hiện
    };
    const { unmount } = render(ve(true));
    await moDong(0);
    expect(screen.getByRole("button", { name: "Khiếu nại dòng này" })).toBeTruthy();
    unmount();
    cleanup();
    for (const i of [1, 2]) {
      render(ve(true));
      await moDong(i);
      expect(screen.queryByRole("button", { name: /Khiếu nại/ })).toBeNull();
      cleanup();
    }
    // thiếu key `commission:view-self` ⇒ dòng của mình cũng KHÔNG có nút (nút xám là lời hứa suông)
    render(ve(false));
    await moDong(0);
    expect(screen.queryByRole("button", { name: /Khiếu nại/ })).toBeNull();
  });
});

describe("[NHH-SO-FE-50] HoaHongDuKien — chỉ phần của mình; chưa tính được ≠ 0đ", () => {
  const hien = (p: Partial<Extract<DuKienManHinh, { loai: "HIEN" }>> = {}): DuKienManHinh => ({
    loai: "HIEN",
    daGhi: { tong: 0, dong: [] },
    duKien: null,
    chuaThe: [],
    giaDinh: [],
    ...p,
  });

  it("[NHH-SO-FE-50] AN ⇒ không vẽ gì; LOI ⇒ nói 'chưa tải được' (không im lặng)", () => {
    const { container, rerender } = render(<HoaHongDuKien du={{ loai: "AN" }} />);
    expect(container.innerHTML).toBe("");
    rerender(<HoaHongDuKien du={{ loai: "LOI" }} />);
    expect(screen.getByRole("status").textContent).toContain("Chưa tải được");
  });

  it("[NHH-SO-FE-51] đã ghi: tổng text-xl, từng dòng 'X / khoản Y đã thu' + nút Vì sao; dự kiến thêm; KHÔNG '0đ' khi chỉ có chưa-thể-tính", () => {
    render(
      <HoaHongDuKien
        du={hien({
          daGhi: { tong: 80_000, dong: [{ id: "e1", soTien: 80_000, khoanThu: 4_000_000, vai: "Sale", ky: "10/2026" }] },
          duKien: { tong: 160_000, dong: [{ vai: "Sale", soTien: 160_000 }] },
        })}
      />,
    );
    const dong = document.querySelector("ul li") as HTMLElement;
    expect(dong.textContent).toContain("80.000đ");
    expect(dong.textContent).toContain("Khoản 4.000.000đ đã thu · kỳ 10/2026");
    // số tiền: cột riêng, căn phải + tabular-nums (các dòng xếp thành cột thẳng hàng chữ số)
    const tien = within(dong).getByText("80.000đ");
    expect((tien.parentElement as HTMLElement).className).toContain("text-right");
    expect(tien.className).toContain("tabular-nums");
    // "Dự kiến thêm" là điều khối này sinh ra để nói ⇒ đứng TRƯỚC "Đã ghi vào sổ"
    const chu = document.body.textContent ?? "";
    expect(chu.indexOf("Dự kiến thêm")).toBeLessThan(chu.indexOf("Đã ghi vào sổ"));
    // không có lý do ⇒ KHÔNG in khối "Chưa thể tính" (đối chứng với ca dưới)
    expect(document.body.textContent).not.toContain("Chưa thể tính");
    expect(screen.getByRole("button", { name: "Vì sao 80.000đ kỳ 10/2026" })).toBeTruthy();
    expect(document.body.textContent).toContain("Dự kiến thêm");
    expect(document.body.textContent).toContain("160.000đ");

    cleanup();
    render(<HoaHongDuKien du={hien({ chuaThe: ["Dòng học phí chưa gắn học viên."] })} />);
    expect(document.body.textContent).toContain("Chưa thể tính hoa hồng dự kiến");
    expect(document.body.textContent).toContain("Dòng học phí chưa gắn học viên.");
    expect(document.body.textContent).not.toMatch(/\b0đ\b/);
    expect(document.body.textContent).not.toContain("Đã ghi vào sổ");
    expect(document.body.textContent).not.toContain("Dự kiến thêm");
  });

  it("[NHH-SO-FE-54] màn hẹp: mỗi dòng đã ghi xếp HAI TẦNG (ngữ cảnh trên; tiền + 'Vì sao' dưới) rồi mới thành một hàng ở ≥ sm — ngữ cảnh không bị bóp thành cột 4 dòng (chụp thật 375)", () => {
    render(<HoaHongDuKien du={hien({ daGhi: { tong: 80_000, dong: [{ id: "e1", soTien: 80_000, khoanThu: 4_000_000, vai: "Sale", ky: "10/2026" }] } })} />);
    const li = document.querySelector("ul li") as HTMLElement;
    expect(li.className).toContain("flex-col");
    expect(li.className).toContain("sm:flex-row");
  });

  it("[NHH-SO-FE-53] dòng ÂM (hoàn tiền) nói 'Hoàn …', không 'Khoản −2.000.000đ đã thu' (vô nghĩa)", () => {
    render(<HoaHongDuKien du={hien({ daGhi: { tong: -80_000, dong: [{ id: "e9", soTien: -80_000, khoanThu: -2_000_000, vai: "Sale", ky: "11/2026" }] } })} />);
    const li = document.querySelector("ul li") as HTMLElement;
    expect(li.textContent).toContain("Hoàn 2.000.000đ · kỳ 11/2026");
    expect(li.textContent).not.toContain("Khoản −");
    expect(li.textContent).toContain("−80.000đ");
  });

  it("[NHH-SO-FE-52] nhiều dòng đã ghi: hiện 5, phần còn lại dẫn sang Sổ hoa hồng", () => {
    const dong = Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, soTien: 1_000 * (i + 1), khoanThu: 100_000, vai: "Sale", ky: "10/2026" }));
    render(<HoaHongDuKien du={hien({ daGhi: { tong: 28_000, dong } })} />);
    expect(document.querySelectorAll("ul li")).toHaveLength(5);
    expect(document.body.textContent).toContain("và 2 dòng khác");
    expect(screen.getByRole("link", { name: "xem ở Sổ hoa hồng" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?xem=tat-ca");
  });
});

const LUA: LuaChonBoLocSo = {
  thang: ["2026-11", "2026-10"],
  nguoiHuong: [{ id: "u1", ten: "Lê Thị Phương Liên" }],
  nhomNguon: [{ code: "EMPLOYEE_REFERRAL", ten: "Nguồn từ nhân sự giới thiệu" }],
  vai: [{ code: "SALE", ten: "Sale" }],
  loaiGiaoDich: [{ code: "NEW", ten: "Khách mới" }],
};
const GIA_TRONG = { thang: "", vai: "", nguoi: "", nguon: "", loai: "", tt: "" };

describe("[NHH-SO-FE-60] bộ lọc TRÊN URL", () => {
  it("[NHH-SO-FE-60] biểu mẫu GET về đúng tab, mang theo xem + coSo; sáu ô lọc; 'Bỏ lọc' CHỈ khi đang lọc", () => {
    const { container, rerender } = render(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{ coSo: "c1", xem: "tat-ca" }} lua={LUA} gia={GIA_TRONG} coLoc={false} />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/nguon-hoa-hong/so");
    expect(Array.from(form.querySelectorAll("input[type=hidden]")).map((i) => [i.getAttribute("name"), (i as HTMLInputElement).value])).toEqual([
      ["coSo", "c1"],
      ["xem", "tat-ca"],
    ]);
    expect(Array.from(form.querySelectorAll("select")).map((s) => s.getAttribute("name"))).toEqual(["thang", "vai", "nguoi", "nguon", "loai", "tt"]);
    expect(screen.queryByRole("link", { name: "Bỏ lọc" })).toBeNull();
    rerender(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{ coSo: "c1", xem: "tat-ca" }} lua={LUA} gia={{ ...GIA_TRONG, thang: "2026-10" }} coLoc />);
    expect(screen.getByRole("link", { name: "Bỏ lọc" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?coSo=c1&xem=tat-ca");
  });

  it("[NHH-SO-FE-61] ô 'Người hưởng' CHỈ có khi người xem có danh sách người (view-self không có); giá trị đang lọc hiện đúng; giá trị lạ vẫn hiện (không nói 'Mọi …' khi bảng đã lọc)", () => {
    const { container, rerender } = render(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{}} lua={{ ...LUA, nguoiHuong: [] }} gia={GIA_TRONG} coLoc={false} />);
    expect(container.querySelector("select[name=nguoi]")).toBeNull();
    rerender(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{}} lua={LUA} gia={{ ...GIA_TRONG, thang: "2026-10", nguoi: "u_da_nghi" }} coLoc />);
    expect((container.querySelector("select[name=thang]") as HTMLSelectElement).value).toBe("2026-10");
    const nguoi = container.querySelector("select[name=nguoi]") as HTMLSelectElement;
    expect(nguoi.value).toBe("u_da_nghi");
    expect(nguoi.selectedOptions[0]!.textContent).toContain("không còn trong danh sách");
    // kỳ được viết kiểu Việt
    expect(Array.from((container.querySelector("select[name=thang]") as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["Mọi kỳ", "11/2026", "10/2026"]);
  });

  it("[NHH-SO-FE-62] chip loại hàng chờ (sáu loại, một nguồn với `LOAI_HANG_CHO_SO`): số đúng từng loại, nhóm đang chọn aria-current, đổi nhóm bỏ trang, giữ cơ sở", () => {
    render(
      <ChipNhomHangCho
        basePath="/nguon-hoa-hong/so"
        giu={{ coSo: "c1" }}
        dangChon="CHO_DIEU_CHINH"
        theoNhom={{ CHUA_PHAN_GIAI_NGUOI_HUONG: 7, CHO_CHINH_SACH: 0, VUOT_TRAN: 1, THIEU_DU_LIEU_THANH_TOAN: 2, CHO_DIEU_CHINH: 3, SO_DU_AM: 0 }}
        tong={13}
      />,
    );
    const cur = screen.getByRole("link", { current: "page" });
    expect(cur.textContent).toContain("Chờ điều chỉnh");
    expect(cur.textContent).toContain("(3)");
    expect(screen.getByRole("link", { name: /Mọi nhóm/ }).getAttribute("href")).toBe("/nguon-hoa-hong/so?coSo=c1");
    expect(screen.getByRole("link", { name: /Chưa phân giải người hưởng/ }).getAttribute("href")).toBe("/nguon-hoa-hong/so?coSo=c1&nhom=CHUA_PHAN_GIAI_NGUOI_HUONG");
    expect(screen.getByRole("link", { name: /Chưa phân giải người hưởng/ }).textContent).toContain("(7)");
    expect(screen.getByRole("link", { name: /Mọi nhóm/ }).textContent).toContain("(13)");
    // sáu chip loại + chip «Mọi nhóm»; «Số dư âm» là loại riêng (hfix), không gộp vào «Chờ điều chỉnh»
    expect(screen.getAllByRole("link")).toHaveLength(7);
    expect(screen.getByRole("link", { name: /Số dư âm/ }).getAttribute("href")).toBe("/nguon-hoa-hong/so?coSo=c1&nhom=SO_DU_AM");
  });
});

describe("[NHH-SO-FE-70] DaiSoCu — dải thông tin trước cutover", () => {
  it("[NHH-SO-FE-70] nêu đúng tháng cuối của sổ cũ (tháng ngay trước mốc, qua năm); link sang sổ cũ CHỈ khi mở được; chưa có mốc ⇒ không vẽ", () => {
    const { container, rerender } = render(<DaiSoCu moc="2027-01" coTheMoSoCu />);
    expect(container.textContent).toContain("12/2026");
    expect(container.textContent).toContain("01/2027");
    expect(screen.getByRole("link", { name: "Xem sổ cũ" }).getAttribute("href")).toBe("/crm/commission");
    rerender(<DaiSoCu moc="2026-10" coTheMoSoCu={false} />);
    expect(container.textContent).toContain("09/2026");
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<DaiSoCu moc={null} coTheMoSoCu />);
    expect(container.innerHTML).toBe("");
  });
});
