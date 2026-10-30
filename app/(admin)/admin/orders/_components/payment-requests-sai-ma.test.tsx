// @vitest-environment jsdom
/**
 * Ca [HN3-R1..R22] — "TÔI NHẬP SAI MÃ TRÊN MÁY" dựng THẬT trong hộp phiếu thẻ POS (docs/pos-hai-nut-khai-may.md §5.3.9; R13–R22 = lượt hoàn thiện giao diện, §5.10).
 * Bấm nút thật, soi cái gì CÓ và KHÔNG CÓ trên màn: cảnh dùng là sale đứng quầy với phụ huynh, khách ĐÃ quẹt thành công mà
 * sale gõ sai mã nên hệ thống nói "Chưa thấy giao dịch".
 *
 * Luật 12 (affordance nói thật): nút chỉ hiện đúng lúc hệ thống nói "Chưa thấy" · nhãn nút nói đúng điều SẮP xảy ra · KHÔNG câu nào
 * hướng dẫn huỷ giao dịch trên máy rồi quẹt lại (đặc tả điều 6) · sau khi kế toán TỪ CHỐI, hộp không mời quẹt lại.
 *
 * Câu chữ cố ý VIẾT LẠI NGUYÊN VĂN ở đây thay vì import hằng: test phải ghim đúng chữ chủ dự án chốt.
 * Đồng hồ ĐÓNG BĂNG (luật 19); chỉ giả `Date`, để `waitFor`/promise chạy thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PhieuPosView } from "@/lib/payments/pos/phieu-pos-luat";
import { thongDiepPos, type KetLuanPos } from "@/lib/payments/pos/thong-diep-pos";
import { CAU_TU_CHOI_HUY_PHIEU_THE, type MaTuChoiHuyPhieuThe } from "@/lib/payments/pos/huy-phieu-the-cau";
import type { PhieuGopView } from "./cong-no-theo-con";

const h = vi.hoisted(() => ({
  taoPhieuGopAction: vi.fn(),
  huyPhieuGopAction: vi.fn(),
  dongPhieuGopAction: vi.fn(),
  taoPhieuPosAction: vi.fn(),
  kiemTraPhieuPosAction: vi.fn(),
  baoAdminPhieuPosAction: vi.fn(),
  timUngVienSaiMaAction: vi.fn(),
  guiSaiMaAction: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, warning: vi.fn(), message: h.message } }));
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
vi.mock("../_pos-sai-ma-actions", () => ({
  timUngVienSaiMaAction: h.timUngVienSaiMaAction,
  guiSaiMaAction: h.guiSaiMaAction,
}));

import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";

const CAU_CHUA_THAY = "Chưa thấy giao dịch mang mã H6WR4. Kiểm tra biên lai đã báo thành công và mã trong ghi chú.";
const CAU_KHONG_UNG_VIEN =
  "Không thấy giao dịch nào đúng số tiền trên máy này từ lúc mở phiếu. Kiểm tra biên lai: giao dịch có THÀNH CÔNG không, đúng máy không.";
const CAU_CHO_KE_TOAN = "Chờ kế toán xác nhận giao dịch nhập sai mã. Khách đã quẹt thành công — ĐỪNG cho khách quẹt lại.";
const NUT_MO = "Tôi nhập sai mã trên máy";
/** Nguyên văn câu cảnh báo cấp ĐƠN (Việc 5, rà đối kháng) — gõ lại ở đây để ca canh CHỮ, không chỉ canh dây nối. */
const CAU_DON_DA_CO_VET_BAC =
  "Đơn này từng có một giao dịch bị kế toán từ chối. Nếu khách đã quẹt thành công trên máy, ĐỪNG cho khách quẹt lại — báo kế toán.";
const NHAN_TU_GHI = "Đúng giao dịch này — ghi nhận";
const NHAN_GUI_KT = "Gửi kế toán xác nhận";
const CAU_CUNG_MA = "Cùng mã với QR chuyển khoản";
const KHONG_HUY = /h[uủ]y|huỷ|hủy/i;
const NUT_HUY_PHIEU_THE = "Huỷ phiếu thẻ";
/** Chữ của hộp BỎ nhãn nút "Huỷ phiếu thẻ" (VIỆC 6 · a2: sau từ chối nút ấy quay lại — nó là chữ "huỷ" HỢP LỆ duy nhất của hộp). */
const chuHuyNgoaiNut = (hop: HTMLElement) => (hop.textContent ?? "").split(NUT_HUY_PHIEU_THE).join("");

// Luật 19 — đồng hồ đóng băng; mọi mốc trong fixture tính từ nó.
const BAY_GIO = new Date("2026-10-09T06:30:00Z"); // 13:30 giờ VN
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

/**
 * `huyPhieuThe` THẬT của một phiếu KHÔNG huỷ được — dựng từ CHÍNH bảng câu của hợp đồng Việc 4, không tự gõ câu. Ca nào mô phỏng một trạng thái
 * mà máy chủ chắc chắn trả `huyDuoc: false` (đã gửi kế toán · vừa bị từ chối · đã thu · hết hạn) PHẢI ghi đè bằng giá trị này, không dùng mặc định.
 */
const khongHuy = (ma: MaTuChoiHuyPhieuThe): PhieuPosView["huyPhieuThe"] => ({ huyDuoc: false, ma, ...CAU_TU_CHOI_HUY_PHIEU_THE[ma] });

/**
 * Chốt NHẤT QUÁN của fixture (ghép Việc 3 × Việc 4, 10/10/2026). Sự cố: `[HN3-R10]`/`[HN3-R11]` dùng mặc định `huyDuoc: true` cho một phiếu mà máy
 * chủ chắc chắn trả `huyDuoc: false` — test nói về một trạng thái KHÔNG TỒN TẠI. Bất biến của view THẬT (đo ở `[HN4-12]` và `[HNG-N02]`):
 *   · `huyDuoc` ⇒ màn đang vẽ phiếu CHỜ QUẸT;
 *   · `huyDuoc` ⇒ phiếu không có yêu cầu "nhập sai mã" đang SỐNG (còn sống ⇒ `CO_YEU_CAU_SAI_MA`). VIỆC 6 · a2 (10/10/2026): yêu cầu đã bị TỪ CHỐI KHÔNG còn chặn —
 *     sau từ chối `huyDuoc: true` là giá trị THẬT (mã `SAI_MA_BI_TU_CHOI` đã gỡ); các ca sau từ chối dùng mặc định của `phieu()`.
 * Vi phạm thì NÉM ngay lúc dựng — không để hàm thuần của hộp âm thầm "đỡ" fixture sai.
 */
function kiemNhatQuan(v: PhieuPosView): PhieuPosView {
  if (v.huyPhieuThe.huyDuoc) {
    if (v.hienThi !== "CHO_QUET" && v.hienThi !== "THAT_BAI") {
      throw new Error(`fixture không nhất quán: huyDuoc:true nhưng hienThi=${v.hienThi} — ghi đè huyPhieuThe bằng khongHuy(<mã>)`);
    }
    if (v.saiMa !== null && v.saiMa.trangThai !== "TU_CHOI") {
      throw new Error(`fixture không nhất quán: huyDuoc:true nhưng đã có yêu cầu sai mã ĐANG SỐNG (${v.saiMa.trangThai}) — ghi đè bằng khongHuy("CO_YEU_CAU_SAI_MA")`);
    }
  }
  return v;
}

function phieu(p: Partial<PhieuPosView> = {}): PhieuPosView {
  const tao = new Date(BAY_GIO.getTime() - 2 * 60_000);
  return kiemNhatQuan({
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
    // GHÉP VIỆC 4: hình dạng của `PhieuPosView` nay có `huyPhieuThe`. Mặc định = đúng giá trị `dungPhieuPosView` dựng cho một phiếu CHỜ QUẸT
    // chưa có kết quả/chưa thấy giao dịch (huỷ được, cần tick). Ca nào mô phỏng trạng thái khác (đang chờ kế toán · vừa bị từ chối) ghi đè
    // bằng giá trị THẬT của trạng thái đó — không dùng mặc định này làm "trung tính".
    huyPhieuThe: { huyDuoc: true, canXacNhanManh: true },
    ...p,
  });
}

/** Phiếu sau khi sale bấm Kiểm tra và hệ thống nói "Chưa thấy". `phutTuLucTao` > 10 ⇒ "Báo admin" được mở. */
function phieuChuaThay(phutTuLucTao = 2, p: Partial<PhieuPosView> = {}): PhieuPosView {
  const tao = new Date(BAY_GIO.getTime() - phutTuLucTao * 60_000);
  return phieu({
    thongDiep: CAU_CHUA_THAY,
    mucDo: "canh_bao",
    ketQuaGanNhat: "NOT_FOUND",
    kiemLuc: vn(new Date(BAY_GIO.getTime() - 60_000)),
    taoLuc: vn(tao),
    hetHanLuc: vn(new Date(tao.getTime() + 24 * 3_600_000)),
    baoAdminTuLuc: vn(new Date(tao.getTime() + 10 * 60_000)),
    ...p,
  });
}

