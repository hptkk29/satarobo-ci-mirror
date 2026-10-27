// @vitest-environment jsdom
/**
 * Form tạo đơn × THU THEO PHẠM VI HỌC — HÀNH VI trên form thật (không phải đọc mã).
 *
 * Mỗi ca "ẩn / không gửi" đi kèm đối chứng dương (luật 11).
 * [20/10/2026] KẾ HOẠCH THANH TOÁN ĐÃ BỎ cho MỌI đơn (chủ dự án): form KHÔNG còn khối kế hoạch ở bất kỳ chế độ nào và payload
 * KHÔNG còn khoá `keHoachDot`. Các ca cũ "cơ sở khác vẫn thấy khối kế hoạch và vẫn gửi đợt" đã đổi thành điều ngược lại; đối chứng
 * dương nay là thẻ giá phạm vi (có ở cơ sở bật, không có ở cơ sở tắt) và các cảnh báo duyệt/đơn trộn còn nguyên.
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
/** Ngưỡng của cơ sở đơn do MÁY CHỦ trả trong kết quả xem trước (đọc bằng `getSetting(..., { orgUnitId })`). */
const NGUONG = { tranGiamPhamVi: 25, tranSoDot: 4, tranUuDaiMoiDong: 1, tranTungKhoan: 50 };

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

/** Khối "Kế hoạch thanh toán" — ĐÃ BỎ 20/10/2026: không chế độ nào được phép vẽ nó nữa. */
/** Ô đơn giá VISIBLE của dòng `stt` (MoneyInput: ô ẩn mang `name`, ô hiện đứng cạnh). */
const oDonGia = (stt: number) =>
  (document.querySelector(`input[name="unitPrice-${stt}"]`) as HTMLInputElement).parentElement!.querySelector(
    'input:not([type="hidden"])',
  ) as HTMLInputElement;
const khoiKeHoach = () => screen.queryByText("Kế hoạch thanh toán");
/** Payload tạo đơn KHÔNG được mang khoá `keHoachDot` (kể cả `null`): server từ chối khi nó không rỗng, và form mới không gửi gì. */
const khongCoKeHoachDot = () => expect(Object.prototype.hasOwnProperty.call(h.tao.mock.calls[0]![0], "keHoachDot")).toBe(false);
/** Mọi thẻ giá theo phạm vi (mỗi dòng đơn một thẻ — KHÔNG còn khối "Thu theo phạm vi học" riêng, chủ dự án 15/10/2026). */
const hopGia = () => screen.queryAllByTestId("gia-pham-vi-dong");
/** Thẻ của dòng đầu; `null` = không có thẻ nào ⇒ đơn không theo phạm vi. */
const khoiPhamVi = () => hopGia()[0] ?? null;
/** jsdom: bấm KHÔNG mở được tooltip của base-ui (đo 15/10/2026) — hover/focus thì mở. Trình duyệt thật mở cả bằng cách bấm (`HelpHint`). */
const bungHint = async (nut: Element) => {
  await act(async () => {
    fireEvent.pointerEnter(nut);
    fireEvent.mouseEnter(nut);
    fireEvent.focus(nut);
  });
};
/** Mở dấu (i) cạnh nhãn "Số buổi mua". */
const moGiaiThichSoBuoi = async () => {
  const nut = screen.getByText("Số buổi mua").closest("label")!.querySelector('button[aria-label="Xem hướng dẫn"]')!;
  await bungHint(nut);
};
const gui = async () => {
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
};
const payload = () => h.tao.mock.calls[0]![0] as { items: Array<{ unitPrice: number }> };

beforeEach(() => {
  vi.clearAllMocks();
  h.tao.mockResolvedValue({ ok: true, id: "ord-1", code: "DH1", lyDoChoDuyet: [] });
  h.tra.mockResolvedValue({ ok: true, leads: [] });
  h.xemTruoc.mockImplementation(async (x: { items: unknown[] }) => ({
    ok: true,
    kieu: "SCOPE",
    nguong: NGUONG,
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
  it("không có khối kế hoạch; hiện thẻ giá phạm vi kèm ghi chú; xem trước gọi máy chủ", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    expect(khoiKeHoach()).toBeNull(); // chưa chọn khoá: cũng không có (trước 20/10/2026 khối này hiện nhưng khoá)
    expect(khoiPhamVi()).toBeNull();
    await chonKhoa("k48");
    expect(khoiKeHoach()).toBeNull();
    expect(khoiPhamVi()).not.toBeNull();
    expect(screen.queryByText("Thu theo phạm vi học")).toBeNull(); // không còn khối riêng
    await moGiaiThichSoBuoi(); // lời giải thích cho Sale nằm ở dấu (i), không ở một khối thêm
    expect(await screen.findByText(/không chia nhiều đợt/)).toBeTruthy();
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalled());
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Đơn giá của dòng lấy theo số này/)).toBeTruthy());
    // Câu cũ "máy chủ sẽ từ chối nếu không khớp" KHÔNG còn ở trạng thái bình thường: đơn giá tự lấy theo số máy chủ tính, Sale không còn gõ lệch được.
    expect(within(khoiPhamVi()!).queryByText(/sẽ từ chối/)).toBeNull();
  });

  it("Tạo đơn KHÔNG gửi keHoachDot — đổi khoá 12 ⇄ 48 buổi (đơn thường ⇄ phạm vi) payload vẫn không có khoá đó", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k12"); // khoá 12 buổi ⇒ đơn thường
    expect(khoiKeHoach()).toBeNull();
    expect(khoiPhamVi()).toBeNull();
    await chonKhoa("k48"); // đổi sang khoá 48 ⇒ theo phạm vi
    expect(khoiKeHoach()).toBeNull();
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalled());
    expect(khoiPhamVi()).not.toBeNull();

    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    khongCoKeHoachDot();
  });

  it("[GT-00] đơn giá dòng SCOPE TỰ LẤY số máy chủ tính, chỉ-đọc, có nhãn 'hệ thống tính'; không còn nút Áp giá; gửi đi đúng số đó", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Đơn giá của dòng lấy theo số này/)).toBeTruthy());
    expect(nutAp()).toBeNull();
    expect(screen.getByText("Đơn giá theo chính sách (hệ thống tính)")).toBeTruthy();
    expect(oDonGia(1).readOnly).toBe(true);
    expect(oDonGia(1).value.replace(/\D/g, "")).toBe(String(GIA_MAY_CHU));
    // Xem trước KHÔNG tính lại (khoá xem trước không chứa đơn giá).
    await new Promise((r) => setTimeout(r, 500));
    expect(h.xemTruoc).toHaveBeenCalledTimes(1);
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().items[0]!.unitPrice).toBe(GIA_MAY_CHU);
    khongCoKeHoachDot();
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
    expect(oDonGia(1).readOnly).toBe(false); // chưa có giá máy chủ ⇒ ô đơn giá KHÔNG chỉ-đọc (không vẽ khoá khi không có số để khoá theo)
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    khongCoKeHoachDot();
  });
});

