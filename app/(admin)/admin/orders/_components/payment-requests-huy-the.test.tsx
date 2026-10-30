// @vitest-environment jsdom
/**
 * Ca [HN4-U*] — NÚT "HUỶ PHIẾU THẺ" (Việc 4, 09/10/2026) dựng THẬT trong hộp phiếu thu thẻ của bảng "Phiếu thu & QR theo đợt"
 * (docs/pos-hai-nut-khai-may.md §6.4 + §6.7). Bấm nút thật, soi cái gì CÓ và KHÔNG CÓ trên màn, và action được gọi với gì.
 *
 * Vì sao có lớp test này ngoài `[HN4-01..12]` (luật thuần) và `[HN4-W*]` (lưới ghim mã): hàm `choPhepHuyPhieuThe` xanh vĩnh viễn kể
 * cả khi component KHÔNG vẽ nút, vẽ nút cho phiếu không huỷ được, bỏ ô tick, hoặc gửi sai cờ. Chỉ bấm thật mới biết.
 *
 * Mô phỏng `router.refresh()` bằng `rerender` với props mới (máy chủ trả lại trang sau khi action ghi xong).
 *
 * Câu chữ của CHỦ DỰ ÁN cố ý VIẾT LẠI NGUYÊN VĂN ở đây thay vì import hằng: test phải ghim đúng chữ đã chốt (đổi một chữ ở
 * `huy-phieu-the-cau.ts` mà quên test này thì phải đỏ). Riêng bảng 16 mã từ chối (`CAU_TU_CHOI_HUY_PHIEU_THE`) thì IMPORT — ca ấy
 * đo "màn in ĐÚNG câu hợp đồng", còn từng câu đã được `[HN4-10]` ghim ở tệp của luật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PhieuPosView } from "@/lib/payments/pos/phieu-pos-luat";
import { CAU_TU_CHOI_HUY_PHIEU_THE, MA_TU_CHOI_HUY_PHIEU_THE, ghepCauTuChoiHuy } from "@/lib/payments/pos/huy-phieu-the-cau";
import type { PhieuGopView } from "./cong-no-theo-con";

const h = vi.hoisted(() => ({
  taoPhieuGopAction: vi.fn(),
  huyPhieuGopAction: vi.fn(),
  dongPhieuGopAction: vi.fn(),
  taoPhieuPosAction: vi.fn(),
  kiemTraPhieuPosAction: vi.fn(),
  baoAdminPhieuPosAction: vi.fn(),
  huyPhieuTheAction: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, warning: vi.fn(), message: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../_actions", () => ({
  taoPhieuGopAction: h.taoPhieuGopAction,
  huyPhieuGopAction: h.huyPhieuGopAction,
  dongPhieuGopAction: h.dongPhieuGopAction,
  taoPhieuPosAction: h.taoPhieuPosAction,
  kiemTraPhieuPosAction: h.kiemTraPhieuPosAction,
  baoAdminPhieuPosAction: h.baoAdminPhieuPosAction,
  huyPhieuTheAction: h.huyPhieuTheAction,
}));
vi.mock("../_qr-actions", () => ({ issueQrForRequest: vi.fn(), regenerateQr: vi.fn() }));
// Việc 3 (thêm khi GHÉP Việc 4): `hop-phieu-pos.tsx` nay import action "tôi nhập sai mã" — không mock thì kéo `@/lib/auth` thật và sập lúc nạp.
vi.mock("../_pos-sai-ma-actions", () => ({ guiSaiMaAction: vi.fn(), timUngVienSaiMaAction: vi.fn() }));

import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";

// ── CHỮ CỦA CHỦ DỰ ÁN / HỢP ĐỒNG — nguyên văn ────────────────────────────────────────────────────────────────────────────
const NHAN_NUT = "Huỷ phiếu thẻ";
const NHAN_XAC_NHAN = "Xác nhận huỷ phiếu thẻ";
const NHAN_KHONG_HUY = "Không huỷ";
// Câu hậu quả: chỉ nói điều CHẮC CHẮN, phần còn lại có điều kiện (đường tạo bị từ chối khi cờ tắt / đơn chờ duyệt) + vế rủi ro trừ hai lần.
const CAU_HAU_QUA =
  "Phiếu thẻ mã H6WR4 sẽ đóng lại; mã và phiếu gộp giữ nguyên. " +
  "Cần thu thẻ lại thì bấm “Thẻ POS” — phiếu mới dùng lại mã này (khi cơ sở đang bật thu thẻ và đơn đã được duyệt). " +
  "Nếu khách đã quẹt rồi mà vẫn thu thêm bằng QR hoặc mã mới, khách sẽ bị trừ hai lần cho tới khi kế toán hoàn.";
const CAU_XAC_NHAN_MANH =
  "Chỉ huỷ khi chắc khách CHƯA quẹt (hoặc đã huỷ giao dịch trên máy). Nếu khách đã quẹt thành công, khoản tiền về sau sẽ vào hàng chờ gắn tay của kế toán.";
const NHAN_TICK = "Tôi chắc khách chưa quẹt thẻ (hoặc đã huỷ giao dịch trên máy)";
const CAU_CHUA_CHON_LY_DO = "Chọn lý do huỷ phiếu thẻ";
const CAU_DA_HUY_TOAST = "Đã huỷ phiếu thẻ mã H6WR4";
const CAU_PHIEU_THE_DA_HUY = "Phiếu thu thẻ đã huỷ — không còn chờ quẹt. Thu thẻ lại thì mở phiếu thẻ mới.";
// VIỆC 4 (rà đối kháng): phiếu HUY mà còn giao dịch thẻ đang chờ kế toán — KHÔNG mời "thu thẻ lại".
const CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN =
  "Phiếu thu thẻ đã huỷ, nhưng có giao dịch thẻ mang mã này đang chờ kế toán xử lý — khách có thể đã bị trừ tiền. ĐỪNG cho khách quẹt lại, chờ kế toán xử lý xong.";
const CAU_THIEU_XAC_NHAN_MANH = "Chưa có kết quả quẹt thẻ rõ ràng — tick xác nhận “khách chưa quẹt thẻ” rồi huỷ lại";
const CAU_CHUA_THAY = "Chưa thấy giao dịch mang mã H6WR4. Kiểm tra biên lai đã báo thành công và mã trong ghi chú.";
const LY_DO = {
  KHACH_DOI_CACH_TRA: "Khách đổi cách trả",
  MO_NHAM: "Mở nhầm / nhập nhầm số tiền",
  KHAC: "Khác",
} as const;

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

const HUY_DUOC: PhieuPosView["huyPhieuThe"] = { huyDuoc: true, canXacNhanManh: true };

/** Phán quyết "không huỷ được" dựng từ CHÍNH bảng câu của hợp đồng — không tự gõ câu. */
function khongHuyDuoc(ma: (typeof MA_TU_CHOI_HUY_PHIEU_THE)[number]): PhieuPosView["huyPhieuThe"] {
  return { huyDuoc: false, ma, ...CAU_TU_CHOI_HUY_PHIEU_THE[ma] };
}

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
    huyPhieuThe: HUY_DUOC,
    ...p,
  };
}

