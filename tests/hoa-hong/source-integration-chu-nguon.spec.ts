// @vitest-environment node
/**
 * [SRC-INT-20..22] — TÍCH HỢP CHỦ NGUỒN (lane C2 · mục 4): «hiện tại» vs «lịch sử hiệu lực» vs «bản chụp» — ba nguồn sự thật KHÁC NHAU, và đổi chủ không viết lại tiền cũ. Postgres THẬT;
 * đường ghi chủ nguồn là `suaNguon` thật, đường ghi nguồn của lead là đường nhập thật, dòng tiền dựng bằng hàm ghi thật, sổ do ENGINE THẬT tính.
 *
 * Phần đã có ca riêng (KHÔNG làm lại ở đây): `[OWN-DB-01..08]` (một lần đổi chủ), `[DRF-*]` (chủ nghỉ việc / tắt cờ), `[DYN-SN-*]` (bản chụp), `[CLC-DB-*]` (chụp lại chủ).
 * Phần CHƯA có ca nào trước tệp này, và là lý do tệp tồn tại:
 *
 *   [SRC-INT-20] LỊCH SỬ CHỦ NGUỒN BẤT BIẾN ở tầng Postgres (trigger `LeadSourceOwnerPeriod_bat_bien_biud`): sửa chủ/ngày/lý do của khoảng mở, sửa khoảng đã đóng, xoá, chồng khoảng lịch sử ⇒ ném
 *                ĐÚNG câu của trigger; đối chứng dương: ĐÓNG khoảng mở + mở khoảng kế tiếp vẫn được. (Ánh xạ SRC-23 — tầng ghi nguồn; trước tệp này `grep` không thấy ca DB nào chạm trigger này.)
 *   [SRC-INT-21] ĐỔI CHỦ HAI LẦN (A→B→C) rồi quét lại khoản của A: MỌI cột của dòng sổ cũ byte-identical (id · số tiền · `resolverBasis` · `createdAt` · `inputHash`), 0 dòng mới, 0 INPUT_DRIFT;
 *                khoản giữa hai mốc về B, khoản sau mốc hai về C; mỗi dòng trỏ ĐÚNG khoảng lịch sử (`nguonChuKhoangId`); bản chụp trên attribution KHÔNG đổi; cột `ownerEmployeeId` = C (ý định mới nhất).
 *   [SRC-INT-22] FAIL-CLOSED: lead ghi lúc nguồn CHƯA có chủ, khoản thu TRƯỚC mốc khai chủ ⇒ treo `NGUON_CHUA_CO_NGUOI_PHU_TRACH`; sau đó khai A (từ T1) rồi ĐỔI sang B (từ T2) ⇒ quét lại khoản cũ:
 *                KHÔNG trả lùi cho A cũng không cho B, 0 INPUT_DRIFT; đối chứng dương: khoản sau T1 về A, khoản sau T2 về B.
 *
 * LUẬT 18: mỗi ca tự dựng, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối. Chạy: `pnpm test:hoa-hong-db`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, lamNhanVien, themChinhSachNhom, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { ghiNguonQuaDuongThat, suaNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[SRC-INT-chu-nguon] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const NOW_QUET_LAI = D("2026-11-25");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const P = "SRCINT_CN_";
const cuaToi: KichBan[] = [];
let dem = 0;
let admin = { userId: "", ten: "Quản trị fixture" };

async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  return k;
}

async function taoNhom(hau: string, chuEmployeeId: string | null = null) {
  dem += 1;
  return db.leadSourceGroup.create({
    data: { code: `${P}${hau}_${Date.now().toString(36)}${dem}`.toUpperCase(), name: `SRCINT ${hau}`, referrerRequirement: "NONE", sortOrder: 700 + dem, commissionEnabled: true, ownerEmployeeId: chuEmployeeId },
    select: { id: true, code: true },
  });
}

/** Mô phỏng bản migration: nguồn ĐANG có chủ nhận khoảng KHỞI TẠO mở từ `tu` (`createdAt = tu` ⇒ không vi phạm CHECK không-lùi-ngày). */
async function khoiTao(groupId: string, owner: string, tu: Date) {
  await db.leadSourceOwnerPeriod.create({ data: { groupId, ownerEmployeeId: owner, kind: "KHOI_TAO", effectiveFrom: tu, createdAt: tu, reason: "Khởi tạo lịch sử chủ nguồn (fixture mô phỏng migration)" } });
}

