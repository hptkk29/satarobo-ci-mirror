// @vitest-environment jsdom
/**
 * [CTU-*] giao diện tab «Chia theo phường» (dựng thật, đọc phần tử).
 *   [CTU-01] hiện đủ phường, đếm «đã đặt N/M»; chưa đổi gì ⇒ nút Lưu KHOÁ
 *   [CTU-02] đổi cơ sở một phường ⇒ đếm tăng, hiện «có thay đổi», nút Lưu mở; bấm Lưu ⇒ gửi ĐỦ mọi dòng (chưa đặt = null) + công tắc
 *   [CTU-03] «Đặt nhanh» chỉ điền các phường CHƯA đặt, không đè phường đã đặt
 *   [CTU-04] bật mà chưa đặt phường nào ⇒ cảnh báo «chưa có tác dụng» (đối chứng: đặt rồi ⇒ không cảnh báo)
 *   [CTU-05] tìm phường lọc danh sách nhưng KHÔNG làm mất giá trị đã chọn ở phường bị ẩn
 *   [CTU-06] cơ sở đã lưu nhưng không còn nhận lead ⇒ hiện nhãn riêng, không để ô trống gây hiểu nhầm
 *   [CTU-07] lỗi từ action ⇒ báo lỗi, không báo thành công
 *   [CTU-08] Quản lý cơ sở: công tắc KHOÁ, phường của cơ sở khác KHÓA (chỉ hiện tên), chỉ chọn được cơ sở của mình
 *   [CTU-09] Quản lý cơ sở: Lưu chỉ gửi phần SỬA ĐƯỢC (không gửi phường của cơ sở khác), không đổi công tắc
 *   [CTU-10] Quản lý cơ sở: «Đặt nhanh» chỉ điền phường trống, đặt cho cơ sở mình; không đụng phường của cơ sở khác
 *   [CTU-11] Quản trị (coSoCuaToi = null): hành vi cũ nguyên vẹn — mọi phường sửa được, công tắc mở (đối chứng của CTU-08)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ luu: vi.fn(), push: vi.fn(), refresh: vi.fn(), toastOk: vi.fn(), toastLoi: vi.fn() }));
vi.mock("../_actions-phuong", () => ({ luuChiaTheoPhuongAction: h.luu }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: h.toastLoi } }));

import { ChiaTheoPhuong } from "./chia-theo-phuong";

const COSO = [{ id: "cs1", name: "Cơ sở 1" }, { id: "cs2", name: "Cơ sở 2" }];
const PHUONG = ["Phường An Hải", "Phường Hải Châu", "Phường Thanh Khê"];

function dung(o: { daDat?: Record<string, string | null>; bat?: boolean; coSoCuaToi?: readonly string[] | null } = {}) {
  return render(
    <ChiaTheoPhuong
      thanhPho="Tp Đà Nẵng"
      cacTinh={["Tp Đà Nẵng", "Tp Huế"]}
      cacPhuong={PHUONG}
      coSo={COSO}
      daDat={o.daDat ?? { "Phường An Hải": null, "Phường Hải Châu": null, "Phường Thanh Khê": null }}
      batBanDau={o.bat ?? false}
      coSoCuaToi={o.coSoCuaToi ?? null}
    />,
  );
}
const o = (p: string) => screen.getByRole("combobox", { name: `Cơ sở của ${p}` }) as HTMLSelectElement;
const nutLuu = () => screen.getByRole("button", { name: /^(Lưu|Đang lưu…)$/ }) as HTMLButtonElement;

beforeEach(() => {
  h.luu.mockReset().mockResolvedValue({ ok: true, bat: false, soPhuongDaDat: 1 });
  [h.push, h.refresh, h.toastOk, h.toastLoi].forEach((f) => f.mockClear());
});
afterEach(cleanup);

describe("[CTU-01] hiện đủ + khoá Lưu khi chưa đổi", () => {
  it("đủ phường, đếm 0/3, Lưu khoá", () => {
    dung();
    for (const p of PHUONG) expect(o(p).value).toBe("");
    expect(screen.getByTestId("so-da-dat").textContent).toBe("0");
    expect(nutLuu().disabled).toBe(true);
  });
  it("giá trị đã lưu được nạp", () => {
    dung({ daDat: { "Phường An Hải": "cs1", "Phường Hải Châu": "cs2", "Phường Thanh Khê": null } });
    expect(o("Phường An Hải").value).toBe("cs1");
    expect(o("Phường Hải Châu").value).toBe("cs2");
    expect(screen.getByTestId("so-da-dat").textContent).toBe("2");
    expect(nutLuu().disabled).toBe(true);
  });
});

describe("[CTU-02] đổi một phường rồi lưu", () => {
  it("gửi đủ mọi dòng (chưa đặt = null) + công tắc; thành công ⇒ toast + làm mới", async () => {
    dung();
    fireEvent.change(o("Phường Hải Châu"), { target: { value: "cs2" } });
    expect(screen.getByTestId("so-da-dat").textContent).toBe("1");
    expect(screen.getByText("Có thay đổi chưa lưu")).toBeTruthy();
    expect(nutLuu().disabled).toBe(false);
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu).toHaveBeenCalledWith({
      bat: false,
      thanhPho: "Tp Đà Nẵng",
      dong: [
        { phuong: "Phường An Hải", coSoId: null },
        { phuong: "Phường Hải Châu", coSoId: "cs2" },
        { phuong: "Phường Thanh Khê", coSoId: null },
      ],
    });
    await waitFor(() => expect(h.toastOk).toHaveBeenCalled());
    expect(h.refresh).toHaveBeenCalled();
  });
  it("chỉ đổi công tắc cũng cho lưu", () => {
    dung();
    fireEvent.click(screen.getByRole("checkbox", { name: "Bật chia lead theo phường" }));
    expect(nutLuu().disabled).toBe(false);
  });
});

describe("[CTU-03] đặt nhanh không đè phường đã đặt", () => {
  it("chỉ điền ô trống", () => {
    dung({ daDat: { "Phường An Hải": "cs1", "Phường Hải Châu": null, "Phường Thanh Khê": null } });
    fireEvent.change(screen.getByRole("combobox", { name: "Cơ sở đặt nhanh" }), { target: { value: "cs2" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(o("Phường An Hải").value).toBe("cs1"); // KHÔNG bị đè
    expect(o("Phường Hải Châu").value).toBe("cs2");
    expect(o("Phường Thanh Khê").value).toBe("cs2");
  });
  it("chưa chọn cơ sở ⇒ nút Áp dụng khoá", () => {
    dung();
    expect((screen.getByRole("button", { name: "Áp dụng" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[CTU-04] bật mà chưa đặt phường nào", () => {
  it("cảnh báo; đặt một phường rồi thì hết cảnh báo", () => {
    dung({ bat: true });
    expect(screen.getByRole("status").textContent).toMatch(/chưa có tác dụng/);
    fireEvent.change(o("Phường An Hải"), { target: { value: "cs1" } });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("đang tắt ⇒ không cảnh báo", () => {
    dung({ bat: false });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("[CTU-05] tìm phường không làm mất lựa chọn", () => {
  it("phường bị ẩn vẫn được gửi với giá trị đã chọn", async () => {
    dung();
    fireEvent.change(o("Phường Thanh Khê"), { target: { value: "cs1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm phường hoặc xã" }), { target: { value: "hải châu" } });
    expect(within(screen.getByRole("list", { name: "Danh sách phường/xã" })).queryAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Cơ sở của Phường Thanh Khê" })).toBeNull();
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.luu).toHaveBeenCalled());
    expect(h.luu.mock.calls[0]![0].dong).toContainEqual({ phuong: "Phường Thanh Khê", coSoId: "cs1" });
  });
});

describe("[CTU-06] cơ sở đã lưu nhưng không còn nhận lead", () => {
  it("hiện nhãn riêng và giữ giá trị", () => {
    dung({ daDat: { "Phường An Hải": "cs_dong_cua", "Phường Hải Châu": null, "Phường Thanh Khê": null } });
    expect(o("Phường An Hải").value).toBe("cs_dong_cua");
    expect(within(o("Phường An Hải")).getByText("(cơ sở không còn nhận lead)")).toBeTruthy();
  });
});

describe("[CTU-07] lỗi từ action", () => {
  it("báo lỗi, không báo thành công, không làm mới", async () => {
    h.luu.mockResolvedValue({ ok: false, error: "Không có quyền" });
    dung();
    fireEvent.change(o("Phường An Hải"), { target: { value: "cs1" } });
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.toastLoi).toHaveBeenCalledWith("Không có quyền"));
    expect(h.toastOk).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("[CTU-08] Quản lý cơ sở — phần của cơ sở mình", () => {
  const DA_DAT = { "Phường An Hải": "cs1", "Phường Hải Châu": "cs2", "Phường Thanh Khê": null };
  it("công tắc khoá + ghi chú nói rõ; phường của cơ sở khác chỉ hiện tên; phường của mình/trống sửa được", () => {
    dung({ daDat: DA_DAT, bat: true, coSoCuaToi: ["cs1"] });
    expect((screen.getByRole("checkbox", { name: "Bật chia lead theo phường" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("ghi-chu-co-so").textContent).toMatch(/cơ sở của mình/);
    expect(screen.queryByRole("combobox", { name: "Cơ sở của Phường Hải Châu" })).toBeNull();
    expect(screen.getByTestId("khoa-Phường Hải Châu").textContent).toMatch(/Cơ sở 2/);
    expect(o("Phường An Hải").value).toBe("cs1");
    expect(o("Phường Thanh Khê").value).toBe("");
  });
  it("ô chọn chỉ có cơ sở của mình (không mời chọn cơ sở khác)", () => {
    dung({ daDat: DA_DAT, coSoCuaToi: ["cs1"] });
    const nhan = within(o("Phường Thanh Khê")).getAllByRole("option").map((x) => x.textContent);
    expect(nhan).toContain("Cơ sở 1");
    expect(nhan).not.toContain("Cơ sở 2");
  });
  it("đếm «của cơ sở bạn»", () => {
    dung({ daDat: DA_DAT, coSoCuaToi: ["cs1"] });
    expect(screen.getByTestId("so-cua-toi").textContent).toBe("1");
    fireEvent.change(o("Phường Thanh Khê"), { target: { value: "cs1" } });
    expect(screen.getByTestId("so-cua-toi").textContent).toBe("2");
  });
});

describe("[CTU-09] Quản lý cơ sở — Lưu chỉ gửi phần sửa được", () => {
  it("không gửi phường của cơ sở khác; vẫn gửi công tắc nguyên giá trị hiện có", async () => {
    dung({ daDat: { "Phường An Hải": "cs1", "Phường Hải Châu": "cs2", "Phường Thanh Khê": null }, bat: true, coSoCuaToi: ["cs1"] });
    fireEvent.change(o("Phường Thanh Khê"), { target: { value: "cs1" } });
    fireEvent.click(nutLuu());
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    const body = h.luu.mock.calls[0]![0];
    expect(body.bat).toBe(true);
    expect(body.dong.map((d: { phuong: string }) => d.phuong).sort()).toEqual(["Phường An Hải", "Phường Thanh Khê"]);
    expect(body.dong).toContainEqual({ phuong: "Phường Thanh Khê", coSoId: "cs1" });
  });
  it("chưa đổi gì ⇒ Lưu khoá (kể cả khi có phường bị khoá)", () => {
    dung({ daDat: { "Phường An Hải": "cs1", "Phường Hải Châu": "cs2", "Phường Thanh Khê": null }, coSoCuaToi: ["cs1"] });
    expect(nutLuu().disabled).toBe(true);
  });
});

describe("[CTU-10] Quản lý cơ sở — đặt nhanh", () => {
  it("chỉ điền phường TRỐNG cho cơ sở mình; phường của cơ sở khác không đụng", () => {
    dung({ daDat: { "Phường An Hải": null, "Phường Hải Châu": "cs2", "Phường Thanh Khê": null }, coSoCuaToi: ["cs1"] });
    const nhan = within(screen.getByRole("combobox", { name: "Cơ sở đặt nhanh" })).getAllByRole("option").map((x) => x.textContent);
    expect(nhan).not.toContain("Cơ sở 2");
    fireEvent.change(screen.getByRole("combobox", { name: "Cơ sở đặt nhanh" }), { target: { value: "cs1" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(o("Phường An Hải").value).toBe("cs1");
    expect(o("Phường Thanh Khê").value).toBe("cs1");
    expect(screen.getByTestId("khoa-Phường Hải Châu").textContent).toMatch(/Cơ sở 2/); // vẫn của cơ sở 2
    expect(screen.getByTestId("so-da-dat").textContent).toBe("3");
  });
});

describe("[CTU-11] Quản trị — đối chứng", () => {
  it("coSoCuaToi = null ⇒ mọi phường sửa được, công tắc mở, không có ghi chú của Quản lý cơ sở", () => {
    dung({ daDat: { "Phường An Hải": "cs1", "Phường Hải Châu": "cs2", "Phường Thanh Khê": null }, coSoCuaToi: null });
    expect((screen.getByRole("checkbox", { name: "Bật chia lead theo phường" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId("ghi-chu-co-so")).toBeNull();
    expect(within(o("Phường Hải Châu")).getAllByRole("option").map((x) => x.textContent)).toContain("Cơ sở 1");
    expect(screen.queryByTestId("khoa-Phường Hải Châu")).toBeNull();
  });
});
