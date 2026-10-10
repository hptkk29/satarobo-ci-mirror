import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { gopLead } from "../../lib/lead/gop-lead";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { damBaoDanhMucGoc, duLieuNguon } from "./_nguon-fixture";

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
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
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

  // ─── Nguồn lead (PR1 · 07 §3.2) — gộp lead biết hai bảng mới ───────────────────────────────────

  /** Gắn quy nguồn cho một lead với `attributedAt` TUYỆT ĐỐI (luật 19). */
  async function gan(leadId: string, groupId: string, attributedAt: string) {
    await db.$transaction((tx) =>
      taoNguonBanDau(tx, leadId, duLieuNguon(groupId, { attributedAt: new Date(attributedAt), matchedRule: `R_${leadId.slice(-4)}` }), null),
    );
  }

  it("[NHH-SRC-18] cả hai có quy nguồn, phụ SỚM hơn ⇒ chính mang nhóm của phụ + audit + touchpoint GOP_LEAD", async () => {
    const nhom = await damBaoDanhMucGoc(db);
    const x = await dungCaThat();
    await gan(x.chinh.id, nhom.WALK_IN, "2026-09-10T00:00:00.000Z");
    await gan(x.phu.id, nhom.PAID_ADS, "2026-09-01T00:00:00.000Z");

    const kq = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" });

    expect(kq.bangDoi.LeadAttribution).toBe(1);
    expect(kq.nguon.cach).toBe("PHU_THANG");
    const chinh = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: x.chinh.id } });
    expect(chinh.groupId).toBe(nhom.PAID_ADS);
    // First-claim: nguồn thắng mang theo GIỜ GHI NHẬN của nó (không bị đặt lại về giờ gộp) — nếu không,
    // lượt gộp kế tiếp so sai thứ tự.
    expect(chinh.attributedAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    // [M1] Gộp lead là NGOẠI LỆ HỢP LỆ của luật "nguồn gốc bất biến" (khác `doiNguon`): bản thắng mang cả
    // NGUỒN GỐC của nó sang lead chính — nếu không, `attributedAt` đã sớm mà `originalGroupId` vẫn của bản thua.
    expect(chinh.originalGroupId).toBe(nhom.PAID_ADS);
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: x.chinh.id, action: "GOP_LEAD_NGUON" } })).toBe(1);
    const tp = await db.leadTouchpoint.findMany({ where: { leadId: x.chinh.id, kind: "GOP_LEAD" } });
    expect(tp).toHaveLength(1);
    // Touchpoint chụp nhóm CŨ của lead chính (thứ vừa bị thay) — kèm nguồn gốc của bản chụp.
    expect(tp[0]!.claimedGroupId).toBe(nhom.WALK_IN);
    expect(tp[0]!.signals).toMatchObject({
      tuLeadId: x.chinh.id,
      matchedRule: `R_${x.chinh.id.slice(-4)}`,
      attributedAt: "2026-09-10T00:00:00.000Z",
    });
    // Dòng của lead phụ ở LẠI trên lead phụ đã xoá mềm — không xoá, không sửa.
    const phu = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: x.phu.id } });
    expect(phu.groupId).toBe(nhom.PAID_ADS);
    expect((await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } })).deletedAt).not.toBeNull();
  }, 60_000);

  it("[NHH-SRC-18c] chính CHƯA có ⇒ dòng của phụ DỜI sang chính; chính SỚM hơn ⇒ chính giữ + touchpoint chụp phụ", async () => {
    const nhom = await damBaoDanhMucGoc(db);
    // (i) chính chưa có, phụ có.
    const a = await dungCaThat();
    await gan(a.phu.id, nhom.EVENT, "2026-09-01T00:00:00.000Z");
    const kqA = await gopLead(db, { phuId: a.phu.id, chinhId: a.chinh.id, apply: true, actorName: "t" });
    expect(kqA.nguon.cach).toBe("DOI_DONG_PHU");
    expect(kqA.bangDoi.LeadAttribution).toBe(1);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: a.chinh.id } })).groupId).toBe(nhom.EVENT);
    expect(await db.leadAttribution.count({ where: { leadId: a.phu.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: a.chinh.id, action: "GOP_LEAD_NGUON" } })).toBe(1);

    await don();
    // (ii) cả hai có, CHÍNH sớm hơn ⇒ chính giữ.
    const b = await dungCaThat();
    await gan(b.chinh.id, nhom.WALK_IN, "2026-09-01T00:00:00.000Z");
    await gan(b.phu.id, nhom.PAID_ADS, "2026-09-10T00:00:00.000Z");
    const kqB = await gopLead(db, { phuId: b.phu.id, chinhId: b.chinh.id, apply: true, actorName: "t" });
    expect(kqB.nguon.cach).toBe("CHINH_GIU");
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: b.chinh.id } })).groupId).toBe(nhom.WALK_IN);
    const tp = await db.leadTouchpoint.findMany({ where: { leadId: b.chinh.id, kind: "GOP_LEAD" } });
    expect(tp).toHaveLength(1);
    expect(tp[0]!.claimedGroupId).toBe(nhom.PAID_ADS);
    // Bản chụp của lead PHỤ không thắng: ghi đúng nó đến từ lead nào, luật nào, ghi nhận lúc nào.
    expect(tp[0]!.signals).toMatchObject({
      tuLeadId: b.phu.id,
      matchedRule: `R_${b.phu.id.slice(-4)}`,
      attributedAt: "2026-09-10T00:00:00.000Z",
    });
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: b.chinh.id, action: "GOP_LEAD_NGUON" } })).toBe(0);
  }, 60_000);

  it("[NHH-SRC-18e] chỉ CHÍNH có quy nguồn ⇒ CHINH_GIU, không đổi gì; không bên nào có ⇒ KHONG_CO", async () => {
    const nhom = await damBaoDanhMucGoc(db);
    const a = await dungCaThat();
    await gan(a.chinh.id, nhom.WALK_IN, "2026-09-01T00:00:00.000Z");
    const kqA = await gopLead(db, { phuId: a.phu.id, chinhId: a.chinh.id, apply: true, actorName: "t" });
    expect(kqA.nguon).toEqual({ cach: "CHINH_GIU", truoc: "WALK_IN", sau: "WALK_IN" });
    expect(kqA.bangDoi.LeadAttribution).toBe(0);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: a.chinh.id } })).groupId).toBe(nhom.WALK_IN);
    expect(await db.auditLog.count({ where: { entityType: "Lead", entityId: a.chinh.id, action: "GOP_LEAD_NGUON" } })).toBe(0);
    expect(await db.leadTouchpoint.count({ where: { leadId: a.chinh.id } })).toBe(0);

    await don();
    const b = await dungCaThat();
    const kqB = await gopLead(db, { phuId: b.phu.id, chinhId: b.chinh.id, apply: true, actorName: "t" });
    expect(kqB.nguon).toEqual({ cach: "KHONG_CO", truoc: null, sau: null });
    expect(await db.leadAttribution.count({ where: { leadId: { in: [b.chinh.id, b.phu.id] } } })).toBe(0);
  }, 60_000);

  it("[NHH-SRC-18d] touchpoint của phụ dời HẾT sang chính; chạy thử ⇒ 0 dòng đổi ở hai bảng mới", async () => {
    const nhom = await damBaoDanhMucGoc(db);
    const x = await dungCaThat();
    await gan(x.phu.id, nhom.EVENT, "2026-09-01T00:00:00.000Z");
    await db.leadTouchpoint.createMany({
      data: [
        { leadId: x.phu.id, kind: "NHAP_LAI", claimedGroupId: nhom.EVENT },
        { leadId: x.phu.id, kind: "REF_SAU", claimedGroupId: nhom.PAID_ADS },
      ],
    });

    // Chạy thử trước: ghi rồi LÙI — hai bảng mới không đổi một dòng.
    const thu = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: false, actorName: "t" });
    expect(thu.daGhi).toBe(false);
    expect(thu.bangDoi.LeadTouchpoint).toBe(2);
    expect(await db.leadTouchpoint.count({ where: { leadId: x.phu.id } })).toBe(2);
    expect(await db.leadTouchpoint.count({ where: { leadId: x.chinh.id } })).toBe(0);
    expect(await db.leadAttribution.count({ where: { leadId: x.phu.id } })).toBe(1);
    expect(await db.leadAttribution.count({ where: { leadId: x.chinh.id } })).toBe(0);

    await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" });
    expect(await db.leadTouchpoint.count({ where: { leadId: x.phu.id } })).toBe(0);
    expect(await db.leadTouchpoint.count({ where: { leadId: x.chinh.id, kind: { in: ["NHAP_LAI", "REF_SAU"] } } })).toBe(2);
  }, 60_000);

  // ─── [F1] `LeadAttribution.inheritedFromLeadId` — cột trỏ Lead mà tên KHÔNG có "leadId" ──────────────────────

  /** Lead thứ ba (không phải chính/phụ). */
  async function taoLeadKhac(ten: string, phone: string) {
    return db.lead.create({ data: { parentName: `${P}${ten}`, phone, status: "DA_DANG_KY" }, select: { id: true } });
  }
  const keThuaCua = async (leadId: string) =>
    (await db.leadAttribution.findUniqueOrThrow({ where: { leadId }, select: { inheritedFromLeadId: true } })).inheritedFromLeadId;
  async function ganKeThua(leadId: string, groupId: string, tuLeadId: string | null) {
    await db.$transaction((tx) =>
      taoNguonBanDau(tx, leadId, duLieuNguon(groupId, { inheritedFromLeadId: tuLeadId, matchedRule: "KE_THUA_SDT" }), null),
    );
  }

  it("[NHH-SRC-18f] dòng quy nguồn của lead KHÁC đang kế thừa từ lead phụ ⇒ trỏ sang lead chính; chạy thử không đổi gì", async () => {
    const nhom = await damBaoDanhMucGoc(db);
    const x = await dungCaThat();
    const khac = await taoLeadKhac("Khac", "84900000298");
    const dungYen = await taoLeadKhac("DungYen", "84900000297");
    const goc = await taoLeadKhac("Goc", "84900000296");
    await ganKeThua(khac.id, nhom.WALK_IN, x.phu.id);
    await ganKeThua(dungYen.id, nhom.WALK_IN, goc.id); // đối chứng: kế thừa từ lead KHÔNG liên quan

    const thu = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: false, actorName: "t" });
    expect(thu.bangDoi.LeadAttributionKeThua).toBe(1); // số của phép ghi thật…
    expect(await keThuaCua(khac.id)).toBe(x.phu.id); // …rồi LÙI

    const kq = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" });
    expect(kq.bangDoi.LeadAttributionKeThua).toBe(1);
    expect(await keThuaCua(khac.id)).toBe(x.chinh.id);
    // Đối chứng dương: dòng kế thừa từ lead khác KHÔNG bị chạm.
    expect(await keThuaCua(dungYen.id)).toBe(goc.id);
    // Không còn ai trỏ vào lead phụ (đã xoá mềm).
    expect(await db.leadAttribution.count({ where: { inheritedFromLeadId: x.phu.id } })).toBe(0);
  }, 60_000);

  it("[NHH-SRC-18g] sau gộp mà dòng sẽ TỰ TRỎ vào chính nó (chính kế thừa từ phụ / phụ kế thừa từ chính) ⇒ NULL, không tự tham chiếu", async () => {
    const nhom = await damBaoDanhMucGoc(db);
    // (i) chỉ CHÍNH có quy nguồn, kế thừa từ phụ ⇒ CHINH_GIU + NULL.
    const a = await dungCaThat();
    await ganKeThua(a.chinh.id, nhom.WALK_IN, a.phu.id);
    await gopLead(db, { phuId: a.phu.id, chinhId: a.chinh.id, apply: true, actorName: "t" });
    expect(await keThuaCua(a.chinh.id)).toBeNull();

    await don();
    // (ii) chỉ PHỤ có quy nguồn, kế thừa từ chính ⇒ dòng DỜI sang chính (DOI_DONG_PHU) rồi NULL.
    const b = await dungCaThat();
    await ganKeThua(b.phu.id, nhom.WALK_IN, b.chinh.id);
    const kqB = await gopLead(db, { phuId: b.phu.id, chinhId: b.chinh.id, apply: true, actorName: "t" });
    expect(kqB.nguon.cach).toBe("DOI_DONG_PHU");
    expect(await keThuaCua(b.chinh.id)).toBeNull();

    await don();
    // (iii) cả hai có, PHỤ thắng (sớm hơn) và mang kế thừa từ chính ⇒ PHU_THANG rồi NULL.
    const c = await dungCaThat();
    await gan(c.chinh.id, nhom.WALK_IN, "2026-09-10T00:00:00.000Z");
    await db.$transaction((tx) =>
      taoNguonBanDau(
        tx,
        c.phu.id,
        duLieuNguon(nhom.PAID_ADS, {
          attributedAt: new Date("2026-09-01T00:00:00.000Z"),
          inheritedFromLeadId: c.chinh.id,
          matchedRule: "KE_THUA_SDT",
        }),
        null,
      ),
    );
    const kqC = await gopLead(db, { phuId: c.phu.id, chinhId: c.chinh.id, apply: true, actorName: "t" });
    expect(kqC.nguon.cach).toBe("PHU_THANG");
    expect(await keThuaCua(c.chinh.id)).toBeNull();

    await don();
    // (iv) đối chứng dương: chính kế thừa từ lead THỨ BA ⇒ giữ nguyên (không bị NULL oan).
    const d = await dungCaThat();
    const goc = await taoLeadKhac("Goc2", "84900000295");
    await ganKeThua(d.chinh.id, nhom.WALK_IN, goc.id);
    await gopLead(db, { phuId: d.phu.id, chinhId: d.chinh.id, apply: true, actorName: "t" });
    expect(await keThuaCua(d.chinh.id)).toBe(goc.id);
  }, 120_000);

  it("[NHH-SRC-18h] LƯỚI CỘT LẠ thấy cột tên 'inheritedFromLeadId' ở bảng chưa khai ⇒ gộp lead TỪ CHỐI, 0 dòng đổi", async () => {
    const x = await dungCaThat();
    await db.$executeRawUnsafe(`CREATE TABLE "GOPL_cot_la" ("inheritedFromLeadId" text)`);
    try {
      await expect(
        gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" }),
      ).rejects.toThrow(/GOPL_cot_la\.inheritedFromLeadId/);
    } finally {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "GOPL_cot_la"`);
    }
    expect((await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } })).deletedAt).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: x.donB.id } })).leadId).toBe(x.phu.id);
    // Đối chứng dương: bỏ bảng lạ đi thì gộp chạy bình thường.
    const kq = await gopLead(db, { phuId: x.phu.id, chinhId: x.chinh.id, apply: true, actorName: "t" });
    expect(kq.daGhi).toBe(true);
  }, 60_000);
});