/** Phiếu thẻ ĐÃ HUỶ tay — đúng hình `dungPhieuPosView` dựng (HUY nói theo trạng thái, không còn nút Kiểm tra). */
function phieuDaHuy(p: Partial<PhieuPosView> = {}): PhieuPosView {
  return phieu({
    trangThai: "HUY",
    hienThi: "HUY",
    thongDiep: CAU_PHIEU_THE_DA_HUY,
    duocKiemTra: false,
    ketQuaGanNhat: "NOT_FOUND",
    huyPhieuThe: khongHuyDuoc("DA_HUY"),
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
    phieuPos: phieu(),
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

// ── thao tác ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Mở hộp phiếu thẻ từ ô "Thẻ · đang chờ" của dòng đợt. */
function moHop() {
  fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
  return screen.getByRole("dialog");
}

const nutHuyThe = () => screen.queryByRole("button", { name: NHAN_NUT });
/**
 * Mã mà hộp coi là DẤU HIỆU TIỀN ĐANG BAY (`nutTrongHopPhieuThe().tienDangBay`) — lý do vẽ ở khung cảnh báo (role=alert) KHÔNG có tiền tố "Chưa huỷ được phiếu thẻ:"
 * (rà ghép 10/10/2026; câu đã tự nói "ĐỪNG cho khách quẹt lại"). Các mã khác giữ dòng xám có tiền tố.
 */
const MA_TIEN_DANG_BAY: readonly string[] = ["DA_NHAN_GIAO_DICH", "CO_GIAO_DICH_CHO_TAY", "CO_YEU_CAU_SAI_MA", "DONG_THE_CHUA_NGA_NGU", "KET_QUA_PAID_CHUA_GHI", "CHUA_NGA_NGU"];
const cauChuaHuyDuoc = (ma: (typeof MA_TU_CHOI_HUY_PHIEU_THE)[number]) =>
  MA_TIEN_DANG_BAY.includes(ma)
    ? ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE[ma])
    : `Chưa huỷ được phiếu thẻ: ${ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE[ma])}`;

/** Bấm "Huỷ phiếu thẻ" trong hộp ⇒ hộp xác nhận (đứng trên cùng). */
function moXacNhan() {
  fireEvent.click(screen.getByRole("button", { name: NHAN_NUT }));
  return screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ });
}

const radio = (xn: HTMLElement, ten: string) => within(xn).getByRole("radio", { name: ten }) as HTMLInputElement;
const oTick = (xn: HTMLElement) => within(xn).getByRole("checkbox", { name: NHAN_TICK }) as HTMLInputElement;
const oGhiChu = (xn: HTMLElement) => within(xn).getByRole("textbox", { name: /Ghi chú/ }) as HTMLTextAreaElement;
const nutXacNhan = (xn: HTMLElement) => within(xn).getByRole("button", { name: NHAN_XAC_NHAN }) as HTMLButtonElement;

/** Điền đủ form hợp lệ: lý do + tick. */
function dienDu(xn: HTMLElement, lyDo: keyof typeof LY_DO = "KHACH_DOI_CACH_TRA") {
  fireEvent.click(radio(xn, LY_DO[lyDo]));
  fireEvent.click(oTick(xn));
}