describe("[P6-F2] đối chứng: CÙNG dòng khoá 48 buổi nhưng KHÔNG theo phạm vi ⇒ không thẻ giá phạm vi, không xem trước; payload không có kế hoạch đợt", () => {
  it("cơ sở CHƯA bật cờ: không thẻ giá phạm vi, không gọi xem trước, đơn giá niêm yết không bị chạm, payload KHÔNG có keHoachDot", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    expect(khoiKeHoach()).toBeNull();
    expect(khoiPhamVi()).toBeNull();
    await new Promise((r) => setTimeout(r, 500)); // quá thời gian debounce của xem trước
    expect(h.xemTruoc).not.toHaveBeenCalled();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    khongCoKeHoachDot();
    expect(payload().items[0]!.unitPrice).toBe(KHOA48.price); // đơn giá không bị chạm
  });

  it("cơ sở ĐÃ bật cờ nhưng khoá 12 buổi (đơn thường): không thẻ giá phạm vi, payload KHÔNG có keHoachDot", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k12");
    expect(khoiKeHoach()).toBeNull();
    expect(khoiPhamVi()).toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    khongCoKeHoachDot();
  });

  it("đổi cơ sở qua lại: CS2 (bật) ⇒ thẻ giá phạm vi; sang CS1 (tắt) ⇒ thẻ biến mất; khối kế hoạch không trở lại, payload không có keHoachDot", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    expect(khoiPhamVi()).not.toBeNull();
    await chonCoSo("cs1");
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    khongCoKeHoachDot();
  });
});

describe("[P6-F3] đơn TRỘN (dòng 48 lẫn dòng khác) ở cơ sở đã bật cờ", () => {
  it("giữ giao diện đơn thường (không thẻ giá phạm vi), kèm cảnh báo bằng đúng câu của máy chủ; không gọi xem trước; payload không có keHoachDot", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Thêm dòng/ })[0]!);
    });
    await chonKhoa("k12", 1);
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).toBeNull();
    const canhBao = screen.getByRole("alert");
    expect(canhBao.textContent).toBe(thongBaoDonTron(["Dòng 2 (Sata 2)"]));
    await new Promise((r) => setTimeout(r, 500));
    expect(h.xemTruoc).not.toHaveBeenCalled();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    khongCoKeHoachDot();
  });
});

