// @vitest-environment jsdom
/**
 * Form tạo đơn × THU THEO PHẠM VI HỌC — HÀNH VI trên form thật (không phải đọc mã).
 *
 * Mỗi ca "ẩn / không gửi" đi kèm đối chứng dương (luật 11): cơ sở khác / đơn thường VẪN thấy khối kế hoạch và VẪN gửi đợt.
 * Form được dựng với hai cơ sở: CS2 đã bật cờ phạm vi, CS1 chưa — đúng cấu hình đã đo trên test.satarobo.vn 13/10/2026.
 *
 * Máy chủ bị thay bằng hai spy: `createOrderManualAction` (bắt payload) và `xemTruocGiaPhamViAction` (trả giá cố định).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  tao: vi.fn(),
  xemTruoc: vi.fn(),
  tra: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, warning: vi.fn() } }));
vi.mock("../_actions", () => ({ createOrderManualAction: h.tao, timPhuHuynhTheoSdtAction: h.tra }));
vi.mock("../_pham-vi-actions", () => ({ xemTruocGiaPhamViAction: h.xemTruoc }));

import { OrderCreateForm } from "./order-create-form";
import { thongBaoDonTron } from "@/lib/orders/pham-vi/phan-loai";

const KHOA48 = { id: "k48", code: "S3", name: "Sata 3", price: 10_560_000, type: "COURSE", slug: "sata-3", totalSessions: 48 };
const KHOA12 = { id: "k12", code: "S2", name: "Sata 2", price: 4_800_000, type: "COURSE", slug: "sata-2", totalSessions: 12 };
const GIA_MAY_CHU = 8_976_000;

const props = (o: Record<string, unknown> = {}) => ({
  paymentMethods: [
    { id: "pm1", code: "CK", name: "Chuyển khoản", centerId: null, canBuyCourse: true, canBuyPackage: true, canBuyExam: true, canBuyProduct: true },
  ],
  courses: [KHOA48, KHOA12],
  products: [],
  centers: [
    { id: "cs1", name: "Cơ sở 1" },
    { id: "cs2", name: "Cơ sở 2" },
  ],
  students: [],
  conLeadBanDau: [],
  maKhuyenMai: [],
  maCoSoTheoCenter: {},
  provinces: [],
  tranPhanTram: 50,
  phamViBatTheoCoSo: { cs1: false, cs2: true },
  defaultCustomer: { name: "Nguyễn Thị Hồng Nhung", phone: "0905123456", email: "" },
  ...o,
});

/**
 * Chọn một giá trị của Select Base UI qua ô ẩn của nó (đường tự điền của trình duyệt — cũng là đường Base UI hỗ trợ chính thức
 * để đổi giá trị mà không cần danh sách thả). jsdom không có bố cục nên `click` lên mục thứ hai trở đi không trúng.
 * `trigger` = nút combobox; ô ẩn là phần tử `input[aria-hidden]` đứng ngay sau nó.
 */
async function datGiaTri(trigger: HTMLElement, giaTri: string) {
  const o = trigger.nextElementSibling as HTMLInputElement | null;
  if (!o || o.tagName !== "INPUT") throw new Error("không thấy ô ẩn của Select");
  await act(async () => {
    fireEvent.change(o, { target: { value: giaTri } });
  });
}

/** Chọn khoá ở dòng đầu (ô Select có chữ "Chọn..." hoặc đang mang tên một khoá Sata). */
async function chonKhoa(id: "k48" | "k48b" | "k12", dongSo = 0) {
  const trigger = screen.getAllByRole("combobox").filter((el) => /Chọn\.\.\.|Sata \d/.test(el.textContent ?? ""))[dongSo];
  if (!trigger) throw new Error(`không thấy ô chọn khoá của dòng ${dongSo + 1}`);
  await datGiaTri(trigger, id);
}

const khoiKeHoach = () => screen.queryByText("Kế hoạch thanh toán");
const khoiPhamVi = () => screen.queryByTestId("khoi-thu-theo-pham-vi");
const gui = async () => {
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
};
const payload = () => h.tao.mock.calls[0]![0] as { keHoachDot: unknown[] | null; items: Array<{ unitPrice: number }> };

