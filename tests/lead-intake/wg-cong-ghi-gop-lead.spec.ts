// @vitest-environment node
/**
 * [WGB-GL-*] CỔNG GHI WAVE 1 cho GỘP LEAD (`gopLead` + `congGhi`) trên Postgres thật. Script `scripts/gop-lead-prod.ts` đi đúng chuỗi này: chạy thử (ghi rồi lùi) → dựng dòng ký → cổng → ghi thật có claim.
 * Khoá EPHEMERAL; môi trường `test`. Ánh xạ WG: xem `tests/lead-intake/wg-cong-ghi.spec.ts` + tài liệu 15 §13.
 *
 * Điểm riêng của gộp lead: kế hoạch chỉ biết SAU khi đã ghi (chạy thử = ghi rồi lùi) ⇒ lõi (1) claim `wg:<nonce>` làm câu đầu tiên, (2) dựng lại kế hoạch TRONG giao dịch và so digest với bản đã ký trước khi commit —
 * lệch ⇒ NÉM ⇒ lùi cả claim lẫn các câu ghi.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { dongDauRaGopLead, gopLead } from "../../lib/lead/gop-lead";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { dungCongGhiThu, OWNER_THU, type TuyChinhCongGhi } from "../_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, dungClaim, kiemCongGhiTruocGhi, type DauVaoCongGhi } from "../../lib/security/cong-ghi-wave1";

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "WGG_";
const SDT = "84900000211";
const MOC = new Date("2026-10-15T03:00:00.000Z");

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await db.order.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadStatusHistory.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadChild.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.auditLog.deleteMany({ where: { module: "write-gate", actorName: OWNER_THU } });
}

async function hienTruong() {
  const chinh = await db.lead.create({ data: { parentName: `${P}Chinh`, phone: SDT, status: "DA_DANG_KY" } });
  const phu = await db.lead.create({ data: { parentName: `${P}Phu`, phone: `0${SDT.slice(2)}`, status: "DA_DANG_KY" } });
  const don1 = await db.order.create({ data: { code: `${P}A`, type: "COURSE", customerName: "PH", customerPhone: SDT, totalAmount: 1, leadId: phu.id }, select: { id: true } });
  return { chinh, phu, don1 };
}

const input = (x: { chinh: { id: string }; phu: { id: string } }, apply: boolean) => ({ phuId: x.phu.id, chinhId: x.chinh.id, apply, actorName: "t", actorUserId: null });
const demWg = () => db.auditLog.count({ where: { module: "write-gate", actorName: OWNER_THU } });

/** Chạy thử (ghi rồi lùi) → dòng ký → artifact → cổng → trả phần `congGhi` đưa cho `gopLead`. */
async function chuanBi(x: { chinh: { id: string }; phu: { id: string } }, o: Partial<TuyChinhCongGhi> = {}, ghiDeCong: Partial<DauVaoCongGhi> = {}) {
  const thu = await gopLead(db, input(x, false));
  const rows = dongDauRaGopLead(thu);
  const { cong } = dungCongGhiThu(WORKFLOW_WAVE1.gopLead, rows, { now: MOC, ...o });
  const c = { ...cong, ...ghiDeCong };
  const duoc = await kiemCongGhiTruocGhi(db, c, WORKFLOW_WAVE1.gopLead, rows);
  return { rows, congGhi: { claim: dungClaim(duoc, c, rows.length), dongDaDuyet: rows } };
}

