// @vitest-environment jsdom
/**
 * [NHH-FE-HB-*] · [NHH-FE-NG-*] · [NHH-FE-PL-*] · [NHH-FE-RE-*] — các bảng và mảnh hiển thị CHỈ-ĐỌC của tab Nguồn
 * trên phần tử thật (HangChoBang, BangNguon, pill, RouteError).
 *
 * VÌ SAO CÓ FILE NÀY: đợt cấy lỗi 08/10 cho thấy MƯỜI SÁU phép cấy lên các tệp này (link dòng trỏ `/lead/` thay vì
 * `/leads/`, cột "Lead 30 ngày" in số tổng, "từ–đến" lệch trang, pill cảnh báo gian lận tô warning, nút Thử lại
 * không gọi `reset`…) đều ra XANH — các bảng chỉ được bao bằng `tsc`, mà `tsc` không thấy chuỗi sai nghĩa.
 * Một bảng cho người duyệt nguồn mà dòng bấm vào ra 404 là lời hứa suông (luật 12), và không lỗi nào báo.
 *
 * Fixture cố ý LỆCH nhau (luật brief): `soLead30Ngay ≠ soLeadTong`, trang 2/3 chứ không phải trang 1, `tong` không
 * chia hết cho `kichThuoc` — để phép cấy "đảo hai số" không cho lại đúng số cũ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Sheet "Gán nguồn" (client) kéo Server Action + router — ở đây chỉ cần NÚT MỞ có mặt đúng chỗ, đúng nhãn, đúng vùng bấm.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/app/(admin)/admin/leads/nguon-actions", () => ({
  moGanNguonAction: async () => ({ ok: false, error: "không dùng trong ca này" }),
  doiNguonLeadAction: async () => ({ ok: false, error: "không dùng trong ca này" }),
  timNguoiGioiThieuAction: async () => ({ ok: true, ketQua: [] }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, info: () => {}, error: () => {} } }));
// BangNguon vẽ NutDoiTrangThai (client) ⇒ kéo `_actions.ts` của tab Nguồn (auth → next-auth) — ở đây chỉ cần module tồn tại.
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions", () => ({
  taoNguonAction: async () => ({ ok: false, error: "không dùng trong ca này" }),
  suaNguonAction: async () => ({ ok: false, error: "không dùng trong ca này" }),
  doiTrangThaiNguonAction: async () => ({ ok: false, error: "không dùng trong ca này" }),
  luuPageMappingAction: async () => ({ ok: false, error: "không dùng trong ca này" }),
}));

import type { DongDanhMucNguonMo } from "@/lib/nguon/doc-danh-muc";
import type { HangChoNguonDong } from "@/lib/nguon/doc-hang-cho";
import { BangNguon } from "../../../app/(admin)/admin/nguon-hoa-hong/nguon/_components/bang-nguon";
import { HangChoBang } from "../../../app/(admin)/admin/nguon-hoa-hong/nguon/_components/hang-cho-bang";
import { NguonStatusPill, TONE_VAN_DE, VanDePill } from "./nguon-status-pill";
import { RouteError } from "./route-error";

afterEach(cleanup);

const dongHC = (p: Partial<HangChoNguonDong> = {}): HangChoNguonDong => ({
  leadId: "lead_abc123",
  tenLead: "Nguyễn Thị Mai",
  trangThaiLead: "MOI",
  coSo: { code: "CS1", name: "Trụ sở chính" },
  duongVao: "sale-form",
  nguon: { code: "UNKNOWN", name: "Chưa xác định" },
  lyDo: ["UNKNOWN"],
  canhBao: [],
  nhanGoc: null,
  tuoiNgay: 3,
  ...p,
});

const hrefTrang = (t: number) => `/nguon-hoa-hong/nguon?trang=${t}`;
const hangCuaBang = () => Array.from(document.querySelectorAll("tbody tr"));

describe("[NHH-FE-HB-01] HangChoBang — dòng bấm được, đúng đích, không nói dối", () => {
  it("tên lead là NÚT mở Sheet 'Gán nguồn' (không rời trang), mang nhãn nêu tên lead", () => {
    render(<HangChoBang coTheMoLead dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    const nut = screen.getByRole("button", { name: "Gán nguồn cho Nguyễn Thị Mai" });
    expect(nut.textContent).toBe("Nguyễn Thị Mai");
    // vùng bấm phủ kín hàng (luật 12): nút mang `after:inset-0` và hàng là `relative`
    expect(nut.className).toContain("after:inset-0");
    expect(hangCuaBang()[0]!.className).toContain("relative");
    // bấm trong hàng KHÔNG điều hướng: không còn liên kết nào trong tbody (đường sang lead nằm TRONG Sheet)
    expect(document.querySelectorAll("tbody a")).toHaveLength(0);
  });

  it("tên rỗng (che PII / chưa nhập) ⇒ vẫn có nút bấm được, ghi '(chưa có tên)' — không phải ô trống", () => {
    render(<HangChoBang coTheMoLead dong={[dongHC({ tenLead: "" })]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    expect(screen.getByRole("button", { name: "Gán nguồn cho (chưa có tên)" }).textContent).toBe("(chưa có tên)");
  });

  it("nhãn cũ của nguồn (dữ liệu để người duyệt tay đọc): có ⇒ in 'cũ: …'; null ⇒ KHÔNG in gì", () => {
    render(
      <HangChoBang coTheMoLead
        dong={[dongHC({ leadId: "a", nhanGoc: "Facebook ads cũ" }), dongHC({ leadId: "b", tenLead: "Lê Văn Hai", nhanGoc: null })]}
        tong={2}
        trang={1}
        kichThuoc={25}
        hrefTrang={hrefTrang}
      />,
    );
    const [h1, h2] = hangCuaBang() as HTMLElement[];
    expect(within(h1!).getByText("cũ: Facebook ads cũ")).toBeTruthy();
    expect(within(h2!).queryByText(/^cũ:/)).toBeNull();
  });

  it("tuổi: 0 ngày ⇒ 'Hôm nay'; 3 ngày ⇒ '3 ngày'; cơ sở thiếu ⇒ gạch; mỗi lý do một pill", () => {
    render(
      <HangChoBang coTheMoLead
        dong={[
          dongHC({ leadId: "a", tuoiNgay: 0, lyDo: ["UNKNOWN", "THIEU_NGUOI"] }),
          dongHC({ leadId: "b", tenLead: "B", tuoiNgay: 3, coSo: null }),
        ]}
        tong={2}
        trang={1}
        kichThuoc={25}
        hrefTrang={hrefTrang}
      />,
    );
    const [h1, h2] = hangCuaBang() as HTMLElement[];
    expect(within(h1!).getByText("Hôm nay")).toBeTruthy();
    expect(within(h1!).getByText("Chưa rõ nguồn")).toBeTruthy();
    expect(within(h1!).getByText("Thiếu người giới thiệu")).toBeTruthy();
    expect(within(h2!).getByText("3 ngày")).toBeTruthy();
    expect(within(h2!).getByText("—")).toBeTruthy();
  });
});

describe("[NHH-FE-HB-02] HangChoBang — phạm vi 'Hiển thị từ–đến / tổng' và thanh trang", () => {
  const dong = (n: number) => Array.from({ length: n }, (_, i) => dongHC({ leadId: `l${i}`, tenLead: `Lead ${i}` }));

  it("trang 3 của 60 lead (25/trang) ⇒ 51–60 / 60 (đến KHÔNG vượt tổng), có đủ 3 trang", () => {
    render(<HangChoBang coTheMoLead dong={dong(10)} tong={60} trang={3} kichThuoc={25} hrefTrang={hrefTrang} />);
    const chan = screen.getByText(/Hiển thị/).closest("p")!.textContent!.replace(/\s+/g, " ");
    expect(chan).toBe("Hiển thị 51–60 / 60 lead");
    // số trang = ceil(60/25) = 3, không phải floor = 2
    expect(screen.getByLabelText("Trang 3").getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("Trang 1").getAttribute("href")).toBe("/nguon-hoa-hong/nguon?trang=1");
  });

  it("trang 2 của 60 ⇒ 26–50 / 60 (từ = (trang−1)×cỡ+1, không phải trang×cỡ+1)", () => {
    render(<HangChoBang coTheMoLead dong={dong(25)} tong={60} trang={2} kichThuoc={25} hrefTrang={hrefTrang} />);
    expect(screen.getByText(/Hiển thị/).closest("p")!.textContent!.replace(/\s+/g, " ")).toBe("Hiển thị 26–50 / 60 lead");
  });

  it("trang 1 của 26 lead ⇒ có trang 2 (ceil(26/25) = 2); số nghìn kiểu Việt khi lớn", () => {
    render(<HangChoBang coTheMoLead dong={dong(25)} tong={26} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    expect(screen.getByLabelText("Trang 2").getAttribute("href")).toBe("/nguon-hoa-hong/nguon?trang=2");
    cleanup();
    render(<HangChoBang coTheMoLead dong={dong(25)} tong={12345} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    expect(screen.getByText(/Hiển thị/).closest("p")!.textContent!.replace(/\s+/g, " ")).toBe("Hiển thị 1–25 / 12.345 lead");
  });
});

const dongDM = (p: Partial<DongDanhMucNguonMo> = {}): DongDanhMucNguonMo => ({
  id: "g1",
  code: "PAID_ADS",
  documentNo: 7,
  name: "Quảng cáo",
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  isSystem: true,
  sortOrder: 7,
  status: "ACTIVE",
  sourceType: "MARKETING",
  commissionEnabled: true,
  attributionWindowDays: null,
  effectiveFrom: null,
  effectiveTo: null,
  chonDuoc: true,
  capNhatLuc: "2026-10-09T02:00:00.000Z",
  soLead30Ngay: 12,
  soLeadTong: 2338,
  ownerEmployeeId: null,
  chinhSachRieng: false,
  ruleChuChay: false,
  ...p,
});

/** Bảng chỉ-đọc (đúng như người không có `sources:manage` thấy). Ca ghi/nút nằm ở `nguon-danh-muc-ui.test.tsx`. */
const bangDoc = (dong: DongDanhMucNguonMo[]) => <BangNguon dong={dong} cuaSoMacDinhNgay={90} coTheGhi={false} coQuyenKichHoat={false} dichMacDinh={[]} nowIso="2026-10-09T03:00:00.000Z" />;