function phieuGop(p: Partial<PhieuGopView> = {}): PhieuGopView {
  return {
    billId: "b1",
    ma: "H6WR4",
    tongTien: 800_000,
    daNhan: 0,
    dong: [{ paymentRequestId: "pr3", installmentNo: 3, ten: "Đợt 3", soTien: 800_000 }],
    qrUrl: "https://img.vietqr.io/image/970407-0000-compact2.png?amount=800000",
    noiDungCk: "MAI 0910000101 H6WR4",
    theDangMo: "DANG_CHO",
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
    phieuGop: phieuGop(),
    duocThuThePos: true,
    phieuPos: phieuChuaThay(),
    mayPos: [{ id: "m1", nhan: "QTTFBKATK" }],
    khaiMay: { title: "Khai máy ở Cơ sở → Máy POS quẹt thẻ", href: null },
    ...p,
  };
}

function dung(p: Partial<Props> = {}) {
  const v = render(<PaymentRequestsSection {...props(p)} />);
  const lamMoi = (q: Partial<Props>) => v.rerender(<PaymentRequestsSection {...props(q)} />);
  return { ...v, lamMoi };
}

/** Mở hộp phiếu thẻ (bấm ô trên dòng đợt: 'Thẻ · đang chờ', hoặc 'Thẻ: chờ kế toán' khi phiếu đang chờ kế toán). */
async function moHop(p: Partial<Props> = {}, nutMo: RegExp = /Thẻ · đang chờ/) {
  const v = dung(p);
  fireEvent.click(screen.getByRole("button", { name: nutMo }));
  const hop = await screen.findByRole("dialog");
  return { ...v, hop };
}

const UV_TU_GHI = {
  bankTransactionId: "bt1",
  gioQuet: "2026-10-09T13:28:35+07:00",
  soTien: 800_000,
  soTheCuoi: "1234",
  ghiChu: "H6WR9",
  xemTruoc: { quyet: "TU_GHI_NHAN" as const, lyDo: [] },
};
const UV_CHO_KT = {
  bankTransactionId: "bt2",
  gioQuet: "2026-10-09T13:29:10+07:00",
  soTien: 800_000,
  soTheCuoi: null,
  ghiChu: "",
  xemTruoc: { quyet: "CHO_KE_TOAN" as const, lyDo: ["NHIEU_UNG_VIEN" as const] },
};
const ketQua = (ungVien: unknown[], p: Record<string, unknown> = {}) => ({
  ok: true,
  ungVien,
  conNua: false,
  soTien: 800_000,
  may: "QTTFBKATK",
  tuLuc: "2026-10-09T13:23:00+07:00",
  cau: ungVien.length === 0 ? CAU_KHONG_UNG_VIEN : null,
  ...p,
});

async function moBuoc(kq: unknown, p: Partial<Props> = {}) {
  h.timUngVienSaiMaAction.mockResolvedValue(kq);
  const v = await moHop(p);
  fireEvent.click(within(v.hop).getByRole("button", { name: NUT_MO }));
  return v;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BAY_GIO);
  vi.clearAllMocks();
  // Luật 18: một ca ĐỎ giữa chừng để lại hộp thoại trong <body>, ca sau đọc nhầm hộp cũ. RTL đã gỡ cây React ở afterEach ⇒ dọn <body> là an toàn.
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  h.timUngVienSaiMaAction.mockResolvedValue(ketQua([UV_TU_GHI, UV_CHO_KT]));
  h.guiSaiMaAction.mockResolvedValue({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận giao dịch 800.000đ vào đơn ORD-1." });
  h.baoAdminPhieuPosAction.mockResolvedValue({ ok: true, soNguoi: 2 });
});
afterEach(() => vi.useRealTimers());

describe("[HN3-R] nút 'Tôi nhập sai mã trên máy' chỉ hiện đúng lúc hệ thống nói 'Chưa thấy giao dịch'", () => {
  it("[HN3-R1] có câu 'Chưa thấy…' trên phiếu CHỜ QUẸT ⇒ có nút; mọi trường hợp khác ⇒ KHÔNG nút (kèm đối chứng dương)", async () => {
    const { hop, lamMoi } = await moHop();
    expect(within(hop).getByRole("button", { name: NUT_MO }), "ĐỐI CHỨNG DƯƠNG").toBeTruthy();
    expect(within(hop).getByText(/Dùng khi biên lai máy đã báo THÀNH CÔNG/)).toBeTruthy();

    const khongNut: Array<[string, PhieuPosView]> = [
      ["chưa kiểm lần nào (câu chờ quẹt)", phieu({ thongDiep: "Chờ khách quẹt thẻ — quẹt xong bấm Kiểm tra thanh toán." })],
      ["máy báo lần quẹt gần nhất THẤT BẠI (V62)", phieuChuaThay(2, { trangThai: "THAT_BAI", hienThi: "THAT_BAI" })],
      ["đã thu xong", phieuChuaThay(2, { trangThai: "DA_THU", hienThi: "DA_THU", huyPhieuThe: khongHuy("DA_THU") })],
      ["đang chờ kế toán", phieuChuaThay(2, { trangThai: "CAN_XU_LY", hienThi: "CAN_XU_LY", choKeToan: true, huyPhieuThe: khongHuy("CAN_XU_LY") })],
      ["phiếu hết hạn", phieuChuaThay(2, { trangThai: "HET_HAN", hienThi: "HET_HAN", huyPhieuThe: khongHuy("DA_HET_HAN") })],
    ];
    for (const [ten, p] of khongNut) {
      lamMoi({ phieuPos: p });
      expect(screen.queryByRole("button", { name: NUT_MO }), ten).toBeNull();
    }
    // Trở lại 'Chưa thấy' ⇒ nút có lại.
    lamMoi({ phieuPos: phieuChuaThay() });
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: NUT_MO })).toBeTruthy();
  });

  it("[HN3-R2] bấm nút ⇒ HỎI máy chủ đúng {orderId, intentId}; trong lúc chờ có trạng thái đang tìm (skeleton), không thẻ nào", async () => {
    let giai: (v: unknown) => void = () => undefined;
    h.timUngVienSaiMaAction.mockReturnValueOnce(new Promise((r) => (giai = r)));
    const { hop } = await moHop();
    fireEvent.click(within(hop).getByRole("button", { name: NUT_MO }));

    await waitFor(() => expect(h.timUngVienSaiMaAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1" }));
    expect(h.timUngVienSaiMaAction).toHaveBeenCalledTimes(1);
    expect(await within(hop).findByRole("status", { name: "Đang tìm giao dịch" })).toBeTruthy();
    expect(within(hop).getByText("Chọn giao dịch của khách")).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: NHAN_TU_GHI })).toBeNull();
    // KHÔNG gửi gì khi mới tìm.
    expect(h.guiSaiMaAction).not.toHaveBeenCalled();

    await act(async () => giai(ketQua([UV_TU_GHI])));
    expect(await within(hop).findByRole("button", { name: NHAN_TU_GHI })).toBeTruthy();
    expect(within(hop).queryByRole("status", { name: "Đang tìm giao dịch" })).toBeNull();
  });
});