beforeEach(() => {
  vi.clearAllMocks();
  h.tao.mockResolvedValue({ ok: true, id: "ord-1", code: "DH1", lyDoChoDuyet: [] });
  h.tra.mockResolvedValue({ ok: true, leads: [] });
  h.xemTruoc.mockImplementation(async (x: { items: unknown[] }) => ({
    ok: true,
    kieu: "SCOPE",
    dong: x.items.map(() => ({ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, phanTramApDung: 15, thanhTien: GIA_MAY_CHU })),
  }));
});
afterEach(cleanup);

/** Chọn cơ sở ở ô "Trung tâm". */
async function chonCoSo(id: "cs1" | "cs2") {
  const trigger = screen.getAllByRole("combobox").find((el) => /Không gán|Cơ sở \d/.test(el.textContent ?? ""));
  if (!trigger) throw new Error("không thấy ô Trung tâm");
  await datGiaTri(trigger, id);
}

describe("[P6-F1] cơ sở BẬT cờ + dòng khoá 48 buổi", () => {
  it("ẩn khối kế hoạch nhiều đợt, hiện khối 'Thu theo phạm vi học' kèm ghi chú; xem trước gọi máy chủ", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    expect(khoiKeHoach()).not.toBeNull(); // chưa chọn khoá: đơn chưa theo phạm vi ⇒ giao diện cũ
    await chonKhoa("k48");
    expect(khoiKeHoach()).toBeNull();
    expect(khoiPhamVi()).not.toBeNull();
    expect(within(khoiPhamVi()!).getByText(/không dùng kế hoạch thanh toán nhiều đợt/)).toBeTruthy();
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalled());
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Đơn giá đang nhập khác giá hệ thống tính/)).toBeTruthy());
  });

  it("Tạo đơn KHÔNG gửi keHoachDot (null), kể cả khi khối kế hoạch đã có đợt từ trước khi đổi khoá", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k12"); // khoá 12 buổi ⇒ đơn thường ⇒ khối kế hoạch hiện, state kế hoạch có đợt
    expect(khoiKeHoach()).not.toBeNull();
    await chonKhoa("k48"); // đổi sang khoá 48 ⇒ theo phạm vi
    expect(khoiKeHoach()).toBeNull();
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalled());

    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().keHoachDot).toBeNull();
  });

  it("kế hoạch đợt CŨ đang HỎNG (đợt thiếu ngày hẹn — cổng chặn lưu của khối cũ) không chặn đơn khi cơ sở chuyển sang phạm vi", async () => {
    // Cơ sở 1 (tắt) + khoá 48: khối kế hoạch hiện. Xoá hạn của đợt ⇒ khối cũ sẽ chặn lưu. Rồi đổi sang Cơ sở 2 (bật): TỔNG ĐƠN KHÔNG
    // ĐỔI nên state kế hoạch không bị chia lại — nó nằm đó, hỏng và ẩn. (Đổi khoá thì tổng đổi và kế hoạch tự lập lại, ca đó không thử được.)
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    const ngay = document.querySelector('input[name="dot-0-due"]') as HTMLInputElement;
    expect(ngay).not.toBeNull();
    await act(async () => {
      fireEvent.change(ngay, { target: { value: "" } });
    });
    await chonCoSo("cs2");
    expect(khoiKeHoach()).toBeNull();
    expect(khoiPhamVi()).not.toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(payload().keHoachDot).toBeNull();
  });

  it("[đối chứng] CÙNG đợt hỏng nhưng cơ sở vẫn tắt ⇒ khối cũ VẪN chặn lưu (không gửi gì)", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    const ngay = document.querySelector('input[name="dot-0-due"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(ngay, { target: { value: "" } });
    });
    await gui();
    expect(h.tao).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/chưa thu — chọn ngày hẹn đóng/));
  });

  it("nút 'Áp giá theo phạm vi học' điền ĐÚNG số máy chủ tính vào đơn giá; gửi đi với số đó", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    const nut = await screen.findByRole("button", { name: "Áp giá theo phạm vi học" });
    await act(async () => {
      fireEvent.click(nut);
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Áp giá theo phạm vi học" })).toBeNull());
    expect(within(khoiPhamVi()!).getByText(/Đơn giá đã khớp giá hệ thống tính/)).toBeTruthy();
    // Áp giá chỉ đổi ĐƠN GIÁ — máy chủ không dùng đơn giá ở đường xem trước nên KHÔNG được tính lại (khoá không chứa đơn giá).
    await new Promise((r) => setTimeout(r, 500));
    expect(h.xemTruoc).toHaveBeenCalledTimes(1);
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().items[0]!.unitPrice).toBe(GIA_MAY_CHU);
    expect(payload().keHoachDot).toBeNull();
  });

  it("máy chủ từ chối xem trước (REJECT) ⇒ câu của máy chủ hiện trong khối, không có nút Áp giá", async () => {
    h.xemTruoc.mockResolvedValue({ ok: true, kieu: "REJECT", thongBao: "Dòng 1 (Sata 3): số buổi 20 không nằm trong các mốc." });
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/số buổi 20 không nằm trong các mốc/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Áp giá theo phạm vi học" })).toBeNull();
  });

  it("xem trước hỏng (mạng/quyền) ⇒ nói thật là chưa tính được, KHÔNG chặn Tạo đơn (máy chủ vẫn là chốt)", async () => {
    h.xemTruoc.mockRejectedValue(new Error("mạng"));
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Chưa tính được giá theo phạm vi học/)).toBeTruthy());
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().keHoachDot).toBeNull();
  });
});

