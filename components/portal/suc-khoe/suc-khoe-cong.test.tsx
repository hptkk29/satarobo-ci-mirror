// @vitest-environment jsdom
/**
 * [PSK-UI-*] «Sức khỏe cả nhà» ở CỔNG PHỤ HUYNH (dựng THẬT: 2 view sinh từ artifact + view-model + localStorage; fetch bị theo dõi).
 *   [PSK-UI-01] sổ trống: hero + lời mời thêm người; mở form có ô thông tin người mới; KHÔNG vẽ khối chi tiết
 *   [PSK-UI-02] thêm người lớn: BMI đúng (72 kg / 1,72 m ⇒ 24,3), phân loại châu Á, thước + năng lượng ước tính; lưu vào máy
 *   [PSK-UI-03] kiểm số đo: thiếu / ngày tương lai / chiều cao vô lý ⇒ báo lỗi bằng lời và KHÔNG ghi
 *   [PSK-UI-04] bản thứ 4 thay bản cũ nhất (giữ tối đa 3) và báo đúng ngày của bản bị thay
 *   [PSK-UI-05] TRẺ EM: KHÔNG phân loại BMI (chưa có bảng WHO), không thước; có «Lớn thêm»
 *   [PSK-UI-06] nhóm gợi ý Ăn uống · Vận động · Nghỉ ngơi đổi nội dung; thử thách tick được và nhớ
 *   [PSK-UI-07] khảo sát: phải đồng ý trước; trả lời · bỏ qua · xem hồ sơ · lưu ⇒ quay về tổng quan có «Hồ sơ thói quen»
 *   [PSK-UI-08] xoá người (xác nhận 2 bước), xoá bản cũ
 *   [PSK-UI-09] RIÊNG TƯ: cả buổi dùng không có yêu cầu mạng nào
 *   [PSK-UI-10] đọc lại sổ đã lưu sau khi vẽ; sổ hỏng ⇒ trống, không sập
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { datHomNay } from "@/lib/suc-khoe/dong-co-goc";
import { KHUON_KET_QUA } from "@/lib/suc-khoe/khuon-ket-qua";
import { KHAO_SAT_CONG } from "@/lib/suc-khoe/khao-sat-cong";
import { ghiSoCong, KHOA_LUU_CONG, docSoCong } from "./luu-tru";
import { SucKhoeCong } from "./suc-khoe-cong";
import type { NguoiCong } from "@/lib/suc-khoe/so-cong";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  datHomNay("2026-11-08"); // luật 19: không đọc đồng hồ thật
  window.localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as never;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BO: NguoiCong = {
  id: "n-bo", ten: "Bố", vt: "Bố", ns: "1985-03-12", gt: "nam", hoatDong: "vua", mt: false, benhNen: false, ks: null,
  ban: [{ id: "b3", ngay: "2026-11-02", cao: 172, nang: 72, eo: null }, { id: "b2", ngay: "2026-08-10", cao: 172, nang: 74, eo: null }, { id: "b1", ngay: "2026-05-05", cao: 172, nang: 75.5, eo: null }],
};
const BIN: NguoiCong = {
  id: "n-bin", ten: "Bin", vt: "Con", ns: "2016-06-01", gt: "nam", hoatDong: "vua", mt: false, benhNen: false, ks: null,
  ban: [{ id: "c2", ngay: "2026-11-02", cao: 140, nang: 34, eo: null }, { id: "c1", ngay: "2026-08-12", cao: 138, nang: 33, eo: null }],
};
const nap = (ds: NguoiCong[], extra: { thu?: Record<string, boolean[]>; dongY?: boolean } = {}) =>
  window.localStorage.setItem(KHOA_LUU_CONG, ghiSoCong({ ds, thu: extra.thu ?? {}, dongY: extra.dongY ?? false }));
const doc = () => docSoCong(window.localStorage.getItem(KHOA_LUU_CONG));

const dung = () => render(<SucKhoeCong />);
/** Ô nhập trong form «Thêm số đo mới» theo nhãn (nhãn «Cân nặng»… cũng xuất hiện ở khối chi tiết nên không tra toàn trang). */
const truong = (nhan: RegExp) => {
  const l = [...document.querySelectorAll<HTMLLabelElement>("#form-sk label")].find((x) => nhan.test((x.textContent ?? "").trim()));
  if (!l) throw new Error("không thấy ô " + nhan);
  return l.querySelector("input,select") as HTMLInputElement;
};
const doiNap = async (ten: string) => await waitFor(() => expect(screen.getAllByText(ten).length).toBeGreaterThan(0));

