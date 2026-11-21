// @vitest-environment jsdom
/**
 * [NHH-FE-CS-*] — các bảng CHỈ-ĐỌC của tab Chính sách trên phần tử thật: hàng chờ · bảng chính sách · ma trận · chi tiết phiên bản.
 *
 * Giống đợt cấy 08/10 của tab Nguồn: bảng chỉ được bao bởi `tsc`, mà `tsc` không thấy chuỗi sai nghĩa (đích liên kết, nhãn "riêng/chung",
 * số in ở ô tổng). Fixture cố ý LỆCH nhau (số khác nhau ở mỗi ô) để phép cấy "đảo hai số" không cho lại đúng số cũ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import type { DongChinhSach, PhienBanChiTiet } from "@/lib/hoa-hong/chinh-sach-doc";
import type { ViecHangCho } from "@/lib/hoa-hong/hang-cho-chinh-sach";
import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "@/lib/hoa-hong/chon-quy-tac";
import { dungMaTran } from "@/lib/hoa-hong/ma-tran-chinh-sach";
import { BangChinhSach } from "./bang-chinh-sach";
import { HangChoChinhSachBang } from "./hang-cho-bang";
import { MaTranBang } from "./ma-tran-bang";
import { PhienBanChiTietView } from "./phien-ban-chi-tiet";

afterEach(cleanup);
const NOW = new Date("2026-10-08T03:00:00.000Z");

const viec = (p: Partial<ViecHangCho>): ViecHangCho => ({
  loai: "NHAP_THIEU_VAN_BAN",
  versionId: "v1",
  policyId: "p1",
  policyCode: "SR.QD.1/A",
  tenChinhSach: "Chính sách A",
  versionNo: 2,
  vai: null,
  lyDo: "Chưa gắn văn bản quy định.",
  ngay: null,
  ...p,
});

describe("[NHH-FE-CS-01] HangChoChinhSachBang", () => {
  it("người được soạn: dòng thiếu văn bản dẫn thẳng bước Văn bản của trình soạn; chưa đủ ngày dẫn bước Hiệu lực", () => {
    render(<HangChoChinhSachBang coTheSoan viec={[viec({}), viec({ loai: "CHUA_DU_NGAY_LAM_VIEC", versionId: "v7", policyId: "p7", policyCode: "SR.QD.7/B", tenChinhSach: "B", ngay: "2026-03-23", lyDo: "sớm" })]} />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/nguon-hoa-hong/chinh-sach/p1/soan?v=v1&buoc=van-ban", "/nguon-hoa-hong/chinh-sach/p7/soan?v=v7&buoc=hieu-luc"]);
    // ngày sớm nhất được in dạng dd/mm/yyyy
    expect(screen.getByText("từ 23/03/2026")).toBeTruthy();
  });

  it("[NHH-FE-CS-01b] người chỉ xem: dòng đi trang chi tiết (không vào trình soạn); việc 'vai chưa có chính sách' KHÔNG phải liên kết và không có mũi tên", () => {
    const vai = viec({ loai: "VAI_KHONG_CO_CHINH_SACH", versionId: null, policyId: null, policyCode: null, tenChinhSach: null, versionNo: null, vai: { code: "AFFILIATE", name: "Cộng tác viên" }, lyDo: "Vai chưa có chính sách" });
    render(<HangChoChinhSachBang coTheSoan={false} viec={[viec({}), vai]} />);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/nguon-hoa-hong/chinh-sach/p1?v=2"]);
    const hangVai = screen.getByText("Cộng tác viên").closest("tr")!;
    expect(within(hangVai).queryByRole("link")).toBeNull();
    expect(hangVai.className).not.toMatch(/cursor-pointer/);
    expect(hangVai.querySelector("svg")).toBeNull();
  });

  it("[NHH-FE-CS-01c] mỗi loại việc có nhãn riêng (không gộp), pill 'Sắp hiệu lực' in đúng ngày", () => {
    render(
      <HangChoChinhSachBang
        coTheSoan
        viec={[viec({ loai: "SAP_HIEU_LUC", ngay: "2026-10-14", lyDo: "Có hiệu lực từ 14/10/2026." }), viec({ loai: "CHUA_DU_NGAY_LAM_VIEC", versionId: "v2", ngay: "2026-03-23" })]}
      />,
    );
    expect(screen.getByText("Sắp hiệu lực")).toBeTruthy();
    expect(screen.getByText("14/10/2026")).toBeTruthy();
    expect(screen.getByText("Chưa đủ 15 ngày làm việc")).toBeTruthy();
  });
});

const dong = (p: Partial<DongChinhSach>): DongChinhSach => ({
  policyId: "p1",
  policyCode: "SR.QD.208/HV_MOI",
  name: "Hoa hồng học viên mới",
  chuSoHuu: "Hội sở",
  chuSoHuuCenterId: null,
  versionId: "v1",
  versionNo: 3,
  status: "ACTIVE",
  khoa: "DANG_AP_DUNG",
  nhanTrangThai: "Đang áp dụng",
  tone: "success",
  phamVi: { loai: "GLOBAL", nhan: "Toàn hệ thống", nhanDai: "Toàn hệ thống (mọi giao dịch thuộc đơn vị sở hữu)" },
  vai: [{ code: "SALE", name: "Sale" }, { code: "MARKETING", name: "Marketing" }, { code: "CENTER_MANAGER", name: "Quản lý cơ sở" }],
  loaiGd: ["NEW", "RENEWAL"],
  tiLe: [{ loai: "NEW", tongPhanTram: "9", khongTinDuoc: false }, { loai: "RENEWAL", tongPhanTram: "3,5", khongTinDuoc: true }],
  vanBan: "SR.QD.208",
  effectiveFrom: new Date("2026-03-22T17:00:00.000Z"),
  effectiveTo: null,
  coBanNhap: { versionId: "v4", versionNo: 4 },
  soPhienBan: 4,
  ...p,
});

describe("[NHH-FE-CS-02] BangChinhSach", () => {
  it("mỗi dòng: liên kết tới trang chi tiết (id, không phải mã); phiên bản + nháp kèm theo; tỉ lệ theo loại; hiệu lực theo giờ VN", () => {
    render(<BangChinhSach dong={[dong({})]} now={NOW} />);
    expect(screen.getByRole("link", { name: "SR.QD.208/HV_MOI" }).getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/p1");
    expect(screen.getByText("v3")).toBeTruthy();
    expect(screen.getByText("+ nháp v4")).toBeTruthy();
    expect(screen.getByText("Mới 9% · Tái tục 3,5%+")).toBeTruthy();
    expect(screen.getByText("từ 23/03/2026")).toBeTruthy(); // 17:00Z hôm trước = 00:00 VN ngày 23
    expect(screen.getByText("Đang áp dụng")).toBeTruthy();
    expect(screen.getByText("Toàn hệ thống")).toBeTruthy();
  });

  it("[NHH-FE-CS-02b] nhiều vai: hai tên đầu + '+N' và title liệt kê đủ; chưa gắn văn bản ⇒ cảnh báo, không để trống", () => {
    render(<BangChinhSach dong={[dong({ vanBan: null })]} now={NOW} />);
    expect(screen.getByText("Sale, Marketing +1").getAttribute("title")).toBe("Sale, Marketing, Quản lý cơ sở");
    expect(screen.getByText("Chưa gắn")).toBeTruthy();
  });

  it("[NHH-FE-CS-02c] chính sách có ngày kết thúc: in ngày CUỐI còn áp dụng (biên mở trừ một ngày), không in nửa đêm kế tiếp", () => {
    render(<BangChinhSach dong={[dong({ effectiveTo: new Date("2026-12-31T17:00:00.000Z") })]} now={NOW} />);
    expect(screen.getByText("23/03/2026 → 31/12/2026")).toBeTruthy();
  });

  it("[NHH-FE-CS-02d] không còn cột 'Loại GD' riêng (gộp vào Tỉ lệ) — và cột 'Mã · Phiên bản' có mặt", () => {
    render(<BangChinhSach dong={[dong({})]} now={NOW} />);
    const th = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(th).toContain("Mã · Phiên bản");
    expect(th).not.toContain("Loại GD");
    expect(th).toContain("Trạng thái");
  });
});

let seq = 0;
function qt(p: Partial<QuyTac> & { roleCode: string; giaTri: number | string }): QuyTac {
  seq += 1;
  return {
    ruleId: `r${seq}`,
    policyId: `pol${seq}`,
    policyCode: `POL-${seq}`,
    versionId: `v${seq}`,
    version: 1,
    documentNumber: "SR",
    scopeType: "GLOBAL",
    scopeKey: "GLOBAL",
    scope: {},
    orgUnitId: null,
    orgUnitPath: "/",
    orgUnitDepth: -1,
    transactionType: "NEW",
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}
const NHOM = [
  { id: "g1", code: "PARENT_REFERRAL", name: "Nguồn từ phụ huynh giới thiệu", coHoaHong: true },
  { id: "g2", code: "PAID_ADS", name: "Nguồn từ Quảng cáo", coHoaHong: true },
];
const VAI = [
  { code: "SALE", name: "Sale", isAcquisition: false },
  { code: "MARKETING", name: "Marketing", isAcquisition: false },
];
const maTran = (quyTac: QuyTac[], tran = 0.09) => dungMaTran({ quyTac, nhomNguon: NHOM, vai: VAI, loai: "NEW", orgUnitPath: "/", rateDate: NOW, thuTuPhamVi: THU_TU_PHAM_VI_MAC_DINH, tran });
const nhomTheoMa = new Map(NHOM.map((n) => [n.code, n.name]));

describe("[NHH-FE-CS-03] MaTranBang", () => {
  const chung = qt({ roleCode: "SALE", giaTri: "0.04", policyId: "pChung", policyCode: "CHUNG" });
  const rieng = qt({ roleCode: "SALE", giaTri: "0.025", policyId: "pRieng", policyCode: "RIENG", version: 3, scopeType: "SOURCE_GROUP", scopeKey: "SOURCE_GROUP:g2", scope: { sourceGroupId: "g2" } });

  it("ô là liên kết tới CHÍNH SÁCH ĐANG THẮNG (kèm số phiên bản), mang nhãn 'riêng'/'chung'", () => {
    render(<MaTranBang maTran={maTran([chung, rieng])} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    const o4 = screen.getByRole("link", { name: /^4%\s*chung$/ });
    expect(o4.getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/pChung?v=1");
    // hai ô cùng 2,5%: cột nhóm Quảng cáo, và cột "Không rõ nguồn" (mức thấp nhất rơi đúng nhóm đó)
    const o25 = screen.getAllByRole("link", { name: /^2,5%\s*riêng/ });
    expect(o25).toHaveLength(2);
    for (const o of o25) expect(o.getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/pRieng?v=3");
    expect(o25.map((o) => o.getAttribute("title"))).toEqual(["RIENG v3", "RIENG v3 · thấp nhất: Nguồn từ Quảng cáo"]);
  });

  it("[NHH-FE-CS-03b] cột UNKNOWN: mức thấp nhất + nêu NHÓM làm nên nó bằng TÊN (không mã)", () => {
    render(<MaTranBang maTran={maTran([chung, rieng])} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    expect(screen.getByText("thấp nhất: Nguồn từ Quảng cáo")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Không rõ nguồn/ })).toBeTruthy();
  });

  it("[NHH-FE-CS-03c] ô không có chính sách: '—' kèm chữ cho trình đọc, KHÔNG phải liên kết; ô chồng lấn: chữ 'Chồng lấn', không liên kết", () => {
    const hai = [qt({ roleCode: "SALE", giaTri: "0.04" }), qt({ roleCode: "SALE", giaTri: "0.05" })];
    render(<MaTranBang maTran={maTran(hai)} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    expect(screen.getAllByText("Chồng lấn").length).toBeGreaterThan(0);
    const hangMarketing = screen.getByRole("rowheader", { name: "Marketing" }).closest("tr")!;
    expect(within(hangMarketing).queryByRole("link")).toBeNull();
    expect(within(hangMarketing).getAllByText("Không có chính sách").length).toBe(3);
  });

  it("[NHH-FE-CS-03e] ô chồng lấn nói LÝ DO bằng chữ nhìn thấy được (chính sách nào chồng nhau), không chỉ trong title — cảm ứng/bàn phím không xem được title", () => {
    // Cấy 08/10: bỏ khối liệt kê ⇒ ô đỏ "Chồng lấn" mà người đọc không biết phải sửa chính sách nào.
    const hai = [qt({ roleCode: "SALE", giaTri: "0.04" }), qt({ roleCode: "SALE", giaTri: "0.05" })];
    render(<MaTranBang maTran={maTran(hai)} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    const vung = screen.getByRole("region", { name: /Ô chồng lấn/ });
    expect(within(vung).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(vung.textContent).toMatch(/chồng lấn chính sách, không đoán/);
    expect(vung.textContent).toMatch(/Sale/);
  });

  it("[NHH-FE-CS-03e2] không có ô chồng lấn ⇒ không vẽ khối liệt kê", () => {
    render(<MaTranBang maTran={maTran([chung, rieng])} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    expect(screen.queryByRole("region", { name: /Ô chồng lấn/ })).toBeNull();
  });

  it("[NHH-FE-CS-03d] dòng tổng in số + chữ 'vượt trần' (không chỉ màu) đúng cột; trần in ở nhãn hàng từ THAM SỐ", () => {
    const nhieu = [chung, qt({ roleCode: "MARKETING", giaTri: "0.06" })]; // 4 + 6 = 10% > 9% ở nhóm g1; g2 có rule riêng 2,5% ⇒ 8,5%
    render(<MaTranBang maTran={maTran([...nhieu, rieng])} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    expect(screen.getByRole("rowheader", { name: /Tổng \/ trần 9%/ })).toBeTruthy();
    const tong = screen.getByRole("rowheader", { name: /Tổng/ }).closest("tr")!;
    const o = within(tong).getAllByRole("cell").map((c) => c.textContent);
    expect(o).toEqual(["10%vượt trần", "8,5%", "8,5%"]);
  });

  it("[NHH-FE-CS-03h] không đọc được trần ⇒ KHÔNG kết luận vượt trần, và nhãn hàng không bịa con số trần", () => {
    const nhieu = [chung, qt({ roleCode: "MARKETING", giaTri: "0.06" })];
    render(<MaTranBang maTran={maTran(nhieu)} nhomTheoMa={nhomTheoMa} tranPhanTram={null} />);
    expect(screen.queryByText("vượt trần")).toBeNull();
    expect(screen.getByRole("rowheader", { name: "Tổng" })).toBeTruthy();
  });

  it("[NHH-FE-CS-03f] chú giải: giải thích riêng/chung + UNKNOWN; chân bảng có dấu * khi cột không tin được", () => {
    const hai = [qt({ roleCode: "SALE", giaTri: "0.04" }), qt({ roleCode: "SALE", giaTri: "0.05" })];
    render(<MaTranBang maTran={maTran(hai)} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    expect(screen.getByText(/mức thấp nhất của từng vai trên các nhóm nguồn, tính động mỗi lần/)).toBeTruthy();
    expect(screen.getByText(/Cột có ô chồng lấn hoặc rule kiểu khác/)).toBeTruthy();
    // Cấy 08/10 (rà soát độc lập): bỏ dấu `*` ở CHÍNH ô tổng XANH — ca này chỉ đọc chân bảng. Dấu `*` nằm ngay cạnh con số là thứ báo "tổng này chưa
    // đủ"; thiếu nó, "0%" của cột chồng lấn đọc như "không ai được trả" thay vì "chưa tính được".
    const tong = screen.getByRole("rowheader", { name: /Tổng/ }).closest("tr")!;
    expect(within(tong).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0%*", "0%*", "0%*"]);
  });

  it("[NHH-FE-CS-03g] vùng cuộn ngang có tổ tiên `relative` (sr-only là position:absolute — thiếu nó thì kéo CẢ TRANG tràn ngang, đã gặp ở tab Nguồn)", () => {
    const { container } = render(<MaTranBang maTran={maTran([chung])} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    const cuon = container.querySelector(".overflow-x-auto")!;
    expect(cuon.className).toMatch(/\brelative\b/);
  });
});

const phienBan = (p: Partial<PhienBanChiTiet> = {}): PhienBanChiTiet => ({
  versionId: "v1",
  versionNo: 2,
  status: "ACTIVE",
  khoa: "DANG_AP_DUNG",
  nhanTrangThai: "Đang áp dụng",
  tone: "success",
  effectiveFrom: new Date("2026-03-22T17:00:00.000Z"),
  effectiveTo: null,
  reason: "Theo SR.QD.208",
  phamVi: { loai: "SOURCE_GROUP", nhan: "Nguồn từ Quảng cáo", nhanDai: "Nhóm nguồn: Nguồn từ Quảng cáo" },
  vanBan: { id: "d1", documentCode: "SR.QD.208", title: "Quy định hoa hồng", publishedOn: "2026-03-02", coTep: true, fileUrl: "https://x.test/a.pdf", fileName: "a.pdf", daThuHoi: false },
  rules: [
    { transactionTypeCode: "NEW", roleCode: "SALE", roleName: "Sale", isAcquisition: false, calcKind: "PERCENT", rate: "0.040000", fixedAmount: null, note: null },
    { transactionTypeCode: "NEW", roleCode: "MARKETING", roleName: "Marketing", isAcquisition: false, calcKind: "EXCLUDE", rate: null, fixedAmount: null, note: null },
    { transactionTypeCode: "RENEWAL", roleCode: "SALE", roleName: "Sale", isAcquisition: false, calcKind: "PERCENT", rate: "0.0125", fixedAmount: null, note: null },
  ],
  tiLe: [{ loai: "NEW", tongPhanTram: "4", khongTinDuoc: false }, { loai: "RENEWAL", tongPhanTram: "1,25", khongTinDuoc: false }],
  tao: { ten: "Phúc", luc: new Date("2026-03-01T03:05:00.000Z") },
  kichHoatLuc: new Date("2026-03-02T03:05:00.000Z"),
  daDung: true,
  ...p,
});

describe("[NHH-FE-CS-04] PhienBanChiTietView", () => {
  it("in rate lưu 0.040000 thành '4%' (không '0.04', không '0,04'); EXCLUDE là 'Không trả'; ô thiếu là '—'", () => {
    render(<PhienBanChiTietView pb={phienBan()} now={NOW} />);
    const bang = screen.getAllByRole("table")[0]!;
    const hangSale = within(bang).getByRole("rowheader", { name: "Sale" }).closest("tr")!;
    expect(within(hangSale).getAllByRole("cell").map((c) => c.textContent)).toEqual(["4%", "1,25%"]);
    const hangMkt = within(bang).getByRole("rowheader", { name: "Marketing" }).closest("tr")!;
    expect(within(hangMkt).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Không trả", "—"]);
    const tong = within(bang).getByRole("rowheader", { name: "Tổng" }).closest("tr")!;
    expect(within(tong).getAllByRole("cell").map((c) => c.textContent)).toEqual(["4%", "1,25%"]);
  });

  it("[NHH-FE-CS-04b] văn bản: số hiệu + tiêu đề + ngày công bố dd/mm/yyyy + liên kết tệp mở tab mới an toàn; phạm vi đủ nghĩa", () => {
    render(<PhienBanChiTietView pb={phienBan()} now={NOW} />);
    expect(screen.getByText("SR.QD.208 — Quy định hoa hồng")).toBeTruthy();
    expect(screen.getByText("công bố 02/03/2026")).toBeTruthy();
    const a = screen.getByRole("link", { name: /a\.pdf/ });
    expect(a.getAttribute("href")).toBe("https://x.test/a.pdf");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Nhóm nguồn: Nguồn từ Quảng cáo")).toBeTruthy();
  });

  it("[NHH-FE-CS-04c] thiếu văn bản / thiếu tệp / đã thu hồi đều NÓI RA (không để trống)", () => {
    const { rerender } = render(<PhienBanChiTietView pb={phienBan({ vanBan: null })} now={NOW} />);
    expect(screen.getByText("Chưa gắn văn bản")).toBeTruthy();
    rerender(<PhienBanChiTietView pb={phienBan({ vanBan: { ...phienBan().vanBan!, coTep: false, fileUrl: null, fileName: null } })} now={NOW} />);
    expect(screen.getByText("Chưa có tệp đính kèm")).toBeTruthy();
    rerender(<PhienBanChiTietView pb={phienBan({ vanBan: { ...phienBan().vanBan!, daThuHoi: true } })} now={NOW} />);
    expect(screen.getByText("Đã thu hồi")).toBeTruthy();
  });

  it("[NHH-FE-CS-04d] đã dùng ⇒ nói 'khoá, chỉ tạo phiên bản mới'; chưa có rule ⇒ nói chưa kích hoạt được", () => {
    const { rerender } = render(<PhienBanChiTietView pb={phienBan()} now={NOW} />);
    expect(screen.getByText(/Đã sinh dòng sổ hoa hồng — khoá/)).toBeTruthy();
    rerender(<PhienBanChiTietView pb={phienBan({ daDung: false, rules: [], tiLe: [] })} now={NOW} />);
    expect(screen.queryByText(/Đã sinh dòng sổ/)).toBeNull();
    expect(screen.getByText(/chưa có rule nào/)).toBeTruthy();
  });

  it("[NHH-FE-CS-04e] hiệu lực: ngày cuối còn áp dụng (biên mở trừ một ngày), giờ VN", () => {
    render(<PhienBanChiTietView pb={phienBan({ effectiveTo: new Date("2026-12-31T17:00:00.000Z") })} now={NOW} />);
    expect(screen.getByText("23/03/2026 → hết 31/12/2026")).toBeTruthy();
  });

  // Cấy 08/10 (rà soát độc lập): bỏ `khongTinDuoc ? "+" : ""` ở dòng Tổng XANH — mọi fixture đều chỉ có PERCENT/EXCLUDE. Có khoản CỐ ĐỊNH thì
  // "4%" ở dòng Tổng chỉ là phần quy được ra phần trăm; thiếu dấu "+" là bảng nói tổng này đầy đủ.
  it("[NHH-FE-CS-04f] rule số tiền cố định: ô in 'đ / lần mua', dòng Tổng mang dấu '+' (chưa gồm khoản cố định)", () => {
    const pb = phienBan({
      rules: [
        { transactionTypeCode: "NEW", roleCode: "SALE", roleName: "Sale", isAcquisition: false, calcKind: "PERCENT", rate: "0.040000", fixedAmount: null, note: null },
        { transactionTypeCode: "NEW", roleCode: "MARKETING", roleName: "Marketing", isAcquisition: false, calcKind: "FIXED_PER_PURCHASE", rate: null, fixedAmount: 500000, note: null },
      ],
      tiLe: [{ loai: "NEW", tongPhanTram: "4", khongTinDuoc: true }],
    });
    render(<PhienBanChiTietView pb={pb} now={NOW} />);
    const bang = screen.getAllByRole("table")[0]!;
    const hangMkt = within(bang).getByRole("rowheader", { name: "Marketing" }).closest("tr")!;
    expect(within(hangMkt).getAllByRole("cell").map((c) => c.textContent)).toEqual(["500.000đ / lần mua"]);
    const tong = within(bang).getByRole("rowheader", { name: "Tổng" }).closest("tr")!;
    expect(within(tong).getAllByRole("cell").map((c) => c.textContent)).toEqual(["4%+"]);
  });
});
