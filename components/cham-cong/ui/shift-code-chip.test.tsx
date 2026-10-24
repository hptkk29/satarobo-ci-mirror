// @vitest-environment jsdom
// Chip mã ca: ký hiệu nguồn phải ĐỌC ĐƯỢC, không chỉ là màu nền.
// Bẫy cũ: lưới phân ca phân biệt nguồn CHỈ bằng nền màu ⇒ mù màu và ảnh in đen trắng mất sạch
// thông tin. Test này ghim ký hiệu 1 chữ + `aria-label` đầy đủ cho từng nguồn.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ShiftCodeChip,
  SourceLegend,
  type ShiftSource,
} from "@/components/cham-cong/ui/shift-code-chip";

const CAN_THIEP: [ShiftSource, string, string][] = [
  ["MANUAL", "T", "Ca S, sửa tay"],
  ["SWAP", "Đ", "Ca S, từ đơn đổi ca"],
  ["LEAVE", "N", "Ca S, nghỉ phép"],
  ["HOLIDAY", "L", "Ca S, ngày lễ"],
];

describe("ShiftCodeChip", () => {
  it.each(CAN_THIEP)("nguồn %s ra ký hiệu %s và aria-label đúng", (source, mark, label) => {
    render(<ShiftCodeChip code="S" source={source} />);
    const chip = screen.getByLabelText(label);
    expect(chip.textContent).toBe(`S${mark}`);
  });

  it("PATTERN / IMPORT không đeo ký hiệu (nguồn bình thường, không phải can thiệp)", () => {
    const { unmount } = render(<ShiftCodeChip code="S" source="PATTERN" />);
    expect(screen.getByLabelText("Ca S, theo khung ca").textContent).toBe("S");
    unmount();
    render(<ShiftCodeChip code="C" source="IMPORT" />);
    expect(screen.getByLabelText("Ca C, từ file import").textContent).toBe("C");
  });

  it("ô khối khác: viền đứt + tên khối + nói rõ chỉ xem, không phải nút", () => {
    render(<ShiftCodeChip code="S" source="MANUAL" foreignUnit="CS2" />);
    const chip = screen.getByLabelText("Ca S, sửa tay, thuộc khối CS2 — chỉ xem");
    expect(chip.tagName).toBe("SPAN"); // chỉ đọc: không render nút/ô chọn
    expect(chip.textContent).toContain("CS2");
    expect(chip.className).toContain("border-dashed");
    expect(chip.className).not.toContain("state-warning-soft"); // màu nguồn nhường cho màu "khối khác"
    expect(chip.querySelector("svg")).not.toBeNull(); // mũi tên → khối
  });

  it("ô chưa xếp ca: in gạch ngang nhưng vẫn có nhãn đọc được", () => {
    render(<ShiftCodeChip code={null} />);
    const chip = screen.getByLabelText("Chưa xếp ca");
    expect(chip.textContent).toBe("—");
  });

  it("size sm/md đổi chiều cao ô (44px của lưới)", () => {
    const { unmount } = render(<ShiftCodeChip code="S" size="sm" />);
    expect(screen.getByLabelText("Ca S").className).toContain("h-6");
    unmount();
    render(<ShiftCodeChip code="S" />);
    expect(screen.getByLabelText("Ca S").className).toContain("h-7");
  });
});

describe("SourceLegend", () => {
  it("đủ 7 chip mẫu: 6 nguồn + ô khối khác", () => {
    render(<SourceLegend />);
    expect(screen.getAllByLabelText(/^Ca S/)).toHaveLength(7);
  });
});