describe("[PSK-UI-01] sổ trống", () => {
  it("hero + lời mời; mở form hiện ô người mới; chưa có khối chi tiết", () => {
    dung();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/khoẻ mỗi ngày/);
    expect(screen.queryByRole("heading", { name: /^Chi tiết:/ })).toBeNull();
    expect(screen.getByText(/còn 6 chỗ/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Thêm số đo mới/ }));
    expect(truong(/Tên hoặc biệt danh/)).toBeTruthy();
    expect(truong(/Cân nặng/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Lời nhắn quan trọng từ Sata Robo" })).toBeTruthy();
  });
});

describe("[PSK-UI-02] thêm người lớn", () => {
  it("BMI 24,3 · Thừa cân (châu Á) · có thước + năng lượng; ghi vào máy", async () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Thêm số đo mới/ }));
    fireEvent.change(truong(/Tên hoặc biệt danh/), { target: { value: "Bố" } });
    fireEvent.change(truong(/^Ngày sinh/), { target: { value: "1985-03-12" } });
    fireEvent.change(truong(/Cân nặng/), { target: { value: "72" } });
    fireEvent.change(truong(/Chiều cao/), { target: { value: "172" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu và xem cùng Sata Robo/ }));
    expect(await screen.findByRole("heading", { name: "Chi tiết: Bố" })).toBeTruthy();
    const ct = within(screen.getByRole("heading", { name: "Chi tiết: Bố" }).closest("section")!);
    expect(ct.getByText("24,3")).toBeTruthy();
    expect(ct.getAllByText("Thừa cân (châu Á)").length).toBeGreaterThan(0);
    expect(ct.getByText("Năng lượng ≈")).toBeTruthy();
    const so = doc();
    expect(so?.ds).toHaveLength(1);
    expect(so?.ds[0]).toMatchObject({ ten: "Bố", gt: "nu", hoatDong: "vua" }); // giới tính mặc định «Nữ» của ô chọn (người dùng chưa đổi)
    expect(so?.ds[0]?.ban[0]).toMatchObject({ ngay: "2026-11-08", cao: 172, nang: 72 });
  });
});

describe("[PSK-UI-03] kiểm số đo", () => {
  it("thiếu tên / ngày sinh / số đo, ngày tương lai, chiều cao vô lý ⇒ lỗi bằng lời, không ghi", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Thêm số đo mới/ }));
    const luu = () => fireEvent.click(screen.getByRole("button", { name: /Lưu và xem cùng Sata Robo/ }));
    luu();
    expect(screen.getByRole("alert").textContent).toMatch(/tên hoặc biệt danh/);
    fireEvent.change(truong(/Tên hoặc biệt danh/), { target: { value: "Bố" } });
    luu();
    expect(screen.getByRole("alert").textContent).toMatch(/ngày sinh hợp lệ/);
    fireEvent.change(truong(/^Ngày sinh/), { target: { value: "1985-03-12" } });
    luu();
    expect(screen.getByRole("alert").textContent).toMatch(/cân nặng và chiều cao/);
    fireEvent.change(truong(/Cân nặng/), { target: { value: "72" } });
    fireEvent.change(truong(/Chiều cao/), { target: { value: "1720" } });
    luu();
    expect(screen.getByRole("alert").textContent).toMatch(/40–230 cm/);
    fireEvent.change(truong(/Chiều cao/), { target: { value: "172" } });
    fireEvent.change(truong(/^Ngày đo/), { target: { value: "2026-12-01" } });
    luu();
    expect(screen.getByRole("alert").textContent).toMatch(/chưa tới/);
    expect(doc()?.ds ?? []).toHaveLength(0);
  });
});

