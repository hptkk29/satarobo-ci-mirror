// @vitest-environment jsdom
/**
 * Ca [HN3-RK1..RK15] — khu "Sale báo nhập sai mã trên máy POS" của KẾ TOÁN ở `/bien-dong-so-du` (docs/pos-hai-nut-khai-may.md §5.3.9; RK13–RK15 = lượt hoàn thiện giao diện, §5.10):
 * `KhuSaiMaPos` (hai bảng) · `NutXuLySaiMa` (Duyệt / Từ chối) · chip ở `BankTxnClient`. Dựng THẬT, bấm nút thật.
 *
 * Luật 12 (affordance nói thật): nút chỉ hiện với yêu cầu mà máy chủ SẼ cho xử lý · người gửi không bấm được Duyệt/Từ chối yêu cầu của
 * chính mình (nút vô hiệu + 'Cần người khác duyệt') · đơn ngoài tầm nhìn không mã/link/nút · ghi chú trên máy là text node.
 * Đồng hồ ĐÓNG BĂNG (luật 19).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  duyetSaiMaAction: vi.fn(),
  tuChoiSaiMaAction: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../_pos-sai-ma-actions", () => ({ duyetSaiMaAction: h.duyetSaiMaAction, tuChoiSaiMaAction: h.tuChoiSaiMaAction }));
// Hai nút xử lý giao dịch có sẵn kéo action thật (auth/DB) — không thuộc ca này.
vi.mock("./xu-ly-giao-dich", () => ({ XuLyGiaoDich: () => null }));
vi.mock("./go-gan-giao-dich", () => ({ GoGanGiaoDich: () => null }));

import type { DongSaiMa, HangChoSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { KhuSaiMaPos } from "./khu-sai-ma-pos";
import { BankTxnClient, type BankTxnItem } from "./bank-txn-client";

const NOW = new Date("2026-10-09T05:00:00Z");

let dem = 0;
function dong(p: Partial<DongSaiMa> = {}): DongSaiMa {
  dem += 1;
  return {
    id: `y${dem}`,
    hieuLuc: "CHO_DUYET",
    kieu: "CHO_KE_TOAN",
    trangThai: "CHO_DUYET",
    guiLuc: new Date(NOW.getTime() - 10 * 60_000),
    nguoiGuiId: "sale1",
    nguoiGui: "Sale Một",
    orderId: "o1",
    maDon: "ORD-269979-000301",
    maPhieu: "K7M2N",
    tenMay: "QTT45XWQT",
    bankTransactionId: `bt${dem}`,
    gioQuet: new Date(NOW.getTime() - 30 * 60_000),
    soTien: 3_168_000,
    soTheCuoi: "1234",
    ghiChu: "K7M2X",
    lyDo: ["NHIEU_UNG_VIEN"],
    lyDoTuChoi: null,
    nguoiQuyet: null,
    quyetLuc: null,
    ...p,
  };
}
const hang = (p: Partial<HangChoSaiMa> = {}): HangChoSaiMa => ({ cho: [], hauKiem: [], theoGiaoDich: {}, soCanXuLy: 0, ...p });

beforeEach(() => {
  vi.clearAllMocks();
  // Luật 18 (mỗi ca XANH khi chạy một mình, và một ca ĐỎ không được làm đỏ lây ca sau): hộp thoại base-ui vẫn nằm trong <body> sau một ca
  // đỏ giữa chừng (lời hứa còn treo), làm `findByRole("dialog")` của ca sau đọc nhầm hộp cũ — đo ở phép cấy U11 (RK14 đỏ lây từ RK9e).
  // RTL đã gỡ cây React ở afterEach, nên dọn <body> ở đây là an toàn.
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  h.duyetSaiMaAction.mockResolvedValue({ ok: true, trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận giao dịch 3.168.000đ vào đơn ORD-269979-000301." });
  h.tuChoiSaiMaAction.mockResolvedValue({ ok: true, trangThai: "TU_CHOI", thongDiep: "Đã từ chối. Giao dịch vẫn nằm trong hàng chờ để gắn tay." });
});

const hangChua = (container: HTMLElement) => container.querySelector("#the-pos-sai-ma");

describe("[HN3-RK] khối chỉ có khi có việc để làm hoặc để nhìn lại", () => {
  it("[HN3-RK1] không yêu cầu nào (cả hai danh sách rỗng) ⇒ KHÔNG vẽ gì — không tiêu đề rỗng trong khu thẻ POS", () => {
    const { container } = render(<KhuSaiMaPos hang={hang()} nguoiXemId="kt1" />);
    expect(container.innerHTML).toBe("");
  });

  it("[HN3-RK2] chỉ có hậu kiểm ⇒ vẫn vẽ khối, bảng việc cần làm nói 'Không có yêu cầu nào đang chờ kế toán'", () => {
    const { container } = render(<KhuSaiMaPos hang={hang({ hauKiem: [dong({ hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN", kieu: "TU_GHI_NHAN" })] })} nguoiXemId="kt1" />);
    expect(hangChua(container)).toBeTruthy();
    expect(screen.getByText("Không có yêu cầu nào đang chờ kế toán.")).toBeTruthy();
    expect(screen.getByText("Đã xử lý 7 ngày qua")).toBeTruthy();
  });
});

describe("[HN3-RK] bảng VIỆC CẦN LÀM: nút chỉ hiện với yêu cầu mà máy chủ sẽ cho xử lý", () => {
  it("[HN3-RK3] CHỜ DUYỆT ⇒ chip + 'Duyệt' + 'Từ chối'; ĐANG GHI ⇒ chip, KHÔNG nút; KẸT ⇒ 'Thử lại ghi nhận', KHÔNG 'Từ chối'", () => {
    const cd = dong();
    const dg = dong({ hieuLuc: "DANG_GHI", trangThai: "DANG_GHI", kieu: "TU_GHI_NHAN", lyDo: [] });
    const ket = dong({ hieuLuc: "KET", trangThai: "DANG_GHI", kieu: "TU_GHI_NHAN", lyDo: [] });
    const { container } = render(<KhuSaiMaPos hang={hang({ cho: [cd, dg, ket] })} nguoiXemId="kt1" />);
    const dongCua = (d: DongSaiMa) => container.querySelectorAll("tbody tr")[[cd, dg, ket].indexOf(d)] as HTMLElement;

    const rCd = dongCua(cd);
    expect(within(rCd).getByText("Chờ duyệt")).toBeTruthy();
    expect(within(rCd).getByRole("button", { name: "Duyệt" })).toBeTruthy();
    expect(within(rCd).getByRole("button", { name: "Từ chối" })).toBeTruthy();

    const rDg = dongCua(dg);
    expect(within(rDg).getByText("Đang ghi")).toBeTruthy();
    expect(within(rDg).queryByRole("button"), "đang ghi tiền: không Duyệt, không Từ chối").toBeNull();

    const rKet = dongCua(ket);
    expect(within(rKet).getByText("Kẹt — thử lại")).toBeTruthy();
    expect(within(rKet).getByRole("button", { name: "Thử lại ghi nhận" })).toBeTruthy();
    expect(within(rKet).queryByRole("button", { name: "Từ chối" }), "không từ chối được yêu cầu đang ghi tiền").toBeNull();
    expect(within(rKet).queryByRole("button", { name: "Duyệt" })).toBeNull();
  });

  it("[HN3-RK4] mỗi dòng đủ cột: người gửi · đơn (link) + mã phiếu · giờ quẹt + số tiền + 4 số cuối + máy · ghi chú · lý do", () => {
    const { container } = render(<KhuSaiMaPos hang={hang({ cho: [dong()] })} nguoiXemId="kt1" />);
    const r = container.querySelector("tbody tr") as HTMLElement;
    expect(within(r).getByText("Sale Một")).toBeTruthy();
    const link = within(r).getByRole("link", { name: "ORD-269979-000301" });
    expect(link.getAttribute("href")).toBe("/orders/o1");
    expect(r.textContent).toContain("K7M2N");
    expect(r.textContent).toContain("3.168.000đ");
    expect(r.textContent).toContain("thẻ …1234");
    expect(r.textContent).toContain("máy QTT45XWQT");
    expect(within(r).getByText("K7M2X")).toBeTruthy();
    // Cột lý do dùng NHÃN NGẮN cho bảng (câu đầy đủ là của sale): hàng cao 5–6 dòng chữ ở smoke 1280px/375px khi dùng câu đầy đủ.
    expect(within(r).getByText("Nhiều giao dịch cùng số tiền trên máy")).toBeTruthy();
    expect(r.textContent, "không dùng câu dài của sale").not.toContain("cần kế toán chọn đúng giao dịch của khách");
    // Tiêu đề cột đủ.
    for (const c of ["Gửi lúc · Người gửi", "Đơn · Phiếu thẻ", "Giao dịch", "Ghi chú trên máy", "Vì sao cần kế toán", "Xử lý"]) {
      expect(screen.getByText(c), c).toBeTruthy();
    }
  });

  it("[HN3-RK5] ĐƠN NGOÀI TẦM NHÌN (loader đã che) ⇒ không link, không nút; vẫn thấy có việc", () => {
    const { container } = render(
      <KhuSaiMaPos
        hang={hang({ cho: [dong({ orderId: null, maDon: "Đơn ở cơ sở khác", maPhieu: "—", tenMay: null, gioQuet: null, soTheCuoi: null, ghiChu: "" })] })}
        nguoiXemId="kt1"
      />,
    );
    const r = container.querySelector("tbody tr") as HTMLElement;
    expect(within(r).getByText("Đơn ở cơ sở khác")).toBeTruthy();
    expect(within(r).queryByRole("link")).toBeNull();
    expect(within(r).queryByRole("button"), "không nút trên đơn không xem được").toBeNull();
    expect(within(r).getByText("(để trống)")).toBeTruthy();
  });

  it("[HN3-RK6] ghi chú là CHỮ NGƯỜI GÕ ⇒ render bằng text node: thẻ HTML nằm trong ghi chú hiện NGUYÊN VĂN, không thành phần tử", () => {
    const doc = '<img src=x onerror="alert(1)"><b>đậm</b>';
    const { container } = render(<KhuSaiMaPos hang={hang({ cho: [dong({ ghiChu: doc })] })} nguoiXemId="kt1" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("tbody b")).toBeNull();
    expect(within(container.querySelector("tbody tr") as HTMLElement).getByText(doc)).toBeTruthy();
  });
});

describe("[HN3-RK12] cột 'Xử lý' DÍNH MÉP PHẢI — nút không được nằm sau thanh cuộn ngang", () => {
  it("tiêu đề và ô 'Xử lý' của bảng việc cần làm đều `sticky right-0` và có nền ĐỤC; các cột khác thì không dính", () => {
    const { container } = render(<KhuSaiMaPos hang={hang({ cho: [dong()] })} nguoiXemId="kt1" />);
    const bang = container.querySelector("table") as HTMLTableElement;
    const ths = [...bang.querySelectorAll("thead th")] as HTMLElement[];
    expect(ths.map((t) => t.textContent)).toEqual(["Gửi lúc · Người gửi", "Đơn · Phiếu thẻ", "Giao dịch", "Ghi chú trên máy", "Vì sao cần kế toán", "Xử lý"]);
    const dinh = (e: Element) => e.classList.contains("sticky") && e.classList.contains("right-0");
    expect(ths.filter(dinh).map((t) => t.textContent), "chỉ cột Xử lý dính").toEqual(["Xử lý"]);
    expect(ths[5]!.classList.contains("bg-muted"), "tiêu đề dính có nền đục").toBe(true);
    const tds = [...bang.querySelectorAll("tbody tr:first-child td")] as HTMLElement[];
    expect(tds).toHaveLength(6);
    expect(tds.filter(dinh).map((t) => tds.indexOf(t))).toEqual([5]);
    expect(tds[5]!.className, "ô dính phủ lớp màu dòng lên nền đục").toMatch(/bg-muted .*background-image/);
    expect(within(tds[5]!).getByRole("button", { name: "Duyệt" })).toBeTruthy();
  });

  it("bảng hậu kiểm (chỉ đọc, không có nút) KHÔNG có cột dính", () => {
    const { container } = render(<KhuSaiMaPos hang={hang({ hauKiem: [dong({ hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN" })] })} nguoiXemId="kt1" />);
    expect(container.querySelectorAll("table .sticky")).toHaveLength(0);
  });
});

describe("[HN3-RK] người gửi KHÔNG tự duyệt / từ chối yêu cầu của mình", () => {
  it("[HN3-RK7] người xem = người gửi ⇒ cả hai nút VÔ HIỆU + 'Cần người khác duyệt'; ĐỐI CHỨNG: người khác thì bấm được", () => {
    const yc = dong({ nguoiGuiId: "ketoan-a" });
    const { unmount } = render(<KhuSaiMaPos hang={hang({ cho: [yc] })} nguoiXemId="ketoan-a" />);
    for (const ten of ["Duyệt", "Từ chối"]) {
      const nut = screen.getByRole("button", { name: ten }) as HTMLButtonElement;
      expect(nut.disabled, `${ten} bị khoá với chính người gửi`).toBe(true);
      expect(nut.getAttribute("title")).toBe("Cần người khác duyệt");
    }
    // Luật 12: lý do khoá phải NHÌN THẤY được bằng chữ (cảm ứng/bàn phím không có tooltip `title`).
    expect(screen.getByText("Cần người khác duyệt"), "chữ nhìn thấy, không chỉ title").toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    expect(h.duyetSaiMaAction, "bấm nút khoá không gọi action").not.toHaveBeenCalled();
    unmount();

    render(<KhuSaiMaPos hang={hang({ cho: [yc] })} nguoiXemId="ketoan-b" />);
    for (const ten of ["Duyệt", "Từ chối"]) {
      const nut = screen.getByRole("button", { name: ten }) as HTMLButtonElement;
      expect(nut.disabled, `${ten} mở với người khác`).toBe(false);
      expect(nut.getAttribute("title")).toBeNull();
    }
    expect(screen.queryByText("Cần người khác duyệt"), "người khác ⇒ không dòng chữ khoá").toBeNull();
  });
});

describe("[HN3-RK] hành động Duyệt / Từ chối", () => {
  it("[HN3-RK8] Duyệt = MỘT bấm, không hộp xác nhận: gọi action đúng {orderId, yeuCauId}; thành công ⇒ toast.success + làm mới", async () => {
    const yc = dong({ id: "yc-1", orderId: "o7" });
    render(<KhuSaiMaPos hang={hang({ cho: [yc] })} nguoiXemId="kt1" />);
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(h.duyetSaiMaAction).toHaveBeenCalledTimes(1));
    expect(h.duyetSaiMaAction).toHaveBeenCalledWith({ orderId: "o7", yeuCauId: "yc-1" });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Đã ghi nhận giao dịch 3.168.000đ vào đơn ORD-269979-000301."));
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog"), "không hộp xác nhận").toBeNull();
  });

  it("[HN3-RK8b] Duyệt bị máy chủ từ chối ⇒ toast.error đúng câu + VẪN làm mới (trạng thái có thể đã đổi)", async () => {
    h.duyetSaiMaAction.mockResolvedValue({ ok: false, error: "Yêu cầu đã được xử lý" });
    render(<KhuSaiMaPos hang={hang({ cho: [dong()] })} nguoiXemId="kt1" />);
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Yêu cầu đã được xử lý"));
    expect(h.refresh).toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
  });

  it("[HN3-RK9] Từ chối: mở HỘP THOẠI nhập lý do (không ô trong bảng); nút xác nhận khoá tới khi ≥ 5 ký tự (sau khi cắt khoảng trắng); 'Đóng' không gọi gì", async () => {
    const yc = dong({ id: "yc-2", orderId: "o8" });
    render(<KhuSaiMaPos hang={hang({ cho: [yc] })} nguoiXemId="kt1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));

    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByText("Từ chối giao dịch sale đã chọn")).toBeTruthy();
    expect(within(hop).getByText(/Sale sẽ thấy lý do dưới đây và lệnh ĐỪNG cho khách quẹt lại/)).toBeTruthy();
    // Hộp thoại phủ lên bảng ⇒ nó phải tự nói ĐANG từ chối dòng nào (từ chối nhầm dòng = trả nhầm giao dịch về hàng chờ).
    expect(within(hop).getByText("ORD-269979-000301 · 3.168.000đ · thẻ …1234")).toBeTruthy();
    const o = within(hop).getByLabelText(/Lý do từ chối/) as HTMLTextAreaElement;
    const xacNhan = within(hop).getByRole("button", { name: "Xác nhận từ chối" }) as HTMLButtonElement;
    expect(xacNhan.disabled, "chưa gõ gì").toBe(true);
    fireEvent.change(o, { target: { value: "  ab  " } });
    expect(xacNhan.disabled, "dưới 5 ký tự sau khi cắt").toBe(true);
    expect(within(hop).getByText("Ít nhất 5 ký tự.")).toBeTruthy();
    fireEvent.change(o, { target: { value: "  abcde  " } });
    expect(xacNhan.disabled, "đủ 5 ký tự").toBe(false);

    // 'Đóng' bỏ hộp thoại, không gọi action, và nút Duyệt/Từ chối của dòng vẫn còn.
    fireEvent.click(within(hop).getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.tuChoiSaiMaAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    const hop2 = await screen.findByRole("dialog");
    expect((within(hop2).getByLabelText(/Lý do từ chối/) as HTMLTextAreaElement).value, "mở lại hộp: ô lý do sạch").toBe("");
    fireEvent.change(within(hop2).getByLabelText(/Lý do từ chối/), { target: { value: "Giao dịch của khách khác" } });
    fireEvent.click(within(hop2).getByRole("button", { name: "Xác nhận từ chối" }));
    await waitFor(() => expect(h.tuChoiSaiMaAction).toHaveBeenCalledTimes(1));
    expect(h.tuChoiSaiMaAction).toHaveBeenCalledWith({ orderId: "o8", yeuCauId: "yc-2", lyDo: "Giao dịch của khách khác" });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Đã từ chối. Giao dịch vẫn nằm trong hàng chờ để gắn tay."));
    expect(h.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("[HN3-RK9c] Từ chối bị máy chủ từ chối ⇒ toast.error đúng câu, hộp thoại GIỮ NGUYÊN lý do đã gõ, và vẫn làm mới", async () => {
    h.tuChoiSaiMaAction.mockResolvedValue({ ok: false, error: "Yêu cầu đã được xử lý" });
    render(<KhuSaiMaPos hang={hang({ cho: [dong({ orderId: "o8" })] })} nguoiXemId="kt1" />);
    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Lý do từ chối/), { target: { value: "Không đúng giao dịch" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Xác nhận từ chối" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Yêu cầu đã được xử lý"));
    expect(h.refresh).toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
    expect((within(screen.getByRole("dialog")).getByLabelText(/Lý do từ chối/) as HTMLTextAreaElement).value).toBe("Không đúng giao dịch");
  });

  it("[HN3-RK9d] yêu cầu KẸT (thử lại): KHÔNG có nút Từ chối và KHÔNG dựng hộp thoại từ chối nào", () => {
    render(<KhuSaiMaPos hang={hang({ cho: [dong({ hieuLuc: "KET", trangThai: "DANG_GHI", kieu: "TU_GHI_NHAN", lyDo: [] })] })} nguoiXemId="kt1" />);
    expect(screen.queryByRole("button", { name: "Từ chối" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Thử lại ghi nhận" })).toBeTruthy();
  });

  it("[HN3-RK9b] chữ trên nút KHÔNG nhắc huỷ giao dịch trên máy", () => {
    const { container } = render(<KhuSaiMaPos hang={hang({ cho: [dong()] })} nguoiXemId="kt1" />);
    expect(container.textContent).not.toMatch(/h[uủ]y|huỷ|hủy/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LƯỢT HOÀN THIỆN GIAO DIỆN (U · 09/10/2026) — ĐỎ trước khi vá: [HN3-RK13] (lớp hiển thị chưa tự làm sạch ghi chú), [HN3-RK14] (rớt kết nối),
// [HN3-RK15] (kẹp lý do), phần thêm của [HN3-RK7] [HN3-RK9]. [HN3-RK8c] [HN3-RK9e] viết SAU mã (hành vi `useTransition` đã đúng) — bằng
// chứng "cắn" ở bảng cấy lỗi §5.10(f).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("[HN3-RK13] ghi chú trên máy ở BẢNG KẾ TOÁN cũng là chữ người gõ: cắt độ dài + bỏ ký tự điều hướng ngay ở lớp hiển thị", () => {
  const cotGhiChu = (c: HTMLElement) => c.querySelector("tbody tr td:nth-child(4)") as HTMLElement;

  it("ghi chú 300+ ký tự có U+202E / U+2066 / zero-width và thẻ HTML ⇒ không phần tử, không ký tự điều hướng, ≤ 120 + '…' (chữ lẫn `title`)", () => {
    const doc = `<img src=x onerror="alert(1)"> ${"B".repeat(300)}\u202Eevil\u2066x\u200B`;
    const { container } = render(<KhuSaiMaPos hang={hang({ cho: [dong({ ghiChu: doc })] })} nguoiXemId="kt1" />);
    const o = cotGhiChu(container);
    expect(o.querySelector("img")).toBeNull();
    expect(o.textContent, "ký tự điều hướng hai chiều / zero-width").not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/);
    expect(Array.from(o.textContent ?? "").length, "chữ hiển thị bị cắt").toBeLessThanOrEqual(121);
    expect(o.textContent?.endsWith("…")).toBe(true);
    const tit = (o.querySelector("[title]") as HTMLElement).getAttribute("title") ?? "";
    expect(Array.from(tit).length, "title cũng bị cắt").toBeLessThanOrEqual(121);
    expect(tit).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/);
    expect(tit.startsWith('<img src=x onerror="alert(1)"> BBB'), "đầu chuỗi giữ NGUYÊN VĂN").toBe(true);
  });

  it("ĐỐI CHỨNG DƯƠNG: ghi chú ngắn sạch ⇒ nguyên văn, `title` = chữ; ghi chú rỗng ⇒ '(để trống)'", () => {
    const { container, unmount } = render(<KhuSaiMaPos hang={hang({ cho: [dong({ ghiChu: "Huynh K7M2X" })] })} nguoiXemId="kt1" />);
    const o = cotGhiChu(container);
    expect(o.textContent).toBe("Huynh K7M2X");
    expect((o.querySelector("[title]") as HTMLElement).getAttribute("title")).toBe("Huynh K7M2X");
    unmount();
    const v2 = render(<KhuSaiMaPos hang={hang({ cho: [dong({ ghiChu: "" })] })} nguoiXemId="kt1" />);
    expect(cotGhiChu(v2.container).textContent).toBe("(để trống)");
  });
});

describe("[HN3-RK] không bấm đúp: nút khoá TRONG LÚC máy chủ chưa trả lời", () => {
  it("[HN3-RK8c] bấm Duyệt hai lần + bấm Từ chối khi đang chạy ⇒ MỘT lượt gọi, không hộp thoại; xong ⇒ MỘT toast + làm mới", async () => {
    let giai: (v: unknown) => void = () => undefined;
    h.duyetSaiMaAction.mockReturnValueOnce(new Promise((r) => (giai = r)));
    render(<KhuSaiMaPos hang={hang({ cho: [dong({ id: "yc-9", orderId: "o9" })] })} nguoiXemId="kt1" />);
    const duyet = screen.getByRole("button", { name: "Duyệt" }) as HTMLButtonElement;
    const tuChoi = screen.getByRole("button", { name: "Từ chối" }) as HTMLButtonElement;
    // Luật 18: lời hứa treo (`giai`) PHẢI được giải ở `finally` — ca đỏ giữa chừng mà để nó treo thì hộp thoại/khoá cuộn của base-ui nằm lại
    // và làm đỏ lây ca sau (đo ở phép cấy U11). Và khẳng định TRƯỚC khi bấm "Từ chối": nếu nút không khoá thì bấm sẽ MỞ hộp thoại.
    try {
      fireEvent.click(duyet);
      fireEvent.click(duyet);
      await waitFor(() => expect(h.duyetSaiMaAction).toHaveBeenCalledTimes(1));
      expect(h.duyetSaiMaAction).toHaveBeenCalledWith({ orderId: "o9", yeuCauId: "yc-9" });
      expect(duyet.disabled, "đang chạy ⇒ khoá").toBe(true);
      expect(tuChoi.disabled, "đang duyệt ⇒ Từ chối cũng khoá").toBe(true);
      fireEvent.click(tuChoi);
      expect(screen.queryByRole("dialog"), "Từ chối lúc đang duyệt không mở hộp thoại").toBeNull();
      expect(h.success).not.toHaveBeenCalled();

      await act(async () => giai({ ok: true, trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận." }));
      await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
      expect(h.refresh).toHaveBeenCalled();
      expect(h.duyetSaiMaAction, "vẫn đúng một lượt").toHaveBeenCalledTimes(1);
    } finally {
      giai({ ok: true, trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận." });
    }
  });

  it("[HN3-RK9e] 'Xác nhận từ chối' bấm đúp ⇒ MỘT lượt gọi; trong lúc gửi 'Đóng' khoá, Escape không đóng, ô lý do giữ nguyên", async () => {
    let giai: (v: unknown) => void = () => undefined;
    h.tuChoiSaiMaAction.mockReturnValueOnce(new Promise((r) => (giai = r)));
    render(<KhuSaiMaPos hang={hang({ cho: [dong({ id: "yc-8", orderId: "o8" })] })} nguoiXemId="kt1" />);
    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    const hop = await screen.findByRole("dialog");
    // Luật 18: giải lời hứa treo ở `finally` để ca đỏ giữa chừng không để hộp thoại mở làm đỏ lây ca sau.
    try {
      fireEvent.change(within(hop).getByLabelText(/Lý do từ chối/), { target: { value: "Giao dịch của khách khác" } });
      const xacNhan = within(hop).getByRole("button", { name: "Xác nhận từ chối" }) as HTMLButtonElement;
      fireEvent.click(xacNhan);
      fireEvent.click(xacNhan);
      await waitFor(() => expect(h.tuChoiSaiMaAction).toHaveBeenCalledTimes(1));
      expect(h.tuChoiSaiMaAction).toHaveBeenCalledWith({ orderId: "o8", yeuCauId: "yc-8", lyDo: "Giao dịch của khách khác" });
      expect((within(hop).getByRole("button", { name: "Đóng" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.keyDown(hop, { key: "Escape" });
      expect(screen.getByRole("dialog"), "Escape lúc đang gửi không đóng hộp thoại").toBeTruthy();
      expect((within(hop).getByLabelText(/Lý do từ chối/) as HTMLTextAreaElement).value).toBe("Giao dịch của khách khác");

      await act(async () => giai({ ok: true, trangThai: "TU_CHOI", thongDiep: "Đã từ chối." }));
      await waitFor(() => expect(h.success).toHaveBeenCalledWith("Đã từ chối."));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(h.tuChoiSaiMaAction).toHaveBeenCalledTimes(1);
    } finally {
      giai({ ok: true, trangThai: "TU_CHOI", thongDiep: "Đã từ chối." });
    }
  });
});

describe("[HN3-RK14] rớt kết nối giữa chừng: câu tiếng Việt, nút nhả, danh sách được tải lại — không văng cả trang", () => {
  const CAU = /Mất kết nối — chưa rõ (đã duyệt|đã từ chối) chưa/;
  const KHONG_HUY = /h[uủ]y|huỷ|hủy/i;

  it("Duyệt: action reject ⇒ toast.error câu tiếng Việt (không chữ kỹ thuật) + làm mới; nút MỞ LẠI (không kẹt khoá); bấm lại gọi được", async () => {
    h.duyetSaiMaAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<KhuSaiMaPos hang={hang({ cho: [dong({ id: "yc-5", orderId: "o5" })] })} nguoiXemId="kt1" />);
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    expect(h.error.mock.calls[0]![0]).toMatch(CAU);
    expect(h.error.mock.calls[0]![0]).not.toContain("Failed to fetch");
    expect(h.error.mock.calls[0]![0], "không hướng dẫn huỷ giao dịch trên máy").not.toMatch(KHONG_HUY);
    expect(h.refresh, "tải lại để lấy sự thật").toHaveBeenCalled();
    const nut = screen.getByRole("button", { name: "Duyệt" }) as HTMLButtonElement;
    await waitFor(() => expect(nut.disabled).toBe(false));
    fireEvent.click(nut);
    await waitFor(() => expect(h.duyetSaiMaAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
  });

  it("Từ chối: action reject ⇒ toast.error câu tiếng Việt, hộp thoại GIỮ lý do đã gõ và mở lại nút; làm mới trang", async () => {
    h.tuChoiSaiMaAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<KhuSaiMaPos hang={hang({ cho: [dong({ id: "yc-6", orderId: "o6" })] })} nguoiXemId="kt1" />);
    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/Lý do từ chối/), { target: { value: "Không đúng giao dịch của khách" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Xác nhận từ chối" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    expect(h.error.mock.calls[0]![0]).toMatch(CAU);
    expect(h.error.mock.calls[0]![0], "không hướng dẫn huỷ giao dịch trên máy").not.toMatch(KHONG_HUY);
    expect(h.refresh).toHaveBeenCalled();
    const xn = within(screen.getByRole("dialog")).getByRole("button", { name: "Xác nhận từ chối" }) as HTMLButtonElement;
    await waitFor(() => expect(xn.disabled, "nhả nút").toBe(false));
    expect((within(screen.getByRole("dialog")).getByLabelText(/Lý do từ chối/) as HTMLTextAreaElement).value, "không mất chữ đã gõ").toBe(
      "Không đúng giao dịch của khách",
    );
    expect(h.success).not.toHaveBeenCalled();
  });
});

describe("[HN3-RK] bảng HẬU KIỂM 7 ngày (chỉ đọc)", () => {
  it("[HN3-RK10] đã ghi nhận · tự ghi nhận có chip 'Sale tự xác nhận' (bậc không qua kế toán) · bị từ chối kèm lý do + người từ chối · xử lý ở nơi khác", () => {
    const tuGhi = dong({ id: "h1", hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN", kieu: "TU_GHI_NHAN", lyDo: [] });
    const keToan = dong({ id: "h2", hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN", kieu: "CHO_KE_TOAN", nguoiQuyet: "Kế Toán Hai", quyetLuc: new Date(NOW.getTime() - 5 * 60_000) });
    const choi = dong({
      id: "h3",
      hieuLuc: "TU_CHOI",
      trangThai: "TU_CHOI",
      lyDoTuChoi: "Giao dịch của khách khác",
      nguoiQuyet: "Kế Toán Ba",
      quyetLuc: new Date(NOW.getTime() - 3 * 60_000),
    });
    const ngoai = dong({ id: "h4", hieuLuc: "DA_XU_LY_NGOAI" });
    const { container } = render(<KhuSaiMaPos hang={hang({ hauKiem: [tuGhi, keToan, choi, ngoai] })} nguoiXemId="kt1" />);
    const rows = [...container.querySelectorAll("tbody tr")] as HTMLElement[];
    expect(rows).toHaveLength(4);
    const [rTu, rKt, rChoi, rNgoai] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    expect(within(rTu).getByText("Đã ghi nhận")).toBeTruthy();
    expect(within(rTu).getByText("Sale tự xác nhận"), "bậc không qua kế toán phải NHÌN LẠI được").toBeTruthy();
    expect(within(rKt).getByText("Đã ghi nhận")).toBeTruthy();
    expect(within(rKt).queryByText("Sale tự xác nhận"), "ĐỐI CHỨNG: bậc kế toán duyệt không gắn chip này").toBeNull();
    expect(rKt.textContent).toContain("Duyệt bởi Kế Toán Hai");

    expect(within(rChoi).getByText("Đã từ chối")).toBeTruthy();
    expect(rChoi.textContent).toContain("Lý do: Giao dịch của khách khác");
    expect(rChoi.textContent).toContain("Từ chối bởi Kế Toán Ba");
    expect(within(rNgoai).getByText("Đã xử lý ở nơi khác")).toBeTruthy();
    // Hậu kiểm là chỉ đọc: không nút nào.
    expect(container.querySelectorAll("tbody button")).toHaveLength(0);
  });
});

describe("[HN3-RK10b] hậu kiểm: chip 'Sale tự xác nhận' và dòng 'Duyệt bởi' KHÔNG được mâu thuẫn (rà đối kháng Việc 3 — [HN3-RV-08])", () => {
  const Q = new Date(NOW.getTime() - 5 * 60_000);
  const hauKiem = (d: DongSaiMa) => {
    const { container } = render(<KhuSaiMaPos hang={hang({ hauKiem: [d] })} nguoiXemId="kt9" />);
    return container.querySelector("tbody tr") as HTMLElement;
  };

  it("tự ghi nhận RỒI rơi về chờ duyệt (lý do GHI_TU_DONG_KHONG_DUOC) và kế toán DUYỆT ⇒ có người xem xét: KHÔNG chip, 'Duyệt bởi …'", () => {
    const r = hauKiem(
      dong({ id: "m1", hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN", kieu: "TU_GHI_NHAN", lyDo: ["GHI_TU_DONG_KHONG_DUOC"], nguoiQuyet: "Kế Toán Hai", quyetLuc: Q }),
    );
    expect(within(r).queryByText("Sale tự xác nhận"), "yêu cầu đã qua tay kế toán — chip nói điều ngược lại").toBeNull();
    expect(r.textContent).toContain("Duyệt bởi Kế Toán Hai");
  });

  it("tự ghi nhận, sập giữa chừng, kế toán chỉ THỬ LẠI việc ghi tiền (không xem xét gì) ⇒ chip VẪN còn, nhưng dòng người làm nói 'Thử lại ghi nhận', KHÔNG 'Duyệt bởi'", () => {
    const r = hauKiem(dong({ id: "m2", hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN", kieu: "TU_GHI_NHAN", lyDo: [], nguoiQuyet: "Kế Toán Hai", quyetLuc: Q }));
    expect(within(r).getByText("Sale tự xác nhận"), "chưa ai xem xét NỘI DUNG ⇒ vẫn phải nhìn lại được").toBeTruthy();
    expect(r.textContent).toContain("Thử lại ghi nhận bởi Kế Toán Hai");
    expect(r.textContent, "'Duyệt' khẳng định kiểm soát quá mức thực tế").not.toContain("Duyệt bởi");
  });

  it("đối chứng dương: kế toán duyệt yêu cầu CHO_KE_TOAN ⇒ 'Duyệt bởi …', không chip; tự ghi nhận không ai quyết ⇒ chip, không dòng 'bởi'", () => {
    const a = hauKiem(dong({ id: "m3", hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN", kieu: "CHO_KE_TOAN", nguoiQuyet: "Kế Toán Hai", quyetLuc: Q }));
    expect(within(a).queryByText("Sale tự xác nhận")).toBeNull();
    expect(a.textContent).toContain("Duyệt bởi Kế Toán Hai");
    document.body.innerHTML = "";
    const b = hauKiem(dong({ id: "m4", hieuLuc: "DA_GHI_NHAN", trangThai: "DA_GHI_NHAN", kieu: "TU_GHI_NHAN", lyDo: [] }));
    expect(within(b).getByText("Sale tự xác nhận")).toBeTruthy();
    expect(b.textContent).not.toMatch(/bởi/);
  });
});

describe("[HN3-RK15] lý do từ chối ở bảng hậu kiểm: mật độ — kẹp 3 dòng, đủ chữ ở `title` (DESIGN.md: dòng bảng chữ luôn kẹp theo SỐ dòng cố định)", () => {
  it("lý do 500 ký tự ⇒ phần tử mang `line-clamp-3` + `title` = nguyên văn; lý do ngắn ⇒ vẫn đọc được nguyên văn", () => {
    const dai = `Giao dịch của khách khác. ${"đối chiếu giờ quẹt và số thẻ ".repeat(17)}`.slice(0, 500);
    const choi = dong({ id: "h9", hieuLuc: "TU_CHOI", trangThai: "TU_CHOI", lyDoTuChoi: dai, nguoiQuyet: "Kế Toán Ba", quyetLuc: new Date(NOW.getTime() - 3 * 60_000) });
    const { container, unmount } = render(<KhuSaiMaPos hang={hang({ hauKiem: [choi] })} nguoiXemId="kt1" />);
    const o = container.querySelector("tbody tr td:last-child [title]") as HTMLElement;
    expect(o, "dòng lý do có title").toBeTruthy();
    expect(o.getAttribute("title")).toBe(dai);
    expect(o.className).toMatch(/\bline-clamp-3\b/);
    expect(o.textContent).toBe(`Lý do: ${dai}`);
    unmount();

    const ngan = render(
      <KhuSaiMaPos hang={hang({ hauKiem: [dong({ id: "h10", hieuLuc: "TU_CHOI", trangThai: "TU_CHOI", lyDoTuChoi: "Không đúng khách", nguoiQuyet: "Kế Toán Ba" })] })} nguoiXemId="kt1" />,
    );
    expect(ngan.container.textContent).toContain("Lý do: Không đúng khách");
  });
});

describe("[HN3-RK11] chip 'Sale báo nhập sai mã' ở bảng giao dịch tiền về", () => {
  const item = (p: Partial<BankTxnItem> = {}): BankTxnItem => ({
    id: "bt1",
    at: "2026-10-09T03:00:00.000Z",
    provider: "CARD_POS",
    providerTxnId: "FXPOS3HN000001",
    amount: 3_168_000,
    content: "K7M2X",
    referenceCode: null,
    accountNumber: null,
    status: "UNMATCHED",
    unmatchedNote: null,
    allocations: [],
    ...p,
  });

  it("chỉ giao dịch UNMATCHED đang bị giữ mới có chip; nhãn theo hiệu lực; giao dịch khác / đã MATCHED thì không", () => {
    const { container } = render(
      <BankTxnClient
        items={[
          item({ id: "a" }),
          item({ id: "b", providerTxnId: "FXPOS3HN000002" }),
          item({ id: "c", providerTxnId: "FXPOS3HN000003" }),
          item({ id: "d", providerTxnId: "FXPOS3HN000004", status: "MATCHED" }),
          item({ id: "e", providerTxnId: "FXPOS3HN000005" }),
        ]}
        saiMaTheoGiaoDich={{
          a: { hieuLuc: "CHO_DUYET" },
          b: { hieuLuc: "DANG_GHI" },
          c: { hieuLuc: "KET" },
          d: { hieuLuc: "CHO_DUYET" },
        }}
        canManage
        canGan
      />,
    );
    const rows = [...container.querySelectorAll("tbody tr")] as HTMLElement[];
    const theoMa = (ma: string) => rows.find((r) => r.textContent?.includes(ma)) as HTMLElement;
    expect(theoMa("FXPOS3HN000001").textContent).toContain("Sale báo nhập sai mã — chờ kế toán duyệt");
    expect(theoMa("FXPOS3HN000002").textContent).toContain("Sale báo nhập sai mã — đang ghi nhận");
    expect(theoMa("FXPOS3HN000003").textContent).toContain("Sale báo nhập sai mã — đang ghi, bị kẹt");
    expect(theoMa("FXPOS3HN000004").textContent, "đã MATCHED: không chip dù có trong bản đồ").not.toContain("Sale báo nhập sai mã");
    expect(theoMa("FXPOS3HN000005").textContent, "không bị giữ: không chip").not.toContain("Sale báo nhập sai mã");
  });

  it("bản đồ rỗng (người xem không có quyền duyệt) ⇒ không chip nào", () => {
    const { container } = render(<BankTxnClient items={[item()]} saiMaTheoGiaoDich={{}} />);
    expect(container.textContent).not.toContain("Sale báo nhập sai mã");
    expect(container.textContent).toContain("Cần xử lý");
  });
});