describe("[P6-F2] đối chứng: CÙNG dòng khoá 48 buổi nhưng KHÔNG theo phạm vi ⇒ giao diện và payload như cũ", () => {
  it("cơ sở CHƯA bật cờ: khối kế hoạch hiện, không khối phạm vi, không gọi xem trước, payload CÓ đợt", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    expect(khoiKeHoach()).not.toBeNull();
    expect(khoiPhamVi()).toBeNull();
    await new Promise((r) => setTimeout(r, 500)); // quá thời gian debounce của xem trước
    expect(h.xemTruoc).not.toHaveBeenCalled();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(Array.isArray(payload().keHoachDot)).toBe(true);
    expect((payload().keHoachDot as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(payload().items[0]!.unitPrice).toBe(KHOA48.price); // đơn giá không bị chạm
  });

  it("cơ sở ĐÃ bật cờ nhưng khoá 12 buổi (đơn thường): khối kế hoạch hiện, payload CÓ đợt", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k12");
    expect(khoiKeHoach()).not.toBeNull();
    expect(khoiPhamVi()).toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect((payload().keHoachDot as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("đổi cơ sở qua lại: CS2 (bật) ⇒ khối phạm vi; sang CS1 (tắt) ⇒ khối kế hoạch trở lại và payload CÓ đợt", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    expect(khoiPhamVi()).not.toBeNull();
    await chonCoSo("cs1");
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).not.toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect((payload().keHoachDot as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

describe("[P6-F3] đơn TRỘN (dòng 48 lẫn dòng khác) ở cơ sở đã bật cờ", () => {
  it("giữ giao diện cũ + payload CÓ đợt, kèm cảnh báo bằng đúng câu của máy chủ; không gọi xem trước", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Thêm dòng/ })[0]!);
    });
    await chonKhoa("k12", 1);
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).not.toBeNull();
    const canhBao = screen.getByRole("alert");
    expect(canhBao.textContent).toBe(thongBaoDonTron(["Dòng 2 (Sata 2)"]));
    await new Promise((r) => setTimeout(r, 500));
    expect(h.xemTruoc).not.toHaveBeenCalled();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect((payload().keHoachDot as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * GOLDEN: payload ĐO trên form TRƯỚC PR này (`origin/test` 4975cc6af) bằng cùng thao tác, đồng hồ đóng băng 11/10/2026.
 * Chạy song song bản cũ và bản mới trong một lượt so sánh tạm (4 kịch bản) cho kết quả GIỐNG HỆT từng byte; hai kịch bản
 * dưới đây giữ lại làm hằng. Đổi bất kỳ trường nào của payload đơn thường là phải cố ý sửa cả hằng này.
 */
describe("[P6-G] payload đơn KHÔNG theo phạm vi giữ nguyên từng byte so với trước PR", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T03:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const co = {
    type: "COURSE",
    status: "PENDING_PAYMENT",
    customerName: "Nguyễn Thị Hồng Nhung",
    customerPhone: "0905123456",
    customerEmail: "",
    customerCccd: null,
    customerAddress: null,
    customerWard: null,
    customerCity: null,
    studentId: null,
    leadId: null,
    leadChildId: null,
    paymentMethodId: "pm1",
    customerNote: null,
    internalNote: null,
  };
  const dot = (amount: number) => [{ amount, daThu: false, dueDate: "2026-10-11", reminderDays: 14, laCoc: false }];
  const dongGoc = (ten: string, courseId: string, gia: number, soBuoi: number) => ({
    type: "COURSE_ENROLLMENT",
    itemName: ten,
    quantity: 1,
    unitPrice: gia,
    packageId: null,
    examAttemptId: null,
    productId: null,
    studentId: null,
    leadChildId: null,
    discounts: [],
    metadata: { courseId, soBuoi },
  });

  it("[P6-G1] cơ sở tắt + khoá 48 buổi", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(h.tao.mock.calls[0]![0]).toEqual({
      ...co,
      centerId: "cs1",
      items: [dongGoc("Sata 3", "k48", 10_560_000, 48)],
      keHoachDot: dot(10_560_000),
    });
  });

  it("[P6-G2] cơ sở bật + đơn trộn 48 & 12 buổi", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Thêm dòng/ })[0]!);
    });
    await chonKhoa("k12", 1);
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(h.tao.mock.calls[0]![0]).toEqual({
      ...co,
      centerId: "cs2",
      items: [dongGoc("Sata 3", "k48", 10_560_000, 48), dongGoc("Sata 2", "k12", 4_800_000, 12)],
      keHoachDot: dot(15_360_000),
    });
  });
});


