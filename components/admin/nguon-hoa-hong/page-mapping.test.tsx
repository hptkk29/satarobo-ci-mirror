// @vitest-environment jsdom
/**
 * [NHH-UI-PM-*] BangPageMapping · QueueToggle (chế độ thứ ba) — trên PHẦN TỬ THẬT (jsdom), hàm lưu được TIÊM.
 *
 * Luật 12: người KHÔNG có `sources:manage` không thấy select/nút Lưu (đối chứng dương: người CÓ thì thấy cả hai); nút Lưu chỉ có khi
 * dòng đã đổi; lưu gọi ĐÚNG (pageId, groupCode, campaignCode).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions", () => ({ luuPageMappingAction: vi.fn() }));

import type { DongPage } from "@/lib/nguon/bang-nguon-theo-page";
import { BangPageMapping } from "./bang-page-mapping";
import { QueueToggle, docCheDoXem } from "./queue-toggle";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Mặc định an toàn cho test: có quyền kích hoạt, không nguồn nào dính tiền. Ca đo cổng «đụng tiền» ghi đè. */
const Bang = (p: Omit<React.ComponentProps<typeof BangPageMapping>, "coQuyenKichHoat" | "dinhTienTheoMa"> & Partial<Pick<React.ComponentProps<typeof BangPageMapping>, "coQuyenKichHoat" | "dinhTienTheoMa">>) => (
  <BangPageMapping coQuyenKichHoat dinhTienTheoMa={{}} {...p} />
);
const LY_DO = "Chủ dự án chốt ngày 10/10/2026";
/** Đổi NGUỒN ⇒ bấm Lưu/Gỡ của dòng mở hộp thoại xác nhận: gõ lý do rồi xác nhận (W2). */
const xacNhanDoiNguon = (lyDo = LY_DO) => {
  const hop = screen.getByRole("dialog");
  fireEvent.change(within(hop).getByRole("textbox"), { target: { value: lyDo } });
  fireEvent.click(within(hop).getByRole("button", { name: /^(Lưu|Gỡ nguồn)$/ }));
};

/** Máy chủ từ chối ⇒ hộp thoại xác nhận GIỮ MỞ (lý do còn nguyên); muốn đọc lỗi ở DÒNG phía sau thì phải Huỷ hộp thoại trước (Radix ẩn phần còn lại khỏi cây truy cập). */
const huyHopThoai = () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Huỷ" }));

const NHOM = [
  { code: "PAID_ADS", name: "Nguồn từ Quảng Cáo" },
  { code: "WALK_IN", name: "Nguồn KH tự đến Trung tâm" },
];

const dong = (p: Partial<DongPage> & Pick<DongPage, "pageId">): DongPage => ({
  tenPage: `Page ${p.pageId}`,
  coSo: { code: "CS1", name: "Trụ sở chính - Nguyễn Hữu Thọ" },
  dangTat: false,
  trongDanhMuc: true,
  map: null,
  ...p,
});

const DONG: DongPage[] = [
  dong({ pageId: "p-chua", tenPage: "Sata Robo Đà Nẵng" }),
  dong({ pageId: "p-tat", tenPage: "Page cũ", dangTat: true }),
  dong({ pageId: "p-da", tenPage: "SataRobo Main", coSo: null, map: { groupCode: "PAID_ADS", campaignCode: "THANG10" } }),
  dong({ pageId: "p-mo-coi", tenPage: null, coSo: null, trongDanhMuc: false, map: { groupCode: "WALK_IN", campaignCode: null } }),
];

const hang = (id: string) => screen.getByText(new RegExp(`Mã ${id}$`)).closest("tr") as HTMLElement;

