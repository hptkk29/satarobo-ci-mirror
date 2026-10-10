// @vitest-environment jsdom
/**
 * [CLC-UI-*] Nút + hộp thoại «Chụp lại chủ nguồn cho lead cũ» — trên PHẦN TỬ THẬT (jsdom), hàm gọi máy chủ được TIÊM (`chup`).
 *
 *   [CLC-UI-01] không có lead cần chụp (tong ≤ 0) ⇒ KHÔNG vẽ gì; có ⇒ nút đúng tên (đối chứng dương)
 *   [CLC-UI-02] hộp thoại nói TRƯỚC: ghi ai · bao nhiêu lead · từng nhóm lý do (nhóm 0 không in) · điều không đổi
 *   [CLC-UI-03] lý do < 10 ký tự ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ
 *   [CLC-UI-04] chạy theo LÔ: lặp theo con trỏ tới hết; gửi đúng (nguồn, chủ đã thấy, lý do đã trim, con trỏ); thanh tiến độ; KHÔNG làm mới trang giữa các lô — chỉ khi đóng
 *   [CLC-UI-05] lỗi giữa chừng ⇒ báo, giữ phần đã làm; «Tiếp tục» chạy từ CON TRỎ, không từ đầu
 *   [CLC-UI-06] chủ vừa đổi ⇒ banner + «Tải lại»
 *   [CLC-UI-07] số liệu ĐÓNG BĂNG lúc mở: trang làm mới giữa chừng (tong co lại) không làm thanh tiến độ chạy lùi
 *
 * Hai lỗi thật mà chụp giao diện bắt được (10/10/2026): làm mới trang giữa lô gỡ hộp thoại đang chạy; `tong` co theo lô làm tiến độ chạy lùi. [CLC-UI-04] và [CLC-UI-07] ghim đúng hai điều đó.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions-chup-lai", () => ({ chupLaiChuNguonAction: vi.fn() }));

import type { KetQuaChupLaiAction } from "@/lib/nguon/ket-qua-action";
import { NutChupLaiChuNguon, type ChupLaiView } from "./chup-lai-chu-nguon";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const VIEW: ChupLaiView = {
  nguonId: "g1",
  tenNguon: "TikTok Ads",
  chu: { employeeId: "emp1", ten: "Trần Thị Phụ Trách", maNv: "NV01" },
  tong: 312,
  theoLyDo: { THIEU_CHU: 249, CHU_NGHI_VIEC: 63, CHU_KHONG_CON_HO_SO: 0 },
  giuChuCu: 0,
  khongChupDuoc: null,
};
const LY_DO = "  Khai chủ nguồn sau khi lead đã ghi nhận  ";
const lo = (daChup: number, conTro: string | null, hetLead: boolean): KetQuaChupLaiAction => ({
  ok: true,
  daChup,
  boQua: 0,
  conTro,
  hetLead,
  theoLyDo: { THIEU_CHU: daChup, CHU_NGHI_VIEC: 0, CHU_KHONG_CON_HO_SO: 0 },
});

const moHopThoai = () => fireEvent.click(screen.getByRole("button", { name: "Chụp lại chủ nguồn cho lead cũ" }));
const nhapLyDo = (v = LY_DO) => fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: v } });
const bamChay = () => fireEvent.click(screen.getByRole("button", { name: /^Chụp lại [\d.]+ lead$/ }));

describe("[CLC-UI-01] nút CHỈ khi có lead cần chụp", () => {
  it("tong = 0 ⇒ không vẽ gì; tong > 0 ⇒ có nút (đối chứng dương)", () => {
    const { container, rerender } = render(<NutChupLaiChuNguon view={{ ...VIEW, tong: 0 }} chup={vi.fn()} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<NutChupLaiChuNguon view={VIEW} chup={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Chụp lại chủ nguồn cho lead cũ" })).toBeTruthy();
  });
});

describe("[CLC-UI-02] hộp thoại nói trước điều sẽ xảy ra", () => {
  it("ghi ai · bao nhiêu lead · từng nhóm lý do; nhóm 0 không in; nói điều KHÔNG đổi và lối đi sau đó", () => {
    render(<NutChupLaiChuNguon view={VIEW} chup={vi.fn()} />);
    moHopThoai();
    const hop = screen.getByRole("dialog");
    expect(within(hop).getAllByText(/Trần Thị Phụ Trách/).length).toBeGreaterThan(0);
    expect(hop.textContent).toContain("(NV01)");
    expect(hop.textContent).toContain("312");
    expect(within(hop).getByText("Nguồn chưa có chủ lúc ghi nhận").parentElement!.textContent).toContain("249");
    expect(within(hop).getByText("Chủ đã chụp nghỉ việc").parentElement!.textContent).toContain("63");
    expect(within(hop).queryByText("Chủ đã chụp không còn hồ sơ")).toBeNull();
    expect(hop.textContent).toMatch(/Không đổi:.*cửa sổ ghi công.*ngày ghi nhận.*nhóm nguồn/);
    expect(hop.textContent).toContain("Chờ điều chỉnh");
    expect(hop.textContent).not.toContain("Cần duyệt"); // chữ không có trong giao diện
    expect(within(hop).getByRole("button", { name: "Chụp lại 312 lead" })).toBeTruthy();
  });
});

describe("[CLC-UI-03] lý do", () => {
  it("< 10 ký tự ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ; đủ ⇒ gọi", async () => {
    const chup = vi.fn().mockResolvedValue(lo(312, null, true));
    render(<NutChupLaiChuNguon view={VIEW} chup={chup} />);
    moHopThoai();
    nhapLyDo("ngắn");
    bamChay();
    expect(screen.getByText(/tối thiểu 10 ký tự\) — nó được ghi vào nhật ký/)).toBeTruthy();
    expect(screen.getByLabelText(/Lý do/).getAttribute("aria-invalid")).toBe("true");
    expect(chup).not.toHaveBeenCalled();
    nhapLyDo();
    bamChay();
    await waitFor(() => expect(chup).toHaveBeenCalledTimes(1));
  });
});

describe("[CLC-UI-04] chạy theo lô", () => {
  it("lặp theo con trỏ tới hết, gửi đúng tham số, tiến độ cộng dồn, KHÔNG refresh giữa lô — chỉ khi đóng", async () => {
    const chup = vi
      .fn()
      .mockResolvedValueOnce(lo(100, "a100", false))
      .mockResolvedValueOnce(lo(100, "a200", false))
      .mockResolvedValueOnce(lo(112, "a312", true));
    render(<NutChupLaiChuNguon view={VIEW} chup={chup} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    await screen.findByRole("status");
    expect(chup).toHaveBeenCalledTimes(3);
    expect(chup.mock.calls.map((c) => c[0].conTro)).toEqual([null, "a100", "a200"]);
    for (const c of chup.mock.calls) expect(c[0]).toMatchObject({ nguonId: "g1", chuDuKien: "emp1", lyDo: "Khai chủ nguồn sau khi lead đã ghi nhận" });
    expect(screen.getByRole("status").textContent).toContain("312");
    expect(ROUTER.refresh, "làm mới giữa các lô gỡ hộp thoại đang chạy").not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(ROUTER.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("đang chạy: nút Huỷ và nút chạy khoá, ô lý do khoá, thanh tiến độ nói số đã làm", async () => {
    let xong: (v: KetQuaChupLaiAction) => void = () => {};
    const chup = vi
      .fn()
      .mockResolvedValueOnce(lo(100, "a100", false))
      .mockImplementationOnce(() => new Promise<KetQuaChupLaiAction>((r) => (xong = r)));
    render(<NutChupLaiChuNguon view={VIEW} chup={chup} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100"));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("312");
    expect((screen.getByRole("button", { name: "Huỷ" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Lý do/) as HTMLTextAreaElement).disabled).toBe(true);
    xong(lo(212, null, true));
    await screen.findByRole("status");
  });
});

describe("[CLC-UI-05] lỗi giữa chừng", () => {
  it("báo lỗi, giữ phần đã làm, «Tiếp tục» chạy từ CON TRỎ (không từ đầu); máy chủ ném lỗi cũng được dịch", async () => {
    const chup = vi
      .fn()
      .mockResolvedValueOnce(lo(100, "a100", false))
      .mockRejectedValueOnce(new Error("mạng đứt"))
      .mockResolvedValueOnce(lo(212, "a312", true));
    render(<NutChupLaiChuNguon view={VIEW} chup={chup} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Mất kết nối giữa chừng/);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.queryByRole("button", { name: /^Chụp lại [\d.]+ lead$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    await screen.findByRole("status");
    expect(chup.mock.calls.map((c) => c[0].conTro)).toEqual([null, "a100", "a100"]);
    expect(screen.getByRole("status").textContent).toContain("312");
  });
});

describe("[CLC-UI-06] chủ vừa đổi", () => {
  it("máy chủ báo chuDoi ⇒ banner + «Tải lại» (đóng + làm mới); lỗi khác KHÔNG có «Tải lại»", async () => {
    const chup = vi.fn().mockResolvedValueOnce({ ok: false, error: "Người phụ trách nguồn vừa được đổi", field: "chuDoi" });
    render(<NutChupLaiChuNguon view={VIEW} chup={chup} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    expect((await screen.findByRole("alert")).textContent).toContain("vừa được đổi");
    // Chưa chụp được lead nào (daChup = 0) mà «Tải lại» vẫn PHẢI làm mới trang: nếu không, trang giữ chủ cũ và mọi lần bấm sau bị từ chối lại.
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ROUTER.refresh).toHaveBeenCalledTimes(1);
    cleanup();
    ROUTER.refresh.mockClear();

    const chup2 = vi.fn().mockResolvedValueOnce({ ok: false, error: "Không có quyền", field: "quyen" });
    render(<NutChupLaiChuNguon view={VIEW} chup={chup2} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    expect((await screen.findByRole("alert")).textContent).toContain("Không có quyền");
    expect(screen.queryByRole("button", { name: "Tải lại" })).toBeNull();
    // Đối chứng: lỗi KHÁC (chưa ghi gì) rồi đóng hộp thoại thì KHÔNG làm mới — chỉ chủ-đổi hoặc đã ghi mới làm mới.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ROUTER.refresh).not.toHaveBeenCalled();
  });
});

describe("[CLC-UI-08] lead GIỮ chủ cũ vì đã chi cho chủ cũ (fin3 R5 M1)", () => {
  it("giuChuCu > 0 ⇒ hộp thoại nói RIÊNG số lead giữ chủ cũ, vì sao, và cách chuyển người nhận; = 0 ⇒ KHÔNG có hàng đó (đối chứng)", () => {
    render(<NutChupLaiChuNguon view={VIEW} chup={vi.fn()} />);
    moHopThoai();
    expect(within(screen.getByRole("dialog")).queryByRole("note")).toBeNull();
    expect(screen.getByRole("dialog").textContent).not.toContain("đòi lại tiền");
    cleanup();
    render(<NutChupLaiChuNguon view={{ ...VIEW, giuChuCu: 7 }} chup={vi.fn()} />);
    moHopThoai();
    const hop = screen.getByRole("dialog");
    const ghiChu = within(hop).getByRole("note");
    expect(ghiChu.textContent).toContain("7 lead");
    expect(ghiChu.textContent).toContain("đã có khoản chi cho chủ cũ");
    expect(ghiChu.textContent).toContain("đòi lại tiền đã trả hợp lệ");
    expect(ghiChu.textContent).toContain("Đổi nguồn");
    expect(ghiChu.textContent, "«Đổi nguồn» sau thu tự ghi điều chỉnh thu hồi — không được gợi ý như đường êm").toContain("THU HỒI");
    expect(ghiChu.textContent).toContain("không qua người duyệt");
    // số lead sẽ chụp KHÔNG cộng cả 7 lead giữ chủ cũ
    expect(within(hop).getByRole("button", { name: "Chụp lại 312 lead" })).toBeTruthy();
    expect(hop.textContent).toMatch(/Không đổi:.*đã có khoản chi cho chủ cũ/);
  });

  it("kết quả: lead bị BỎ QUA được nói ra (không để người dùng thấy số nhỏ hơn mà không biết vì sao); không bỏ qua ⇒ không có dòng đó; giữ chủ cũ nhắc lại ở kết quả", async () => {
    const chup = vi
      .fn()
      .mockResolvedValueOnce({ ...lo(100, "a100", false), boQua: 3 })
      .mockResolvedValueOnce({ ...lo(209, null, true), boQua: 0 });
    render(<NutChupLaiChuNguon view={{ ...VIEW, giuChuCu: 4 }} chup={chup} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    const kq = await screen.findByRole("status");
    expect(kq.textContent).toContain("309");
    expect(kq.textContent).toMatch(/3\s*lead được BỎ QUA/);
    expect(kq.textContent).toContain("4 lead đã chi cho chủ cũ vẫn giữ chủ cũ");
    cleanup();

    const chup2 = vi.fn().mockResolvedValueOnce(lo(312, null, true));
    render(<NutChupLaiChuNguon view={VIEW} chup={chup2} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    const kq2 = await screen.findByRole("status");
    expect(kq2.textContent).not.toContain("BỎ QUA");
    expect(kq2.textContent).not.toContain("giữ chủ cũ");
  });
});

describe("[CLC-UI-07] số liệu đóng băng lúc mở", () => {
  it("trang làm mới giữa chừng (tong co lại) ⇒ hộp thoại vẫn nói 312 và tiến độ không chạy lùi", async () => {
    let xong: (v: KetQuaChupLaiAction) => void = () => {};
    const chup = vi
      .fn()
      .mockResolvedValueOnce(lo(100, "a100", false))
      .mockImplementationOnce(() => new Promise<KetQuaChupLaiAction>((r) => (xong = r)));
    const { rerender } = render(<NutChupLaiChuNguon view={VIEW} chup={chup} />);
    moHopThoai();
    nhapLyDo();
    bamChay();
    await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100"));
    rerender(<NutChupLaiChuNguon view={{ ...VIEW, tong: 212, theoLyDo: { THIEU_CHU: 149, CHU_NGHI_VIEC: 63, CHU_KHONG_CON_HO_SO: 0 } }} chup={chup} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("312");
    expect(screen.getByRole("dialog").textContent).toContain("312");
    xong(lo(212, null, true));
    await screen.findByRole("status");
    expect(screen.getByRole("status").textContent).toContain("312");
  });
});