// ═══ PHẦN BỔ SUNG [PB-*] — lượt cấy lỗi độc lập trên head e08ed053f: 14 lỗ mà mock "cùng một giá cho mọi dòng" và các ca một-dòng không bắt được ═══
const KHOA48B = { id: "k48b", code: "S4", name: "Sata 4", price: 11_520_000, type: "COURSE", slug: "sata-4", totalSessions: 48 };
const hai = (o: Record<string, unknown> = {}) => props({ courses: [KHOA48, KHOA48B, KHOA12], ...o });
const oTien = () => {
  const an = document.querySelector('input[name="dot-0-amount"]') as HTMLInputElement;
  return an.parentElement!.querySelector('input:not([type="hidden"])') as HTMLInputElement;
};
const nutAp = () => screen.queryByRole("button", { name: "Áp giá theo phạm vi học" });
const themDong = async () => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /Thêm dòng/ })[0]!);
  });
};
const SCOPE2 = (a: number, b: number) => async (x: { items: unknown[] }) => ({
  ok: true,
  kieu: "SCOPE",
  dong: x.items.map((_, i) => ({ soBuoi: 48, loaiMua: "FULL", niemYet: i === 0 ? 10_560_000 : 11_520_000, phanTramApDung: 15, thanhTien: i === 0 ? a : b })),
});

describe("[PB] nhiều dòng — giá đi đúng dòng", () => {
  it("[PB-F1] áp giá: mỗi dòng nhận giá CỦA DÒNG ấy", async () => {
    h.xemTruoc.mockImplementation(SCOPE2(8_976_000, 9_500_000));
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    const nut = await screen.findByRole("button", { name: "Áp giá theo phạm vi học" });
    await act(async () => {
      fireEvent.click(nut);
    });
    await waitFor(() => expect(nutAp()).toBeNull());
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().items.map((i) => i.unitPrice)).toEqual([8_976_000, 9_500_000]);
  });
  it("[PB-F2] nút Áp giá hiện khi CHỈ MỘT dòng lệch (dòng 1 đã khớp, dòng 2 lệch)", async () => {
    h.xemTruoc.mockImplementation(SCOPE2(10_560_000, 9_500_000)); // dòng 1 = giá niêm yết form điền sẵn
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await screen.findByRole("button", { name: "Áp giá theo phạm vi học" });
  });
  it("[PB-F3] thẻ từng dòng in giá của CHÍNH dòng đó", async () => {
    h.xemTruoc.mockImplementation(SCOPE2(8_976_000, 9_500_000));
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await waitFor(() => expect(screen.getAllByText(/Giá theo phạm vi học \(hệ thống tính\)/)).toHaveLength(2));
    const the = screen.getAllByText(/Giá theo phạm vi học \(hệ thống tính\)/).map((el) => el.closest("div")!.textContent ?? "");
    expect(the[0]).toContain("8.976.000đ");
    expect(the[1]).toContain("9.500.000đ");
  });
  it("[PB-F4] khối: dòng 1 khớp, dòng 2 lệch ⇒ báo lệch (some, không every / không dòng đầu)", async () => {
    h.xemTruoc.mockImplementation(SCOPE2(10_560_000, 9_500_000));
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Đơn giá đang nhập khác giá hệ thống tính/)).toBeTruthy());
    expect(within(khoiPhamVi()!).queryByText(/Đơn giá đã khớp/)).toBeNull();
  });
});

