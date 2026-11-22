// @vitest-environment node
/**
 * [WGB-DB-*] CỔNG GHI WAVE 1 trên Postgres THẬT — lõi `thucHienDiTru` (backfill quy nguồn) + `claimPheDuyet`. Khoá EPHEMERAL sinh lúc chạy; môi trường `test` (tên DB phải có chữ 'test').
 *
 * Ánh xạ bảng ca WG-01..12 của đợt nối cổng (tài liệu 15 §13):
 *   WG-01 hợp lệ ............ [WGB-DB-01]            WG-07 replay ........... [WGB-DB-07] (xoá bản ghi nghiệp vụ, GIỮ hàng wg:, phát lại)
 *   WG-02 sai digest ........ [WGB-DB-02a]          WG-08 artifact bị sửa .. [WGB-DB-02g]
 *   WG-03 sai số dòng ....... [WGB-DB-02b]          WG-09 sai khoá công khai [WGB-DB-02h]
 *   WG-04 hết hạn ........... [WGB-DB-02c]          WG-10 thiếu artifact ... [WGB-DB-02i]
 *   WG-05 sai workflow ...... [WGB-DB-02d]          WG-11 ABORT trước ghi .. MỌI ca [WGB-DB-02*] đếm LeadAttribution + LeadTouchpoint + AuditLog (cả bảng) = 0 thay đổi; script thật: wg-cong-ghi-script.spec.ts
 *   WG-06 sai môi trường .... [WGB-DB-02e/f]        WG-12 đồng thời ........ [WGB-DB-12a] (claim, đúng đường claim) · [WGB-DB-12b] (cả lõi: đúng 1 thắng, 1 hàng wg:, 1 audit bắt đầu, ghi đúng N)
 *
 * ⚠️ Vì sao [WGB-DB-07]/[12] không dựa vào "lead đã có quy nguồn thì ghi 0": `skipDuplicates` làm lượt phát lại/lượt song song thứ hai ghi 0 dòng KỂ CẢ khi không có cơ chế dùng-một-lần nào.
 * Nên ca replay xoá bản ghi nghiệp vụ trước khi phát lại (nếu cổng hỏng thì lần này GHI LẠI đủ N dòng và ca đỏ), còn ca đồng thời khẳng định trên HÀNG `wg:<nonce>` + audit, không trên số quy nguồn.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `WGB_`. LUẬT 18: mỗi ca tự dựng hiện trường. LUẬT 19: mọi mốc tuyệt đối.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { dungCongGhiThu, khoaThu, OWNER_THU, type TuyChinhCongGhi } from "../_helpers/cong-ghi-wave1";
import { docDuLieuDiTru, docNhomDiTru } from "../../lib/nguon/di-tru-db";
import { dungKeHoachDiTru, type KeHoachDiTru, type NhomDiTru } from "../../lib/nguon/di-tru-ke-hoach";
import { KICH_THUOC_LO_DI_TRU, thucHienDiTru } from "../../lib/nguon/di-tru-ghi";
import { CongGhiTuChoi, WORKFLOW_WAVE1, claimPheDuyet, kiemCongGhiTruocGhi, type DauVaoCongGhi } from "../../lib/security/cong-ghi-wave1";
import { kyThoPayload, taoCapKhoa } from "../../lib/security/phe-duyet-ghi";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "WGB_";
const CASE = 90_000;
const TRUOC = new Date("2026-09-15T03:00:00.000Z");
const DEN_SAU = new Date("2026-10-05T00:00:00.000Z");
const CUA_SO = 90;
const ACTOR_NAME = `${P}actor`;
/** Mốc BẮT ĐẦU lượt chạy + mốc ký — tuyệt đối (luật 19). */
const BAT_DAU = new Date("2026-10-12T01:02:03.000Z");

