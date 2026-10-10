// @vitest-environment jsdom
/**
 * [NHH-UI-QF-*] — Ô CHỌN NGUỒN của form nhập lead, trên PHẦN TỬ THẬT (jsdom). Luật: cơ sở ép chọn ⇒ BỎ ô gõ tự do + datalist,
 * ép chọn nguồn + người + giải trình; cờ tắt / cơ sở chưa ép ⇒ hành vi CŨ y nguyên (đối chứng dương ở từng ca).
 * Hàm gọi máy chủ được mock; luật máy chủ có ca DB riêng (`tests/lead-intake/nguon-ui-nhap-lead.spec.ts`).
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

const CENTERS = [
  { code: "CS1", name: "Cơ sở 1" },
  { code: "CS2", name: "Cơ sở 2" },
];

const g = (p: Partial<NhomChon> & Pick<NhomChon, "id" | "code" | "name">): NhomChon => ({
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  sortOrder: 1,
  ...p,
});
const DANH_MUC: NhomChon[] = [
  g({ id: "g2", code: "PAID_ADS", name: "Nguồn từ Quảng Cáo" }),
  g({ id: "g5", code: "EMPLOYEE_REFERRAL", name: "Nguồn từ nhân sự giới thiệu", referrerRequirement: "EMPLOYEE" }),
  // Nguồn do ADMIN tạo (không nằm trong 9 mã gốc) cũng yêu cầu nhân sự — dựng ca "bấm một nhóm, ghi vào nhóm nhân sự gốc".
  g({ id: "g7", code: "TRUONG_HOC", name: "Nguồn từ Trường học", referrerRequirement: "EMPLOYEE" }),
  g({ id: "g11", code: "OTHER", name: "Nguồn khác", requiresNote: true }),
];
/** CS1 ép chọn; CS2 và "để hệ thống tự chia" thì không. */
const NGUON: NguonChoFormNhap = { danhMuc: DANH_MUC, epMacDinh: false, epTheoCoSo: { CS1: true, CS2: false } };

const chonCoSo = (ma: string) => fireEvent.change(screen.getByLabelText("Cơ sở phụ huynh chọn"), { target: { value: ma } });
const luu = () => fireEvent.click(screen.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }));
const goSdt = () => fireEvent.change(screen.getByLabelText("SĐT phụ huynh"), { target: { value: "0905123456" } });
const lanGoi = () => ACT.tao.mock.calls[0]![0] as Record<string, unknown>;

describe("[NHH-UI-QF-01] ô chọn nguồn chỉ thay ô gõ tự do khi cơ sở ÉP CHỌN", () => {
  it("không truyền `nguon` (cờ tắt) ⇒ ô gõ tự do + datalist y như cũ, KHÔNG có ô chọn", () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} />);
    expect(document.querySelector("datalist#nguon-goi-y")).not.toBeNull();
    expect(screen.getByLabelText("Nguồn")).toBeTruthy();
    expect(screen.queryByTestId("o-chon-nguon")).toBeNull();
  });

  it("chưa chọn cơ sở (cờ toàn hệ TẮT) ⇒ ô cũ; chọn CS1 (ép) ⇒ ô chọn nguồn, BỎ datalist; chọn CS2 (không ép) ⇒ ô cũ trở lại", () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    expect(screen.queryByTestId("o-chon-nguon")).toBeNull();
    chonCoSo("CS1");
    expect(screen.getByTestId("o-chon-nguon")).toBeTruthy();
    expect(document.querySelector("datalist#nguon-goi-y")).toBeNull();
    expect(screen.queryByLabelText("Nguồn")).toBeNull(); // ô gõ tự do đã bỏ
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    chonCoSo("CS2");
    expect(screen.queryByTestId("o-chon-nguon")).toBeNull();
    expect(document.querySelector("datalist#nguon-goi-y")).not.toBeNull();
  });

  it("cờ TOÀN HỆ bật (epMacDinh) ⇒ phiếu 'để hệ thống tự chia' cũng phải chọn nguồn", () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={{ ...NGUON, epMacDinh: true }} />);
    expect(screen.getByTestId("o-chon-nguon")).toBeTruthy();
  });
});

