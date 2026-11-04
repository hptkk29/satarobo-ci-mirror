// @vitest-environment jsdom
/**
 * LANE C1 «NGUỒN Ở LỚP NHẬP» — form Nhập khách hàng trên PHẦN TỬ THẬT (jsdom): trạng thái gửi · bàn phím + nhãn + lỗi của ô chọn nguồn · luật theo THUỘC TÍNH của nguồn tuỳ biến.
 * Bổ sung cho `quick-lead-form-nguon.test.tsx` (NHH-UI-QF-*) — không chép lại ca đã có.
 *
 *   [SRC-ENT-09]  đang gửi ⇒ nút Lưu `disabled` + chữ «Đang lưu…», ô chọn nguồn khoá, bấm lần hai KHÔNG gọi máy chủ lần hai; đối chứng dương: chưa gửi ⇒ nút bấm được
 *   [SRC-ENT-10]  ô chọn nguồn: có nhãn, mở bằng ↓, ô tìm nhận focus, tìm KHÔNG DẤU, ↑/↓ + Enter chọn, Esc đóng trả focus; lỗi hiện `role=alert` + `aria-invalid` + `aria-describedby` trỏ đúng
 *   [SRC-ENT-11]  nguồn TUỲ BIẾN (không phải «Khác», không phải mã gốc): kiểu PHỤ HUYNH / ĐỐI TÁC bắt chọn người; `requiresNote` ⇒ hiện ô «Giải trình nguồn» + bắt ≥10 ký tự; nguồn không cần ⇒ không hiện ô
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ACT = vi.hoisted(() => ({
  tao: vi.fn(async (_: unknown) => ({ ok: true as const, leadId: "lead-1" })),
  tim: vi.fn(async (_: unknown) => ({ ok: true as const, ketQua: [] as unknown[] })),
}));
vi.mock("@/lib/lead/intake/quick-form-action", () => ({ createInternalLeadAction: ACT.tao }));
vi.mock("@/app/(admin)/admin/leads/nguon-actions", () => ({
  timNguoiGioiThieuAction: ACT.tim,
  moGanNguonAction: vi.fn(),
  doiNguonLeadAction: vi.fn(),
}));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { QuickLeadForm } from "@/components/lead-intake/quick-lead-form";
import type { NhomChon } from "@/lib/nguon/chon-nguon";
import type { NguonChoFormNhap } from "@/lib/nguon/nguon-cho-form-nhap";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const g = (p: Partial<NhomChon> & Pick<NhomChon, "id" | "code" | "name">): NhomChon => ({
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  sortOrder: 1,
  ...p,
});
const DANH_MUC: NhomChon[] = [
  g({ id: "g2", code: "PAID_ADS", name: "Nguồn từ Quảng Cáo" }),
  g({ id: "g3", code: "WALK_IN", name: "Nguồn khách tự đến trung tâm" }),
  // Nguồn do ADMIN tạo — mã KHÔNG nằm trong 9 mã gốc, tên KHÔNG phải «Khác»: hành vi chỉ được đến từ THUỘC TÍNH.
  g({ id: "gph", code: "CLB_PHU_HUYNH", name: "CLB phụ huynh Sata", referrerRequirement: "PARENT" }),
  g({ id: "gdt", code: "TRUONG_DOI_TAC", name: "Trường đối tác", referrerRequirement: "AFFILIATE_ORG" }),
  g({ id: "gct", code: "HOI_THAO_NGOAI", name: "Hội thảo ngoài", requiresNote: true }),
];
/** Module Nguồn BẬT ⇒ `epMacDinh: true`: phiếu nào cũng phải chọn nguồn. */
const NGUON: NguonChoFormNhap = { danhMuc: DANH_MUC, epMacDinh: true, epTheoCoSo: { CS1: true } };
const CENTERS = [{ code: "CS1", name: "Cơ sở 1" }];

