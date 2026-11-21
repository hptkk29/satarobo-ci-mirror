// @vitest-environment jsdom
// [C9B] Nút "Bảo lưu" ở hồ sơ học viên (nghiệm thu bảo lưu vòng 2): đường MỚI (`baoLuuMoi`) chỉ hiện khi học viên có ít nhất một ghi danh đang học thuộc khoá
// `allowPause`. Trước bản vá nút chỉ kiểm cờ cơ sở + quyền, và dẫn tới màn "học viên không có khoá nào bảo lưu được" (lời hứa suông, luật 12).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("./reserve-modal", () => ({ ReserveModal: () => null }));
vi.mock("./resume-reserve-modal", () => ({ ResumeReserveModal: () => null }));
vi.mock("./withdraw-modal", () => ({ WithdrawModal: () => null }));
vi.mock("./reactivate-modal", () => ({ ReactivateModal: () => null }));

import { LifecycleActions } from "./lifecycle-actions";

const base = { studentId: "hv1", studentName: "An", studentStatus: "ACTIVE" as const, activeReserve: null };
const gd = (allowPause?: boolean, status = "ACTIVE") => ({ id: "gd", status, class: { name: "Lớp A" }, ...(allowPause === undefined ? {} : { allowPause }) });
const coNutBaoLuu = () => screen.queryByText("Bảo lưu");

describe("[C9B] nút Bảo lưu theo khoá cho phép", () => {
  it("[C9B-01] đường mới + khoá allowPause=false ⇒ KHÔNG nút (cũng không rơi về nút cũ)", () => {
    render(<LifecycleActions {...base} enrollments={[gd(false)]} baoLuuMoi />);
    expect(coNutBaoLuu()).toBeNull();
  });

  it("[C9B-02] đường mới + có ÍT NHẤT một khoá cho phép ⇒ nút là liên kết sang màn lập hồ sơ", () => {
    render(<LifecycleActions {...base} enrollments={[gd(false), gd(true)]} baoLuuMoi />);
    expect(coNutBaoLuu()?.closest("a")?.getAttribute("href")).toBe("/bao-luu/moi?studentId=hv1");
  });

  it("[C9B-03] chưa biết khoá (không truyền allowPause) ⇒ vẫn hiện — không ẩn nhầm do thiếu dữ liệu", () => {
    render(<LifecycleActions {...base} enrollments={[gd()]} baoLuuMoi />);
    expect(coNutBaoLuu()?.closest("a")).not.toBeNull();
  });

  it("[C9B-04] đường CŨ (cờ cơ sở tắt) không đổi: vẫn là nút mở hộp thoại, kể cả khi khoá allowPause=false", () => {
    render(<LifecycleActions {...base} enrollments={[gd(false)]} baoLuuMoi={false} />);
    expect(coNutBaoLuu()?.closest("button")).not.toBeNull();
  });

  it("[C9B-05] chỉ ghi danh ĐANG HỌC được tính: khoá cho phép nhưng ghi danh đã hoàn thành ⇒ không nút", () => {
    render(<LifecycleActions {...base} enrollments={[gd(true, "COMPLETED")]} baoLuuMoi />);
    expect(coNutBaoLuu()).toBeNull();
  });
});