describe("[NHH-UI-QF-02] gửi phiếu: kiểm trước, gửi đúng thứ đang hiển thị", () => {
  it("cơ sở ép chọn mà chưa chọn nguồn ⇒ lỗi CẠNH ô + toast, KHÔNG gọi máy chủ", async () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    chonCoSo("CS1");
    goSdt();
    luu();
    expect(await screen.findByText("Chọn một nguồn.")).toBeTruthy();
    expect(TOAST.error).toHaveBeenCalled();
    expect(ACT.tao).not.toHaveBeenCalled();
  });

  it("lỗi CŨ biến mất khi chọn lại nguồn (câu 'Chọn một nguồn.' không được nằm đó sau khi đã chọn)", async () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    chonCoSo("CS1");
    goSdt();
    luu();
    expect(await screen.findByText("Chọn một nguồn.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    expect(screen.queryByText("Chọn một nguồn.")).toBeNull();
  });

  it("nguồn cần nhân sự mà chưa chọn ⇒ lỗi đúng câu của máy chủ cạnh ô tìm; nguồn 'Khác' thiếu giải trình ⇒ lỗi cạnh ô giải trình", async () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    chonCoSo("CS1");
    goSdt();
    fireEvent.click(screen.getByLabelText(/Nguồn từ nhân sự giới thiệu/));
    luu();
    expect((await screen.findByText("Nguồn này cần chọn nhân sự giới thiệu.")).getAttribute("role")).toBe("alert");
    fireEvent.click(screen.getByLabelText(/Nguồn khác/));
    luu();
    expect(await screen.findByText(/giải trình từ 10 ký tự/)).toBeTruthy();
    expect(ACT.tao).not.toHaveBeenCalled();
  });

  it("chọn nguồn hợp lệ ⇒ gửi `nguonChon` (id nhóm) và `source: null` — chữ gõ tay còn sót KHÔNG đi cùng ô chọn", async () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    // gõ nhãn ở ô cũ TRƯỚC khi đổi sang cơ sở ép chọn — nhãn này không được lọt vào phiếu
    fireEvent.change(screen.getByLabelText("Nguồn"), { target: { value: "Facebook Ads" } });
    chonCoSo("CS1");
    goSdt();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    luu();
    await waitFor(() => expect(ACT.tao).toHaveBeenCalledTimes(1));
    expect(lanGoi()).toMatchObject({
      source: null,
      centerCode: "CS1",
      nguonChon: { groupId: "g2", employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null },
    });
  });

  it("chọn nhân sự là GIÁO VIÊN ở nhóm nhân sự do admin tạo ⇒ gửi ĐÚNG nhóm admin tạo (g7) + employeeId — vai không đổi nhóm", async () => {
    ACT.tim.mockResolvedValueOnce({
      ok: true,
      ketQua: [{ loai: "NHAN_SU", employeeId: "e-gv", ten: "Cô Lan", ma: "SR.NV.07", vai: "TEACHER" }],
    });
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    chonCoSo("CS1");
    goSdt();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Trường học/));
    fireEvent.change(screen.getByLabelText("Nhân sự giới thiệu"), { target: { value: "Lan" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option"));
    luu();
    await waitFor(() => expect(ACT.tao).toHaveBeenCalledTimes(1));
    expect(lanGoi().nguonChon).toMatchObject({ groupId: "g7", employeeId: "e-gv" });
  });

  it("nguồn 'Khác' + giải trình ⇒ gửi giải trình đã trim", async () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    chonCoSo("CS1");
    goSdt();
    fireEvent.click(screen.getByLabelText(/Nguồn khác/));
    fireEvent.change(screen.getByLabelText(/Giải trình nguồn/), { target: { value: "  khách đến từ hội thảo STEM  " } });
    luu();
    await waitFor(() => expect(ACT.tao).toHaveBeenCalledTimes(1));
    expect(lanGoi().nguonChon).toMatchObject({ groupId: "g11", giaiTrinh: "khách đến từ hội thảo STEM" });
  });

  it("cơ sở KHÔNG ép (CS2) ⇒ hành vi cũ: gửi nhãn gõ tay, `nguonChon: null`", async () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    chonCoSo("CS2");
    goSdt();
    fireEvent.change(screen.getByLabelText("Nguồn"), { target: { value: "Facebook Ads" } });
    luu();
    await waitFor(() => expect(ACT.tao).toHaveBeenCalledTimes(1));
    expect(lanGoi()).toMatchObject({ source: "Facebook Ads", nguonChon: null });
  });

  it("lưu xong ⇒ ô chọn nguồn được XOÁ cho phiếu kế tiếp (không mang nguồn của khách trước sang khách sau)", async () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} nguon={NGUON} />);
    chonCoSo("CS1");
    goSdt();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    luu();
    await waitFor(() => expect(ACT.tao).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(TOAST.success).toHaveBeenCalled());
    // form reset ⇒ cơ sở về "để hệ thống tự chia" ⇒ ô chọn biến mất; chọn lại CS1 thì nguồn phải TRỐNG
    chonCoSo("CS1");
    expect((screen.getByLabelText(/Nguồn từ Quảng Cáo/) as HTMLInputElement).checked).toBe(false);
  });
});