describe("[PB] nút/nhãn nói thật", () => {
  it("[PB-F5] xem trước hỏng (ok:false) ⇒ KHÔNG có nút Áp giá", async () => {
    h.xemTruoc.mockResolvedValue({ ok: false, error: "x" });
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Chưa tính được giá/)).toBeTruthy());
    expect(nutAp()).toBeNull();
  });
  it("[PB-F6] máy chủ trả LEGACY ⇒ KHÔNG có nút Áp giá", async () => {
    h.xemTruoc.mockResolvedValue({ ok: true, kieu: "LEGACY" });
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Máy chủ không áp dụng phạm vi học/)).toBeTruthy());
    expect(nutAp()).toBeNull();
  });
  it("[PB-F7] thẻ dòng: số đậm là THÀNH TIỀN (không phải niêm yết); cảnh báo 'khác số này' có khi lệch, mất khi đã áp", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(screen.getAllByText(/Giá theo phạm vi học \(hệ thống tính\)/)).toHaveLength(1));
    const the = () => screen.getByText(/Giá theo phạm vi học \(hệ thống tính\)/).closest("div")!;
    expect(within(the()).getByText("8.976.000đ", { selector: "b" })).toBeTruthy();
    expect(within(the()).queryByText(/Đơn giá đang nhập khác số này/)).not.toBeNull();
    await act(async () => {
      fireEvent.click(nutAp()!);
    });
    await waitFor(() => expect(nutAp()).toBeNull());
    expect(within(the()).queryByText(/Đơn giá đang nhập khác số này/)).toBeNull();
  });
  it("[PB-F8] cơ sở TẮT: không có thẻ giá phạm vi trong dòng", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText(/Giá theo phạm vi học \(hệ thống tính\)/)).toBeNull();
    expect(screen.queryByText(/Đang tính giá theo phạm vi học/)).toBeNull();
  });
});

describe("[PB] xem trước theo đầu vào HIỆN TẠI", () => {
  it("[PB-X1] đổi đầu vào ⇒ kết quả CŨ không được hiện (đang tính lại)", async () => {
    let n = 0;
    h.xemTruoc.mockImplementation((x: { items: unknown[] }) => {
      n++;
      if (n === 1) return Promise.resolve({ ok: true, kieu: "SCOPE", dong: x.items.map(() => ({ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, phanTramApDung: 15, thanhTien: GIA_MAY_CHU })) });
      return new Promise(() => {}); // lượt 2 treo
    });
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Đơn giá đang nhập khác/)).toBeTruthy());
    await chonKhoa("k48b"); // đổi khoá ⇒ khoá xem trước đổi
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(2));
    expect(within(khoiPhamVi()!).getByText(/Đang tính giá theo phạm vi học/)).toBeTruthy();
    expect(nutAp()).toBeNull();
  });
  it("[PB-X2] lượt về MUỘN của chuỗi cũ không ghi đè chuỗi mới", async () => {
    const treo: Array<(v: unknown) => void> = [];
    h.xemTruoc.mockImplementation((x: { items: unknown[] }) => {
      const k = h.xemTruoc.mock.calls.length;
      if (k === 1) return new Promise((r) => treo.push(r)); // chuỗi cũ: treo
      return Promise.resolve({ ok: true, kieu: "SCOPE", dong: x.items.map(() => ({ soBuoi: 48, loaiMua: "FULL", niemYet: 11_520_000, phanTramApDung: 15, thanhTien: 9_999_000 })) });
    });
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(1));
    await chonKhoa("k48b");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(khoiPhamVi()!).getAllByText("9.999.000đ").length).toBeGreaterThan(0));
    await act(async () => {
      treo[0]!({ ok: true, kieu: "SCOPE", dong: [{ soBuoi: 48, loaiMua: "FULL", niemYet: 1, phanTramApDung: 0, thanhTien: 1 }] });
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(khoiPhamVi()!).getAllByText("9.999.000đ").length).toBeGreaterThan(0);
    expect(within(khoiPhamVi()!).queryByText(/Đang tính giá/)).toBeNull();
  });
  it("[PB-X3] khoá xem trước mang đúng centerId đang chọn; đổi giữa hai cơ sở ĐỀU bật ⇒ tính lại", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2", phamViBatTheoCoSo: { cs1: true, cs2: true } })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(1));
    expect(h.xemTruoc.mock.calls[0]![0]).toMatchObject({ centerId: "cs2" });
    await chonCoSo("cs1");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(2));
    expect(h.xemTruoc.mock.calls[1]![0]).toMatchObject({ centerId: "cs1" });
  });
});