/**
 * [20/10/2026] Hằng golden nay KHÔNG còn khoá `keHoachDot` (kế hoạch thanh toán đã bỏ) — đó là thay đổi cố ý duy nhất của payload.
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
    });
  });
});


// ═══ PHẦN BỔ SUNG [PB-*] — lượt cấy lỗi độc lập trên head e08ed053f: 14 lỗ mà mock "cùng một giá cho mọi dòng" và các ca một-dòng không bắt được ═══
const KHOA48B = { id: "k48b", code: "S4", name: "Sata 4", price: 11_520_000, type: "COURSE", slug: "sata-4", totalSessions: 48 };
const hai = (o: Record<string, unknown> = {}) => props({ courses: [KHOA48, KHOA48B, KHOA12], ...o });
const nutAp = () => screen.queryByRole("button", { name: "Áp giá theo phạm vi học" });
const themDong = async () => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /Thêm dòng/ })[0]!);
  });
};
const SCOPE2 = (a: number, b: number) => async (x: { items: unknown[] }) => ({
  ok: true,
  kieu: "SCOPE",
  nguong: NGUONG,
  dong: x.items.map((_, i) => ({ soBuoi: 48, loaiMua: "FULL", niemYet: i === 0 ? 10_560_000 : 11_520_000, phanTramApDung: 15, thanhTien: i === 0 ? a : b })),
});

describe("[PB] nhiều dòng — giá đi đúng dòng", () => {
  it("[PB-F1] mỗi dòng nhận giá CỦA DÒNG ấy (tự điền, chỉ-đọc), không còn nút Áp giá; payload đúng từng dòng", async () => {
    h.xemTruoc.mockImplementation(SCOPE2(8_976_000, 9_500_000));
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await waitFor(() => expect(hopGia()).toHaveLength(2));
    await waitFor(() => expect(oDonGia(2).readOnly).toBe(true));
    expect(nutAp()).toBeNull();
    expect(oDonGia(1).value.replace(/\D/g, "")).toBe("8976000");
    expect(oDonGia(2).value.replace(/\D/g, "")).toBe("9500000");
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().items.map((i) => i.unitPrice)).toEqual([8_976_000, 9_500_000]);
  });
  it("[PB-F2] dòng 1 đã trùng giá niêm yết form điền sẵn, dòng 2 lệch: CẢ HAI vẫn lấy giá máy chủ (không dòng nào còn 'lệch')", async () => {
    h.xemTruoc.mockImplementation(SCOPE2(10_560_000, 9_500_000));
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await waitFor(() => expect(oDonGia(2).value.replace(/\D/g, "")).toBe("9500000"));
    expect(oDonGia(1).value.replace(/\D/g, "")).toBe("10560000");
    expect(screen.queryByText(/khác số này/)).toBeNull();
  });
  it("[PB-F3] thẻ từng dòng in giá của CHÍNH dòng đó", async () => {
    h.xemTruoc.mockImplementation(SCOPE2(8_976_000, 9_500_000));
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await waitFor(() => expect(screen.getAllByText(/Giá theo chính sách phạm vi học \(hệ thống tính\)/)).toHaveLength(2));
    const the = screen.getAllByText(/Giá theo chính sách phạm vi học \(hệ thống tính\)/).map((el) => el.closest("div")!.textContent ?? "");
    expect(the[0]).toContain("8.976.000đ");
    expect(the[1]).toContain("9.500.000đ");
  });
});

describe("[PB] xem trước CŨ không được áp vào dòng khác", () => {
  it("[PB-F9] xoá dòng 1 khi xem trước 2 dòng còn đó ⇒ dòng còn lại KHÔNG mượn giá CŨ của dòng khác; rồi lấy đúng giá máy chủ tính cho nó", async () => {
    h.xemTruoc.mockImplementation(async (x: { items: unknown[] }) =>
      x.items.length === 2
        ? SCOPE2(8_976_000, 9_500_000)(x)
        : { ok: true, kieu: "SCOPE", nguong: NGUONG, dong: [{ soBuoi: 48, loaiMua: "FULL", niemYet: 11_520_000, phanTramApDung: 15, thanhTien: 7_777_000 }] },
    );
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await waitFor(() => expect(oDonGia(2).value.replace(/\D/g, "")).toBe("9500000"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xoá dòng 1" }));
    });
    // Kết quả 2 dòng đã CŨ so với danh sách 1 dòng: dòng còn lại (nay là dòng 1) KHÔNG được lấy 8.976.000 (giá cũ của dòng 1 đã xoá)
    // cũng không 9.500.000 (giá cũ của chính nó): chưa có kết quả cho đầu vào hiện tại ⇒ giữ giá niêm yết của khoá, chưa khoá.
    expect(oDonGia(1).readOnly).toBe(false);
    expect(oDonGia(1).value.replace(/\D/g, "")).toBe(String(KHOA48B.price));
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    expect(oDonGia(1).value.replace(/\D/g, "")).toBe("7777000");
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().items.map((i) => i.unitPrice)).toEqual([7_777_000]);
  });
});

describe("[PB] lời nhắn của máy chủ và nút thêm giảm trên dòng phạm vi", () => {
  const nutThemGiam = () => screen.getByRole("button", { name: /Thêm khoản giảm/ }) as HTMLButtonElement;

  it("[PB-F10] máy chủ từ chối cả đơn (nhiều dòng) ⇒ lời nhắn in ĐÚNG MỘT LẦN ở dòng 1; dòng sau chỉ trỏ về Dòng 1", async () => {
    h.xemTruoc.mockResolvedValue({ ok: true, kieu: "REJECT", thongBao: "Dòng 2 (Sata 4): đơn giá phải là 8.640.000đ." });
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await themDong();
    await chonKhoa("k48b", 1);
    await waitFor(() => expect(within(hopGia()[0]!).getByRole("alert")).toBeTruthy());
    expect(screen.getAllByRole("alert").filter((el) => /đơn giá phải là/.test(el.textContent ?? ""))).toHaveLength(1);
    expect(within(hopGia()[1]!).getByRole("alert").textContent).not.toMatch(/đơn giá phải là/);
    expect(within(hopGia()[1]!).getByText(/xem thông báo ở Dòng 1/)).toBeTruthy();
  });

  it("[PB-F11] dòng phạm vi: nút 'Thêm khoản giảm' BẬT + dòng chữ nói đúng hệ quả (chờ duyệt); thêm khoản rồi thì dòng chữ nhường chỗ cho số %; đối chứng: cơ sở tắt cờ không có dòng chữ", async () => {
    // Dòng phạm vi (CS2 bật cờ + khoá 48): từ 20/10/2026 mở lại khoản giảm thêm — nút không còn khoá, và nói thật rằng đó là chính sách thứ 2.
    const { unmount } = render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(khoiPhamVi()).not.toBeNull());
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    expect(nutThemGiam().disabled).toBe(false);
    expect(screen.getByTestId("giam-gia-pham-vi-ghi-chu").textContent).toMatch(/chờ Quản lý cơ sở duyệt/);
    expect(screen.queryByText(/chưa cộng thêm khoản giảm tay/)).toBeNull();
    unmount();
    // Đối chứng 1: cùng khoá 48 nhưng cơ sở TẮT cờ ⇒ đơn thường ⇒ thêm được, không có dòng chữ.
    const r2 = render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    expect(nutThemGiam().disabled).toBe(false);
    expect(screen.queryByTestId("giam-gia-pham-vi-ghi-chu")).toBeNull();
    r2.unmount();
    // Đối chứng 2: cơ sở BẬT cờ nhưng khoá 12 buổi ⇒ không theo phạm vi ⇒ thêm được, không có dòng chữ.
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k12");
    expect(nutThemGiam().disabled).toBe(false);
    expect(screen.queryByTestId("giam-gia-pham-vi-ghi-chu")).toBeNull();
  });
});

describe("[PB] nút/nhãn nói thật", () => {
  it("[PB-F5] xem trước hỏng (ok:false) ⇒ ô đơn giá KHÔNG chỉ-đọc (chưa có số để khoá theo)", async () => {
    h.xemTruoc.mockResolvedValue({ ok: false, error: "x" });
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Chưa tính được giá/)).toBeTruthy());
    expect(nutAp()).toBeNull();
    expect(oDonGia(1).readOnly).toBe(false);
  });
  it("[PB-F6] máy chủ trả LEGACY ⇒ ô đơn giá KHÔNG chỉ-đọc", async () => {
    h.xemTruoc.mockResolvedValue({ ok: true, kieu: "LEGACY" });
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Máy chủ không áp dụng phạm vi học/)).toBeTruthy());
    expect(nutAp()).toBeNull();
    expect(oDonGia(1).readOnly).toBe(false);
  });
  it("[PB-F7] thẻ dòng: số đậm là THÀNH TIỀN (không phải niêm yết); ô đơn giá mang đúng số đó và chỉ-đọc; không còn cảnh báo 'khác số này'", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(screen.getAllByText(/Giá theo chính sách phạm vi học \(hệ thống tính\)/)).toHaveLength(1));
    const the = () => screen.getByText(/Giá theo chính sách phạm vi học \(hệ thống tính\)/).closest("div")!;
    expect(within(the()).getByText("8.976.000đ", { selector: "b" })).toBeTruthy();
    expect(within(the()).queryByText(/khác số này/)).toBeNull();
    expect(oDonGia(1).readOnly).toBe(true);
    expect(oDonGia(1).value.replace(/\D/g, "")).toBe("8976000");
  });
  it("[PB-F8] cơ sở TẮT: không có thẻ giá phạm vi trong dòng", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText(/Giá theo chính sách phạm vi học \(hệ thống tính\)/)).toBeNull();
    expect(screen.queryByText(/Đang tính giá theo phạm vi học/)).toBeNull();
  });
});

describe("[PB] xem trước theo đầu vào HIỆN TẠI", () => {
  it("[PB-X1] đổi đầu vào ⇒ kết quả CŨ không được hiện (đang tính lại)", async () => {
    let n = 0;
    h.xemTruoc.mockImplementation((x: { items: unknown[] }) => {
      n++;
      if (n === 1) return Promise.resolve({ ok: true, kieu: "SCOPE", nguong: NGUONG, dong: x.items.map(() => ({ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, phanTramApDung: 15, thanhTien: GIA_MAY_CHU })) });
      return new Promise(() => {}); // lượt 2 treo
    });
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(within(khoiPhamVi()!).getByText(/Đơn giá của dòng lấy theo số này/)).toBeTruthy());
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
      return Promise.resolve({ ok: true, kieu: "SCOPE", nguong: NGUONG, dong: x.items.map(() => ({ soBuoi: 48, loaiMua: "FULL", niemYet: 11_520_000, phanTramApDung: 15, thanhTien: 9_999_000 })) });
    });
    render(<OrderCreateForm {...hai({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(1));
    await chonKhoa("k48b");
    await waitFor(() => expect(h.xemTruoc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(khoiPhamVi()!).getAllByText("9.999.000đ").length).toBeGreaterThan(0));
    await act(async () => {
      treo[0]!({ ok: true, kieu: "SCOPE", nguong: NGUONG, dong: [{ soBuoi: 48, loaiMua: "FULL", niemYet: 1, phanTramApDung: 0, thanhTien: 1 }] });
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

describe("[PB] phân loại theo cơ sở", () => {
  it("[PB-B1] CHƯA chọn cơ sở + khoá 48 ⇒ không thẻ giá phạm vi, không khối kế hoạch, payload không có keHoachDot", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: undefined })} />);
    await chonKhoa("k48");
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    khongCoKeHoachDot();
  });
  it("[PB-B2] cơ sở KHÔNG có trong bảng cờ ⇒ coi là TẮT (không thẻ giá phạm vi)", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1", phamViBatTheoCoSo: { cs2: true } })} />);
    await chonKhoa("k48");
    expect(khoiPhamVi()).toBeNull();
    expect(khoiKeHoach()).toBeNull();
  });
  it("[PB-B3] đối chứng dương: cùng khoá 48, cơ sở có trong bảng cờ và BẬT ⇒ thẻ giá phạm vi CÓ — nên hai ca trên 'không thẻ' không xanh vì form trống", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2", phamViBatTheoCoSo: { cs2: true } })} />);
    await chonKhoa("k48");
    expect(khoiPhamVi()).not.toBeNull();
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
  return { ok: true, kieu: "SCOPE", nguong: NGUONG, dong: [{ soBuoi: so, loaiMua: so === 48 ? "FULL" : "MILESTONE", niemYet: g.niemYet, phanTramApDung: g.pt, thanhTien: g.thanhTien }] };
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


// ═══ [P8] Dấu (i) cho Sale thay cho khối riêng — chủ dự án 15/10/2026 ═══════════════════════════════════════════════════════
//
// "Không cần thêm session như này đâu, chỉ cần làm chữ i thông tin cho sale đọc." Lời giải thích về MUA THEO SỐ BUỔI nằm ở dấu (i) của ô
// "Số buổi mua"; lời giải thích về TỪNG CHƯƠNG TRÌNH GIẢM lấy thẳng từ văn bản BLĐ (ưu đãi + điều kiện) trong dấu (i) của bộ chọn chương
// trình — không gõ số/chữ chính sách vào mã, vì khi chính sách đổi thì lời giải thích sẽ lệch giá.
const CHUONG_TRINH = {
  voucherId: "v-24",
  ma: "HP24",
  maVanBan: "SR.QD.233",
  tenChuongTrinh: "Mua 24 buổi",
  kieu: "PERCENT" as const,
  phanTram: 5,
  soTien: null,
  giamToiDa: null,
  donToiThieu: 0,
  khoaHoc: [] as string[],
  coSo: [] as string[],
  hieuLuc: { validFrom: new Date("2020-01-01T00:00:00.000Z"), validUntil: new Date("2099-12-31T00:00:00.000Z"), revokedAt: null },
  uuDai: "Khách mua 24 buổi được bớt 5% học phí của lần mua đó.",
  dieuKien: "Chỉ áp khi mua đúng 24 buổi, không cộng với ưu đãi khác.",
  dangBat: true,
  conLuot: true,
};
const moHint = async (nhan: RegExp) => {
  const nut = screen.getByText(nhan).closest("label")!.querySelector('button[aria-label="Xem hướng dẫn"]')!;
  await bungHint(nut);
};

describe("[P8] dấu (i) thay khối riêng", () => {
  it("[P8-1] cơ sở BẬT + khoá 48: dấu (i) 'Số buổi mua' nói bằng lời Sale đọc được: một lần, không chia đợt, mốc hợp lệ, giảm giá chọn ở dòng giảm", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await moGiaiThichSoBuoi();
    const hint = await screen.findByText(/không chia nhiều đợt/);
    const chu = hint.closest("[data-slot]")?.textContent ?? hint.parentElement!.textContent ?? "";
    expect(chu).toContain("12 / 24 / 36 / 48"); // mốc lấy từ hằng của luật, không gõ tay
    // Nói THẬT về giảm giá (luật 12): máy chủ từ chối khoản giảm tay / mã khuyến mãi trên dòng phạm vi, nên dấu (i) không hứa chọn chương trình ở đó.
    expect(chu).toMatch(/đã gồm\s+giảm theo chính sách/);
    // [20/10/2026] Mở lại khoản giảm thêm: dấu (i) nói THẬT hệ quả — đó là chính sách thứ 2, đơn chờ Quản lý cơ sở duyệt, tổng giảm không vượt trần.
    expect(chu).toMatch(/chờ Quản lý cơ sở duyệt/);
    expect(chu).toMatch(/không vượt trần của cơ sở/);
    expect(chu).not.toMatch(/chưa cộng thêm được/);
    // Thứ hạng con / gói 48 chỉ tính trong MỘT đơn (NOI-TAO-DON.md mục 9): ⓘ không được để Sale tưởng đơn trước của gia đình đã được tính.
    expect(chu).toMatch(/chỉ tính\s+trong đơn này/);
    expect(chu).toMatch(/đơn mua trước của gia đình chưa được tính/);
    // Cách xếp thứ tự con là của MÁY (cài đặt mặc định), không phải của Sale: ⓘ không được để Sale tưởng mình chọn được.
    expect(chu).toMatch(/do hệ thống xếp theo cài đặt \(mặc định: con có tổng niêm yết\s+thấp hơn là con thứ nhất\)/);
    // Số buổi lẻ: văn bản cho phép khi quản lý duyệt, hệ thống chưa có đường đó — nói thẳng, không im lặng.
    expect(chu).toMatch(/chưa có đường duyệt này/);
    expect(chu).not.toMatch(/Mục 5\.4/); // câu của đơn thường không lẫn vào
  });

  it("[P8-2] ĐỐI CHỨNG: cơ sở TẮT cờ ⇒ dấu (i) 'Số buổi mua' vẫn là câu cũ của đơn thường", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    await moGiaiThichSoBuoi();
    expect(await screen.findByText(/Mục 5\.4/)).toBeTruthy();
    expect(screen.queryByText(/không chia nhiều đợt/)).toBeNull();
  });

  it("[P8-3] bộ chọn chương trình: dấu (i) in ƯU ĐÃI + ĐIỀU KIỆN đúng như văn bản BLĐ ban hành; đổi chữ ở dữ liệu thì đổi chữ ở dấu (i)", async () => {
    render(
      <OrderCreateForm
        {...props({
          defaultCenterId: "cs1",
          maKhuyenMai: [CHUONG_TRINH],
          maCoSoTheoCenter: { cs1: "CS1", cs2: "CS2" },
        })}
      />,
    );
    await chonKhoa("k48");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Thêm khoản giảm/ }));
    });
    await moHint(/Chương trình khuyến mãi/);
    const khung = await screen.findByTestId("mo-ta-chuong-trinh");
    expect(khung.textContent).toContain("Mua 24 buổi");
    expect(khung.textContent).toContain("SR.QD.233");
    expect(khung.textContent).toContain(CHUONG_TRINH.uuDai);
    expect(khung.textContent).toContain(CHUONG_TRINH.dieuKien);
  });

  it("[P8-4] đã CHỌN một chương trình: dấu (i) cạnh tên chương trình in ưu đãi + điều kiện của ĐÚNG chương trình đó", async () => {
    const khac = { ...CHUONG_TRINH, voucherId: "v-36", ma: "HP36", tenChuongTrinh: "Mua 36 buổi", uuDai: "Bớt 10% cho lần mua 36 buổi.", dieuKien: "Chỉ áp khi mua đúng 36 buổi." };
    render(
      <OrderCreateForm
        {...props({ defaultCenterId: "cs1", maKhuyenMai: [CHUONG_TRINH, khac], maCoSoTheoCenter: { cs1: "CS1", cs2: "CS2" } })}
      />,
    );
    await chonKhoa("k48");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Thêm khoản giảm/ }));
    });
    const chon = screen.getAllByRole("combobox").find((el) => el.tagName === "SELECT") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(chon, { target: { value: "v-36" } });
    });
    const dong = await screen.findByText(/hiệu lực đến/);
    await bungHint(dong.querySelector('button[aria-label="Xem hướng dẫn"]')!);
    const noi = document.body.textContent ?? "";
    expect(noi).toContain("Bớt 10% cho lần mua 36 buổi.");
    expect(noi).toContain("Chỉ áp khi mua đúng 36 buổi.");
    expect(noi).not.toContain("Chỉ áp khi mua đúng 24 buổi"); // không lẫn lời của chương trình khác
  });
});


// ═══ [GT] KHOẢN GIẢM THÊM TRÊN DÒNG THEO PHẠM VI HỌC — chủ dự án mở lại 20/10/2026 ═════════════════════════════════════════════════════
//
// "phải để linh hoạt, tuỳ chính được chương trình giảm giá chứ… vẫn mở ra, nhưng sẽ chuyển phần này cho quản lý duyệt nếu thêm chính sách giảm
// thứ 2" + "trần mức giảm thì để max 25% mà cho qlcs tự chỉnh cho từng cơ sở được".
//
// Fixture: dòng 48 buổi niêm yết 10.560.000, chính sách 15% ⇒ 8.976.000 (giảm 1.584.000). Trần 25% của niêm yết = 2.640.000 ⇒ khoản thêm tối đa 1.056.000.
// Mọi ca "KHÔNG thấy cảnh báo" đi kèm đối chứng dương (luật 11): cùng khoản, cơ sở/trần khác thì cảnh báo CÓ.
const oGiam = (stt: number, khoan: number) =>
  (document.querySelector(`input[name="giamGia-${stt}-${khoan}"]`) as HTMLInputElement).parentElement!.querySelector(
    'input:not([type="hidden"])',
  ) as HTMLInputElement;
const themKhoanTay = async (soTien: string, lyDo = "Khách quen, quản lý đã đồng ý") => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Thêm khoản giảm/ }));
  });
  await act(async () => {
    fireEvent.change(oGiam(1, 1), { target: { value: soTien } });
  });
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(/VD: em ruột/), { target: { value: lyDo } });
  });
};
const chuoiTran = () => screen.queryByTestId("pham-vi-vuot-tran");
const chuoiDuyet = () => screen.queryByTestId("pham-vi-cho-duyet");
/** Máy chủ giả trả ngưỡng THEO CƠ SỞ (cs1 trần `tranCs1`, cs2 trần `tranCs2`); giá fixture như `BANG_GIA[48]`. */
const mayChuTheoCoSo = (tranCs1: number, tranCs2: number, tranUuDai = 1) => async (x: { centerId: string | null; items: unknown[] }) => ({
  ok: true,
  kieu: "SCOPE",
  nguong: { ...NGUONG, tranUuDaiMoiDong: tranUuDai, tranGiamPhamVi: x.centerId === "cs1" ? tranCs1 : tranCs2 },
  dong: x.items.map(() => ({ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, phanTramApDung: 15, thanhTien: GIA_MAY_CHU })),
});

