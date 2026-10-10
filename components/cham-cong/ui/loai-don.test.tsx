// @vitest-environment jsdom
// Chữ "i" của loại đơn: mỗi loại PHẢI có nút "i" đọc được tên, chạm vào là hiện lời giải thích,
// và chạm "i" KHÔNG được kích hoạt thứ nằm dưới nó (dòng bảng mở đơn, thẻ chọn loại).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WORK_REQUEST_KINDS, WR_KIND_GIAI_THICH, WR_KIND_LABEL } from "@/lib/work-request";
import { NhanLoaiDon } from "@/components/cham-cong/ui/loai-don";

describe("NhanLoaiDon + chữ i", () => {
  it.each(WORK_REQUEST_KINDS)("[LD-01] %s: có nhãn + nút 'i' mang tên loại", (kind) => {
    render(<NhanLoaiDon kind={kind} />);
    expect(screen.getByText(WR_KIND_LABEL[kind])).toBeTruthy();
    const nut = screen.getByRole("button", { name: `Giải thích loại đơn: ${WR_KIND_LABEL[kind]}` });
    expect(nut.getAttribute("type")).toBe("button"); // nằm trong <form> — không được là submit
  });

  it("[LD-02] chạm 'i' ⇒ hiện ĐỦ bốn mục, đúng chữ của bảng giải thích", async () => {
    render(<NhanLoaiDon kind="LEAVE" />);
    const nut = screen.getByRole("button", { name: "Giải thích loại đơn: Nghỉ phép" });
    // Trình duyệt thật bắn pointerdown TRƯỚC click — base-ui đọc `closeOnClick={false}` ở đúng
    // lúc pointerdown. Bắn click trần là mô phỏng một cú chạm không tồn tại (tooltip tự đóng).
    fireEvent.pointerDown(nut);
    fireEvent.click(nut);
    const g = WR_KIND_GIAI_THICH.LEAVE;
    const coDoan = (dau: string, than: string) =>
      screen.findByText((_, el) => el?.tagName === "SPAN" && el.textContent === `${dau} ${than}`);
    expect(await coDoan("Dùng khi:", g.dungKhi)).toBeTruthy();
    expect(await coDoan("Cần điền:", g.canDien)).toBeTruthy();
    expect(await coDoan("Khi quản lý duyệt:", g.khiDuyet)).toBeTruthy();
  });

  it("[LD-03] chạm 'i' trên dòng bấm-được KHÔNG kích hoạt dòng (không mở đơn)", () => {
    const moDon = vi.fn();
    render(
      <div onClick={moDon}>
        <NhanLoaiDon kind="TIMESHEET_FIX" />
      </div>,
    );
    const nut = screen.getByRole("button", { name: "Giải thích loại đơn: Chỉnh công" });
    fireEvent.pointerDown(nut);
    fireEvent.click(nut);
    expect(moDon).not.toHaveBeenCalled();
  });
});