describe("[PB] phân loại theo cơ sở + kế hoạch lệch", () => {
  it("[PB-B1] CHƯA chọn cơ sở + khoá 48 ⇒ giao diện cũ (không khối phạm vi), payload CÓ đợt", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: undefined })} />);
    await chonKhoa("k48");
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).not.toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect((payload().keHoachDot as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
  it("[PB-B2] cơ sở KHÔNG có trong bảng cờ ⇒ coi là TẮT", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1", phamViBatTheoCoSo: { cs2: true } })} />);
    await chonKhoa("k48");
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).not.toBeNull();
  });
  it("[PB-A1] kế hoạch cũ bị LỆCH (sửa số một đợt) rồi chuyển sang cơ sở bật ⇒ không chặn lưu, keHoachDot null", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    const tien = oTien();
    expect(tien).not.toBeNull();
    await act(async () => {
      fireEvent.change(tien, { target: { value: "1000000" } });
    });
    await chonCoSo("cs2");
    expect(khoiPhamVi()).not.toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(payload().keHoachDot).toBeNull();
  });
  it("[PB-A2] đối chứng: CÙNG kế hoạch lệch nhưng cơ sở vẫn tắt ⇒ khối cũ chặn lưu", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    const tien = oTien();
    await act(async () => {
      fireEvent.change(tien, { target: { value: "1000000" } });
    });
    await gui();
    expect(h.tao).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/lệch/));
  });
});


// ═══ [P7-1x] Ô "Số buổi mua" × xem trước giá — vá sau smoke 13–14/10/2026 ═════════════════════════════════════════════════════
//
// Triệu chứng (test.satarobo.vn, CS2, khoá 48 buổi): bấm ô "Số buổi mua" rồi gõ 24 lần đầu ⇒ "Chưa tính được giá… (Dữ liệu không hợp lệ)"; bôi đen rồi gõ lại ⇒ 24 buổi / 5.700.000đ.
// Nguyên nhân (đo trên Chromium thật, ô <input type=number value=48>: bấm rồi gõ "24" ⇒ "4824"; bôi đen rồi gõ ⇒ "24"): chọn khoá điền sẵn đủ buổi (48) nên "bấm + gõ 24" NỐI thành 4824; 4824 vượt trần 500
// của `orderItemSchema` nên zod từ chối ở cổng đọc, và action cũ gom MỌI lỗi zod thành một câu chung. Lần gõ thứ hai thành công vì người smoke triple-click (= bôi đen) trước. KHÔNG phải đua lượt về
// (đã ghim `[PB-X2]`, xanh trước PR này) và KHÔNG phải debounce. Vá hai tầng: (1) vào ô là chọn hết (`[P7-19]`); (2) lời từ chối nói thật vì sao (`[P7-11]`). Luật server (trần 500, mốc 12/24/36/48) đứng nguyên.
import { docDauVaoXemTruoc } from "@/lib/orders/pham-vi/dau-vao-xem-truoc";

