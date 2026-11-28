// @vitest-environment node
/**
 * [KND-*] «Từ ngày / Đến ngày» ở danh sách lead trên Postgres THẬT — `locNgayNhanLead` (lib/lead/khoang-ngay-tao.ts).
 * Ca chính: lead cũ vừa NHẬP LẠI hôm nay phải ra khi lọc hôm nay (cột «Ngày nhận lead» in lastInboundAt, bản cũ lọc createdAt).
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `KND`.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { locNgayNhanLead } from "../../lib/lead/khoang-ngay-tao";

const P = "KND";
const id = (s: string) => `${P}-${s}`;
const VN = (iso: string) => new Date(`${iso}+07:00`);
const don = () => db.lead.deleteMany({ where: { id: { startsWith: P } } });

async function dung() {
  await don();
  const mk = (s: string, createdAt: string, lastInboundAt: string | null) =>
    db.lead.create({ data: { id: id(s), parentName: `PH ${s}`, phone: `09${Math.abs([...s].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)).toString().padStart(8, "0").slice(0, 8)}`, status: "MOI", createdAt: VN(createdAt), lastInboundAt: lastInboundAt ? VN(lastInboundAt) : null } });
  await mk("sang-som", "2026-11-13T00:30:00", "2026-11-13T00:30:00"); // 00:30 VN ngày 13 — bản cũ loại
  await mk("trua", "2026-11-13T11:00:00", "2026-11-13T11:00:00");
  await mk("cuoi-ngay", "2026-11-13T23:59:30", null);
  await mk("hom-sau-sang-som", "2026-11-14T00:30:00", "2026-11-14T00:30:00"); // 00:30 VN ngày 14 — bản cũ cho lọt vào «đến 13»
  await mk("cu-nhap-lai", "2026-08-01T10:00:00", "2026-11-13T10:59:00"); // tạo tháng 8, nhập lại 13/11
  await mk("cu", "2026-08-01T10:00:00", "2026-08-01T10:00:00");
}

const tim = async (tu?: string, den?: string) =>
  (await db.lead.findMany({ where: { id: { startsWith: P }, deletedAt: null, ...(locNgayNhanLead(tu, den) ? { AND: [locNgayNhanLead(tu, den)!] } : {}) }, select: { id: true } }))
    .map((l) => l.id.slice(P.length + 1))
    .sort();

describe.skipIf(!RUN_DB_TESTS)("[KND] lọc ngày nhận lead — Postgres thật", () => {
  beforeEach(dung);
  afterAll(don);

  it("[KND-00] ĐỐI CHỨNG DƯƠNG: không lọc ⇒ đủ 6 phiếu mẫu", async () => {
    expect(await tim()).toEqual(["cu", "cu-nhap-lai", "cuoi-ngay", "hom-sau-sang-som", "sang-som", "trua"]);
  });

  it("[KND-01] 🔴 đúng ngày 13/11 (VN): có 00:30 sáng, trưa, 23:59 và phiếu NHẬP LẠI hôm nay; KHÔNG có 00:30 ngày 14 và phiếu cũ", async () => {
    expect(await tim("2026-11-13", "2026-11-13")).toEqual(["cu-nhap-lai", "cuoi-ngay", "sang-som", "trua"]);
  });

  it("[KND-02] chỉ «Từ ngày» 14/11 ⇒ chỉ phiếu sáng sớm 14; chỉ «Đến ngày» 01/08 ⇒ chỉ phiếu cũ (phiếu nhập lại không còn ở ngày tạo cũ vì cột không in ngày đó)", async () => {
    expect(await tim("2026-11-14")).toEqual(["hom-sau-sang-som"]);
    expect(await tim(undefined, "2026-08-01")).toEqual(["cu"]);
  });
});
