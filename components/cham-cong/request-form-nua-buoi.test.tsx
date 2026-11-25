// @vitest-environment jsdom
// [NNB-F] / [NBC-F] Form nộp đơn nghỉ: nút nửa buổi theo ĐÚNG các buổi của ca ngày đó (27/10/2026).
//
// Chủ dự án: "hệ thống tự nhận diện buổi mà nhân viên đó nghỉ" — ca sáng+chiều (SC · HC…) ⇒ «Nửa buổi
// sáng» / «Nửa buổi chiều»; ca chiều+tối (CT · ca suốt…) ⇒ «Nửa buổi chiều» / «Nửa buổi tối»; ca một buổi
// (S · C · T) ⇒ chỉ «Cả ngày» / «Theo giờ» (sự cố trước đó: ca T nộp "nửa buổi chiều").
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const submitRequestAction = vi.hoisted(() => vi.fn(async (_: unknown) => ({ ok: true as const, note: null })));
vi.mock("@/lib/cham-cong/request-actions", () => ({ submitRequestAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { catalogByCode } from "@/lib/cham-cong/catalog";
import { cacBuoiNghi } from "@/lib/cham-cong/nghi-trong-ca";
import type { RequestFormOptions } from "@/lib/cham-cong/request-form-data";
import { RequestForm } from "./request-form";

// Fixture dựng bằng CHÍNH hàm máy chủ dùng (`request-form-data.ts`) trên danh mục ca thật — không gõ tay khung.
const ca = (ma: string) => {
  const e = catalogByCode(ma)!;
  return { code: ma, soCap: e.soCapQuetKyVong, buoi: cacBuoiNghi(e.segments, e.soCapQuetKyVong) };
};

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
    ca: {
      "2026-10-28": ca("T"),
      "2026-10-29": ca("ST"),
      "2026-10-30": ca("CT"),
      "2026-10-26": ca("SC"),
      "2026-10-24": ca("HC"),
    },
  },
};

// Tìm theo CHỮ trên nút: nút đầu nhóm mang `id` của <label> "Thời lượng" nên tên truy cập của nó là "Thời lượng".
const nut = (ten: string) => {
  const ds = screen.getAllByRole("radio").filter((b) => b.textContent === ten);
  expect(ds).toHaveLength(1);
  return ds[0] as HTMLButtonElement;
};
const mo = (ngay: string) => render(<RequestForm options={OPTIONS} preset="LEAVE" presetDate={ngay} onClose={() => undefined} />);

afterEach(() => {
  cleanup();
  submitRequestAction.mockClear();
});

const nhanNut = () => screen.getAllByRole("radio").map((b) => b.textContent);
const gui = async () => {
  fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "Việc nhà" } });
  fireEvent.click(screen.getByRole("button", { name: /Gửi đơn/ }));
  await vi.waitFor(() => expect(submitRequestAction).toHaveBeenCalledTimes(1));
  return submitRequestAction.mock.calls[0]![0];
};

