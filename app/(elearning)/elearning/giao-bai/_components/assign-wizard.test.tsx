// @vitest-environment jsdom
/** [WZ-*] Trình giao khoá 4 bước theo QtGiaoKhoa1..4: đầu trang + thanh bước + danh sách khoá (radio) + cột Tóm tắt + nút Quay lại/Tiếp. Logic giao (action) KHÔNG đổi. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../_actions", () => ({ xemTruocTapNguoiHocAction: vi.fn(), taoLuotGiaoAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const { AssignWizard } = await import("./assign-wizard");
const acts = await import("../_actions");
const xemTruoc = vi.mocked(acts.xemTruocTapNguoiHocAction);
const taoLuot = vi.mocked(acts.taoLuotGiaoAction);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const props = {
  tapDongBat: false,
  khoa: [
    { id: "k1", title: "Quy trình dạy buổi trial RoboSim", code: "RS-TRIAL", banMoi: { nhan: "v3.0", soBai: 8 } },
    { id: "k2", title: "An toàn điện & pin robot", code: "ATD", banMoi: null },
  ],
  phongBan: [],
  coSo: [],
  chucDanh: [],
  vai: [],
  nhanSu: [],
};

describe("[WZ-01] bước 1 theo thiết kế", () => {
  it("đầu trang 'Giao khoá nội bộ' + 'Bước 1 — chọn nội dung' + nút 'Lượt giao đã tạo' trỏ tới trang Lượt giao", () => {
    render(<AssignWizard {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Giao khoá nội bộ" })).toBeTruthy();
    expect(screen.getByText("Bước 1 — chọn nội dung")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lượt giao đã tạo" }).getAttribute("href")).toBe("/elearning/luot-giao");
  });

  it("thanh bước: 4 mục, đúng MỘT mục aria-current='step' (bước 1)", () => {
    render(<AssignWizard {...props} />);
    const ds = within(screen.getByRole("list", { name: "Các bước giao khoá" })).getAllByRole("listitem");
    expect(ds).toHaveLength(4);
    expect(ds.filter((x) => x.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(ds[0]!.getAttribute("aria-current")).toBe("step");
  });

  it("🔴 khoá là danh sách radio có 'bản vX.Y · N bài' khi biết; khoá không có bản nói thẳng 'đang phát hành' (không bịa số)", () => {
    render(<AssignWizard {...props} />);
    const nhom = screen.getByRole("radiogroup", { name: "Khoá học" });
    expect(within(nhom).getAllByRole("radio")).toHaveLength(2);
    expect(within(nhom).getByText(/RS-TRIAL · bản v3\.0 · 8 bài · đang phát hành/)).toBeTruthy();
    expect(within(nhom).getByText("ATD · đang phát hành")).toBeTruthy();
  });
});

describe("[WZ-02] chọn khoá → Tóm tắt + Tiếp", () => {
  it("🔴 chưa chọn ⇒ 'Tiếp' khoá và Tóm tắt nói 'chọn ở bước 1'; chọn khoá ⇒ tên lượt tự điền, Tóm tắt hiện khoá + tên, 'Tiếp' mở; bấm ⇒ Bước 2", () => {
    render(<AssignWizard {...props} />);
    const tomTat = screen.getByRole("complementary", { name: "Tóm tắt" });
    expect(within(tomTat).getByText("chọn ở bước 1")).toBeTruthy();
    expect((within(tomTat).getByRole("button", { name: "Tiếp" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Quy trình dạy buổi trial RoboSim/ }));
    expect(within(tomTat).getAllByText("Quy trình dạy buổi trial RoboSim").length).toBeGreaterThanOrEqual(2); // dòng Khoá + dòng Tên lượt
    expect((screen.getByPlaceholderText(/An toàn lao động/) as HTMLInputElement).value).toBe("Quy trình dạy buổi trial RoboSim");
    const tiep = within(tomTat).getByRole("button", { name: "Tiếp" }) as HTMLButtonElement;
    expect(tiep.disabled).toBe(false);
    fireEvent.click(tiep);
    expect(screen.getByText("Bước 2 — chọn người học")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Các bước giao khoá" })).getAllByRole("listitem")[1]!.getAttribute("aria-current")).toBe("step");
    expect((within(tomTat).getByRole("button", { name: "Quay lại" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("chưa có khoá xuất bản nào ⇒ nói đường đi (soạn và xuất bản trước), không bước tiếp", () => {
    render(<AssignWizard {...props} khoa={[]} />);
    expect(screen.getByText(/Chưa có khoá nào ở trạng thái xuất bản/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Tiếp" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ───────── P5b: bước 2–4 ─────────
const ng = (i: number, o: Record<string, unknown> = {}) => ({
  userId: `u${i}`,
  fullName: `Người ${i}`,
  employeeCode: `NV${i}`,
  jobTitle: "Giáo viên",
  centerId: "cs2",
  joinedAt: "2026-10-02T00:00:00.000Z",
  ...o,
});
const props2 = { ...props, coSo: [{ id: "cs2", name: "CS2 · Hoàng Diệu" }], nhanSu: [] };
const TAP = (extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  data: { nhan: [ng(1), ng(2), ng(3)], thieuCoSo: [], thieuTaiKhoan: [], biLoaiTru: [], tong: 3, daCoGhiDanh: [], ...extra },
});

async function denBuoc2VaXemTruoc(tap: ReturnType<typeof TAP>) {
  xemTruoc.mockResolvedValue(tap as never);
  render(<AssignWizard {...props2} />);
  fireEvent.click(screen.getByRole("radio", { name: /Quy trình dạy buổi trial RoboSim/ }));
  fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Xem trước danh sách" }));
  });
  await screen.findByText(/Xem trước · \d+ người khớp/);
}

describe("[WZ-03] bước 1: tìm khoá", () => {
  it("gõ tên/mã ⇒ danh sách lọc theo; không khớp ⇒ nói thẳng", () => {
    render(<AssignWizard {...props2} />);
    const nhom = screen.getByRole("radiogroup", { name: "Khoá học" });
    fireEvent.change(screen.getByLabelText("Tìm khoá theo tên hoặc mã"), { target: { value: "atd" } });
    expect(within(nhom).getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Tìm khoá theo tên hoặc mã"), { target: { value: "không có khoá này" } });
    expect(within(nhom).queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain("Không có khoá nào khớp");
  });
});

describe("[WZ-04] bước 2: danh sách xem trước chọn/bỏ từng người", () => {
  it("🔴 xem trước gửi kèm `courseId`; dòng có chức danh · cơ sở · vào làm; 'đã chọn N'", async () => {
    await denBuoc2VaXemTruoc(TAP());
    expect(xemTruoc.mock.calls[0]![0]).toMatchObject({ courseId: "k1" });
    expect(screen.getByText("Xem trước · 3 người khớp")).toBeTruthy();
    expect(screen.getByText("đã chọn 3")).toBeTruthy();
    expect(screen.getAllByText(/Giáo viên · CS2 · Hoàng Diệu · vào làm 02\/10/)).toHaveLength(3);
    expect(screen.getAllByRole("checkbox", { name: /^Bỏ Người/ })).toHaveLength(3);
  });

  it("🔴 bỏ chọn một người ⇒ 'đã chọn 2', Tóm tắt 'Sẽ giao cho 2'… người đó vẫn còn trên danh sách (chọn lại được); 'Bỏ chọn hết' ⇒ 0; 'Chọn tất cả' ⇒ 3", async () => {
    await denBuoc2VaXemTruoc(TAP());
    fireEvent.click(screen.getByRole("checkbox", { name: "Bỏ Người 2" }));
    expect(screen.getByText("đã chọn 2")).toBeTruthy();
    expect(screen.getByText("Sẽ giao cho 2 người")).toBeTruthy();
    expect(screen.getByText("Xem trước · 3 người khớp")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Chọn Người 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn hết" }));
    expect(screen.getByText("đã chọn 0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả 3 người" }));
    expect(screen.getByText("đã chọn 3")).toBeTruthy();
    expect(screen.getByText("Sẽ giao cho 3 người")).toBeTruthy();
  });

  it("🔴 đổi luật sau khi xem trước ⇒ xem trước cũ bị bỏ (không giao với con số của luật cũ)", async () => {
    await denBuoc2VaXemTruoc(TAP());
    fireEvent.change(screen.getByPlaceholderText("để trống nếu không lọc"), { target: { value: "30" } });
    expect(screen.queryByText(/Xem trước · \d+ người khớp/)).toBeNull();
    expect(screen.getByText("Chưa xem trước")).toBeTruthy();
  });

  it("🔴 tick một điều kiện (ô chọn nhiều) sau khi xem trước cũng làm xem trước cũ bị bỏ", async () => {
    await denBuoc2VaXemTruoc(TAP());
    fireEvent.click(screen.getByRole("checkbox", { name: "Đang làm" }));
    expect(screen.queryByText(/Xem trước · \d+ người khớp/)).toBeNull();
  });

  it("🔴 đổi khoá ở bước 1 sau khi xem trước ⇒ xem trước cũ bị bỏ (mục 'đã có lượt học khoá này' đo theo khoá)", async () => {
    await denBuoc2VaXemTruoc(TAP());
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    fireEvent.click(screen.getByRole("radio", { name: /An toàn điện/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    expect(screen.getByText("Chưa xem trước")).toBeTruthy();
  });
});

describe("[WZ-05] bước 3–4: nhắc học, người bị bỏ qua, giao một lần", () => {
  async function denBuoc4(tap: ReturnType<typeof TAP>) {
    await denBuoc2VaXemTruoc(tap);
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" })); // → bước 3
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "KHONG" } }); // không đặt hạn
    // Nhắc học ở bước 3: Trong ứng dụng bật; Email/Zalo khoá + nói rõ chưa hỗ trợ.
    expect((screen.getByRole("checkbox", { name: "Trong ứng dụng" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Email/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Zalo/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" })); // → bước 4
  }

  it("bước 4: tóm tắt đủ hàng + nút 'Giao khoá cho N người'", async () => {
    await denBuoc4(TAP());
    const dl = screen.getByText("Nộp trễ").closest("dl")!;
    expect(within(dl).getByText("Không cho phép")).toBeTruthy();
    expect(within(dl).getByText("Trong ứng dụng")).toBeTruthy();
    expect(within(dl).getByText(/bản v3\.0 · 8 bài bắt buộc/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Giao khoá cho 3 người" })).toBeTruthy();
  });

  it("🔴 người đã có lượt học khoá này ⇒ nêu đích danh 'sẽ bỏ qua …' và nút chỉ đếm người THỰC SỰ được giao", async () => {
    await denBuoc4(TAP({ daCoGhiDanh: [{ userId: "u2", fullName: "Người 2", employeeCode: "NV2" }] }));
    expect(screen.getByText(/1 người đang có lượt học khoá này — sẽ bỏ qua Người 2/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Giao khoá cho 2 người" })).toBeTruthy();
  });

  it("🔴 chưa xem trước thì KHÔNG giao được (nút khoá + lời hướng dẫn), thay vì cho bấm rồi bị máy chủ từ chối", () => {
    render(<AssignWizard {...props2} />);
    fireEvent.click(screen.getByRole("radio", { name: /Quy trình dạy buổi trial RoboSim/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" })); // bước 2
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" })); // bước 3
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "KHONG" } });
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" })); // bước 4
    expect((screen.getByRole("button", { name: "Xác nhận giao" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Chưa xem trước danh sách người nhận/)).toBeTruthy();
  });

  it("🔴 bấm đúp 'Giao khoá' ⇒ action chạy ĐÚNG MỘT lần; gửi `soNguoiDaXemTruoc` + người bỏ chọn trong loại trừ; xong ⇒ màn kết quả có link tới lượt vừa tạo", async () => {
    let xong!: (v: unknown) => void;
    taoLuot.mockReturnValue(new Promise((r) => (xong = r)) as never);
    await denBuoc2VaXemTruoc(TAP());
    fireEvent.click(screen.getByRole("checkbox", { name: "Bỏ Người 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "KHONG" } });
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    const nut = screen.getByRole("button", { name: "Giao khoá cho 2 người" });
    await act(async () => {
      fireEvent.click(nut);
      fireEvent.click(nut);
    });
    expect(taoLuot).toHaveBeenCalledTimes(1);
    expect(taoLuot.mock.calls[0]![0]).toMatchObject({ soNguoiDaXemTruoc: 2, loaiTruUserId: ["u3"], contentId: "k1", notifyChannels: ["IN_APP"] });
    await act(async () => {
      xong({ ok: true, data: { assignmentId: "a1", soGhiDanh: 2, thieuCoSo: [{ fullName: "Người 9", employeeCode: "NV9" }], daCoGhiDanh: [] } });
    });
    await waitFor(() => expect(screen.getByText("Đã giao xong")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Xem lượt giao vừa tạo" }).getAttribute("href")).toBe("/elearning/giao-bai/a1");
    expect(screen.getByRole("link", { name: "Tất cả lượt giao" }).getAttribute("href")).toBe("/elearning/luot-giao");
    expect(screen.getByRole("alert").textContent).toContain("Người 9");
  });

  it("giao bị từ chối ⇒ ở lại bước 4 và bấm lại được (không kẹt vì cờ chống bấm đúp)", async () => {
    taoLuot.mockResolvedValueOnce({ ok: false, error: { code: "PREVIEW_STALE", message: "Danh sách đã đổi" } } as never);
    await denBuoc4(TAP());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Giao khoá cho 3 người" }));
    });
    await waitFor(() => expect(taoLuot).toHaveBeenCalledTimes(1));
    taoLuot.mockResolvedValueOnce({ ok: true, data: { assignmentId: "a2", soGhiDanh: 3, thieuCoSo: [], daCoGhiDanh: [] } } as never);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Giao khoá cho 3 người" }));
    });
    expect(taoLuot).toHaveBeenCalledTimes(2);
  });
});

describe("[WZ-06] kết quả giao nêu đủ các nhóm người không nhận được; hạn 'sau N ngày' phải hợp lệ", () => {
  it("🔴 người thiếu tài khoản / không tính được hạn / cơ sở chưa gắn đơn vị được nêu trên màn kết quả (không chỉ thiếu cơ sở)", async () => {
    taoLuot.mockResolvedValueOnce({
      ok: true,
      data: {
        assignmentId: "a3",
        soGhiDanh: 1,
        thieuCoSo: [],
        daCoGhiDanh: [],
        thieuTaiKhoan: [{ fullName: "Người 7", employeeCode: "NV7" }],
        khongTinhDuocHan: [{ fullName: "Người 8", employeeCode: "NV8" }],
        coSoChuaCoDonVi: ["cs9"],
      },
    } as never);
    xemTruoc.mockResolvedValue(TAP() as never);
    render(<AssignWizard {...props2} />);
    fireEvent.click(screen.getByRole("radio", { name: /Quy trình dạy buổi trial RoboSim/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xem trước danh sách" }));
    });
    await screen.findByText(/Xem trước · \d+ người khớp/);
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "KHONG" } });
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Giao khoá cho 3 người" }));
    });
    await screen.findByText("Đã giao xong");
    const canhBao = screen.getAllByRole("alert").map((x) => x.textContent ?? "").join(" | ");
    expect(canhBao).toContain("Người 7");
    expect(canhBao).toContain("không tính được hạn");
    expect(canhBao).toContain("Người 8");
    expect(canhBao).toContain("chưa gắn đơn vị tổ chức");
  });

  it("🔴 'Sau N ngày': rỗng hoặc 0 ⇒ Tiếp khoá; N ≥ 1 ⇒ mở", () => {
    render(<AssignWizard {...props2} />);
    fireEvent.click(screen.getByRole("radio", { name: /Quy trình dạy buổi trial RoboSim/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" })); // bước 2
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" })); // bước 3
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "SO_NGAY" } });
    const tiep = () => screen.getByRole("button", { name: "Tiếp" }) as HTMLButtonElement;
    const o = screen.getByLabelText("Số ngày") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "" } });
    expect(tiep().disabled).toBe(true);
    fireEvent.change(o, { target: { value: "0" } });
    expect(tiep().disabled).toBe(true);
    fireEvent.change(o, { target: { value: "14" } });
    expect(tiep().disabled).toBe(false);
  });
});