describe("[GT] khoản giảm thêm: báo trước CHỜ DUYỆT và VƯỢT TRẦN bằng cùng hàm với máy chủ", () => {
  it("[GT-01] 1 khoản thêm trong trần ⇒ đơn VẪN gửi được, đơn giá dòng vẫn là giá hệ thống tính, khoản nằm ở discounts; form báo trước 'chờ duyệt' đúng câu; tổng % + số điểm còn lại tới trần", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    expect(chuoiDuyet()).toBeNull(); // chưa có khoản thêm ⇒ KHÔNG chờ duyệt (chính sách thứ nhất là giá hệ thống tính)
    await themKhoanTay("100000");
    const duyet = await screen.findByTestId("pham-vi-cho-duyet");
    expect(duyet.textContent).toContain("áp thêm chương trình giảm ngoài chính sách phạm vi học");
    expect(duyet.textContent).toContain("Đơn này sẽ cần quản lý cơ sở duyệt trước khi xuất mã QR");
    expect(chuoiTran()).toBeNull();
    const ghi = screen.getByTestId("giam-them-pham-vi").textContent ?? "";
    expect(ghi).toContain("15,95%"); // (1.584.000 chính sách + 100.000) ÷ 10.560.000 niêm yết
    expect(ghi).toContain("chính sách 15%");
    expect(ghi).toContain("trần của cơ sở 25%");
    expect(ghi).toContain("còn 9,05 điểm");
    expect(screen.queryByTestId("giam-gia-pham-vi-ghi-chu")).toBeNull(); // có khoản rồi thì dòng giải thích 'chờ duyệt' nhường chỗ cho số %
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    const it0 = (h.tao.mock.calls[0]![0] as { items: Array<{ unitPrice: number; discounts: Array<{ giaTri: number; lyDo: string }> }> }).items[0]!;
    expect(it0.unitPrice).toBe(GIA_MAY_CHU); // KHÔNG trừ khoản thêm vào đơn giá: đơn giá là giá chính sách, khoản thêm nằm riêng
    expect(it0.discounts).toHaveLength(1);
    expect(it0.discounts[0]).toMatchObject({ giaTri: 100_000, lyDo: "Khách quen, quản lý đã đồng ý" });
  });

  it("[GT-02] khoản thêm làm TỔNG vượt trần 25% ⇒ khối đỏ nói bằng số; Lưu bị chặn ở form (không gọi máy chủ) với đúng câu của máy chủ; ĐỐI CHỨNG: bớt về trong trần thì gửi được", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    await themKhoanTay("1100000"); // 1.584.000 + 1.100.000 = 2.684.000 = 25,42% niêm yết
    const loi = await screen.findByTestId("pham-vi-vuot-tran");
    expect(loi.textContent).toContain("tổng giảm 25,42% giá niêm yết (chính sách 15% + thêm 10,42%), vượt trần 25% của cơ sở này");
    expect(loi.textContent).toContain("Cấu hình vận hành");
    expect(screen.getByTestId("giam-them-pham-vi").getAttribute("role")).toBe("alert");
    await gui();
    expect(h.tao).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("vượt trần 25% của cơ sở này"), expect.anything());
    // đối chứng dương: hạ khoản xuống còn 100.000đ ⇒ hết cảnh báo đỏ, gửi được
    await act(async () => {
      fireEvent.change(oGiam(1, 1), { target: { value: "100000" } });
    });
    expect(chuoiTran()).toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
  });

  it("[GT-03] BIÊN: đúng 25,00% (khoản thêm 1.056.000) QUA; 25,01% (1.056.001) bị từ chối — không làm tròn xuống", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    await themKhoanTay("1056000");
    expect(screen.getByTestId("giam-them-pham-vi").textContent).toContain("25%");
    expect(chuoiTran()).toBeNull();
    await act(async () => {
      fireEvent.change(oGiam(1, 1), { target: { value: "1056001" } });
    });
    const loi = await screen.findByTestId("pham-vi-vuot-tran");
    expect(loi.textContent).toContain("25,01%");
  });

  it("[GT-04] TRẦN THEO CƠ SỞ: cùng khoản 600.000đ — cơ sở trần 25% qua, cơ sở trần 20% vượt; đổi cơ sở thì kết luận đổi theo (ngưỡng đọc theo orgUnitId, không số chung)", async () => {
    h.xemTruoc.mockImplementation(mayChuTheoCoSo(20, 25));
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2", phamViBatTheoCoSo: { cs1: true, cs2: true } })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    await themKhoanTay("600000"); // (1.584.000 + 600.000) ÷ 10.560.000 = 20,68%
    expect(chuoiTran()).toBeNull(); // cs2: trần 25%
    expect(screen.getByTestId("giam-them-pham-vi").textContent).toContain("trần của cơ sở 25%");
    await chonCoSo("cs1");
    const loi = await screen.findByTestId("pham-vi-vuot-tran"); // cs1: trần 20%
    expect(loi.textContent).toContain("vượt trần 20% của cơ sở này");
    expect(screen.getByTestId("giam-them-pham-vi").textContent).toContain("trần của cơ sở 20%");
  });

  it("[GT-05] TRẦN THẤP HƠN CHÍNH SÁCH (10% < 15%): chính sách VẪN áp — không khoản thêm thì Lưu bình thường; thêm bất kỳ khoản nào thì bị chặn và câu nói rõ lý do", async () => {
    h.xemTruoc.mockImplementation(mayChuTheoCoSo(10, 10));
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    expect(chuoiTran()).toBeNull(); // không khoản thêm ⇒ KHÔNG vượt dù chính sách 15% > trần 10%
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect(payload().items[0]!.unitPrice).toBe(GIA_MAY_CHU); // chính sách hệ thống vẫn áp
    h.tao.mockClear();
    await themKhoanTay("1000");
    const loi = await screen.findByTestId("pham-vi-vuot-tran");
    expect(loi.textContent).toContain("Trần thấp hơn mức chính sách phạm vi học: chính sách vẫn áp, nhưng không cộng thêm được khoản giảm nào");
    await gui();
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("[GT-06] DÒNG GIẢM 0% theo chính sách (mốc 12 buổi) + đúng 1 khoản thêm ⇒ dòng chính sách vẫn là ưu đãi THỨ NHẤT ⇒ CHỜ DUYỆT, câu «ngoài chính sách» (chủ dự án chốt 20/10 vòng 2); không vượt trần", async () => {
    h.xemTruoc.mockImplementation(async (x: { items: unknown[] }) => ({
      ok: true,
      kieu: "SCOPE",
      nguong: NGUONG,
      dong: x.items.map(() => ({ soBuoi: 12, loaiMua: "MILESTONE", niemYet: 3_000_000, phanTramApDung: 0, thanhTien: 3_000_000 })),
    }));
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await waitFor(() => expect(oDonGia(1).readOnly).toBe(true));
    await themKhoanTay("100000");
    const duyet = await screen.findByTestId("pham-vi-cho-duyet");
    expect(duyet.textContent).toContain("ngoài chính sách phạm vi học");
    expect(chuoiTran()).toBeNull();
  });
});