describe("[NHH-FE-NG-01] BangNguon — danh mục nguồn", () => {
  it("tên nguồn là liên kết `/nguon-hoa-hong/nguon/<mã>` (có segment /nguon/), mở trang chi tiết", () => {
    render(bangDoc([dongDM()]));
    expect(screen.getByRole("link", { name: "Quảng cáo" }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon/PAID_ADS");
  });

  it("cột 'Lead 30 ngày' in số 30 NGÀY, cột 'Tổng lead' in số TỔNG (hai số khác nhau — đảo là đỏ)", () => {
    render(bangDoc([dongDM()]));
    const o = Array.from(hangCuaBang()[0]!.querySelectorAll("td")).map((td) => td.textContent?.trim());
    // [Nguồn (số · mã), Nhóm nguồn, Cửa sổ, Hoa hồng nguồn, Trạng thái, Lead (tổng / 30 ngày), chevron]
    expect(o[0]).toContain("7 · PAID_ADS");
    const lead = Array.from(hangCuaBang()[0]!.querySelectorAll("td"))[5]!;
    expect(Array.from(lead.querySelectorAll("span")).map((x) => x.textContent)).toEqual(["2.338", "12 trong 30 ngày"]);
  });

  it("nhóm hệ thống (không số văn bản) ⇒ '—'; trạng thái và yêu cầu nhập hiện bằng chữ", () => {
    render(bangDoc([dongDM({ documentNo: null, code: "UNKNOWN", name: "Chưa xác định", selectable: false, status: "ACTIVE", chonDuoc: false })]));
    const o = Array.from(hangCuaBang()[0]!.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(o[0]).toContain("UNKNOWN");
    expect(o[0]).not.toContain("·"); // không số văn bản ⇒ không có tiền tố «n · »
    expect(o[1]).toContain("Hệ thống gán");
    expect(o[4]).toContain("Đang dùng");
  });
});

describe("[NHH-FE-PL-01] pill — tông theo NGHĨA, không theo màu thương hiệu", () => {
  it("cảnh báo gian lận = danger; ba lý do thiếu dữ liệu = warning (bảng ánh xạ)", () => {
    expect(TONE_VAN_DE).toEqual({
      UNKNOWN: "warning",
      THIEU_NGUOI: "warning",
      THIEU_GIAI_TRINH: "warning",
      CANH_BAO: "danger",
    });
  });

  it("VanDePill CANH_BAO: in ĐÚNG TỪNG MÃ cảnh báo (không gộp 'Có cảnh báo') và tô tông danger trên phần tử thật", () => {
    render(<VanDePill lyDo="CANH_BAO" canhBao={["SDT_NHAN_VIEN", "NGUOI_GT_LA_KHACH"]} />);
    const a = screen.getByText("SĐT trùng nhân viên");
    const b = screen.getByText("Người giới thiệu là khách");
    expect(screen.queryByText("Có cảnh báo")).toBeNull();
    expect(a.className).toContain("--state-danger-soft");
    expect(b.className).toContain("--state-danger-soft");
    cleanup();
    // đối chứng: cảnh báo RỖNG ⇒ pill chung 'Có cảnh báo' (nhánh còn lại)
    render(<VanDePill lyDo="CANH_BAO" canhBao={[]} />);
    expect(screen.getByText("Có cảnh báo")).toBeTruthy();
  });

  it("VanDePill thiếu dữ liệu: tông warning, KHÔNG phải danger", () => {
    render(<VanDePill lyDo="THIEU_NGUOI" />);
    const el = screen.getByText("Thiếu người giới thiệu");
    expect(el.className).toContain("--state-warning-soft");
    expect(el.className).not.toContain("--state-danger-soft");
  });

  it("NguonStatusPill: ACTIVE = success; ba trạng thái còn lại = muted", () => {
    render(<NguonStatusPill status="ACTIVE" />);
    expect(screen.getByText("Đang dùng").className).toContain("--state-success-soft");
    cleanup();
    for (const [s, nhan] of [["INACTIVE", "Tạm ngừng"], ["ARCHIVED", "Lưu trữ"], ["DRAFT", "Nháp"]] as const) {
      render(<NguonStatusPill status={s} />);
      const el = screen.getByText(nhan);
      expect(el.className, s).toContain("bg-muted");
      expect(el.className, s).not.toContain("--state-success-soft");
      cleanup();
    }
  });
});

describe("[NHH-FE-RE-01] RouteError — lỗi nói được tiếng Việt, có đường Thử lại", () => {
  it("nút Thử lại GỌI reset; mã digest in ra khi có, không in khi không có", () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<RouteError error={Object.assign(new Error("boom"), { digest: "d1g3st" })} reset={reset} />);
    expect(screen.getByText("d1g3st")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(reset).toHaveBeenCalledTimes(1);
    cleanup();
    render(<RouteError error={new Error("boom")} reset={reset} />);
    expect(screen.queryByText(/Mã lỗi/)).toBeNull();
    loi.mockRestore();
  });
});

describe("[NHH-FE-HB-03] HangChoBang — mọi vai có `sources:view` mở được Sheet; `coTheMoLead` chỉ quyết định đường sang hồ sơ lead", () => {
  // Kế toán HO / Giám đốc có `sources:view` nhưng không giữ `leads:view-*`: `/leads/[id]` đá họ về /dashboard thầm lặng — nên link
  // sang lead nằm TRONG Sheet và chỉ có khi `coTheMoLead`. Sheet thì ai thấy tab cũng mở được (nó tự nói đổi được hay không).
  it("coTheMoLead=false ⇒ dòng VẪN bấm được (mở Sheet), và KHÔNG có liên kết nào dẫn tới /leads ngoài Sheet", () => {
    render(<HangChoBang coTheMoLead={false} dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    const hang = hangCuaBang()[0] as HTMLElement;
    expect(within(hang).getByRole("button", { name: "Gán nguồn cho Nguyễn Thị Mai" })).toBeTruthy();
    expect(hang.className).toContain("cursor-pointer");
    expect(within(hang).queryAllByRole("link")).toHaveLength(0);
    expect(document.querySelectorAll("tbody a")).toHaveLength(0);
  });

  it("đối chứng dương: coTheMoLead=true cũng vẽ cùng nút; mũi tên chỉ ra ngoài vùng bấm đã có đích thật (Sheet)", () => {
    render(<HangChoBang coTheMoLead dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    const hang = hangCuaBang()[0] as HTMLElement;
    expect(within(hang).getAllByRole("button")).toHaveLength(1);
    expect(hang.querySelector("svg")).not.toBeNull();
  });

  it("tiêu đề bảng: cột 'Mở' luôn có — mũi tên mỗi dòng nay có đích thật cho mọi vai", () => {
    render(<HangChoBang coTheMoLead={false} dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    expect(document.querySelector('th[aria-label="Mở"]')).not.toBeNull();
    expect(hangCuaBang()[0]!.querySelector("svg")).not.toBeNull();
  });
});

describe("[NHH-FE-HB-04] HangChoBang — chữ bị cắt vẫn đọc được: `title` nằm trên phần tử TRÊN CÙNG", () => {
  // Lớp phủ `after:inset-0` của liên kết phủ kín hàng ⇒ `title` đặt trên <td> bên dưới không bao giờ hiện.
  it("nút mở Sheet mang `title` đủ: tên lead, cơ sở (tên đầy đủ) và nhãn cũ", () => {
    render(
      <HangChoBang
        coTheMoLead
        dong={[dongHC({ nhanGoc: "Facebook ads cũ", coSo: { code: "CS1", name: "Trụ sở chính - Nguyễn Hữu Thọ" } })]}
        tong={1}
        trang={1}
        kichThuoc={25}
        hrefTrang={hrefTrang}
      />,
    );
    const a = within(hangCuaBang()[0] as HTMLElement).getByRole("button");
    const t = a.getAttribute("title") ?? "";
    expect(t).toContain("Nguyễn Thị Mai");
    expect(t).toContain("Trụ sở chính - Nguyễn Hữu Thọ");
    expect(t).toContain("Facebook ads cũ");
  });

  it("`title` nằm trên NÚT (phần tử trên cùng của ô tên), không phải trên <td> bị lớp phủ che", () => {
    render(<HangChoBang coTheMoLead={false} dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    const nut = within(hangCuaBang()[0] as HTMLElement).getByRole("button", { name: /Nguyễn Thị Mai/ });
    expect(nut.getAttribute("title") ?? "").toContain("Nguyễn Thị Mai");
    expect(nut.closest("td")!.getAttribute("title")).toBeNull();
  });
});

describe("[NHH-FE-HB-05] HangChoBang — cột 'Vấn đề' (lý do bảng này tồn tại) đứng NGAY sau Lead", () => {
  it("thứ tự tiêu đề: Lead · Vấn đề · Nguồn hiện tại · … (cột ngoài tầm mắt khi cuộn ngang là cột phụ)", () => {
    render(<HangChoBang coTheMoLead dong={[dongHC()]} tong={1} trang={1} kichThuoc={25} hrefTrang={hrefTrang} />);
    const th = Array.from(document.querySelectorAll("thead th")).map((x) => x.textContent?.trim());
    expect(th.slice(0, 3)).toEqual(["Lead", "Vấn đề", "Nguồn hiện tại"]);
    expect(th.indexOf("Tuổi")).toBeGreaterThan(th.indexOf("Đường vào"));
    // dữ liệu đi đúng cột: ô thứ hai của dòng là pill vấn đề
    const o = Array.from(hangCuaBang()[0]!.querySelectorAll("td"));
    expect(o[1]!.textContent).toContain("Chưa rõ nguồn");
  });
});

describe("[NHH-UI-TB-01] HangChoBang — ↑/↓ đổi dòng, Enter mở (06 §7)", () => {
  const ba = () =>
    render(
      <HangChoBang
        coTheMoLead
        dong={[dongHC({ leadId: "a", tenLead: "An" }), dongHC({ leadId: "b", tenLead: "Bình" }), dongHC({ leadId: "c", tenLead: "Chi" })]}
        tong={3}
        trang={1}
        kichThuoc={25}
        hrefTrang={hrefTrang}
      />,
    );
  const nut = (ten: string) => screen.getByRole("button", { name: `Gán nguồn cho ${ten}` });

  it("↓ chuyển focus sang nút của dòng kế, ↑ về dòng trước; hai ĐẦU danh sách giữ nguyên (không vòng)", () => {
    ba();
    nut("An").focus();
    fireEvent.keyDown(nut("An"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(nut("Bình"));
    fireEvent.keyDown(nut("Bình"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(nut("Chi"));
    fireEvent.keyDown(nut("Chi"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(nut("Chi")); // cuối: ở yên
    fireEvent.keyDown(nut("Chi"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(nut("Bình"));
    nut("An").focus();
    fireEvent.keyDown(nut("An"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(nut("An")); // đầu: ở yên
  });

  it("phím có phím bổ trợ (Ctrl/Alt/Shift/Meta) KHÔNG bị bắt — trình duyệt/trình đọc màn hình còn dùng", () => {
    ba();
    nut("An").focus();
    for (const m of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }]) {
      fireEvent.keyDown(nut("An"), { key: "ArrowDown", ...m });
      expect(document.activeElement).toBe(nut("An"));
    }
  });

  it("phím khác ArrowUp/ArrowDown không đổi focus; ↓ chặn cuộn trang (preventDefault) khi ĐÃ chuyển dòng", () => {
    ba();
    nut("An").focus();
    fireEvent.keyDown(nut("An"), { key: "Enter" });
    expect(document.activeElement).toBe(nut("An"));
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    nut("An").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("focus KHÔNG nằm trên nút dòng (vd liên kết phân trang) ⇒ ↓ không làm gì", () => {
    ba();
    const trang = document.querySelector("nav a, nav button") as HTMLElement | null;
    if (!trang) return; // một trang duy nhất ⇒ không có thanh trang: không có gì để thử
    trang.focus();
    fireEvent.keyDown(trang, { key: "ArrowDown" });
    expect(document.activeElement).toBe(trang);
  });
});