describe("[HN3-R] danh sách ứng viên: thẻ xếp chồng, nhãn nút nói đúng điều SẮP xảy ra", () => {
  it("[HN3-R3] mỗi thẻ có giờ quẹt · số tiền · 4 số cuối · ghi chú đã nhập; nhãn theo bậc; lý do chỉ ở thẻ cần kế toán", async () => {
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, UV_CHO_KT]));
    const nutTu = await within(hop).findByRole("button", { name: NHAN_TU_GHI });
    const nutKt = within(hop).getByRole("button", { name: NHAN_GUI_KT });

    const theTu = nutTu.closest("li") as HTMLElement;
    expect(theTu.textContent, "giờ quẹt CÓ GIÂY — hai lần quẹt cùng phút chỉ khác nhau ở giây").toContain("13:28:35 09/10");
    expect(theTu.textContent).toContain("800.000");
    expect(within(theTu).getByText("…1234")).toBeTruthy();
    expect(theTu.textContent).toContain("“H6WR9”");
    expect(theTu.textContent, "bậc tự ghi nhận: không lý do").not.toMatch(/cần kế toán/);

    const theKt = nutKt.closest("li") as HTMLElement;
    expect(theKt.textContent).toContain("13:29:10 09/10");
    expect(within(theKt).getByText("(để trống)")).toBeTruthy();
    expect(theKt.textContent).toContain("Không rõ số thẻ");
    expect(theKt.textContent, "bậc chờ kế toán: có lý do").toContain("Có nhiều hơn một giao dịch cùng số tiền trên máy — cần kế toán chọn đúng giao dịch của khách.");

    // Mô tả bước nói rõ ba điều kiện lọc.
    expect(within(hop).getByText(/Chỉ hiện giao dịch THÀNH CÔNG, đúng 800\.000đ, trên máy QTTFBKATK, từ 13:23\./)).toBeTruthy();
    // Mã ĐÚNG của phiếu nằm ngay đầu bước để sale SO với ghi chú trên từng thẻ ("H6WR9" ≠ "H6WR4") — không phải nhớ từ màn trước.
    expect(within(hop).getByText(/Mã đúng của phiếu:/)).toBeTruthy();
    expect(within(hop).getByText("H6WR4").className, "mã đúng in dạng mono, nổi hơn chữ mô tả").toContain("font-mono");
  });

  it("[HN3-R19] mọi nút chọn cùng tên ⇒ MỖI nút có `aria-describedby` trỏ tới giờ + số tiền của CHÍNH thẻ chứa nó (người dùng trình đọc màn hình phân biệt được)", async () => {
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, UV_CHO_KT]));
    for (const [nhan, gio] of [
      [NHAN_TU_GHI, "13:28:35 09/10"],
      [NHAN_GUI_KT, "13:29:10 09/10"],
    ] as const) {
      const nut = await within(hop).findByRole("button", { name: nhan });
      const id = nut.getAttribute("aria-describedby");
      expect(id, `${nhan}: có aria-describedby`).toBeTruthy();
      const mota = document.getElementById(id!);
      expect(mota, `${nhan}: phần tử mô tả tồn tại`).toBeTruthy();
      expect(mota!.textContent).toContain(gio);
      expect(mota!.textContent).toContain("800.000");
      expect(nut.closest("li")!.contains(mota), "mô tả nằm TRONG thẻ của nút").toBe(true);
    }
    const ids = [...hop.querySelectorAll("li button")].map((b) => b.getAttribute("aria-describedby"));
    expect(new Set(ids).size, "mỗi thẻ một id riêng").toBe(2);
  });

  it("[HN3-R19b] nút 'Quay lại phiếu' đủ vùng chạm trên điện thoại (`h-11`, thu về `sm:h-9` ở màn rộng)", async () => {
    const { hop } = await moBuoc(ketQua([UV_TU_GHI]));
    const lui = within(hop).getByRole("button", { name: /Quay lại phiếu/ });
    expect(lui.className).toMatch(/\bh-11\b/);
    expect(lui.className).toMatch(/\bsm:h-9\b/);
  });

  it("[HN3-R4] chọn một giao dịch ⇒ gửi ĐÚNG {orderId, intentId, bankTransactionId}; thành công ⇒ toast.success + làm mới + về lại hộp phiếu", async () => {
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, UV_CHO_KT]));
    fireEvent.click(await within(hop).findByRole("button", { name: NHAN_TU_GHI }));

    await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledTimes(1));
    expect(h.guiSaiMaAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1", bankTransactionId: "bt1" });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Đã ghi nhận giao dịch 800.000đ vào đơn ORD-1."));
    expect(h.refresh).toHaveBeenCalled();
    // Bước chọn đã đóng: hộp phiếu trở lại.
    await waitFor(() => expect(within(screen.getByRole("dialog")).queryByText("Chọn giao dịch của khách")).toBeNull());
    expect(within(screen.getByRole("dialog")).getByText(/Thu thẻ POS —/)).toBeTruthy();
  });

  it("[HN3-R4b] gửi kế toán (CHO_DUYET) ⇒ thông điệp trung tính (toast.message), KHÔNG toast thành công", async () => {
    h.guiSaiMaAction.mockResolvedValue({ ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET", thongDiep: "Đã gửi kế toán xác nhận. ĐỪNG cho khách quẹt lại." });
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, UV_CHO_KT]));
    fireEvent.click(await within(hop).findByRole("button", { name: NHAN_GUI_KT }));
    await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1", bankTransactionId: "bt2" }));
    await waitFor(() => expect(h.message).toHaveBeenCalledWith("Đã gửi kế toán xác nhận. ĐỪNG cho khách quẹt lại."));
    expect(h.success).not.toHaveBeenCalled();
  });

  it("[HN3-R5] gửi bị từ chối ⇒ toast.error đúng câu của máy chủ, ở lại bước chọn và TẢI LẠI danh sách (đã cũ)", async () => {
    h.guiSaiMaAction.mockResolvedValue({ ok: false, error: "Giao dịch này đang được giữ cho phiếu khác — tải lại danh sách" });
    const { hop } = await moBuoc(ketQua([UV_TU_GHI]));
    fireEvent.click(await within(hop).findByRole("button", { name: NHAN_TU_GHI }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Giao dịch này đang được giữ cho phiếu khác — tải lại danh sách"));
    await waitFor(() => expect(h.timUngVienSaiMaAction).toHaveBeenCalledTimes(2));
    // Rà đối kháng Việc 3 [HN3-RV-07]: gửi thất bại LÀ tín hiệu trang đã cũ (phiếu đổi trạng thái, giao dịch bị giữ…) ⇒ lấy lại sự thật.
    // Bản đầu khẳng định NGƯỢC LẠI ("không làm mới trang") — ghim đúng cái lỗi: xem `[HN3-RV-07]`.
    expect(h.refresh, "gửi thất bại ⇒ làm mới trang một lần").toHaveBeenCalledTimes(1);
    expect(within(hop).getByText("Chọn giao dịch của khách")).toBeTruthy();
    expect(await within(hop).findByRole("button", { name: NHAN_TU_GHI })).toBeTruthy();
  });

  it("[HN3-RV-07] máy chủ đã GIỮ giao dịch rồi mới ném ở pha tiền (LOI_CHUA_XONG) ⇒ trang được LÀM MỚI; câu cấm quẹt lại không chỉ nằm trong toast", async () => {
    const LOI_CHUA_XONG = "Hệ thống chưa ghi nhận xong giao dịch này — đã báo kế toán thử lại. ĐỪNG cho khách quẹt lại.";
    h.guiSaiMaAction.mockResolvedValue({ ok: false, error: LOI_CHUA_XONG });
    const { hop } = await moBuoc(ketQua([UV_TU_GHI]));
    expect(h.refresh).not.toHaveBeenCalled();
    fireEvent.click(await within(hop).findByRole("button", { name: NHAN_TU_GHI }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith(LOI_CHUA_XONG));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    // Hai nhánh anh em đã tự làm mới từ trước: rớt kết nối (res === null) — xem [HN3-R20] — và gửi thành công.
  });

  it("[HN3-R6] ĐANG GỬI: mọi nút chọn bị khoá, 'Quay lại phiếu' khoá, Escape KHÔNG đóng hộp (tránh bấm đúp / bỏ giữa chừng)", async () => {
    let giai: (v: unknown) => void = () => undefined;
    h.guiSaiMaAction.mockReturnValueOnce(new Promise((r) => (giai = r)));
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, UV_CHO_KT]));
    const nutTu = await within(hop).findByRole("button", { name: NHAN_TU_GHI });
    fireEvent.click(nutTu);
    await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledTimes(1));

    expect((within(hop).getByRole("button", { name: NHAN_GUI_KT }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(hop).getByRole("button", { name: NHAN_TU_GHI }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(hop).getByRole("button", { name: /Quay lại phiếu/ }) as HTMLButtonElement).disabled).toBe(true);
    // Bấm lại lúc đang gửi KHÔNG gửi thêm lần nào.
    fireEvent.click(within(hop).getByRole("button", { name: NHAN_TU_GHI }));
    fireEvent.keyDown(hop, { key: "Escape" });
    expect(screen.getByRole("dialog"), "Escape lúc đang gửi không đóng hộp").toBeTruthy();
    expect(h.guiSaiMaAction).toHaveBeenCalledTimes(1);

    await act(async () => giai({ ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN", thongDiep: "Đã ghi nhận." }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Đã ghi nhận."));
  });
});

