// @vitest-environment node
/**
 * [L2-W*] · [L2-OR-*] · [L2-KT-*] — lưới DÂY NỐI + phần THUẦN của người hưởng tổ chức (AFF-L2). Không DB, không đồng hồ.
 *
 * Lưới dây nối (luật 11: neo hẹp, BỎ chú thích, ĐẾM số lần khớp) canh những thứ mà test hành vi chạm DB không thấy khi một chỗ bị gỡ:
 *   [L2-W1]  cột `CommissionRule.dungCuaSoNguon` đi qua CẢ BA đường dựng rule (soạn mới · chép sang version mới · nạp thành `QuyTac`) — mất một đường là chính sách «dùng cửa sổ nguồn» im lặng đổi nghĩa
 *   [L2-W2]  `ghiDong` — đường ghi sổ DUY NHẤT — suy trạng thái chi ban đầu từ loại người hưởng (một lời gọi), và `createMany` vẫn chỉ có một
 *   [L2-W3]  MỌI chỗ dựng dòng sổ khai `beneficiaryType` (dongTuNhap · saoTuDongGoc · LEGACY_REVERSAL · dòng khiếu nại đích khoản thu)
 *   [L2-W4]  `dungDauVaoChinhSach` truyền `baoVeCampaign` từ kết quả đo thật (không hằng)
 *   [L2-W5]  tính tiền KHÔNG có bản thứ hai của «rule nào thắng»: `tinh-dong-cho-khoan` gọi `chonQuyTacNguonRo`, và `tinhChinhSachChoPhan` cũng gọi đúng hàm đó
 *   [L2-W6]  D-E: Affiliate/Campaign KHÔNG tự định nghĩa NEW/RENEWAL (engine mới là nguồn sự thật)
 *   [L2-W7]  kỳ sang PAID không bị dòng ON_HOLD giữ lại; không còn phép `not: "PAID"` trần
 *   [L2-W8]  guardrail đọc kiểu tính được phép từ MỘT hằng (`KIEU_TINH_HO_TRO`)
 *   [L2-OR]  `voiTrangThaiChiBanDau` + dòng khiếu nại của người nhận cá nhân từ mẫu tổ chức
 *   [L2-KT]  `KIEU_TINH_HO_TRO` không có FIXED/TIER (D-F: dừng, xem notes)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommissionTransaction } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { KIEU_TINH_HO_TRO } from "./chon-quy-tac";
import { voiTrangThaiChiBanDau } from "./ghi-so";
import { dungDongDieuChinhKhieuNai } from "./khieu-nai-dieu-chinh";

/** Đọc tệp nguồn, BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa đúng chuỗi đang canh — luật 11). */
function doc(duong: string): string {
  const s = readFileSync(resolve(process.cwd(), duong), "utf8");
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}
const dem = (g: string, mau: string): number => g.split(mau).length - 1;

describe("[L2-W1] dungCuaSoNguon đi qua cả ba đường dựng rule", () => {
  const g = doc("lib/hoa-hong/chinh-sach-service.ts");
  it("soạn mới (dongRule) ghi cột; chép sang version mới (docRuleInput) và nạp thành QuyTac (quyTacTuVersion) mang nó theo", () => {
    expect(dem(g, "dungCuaSoNguon: r.dungCuaSoNguon === true")).toBe(1);
    expect(dem(g, "...(r.dungCuaSoNguon ? { dungCuaSoNguon: true } : {})")).toBe(2);
  });
});

describe("[L2-W2] ghiDong suy trạng thái chi ban đầu từ loại người hưởng", () => {
  const g = doc("lib/hoa-hong/ghi-so.ts");
  it("đúng MỘT lời gọi `moi.map(voiTrangThaiChiBanDau)` và `createMany` vẫn chỉ MỘT chỗ", () => {
    expect(dem(g, "moi.map(voiTrangThaiChiBanDau)")).toBe(1);
    expect(dem(g, "commissionTransaction.createMany(")).toBe(1);
  });
});

describe("[L2-W3] mọi chỗ dựng dòng sổ khai beneficiaryType", () => {
  it("quet-khoan.ts: dongTuNhap · saoTuDongGoc · LEGACY_REVERSAL = 3 chỗ; khieu-nai-dieu-chinh.ts: dòng đích khoản thu ghi tường minh PERSON", () => {
    const q = doc("lib/hoa-hong/quet-khoan.ts");
    expect(dem(q, 'beneficiaryType: d.beneficiaryKind === "USER" ? "PERSON" : (doiTac?.partyKind ?? null)')).toBe(1);
    expect(dem(q, "beneficiaryType: g.beneficiaryType")).toBe(1);
    expect(dem(q, 'beneficiaryType: "PERSON"')).toBe(1);
    const k = doc("lib/hoa-hong/khieu-nai-dieu-chinh.ts");
    expect(dem(k, 'beneficiaryType: "PERSON"')).toBe(1);
  });
});

