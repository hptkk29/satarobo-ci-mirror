// @vitest-environment jsdom
/**
 * [DHV-UI] `<NutDuyetHocVuot/>` — QLCS duyệt học vượt bù, có quyền SỬA số lượt khi không đồng ý số Sale xin (19/11/2026).
 * Ví dụ của chủ dự án: Sale xin 7 lượt cho 7 bài, Quản lý chỉ duyệt 3 lượt (3 buổi bù gom 3 + 2 + 2 bài).
 * Nút nói thật: giữ số Sale xin ⇒ duyệt luôn không đòi lý do; đổi số ⇒ hiện ô lý do và khoá nút tới khi lý do ≥ 10 ký tự; số ngoài 1..v ⇒ khoá.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ duyet: vi.fn(), tuChoi: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../_actions", () => ({
  duyetHocVuotAction: (...a: unknown[]) => h.duyet(...a),
  tuChoiHocVuotAction: (...a: unknown[]) => h.tuChoi(...a),
}));

import { NutDuyetHocVuot } from "./nut-duyet-hoc-vuot";

const mo = () => {
  render(<NutDuyetHocVuot requestId="yc-1" tenBe="Bé A" soSaleXin={7} soPhaiBu={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
};
const nutXacNhan = () => screen.getAllByRole("button").filter((b) => /^Duyệt/.test(b.textContent ?? "")).at(-1) as HTMLButtonElement;

describe("[DHV-UI] hộp Duyệt học vượt bù", () => {
  beforeEach(() => {
    h.duyet.mockReset();
    h.duyet.mockResolvedValue({ ok: true, soDongBu: 7, luotCong: 3 });
  });
  afterEach(cleanup);

  it("[DHV-UI-1] mặc định = số Sale xin; giữ nguyên ⇒ duyệt ngay, KHÔNG ô lý do, gửi soBuoiBu = số Sale xin và không kèm lyDo", async () => {
    mo();
    expect((screen.getByLabelText(/Số lượt bù duyệt/) as HTMLInputElement).value).toBe("7");
    expect(screen.queryByLabelText(/Lý do đổi/)).toBeNull();
    fireEvent.click(nutXacNhan());
    await waitFor(() => expect(h.duyet).toHaveBeenCalledTimes(1));
    expect(h.duyet).toHaveBeenCalledWith({ requestId: "yc-1", soBuoiBu: 7 });
  });

  it("[DHV-UI-2] đổi 7 → 3 ⇒ hiện ô lý do, nút khoá tới khi lý do ≥ 10 ký tự, rồi gửi soBuoiBu = 3 kèm lý do", async () => {
    mo();
    fireEvent.change(screen.getByLabelText(/Số lượt bù duyệt/), { target: { value: "3" } });
    const ly = screen.getByLabelText(/Lý do đổi từ 7 sang 3/);
    expect(nutXacNhan().disabled).toBe(true);
    fireEvent.change(ly, { target: { value: "ngắn" } });
    expect(nutXacNhan().disabled).toBe(true);
    fireEvent.change(ly, { target: { value: "Chia 3 buổi bù: 3 + 2 + 2 bài" } });
    expect(nutXacNhan().disabled).toBe(false);
    fireEvent.click(nutXacNhan());
    await waitFor(() => expect(h.duyet).toHaveBeenCalledTimes(1));
    expect(h.duyet).toHaveBeenCalledWith({ requestId: "yc-1", soBuoiBu: 3, lyDo: "Chia 3 buổi bù: 3 + 2 + 2 bài" });
  });

  it("[DHV-UI-3] số ngoài 1..v (0, 8, rỗng, lẻ) ⇒ nút khoá, không gọi server", () => {
    mo();
    const o = screen.getByLabelText(/Số lượt bù duyệt/);
    // Điền sẵn lý do hợp lệ: nếu không, nút khoá vì THIẾU LÝ DO chứ không vì số sai và ca này xanh oan khi cổng số bị gỡ.
    fireEvent.change(o, { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Lý do đổi/), { target: { value: "Chia 3 buổi bù: 3 + 2 + 2 bài" } });
    expect(nutXacNhan().disabled).toBe(false);
    for (const v of ["0", "8", "", "2.5"]) {
      fireEvent.change(o, { target: { value: v } });
      expect(nutXacNhan().disabled).toBe(true);
    }
    expect(h.duyet).not.toHaveBeenCalled();
  });
});
