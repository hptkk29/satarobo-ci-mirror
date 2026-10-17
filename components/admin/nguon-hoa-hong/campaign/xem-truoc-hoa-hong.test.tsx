// @vitest-environment jsdom
/**
 * [AFX-*] — XemTruocHoaHong (AFF-L1) trên PHẦN TỬ THẬT: mỗi trạng thái của kết quả xem trước nói ĐÚNG và KHÔNG bịa số.
 *
 *   [AFX-01] chưa chọn đối tác ⇒ chỉ đường tới «Xem trước nguồn»; chọn rồi mà không thấy đối tác ⇒ nói thế
 *   [AFX-02] «Chưa tính được» luôn kèm LÝ DO (nguồn cần xem tay · chưa có chính sách · chồng lấn) — không in "0đ"
 *   [AFX-03] vượt trần: nói tổng + trần, link nâng trần CHỈ khi có quyền (đối chứng: không quyền ⇒ chữ)
 *   [AFX-04] kết quả OK: đủ campaign · nguồn đã giải · đối tác mẫu · sự kiện · cơ sở tính · chính sách; tiền của đối tác; vai không người nói rõ «chỉ tính vào trần»; câu giả định luôn in
 *   [AFX-05] vai AFFILIATE không ra tiền (EXCLUDE / không có quy tắc) ⇒ nói «không có», KHÔNG in 0đ
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { KetQuaXemTruocHoaHong } from "@/lib/affiliate/xem-truoc-hoa-hong";
import { XemTruocHoaHong } from "./xem-truoc-hoa-hong";

afterEach(cleanup);

const OK: Extract<KetQuaXemTruocHoaHong, { loai: "OK" }> = {
  loai: "OK",
  campaign: "Tết 2027",
  nguon: "Đối tác giới thiệu",
  doiTac: "Cô Lan",
  suKien: "Khoản học phí đã thu — khách hàng mới",
  coSo: 10_000_000,
  chinhSach: { policyCode: "AFF-TET", versionNo: 2, trangThai: "DRAFT" },
  vai: [
    { roleCode: "AFFILIATE", vai: "Cộng tác viên / đối tác", quyTac: "3%", soTien: 300_000, ghiChu: null },
    { roleCode: "SALE", vai: "Sale", quyTac: "4%", soTien: null, ghiChu: "Không có người trong ví dụ — chỉ tính vào trần" },
  ],
  tiLeTuongDuong: 0.07,
  tran: 0.09,
};
const dung = (ketQua: KetQuaXemTruocHoaHong | null, daChonDoiTac = true, hrefTran: string | null = null) => render(<XemTruocHoaHong ketQua={ketQua} daChonDoiTac={daChonDoiTac} hrefTran={hrefTran} />);

describe("[AFX-01] chưa chọn đối tác", () => {
  it("chưa chọn ⇒ chỉ đường tới #xem-truoc-nguon; đã chọn mà null ⇒ «Không tìm thấy đối tác này»", () => {
    const a = dung(null, false);
    expect(screen.getByRole("link", { name: "Xem trước nguồn" }).getAttribute("href")).toBe("#xem-truoc-nguon");
    a.unmount();
    dung(null, true);
    expect(screen.getByText("Không tìm thấy đối tác này.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Xem trước nguồn" })).toBeNull();
  });
});

describe("[AFX-02] chưa tính được kèm lý do", () => {
  it("nguồn cần xem tay · chưa có chính sách · chồng lấn: mỗi cái một câu, KHÔNG có số tiền", () => {
    const a = dung({ loai: "NGUON_XEM_TAY", lyDo: "Đối tác không thuộc quy tắc nào" });
    expect(screen.getByText(/nguồn của đối tác này cần xem tay — Đối tác không thuộc quy tắc nào/)).toBeTruthy();
    a.unmount();
    const b = dung({ loai: "CHUA_CO_CHINH_SACH" });
    expect(screen.getByText(/chưa có chính sách riêng nào \(nháp hoặc đang áp\)/)).toBeTruthy();
    b.unmount();
    dung({ loai: "CHONG_LAN", lyDo: "Hai quy tắc cùng hạng" });
    expect(screen.getByText(/Hai quy tắc cùng hạng/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d\s?đ/);
  });
});

describe("[AFX-03] vượt trần", () => {
  const vt: KetQuaXemTruocHoaHong = { loai: "VUOT_TRAN", tiLe: 0.1, tran: 0.09 };
  it("nói tổng 10% và trần 9%; có quyền ⇒ liên kết nâng trần; không quyền ⇒ chữ, KHÔNG liên kết", () => {
    const a = dung(vt, true, "/cau-hinh-van-hanh?tab=khach-hang");
    expect(screen.getByRole("alert").textContent).toMatch(/10%.*vượt trần 9%/);
    expect(screen.getByRole("link", { name: /Nâng trần/ }).getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=khach-hang");
    a.unmount();
    dung(vt, true, null);
    expect(screen.queryByRole("link", { name: /Nâng trần/ })).toBeNull();
    expect(screen.getByText(/thao tác của quản trị hệ thống/)).toBeTruthy();
  });
});

describe("[AFX-04] kết quả đầy đủ", () => {
  it("in đủ bối cảnh, tiền của đối tác, vai không người nói rõ, tổng so trần và câu giả định", () => {
    dung(OK);
    for (const nhan of ["Campaign", "Nguồn (đã giải)", "Đối tác mẫu", "Sự kiện", "Cơ sở tính", "Chính sách"]) expect(screen.getByText(nhan)).toBeTruthy();
    expect(screen.getByText("Tết 2027")).toBeTruthy();
    expect(screen.getByText("Cô Lan")).toBeTruthy();
    expect(screen.getByText(/AFF-TET · v2 · bản nháp \(xem trước nếu kích hoạt\)/)).toBeTruthy();
    expect(screen.getByText(/10\.000\.000.*thực thu sau VAT/)).toBeTruthy();
    const dong = screen.getAllByRole("listitem");
    expect(within(dong[0]!).getByText(/300\.000/)).toBeTruthy();
    expect(within(dong[1]!).getByText(/chỉ tính vào trần/)).toBeTruthy();
    expect(screen.getByText(/Hoa hồng dự kiến của đối tác/).textContent).toMatch(/300\.000/);
    expect(screen.getByText(/Giả định: một khoản học phí mẫu/)).toBeTruthy();
    expect(screen.getByText(/7%/)).toBeTruthy();
  });
  it("chính sách ĐANG ÁP ghi «đang áp», không ghi «bản nháp»", () => {
    dung({ ...OK, chinhSach: { policyCode: "AFF-TET", versionNo: 1, trangThai: "ACTIVE" } });
    expect(screen.getByText(/AFF-TET · v1 · đang áp/)).toBeTruthy();
    expect(screen.queryByText(/bản nháp/)).toBeNull();
  });
});

describe("[AFX-05] vai đối tác không ra tiền", () => {
  it("EXCLUDE / không có quy tắc ⇒ «không có (campaign chưa có mức cho vai đối tác)», không in 0đ", () => {
    dung({ ...OK, vai: [{ roleCode: "AFFILIATE", vai: "Cộng tác viên / đối tác", quyTac: "không trả", soTien: null, ghiChu: "Loại trừ rõ ràng" }] });
    expect(screen.getByText(/Hoa hồng dự kiến của đối tác/).textContent).toContain("không có (campaign chưa có mức cho vai đối tác)");
    expect(screen.getByText("Loại trừ rõ ràng")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b0\s?đ/);
  });
});
