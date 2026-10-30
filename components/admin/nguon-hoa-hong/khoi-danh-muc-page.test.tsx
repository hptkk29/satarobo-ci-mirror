// @vitest-environment jsdom
/**
 * [DMP-UI-*] KhoiDanhMucPage — trên PHẦN TỬ THẬT (jsdom), hàm lưu được TIÊM.
 *
 * Luật 12: người KHÔNG phải Quản trị tối cao không thấy khối (đối chứng dương: người CÓ thì thấy nút "Thêm Page"); Page đã cấp cho Agent mà chưa có trong
 * danh mục hiện nút gợi ý điền sẵn mã; gửi gọi ĐÚNG đầu vào (Hội sở ⇒ centerId null); lỗi máy chủ hiện ra, không đóng hộp.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions", () => ({ luuPageDanhMucAction: vi.fn() }));

import { KhoiDanhMucPage } from "./khoi-danh-muc-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CO_SO = [{ id: "cs1", name: "Cơ sở 1" }];
const DM = [{ pageId: "page-co-san-1", tenPage: "Page có sẵn", phamVi: "HO" as const, centerId: null, tenCoSo: null, dangTat: false }];
const dung = (o: Partial<React.ComponentProps<typeof KhoiDanhMucPage>> = {}) =>
  render(<KhoiDanhMucPage coTheQuanLy danhMuc={DM} goiY={[]} coSo={CO_SO} luu={vi.fn(async () => ({ ok: true as const, hanhDong: "THEM" as const, canhBao: [] }))} {...o} />);

describe("KhoiDanhMucPage", () => {
  it("[DMP-UI-01] không phải Quản trị tối cao ⇒ không vẽ gì; đối chứng dương: có quyền ⇒ thấy nút Thêm Page và Page trong danh mục", () => {
    const { container } = dung({ coTheQuanLy: false });
    expect(container.innerHTML).toBe("");
    cleanup();
    dung();
    expect(screen.getByRole("button", { name: /Thêm Page/ })).toBeTruthy();
    expect(screen.getByText("Page có sẵn")).toBeTruthy();
  });

  it("[DMP-UI-02] Page đã cấp cho Agent mà chưa có trong danh mục ⇒ gợi ý; bấm ⇒ hộp thoại điền sẵn mã; Page đã có thì KHÔNG gợi ý", () => {
    dung({ goiY: [{ pageId: "page-moi-canary", agent: "Agent A", trongDanhMuc: false }, { pageId: "page-co-san-1", agent: "Agent A", trongDanhMuc: true }] });
    expect(screen.getByRole("status").textContent).toMatch(/1 Page đã cấp cho Agent AI Lead/);
    fireEvent.click(screen.getByRole("button", { name: "Thêm vào danh mục" }));
    const hop = screen.getByRole("dialog");
    expect((within(hop).getByLabelText(/Mã Page/) as HTMLInputElement).value).toBe("page-moi-canary");
  });

  it("[DMP-UI-03] gửi Page Hội sở ⇒ gọi luu đúng đầu vào (centerId null), báo thành công, làm mới trang", async () => {
    const luu = vi.fn(async () => ({ ok: true as const, hanhDong: "THEM" as const, canhBao: [] }));
    dung({ luu });
    fireEvent.click(screen.getByRole("button", { name: /Thêm Page/ }));
    const hop = screen.getByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Mã Page/), { target: { value: " page-canary-1 " } });
    fireEvent.change(within(hop).getByLabelText(/Lý do thay đổi/), { target: { value: "Thêm Page canary AI Lead" } });
    fireEvent.submit(hop.querySelector("form")!);
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(luu).toHaveBeenCalledWith({ pageId: "page-canary-1", pageName: null, phamVi: "HO", centerId: null, isActive: true, lyDo: "Thêm Page canary AI Lead" });
    await waitFor(() => expect(TOAST.success).toHaveBeenCalled());
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("[DMP-UI-04] máy chủ từ chối ⇒ lỗi hiện trong hộp (role=alert), hộp KHÔNG đóng, không làm mới trang", async () => {
    const luu = vi.fn(async () => ({ ok: false as const, error: "Mã Page này là Page mẫu của gói bàn giao — không dùng được." }));
    dung({ luu });
    fireEvent.click(screen.getByRole("button", { name: /Thêm Page/ }));
    const hop = screen.getByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Mã Page/), { target: { value: "104500000000001" } });
    fireEvent.change(within(hop).getByLabelText(/Lý do thay đổi/), { target: { value: "Thử Page mẫu bị chặn" } });
    fireEvent.submit(hop.querySelector("form")!);
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toMatch(/Page mẫu/));
    expect(ROUTER.refresh).not.toHaveBeenCalled();
  });

  it("[DMP-UI-05] chọn 'Một cơ sở' ⇒ hiện ô Cơ sở và gửi centerId; cảnh báo Messenger CRM mới luôn hiện trong hộp", async () => {
    const luu = vi.fn(async () => ({ ok: true as const, hanhDong: "THEM" as const, canhBao: ["Đổi phạm vi Page: ..."] }));
    dung({ luu });
    fireEvent.click(screen.getByRole("button", { name: /Thêm Page/ }));
    const hop = screen.getByRole("dialog");
    expect(within(hop).getByRole("note").textContent).toMatch(/Messenger CRM/);
    expect(within(hop).queryByLabelText("Cơ sở")).toBeNull();
    fireEvent.change(within(hop).getByLabelText(/Phạm vi/), { target: { value: "CENTER" } });
    fireEvent.change(within(hop).getByLabelText("Cơ sở"), { target: { value: "cs1" } });
    fireEvent.change(within(hop).getByLabelText(/Mã Page/), { target: { value: "page-canary-2" } });
    fireEvent.change(within(hop).getByLabelText(/Lý do thay đổi/), { target: { value: "Page riêng của cơ sở 1" } });
    fireEvent.submit(hop.querySelector("form")!);
    await waitFor(() => expect(luu).toHaveBeenCalled());
    expect(luu).toHaveBeenCalledWith(expect.objectContaining({ phamVi: "CENTER", centerId: "cs1" }));
    await waitFor(() => expect(TOAST.warning).toHaveBeenCalledWith("Đổi phạm vi Page: ..."));
  });
});
