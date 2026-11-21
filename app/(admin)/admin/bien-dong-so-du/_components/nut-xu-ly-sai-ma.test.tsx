// @vitest-environment jsdom
/**
 * [NXS-*] — nút Duyệt / Từ chối yêu cầu "nhập sai mã": KHÔNG bấm lại được trong lúc chờ tải lại (#665 mục 4).
 *
 * Gốc: nút khoá bằng `useTransition`, mà transition hết ngay khi action trả về — còn `router.refresh()` vẽ lại hàng mất ~1,5 giây (đo ở nghiệm thu 12/10/2026). Khoảng đó nút sáng lại,
 * hàng vẫn ghi "Chờ duyệt / Duyệt / Từ chối" ⇒ dễ bấm đúp. Nay `daXuLy` giữ khoá tới khi hàng được thay; thất bại / rớt kết nối thì mở lại để bấm lại.
 *
 * Đo ĐÚNG khoảng hở: action đã trả (promise resolve) + `refresh` đã gọi, nhưng cây chưa được thay ⇒ nút phải còn khoá. Đối chứng dương: thất bại ⇒ nút mở lại.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  duyetSaiMaAction: vi.fn(),
  tuChoiSaiMaAction: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../_pos-sai-ma-actions", () => ({ duyetSaiMaAction: h.duyetSaiMaAction, tuChoiSaiMaAction: h.tuChoiSaiMaAction }));

import { NutXuLySaiMa } from "./nut-xu-ly-sai-ma";

function dung() {
  return render(<NutXuLySaiMa orderId="o1" yeuCauId="y1" tomTat="ORD-1 · 3.168.000đ" laNguoiGui={false} thuLai={false} />);
}
const nutDuyet = () => screen.getByRole("button", { name: "Duyệt" }) as HTMLButtonElement;
const nutTuChoi = () => screen.getByRole("button", { name: "Từ chối" }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});
afterEach(() => cleanup());

describe("[NXS] Duyệt / Từ chối không sáng lại trước khi hàng được thay", () => {
  it("[NXS-01] ĐỐI CHỨNG DƯƠNG: trước khi bấm, hai nút bật", () => {
    dung();
    expect(nutDuyet().disabled).toBe(false);
    expect(nutTuChoi().disabled).toBe(false);
  });

  it("[NXS-02] Duyệt thành công ⇒ action đã trả, `refresh` đã gọi, hàng CHƯA thay ⇒ CẢ HAI nút vẫn khoá (không bấm đúp được)", async () => {
    h.duyetSaiMaAction.mockResolvedValue({ ok: true, trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận." });
    dung();
    fireEvent.click(nutDuyet());
    expect(nutDuyet().disabled, "khoá NGAY khi bấm").toBe(true);
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.duyetSaiMaAction).toHaveBeenCalledTimes(1);
    expect(nutDuyet().disabled, "action đã xong nhưng hàng chưa đổi ⇒ vẫn khoá").toBe(true);
    expect(nutTuChoi().disabled).toBe(true);
    fireEvent.click(nutDuyet());
    expect(h.duyetSaiMaAction, "bấm lần hai không gửi thêm").toHaveBeenCalledTimes(1);
  });

  it("[NXS-03] Duyệt bị máy chủ TỪ CHỐI ⇒ nút mở lại (còn việc để làm)", async () => {
    h.duyetSaiMaAction.mockResolvedValue({ ok: false, error: "Yêu cầu vừa đổi trạng thái" });
    dung();
    fireEvent.click(nutDuyet());
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Yêu cầu vừa đổi trạng thái"));
    await waitFor(() => expect(nutDuyet().disabled).toBe(false));
  });

  it("[NXS-04] rớt kết nối giữa chừng ⇒ nói chưa rõ kết quả và mở lại nút", async () => {
    h.duyetSaiMaAction.mockRejectedValue(new Error("network"));
    dung();
    fireEvent.click(nutDuyet());
    await waitFor(() => expect(h.error).toHaveBeenCalledWith(expect.stringMatching(/chưa rõ đã duyệt chưa/)));
    await waitFor(() => expect(nutDuyet().disabled).toBe(false));
  });
});