describe.skipIf(!RUN)("[WGB-GL] cổng ghi Wave 1 — gộp lead (DB thật)", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[WGB-GL-01] WG-01 hợp lệ: gộp thật; lead phụ xoá mềm; đơn đổi sang lead chính; ĐÚNG MỘT hàng wg:; dòng ký không có tên/SĐT", async () => {
    const x = await hienTruong();
    const { rows, congGhi } = await chuanBi(x);
    expect(rows[0]).toBe(`gop-lead/v1|lead|${x.phu.id}|${x.chinh.id}`);
    for (const d of rows) expect(d).not.toMatch(new RegExp(`${P}|${SDT}|900000211`));
    const kq = await gopLead(db, { ...input(x, true), congGhi });
    expect(kq.daGhi).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } })).deletedAt).not.toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: x.don1.id } })).leadId).toBe(x.chinh.id);
    expect(await demWg()).toBe(1);
  }, 60_000);

  it("[WGB-GL-02] dữ liệu trôi giữa chạy thử và ghi (đơn mới ở lead phụ) ⇒ digest kế hoạch TRONG giao dịch lệch ⇒ NÉM, LÙI cả claim lẫn ghi: phụ còn sống, đơn mới còn ở phụ, 0 hàng wg:", async () => {
    const x = await hienTruong();
    const { congGhi } = await chuanBi(x);
    const donMoi = await db.order.create({ data: { code: `${P}B`, type: "COURSE", customerName: "PH", customerPhone: SDT, totalAmount: 1, leadId: x.phu.id }, select: { id: true } });
    await expect(gopLead(db, { ...input(x, true), congGhi })).rejects.toMatchObject({ name: "CongGhiTuChoi", ma: "LECH_DIGEST" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } })).deletedAt).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: donMoi.id } })).leadId).toBe(x.phu.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: x.don1.id } })).leadId).toBe(x.phu.id);
    expect(await demWg()).toBe(0);
  }, 60_000);

  it("[WGB-GL-03] thiếu artifact / artifact sai ⇒ cổng ném TRƯỚC khi gọi gopLead(apply): lead phụ và đơn nguyên vẹn, 0 hàng wg:", async () => {
    const x = await hienTruong();
    for (const [ten, ma, ghiDe] of [
      ["thiếu", "THIEU_ARTIFACT", { artifact: null }],
      ["chưa ghim", "KHOA_KHONG_KHOP", { keyIdTinCay: "" }],
      ["sai môi trường", "SAI_MOI_TRUONG", { moiTruong: "prod" }],
    ] as const) {
      const loi = await chuanBi(x, {}, ghiDe as Partial<DauVaoCongGhi>).then(
        () => null,
        (e: unknown) => e,
      );
      expect(loi, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((loi as CongGhiTuChoi).ma, ten).toBe(ma);
      expect((await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } })).deletedAt, ten).toBeNull();
      expect(await demWg(), ten).toBe(0);
    }
  }, 60_000);

  it("[WGB-GL-07] WG-07 replay: gộp xong, phát lại CÙNG artifact ⇒ DA_DUNG — claim là câu ĐẦU TIÊN (trước cả việc tìm lead phụ đã bị xoá mềm)", async () => {
    const x = await hienTruong();
    const { congGhi } = await chuanBi(x);
    await gopLead(db, { ...input(x, true), congGhi });
    await expect(gopLead(db, { ...input(x, true), congGhi })).rejects.toMatchObject({ name: "CongGhiTuChoi", ma: "DA_DUNG" });
    expect(await demWg()).toBe(1);
  }, 60_000);

  it("[WGB-GL-12] WG-12 đồng thời: hai lượt gộp cùng artifact song song ⇒ đúng 1 thắng, 1 CongGhiTuChoi(DA_DUNG), 1 hàng wg:", async () => {
    const x = await hienTruong();
    const { congGhi } = await chuanBi(x);
    const kq = await Promise.allSettled([gopLead(db, { ...input(x, true), congGhi }), gopLead(db, { ...input(x, true), congGhi })]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.filter((k): k is PromiseRejectedResult => k.status === "rejected");
    expect(thua).toHaveLength(1);
    expect(thua[0]!.reason).toBeInstanceOf(CongGhiTuChoi);
    expect((thua[0]!.reason as CongGhiTuChoi).ma).toBe("DA_DUNG");
    expect(await demWg()).toBe(1);
  }, 60_000);

  it("[WGB-GL-14] chạy thử (apply:false) KHÔNG claim kể cả khi truyền congGhi — chạy thử không bao giờ tiêu thụ artifact", async () => {
    const x = await hienTruong();
    const { congGhi } = await chuanBi(x);
    await gopLead(db, { ...input(x, false), congGhi });
    expect(await demWg()).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: x.phu.id } })).deletedAt).toBeNull();
  }, 60_000);
});