describe("[PSK-UI-04] giữ tối đa 3 bản", () => {
  it("bản thứ 4 thay bản cũ nhất và báo đúng ngày", async () => {
    nap([BO]);
    dung();
    await doiNap("Bố");
    fireEvent.click(screen.getByRole("button", { name: /Thêm số đo mới/ }));
    fireEvent.change(truong(/Cân nặng/), { target: { value: "71" } });
    fireEvent.change(truong(/Chiều cao/), { target: { value: "172" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu và xem cùng Sata Robo/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Bản cũ nhất \(05\/05\/2026\) đã được thay/));
    expect(doc()?.ds[0]?.ban).toHaveLength(3);
    expect(doc()?.ds[0]?.ban[0]).toMatchObject({ ngay: "2026-11-08", nang: 71 });
  });
});

describe("[PSK-UI-05] trẻ em", () => {
  it("không phân loại BMI, không thước, có «Lớn thêm»", async () => {
    nap([BIN]);
    dung();
    await doiNap("Bin");
    const ct = within(screen.getByRole("heading", { name: "Chi tiết: Bin" }).closest("section")!);
    expect(ct.getAllByText(/Chưa đánh giá/).length).toBeGreaterThan(0);
    expect(ct.queryByText("Năng lượng ≈")).toBeNull();
    expect(ct.getByText("Lớn thêm")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Trong vùng tham khảo thông thường/);
    expect(document.body.textContent).not.toMatch(/Thừa cân|Nhẹ cân|Béo phì|Bình thường \(châu Á\)/);
  });
});

describe("[PSK-UI-06] gợi ý + thử thách", () => {
  it("đổi nhóm đổi nội dung; thử thách tick và nhớ", async () => {
    nap([BO]);
    dung();
    await doiNap("Bố");
    const k = KHUON_KET_QUA["nl-can-chu-y"];
    expect(screen.getByText(k.anUong.tieuDe)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Vận động/ }));
    expect(screen.getByText(k.vanDong.tieuDe)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Nghỉ ngơi/ }));
    expect(screen.getByText(k.nghiNgoi.tieuDe)).toBeTruthy();
    const o = screen.getAllByRole("checkbox", { checked: false });
    fireEvent.click(o[0]!);
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(doc()?.thu["n-bo"]).toEqual([true, false, false]);
  });
});

