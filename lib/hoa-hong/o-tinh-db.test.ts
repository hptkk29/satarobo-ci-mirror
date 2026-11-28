// @vitest-environment node
/**
 * [NHH-OT-DB-01..04] — `docTrangThaiO` (nạp trạng thái Ô TÍNH): cơ sở còn lại, sự kiện hoàn đã "khôi phục", mẫu dòng gốc cho người chỉ có dòng điều chỉnh.
 * Giả lập client Prisma (3 câu đọc) nên chạy được KHÔNG cần DB — hàm quyết định nằm trong `docTrangThaiO`, không phải trong câu đọc.
 *
 * Vì sao có tệp này (lượt cấy lỗi PR5b/PR5c, 08/10): bộ DB đo hành vi qua cả pipeline nên ba chỗ dưới đây có thể đổi mà không ca nào đỏ —
 *   · `every` → `some` ở "sự kiện hoàn đã khôi phục hết": cấy ⇒ 0 ca đỏ;
 *   · bỏ `Math.max(0, …)` của cơ sở còn lại: cấy ⇒ 0 ca đỏ;
 *   · bỏ `d.amount > 0` của mẫu dự phòng (dòng điều chỉnh ÂM làm mẫu snapshot): cấy ⇒ 0 ca đỏ.
 */
import { describe, expect, it } from "vitest";

import { MA_KHOI_PHUC_HOAN, docTrangThaiO } from "./o-tinh-db";
import type { Khach } from "./nap-khoan";

type Dong = {
  id: string;
  calcSlotId: string;
  entryKind: string;
  roleCode: string;
  beneficiaryKind: "USER" | "AFFILIATE";
  beneficiaryUserId: string | null;
  beneficiaryAffiliateId: string | null;
  amount: number;
  netBase: number;
  refEventId: string | null;
  periodId: string;
  createdAt: Date;
  refEntryId: string | null;
  reasonCode: string | null;
};

const SLOT = "slot-1";
let dem = 0;
const dong = (p: Partial<Dong> & Pick<Dong, "entryKind" | "amount">): Dong => ({
  id: `d${(dem += 1)}`,
  calcSlotId: SLOT,
  roleCode: "SALE",
  beneficiaryKind: "USER",
  beneficiaryUserId: "u-sale",
  beneficiaryAffiliateId: null,
  netBase: 10_000_000,
  refEventId: null,
  periodId: "ky-1",
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, dem)),
  refEntryId: null,
  reasonCode: null,
  ...p,
});

function khach(netBase: number, dongSo: Dong[]): Khach {
  return {
    commissionCalcSlot: {
      findMany: async () => [
        { id: SLOT, paymentId: "pay-1", orderItemKey: "oi", centerId: "c1", orgUnitId: "ou1", netBase, firstInputHash: "h0", lastMatchedHash: "h0" },
      ],
    },
    commissionTransaction: { findMany: async () => dongSo },
    commissionHold: { findMany: async () => [] },
  } as unknown as Khach;
}

const docO = async (netBase: number, dongSo: Dong[]) => (await docTrangThaiO(khach(netBase, dongSo), [SLOT])).get(SLOT)!;

describe("[NHH-OT-DB-01] cơ sở còn lại = netBase − Σ cơ sở đã đảo (mỗi SỰ KIỆN hoàn tính MỘT lần)", () => {
  it("hai người cùng một sự kiện hoàn (cùng netBase âm) ⇒ trừ MỘT lần, không phải hai; soLanDao = 1", async () => {
    const goc = dong({ entryKind: "ORIGINAL", amount: 300_000 });
    const gocMkt = dong({ entryKind: "ORIGINAL", amount: 100_000, roleCode: "MARKETING", beneficiaryUserId: "u-qc" });
    const daoSale = dong({ entryKind: "REVERSAL", amount: -120_000, netBase: -4_000_000, refEventId: "hoan-1", refEntryId: goc.id });
    const daoQc = dong({ entryKind: "REVERSAL", amount: -40_000, netBase: -4_000_000, refEventId: "hoan-1", refEntryId: gocMkt.id, roleCode: "MARKETING", beneficiaryUserId: "u-qc" });
    const o = await docO(10_000_000, [goc, gocMkt, daoSale, daoQc]);
    expect(o.coSoConLai).toBe(6_000_000);
    expect(o.soLanDao).toBe(1);
  });
});

