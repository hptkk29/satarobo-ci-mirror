// @vitest-environment node
/**
 * [DRF-*] · [CSN-BC-*] · [OWN-DB-*] — HOA HỒNG ĐÃ TÍNH KHÔNG BỊ HỒI TỐ + CHỦ NGUỒN THEO LỊCH SỬ (hướng B+C, 16/10/2026). Postgres THẬT; đường ghi chủ nguồn là `suaNguon` thật;
 * dòng tiền dựng bằng hàm ghi thật; sổ do ENGINE THẬT tính.
 *
 *   [DRF-01] chủ nguồn đã được chi rồi NGHỈ VIỆC ⇒ quét lại KHÔNG sinh INPUT_DRIFT «−x», sổ không đổi, kết quả ghi `lichSu`
 *   [DRF-02] đối chứng DƯƠNG: Sale chốt đơn đổi vì nghiệp vụ (`convertedById` đổi sang người khác, người cũ không còn là ứng viên) ⇒ VẪN INPUT_DRIFT
 *   [DRF-03] nguồn TẮT `commissionEnabled` sau khi đã chi ⇒ ô đã chi không bị đo lại theo cờ sống (không «−x»); ô MỚI sau khi tắt thì không có dòng chủ nguồn
 *   [DRF-04] «Áp dụng» một INPUT_DRIFT khác (nghiệp vụ thật) không kéo theo thu hồi tiền của người đã nghỉ
 *   [CSN-BC-01] `resolverBasis` của dòng sổ ghi: chủ nguồn lúc đó · căn cứ · khoảng lịch sử · ngày sự kiện · attribution · bản chính sách · lúc resolve
 *   [OWN-DB-01] đổi chủ A→B hiệu lực T bằng `suaNguon` thật: lần mua có ngày thu đầu TRƯỚC T vẫn trả A (kể cả đợt trả góp SAU T); lần mua ĐẦU SAU T trả B; quét lại khoản cũ ⇒ KHÔNG điều chỉnh âm cho A
 *   [OWN-DB-02] hai khoản của MỘT lần mua (một trước T, một sau T) về CÙNG một người
 *   [OWN-DB-03] lead ghi nhận lúc nguồn CHƯA có chủ: khoản có ngày sự kiện sau mốc khai chủ ĐƯỢC trả cho chủ; trước mốc thì không (hết «treo vĩnh viễn», không hồi tố)
 *   [OWN-DB-04] chủ hiện tại NGHỈ VIỆC mà chưa thay ⇒ khoản MỚI treo `NGUOI_HUONG_NGHI` trung thực
 *   [OWN-DB-05] `suaNguon` từ chối đổi chủ khi thiếu / lùi ngày hiệu lực; lịch sử ghi đúng một khoảng đóng + một khoảng mở; nguồn khởi tạo có khoảng KHỞI TẠO
 *   [OWN-DB-07] đổi chủ «HÔM NAY» có hiệu lực TỪ LÚC LƯU: khoản dated 00:00 hôm nay (nhập tay) vẫn về chủ CŨ, khoản dated sau giờ lưu về chủ mới (hành vi chốt — ca chống hiểu lầm)
 *   [OWN-DB-08] đổi chủ ĐÃ HẸN: cột `ownerEmployeeId` là B NGAY, nhưng engine vẫn trả A cho khoản dated trước ngày hiệu lực (cột = ý định mới nhất, KHÔNG phải «chủ đang hiệu lực»)
 *
 * LUẬT 18: mỗi ca tự dựng, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối. Chạy: `pnpm test:hoa-hong-db`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { mocHieuLucTuNgayVN } from "../../lib/nguon/chu-nguon-lich-su";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, lamNhanVien, nguoiKyHo, themChinhSachNhom, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { ghiNguonQuaDuongThat, suaNguon, taoNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[DRF] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const NOW_QUET_LAI = D("2026-11-25");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const cuaToi: KichBan[] = [];
let dem = 0;
let admin = { userId: "", ten: "Quản trị fixture" };

async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  return k;
}

async function taoNhom(hau: string, o: { chuEmployeeId?: string | null; commissionEnabled?: boolean } = {}) {
  dem += 1;
  return db.leadSourceGroup.create({
    data: {
      code: `DRF_${hau}_${Date.now().toString(36)}${dem}`.toUpperCase(),
      name: `DRF ${hau}`,
      referrerRequirement: "NONE",
      sortOrder: 800 + dem,
      commissionEnabled: o.commissionEnabled ?? true,
      ownerEmployeeId: o.chuEmployeeId ?? null,
    },
    select: { id: true, code: true },
  });
}

/** Mô phỏng bản migration: nguồn ĐANG có chủ nhận khoảng KHỞI TẠO mở từ `tu` (insert thẳng — migration chạy trước test nên không seed được cho nhóm do test tạo). */
async function khoiTao(groupId: string, owner: string | null, tu: Date) {
  if (owner === null) return;
  await db.leadSourceOwnerPeriod.create({ data: { groupId, ownerEmployeeId: owner, kind: "KHOI_TAO", effectiveFrom: tu, createdAt: tu, reason: "Khởi tạo lịch sử chủ nguồn (fixture mô phỏng migration)" } });
}

