// @vitest-environment jsdom
/**
 * Ca [HN1-R*] — HAI NÚT QR / THẺ POS CHUNG MỘT MÃ, dựng THẬT trong bảng "Phiếu thu & QR theo đợt"
 * (docs/pos-hai-nut-khai-may.md §1). Bấm nút thật, soi cái gì CÓ và KHÔNG CÓ trên màn.
 *
 * Lỗi sinh ra lớp test này: `{phieuGop && <PhieuGopQr/>}` vẽ panel QR MỖI KHI có phiếu gộp, nên bấm "Thẻ POS"
 * (cũng đẻ ra phiếu gộp) là bung luôn ảnh QR + "Nội dung CK" — khách đứng quầy thấy hai cách trả cho một
 * khoản. Hàm thuần xanh vĩnh viễn kể cả khi component vẫn vẽ vô điều kiện; chỉ bấm thật mới biết.
 *
 * Mô phỏng `router.refresh()` bằng `rerender` với props mới (máy chủ trả lại trang sau khi action ghi xong).
 *
 * Câu chữ cố ý VIẾT LẠI NGUYÊN VĂN ở đây thay vì import hằng: test phải ghim đúng chữ chủ dự án chốt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PhieuPosView } from "@/lib/payments/pos/phieu-pos-luat";
import type { PhieuGopView } from "./cong-no-theo-con";

const h = vi.hoisted(() => ({
  taoPhieuGopAction: vi.fn(),
  huyPhieuGopAction: vi.fn(),
  dongPhieuGopAction: vi.fn(),
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
  taoPhieuGopAction: h.taoPhieuGopAction,
  huyPhieuGopAction: h.huyPhieuGopAction,
  dongPhieuGopAction: h.dongPhieuGopAction,
  taoPhieuPosAction: h.taoPhieuPosAction,
  kiemTraPhieuPosAction: h.kiemTraPhieuPosAction,
  baoAdminPhieuPosAction: h.baoAdminPhieuPosAction,
}));
vi.mock("../_qr-actions", () => ({ issueQrForRequest: vi.fn(), regenerateQr: vi.fn() }));
// Việc 3: `hop-phieu-pos.tsx` nay import action "tôi nhập sai mã" (kéo `@/lib/auth` thật nếu không mock).
vi.mock("../_pos-sai-ma-actions", () => ({ guiSaiMaAction: vi.fn(), timUngVienSaiMaAction: vi.fn() }));

import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";

const CAU_CANH_BAO =
  "Mã này đang mở cho cả chuyển khoản và thẻ — khách chỉ trả MỘT cách. Khoản về sau sẽ vào hàng chờ gắn tay.";
const CAU_CHO_QUET = "Đang chờ quẹt thẻ cho mã này";
const CAU_CHO_KE_TOAN = "Giao dịch thẻ của mã này còn chờ kế toán xử lý";
// Việc 4 — ba câu chặn "Huỷ phiếu" khi thẻ đang chờ, viết lại NGUYÊN VĂN (câu thứ tư — hộp không cho huỷ — dựng từ cặp câu lý do).
const CAU_CHAN_CO_NUT = "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước (bấm “Thẻ · đang chờ” ở dòng đợt, rồi “Huỷ phiếu thẻ”).";
const CAU_CHAN_KHONG_QUYEN =
  "Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã. Nhờ người có quyền thu thẻ POS xử lý phiếu thẻ trước (huỷ nếu khách chưa quẹt, hoặc kiểm tra kết quả).";
const CAU_CHAN_CHUA_BIET =
  "Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã. Mở phiếu thẻ ở dòng đợt (“Thẻ · đang chờ”): khách chưa quẹt thì huỷ phiếu thẻ ở đó.";
const CAU_CUNG_MA = "Cùng mã với QR chuyển khoản";

// Luật 19 — đồng hồ đóng băng; mọi mốc trong fixture tính từ nó.
const BAY_GIO = new Date("2026-10-09T06:30:00Z");
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
    saiMa: null,
    donDaCoVetBac: false,
    huyPhieuThe: { huyDuoc: true, canXacNhanManh: true },
    ...p,
  };
}

function phieuGop(p: Partial<PhieuGopView> = {}): PhieuGopView {
  return {
    billId: "b1",
    ma: "H6WR4",
    tongTien: 800_000,
    daNhan: 0,
    dong: [{ paymentRequestId: "pr3", installmentNo: 3, ten: "Đợt 3", soTien: 800_000 }],
    // URL ảnh THẬT ⇒ phép thử "KHÔNG có ảnh QR" có nghĩa (qrUrl null thì ảnh vắng mặt dù component vẽ vô điều kiện).
    qrUrl: "https://img.vietqr.io/image/970407-0000-compact2.png?amount=800000",
    noiDungCk: "MAI 0910000101 H6WR4",
    theDangMo: null,
    ...p,
  };
}

type Props = Parameters<typeof PaymentRequestsSection>[0];

function props(p: Partial<Props> = {}): Props {
  return {
    orderId: "o1",
    requests: [DOT],
    initialSessions: {},
    canManage: false,
    duocPhatPhieu: true,
    duocDongPhieu: false,
    batThuTheoCon: true,
    phieuGop: null,
    duocThuThePos: true,
    phieuPos: null,
    mayPos: [{ id: "m1", nhan: "QTTFBKATK" }],
    khaiMay: { title: "Khai máy ở Cơ sở → Máy POS quẹt thẻ", href: null },
    ...p,
  };
}

function dung(p: Partial<Props> = {}) {
  const v = render(<PaymentRequestsSection {...props(p)} />);
  /** Máy chủ trả lại trang sau `router.refresh()`. */
  const lamMoi = (q: Partial<Props>) => v.rerender(<PaymentRequestsSection {...props(q)} />);
  return { ...v, lamMoi };
}