let stt = 0;
const sdt = () => `09917${String(++stt).padStart(5, "0")}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.auditLog.deleteMany({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME } });
  await db.auditLog.deleteMany({ where: { module: "write-gate", actorName: OWNER_THU } });
  await db.leadSourceGroup.updateMany({ data: { ownerEmployeeId: null, attributionWindowDays: null } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

describe.skipIf(!RUN)("Cổng ghi Wave 1 — backfill quy nguồn (Postgres thật)", () => {
  async function taoLead(ten: string, source: string | null): Promise<string> {
    const l = await db.lead.create({ data: { parentName: `${P}${ten}`, phone: sdt(), status: "MOI", source, createdAt: TRUOC }, select: { id: true } });
    return l.id;
  }
  async function boMau(): Promise<string[]> {
    return [await taoLead("ads1", "Ads"), await taoLead("ads2", "Ads"), await taoLead("org", "Organic"), await taoLead("ql", "Quản Lý Trung Tâm")];
  }
  async function lapKeHoach(ids: string[]): Promise<{ kh: KeHoachDiTru; nhomDm: NhomDiTru[] }> {
    return db.$transaction(async (tx: Tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const kq = await docDuLieuDiTru(tx, { coBangQuyNguon: true, phamVi: { leadIds: ids }, den: null });
      const nhomDm = await docNhomDiTru(tx);
      return { kh: dungKeHoachDiTru({ hang: kq.hang, chiTiet: kq.chiTiet, nhom: nhomDm, nhomCanChu: new Set(nhomDm.map((g) => g.code)), cuaSoMacDinhNgay: CUA_SO }), nhomDm };
    });
  }
  /** Ghi bằng ĐÚNG `cong` được truyền (không tự dựng artifact) — ca nào muốn sai thì dựng sai và truyền vào. */
  const ghiVoi = (kh: KeHoachDiTru, nhomDm: NhomDiTru[], congGhi: DauVaoCongGhi, kichThuocLo = KICH_THUOC_LO_DI_TRU) =>
    thucHienDiTru({
      db,
      kh,
      nhom: nhomDm,
      cuaSoMacDinhNgay: CUA_SO,
      duyet: { soDuyet: kh.tong.ghi, soDuyetReview: kh.tong.review, sha: kh.sha, den: DEN_SAU, chapNhanNguonChuaCoChu: kh.nhomPhaiCoChu.map((g) => g.code) },
      actor: { id: null, name: ACTOR_NAME },
      kichThuocLo,
      nguonChay: { actor: null, triggeringActor: null, runId: null, runAttempt: null },
      batDauLuc: BAT_DAU,
      congGhi,
    });
  const cong = (kh: KeHoachDiTru, o: Partial<TuyChinhCongGhi> = {}) => dungCongGhiThu(WORKFLOW_WAVE1.diTru, kh.dongDauRa, { now: BAT_DAU, ...o });

  const demQuyNguon = (ids: string[]) => db.leadAttribution.count({ where: { leadId: { in: ids } } });
  const demTouchpoint = (ids: string[]) => db.leadTouchpoint.count({ where: { leadId: { in: ids } } });
  const demDauVet = async () => ({ qn: await db.leadAttribution.count(), tp: await db.leadTouchpoint.count(), audit: await db.auditLog.count() });
  const demWg = () => db.auditLog.count({ where: { module: "write-gate", actorName: OWNER_THU } });
  const demBatDau = () => db.auditLog.count({ where: { entityType: "NguonDiTru", actorName: ACTOR_NAME, action: "DI_TRU_NGUON" } });

  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, CASE);

  it("[WGB-DB-01] WG-01 hợp lệ: ghi đủ N; hàng wg:<nonce> đúng MỘT, mang digest/keyId/số dòng; audit bắt đầu đúng một", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    const { cong: c, artifact } = cong(kh);
    const r = await ghiVoi(kh, nhomDm, c);
    expect(r).toMatchObject({ ok: true, ghi: 4, daCo: 0 });
    expect(await demQuyNguon(ids)).toBe(4);
    expect(await demTouchpoint(ids)).toBe(4);
    expect(await demBatDau()).toBe(1);
    const wg = await db.auditLog.findMany({ where: { id: `wg:${artifact.payload.nonce}` } });
    expect(wg).toHaveLength(1);
    expect(wg[0]).toMatchObject({ module: "write-gate", entityType: "WriteGateArtifact", entityId: artifact.payload.nonce, action: "APPLY", actorName: OWNER_THU });
    expect(wg[0]!.newValues).toMatchObject({ workflow: WORKFLOW_WAVE1.diTru, targetEnvironment: "test", inputDigest: artifact.payload.inputDigest, expectedRowCount: 4, appliedRowCount: 4, keyId: khoaThu().keyId, runRef: "test:1" });
    // dòng ký = đúng bốn dòng của kế hoạch, mỗi dòng NHÚNG bản chụp nguồn (chủ · cửa sổ riêng · cửa sổ mặc định) và KHÔNG có tên/SĐT
    expect(kh.dongDauRa).toHaveLength(kh.tong.ghi);
    for (const d of kh.dongDauRa) {
      expect(d.split("|")).toHaveLength(9);
      expect(d.endsWith(`|${CUA_SO}`)).toBe(true);
      expect(d).not.toMatch(new RegExp(P));
    }
  }, CASE);

  const TU_CHOI: Array<[string, string, (kh: KeHoachDiTru) => Partial<TuyChinhCongGhi> | "thieu"]> = [
    ["[WGB-DB-02a] WG-02 sai digest (owner ký bốn dòng KHÁC, cùng số dòng)", "LECH_DIGEST", (kh) => ({ rowsKy: kh.dongDauRa.map((d, i) => (i === 0 ? `${d}x` : d)) })],
    ["[WGB-DB-02c] WG-04 hết hạn (cổng chạy sau expiresAt)", "HET_HAN", () => ({ hanGio: 1, nowCong: new Date("2026-10-12T02:02:04.000Z") })],
    ["[WGB-DB-02d] WG-05 sai workflow (artifact của việc nối đơn)", "SAI_WORKFLOW", () => ({ workflowKy: WORKFLOW_WAVE1.noiDon })],
    ["[WGB-DB-02e] WG-06 sai môi trường (ký cho prod, áp ở test)", "SAI_MOI_TRUONG", () => ({ moiTruongKy: "prod" })],
    ["[WGB-DB-02f] WG-06 môi trường khai prod nhưng DB mang tên test", "SAI_MOI_TRUONG", () => ({ moiTruongKy: "prod", moiTruongCong: "prod" })],
    ["[WGB-DB-02h] WG-09 sai khoá công khai (khoá lạ được đưa vào + ghim theo nó)", "KHOA_KHONG_KHOP", () => {
      const lạ = taoCapKhoa();
      return { khoaTin: lạ };
    }],
    ["[WGB-DB-02i] WG-10 thiếu artifact", "THIEU_ARTIFACT", () => "thieu"],
    ["[WGB-DB-02j] chưa ghim vân tay khoá", "KHOA_KHONG_KHOP", () => ({ ghim: "" })],
  ];

  it.each(TU_CHOI)("%s ⇒ %s, ABORT trước phép ghi đầu: 0 quy nguồn · 0 touchpoint · 0 dòng audit (đếm CẢ BẢNG)", async (_ten, maMong, tao) => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    const o = tao(kh);
    const c = o === "thieu" ? { ...cong(kh).cong, artifact: null } : cong(kh, o).cong;
    const truoc = await demDauVet();
    const loi = await ghiVoi(kh, nhomDm, c).then(
      () => null,
      (e: unknown) => e,
    );
    expect(loi).toBeInstanceOf(CongGhiTuChoi);
    expect((loi as CongGhiTuChoi).ma).toBe(maMong);
    expect(await demDauVet()).toEqual(truoc); // không một phép ghi nào — kể cả dòng claim
    expect(await demQuyNguon(ids)).toBe(0);
    expect(await demWg()).toBe(0);
    // đối chứng dương: cùng hiện trường, artifact ĐÚNG ⇒ ghi được (ca không đỏ vì lý do khác)
    expect(await ghiVoi(kh, nhomDm, cong(kh).cong)).toMatchObject({ ok: true, ghi: 4 });
  }, CASE);

  it("[WGB-DB-02b] WG-03 sai số dòng (digest ký ĐÚNG, expectedRowCount ký khác) ⇒ LECH_SO_DONG, 0 phép ghi", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    const { artifact } = cong(kh);
    const payload = { ...artifact.payload, expectedRowCount: 5 };
    const c = { ...cong(kh).cong, artifact: { payload, signature: kyThoPayload(payload, khoaThu().privateKeyPem) } };
    const truoc = await demDauVet();
    await expect(ghiVoi(kh, nhomDm, c)).rejects.toMatchObject({ name: "CongGhiTuChoi", ma: "LECH_SO_DONG" });
    expect(await demDauVet()).toEqual(truoc);
  }, CASE);

  it("[WGB-DB-02g] WG-08 artifact bị sửa một byte ⇒ SAI_CHU_KY, 0 phép ghi", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    const { cong: c, artifact } = cong(kh);
    const sua = { ...artifact, payload: { ...artifact.payload, expectedRowCount: 3 } };
    const truoc = await demDauVet();
    await expect(ghiVoi(kh, nhomDm, { ...c, artifact: sua })).rejects.toMatchObject({ ma: "SAI_CHU_KY" });
    expect(await demDauVet()).toEqual(truoc);
  }, CASE);

  it("[WGB-DB-07] WG-07 replay: ghi xong, XOÁ bản ghi nghiệp vụ nhưng GIỮ hàng wg:<nonce>, phát lại CÙNG artifact ⇒ DA_DUNG và không ghi lại gì", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    const { cong: c } = cong(kh);
    expect(await ghiVoi(kh, nhomDm, c)).toMatchObject({ ok: true, ghi: 4 });
    // Gỡ dấu nghiệp vụ ⇒ nếu cổng dùng-một-lần hỏng, lần phát lại này sẽ GHI LẠI đủ 4 dòng (skipDuplicates không còn che).
    await db.leadAttribution.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: ids } } });
    expect(await demWg()).toBe(1);
    await expect(ghiVoi(kh, nhomDm, c)).rejects.toMatchObject({ name: "CongGhiTuChoi", ma: "DA_DUNG" });
    expect(await demQuyNguon(ids)).toBe(0);
    expect(await demTouchpoint(ids)).toBe(0);
    expect(await demWg()).toBe(1);
  }, CASE);

  it("[WGB-DB-07b] kiểm SỚM không phải cổng thật: bỏ qua kiểm sớm (gọi thẳng claim) thì hàng wg: vẫn chặn lần thứ hai", async () => {
    const ids = await boMau();
    const { kh } = await lapKeHoach(ids);
    const { cong: c } = cong(kh);
    const ok = await kiemCongGhiTruocGhi(db, c, WORKFLOW_WAVE1.diTru, kh.dongDauRa);
    const chiTiet = { appliedAt: BAT_DAU, rowCount: kh.dongDauRa.length, runRef: "t" };
    await db.$transaction((tx) => claimPheDuyet(tx, ok, chiTiet));
    await expect(db.$transaction((tx) => claimPheDuyet(tx, ok, chiTiet))).rejects.toMatchObject({ name: "CongGhiTuChoi", ma: "DA_DUNG" });
    expect(await demWg()).toBe(1);
  }, CASE);

  it("[WGB-DB-12a] WG-12 đồng thời, đúng đường CLAIM: hai transaction cùng artifact chạy song song ⇒ đúng 1 thắng, 1 DA_DUNG, 1 hàng wg:", async () => {
    const ids = await boMau();
    const { kh } = await lapKeHoach(ids);
    const { cong: c } = cong(kh);
    const ok = await kiemCongGhiTruocGhi(db, c, WORKFLOW_WAVE1.diTru, kh.dongDauRa); // cả hai dùng chung kết quả kiểm sớm "chưa dùng"
    const chiTiet = { appliedAt: BAT_DAU, rowCount: kh.dongDauRa.length, runRef: "t" };
    const kq = await Promise.allSettled([db.$transaction((tx) => claimPheDuyet(tx, ok, chiTiet)), db.$transaction((tx) => claimPheDuyet(tx, ok, chiTiet))]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const tu = kq.filter((k): k is PromiseRejectedResult => k.status === "rejected");
    expect(tu).toHaveLength(1);
    expect(tu[0]!.reason).toMatchObject({ name: "CongGhiTuChoi", ma: "DA_DUNG" });
    expect(await demWg()).toBe(1);
  }, CASE);

  it("[WGB-DB-12b] WG-12 đồng thời, cả LÕI: hai lượt ghi cùng artifact song song ⇒ đúng 1 thắng, 1 bị CongGhiTuChoi; 1 hàng wg:, 1 audit bắt đầu, ghi đúng N", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    const { cong: c } = cong(kh);
    const kq = await Promise.allSettled([ghiVoi(kh, nhomDm, c), ghiVoi(kh, nhomDm, c)]);
    const thang = kq.filter((k): k is PromiseFulfilledResult<Awaited<ReturnType<typeof ghiVoi>>> => k.status === "fulfilled");
    const thua = kq.filter((k): k is PromiseRejectedResult => k.status === "rejected");
    expect(thang).toHaveLength(1);
    expect(thua).toHaveLength(1);
    expect(thua[0]!.reason).toBeInstanceOf(CongGhiTuChoi);
    expect((thua[0]!.reason as CongGhiTuChoi).ma).toBe("DA_DUNG");
    expect(thang[0]!.value).toMatchObject({ ok: true, ghi: 4 });
    expect(await demWg()).toBe(1);
    expect(await demBatDau()).toBe(1);
    expect(await demQuyNguon(ids)).toBe(4);
    expect(await demTouchpoint(ids)).toBe(4);
  }, CASE);

  it("[WGB-DB-13] claim nằm ở lô ĐẦU và tồn tại kể cả khi lô đó ghi 0 (skipDuplicates): artifact thứ hai trên kế hoạch cũ ⇒ ok, ghi 0, thêm một hàng wg:", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(await ghiVoi(kh, nhomDm, cong(kh).cong)).toMatchObject({ ok: true, ghi: 4 });
    expect(await ghiVoi(kh, nhomDm, cong(kh).cong)).toMatchObject({ ok: true, ghi: 0, daCo: 4 });
    expect(await demWg()).toBe(2);
    expect(await demBatDau()).toBe(1);
  }, CASE);

  it("[WGB-DB-14] chia lô (4 lead / lô 3 ⇒ 2 lô): claim ĐÚNG MỘT lần (lô đầu), ghi đủ; artifact không bị đốt hai lần", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    expect(await ghiVoi(kh, nhomDm, cong(kh).cong, 3)).toMatchObject({ ok: true, ghi: 4, soLo: 2 });
    expect(await demWg()).toBe(1);
  }, CASE);

  it("[WGB-DB-15] kế hoạch rỗng (đã backfill xong) ⇒ KHÔNG cần artifact (không có gì để ghi), không dòng audit nào", async () => {
    const ids = await boMau();
    const { kh, nhomDm } = await lapKeHoach(ids);
    await ghiVoi(kh, nhomDm, cong(kh).cong);
    const moi = await lapKeHoach(ids);
    expect(moi.kh.dongDauRa).toEqual([]);
    const truoc = await demDauVet();
    expect(await ghiVoi(moi.kh, moi.nhomDm, { ...cong(kh).cong, artifact: null })).toMatchObject({ ok: true, ghi: 0, soLo: 0 });
    expect(await demDauVet()).toEqual(truoc);
  }, CASE);
});
