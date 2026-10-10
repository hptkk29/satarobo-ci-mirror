// @vitest-environment node
/**
 * [NHH-CUT-01] — `docMocCutover`: mốc HỎNG phải NÉM, không được rơi về `null`. THUẦN (giả lập `systemSetting.findUnique`).
 *
 * Vì sao: `null` nghĩa là "chưa đặt mốc ⇒ engine mới không ghi gì" nên một mốc sai dạng mà bị đọc thành `null` thì cổng đường cũ mở
 * toang một cách LẶNG LẼ (05 §2.2c). Cấy 08/10: đổi nhánh ném thành `return null` ⇒ 0 ca đỏ (không bộ nào ghi mốc hỏng vào setting).
 */
import type { PrismaClient } from "@prisma/client";
import { describe, it, expect } from "vitest";

import { KHOA_KY_CUTOVER, docMocCutover, docThangThuocSoMoi } from "./cutover";

function gia(row: { valueJson: unknown } | null) {
  const goi: unknown[] = [];
  const client = {
    systemSetting: {
      findUnique: async (a: unknown) => {
        goi.push(a);
        return row;
      },
    },
  } as unknown as PrismaClient;
  return { client, goi };
}

describe("[NHH-CUT-01] docMocCutover", () => {
  it("[NHH-CUT-01] đọc đúng khoá `hoaHong.kyCutover` THẲNG từ SystemSetting (không qua getSetting cache) và trả đúng chuỗi YYYY-MM", async () => {
    const { client, goi } = gia({ valueJson: "2026-10" });
    expect(await docMocCutover(client)).toBe("2026-10");
    expect(KHOA_KY_CUTOVER).toBe("hoaHong.kyCutover");
    expect(goi).toHaveLength(1);
    expect((goi[0] as { where: { key: string } }).where.key).toBe("hoaHong.kyCutover");
  });

  it("[NHH-CUT-01] CHƯA đặt (không có dòng, hoặc valueJson null) ⇒ null", async () => {
    expect(await docMocCutover(gia(null).client)).toBeNull();
    expect(await docMocCutover(gia({ valueJson: null }).client)).toBeNull();
  });

  it.each([["2026-13"], ["2026-00"], ["26-10"], ["2026-1"], [""], ["2026-10-01"], [202610], [{ thang: "2026-10" }], [true]])(
    "[NHH-CUT-01] mốc sai dạng %j ⇒ NÉM MOC_CUTOVER_HONG (không đoán, không rơi về null)",
    async (v) => {
      await expect(docMocCutover(gia({ valueJson: v }).client)).rejects.toMatchObject({ ma: "MOC_CUTOVER_HONG" });
    },
  );
});

// ── docThangThuocSoMoi — MỘT câu hỏi cho năm cổng đường cũ (04 §3.2) ─────────────────────────────

function giaHai(moc: unknown, coDongSoMoi: boolean) {
  const hoiDong: unknown[] = [];
  const client = {
    systemSetting: { findUnique: async () => (moc === undefined ? null : { valueJson: moc }) },
    commissionTransaction: {
      findFirst: async (a: unknown) => {
        hoiDong.push(a);
        return coDongSoMoi ? { id: "d1" } : null;
      },
    },
  } as unknown as PrismaClient;
  return { client, hoiDong };
}

describe("[NHH-CUT-02] docThangThuocSoMoi — tháng nào thuộc sổ MỚI", () => {
  it("tháng ĐÚNG MỐC thuộc sổ mới kể cả khi CHƯA có dòng sổ nào (mốc là ranh giới BAO GỒM, không phụ thuộc vế 'đã có dòng')", async () => {
    const { client } = giaHai("2026-10", false);
    expect(await docThangThuocSoMoi(client, "2026-10")).toBe(true);
  });

  it("tháng SAU mốc ⇒ true và KHÔNG hỏi vế hai (đường nóng của mọi lượt convert sau cutover)", async () => {
    const { client, hoiDong } = giaHai("2026-10", false);
    expect(await docThangThuocSoMoi(client, "2026-12")).toBe(true);
    expect(hoiDong).toHaveLength(0);
  });

  it("tháng TRƯỚC mốc: chưa có dòng sổ mới ⇒ false (đối chứng dương cho hai ca trên: cổng không phải luôn-true)", async () => {
    const { client, hoiDong } = giaHai("2026-10", false);
    expect(await docThangThuocSoMoi(client, "2026-09")).toBe(false);
    expect(hoiDong).toHaveLength(1);
  });

  it("tháng TRƯỚC mốc nhưng ĐÃ có dòng sổ mới (mốc bị SQL tay dời lên) ⇒ true — vế hai giữ cổng khi vế một hỏng", async () => {
    const { client } = giaHai("2026-10", true);
    expect(await docThangThuocSoMoi(client, "2026-09")).toBe(true);
  });

  it("CHƯA đặt mốc: chưa có dòng ⇒ false; có dòng ⇒ true", async () => {
    expect(await docThangThuocSoMoi(giaHai(undefined, false).client, "2026-11")).toBe(false);
    expect(await docThangThuocSoMoi(giaHai(undefined, true).client, "2026-11")).toBe(true);
  });
});
