// tests/finance/wg-cong-ghi-noi-don.test.ts — [WGB-ND-*] CỔNG GHI WAVE 1 cho «nối Order.leadId» (D8) trên Postgres THẬT: lõi `ghiNoiDon` / `ghiNoiDonTrongTx`.
//
// Chạy bộ này:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts <tệp>`). `pnpm test:unit` trần SKIP — log "SKIP" nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Ánh xạ WG-01..12: xem `tests/lead-intake/wg-cong-ghi.spec.ts` + tài liệu 15 §13.
//
// ⚠️ Cùng bẫy như bản backfill: `updateMany … leadId: null` làm lượt phát lại/song song thứ hai ghi 0 đơn KỂ CẢ khi không có cổng dùng-một-lần nào ⇒ ca replay ĐẶT LẠI `leadId = null`
// trước khi phát lại (cổng hỏng ⇒ nối LẠI ⇒ ca đỏ), ca đồng thời khẳng định trên hàng `wg:` + audit mức lượt.
//
// Fixture tiền tố `WGN_`; không `resetDb()`; phạm vi luôn là đúng id đơn fixture (không "TAT_CA").
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, khoaThu, OWNER_THU, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { dongDauRaNoiDon, type KeHoachNoiDon } from "@/lib/nguon/noi-don";
import { docKeHoachNoiDon, ghiNoiDon, ghiNoiDonTrongTx } from "@/lib/nguon/noi-don-db";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { kyThoPayload, taoCapKhoa } from "@/lib/security/phe-duyet-ghi";