describe("[HN3-R] không ứng viên · lỗi tìm · 'Báo admin' SẴN CÓ", () => {
  it("[HN3-R7] KHÔNG ứng viên ⇒ câu NGUYÊN VĂN của chủ dự án; chưa đủ 10 phút ⇒ KHÔNG 'Báo admin'; ≥ 10 phút ⇒ có và gọi action SẴN CÓ", async () => {
    const { hop, unmount } = await moBuoc(ketQua([]), { phieuPos: phieuChuaThay(2) });
    expect(await within(hop).findByText(CAU_KHONG_UNG_VIEN)).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: NHAN_TU_GHI })).toBeNull();
    expect(within(hop).queryByRole("button", { name: NHAN_GUI_KT })).toBeNull();
    expect(within(hop).queryByRole("button", { name: "Báo admin" }), "chưa đủ 10 phút").toBeNull();
    unmount();
    cleanupDialog();

    const v2 = await moBuoc(ketQua([]), { phieuPos: phieuChuaThay(30) });
    expect(await within(v2.hop).findByText(CAU_KHONG_UNG_VIEN)).toBeTruthy();
    fireEvent.click(within(v2.hop).getByRole("button", { name: "Báo admin" }));
    await waitFor(() => expect(h.baoAdminPhieuPosAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1" }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Đã báo 2 người (Kế toán HO / Quản trị)"));
  });

  it("[HN5-U2] danh sách trống VÌ giao dịch đã bị kế toán bác ⇒ hộp CẢNH BÁO (không phải thông tin) mang câu cấm quẹt lại; đối chứng: trống thường ⇒ hộp thông tin, câu đặc tả", async () => {
    // Mã TRƯỚC (rà đối kháng Việc 5): cùng hộp thông tin xám với câu "Không thấy giao dịch nào…" cho cả hai ca — một lệnh CẤM nằm ở tông trung tính.
    const CAU_BAC = "Có giao dịch đúng số tiền, nhưng kế toán đã từ chối nó cho đơn này. Khách có thể đã bị trừ tiền — ĐỪNG cho khách quẹt lại, báo kế toán.";
    const { hop, unmount } = await moBuoc(ketQua([], { cau: CAU_BAC }), { phieuPos: phieuChuaThay(2, { donDaCoVetBac: true }) });
    const cau = await within(hop).findByText(CAU_BAC);
    expect(cau.closest("div")?.className, "tông cảnh báo").toMatch(/state-warning/);
    expect(within(hop).queryByText(CAU_KHONG_UNG_VIEN), "KHÔNG nói \"không thấy\" khi CÓ").toBeNull();
    unmount();
    cleanupDialog();

    const v2 = await moBuoc(ketQua([]), { phieuPos: phieuChuaThay(2) });
    const thuong = await within(v2.hop).findByText(CAU_KHONG_UNG_VIEN);
    expect(thuong.closest("div")?.className, "đối chứng: tông thông tin").not.toMatch(/state-warning/);
  });

  it("[HN3-R8] máy chủ từ chối bước TÌM ⇒ hộp cảnh báo đúng câu lỗi, không thẻ nào; 'Quay lại phiếu' đóng bước", async () => {
    const { hop } = await moBuoc({ ok: false, error: "Phiếu thu thẻ đã hết hạn — tạo phiếu mới nếu cần thu" });
    expect(await within(hop).findByText("Phiếu thu thẻ đã hết hạn — tạo phiếu mới nếu cần thu")).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: NHAN_TU_GHI })).toBeNull();
    fireEvent.click(within(hop).getByRole("button", { name: /Quay lại phiếu/ }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).queryByText("Chọn giao dịch của khách")).toBeNull());
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: NUT_MO }), "về lại hộp phiếu, nút còn đó").toBeTruthy();
  });

  it("[HN3-R9] KHÔNG chữ nào trong bước chọn hướng dẫn huỷ giao dịch trên máy — ở MỌI trạng thái (đang tìm · danh sách · trống · lỗi)", async () => {
    let giai: (v: unknown) => void = () => undefined;
    h.timUngVienSaiMaAction.mockReturnValueOnce(new Promise((r) => (giai = r)));
    const { hop } = await moHop();
    fireEvent.click(within(hop).getByRole("button", { name: NUT_MO }));
    await within(hop).findByRole("status", { name: "Đang tìm giao dịch" });
    expect(hop.textContent, "đang tìm").not.toMatch(KHONG_HUY);

    await act(async () => giai(ketQua([UV_TU_GHI, UV_CHO_KT])));
    await within(hop).findByRole("button", { name: NHAN_TU_GHI });
    expect(hop.textContent, "danh sách").not.toMatch(KHONG_HUY);

    h.timUngVienSaiMaAction.mockResolvedValue(ketQua([]));
    fireEvent.click(within(hop).getByRole("button", { name: /Quay lại phiếu/ }));
    fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: NUT_MO }));
    await within(hop).findByText(CAU_KHONG_UNG_VIEN);
    expect(hop.textContent, "không ứng viên").not.toMatch(KHONG_HUY);

    h.timUngVienSaiMaAction.mockResolvedValue({ ok: false, error: "Không có quyền" });
    fireEvent.click(within(hop).getByRole("button", { name: /Quay lại phiếu/ }));
    fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: NUT_MO }));
    await within(hop).findByText("Không có quyền");
    expect(hop.textContent, "lỗi").not.toMatch(KHONG_HUY);
  });
});

