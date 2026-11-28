/**
 * [ONL-CDF-*] Form "Cài đặt học tập" sau phương án A của #1300 (Owner 27/11/2026: LUÔN cho xem điểm bài đã khoá xem lại).
 * Ô tick "Cho xem điểm của bài đã khoá xem lại" bị bỏ vì không còn tác dụng; khi lưu, form vẫn GỬI NGUYÊN giá trị cờ đã lưu
 * (schema strict + trường bắt buộc: không đổi schema, không đổi dữ liệu).
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { caiDatHocTapSchema, caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { CaiDatHocTapForm } from "./cai-dat-hoc-tap-form";

const luu = vi.hoisted(() => vi.fn<(goi: { versionId: string; caiDat: unknown }) => Promise<{ ok: true }>>(async () => ({ ok: true })));
vi.mock("../_actions", () => ({ luuCaiDatAction: luu }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  luu.mockClear();
});

describe("[ONL-CDF-01] ô tick đã bỏ", () => {
  it("không còn ô 'Cho xem điểm của bài đã khoá xem lại'; ô 'Không cho xem lại bài đã qua' và ô chọn 'Hiển thị kết quả' vẫn còn", () => {
    render(<CaiDatHocTapForm versionId="v1" caiDat={caiDatKhoiDauChoBanNhap()} duocSua />);
    expect(screen.queryByText(/Cho xem điểm của bài đã khoá xem lại/)).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Không cho xem lại bài đã qua/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Hiển thị kết quả" })).toBeTruthy();
  });
});

describe("[ONL-CDF-02] tương thích đọc/lưu", () => {
  for (const coCu of [true, false]) {
    it(`cờ đã lưu = ${coCu} ⇒ bấm Lưu gửi lại đúng ${coCu}, và gói gửi đi qua được schema strict`, async () => {
      render(<CaiDatHocTapForm versionId="v1" caiDat={{ ...caiDatKhoiDauChoBanNhap(), choXemDiemBaiKhoaXemLai: coCu }} duocSua />);
      fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));
      await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
      const goi = luu.mock.calls[0]![0];
      expect(goi.versionId).toBe("v1");
      expect(goi.caiDat).toHaveProperty("choXemDiemBaiKhoaXemLai", coCu);
      expect(caiDatHocTapSchema.safeParse(goi.caiDat).success).toBe(true);
    });
  }
});
