import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { gopLead } from "../../lib/lead/gop-lead";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

// =============================================================================
// GỘP HAI LEAD CÙNG MỘT GIA ĐÌNH — tầng DB thật (Postgres LOCAL)
//
// Sinh ra từ sự cố prod 26/09/2026 (0368829724): một gia đình hai hồ sơ, mỗi hồ sơ một
// đơn cho một bé. Chủ dự án chốt: GỘP HAI LEAD, GIỮ NGUYÊN HAI ĐƠN. Fixture dựng đúng hình
// dạng dữ liệu thật đó: lead chính có bé A (có đơn) + một bản TRÙNG tên bé B do Sale thêm
// tay (không gắn gì); lead phụ có bé B thật (có đơn + lịch sử).
// =============================================================================

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "GOPL_";
const SDT = "84900000201";

async function don() {
  const leads = await db.lead.findMany({
    where: { parentName: { startsWith: P } },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  await db.order.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length) {
    await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadStatusHistory.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadChild.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

async function taoDon(code: string, leadId: string, leadChildId: string | null) {
  return db.order.create({
    data: {
      code: `${P}${code}`,
      type: "COURSE",
      customerName: "PH",
      customerPhone: SDT,
      totalAmount: 1,
      leadId,
      leadChildId,
    },
    select: { id: true },
  });
}

/** Dựng đúng hình dạng ca 0368829724. */
async function dungCaThat() {
  const chinh = await db.lead.create({
    data: { parentName: `${P}Chính`, phone: SDT, status: "DA_DANG_KY" },
  });
  const phu = await db.lead.create({
    data: { parentName: `${P}Phụ`, phone: `0${SDT.slice(2)}`, status: "DA_DANG_KY", note: "ghi chú phụ" },
  });
  const beA = await db.leadChild.create({ data: { leadId: chinh.id, fullName: "Bé An" } });
  const beBTrung = await db.leadChild.create({ data: { leadId: chinh.id, fullName: "Bé Bình" } });
  const beB = await db.leadChild.create({
    data: { leadId: phu.id, fullName: "bé bình", schoolName: "TH Phù Đổng" },
  });
  const donA = await taoDon("A", chinh.id, beA.id);
  const donB = await taoDon("B", phu.id, beB.id);
  await db.leadActivity.create({
    data: { leadId: phu.id, type: "NOTE", content: "hoạt động của lead phụ", actorName: "t" },
  });
  return { chinh, phu, beA, beBTrung, beB, donA, donB };
}

describe.skipIf(!RUN)("Gộp lead — tầng DB thật", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[GOP-01] gộp thật: hai đơn GIỮ NGUYÊN, chỉ đổi lead; bé trùng rỗng bị thay; lead phụ xoá mềm", async () => {
    const x = await dungCaThat();

    const kq = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" });
    expect(kq.daGhi).toBe(true);

    const donA = await db.order.findUniqueOrThrow({ where: { id: x.donA.id } });
    const donB = await db.order.findUniqueOrThrow({ where: { id: x.donB.id } });
    expect(donA.leadId).toBe(x.chinh.id);
    expect(donA.leadChildId).toBe(x.beA.id);
    expect(donB.leadId).toBe(x.chinh.id);
    // Đơn của bé B vẫn trỏ ĐÚNG bản ghi bé đang giữ lịch sử — bản ghi đó dời sang lead chính.
    expect(donB.leadChildId).toBe(x.beB.id);

    const con = await db.leadChild.findMany({
      where: { leadId: x.chinh.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    expect(con.map((c) => c.id).sort()).toEqual([x.beA.id, x.beB.id].sort());
    expect(await db.leadChild.count({ where: { id: x.beBTrung.id } })).toBe(0);

    const phu = await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } });
    expect(phu.deletedAt).not.toBeNull();
    expect(await db.leadActivity.count({ where: { leadId: x.phu.id } })).toBe(0);

    const lichSu = await db.leadActivity.findMany({
      where: { leadId: x.chinh.id },
      select: { content: true },
    });
    const noi = lichSu.map((a) => a.content).join("\n");
    expect(noi).toContain("hoạt động của lead phụ");
    expect(noi).toContain("[Gộp lead]");
    expect(noi).toContain("ghi chú phụ");
  }, 60_000);

  it("[GOP-02] chạy thử: in kế hoạch đúng số, KHÔNG đổi một dòng nào", async () => {
    const x = await dungCaThat();

    const kq = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: false, actorName: "t" });

    expect(kq.daGhi).toBe(false);
    expect(kq.bangDoi.Order).toBe(1);
    expect(kq.bangDoi.LeadActivity).toBe(1);
    expect(kq.con).toEqual([
      expect.objectContaining({ ten: "bé bình", cach: "thay-ban-trung-rong" }),
    ]);
    expect((await db.order.findUniqueOrThrow({ where: { id: x.donB.id } })).leadId).toBe(x.phu.id);
    expect((await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } })).deletedAt).toBeNull();
    expect(await db.leadChild.count({ where: { id: x.beBTrung.id } })).toBe(1);
  }, 60_000);

  it("[GOP-03] hai lead KHÁC SĐT ⇒ từ chối, không đổi gì", async () => {
    const x = await dungCaThat();
    await db.lead.update({ where: { id: x.phu.id }, data: { phone: "84900000299" } });

    await expect(
      gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" }),
    ).rejects.toThrow(/khác số điện thoại/);
    expect((await db.order.findUniqueOrThrow({ where: { id: x.donB.id } })).leadId).toBe(x.phu.id);
  }, 60_000);

  it("[GOP-04] bé trùng mà CẢ HAI bản đều có đơn ⇒ giữ bản ở lead chính, dời đơn của bản kia sang", async () => {
    const x = await dungCaThat();
    const donTrung = await taoDon("TRUNG", x.chinh.id, x.beBTrung.id);

    const kq = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" });

    expect(kq.con).toEqual([expect.objectContaining({ cach: "gop-vao-con-co-san" })]);
    const donB = await db.order.findUniqueOrThrow({ where: { id: x.donB.id } });
    expect(donB.leadId).toBe(x.chinh.id);
    expect(donB.leadChildId).toBe(x.beBTrung.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: donTrung.id } })).leadChildId).toBe(
      x.beBTrung.id,
    );
    expect(await db.leadChild.count({ where: { id: x.beB.id } })).toBe(0);
    // Ô trống của bản giữ được bù từ bản bị gộp — không mất trường học đã khai.
    expect(
      (await db.leadChild.findUniqueOrThrow({ where: { id: x.beBTrung.id } })).schoolName,
    ).toBe("TH Phù Đổng");
  }, 60_000);

  it("[GOP-05] gộp một lead vào CHÍNH NÓ ⇒ từ chối", async () => {
    const x = await dungCaThat();
    await expect(
      gopLead(db, { phuId: x.chinh.id, chinhId: x.chinh.id, apply: true, actorName: "t" }),
    ).rejects.toThrow(/chính nó/);
  }, 60_000);
});