describe("[NBC-F] nút thời lượng theo buổi của ca ngày đó", () => {
  it("[NBC-F1] ca SC ⇒ Cả ngày · sáng · chiều · Theo giờ; bấm «Nửa buổi sáng» ⇒ gửi theo giờ 07:45–11:30, báo vào lúc 13:45", async () => {
    mo("2026-10-26");
    expect(nhanNut()).toEqual(["Cả ngày", "Nửa buổi sáng", "Nửa buổi chiều", "Theo giờ"]);
    fireEvent.click(nut("Nửa buổi sáng"));
    expect(document.querySelector("[data-khung-buoi]")?.textContent).toMatch(/07:45–11:30 của ca SC.*vào 13:45, ra 17:30/);
    expect(screen.queryByLabelText("Nghỉ từ giờ")).toBeNull();
    expect(await gui()).toMatchObject({ leaveDurationType: "HOURLY", startTime: "07:45", endTime: "11:30", toDate: null });
  });

  it("[NBC-F2] ca CT ⇒ Cả ngày · chiều · tối · Theo giờ (KHÔNG có sáng); «Nửa buổi chiều» ⇒ 13:45–17:30, vào lúc 17:30", async () => {
    mo("2026-10-30");
    expect(nhanNut()).toEqual(["Cả ngày", "Nửa buổi chiều", "Nửa buổi tối", "Theo giờ"]);
    fireEvent.click(nut("Nửa buổi chiều"));
    expect(document.querySelector("[data-khung-buoi]")?.textContent).toMatch(/vào 17:30, ra 21:00/);
    expect(await gui()).toMatchObject({ leaveDurationType: "HOURLY", startTime: "13:45", endTime: "17:30" });
  });

  it("[NBC-F3] ca HC (2 cụm quét) ⇒ «Nửa buổi chiều» vẫn gửi nửa buổi theo cụm (đúng 0,5 công), không gửi giờ", async () => {
    mo("2026-10-24");
    expect(nhanNut()).toEqual(["Cả ngày", "Nửa buổi sáng", "Nửa buổi chiều", "Theo giờ"]);
    fireEvent.click(nut("Nửa buổi chiều"));
    expect(await gui()).toMatchObject({ leaveDurationType: "HALF_DAY_PM", startTime: null, endTime: null });
  });

  it("[NBC-F4] ca ST ⇒ sáng · TỐI (nhãn theo buổi thật), gửi nửa buổi theo cụm", async () => {
    mo("2026-10-29");
    expect(nhanNut()).toEqual(["Cả ngày", "Nửa buổi sáng", "Nửa buổi tối", "Theo giờ"]);
    fireEvent.click(nut("Nửa buổi tối"));
    expect(await gui()).toMatchObject({ leaveDurationType: "HALF_DAY_PM" });
  });
});

describe("[NNB-F] ca một buổi / chưa rõ ca", () => {
  it("[NNB-F1] ca T ⇒ KHÔNG có nút nửa buổi nào, có câu chỉ đường «Cả ngày» / «Theo giờ»", () => {
    mo("2026-10-28");
    expect(nhanNut()).toEqual(["Cả ngày", "Theo giờ"]);
    expect(document.querySelector("[data-mot-buoi]")?.textContent).toMatch(/Ca T .*chỉ có một buổi.*«Cả ngày».*«Theo giờ»/);
  });

  it("[NNB-F2] đối chứng: ca có hai buổi ⇒ không có câu «một buổi»", () => {
    mo("2026-10-29");
    expect(document.querySelector("[data-mot-buoi]")).toBeNull();
  });

  it("[NNB-F3] chưa xếp ca ngày đó ⇒ không đoán: bày sáng / chiều chung, cổng nộp + duyệt kiểm lại", () => {
    mo("2026-10-27");
    expect(nhanNut()).toEqual(["Cả ngày", "Nửa buổi sáng", "Nửa buổi chiều", "Theo giờ"]);
  });
});

describe("[NBT-F] nút «Nửa buổi tối» (ca CT)", () => {
  it("[NBT-F1] bấm ⇒ gửi đơn «Theo giờ» đúng khung tối 17:30–21:00, báo ra lúc 17:30, không bày ô giờ gõ tay", async () => {
    mo("2026-10-30");
    fireEvent.click(nut("Nửa buổi tối"));
    expect(nut("Nửa buổi tối").getAttribute("aria-checked")).toBe("true");
    expect(nut("Theo giờ").getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector("[data-khung-buoi]")?.textContent).toMatch(/17:30–21:00 của ca CT.*vào 13:45, ra 17:30/);
    expect(screen.queryByLabelText("Nghỉ từ giờ")).toBeNull();
    expect(await gui()).toMatchObject({ kind: "LEAVE", fromDate: "2026-10-30", toDate: null, leaveDurationType: "HOURLY", startTime: "17:30", endTime: "21:00" });
  });

  it("[NBT-F3] «Theo giờ» vẫn là lựa chọn riêng: bấm sau nút buổi ⇒ ô giờ hiện lại", () => {
    mo("2026-10-30");
    fireEvent.click(nut("Nửa buổi tối"));
    fireEvent.click(nut("Theo giờ"));
    expect(nut("Nửa buổi tối").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("Nghỉ từ giờ")).toBeTruthy();
  });
});