const anhQr = () => screen.queryByAltText(/Mã QR phiếu/);
const noiDungCk = () => screen.queryByText(/Nội dung CK/);
const nutQrMa = () => screen.getByRole("button", { name: /QR · H6WR4/ });

/** Bấm nút mã QR (bật/tắt panel) — và khẳng định nó KHÔNG phát phiếu gộp mới. */
function bamNutQrMa() {
  fireEvent.click(nutQrMa());
  expect(h.taoPhieuGopAction, "nút QR của mã đang mở chỉ bật/tắt panel, không phát phiếu").not.toHaveBeenCalled();
}

async function dongHop() {
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BAY_GIO);
  vi.clearAllMocks();
  h.taoPhieuGopAction.mockResolvedValue({ ok: true, billId: "b1", ma: "H6WR4", tongTien: 800_000, soDong: 1 });
  h.taoPhieuPosAction.mockResolvedValue({ ok: true, phieu: phieu() });
});
afterEach(() => vi.useRealTimers());

describe("[HN1-R] mỗi nút chỉ xuất thứ của nó", () => {
  it("[HN1-R1] bấm 'Thẻ POS' (chưa có phiếu gộp) ⇒ CHỈ hộp thẻ: có mã cỡ lớn, KHÔNG ảnh QR, KHÔNG 'Nội dung CK'", async () => {
    const v = dung();
    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    await waitFor(() => expect(h.taoPhieuPosAction).toHaveBeenCalledWith({ orderId: "o1", paymentRequestId: "pr3" }));
    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByText("H6WR4")).toBeTruthy();
    expect(h.taoPhieuGopAction, "Thẻ POS tự đẻ phiếu gộp ở máy chủ, không qua nút phát QR").not.toHaveBeenCalled();

    // Máy chủ làm mới trang: lúc này CÓ phiếu gộp (đẻ ra từ nút Thẻ) và có phiếu thẻ đang chờ.
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(anhQr(), "bấm Thẻ POS không được bung ảnh QR").toBeNull();
    expect(noiDungCk(), "…cũng không bung 'Nội dung CK'").toBeNull();
    // Đối chứng dương: nút QR của chính mã ấy CÓ trên dòng (muốn xem QR thì tự bấm).
    expect(screen.getByText(/QR · H6WR4/)).toBeTruthy();
  });

  it("[HN1-R2] bấm 'Xuất QR' ⇒ CHỈ panel QR: có ảnh + 'Nội dung CK', KHÔNG hộp thẻ", async () => {
    const v = dung();
    fireEvent.click(screen.getByRole("button", { name: "Xuất QR" }));
    await waitFor(() => expect(h.taoPhieuGopAction).toHaveBeenCalledWith({ orderId: "o1", paymentRequestIds: ["pr3"] }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    v.lamMoi({ phieuGop: phieuGop() });
    expect(screen.getByAltText("Mã QR phiếu H6WR4")).toBeTruthy();
    expect(noiDungCk()).toBeTruthy();
    expect(screen.queryByRole("dialog"), "bấm QR không được bung hộp thẻ").toBeNull();
    expect(h.taoPhieuPosAction).not.toHaveBeenCalled();
    // Đối chứng dương: nút Thẻ POS vẫn còn đó cho đợt này (dùng lại mã).
    expect(screen.getByRole("button", { name: /^Thẻ POS$/ })).toBeTruthy();
  });

  it("[HN1-R3] tải trang với phiếu gộp + thẻ đang mở ⇒ KHÔNG bung panel QR; dòng có 'Thẻ · đang chờ' + nút 'QR · MÃ'; bấm QR bật/tắt", () => {
    dung({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    expect(anhQr()).toBeNull();
    expect(noiDungCk()).toBeNull();
    expect(screen.getByRole("button", { name: /Thẻ · đang chờ/ })).toBeTruthy();
    expect(nutQrMa().getAttribute("aria-expanded")).toBe("false");

    bamNutQrMa();
    expect(screen.getByAltText("Mã QR phiếu H6WR4")).toBeTruthy();
    expect(noiDungCk()).toBeTruthy();
    expect(nutQrMa().getAttribute("aria-expanded")).toBe("true");
    // Cả hai kênh đã mở cho cùng mã ⇒ panel đang hiện in cảnh báo.
    expect(screen.getByText(CAU_CANH_BAO)).toBeTruthy();

    bamNutQrMa();
    expect(anhQr(), "bấm lần nữa ⇒ ẩn").toBeNull();
    expect(screen.queryByText(CAU_CANH_BAO)).toBeNull();
  });

  it("[HN1-R3b] ĐỐI CHỨNG: phiếu gộp KHÔNG có thẻ mở ⇒ panel QR hiện sẵn như cũ, và KHÔNG cảnh báo", () => {
    dung({ phieuGop: phieuGop({ theDangMo: null }) });
    expect(screen.getByAltText("Mã QR phiếu H6WR4")).toBeTruthy();
    expect(noiDungCk()).toBeTruthy();
    expect(screen.queryByText(CAU_CANH_BAO), "chỉ dùng QR ⇒ không có gì để cảnh báo").toBeNull();
    expect(nutQrMa().getAttribute("aria-expanded")).toBe("true");
  });

  it("[HN1-R4] mã hiển thị ở HAI nơi bằng nhau: nút 'QR · MÃ' trên dòng và mã cỡ lớn trong hộp thẻ", () => {
    dung({ phieuGop: phieuGop({ ma: "WT9GX", theDangMo: "DANG_CHO" }), phieuPos: phieu({ code5: "WT9GX" }) });
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
    const trongHop = within(screen.getByRole("dialog")).getByText("WT9GX").textContent;
    const tren = screen.getByText(/QR · WT9GX/).textContent;
    expect(trongHop).toBe("WT9GX");
    expect(tren).toBe("QR · WT9GX");
    expect(tren?.endsWith(trongHop ?? "?"), "nút QR và hộp thẻ in CÙNG một mã 5 ký tự").toBe(true);
  });

  it("[HN1-R5] POS trước rồi QR ⇒ nút QR DÙNG LẠI mã: không gọi phát phiếu gộp lần nào", async () => {
    const v = dung();
    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    await screen.findByRole("dialog");
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    await dongHop();

    bamNutQrMa(); // đã khẳng định taoPhieuGopAction chưa được gọi
    expect(screen.getByAltText("Mã QR phiếu H6WR4")).toBeTruthy();
    expect(h.taoPhieuPosAction).toHaveBeenCalledTimes(1);
    expect(h.taoPhieuGopAction).toHaveBeenCalledTimes(0);
  });

  it("[HN1-R5b] QR trước rồi Thẻ ⇒ phát phiếu gộp ĐÚNG MỘT LẦN (ở nút QR); nút Thẻ chỉ mở phiếu thẻ cho CÙNG đợt", async () => {
    const v = dung();
    fireEvent.click(screen.getByRole("button", { name: "Xuất QR" }));
    await waitFor(() => expect(h.taoPhieuGopAction).toHaveBeenCalledTimes(1));
    v.lamMoi({ phieuGop: phieuGop() });

    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    await waitFor(() => expect(h.taoPhieuPosAction).toHaveBeenCalledWith({ orderId: "o1", paymentRequestId: "pr3" }));
    await screen.findByRole("dialog");
    expect(h.taoPhieuGopAction, "nút thứ hai không phát phiếu mới").toHaveBeenCalledTimes(1);
  });

  it("[HN1-R6] ĐỐI CHỨNG DƯƠNG: người KHÔNG có `payments:pos-check` vẫn THẤY nút QR, panel không mở sẵn khi có thẻ, Huỷ không được mời", () => {
    // Họ không nạp được phiếu thẻ (`phieuPos = null`) — sự thật "thẻ đang mở" phải tới họ qua `phieuGop.theDangMo`.
    dung({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    expect(nutQrMa(), "nút QR phải CÓ").toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thẻ/ }), "không quyền thẻ ⇒ không ô Thẻ").toBeNull();
    expect(anhQr(), "có thẻ đang mở ⇒ panel QR không mở sẵn, dù người xem không thấy phiếu thẻ").toBeNull();
    bamNutQrMa();
    expect(screen.getByAltText("Mã QR phiếu H6WR4")).toBeTruthy();
    expect(screen.getByText(CAU_CANH_BAO)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Huỷ phiếu" }), "nút Huỷ mà máy chủ chắc chắn từ chối = lời hứa suông").toBeNull();
    expect(screen.getByText(new RegExp(CAU_CHO_QUET))).toBeTruthy();
  });

  it("[HN1-R6b] ĐỐI CHỨNG: chưa có phiếu gộp, người không có `pos-check` vẫn thấy 'Xuất QR'", () => {
    dung({ duocThuThePos: false });
    expect(screen.getByRole("button", { name: "Xuất QR" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thẻ/ })).toBeNull();
  });

  it("[HN1-R7] mã đang mở cho đợt KHÁC ⇒ giữ nguyên câu 'Mã đang mở cho Đợt X', không nút nào ở dòng đó", () => {
    const d1: PaymentRequestRow = { ...DOT, id: "pr1", installmentNo: 1 };
    const d2: PaymentRequestRow = { ...DOT, id: "pr2", installmentNo: 2 };
    dung({
      requests: [d1, d2],
      phieuGop: phieuGop({ dong: [{ paymentRequestId: "pr1", installmentNo: 1, ten: "Đợt 1", soTien: 800_000 }] }),
    });
    const dong2 = screen.getByRole("cell", { name: "Đợt 2/2" }).closest("tr") as HTMLElement;
    expect(within(dong2).getByText(/Mã đang mở cho Đợt 1\/2/)).toBeTruthy();
    expect(within(dong2).queryByRole("button")).toBeNull();
    // Đối chứng dương: dòng của đợt GIỮ mã có nút.
    const dong1 = screen.getByRole("cell", { name: "Đợt 1/2" }).closest("tr") as HTMLElement;
    expect(within(dong1).getByRole("button", { name: /QR · H6WR4/ })).toBeTruthy();
  });
});

describe("[HN1-R] 'Huỷ phiếu' chỉ được mời khi máy chủ sẽ cho", () => {
  it("[HN1-R8] có thẻ ĐANG CHỜ ⇒ không nút Huỷ, có câu giải thích; ĐỐI CHỨNG: hết thẻ ⇒ nút Huỷ xuất hiện", () => {
    const v = dung({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    bamNutQrMa();
    expect(screen.queryByRole("button", { name: "Huỷ phiếu" })).toBeNull();
    expect(screen.getByText(new RegExp(CAU_CHO_QUET))).toBeTruthy();
    // Việc 4 (09/10/2026): nút "Huỷ phiếu thẻ" ĐÃ CÓ ⇒ câu chặn trỏ tới nó — vì người xem có `pos-check` VÀ hộp (phieu() mặc
    // định `huyDuoc: true`) sẽ vẽ nút đó. Trước Việc 4 ca này ghim ngược lại ("không lặp lời hứa về một nút chưa tồn tại").
    expect(screen.getByText(CAU_CHAN_CO_NUT)).toBeTruthy();

    // Phiếu thẻ hết hạn / kế toán xử lý xong ⇒ `theDangMo` về null ⇒ Huỷ phiếu có lại.
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: null });
    expect(screen.getByRole("button", { name: "Huỷ phiếu" })).toBeTruthy();
    expect(screen.queryByText(new RegExp(CAU_CHO_QUET))).toBeNull();
  });

  it("[HN4-R1] câu chặn đi theo QUYỀN của người xem: không có `pos-check` ⇒ chỉ nói nhờ ai; ĐỐI CHỨNG: có quyền, cùng phiếu ⇒ trỏ tới nút", () => {
    const v = dung({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    bamNutQrMa();
    expect(screen.getByText(CAU_CHAN_KHONG_QUYEN)).toBeTruthy();
    expect(screen.queryByText(CAU_CHAN_CO_NUT), "không hứa nút người xem không có").toBeNull();
    v.lamMoi({ duocThuThePos: true, phieuPos: phieu(), phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    expect(screen.getByText(CAU_CHAN_CO_NUT)).toBeTruthy();
    expect(screen.queryByText(CAU_CHAN_KHONG_QUYEN)).toBeNull();
  });

  it("[HN4-R2] có quyền mà phiếu thẻ KHÔNG lên màn (rời màn sau 30′) ⇒ chỉ tới ô 'Thẻ · đang chờ', không hứa nút", () => {
    dung({ duocThuThePos: true, phieuPos: null, phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    bamNutQrMa();
    expect(screen.getByText(CAU_CHAN_CHUA_BIET)).toBeTruthy();
    expect(screen.queryByText(CAU_CHAN_CO_NUT)).toBeNull();
  });

  it("[HN4-R3] có quyền nhưng hộp KHÔNG cho huỷ (lỗi kết nối) ⇒ nói LÝ DO cùng cặp câu hộp in, không hứa 'bấm Huỷ phiếu thẻ'", () => {
    const huyPhieuThe: PhieuPosView["huyPhieuThe"] = {
      huyDuoc: false,
      ma: "LOI_KET_NOI",
      lyDo: "Lần kiểm gần nhất bị lỗi kết nối — chưa biết khách đã quẹt hay chưa",
      viecNenLam: "Bấm Kiểm tra thanh toán để hỏi lại; có kết quả rõ ràng mới huỷ được.",
    };
    dung({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu({ huyPhieuThe, ketQuaGanNhat: "PROVIDER_ERROR" }) });
    bamNutQrMa();
    expect(
      screen.getByText(
        "Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã, và phiếu thẻ cũng chưa huỷ được: " +
          "Lần kiểm gần nhất bị lỗi kết nối — chưa biết khách đã quẹt hay chưa — Bấm Kiểm tra thanh toán để hỏi lại; có kết quả rõ ràng mới huỷ được.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(CAU_CHAN_CO_NUT)).toBeNull();
  });

  it("[HN1-R8b] thẻ CHỜ KẾ TOÁN ⇒ cũng chặn, bằng câu riêng", () => {
    dung({
      phieuGop: phieuGop({ theDangMo: "CHO_KE_TOAN" }),
      phieuPos: phieu({ trangThai: "LECH_TIEN", hienThi: "LECH_TIEN", choKeToan: true, mucDo: "canh_bao" }),
    });
    expect(anhQr(), "thẻ chờ kế toán cũng là 'thẻ đang mở' ⇒ panel QR không mở sẵn").toBeNull();
    bamNutQrMa();
    expect(screen.queryByRole("button", { name: "Huỷ phiếu" })).toBeNull();
    expect(screen.getByText(new RegExp(CAU_CHO_KE_TOAN))).toBeTruthy();
  });
});

describe("[HN1-R] hộp thẻ: dòng 'cùng mã' và cảnh báo hai kênh", () => {
  it("[HN1-R9] QR đã hiện rồi bấm Thẻ POS ⇒ hộp thẻ có cảnh báo, và panel QR ẨN (một kênh một lúc)", async () => {
    const v = dung({ phieuGop: phieuGop({ theDangMo: null }) });
    expect(screen.getByAltText("Mã QR phiếu H6WR4")).toBeTruthy(); // QR hiện sẵn như cũ
    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    const hop = await screen.findByRole("dialog");
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    expect(within(hop).getByText(CAU_CANH_BAO)).toBeTruthy();
    expect(anhQr(), "mở hộp thẻ ⇒ panel QR ẩn").toBeNull();
    // Đóng hộp KHÔNG tự bật lại QR.
    await dongHop();
    expect(anhQr()).toBeNull();
    expect(h.taoPhieuGopAction).not.toHaveBeenCalled();
  });

  it("[HN1-R9b] ĐỐI CHỨNG: chỉ dùng thẻ (QR chưa từng hiện) ⇒ hộp thẻ KHÔNG cảnh báo", async () => {
    const v = dung();
    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    const hop = await screen.findByRole("dialog");
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    expect(within(hop).queryByText(CAU_CANH_BAO)).toBeNull();
    expect(within(hop).getByText("H6WR4")).toBeTruthy();
  });

  it("[HN1-R10] hộp thẻ đang chờ quẹt in thêm dòng nhỏ 'Cùng mã với QR chuyển khoản'; phiếu đã hết hạn thì không", () => {
    const v = dung({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
    expect(within(screen.getByRole("dialog")).getByText(CAU_CUNG_MA)).toBeTruthy();

    // Phiếu HẾT HẠN khi hộp đang mở — mã không còn để gõ vào máy, nói "cùng mã" là nói thừa/sai.
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieu({ trangThai: "HET_HAN", hienThi: "HET_HAN" }) });
    expect(within(screen.getByRole("dialog")).queryByText(CAU_CUNG_MA)).toBeNull();
    expect(within(screen.getByRole("dialog")).getByText("H6WR4"), "mã vẫn in, chỉ bỏ câu 'cùng mã'").toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG VIỆC 1 (09/10/2026) — docs/pos-hai-nut-khai-may.md §1.11
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN2-R] ô dòng nói cùng sự thật với panel và nút Huỷ", () => {
  it("[HN2-R1] phiếu thẻ đã rời màn (phieuPos = null) mà máy chủ nói thẻ đang mở ⇒ dòng nói 'Thẻ · đang chờ', KHÔNG 'Thẻ POS'", () => {
    dung({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: null });
    expect(screen.getByRole("button", { name: /Thẻ · đang chờ/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Thẻ POS$/ }), "bản cũ mời 'Thẻ POS' như chưa có thẻ").toBeNull();
    expect(anhQr(), "panel QR vẫn ẩn").toBeNull();
    bamNutQrMa();
    expect(screen.getByText(new RegExp(CAU_CHO_QUET)), "…và nút Huỷ nói cùng một chuyện với dòng").toBeTruthy();
  });

  it("[HN2-R1b] ĐỐI CHỨNG DƯƠNG: máy chủ nói KHÔNG có thẻ ⇒ dòng mời 'Thẻ POS' (dùng lại mã)", () => {
    dung({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: null });
    expect(screen.getByRole("button", { name: /^Thẻ POS$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thẻ · đang chờ/ })).toBeNull();
  });

  it("[HN2-R2] người KHÔNG có `pos-check` thấy NHÃN CHỮ 'Thẻ đang chờ' trên dòng (không nút); ĐỐI CHỨNG: hết thẻ ⇒ nhãn biến mất", () => {
    const v = dung({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    const nhan = screen.getByText("Thẻ đang chờ");
    expect(nhan.closest("button"), "nhãn chữ, không phải nút — không cấp năng lực mới").toBeNull();
    expect(screen.queryByRole("button", { name: /Thẻ/ })).toBeNull();
    expect(nutQrMa(), "nút QR vẫn có").toBeTruthy();
    v.lamMoi({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: null }) });
    expect(screen.queryByText("Thẻ đang chờ")).toBeNull();
  });

  it("[HN2-R3] thẻ CHƯA KẾT LUẬN (quá hạn, lượt kiểm báo lỗi) ⇒ dòng nói 'Thẻ · chưa rõ', Huỷ bị chặn bằng câu riêng", () => {
    dung({ phieuGop: phieuGop({ theDangMo: "CHUA_KET_LUAN" }), phieuPos: phieu({ hienThi: "HET_HAN", ketQuaGanNhat: "PROVIDER_ERROR", mucDo: "loi" }) });
    expect(screen.getByRole("button", { name: /Thẻ · chưa rõ/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Thẻ POS$/ })).toBeNull();
    bamNutQrMa();
    expect(screen.queryByRole("button", { name: "Huỷ phiếu" })).toBeNull();
    expect(screen.getByText(/chưa kết luận/)).toBeTruthy();
  });
});

describe("[HN2-R] bấm 'Thẻ · chưa rõ' mở CHÍNH phiếu cũ để Kiểm tra — không tạo phiếu mới", () => {
  it("[HN2-R3b] mở hộp với phiếu đã quá hạn; KHÔNG gọi tạo phiếu (tạo mới sẽ chôn trạng thái chưa kết luận)", async () => {
    dung({
      phieuGop: phieuGop({ theDangMo: "CHUA_KET_LUAN" }),
      phieuPos: phieu({ hienThi: "HET_HAN", ketQuaGanNhat: "PROVIDER_ERROR", mucDo: "loi" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · chưa rõ/ }));
    const hop = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(hop).getByText("H6WR4")).toBeTruthy();
    expect(h.taoPhieuPosAction).not.toHaveBeenCalled();
  });
});

describe("[HN2-R] đợt sale ĐÃ THU TAY không mời phát mã", () => {
  it("[HN2-R4] `daThuTay` ⇒ không 'Xuất QR', không 'Thẻ POS'; ĐỐI CHỨNG: bỏ `daThuTay` ⇒ cả hai nút có", () => {
    const v = dung({ daThuTay: { 3: true } });
    expect(screen.getByText("Đã thu (tay)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xuất QR" }), "mời khách trả lần hai").toBeNull();
    expect(screen.queryByRole("button", { name: /^Thẻ POS$/ })).toBeNull();
    v.lamMoi({ daThuTay: {} });
    expect(screen.getByRole("button", { name: "Xuất QR" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Thẻ POS$/ })).toBeTruthy();
  });
});

describe("[HN2-R] một nút tạo mã đang chạy ⇒ mọi nút tạo mã khoá (cùng đơn)", () => {
  const D1: PaymentRequestRow = { ...DOT, id: "pr1", installmentNo: 1 };
  const D2: PaymentRequestRow = { ...DOT, id: "pr2", installmentNo: 2 };

  it("[HN2-R5] đang 'Thẻ POS' ⇒ 'Xuất QR' (cả dòng khác) khoá và bấm không gọi máy chủ; xong ⇒ mở lại", async () => {
    let xong!: (v: unknown) => void;
    h.taoPhieuPosAction.mockReturnValue(new Promise((r) => (xong = r)));
    dung({ requests: [D1, D2] });
    const dong1 = screen.getByRole("cell", { name: "Đợt 1/2" }).closest("tr") as HTMLElement;
    const dong2 = screen.getByRole("cell", { name: "Đợt 2/2" }).closest("tr") as HTMLElement;
    fireEvent.click(within(dong1).getByRole("button", { name: /^Thẻ POS$/ }));
    await waitFor(() => expect(within(dong1).getByRole("button", { name: "Xuất QR" }).hasAttribute("disabled")).toBe(true), {
      timeout: 5000,
    });
    expect(within(dong2).getByRole("button", { name: "Xuất QR" }).hasAttribute("disabled"), "dòng khác cũng khoá").toBe(true);
    expect(within(dong2).getByRole("button", { name: /^Thẻ POS$/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(dong1).getByRole("button", { name: "Xuất QR" }));
    expect(h.taoPhieuGopAction, "nút khoá thì bấm không phát gì").not.toHaveBeenCalled();
    xong({ ok: true, phieu: phieu() });
    await screen.findByRole("dialog", {}, { timeout: 5000 }); // hộp thẻ mở ⇒ phần còn lại của trang bị che (aria-hidden)
    // Hộp từ chối đóng khi `dangTao` còn true (transition bao cả `router.refresh()`) — bấm Escape lặp tới khi chịu đóng.
    await waitFor(
      () => {
        const d = screen.queryByRole("dialog");
        if (d) fireEvent.keyDown(d, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: 5000 },
    );
    expect(within(dong1).getByRole("button", { name: "Xuất QR" }).hasAttribute("disabled"), "xong ⇒ mở lại").toBe(false);
    expect(within(dong2).getByRole("button", { name: "Xuất QR" }).hasAttribute("disabled")).toBe(false);
  });

  it("[HN2-R5b] đang 'Xuất QR' ⇒ 'Thẻ POS' khoá và bấm không mở phiếu thẻ", async () => {
    let xong!: (v: unknown) => void;
    h.taoPhieuGopAction.mockReturnValue(new Promise((r) => (xong = r)));
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Xuất QR" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Thẻ POS$/ }).hasAttribute("disabled")).toBe(true), {
      timeout: 5000,
    });
    fireEvent.click(screen.getByRole("button", { name: /^Thẻ POS$/ }));
    expect(h.taoPhieuPosAction).not.toHaveBeenCalled();
    xong({ ok: true, billId: "b1", ma: "H6WR4", tongTien: 800_000, soDong: 1, dungLai: false });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Thẻ POS$/ }).hasAttribute("disabled")).toBe(false), {
      timeout: 5000,
    });
  });

  it("[HN2-R5c] ĐỐI CHỨNG: không nút nào đang chạy ⇒ cả hai nút mở", () => {
    dung();
    expect(screen.getByRole("button", { name: "Xuất QR" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /^Thẻ POS$/ }).hasAttribute("disabled")).toBe(false);
  });

  it("[HN2-R6] máy chủ trả 'dùng lại mã' (nút kia vừa phát) ⇒ toast nói đúng, không 'Đã phát mã'", async () => {
    h.taoPhieuGopAction.mockResolvedValue({ ok: true, billId: "b1", ma: "H6WR4", tongTien: 800_000, soDong: 1, dungLai: true });
    dung();
    fireEvent.click(screen.getByRole("button", { name: "Xuất QR" }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(String(h.success.mock.calls[0]?.[0])).toMatch(/dùng lại mã H6WR4/);
    expect(String(h.success.mock.calls[0]?.[0])).not.toMatch(/Đã phát mã/);
  });
});

describe("[HN2-R] đợt khác giữ mã + thẻ đang chờ", () => {
  it("[HN2-R7] dòng của đợt KHÁC nói 'thẻ đang chờ' và `title` không chỉ vào 'đóng hoặc huỷ'", () => {
    const d1: PaymentRequestRow = { ...DOT, id: "pr1", installmentNo: 1 };
    const d2: PaymentRequestRow = { ...DOT, id: "pr2", installmentNo: 2 };
    dung({
      requests: [d1, d2],
      phieuGop: phieuGop({ theDangMo: "DANG_CHO", dong: [{ paymentRequestId: "pr1", installmentNo: 1, ten: "Đợt 1", soTien: 800_000 }] }),
      phieuPos: phieu({ paymentRequestIds: ["pr1"] }),
    });
    const dong2 = screen.getByRole("cell", { name: "Đợt 2/2" }).closest("tr") as HTMLElement;
    const nhan = within(dong2).getByText("Mã đang mở cho Đợt 1/2 (thẻ đang chờ)");
    expect(nhan.getAttribute("title")).toContain("đang chờ quẹt thẻ");
    expect(nhan.getAttribute("title")).not.toContain("đóng hoặc huỷ mã đó rồi xuất lại");
  });
});

describe("[HN2-R] 'Huỷ phiếu' bị máy chủ từ chối", () => {
  it("[HN2-R8] từ chối (đua với phiếu thẻ) ⇒ màn tự làm mới và BỎ bước 'Xác nhận huỷ' (không mời bấm lại câu chắc chắn bị từ chối)", async () => {
    h.huyPhieuGopAction.mockResolvedValue({ ok: false, error: "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước" });
    dung({ phieuGop: phieuGop({ theDangMo: null }) });
    fireEvent.click(screen.getByRole("button", { name: "Huỷ phiếu" }));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận huỷ mã/ }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước"));
    expect(h.refresh, "máy chủ nạp lại ⇒ `theDangMo` mới ⇒ nút Huỷ chuyển sang câu giải thích").toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Xác nhận huỷ mã/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Huỷ phiếu" }), "nút trở về bước một (nếu trang chưa kịp đổi)").toBeTruthy();
  });

  it("[HN2-R8b] ĐỐI CHỨNG: huỷ thành công ⇒ vẫn làm mới đúng một lần", async () => {
    h.huyPhieuGopAction.mockResolvedValue({ ok: true, daNhan: 0 });
    dung({ phieuGop: phieuGop({ theDangMo: null }) });
    fireEvent.click(screen.getByRole("button", { name: "Huỷ phiếu" }));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận huỷ mã/ }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Đã huỷ phiếu"));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});
