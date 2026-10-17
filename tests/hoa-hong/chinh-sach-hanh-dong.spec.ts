// @vitest-environment node
/**
 * [NHH-FE-HD-*] — THAO TÁC GHI của tab Chính sách trên Postgres THẬT (06 §5.2, 05 PR8): lưu nháp · sửa nháp · version mới ·
 * kiểm hàng rào · kích hoạt · huỷ nháp, và các reader dựng bảng/ma trận/hàng chờ.
 *
 * Thứ chỉ DB mới chứng minh:
 *   · gõ "4" ở ô phần trăm ra `rate = 0.04` TRONG BẢNG (lỗi ×100 không ném, không test thuần nào thấy);
 *   · cách ly cơ sở khi GHI — `scopedDb` không che write, nên người chỉ thấy CS1 không được sửa chính sách Hội sở dù ĐỌC được nó,
 *     và không chạm được bản ghi của CS2 bằng id đoán;
 *   · lưu hỏng giữa chừng không đẻ văn bản trùng (văn bản đã tạo được trả id để lần lưu sau dùng lại);
 *   · nháp bị sửa xen giữa (hai người cùng mở) KHÔNG bị ghi đè lặng lẽ;
 *   · lỗi hàng rào trả về đủ để vẽ thanh kiểm, và kích hoạt bị chặn thì version vẫn DRAFT.
 *
 * Chạy: `pnpm test:hoa-hong-db`. `pnpm test:unit` trần sẽ SKIP.
 * ⚠️ AN TOÀN DB: không `resetDb()`; dữ liệu mang tiền tố `fx-hd-`/`FXHD`, dọn ĐẦU mỗi ca (luật 18). Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
// Kho công khai R2 giả: `luuNhap` đòi url tệp đính kèm = <gốc công khai>/<key> (chống tệp do client khai tuỳ ý).
vi.mock("@/lib/storage/r2-client", () => ({ getR2PublicUrl: () => "https://cdn.fx.test" }));
const GOC_KHO = "https://cdn.fx.test";

import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";

import { formRong, type FormChinhSach } from "../../lib/hoa-hong/chinh-sach-form";
import { dungMaTran } from "../../lib/hoa-hong/ma-tran-chinh-sach";
import { MASTER_VAI_HUONG } from "../../lib/hoa-hong/vai-huong";
import { THU_TU_PHAM_VI_MAC_DINH } from "../../lib/hoa-hong/chon-quy-tac";
import { huyBanNhap, kichHoatPhienBan as kichHoatThat, kiemHangRao, luuNhap } from "../../lib/hoa-hong/chinh-sach-hanh-dong";
import { coChinhSachDangApDung, docBangChinhSach, docBoLocChinhSach, docChiTietChinhSach, docDuLieuMaTran, docDuLieuSoan, docHangChoChinhSach, docPhienBanDeSoan } from "../../lib/hoa-hong/chinh-sach-doc";
import { danhDauDaDung } from "../../lib/hoa-hong/chinh-sach-service";

if (!RUN_DB_TESTS) console.warn(`[NHH-FE-HD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fx-hd-";
const NGUOI = { userId: null, ten: "Soạn thảo fixture" };
const NOW = new Date("2026-10-08T03:00:00.000Z");

const actorHo = { userId: "fx-hd-ho", isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as Actor;
const actorCoSo = (centerIds: string[]): Actor =>
  ({ userId: "fx-hd-cs", isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: centerIds, visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor;

let seq = 0;
const ma = () => `${P}${(seq += 1)}`;

/** Form HỢP LỆ đủ để kích hoạt: một vai SALE 4%, văn bản mới CÓ TỆP, hiệu lực đúng ngày thứ 15 làm việc sau công bố (02/03 → 23/03/2026). */
const formDu = (p: Partial<FormChinhSach> = {}): FormChinhSach => ({
  ...formRong(),
  policyCode: ma(),
  name: "Hoa hồng fixture",
  loaiGd: ["NEW"],
  vai: ["SALE"],
  o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" } },
  vanBan: {
    kieu: "moi",
    documentCode: ma(),
    title: "Quy định fixture",
    issuedOn: "2026-02-20",
    publishedOn: "2026-03-02",
    effectiveOn: "2026-03-23",
    approvedByName: "Hồ Đắc Phúc",
    tep: { key: "uploads/documents/2026-10/fx-ab12cd34.pdf", ten: "fx.pdf", url: `${GOC_KHO}/uploads/documents/2026-10/fx-ab12cd34.pdf` },
  },
  hieuLucTu: "2026-03-23",
  hieuLucDen: "",
  lyDo: "SR.QD.fixture",
  ...p,
});

/** Người duyệt luôn cầm mốc `updatedAt` mà họ đã thấy; ca thường = thấy bản hiện tại. Ca "bản đã đổi sau khi xem" gọi `kichHoatThat` với mốc cũ. */
const kichHoatPhienBan = async (a: Omit<Parameters<typeof kichHoatThat>[0], "updatedAtDaThay">) =>
  kichHoatThat({ ...a, updatedAtDaThay: (await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId }, select: { updatedAt: true } })).updatedAt.toISOString() });

const luu = (form: FormChinhSach, actor: Actor = actorHo, extra: { policyId?: string | null; versionId?: string | null; updatedAtDaThay?: string | null } = {}) =>
  luuNhap({ actor, nguoi: NGUOI, now: NOW, vao: { form, policyId: extra.policyId ?? null, versionId: extra.versionId ?? null, updatedAtDaThay: extra.updatedAtDaThay ?? null } });