const BANG_GIA: Record<number, { niemYet: number; pt: number; thanhTien: number }> = {
  12: { niemYet: 3_000_000, pt: 0, thanhTien: 3_000_000 },
  24: { niemYet: 6_000_000, pt: 5, thanhTien: 5_700_000 },
  36: { niemYet: 9_000_000, pt: 10, thanhTien: 8_100_000 },
  48: { niemYet: 10_560_000, pt: 15, thanhTien: 8_976_000 },
};
const THONG_BAO_LE = "Dòng 1 (Sata 3): số buổi không nằm trong các mốc. Số buổi hợp lệ: 12 / 24 / 36 / 48.";
/** Máy chủ GIẢ nhưng cổng đọc là THẬT (`docDauVaoXemTruoc`) — đúng thứ action chạy đầu tiên. Bảng giá chỉ là fixture, không khẳng định giá thật. */
const mayChuGia = async (x: unknown) => {
  const r = docDauVaoXemTruoc(x);
  if (!r.ok) return { ok: false, error: r.error };
  const md = r.data.items[0]!.metadata as { soBuoi?: number } | null | undefined;
  const so = md?.soBuoi ?? 48; // vắng soBuoi = mua đủ khoá
  const g = BANG_GIA[so];
  if (!g) return { ok: true, kieu: "REJECT", thongBao: THONG_BAO_LE };
  return { ok: true, kieu: "SCOPE", dong: [{ soBuoi: so, loaiMua: so === 48 ? "FULL" : "MILESTONE", niemYet: g.niemYet, phanTramApDung: g.pt, thanhTien: g.thanhTien }] };
};
const oSoBuoi = () => document.querySelector('input[type="number"][min="1"][max="500"]') as HTMLInputElement;
const goSoBuoi = async (v: string) => {
  await act(async () => {
    fireEvent.change(oSoBuoi(), { target: { value: v } });
  });
};
const khoiNoi = () => khoiPhamVi()?.textContent ?? "";