describe("[NHH-OT-DB-02] sự kiện hoàn bị bác rồi KHÔI PHỤC: chỉ khi MỌI dòng đảo của sự kiện đã được khôi phục thì cơ sở mới được trả lại", () => {
  const goc = dong({ entryKind: "ORIGINAL", amount: 300_000 });
  const gocQc = dong({ entryKind: "ORIGINAL", amount: 100_000, roleCode: "MARKETING", beneficiaryUserId: "u-qc" });
  const daoSale = dong({ entryKind: "REVERSAL", amount: -120_000, netBase: -4_000_000, refEventId: "hoan-2", refEntryId: goc.id });
  const daoQc = dong({ entryKind: "REVERSAL", amount: -40_000, netBase: -4_000_000, refEventId: "hoan-2", refEntryId: gocQc.id, roleCode: "MARKETING", beneficiaryUserId: "u-qc" });
  const khoiPhuc = (d: Dong) =>
    dong({ entryKind: "INPUT_CORRECTION", amount: -d.amount, refEntryId: d.id, reasonCode: MA_KHOI_PHUC_HOAN, roleCode: d.roleCode, beneficiaryUserId: d.beneficiaryUserId });

  it("đối chứng dương: khôi phục CẢ HAI dòng đảo ⇒ cơ sở trả lại đủ 10tr, soLanDao 0", async () => {
    const o = await docO(10_000_000, [goc, gocQc, daoSale, daoQc, khoiPhuc(daoSale), khoiPhuc(daoQc)]);
    expect(o.coSoConLai).toBe(10_000_000);
    expect(o.soLanDao).toBe(0);
  });

  it("MỚI khôi phục MỘT trong hai dòng đảo ⇒ sự kiện vẫn tính là ĐÃ đảo: cơ sở còn 6tr (không trả lại nửa vời)", async () => {
    const o = await docO(10_000_000, [goc, gocQc, daoSale, daoQc, khoiPhuc(daoSale)]);
    expect(o.coSoConLai).toBe(6_000_000);
    expect(o.soLanDao).toBe(1);
  });

  it("dòng INPUT_CORRECTION khác lý do (không phải khôi phục hoàn) KHÔNG làm sự kiện hoàn thành 'đã khôi phục'", async () => {
    const khac = dong({ entryKind: "INPUT_CORRECTION", amount: 120_000, refEntryId: daoSale.id, reasonCode: "INPUT_DRIFT_AP_DUNG" });
    const khac2 = dong({ entryKind: "INPUT_CORRECTION", amount: 40_000, refEntryId: daoQc.id, reasonCode: "INPUT_DRIFT_AP_DUNG", roleCode: "MARKETING", beneficiaryUserId: "u-qc" });
    const o = await docO(10_000_000, [goc, gocQc, daoSale, daoQc, khac, khac2]);
    expect(o.coSoConLai).toBe(6_000_000);
  });
});

describe("[NHH-OT-DB-03] cơ sở còn lại KHÔNG BAO GIỜ âm", () => {
  it("đảo nhiều hơn netBase của ô (dữ liệu lệch) ⇒ kẹp về 0, không ra số âm đem đi tính kỳ vọng", async () => {
    const goc = dong({ entryKind: "ORIGINAL", amount: 30_000, netBase: 1_000_000 });
    const dao1 = dong({ entryKind: "REVERSAL", amount: -30_000, netBase: -900_000, refEventId: "h-a", refEntryId: goc.id });
    const dao2 = dong({ entryKind: "REVERSAL", amount: -1, netBase: -900_000, refEventId: "h-b", refEntryId: goc.id });
    const o = await docO(1_000_000, [goc, dao1, dao2]);
    expect(o.coSoConLai).toBe(0);
  });
});

describe("[NHH-OT-DB-04] mẫu dòng gốc: người KHÔNG có ORIGINAL lấy dòng điều chỉnh DƯƠNG đầu tiên", () => {
  it("chỉ có SOURCE_CORRECTION: dòng ÂM đứng trước KHÔNG được làm mẫu (mẫu là snapshot của một khoản được TRẢ)", async () => {
    const am = dong({ entryKind: "SOURCE_CORRECTION", amount: -10_000, roleCode: "REFERRER_PARENT", beneficiaryUserId: "u-ph" });
    const duong = dong({ entryKind: "SOURCE_CORRECTION", amount: 60_000, roleCode: "REFERRER_PARENT", beneficiaryUserId: "u-ph" });
    const o = await docO(10_000_000, [am, duong]);
    expect(o.dongGoc.get("REFERRER_PARENT|USER|u-ph")).toBe(duong.id);
  });

  it("đối chứng: người CÓ ORIGINAL thì mẫu là ORIGINAL, không phải dòng điều chỉnh dương đứng sau", async () => {
    const goc = dong({ entryKind: "ORIGINAL", amount: 300_000 });
    const sc = dong({ entryKind: "SOURCE_CORRECTION", amount: 60_000 });
    const o = await docO(10_000_000, [goc, sc]);
    expect(o.dongGoc.get("SALE|USER|u-sale")).toBe(goc.id);
  });
});
