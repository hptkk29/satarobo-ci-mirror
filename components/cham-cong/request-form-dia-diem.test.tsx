// @vitest-environment jsdom
// [DT-F1] Ô "Địa điểm" / "Nơi đến" của form nộp đơn — HIỆN đúng với loại bắt buộc nó (08/10/2026).
//
// Sự cố bắt được khi soát giao diện 375px: ô Địa điểm nằm trong khối chỉ dựng cho loại NHIỀU ngày, nên
// "Chấm công ngoài địa điểm" (loại MỘT ngày) không bao giờ thấy ô — trong khi form và server đều bắt buộc
// ⇒ không gửi được đơn. Không ca nào đỏ vì mọi test cũ gọi thẳng server action, không dựng form.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/cham-cong/request-actions", () => ({ submitRequestAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { RequestFormOptions } from "@/lib/cham-cong/request-form-data";
import type { WorkRequestKindV } from "@/lib/work-request";
import { RequestForm } from "./request-form";

const OPTIONS: RequestFormOptions = {
  defaultCenter: { id: "cs1", label: "CS1" },
  centers: [{ id: "cs1", label: "CS1" }],
  templates: [],
  leaveTypes: [],
  colleagues: [],
  myClasses: [],
  timesheetExempt: false,
  noticeDays: 0,
  soDuNghiBuPhut: 0,
  caTheoNgay: { tu: "2026-10-01", den: "2026-10-31", ca: {} },
};

const moForm = (kind: WorkRequestKindV) => render(<RequestForm options={OPTIONS} preset={kind} onClose={() => undefined} />);

afterEach(cleanup);

describe("[DT-F1] ô địa điểm / nơi đến", () => {
  it("[DT-F1a] chấm công ngoài địa điểm (MỘT ngày) ⇒ có ô Địa điểm BẮT BUỘC + khung giờ", () => {
    moForm("OUTSIDE_ATTENDANCE");
    const o = screen.getByPlaceholderText(/Hoà Khánh/);
    expect(o).toBeTruthy();
    expect(screen.getByText("Địa điểm")).toBeTruthy();
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(2);
  });

  it("[DT-F1b] đi công tác (NHIỀU ngày) ⇒ có ô Nơi đến (đối chứng: ô vẫn đúng chỗ cho loại cũ)", () => {
    moForm("BUSINESS_TRIP");
    expect(screen.getByPlaceholderText(/Nhà thi đấu Tiên Sơn/)).toBeTruthy();
  });

  it("[DT-F1c] loại không cần địa điểm (tăng ca) ⇒ KHÔNG có ô", () => {
    moForm("OT");
    expect(screen.queryByPlaceholderText(/Hoà Khánh|Tiên Sơn/)).toBeNull();
  });
});