describe("[HN3-R] trạng thái của phiếu sau khi gửi / sau khi kế toán từ chối", () => {
  it("[HN3-R10] đã gửi kế toán ⇒ hộp nói 'Chờ kế toán xác nhận giao dịch nhập sai mã…'; KHÔNG nút 'Tôi nhập sai mã' (đã có yêu cầu)", async () => {
    const { hop } = await moHop(
      {
        phieuGop: phieuGop({ theDangMo: "CHO_KE_TOAN" }),
        phieuPos: phieuChuaThay(2, {
          trangThai: "CAN_XU_LY",
          hienThi: "CAN_XU_LY",
          choKeToan: true,
          thongDiep: CAU_CHO_KE_TOAN,
          saiMa: { trangThai: "CHO_DUYET", hieuLuc: "CHO_DUYET", lyDoTuChoi: null },
          // Giá trị THẬT máy chủ dựng cho phiếu CAN_XU_LY (không dùng mặc định `huyDuoc: true` — xem `kiemNhatQuan`).
          huyPhieuThe: khongHuy("CAN_XU_LY"),
        }),
      },
      /Thẻ: chờ kế toán/,
    );
    expect(within(hop).getByText(CAU_CHO_KE_TOAN)).toBeTruthy();
    expect(within(hop).getByText(/^Chờ kế toán xác nhận giao dịch nhập sai mã/)).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: NUT_MO })).toBeNull();
    expect(hop.textContent).not.toMatch(KHONG_HUY);
  });

  it("[HN3-R11] kế toán TỪ CHỐI ⇒ dòng RIÊNG đọc từ yêu cầu (kèm lý do) · ẨN hướng dẫn quẹt lại · câu LƯU 'Chưa thấy' không che nó", async () => {
    // VIỆC 6 · a2: `huyPhieuThe` THẬT sau từ chối = mặc định `huyDuoc: true` (mã `SAI_MA_BI_TU_CHOI` đã gỡ) — nên hộp CÓ nút "Huỷ phiếu thẻ" (chữ "huỷ" duy nhất của hộp) và
    // KHÔNG có dòng "Chưa huỷ được…". Hộp vẫn chỉ MỘT lệnh cấm quẹt lại và KHÔNG mời quẹt.
    const tuChoi = phieuChuaThay(2, {
      saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: "Giao dịch của khách khác" },
    });
    const { hop, lamMoi } = await moHop({ phieuPos: tuChoi });

    const canh = within(hop).getByRole("alert");
    expect(canh.textContent).toContain("Kế toán không xác nhận giao dịch đã chọn (lý do: Giao dịch của khách khác).");
    expect(canh.textContent).toContain("ĐỪNG cho khách quẹt lại, báo kế toán.");
    expect(within(hop).queryByText("Nhập số tiền vào máy."), "ẩn bốn bước hướng dẫn").toBeNull();
    expect(within(hop).queryByText(CAU_CUNG_MA)).toBeNull();
    // Câu lưu cũ ('Chưa thấy…') vẫn hiện như một dòng trạng thái thường — nhưng dòng từ chối đã có mặt và nổi bật (role=alert).
    expect(within(hop).getByText(CAU_CHUA_THAY)).toBeTruthy();
    // VIỆC 6: nút huỷ PHIẾU THẺ quay lại; ngoài nhãn của nút ấy KHÔNG chữ "huỷ" nào (đặc tả Việc 3 điều 6: không hướng dẫn huỷ giao dịch trên máy rồi quẹt lại).
    expect(within(hop).getByRole("button", { name: NUT_HUY_PHIEU_THE }), "sau từ chối nút huỷ phiếu thẻ HIỆN").toBeTruthy();
    expect(within(hop).queryByText(/^Chưa huỷ được phiếu thẻ/), "…và không có dòng lý do thứ hai").toBeNull();
    expect(chuHuyNgoaiNut(hop)).not.toMatch(KHONG_HUY);

    // ĐỐI CHỨNG DƯƠNG: cùng phiếu KHÔNG bị từ chối ⇒ có đủ bốn bước, không dòng cảnh báo.
    lamMoi({ phieuPos: phieuChuaThay(2) });
    expect(within(screen.getByRole("dialog")).getByText("Nhập số tiền vào máy.")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText(CAU_CUNG_MA)).toBeTruthy();
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });

  it("[HN3-R11b] câu LƯU của phiếu vừa bị từ chối TRÙNG dòng cảnh báo ⇒ chỉ in MỘT lần (smoke 375px đo bản đầu in hai lần liền nhau)", async () => {
    const cau =
      "Kế toán không xác nhận giao dịch đã chọn (lý do: Giao dịch của khách khác). Khách có thể đã bị trừ tiền — ĐỪNG cho khách quẹt lại, báo kế toán.";
    const { hop, lamMoi } = await moHop({
      phieuPos: phieu({
        thongDiep: cau,
        ketQuaGanNhat: "NOT_FOUND",
        saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: "Giao dịch của khách khác" },
      }),
    });
    expect(within(hop).getAllByText(cau), "đúng MỘT bản").toHaveLength(1);
    expect(within(hop).getByRole("alert").textContent, "bản duy nhất là dòng cảnh báo riêng").toBe(cau);

    // ĐỐI CHỨNG DƯƠNG: câu lưu KHÁC câu từ chối (poller đã ghi đè) ⇒ vẫn hiện, bên cạnh dòng cảnh báo.
    lamMoi({
      phieuPos: phieu({
        thongDiep: CAU_CHUA_THAY,
        ketQuaGanNhat: "NOT_FOUND",
        saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: "Giao dịch của khách khác" },
      }),
    });
    const hop2 = screen.getByRole("dialog");
    expect(within(hop2).getByText(CAU_CHUA_THAY)).toBeTruthy();
    expect(within(hop2).getByRole("alert").textContent).toBe(cau);
    // ĐỐI CHỨNG: lý do KHÁC ⇒ câu lưu cũ (lý do cũ) KHÔNG trùng dòng mới ⇒ hiện cả hai (không giấu nhầm câu khác nội dung).
    lamMoi({
      phieuPos: phieu({
        thongDiep: cau,
        ketQuaGanNhat: "NOT_FOUND",
        saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: "Lý do khác hẳn" },
      }),
    });
    expect(within(screen.getByRole("dialog")).getAllByText(/Kế toán không xác nhận giao dịch đã chọn/)).toHaveLength(2);
  });

  it("[HN5-U1] phiếu thẻ MỚI của đơn từng có giao dịch bị bác (saiMa = null, donDaCoVetBac) ⇒ MỘT dòng cảnh báo; vẫn đủ bốn bước, vẫn có nút; đơn sạch ⇒ không dòng nào; phiếu có dòng từ chối riêng ⇒ không in thêm", async () => {
    // Mã TRƯỚC (rà đối kháng Việc 5, R-5a): hộp phiếu mới không biết đơn từng có giao dịch bị bác — chỉ đọc `saiMa` của CHÍNH phiếu — nên mời quẹt không kèm lời nhắc nào.
    const { hop, lamMoi } = await moHop({ phieuPos: phieuChuaThay(2, { donDaCoVetBac: true }) });
    expect(within(hop).getAllByRole("alert"), "đúng MỘT cảnh báo").toHaveLength(1);
    expect(within(hop).getByRole("alert").textContent).toBe(CAU_DON_DA_CO_VET_BAC);
    expect(within(hop).getByText("Nhập số tiền vào máy."), "KHÔNG giấu hướng dẫn quẹt (cờ theo ĐƠN, phiếu này có thể chưa quẹt)").toBeTruthy();
    expect(within(hop).getByRole("button", { name: NUT_MO }), "nút Tôi nhập sai mã vẫn hiện").toBeTruthy();

    // ĐỐI CHỨNG DƯƠNG: đơn sạch ⇒ không cảnh báo.
    lamMoi({ phieuPos: phieuChuaThay(2, { donDaCoVetBac: false }) });
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();

    // Phiếu có dòng từ chối RIÊNG + cờ đơn ⇒ chỉ dòng từ chối riêng (không hai lệnh cấm liền nhau).
    lamMoi({
      phieuPos: phieuChuaThay(2, {
        donDaCoVetBac: true,
        saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: "Giao dịch của khách khác" },
      }),
    });
    const hop3 = screen.getByRole("dialog");
    expect(within(hop3).getAllByRole("alert")).toHaveLength(1);
    expect(within(hop3).queryByText(CAU_DON_DA_CO_VET_BAC)).toBeNull();
  });

  it("[HN3-R12] từ chối KHÔNG lý do (dữ liệu cũ) vẫn in được dòng lệnh cấm quẹt lại", async () => {
    const { hop } = await moHop({
      phieuPos: phieuChuaThay(2, {
        saiMa: { trangThai: "TU_CHOI", hieuLuc: "TU_CHOI", lyDoTuChoi: null },
      }),
    });
    const canh = within(hop).getByRole("alert");
    expect(canh.textContent).toContain("Kế toán không xác nhận giao dịch đã chọn. ");
    expect(canh.textContent).not.toContain("lý do:");
    expect(canh.textContent).toContain("ĐỪNG cho khách quẹt lại");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LƯỢT HOÀN THIỆN GIAO DIỆN (U · 09/10/2026) — viết SAU rà cuối của lượt đầu. Mỗi ca ghi rõ "đỏ trước" hay "viết sau mã":
//   · ĐỎ TRƯỚC khi vá (đo trên bốn tệp UI của lượt đầu — §5.10(e)): [HN3-R3] (mã đúng + giây) · [HN3-R14] [HN3-R14b] (câu Kiểm tra cũ sống sót
//     qua `router.refresh()`) · [HN3-R16] [HN3-R16b] (ứng viên khác tiền / bước trống) · [HN3-R17] (ghi chú: điều hướng hai chiều + độ dài) ·
//     [HN3-R19] [HN3-R19b] (a11y + 44px) · [HN3-R20] [HN3-R21] (rớt kết nối) · [HN3-R22] (gộp lý do chung).
//   · XANH NGAY (hành vi đã đúng từ lượt đầu, ca này KHÓA nó; bằng chứng "cắn" là bảng cấy lỗi §5.10(f)): [HN3-R13] [HN3-R14c] [HN3-R15] [HN3-R15b]
//     [HN3-R17b] [HN3-R18] và ca đối chứng của [HN3-R22].
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const CAU_GUI_KT = "Đã gửi kế toán xác nhận. ĐỪNG cho khách quẹt lại.";
const CAU_DA_GHI = "Đã ghi nhận giao dịch 800.000đ vào đơn ORD-1.";
const CAU_DA_THU = "Đã thu 800.000đ lúc 13:35 — đã ghi nhận, chờ kế toán xác nhận.";

/** Kết quả của `kiemTraPhieuPosAction` cho MỘT kết luận — câu dựng bằng `thongDiepPos` THẬT, không gõ tay. */
function kiemRa(k: KetLuanPos) {
  const { cau, mucDo } = thongDiepPos(k);
  return {
    cau,
    res: {
      ok: true,
      ketQua: { status: "CHO_QUET", doiTrangThai: false, thongDiep: cau, mucDo, ketLuan: null, tuCache: false, kiemLuc: "2026-10-09T13:29:00+07:00" },
    },
  };
}

const TAO_LUC = new Date(BAY_GIO.getTime() - 2 * 60_000);
const LUC_DL = new Date(BAY_GIO.getTime() - 60_000);
const CHUA_THAY_KL: KetLuanPos = {
  loai: "CHUA_THAY",
  code5: "H6WR4",
  duLieuLuc: LUC_DL,
  gdMoiNhatLuc: LUC_DL,
  taoLuc: TAO_LUC,
  baoAdminTuLuc: new Date(TAO_LUC.getTime() + 10 * 60_000),
};

/** Phiếu SAU khi sale gửi kế toán, đúng như máy chủ dựng lại (CAN_XU_LY + câu theo yêu cầu + dòng yêu cầu CHO_DUYET). */
const phieuChoKeToan = () =>
  phieuChuaThay(2, {
    trangThai: "CAN_XU_LY",
    hienThi: "CAN_XU_LY",
    choKeToan: true,
    thongDiep: CAU_CHO_KE_TOAN,
    mucDo: "canh_bao",
    saiMa: { trangThai: "CHO_DUYET", hieuLuc: "CHO_DUYET", lyDoTuChoi: null },
    huyPhieuThe: khongHuy("CAN_XU_LY"),
  });
/** Phiếu SAU khi ghi tiền xong (sale tự ghi nhận, hoặc kế toán đã duyệt). */
const phieuDaThu = () =>
  phieuChuaThay(2, {
    trangThai: "DA_THU",
    hienThi: "DA_THU",
    thongDiep: CAU_DA_THU,
    mucDo: "thanh_cong",
    soTienPhaiThu: null,
    saiMa: { trangThai: "DA_GHI_NHAN", hieuLuc: "DA_GHI_NHAN", lyDoTuChoi: null },
    huyPhieuThe: khongHuy("DA_THU"),
  });

describe("[HN3-R] 'đo biến kết quả THẬT': nút đi theo CÂU đang hiện trên hộp — kể cả câu của lượt Kiểm tra VỪA bấm", () => {
  it("[HN3-R13] bấm Kiểm tra: CHỈ câu 'Chưa thấy giao dịch' (3 biến thể của CHUA_THAY) mở nút; MỌI kết luận khác của `thongDiepPos` thì không", async () => {
    const khong: KetLuanPos[] = [
      { loai: "DA_THU", soTien: 800_000, luc: LUC_DL, daGhiTruoc: false, giaoDichKhac: 0 },
      { loai: "LECH_TIEN", soTienMay: 799_000, soTienPhieu: 800_000 },
      { loai: "CAN_XU_LY", soTienMay: 800_000, lyDo: "máy chưa khai" },
      { loai: "THAT_BAI", maLoi: "THAT_BAI", nhom: "THAT_BAI_RO" },
      { loai: "HUY_SAU_THU", soTien: 800_000 },
      // `lastResultKind = NOT_FOUND` bao BỐN kết luận — ba kết luận còn lại KHÔNG phải "Chưa thấy" (V63):
      { loai: "DANG_CHO_NGAN_HANG", code5: "H6WR4", maTrangThai: "Đang xử lý", cheDo: "FILE" },
      { loai: "DANG_CHO_NGAN_HANG", code5: "H6WR4", maTrangThai: "Đang xử lý", cheDo: "AGENT" },
      { loai: "DANG_DONG_BO", code5: "H6WR4" },
      { loai: "MAY_KHONG_DOC_DUOC", code5: "H6WR4" },
      { loai: "LOI_KET_NOI", maLoi: "CHUA_CAP_API" },
      { loai: "CHUA_XAC_DINH" },
      { loai: "TCB_TAM_MAT_KET_NOI", coSo: "CS1", lyDo: "HET_PHIEN", maLoi: "SESSION_EXPIRED" },
    ];
    const co: KetLuanPos[] = [
      CHUA_THAY_KL,
      { ...CHUA_THAY_KL, cheDo: "AGENT" },
      { ...CHUA_THAY_KL, duLieuLuc: null, gdMoiNhatLuc: null }, // chưa có dữ liệu nào ⇒ câu có thêm lệnh 'ĐỪNG quẹt lại'
    ];
    const { hop } = await moHop({ phieuPos: phieu() });
    expect(within(hop).queryByRole("button", { name: NUT_MO }), "chưa kiểm lần nào").toBeNull();

    const kiem = async (k: KetLuanPos) => {
      const { cau, res } = kiemRa(k);
      h.kiemTraPhieuPosAction.mockResolvedValueOnce(res);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Kiểm tra thanh toán" }));
      await within(screen.getByRole("dialog")).findByText(cau);
      return cau;
    };

    // Đan xen có/không để nút phải BẬT rồi TẮT theo đúng câu vừa hiện (không "nhớ" lần trước).
    for (const [i, k] of co.entries()) {
      await kiem(k);
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: NUT_MO }), `CHUA_THAY #${i}`).toBeTruthy();
      const kh = khong[i]!;
      await kiem(kh);
      expect(within(screen.getByRole("dialog")).queryByRole("button", { name: NUT_MO }), `${kh.loai} (sau CHUA_THAY #${i})`).toBeNull();
    }
    for (const kh of khong) {
      await kiem(kh);
      expect(within(screen.getByRole("dialog")).queryByRole("button", { name: NUT_MO }), kh.loai).toBeNull();
    }
    // Đối chứng dương chốt: sau chuỗi dài, một câu 'Chưa thấy' lại mở nút.
    await kiem(CHUA_THAY_KL);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: NUT_MO })).toBeTruthy();
  });
});

