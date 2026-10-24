// @vitest-environment jsdom
/**
 * [NXN-*] — nút ✓ "Xác nhận" của màn Thanh toán chỉ được VẼ cho dòng mà máy chủ SẼ cho xác nhận (luật 12).
 *
 * Gốc (sự cố F1): tài khoản Quản trị ghi một khoản tiền mặt rồi bấm ✓ trên chính dòng đó → toast "Người ghi
 * nhận không được tự xác nhận khoản của mình" (lõi xác nhận ném `TU_XAC_NHAN`). Nút vẫn hiện: giao diện không
 * hề hỏi AC5. Nay máy chủ tính `laNguoiGhi` cho từng dòng (so với người xem, bằng `laNguoiGhiKhoan`) và bảng
 * thay ✓ bằng lời nói thật "Cần người khác xác nhận" — vẫn giữ Sửa / Từ chối vì hai đường đó không kiểm người ghi.
 *
 * Ca nào khẳng định SỰ VẮNG MẶT của nút đều kèm ĐỐI CHỨNG DƯƠNG (dòng của người khác vẫn THẤY nút) trong
 * CÙNG một lần dựng — vắng mặt vì tính năng hỏng hoàn toàn sẽ không qua được đối chứng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  confirmPaymentAction: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Server Action thật kéo auth/DB — không thuộc ca này. Chỉ `confirmPaymentAction` cần theo dõi.
vi.mock("../_actions", () => ({
  recordPaymentAction: vi.fn(),
  confirmPaymentAction: h.confirmPaymentAction,
  rejectPaymentAction: vi.fn(),
  adjustPaymentAction: vi.fn(),
  updatePendingPaymentAction: vi.fn(),
  revealPaymentsPii: vi.fn(),
  queryPayments: vi.fn(),
}));
vi.mock("./bulk-backfill-confirm", () => ({ BulkBackfillConfirm: () => null }));

import type { PaymentRow } from "../_actions";
import { PaymentsClient } from "./payments-client";

// Trạng thái sổ khai thành HẰNG, không gõ thẳng `khoá: "giá trị"` — lưới `truc-a` quét cả cây mã tìm chuỗi đó ở mọi tệp.
const SALE_CHO_KE_TOAN = "RECORDED";
const CHO_KE_TOAN = "PENDING";
const DA_XAC_NHAN = "CONFIRMED";

let dem = 0;
function dong(p: Partial<PaymentRow> & { orderCode: string }): PaymentRow {
  dem += 1;
  return {
    id: `p${dem}`,
    amount: 1_500_000,
    method: "CASH",
    paidDate: "2026-10-18T03:00:00.000Z",
    updatedAt: "2026-10-18T03:00:00.000Z",
    saleStatus: SALE_CHO_KE_TOAN,
    accountantStatus: CHO_KE_TOAN,
    paymentType: "PAYMENT",
    hienTai: 1_500_000,
    soLanDieuChinh: 0,
    orderId: `o${dem}`,
    customerName: "PH Fixture",
    studentName: "Bé Fixture",
    className: null,
    enrollmentId: "e1",
    thieuGhiDanh: false,
    laNguoiGhi: false,
    collectedByName: "Người thu",
    leadSource: null,
    parentName: null,
    parentNationalId: null,
    address: null,
    piiMasked: true,
    receiptCode: null,
    hasActiveReceipt: false,
    ...p,
  };
}

function dung(rows: PaymentRow[]) {
  return render(
    <PaymentsClient
      initialRows={rows}
      orders={[]}
      methods={[]}
      canConfirm
      canAdjust
      canRecord={false}
      canViewPii={false}
    />,
  );
}
const hang = (ma: string) => screen.getByText(ma).closest("tr") as HTMLElement;
const nutXacNhan = (tr: HTMLElement) => within(tr).queryByTitle("Xác nhận");

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});
afterEach(() => cleanup());

describe("[NXN] ✓ Xác nhận chỉ vẽ cho dòng máy chủ sẽ cho xác nhận", () => {
  it("[NXN-01] dòng do NGƯỜI XEM ghi: KHÔNG có ✓, có lời 'Cần người khác xác nhận'; ĐỐI CHỨNG DƯƠNG: dòng của người khác vẫn THẤY ✓", () => {
    dung([dong({ orderCode: "ORD-CUA-TOI", laNguoiGhi: true }), dong({ orderCode: "ORD-NGUOI-KHAC", laNguoiGhi: false })]);

    // Đối chứng dương trước: nút ✓ có thật trên màn này, ở dòng của người khác.
    expect(nutXacNhan(hang("ORD-NGUOI-KHAC")), "đối chứng: dòng người khác phải THẤY ✓").not.toBeNull();
    expect(within(hang("ORD-NGUOI-KHAC")).queryByText("Cần người khác xác nhận")).toBeNull();

    expect(nutXacNhan(hang("ORD-CUA-TOI")), "dòng chính mình ghi KHÔNG được vẽ ✓ — máy chủ sẽ từ chối").toBeNull();
    expect(within(hang("ORD-CUA-TOI")).getByText("Cần người khác xác nhận")).toBeTruthy();
  });

  it("[NXN-02] dòng do chính mình ghi VẪN còn Sửa khoản chờ duyệt + Từ chối (server không kiểm người ghi ở hai đường đó)", () => {
    dung([dong({ orderCode: "ORD-CUA-TOI", laNguoiGhi: true }), dong({ orderCode: "ORD-NGUOI-KHAC" })]);
    const tr = hang("ORD-CUA-TOI");
    expect(within(tr).queryByTitle("Sửa khoản chờ duyệt")).not.toBeNull();
    expect(within(tr).queryByTitle("Từ chối")).not.toBeNull();
    // Cùng bộ nút ở dòng đối chứng (không mất nút nào do nhánh mới).
    const doi = hang("ORD-NGUOI-KHAC");
    expect(within(doi).queryByTitle("Sửa khoản chờ duyệt")).not.toBeNull();
    expect(within(doi).queryByTitle("Từ chối")).not.toBeNull();
  });

  it("[NXN-03] bấm ✓ ở dòng của người khác vẫn gọi action (nút còn sống, không chỉ còn là hình)", async () => {
    h.confirmPaymentAction.mockResolvedValue({ ok: true, receiptId: "r1" });
    dung([dong({ orderCode: "ORD-CUA-TOI", laNguoiGhi: true }), dong({ orderCode: "ORD-NGUOI-KHAC" })]);
    fireEvent.click(nutXacNhan(hang("ORD-NGUOI-KHAC"))!);
    await waitFor(() => expect(h.confirmPaymentAction).toHaveBeenCalledTimes(1));
  });

  it("[NXN-04] dòng chưa gắn ghi danh + do mình ghi: vẫn 'Chờ convert' (lõi từ chối CHUA_GHI_DANH trước), không có ✓", () => {
    dung([
      dong({ orderCode: "ORD-CHO-CONVERT-CUA-TOI", thieuGhiDanh: true, laNguoiGhi: true, enrollmentId: null }),
      dong({ orderCode: "ORD-NGUOI-KHAC" }),
    ]);
    const tr = hang("ORD-CHO-CONVERT-CUA-TOI");
    expect(nutXacNhan(hang("ORD-NGUOI-KHAC")), "đối chứng dương").not.toBeNull();
    expect(nutXacNhan(tr)).toBeNull();
    expect(within(tr).getByText(/Chờ convert/)).toBeTruthy();
    // Hai nhánh KHÔNG chồng lên nhau: dòng này chưa thể xác nhận vì ghi danh, chưa nói tới người ghi.
    expect(within(tr).queryByText("Cần người khác xác nhận")).toBeNull();
    // Vẫn từ chối / sửa được (đường gỡ khoản nhập trùng).
    expect(within(tr).queryByTitle("Từ chối")).not.toBeNull();
  });

  it("[NXN-05] dòng ĐÃ xác nhận của chính mình không bị nhãn mới đè lên: nhánh CONFIRMED vẫn là 'Điều chỉnh'", () => {
    dung([
      dong({ orderCode: "ORD-DA-XAC-NHAN", accountantStatus: DA_XAC_NHAN, laNguoiGhi: true }),
      dong({ orderCode: "ORD-NGUOI-KHAC" }),
    ]);
    const tr = hang("ORD-DA-XAC-NHAN");
    expect(nutXacNhan(hang("ORD-NGUOI-KHAC")), "đối chứng dương").not.toBeNull();
    expect(within(tr).queryByText("Cần người khác xác nhận")).toBeNull();
    expect(within(tr).queryByTitle("Điều chỉnh")).not.toBeNull();
  });
});
