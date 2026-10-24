// @vitest-environment node
/**
 * [NHH-ISO-*] — BỐN bảng chính sách (văn bản · chính sách · version · rule) phải khai ĐỦ BỐN chỗ của luật Nền #3
 * (đính chính 27/08): `SCOPED_MODELS` · `NULL_IS_GLOBAL_MODELS` · `getModelPrefixes()` · `BACKFILL_SPECS`.
 *
 * Vì sao có tệp này — cấy lỗi 08/10:
 *   · Đổi `nullMeaning` của `CommissionRule` từ NULL_TOAN_HE_THONG sang NULL_CHUA_KHOP ⇒ **0 ca đỏ** (cả `center-bridge.test.ts`
 *     lẫn bộ DB). Đối soát đêm `/api/cron/orgunit-drift` tin vào trường này: "chưa khớp" = nó cố điền `orgUnitId` cho
 *     rule của Hội sở từ `centerId` NULL — tức biến rule dùng chung thành rule không-thuộc-ai.
 *   · Hai chỗ kia (`SCOPED_MODELS`, prefix) đã có lưới chung nhưng chỉ nói "mỗi model phải có", không nói "model hoa hồng
 *     phải khớp NHAU". Tệp này khoá sự nhất quán giữa bốn khai báo cho đúng bốn bảng.
 *
 * Hành vi (CS1 không thấy CS2, vẫn thấy Hội sở) do `[NHH-POL-DB-14]` giữ trên Postgres thật; đây là nửa THUẦN của nó,
 * đỏ ngay trong `pnpm test:unit` không cần DB.
 */
import { describe, it, expect } from "vitest";

import { NULL_IS_GLOBAL_MODELS, SCOPED_MODELS, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPEC_BY_MODEL } from "@/lib/org/center-bridge";

const BON_BANG = ["RegulationDocument", "CommissionPolicy", "CommissionPolicyVersion", "CommissionRule"] as const;

describe("[NHH-ISO] bốn bảng chính sách khai đủ bốn chỗ, nhất quán", () => {
  it("[NHH-ISO-01] SCOPED_MODELS và NULL_IS_GLOBAL_MODELS chứa CẢ BỐN (quên vế sau ⇒ chính sách Hội sở tàng hình với cơ sở)", () => {
    for (const m of BON_BANG) {
      expect(SCOPED_MODELS.has(m), `${m} ∈ SCOPED_MODELS`).toBe(true);
      expect(NULL_IS_GLOBAL_MODELS.has(m), `${m} ∈ NULL_IS_GLOBAL_MODELS`).toBe(true);
    }
  });

  it("[NHH-ISO-02] prefix quyền của cả bốn là `commission_policies:` và KHÔNG rơi về diện rộng (rỗng)", () => {
    for (const m of BON_BANG) expect(getModelPrefixes(m), m).toEqual(["commission_policies:"]);
  });

  it("[NHH-ISO-03] BACKFILL_SPECS: centerId NULL = TOÀN HỆ THỐNG (không phải 'chưa khớp') và có scoped:true — khớp NULL_IS_GLOBAL_MODELS", () => {
    for (const m of BON_BANG) {
      const spec = BACKFILL_SPEC_BY_MODEL.get(m);
      expect(spec, `${m} có trong BACKFILL_SPECS`).toBeDefined();
      expect(spec!.nullMeaning, `${m}.nullMeaning`).toBe("NULL_TOAN_HE_THONG");
      expect(spec!.scoped, `${m}.scoped`).toBe(true);
    }
  });

  it("[NHH-ISO-04] đối chứng: một bảng có thật mà KHÔNG phải 'toàn hệ thống' vẫn đọc ra giá trị khác — phép so ở ISO-03 không phải hằng đúng", () => {
    const khac = [...BACKFILL_SPEC_BY_MODEL.values()].filter((s) => s.nullMeaning !== "NULL_TOAN_HE_THONG");
    expect(khac.length).toBeGreaterThan(0);
  });
});

const NAM_BANG_SO = ["StudentTransaction", "CommissionPeriod", "CommissionCalcSlot", "CommissionTransaction", "CommissionHold"] as const;

describe("[NHH-ISO] NĂM bảng của SỔ hoa hồng (PR5a) khai đủ ba chỗ, nhất quán", () => {
  // Cấy 08/10: bỏ prefix quyền của sổ (`getModelPrefixes` trả []) ⇒ 0 ca đỏ ở bộ thuần — tầm nhìn rơi về diện rộng (lỗi #04), chỉ bộ DB
  // thấy (SEC-05) và chỉ khi có DB. Nửa THUẦN này đỏ ngay trong `pnpm test:unit`.
  it("[NHH-ISO-05] cả năm ∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS (centerId của sổ không bao giờ là 'dùng chung'), prefix quyền KHÔNG rỗng và gồm `commission:` + `commission_periods:`", () => {
    for (const m of NAM_BANG_SO) {
      expect(SCOPED_MODELS.has(m), `${m} ∈ SCOPED_MODELS`).toBe(true);
      expect(NULL_IS_GLOBAL_MODELS.has(m), `${m} ∉ NULL_IS_GLOBAL_MODELS`).toBe(false);
      const p = getModelPrefixes(m);
      expect(p, `${m}: prefix quyền`).toEqual(expect.arrayContaining(["commission:", "commission_periods:"]));
    }
  });

  it("[NHH-ISO-06] BACKFILL_SPECS: sổ/kỳ/ô NOT NULL (BAT_BUOC); phân loại lần mua và hàng chờ NULL = 'chưa quy được cơ sở' (NULL_CHUA_KHOP, chỉ Hội sở thấy) — và cả năm scoped:true", () => {
    const mong: Record<(typeof NAM_BANG_SO)[number], string> = {
      StudentTransaction: "NULL_CHUA_KHOP",
      CommissionPeriod: "BAT_BUOC",
      CommissionCalcSlot: "BAT_BUOC",
      CommissionTransaction: "BAT_BUOC",
      CommissionHold: "NULL_CHUA_KHOP",
    };
    for (const m of NAM_BANG_SO) {
      const spec = BACKFILL_SPEC_BY_MODEL.get(m);
      expect(spec, `${m} có trong BACKFILL_SPECS`).toBeDefined();
      expect(spec!.nullMeaning, `${m}.nullMeaning`).toBe(mong[m]);
      expect(spec!.scoped, `${m}.scoped`).toBe(true);
    }
  });
});
