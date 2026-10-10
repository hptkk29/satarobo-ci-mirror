// @vitest-environment jsdom
/**
 * Ô CHỌN của trình sửa tham số vận hành [F3 · 22/09/2026].
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────────
 * Chủ dự án chốt *"làm cho quản lý tự cài đặt cho phần này trên hệ thống"*, nên chính sách
 * ưu đãi anh em nay là tham số vận hành — trong đó có hai tham số dạng CHỮ chỉ nhận vài giá
 * trị định trước. Trình sửa suy kiểu ô nhập từ GIÁ TRỊ, nên chuỗi ra ô chữ TRẮNG: quản lý
 * phải tự gõ `HOC_PHI_THAP_HON`, gõ sai thì nhận một câu lỗi kỹ thuật. Đó là affordance nói
 * dối (luật 12), và bốn ca dưới canh đúng bốn lời hứa của bản vá:
 *
 *  1. có danh sách chọn ⇒ vẽ `<select>` với ĐỦ mục, KHÔNG vẽ ô chữ tự do;
 *  2. mục đang chọn hiện đúng giá trị ĐANG LƯU;
 *  3. đổi mục thì HỆ QUẢ của mục đó hiện ra ngay — thứ duy nhất giúp quản lý quyết định;
 *  4. giá trị đang lưu KHÔNG còn trong danh sách thì phải NÓI RA, không im lặng hiện mục đầu.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../actions", () => ({ saveGlobalSettingAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { nhanCuaKey } from "@/lib/settings/nhan-van-hanh";
import { BangCauHinhTab } from "./settings-editor";

const KHOA = "billing.lateDiscountAbsorb" as const;
const NHAN = nhanCuaKey(KHOA);

function dung(value: unknown = "DOT_XA_NHAT", choSua = true) {
  return render(
    <BangCauHinhTab
      rows={[{ key: KHOA, value, nhan: NHAN }]}
      choSua={choSua}
      choSuaCoSo={choSua}
    />,
  );
}

describe("[CFGO] tham số có danh sách chọn", () => {
  it("[CFGO-00] nhãn của khoá này THẬT SỰ có danh sách chọn", () => {
    // Ca chống TAUTOLOGY: gỡ `chon` khỏi nhãn thì mọi ca dưới đo một ô chữ và vẫn xanh được.
    expect(NHAN.chon, "khoá dùng làm mẫu phải có `chon`").toBeTruthy();
    expect(NHAN.chon!.length).toBeGreaterThanOrEqual(2);
  });

  it("[CFGO-01] vẽ ô chọn với ĐỦ mục, KHÔNG vẽ ô chữ tự do", () => {
    dung();
    const o = screen.getByRole("combobox", { name: NHAN.ten });
    expect(o.tagName).toBe("SELECT");
    const muc = screen.getAllByRole("option").map((x) => x.textContent);
    expect(muc).toEqual(NHAN.chon!.map((c) => c.nhan));
    // Ô chữ tự do cho một giá trị chỉ nhận 3 khả năng là mời gõ sai.
    expect(screen.queryByRole("textbox", { name: NHAN.ten })).toBeNull();
  });

  it("[CFGO-02] mục đang chọn là giá trị ĐANG LƯU, không phải mục đầu danh sách", () => {
    dung("DOT_GAN_NHAT");
    expect(screen.getByRole("combobox", { name: NHAN.ten })).toHaveValue("DOT_GAN_NHAT");
  });

  it("[CFGO-03] đổi mục ⇒ HỆ QUẢ của mục vừa chọn hiện ra", () => {
    dung("DOT_XA_NHAT");
    const xaNhat = NHAN.chon!.find((c) => c.giaTri === "DOT_XA_NHAT")!;
    const ganNhat = NHAN.chon!.find((c) => c.giaTri === "DOT_GAN_NHAT")!;
    // Một câu hệ quả, không phải cả ba: liệt kê hết là bắt người đọc tự đối chiếu.
    expect(screen.getByText(xaNhat.hauQua!, { exact: false })).toBeTruthy();
    expect(screen.queryByText(ganNhat.hauQua!, { exact: false })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: NHAN.ten }), {
      target: { value: "DOT_GAN_NHAT" },
    });
    expect(screen.getByText(ganNhat.hauQua!, { exact: false })).toBeTruthy();
    expect(screen.queryByText(xaNhat.hauQua!, { exact: false })).toBeNull();
  });

  it("[CFGO-04] giá trị đang lưu KHÔNG còn trong danh sách ⇒ NÓI RA", () => {
    // Ca thật: ai đó ghi tay một giá trị cũ vào cơ sở dữ liệu, hoặc một lựa chọn bị gỡ khỏi
    // danh sách. Im lặng thì ô hiện mục ĐẦU TIÊN và người đọc tin đó là giá trị đang chạy —
    // rồi họ bấm Lưu một giá trị họ chưa từng chọn.
    dung("MOT_CACH_DA_GO");
    expect(screen.getByText(/không còn trong danh sách/i)).toBeTruthy();
    expect(screen.getByText(/MOT_CACH_DA_GO/)).toBeTruthy();
  });

  it("[CFGO-05] chỉ-được-xem ⇒ ô chọn bị KHOÁ, không chỉ ẩn nút Lưu", () => {
    dung("DOT_XA_NHAT", false);
    expect(screen.getByRole("combobox", { name: NHAN.ten })).toBeDisabled();
  });
});
