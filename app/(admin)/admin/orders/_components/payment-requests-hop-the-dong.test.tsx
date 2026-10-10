// @vitest-environment jsdom
/**
 * Ca [HN6-HD-*] — VIỆC 6 (chốt, rà đối kháng): MÀN CỦA SALE khi phiếu thẻ bị HUỶ KÈM bởi "Dừng học" / "Đổi khoá" (mục 3).
 *
 * Kịch bản đo được ở Postgres thật: sale đang mở hộp thẻ cho khách đứng quầy; người khác (quản lý) bấm Dừng học một bé cùng phiếu gộp ⇒ phiếu thẻ HUY + phiếu gộp VOID ⇒
 * sau `router.refresh()` đầu tiên của sale props KHÔNG còn phiếu thẻ nào. Bản trước mục 3 ở trạng thái này: (a) hộp rơi sang bước "Tạo phiếu thu thẻ" của một đợt đã VOID và
 * lời nhắc "đừng nhập mã này" biến mất; (b) khách quẹt theo mã cũ ⇒ giao dịch vào hàng chờ gắn tay, nhưng màn không nói gì.
 *
 * FIXTURE ĐI QUA ĐƯỜNG THẬT (khuôn `payment-requests-hop-the-loi-ra.test.tsx`): view do `dungPhieuPosChoDon` (cả picker `chonPhieuPosHienThi`) dựng từ hàng thô.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { dungPhieuPosChoDon, dungPhieuPosView, type PhieuPosDeXem } from "@/lib/payments/pos/phieu-pos-luat";
import type { PhieuGopView } from "./cong-no-theo-con";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  message: vi.fn(),
  info: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, warning: h.warning, message: h.message, info: h.info } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../_actions", () => ({
  taoPhieuGopAction: vi.fn(),
  huyPhieuGopAction: vi.fn(),
  dongPhieuGopAction: vi.fn(),
  taoPhieuPosAction: vi.fn(),
  kiemTraPhieuPosAction: vi.fn(),
  baoAdminPhieuPosAction: vi.fn(),
  huyPhieuTheAction: vi.fn(),
}));
vi.mock("../_qr-actions", () => ({ issueQrForRequest: vi.fn(), regenerateQr: vi.fn() }));
vi.mock("../_pos-sai-ma-actions", () => ({ timUngVienSaiMaAction: vi.fn(), guiSaiMaAction: vi.fn() }));

import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";

const BAY_GIO = new Date("2026-10-09T06:30:00Z");
const PHUT = 60_000;
const TAO = new Date(BAY_GIO.getTime() - 2 * PHUT);

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
const DOT_DA_HUY: PaymentRequestRow = { ...DOT, status: "VOID" };

function raw(p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem {
  return {
    id: "i1",
    code5: "H6WR4",
    amount: 800_000,
    status: "CHO_QUET",
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 60 * PHUT),
    lastCheckAt: null,
    lastResultKind: null,
    lastResultMessage: null,
    paymentBillId: "b1",
    posTerminal: { id: "m1", maThietBi: "TB-1", maQuay: "QTTFBKATK", ten: null },
    bankTransaction: null,
    paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr3" }] },
    coGiaoDichChoTay: false,
    saiMaYeuCau: [],
    coDongTheChuaKetLuan: false,
    donDaCoVetBac: false,
    ...p,
  };
}
const PHIEU_MO = { billId: "b1", tongTien: 800_000, dong: [{ paymentRequestId: "pr3", ten: "Đợt 3", soTien: 800_000 }] };

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
const goc = (q: Partial<Props> = {}): Props => ({
  orderId: "o1",
  requests: [DOT],
  initialSessions: {},
  canManage: false,
  duocPhatPhieu: true,
  duocDongPhieu: false,
  batThuTheoCon: true,
  phieuGop: phieuGop(),
  duocThuThePos: true,
  phieuPos: dungPhieuPosView({ intent: raw(), phieuMo: PHIEU_MO, now: BAY_GIO }),
  mayPos: [{ id: "m1", nhan: "QTTFBKATK" }],
  khaiMay: { title: "Khai máy ở Cơ sở → Máy POS quẹt thẻ", href: null },
  ...q,
});

/** Trang SAU dừng học: đợt VOID, phiếu gộp không còn mở, phiếu thẻ HUY trên phiếu gộp VOID. `choTay` = giao dịch quẹt theo mã cũ đã về hàng chờ gắn tay. */
const sauDungHoc = (choTay: boolean): Partial<Props> => ({
  requests: [DOT_DA_HUY],
  phieuGop: null,
  // Đi qua picker thật: phiếu HUY nằm trên phiếu gộp VOID, `phieuMo = null`.
  phieuPos: dungPhieuPosChoDon({
    ds: [raw({ status: "HUY", coGiaoDichChoTay: choTay, paymentBill: { status: "VOID", lines: [{ paymentRequestId: "pr3" }] } })],
    phieuMo: null,
    now: BAY_GIO,
  }),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BAY_GIO);
  vi.clearAllMocks();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("[HN6-HD-01] hộp thẻ đang mở mà phiếu thẻ biến khỏi props (dừng học huỷ kèm) ⇒ hộp ĐÓNG và NÓI, không rơi sang 'Tạo phiếu thu thẻ'", () => {
  it("[HN6-HD-01a] hộp mở trên phiếu ĐANG CHỜ ⇒ trang mới không còn phiếu thẻ ⇒ hộp đóng + toast cảnh báo; không nút 'Tạo phiếu thu thẻ'", () => {
    const v = render(<PaymentRequestsSection {...goc()} />);
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
    expect(screen.getByRole("dialog", { name: /Thu thẻ POS/ }), "fixture: hộp mở trên phiếu đang chờ").toBeTruthy();

    v.rerender(<PaymentRequestsSection {...goc(sauDungHoc(false))} />);

    expect(screen.queryByRole("dialog"), "hộp phải đóng").toBeNull();
    expect(screen.queryByRole("button", { name: /Tạo phiếu thu thẻ/ }), "không bước chọn máy của một đợt đã VOID").toBeNull();
    expect(h.warning, "phải NÓI vì sao hộp biến mất").toHaveBeenCalledTimes(1);
    expect(String(h.warning.mock.calls[0]?.[0])).toMatch(/Phiếu thẻ này đã đóng/);
    expect(String(h.warning.mock.calls[0]?.[0])).toMatch(/ĐỪNG cho khách quẹt/);
  });

  it("[HN6-HD-01b] ĐỐI CHỨNG DƯƠNG — trang mới VẪN còn phiếu (cập nhật bình thường sau một lượt Kiểm tra) ⇒ hộp KHÔNG đóng, không toast", () => {
    const v = render(<PaymentRequestsSection {...goc()} />);
    fireEvent.click(screen.getByRole("button", { name: /Thẻ · đang chờ/ }));
    v.rerender(
      <PaymentRequestsSection
        {...goc({
          phieuPos: dungPhieuPosView({
            intent: raw({ lastCheckAt: new Date(BAY_GIO.getTime() - PHUT), lastResultKind: "NOT_FOUND", lastResultMessage: "x" }),
            phieuMo: PHIEU_MO,
            now: BAY_GIO,
          }),
        })}
      />,
    );
    expect(screen.getByRole("dialog", { name: /Thu thẻ POS/ })).toBeTruthy();
    expect(h.warning).not.toHaveBeenCalled();
  });

  it("[HN6-HD-01c] ĐỐI CHỨNG DƯƠNG — hộp ở BƯỚC CHỌN MÁY (chưa có phiếu: intentId = null) KHÔNG bị đóng khi trang chưa có phiếu thẻ nào", () => {
    const hai = [
      { id: "m1", nhan: "QTTFBKATK" },
      { id: "m2", nhan: "QTTFBKATL" },
    ];
    render(<PaymentRequestsSection {...goc({ phieuGop: null, phieuPos: null, mayPos: hai })} />);
    fireEvent.click(screen.getByRole("button", { name: /Thẻ POS/ }));
    expect(screen.getByRole("dialog", { name: /Thu thẻ POS/ }), "bước chọn máy mở ra").toBeTruthy();
    expect(screen.getByRole("button", { name: /Tạo phiếu thu thẻ/ }), "bước chọn máy giữ nguyên").toBeTruthy();
    expect(h.warning).not.toHaveBeenCalled();
  });
});

describe("[HN6-HD-02] phiếu thẻ HUY còn giao dịch chờ tay trên phiếu gộp ĐÃ ĐÓNG ⇒ dải kết quả vẫn báo cho sale (đường thật: picker → view → dải)", () => {
  it("[HN6-HD-02a] có giao dịch chờ tay ⇒ dải có câu 'ĐỪNG cho khách quẹt lại' và nút 'Mở phiếu thẻ'", () => {
    render(<PaymentRequestsSection {...goc(sauDungHoc(true))} />);
    expect(screen.getByText(/ĐỪNG cho khách quẹt lại, chờ kế toán xử lý xong/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mở phiếu thẻ" })).toBeTruthy();
  });

  it("[HN6-HD-02b] ĐỐI CHỨNG DƯƠNG — cùng cảnh, KHÔNG giao dịch chờ tay ⇒ không dải, không câu (phiếu HUY thường biến mất khi phiếu gộp đã đóng)", () => {
    render(<PaymentRequestsSection {...goc(sauDungHoc(false))} />);
    expect(screen.queryByText(/ĐỪNG cho khách quẹt lại/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Mở phiếu thẻ" })).toBeNull();
  });
});
