// @vitest-environment jsdom
/**
 * [BNH-*] — ma trận + chi tiết phiên bản TÁCH «Hoa hồng nguồn (acquisition)» khỏi «Hoa hồng giao dịch khác» (E2a, 09/10/2026), trên phần tử thật.
 *
 * Tách CHỖ NGỒI, không tách TỔNG: trần 9% đếm cả hai nhóm, nên hàng «Tổng» phải vẫn là MỘT hàng cho cả bảng. Fixture cố ý để vai nguồn ĐỨNG TRƯỚC vai giao dịch trong dữ liệu
 * (đúng thứ tự `sortOrder` của master có vai giới thiệu xen kẽ) — nếu bảng chỉ lặp theo thứ tự đầu vào thì nhóm sẽ lộn.
 *
 *   [BNH-01] ma trận: hai nhóm theo thứ tự cố định (giao dịch → nguồn), mỗi vai nằm đúng nhóm theo cờ master (không theo mã vai)
 *   [BNH-02] ma trận: hàng Tổng MỘT hàng, cộng cả hai nhóm (4% giao dịch + 2% nguồn = 6%)
 *   [BNH-03] ma trận: chỉ có vai giao dịch ⇒ không vẽ tiêu đề nhóm nguồn trống
 *   [BNH-04] chi tiết phiên bản: cùng cách tách; Tổng một hàng
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

import type { PhienBanChiTiet } from "@/lib/hoa-hong/chinh-sach-doc";
import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "@/lib/hoa-hong/chon-quy-tac";
import { dungMaTran } from "@/lib/hoa-hong/ma-tran-chinh-sach";
import { MaTranBang } from "./ma-tran-bang";
import { PhienBanChiTietView } from "./phien-ban-chi-tiet";

afterEach(cleanup);
const NOW = new Date("2026-10-08T03:00:00.000Z");

let seq = 0;
function qt(roleCode: string, giaTri: string): QuyTac {
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
    roleCode,
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    giaTri,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
  };
}

const NHOM = [{ id: "g1", code: "NGUON_X", name: "Nguồn X", coHoaHong: true }];
// vai nguồn đứng TRƯỚC vai giao dịch trong dữ liệu đầu vào
const VAI = [
  { code: "SOURCE_OWNER", name: "Người phụ trách nguồn", isAcquisition: true },
  { code: "SALE", name: "Sale", isAcquisition: false },
  { code: "REFERRER_PARENT_SALE", name: "Sale phụ trách PH giới thiệu", isAcquisition: true },
  { code: "CENTER_MANAGER", name: "Quản lý cơ sở", isAcquisition: false },
];
const nhomTheoMa = new Map(NHOM.map((n) => [n.code, n.name]));
const maTran = (vai = VAI, quyTac = [qt("SALE", "0.04"), qt("SOURCE_OWNER", "0.02")]) =>
  dungMaTran({ quyTac, nhomNguon: NHOM, vai, loai: "NEW", orgUnitPath: "/", rateDate: NOW, thuTuPhamVi: THU_TU_PHAM_VI_MAC_DINH, tran: 0.09 });

const tbodyCua = (khoa: string) => document.querySelector(`tbody[data-nhom-hoa-hong="${khoa}"]`) as HTMLElement;
const hangVai = (tb: HTMLElement) => Array.from(tb.querySelectorAll("th[scope=row]")).map((x) => x.textContent);
const tieuDeNhom = (tb: HTMLElement) => tb.querySelector("th[scope=rowgroup] > span")?.textContent;

describe("[BNH-01] ma trận tách hai nhóm theo cờ master", () => {
  it("«Hoa hồng giao dịch khác» (Sale, Quản lý cơ sở) đứng trước «Hoa hồng nguồn (acquisition)» (Người phụ trách nguồn, Sale phụ trách PH); thứ tự trong nhóm giữ nguyên đầu vào", () => {
    render(<MaTranBang maTran={maTran()} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    const tbs = Array.from(document.querySelectorAll("tbody")).map((t) => t.getAttribute("data-nhom-hoa-hong"));
    expect(tbs).toEqual(["GIAO_DICH", "NGUON"]);
    expect(hangVai(tbodyCua("GIAO_DICH"))).toEqual(["Sale", "Quản lý cơ sở"]);
    expect(hangVai(tbodyCua("NGUON"))).toEqual(["Người phụ trách nguồn", "Sale phụ trách PH giới thiệu"]);
    expect(tieuDeNhom(tbodyCua("GIAO_DICH"))).toBe("Hoa hồng giao dịch khác");
    expect(tieuDeNhom(tbodyCua("NGUON"))).toBe("Hoa hồng nguồn (acquisition)");
  });
});

describe("[BNH-02] hàng Tổng vẫn MỘT hàng cho cả hai nhóm", () => {
  it("Sale 4% (giao dịch) + Người phụ trách nguồn 2% (nguồn) ⇒ cột nguồn X cộng 6%, không phải hai con số rời; chỉ một hàng Tổng", () => {
    render(<MaTranBang maTran={maTran()} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    const tong = screen.getAllByRole("rowheader", { name: /^Tổng/ });
    expect(tong).toHaveLength(1);
    const cells = within(tong[0]!.closest("tr")!).getAllByRole("cell").map((c) => c.textContent);
    expect(cells[0]).toBe("6%"); // cột Nguồn X
    expect(screen.getByText(/Hàng «Tổng» cộng/)).toBeTruthy();
    expect(screen.getByText("cả hai nhóm")).toBeTruthy();
  });
});

describe("[BNH-03] nhóm rỗng", () => {
  it("chỉ có vai giao dịch ⇒ chỉ một nhóm, không tiêu đề «nguồn» trống (đối chứng dương: có vai nguồn ⇒ có tiêu đề)", () => {
    render(<MaTranBang maTran={maTran(VAI.filter((v) => !v.isAcquisition))} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    expect(document.querySelectorAll("tbody")).toHaveLength(1);
    expect(document.querySelector("tbody[data-nhom-hoa-hong=NGUON]")).toBeNull();
    cleanup();
    render(<MaTranBang maTran={maTran()} nhomTheoMa={nhomTheoMa} tranPhanTram="9" />);
    expect(tieuDeNhom(tbodyCua("NGUON"))).toBe("Hoa hồng nguồn (acquisition)");
  });
});

const rule = (roleCode: string, roleName: string, isAcquisition: boolean, rate: string): PhienBanChiTiet["rules"][number] => ({
  transactionTypeCode: "NEW",
  roleCode,
  roleName,
  isAcquisition,
  calcKind: "PERCENT",
  rate,
  fixedAmount: null,
  note: null,
});
const phienBan = (rules: PhienBanChiTiet["rules"]): PhienBanChiTiet => ({
  versionId: "v1",
  versionNo: 2,
  status: "ACTIVE",
  khoa: "DANG_AP_DUNG",
  nhanTrangThai: "Đang áp dụng",
  tone: "success",
  effectiveFrom: new Date("2026-03-22T17:00:00.000Z"),
  effectiveTo: null,
  reason: "Theo SR.QD.208",
  phamVi: { loai: "GLOBAL", nhan: "Chung", nhanDai: "Mọi giao dịch" },
  vanBan: null,
  rules,
  tiLe: [{ loai: "NEW", tongPhanTram: "6", khongTinDuoc: false }],
  tao: { ten: "Phúc", luc: new Date("2026-03-01T03:05:00.000Z") },
  kichHoatLuc: null,
  daDung: false,
});

describe("[BNH-04] chi tiết phiên bản", () => {
  it("vai giao dịch trước, vai nguồn sau (theo cờ của dòng rule); Tổng MỘT hàng = 6%", () => {
    const pb = phienBan([rule("SOURCE_OWNER", "Người phụ trách nguồn", true, "0.02"), rule("SALE", "Sale", false, "0.04")]);
    render(<PhienBanChiTietView pb={pb} now={NOW} />);
    expect(Array.from(document.querySelectorAll("tbody")).map((t) => t.getAttribute("data-nhom-hoa-hong"))).toEqual(["GIAO_DICH", "NGUON"]);
    expect(hangVai(tbodyCua("GIAO_DICH"))).toEqual(["Sale"]);
    expect(hangVai(tbodyCua("NGUON"))).toEqual(["Người phụ trách nguồn"]);
    expect(tieuDeNhom(tbodyCua("GIAO_DICH"))).toBe("Hoa hồng giao dịch khác");
    expect(tieuDeNhom(tbodyCua("NGUON"))).toBe("Hoa hồng nguồn (acquisition)");
    const tong = screen.getAllByRole("rowheader", { name: "Tổng" });
    expect(tong).toHaveLength(1);
    expect(within(tong[0]!.closest("tr")!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["6%"]);
  });
});
