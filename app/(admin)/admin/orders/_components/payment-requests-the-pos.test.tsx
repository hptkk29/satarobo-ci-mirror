// @vitest-environment jsdom
/**
 * Ca [POS1-UI-R*] — ô "Thẻ POS" + hộp phiếu thu thẻ dựng THẬT trong bảng "Phiếu thu & QR theo đợt"
 * (GĐ1 POS, docs/pos-gd1-thiet-ke.md §7). Bấm nút thật, soi action được gọi với gì và hộp in gì.
 *
 * Vì sao có lớp test này ngoài `[POS1-UI-01]` (hàm thuần) và lưới dây nối: smoke 06/10 bắt được
 * một lỗi mà cả hai lớp kia xanh — khối POS đọc `dongPhieuMo` TRƯỚC khi nó được khai (TDZ), trang
 * đơn sập NGAY KHI đơn có phiếu POS. Hàm thuần không chạy thân component; lưới chỉ đọc chữ.
 * `[POS1-UI-R1]` dựng bảng có phiếu POS — chính ca đó.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PhieuPosView } from "@/lib/payments/pos/phieu-pos-luat";

const h = vi.hoisted(() => ({
  taoPhieuPosAction: vi.fn(),
  kiemTraPhieuPosAction: vi.fn(),
  baoAdminPhieuPosAction: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../_actions", () => ({
  taoPhieuGopAction: vi.fn(),
  huyPhieuGopAction: vi.fn(),
  dongPhieuGopAction: vi.fn(),
  taoPhieuPosAction: h.taoPhieuPosAction,
  kiemTraPhieuPosAction: h.kiemTraPhieuPosAction,
  baoAdminPhieuPosAction: h.baoAdminPhieuPosAction,
}));
vi.mock("../_qr-actions", () => ({ issueQrForRequest: vi.fn(), regenerateQr: vi.fn() }));

import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";

// Luật 19 — đồng hồ đóng băng; mọi mốc trong fixture tính từ nó.
const BAY_GIO = new Date("2026-10-06T06:30:00Z"); // 13:30 giờ VN
const vn = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "+07:00");

const DOT: PaymentRequestRow = {
  id: "pr3",
  orderItemId: null,
  installmentNo: 3,
  amountDue: 800_000,
  allocated: 0,
  dueDate: null,
  status: "PENDING",
  matchKey: null,
};

function phieu(p: Partial<PhieuPosView> = {}): PhieuPosView {
  const tao = new Date(BAY_GIO.getTime() - 2 * 60_000);
  return {
    intentId: "i1",
    code5: "H6WR4",
    soTienLucTao: 800_000,
    soTienPhaiThu: 800_000,
    dongDot: [{ nhan: "Đợt 3", soTien: 800_000 }],
    may: { id: "m1", nhan: "QTTFBKATK" },
    trangThai: "CHO_QUET",
    hienThi: "CHO_QUET",
    thongDiep: null,
    kiemLuc: null,
    taoLuc: vn(tao),
    hetHanLuc: vn(new Date(tao.getTime() + 24 * 3_600_000)),
    baoAdminTuLuc: vn(new Date(tao.getTime() + 10 * 60_000)),
    duocKiemTra: true,
    paymentRequestIds: ["pr3"],
    cuaPhieuDangMo: true,
    choKeToan: false,
    ketQuaGanNhat: null,
    mucDo: "thong_tin",
    ...p,
  };
}

const PHIEU_GOP = {
  billId: "b1",
  ma: "H6WR4",
  tongTien: 800_000,
  daNhan: 0,
  dong: [{ paymentRequestId: "pr3", installmentNo: 3, ten: "Đợt 3", soTien: 800_000 }],
  qrUrl: null,
  noiDungCk: "MAI 0910000101 H6WR4",
} as unknown as Parameters<typeof PaymentRequestsSection>[0]["phieuGop"];

function dung(p: Partial<Parameters<typeof PaymentRequestsSection>[0]> = {}) {
  return render(
    <PaymentRequestsSection
      orderId="o1"
      requests={[DOT]}
      initialSessions={{}}
      canManage={false}
      duocPhatPhieu
      duocDongPhieu={false}
      batThuTheoCon
      phieuGop={null}
      duocThuThePos
      phieuPos={null}
      mayPos={[{ id: "m1", nhan: "QTTFBKATK" }]}
      {...p}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BAY_GIO);
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("[POS1-UI-R] ô 'Thẻ POS' + hộp phiếu thu thẻ", () => {
  it("[POS1-UI-R1] đơn CÓ phiếu POS đang chờ ⇒ bảng dựng được, ô dòng là 'Thẻ · đang chờ' và mở lại hộp", () => {
    dung({ phieuGop: PHIEU_GOP, phieuPos: phieu() });
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
    const hop = screen.getByRole("dialog");
    expect(within(hop).getByText("H6WR4")).toBeTruthy();
    expect(within(hop).getByText("800.000")).toBeTruthy();
    expect(within(hop).getByRole("button", { name: "Kiểm tra thanh toán" })).toBeTruthy();
    // Mở lại phiếu cũ KHÔNG tạo phiếu mới.
    expect(h.taoPhieuPosAction).not.toHaveBeenCalled();
  });

  it("[POS1-UI-R2] một máy ⇒ bấm 'Thẻ POS' gọi tạo phiếu KHÔNG kèm máy, rồi hộp hiện mã", async () => {
    h.taoPhieuPosAction.mockResolvedValue({ ok: true, phieu: phieu() });
    dung();
    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    await waitFor(() => expect(h.taoPhieuPosAction).toHaveBeenCalledWith({ orderId: "o1", paymentRequestId: "pr3" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("H6WR4")).toBeTruthy();
  });

  it("[POS1-UI-R3] hai máy ⇒ bước chọn máy; nút tạo TẮT tới khi chọn, gọi tạo KÈM máy đã chọn", async () => {
    h.taoPhieuPosAction.mockResolvedValue({ ok: true, phieu: phieu({ may: { id: "m2", nhan: "QTTB" } }) });
    dung({ mayPos: [{ id: "m1", nhan: "QTTA" }, { id: "m2", nhan: "QTTB" }] });
    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    const hop = screen.getByRole("dialog");
    const tao = within(hop).getByRole("button", { name: "Tạo phiếu thu thẻ" }) as HTMLButtonElement;
    expect(tao.disabled).toBe(true);
    expect(h.taoPhieuPosAction).not.toHaveBeenCalled();
    fireEvent.click(within(hop).getByRole("radio", { name: /QTTB/ }));
    expect(tao.disabled).toBe(false);
    fireEvent.click(tao);
    await waitFor(() =>
      expect(h.taoPhieuPosAction).toHaveBeenCalledWith({ orderId: "o1", paymentRequestId: "pr3", posTerminalId: "m2" }),
    );
  });

  it("[POS1-UI-R4] 'Kiểm tra thanh toán' in ĐÚNG câu máy chủ trả (bảng thông điệp), không tự dựng câu", async () => {
    const cau = "Chưa thấy giao dịch mang mã H6WR4. Kiểm tra biên lai đã báo thành công và mã trong ghi chú.";
    h.kiemTraPhieuPosAction.mockResolvedValue({
      ok: true,
      // Lượt bấm dồn (CACHE): câu + giờ của lượt kiểm THẬT trước đó (rà đối kháng GĐ2 06/10/2026).
      ketQua: {
        status: "CHO_QUET",
        doiTrangThai: false,
        thongDiep: cau,
        mucDo: "thong_tin",
        ketLuan: null,
        tuCache: true,
        kiemLuc: "2026-10-06T16:58:00+07:00",
      },
    });
    dung({ phieuGop: PHIEU_GOP, phieuPos: phieu() });
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Kiểm tra thanh toán" }));
    await waitFor(() => expect(h.kiemTraPhieuPosAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1" }));
    expect(await within(screen.getByRole("dialog")).findByText(cau)).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("Kiểm lúc 16:58"), "giờ lượt kiểm thật, không phải giờ bấm").toBeTruthy();
    expect(h.refresh).toHaveBeenCalled();
  });

  it("[POS1-UI-R5] 'Báo admin' chỉ hiện khi đủ ba vế của cổng máy chủ (đối chứng dương: ≥10 phút + NOT_FOUND)", () => {
    const cuaSo = (p: Partial<PhieuPosView>) => {
      const r = dung({ phieuGop: PHIEU_GOP, phieuPos: phieu(p) });
      fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
      const co = within(screen.getByRole("dialog")).queryByRole("button", { name: "Báo admin" }) !== null;
      r.unmount();
      return co;
    };
    const tao11 = vn(new Date(BAY_GIO.getTime() - 11 * 60_000));
    expect(cuaSo({ taoLuc: tao11, ketQuaGanNhat: "NOT_FOUND" })).toBe(true);
    expect(cuaSo({ ketQuaGanNhat: "NOT_FOUND" })).toBe(false); // mới 2 phút
    expect(cuaSo({ taoLuc: tao11, ketQuaGanNhat: null })).toBe(false); // chưa kiểm lần nào
    expect(cuaSo({ taoLuc: tao11, ketQuaGanNhat: "FAILED", trangThai: "THAT_BAI", hienThi: "THAT_BAI" })).toBe(false);
  });

  it("[POS1-UI-R6] T21 — giao dịch thẻ trước còn chờ kế toán ⇒ KHÔNG nút tạo; hộp không mời quẹt", () => {
    dung({
      phieuGop: PHIEU_GOP,
      phieuPos: phieu({ trangThai: "LECH_TIEN", hienThi: "LECH_TIEN", choKeToan: true, mucDo: "canh_bao" }),
    });
    expect(screen.queryByRole("button", { name: /^Thẻ POS$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Thẻ: chờ kế toán/ }));
    const hop = screen.getByRole("dialog");
    expect(within(hop).queryByText(/Cho khách chạm hoặc quẹt thẻ/)).toBeNull();
    expect(within(hop).queryByRole("button", { name: "Tạo phiếu mới" })).toBeNull();
    expect(within(hop).getByText(/Đừng quẹt bù phần chênh/)).toBeTruthy();
  });

  it("[POS1-UI-R7] phiếu đã thu không nằm trên ô dòng nào ⇒ dải kết quả dưới bảng mở lại được", () => {
    dung({
      requests: [{ ...DOT, status: "PAID", allocated: 800_000 }],
      phieuPos: phieu({
        trangThai: "DA_THU",
        hienThi: "DA_THU",
        cuaPhieuDangMo: false,
        soTienPhaiThu: null,
        mucDo: "thanh_cong",
        thongDiep: "Đã thu 800.000đ lúc 13:20 — đã ghi nhận, chờ kế toán xác nhận.",
      }),
    });
    expect(screen.getByText(/Đã thu 800\.000đ lúc 13:20/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mở phiếu thẻ" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("[POS1-UI-R8] không quyền `payments:pos-check` ⇒ không ô thẻ, không dải (đối chứng: R1/R2 có)", () => {
    dung({ duocThuThePos: false, phieuGop: PHIEU_GOP, phieuPos: null });
    expect(screen.queryByRole("button", { name: /Thẻ/ })).toBeNull();
    expect(screen.queryByText(/Thẻ POS · mã/)).toBeNull();
  });
});