describe("[PSK-UI-07] khảo sát", () => {
  it("chưa đồng ý ⇒ không bắt đầu; trả lời + bỏ qua tới hết ⇒ hồ sơ; lưu ⇒ quay về có «Hồ sơ thói quen»", async () => {
    nap([BO]);
    dung();
    await doiNap("Bố");
    fireEvent.click(screen.getByRole("link", { name: /Bắt đầu khảo sát cho Bố/ }));
    expect(await screen.findByRole("heading", { name: /Sata Robo muốn hiểu Bố hơn/ })).toBeTruthy();
    expect(document.body.textContent).toMatch(/TRÊN THIẾT BỊ NÀY/);
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu" }));
    expect(screen.getByRole("status").textContent).toMatch(/Cần đồng ý/);
    expect(screen.queryByText(/Câu 1\//)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Đồng ý một lần/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu" }));
    const tong = KHAO_SAT_CONG.lon.length;
    expect(screen.getByText(new RegExp(`Câu 1/${tong}`))).toBeTruthy();
    // «Câu tiếp theo» khi chưa chọn ⇒ nhắc
    fireEvent.click(screen.getByRole("button", { name: /Câu tiếp theo/ }));
    expect(screen.getByRole("status").textContent).toMatch(/Chọn ít nhất một ý/);
    // trả lời câu 1 (chọn lựa chọn đầu) rồi bỏ qua mọi câu còn lại
    const dau = screen.getByRole("group").querySelector("button");
    fireEvent.click(dau!);
    fireEvent.click(screen.getByRole("button", { name: /Câu tiếp theo/ }));
    for (let i = 2; i <= tong; i++) fireEvent.click(screen.getByRole("button", { name: "Bỏ qua câu này" }));
    expect(await screen.findByRole("heading", { name: /Xong rồi! Đây là hồ sơ thói quen của Bố/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /Lưu và xem lời khuyên cho Bố/ }));
    expect(await screen.findByText(/Hồ sơ thói quen của Bố/)).toBeTruthy();
    const ks = doc()?.ds[0]?.ks;
    expect(ks).toMatchObject({ ngay: "2026-11-08", ai: "Bố tự trả lời" });
    expect(Object.keys(ks?.tl ?? {})).toEqual(["0"]);
    expect(doc()?.dongY).toBe(true);
    // đối chứng: đã đồng ý một lần ⇒ người khác không bị hỏi lại
    cleanup();
    nap([BO, BIN], { dongY: true });
    dung();
    await doiNap("Bin");
    fireEvent.click(screen.getAllByRole("link", { name: /Bắt đầu khảo sát cho/ })[0]!);
    await screen.findByRole("heading", { name: /Sata Robo muốn hiểu/ });
    expect(screen.queryByRole("checkbox", { name: /Đồng ý một lần/ })).toBeNull();
  });
  it("trẻ em: bộ 28 câu và lựa chọn «ai trả lời»", async () => {
    nap([BIN], { dongY: true });
    dung();
    await doiNap("Bin");
    fireEvent.click(screen.getByRole("link", { name: /Bắt đầu khảo sát cho Bin/ }));
    await screen.findByRole("heading", { name: /Sata Robo muốn hiểu Bin hơn/ });
    expect(screen.getByText("Ai trả lời?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu" }));
    expect(screen.getByText(new RegExp(`Câu 1/${KHAO_SAT_CONG.tre.length}`))).toBeTruthy();
  });
});

describe("[PSK-UI-08] xoá", () => {
  it("xoá người cần xác nhận; xoá bản cũ", async () => {
    nap([BO, BIN]);
    dung();
    await doiNap("Bố");
    fireEvent.click(screen.getByRole("button", { name: /Các bản cũ hơn \(2\)/ }));
    expect(screen.getAllByRole("button", { name: "Xoá bản này" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Xoá bản này" })[0]!);
    await waitFor(() => expect(doc()?.ds[0]?.ban).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Xoá người này" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(doc()?.ds).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Xoá người này" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Xoá" }));
    await waitFor(() => expect(doc()?.ds.map((n) => n.ten)).toEqual(["Bin"]));
  });
});

describe("[PSK-UI-09] riêng tư", () => {
  it("thêm số đo + khảo sát + sao lưu ⇒ không có yêu cầu mạng nào", async () => {
    nap([BO], { dongY: true });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    dung();
    await doiNap("Bố");
    fireEvent.click(screen.getByRole("link", { name: /Bắt đầu khảo sát cho Bố/ }));
    await screen.findByRole("heading", { name: /Sata Robo muốn hiểu/ });
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu" }));
    fireEvent.click(screen.getByRole("group").querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: /Câu tiếp theo/ }));
    for (let i = 2; i <= KHAO_SAT_CONG.lon.length; i++) fireEvent.click(screen.getByRole("button", { name: "Bỏ qua câu này" }));
    fireEvent.click(await screen.findByRole("link", { name: /Lưu và xem lời khuyên cho Bố/ }));
    await screen.findByText(/Hồ sơ thói quen của Bố/);
    // thêm một số đo + xoá + sao lưu
    fireEvent.click(screen.getByRole("button", { name: /Thêm số đo mới/ }));
    fireEvent.change(truong(/Cân nặng/), { target: { value: "70" } });
    fireEvent.change(truong(/Chiều cao/), { target: { value: "172" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu và xem cùng Sata Robo/ }));
    await waitFor(() => expect(doc()?.ds[0]?.ban[0]?.nang).toBe(70));
    fireEvent.click(screen.getByRole("button", { name: "Tải bản sao lưu" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("[PSK-UI-10] đọc lại sổ", () => {
  it("sổ hỏng ⇒ trống, không sập; sổ tốt ⇒ hiện sau khi vẽ", async () => {
    window.localStorage.setItem(KHOA_LUU_CONG, "{không phải json");
    dung();
    expect(screen.getByText(/còn 6 chỗ/)).toBeTruthy();
    cleanup();
    nap([BIN]);
    dung();
    await act(async () => undefined);
    await doiNap("Bin");
  });
});
