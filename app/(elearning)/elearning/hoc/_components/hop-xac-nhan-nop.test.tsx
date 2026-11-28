/**
 * [HXN-*] Hộp xác nhận nộp bài thi: n/m, câu chưa làm kèm "Mở câu N", hai nút; KHÔNG tự nộp khi mở.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HopXacNhanNop } from "./hop-xac-nhan-nop";

afterEach(cleanup);

function ve(o: Partial<Parameters<typeof HopXacNhanNop>[0]> = {}) {
  const f = { doiMo: vi.fn(), moCau: vi.fn(), nop: vi.fn() };
  render(<HopXacNhanNop mo soDaLam={11} tong={12} cauChuaLam={[7]} conLaiChu="14:20" dangNop={false} {...f} {...o} />);
  return f;
}

describe("[HXN-01] nội dung", () => {
  it("đã trả lời 11/12, đồng hồ còn lại, liệt kê câu chưa làm", () => {
    ve();
    expect(screen.getByText("11/12")).toBeTruthy();
    expect(screen.getByText("14:20")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Câu chưa làm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mở câu 7" })).toBeTruthy();
  });
  it("làm hết ⇒ KHÔNG có danh sách câu chưa làm (không khung rỗng)", () => {
    ve({ soDaLam: 12, cauChuaLam: [] });
    expect(screen.queryByRole("list", { name: "Câu chưa làm" })).toBeNull();
  });
  it("đóng (mo=false) ⇒ không vẽ gì", () => {
    ve({ mo: false });
    expect(screen.queryByText("Nộp bài?")).toBeNull();
  });
});

describe("[HXN-02] hành động", () => {
  it("'Mở câu 7' gọi moCau(7); 'Làm tiếp' đóng; 'Nộp bài' mới nộp — mở hộp KHÔNG tự nộp", () => {
    const f = ve();
    expect(f.nop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mở câu 7" }));
    expect(f.moCau).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "Làm tiếp" }));
    expect(f.doiMo).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài" }));
    expect(f.nop).toHaveBeenCalledTimes(1);
  });
  it("đang nộp ⇒ nút Nộp bị khoá (không nộp hai lần)", () => {
    ve({ dangNop: true });
    expect((screen.getByRole("button", { name: "Đang nộp…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[HXN-03] hết giờ", () => {
  it("không mời 'Mở câu N' / 'Làm tiếp' (máy chủ sẽ từ chối lưu); chỉ còn nộp; nói rõ câu trống tính 0", () => {
    ve({ hetGio: true, cauChuaLam: [7] });
    expect(screen.queryByRole("button", { name: "Mở câu 7" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Làm tiếp" })).toBeNull();
    expect(screen.getByText(/Đã hết giờ — chỉ còn nộp bài\. Câu chưa làm sẽ tính 0 điểm\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nộp bài" })).toBeTruthy(); // đối chứng dương: vẫn nộp được
  });
});
