import { describe, expect, it, vi } from "vitest";

import { formatInvoiceCode } from "@/lib/finance/invoice-code";
import { paymentMatchKey } from "@/lib/payments/payment-request";
import { collectMatchKeyCandidates } from "@/lib/payments/ung-vien-ma-khop";
import { noiDungChuyenKhoan } from "./cau-hinh-thanh-toan";
import { MANH_MA_DON_ONLINE, docTienChoDoiSoatCuaDonOnlineDaHuy, ghiChuTienVeDonOnlineHetNhanTien, timDonOnlineHetNhanTienTheoMa } from "./tien-ve-don-het-nhan";
import { MA_CO_SO_DON_ONLINE } from "./tao-don";

/**
 * [TVD] phần THUẦN của «tiền về khi đơn Online hết nhận tiền». Hành vi trên Postgres: `tests/finance/online-tien-ve-don-het-nhan.test.ts`.
 */
describe("[TVD] tiền về trên đơn Online hết nhận tiền", () => {
  const khoaPhieu = paymentMatchKey(formatInvoiceCode(MA_CO_SO_DON_ONLINE, 2026, 1), 0);

  it("[TVD-01] mảnh lọc thô có mặt trong MỌI matchKey của đơn Online — cả khi có tiền tố nội dung chuyển khoản", () => {
    expect(khoaPhieu).toContain(MANH_MA_DON_ONLINE);
    expect(noiDungChuyenKhoan("SR", khoaPhieu)).toContain(MANH_MA_DON_ONLINE);
  });

  it("[TVD-02] nội dung KHÔNG mang mảnh ⇒ không hỏi DB (đường offline không thêm câu tra nào)", async () => {
    const findFirst = vi.fn();
    const cli = { paymentRequest: { findFirst } } as never;
    await expect(timDonOnlineHetNhanTienTheoMa(cli, collectMatchKeyCandidates({ reference: "FT123456", description: "ORD260913000001D1 NguyenVanA 0905123456" }))).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("[TVD-03] ghi chú nêu mã đơn và nói đúng tình trạng; hàng chờ rỗng ⇒ không tra phiếu", async () => {
    expect(ghiChuTienVeDonOnlineHetNhanTien({ maDon: "INV-ONL-2026-0001", trangThai: "CANCELLED" })).toMatch(/INV-ONL-2026-0001 đã huỷ/);
    expect(ghiChuTienVeDonOnlineHetNhanTien({ maDon: "INV-ONL-2026-0001", trangThai: "REFUNDED" })).toMatch(/đã hoàn tiền/);
    const findMany = vi.fn();
    const cli = { bankTransaction: { findMany: vi.fn().mockResolvedValue([]) }, paymentRequest: { findMany } } as never;
    await expect(docTienChoDoiSoatCuaDonOnlineDaHuy(cli, { gioiHan: 10 })).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});
