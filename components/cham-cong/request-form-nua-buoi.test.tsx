// @vitest-environment jsdom
// [NNB-F] Form nộp đơn nghỉ: ca của ngày KHÔNG chia buổi (S/C/T…) ⇒ khoá «Nửa buổi sáng / chiều» (27/10/2026).
//
// Sự cố: GV ca T (17:15–21:00) nộp "nghỉ nửa buổi chiều" vì form luôn bày đủ bốn thời lượng — trong khi
// đường duyệt chắc chắn từ chối nửa buổi trên ca một cụm quét. Nghỉ trọn ca tối = «Cả ngày».
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/cham-cong/request-actions", () => ({ submitRequestAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { RequestFormOptions } from "@/lib/cham-cong/request-form-data";
import { RequestForm } from "./request-form";

const OPTIONS: RequestFormOptions = {
  defaultCenter: { id: "cs1", label: "CS1" },
  centers: [{ id: "cs1", label: "CS1" }],
  templates: [],
  leaveTypes: [{ id: "lt", code: "KHONG_LUONG", name: "Nghỉ không lương", paidRatio: 0, noticeDays: null, truQuyPhep: false }] as RequestFormOptions["leaveTypes"],
  colleagues: [],
  myClasses: [],
  timesheetExempt: false,
  noticeDays: 0,
  soDuNghiBuPhut: 0,
  caTheoNgay: {
    tu: "2026-10-01",
    den: "2026-10-31",
    ca: { "2026-10-28": { code: "T", soCap: 1 }, "2026-10-29": { code: "ST", soCap: 2 } },
  },
};

// Tìm theo CHỮ trên nút: nút đầu nhóm mang `id` của <label> "Thời lượng" nên tên truy cập của nó là "Thời lượng".
const nut = (ten: string) => {
  const ds = screen.getAllByRole("radio").filter((b) => b.textContent === ten);
  expect(ds).toHaveLength(1);
  return ds[0] as HTMLButtonElement;
};
const mo = (ngay: string) => render(<RequestForm options={OPTIONS} preset="LEAVE" presetDate={ngay} onClose={() => undefined} />);

afterEach(cleanup);

describe("[NNB-F] thời lượng nghỉ theo ca của ngày", () => {
  it("[NNB-F1] ca T ⇒ hai nút nửa buổi bị khoá, có câu chỉ đường; «Cả ngày» và «Theo giờ» vẫn bấm được", () => {
    mo("2026-10-28");
    expect(nut("Nửa buổi sáng").disabled).toBe(true);
    expect(nut("Nửa buổi chiều").disabled).toBe(true);
    expect(nut("Cả ngày").disabled).toBe(false);
    expect(nut("Theo giờ").disabled).toBe(false);
    expect(document.querySelector("[data-khoa-nua-buoi]")?.textContent).toMatch(/Ca T .*không chia buổi.*«Cả ngày»/);
  });

  it("[NNB-F2] đối chứng: ca ST (hai cụm) ⇒ nửa buổi bấm được, không có câu khoá", () => {
    mo("2026-10-29");
    expect(nut("Nửa buổi chiều").disabled).toBe(false);
    expect(document.querySelector("[data-khoa-nua-buoi]")).toBeNull();
  });

  it("[NNB-F3] chưa xếp ca ngày đó ⇒ không đoán, không khoá", () => {
    mo("2026-10-27");
    expect(nut("Nửa buổi sáng").disabled).toBe(false);
  });
});