describe("[L2-W4] dungDauVaoChinhSach truyền kết quả đo thật", () => {
  it("`baoVeCampaign: baoVe.baoVe` đúng một chỗ; không có `baoVeCampaign: true|false` gõ tay", () => {
    const g = doc("lib/hoa-hong/dau-vao-chinh-sach.ts");
    expect(dem(g, "baoVeCampaign: baoVe.baoVe")).toBe(1);
    expect(/baoVeCampaign:\s*(true|false)/.test(g)).toBe(false);
  });
});

describe("[L2-W5] một bản duy nhất của «rule nào thắng»", () => {
  it("`chonQuyTacNguonRo` được định nghĩa ở tinh-chinh-sach, gọi MỘT lần trong tinhChinhSachChoPhan và MỘT lần ở tinh-dong-cho-khoan; không còn `chonQuyTac({` ở tinh-chinh-sach ngoài hàm ấy", () => {
    const a = doc("lib/hoa-hong/tinh-chinh-sach.ts");
    expect(dem(a, "export function chonQuyTacNguonRo(")).toBe(1);
    expect(dem(a, "chonQuyTacNguonRo(d, vai.code, nh)")).toBe(1);
    expect(dem(a, "chonQuyTac({")).toBe(1);
    const b = doc("lib/hoa-hong/tinh-dong-cho-khoan.ts");
    expect(dem(b, "chonQuyTacNguonRo(d, v.code, nh)")).toBe(1);
    expect(dem(b, "chonQuyTac(")).toBe(0);
  });
});

describe("[L2-W6] Affiliate/Campaign không tự định nghĩa NEW/RENEWAL", () => {
  it("không tệp nguồn nào ở lib/affiliate/ nhắc RENEWAL · renewedFromEnrollmentId · loaiGiaoDich · transactionType — phân loại là việc của engine hoa hồng (phan-loai-giao-dich)", () => {
    const duyet = (thuMuc: string): string[] =>
      readdirSync(thuMuc).flatMap((t) => {
        const p = join(thuMuc, t);
        return statSync(p).isDirectory() ? duyet(p) : /\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t) ? [p] : [];
      });
    const tep = duyet(resolve(process.cwd(), "lib/affiliate"));
    expect(tep.length, "ĐỐI CHỨNG: lưới thật sự có tệp để quét").toBeGreaterThan(20);
    // MIỄN TRỪ có chủ đích (AFF-L1, gộp sau L2): ba tệp CHỈ nhắc «NEW/RENEWAL» như NHÃN của loại giao dịch trong quy tắc / tham số của bản xem trước (đưa nó vào CHÍNH engine để tính thử) —
    // không phân loại giao dịch. Lý lẽ của lưới là «Affiliate không tự định nghĩa NEW/RENEWAL thứ hai»; nên miễn trừ vẫn đòi: không có `renewedFromEnrollmentId`, không có `phan-loai-giao-dich`.
    const MIEN_TRU = new Set(["lib/affiliate/hoa-hong-campaign-dau-vao.ts", "lib/affiliate/hoa-hong-campaign-doc.ts", "lib/affiliate/xem-truoc-hoa-hong.ts"]);
    const rel = (t: string) => t.slice(process.cwd().length + 1).replace(/\\/g, "/");
    const phamLuat = tep.filter((t) => !MIEN_TRU.has(rel(t)) && /\b(RENEWAL|renewedFromEnrollmentId|loaiGiaoDich|transactionType)\b/.test(doc(rel(t))));
    expect(phamLuat).toEqual([]);
    for (const m of MIEN_TRU) {
      expect(doc(m), `${m}: tệp miễn trừ không được động tới phân loại của engine`).not.toMatch(/renewedFromEnrollmentId|phan-loai-giao-dich|phanLoaiGiaoDich/);
    }
  }, 60_000); // quét ~60 tệp: mặc định 5s là trần của máy nhanh, không phải của luật
});

describe("[L2-W7] kỳ PAID không bị dòng ON_HOLD giữ", () => {
  it('xuat-ky.ts: `payoutStatus: { notIn: ["PAID", "ON_HOLD"] }` đúng một chỗ, không còn `{ not: "PAID" }`', () => {
    const g = doc("lib/hoa-hong/xuat-ky.ts");
    expect(dem(g, 'payoutStatus: { notIn: ["PAID", "ON_HOLD"] }')).toBe(1);
    expect(dem(g, 'payoutStatus: { not: "PAID" }')).toBe(0);
  });
});

describe("[L2-W8] guardrail đọc kiểu tính từ MỘT hằng", () => {
  it("`!KIEU_TINH_HO_TRO.includes(q.kieuTinh)` đúng một chỗ; không còn điều kiện gõ tay trên FIXED_PER_PURCHASE", () => {
    const g = doc("lib/hoa-hong/guardrail-kich-hoat.ts");
    expect(dem(g, "!KIEU_TINH_HO_TRO.includes(q.kieuTinh)")).toBe(1);
    expect(dem(g, 'q.kieuTinh === "FIXED_PER_PURCHASE" ||')).toBe(0);
  });
});