async function nhanSu(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  const empId = await lamNhanVien(u.id, `${k.ma}-${hau}`);
  return { userId: u.id, empId };
}

const chon = (groupId: string) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const holdMo = (khoan: string, code: string) => db.commissionHold.findMany({ where: { paymentId: khoan, code: code as never, status: "OPEN" } });

async function thu(k: KichBan, hau: string, ngay: Date, now = NOW) {
  const bc = await boiCanh(k, now);
  const khoan = await tienVe(k, await dungBe(k, hau, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  const kq = await quetKhoan(db, bc, khoan);
  return { khoan, kq, tom: tomTat(await dongSoCuaKhoan(khoan)) };
}

/** Chụp MỌI cột đáng kể của dòng sổ — so byte-identical trước/sau (không chỉ số tiền: `tomTat` bỏ sót id / createdAt / resolverBasis). */
async function chupSo(khoan: string) {
  return (await dongSoCuaKhoan(khoan)).map((d) => ({
    id: d.id,
    entryKind: d.entryKind,
    roleCode: d.roleCode,
    beneficiaryUserId: d.beneficiaryUserId,
    amount: d.amount,
    sourceGroupCode: d.sourceGroupCode,
    attributionId: d.attributionId,
    inputHash: d.inputHash,
    createdAt: d.createdAt.toISOString(),
    resolverBasis: d.resolverBasis,
  }));
}

describe.skipIf(!RUN_DB_TESTS)("[SRC-INT-OWN] tích hợp chủ nguồn — hiện tại · lịch sử · bản chụp", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    admin = { userId: (await seedUser({ email: `srcint-cn-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Quản trị fixture", phone: null })).id, ten: "Quản trị fixture" };
  }, 120_000);

  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });

  afterAll(async () => {
    await donKichBan(cuaToi);
    const nhom = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: P } }, select: { id: true } })).map((g) => g.id);
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", entityId: { in: nhom } } });
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhom } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhom } }, { originalGroupId: { in: nhom } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } }); // khoảng lịch sử đi theo (cascade — trigger cho phép khi nguồn cha đã mất)
    await datMocCutover(null);
  }, 120_000);

  it("[SRC-INT-20] lịch sử chủ nguồn BẤT BIẾN ở Postgres: sửa khoảng mở / khoảng đóng / xoá / chồng khoảng ⇒ ném đúng câu trigger; đối chứng dương: đóng khoảng mở + mở khoảng kế tiếp được", async () => {
    // Cấy: DROP TRIGGER "LeadSourceOwnerPeriod_bat_bien_biud" (hoặc gỡ một vế `IS DISTINCT FROM`) ⇒ các `rejects` tương ứng không ném ⇒ đỏ.
    const k = await kb("t20");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("T20", A.empId);
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    const mo = await db.leadSourceOwnerPeriod.findFirstOrThrow({ where: { groupId: g.id, effectiveTo: null } });
    const sua = (data: Record<string, unknown>) => db.leadSourceOwnerPeriod.update({ where: { id: mo.id }, data: data as never });

    // khoảng ĐANG MỞ: đổi chủ / đổi ngày bắt đầu / đổi lý do đều bị chặn — chỉ được ĐÓNG
    await expect(sua({ ownerEmployeeId: B.empId })).rejects.toThrow(/bất biến/);
    await expect(sua({ effectiveFrom: D("2026-10-06"), createdAt: D("2026-10-06") })).rejects.toThrow(/bất biến/);
    await expect(sua({ reason: "viết lại lịch sử cho đẹp" })).rejects.toThrow(/bất biến/);
    await expect(db.leadSourceOwnerPeriod.delete({ where: { id: mo.id } })).rejects.toThrow(/không bao giờ bị xoá/);
    expect((await db.leadSourceOwnerPeriod.findUniqueOrThrow({ where: { id: mo.id } })).ownerEmployeeId).toBe(A.empId); // chặn thật, không chỉ ném

    // đối chứng DƯƠNG: đóng khoảng mở ở T1, mở khoảng DOI_CHU B từ T1 (đúng thứ tự: đóng trước, mở sau)
    const T1 = D("2026-11-01");
    await sua({ effectiveTo: T1 });
    await db.leadSourceOwnerPeriod.create({ data: { groupId: g.id, ownerEmployeeId: B.empId, kind: "DOI_CHU", effectiveFrom: T1, createdAt: T1, setById: admin.userId, reason: "Chuyển phụ trách sang B từ 01/11" } });
    expect((await db.leadSourceOwnerPeriod.findMany({ where: { groupId: g.id }, orderBy: { effectiveFrom: "asc" } })).map((x) => [x.ownerEmployeeId, x.effectiveTo?.toISOString() ?? null])).toEqual([
      [A.empId, T1.toISOString()],
      [B.empId, null],
    ]);

    // khoảng ĐÃ ĐÓNG: không mở lại, không dời mốc đóng, không xoá
    await expect(sua({ effectiveTo: null })).rejects.toThrow(/đã đóng/);
    await expect(sua({ effectiveTo: D("2026-11-03") })).rejects.toThrow(/đã đóng/);
    await expect(db.leadSourceOwnerPeriod.delete({ where: { id: mo.id } })).rejects.toThrow(/không bao giờ bị xoá/);

    // CHỒNG khoảng lịch sử: khoảng [10-20, 10-25) nằm trọn trong khoảng A đã đóng ⇒ chặn (dùng khoảng ĐÓNG để không chạm chỉ mục "một khoảng mở")
    await expect(
      db.leadSourceOwnerPeriod.create({ data: { groupId: g.id, ownerEmployeeId: B.empId, kind: "DOI_CHU", effectiveFrom: D("2026-10-20"), effectiveTo: D("2026-10-25"), createdAt: D("2026-10-20"), setById: admin.userId, reason: "Chèn khoảng vào giữa lịch sử" } }),
    ).rejects.toThrow(/chồng khoảng/);
    expect(await db.leadSourceOwnerPeriod.count({ where: { groupId: g.id } })).toBe(2);
  });

  it("[SRC-INT-21] đổi chủ HAI lần A→B→C: quét lại khoản của A ⇒ dòng sổ cũ byte-identical, 0 dòng mới, 0 INPUT_DRIFT; khoản giữa → B, sau → C; bản chụp attribution không đổi", async () => {
    // Cấy: engine tra chủ theo «hôm nay» thay vì ngày sự kiện ⇒ quét lại ra C ⇒ INPUT_DRIFT «A −100.000 / C +100.000» ⇒ đỏ cả `quét lại` lẫn `byte-identical`.
    // Cấy 2: `ghiDoiChuNguon` quên đóng khoảng cũ ⇒ trigger chồng khoảng ném ngay ở lần đổi chủ thứ hai ⇒ đỏ.
    const k = await kb("t21");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const C = await nhanSu(k, "c");
    const g = await taoNhom("T21", A.empId);
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const attr = await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    expect(attr.signals).toMatchObject({ nguon: { chuNhanVienId: A.empId } }); // bản chụp lúc ghi nhận: A

    const truocT1 = await thu(k, "a", D("2026-11-10"));
    expect(truocT1.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    const soTruoc = await chupSo(truocT1.khoan);

    const T1 = D("2026-11-18");
    const T2 = D("2026-11-22");
    expect(await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Chuyển phụ trách nguồn sang B từ 18/11", now: D("2026-11-15"), hieuLucChuTu: T1 })).toMatchObject({ ok: true, doi: true });
    expect(await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: C.empId }, lyDo: "Chuyển phụ trách nguồn sang C từ 22/11", now: D("2026-11-20"), hieuLucChuTu: T2 })).toMatchObject({ ok: true, doi: true });

    // ba nguồn sự thật, ba câu trả lời KHÁC NHAU — đó là điều ca này khoá
    const ls = await db.leadSourceOwnerPeriod.findMany({ where: { groupId: g.id }, orderBy: { effectiveFrom: "asc" } });
    expect(ls.map((x) => [x.kind, x.ownerEmployeeId, x.effectiveTo?.toISOString() ?? null])).toEqual([
      ["KHOI_TAO", A.empId, T1.toISOString()],
      ["DOI_CHU", B.empId, T2.toISOString()],
      ["DOI_CHU", C.empId, null],
    ]);
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: g.id } })).ownerEmployeeId).toBe(C.empId); // hiện tại (ý định mới nhất)
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id } })).signals).toEqual(attr.signals); // bản chụp: vẫn A

    // quét lại khoản của A SAU hai lần đổi chủ
    const r = await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), truocT1.khoan);
    expect(r.loai).toBe("KHONG_DOI");
    expect(await holdMo(truocT1.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(await chupSo(truocT1.khoan)).toEqual(soTruoc); // byte-identical: không dòng nào bị sửa, không dòng nào thêm

    const giua = await thu(k, "b", D("2026-11-20"), NOW_QUET_LAI);
    expect(giua.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${B.userId}`]: 100_000 });
    const sau = await thu(k, "c", D("2026-11-23"), NOW_QUET_LAI);
    expect(sau.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${C.userId}`]: 100_000 });

    // mỗi dòng SOURCE_OWNER trỏ ĐÚNG khoảng lịch sử của chủ lúc đó (bằng chứng tra soát "lúc đó nguồn thuộc ai")
    const khoangCua = async (khoan: string) => ((await dongSoCuaKhoan(khoan)).find((d) => d.roleCode === "SOURCE_OWNER")!.resolverBasis as { nguonChuKhoangId: string; sourceOwnerEmployeeId: string });
    expect(await khoangCua(truocT1.khoan)).toMatchObject({ nguonChuKhoangId: ls[0]!.id, sourceOwnerEmployeeId: A.empId });
    expect(await khoangCua(giua.khoan)).toMatchObject({ nguonChuKhoangId: ls[1]!.id, sourceOwnerEmployeeId: B.empId });
    expect(await khoangCua(sau.khoan)).toMatchObject({ nguonChuKhoangId: ls[2]!.id, sourceOwnerEmployeeId: C.empId });
  });

  it("[SRC-INT-22] FAIL-CLOSED: khoản thu TRƯỚC mốc khai chủ ⇒ treo; khai A rồi đổi B ⇒ quét lại KHÔNG trả lùi cho ai; đối chứng dương: khoản sau T1 → A, sau T2 → B", async () => {
    // Cấy: engine tra khoảng «gần nhất» khi ngày sự kiện không rơi khoảng nào ⇒ khoản cũ quét lại ra A (hoặc B) ⇒ INPUT_DRIFT «+100.000» ⇒ đỏ.
    const k = await kb("t22");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("T22", null);
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const treo = await thu(k, "a", D("2026-11-10"));
    expect(treo.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 }); // chưa có chủ ⇒ KHÔNG ai nhận 1%
    expect((await holdMo(treo.khoan, "UNRESOLVED_BENEFICIARY"))[0]!.detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });

    const T1 = D("2026-11-18");
    const T2 = D("2026-11-22");
    expect(await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: A.empId }, lyDo: "Khai chủ nguồn A từ 18/11", now: D("2026-11-15"), hieuLucChuTu: T1 })).toMatchObject({ ok: true });
    expect(await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Đổi chủ nguồn sang B từ 22/11", now: D("2026-11-20"), hieuLucChuTu: T2 })).toMatchObject({ ok: true });

    const soTruoc = await chupSo(treo.khoan);
    const r = await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), treo.khoan);
    expect(r.loai).not.toBe("TROI");
    expect(await holdMo(treo.khoan, "INPUT_DRIFT")).toHaveLength(0);
    const rong = await chupSo(treo.khoan);
    expect(rong).toEqual(soTruoc);
    expect(rong.some((d) => d.roleCode === "SOURCE_OWNER")).toBe(false); // không trả lùi cho A, cũng không cho B

    // đối chứng dương: cùng engine, cùng lead — khoản MỚI đúng khoảng thì được trả (nên «0 dòng» ở trên là chặn thật, không phải engine hỏng)
    expect((await thu(k, "b", D("2026-11-19"), NOW_QUET_LAI)).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    expect((await thu(k, "c", D("2026-11-23"), NOW_QUET_LAI)).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${B.userId}`]: 100_000 });
  });
});