describe("[HN3-R] sau khi GỬI thành công: `router.refresh()` KHÔNG reset state ⇒ câu của lượt Kiểm tra cũ không được sống sót", () => {
  // Cảnh THẬT ở quầy: sale bấm Kiểm tra ("Chưa thấy…") → "Tôi nhập sai mã" → chọn → gửi → trang làm mới. `vuaKiem` là useState của
  // hộp (hộp KHÔNG đóng sau khi gửi) nên nó sống qua `router.refresh()`; nếu `ketQuaHienThi` vẫn ưu tiên nó thì hộp tiếp tục in
  // "Chưa thấy…" ngay cả khi phiếu đã `CAN_XU_LY`/`DA_THU` — và trong lúc chờ làm mới, câu LƯU "Chưa thấy…" còn nguyên + trạng thái
  // CHO_QUET sẽ bật lại cả nút lẫn bốn bước mời quẹt. Mỗi ca khoá ba mốc: (b) trước khi dữ liệu mới về · (a) khi về · (c) lần đổi sau nữa.
  async function toiBuocGui(res: unknown, nhanNut: string) {
    h.kiemTraPhieuPosAction.mockResolvedValue(kiemRa(CHUA_THAY_KL).res);
    h.timUngVienSaiMaAction.mockResolvedValue(ketQua([UV_TU_GHI, UV_CHO_KT]));
    h.guiSaiMaAction.mockResolvedValue(res);
    const v = await moHop({ phieuPos: phieu() });
    fireEvent.click(within(v.hop).getByRole("button", { name: "Kiểm tra thanh toán" }));
    const cauChuaThay = kiemRa(CHUA_THAY_KL).cau;
    await within(v.hop).findByText(cauChuaThay);
    // Máy chủ làm mới trang sau Kiểm tra: câu LƯU = câu vừa kiểm.
    v.lamMoi({ phieuPos: phieuChuaThay(2, { thongDiep: cauChuaThay }) });
    fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: NUT_MO }));
    fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: nhanNut }));
    return { v, cauChuaThay };
  }

  it("[HN3-R14] gửi kế toán: (b) chưa có dữ liệu mới ⇒ câu của máy chủ, KHÔNG 'Chưa thấy', KHÔNG nút, KHÔNG bốn bước · (a) dữ liệu mới về ⇒ 'Chờ kế toán xác nhận giao dịch nhập sai mã' · (c) kế toán duyệt ⇒ câu mới", async () => {
    const { v, cauChuaThay } = await toiBuocGui(
      { ok: true, kieu: "CHO_KE_TOAN", trangThai: "CHO_DUYET", thongDiep: CAU_GUI_KT },
      NHAN_GUI_KT,
    );
    await waitFor(() => expect(h.message).toHaveBeenCalledWith(CAU_GUI_KT));
    await waitFor(() => expect(within(screen.getByRole("dialog")).queryByText("Chọn giao dịch của khách")).toBeNull());
    expect(h.refresh).toHaveBeenCalled();

    // (b) props CHƯA đổi (máy chủ chưa trả trang): vẫn CHO_QUET + câu lưu 'Chưa thấy…'.
    const hopB = screen.getByRole("dialog");
    expect(within(hopB).queryByText(cauChuaThay), "(b) câu cũ phải biến mất").toBeNull();
    expect(within(hopB).queryByRole("button", { name: NUT_MO }), "(b) nút KHÔNG bật lại — sale có thể bấm lần hai").toBeNull();
    expect(within(hopB).queryByText("Nhập số tiền vào máy."), "(b) KHÔNG mời quẹt trong lúc chờ làm mới").toBeNull();
    expect(within(hopB).getByText(CAU_GUI_KT), "(b) câu máy chủ vừa trả").toBeTruthy();
    // GHÉP Việc 4: props còn CHO_QUET + `huyDuoc: true` (tính ở lượt tải trước) nhưng khách ĐÃ quẹt xong và phiếu thật đã sang CAN_XU_LY ⇒ nút "Huỷ phiếu thẻ"
    // KHÔNG được có mặt (không chỉ khoá): đúng cửa sổ nguy hiểm nhất — sale thấy một nút huỷ sáng cạnh câu "ĐỪNG cho khách quẹt lại". Mã TRƯỚC ghép: nút còn sáng.
    expect(within(hopB).queryByRole("button", { name: "Huỷ phiếu thẻ" }), "(b) nút huỷ phiếu thẻ KHÔNG có mặt trong cửa sổ vừa gửi").toBeNull();
    expect(within(hopB).queryByText(/Chưa huỷ được phiếu thẻ/), "(b) cũng không dòng 'Chưa huỷ được' thừa").toBeNull();

    // (a) trang mới về.
    v.lamMoi({ phieuPos: phieuChoKeToan(), phieuGop: phieuGop({ theDangMo: "CHO_KE_TOAN" }) });
    const hopA = screen.getByRole("dialog");
    expect(within(hopA).getByText(CAU_CHO_KE_TOAN)).toBeTruthy();
    expect(within(hopA).getByText(/^Chờ kế toán xác nhận giao dịch nhập sai mã/)).toBeTruthy();
    expect(within(hopA).queryByText(cauChuaThay), "(a) 'Chưa thấy' đã hết").toBeNull();
    expect(within(hopA).queryByText(CAU_GUI_KT), "(a) câu tạm không sống lâu hơn dữ liệu").toBeNull();
    expect(within(hopA).queryByRole("button", { name: NUT_MO })).toBeNull();

    // (c) kế toán duyệt ⇒ phiếu DA_THU: câu mới, không bị câu cũ nào che.
    v.lamMoi({ phieuPos: phieuDaThu(), phieuGop: phieuGop({ theDangMo: null }) });
    const hopC = screen.getByRole("dialog");
    expect(within(hopC).getByText(CAU_DA_THU)).toBeTruthy();
    expect(within(hopC).queryByText(CAU_CHO_KE_TOAN)).toBeNull();
    expect(within(hopC).queryByText(cauChuaThay)).toBeNull();
  });

  it("[HN3-R14b] tự ghi nhận (bậc 1): (b) câu 'Đã ghi nhận…' tông THÀNH CÔNG, không 'Chưa thấy' · (a) phiếu DA_THU ⇒ câu thu tiền", async () => {
    const { v, cauChuaThay } = await toiBuocGui(
      { ok: true, kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN", thongDiep: CAU_DA_GHI },
      NHAN_TU_GHI,
    );
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(CAU_DA_GHI));
    await waitFor(() => expect(within(screen.getByRole("dialog")).queryByText("Chọn giao dịch của khách")).toBeNull());

    const hopB = screen.getByRole("dialog");
    expect(within(hopB).queryByText(cauChuaThay)).toBeNull();
    expect(within(hopB).queryByRole("button", { name: NUT_MO })).toBeNull();
    expect(within(hopB).queryByRole("button", { name: "Huỷ phiếu thẻ" }), "(b) tự ghi nhận xong ⇒ khách ĐÃ quẹt ⇒ không nút huỷ phiếu thẻ").toBeNull();
    expect(within(hopB).queryByText("Nhập số tiền vào máy.")).toBeNull();
    const dong = within(hopB).getByText(CAU_DA_GHI).closest("div.rounded-lg") as HTMLElement;
    expect(dong.className, "thành công ⇒ tông xanh").toContain("state-success");

    v.lamMoi({ phieuPos: phieuDaThu(), phieuGop: phieuGop({ theDangMo: null }) });
    const hopA = screen.getByRole("dialog");
    expect(within(hopA).getByText(CAU_DA_THU)).toBeTruthy();
    expect(within(hopA).queryByText(CAU_DA_GHI), "câu tạm không sống lâu hơn dữ liệu").toBeNull();
    expect(within(hopA).queryByText(cauChuaThay)).toBeNull();
  });

  it("[HN3-R14c] gửi THẤT BẠI ⇒ KHÔNG đổi câu: câu 'Chưa thấy' và nút vẫn đó (không câu tạm nào bịa ra khi máy chủ từ chối)", async () => {
    const { cauChuaThay } = await toiBuocGui({ ok: false, error: "Giao dịch này đang được giữ cho phiếu khác — tải lại danh sách" }, NHAN_TU_GHI);
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Giao dịch này đang được giữ cho phiếu khác — tải lại danh sách"));
    const hop = screen.getByRole("dialog");
    // Vẫn ở bước chọn: danh sách được TẢI LẠI (lần hai) rồi mới mở khoá "Quay lại phiếu"; quay lại thì câu cũ còn nguyên.
    await waitFor(() => expect(h.timUngVienSaiMaAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((within(hop).getByRole("button", { name: /Quay lại phiếu/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(hop).getByRole("button", { name: /Quay lại phiếu/ }));
    const hopPhieu = await screen.findByRole("dialog");
    expect(await within(hopPhieu).findByText(cauChuaThay)).toBeTruthy();
    expect(within(hopPhieu).getByRole("button", { name: NUT_MO })).toBeTruthy();
    expect(within(hopPhieu).queryByText(CAU_GUI_KT)).toBeNull();
  });
});

describe("[HN3-R] bước xác nhận: MỖI giao dịch một nút, không gì tự gửi", () => {
  it("[HN3-R15] đúng MỘT ứng viên (bậc tự ghi nhận HOẶC bậc chờ kế toán) ⇒ vẫn chờ sale bấm; không gửi lúc mở bước, không gửi lúc danh sách về", async () => {
    for (const [uv, nhan] of [
      [UV_TU_GHI, NHAN_TU_GHI],
      [UV_CHO_KT, NHAN_GUI_KT],
    ] as const) {
      h.guiSaiMaAction.mockClear();
      const { hop, unmount } = await moBuoc(ketQua([uv]));
      const nut = await within(hop).findByRole("button", { name: nhan });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40)); // cho mọi microtask/timer sau khi danh sách về chạy hết
      });
      expect(h.guiSaiMaAction, `${nhan}: chưa bấm ⇒ chưa gửi`).not.toHaveBeenCalled();
      expect(within(hop).getByText("Chọn giao dịch của khách"), "vẫn ở bước chọn").toBeTruthy();
      fireEvent.click(nut);
      await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledTimes(1));
      expect(h.guiSaiMaAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1", bankTransactionId: uv.bankTransactionId });
      unmount();
      cleanupDialog();
    }
  });

  it("[HN3-R15b] hai ứng viên ⇒ mỗi nút gửi ĐÚNG giao dịch của thẻ chứa nó (không nút nào gửi thay thẻ khác)", async () => {
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, UV_CHO_KT]));
    fireEvent.click(await within(hop).findByRole("button", { name: NHAN_GUI_KT }));
    await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledTimes(1));
    expect(h.guiSaiMaAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1", bankTransactionId: "bt2" });
  });
});