describe("[L2-OR] loại người hưởng → trạng thái chi", () => {
  it("[L2-OR-01] ORGANIZATION ⇒ ON_HOLD; PERSON · null ⇒ nguyên vẹn (đối tượng không đổi, không thêm khoá payoutStatus)", () => {
    const org = { beneficiaryType: "ORGANIZATION" as const, x: 1 };
    expect(voiTrangThaiChiBanDau(org)).toEqual({ ...org, payoutStatus: "ON_HOLD" });
    const nguoi = { beneficiaryType: "PERSON" as const, x: 2 };
    expect(voiTrangThaiChiBanDau(nguoi)).toBe(nguoi);
    expect(Object.keys(voiTrangThaiChiBanDau(nguoi))).not.toContain("payoutStatus");
    const cu = { beneficiaryType: null, x: 3 };
    expect(voiTrangThaiChiBanDau(cu)).toBe(cu);
  });

  /** Mẫu: một dòng của TỔ CHỨC đang ON_HOLD. Chỉ những trường mà hai hàm dưới ĐỌC. */
  const mauToChuc = {
    id: "ct-org",
    idempotencyKey: "k",
    calcSlotId: "slot1",
    paymentId: "pay1",
    orderId: "o1",
    orderItemId: "oi1",
    studentId: "s1",
    leadId: "l1",
    studentTransactionId: "st1",
    transactionTypeCode: "NEW",
    revenueComponent: "TUITION",
    splitMethod: "DONG",
    attributionId: "at1",
    sourceGroupId: "g1",
    sourceGroupCode: "PARTNER",
    sourceId: null,
    affiliateCampaignId: "c1",
    affiliateMembershipId: "m1",
    affiliateReferralId: "r1",
    beneficiaryRoleId: "role1",
    roleCode: "AFFILIATE",
    beneficiaryKind: "AFFILIATE",
    beneficiaryUserId: null,
    beneficiaryAffiliateId: "aff-org",
    beneficiaryEmployeeId: null,
    beneficiaryName: "Trường A",
    beneficiaryType: "ORGANIZATION",
    resolverType: "DIRECT_PERSON",
    resolverBasis: { canCu: "AFFILIATE" },
    policyId: "p1",
    policyVersionId: "pv1",
    versionNo: 1,
    ruleId: "r1",
    documentNumber: "SR.QD.1",
    calcKind: "PERCENT",
    scopeOrderVersion: "v1",
    rateDate: new Date("2026-10-12T03:00:00.000Z"),
    assigneeDate: new Date("2026-10-12T03:00:00.000Z"),
    naturalPeriod: "2026-10",
    vatRate: 0,
    rate: 0.03,
    fixedAmount: null,
    capRate: 0.09,
    equivalentRate: 0.03,
    inputHash: "h",
    centerId: "cs1",
    orgUnitId: "ou1",
  } as unknown as CommissionTransaction;

  const nen = { id: "ct-new", disputeId: "d1", soTien: 50_000, lyDoQuyetDinh: "bù", periodId: "ky1", lateArrival: false } as const;

  it("[L2-OR-02] khiếu nại đích DÒNG của tổ chức giữ loại ORGANIZATION (⇒ ON_HOLD); đích KHOẢN THU cho một USER là PERSON — KHÔNG kế thừa «tổ chức» từ dòng mẫu", () => {
    const dichDong = dungDongDieuChinhKhieuNai({ ...nen, mau: mauToChuc, nguoiNhan: null });
    expect(dichDong).toMatchObject({ beneficiaryKind: "AFFILIATE", beneficiaryAffiliateId: "aff-org", beneficiaryType: "ORGANIZATION" });
    const dichKhoan = dungDongDieuChinhKhieuNai({
      ...nen,
      mau: mauToChuc,
      nguoiNhan: {
        nguoi: { userId: "u-sale", employeeId: "e1", ten: "Sale A" } as never,
        vai: { id: "role-sale", code: "SALE", resolverType: "TRANSACTION_ROLE" } as never,
      },
    });
    expect(dichKhoan).toMatchObject({ beneficiaryKind: "USER", beneficiaryUserId: "u-sale", beneficiaryType: "PERSON" });
    expect(voiTrangThaiChiBanDau(dichKhoan as { beneficiaryType: "PERSON" | "ORGANIZATION" | null })).not.toHaveProperty("payoutStatus");
  });
});

describe("[L2-KT] kiểu tính được hỗ trợ (D-F)", () => {
  it("[L2-KT-01] PERCENT · EXCLUDE · FIXED_PER_PURCHASE (mở ở AFF-L2b — Q14 đã chốt, xem docs/source-commission/closeout/l2b-fixed.md); TIER_PERIOD_BONUS vẫn CHƯA; màn soạn chính sách đọc đúng hằng này", () => {
    expect([...KIEU_TINH_HO_TRO].sort()).toEqual(["EXCLUDE", "FIXED_PER_PURCHASE", "PERCENT"]);
    expect(KIEU_TINH_HO_TRO).not.toContain("TIER_PERIOD_BONUS");
  });
});