describe("[NHH-UI-PM-01] BangPageMapping — quyền sửa = sources:manage (luật 12)", () => {
  it("CÓ quyền ⇒ mỗi dòng có select nguồn + ô mã chiến dịch; KHÔNG có nút Lưu khi chưa đổi gì", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Lưu|Gỡ nguồn/ })).toBeNull();
    expect(screen.queryByText(/sources:manage/)).toBeNull();
  });

  it("KHÔNG quyền ⇒ chỉ-đọc: không select, không ô nhập, không nút; nêu TÊN khoá + hỏi ai; vẫn đọc được nguồn đang gán", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua={false} runtimeBat luu={vi.fn()} />);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("sources:manage").tagName).toBe("CODE");
    expect(screen.getByText(/hỏi quản trị viên hệ thống/)).toBeTruthy();
    expect(within(hang("p-da")).getByText("Nguồn từ Quảng Cáo")).toBeTruthy();
    expect(within(hang("p-da")).getByText("THANG10")).toBeTruthy();
  });

  it("chỉ nói điều ĐÁNG chú ý ở cột trạng thái: chưa gán / Page tắt / mồ côi; dòng bình thường chỉ 'Đã gán'", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua={false} runtimeBat luu={vi.fn()} />);
    expect(within(hang("p-chua")).getByText("Chưa gán nguồn")).toBeTruthy();
    expect(within(hang("p-tat")).getByText("Page đang tắt")).toBeTruthy();
    expect(within(hang("p-tat")).queryByText("Chưa gán nguồn")).toBeNull(); // Page tắt KHÔNG đếm là việc phải làm
    expect(within(hang("p-mo-coi")).getByText("Không còn trong danh mục")).toBeTruthy();
    expect(within(hang("p-da")).getByText("Đã gán")).toBeTruthy();
  });

  it("cờ page-mapping TẮT ⇒ dải nói thật 'chưa có tác dụng'; BẬT ⇒ không có dải", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat={false} luu={vi.fn()} />);
    expect(screen.getByText(/chưa có tác dụng/)).toBeTruthy();
    cleanup();
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    expect(screen.queryByText(/chưa có tác dụng/)).toBeNull();
  });

  it("danh mục Page rỗng ⇒ nói vì sao rỗng và làm gì tiếp", () => {
    render(<Bang dong={[]} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    expect(screen.getByText("Chưa có Page nào trong danh mục")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("[NHH-UI-PM-02] BangPageMapping — sửa tại chỗ, tự lưu từng dòng", () => {
  const chon = (id: string, nhan: string) => fireEvent.change(within(hang(id)).getByRole("combobox"), { target: { value: nhan } });

  it("chọn nguồn ⇒ hiện Lưu + Huỷ CỦA DÒNG ĐÓ (dòng khác không đổi); Huỷ trả về giá trị máy chủ", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    chon("p-chua", "WALK_IN");
    expect(within(hang("p-chua")).getByRole("button", { name: /^Lưu nguồn của Page/ })).toBeTruthy();
    expect(within(hang("p-da")).queryByRole("button")).toBeNull();
    fireEvent.click(within(hang("p-chua")).getByRole("button", { name: /^Huỷ thay đổi của Page/ }));
    expect((within(hang("p-chua")).getByRole("combobox") as HTMLSelectElement).value).toBe("");
    expect(within(hang("p-chua")).queryByRole("button")).toBeNull();
  });

  it("ô mã chiến dịch bị khoá khi chưa chọn nguồn; có nguồn ⇒ gõ được", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    const o = within(hang("p-chua")).getByRole("textbox") as HTMLInputElement;
    expect(o.disabled).toBe(true);
    chon("p-chua", "PAID_ADS");
    expect((within(hang("p-chua")).getByRole("textbox") as HTMLInputElement).disabled).toBe(false);
  });

  it("Lưu gọi ĐÚNG (pageId, groupCode, campaignCode đã trim); thành công ⇒ toast + làm mới trang", async () => {
    const luu = vi.fn(async () => ({ ok: true as const, doi: true }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-chua", "PAID_ADS");
    fireEvent.change(within(hang("p-chua")).getByRole("textbox"), { target: { value: "  KHAI_TRUONG  " } });
    fireEvent.click(within(hang("p-chua")).getByRole("button", { name: /^Lưu nguồn của Page/ }));
    expect(luu).not.toHaveBeenCalled(); // đổi NGUỒN ⇒ hộp thoại xác nhận đứng giữa
    xacNhanDoiNguon();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(luu).toHaveBeenCalledWith({ pageId: "p-chua", groupCode: "PAID_ADS", campaignCode: "KHAI_TRUONG", lyDo: LY_DO });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledWith("Đã lưu nguồn của Page.");
  });

  it("đưa Page đã gán về '— Chưa gán nguồn —' ⇒ nút đổi thành 'Gỡ nguồn' và gửi groupCode null + campaignCode null", async () => {
    const luu = vi.fn(async () => ({ ok: true as const, doi: true }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-da", "");
    fireEvent.click(within(hang("p-da")).getByRole("button", { name: /^Gỡ nguồn của Page/ }));
    xacNhanDoiNguon();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(luu).toHaveBeenCalledWith({ pageId: "p-da", groupCode: null, campaignCode: null, lyDo: LY_DO });
    expect(TOAST.success).toHaveBeenCalledWith("Đã gỡ nguồn của Page.");
  });

  it("máy chủ từ chối ⇒ lỗi hiện NGAY DÒNG ĐÓ (role=alert), dòng giữ bản nháp, KHÔNG làm mới trang, KHÔNG toast thành công", async () => {
    const luu = vi.fn(async () => ({ ok: false as const, error: "Bảng vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "vuaDoi" }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-chua", "WALK_IN");
    fireEvent.click(within(hang("p-chua")).getByRole("button", { name: /^Lưu nguồn của Page/ }));
    xacNhanDoiNguon();
    await within(screen.getByRole("dialog")).findByRole("alert"); // lỗi hiện ngay trong hộp thoại (xem PM-07e)
    huyHopThoai();
    const loi = await within(hang("p-chua")).findByRole("alert");
    expect(loi.textContent).toContain("vừa được người khác thay đổi");
    expect((within(hang("p-chua")).getByRole("combobox") as HTMLSelectElement).value).toBe("WALK_IN");
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(TOAST.success).not.toHaveBeenCalled();
  });

  it("[NHH-UI-PM-02b] ô mã chiến dịch chỉ khác KHOẢNG TRẮNG đầu/cuối ⇒ chưa phải thay đổi (không hiện Lưu); gõ ký tự thật ⇒ hiện Lưu (đối chứng dương)", () => {
    // Cấy `a.campaign.trim() !== g.campaign` → `a.campaign !== g.campaign`: nút Lưu hiện cho một "thay đổi" mà máy chủ sẽ báo không-đổi.
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    const o = within(hang("p-da")).getByRole("textbox");
    fireEvent.change(o, { target: { value: "  THANG10 " } });
    expect(within(hang("p-da")).queryByRole("button", { name: /Lưu|Gỡ nguồn/ })).toBeNull();
    fireEvent.change(o, { target: { value: "THANG11" } });
    expect(within(hang("p-da")).getByRole("button", { name: /^Lưu nguồn của Page/ })).toBeTruthy();
  });

  it("[NHH-UI-PM-02c] lỗi của một dòng TỰ XOÁ khi người dùng sửa chính dòng đó (không treo lỗi cũ cạnh giá trị mới); dòng khác không bị đụng", async () => {
    // Cấy `setLoi((l) => l)` trong `sua`: lỗi "vừa được người khác thay đổi" nằm lại mãi cạnh một giá trị người dùng đã sửa lại.
    const luu = vi.fn(async () => ({ ok: false as const, error: "Bảng vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "vuaDoi" }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-chua", "WALK_IN");
    fireEvent.click(within(hang("p-chua")).getByRole("button", { name: /^Lưu nguồn của Page/ }));
    xacNhanDoiNguon();
    await within(screen.getByRole("dialog")).findByRole("alert");
    huyHopThoai();
    await within(hang("p-chua")).findByRole("alert");
    chon("p-da", "WALK_IN");
    fireEvent.click(within(hang("p-da")).getByRole("button", { name: /^Lưu nguồn của Page/ }));
    xacNhanDoiNguon();
    await within(screen.getByRole("dialog")).findByRole("alert");
    huyHopThoai();
    await within(hang("p-da")).findByRole("alert");
    chon("p-chua", "PAID_ADS"); // sửa lại dòng 1
    expect(within(hang("p-chua")).queryByRole("alert")).toBeNull();
    expect(within(hang("p-da")).getByRole("alert")).toBeTruthy(); // dòng 2 giữ nguyên lỗi của nó
  });

  it("[NHH-UI-PM-04] sau khi Lưu THÀNH CÔNG, dòng GIỮ giá trị vừa lưu (không quay về giá trị cũ rồi mới nhảy sang giá trị mới); dữ liệu mới về ⇒ khớp, hết nút Lưu", async () => {
    // Cấy lại `hoanTac(d)` ngay sau khi lưu: ô nguồn quay về '— Chưa gán nguồn —' trong lúc chờ máy chủ, người dùng tưởng lưu hỏng rồi bấm lại.
    const luu = vi.fn(async () => ({ ok: true as const, doi: true }));
    const { rerender } = render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-chua", "WALK_IN");
    fireEvent.click(within(hang("p-chua")).getByRole("button", { name: /^Lưu nguồn của Page/ }));
    xacNhanDoiNguon();
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect((within(hang("p-chua")).getByRole("combobox") as HTMLSelectElement).value).toBe("WALK_IN"); // KHÔNG quay về ""
    // dữ liệu mới về từ máy chủ (cùng giá trị đã lưu) ⇒ dòng đọc từ máy chủ, hết nút Lưu
    rerender(
      <Bang
        dong={DONG.map((d) => (d.pageId === "p-chua" ? { ...d, map: { groupCode: "WALK_IN", campaignCode: null } } : d))}
        nhom={NHOM}
        coTheSua
        runtimeBat
        luu={luu}
      />,
    );
    expect((within(hang("p-chua")).getByRole("combobox") as HTMLSelectElement).value).toBe("WALK_IN");
    expect(within(hang("p-chua")).queryByRole("button")).toBeNull();
    expect(within(hang("p-chua")).getByText("Đã gán")).toBeTruthy();
  });

  it("[NHH-UI-PM-04b] bản nháp CŨ không đè dữ liệu máy chủ MỚI: người A sửa dở dòng, người B đổi dòng đó và lưu, A tải lại ⇒ A thấy giá trị của B, không phải bản nháp cũ", () => {
    // Cấy bỏ so `goc` trong hienTai: bản nháp cũ nằm đè lên dữ liệu máy chủ đã đổi, và nút Lưu sẽ ghi ĐÈ lên thay đổi của người kia.
    const { rerender } = render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    chon("p-chua", "WALK_IN"); // A sửa dở
    rerender(
      <Bang
        dong={DONG.map((d) => (d.pageId === "p-chua" ? { ...d, map: { groupCode: "PAID_ADS", campaignCode: null } } : d))}
        nhom={NHOM}
        coTheSua
        runtimeBat
        luu={vi.fn()}
      />,
    );
    expect((within(hang("p-chua")).getByRole("combobox") as HTMLSelectElement).value).toBe("PAID_ADS");
    expect(within(hang("p-chua")).queryByRole("button")).toBeNull();
  });

  it("[NHH-UI-PM-05] nút trong dòng mang TÊN PAGE (N dòng có N nút 'Lưu' y hệt thì người đọc màn hình không phân biệt được); chữ hiển thị vẫn là 'Lưu' / 'Huỷ' / 'Gỡ nguồn'", () => {
    // Cấy bỏ aria-label của ba nút.
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    chon("p-chua", "WALK_IN");
    chon("p-da", "");
    const chua = within(hang("p-chua"));
    expect(chua.getByRole("button", { name: "Lưu nguồn của Page Sata Robo Đà Nẵng" }).textContent).toBe("Lưu");
    expect(chua.getByRole("button", { name: "Huỷ thay đổi của Page Sata Robo Đà Nẵng" }).textContent).toBe("Huỷ");
    expect(within(hang("p-da")).getByRole("button", { name: "Gỡ nguồn của Page SataRobo Main" }).textContent).toBe("Gỡ nguồn");
    // hai dòng cùng sửa ⇒ tên các nút KHÁC nhau
    const ten = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(ten).size).toBe(ten.length);
  });

  it("[NHH-UI-PM-06] sau khi Lưu xong, focus về ô nguồn CỦA DÒNG đó (nút Lưu vừa gỡ khỏi cây — focus không rơi về <body>)", async () => {
    // Cấy bỏ khối rAF-focus: bàn phím mất vị trí trong bảng sau mỗi lần lưu.
    const luu = vi.fn(async () => ({ ok: true as const, doi: true }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-chua", "WALK_IN");
    fireEvent.click(within(hang("p-chua")).getByRole("button", { name: /^Lưu nguồn của Page/ }));
    xacNhanDoiNguon();
    await waitFor(() => expect(document.activeElement).toBe(within(hang("p-chua")).getByRole("combobox")));
  });

  it("nhóm đã ngừng mà Page còn trỏ vào ⇒ vẫn hiện ĐÚNG giá trị đang lưu (không giả vờ là 'chưa gán')", () => {
    render(
      <Bang
        dong={[dong({ pageId: "p-ngung", map: { groupCode: "NHOM_CU", campaignCode: null } })]}
        nhom={NHOM}
        coTheSua
        runtimeBat
        luu={vi.fn()}
      />,
    );
    const s = within(hang("p-ngung")).getByRole("combobox") as HTMLSelectElement;
    expect(s.value).toBe("NHOM_CU");
    expect(s.selectedOptions[0]!.textContent).toContain("không còn dùng");
  });
});

describe("[NHH-UI-PM-07] đổi NGUỒN của Page đi qua hộp thoại: lý do ≥ 10 ký tự + nói trước nếu cần quyền kích hoạt (W2, res3 R3-M2)", () => {
  const chon = (id: string, nhan: string) => fireEvent.change(within(hang(id)).getByRole("combobox"), { target: { value: nhan } });
  const moHop = (id: string) => fireEvent.click(within(hang(id)).getByRole("button", { name: /^(Lưu|Gỡ nguồn)/ }));

  it("a. đổi nguồn ⇒ hộp thoại mở, `luu` CHƯA gọi; lý do ngắn ⇒ lỗi cạnh ô, vẫn chưa gọi; đủ dài ⇒ gọi với lý do đã trim; Huỷ ⇒ không gọi", async () => {
    // Cấy: bỏ `loiLyDoGanPage` khỏi hộp thoại ⇒ lý do ngắn vẫn gửi đi (đỏ); gọi `luuDong` thẳng ở nút dòng ⇒ không có hộp thoại (đỏ).
    const luu = vi.fn(async () => ({ ok: true as const, doi: true }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-chua", "WALK_IN");
    moHop("p-chua");
    const hop = screen.getByRole("dialog");
    expect(within(hop).getByText(/mọi lead mới/)).toBeTruthy();
    fireEvent.change(within(hop).getByRole("textbox"), { target: { value: "ngắn" } });
    fireEvent.click(within(hop).getByRole("button", { name: /^Lưu$/ }));
    expect(within(hop).getByRole("alert").textContent).toContain("10 ký tự");
    expect(luu).not.toHaveBeenCalled();
    fireEvent.click(within(hop).getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(luu).not.toHaveBeenCalled();
    moHop("p-chua");
    xacNhanDoiNguon("   Chủ dự án chốt ngày 10/10   ");
    await waitFor(() => expect(luu).toHaveBeenCalledWith({ pageId: "p-chua", groupCode: "WALK_IN", campaignCode: null, lyDo: "Chủ dự án chốt ngày 10/10" }));
  });

  it("b. chỉ đổi MÃ CHIẾN DỊCH (nguồn giữ nguyên) ⇒ KHÔNG hộp thoại, `luu` gọi ngay với lyDo null (không đổi người nhận tiền)", async () => {
    // Cấy: `doiNguon` so cả chiến dịch ⇒ đổi mã chiến dịch cũng đòi lý do (đỏ).
    const luu = vi.fn(async () => ({ ok: true as const, doi: true }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    fireEvent.change(within(hang("p-da")).getByRole("textbox"), { target: { value: "THANG11" } });
    moHop("p-da");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(luu).toHaveBeenCalledWith({ pageId: "p-da", groupCode: "PAID_ADS", campaignCode: "THANG11", lyDo: null }));
  });

  it("c. nguồn CŨ hoặc MỚI dính tiền + người xem THIẾU quyền kích hoạt ⇒ hộp thoại nêu TÊN khoá, KHÔNG có ô lý do, KHÔNG có nút xác nhận; có quyền ⇒ đủ cả hai", () => {
    // Cấy: bỏ vế `dinhTien && !coQuyenKichHoat` ⇒ người thiếu quyền vẫn gõ lý do rồi mới bị từ chối (đỏ).
    const dinhTienTheoMa = { PAID_ADS: true, WALK_IN: false };
    const { unmount } = render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} coQuyenKichHoat={false} dinhTienTheoMa={dinhTienTheoMa} />);
    chon("p-chua", "PAID_ADS"); // nguồn MỚI dính tiền
    moHop("p-chua");
    let hop = screen.getByRole("dialog");
    expect(within(hop).getByRole("alert").textContent).toContain("commission_policies:activate");
    expect(within(hop).queryByRole("textbox")).toBeNull();
    expect(within(hop).queryByRole("button", { name: /^(Lưu|Gỡ nguồn)$/ })).toBeNull();
    expect(within(hop).getByRole("button", { name: "Đóng" })).toBeTruthy();
    unmount();
    cleanup();
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} coQuyenKichHoat={false} dinhTienTheoMa={dinhTienTheoMa} />);
    chon("p-da", ""); // nguồn CŨ (PAID_ADS) dính tiền, gỡ Page
    moHop("p-da");
    hop = screen.getByRole("dialog");
    expect(within(hop).getByRole("alert").textContent).toContain("commission_policies:activate");
    cleanup();
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} coQuyenKichHoat dinhTienTheoMa={dinhTienTheoMa} />);
    chon("p-da", "WALK_IN");
    moHop("p-da");
    hop = screen.getByRole("dialog");
    expect(within(hop).queryByRole("alert")).toBeNull();
    expect(within(hop).getByRole("textbox")).toBeTruthy();
    expect(within(hop).getByRole("button", { name: /^Lưu$/ })).toBeTruthy();
  });

  it("e. máy chủ TỪ CHỐI ⇒ hộp thoại GIỮ MỞ, lý do đã gõ còn nguyên, lỗi hiện ngay trong hộp thoại; thử lại thành công ⇒ đóng + lỗi cũ biến mất; Huỷ rồi mở lại ⇒ không hiện sẵn lỗi cũ", async () => {
    // Cấy: đưa `setHoi(null)` về trước nhánh `!r.ok` (như cũ) ⇒ hộp thoại đóng, lý do mất, lỗi chỉ ở dòng phía sau (đỏ).
    const luu = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: "Bảng vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "vuaDoi" })
      .mockResolvedValueOnce({ ok: true as const, doi: true });
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} />);
    chon("p-chua", "WALK_IN");
    moHop("p-chua");
    xacNhanDoiNguon();
    const hop = await screen.findByRole("dialog");
    await waitFor(() => expect(within(hop).getByRole("alert").textContent).toContain("vừa được người khác thay đổi"));
    expect((within(hop).getByRole("textbox") as HTMLTextAreaElement).value).toBe(LY_DO); // lý do KHÔNG mất
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    // Thử lại ngay trong hộp thoại, không gõ lại lý do.
    fireEvent.click(within(hop).getByRole("button", { name: /^Lưu$/ }));
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(2));
    expect(luu).toHaveBeenLastCalledWith({ pageId: "p-chua", groupCode: "WALK_IN", campaignCode: null, lyDo: LY_DO });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(hang("p-chua")).queryByRole("alert")).toBeNull(); // lỗi cũ không treo cạnh lượt đã thành công
    expect(TOAST.success).toHaveBeenCalledTimes(1);
    cleanup();

    // Huỷ sau khi bị từ chối rồi MỞ LẠI: hộp thoại mới không hiện sẵn lỗi của lượt trước.
    const luu2 = vi.fn(async () => ({ ok: false as const, error: "Lỗi cũ của lượt trước", field: "x" }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu2} />);
    chon("p-chua", "WALK_IN");
    moHop("p-chua");
    xacNhanDoiNguon();
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("Lỗi cũ"));
    huyHopThoai();
    moHop("p-chua");
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });

  it("d. ĐỐI CHỨNG DƯƠNG: cả nguồn cũ lẫn mới KHÔNG dính tiền + người xem thiếu quyền ⇒ vẫn gõ lý do và lưu được", async () => {
    const luu = vi.fn(async () => ({ ok: true as const, doi: true }));
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={luu} coQuyenKichHoat={false} dinhTienTheoMa={{ PAID_ADS: false, WALK_IN: false }} />);
    chon("p-chua", "WALK_IN");
    moHop("p-chua");
    xacNhanDoiNguon();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
  });
});

describe("[NHH-UI-PM-03] QueueToggle — chế độ 'Page mapping' chỉ có ở tab Nguồn", () => {
  it("docCheDoXem nhận ba giá trị, còn lại rơi về hàng chờ", () => {
    expect(docCheDoXem("page-mapping")).toBe("page-mapping");
    expect(docCheDoXem("tat-ca")).toBe("tat-ca");
    expect(docCheDoXem(null)).toBe("can-xu-ly");
    expect(docCheDoXem("xxx")).toBe("can-xu-ly");
  });

  it("có `soPageChuaMap` ⇒ vẽ liên kết 'Page mapping' (kèm số khi > 0) trỏ `?xem=page-mapping`; giữ cơ sở", () => {
    render(<QueueToggle basePath="/nguon-hoa-hong/nguon" dangXem="can-xu-ly" soCanXuLy={30} soPageChuaMap={2} giu={{ coSo: "cs1" }} />);
    const a = screen.getByRole("link", { name: /Page mapping/ });
    expect(a.getAttribute("href")).toBe("/nguon-hoa-hong/nguon?coSo=cs1&xem=page-mapping");
    expect(a.textContent).toContain("(2)");
    expect(screen.getByRole("link", { name: /Cần xử lý/ }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon?coSo=cs1");
  });

  it("số = 0 hoặc không biết ⇒ không in '(0)'; chế độ đang xem có aria-current", () => {
    render(<QueueToggle basePath="/x" dangXem="page-mapping" soCanXuLy={null} soPageChuaMap={0} />);
    const a = screen.getByRole("link", { name: /Page mapping/ });
    expect(a.textContent).toBe("Page mapping");
    expect(a.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Tất cả/ }).getAttribute("aria-current")).toBeNull();
  });

  it("[NHH-UI-PM-03b] đang ở chế độ 'Page mapping' mà có cơ sở đang chọn ⇒ hai liên kết quay lại GIỮ cơ sở (đi vào bằng `?coSo=`, bấm quay ra không bị đẩy về 'Tất cả cơ sở')", () => {
    render(<QueueToggle basePath="/nguon-hoa-hong/nguon" dangXem="page-mapping" soCanXuLy={3} soPageChuaMap={1} giu={{ coSo: "cs2" }} />);
    expect(screen.getByRole("link", { name: /Cần xử lý/ }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon?coSo=cs2");
    expect(screen.getByRole("link", { name: /Tất cả/ }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon?coSo=cs2&xem=tat-ca");
  });

  it("đối chứng: KHÔNG truyền `soPageChuaMap` (tab khác) ⇒ chỉ hai liên kết, không có 'Page mapping'", () => {
    render(<QueueToggle basePath="/x" dangXem="can-xu-ly" soCanXuLy={5} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByText(/Page mapping/)).toBeNull();
  });
});

describe("[W4-PM-01] 375px — nút Lưu/Huỷ không nằm ngoài khung nhìn; vùng bấm đạt chuẩn; chú thích không tự mâu thuẫn", () => {
  const chon = (id: string, nhan: string) => fireEvent.change(within(hang(id)).getByRole("combobox"), { target: { value: nhan } });

  it("ô chứa Lưu/Huỷ DÍNH mép phải dưới md (bảng min-w-820 cuộn ngang), nút cao ≥44px dưới md; dòng chưa đổi KHÔNG dính", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    chon("p-chua", "WALK_IN");
    const o = within(hang("p-chua")).getByRole("button", { name: /^Lưu nguồn của Page/ }).closest("td") as HTMLElement;
    expect(o.className).toContain("sticky");
    expect(o.className).toContain("right-0");
    expect(o.className).toContain("md:relative");
    for (const b of within(o).getAllByRole("button")) {
      expect(b.className, b.textContent ?? "").toContain("h-11");
      expect(b.className, b.textContent ?? "").toContain("md:h-8");
    }
    // vùng cuộn ngang phải là khối bao có định vị: nhãn sr-only (absolute) không được thoát ra làm cả trang cuộn ngang (đo thật 375px: doc 523 > 375)
    expect(screen.getByRole("table").parentElement!.className).toContain("relative");
    // đối chứng: ô trạng thái của dòng KHÔNG đổi không dính (nếu dính thì che cột Nguồn khi cuộn)
    const oKhac = within(hang("p-da")).getByText("Đã gán").closest("td") as HTMLElement;
    expect(oKhac.className).not.toContain("sticky");
  });

  it("chú thích dưới bảng: cờ BẬT ⇒ nói lead sẽ tự nhận nguồn; cờ TẮT ⇒ KHÔNG khẳng định điều đó (chỉ nói 'khi bật')", () => {
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat luu={vi.fn()} />);
    expect(screen.getByText(/Lead vào từ một Page đã gán sẽ tự nhận đúng nguồn đó/)).toBeTruthy();
    cleanup();
    render(<Bang dong={DONG} nhom={NHOM} coTheSua runtimeBat={false} luu={vi.fn()} />);
    expect(screen.queryByText(/Lead vào từ một Page đã gán sẽ tự nhận đúng nguồn đó/)).toBeNull();
    expect(screen.getByText(/Khi tính năng tự gán nguồn theo Page được bật/)).toBeTruthy();
    expect(screen.getByText(/chưa có tác dụng/)).toBeTruthy();
  });
});