describe("[HN3-R22] mật độ ở 375px: lý do CHUNG của mọi thẻ in MỘT lần trên đầu danh sách, mỗi thẻ chỉ in lý do RIÊNG của nó", () => {
  // Đo ở vòng duyệt trình duyệt thật (09/10/2026): ba thẻ cùng "Có nhiều hơn một giao dịch cùng số tiền…" — ba đoạn cam GIỐNG HỆT, mỗi thẻ cao ~210px.
  const CAU_NHIEU = "Có nhiều hơn một giao dịch cùng số tiền trên máy — cần kế toán chọn đúng giao dịch của khách.";
  const CAU_LECH = "Ghi chú trên máy khác mã phiếu nhiều ký tự — cần kế toán xác nhận.";
  const UV_A = { ...UV_CHO_KT, bankTransactionId: "bt-a", ghiChu: "", xemTruoc: { quyet: "CHO_KE_TOAN" as const, lyDo: ["NHIEU_UNG_VIEN" as const] } };
  const UV_B = {
    ...UV_CHO_KT,
    bankTransactionId: "bt-b",
    gioQuet: "2026-10-09T13:30:20+07:00",
    ghiChu: "XYZAB",
    xemTruoc: { quyet: "CHO_KE_TOAN" as const, lyDo: ["NHIEU_UNG_VIEN" as const, "GHI_CHU_LECH_NHIEU" as const] },
  };

  it("hai thẻ cùng lý do NHIEU_UNG_VIEN ⇒ câu đó đúng MỘT lần, nằm NGOÀI mọi thẻ; lý do riêng (LECH_NHIEU) vẫn nằm ở đúng thẻ của nó", async () => {
    const { hop } = await moBuoc(ketQua([UV_A, UV_B]));
    await within(hop).findAllByRole("button", { name: NHAN_GUI_KT });
    expect(within(hop).getAllByText(CAU_NHIEU), "đúng một bản").toHaveLength(1);
    const dong = within(hop).getByText(CAU_NHIEU);
    expect(dong.closest("li"), "câu chung KHÔNG nằm trong thẻ nào").toBeNull();
    const [theA, theB] = within(hop).getAllByRole("listitem") as [HTMLElement, HTMLElement];
    expect(theA.textContent, "thẻ A không có lý do riêng").not.toContain("cần kế toán");
    expect(within(theB).getByText(CAU_LECH), "lý do RIÊNG ở đúng thẻ B").toBeTruthy();
    expect(within(theA).queryByText(CAU_LECH)).toBeNull();
    // Vẫn gửi đúng giao dịch của thẻ chứa nút.
    fireEvent.click(within(theB).getByRole("button", { name: NHAN_GUI_KT }));
    await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1", bankTransactionId: "bt-b" }));
  });

  it("ĐỐI CHỨNG: MỘT thẻ duy nhất, hoặc thẻ tự ghi nhận đứng cạnh thẻ chờ kế toán ⇒ KHÔNG gộp — lý do vẫn ở trong thẻ", async () => {
    const a = await moBuoc(ketQua([UV_A]));
    await within(a.hop).findByRole("button", { name: NHAN_GUI_KT });
    expect(within(a.hop).getByText(CAU_NHIEU).closest("li"), "một thẻ: lý do ở trong thẻ").not.toBeNull();
    a.unmount();
    cleanupDialog();

    const b = await moBuoc(ketQua([UV_TU_GHI, UV_A]));
    await within(b.hop).findByRole("button", { name: NHAN_TU_GHI });
    expect(within(b.hop).getByText(CAU_NHIEU).closest("li"), "thẻ tự ghi nhận không có lý do ⇒ không có gì chung").not.toBeNull();
  });
});