async function nhanSu(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  const empId = await lamNhanVien(u.id, `${k.ma}-${hau}`);
  return { userId: u.id, empId };
}

const chon = (groupId: string) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });

async function thu(k: KichBan, hau: string, ngay: Date, now = NOW) {
  const bc = await boiCanh(k, now);
  const khoan = await tienVe(k, await dungBe(k, hau, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  const kq = await quetKhoan(db, bc, khoan);
  return { khoan, kq, tom: tomTat(await dongSoCuaKhoan(khoan)) };
}

const holdMo = (khoan: string, code: string) => db.commissionHold.findMany({ where: { paymentId: khoan, code: code as never, status: "OPEN" } });
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;

describe.skipIf(!RUN_DB_TESTS)("[DRF] hoa hồng đã tính không bị hồi tố · chủ nguồn theo lịch sử", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    admin = { userId: (await seedUser({ email: `drf-ghi-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Quản trị fixture", phone: null })).id, ten: "Quản trị fixture" };
  }, 120_000);

  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });

  afterAll(async () => {
    await donKichBan(cuaToi);
    const nhom = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "DRF_" } }, select: { id: true } })).map((g) => g.id);
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", entityId: { in: nhom } } });
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhom } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhom } }, { originalGroupId: { in: nhom } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DRF_" } } });
    await datMocCutover(null);
  }, 120_000);

  it("[DRF-01] chủ nguồn đã được chi rồi NGHỈ VIỆC ⇒ quét lại không «−x»: KHONG_DOI + lichSu, 0 hold, sổ không đổi", async () => {
    // Cấy: bỏ `kyVongSauLichSu(` ở soVoiOThu (truyền thẳng kyVongCua) ⇒ INPUT_DRIFT «A −100.000» ⇒ đỏ.
    const k = await kb("d1");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("A", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const chi = await thu(k, "a", D("2026-11-10"));
    expect(chi.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });

    await db.employee.update({ where: { id: A.empId }, data: { status: "RESIGNED" } });
    const truoc = await db.commissionTransaction.count({ where: { calcSlot: { paymentId: chi.khoan } } });
    const r = await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), chi.khoan);
    expect(r).toMatchObject({ loai: "KHONG_DOI", lichSu: [`SOURCE_OWNER|USER|${A.userId}`] });
    expect(await holdMo(chi.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(await db.commissionTransaction.count({ where: { calcSlot: { paymentId: chi.khoan } } })).toBe(truoc);
    expect(tomTat(await dongSoCuaKhoan(chi.khoan))).toEqual(chi.tom);
    // quét lại lần nữa vẫn yên (ô được đánh dấu đã khớp)
    expect((await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), chi.khoan)).loai).toBe("KHONG_DOI");
    expect(await holdMo(chi.khoan, "INPUT_DRIFT")).toHaveLength(0);
  });

  it("[DRF-02] đối chứng DƯƠNG: Sale chốt đơn đổi vì NGHIỆP VỤ ⇒ VẪN INPUT_DRIFT (A −400.000 / B +400.000) — carry-forward không nuốt mọi chênh lệch", async () => {
    const k = await kb("d2");
    const g = await taoNhom("B", { chuEmployeeId: null, commissionEnabled: false });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const chi = await thu(k, "a", D("2026-11-10"));
    expect(chi.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    const B = await seedUser({ email: `${k.ma}-sale-b@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-b`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: B.id } });
    const r = await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), chi.khoan);
    expect(r.loai).toBe("TROI");
    const hold = (await holdMo(chi.khoan, "INPUT_DRIFT"))[0]!;
    const chenh = (hold.detail as { chenh: { key: string; chenh: number }[] }).chenh;
    expect(Object.fromEntries(chenh.map((c) => [c.key, c.chenh]))).toEqual({ [`SALE|USER|${k.sale.id}`]: -400_000, [`SALE|USER|${B.id}`]: 400_000 });
  });

  it("[DRF-03] nguồn TẮT commissionEnabled sau khi đã chi ⇒ ô đã chi không «−x»; ô MỚI sau khi tắt không có dòng chủ nguồn (tắt cờ chỉ chặn ô mới)", async () => {
    const k = await kb("d3");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("C", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const chi = await thu(k, "a", D("2026-11-10"));
    expect(chi.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });

    await db.leadSourceGroup.update({ where: { id: g.id }, data: { commissionEnabled: false } });
    const r = await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), chi.khoan);
    expect(r).toMatchObject({ loai: "KHONG_DOI", lichSu: [`SOURCE_OWNER|USER|${A.userId}`] });
    expect(await holdMo(chi.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(tomTat(await dongSoCuaKhoan(chi.khoan))).toEqual(chi.tom);

    // ô MỚI (khoản thu mới của lần mua khác) sau khi tắt cờ: không có dòng chủ nguồn
    const moi = await thu(k, "b", D("2026-11-12"), NOW_QUET_LAI);
    expect(moi.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
  });

  it("[DRF-04] «Áp dụng» một INPUT_DRIFT khác không kéo theo thu hồi tiền của người đã nghỉ", async () => {
    const k = await kb("d4");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("D", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const chi = await thu(k, "a", D("2026-11-10"));
    // Sale đổi (nghiệp vụ) VÀ chủ nguồn nghỉ: chênh lệch thật chỉ là Sale; chủ nguồn đã nghỉ phải được GIỮ.
    const B = await seedUser({ email: `${k.ma}-sale-b@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-b`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: B.id } });
    await db.employee.update({ where: { id: A.empId }, data: { status: "RESIGNED" } });
    const bc = await boiCanh(k, NOW_QUET_LAI);
    expect((await quetKhoan(db, bc, chi.khoan)).loai).toBe("TROI");
    const hold = (await holdMo(chi.khoan, "INPUT_DRIFT"))[0]!;
    const khoaChu = ((hold.detail as { chenh: { key: string }[] }).chenh).map((c) => c.key);
    expect(khoaChu.some((x) => x.startsWith("SOURCE_OWNER|"))).toBe(false); // người duyệt KHÔNG thấy «chủ nguồn −x»
    const giai = await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Người chốt mới thật sự phụ trách đơn này", nguoi: await nguoiKyHo() });
    expect(giai.loai).toBe("DA_AP_DUNG");
    // `tomTat` lấy dòng CUỐI của mỗi khoá nên không dùng được ở đây: Sale cũ có dòng gốc +400.000 VÀ dòng điều chỉnh −400.000 ⇒ phải CỘNG theo khoá.
    const rong: Record<string, number> = {};
    for (const d of await dongSoCuaKhoan(chi.khoan)) rong[`${d.roleCode}:${d.beneficiaryUserId}`] = (rong[`${d.roleCode}:${d.beneficiaryUserId}`] ?? 0) + d.amount;
    expect(rong).toEqual({ [`SALE:${k.sale.id}`]: 0, [`SALE:${B.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
  });

  it("[CSN-BC-01] resolverBasis ghi chủ nguồn lúc đó, căn cứ, khoảng lịch sử, ngày sự kiện, attribution, bản chính sách, lúc resolve", async () => {
    const k = await kb("c1");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("E", { chuEmployeeId: A.empId });
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const attr = await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const chi = await thu(k, "a", D("2026-11-10"));
    const khoang = await db.leadSourceOwnerPeriod.findFirstOrThrow({ where: { groupId: g.id } });
    const dong = (await dongSoCuaKhoan(chi.khoan)).find((d) => d.roleCode === "SOURCE_OWNER")!;
    expect(dong.resolverBasis).toMatchObject({
      sourceOwnerEmployeeId: A.empId,
      nguonChuGoc: "LICH_SU",
      nguonChuKhoangId: khoang.id,
      attributionId: attr.id,
      policyVersionNo: dong.versionNo,
      resolvedAt: NOW.toISOString(),
    });
    expect((dong.resolverBasis as { ngaySuKien: string }).ngaySuKien).toBe(D("2026-11-10").toISOString());
    expect((dong.resolverBasis as { canCu: string }).canCu).toBeTruthy();
    // dòng của vai KHÁC (Sale) cũng mang ảnh chụp chủ nguồn — tra soát "lúc đó nguồn thuộc ai" không phải tra nguồn sống
    const sale = (await dongSoCuaKhoan(chi.khoan)).find((d) => d.roleCode === "SALE")!;
    expect(sale.resolverBasis).toMatchObject({ sourceOwnerEmployeeId: A.empId, nguonChuGoc: "LICH_SU" });
  });

  it("[OWN-DB-01] đổi chủ A→B hiệu lực T bằng suaNguon thật: lần mua trước T vẫn trả A (kể cả đợt SAU T); lần mua đầu sau T trả B; quét lại khoản cũ không điều chỉnh âm cho A", async () => {
    // Cấy: engine tra chủ theo «hôm nay» (bỏ ngaySuKien) ⇒ khoản cũ quét lại ra B ⇒ INPUT_DRIFT «A −100.000» ⇒ đỏ.
    const k = await kb("o1");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("F", { chuEmployeeId: A.empId });
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const truocT = await thu(k, "a", D("2026-11-10"));
    expect(truocT.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });

    const T = D("2026-11-18");
    const doi = await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Chuyển phụ trách nguồn sang B từ 18/11", now: D("2026-11-15"), hieuLucChuTu: T });
    expect(doi).toMatchObject({ ok: true, doi: true });
    const ls = await db.leadSourceOwnerPeriod.findMany({ where: { groupId: g.id }, orderBy: { effectiveFrom: "asc" } });
    expect(ls.map((x) => [x.kind, x.ownerEmployeeId, x.effectiveFrom.toISOString(), x.effectiveTo?.toISOString() ?? null])).toEqual([
      ["KHOI_TAO", A.empId, D("2026-10-05").toISOString(), T.toISOString()],
      ["DOI_CHU", B.empId, T.toISOString(), null],
    ]);

    // quét lại khoản cũ SAU khi đổi chủ: ngày sự kiện 10/11 < T ⇒ vẫn A ⇒ KHÔNG chênh lệch, KHÔNG «A −100.000 / B +100.000»
    const r = await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), truocT.khoan);
    expect(r.loai).toBe("KHONG_DOI");
    expect(await holdMo(truocT.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(tomTat(await dongSoCuaKhoan(truocT.khoan))).toEqual(truocT.tom);

    // lần mua ĐẦU tiên sau T ⇒ B
    const sauT = await thu(k, "b", D("2026-11-19"), NOW_QUET_LAI);
    expect(sauT.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${B.userId}`]: 100_000 });
  });

  it("[OWN-DB-07] đổi chủ 'HÔM NAY' có hiệu lực TỪ LÚC LƯU: khoản dated 00:00 hôm nay (nhập tay) vẫn về chủ CŨ; khoản dated sau giờ lưu về chủ mới", async () => {
    // Hành vi CHỐT (không hồi tố: khoản quét trong ngày có thể đã ghi cho A; kéo mốc về 00:00 là viết lại chúng). Ca này chống HIỂU LẦM — màn hình có câu nói điều này ([OWN-UI-02]).
    // Cấy: `mocHieuLucTuNgayVN` trả 00:00 sáng nay cho 'hôm nay' ⇒ khoản 00:00 về B ⇒ ca đỏ.
    const k = await kb("o7");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("O7", { chuEmployeeId: A.empId });
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const luu = new Date("2026-11-15T09:30:00+07:00"); // bấm Lưu 09:30 sáng giờ VN
    const hieuLuc = mocHieuLucTuNgayVN("2026-11-15", luu)!;
    expect(hieuLuc).toEqual(luu);
    expect(await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Chuyển phụ trách nguồn sang B từ hôm nay", now: luu, hieuLucChuTu: hieuLuc })).toMatchObject({ ok: true, doi: true });
    const nuaDem = await thu(k, "a", new Date("2026-11-15T00:00:00+07:00"), NOW_QUET_LAI);
    expect(nuaDem.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 }); // 00:00 hôm nay, TRƯỚC giờ lưu ⇒ chủ cũ
    const sauLuu = await thu(k, "b", new Date("2026-11-15T10:00:00+07:00"), NOW_QUET_LAI);
    expect(sauLuu.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${B.userId}`]: 100_000 }); // sau giờ lưu ⇒ chủ mới
  });

  it("[OWN-DB-08] đổi chủ ĐÃ HẸN: cột ownerEmployeeId là B NGAY, nhưng engine vẫn trả A cho khoản dated trước ngày hiệu lực (cột = ý định mới nhất, không phải chủ đang hiệu lực)", async () => {
    const k = await kb("o8");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("O8", { chuEmployeeId: A.empId });
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const T = D("2026-11-30");
    await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Hẹn chuyển phụ trách nguồn sang B từ 30/11", now: D("2026-11-15"), hieuLucChuTu: T });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: g.id } })).ownerEmployeeId).toBe(B.empId); // cột đổi NGAY — mọi chỗ đọc cột (guardrail, ô «có chủ chưa») thấy B từ lúc lưu
    const ls = await db.leadSourceOwnerPeriod.findMany({ where: { groupId: g.id }, orderBy: { effectiveFrom: "asc" } });
    expect(ls.map((x) => [x.ownerEmployeeId, x.effectiveTo?.toISOString() ?? null])).toEqual([[A.empId, T.toISOString()], [B.empId, null]]); // …nhưng tiền theo LỊCH SỬ: A tới T
    const truocT = await thu(k, "a", D("2026-11-20"), NOW_QUET_LAI);
    expect(truocT.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
  });

  it("[OWN-DB-02] hai khoản của MỘT lần mua (một trước T, một sau T) về CÙNG một người — ngày sự kiện là ngày thu ĐẦU", async () => {
    const k = await kb("o2");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("G", { chuEmployeeId: A.empId });
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const bc = await boiCanh(k, NOW);
    const dot1 = await tienVe(k, be, { soTien: 5_000_000, ngay: D("2026-11-10") });
    await quetKhoan(db, bc, dot1);
    const T = D("2026-11-18");
    await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Chuyển phụ trách nguồn sang B từ 18/11", now: D("2026-11-15"), hieuLucChuTu: T });
    const dot2 = await tienVe(k, be, { soTien: 5_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), dot2);
    expect(tomTat(await dongSoCuaKhoan(dot1))).toEqual({ [`SALE:${k.sale.id}`]: 200_000, [`SOURCE_OWNER:${A.userId}`]: 50_000 });
    expect(tomTat(await dongSoCuaKhoan(dot2))).toEqual({ [`SALE:${k.sale.id}`]: 200_000, [`SOURCE_OWNER:${A.userId}`]: 50_000 }); // KHÔNG chia hai người
  });

  it("[OWN-DB-03] lead ghi nhận lúc nguồn CHƯA có chủ: khoản sự kiện SAU mốc khai chủ được trả cho chủ; TRƯỚC mốc thì không", async () => {
    const k = await kb("o3");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("H", { chuEmployeeId: null });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const truoc = await thu(k, "a", D("2026-11-10"));
    expect(truoc.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 }); // chưa có chủ ⇒ treo
    expect((await holdMo(truoc.khoan, "UNRESOLVED_BENEFICIARY"))[0]!.detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });

    const T = D("2026-11-18");
    expect(await suaNguon({ nguoi: admin, id: g.id, updatedAtDaThay: await moiNhat(g.id), vao: { ownerEmployeeId: A.empId }, lyDo: "Khai chủ nguồn từ 18/11", now: D("2026-11-15"), hieuLucChuTu: T })).toMatchObject({ ok: true });
    const sau = await thu(k, "b", D("2026-11-19"), NOW_QUET_LAI);
    expect(sau.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 }); // bản chụp null KHÔNG còn chặn: sự kiện nằm trong khoảng có chủ
    // khoản TRƯỚC mốc quét lại: không hồi tố — không INPUT_DRIFT «A +100.000»
    const r = await quetKhoan(db, await boiCanh(k, NOW_QUET_LAI), truoc.khoan);
    expect(r.loai).not.toBe("TROI");
    expect(await holdMo(truoc.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(tomTat(await dongSoCuaKhoan(truoc.khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
  });

  it("[OWN-DB-04] chủ hiện tại NGHỈ VIỆC mà chưa thay ⇒ khoản MỚI treo NGUOI_HUONG_NGHI trung thực (không rơi về ai)", async () => {
    const k = await kb("o4");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("I", { chuEmployeeId: A.empId });
    await khoiTao(g.id, A.empId, D("2026-10-05"));
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    await db.employee.update({ where: { id: A.empId }, data: { status: "RESIGNED" } });
    const treo = await thu(k, "a", D("2026-11-10"));
    expect(treo.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await holdMo(treo.khoan, "UNRESOLVED_BENEFICIARY"))[0]!.detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUOI_HUONG_NGHI" });
  });

  it("[OWN-DB-05] suaNguon: đổi chủ mà thiếu hoặc LÙI ngày hiệu lực ⇒ từ chối, 0 dòng đổi; nguồn tạo có chủ ⇒ khoảng KHỞI TẠO; đổi chủ ⇒ đóng một + mở một", async () => {
    const k = await kb("o5");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const tao = await taoNguon({
      nguoi: admin,
      vao: {
        code: `DRF_O5_${Date.now().toString(36)}`.toUpperCase(),
        name: "DRF O5",
        description: null,
        sourceType: "OTHER",
        referrerRequirement: "NONE",
        requiresNote: false,
        selectable: true,
        sortOrder: 850,
        trangThai: "DRAFT",
        attributionWindowDays: null,
        commissionEnabled: false,
        ownerOrgUnitId: null,
        ownerEmployeeId: A.empId,
        effectiveFrom: null,
        effectiveTo: null,
      },
    });
    expect(tao).toMatchObject({ ok: true });
    if (!tao.ok) return;
    const ls0 = await db.leadSourceOwnerPeriod.findMany({ where: { groupId: tao.id } });
    expect(ls0).toHaveLength(1);
    expect(ls0[0]).toMatchObject({ kind: "KHOI_TAO", ownerEmployeeId: A.empId, effectiveTo: null });

    const now = D("2026-11-15");
    const thieu = await suaNguon({ nguoi: admin, id: tao.id, updatedAtDaThay: await moiNhat(tao.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Đổi phụ trách thử không ngày", now, hieuLucChuTu: null });
    expect(thieu).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    const lui = await suaNguon({ nguoi: admin, id: tao.id, updatedAtDaThay: await moiNhat(tao.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Đổi phụ trách thử lùi ngày", now, hieuLucChuTu: D("2026-11-01") });
    expect(lui).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: tao.id } })).ownerEmployeeId).toBe(A.empId); // cổng đứng TRƯỚC phép ghi: cột nguồn không đổi
    expect(await db.leadSourceOwnerPeriod.count({ where: { groupId: tao.id } })).toBe(1);

    const T = D("2026-11-16");
    expect(await suaNguon({ nguoi: admin, id: tao.id, updatedAtDaThay: await moiNhat(tao.id), vao: { ownerEmployeeId: B.empId }, lyDo: "Đổi phụ trách từ 16/11", now, hieuLucChuTu: T })).toMatchObject({ ok: true, doi: true });
    const ls = await db.leadSourceOwnerPeriod.findMany({ where: { groupId: tao.id }, orderBy: { effectiveFrom: "asc" } });
    expect(ls).toHaveLength(2);
    expect(ls[0]).toMatchObject({ ownerEmployeeId: A.empId, effectiveTo: T });
    expect(ls[1]).toMatchObject({ ownerEmployeeId: B.empId, kind: "DOI_CHU", effectiveTo: null, setById: admin.userId });
    // đã hẹn một thay đổi chưa tới hạn ⇒ không hẹn thêm
    const them = await suaNguon({ nguoi: admin, id: tao.id, updatedAtDaThay: await moiNhat(tao.id), vao: { ownerEmployeeId: A.empId }, lyDo: "Đổi lại ngay khi còn thay đổi hẹn giờ", now, hieuLucChuTu: D("2026-11-30") });
    expect(them).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    // lịch sử BẤT BIẾN: sửa/xoá trực tiếp bị trigger chặn
    await expect(db.leadSourceOwnerPeriod.update({ where: { id: ls[0]!.id }, data: { ownerEmployeeId: B.empId } })).rejects.toThrow(/bất biến/);
    await expect(db.leadSourceOwnerPeriod.delete({ where: { id: ls[1]!.id } })).rejects.toThrow(/không bao giờ bị xoá/);
  });

  it("[OWN-DB-06] xoá một NGUỒN kéo theo lịch sử chủ nguồn của nó (ON DELETE CASCADE) — đối chứng: xoá THẲNG một khoảng của nguồn còn sống vẫn bị chặn", async () => {
    // Vì sao: khoá ngoại RESTRICT làm MỌI spec dựng nguồn có chủ rồi dọn bằng `leadSourceGroup.deleteMany` đỏ (đo 16/10: 20 tệp/60 ca); lịch sử không có nghĩa khi nguồn đã không còn.
    // Cấy: đổi khoá ngoại về RESTRICT ⇒ xoá nguồn ném 23001 ⇒ đỏ; bỏ vế `NOT EXISTS (nguồn cha)` của trigger ⇒ xoá nguồn ném «không bao giờ bị xoá» ⇒ đỏ; bỏ cổng cha-còn-sống ⇒ ca «chặn» đỏ.
    const k = await kb("o6");
    const A = await nhanSu(k, "a");
    const tao = await taoNguon({
      nguoi: admin,
      vao: {
        code: `DRF_O6_${Date.now().toString(36)}`.toUpperCase(),
        name: "DRF O6",
        description: null,
        sourceType: "OTHER",
        referrerRequirement: "NONE",
        requiresNote: false,
        selectable: true,
        sortOrder: 851,
        trangThai: "DRAFT",
        attributionWindowDays: null,
        commissionEnabled: false,
        ownerOrgUnitId: null,
        ownerEmployeeId: A.empId,
        effectiveFrom: null,
        effectiveTo: null,
      },
    });
    expect(tao).toMatchObject({ ok: true });
    if (!tao.ok) return;
    const ls = await db.leadSourceOwnerPeriod.findMany({ where: { groupId: tao.id } });
    expect(ls).toHaveLength(1);
    await expect(db.leadSourceOwnerPeriod.delete({ where: { id: ls[0]!.id } })).rejects.toThrow(/không bao giờ bị xoá/);
    expect(await db.leadSourceOwnerPeriod.count({ where: { groupId: tao.id } })).toBe(1);
    await db.leadSourceGroup.delete({ where: { id: tao.id } });
    expect(await db.leadSourceOwnerPeriod.count({ where: { groupId: tao.id } })).toBe(0);
  });
});
