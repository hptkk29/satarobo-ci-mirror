// @vitest-environment node
/**
 * GÁN NGUỒN HÀNG LOẠT cho hàng chờ «Chưa rõ nguồn» (`lib/nguon/gan-nguon-hang-loat.ts`). Postgres LOCAL thật; đường ghi là `doiNguonLead` THẬT.
 *
 *   [GHN-01]  lô + con trỏ: 30 lead UNKNOWN ⇒ hai lô (25 + 5), mọi lead sang nguồn đích; audit `DOI_NGUON` MỖI lead + một audit tóm tắt MỖI lô; lead cơ sở khác và lead nguồn khác KHÔNG bị đụng
 *   [GHN-02]  xem trước (`chiXem`) đếm ĐÚNG như bước ghi nhưng KHÔNG ghi: 0 audit, attribution `updatedAt` không nhích
 *   [GHN-03]  lead ĐÃ CÓ THỰC THU bị BỎ QUA kể cả khi người bấm có `sources:override-after-payment` (không phát hàng loạt sự kiện đổi-sau-thu); lead chưa thu (PENDING) vẫn đổi — đối chứng dương
 *   (sổ hoa hồng: định nghĩa «đã có tiền» nằm ở docDauVaoTaiChinh — đã có ca riêng ở nguon-doi-nguon.spec; hàm hàng loạt chỉ GỌI nó)
 *   [GHN-05]  lead nguồn đang KHOÁ bị bỏ qua
 *   [GHN-06]  lead bị bỏ qua KHÔNG chặn các lô sau (con trỏ keyset theo id, không «lấy 25 đầu mãi mãi»)
 *   [GHN-07]  nguồn đích sai bị từ chối trước mọi phép ghi: UNKNOWN · nguồn đòi người giới thiệu · nguồn đòi giải trình · nguồn ngừng; lý do ngắn bị từ chối (chỉ khi ghi, không khi xem trước)
 *   [GHN-08]  thiếu quyền đổi nguồn ⇒ dừng sớm với câu từ chối, 0 dòng đổi, 0 audit
 *   [GHN-09]  `docNguonChoHangLoat` chỉ liệt kê nguồn gán chung được
 *   [GHN-10]  TICK (`ids`): chỉ đổi đúng các lead đã tick, lead khác trong hàng chờ giữ nguyên
 *   [GHN-11]  `ids` chỉ THU HẸP: id lead ngoài hàng chờ · id lead CƠ SỞ KHÁC · id bịa ⇒ KHÔNG ai bị đổi (đây không phải đường «đổi nguồn mọi lead đoán được id»)
 *   [GHN-12]  bộ lọc KHÁC «Chưa rõ nguồn» cũng dùng được: lead «thiếu người giới thiệu» sang nguồn không đòi người ⇒ đổi; lead UNKNOWN (ngoài bộ lọc) giữ nguyên — đối chứng
 *   [GHN-13]  lead ĐÃ Ở ĐÚNG nguồn đích bị bỏ qua (không đẻ nhật ký vô nghĩa); `ids` rỗng hoặc quá trần bị từ chối
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `GHN` / `GHN_`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import type { KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { docHangChoNguon, whereHangCho } from "../../lib/nguon/doc-hang-cho";
import { docNguonChoHangLoat, ganNguonMotLo } from "../../lib/nguon/gan-nguon-hang-loat";
import { CO_LO_GAN_HANG_LOAT, TOI_DA_ID_GAN } from "../../lib/nguon/gan-nguon-hang-loat-nhan";
import { CO_NGUON_DAY_DU, capKhoaGhiNguon, damBaoDanhMucGoc, datCoNguon, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "GHN_";
const CASE = 120_000;
const LY_DO = "Lead nhập từ file Excel cũ, không còn căn cứ nguồn";
const NOW = new Date("2026-11-05T05:00:00.000Z");

function actorCoSo(centerIds: string[]): Actor {
  return capKhoaGhiNguon({
    userId: "ghl-actor",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as Actor);
}

const quyen = (...cac: string[]): KiemQuyen => async (action) => cac.includes(action);
const CO_DE = quyen("leads:overwrite");

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    for (const id of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${id}:` } } });
    const dons = await db.order.findMany({ where: { leadId: { in: ids } }, select: { id: true } });
    await db.payment.deleteMany({ where: { orderId: { in: dons.map((o) => o.id) } } });
    await db.commissionTransaction.deleteMany({ where: { leadId: { in: ids } } });
    await db.order.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: "gan-nguon-hang-loat", reason: LY_DO } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "GHN_G_" } } });
  await db.center.deleteMany({ where: { code: { startsWith: "GHN" } } });
}

describe.skipIf(!RUN)("Gán nguồn hàng loạt — hàng chờ «Chưa rõ nguồn»", () => {
  let nhom: IdNhom;
  let cA = "";
  let cB = "";
  let dem = 0;

  async function dungLead(o: { centerId?: string; groupId?: string; signals?: object; ten?: string; referrerMissing?: boolean } = {}): Promise<string> {
    dem += 1;
    const l = await db.lead.create({
      data: { parentName: `${P}${o.ten ?? "L"}${dem}`, phone: `0907${String(1_000_00 + dem).padStart(6, "0")}`, status: "MOI", centerId: o.centerId ?? cA, source: "Import Excel" },
      select: { id: true },
    });
    const g = o.groupId ?? nhom.UNKNOWN;
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: g,
        originalGroupId: g,
        identificationMethod: "UNKNOWN",
        matchedRule: "UNKNOWN",
        reasonText: "ca test",
        referrerMissing: o.referrerMissing ?? false,
        attributedAt: new Date("2026-08-01T00:00:00.000Z"),
        signals: (o.signals ?? { nhanGoc: "import excel", coXemTay: true, xemTay: ["LEGACY_IMPORT_SOURCE_UNKNOWN"] }) as object,
      },
    });
    return l.id;
  }

  async function dungThu(leadId: string, accountantStatus: "PENDING" | "CONFIRMED"): Promise<void> {
    const o = await db.order.create({
      data: { code: `ORD-GHN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, type: "COURSE", customerName: "x", customerPhone: "0908000000", totalAmount: 5_000_000, leadId },
      select: { id: true },
    });
    await db.payment.create({ data: { orderId: o.id, amount: 1_000_000, method: "chuyen-khoan", paidDate: new Date("2026-09-01T03:00:00.000Z"), accountantStatus } });
  }

  const nhomCua = async (id: string) => (await db.leadAttribution.findUniqueOrThrow({ where: { leadId: id }, include: { group: { select: { code: true } } } })).group.code;
  const demAudit = (id: string) => db.auditLog.count({ where: { entityType: "Lead", entityId: id, module: "nguon-hoa-hong", action: { startsWith: "DOI_NGUON" } } });
  const demHangLoatLo = () => db.auditLog.count({ where: { entityType: "Lead", entityId: "gan-nguon-hang-loat", reason: LY_DO } });

  function lo(over: Partial<Parameters<typeof ganNguonMotLo>[0]> = {}) {
    return ganNguonMotLo({
      actor: actorCoSo([cA]),
      actorName: "Người gán",
      kiemQuyen: CO_DE,
      groupId: nhom.WALK_IN,
      lyDo: LY_DO,
      coSoId: null,
      pham: { kieu: "loc", lyDo: "UNKNOWN" },
      conTro: null,
      chiXem: false,
      bayGio: NOW,
      ...over,
    });
  }

  /** Chạy mọi lô tới hết, cộng dồn. */
  async function chayHet(over: Partial<Parameters<typeof ganNguonMotLo>[0]> = {}) {
    const tong = { daDoi: 0, boQuaCoTien: 0, boQuaKhoa: 0, boQuaCungNguon: 0, boQuaVuaDoi: 0, khongDoiDuoc: 0, daQuet: 0, soLo: 0 };
    let conTro: string | null = null;
    for (let i = 0; i < 50; i++) {
      const r = await lo({ ...over, conTro });
      if (!r.ok) throw new Error(`lô lỗi: ${r.loi}`);
      tong.soLo++;
      for (const k of ["daDoi", "boQuaCoTien", "boQuaKhoa", "boQuaCungNguon", "boQuaVuaDoi", "khongDoiDuoc", "daQuet"] as const) tong[k] += r[k];
      if (r.hetLead) return tong;
      conTro = r.conTro;
    }
    throw new Error("không dừng");
  }

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    cA = (await db.center.create({ data: { code: "GHN-A", name: "GHN A", slug: "ghl-a", address: "a", city: "" } })).id;
    cB = (await db.center.create({ data: { code: "GHN-B", name: "GHN B", slug: "ghl-b", address: "b", city: "" } })).id;
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, CASE);

  it("[GHN-01] 30 lead UNKNOWN ⇒ hai lô (25+5); audit mỗi lead + một audit tóm tắt mỗi lô; lead cơ sở khác / nguồn khác không bị đụng", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await dungLead());
    const khacCoSo = await dungLead({ centerId: cB });
    const khacNguon = await dungLead({ groupId: nhom.PAID_ADS, signals: { duongVao: "facebook" } });

    const t = await chayHet();
    expect(t).toMatchObject({ daDoi: 30, boQuaCoTien: 0, boQuaKhoa: 0, khongDoiDuoc: 0, soLo: 2 });
    for (const id of ids) {
      expect(await nhomCua(id)).toBe("WALK_IN");
      expect(await demAudit(id), id).toBe(1);
    }
    expect(await demHangLoatLo()).toBe(2);
    // Đối chứng: người bấm cấp cơ sở A KHÔNG chạm được lead cơ sở B, và lead có nguồn khác không nằm trong hàng chờ UNKNOWN.
    expect(await nhomCua(khacCoSo)).toBe("UNKNOWN");
    expect(await demAudit(khacCoSo)).toBe(0);
    expect(await nhomCua(khacNguon)).toBe("PAID_ADS");
    // Cờ xem tay được gỡ ⇒ lead rời hàng chờ (`doiNguonLead` gỡ `xemTay`) và số «Chưa rõ nguồn» của cơ sở A về 0.
    const con = await docHangChoNguon(actorCoSo([cA]), { coSoId: cA, lyDo: "UNKNOWN", trang: 1, now: NOW, canViewPii: true });
    expect(con.tong).toBe(0);
  }, CASE);

  it("[GHN-02] xem trước đếm đúng nhưng KHÔNG ghi: 0 audit, nhóm + updatedAt không đổi", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await dungLead());
    await dungThu(ids[0]!, "CONFIRMED");
    const truoc = await Promise.all(ids.map((id) => db.leadAttribution.findUniqueOrThrow({ where: { leadId: id }, select: { updatedAt: true } })));

    const xem = await chayHet({ chiXem: true, lyDo: null });
    expect(xem).toMatchObject({ daDoi: 5, boQuaCoTien: 1 });
    for (const [i, id] of ids.entries()) {
      expect(await nhomCua(id)).toBe("UNKNOWN");
      expect(await demAudit(id)).toBe(0);
      expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: id }, select: { updatedAt: true } })).updatedAt.getTime()).toBe(truoc[i]!.updatedAt.getTime());
    }
    expect(await demHangLoatLo()).toBe(0);
    // Ghi thật cho ra ĐÚNG số mà xem trước đã báo.
    const that = await chayHet();
    expect(that).toMatchObject({ daDoi: xem.daDoi, boQuaCoTien: xem.boQuaCoTien });
  }, CASE);

  it("[GHN-03] lead ĐÃ THU tiền bị bỏ qua kể cả khi người bấm có quyền đổi-sau-thu; lead mới chỉ có khoản PENDING vẫn đổi", async () => {
    const daThu = await dungLead({ ten: "DaThu" });
    await dungThu(daThu, "CONFIRMED");
    const chuaThu = await dungLead({ ten: "ChuaThu" });
    await dungThu(chuaThu, "PENDING");
    const sach = await dungLead({ ten: "Sach" });

    const t = await chayHet({ kiemQuyen: quyen("leads:overwrite", "sources:override-after-payment", "sources:manage") });
    expect(t).toMatchObject({ daDoi: 2, boQuaCoTien: 1 });
    expect(await nhomCua(daThu)).toBe("UNKNOWN");
    expect(await demAudit(daThu)).toBe(0);
    expect(await nhomCua(chuaThu)).toBe("WALK_IN");
    expect(await nhomCua(sach)).toBe("WALK_IN");
    expect(await db.domainEvent.count({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${daThu}:` } } })).toBe(0);
  }, CASE);

  it("[GHN-05] lead nguồn đang KHOÁ bị bỏ qua", async () => {
    const khoa = await dungLead({ ten: "Khoa", signals: { khoaNguon: true, nhanGoc: "x" } });
    const sach = await dungLead({ ten: "Sach" });
    const t = await chayHet();
    expect(t).toMatchObject({ daDoi: 1, boQuaKhoa: 1 });
    expect(await nhomCua(khoa)).toBe("UNKNOWN");
    expect(await nhomCua(sach)).toBe("WALK_IN");
  }, CASE);

  it("[GHN-06] lead bị bỏ qua KHÔNG chặn lô sau: 30 lead, 4 đã thu ⇒ 26 đổi, 4 còn lại, quét đủ 30", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await dungLead());
    // Chọn đầu, giữa, cuối theo THỨ TỰ id (thứ tự quét) để cả hai lô đều có lead bị bỏ qua.
    const theoId = [...ids].sort();
    const daThu = [theoId[0]!, theoId[1]!, theoId[24]!, theoId[29]!];
    for (const id of daThu) await dungThu(id, "CONFIRMED");
    const t = await chayHet();
    expect(t).toMatchObject({ daDoi: 26, boQuaCoTien: 4, daQuet: 30, soLo: 2 });
    for (const id of daThu) expect(await nhomCua(id)).toBe("UNKNOWN");
    const con = await db.lead.count({ where: { ...whereHangCho("UNKNOWN", cA), id: { in: ids } } });
    expect(con).toBe(4);
  }, CASE);

  it("[GHN-07] nguồn đích sai bị từ chối TRƯỚC mọi phép ghi; lý do ngắn chỉ bị từ chối khi ghi thật", async () => {
    const lead = await dungLead();
    const khac = await db.leadSourceGroup.create({ data: { code: "GHN_G_YEUCAU", name: "GHN yêu cầu", referrerRequirement: "EMPLOYEE", sortOrder: 900 }, select: { id: true } });
    const giaiTrinh = await db.leadSourceGroup.create({ data: { code: "GHN_G_GIAITRINH", name: "GHN giải trình", referrerRequirement: "NONE", requiresNote: true, sortOrder: 901 }, select: { id: true } });
    const ngung = await db.leadSourceGroup.create({ data: { code: "GHN_G_NGUNG", name: "GHN ngừng", referrerRequirement: "NONE", status: "INACTIVE", sortOrder: 902 }, select: { id: true } });
    for (const [ten, groupId] of [["UNKNOWN", nhom.UNKNOWN], ["đòi người", khac.id], ["đòi giải trình", giaiTrinh.id], ["ngừng", ngung.id], ["không tồn tại", "khong-ton-tai"]] as const) {
      const r = await lo({ groupId });
      expect(r, ten).toMatchObject({ ok: false, truong: "nguon" });
    }
    expect(await nhomCua(lead)).toBe("UNKNOWN");
    expect(await demAudit(lead)).toBe(0);

    const ngan = await lo({ lyDo: "ngắn" });
    expect(ngan).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await nhomCua(lead)).toBe("UNKNOWN");
    // Xem trước không đòi lý do.
    expect(await lo({ lyDo: null, chiXem: true })).toMatchObject({ ok: true, daDoi: 1 });
  }, CASE);

  it("[GHN-08] thiếu quyền đổi nguồn ⇒ dừng sớm, 0 dòng đổi, 0 audit", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await dungLead());
    const r = await lo({ kiemQuyen: quyen() });
    expect(r).toMatchObject({ ok: false, truong: "quyen" });
    for (const id of ids) {
      expect(await nhomCua(id)).toBe("UNKNOWN");
      expect(await demAudit(id)).toBe(0);
    }
    expect(await demHangLoatLo()).toBe(0);
  }, CASE);

  it("[GHN-10] tick (ids): chỉ đổi đúng các lead đã tick; lead khác trong hàng chờ giữ nguyên", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await dungLead());
    const tick = [ids[1]!, ids[3]!, ids[4]!];
    const t = await chayHet({ pham: { kieu: "ids", ids: tick } });
    expect(t).toMatchObject({ daDoi: 3, daQuet: 3, boQuaCoTien: 0 });
    for (const [i, id] of ids.entries()) expect(await nhomCua(id), `lead #${i}`).toBe(tick.includes(id) ? "WALK_IN" : "UNKNOWN");
    for (const id of tick) expect(await demAudit(id)).toBe(1);
    expect(await demAudit(ids[0]!)).toBe(0);
  }, CASE);

  it("[GHN-11] ids chỉ THU HẸP: id ngoài hàng chờ · lead cơ sở KHÁC · id bịa ⇒ không ai bị đổi; id hợp lệ đi kèm vẫn đổi", async () => {
    const trong = await dungLead({ ten: "Trong" });
    const ngoaiHangCho = await dungLead({ groupId: nhom.PAID_ADS, signals: { duongVao: "facebook" }, ten: "Sach" }); // nguồn rõ, không vướng vấn đề nào
    const coSoKhac = await dungLead({ centerId: cB, ten: "CoSoB" }); // trong hàng chờ nhưng NGOÀI tầm nhìn của người bấm (chỉ cơ sở A)
    const r = await lo({ pham: { kieu: "ids", ids: [ngoaiHangCho, coSoKhac, "id-bia-khong-ton-tai"] } });
    expect(r).toMatchObject({ ok: true, daDoi: 0, daQuet: 0 });
    expect(await nhomCua(ngoaiHangCho)).toBe("PAID_ADS");
    expect(await nhomCua(coSoKhac)).toBe("UNKNOWN");
    expect(await demAudit(ngoaiHangCho)).toBe(0);
    expect(await demAudit(coSoKhac)).toBe(0);
    // Đối chứng dương: thêm MỘT id hợp lệ vào cùng danh sách ⇒ chỉ nó đổi.
    const t = await chayHet({ pham: { kieu: "ids", ids: [ngoaiHangCho, coSoKhac, "id-bia-khong-ton-tai", trong] } });
    expect(t).toMatchObject({ daDoi: 1, daQuet: 1 });
    expect(await nhomCua(trong)).toBe("WALK_IN");
    expect(await nhomCua(coSoKhac)).toBe("UNKNOWN");
  }, CASE);

  it("[GHN-12] bộ lọc khác «Chưa rõ nguồn» cũng dùng được: THIEU_NGUOI ⇒ đổi sang nguồn không đòi người; lead UNKNOWN ngoài bộ lọc giữ nguyên", async () => {
    const thieuNguoi = await dungLead({ groupId: nhom.EMPLOYEE_REFERRAL, referrerMissing: true, signals: { duongVao: "sale-form" }, ten: "ThieuNguoi" });
    const unknown = await dungLead({ ten: "Unknown" });
    const t = await chayHet({ pham: { kieu: "loc", lyDo: "THIEU_NGUOI" } });
    expect(t).toMatchObject({ daDoi: 1, daQuet: 1 });
    expect(await nhomCua(thieuNguoi)).toBe("WALK_IN");
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: thieuNguoi }, select: { referrerMissing: true } })).referrerMissing).toBe(false);
    expect(await nhomCua(unknown)).toBe("UNKNOWN"); // không thuộc bộ lọc THIEU_NGUOI
    // «Mọi vấn đề» (lyDo null) lấy cả hai.
    const moi = await dungLead({ ten: "Moi" });
    const tat = await chayHet({ pham: { kieu: "loc", lyDo: null } });
    expect(tat.daDoi).toBe(2); // `unknown` + `moi` (thieuNguoi đã sang WALK_IN và hết vướng vấn đề)
    expect(await nhomCua(moi)).toBe("WALK_IN");
    expect(await nhomCua(unknown)).toBe("WALK_IN");
  }, CASE);

  it("[GHN-13] lead ĐÃ Ở ĐÚNG nguồn đích bị bỏ qua; ids rỗng hoặc quá trần bị từ chối", async () => {
    const daDung = await dungLead({ groupId: nhom.WALK_IN, referrerMissing: true, signals: { duongVao: "sale-form" }, ten: "DaDung" }); // vướng THIEU_NGUOI nhưng đã là WALK_IN
    const khac = await dungLead({ ten: "Khac" });
    const t = await chayHet({ pham: { kieu: "ids", ids: [daDung, khac] } });
    expect(t).toMatchObject({ daDoi: 1, boQuaCungNguon: 1, daQuet: 2 });
    expect(await demAudit(daDung)).toBe(0); // KHÔNG đẻ nhật ký đổi-từ-A-sang-A
    expect(await demAudit(khac)).toBe(1);
    expect(await lo({ pham: { kieu: "ids", ids: [] } })).toMatchObject({ ok: false, truong: "nguon" });
    expect(await lo({ pham: { kieu: "ids", ids: Array.from({ length: TOI_DA_ID_GAN + 1 }, (_, i) => `x${i}`) } })).toMatchObject({ ok: false, truong: "nguon" });
  }, CASE);
  it("[GHN-09] `docNguonChoHangLoat` chỉ liệt kê nguồn gán chung được", async () => {
    await db.leadSourceGroup.create({ data: { code: "GHN_G_OK", name: "GHN ok", referrerRequirement: "NONE", sortOrder: 903 } });
    await db.leadSourceGroup.create({ data: { code: "GHN_G_YC", name: "GHN yêu cầu", referrerRequirement: "PARENT", sortOrder: 904 } });
    const ds = (await docNguonChoHangLoat(NOW)).map((n) => n.code);
    expect(ds).toContain("WALK_IN");
    expect(ds).toContain("GHN_G_OK");
    expect(ds).not.toContain("GHN_G_YC");
    expect(ds).not.toContain("UNKNOWN");
    expect(CO_LO_GAN_HANG_LOAT).toBe(25);
  }, CASE);
});