const oNguon = () => screen.getByRole("combobox", { name: /Nguồn khách hàng/ });
function chonNguon(ten: RegExp | string) {
  const o = oNguon();
  if (o.getAttribute("aria-expanded") !== "true") fireEvent.click(o);
  fireEvent.click(screen.getByRole("option", { name: ten }));
}
const luu = () => fireEvent.click(screen.getByRole("button", { name: /Lưu và nhập phiếu tiếp|Đang lưu/ }));
const goSdt = () => fireEvent.change(screen.getByLabelText("SĐT phụ huynh"), { target: { value: "0905123456" } });
/** Chỉ các dòng của ô nguồn (form còn `<select>` cơ sở / khoá cũng mang role option). */
const dongNguon = () => within(screen.getByRole("listbox", { name: "Danh sách nguồn khách hàng" })).getAllByRole("option");
const dung = () => render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);

describe("[SRC-ENT-09] trạng thái GỬI của form", () => {
  it("đang gửi ⇒ nút Lưu disabled + «Đang lưu…», ô chọn nguồn khoá, bấm lại KHÔNG gọi máy chủ lần hai; chưa gửi ⇒ nút bấm được (đối chứng)", async () => {
    // Lời hứa KHÔNG BAO GIỜ hoàn tất ⇒ `useTransition` ở lại `pending`.
    ACT.tao.mockImplementationOnce(() => new Promise(() => {}));
    dung();
    goSdt();
    chonNguon(/Nguồn từ Quảng Cáo/);
    const nut = screen.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }) as HTMLButtonElement;
    expect(nut.disabled).toBe(false); // đối chứng dương: đủ dữ liệu ⇒ bấm được
    expect((oNguon() as HTMLButtonElement).disabled).toBe(false);

    luu();
    await waitFor(() => expect((screen.getByRole("button", { name: /Đang lưu/ }) as HTMLButtonElement).disabled).toBe(true));
    expect((oNguon() as HTMLButtonElement).disabled).toBe(true);
    luu();
    luu();
    expect(ACT.tao).toHaveBeenCalledTimes(1);
  });
});