async function dongHop() {
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BAY_GIO);
  vi.clearAllMocks();
  h.huyPhieuTheAction.mockResolvedValue({ ok: true, intentId: "i1", code5: "H6WR4" });
});
afterEach(() => vi.useRealTimers());

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U01 — nút CHỈ khi `huyDuoc`; không nút thì có dòng nói vì sao
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U01] nút 'Huỷ phiếu thẻ' chỉ vẽ khi `huyPhieuThe.huyDuoc`", () => {
  it("[HN4-U01] hộp cho huỷ ⇒ CÓ nút, không dòng 'Chưa huỷ được'; ĐỐI CHỨNG DƯƠNG: nút 'Kiểm tra thanh toán' vẫn có", () => {
    dung();
    const hop = moHop();
    expect(within(hop).getByRole("button", { name: NHAN_NUT })).toBeTruthy();
    expect(within(hop).queryByText(/Chưa huỷ được phiếu thẻ/)).toBeNull();
    expect(within(hop).getByRole("button", { name: "Kiểm tra thanh toán" })).toBeTruthy();
  });

  it("[HN4-U01b] hộp KHÔNG cho huỷ (lỗi kết nối) ⇒ KHÔNG nút, có MỘT dòng lý do nguyên văn; ĐỐI CHỨNG: 'Kiểm tra thanh toán' vẫn có", () => {
    dung({
      phieuPos: phieu({ huyPhieuThe: khongHuyDuoc("LOI_KET_NOI"), ketQuaGanNhat: "PROVIDER_ERROR", mucDo: "loi" }),
    });
    const hop = moHop();
    expect(within(hop).queryByRole("button", { name: NHAN_NUT }), "nút chắc chắn bị máy chủ từ chối = lời hứa suông").toBeNull();
    expect(
      within(hop).getByText(
        "Chưa huỷ được phiếu thẻ: Lần kiểm gần nhất bị lỗi kết nối — chưa biết khách đã quẹt hay chưa — " +
          "Bấm Kiểm tra thanh toán để hỏi lại; có kết quả rõ ràng mới huỷ được.",
      ),
    ).toBeTruthy();
    expect(within(hop).getByRole("button", { name: "Kiểm tra thanh toán" }), "đường thoát có thật vẫn còn").toBeTruthy();
  });

  it("[HN4-U01c] MỌI mã từ chối của phiếu còn chờ quẹt ⇒ không nút + dòng lý do = `ghepCauTuChoiHuy` của CHÍNH mã đó (16 mã, từng mã một)", () => {
    for (const ma of MA_TU_CHOI_HUY_PHIEU_THE) {
      const v = dung({ phieuPos: phieu({ huyPhieuThe: khongHuyDuoc(ma) }) });
      const hop = moHop();
      expect(within(hop).queryByRole("button", { name: NHAN_NUT }), `${ma}: không nút`).toBeNull();
      expect(within(hop).getAllByText(cauChuaHuyDuoc(ma)), `${ma}: đúng một dòng lý do, đúng câu hợp đồng`).toHaveLength(1);
      v.unmount();
    }
  });

  it("[HN4-U01d] phiếu ĐÃ ĐÓNG (đã thu · chờ kế toán · hết hạn · đã huỷ · phiếu gộp đóng) ⇒ không nút, KHÔNG dòng 'Chưa huỷ được' (hộp đã tự kể trạng thái)", () => {
    const ca: [string, Partial<PhieuPosView>][] = [
      ["DA_THU", { trangThai: "DA_THU", hienThi: "DA_THU", huyPhieuThe: khongHuyDuoc("DA_THU"), mucDo: "thanh_cong" }],
      ["LECH_TIEN", { trangThai: "LECH_TIEN", hienThi: "LECH_TIEN", huyPhieuThe: khongHuyDuoc("LECH_TIEN"), choKeToan: true }],
      ["CAN_XU_LY", { trangThai: "CAN_XU_LY", hienThi: "CAN_XU_LY", huyPhieuThe: khongHuyDuoc("CAN_XU_LY"), choKeToan: true }],
      ["HET_HAN", { trangThai: "HET_HAN", hienThi: "HET_HAN", huyPhieuThe: khongHuyDuoc("DA_HET_HAN") }],
      ["HUY", { trangThai: "HUY", hienThi: "HUY", huyPhieuThe: khongHuyDuoc("DA_HUY"), duocKiemTra: false, thongDiep: CAU_PHIEU_THE_DA_HUY }],
      ["PHIEU_DA_DONG", { hienThi: "PHIEU_DA_DONG", huyPhieuThe: khongHuyDuoc("PHIEU_GOP_DA_DONG") }],
    ];
    for (const [ten, p] of ca) {
      // Mở hộp bằng dải kết quả hoặc ô dòng — tuỳ phiếu nằm đâu; đơn giản nhất: dựng hộp qua nút "Mở phiếu thẻ"/"Thẻ …" nếu có.
      const v = dung({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieu(p) });
      const mo =
        screen.queryByRole("button", { name: "Mở phiếu thẻ" }) ??
        screen.queryByRole("button", { name: /Thẻ: chờ kế toán|Thẻ · đang chờ|Thẻ · chưa rõ/ });
      if (mo) {
        fireEvent.click(mo);
        const hop = screen.getByRole("dialog");
        expect(within(hop).queryByRole("button", { name: NHAN_NUT }), `${ten}: không nút`).toBeNull();
        expect(within(hop).queryByText(/Chưa huỷ được phiếu thẻ/), `${ten}: không dòng lý do thừa`).toBeNull();
      } else {
        // Phiếu HUY / HET_HAN không lên dải; ô dòng về "Thẻ POS" — không có hộp để soi, nhưng cũng KHÔNG có nút nào trên màn.
        expect(nutHuyThe(), `${ten}: không nút ở đâu cả`).toBeNull();
      }
      v.unmount();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U02 — hộp xác nhận
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U02] hộp xác nhận hai bước", () => {
  it("[HN4-U02] bấm nút ⇒ hộp xác nhận: hậu quả + 3 lý do + ghi chú + CÂU XÁC NHẬN MẠNH nguyên văn + ô tick; chưa gọi action", () => {
    dung();
    moHop();
    const xn = moXacNhan();
    expect(within(xn).getByText(CAU_HAU_QUA)).toBeTruthy();
    for (const nhan of Object.values(LY_DO)) expect(radio(xn, nhan).checked, `${nhan} chưa chọn sẵn`).toBe(false);
    expect(oGhiChu(xn).maxLength, "ghi chú ≤ 200 ký tự").toBe(200);
    expect(within(xn).getByText(CAU_XAC_NHAN_MANH), "câu của chủ dự án, nguyên văn").toBeTruthy();
    expect(oTick(xn).checked).toBe(false);
    expect(nutXacNhan(xn).disabled, "chưa chọn gì ⇒ khoá").toBe(true);
    expect(within(xn).getByRole("button", { name: NHAN_KHONG_HUY })).toBeTruthy();
    expect(h.huyPhieuTheAction, "mở hộp xác nhận KHÔNG phải là huỷ").not.toHaveBeenCalled();
  });

  it("[HN4-U02b] nút xác nhận khoá tới khi ĐỦ: lý do ∧ (KHÁC ⇒ ghi chú ≥ 3) ∧ tick — từng vế một, kèm ĐỐI CHỨNG DƯƠNG", () => {
    dung();
    moHop();
    const xn = moXacNhan();

    // Chỉ tick, chưa lý do ⇒ khoá, và `title` nói thiếu gì.
    fireEvent.click(oTick(xn));
    expect(nutXacNhan(xn).disabled).toBe(true);
    expect(nutXacNhan(xn).getAttribute("title")).toBe(CAU_CHUA_CHON_LY_DO);
    fireEvent.click(oTick(xn)); // bỏ tick

    // Chỉ lý do, chưa tick ⇒ khoá.
    fireEvent.click(radio(xn, LY_DO.KHACH_DOI_CACH_TRA));
    expect(nutXacNhan(xn).disabled, "thiếu tick").toBe(true);

    // ĐỐI CHỨNG DƯƠNG: đủ lý do + tick ⇒ mở.
    fireEvent.click(oTick(xn));
    expect(nutXacNhan(xn).disabled, "đủ lý do + tick").toBe(false);
    expect(nutXacNhan(xn).getAttribute("title")).toBeNull();

    // Bỏ tick lại ⇒ khoá lại (tick không "dính").
    fireEvent.click(oTick(xn));
    expect(nutXacNhan(xn).disabled).toBe(true);
    fireEvent.click(oTick(xn));

    // "Khác" mà ghi chú trống / 1–2 ký tự / toàn khoảng trắng ⇒ khoá; ≥ 3 ký tự thật ⇒ mở.
    fireEvent.click(radio(xn, LY_DO.KHAC));
    expect(nutXacNhan(xn).disabled, "Khác + chưa ghi chú").toBe(true);
    fireEvent.change(oGhiChu(xn), { target: { value: "ab" } });
    expect(nutXacNhan(xn).disabled, "Khác + 2 ký tự").toBe(true);
    fireEvent.change(oGhiChu(xn), { target: { value: "  a   " } });
    expect(nutXacNhan(xn).disabled, "Khác + khoảng trắng bao quanh 1 ký tự").toBe(true);
    fireEvent.change(oGhiChu(xn), { target: { value: "abc" } });
    expect(nutXacNhan(xn).disabled, "Khác + 3 ký tự").toBe(false);

    // Lý do KHÁC "Khác" thì ghi chú KHÔNG bắt buộc.
    fireEvent.click(radio(xn, LY_DO.MO_NHAM));
    fireEvent.change(oGhiChu(xn), { target: { value: "" } });
    expect(nutXacNhan(xn).disabled, "Mở nhầm + không ghi chú").toBe(false);
  });

  it("[HN4-U02i] nút khoá thì NÓI THIẾU GÌ bằng chữ nhìn thấy (nút khoá `pointer-events-none` — `title` không hiện): lý do → ghi chú → tick → hết", () => {
    dung();
    moHop();
    const xn = moXacNhan();
    const nut = nutXacNhan(xn);
    /** Dòng nhắc mà nút trỏ tới bằng `aria-describedby` — `null` khi nút không trỏ tới đâu (đủ rồi). */
    const nhac = () => {
      const id = nut.getAttribute("aria-describedby");
      return id === null ? null : (document.getElementById(id)?.textContent ?? "(id trỏ tới hư không)");
    };
    expect(nhac()).toBe(CAU_CHUA_CHON_LY_DO);
    expect(within(xn).getByText(CAU_CHUA_CHON_LY_DO), "chữ nhìn thấy được, không chỉ `title`").toBeTruthy();

    fireEvent.click(radio(xn, LY_DO.KHAC));
    expect(nhac()).toBe("Ghi chú lý do “Khác” (ít nhất 3 ký tự)");
    fireEvent.change(oGhiChu(xn), { target: { value: "abc" } });
    expect(nhac()).toBe("Tick xác nhận khách chưa quẹt thẻ");
    fireEvent.click(oTick(xn));
    expect(nhac(), "đủ rồi ⇒ không còn dòng nhắc").toBeNull();
    expect(within(xn).queryByText("Tick xác nhận khách chưa quẹt thẻ")).toBeNull();
    expect(nut.disabled).toBe(false);
  });

  it("[HN4-U02c] bấm xác nhận ⇒ gọi `huyPhieuTheAction` ĐÚNG MỘT LẦN với đúng hình; ghi chú được cắt khoảng trắng", async () => {
    dung();
    moHop();
    const xn = moXacNhan();
    dienDu(xn, "MO_NHAM");
    fireEvent.change(oGhiChu(xn), { target: { value: "  bấm nhầm nút Thẻ POS  " } });
    fireEvent.click(nutXacNhan(xn));
    await waitFor(() => expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1));
    expect(h.huyPhieuTheAction.mock.calls[0]?.[0]).toStrictEqual({
      orderId: "o1",
      intentId: "i1",
      lyDo: "MO_NHAM",
      ghiChu: "bấm nhầm nút Thẻ POS",
      xacNhanKhachChuaQuet: true,
    });
  });

  it("[HN4-U02d] KHÔNG ghi chú ⇒ payload KHÔNG có khoá `ghiChu` (không gửi chuỗi rỗng)", async () => {
    dung();
    moHop();
    const xn = moXacNhan();
    dienDu(xn, "KHACH_DOI_CACH_TRA");
    fireEvent.click(nutXacNhan(xn));
    await waitFor(() => expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1));
    expect(h.huyPhieuTheAction.mock.calls[0]?.[0]).toStrictEqual({
      orderId: "o1",
      intentId: "i1",
      lyDo: "KHACH_DOI_CACH_TRA",
      xacNhanKhachChuaQuet: true,
    });
  });

  it("[HN4-U02e] `canXacNhanManh: false` (hợp đồng cho phép) ⇒ KHÔNG khung cảnh báo, KHÔNG ô tick, chỉ cần lý do; gửi `xacNhanKhachChuaQuet: false` — màn ĐỌC trường, không hard-code", async () => {
    dung({ phieuPos: phieu({ huyPhieuThe: { huyDuoc: true, canXacNhanManh: false } }) });
    moHop();
    const xn = moXacNhan();
    expect(within(xn).queryByText(CAU_XAC_NHAN_MANH)).toBeNull();
    expect(within(xn).queryByRole("checkbox")).toBeNull();
    expect(nutXacNhan(xn).disabled).toBe(true);
    fireEvent.click(radio(xn, LY_DO.KHACH_DOI_CACH_TRA));
    expect(nutXacNhan(xn).disabled, "đủ lý do là đủ").toBe(false);
    fireEvent.click(nutXacNhan(xn));
    await waitFor(() => expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1));
    expect(h.huyPhieuTheAction.mock.calls[0]?.[0]).toStrictEqual({
      orderId: "o1",
      intentId: "i1",
      lyDo: "KHACH_DOI_CACH_TRA",
      xacNhanKhachChuaQuet: false,
    });
  });

  it("[HN4-U02f] ĐÓNG rồi MỞ LẠI ⇒ form sạch: không lý do, không tick, ghi chú trống (tick không được sống sót giữa hai lần mở)", () => {
    dung();
    moHop();
    let xn = moXacNhan();
    dienDu(xn, "MO_NHAM");
    fireEvent.change(oGhiChu(xn), { target: { value: "nháp" } });
    fireEvent.click(within(xn).getByRole("button", { name: NHAN_KHONG_HUY }));
    expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull();
    expect(h.huyPhieuTheAction).not.toHaveBeenCalled();

    xn = moXacNhan();
    expect(radio(xn, LY_DO.MO_NHAM).checked, "lý do cũ không dính").toBe(false);
    expect(oTick(xn).checked, "tick cũ không dính — mỗi lần huỷ là một lần chịu trách nhiệm").toBe(false);
    expect(oGhiChu(xn).value).toBe("");
    expect(nutXacNhan(xn).disabled).toBe(true);
  });

  it("[HN4-U02g] hộp xác nhận portal ra ngoài khung admin ⇒ mang `admin-scope` (không thì nút lấy màu CAM của :root)", () => {
    dung();
    moHop();
    const xn = moXacNhan();
    expect(xn.className).toMatch(/\badmin-scope\b/);
  });

  it("[HN4-U02h] Esc đóng CHỈ hộp xác nhận (hộp thẻ phía dưới còn nguyên) — hai hộp lồng nhau không kéo nhau đóng", async () => {
    dung();
    moHop();
    const xn = moXacNhan();
    fireEvent.keyDown(xn, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
    expect(screen.getByRole("dialog", { name: /Thu thẻ POS/ }), "hộp thẻ còn đó").toBeTruthy();
    expect(h.huyPhieuTheAction).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U03 — thành công ⇒ hộp đổi sang trạng thái HUY, không để state cũ
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U03] huỷ thành công", () => {
  it("[HN4-U03] toast đúng câu + làm mới trang + hộp xác nhận đóng; trang mới về ⇒ hộp nói HUY, không còn nút nào của phiếu mở", async () => {
    const v = dung();
    moHop();
    const xn = moXacNhan();
    dienDu(xn);
    fireEvent.click(nutXacNhan(xn));

    await waitFor(() => expect(h.success).toHaveBeenCalledWith(CAU_DA_HUY_TOAST));
    expect(h.refresh, "làm mới đúng một lần").toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
    expect(h.error).not.toHaveBeenCalled();

    // Máy chủ trả lại trang: phiếu thẻ đã HUY, phiếu gộp không còn thẻ mở.
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieuDaHuy() });
    const hop = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(hop).getByText(CAU_PHIEU_THE_DA_HUY)).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: "Kiểm tra thanh toán" }), "phiếu HUY không còn nút Kiểm tra").toBeNull();
    expect(within(hop).queryByRole("button", { name: NHAN_NUT }), "đã huỷ rồi thì hết nút huỷ").toBeNull();
    expect(within(hop).queryByRole("button", { name: "Báo admin" })).toBeNull();
    expect(within(hop).queryByText(/Chưa huỷ được phiếu thẻ/), "phiếu đã đóng — không dòng 'chưa huỷ được'").toBeNull();
  });

  it("[HN4-U03b] ⚠️ `router.refresh()` KHÔNG reset useState: câu 'Chưa thấy…' của lượt Kiểm tra TRƯỚC không được che câu 'đã huỷ'", async () => {
    h.kiemTraPhieuPosAction.mockResolvedValue({
      ok: true,
      ketQua: {
        status: "CHO_QUET",
        doiTrangThai: false,
        thongDiep: CAU_CHUA_THAY,
        mucDo: "thong_tin",
        ketLuan: null,
        tuCache: false,
        kiemLuc: "2026-10-09T13:29:00+07:00",
      },
    });
    const v = dung();
    const hop = moHop();
    fireEvent.click(within(hop).getByRole("button", { name: "Kiểm tra thanh toán" }));
    expect(await within(hop).findByText(CAU_CHUA_THAY)).toBeTruthy();

    const xn = moXacNhan();
    dienDu(xn);
    fireEvent.click(nutXacNhan(xn));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(CAU_DA_HUY_TOAST));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());

    v.lamMoi({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieuDaHuy() });
    const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(sau).queryByText(CAU_CHUA_THAY), "câu cũ của lượt Kiểm tra phải biến mất").toBeNull();
    expect(within(sau).getByText(CAU_PHIEU_THE_DA_HUY), "…nhường chỗ cho câu đúng với trạng thái").toBeTruthy();
  });

  it("[HN4-U03c] phiếu HUY không để lại dải footer rỗng (không nút nào để đặt vào) — footer ẩn", async () => {
    const v = dung();
    moHop();
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieuDaHuy() });
    const hop = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    const footer = hop.querySelector('[data-slot="dialog-footer"]');
    expect(footer === null || /\bhidden\b/.test(footer.className), "footer rỗng không được chiếm chỗ").toBe(true);
    // ĐỐI CHỨNG DƯƠNG: phiếu đang chờ quẹt thì footer HIỆN (có nút).
    v.lamMoi({ phieuGop: phieuGop(), phieuPos: phieu() });
    const footerMo = screen.getByRole("dialog", { name: /Thu thẻ POS/ }).querySelector('[data-slot="dialog-footer"]');
    expect(footerMo).not.toBeNull();
    expect(/\bhidden\b/.test(footerMo?.className ?? "")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U13 — phiếu HUY: không còn gì để gõ vào máy; và khi còn giao dịch chờ kế toán thì KHÔNG mời "thu thẻ lại"
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U13] hộp phiếu thẻ ĐÃ HUỶ", () => {
  const moHopTuO = (ten: RegExp) => {
    fireEvent.click(screen.getByRole("button", { name: ten }));
    return screen.getByRole("dialog", { name: /Thu thẻ POS/ });
  };

  it("[HN4-U13a] HUY + giao dịch chờ kế toán (mở từ ô 'Thẻ: chờ kế toán') ⇒ câu CẢNH BÁO, KHÔNG 'thu thẻ lại', không Chép số/mã, không Kiểm tra", () => {
    dung({
      phieuGop: phieuGop({ theDangMo: "CHO_KE_TOAN" }),
      phieuPos: phieuDaHuy({ choKeToan: true, thongDiep: CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN, mucDo: "canh_bao" }),
    });
    const hop = moHopTuO(/Thẻ: chờ kế toán/);
    expect(within(hop).getByText(CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN)).toBeTruthy();
    expect(within(hop).queryByText(/Thu thẻ lại thì mở phiếu thẻ mới/), "máy chủ từ chối đúng việc đó").toBeNull();
    expect(within(hop).queryByRole("button", { name: /^Chép số/ }), "không còn gì để gõ vào máy").toBeNull();
    expect(within(hop).queryByRole("button", { name: /^Chép mã/ })).toBeNull();
    expect(within(hop).queryByRole("button", { name: "Kiểm tra thanh toán" })).toBeNull();
  });

  it("[HN4-U13b] ĐỐI CHỨNG: HUY không có giao dịch chờ ⇒ câu 'thu thẻ lại', cũng không Chép số/mã; phiếu ĐANG MỞ thì CÓ Chép số/mã", () => {
    const v = dung({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieuDaHuy() });
    // Ô dòng về 'Thẻ POS' (không còn thẻ mở) — hộp phiếu HUY dựng thẳng qua ô kết quả không có; kiểm bằng phiếu đang mở ở dưới.
    v.lamMoi({ phieuGop: phieuGop(), phieuPos: phieu() });
    const hopMo = moHop();
    expect(within(hopMo).getByRole("button", { name: /^Chép số/ })).toBeTruthy();
    expect(within(hopMo).getByRole("button", { name: /^Chép mã/ })).toBeTruthy();
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieuDaHuy() });
    const hop = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(hop).getByText(CAU_PHIEU_THE_DA_HUY)).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: /^Chép số/ })).toBeNull();
    expect(within(hop).queryByRole("button", { name: /^Chép mã/ })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U04 — thất bại
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U04] huỷ thất bại ⇒ toast câu máy chủ, làm mới, hộp xác nhận KHÔNG kẹt", () => {
  it("[HN4-U04] máy chủ từ chối (đua: phiếu đã thu) ⇒ toast.error đúng câu + làm mới + đóng hộp xác nhận; hộp thẻ vẫn dùng được", async () => {
    const cau = "Phiếu thẻ này đã thu rồi — tiền thẻ đã ghi nhận vào mã, đang chờ kế toán xác nhận — Không huỷ. Khách cần hoàn tiền thì nhờ kế toán.";
    h.huyPhieuTheAction.mockResolvedValue({ ok: false, error: cau });
    dung();
    const hop = moHop();
    const xn = moXacNhan();
    dienDu(xn);
    fireEvent.click(nutXacNhan(xn));

    await waitFor(() => expect(h.error).toHaveBeenCalledWith(cau));
    expect(h.success).not.toHaveBeenCalled();
    expect(h.refresh, "trạng thái đã đổi giữa lúc dựng màn và lúc bấm ⇒ lấy sự thật").toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
    // Không mời bấm lại đúng câu chắc chắn bị từ chối, và hộp thẻ không bị kẹt: nút Kiểm tra bấm được.
    // GHÉP (10/10/2026): trong lúc lượt huỷ còn chạy (`dangHuy`) nút Kiểm tra khoá; hộp xác nhận đóng TRƯỚC khi transition kết thúc ⇒ khẳng định tức thời là ĐUA
    // (đo ở lượt cấy lỗi H3: xanh nhiều lần, đỏ một lần khi máy chậm). Điều ca này đòi là "KHÔNG BỊ KẸT" ⇒ chờ tới khi mở khoá.
    await waitFor(() => expect((within(hop).getByRole("button", { name: "Kiểm tra thanh toán" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("[HN4-U04b] `CAU_THIEU_XAC_NHAN_MANH` (trạng thái đổi giữa lúc dựng màn và lúc bấm) ⇒ toast nguyên văn + LÀM MỚI (khuôn V24)", async () => {
    h.huyPhieuTheAction.mockResolvedValue({ ok: false, error: CAU_THIEU_XAC_NHAN_MANH });
    dung({ phieuPos: phieu({ huyPhieuThe: { huyDuoc: true, canXacNhanManh: false } }) });
    moHop();
    const xn = moXacNhan();
    fireEvent.click(radio(xn, LY_DO.MO_NHAM));
    fireEvent.click(nutXacNhan(xn));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith(CAU_THIEU_XAC_NHAN_MANH));
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
  });

  it("[HN4-U04c] rớt kết nối (action reject) ⇒ KHÔNG văng lỗi chưa bắt; câu tiếng Việt nói CHƯA RÕ đã huỷ chưa + làm mới + đóng hộp xác nhận", async () => {
    h.huyPhieuTheAction.mockRejectedValue(new Error("fetch failed"));
    dung();
    moHop();
    const xn = moXacNhan();
    dienDu(xn);
    fireEvent.click(nutXacNhan(xn));
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    const cau = String(h.error.mock.calls[0]?.[0]);
    expect(cau, "câu người thường đọc được").toMatch(/Mất kết nối/);
    expect(cau, "nói thẳng là CHƯA RÕ").toMatch(/chưa rõ/);
    expect(cau, "không lộ lỗi kỹ thuật").not.toMatch(/fetch failed/);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
  });

  it("[HN4-U04d] thất bại cũng bỏ câu của lượt Kiểm tra cũ (trang mới có thể đã đổi trạng thái) — không để 'Chưa thấy…' che sự thật mới", async () => {
    h.huyPhieuTheAction.mockResolvedValue({ ok: false, error: "Phiếu thẻ này đã thu rồi — Không huỷ." });
    h.kiemTraPhieuPosAction.mockResolvedValue({
      ok: true,
      ketQua: { status: "CHO_QUET", doiTrangThai: false, thongDiep: CAU_CHUA_THAY, mucDo: "thong_tin", ketLuan: null, tuCache: false, kiemLuc: "2026-10-09T13:29:00+07:00" },
    });
    const v = dung();
    const hop = moHop();
    fireEvent.click(within(hop).getByRole("button", { name: "Kiểm tra thanh toán" }));
    expect(await within(hop).findByText(CAU_CHUA_THAY)).toBeTruthy();
    const xn = moXacNhan();
    dienDu(xn);
    fireEvent.click(nutXacNhan(xn));
    await waitFor(() => expect(h.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
    // Trang mới: phiếu đã thu.
    v.lamMoi({
      phieuGop: phieuGop({ theDangMo: "CHO_KE_TOAN" }),
      phieuPos: phieu({
        trangThai: "DA_THU",
        hienThi: "DA_THU",
        thongDiep: "Đã thu 800.000đ lúc 13:30 — đã ghi nhận, chờ kế toán xác nhận.",
        mucDo: "thanh_cong",
        huyPhieuThe: khongHuyDuoc("DA_THU"),
      }),
    });
    const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(sau).queryByText(CAU_CHUA_THAY)).toBeNull();
    expect(within(sau).getByText(/Đã thu 800\.000đ lúc 13:30/)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U05 — đang chạy
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U05] đang chạy ⇒ không bấm đúp, không đóng được", () => {
  it("[HN4-U05] bấm xác nhận rồi bấm đúp ⇒ action gọi ĐÚNG MỘT lần; nút khoá + nói 'Đang huỷ'; Esc không đóng được; xong ⇒ đóng", async () => {
    // Hộp giữ hàm giải phóng ở thuộc tính (không phải biến `let`): TS thu hẹp `let x: T | undefined` thành `undefined` và không thấy phép gán trong closure.
    const treo: { xong?: (v: unknown) => void } = {};
    h.huyPhieuTheAction.mockReturnValue(new Promise((r) => (treo.xong = r)));
    try {
      dung();
      moHop();
      const xn = moXacNhan();
      dienDu(xn);
      fireEvent.click(nutXacNhan(xn));
      await waitFor(() => expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1));

      const dang = within(xn).getByRole("button", { name: /Đang huỷ/ }) as HTMLButtonElement;
      expect(dang.disabled).toBe(true);
      fireEvent.click(dang);
      fireEvent.click(dang);
      expect(h.huyPhieuTheAction, "bấm đúp không gửi hai lần").toHaveBeenCalledTimes(1);

      // Đang chạy thì không đóng được: "Không huỷ" khoá, Esc không đóng.
      expect((within(xn).getByRole("button", { name: NHAN_KHONG_HUY }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.keyDown(xn, { key: "Escape" });
      expect(screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ }), "Esc không đóng khi đang chạy").toBeTruthy();

      treo.xong?.({ ok: true, intentId: "i1", code5: "H6WR4" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
      expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1);
    } finally {
      // Ca đỏ giữa chừng thì lời hứa treo KHÔNG được rò sang ca sau: React 19 gộp các async transition cùng làn, nên một transition
      // treo vĩnh viễn làm transition của ca KẾ TIẾP không bao giờ commit (đã bắt được ở lượt cấy lỗi M5: ca `U05b` đỏ theo).
      treo.xong?.({ ok: false, error: "dọn ca test" });
    }
  });

  it("[HN4-U05b] hộp thẻ KHÔNG cho huỷ khi đang Kiểm tra (hai việc chạy chồng nhau) ⇒ nút 'Huỷ phiếu thẻ' khoá; xong Kiểm tra ⇒ mở lại", async () => {
    const treo: { xong?: (v: unknown) => void } = {};
    h.kiemTraPhieuPosAction.mockReturnValue(new Promise((r) => (treo.xong = r)));
    try {
      dung();
      const hop = moHop();
      fireEvent.click(within(hop).getByRole("button", { name: "Kiểm tra thanh toán" }));
      await waitFor(() => expect((within(hop).getByRole("button", { name: NHAN_NUT }) as HTMLButtonElement).disabled).toBe(true));
      treo.xong?.({
        ok: true,
        ketQua: { status: "CHO_QUET", doiTrangThai: false, thongDiep: CAU_CHUA_THAY, mucDo: "thong_tin", ketLuan: null, tuCache: false, kiemLuc: "2026-10-09T13:29:00+07:00" },
      });
      await waitFor(() => expect((within(hop).getByRole("button", { name: NHAN_NUT }) as HTMLButtonElement).disabled).toBe(false));
    } finally {
      treo.xong?.({ ok: false, error: "dọn ca test" }); // xem chú thích ở `[HN4-U05]`
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U06 — người không có quyền
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U06] người KHÔNG có `payments:pos-check`", () => {
  it("[HN4-U06] không nút 'Huỷ phiếu thẻ' ở đâu cả, NHƯNG mọi nút khác còn (QR · mã, Huỷ phiếu của phiếu gộp, Xuất QR…) — đối chứng dương luật 11", () => {
    // Họ không nạp được phiếu thẻ (`phieuPos = null`); máy chủ nói không có thẻ nào đang mở ⇒ phiếu gộp huỷ được.
    dung({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: null }) });
    expect(screen.getByRole("button", { name: /QR · H6WR4/ }), "nút QR phải CÓ").toBeTruthy();
    // Không có thẻ nào mở ⇒ panel QR hiện sẵn (không bấm nút QR — bấm là TẮT nó).
    expect(screen.getByRole("button", { name: "Huỷ phiếu" }), "Huỷ phiếu (của phiếu gộp) phải CÓ").toBeTruthy();
    expect(nutHuyThe(), "KHÔNG có nút Huỷ phiếu THẺ").toBeNull();
    // Và KHÔNG có nút Thẻ nào để họ mở hộp ("Thẻ POS" / "Thẻ · đang chờ"): ô Thẻ gác bằng `payments:pos-check` (`kenhCuaDong`).
    expect(screen.queryByRole("button", { name: /Thẻ/ }), "không quyền ⇒ không ô Thẻ nào bấm được").toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[HN4-U06b] có thẻ đang chờ mà người xem không có quyền ⇒ chỉ NHÃN CHỮ + câu 'nhờ người có quyền'; không hứa nút họ không có; ĐỐI CHỨNG: có quyền ⇒ ô mở hộp ⇒ nút", () => {
    const v = dung({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    expect(screen.queryByRole("button", { name: /Thẻ/ })).toBeNull();
    expect(nutHuyThe()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ }));
    expect(screen.queryByText(/bấm “Thẻ · đang chờ” ở dòng đợt, rồi “Huỷ phiếu thẻ”/), "không hứa nút người xem không có").toBeNull();

    v.lamMoi({ duocThuThePos: true, phieuPos: phieu(), phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    moHop();
    expect(nutHuyThe(), "có quyền ⇒ có nút").toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U07 — sau huỷ, các nút khác trên màn nói đúng
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U07] sau huỷ: ô dòng về 'Thẻ POS', phiếu gộp huỷ được", () => {
  it("[HN4-U07] phiếu thẻ HUY + phiếu gộp hết thẻ mở ⇒ ô dòng 'Thẻ POS' (dùng lại mã), không 'Thẻ · đang chờ', không dải kết quả; panel QR 'Huỷ phiếu' hết CHẶN", async () => {
    const v = dung();
    moHop();
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: phieuDaHuy() });
    await dongHop();

    expect(screen.getByRole("button", { name: /^Thẻ POS$/ }), "mời mở phiếu thẻ mới").toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thẻ · đang chờ/ })).toBeNull();
    expect(screen.queryByText(/Thẻ POS · mã/), "phiếu HUY không lên dải kết quả").toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ }));
    expect(screen.getByRole("button", { name: "Huỷ phiếu" }), "hết thẻ mở ⇒ Huỷ phiếu có lại").toBeTruthy();
    expect(screen.queryByText(/Đang chờ quẹt thẻ cho mã này/)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U10 — câu chặn "Huỷ phiếu" chỉ đường tới nút này: đường chỉ phải CÓ THẬT
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U10] lời chỉ của câu chặn 'Huỷ phiếu' khớp với hộp thẻ (luật 12: chỉ đường thì đường phải có)", () => {
  it("[HN4-U10] huỷ được: panel QR bảo 'bấm “Thẻ · đang chờ” … rồi “Huỷ phiếu thẻ”' ⇒ làm ĐÚNG như vậy thì CÓ nút", () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ })); // hiện panel QR (mặc định ẩn vì có thẻ đang mở)
    expect(
      screen.getByText("Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước (bấm “Thẻ · đang chờ” ở dòng đợt, rồi “Huỷ phiếu thẻ”)."),
    ).toBeTruthy();
    // Làm theo lời chỉ, từng bước.
    const hop = moHop();
    expect(within(hop).getByRole("button", { name: NHAN_NUT }), "đường được chỉ có thật").toBeTruthy();
  });

  it("[HN4-U10b] KHÔNG huỷ được: câu ở panel QR và dòng trong hộp thẻ nói CÙNG cặp (lý do · việc nên làm) — không hai câu cãi nhau", () => {
    const huy = khongHuyDuoc("CHUA_NGA_NGU");
    dung({ phieuPos: phieu({ huyPhieuThe: huy, ketQuaGanNhat: "NOT_FOUND" }) });
    fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ }));
    // Cặp câu lấy thẳng từ bảng hợp đồng (không từ `huy`: kiểu của nó là cả hai nhánh `huyDuoc`, `tsc` không cho đưa vào `ghepCauTuChoiHuy`).
    const cap = ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE.CHUA_NGA_NGU);
    expect(
      screen.getByText(`Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã, và phiếu thẻ cũng chưa huỷ được: ${cap}`),
      "panel QR nói lý do của hộp",
    ).toBeTruthy();
    const hop = moHop();
    // CHUA_NGA_NGU là dấu hiệu tiền đang bay ⇒ hộp nói CÙNG cặp ấy ở khung cảnh báo (không tiền tố).
    expect(within(hop).getByText(cap), "hộp nói đúng cặp ấy").toBeTruthy();
    expect(within(hop).queryByRole("button", { name: NHAN_NUT })).toBeNull();
  });
});