describe("[HN3-R] KHÔNG hiện giao dịch khác số tiền — lớp hiển thị tự bảo vệ, không chỉ tin máy chủ", () => {
  const LECH = { ...UV_CHO_KT, bankTransactionId: "bt-lech", soTien: 800_001, ghiChu: "LECHTIEN" };
  const LECH2 = { ...UV_TU_GHI, bankTransactionId: "bt-lech2", soTien: 799_999, ghiChu: "LECHTIEN2" };

  it("[HN3-R16] máy chủ lẫn hai giao dịch lệch 1 đồng vào danh sách ⇒ thẻ đó KHÔNG hiện, thẻ đúng tiền vẫn hiện (đối chứng dương)", async () => {
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, LECH, LECH2]));
    const nut = await within(hop).findAllByRole("button", { name: /Đúng giao dịch này — ghi nhận|Gửi kế toán xác nhận/ });
    expect(nut, "đúng MỘT nút xác nhận — của thẻ đúng tiền").toHaveLength(1);
    expect(within(hop).getAllByRole("listitem"), "đúng MỘT thẻ").toHaveLength(1);
    expect(hop.textContent).not.toContain("LECHTIEN");
    expect(hop.textContent).not.toMatch(/800\.001|799\.999/);
    expect(hop.textContent, "thẻ đúng tiền").toContain("“H6WR9”");
    fireEvent.click(nut[0]!);
    await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1", bankTransactionId: "bt1" }));
  });

  it("[HN3-R16b] MỌI thẻ đều lệch tiền ⇒ KHÔNG trống: câu 'Không thấy giao dịch nào đúng số tiền…' (+ 'Báo admin' khi cổng cho), không nút gửi", async () => {
    const { hop, unmount } = await moBuoc(ketQua([LECH, LECH2], { cau: null }), { phieuPos: phieuChuaThay(30) });
    expect(await within(hop).findByText(CAU_KHONG_UNG_VIEN)).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: NHAN_TU_GHI })).toBeNull();
    expect(within(hop).queryByRole("button", { name: NHAN_GUI_KT })).toBeNull();
    expect(hop.textContent).not.toContain("LECHTIEN");
    expect(within(hop).getByRole("button", { name: "Báo admin" }), "≥ 10 phút ⇒ Báo admin SẴN CÓ").toBeTruthy();
    unmount();
  });
});

describe("[HN3-R] ghi chú trên máy là CHỮ NGƯỜI GÕ — render an toàn, cắt độ dài, ngay cả khi lớp trên quên làm sạch", () => {
  it("[HN3-R17] ghi chú 300+ ký tự có U+202E và thẻ HTML: không phần tử HTML, không ký tự điều hướng hai chiều, ≤ 120 ký tự + '…' (cả chữ lẫn `title`)", async () => {
    const doc = `<img src=x onerror="alert(1)"><b>đậm</b> ${"A".repeat(300)}\u202Eevil\u200B`;
    const { hop } = await moBuoc(ketQua([{ ...UV_TU_GHI, ghiChu: doc }]));
    await within(hop).findByRole("button", { name: NHAN_TU_GHI });
    expect(hop.querySelector("img"), "thẻ HTML nằm trong ghi chú không thành phần tử").toBeNull();
    expect(hop.querySelector("b")).toBeNull();
    expect(hop.textContent, "ký tự điều hướng hai chiều").not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/);

    const ghi = hop.querySelector("li p[title]") as HTMLElement;
    expect(ghi, "dòng ghi chú có `title`").toBeTruthy();
    const tit = ghi.getAttribute("title") ?? "";
    expect(Array.from(tit).length, "title cũng bị cắt").toBeLessThanOrEqual(121);
    expect(tit).not.toMatch(/[\u202A-\u202E\u200B]/);
    expect(tit.startsWith('<img src=x onerror="alert(1)">'), "chữ đầu giữ NGUYÊN VĂN (không escape lại)").toBe(true);
    // Chữ hiển thị = nhãn + “ghi chú”: phần ghi chú trong ngoặc kép không vượt 121 ký tự.
    const trongNgoac = (ghi.textContent ?? "").match(/“([\s\S]*)”/)?.[1] ?? "";
    expect(Array.from(trongNgoac).length).toBeLessThanOrEqual(121);
    expect(trongNgoac.endsWith("…")).toBe(true);
  });

  it("[HN3-R17b] ĐỐI CHỨNG DƯƠNG: ghi chú ngắn, sạch ⇒ hiện nguyên văn, không '…', không bị đổi", async () => {
    const { hop } = await moBuoc(ketQua([{ ...UV_TU_GHI, ghiChu: "Huynh H6WR9" }]));
    await within(hop).findByRole("button", { name: NHAN_TU_GHI });
    expect(hop.textContent).toContain("“Huynh H6WR9”");
    expect((hop.querySelector("li p[title]") as HTMLElement).getAttribute("title")).toBe("Huynh H6WR9");
  });
});

describe("[HN3-R] mất kết nối giữa chừng: câu tiếng Việt đọc được, nút không kẹt vòng quay, cả trang không văng", () => {
  const CAU_MAT_KET_NOI = "Không kết nối được máy chủ — kiểm tra mạng rồi bấm lại.";

  it("[HN3-R20] bước TÌM bị rớt kết nối (action reject) ⇒ hộp cảnh báo CÂU TIẾNG VIỆT, không thẻ nào, không trắng; 'Quay lại phiếu' còn dùng được; mở lại tìm được bình thường", async () => {
    h.timUngVienSaiMaAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    const { hop } = await moHop();
    fireEvent.click(within(hop).getByRole("button", { name: NUT_MO }));
    expect(await within(hop).findByText(CAU_MAT_KET_NOI)).toBeTruthy();
    expect(within(hop).queryByRole("status", { name: "Đang tìm giao dịch" }), "không kẹt ở trạng thái đang tìm").toBeNull();
    expect(within(hop).queryByRole("button", { name: NHAN_TU_GHI })).toBeNull();
    expect(hop.textContent).not.toContain("Failed to fetch"); // không lộ chữ kỹ thuật
    expect(hop.textContent, "câu lỗi mới không hướng dẫn huỷ giao dịch trên máy").not.toMatch(KHONG_HUY);

    // Lần sau tìm được bình thường (đối chứng dương): quay lại → bấm nút → có thẻ.
    fireEvent.click(within(hop).getByRole("button", { name: /Quay lại phiếu/ }));
    fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: NUT_MO }));
    expect(await within(hop).findByRole("button", { name: NHAN_TU_GHI })).toBeTruthy();
  });

  it("[HN3-R21] bước GỬI bị rớt kết nối ⇒ toast câu tiếng Việt + làm mới trạng thái phiếu; nút KHÔNG kẹt vòng quay; vẫn ở bước chọn, bấm lại được", async () => {
    h.guiSaiMaAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    const { hop } = await moBuoc(ketQua([UV_TU_GHI, UV_CHO_KT]));
    fireEvent.click(await within(hop).findByRole("button", { name: NHAN_TU_GHI }));
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    expect(h.error.mock.calls[0]![0]).toMatch(/Mất kết nối khi gửi/);
    expect(h.error.mock.calls[0]![0]).not.toContain("Failed to fetch");
    expect(h.error.mock.calls[0]![0], "câu lỗi mới không hướng dẫn huỷ giao dịch trên máy").not.toMatch(KHONG_HUY);
    expect(h.refresh, "đã làm mới để lấy sự thật (yêu cầu có thể ĐÃ tới nơi)").toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
    expect(h.message).not.toHaveBeenCalled();

    const nut = within(hop).getByRole("button", { name: NHAN_TU_GHI }) as HTMLButtonElement;
    await waitFor(() => expect(nut.disabled, "mở khoá lại").toBe(false));
    expect(nut.querySelector("svg.animate-spin"), "không kẹt vòng quay").toBeNull();
    expect(within(hop).getByText("Chọn giao dịch của khách"), "vẫn ở bước chọn").toBeTruthy();

    // Bấm lại ⇒ gửi được (mock lượt hai trả thành công).
    fireEvent.click(nut);
    await waitFor(() => expect(h.guiSaiMaAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
  });
});

describe("[HN3-R] quyền gửi = `payments:pos-check`: người không có KHÔNG có đường nào tới nút, mà mọi nút khác của họ vẫn đủ", () => {
  it("[HN3-R18] không `pos-check` (trang không nạp phiếu thẻ: `phieuPos = null`) ⇒ không ô Thẻ, không hộp, không nút 'Tôi nhập sai mã'; nút QR vẫn có · ĐỐI CHỨNG DƯƠNG: có quyền ⇒ mở hộp thấy nút cùng đủ nút sẵn có", async () => {
    const v = dung({ duocThuThePos: false, phieuPos: null });
    expect(screen.queryByRole("button", { name: /Thẻ/ }), "không quyền thẻ ⇒ không ô Thẻ").toBeNull();
    expect(screen.queryByRole("button", { name: NUT_MO })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /QR/ }), "ĐỐI CHỨNG: nút QR của người không có quyền thẻ vẫn CÓ").toBeTruthy();

    v.lamMoi({ duocThuThePos: true, phieuPos: phieuChuaThay(30) });
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByRole("button", { name: NUT_MO })).toBeTruthy();
    expect(within(hop).getByRole("button", { name: "Kiểm tra thanh toán" }), "nút sẵn có không mất").toBeTruthy();
    expect(within(hop).getByRole("button", { name: "Báo admin" }), "nút sẵn có không mất").toBeTruthy();
  });
});

/** Dọn hộp còn sót giữa hai lần dựng trong CÙNG một ca. */
function cleanupDialog() {
  for (const d of screen.queryAllByRole("dialog")) d.remove();
}