describe("[P7-1] gõ 'Số buổi mua' — lời từ chối nói thật, mốc hợp lệ ổn định", () => {
  beforeEach(() => {
    h.xemTruoc.mockImplementation(mayChuGia);
  });

  it("[P7-11] ô đang mang 48, bấm KHÔNG bôi đen rồi gõ '2','4' (⇒ 482 → 4824): câu từ chối nói ĐÚNG lý do (1–500) và dòng nào, không còn câu chung", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    expect(oSoBuoi().value).toBe("48"); // khoá điền sẵn đủ buổi — ô KHÔNG trống
    await goSoBuoi("482");
    await goSoBuoi("4824");
    await waitFor(() => expect(khoiNoi()).toMatch(/Chưa tính được giá theo phạm vi học/));
    expect(khoiNoi()).toContain("Dòng 1: Số buổi phải là số nguyên từ 1 đến 500");
    expect(khoiNoi()).not.toContain("Dữ liệu không hợp lệ");
    expect(nutAp()).toBeNull(); // không có giá để áp
    expect(screen.getByText(/Số buổi hợp lệ:/).textContent).toContain("12 / 24 / 36 / 48"); // gợi ý mốc trên dòng vẫn hiện
  });

  it.each([
    [12, ["1", "12"]],
    [24, ["2", "24"]],
    [36, ["3", "36"]],
    [48, ["4", "48"]],
  ])("[P7-12] bôi đen rồi gõ từng ký tự tới %i ⇒ giá hợp lệ ổn định (ký tự đầu là số lẻ, ký tự cuối là mốc)", async (so, buoc) => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await goSoBuoi(""); // bôi đen + xoá
    for (const v of buoc) await goSoBuoi(v);
    const g = BANG_GIA[so]!;
    await waitFor(() => expect(khoiNoi()).toContain(`${so} buổi · niêm yết ${g.niemYet.toLocaleString("vi-VN")}đ, giảm ${g.pt}%`));
    expect(khoiNoi()).not.toMatch(/Chưa tính được giá|Dữ liệu không hợp lệ/);
    await new Promise((r) => setTimeout(r, 450)); // quá debounce: không còn lượt nào đè
    expect(khoiNoi()).toContain(`${so} buổi · niêm yết`);
  });

  it("[P7-13] lượt về của khoá mặc định tới SAU lượt của '24' (đảo thứ tự) ⇒ vẫn hiện giá của 24", async () => {
    const treo: Array<(v: unknown) => void> = [];
    h.xemTruoc.mockImplementation((x: unknown) => {
      if (h.xemTruoc.mock.calls.length === 1) return new Promise((r) => treo.push(r)); // lượt đầu: treo
      return mayChuGia(x);
    });
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(1));
    await goSoBuoi("2");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(2));
    await goSoBuoi("24");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(khoiNoi()).toContain("24 buổi · niêm yết 6.000.000đ, giảm 5%"));
    await act(async () => {
      treo[0]!({ ok: false, error: "Dữ liệu không hợp lệ" }); // kết quả CŨ về muộn
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(khoiNoi()).toContain("24 buổi · niêm yết 6.000.000đ, giảm 5%");
    expect(khoiNoi()).not.toContain("Dữ liệu không hợp lệ");
  });

  it("[P7-14] số lẻ (13, 49) ⇒ câu của máy chủ 'Số buổi hợp lệ: 12 / 24 / 36 / 48' (luật không đổi), không có nút Áp giá", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    for (const v of ["13", "49"]) {
      await goSoBuoi(v);
      await waitFor(() => expect(khoiNoi()).toContain("Số buổi hợp lệ: 12 / 24 / 36 / 48"));
      expect(nutAp()).toBeNull();
      await goSoBuoi("24"); // quay về mốc để lượt sau đo lại từ trạng thái hợp lệ
      await waitFor(() => expect(khoiNoi()).toContain("24 buổi · niêm yết"));
    }
  });

  it("[P7-15] ô TRỐNG hoặc 0 ⇒ lượt xem trước KHÔNG kèm soBuoi (hành vi hiện hành: mua ĐỦ KHOÁ); vẫn KHÔNG bị 'Dữ liệu không hợp lệ'", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    for (const v of ["", "0"]) {
      await goSoBuoi("24");
      await waitFor(() => expect(khoiNoi()).toContain("24 buổi · niêm yết"));
      h.xemTruoc.mockClear();
      await goSoBuoi(v);
      await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(1));
      const md = (h.xemTruoc.mock.calls[0]![0] as { items: Array<{ metadata?: Record<string, unknown> | null }> }).items[0]!.metadata;
      expect(md).toEqual({ courseId: "k48" }); // không soBuoi, không NaN, không chuỗi
      await waitFor(() => expect(khoiNoi()).toContain("48 buổi · niêm yết"));
      expect(khoiNoi()).not.toContain("Dữ liệu không hợp lệ");
    }
  });

  it("[P7-19] vào ô 'Số buổi mua' là CHỌN HẾT giá trị (để 'bấm rồi gõ 24' thay 48 chứ không nối thành 4824); chỉ ô số buổi, không ô số khác", async () => {
    const chon = vi.spyOn(HTMLInputElement.prototype, "select").mockImplementation(() => {});
    try {
      render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
      await chonKhoa("k48");
      const o = oSoBuoi();
      expect(chon).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.focus(o);
      });
      expect(chon).toHaveBeenCalledTimes(1);
      expect(chon.mock.contexts[0]).toBe(o);
    } finally {
      chon.mockRestore();
    }
  });

  it("[P7-PF1] chọn-hết CHỈ ở ô 'Số buổi mua': focus ô Số buổi ⇒ select đúng 1 lần; focus ô 'Số lượng' ⇒ KHÔNG gọi thêm", async () => {
    const chon = vi.spyOn(HTMLInputElement.prototype, "select").mockImplementation(() => {});
    try {
      render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
      await chonKhoa("k48");
      const oSoLuong = screen.getAllByText("Số lượng")[0]!.closest("div")!.querySelector("input") as HTMLInputElement;
      expect(oSoLuong).not.toBeNull();
      expect(oSoLuong).not.toBe(oSoBuoi());
      await act(async () => {
        fireEvent.focus(oSoBuoi());
      });
      expect(chon).toHaveBeenCalledTimes(1);
      await act(async () => {
        fireEvent.focus(oSoLuong);
      });
      expect(chon).toHaveBeenCalledTimes(1); // vẫn 1 — ô Số lượng không được tự chọn hết
    } finally {
      chon.mockRestore();
    }
  });

  it("[P7-16] ĐỐI CHỨNG: cơ sở TẮT cờ ⇒ gõ số buổi nào cũng KHÔNG gọi xem trước, không khối phạm vi", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    for (const v of ["4824", "24", ""]) await goSoBuoi(v);
    await new Promise((r) => setTimeout(r, 500));
    expect(h.xemTruoc).not.toHaveBeenCalled();
    expect(khoiPhamVi()).toBeNull();
  });
});