describe("[HN4-U11] 'Huỷ phiếu' của phiếu gộp bị máy chủ từ chối vì thẻ đang mở ⇒ màn chỉ tới nút này", () => {
  it("[HN4-U11] từ chối + làm mới ⇒ dòng đợt về 'Thẻ · đang chờ'; panel QR chỉ đường; đi theo đường ấy thì CÓ nút 'Huỷ phiếu thẻ'", async () => {
    const cauServer = "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước";
    h.huyPhieuGopAction.mockResolvedValue({ ok: false, error: cauServer });
    // Trang tải lúc CHƯA có thẻ (đua: nơi khác vừa bấm "Thẻ POS") ⇒ nút "Huỷ phiếu" còn được mời.
    const v = dung({ phieuGop: phieuGop({ theDangMo: null }), phieuPos: null });
    fireEvent.click(screen.getByRole("button", { name: "Huỷ phiếu" }));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận huỷ mã/ }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith(cauServer));
    expect(h.refresh).toHaveBeenCalledTimes(1);

    // Máy chủ trả trang mới: thẻ đang mở + người xem CÓ quyền và phiếu thẻ lên màn.
    v.lamMoi({ phieuGop: phieuGop({ theDangMo: "DANG_CHO" }), phieuPos: phieu() });
    expect(screen.getByRole("button", { name: /Thẻ · đang chờ/ }), "dòng đợt nói đúng sự thật").toBeTruthy();
    expect(screen.queryByRole("button", { name: "Huỷ phiếu" }), "nút Huỷ phiếu không còn được mời").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ }));
    expect(
      screen.getByText("Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước (bấm “Thẻ · đang chờ” ở dòng đợt, rồi “Huỷ phiếu thẻ”)."),
      "câu chặn chỉ tới nút",
    ).toBeTruthy();
    // Đi theo đúng lời chỉ.
    const hop = moHop();
    expect(within(hop).getByRole("button", { name: NHAN_NUT }), "đường được chỉ có thật").toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// U09 — chữ "nói thật tạm" của Việc 1 còn sót ở màn
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HN4-U09] nhãn 'Thẻ đang chờ' (người không có `pos-check`) không còn nói 'chỉ kiểm tra kết quả'", () => {
  it("[HN4-U09] `title` nói đúng điều người có quyền làm được: huỷ nếu khách chưa quẹt, hoặc kiểm tra — và KHÔNG hứa một nút người xem không có", () => {
    dung({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: "DANG_CHO" }) });
    const nhan = screen.getByText("Thẻ đang chờ");
    const title = nhan.getAttribute("title") ?? "";
    expect(title).toBe(
      "Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã. Nhờ người có quyền thu thẻ POS xử lý phiếu thẻ trước " +
        "(huỷ nếu khách chưa quẹt, hoặc kiểm tra kết quả).",
    );
    expect(title, "câu cũ (chưa có nút huỷ) đã hết đúng").not.toMatch(/thu thẻ kiểm tra kết quả/);
    expect(title, "không hứa nút").not.toMatch(/bấm “Huỷ phiếu thẻ”/);
  });

  it("[HN4-U09b] ĐỐI CHỨNG: hai kiểu thẻ khác giữ câu riêng của chúng (chờ kế toán · chưa kết luận)", () => {
    const v = dung({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: "CHO_KE_TOAN" }) });
    expect(screen.getByText("Thẻ: chờ kế toán").getAttribute("title")).toBe("Giao dịch thẻ của mã này còn chờ kế toán xử lý");
    v.lamMoi({ duocThuThePos: false, phieuPos: null, phieuGop: phieuGop({ theDangMo: "CHUA_KET_LUAN" }) });
    expect(screen.getByText("Thẻ đang chờ").getAttribute("title")).toBe(
      "Mã này đang mở cho thẻ — chưa huỷ được mã. Nhờ người có quyền thu thẻ kiểm tra kết quả",
    );
  });
});