describe("[SRC-ENT-10] ô chọn nguồn: nhãn · bàn phím · tìm không dấu · lỗi có thể nghe thấy", () => {
  it("nhãn nối đúng ô; ↓ mở + focus vào ô tìm; gõ KHÔNG DẤU lọc; Enter chọn + đóng + trả focus về nút", () => {
    dung();
    const o = screen.getByLabelText("Nguồn khách hàng");
    expect(o).toBe(oNguon()); // `<label htmlFor>` nối với chính combobox
    expect(o.getAttribute("aria-haspopup")).toBe("listbox");
    expect(o.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(o, { key: "ArrowDown" });
    expect(o.getAttribute("aria-expanded")).toBe("true");
    const tim = screen.getByRole("searchbox", { name: "Tìm nguồn" });
    expect(document.activeElement).toBe(tim);
    expect(dongNguon()).toHaveLength(DANH_MUC.length);

    fireEvent.change(tim, { target: { value: "quang cao" } }); // không dấu, không hoa
    const con = dongNguon();
    expect(con).toHaveLength(1);
    expect(con[0]!.textContent).toContain("Nguồn từ Quảng Cáo");

    fireEvent.keyDown(tim, { key: "Enter" });
    expect(o.getAttribute("aria-expanded")).toBe("false");
    expect(o.textContent).toContain("Nguồn từ Quảng Cáo");
    expect(document.activeElement).toBe(o);
  });

  it("↑/↓ đổi dòng đang sáng (aria-activedescendant); Esc đóng danh sách và trả focus về nút", () => {
    dung();
    const o = oNguon();
    fireEvent.keyDown(o, { key: "ArrowDown" });
    const tim = screen.getByRole("searchbox", { name: "Tìm nguồn" });
    const sang = () => tim.getAttribute("aria-activedescendant");
    const dau = sang();
    expect(dau).toBeTruthy();
    fireEvent.keyDown(tim, { key: "ArrowDown" });
    const hai = sang();
    expect(hai).not.toBe(dau);
    fireEvent.keyDown(tim, { key: "ArrowUp" });
    expect(sang()).toBe(dau);

    fireEvent.keyDown(tim, { key: "Escape" });
    expect(o.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(o);
  });

  it("chưa chọn nguồn mà bấm Lưu ⇒ lỗi `role=alert` cạnh ô + `aria-invalid` + `aria-describedby` trỏ ĐÚNG phần tử lỗi; chọn lại ⇒ lỗi và `aria-invalid` biến mất", async () => {
    dung();
    goSdt();
    luu();
    const loi = await screen.findByText("Chọn một nguồn.");
    expect(loi.getAttribute("role")).toBe("alert");
    const o = oNguon();
    expect(o.getAttribute("aria-invalid")).toBe("true");
    expect(o.getAttribute("aria-describedby")).toBe(loi.id);
    expect(ACT.tao).not.toHaveBeenCalled();

    chonNguon(/Nguồn từ Quảng Cáo/);
    expect(screen.queryByText("Chọn một nguồn.")).toBeNull();
    expect(oNguon().getAttribute("aria-invalid")).toBeNull();
  });
});

describe("[SRC-ENT-11] nguồn TUỲ BIẾN: hành vi đi theo THUỘC TÍNH, không theo mã/tên", () => {
  it("nguồn kiểu PHỤ HUYNH / ĐỐI TÁC chưa chọn người ⇒ lỗi đúng câu của máy chủ, KHÔNG gọi máy chủ; đối chứng: nguồn không cần người ⇒ gọi", async () => {
    dung();
    goSdt();
    chonNguon(/CLB phụ huynh Sata/);
    luu();
    expect((await screen.findByText("Nguồn này cần chọn phụ huynh giới thiệu.")).getAttribute("role")).toBe("alert");
    chonNguon(/Trường đối tác/);
    luu();
    expect(await screen.findByText("Nguồn này cần chọn đối tác giới thiệu.")).toBeTruthy();
    expect(ACT.tao).not.toHaveBeenCalled();

    chonNguon(/Nguồn khách tự đến trung tâm/);
    luu();
    await waitFor(() => expect(ACT.tao).toHaveBeenCalledTimes(1));
    expect((ACT.tao.mock.calls[0]![0] as { nguonChon: { groupId: string } }).nguonChon.groupId).toBe("g3");
  });

  it("`requiresNote` của nguồn tuỳ biến ⇒ hiện ô «Giải trình nguồn» (có nhãn), ngắn ⇒ lỗi cạnh ô, đủ ⇒ gửi giải trình đã trim; nguồn KHÔNG cần ⇒ KHÔNG có ô", async () => {
    dung();
    goSdt();
    chonNguon(/Nguồn từ Quảng Cáo/);
    expect(screen.queryByLabelText(/Giải trình nguồn/)).toBeNull(); // đối chứng: nguồn thường không có ô

    chonNguon(/Hội thảo ngoài/);
    const o = screen.getByLabelText(/Giải trình nguồn/) as HTMLTextAreaElement; // `<label htmlFor>` ↔ textarea
    expect(o.tagName).toBe("TEXTAREA");
    fireEvent.change(o, { target: { value: "ngắn ok" } });
    luu();
    const loi = await screen.findByText(/giải trình từ 10 ký tự \(hiện 7\)/);
    expect(loi.getAttribute("role")).toBe("alert");
    expect(o.getAttribute("aria-invalid")).toBe("true");
    expect(o.getAttribute("aria-describedby")).toBe(loi.id);
    expect(ACT.tao).not.toHaveBeenCalled();

    fireEvent.change(o, { target: { value: "  khách quen của hội thảo STEM  " } });
    luu();
    await waitFor(() => expect(ACT.tao).toHaveBeenCalledTimes(1));
    expect((ACT.tao.mock.calls[0]![0] as { nguonChon: unknown }).nguonChon).toMatchObject({ groupId: "gct", giaiTrinh: "khách quen của hội thảo STEM" });
  });
});