describe("[GT2] DÒNG CHÍNH SÁCH DỰNG SẴN trong khối 'Giảm giá dòng này' [chủ dự án 20/10/2026]", () => {
  const dongCS = () => screen.queryByTestId("dong-chinh-sach-pham-vi");
  const canDuyetNhan = () => screen.queryByTestId("khoan-them-can-duyet");

  it("[GT2-01] dòng SCOPE TỰ CÓ dòng 'Chính sách nộp theo học phần': số buổi mốc, niêm yết, %, số tiền giảm do máy chủ tính; KHÔNG có nút sửa/xoá; khối KHÔNG còn câu 'Chưa có khoản giảm nào' hay cảnh báo trống", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    const hang = await screen.findByTestId("dong-chinh-sach-pham-vi");
    expect(hang.textContent).toContain("Chính sách nộp theo học phần");
    expect(hang.textContent).toContain("−1.584.000đ"); // 10.560.000 − 8.976.000 (máy chủ tính)
    expect(hang.textContent).toContain("48 buổi");
    expect(hang.textContent).toContain("niêm yết 10.560.000đ");
    expect(hang.textContent).toContain("giảm 15%");
    expect(hang.textContent).toContain("Hệ thống tính theo số buổi và ngày tiền về");
    expect(within(hang).queryByRole("button")).toBeNull(); // khoá: không xoá, không sửa
    expect(within(hang).queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Chưa có khoản giảm nào/)).toBeNull();
    expect(screen.queryByText(/Không có chương trình nào áp dụng được/)).toBeNull();
    // Dòng chính sách KHÔNG phải một khoản của dòng: không sinh ô giảm nào, payload không có discounts.
    expect(document.querySelector('input[name="giamGia-1-1"]')).toBeNull();
    await gui();
    await waitFor(() => expect(h.tao).toHaveBeenCalledTimes(1));
    expect((h.tao.mock.calls[0]![0] as { items: Array<{ discounts: unknown[] }> }).items[0]!.discounts).toEqual([]);
  });

  it("[GT2-02] con thứ hai: dòng chính sách nói ĐÚNG % đã gồm (nền + anh/chị/em) — số của máy chủ, không tính lại", async () => {
    h.xemTruoc.mockImplementation(async (x: { items: unknown[] }) => ({
      ok: true,
      kieu: "SCOPE",
      nguong: NGUONG,
      dong: x.items.map(() => ({ soBuoi: 48, loaiMua: "FULL", niemYet: 11_520_000, phanTramApDung: 25, phanTramNen: 15, phanTramCongThem: 10, thuTuCon: 2, thanhTien: 8_640_000 })),
    }));
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    const hang = await screen.findByTestId("dong-chinh-sach-pham-vi");
    expect(hang.textContent).toContain("giảm 25%");
    expect(hang.textContent).toContain("đã gồm 15% theo số buổi + 10% anh/chị/em, con thứ 2 trong đơn");
    expect(hang.textContent).toContain("−2.880.000đ");
  });

  it("[GT2-03] % chính sách = 0 (mốc 12 buổi / chưa có chính sách hiệu lực): dòng VẪN hiện, nói thật '0%, chưa có chính sách áp dụng' — không để khối trống", async () => {
    h.xemTruoc.mockImplementation(async (x: { items: unknown[] }) => ({
      ok: true,
      kieu: "SCOPE",
      nguong: NGUONG,
      dong: x.items.map(() => ({ soBuoi: 12, loaiMua: "MILESTONE", niemYet: 2_640_000, phanTramApDung: 0, phanTramNen: 0, phanTramCongThem: 0, thuTuCon: 1, thanhTien: 2_640_000 })),
    }));
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    const hang = await screen.findByTestId("dong-chinh-sach-pham-vi");
    expect(hang.textContent).toContain("0%, chưa có chính sách áp dụng");
    expect(hang.textContent).toContain("0đ");
    expect(screen.queryByText(/Không có chương trình nào áp dụng được/)).toBeNull();
  });

  it("[GT2-04] ĐẾM — CHỈ chính sách: KHÔNG báo duyệt (cả dòng lẫn đơn); CHÍNH SÁCH + 1 khoản thêm: báo 'cần quản lý duyệt' NGAY dưới khối và ở khối đơn; ĐỐI CHỨNG không-SCOPE: không có dòng chính sách", async () => {
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await screen.findByTestId("dong-chinh-sach-pham-vi");
    expect(canDuyetNhan()).toBeNull();
    expect(screen.queryByTestId("pham-vi-cho-duyet")).toBeNull();
    await themKhoanTay("100000");
    const nhan = await screen.findByTestId("khoan-them-can-duyet");
    expect(nhan.textContent).toContain("Khoản giảm này cần quản lý duyệt trước khi xuất QR");
    expect(await screen.findByTestId("pham-vi-cho-duyet")).toBeTruthy();
    // Nhãn của khoản Sale thêm nói rõ nó nằm NGOÀI chính sách (dòng chính sách là dòng đầu).
    expect(screen.getByText(/Khoản thêm 1 \(ngoài chính sách\)/)).toBeTruthy();
    cleanup();
    // Đối chứng: cùng khoá 48 ở cơ sở TẮT cờ ⇒ đơn thường ⇒ không có dòng chính sách, nhãn cũ 'Khoản 1'.
    render(<OrderCreateForm {...props({ defaultCenterId: "cs1" })} />);
    await chonKhoa("k48");
    expect(dongCS()).toBeNull();
    expect(screen.getByText(/Chưa có khoản giảm nào/)).toBeTruthy();
  });

  it("[GT2-05] % chính sách = 0 + 1 khoản tay ⇒ VẪN báo duyệt (dòng chính sách luôn là ưu đãi thứ nhất — chủ dự án chốt 20/10 vòng 2)", async () => {
    h.xemTruoc.mockImplementation(async (x: { items: unknown[] }) => ({
      ok: true,
      kieu: "SCOPE",
      nguong: NGUONG, // tranUuDaiMoiDong = 1
      dong: x.items.map(() => ({ soBuoi: 12, loaiMua: "MILESTONE", niemYet: 2_640_000, phanTramApDung: 0, phanTramNen: 0, phanTramCongThem: 0, thuTuCon: 1, thanhTien: 2_640_000 })),
    }));
    render(<OrderCreateForm {...props({ defaultCenterId: "cs2" })} />);
    await chonKhoa("k48");
    await screen.findByTestId("dong-chinh-sach-pham-vi");
    await themKhoanTay("50000");
    expect(await screen.findByTestId("khoan-them-can-duyet")).toBeTruthy();
    expect(await screen.findByTestId("pham-vi-cho-duyet")).toBeTruthy();
  });
});
