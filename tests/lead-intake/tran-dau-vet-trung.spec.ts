// @vitest-environment node
/**
 * [TDV-*] `daVuotTranDauVetTrung` — TRẦN dấu vết «phiếu trùng» của đường công khai ẩn danh (audit XI · I3), trên Postgres THẬT.
 * Phần chứng minh ĐẦU-CUỐI (gửi lặp qua `/intake`, phản hồi giống hệt) nằm ở `affiliate-intake.spec.ts` [AFI-I3]; ở đây ghim ngữ nghĩa của hàm đếm: theo (lead, nguồn), cửa sổ 24 giờ, `now` do test truyền.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dữ liệu tiền tố `TDV`, dọn theo tiền tố. Ngày TUYỆT ĐỐI (luật 19).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { CUA_SO_DAU_VET_TRUNG_GIO, TRAN_DAU_VET_TRUNG_ANH_DANH, daVuotTranDauVetTrung } from "../../lib/lead/dedup";

const P = "TDV";
const NOW = new Date("2026-10-20T03:00:00.000Z");
const gioTruoc = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);
let seq = 0;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

async function leadMoi() {
  seq += 1;
  return db.lead.create({ data: { parentName: `${P} ${seq}`, phone: `0907800${String(seq).padStart(3, "0")}`, status: "DA_DANG_KY" } });
}
async function trung(leadId: string, n: number, p: { source?: string | null; luc: Date }) {
  for (let i = 0; i < n; i++) {
    await db.leadDuplicate.create({ data: { primaryLeadId: leadId, duplicatePhone: "0907800999", source: p.source === undefined ? "affiliate-intake" : p.source, matchedAt: p.luc } });
  }
}

describe.skipIf(!RUN_DB_TESTS)("[TDV] trần dấu vết trùng ẩn danh", () => {
  beforeAll(don, 60_000);
  afterAll(don, 60_000);

  it("[TDV-01] đúng ngưỡng: TRẦN−1 dấu vết ⇒ chưa vượt; đủ TRẦN ⇒ vượt", async () => {
    const l = await leadMoi();
    await trung(l.id, TRAN_DAU_VET_TRUNG_ANH_DANH - 1, { luc: gioTruoc(1) });
    expect(await daVuotTranDauVetTrung(l.id, "affiliate-intake", NOW)).toBe(false);
    await trung(l.id, 1, { luc: gioTruoc(1) });
    expect(await daVuotTranDauVetTrung(l.id, "affiliate-intake", NOW)).toBe(true);
  });

  it("[TDV-02] cửa sổ 24 giờ: dấu vết cũ hơn cửa sổ KHÔNG tính (còn trong cửa sổ thì tính)", async () => {
    const l = await leadMoi();
    await trung(l.id, TRAN_DAU_VET_TRUNG_ANH_DANH, { luc: gioTruoc(CUA_SO_DAU_VET_TRUNG_GIO + 1) });
    expect(await daVuotTranDauVetTrung(l.id, "affiliate-intake", NOW)).toBe(false);
    const l2 = await leadMoi();
    await trung(l2.id, TRAN_DAU_VET_TRUNG_ANH_DANH, { luc: gioTruoc(CUA_SO_DAU_VET_TRUNG_GIO - 1) });
    expect(await daVuotTranDauVetTrung(l2.id, "affiliate-intake", NOW)).toBe(true);
  });

  it("[TDV-03] đếm theo (lead, nguồn): dấu vết của lead KHÁC hoặc nguồn KHÁC không làm lead này vượt trần", async () => {
    const a = await leadMoi();
    const b = await leadMoi();
    await trung(b.id, TRAN_DAU_VET_TRUNG_ANH_DANH + 2, { luc: gioTruoc(1) }); // lead khác bị bơm
    await trung(a.id, TRAN_DAU_VET_TRUNG_ANH_DANH + 2, { luc: gioTruoc(1), source: "webhook-khac" }); // cùng lead, nguồn khác
    expect(await daVuotTranDauVetTrung(a.id, "affiliate-intake", NOW)).toBe(false);
    expect(await daVuotTranDauVetTrung(a.id, "webhook-khac", NOW)).toBe(true); // đối chứng dương
  });
});