if (!RUN_DB_TESTS) console.warn(`[WGB-ND] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "WGN_";
const CO_SO = `${P}center`;
const MOC = new Date("2026-10-15T03:00:00.000Z");
const ACTOR = { id: null, name: "Test cổng nối đơn (WGN_)" } as const;
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9100001", runAttempt: "1" } } as const;
const KHOA_LUOT = `luot:${LUOT.nguonChay.runId}:${LUOT.nguonChay.runAttempt}`;

const CG = (kh: KeHoachNoiDon, o: Partial<TuyChinhCongGhi> = {}) => dungCongGhiThu(WORKFLOW_WAVE1.noiDon, dongDauRaNoiDon(kh.mot), { now: MOC, ...o });
const nhap = (keHoach: KeHoachNoiDon, congGhi: DauVaoCongGhi) => ({ keHoach, soDuyet: keHoach.mot.length, ghiDuoc: true, actor: ACTOR, luotChay: LUOT, congGhi });

async function don() {
  const orders = await db.order.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  await db.auditLog.deleteMany({ where: { entityType: "NoiDonLead", entityId: KHOA_LUOT } });
  await db.auditLog.deleteMany({ where: { module: "write-gate", actorName: OWNER_THU } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } });
}

async function taoLead(id: string, phone: string) {
  return db.lead.create({ data: { id: `${P}${id}`, parentName: `${P}${id}`, phone, status: "DA_DANG_KY" }, select: { id: true } });
}
async function taoDon(ma: string, customerPhone: string) {
  return db.order.create({
    data: { id: `${P}o_${ma}`, code: `${P}${ma}`, type: "COURSE", customerName: "PH", customerPhone, totalAmount: 1, centerId: CO_SO },
    select: { id: true },
  });
}

const demDauVet = async () => ({ audit: await db.auditLog.count(), orderCoLead: await db.order.count({ where: { id: { startsWith: P }, leadId: { not: null } } }) });
const demWg = () => db.auditLog.count({ where: { module: "write-gate", actorName: OWNER_THU } });
const demLuot = () => db.auditLog.count({ where: { entityType: "NoiDonLead", action: "NOI_LEAD_LUOT_CHAY", entityId: KHOA_LUOT } });

describe.skipIf(!RUN_DB_TESTS)("[WGB-ND] cổng ghi Wave 1 — nối Order.leadId (DB thật)", () => {
  beforeAll(async () => {
    await don();
    await db.order.deleteMany({ where: { centerId: CO_SO } });
    await db.center.deleteMany({ where: { id: CO_SO } });
    await db.center.create({ data: { id: CO_SO, name: "WGN cơ sở", slug: `${P}center-slug`, address: "Không có thật" } });
  });
  beforeEach(don);
  afterAll(async () => {
    await don();
    await db.center.deleteMany({ where: { id: CO_SO } });
    await db.$disconnect();
  });

  /** Hai đơn, hai lead khác SĐT ⇒ kế hoạch `mot` = 2 dòng. */
  async function hienTruong() {
    await taoLead("l1", "84900009101");
    await taoLead("l2", "84900009102");
    const a = await taoDon("a", "0900009101");
    const b = await taoDon("b", "0900009102");
    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [a.id, b.id] });
    expect(keHoach.mot).toHaveLength(2);
    return { a, b, keHoach };
  }

  it("[WGB-ND-01] WG-01 hợp lệ: nối đủ 2 đơn; hàng wg:<nonce> đúng MỘT; audit mức lượt đúng một", async () => {
    const { a, b, keHoach } = await hienTruong();
    const { cong, artifact } = CG(keHoach);
    expect(await ghiNoiDon(db, nhap(keHoach, cong))).toEqual({ daNoi: 2, boQua: 0 });
    expect((await db.order.findMany({ where: { id: { in: [a.id, b.id] } }, select: { leadId: true } })).every((o) => o.leadId !== null)).toBe(true);
    const wg = await db.auditLog.findMany({ where: { id: `wg:${artifact.payload.nonce}` } });
    expect(wg).toHaveLength(1);
    expect(wg[0]!.newValues).toMatchObject({ workflow: WORKFLOW_WAVE1.noiDon, targetEnvironment: "test", expectedRowCount: 2, appliedRowCount: 2, keyId: khoaThu().keyId });
    expect(await demLuot()).toBe(1);
  });

  const TU_CHOI: Array<[string, string, (kh: KeHoachNoiDon) => Partial<TuyChinhCongGhi> | "thieu"]> = [
    ["[WGB-ND-02a] WG-02 sai digest", "LECH_DIGEST", (kh) => ({ rowsKy: dongDauRaNoiDon(kh.mot).map((d, i) => (i === 0 ? `${d}x` : d)) })],
    ["[WGB-ND-02c] WG-04 hết hạn", "HET_HAN", () => ({ hanGio: 1, nowCong: new Date("2026-10-15T04:03:01.000Z") })],
    ["[WGB-ND-02d] WG-05 sai workflow (artifact của backfill nguồn)", "SAI_WORKFLOW", () => ({ workflowKy: WORKFLOW_WAVE1.diTru })],
    ["[WGB-ND-02e] WG-06 sai môi trường", "SAI_MOI_TRUONG", () => ({ moiTruongKy: "prod" })],
    ["[WGB-ND-02h] WG-09 sai khoá công khai", "KHOA_KHONG_KHOP", () => ({ khoaTin: taoCapKhoa() })],
    ["[WGB-ND-02i] WG-10 thiếu artifact", "THIEU_ARTIFACT", () => "thieu"],
    ["[WGB-ND-02j] chưa ghim vân tay", "KHOA_KHONG_KHOP", () => ({ ghim: "" })],
  ];

  it.each(TU_CHOI)("%s ⇒ %s, ABORT trước phép ghi đầu: 0 đơn đổi · 0 dòng audit (đếm CẢ BẢNG) · 0 hàng wg:", async (_ten, maMong, tao) => {
    const { keHoach } = await hienTruong();
    const o = tao(keHoach);
    const c = o === "thieu" ? { ...CG(keHoach).cong, artifact: null } : CG(keHoach, o).cong;
    const truoc = await demDauVet();
    const loi = await ghiNoiDon(db, nhap(keHoach, c)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(loi).toBeInstanceOf(CongGhiTuChoi);
    expect((loi as CongGhiTuChoi).ma).toBe(maMong);
    expect(await demDauVet()).toEqual(truoc);
    expect(await demWg()).toBe(0);
    // đối chứng dương: cùng hiện trường, artifact ĐÚNG ⇒ nối được
    expect(await ghiNoiDon(db, nhap(keHoach, CG(keHoach).cong))).toEqual({ daNoi: 2, boQua: 0 });
  });

  it("[WGB-ND-02b] WG-03 sai số dòng (digest ký ĐÚNG, expectedRowCount ký khác) ⇒ LECH_SO_DONG, 0 phép ghi", async () => {
    const { keHoach } = await hienTruong();
    const { cong, artifact } = CG(keHoach);
    const payload = { ...artifact.payload, expectedRowCount: 3 };
    const truoc = await demDauVet();
    await expect(ghiNoiDon(db, nhap(keHoach, { ...cong, artifact: { payload, signature: kyThoPayload(payload, khoaThu().privateKeyPem) } }))).rejects.toMatchObject({ ma: "LECH_SO_DONG" });
    expect(await demDauVet()).toEqual(truoc);
  });

  it("[WGB-ND-02g] WG-08 artifact bị sửa một byte ⇒ SAI_CHU_KY, 0 phép ghi", async () => {
    const { keHoach } = await hienTruong();
    const { cong, artifact } = CG(keHoach);
    const truoc = await demDauVet();
    await expect(ghiNoiDon(db, nhap(keHoach, { ...cong, artifact: { ...artifact, payload: { ...artifact.payload, expectedRowCount: 1 } } }))).rejects.toMatchObject({ ma: "SAI_CHU_KY" });
    expect(await demDauVet()).toEqual(truoc);
  });

  it("[WGB-ND-02k] gọi THẲNG ghiNoiDonTrongTx (bỏ lượt kiểm trước tx) mà thiếu artifact ⇒ vẫn ném, 0 đổi — cổng nằm TRONG transaction, không phụ thuộc đường vào", async () => {
    const { keHoach } = await hienTruong();
    const truoc = await demDauVet();
    await expect(db.$transaction((tx) => ghiNoiDonTrongTx(tx, nhap(keHoach, { ...CG(keHoach).cong, artifact: null })))).rejects.toMatchObject({ ma: "THIEU_ARTIFACT" });
    expect(await demDauVet()).toEqual(truoc);
  });

  it("[WGB-ND-07] WG-07 replay: nối xong, ĐẶT LẠI leadId = null nhưng GIỮ hàng wg:<nonce>, phát lại CÙNG artifact ⇒ DA_DUNG và đơn vẫn chưa nối", async () => {
    const { a, b, keHoach } = await hienTruong();
    const { cong } = CG(keHoach);
    expect(await ghiNoiDon(db, nhap(keHoach, cong))).toEqual({ daNoi: 2, boQua: 0 });
    await db.order.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { leadId: null } });
    expect(await demWg()).toBe(1);
    await expect(ghiNoiDon(db, nhap(keHoach, cong))).rejects.toMatchObject({ name: "CongGhiTuChoi", ma: "DA_DUNG" });
    expect((await db.order.findMany({ where: { id: { in: [a.id, b.id] } }, select: { leadId: true } })).every((o) => o.leadId === null)).toBe(true);
    expect(await demWg()).toBe(1);
  });

  it("[WGB-ND-12] WG-12 đồng thời: hai lượt ghi cùng artifact song song ⇒ đúng 1 thắng, 1 CongGhiTuChoi; 1 hàng wg:, 1 audit mức lượt, mỗi đơn đúng 1 audit NOI_LEAD", async () => {
    const { a, b, keHoach } = await hienTruong();
    const { cong } = CG(keHoach);
    const kq = await Promise.allSettled([ghiNoiDon(db, nhap(keHoach, cong)), ghiNoiDon(db, nhap(keHoach, cong))]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.filter((k): k is PromiseRejectedResult => k.status === "rejected");
    expect(thua).toHaveLength(1);
    expect(thua[0]!.reason).toBeInstanceOf(CongGhiTuChoi);
    expect((thua[0]!.reason as CongGhiTuChoi).ma).toBe("DA_DUNG");
    expect(await demWg()).toBe(1);
    expect(await demLuot()).toBe(1);
    for (const d of [a, b]) expect(await db.auditLog.count({ where: { entityType: "Order", action: "NOI_LEAD", entityId: d.id } })).toBe(1);
  });

  it("[WGB-ND-13] dòng ký: MỘT dòng/đơn sẽ nối (số dòng = mot.length), chứa id/mã đơn + id lead, KHÔNG có tên/SĐT; thứ tự kế hoạch không đổi digest", async () => {
    const { keHoach } = await hienTruong();
    const dong = dongDauRaNoiDon(keHoach.mot);
    expect(dong).toHaveLength(keHoach.mot.length);
    for (const d of dong) {
      expect(d.split("|")).toHaveLength(4);
      expect(d.startsWith("noi-don/v1|")).toBe(true);
      expect(d).not.toMatch(/0900009|84900009/);
    }
    const dao = { ...keHoach, mot: [...keHoach.mot].reverse() };
    expect(await ghiNoiDon(db, nhap(dao, CG(keHoach).cong))).toEqual({ daNoi: 2, boQua: 0 }); // artifact ký theo thứ tự này, ghi theo thứ tự khác ⇒ vẫn khớp
  });

  it("[WGB-ND-14] kế hoạch rỗng (không có đơn nào nối được) ⇒ không đòi artifact, không phép ghi", async () => {
    await taoDon("khong", "0900009199"); // không lead nào cùng SĐT
    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [`${P}o_khong`] });
    expect(keHoach.mot).toHaveLength(0);
    const truoc = await demDauVet();
    // `quyetDinhGhiNoiDon` đòi soDuyet ≥ 1 cho lượt có ghi; với 0 đơn lõi trả sớm — ghi nhận: không ném CongGhiTuChoi, không đổi gì.
    const r = await db.$transaction((tx) => ghiNoiDonTrongTx(tx, { ...nhap(keHoach, { ...dungCongGhiThu(WORKFLOW_WAVE1.noiDon, ["x"], { now: MOC }).cong, artifact: null }), soDuyet: 0 })).then(
      (x) => x,
      (e: unknown) => e,
    );
    expect(r instanceof CongGhiTuChoi).toBe(false);
    expect(await demDauVet()).toEqual(truoc);
  });
});