async function don() {
  const cs = await db.commissionPolicy.findMany({ where: { policyCode: { startsWith: P } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await db.commissionRule.deleteMany({ where: { version: { policyId: { in: ids } } } });
  await db.commissionPolicyVersion.deleteMany({ where: { policyId: { in: ids } } });
  await db.commissionPolicy.deleteMany({ where: { id: { in: ids } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "FXHD" } } });
  await db.regulationDocument.deleteMany({ where: { documentCode: { startsWith: P } } });
  await db.holiday.deleteMany({ where: { name: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { entityType: { in: ["CommissionPolicy", "CommissionPolicyVersion", "RegulationDocument"] }, actorName: NGUOI.ten } });
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-FE-HD] tab Chính sách — Postgres thật", () => {
  let cs1 = "";
  let cs2 = "";
  let cs1Center = "";
  let cs2Center = "";
  let nhomQc = "";

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    const o = await db.orgUnit.findMany({ where: { code: { in: ["CS1", "CS2"] } }, select: { id: true, code: true, centerId: true } });
    const byCode = Object.fromEntries(o.map((x) => [x.code, x]));
    cs1 = byCode.CS1!.id;
    cs2 = byCode.CS2!.id;
    cs1Center = byCode.CS1!.centerId!;
    cs2Center = byCode.CS2!.centerId!;
    nhomQc = (await db.leadSourceGroup.findFirstOrThrow({ where: { code: "PAID_ADS" }, select: { id: true } })).id;
  }, 120_000);
  beforeEach(async () => {
    await don();
  }, 60_000);
  afterAll(async () => {
    await don();
  }, 60_000);

  // ─── Lưu nháp ───────────────────────────────────────────────────────────────

  it("[NHH-FE-HD-01] tạo chính sách mới: gõ '4' ⇒ rate = 0.04 TRONG BẢNG (không phải 4), nháp, có văn bản + tệp, và kèm kết quả hàng rào", async () => {
    const form = formDu();
    const r = await luu(form);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: r.versionId }, include: { rules: { include: { beneficiaryRole: true } }, document: true } });
    expect(v.status).toBe("DRAFT");
    expect(v.versionNo).toBe(1);
    expect(v.rules.map((x) => [x.beneficiaryRole.code, x.transactionTypeCode, x.calcKind, x.rate?.toString()])).toEqual([["SALE", "NEW", "PERCENT", "0.04"]]);
    expect(v.effectiveFrom.toISOString()).toBe("2026-03-22T17:00:00.000Z");
    expect(v.document?.fileKey).toBe("uploads/documents/2026-10/fx-ab12cd34.pdf");
    expect(r.vanBanId).toBe(v.documentId);
    // Hội sở sở hữu ⇒ centerId NULL (dùng chung); version + rule chép từ policy
    expect(v.centerId).toBeNull();
    expect(r.hangRao).not.toBeNull();
    expect(r.hangRao!.somNhat).toBe("2026-03-23");
    expect(r.hangRao!.loi).toEqual([]);
  });

  it("[NHH-FE-HD-02] trùng mã chính sách ⇒ lỗi gắn vào Ô 'policyCode'; văn bản vừa tạo được trả id để lần lưu sau KHÔNG tạo trùng", async () => {
    const dau = formDu();
    expect((await luu(dau)).ok).toBe(true);
    // Lần 2: cùng policyCode, văn bản MỚI khác số ⇒ văn bản tạo được, chính sách hỏng
    const hai = formDu({ policyCode: dau.policyCode });
    const r = await luu(hai);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi.map((l) => l.truong)).toEqual(["policyCode"]);
    expect(r.vanBanIdDaTao).toBeTruthy();
    // Client đổi mã và gửi lại với văn bản 'co-san' = id vừa tạo ⇒ không đẻ văn bản thứ hai
    const sauKhiSua = formDu({ policyCode: ma(), vanBan: { kieu: "co-san", id: r.vanBanIdDaTao! } });
    expect((await luu(sauKhiSua)).ok).toBe(true);
    const so = await db.regulationDocument.count({ where: { documentCode: hai.vanBan.kieu === "moi" ? hai.vanBan.documentCode : "?" } });
    expect(so).toBe(1);
  });

  it("[NHH-FE-HD-03] trùng số hiệu văn bản ⇒ lỗi ở Ô 'vanBan.documentCode', không tạo chính sách nửa vời", async () => {
    const a = formDu();
    expect((await luu(a)).ok).toBe(true);
    const b = formDu({ vanBan: a.vanBan });
    const r = await luu(b);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi.map((l) => l.truong)).toEqual(["vanBan.documentCode"]);
    expect(await db.commissionPolicy.count({ where: { policyCode: b.policyCode } })).toBe(0);
  });

  it("[NHH-FE-HD-04] sửa nháp: lưu đè đúng bản nháp, vẫn DRAFT, trả updatedAt mới; rule cũ được thay (không tích tụ)", async () => {
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    const form2 = formDu({ policyCode: (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode, vanBan: { kieu: "co-san", id: a.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "3,5" } } });
    const b = await luu(form2, actorHo, { policyId: a.policyId, versionId: a.versionId, updatedAtDaThay: a.updatedAt });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.versionId).toBe(a.versionId);
    expect(b.updatedAt).not.toBe(a.updatedAt);
    const rules = await db.commissionRule.findMany({ where: { versionId: a.versionId } });
    expect(rules.map((x) => x.rate?.toString())).toEqual(["0.035"]);
  });

  it("[NHH-FE-HD-05] hai người cùng mở một nháp: người lưu SAU (cầm updatedAt cũ) bị chặn, DB giữ bản của người lưu trước", async () => {
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    const nguoiMot = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "5" } } }), actorHo, { policyId: a.policyId, versionId: a.versionId, updatedAtDaThay: a.updatedAt });
    expect(nguoiMot.ok).toBe(true);
    const nguoiHai = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "6" } } }), actorHo, { policyId: a.policyId, versionId: a.versionId, updatedAtDaThay: a.updatedAt });
    expect(nguoiHai.ok).toBe(false);
    if (nguoiHai.ok) return;
    expect(nguoiHai.chung).toMatch(/Có người vừa sửa/);
    expect((await db.commissionRule.findMany({ where: { versionId: a.versionId } })).map((x) => x.rate?.toString())).toEqual(["0.05"]);
  });

  it("[NHH-FE-HD-06] bản ĐÃ KÍCH HOẠT không sửa được (lỗi chung rõ nghĩa, DB không đổi); muốn đổi thì tạo VERSION MỚI (v2 nháp, v1 vẫn ACTIVE)", async () => {
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    const k = await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null });
    expect(k.ok, JSON.stringify(k)).toBe(true);
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    const sua = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "9" } } }), actorHo, { policyId: a.policyId, versionId: a.versionId });
    expect(sua.ok).toBe(false);
    if (!sua.ok) expect(sua.chung).toMatch(/chỉ sửa được bản nháp|tạo version mới/);
    expect((await db.commissionRule.findMany({ where: { versionId: a.versionId } })).map((x) => x.rate?.toString())).toEqual(["0.04"]);

    const v2 = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "3" } }, hieuLucTu: "2026-11-02" }), actorHo, { policyId: a.policyId });
    if (!v2.ok) throw new Error(JSON.stringify(v2));
    expect(v2.versionNo).toBe(2);
    const vs = await db.commissionPolicyVersion.findMany({ where: { policyId: a.policyId }, orderBy: { versionNo: "asc" }, select: { versionNo: true, status: true } });
    expect(vs).toEqual([
      { versionNo: 1, status: "ACTIVE" },
      { versionNo: 2, status: "DRAFT" },
    ]);
  });

  // ─── Cách ly cơ sở khi GHI ──────────────────────────────────────────────────

  it("[NHH-FE-HD-07] người chỉ thấy CS1: KHÔNG tạo được chính sách của Hội sở; tạo được của CS1; đối chứng: Hội sở tạo được cả hai", async () => {
    const hoTuCs1 = await luu(formDu({ chuSoHuuOrgUnitId: null }), actorCoSo([cs1Center]));
    expect(hoTuCs1.ok).toBe(false);
    if (!hoTuCs1.ok) expect(hoTuCs1.chung).toMatch(/không được sửa/);
    const cs1TuCs1 = await luu(formDu({ chuSoHuuOrgUnitId: cs1 }), actorCoSo([cs1Center]));
    expect(cs1TuCs1.ok, JSON.stringify(cs1TuCs1)).toBe(true);
    const cs2TuCs1 = await luu(formDu({ chuSoHuuOrgUnitId: cs2 }), actorCoSo([cs1Center]));
    expect(cs2TuCs1.ok).toBe(false);
    expect((await luu(formDu({ chuSoHuuOrgUnitId: cs2 }), actorHo)).ok).toBe(true);
    expect((await luu(formDu({ chuSoHuuOrgUnitId: null }), actorHo)).ok).toBe(true);
  });

  it("[NHH-FE-HD-08] ĐỌC được ≠ SỬA được: người CS1 thấy chính sách Hội sở nhưng sửa/huỷ/kích hoạt bản nháp của nó bị từ chối; DB nguyên vẹn", async () => {
    const ho = await luu(formDu());
    if (!ho.ok) throw new Error("x");
    const cs1Actor = actorCoSo([cs1Center]);
    // đọc được
    expect(await docChiTietChinhSach(cs1Actor, ho.policyId, NOW)).not.toBeNull();
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: ho.policyId } })).policyCode;
    const sua = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: ho.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "9" } } }), cs1Actor, { policyId: ho.policyId, versionId: ho.versionId });
    expect(sua.ok).toBe(false);
    const huy = await huyBanNhap({ actor: cs1Actor, nguoi: NGUOI, now: NOW, versionId: ho.versionId, lyDo: "thử" });
    expect(huy.ok).toBe(false);
    const kich = await kichHoatPhienBan({ actor: cs1Actor, nguoi: NGUOI, now: NOW, versionId: ho.versionId, xacNhanLyDo: null });
    expect(kich.ok).toBe(false);
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: ho.versionId }, include: { rules: true } });
    expect(v.status).toBe("DRAFT");
    expect(v.rules.map((x) => x.rate?.toString())).toEqual(["0.04"]);
  });

  it("[NHH-FE-HD-09] id của cơ sở KHÁC không đoán được: CS1 sửa/kiểm/huỷ nháp của CS2 ⇒ cùng câu 'không tìm thấy' như id không tồn tại", async () => {
    const c2 = await luu(formDu({ chuSoHuuOrgUnitId: cs2 }), actorHo);
    if (!c2.ok) throw new Error("x");
    const a = actorCoSo([cs1Center]);
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: c2.policyId } })).policyCode;
    const sua = await luu(formDu({ policyCode: code, chuSoHuuOrgUnitId: cs2, vanBan: { kieu: "co-san", id: c2.vanBanId! } }), a, { policyId: c2.policyId, versionId: c2.versionId });
    const kiem = await kiemHangRao({ actor: a, now: NOW, versionId: c2.versionId });
    const huy = await huyBanNhap({ actor: a, nguoi: NGUOI, now: NOW, versionId: c2.versionId, lyDo: "thử" });
    const khong = await kiemHangRao({ actor: a, now: NOW, versionId: "id-khong-ton-tai" });
    // Không có versionId (tạo PHIÊN BẢN MỚI trên chính sách của cơ sở khác): phép tra versionId không che được, nên chỉ phép tra CHÍNH SÁCH giữ chốt này.
    const moiTrenCs2 = await luu(formDu({ policyCode: code, chuSoHuuOrgUnitId: cs2, vanBan: { kieu: "co-san", id: c2.vanBanId! } }), a, { policyId: c2.policyId });
    for (const r of [sua, moiTrenCs2, kiem, huy]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.chung).toBe((khong as { chung: string }).chung);
    }
    expect(await docChiTietChinhSach(a, c2.policyId, NOW)).toBeNull();
  });

  it("[NHH-FE-HD-10] văn bản của cơ sở khác không gắn được bằng id đoán (ngoài tầm nhìn ⇒ lỗi ở Ô 'vanBan.id')", async () => {
    const c2 = await luu(formDu({ chuSoHuuOrgUnitId: cs2 }), actorHo);
    if (!c2.ok) throw new Error("x");
    const r = await luu(formDu({ chuSoHuuOrgUnitId: cs1, vanBan: { kieu: "co-san", id: c2.vanBanId! } }), actorCoSo([cs1Center]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi.map((l) => l.truong)).toEqual(["vanBan.id"]);
  });

  // ─── Hàng rào + kích hoạt ───────────────────────────────────────────────────

  it("[NHH-FE-HD-11] kích hoạt bị chặn: trả đủ mã lỗi để vẽ thanh hàng rào + ngày sớm nhất hợp lệ, version VẪN DRAFT", async () => {
    // thiếu tệp văn bản + hiệu lực 20/03 (sớm hơn 23/03)
    const a = await luu(formDu({ hieuLucTu: "2026-03-20", vanBan: { kieu: "moi", documentCode: ma(), title: "T", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "X", tep: null } }));
    if (!a.ok) throw new Error(JSON.stringify(a));
    expect(a.hangRao!.loi.map((l) => l.ma).sort()).toEqual(["HIEU_LUC_SOM", "VAN_BAN_THIEU"]);
    expect(a.hangRao!.somNhat).toBe("2026-03-23");
    const k = await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null });
    expect(k.ok).toBe(false);
    if (!k.ok) expect(k.hangRao?.loi.map((l) => l.ma).sort()).toEqual(["HIEU_LUC_SOM", "VAN_BAN_THIEU"]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId } })).status).toBe("DRAFT");
  });

  it("[NHH-FE-HD-12] kiemHangRao đọc-không-ghi: gọi hai lần cùng kết quả, updatedAt không đổi, không thêm dòng audit", async () => {
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    const truoc = await db.auditLog.count({ where: { entityId: a.versionId } });
    const r1 = await kiemHangRao({ actor: actorHo, now: NOW, versionId: a.versionId });
    const r2 = await kiemHangRao({ actor: actorHo, now: NOW, versionId: a.versionId });
    expect(r1).toEqual(r2);
    if (!r1.ok) throw new Error("x");
    expect(r1.updatedAt).toBe(a.updatedAt);
    expect(r1.hangRao.loi).toEqual([]);
    expect(await db.auditLog.count({ where: { entityId: a.versionId } })).toBe(truoc);
  });

  it("[NHH-FE-HD-13] trần: hai chính sách GLOBAL cộng quá trần ⇒ kích hoạt cái thứ hai bị chặn VUOT_TRAN (trần đọc từ cấu hình, không hằng 9%)", async () => {
    const a = await luu(formDu({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "5" } } }));
    if (!a.ok) throw new Error("x");
    expect((await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null })).ok).toBe(true);
    // chính sách thứ hai: vai MARKETING cần người phụ trách ⇒ dùng SALE_ADMIN (TRANSACTION_ROLE) 5% ⇒ Σ 10% > 9%
    const b = await luu(formDu({ vai: ["SALE_ADMIN"], o: { "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "5" } } }));
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.hangRao!.loi.map((l) => l.ma)).toContain("VUOT_TRAN");
    const k = await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: b.versionId, xacNhanLyDo: null });
    expect(k.ok).toBe(false);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: b.versionId } })).status).toBe("DRAFT");
  });

  it("[NHH-FE-HD-14] huỷ nháp: thành CANCELLED có lý do; bản ACTIVE thì không huỷ được (lỗi chung)", async () => {
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    expect((await huyBanNhap({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, lyDo: "soạn nhầm" })).ok).toBe(true);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId } })).status).toBe("CANCELLED");
    const b = await luu(formDu());
    if (!b.ok) throw new Error("x");
    await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: b.versionId, xacNhanLyDo: null });
    const h = await huyBanNhap({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: b.versionId, lyDo: "thử" });
    expect(h.ok).toBe(false);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: b.versionId } })).status).toBe("ACTIVE");
  });

  it("[NHH-FE-HD-15] phiên bản ĐÃ DÙNG (firstUsedAt): không sửa, không huỷ — lỗi chung nêu rõ 'đã sinh dòng sổ'", async () => {
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    await db.$transaction((tx) => danhDauDaDung(tx, a.versionId, NOW));
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    const sua = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! } }), actorHo, { policyId: a.policyId, versionId: a.versionId });
    expect(sua.ok).toBe(false);
    if (!sua.ok) expect(sua.chung).toMatch(/đã sinh dòng sổ/);
    const huy = await huyBanNhap({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, lyDo: "thử" });
    expect(huy.ok).toBe(false);
  });

  // ─── Reader ─────────────────────────────────────────────────────────────────

  it("[NHH-FE-HD-16] hàng chờ: nháp thiếu tệp vào 'Nháp thiếu văn bản'; nháp hiệu lực sớm vào 'Chưa đủ ngày' kèm ngày sớm nhất; nháp đủ thì KHÔNG có", async () => {
    const thieu = await luu(formDu({ vanBan: { kieu: "moi", documentCode: ma(), title: "T", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "X", tep: null } }));
    const som = await luu(formDu({ hieuLucTu: "2026-03-20" }));
    const du = await luu(formDu());
    if (!thieu.ok || !som.ok || !du.ok) throw new Error("x");
    const hc = (await docHangChoChinhSach(actorHo, NOW)).filter((x) => x.policyCode?.startsWith(P));
    const theoLoai = (l: string) => hc.filter((x) => x.loai === l).map((x) => x.versionId);
    expect(theoLoai("NHAP_THIEU_VAN_BAN")).toEqual([thieu.versionId]);
    expect(theoLoai("CHUA_DU_NGAY_LAM_VIEC")).toEqual([som.versionId]);
    expect(hc.find((x) => x.versionId === som.versionId)?.ngay).toBe("2026-03-23");
    expect(hc.some((x) => x.versionId === du.versionId)).toBe(false);
  });

  it("[NHH-FE-HD-17] hàng chờ theo tầm nhìn: người CS1 không thấy việc của nháp CS2; vai 'chưa có chính sách' xuất hiện khi chưa kích hoạt gì", async () => {
    const c2 = await luu(formDu({ chuSoHuuOrgUnitId: cs2, vanBan: { kieu: "moi", documentCode: ma(), title: "T", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "X", tep: null } }), actorHo);
    if (!c2.ok) throw new Error("x");
    const cs1Thay = (await docHangChoChinhSach(actorCoSo([cs1Center]), NOW)).filter((x) => x.policyCode?.startsWith(P));
    expect(cs1Thay).toEqual([]);
    const hoThay = (await docHangChoChinhSach(actorHo, NOW)).filter((x) => x.policyCode?.startsWith(P));
    expect(hoThay.map((x) => x.versionId)).toEqual([c2.versionId]);
    // chưa có bản ACTIVE nào (fixture dọn sạch) ⇒ MỌI vai master đều là việc (10 vai: 8 vai cũ + `REFERRER_PARENT_SALE` + `SOURCE_OWNER` của nguồn động)
    const vai = (await docHangChoChinhSach(actorHo, NOW)).filter((x) => x.loai === "VAI_KHONG_CO_CHINH_SACH");
    expect(vai.length).toBe(MASTER_VAI_HUONG.length);
    expect(MASTER_VAI_HUONG.length).toBe(10);
  });

  it("[NHH-FE-HD-18] bảng chính sách: mỗi chính sách một dòng, đúng phiên bản hiện hành (ACTIVE v1, có nháp v2 kèm theo); tỉ lệ cộng đúng", async () => {
    const a = await luu(formDu({ vai: ["SALE", "SALE_ADMIN"], o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "1" } } }));
    if (!a.ok) throw new Error("x");
    expect((await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null })).ok).toBe(true);
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    await luu(formDu({ policyCode: code, vai: ["SALE"], o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "3" } }, vanBan: { kieu: "co-san", id: a.vanBanId! }, hieuLucTu: "2026-11-02" }), actorHo, { policyId: a.policyId });
    const dong = (await docBangChinhSach(actorHo, NOW)).filter((d) => d.policyCode === code);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ versionNo: 1, khoa: "DANG_AP_DUNG", soPhienBan: 2, coBanNhap: { versionNo: 2 } });
    expect(dong[0]!.tiLe).toEqual([{ loai: "NEW", tongPhanTram: "5", khongTinDuoc: false }]);
    expect(dong[0]!.vai.map((v) => v.code).sort()).toEqual(["SALE", "SALE_ADMIN"]);
  });

  it("[NHH-FE-HD-19] ma trận từ DB: GLOBAL 4% + riêng nhóm Quảng cáo 2% ⇒ ô đúng, UNKNOWN = 2%, tổng so trần đọc từ setting; chính sách của CS2 KHÔNG vào ma trận của người CS1", async () => {
    const chung = await luu(formDu());
    const rieng = await luu(formDu({ phamVi: { loai: "SOURCE_GROUP", sourceGroupId: nhomQc }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "2" } } }));
    const cs2Rule = await luu(formDu({ chuSoHuuOrgUnitId: cs2, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "7" } } }), actorHo);
    if (!chung.ok || !rieng.ok || !cs2Rule.ok) throw new Error("x");
    for (const x of [chung, rieng, cs2Rule]) {
      const k = await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: x.versionId, xacNhanLyDo: null });
      expect(k.ok, JSON.stringify(k)).toBe(true);
    }
    const dungTu = async (actor: Actor, coSoId: string | null) => {
      const d = await docDuLieuMaTran(actor, coSoId);
      return dungMaTran({ quyTac: d.quyTac, nhomNguon: d.nhomNguon, vai: d.vai, loai: "NEW", orgUnitPath: d.orgUnitPath, rateDate: NOW, thuTuPhamVi: THU_TU_PHAM_VI_MAC_DINH, tran: d.tran ?? 0.09 });
    };
    const m = await dungTu(actorHo, null);
    const sale = m.dong.find((x) => x.vai.code === "SALE")!;
    expect(sale.o.find((o) => o.cot === nhomQc)).toMatchObject({ kieu: "PERCENT", phanTram: "2", cuThe: true });
    expect(sale.o.find((o) => o.kieu === "PERCENT" && o.cot !== nhomQc && o.cot !== "UNKNOWN")).toMatchObject({ phanTram: "4", cuThe: false });
    expect(sale.o.find((o) => o.cot === "UNKNOWN")).toMatchObject({ phanTram: "2" });
    expect(m.tranPhanTram).toBe("9");
    // rule của CS2 (7%) chỉ áp tại CS2: toàn hệ KHÔNG thấy; xem tại CS2 thì 7% thắng
    expect(sale.o.some((o) => o.kieu === "PERCENT" && o.phanTram === "7")).toBe(false);
    const taiCs2 = await dungTu(actorHo, cs2Center);
    expect(taiCs2.dong.find((x) => x.vai.code === "SALE")!.o.find((o) => o.cot !== nhomQc && o.cot !== "UNKNOWN" && o.kieu === "PERCENT")).toMatchObject({ phanTram: "7", cuThe: true });
    // người CS1 không đọc được rule của CS2 ngay từ tầng dữ liệu
    const dCs1 = await docDuLieuMaTran(actorCoSo([cs1Center]), null);
    expect(dCs1.quyTac.some((q) => q.policyId === cs2Rule.policyId)).toBe(false);
    expect(dCs1.quyTac.some((q) => q.policyId === chung.policyId)).toBe(true);
  });

  it("[NHH-FE-HD-21] bảng chính sách theo tầm nhìn: người CS1 thấy chính sách Hội sở + của CS1, KHÔNG thấy của CS2; đối chứng: Hội sở thấy cả ba; mỗi dòng mang chủ sở hữu để chip cơ sở lọc", async () => {
    const ho = await luu(formDu({ chuSoHuuOrgUnitId: null }), actorHo);
    const c1 = await luu(formDu({ chuSoHuuOrgUnitId: cs1 }), actorHo);
    const c2 = await luu(formDu({ chuSoHuuOrgUnitId: cs2 }), actorHo);
    if (!ho.ok || !c1.ok || !c2.ok) throw new Error("x");
    const trongBang = async (a: Actor) => (await docBangChinhSach(a, NOW)).filter((d) => d.policyCode.startsWith(P));
    const ids = (ds: { policyId: string }[]) => ds.map((d) => d.policyId).sort();
    expect(ids(await trongBang(actorCoSo([cs1Center])))).toEqual([ho.policyId, c1.policyId].sort());
    expect(ids(await trongBang(actorCoSo([cs2Center])))).toEqual([ho.policyId, c2.policyId].sort());
    const tatCa = await trongBang(actorHo);
    expect(ids(tatCa)).toEqual([ho.policyId, c1.policyId, c2.policyId].sort());
    expect(tatCa.find((d) => d.policyId === ho.policyId)!.chuSoHuuCenterId).toBeNull();
    expect(tatCa.find((d) => d.policyId === c1.policyId)!.chuSoHuuCenterId).toBe(cs1Center);
    expect(tatCa.find((d) => d.policyId === c2.policyId)!.chuSoHuuCenterId).toBe(cs2Center);
  });

  it("[NHH-FE-HD-20] dữ liệu soạn: người CS1 chỉ được chọn cơ sở CS1 và không được sở hữu Hội sở; văn bản liệt kê trong tầm nhìn; loại GD bật = NEW + RENEWAL", async () => {
    const ho = await docDuLieuSoan(actorHo, NOW);
    expect(ho.coTheSoHuuHoiSo).toBe(true);
    expect(ho.coSo.map((c) => c.centerId).sort()).toEqual([cs1Center, cs2Center].sort());
    const cs = await docDuLieuSoan(actorCoSo([cs1Center]), NOW);
    expect(cs.coTheSoHuuHoiSo).toBe(false);
    expect(cs.coSo.map((c) => c.centerId)).toEqual([cs1Center]);
    expect(ho.loaiGdBat).toEqual(["NEW", "RENEWAL"]);
    expect(ho.vai).toHaveLength(MASTER_VAI_HUONG.length);
    expect(ho.nhomNguon.some((n) => n.code === "UNKNOWN")).toBe(false);
  });

  // ─── Rà soát độc lập 08/10 — mỗi ca dưới đây ghim một phép cấy từng cho XANH 100% (xem bảng ở docs/source-commission/06) ───

  it("[NHH-FE-HD-22] KHÔNG mượn chính sách CỦA MÌNH làm bình phong để sửa nháp của chính sách KHÁC: (policyId = của CS1, versionId = nháp Hội sở) ⇒ 'không tìm thấy', nháp Hội sở nguyên vẹn; đối chứng: sửa nháp CỦA MÌNH thì được", async () => {
    // Cấy: bỏ `|| ver.policyId !== pol.id` ở luuNhap ⇒ 1193/1193 + 87/87 XANH. Quyền GHI được kiểm trên chính sách NGƯỜI GỬI NÊU (của CS1),
    // còn version lại tra bằng `scopedDb` mà bản ghi Hội sở (centerId NULL = dùng chung) NHÌN THẤY được ⇒ CS1 sửa được nháp của Hội sở.
    const ho = await luu(formDu());
    const own = await luu(formDu({ chuSoHuuOrgUnitId: cs1 }));
    if (!ho.ok || !own.ok) throw new Error("x");
    const codeOwn = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: own.policyId } })).policyCode;
    const cs1Actor = actorCoSo([cs1Center]);
    const formSua = (phanTram: string) =>
      formDu({ policyCode: codeOwn, chuSoHuuOrgUnitId: cs1, vanBan: { kieu: "co-san", id: own.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram } } });

    const r = await luu(formSua("9"), cs1Actor, { policyId: own.policyId, versionId: ho.versionId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.chung).toMatch(/Không tìm thấy/);
    expect((await db.commissionRule.findMany({ where: { versionId: ho.versionId } })).map((x) => x.rate?.toString())).toEqual(["0.04"]);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: ho.versionId } })).updatedAt.toISOString()).toBe(ho.updatedAt);

    // đối chứng dương: chính CS1 sửa nháp CỦA MÌNH thì được (lưới không chặn nhầm)
    const dung = await luu(formSua("3"), cs1Actor, { policyId: own.policyId, versionId: own.versionId, updatedAtDaThay: own.updatedAt });
    expect(dung.ok, JSON.stringify(dung)).toBe(true);
    expect((await db.commissionRule.findMany({ where: { versionId: own.versionId } })).map((x) => x.rate?.toString())).toEqual(["0.03"]);
  });

  it("[NHH-FE-HD-23] chính sách ĐÃ CÓ: văn bản mới kèm phiên bản mới thuộc đơn vị của CHÍNH SÁCH, không theo chủ sở hữu client gửi (khai null = Hội sở không biến văn bản của CS1 thành dùng chung)", async () => {
    // Cấy: `ownerOrgUnitId = pol.orgUnitId` → `payload.ownerOrgUnitId` XANH. Client thật luôn gửi đúng chủ (formTuPhienBan) nên chỉ một request
    // tự dựng mới lộ: văn bản mang `centerId NULL` hiện ra cho actor của MỌI cơ sở (NULL_IS_GLOBAL).
    const own = await luu(formDu({ chuSoHuuOrgUnitId: cs1 }));
    if (!own.ok) throw new Error("x");
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: own.policyId } })).policyCode;
    const f = formDu({ policyCode: code, chuSoHuuOrgUnitId: null, hieuLucTu: "2026-11-02" });
    const r = await luu(f, actorCoSo([cs1Center]), { policyId: own.policyId });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const so = f.vanBan.kieu === "moi" ? f.vanBan.documentCode : "?";
    const doc = await db.regulationDocument.findFirstOrThrow({ where: { documentCode: so } });
    expect(doc.centerId).toBe(cs1Center);
    expect(doc.orgUnitId).toBe(cs1);
    // người CS2 KHÔNG thấy văn bản đó
    expect(await scopedDb(actorCoSo([cs2Center])).regulationDocument.findUnique({ where: { id: doc.id } })).toBeNull();
  });

  it("[NHH-FE-HD-24] coChinhSachDangApDung: bản ACTIVE CHƯA tới ngày hiệu lực không phải 'đang áp dụng'; bản đã tới thì phải", async () => {
    // Cấy: `effectiveFrom: { lte: now }` → `gte` XANH — không ca nào gọi hàm này (nó chỉ nuôi dải "Chưa có chính sách nào đang hiệu lực").
    expect(await coChinhSachDangApDung(actorHo, NOW), "nền sạch: chưa có bản ACTIVE nào").toBe(false);
    const tuongLai = await luu(formDu({ hieuLucTu: "2026-11-02" }));
    if (!tuongLai.ok) throw new Error("x");
    expect((await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: tuongLai.versionId, xacNhanLyDo: null })).ok).toBe(true);
    expect(await coChinhSachDangApDung(actorHo, NOW), "ACTIVE nhưng 02/11 mới hiệu lực").toBe(false);
    const dangChay = await luu(formDu({ vai: ["SALE_ADMIN"], o: { "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "1" } } }));
    if (!dangChay.ok) throw new Error("x");
    expect((await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: dangChay.versionId, xacNhanLyDo: null })).ok).toBe(true);
    expect(await coChinhSachDangApDung(actorHo, NOW)).toBe(true);
    // cùng một DB, một thời điểm TRƯỚC khi bản thứ hai có hiệu lực (22/03 17:00Z = 23/03 00:00 VN) ⇒ lại là false
    expect(await coChinhSachDangApDung(actorHo, new Date("2026-03-22T16:59:59.999Z"))).toBe(false);
  });

  it("[NHH-FE-HD-25] bộ lọc/chip cơ sở: người CS1 chỉ thấy cơ sở CS1, Hội sở thấy mọi cơ sở; vai đang bật", async () => {
    // Cấy: bỏ nhánh tầm nhìn ở `docBoLocChinhSach` (luôn `{ not: null }`) XANH — HD-20 chỉ phủ `docDuLieuSoan`, một bản chép riêng của cùng điều kiện.
    const cs = await docBoLocChinhSach(actorCoSo([cs1Center]));
    expect(cs.coSo.map((c) => c.id)).toEqual([cs1Center]);
    const ho = await docBoLocChinhSach(actorHo);
    expect(ho.coSo.map((c) => c.id)).toEqual(expect.arrayContaining([cs1Center, cs2Center]));
    expect(ho.vai).toHaveLength(MASTER_VAI_HUONG.length);
  });

  it("[NHH-FE-HD-26] hàng chờ trừ ngày lễ THẬT từ DB: lễ toàn hệ đẩy mốc 15 ngày cho mọi nháp; lễ riêng CS1 chỉ đẩy nháp có phạm vi phủ CS1, KHÔNG đẩy nháp phạm vi CS2", async () => {
    // Cấy: (a) bỏ nạp `Holiday` ở docHangChoChinhSach, (b) `coSoTrongPhamVi` luôn rỗng — cả hai XANH, vì ca thuần HC2-02 tự đưa `nghi`
    // và `coSoTrongPhamVi` vào hàm phân loại; phần NỐI từ DB sang hàm đó chỉ ca này mới chạm.
    const glob = await luu(formDu());
    const p1 = await luu(formDu({ chuSoHuuOrgUnitId: cs1, phamVi: { loai: "ORG_UNIT", orgUnitId: cs1 } }));
    const p2 = await luu(formDu({ chuSoHuuOrgUnitId: cs2, phamVi: { loai: "ORG_UNIT", orgUnitId: cs2 } }));
    if (!glob.ok || !p1.ok || !p2.ok) throw new Error("x");
    const chuaDu = async () => (await docHangChoChinhSach(actorHo, NOW)).filter((x) => x.loai === "CHUA_DU_NGAY_LAM_VIEC" && x.policyCode?.startsWith(P));
    const ids = (xs: { versionId: string | null }[]) => xs.map((x) => x.versionId).sort();
    expect(await chuaDu(), "không lễ: cả ba đúng ngày thứ 15 (02/03 → 23/03)").toEqual([]);

    await db.holiday.create({ data: { name: `${P}le-cs1`, date: new Date("2026-03-10T00:00:00.000Z"), type: "HOLIDAY", centerId: cs1Center } });
    const lo = await chuaDu();
    expect(ids(lo)).toEqual(ids([{ versionId: glob.versionId }, { versionId: p1.versionId }]));
    expect(lo.every((x) => x.ngay === "2026-03-24")).toBe(true);

    await db.holiday.deleteMany({ where: { name: `${P}le-cs1` } });
    await db.holiday.create({ data: { name: `${P}le-ca-he-thong`, date: new Date("2026-03-10T00:00:00.000Z"), type: "HOLIDAY", centerId: null } });
    const toan = await chuaDu();
    expect(ids(toan)).toEqual(ids([{ versionId: glob.versionId }, { versionId: p1.versionId }, { versionId: p2.versionId }]));
    expect(toan.every((x) => x.ngay === "2026-03-24")).toBe(true);
  });

  it("[NHH-FE-HD-27] đọc không lẫn bản ĐÃ HUỶ: hàng chờ không báo 'sắp hiệu lực' cho nháp đã huỷ; gốc để soạn phiên bản mới là bản KHÔNG huỷ; chính sách chỉ có một nháp không tự coi mình là 'nháp kèm theo'", async () => {
    // Cấy 08/10 (rà soát độc lập), ba phép đều XANH: (a) `status: { in: [...] }` của docHangChoChinhSach thêm CANCELLED, (b) docPhienBanDeSoan
    // lấy `versions[0]` thay vì bản không huỷ mới nhất, (c) bỏ `v.id !== chon.id` ở `coBanNhap`.
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    expect((await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null })).ok).toBe(true);
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    // v2 nháp, hiệu lực 12/10 (4 ngày sau NOW ⇒ nếu còn sống thì là 'sắp hiệu lực'… nhưng nháp không tính) rồi HUỶ
    const v2 = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! }, hieuLucTu: "2026-10-12" }), actorHo, { policyId: a.policyId });
    if (!v2.ok) throw new Error(JSON.stringify(v2));
    expect((await huyBanNhap({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: v2.versionId, lyDo: "soạn nhầm" })).ok).toBe(true);
    expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: v2.versionId } })).status).toBe("CANCELLED");

    expect((await docHangChoChinhSach(actorHo, NOW)).filter((x) => x.policyCode === code)).toEqual([]);
    const goc = await docPhienBanDeSoan(actorHo, a.policyId, null);
    expect(goc).toMatchObject({ versionNo: 1, status: "ACTIVE" });
    // chỉ định đúng version đã huỷ thì vẫn mở được (xem lại)
    expect(await docPhienBanDeSoan(actorHo, a.policyId, v2.versionId)).toMatchObject({ versionNo: 2, status: "CANCELLED" });

    const chiNhap = await luu(formDu());
    if (!chiNhap.ok) throw new Error("x");
    const dong = (await docBangChinhSach(actorHo, NOW)).find((d) => d.policyId === chiNhap.policyId);
    expect(dong).toMatchObject({ versionNo: 1, khoa: "NHAP", coBanNhap: null });
  });

  it("[NHH-FE-HD-28] cảnh báo cần xác nhận đi hết đường qua điều phối: chưa xác nhận ⇒ ok:false + hangRao.canhBao (KHÔNG phải loi); lý do 9 ký tự (đệm trắng) vẫn chặn; đủ 10 ⇒ kích hoạt, trả canhBao, audit mang lý do", async () => {
    // Cấy 08/10 (rà soát độc lập), hai phép XANH: (a) `kichHoatPhienBan` không chuyển `xacNhanLyDo` xuống service (cảnh báo không bao giờ xác nhận
    // được ⇒ mọi chính sách làm UNKNOWN tăng đều không kích hoạt nổi), (b) nhánh `CAN_XAC_NHAN_CANH_BAO` bị tắt (client nhận lỗi chặn cứng, đỏ
    // hàng rào, thay vì mở ô lý do).
    const g1 = await db.leadSourceGroup.create({ data: { code: "FXHD1", name: "FX nhóm 1", sortOrder: 901, commissionEnabled: true } });
    const g2 = await db.leadSourceGroup.create({ data: { code: "FXHD2", name: "FX nhóm 2", sortOrder: 902, commissionEnabled: true } });
    await db.leadSourceGroup.updateMany({ where: { code: { not: { startsWith: "FXHD" } }, status: "ACTIVE" }, data: { status: "INACTIVE" } });
    try {
      const nhom = (id: string, phanTram: string) => luu(formDu({ phamVi: { loai: "SOURCE_GROUP", sourceGroupId: id }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram } } }));
      const n1 = await nhom(g1.id, "4");
      const n2 = await nhom(g2.id, "5");
      if (!n1.ok || !n2.ok) throw new Error(JSON.stringify([n1, n2]));
      const kich = (versionId: string, xacNhanLyDo: string | null) => kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId, xacNhanLyDo });
      // n1 là rule đầu tiên của ô SALE·NEW ⇒ không có gì để xác nhận
      const mot = await kich(n1.versionId, null);
      expect(mot.ok, JSON.stringify(mot)).toBe(true);
      // n2 lấp nhóm còn thiếu ⇒ UNKNOWN 0 → 4%: CẢNH BÁO cần xác nhận
      const chua = await kich(n2.versionId, null);
      expect(chua.ok).toBe(false);
      if (chua.ok) return;
      expect(chua.chung).toMatch(/cảnh báo cần xác nhận/);
      expect(chua.hangRao?.loi).toEqual([]);
      expect(chua.hangRao?.canhBao.map((c) => c.ma)).toEqual(["CAN_XAC_NHAN_CANH_BAO"]);
      expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: n2.versionId } })).status).toBe("DRAFT");

      const ngan = await kich(n2.versionId, "   123456789   ");
      expect(ngan.ok).toBe(false);
      expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: n2.versionId } })).status).toBe("DRAFT");

      const dung = await kich(n2.versionId, "BLD chot 1");
      expect(dung.ok, JSON.stringify(dung)).toBe(true);
      if (dung.ok) expect(dung.canhBao.map((c) => c.ma)).toEqual(["UNKNOWN_TANG"]);
      expect((await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: n2.versionId } })).status).toBe("ACTIVE");
      const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionPolicyVersion", entityId: n2.versionId, action: "ACTIVATE" } });
      expect(log.reason).toContain("BLD chot 1");
    } finally {
      await db.leadSourceGroup.updateMany({ where: { code: { not: { startsWith: "FXHD" } }, status: "INACTIVE", isSystem: true }, data: { status: "ACTIVE" } });
    }
  });

  it("[NHH-FE-HD-29] ma trận fail-closed: rule của đơn vị SỞ HỮU đã bị xoá mềm (mất path) bị LOẠI, không biến thành rule 'toàn hệ'", async () => {
    // Cấy 08/10 (rà soát độc lập): `if (!path) return { path: "\0", depth: -1 }` → `{ path: "/", depth: -1 }` XANH. Đó là lựa chọn CÓ CHỦ ĐÍCH
    // (chú thích ở docDuLieuMaTran: "không đoán — bỏ rule khỏi ma trận còn hơn gán nhầm toàn hệ"): rule 4% của CS1 sẽ hiện ra như 4% áp MỌI nơi.
    const c1 = await luu(formDu({ chuSoHuuOrgUnitId: cs1 }));
    if (!c1.ok) throw new Error("x");
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: c1.policyId } })).policyCode;
    expect((await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: c1.versionId, xacNhanLyDo: null })).ok).toBe(true);
    const dungTu = async (coSoId: string | null) => {
      const d = await docDuLieuMaTran(actorHo, coSoId);
      return { d, m: dungMaTran({ quyTac: d.quyTac, nhomNguon: d.nhomNguon, vai: d.vai, loai: "NEW", orgUnitPath: d.orgUnitPath, rateDate: NOW, thuTuPhamVi: THU_TU_PHAM_VI_MAC_DINH, tran: d.tran ?? 0.09 }) };
    };
    const o = (m: ReturnType<typeof dungMaTran>) => m.dong.find((x) => x.vai.code === "SALE")!.o.filter((x) => x.cot !== "UNKNOWN");
    // đối chứng dương: xem TẠI CS1 thì 4% hiện; xem toàn hệ thì chưa (rule của cơ sở không áp ở "/")
    expect(o((await dungTu(cs1Center)).m).every((x) => x.kieu === "PERCENT" && x.phanTram === "4")).toBe(true);
    expect(o((await dungTu(null)).m).every((x) => x.kieu === "KHONG_CO")).toBe(true);

    await db.orgUnit.update({ where: { id: cs1 }, data: { deletedAt: NOW } });
    try {
      const { d, m } = await dungTu(null);
      const cua = d.quyTac.filter((q) => q.policyCode === code);
      expect(cua.length).toBeGreaterThan(0);
      expect(cua.every((q) => q.orgUnitPath === "\u0000")).toBe(true);
      expect(o(m).every((x) => x.kieu === "KHONG_CO"), "rule của đơn vị đã xoá KHÔNG được hiện như rule toàn hệ").toBe(true);
    } finally {
      await db.orgUnit.update({ where: { id: cs1 }, data: { deletedAt: null } });
    }
  });

  it("[NHH-FE-HD-30] kích hoạt gắn với NỘI DUNG người duyệt đã thấy: nháp bị sửa (4% → 8%) sau khi xem ⇒ kích hoạt với mốc cũ bị từ chối, nháp vẫn DRAFT 8%; đối chứng: mốc mới thì kích hoạt được", async () => {
    // Cấy 08/10: bỏ `updatedAtDaThay` khỏi `kichHoatPhienBan` ⇒ người duyệt xác nhận 4% mà máy chủ kích hoạt 8% (tái hiện thật trên Postgres).
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    const b = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "8" } } }), actorHo, { policyId: a.policyId, versionId: a.versionId, updatedAtDaThay: a.updatedAt });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.updatedAt).not.toBe(a.updatedAt);
    const cu = await kichHoatThat({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null, updatedAtDaThay: a.updatedAt });
    expect(cu.ok).toBe(false);
    if (cu.ok) return;
    expect(cu.chung).toMatch(/vừa được sửa/);
    const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: a.versionId }, include: { rules: true } });
    expect(v.status).toBe("DRAFT");
    expect(v.rules.map((x) => x.rate?.toString())).toEqual(["0.08"]);
    const moi = await kichHoatThat({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null, updatedAtDaThay: b.updatedAt });
    expect(moi.ok, JSON.stringify(moi)).toBe(true);
  });

  it("[NHH-FE-HD-31] tệp đính kèm do client khai không được tin: javascript: / host lạ / key ngoài thư mục upload ⇒ lỗi ở Ô 'vanBan.tep', KHÔNG tạo văn bản, KHÔNG tạo chính sách; đối chứng: tệp đúng kho thì lưu được", async () => {
    // Cấy 08/10: bỏ `loiTepVanBan` khỏi `luuNhap` ⇒ `RegulationDocument.fileUrl = "javascript:alert(1)"` qua điều kiện "văn bản phải kèm tệp".
    const dem = async () => ({ vb: await db.regulationDocument.count({ where: { documentCode: { startsWith: P } } }), cs: await db.commissionPolicy.count({ where: { policyCode: { startsWith: P } } }) });
    const truoc = await dem();
    const KEY = "uploads/documents/2026-10/fx-ab12cd34.pdf";
    for (const tep of [
      { key: "zzz", ten: "zzz", url: "javascript:alert(1)" },
      { key: KEY, ten: "x.pdf", url: `https://evil.example/${KEY}` },
      { key: KEY, ten: "x.pdf", url: `http://cdn.fx.test/${KEY}` },
      { key: "documents/fx.pdf", ten: "x.pdf", url: `${GOC_KHO}/documents/fx.pdf` },
    ]) {
      const f = formDu();
      const r = await luu({ ...f, vanBan: { ...(f.vanBan as Extract<FormChinhSach["vanBan"], { kieu: "moi" }>), tep } });
      expect(r.ok, JSON.stringify(tep)).toBe(false);
      if (r.ok) continue;
      expect(r.loi.map((x) => x.truong), JSON.stringify(tep)).toEqual(["vanBan.tep"]);
    }
    expect(await dem()).toEqual(truoc);
    expect((await luu(formDu())).ok).toBe(true);
  });

  it("[NHH-FE-HD-32] lưu vào phiên bản KHÔNG CÒN LÀ NHÁP kèm văn bản mới ⇒ bị từ chối TRƯỚC khi tạo văn bản (không để văn bản mồ côi chiếm số hiệu)", async () => {
    // Cấy 08/10: bỏ cổng trạng thái trước `taoVanBan` ⇒ số văn bản tăng 1 dù lưu thất bại.
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    expect((await kichHoatPhienBan({ actor: actorHo, nguoi: NGUOI, now: NOW, versionId: a.versionId, xacNhanLyDo: null })).ok).toBe(true);
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    const truoc = await db.regulationDocument.count({ where: { documentCode: { startsWith: P } } });
    const kq = await luu(formDu({ policyCode: code }), actorHo, { policyId: a.policyId, versionId: a.versionId, updatedAtDaThay: a.updatedAt });
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.chung).toMatch(/chỉ sửa được bản nháp|tạo version mới/);
    expect(await db.regulationDocument.count({ where: { documentCode: { startsWith: P } } })).toBe(truoc);
  });

  it("[NHH-FE-HD-33] sửa một nháp ĐÃ CÓ mà không mang mốc updatedAt đã thấy ⇒ từ chối (không có mốc thì không biết có ai sửa xen giữa); DB nguyên vẹn", async () => {
    const a = await luu(formDu());
    if (!a.ok) throw new Error("x");
    const code = (await db.commissionPolicy.findUniqueOrThrow({ where: { id: a.policyId } })).policyCode;
    const kq = await luu(formDu({ policyCode: code, vanBan: { kieu: "co-san", id: a.vanBanId! }, o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "9" } } }), actorHo, { policyId: a.policyId, versionId: a.versionId, updatedAtDaThay: null });
    expect(kq.ok).toBe(false);
    expect((await db.commissionRule.findMany({ where: { versionId: a.versionId } })).map((x) => x.rate?.toString())).toEqual(["0.04"]);
  });
});
