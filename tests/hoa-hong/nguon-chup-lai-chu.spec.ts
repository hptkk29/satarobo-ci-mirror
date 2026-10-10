// @vitest-environment node
/**
 * [CLC-DB-*] — «CHỤP LẠI CHỦ NGUỒN» cho lead đã ghi nhận (W3 · gt2 R1-H1). Postgres THẬT; đường ghi nguồn là đường nhập thật, dòng tiền dựng bằng hàm ghi thật, sổ do ENGINE THẬT tính.
 *
 *   [CLC-DB-01] SQL `BAN_CHUP_HOP_LE` ≡ Zod `docNguonChup` trên một bảng hình dạng (số trên nút = số dòng ghi)
 *   [CLC-DB-02] (a) lead ghi lúc nguồn CHƯA có chủ ⇒ hold NGUON_CHUA_CO_NGUOI_PHU_TRACH ⇒ khai chủ (vẫn treo) ⇒ chụp lại ⇒ quét ⇒ INPUT_DRIFT (hold treo đóng) ⇒ duyệt áp dụng ⇒ 1% về chủ;
 *               khoản CHƯA quét lần nào thì quét lần đầu ghi thẳng 1%
 *   [CLC-DB-03] (b) chủ nghỉ việc ⇒ hold NGUOI_HUONG_NGHI ⇒ thay chủ ⇒ chụp lại ⇒ quét ⇒ hold nghỉ việc đóng; lead ĐÃ chi cho chủ cũ (fin3 R5 M1) GIỮ chủ cũ — không vào diện, chụp lại KHÔNG thêm vế «chủ mới +x»
 *   [CLC-DB-04] chủ đã chụp CÒN HOẠT ĐỘNG KHÔNG bị đụng (signals · updatedAt byte-identical); lô trộn: chỉ dòng chủ nghỉ được chụp lại
 *   [CLC-DB-05] chạy lại = 0 dòng, 0 audit mới, `updatedAt` không nhích
 *   [CLC-DB-06] cổng: lý do ngắn · chủ lệch người đã thấy · chưa khai chủ · chủ nghỉ · chủ chưa tài khoản · cỡ lô sai ⇒ 0 dòng đổi
 *   [CLC-DB-07] bản chụp HỎNG · hàng CHƯA có bản chụp · nguồn KHÁC không bị đụng; `cuaSoNgay` · `attributedAt` · nhóm giữ nguyên
 *   [CLC-DB-08] 450 lead: chia lô, con trỏ tiến, mỗi lô dưới trần; hai người bấm cùng lúc không ghi hai lần
 *   [CLC-DB-09] audit mỗi lô (lý do · chủ mới · số dòng · id · chủ cũ THEO TỪNG LEAD), và audit lỗi ⇒ cả lô LÙI (không dòng nào đổi)
 *   [CLC-OBS-01] (it.fails) quan sát: hold treo mềm tự đóng ở lượt quét lại kế tiếp dù điều kiện còn — ghim, không vá ở W3
 *   [CLC-DB-10] `ghiChuNguonChupLo` tự kiểm lại điều kiện trong WHERE: id của dòng KHÔNG thuộc diện bị bỏ qua dù người gọi đưa vào; id của NGUỒN KHÁC (dòng còn trong diện) cũng bị bỏ qua
 *   [CLC-DB-11] «đã chi» = Σ ròng dòng sổ SOURCE_OWNER ≠ 0: hoàn trọn ⇒ vào diện; hoàn một phần ⇒ giữ chủ cũ; phép ghi tự từ chối id của lead đã chi
 *   [CLC-DB-12] khoá hàng nguồn `FOR SHARE`: chủ nguồn đang bị đổi (chưa commit) ⇒ chụp lại CHỜ rồi từ chối `chuDoi` (cấy N2)
 *   [CLC-DB-13] khoá advisory theo nguồn: khoá đang bị giữ ⇒ chụp lại CHỜ; khoá của nguồn khác không chặn (cấy N3)
 *   (kèm trong DB-02/03) hàng chờ SỔ thật của hai hold chủ nguồn dẫn về «Đối tượng liên quan» của ĐÚNG nguồn khi người xem mở được trang nguồn; không thì về lead
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { Prisma } from "@prisma/client";
import { db } from "../../lib/db";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { docHangChoSo } from "../../lib/hoa-hong/hang-cho-so-doc";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docCanChupLai } from "../../lib/nguon/chup-lai-chu-nguon-doc";
import { chupLaiChuNguonMotLo, type KetQuaChupLaiLo } from "../../lib/nguon/chup-lai-chu-nguon";
import { khoaChupLaiTheoNguon } from "../../lib/nguon/chup-lai-chu-nguon-luat";
import { BAN_CHUP_HOP_LE } from "../../lib/nguon/chup-lai-chu-nguon-sql";
import { ghiChuNguonChupLo } from "../../lib/nguon/ghi-nguon";
import { nguonCapNhatTheoLead } from "../../lib/nguon/doc-nguon-hoa-hong";
import { docNguonChup } from "../../lib/nguon/nguon-chup";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, dungBe, dungKichBan, hoanTien, lamNhanVien, nguoiKyHo, themChinhSachNhom, tienVe, tomTat, type KichBan } from "./_kich-ban";
import { ghiNguonQuaDuongThat, themLead } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[CLC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20"); // lượt quét đầu
const NOW_TRUOC_CHUP = D("2027-02-25"); // lượt quét đối chứng khi CHƯA chụp lại (phải sớm hơn NOW_CHUP để mốc nhích còn mới hơn `lastCheckedAt`)
const NOW_CHUP = D("2027-03-01"); // thời điểm chụp lại (thành `updatedAt` của dòng được ghi)
const NOW_QUET_LAI = D("2027-03-02"); // lượt quét sau khi chụp lại
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const LY_DO = "Khai chủ nguồn sau khi lead đã ghi nhận";
const cuaToi: KichBan[] = [];
const donSau: (() => Promise<unknown>)[] = [];
let dem = 0;

async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  return k;
}

async function taoNhom(hau: string, o: { chuEmployeeId?: string | null } = {}) {
  dem += 1;
  return db.leadSourceGroup.create({
    data: {
      code: `CLC_${hau}_${Date.now().toString(36)}${dem}`.toUpperCase(),
      name: `CLC ${hau}`,
      referrerRequirement: "NONE",
      sortOrder: 700 + dem,
      commissionEnabled: true,
      ownerEmployeeId: o.chuEmployeeId ?? null,
    },
    select: { id: true, code: true },
  });
}

/** Nhân sự + tài khoản (SOURCE_OWNER đổi `Employee.id` → `User.id`). */
async function nhanSu(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  const empId = await lamNhanVien(u.id, `${k.ma}-${hau}`);
  return { userId: u.id, empId };
}

/** Nhân sự CÒN LÀM VIỆC nhưng CHƯA có tài khoản. */
async function nhanSuKhongTaiKhoan(hau: string) {
  dem += 1;
  return db.employee.create({
    data: { employeeCode: `CLC${Date.now().toString(36)}${dem}${hau}`.toUpperCase(), fullName: `NV khong tk ${hau}`, jobTitle: "Nhân viên", department: "KINH_DOANH", status: "ACTIVE" },
    select: { id: true },
  });
}

const chon = (groupId: string) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });

async function thu(k: KichBan, hau: string, ngay: Date, now = NOW) {
  const bc = await boiCanh(k, now);
  const khoan = await tienVe(k, await dungBe(k, hau, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
  await quetKhoan(db, bc, khoan);
  return { khoan, tom: tomTat(await dongSoCuaKhoan(khoan)) };
}

const holdMo = (khoan: string, code: string) => db.commissionHold.findMany({ where: { paymentId: khoan, code: code as never, status: "OPEN" } });
const snap = async (leadId: string) => (await db.leadAttribution.findUniqueOrThrow({ where: { leadId } })) as { signals: unknown; updatedAt: Date; attributedAt: Date; groupId: string; originalGroupId: string };

function chay(nguonId: string, chuDuKien: string, o: { conTro?: string | null; coLo?: number; lyDo?: string | null; now?: Date } = {}) {
  return chupLaiChuNguonMotLo({
    nguoi: { userId: nguoiGhi, ten: "Quản trị fixture" },
    nguonId,
    chuDuKien,
    lyDo: o.lyDo === undefined ? LY_DO : o.lyDo,
    conTro: o.conTro ?? null,
    coLo: o.coLo ?? 100,
    now: o.now ?? NOW_CHUP,
  });
}

/** Lặp theo con trỏ cho tới hết; trả các lô. */
async function chayHet(nguonId: string, chuDuKien: string, coLo = 100): Promise<KetQuaChupLaiLo[]> {
  const ra: KetQuaChupLaiLo[] = [];
  let conTro: string | null = null;
  for (let i = 0; i < 100; i++) {
    const r = await chay(nguonId, chuDuKien, { conTro, coLo });
    ra.push(r);
    if (!r.ok || r.hetLead) return ra;
    conTro = r.conTro;
  }
  throw new Error("chayHet: không dừng sau 100 lô");
}

const tongDaChup = (ds: KetQuaChupLaiLo[]) => ds.reduce((n, r) => n + (r.ok ? r.daChup : 0), 0);
const demAudit = (nguonId: string) => db.auditLog.count({ where: { entityType: "LeadSourceGroup", entityId: nguonId, action: "NGUON_CHUP_LAI_CHU" } });


const QUYEN_DU = { don: true, lead: true, chinhSach: true, nguoiPhuTrach: true, nguon: true };

/** Dòng hàng chờ SỔ (đúng hàm đọc của màn) của một khoản — để đo link «việc kế tiếp» trên dữ liệu thật. */
async function dongHangCho(k: KichBan, khoan: string, quyen: typeof QUYEN_DU) {
  const ho = await nguoiKyHo();
  const ds = await docHangChoSo(db, ho.quyen, { centerId: k.centerId, quyen, coTrang: 100 });
  return ds.dong.find((d) => d.paymentId === khoan && d.vai === "SOURCE_OWNER");
}

let nguoiGhi = "";

describe.skipIf(!RUN_DB_TESTS)("[CLC-DB] chụp lại chủ nguồn trên lead đã ghi nhận", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
    nguoiGhi = (await seedUser({ email: `clc-ghi-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Quản trị fixture", phone: null })).id;
  }, 120_000);

  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });

  afterAll(async () => {
    for (const f of donSau) await f();
    await donKichBan(cuaToi);
    const nhom = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "CLC_" } }, select: { id: true } })).map((g) => g.id);
    await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", entityId: { in: nhom } } });
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhom } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhom } }, { originalGroupId: { in: nhom } }] } });
    await db.lead.deleteMany({ where: { parentName: { startsWith: "CLC-BULK" } } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "CLC_" } } });
    await datMocCutover(null);
  }, 120_000);

  it("[CLC-DB-01] SQL BAN_CHUP_HOP_LE ≡ Zod docNguonChup trên bảng hình dạng — số lead hiện ở nút bằng số lead được ghi", async () => {
    // Cấy: bỏ vế `- 'cuaSoNgay' - 'chuNhanVienId' = '{}'` (khoá thừa) ⇒ dòng "khoá thừa" lọt SQL mà Zod strict từ chối ⇒ đỏ.
    const hinh: unknown[] = [
      { nguon: { cuaSoNgay: 90, chuNhanVienId: null } },
      { nguon: { cuaSoNgay: 90, chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: 1, chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: 3650, chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: 3651, chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: 0, chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: 30.5, chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: "90", chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: 90, chuNhanVienId: "" } },
      { nguon: { cuaSoNgay: 90, chuNhanVienId: 7 } },
      { nguon: { cuaSoNgay: 90 } },
      { nguon: { chuNhanVienId: "emp-1" } },
      { nguon: { cuaSoNgay: 90, chuNhanVienId: "emp-1", thua: 1 } },
      { nguon: [] },
      { nguon: "x" },
      { nguon: null },
      { duongVao: "nhap-tay" },
      {},
      null,
    ];
    const dong = await db.$queryRaw<{ i: number; ok: boolean | null }[]>(Prisma.sql`
      SELECT (t.ord - 1)::int AS i, (${BAN_CHUP_HOP_LE}) AS ok
      FROM (SELECT value AS "signals", ordinality AS ord FROM jsonb_array_elements(${JSON.stringify(hinh)}::jsonb) WITH ORDINALITY) t
      ORDER BY t.ord`);
    expect(dong).toHaveLength(hinh.length);
    const sai = dong.filter((d) => (d.ok === true) !== (docNguonChup(hinh[d.i]).trangThai === "HOP_LE")).map((d) => JSON.stringify(hinh[d.i]));
    expect(sai, `SQL và Zod lệch nhau ở: ${sai.join(" | ")}`).toEqual([]);
    expect(dong.filter((d) => d.ok === true)).toHaveLength(4); // đối chứng dương: bảng thật có dòng hợp lệ (2 chủ + biên 1 và 3650)
  });

  it("[CLC-DB-02] (a) nguồn chưa có chủ lúc ghi ⇒ treo; khai chủ vẫn treo; chụp lại + quét ⇒ INPUT_DRIFT ⇒ duyệt ⇒ 1% về chủ; khoản chưa quét ⇒ 1% ngay lần đầu", async () => {
    // Cấy: bỏ nhánh `THIEU_CHU` (chuChup === null) khỏi phanLoaiChuChup ⇒ diện rỗng ⇒ daChup 0 ⇒ đỏ.
    const k = await kb("c2");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("A", { chuEmployeeId: null });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const a0 = await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    expect(a0.signals).toMatchObject({ nguon: { cuaSoNgay: 90, chuNhanVienId: null } });
    // Khoản đã quét LÚC NGUỒN CHƯA CÓ CHỦ ⇒ treo.
    const dot1 = await thu(k, "a", D("2026-11-20"));
    expect(dot1.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await holdMo(dot1.khoan, "UNRESOLVED_BENEFICIARY"))[0]!.detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });
    // Hàng chờ SỔ thật: người xem mở được trang nguồn ⇒ link về đúng nguồn; không ⇒ về lead.
    expect((await dongHangCho(k, dot1.khoan, QUYEN_DU))?.lienKet).toEqual({ nhan: "Mở nguồn", href: `/nguon-hoa-hong/nguon/${g.code}#muc-doi-tuong` });
    expect((await dongHangCho(k, dot1.khoan, { ...QUYEN_DU, nguon: false }))?.lienKet).toEqual({ nhan: "Mở lead", href: `/leads/${k.lead!.id}` });

    // Admin khai chủ SAU: bản chụp là thẩm quyền ⇒ vẫn treo (đây chính là lỗ).
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });
    await quetKhoan(db, await boiCanh(k, NOW_TRUOC_CHUP), dot1.khoan);
    expect((await dongSoCuaKhoan(dot1.khoan)).some((r) => r.roleCode === "SOURCE_OWNER")).toBe(false);
    expect(await holdMo(dot1.khoan, "INPUT_DRIFT"), "đối chứng: CHƯA chụp lại thì quét lại không thấy gì để trôi").toHaveLength(0);

    const truoc = await snap(k.lead!.id);
    const can = await docCanChupLai(db, g.id);
    expect(can).toMatchObject({ khongChupDuoc: null, tong: 1, theoLyDo: { THIEU_CHU: 1, CHU_NGHI_VIEC: 0, CHU_KHONG_CON_HO_SO: 0 } });
    const kq = await chay(g.id, A.empId);
    expect(kq).toMatchObject({ ok: true, daChup: 1, boQua: 0, hetLead: true, theoLyDo: { THIEU_CHU: 1 } });

    const sau = await snap(k.lead!.id);
    expect(sau.signals).toEqual({ ...(truoc.signals as object), nguon: { cuaSoNgay: 90, chuNhanVienId: A.empId } });
    expect(sau.attributedAt).toEqual(truoc.attributedAt);
    expect(sau.groupId).toBe(truoc.groupId);
    expect(sau.originalGroupId).toBe(truoc.originalGroupId);
    expect(sau.updatedAt).toEqual(NOW_CHUP);
    expect((await docCanChupLai(db, g.id))!.tong).toBe(0);

    // Mốc đầu vào nhích ⇒ tập quét Q4 thấy lead này đổi SAU lần so gần nhất của ô.
    const slot = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: dot1.khoan } });
    expect((await nguonCapNhatTheoLead(db, [k.lead!.id])).get(k.lead!.id)!.getTime()).toBeGreaterThan(slot.lastCheckedAt!.getTime());

    // Quét lại: KHÔNG tự ghi — INPUT_DRIFT cho người duyệt; hold "treo" cũ đóng.
    const bc2 = await boiCanh(k, NOW_QUET_LAI);
    await quetKhoan(db, bc2, dot1.khoan);
    expect(await holdMo(dot1.khoan, "UNRESOLVED_BENEFICIARY")).toHaveLength(0);
    const troi = await holdMo(dot1.khoan, "INPUT_DRIFT");
    expect(troi).toHaveLength(1);
    expect(tomTat(await dongSoCuaKhoan(dot1.khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 }); // chưa có dòng nào mới
    const giai = await giaiHangCho(db, bc2, { holdId: troi[0]!.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng chủ nguồn đã chụp lại cho khoản đã tính", nguoi: await nguoiKyHo() });
    expect(giai.loai).toBe("DA_AP_DUNG");
    expect(tomTat(await dongSoCuaKhoan(dot1.khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });

    // Khoản CHƯA quét lần nào sau khi chụp lại: quét lần đầu ghi thẳng 1% về chủ.
    const dot2 = await thu(k, "b", D("2026-11-21"), NOW_QUET_LAI);
    expect(dot2.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    expect(await holdMo(dot2.khoan, "UNRESOLVED_BENEFICIARY")).toHaveLength(0);
  });

  // GHIM BUG (it.fails, đo khi viết W3 — KHÔNG thuộc phạm vi vá của W3): hold «treo» mềm (UNRESOLVED_BENEFICIARY) chỉ sống tới lượt quét lại KẾ TIẾP. `soVoiOThu` không dựng lại hold treo của ô đã có
  // (chỉ INPUT_DRIFT), rồi `dongHangChoDaHetCan` đóng mọi hold mở không nằm trong tập vừa dựng — nên một lượt quét lại KHÔNG đổi gì cũng làm hold «chủ nguồn chưa có» biến khỏi hàng chờ trong khi điều kiện
  // còn nguyên. Hệ quả: hàng chờ sổ chỉ nhìn thấy sự cố treo tới lần quét lại đầu tiên. Vá xong (hold treo còn mở khi điều kiện còn) ca này ĐỎ ⇒ gỡ `.fails`.
  it.fails("[CLC-OBS-01] hold treo «chủ nguồn chưa có» VẪN MỞ sau một lượt quét lại không đổi gì (hôm nay: bị tự đóng)", async () => {
    const k = await kb("o1");
    const g = await taoNhom("OBS", { chuEmployeeId: null });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const dot = await thu(k, "a", D("2026-11-20"));
    expect(await holdMo(dot.khoan, "UNRESOLVED_BENEFICIARY")).toHaveLength(1);
    await quetKhoan(db, await boiCanh(k, NOW_TRUOC_CHUP), dot.khoan);
    expect(await holdMo(dot.khoan, "UNRESOLVED_BENEFICIARY")).toHaveLength(1);
  });

  it("[CLC-DB-03] (b) chủ nghỉ việc ⇒ NGUOI_HUONG_NGHI; thay chủ + chụp lại ⇒ lead CHƯA chi chuyển sang chủ mới; lead ĐÃ chi cho chủ cũ GIỮ chủ cũ (không INPUT_DRIFT, không thu hồi hồi tố)", async () => {
    // Cấy: bỏ nhánh CHU_NGHI_VIEC (hoặc dùng tập TRANG_THAI_NGHI rỗng) ⇒ lead của chủ nghỉ không vào diện ⇒ daChup 0 ⇒ đỏ. Bỏ phép loại «đã chi» (ở một trong ba nơi dùng) ⇒ lead 1 bị chụp sang B ⇒ đỏ.
    const k = await kb("c3");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("B", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    // lead 1: ghi nhận + ĐÃ chi cho A trước khi A nghỉ.
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const chi = await thu(k, "a", D("2026-11-20"));
    expect(chi.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    // lead 2: ghi nhận khi chủ là A, thu SAU khi A nghỉ ⇒ treo NGUOI_HUONG_NGHI.
    const k2 = await themLead(k, "hai");
    await ghiNguonQuaDuongThat(k2, { nguonChon: chon(g.id) }, ATTRIBUTED, k2.lead!.id);
    await db.employee.update({ where: { id: A.empId }, data: { status: "RESIGNED" } });
    const treo = await thu(k2, "n", D("2026-11-21"));
    expect(treo.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await holdMo(treo.khoan, "UNRESOLVED_BENEFICIARY"))[0]!.detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUOI_HUONG_NGHI" });
    expect((await dongHangCho(k2, treo.khoan, QUYEN_DU))?.lienKet).toEqual({ nhan: "Mở nguồn", href: `/nguon-hoa-hong/nguon/${g.code}#muc-doi-tuong` });

    // Admin THAY chủ sang B. Lead 2 (treo, CHƯA chi gì cho A) thuộc diện. Lead 1 đã chi 100.000đ cho A thì KHÔNG: chụp lại nó là thu hồi hồi tố từ người đã được trả hợp lệ — quét lại sẽ
    // sinh INPUT_DRIFT A −100.000 / B +100.000 và một cú «Áp dụng» là xong (fin3 R5 M1, đo 10/10/2026).
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: B.empId } });
    // đối chứng: thay chủ ở nhóm mà CHƯA chụp lại ⇒ quét lại khoản treo vẫn không có B, không có gì trôi.
    await quetKhoan(db, await boiCanh(k, NOW_TRUOC_CHUP), treo.khoan);
    expect(tomTat(await dongSoCuaKhoan(treo.khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect(await holdMo(treo.khoan, "INPUT_DRIFT")).toHaveLength(0);
    // đối chứng dương cho khoá nối của phép loại: dòng sổ SOURCE_OWNER của lead 1 mang đúng Employee.id của A (nếu cột này trống thì phép loại im lặng không làm gì)
    const dongChi = (await dongSoCuaKhoan(chi.khoan)).filter((r) => r.roleCode === "SOURCE_OWNER");
    expect(dongChi).toHaveLength(1);
    expect(dongChi[0]).toMatchObject({ beneficiaryEmployeeId: A.empId, beneficiaryUserId: A.userId, resolverType: "SOURCE_OWNER", amount: 100_000 });
    expect(await docCanChupLai(db, g.id)).toMatchObject({ tong: 1, giuChuCu: 1, theoLyDo: { THIEU_CHU: 0, CHU_NGHI_VIEC: 1, CHU_KHONG_CON_HO_SO: 0 } });

    // Đối chứng (ĐO 10/10/2026, không do chụp lại): chủ đã nghỉ thì quét lại khoản ĐÃ chi cho họ cho INPUT_DRIFT «A −100.000» (kỳ vọng hôm nay không còn A) — hành vi của engine, ngoài phạm vi W3.
    // Cái chụp lại KHÔNG ĐƯỢC thêm vào đó là vế «B +100.000».
    await quetKhoan(db, await boiCanh(k, NOW_TRUOC_CHUP), chi.khoan);
    const chenhCuaHold = async () => (await holdMo(chi.khoan, "INPUT_DRIFT")).flatMap((h) => ((h.detail as { chenh?: { key: string; chenh: number }[] }).chenh ?? []).map((c) => `${c.key}=${c.chenh}`)).sort();
    const chenhTruocChup = await chenhCuaHold();
    expect(chenhTruocChup).toEqual([`SOURCE_OWNER|USER|${A.userId}=-100000`]);
    const chiTruoc = await snap(k.lead!.id);
    const kq = await chay(g.id, B.empId);
    expect(kq).toMatchObject({ ok: true, daChup: 1, boQua: 0, hetLead: true, theoLyDo: { CHU_NGHI_VIEC: 1 } });
    const chiSau = await snap(k.lead!.id);
    expect(JSON.stringify(chiSau.signals), "lead đã chi cho A phải GIỮ bản chụp A").toBe(JSON.stringify(chiTruoc.signals));
    expect(chiSau.updatedAt).toEqual(chiTruoc.updatedAt);
    expect(chiSau.signals).toMatchObject({ nguon: { cuaSoNgay: 90, chuNhanVienId: A.empId } });
    expect((await snap(k2.lead!.id)).signals).toMatchObject({ nguon: { cuaSoNgay: 90, chuNhanVienId: B.empId } });

    // lead 2 (treo): quét lại ⇒ hold nghỉ việc đóng, INPUT_DRIFT, duyệt ⇒ 1% về B.
    const bc = await boiCanh(k, NOW_QUET_LAI);
    await quetKhoan(db, bc, treo.khoan);
    const troi = await holdMo(treo.khoan, "INPUT_DRIFT");
    expect(troi).toHaveLength(1);
    await giaiHangCho(db, bc, { holdId: troi[0]!.id, quyetDinh: "AP_DUNG", lyDo: "Áp dụng chủ mới sau khi chủ cũ nghỉ việc", nguoi: await nguoiKyHo() });
    expect(await holdMo(treo.khoan, "UNRESOLVED_BENEFICIARY")).toHaveLength(0);
    expect(await holdMo(treo.khoan, "INPUT_DRIFT")).toHaveLength(0);
    expect(tomTat(await dongSoCuaKhoan(treo.khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${B.userId}`]: 100_000 });

    // lead 1 (đã chi cho A): sổ giữ nguyên và chụp lại KHÔNG thêm vế «B +100.000» vào chênh lệch — chênh lệch vẫn đúng như trước khi chụp (chỉ A −100.000, do A nghỉ).
    await quetKhoan(db, bc, chi.khoan);
    expect(tomTat(await dongSoCuaKhoan(chi.khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    expect(await chenhCuaHold()).toEqual(chenhTruocChup);

    // chạy lại: không ghi gì; lead 1 vẫn được đếm là «giữ chủ cũ» (để màn hình nói thật), không còn lead nào chờ chụp.
    expect(await chay(g.id, B.empId, { now: D("2027-04-01") })).toMatchObject({ ok: true, daChup: 0, hetLead: true });
    expect(await docCanChupLai(db, g.id)).toMatchObject({ tong: 0, giuChuCu: 1 });
    expect(await demAudit(g.id)).toBe(1);
  });

  it("[CLC-DB-04] chủ đã chụp CÒN HOẠT ĐỘNG không bị đụng (byte-identical); lô trộn chỉ chụp lại dòng của chủ đã nghỉ", async () => {
    // Cấy: bỏ điều kiện trạng thái (coi mọi chủ khác chủ hiện tại là thuộc diện) ⇒ dòng của A (đang làm) bị ghi đè ⇒ đỏ.
    const k = await kb("c4");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const C = await nhanSu(k, "c");
    const g = await taoNhom("C", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED); // chụp A (sẽ còn làm)
    const k2 = await themLead(k, "hai");
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: C.empId } });
    await ghiNguonQuaDuongThat(k2, { nguonChon: chon(g.id) }, ATTRIBUTED, k2.lead!.id); // chụp C (sẽ nghỉ)
    await db.employee.update({ where: { id: C.empId }, data: { status: "TERMINATED" } });
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: B.empId } }); // chủ hiện tại B

    const a = await snap(k.lead!.id);
    const kq = await chay(g.id, B.empId);
    expect(kq).toMatchObject({ ok: true, daChup: 1, theoLyDo: { CHU_NGHI_VIEC: 1 } });
    // Nhật ký ghi chủ cũ THEO TỪNG LEAD, và CHỈ lead được ghi (lead của A còn làm không có mặt) — đối soát / hoàn tác theo lead được.
    const au = await db.auditLog.findFirstOrThrow({ where: { entityType: "LeadSourceGroup", entityId: g.id, action: "NGUON_CHUP_LAI_CHU" } });
    expect(au.oldValues).toEqual({ chuDaChup: { [C.empId]: 1 }, chuCuTheoLead: { [k2.lead!.id]: C.empId } });
    const a2 = await snap(k.lead!.id);
    expect(JSON.stringify(a2.signals)).toBe(JSON.stringify(a.signals)); // A còn làm: KHÔNG đổi
    expect(a2.updatedAt).toEqual(a.updatedAt);
    expect(a2.signals).toMatchObject({ nguon: { chuNhanVienId: A.empId } });
    expect((await snap(k2.lead!.id)).signals).toMatchObject({ nguon: { chuNhanVienId: B.empId } });
    // A vẫn được trả ở khoản mới của lead 1 (không bị hồi tố).
    expect((await thu(k, "x", D("2026-11-22"), NOW_QUET_LAI)).tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
  });

  it("[CLC-DB-05] chạy lại ⇒ 0 dòng, 0 audit mới, updatedAt không nhích", async () => {
    const k = await kb("c5");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("D", { chuEmployeeId: null });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });
    expect(tongDaChup(await chayHet(g.id, A.empId))).toBe(1);
    const sau1 = await snap(k.lead!.id);
    const audit1 = await demAudit(g.id);
    expect(audit1).toBe(1);
    const lai = await chay(g.id, A.empId, { now: D("2027-04-01") });
    expect(lai).toMatchObject({ ok: true, daChup: 0, hetLead: true });
    expect(await demAudit(g.id)).toBe(1);
    const sau2 = await snap(k.lead!.id);
    expect(sau2.updatedAt).toEqual(sau1.updatedAt);
    expect(JSON.stringify(sau2.signals)).toBe(JSON.stringify(sau1.signals));
  });

  it("[CLC-DB-06] cổng: lý do ngắn · chủ lệch người đã thấy · chưa khai chủ · chủ nghỉ · chủ chưa tài khoản · cỡ lô sai ⇒ 0 dòng đổi", async () => {
    // Cấy: bỏ `throw chuDoi` (so chuDuKien) ⇒ ca "chủ lệch" ghi dòng ⇒ đỏ.
    const k = await kb("c6");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("E", { chuEmployeeId: null });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const nguyen = async () => JSON.stringify((await snap(k.lead!.id)).signals) + (await snap(k.lead!.id)).updatedAt.toISOString();
    const goc = await nguyen();

    // chưa khai chủ
    expect(await chay(g.id, A.empId)).toMatchObject({ ok: false, truong: "chuKhongHopLe" });
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });
    // lý do ngắn / rỗng / null
    expect(await chay(g.id, A.empId, { lyDo: "ngắn" })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await chay(g.id, A.empId, { lyDo: "   " })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await chay(g.id, A.empId, { lyDo: null })).toMatchObject({ ok: false, truong: "lyDo" });
    // cỡ lô
    expect(await chay(g.id, A.empId, { coLo: 0 })).toMatchObject({ ok: false, truong: "coLo" });
    expect(await chay(g.id, A.empId, { coLo: 201 })).toMatchObject({ ok: false, truong: "coLo" });
    // chủ đã đổi giữa lúc người bấm nhìn hộp thoại và lúc bấm
    expect(await chay(g.id, B.empId)).toMatchObject({ ok: false, truong: "chuDoi" });
    // nguồn không tồn tại
    expect(await chay("khong-co-nguon", A.empId)).toMatchObject({ ok: false, truong: "khongTimThay" });
    // chủ chưa có tài khoản
    const khongTk = await nhanSuKhongTaiKhoan("a");
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: khongTk.id } });
    expect(await chay(g.id, khongTk.id)).toMatchObject({ ok: false, truong: "chuKhongHopLe" });
    expect(await docCanChupLai(db, g.id)).toMatchObject({ tong: 0, khongChupDuoc: expect.stringContaining("tài khoản") });
    // chủ đã nghỉ
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });
    await db.employee.update({ where: { id: A.empId }, data: { status: "RESIGNED" } });
    expect(await chay(g.id, A.empId)).toMatchObject({ ok: false, truong: "chuKhongHopLe" });

    expect(await nguyen(), "một cổng từ chối mà vẫn đổi dòng").toBe(goc);
    expect(await demAudit(g.id)).toBe(0);
  });

  it("[CLC-DB-07] bản chụp HỎNG · hàng CHƯA có bản chụp · nguồn khác không bị đụng; cuaSoNgay/attributedAt/nhóm giữ nguyên", async () => {
    // Cấy: bỏ `BAN_CHUP_HOP_LE` khỏi câu chọn lô VÀ câu ghi ⇒ dòng HỎNG bị ghi (hoặc jsonb_set vào chuỗi) ⇒ đỏ.
    const k = await kb("c7");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("F", { chuEmployeeId: null });
    const g2 = await taoNhom("G", { chuEmployeeId: null });
    const tot = await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const kHong = await themLead(k, "hong");
    await ghiNguonQuaDuongThat(kHong, { nguonChon: chon(g.id) }, ATTRIBUTED, kHong.lead!.id);
    await db.leadAttribution.update({ where: { leadId: kHong.lead!.id }, data: { signals: { nguon: { cuaSoNgay: "chín mươi", chuNhanVienId: null } } } });
    const kCu = await themLead(k, "cu");
    await ghiNguonQuaDuongThat(kCu, { nguonChon: chon(g.id) }, ATTRIBUTED, kCu.lead!.id);
    await db.leadAttribution.update({ where: { leadId: kCu.lead!.id }, data: { signals: { duongVao: "nhap-tay" } } });
    const kKhac = await themLead(k, "khac");
    await ghiNguonQuaDuongThat(kKhac, { nguonChon: chon(g2.id) }, ATTRIBUTED, kKhac.lead!.id);
    await db.leadAttribution.update({ where: { leadId: kHong.lead!.id }, data: { changeReason: null } });
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });

    const luu = async (l: KichBan) => JSON.stringify(await snap(l.lead!.id));
    const [hong0, cu0, khac0] = [await luu(kHong), await luu(kCu), await luu(kKhac)];
    // cửa sổ riêng 45 ngày ở dòng tốt: phải GIỮ 45 (đổi cửa sổ là hồi tố)
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: { duongVao: "x", nguon: { cuaSoNgay: 45, chuNhanVienId: null } } } });
    const tot0 = await snap(k.lead!.id);
    const kq = await chay(g.id, A.empId);
    expect(kq).toMatchObject({ ok: true, daChup: 1, boQua: 0, hetLead: true });
    const tot1 = await snap(k.lead!.id);
    expect(tot1.signals).toEqual({ duongVao: "x", nguon: { cuaSoNgay: 45, chuNhanVienId: A.empId } }); // khoá khác trong signals + cửa sổ giữ nguyên
    expect(tot1.attributedAt).toEqual(tot0.attributedAt);
    expect(tot1.groupId).toBe(tot.groupId);
    expect([await luu(kHong), await luu(kCu), await luu(kKhac)]).toEqual([hong0, cu0, khac0]);
  });

  it("[CLC-DB-08] 450 lead: chia lô theo con trỏ, mỗi lô dưới trần 5s; hai người bấm cùng lúc không ghi hai lần", async () => {
    // Cấy: bỏ `pg_advisory_xact_lock` ⇒ hai vòng song song cùng chọn một lô (FOR UPDATE tuần tự hoá dòng nhưng tổng daChup vẫn phải = 450) — ca này ghim tổng; cấy bỏ `AND ${sau}` ⇒ đỏ ở ca con trỏ.
    const k = await kb("c8");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b"); // chủ HOẠT ĐỘNG: 150 dòng của B không thuộc diện
    const g = await taoNhom("H", { chuEmployeeId: A.empId });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED); // lead mẫu (để có `groupId` hợp lệ cho FK)
    const SO = 450;
    const khoaLead = `CLC-BULK-${Date.now().toString(36)}`;
    await db.lead.createMany({
      data: Array.from({ length: SO }, (_, i) => ({ id: `${khoaLead}-${i}`, parentName: khoaLead, phone: `08${String(i).padStart(8, "0")}`, status: "DA_DANG_KY" as const, centerId: k.centerId })),
    });
    await db.leadAttribution.createMany({
      data: Array.from({ length: SO }, (_, i) => ({
        leadId: `${khoaLead}-${i}`,
        groupId: g.id,
        originalGroupId: g.id,
        identificationMethod: "PAGE_MAPPING" as const,
        matchedRule: "FIXTURE",
        reasonText: "fixture bulk",
        attributedAt: ATTRIBUTED,
        // 300 dòng thiếu chủ (diện) · 150 dòng chủ B còn làm (ngoài diện)
        signals: { nguon: { cuaSoNgay: 90, chuNhanVienId: i % 3 === 0 ? B.empId : null } },
      })),
    });
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });
    expect((await docCanChupLai(db, g.id))!.tong).toBe(300);

    // con trỏ: đưa vào id của dòng thứ 100 ⇒ các dòng id nhỏ hơn KHÔNG bị đụng
    const idsSapXep = (await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "LeadAttribution" WHERE "groupId" = ${g.id} ORDER BY "id"`)).map((r) => r.id);
    const moc = idsSapXep[100]!;
    const truoc = await db.leadAttribution.findMany({ where: { groupId: g.id, id: { lte: moc } }, select: { id: true, signals: true, updatedAt: true } });
    const thu1 = await chay(g.id, A.empId, { conTro: moc, coLo: 50 });
    expect(thu1).toMatchObject({ ok: true });
    expect(await db.leadAttribution.findMany({ where: { groupId: g.id, id: { lte: moc } }, select: { id: true, signals: true, updatedAt: true } })).toEqual(truoc);
    if (thu1.ok) {
      expect(thu1.daChup).toBeGreaterThan(0);
      expect(thu1.conTro! > moc).toBe(true);
    }
    // phần còn lại + phần trước con trỏ chạy bằng vòng đầy đủ
    const danhLo: number[] = [];
    let conTro: string | null = null;
    const lo: KetQuaChupLaiLo[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      const r = await chay(g.id, A.empId, { conTro, coLo: 100 });
      danhLo.push(Date.now() - t0);
      lo.push(r);
      if (!r.ok || r.hetLead) break;
      conTro = r.conTro;
    }
    expect(lo.every((r) => r.ok)).toBe(true);
    // diện đã được ghi đủ: đúng 300 dòng thiếu chủ nay mang A; 150 dòng của B (còn làm) GIỮ B
    const bulk = { leadId: { startsWith: khoaLead } };
    expect(await db.leadAttribution.count({ where: { groupId: g.id, ...bulk, signals: { path: ["nguon", "chuNhanVienId"], equals: A.empId } } })).toBe(300);
    expect(await db.leadAttribution.count({ where: { groupId: g.id, ...bulk, signals: { path: ["nguon", "chuNhanVienId"], equals: B.empId } } })).toBe(150);
    expect((await docCanChupLai(db, g.id))!.tong).toBe(0);
    expect(Math.max(...danhLo), `thời gian từng lô (ms): ${danhLo.join(", ")}`).toBeLessThan(4_000);
    console.info(`[CLC-DB-08] ${SO} lead, ${lo.length} lô tiếp theo, thời gian từng lô (ms): ${danhLo.join(", ")}`);

    // hai người bấm cùng lúc trên diện mới: tổng dòng ghi = đúng số dòng trong diện, không ai ghi hai lần
    await db.$executeRaw(Prisma.sql`UPDATE "LeadAttribution" SET "signals" = jsonb_set("signals", '{nguon,chuNhanVienId}', 'null'::jsonb) WHERE "groupId" = ${g.id} AND "leadId" LIKE ${khoaLead + "-%"} AND ("signals"->'nguon'->>'chuNhanVienId') = ${A.empId}`);
    const dien = (await docCanChupLai(db, g.id))!.tong;
    expect(dien).toBe(300);
    const [x, y] = await Promise.all([chayHet(g.id, A.empId, 100), chayHet(g.id, A.empId, 100)]);
    expect(tongDaChup(x) + tongDaChup(y)).toBe(dien);
    expect((await docCanChupLai(db, g.id))!.tong).toBe(0);
  });

  it("[CLC-DB-09] audit mỗi lô mang lý do · chủ mới · số dòng · id; audit lỗi ⇒ cả lô LÙI", async () => {
    // Cấy: đưa `writeAudit` ra NGOÀI `$transaction` (hoặc nuốt lỗi) ⇒ dòng đã đổi mà audit lỗi ⇒ đỏ ở ca "audit lỗi".
    const k = await kb("c9");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("I", { chuEmployeeId: null });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });
    const goc = JSON.stringify((await snap(k.lead!.id)).signals);

    // Bẫy: trigger làm CHÍNH lần ghi audit của chụp lại nổ ⇒ phải lùi cả UPDATE.
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS clc_audit_no_trg ON "AuditLog"`); // an toàn khi lần chạy trước bị giết giữa chừng (luật 18)
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION clc_audit_no() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'NGUON_CHUP_LAI_CHU' THEN RAISE EXCEPTION 'clc audit no'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER clc_audit_no_trg BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION clc_audit_no()`);
    donSau.push(async () => {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS clc_audit_no_trg ON "AuditLog"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS clc_audit_no()`);
    });
    try {
      await expect(chay(g.id, A.empId)).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS clc_audit_no_trg ON "AuditLog"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS clc_audit_no()`);
    }
    expect(JSON.stringify((await snap(k.lead!.id)).signals), "audit lỗi mà dòng vẫn đổi").toBe(goc);

    const kq = await chay(g.id, A.empId);
    expect(kq).toMatchObject({ ok: true, daChup: 1 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "LeadSourceGroup", entityId: g.id, action: "NGUON_CHUP_LAI_CHU" } });
    expect(audit.reason).toBe(LY_DO);
    expect(audit.actorId).toBe(nguoiGhi);
    expect(audit.module).toBe("nguon-hoa-hong");
    expect(audit.newValues).toMatchObject({ chuNhanVienId: A.empId, soLead: 1, theoLyDo: { THIEU_CHU: 1 } });
    // Chủ cũ THEO TỪNG LEAD (fin3 R5 M2): để đối soát / hoàn tác theo lead được, không chỉ đếm gộp theo chủ cũ.
    expect(audit.oldValues).toEqual({ chuDaChup: { "(chưa có chủ)": 1 }, chuCuTheoLead: { [k.lead!.id]: null } });
    const att = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id }, select: { id: true } });
    expect((audit.newValues as { leadAttributionIds: string[] }).leadAttributionIds).toEqual([att.id]);
  });

  it("[CLC-DB-11] «đã chi cho chủ cũ» = khoản SOURCE_OWNER còn hiệu lực: hoàn tiền TRỌN thì không còn là đã chi (lead vào diện); hoàn MỘT PHẦN thì vẫn giữ chủ cũ", async () => {
    // Cấy: tính «đã chi» theo `count(*) > 0` thay vì Σ ròng ≠ 0 ⇒ lead đã hoàn trọn vẫn bị giữ ⇒ đỏ.
    const k = await kb("c11");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("L", { chuEmployeeId: A.empId });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    const hoanTrong = await thu(k, "a", D("2026-11-20"));
    expect(hoanTrong.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });
    const k2 = await themLead(k, "hai");
    await ghiNguonQuaDuongThat(k2, { nguonChon: chon(g.id) }, ATTRIBUTED, k2.lead!.id);
    const hoanMotPhan = await thu(k2, "b", D("2026-11-21"));
    expect(hoanMotPhan.tom).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${A.userId}`]: 100_000 });

    // Hoàn TRỌN khoản của lead 1 (sổ: +100.000 rồi −100.000 ⇒ Σ ròng 0); hoàn 4.000.000/10.000.000 của lead 2 (Σ ròng còn dương).
    const bc = await boiCanh(k, NOW);
    const hoan1 = await hoanTien(k, hoanTrong.khoan, { soTien: 10_000_000, ngay: D("2026-12-01") });
    expect((await quetKhoan(db, bc, hoan1)).loai).toBe("DA_DAO");
    const hoan2 = await hoanTien(k2, hoanMotPhan.khoan, { soTien: 4_000_000, ngay: D("2026-12-01") });
    expect((await quetKhoan(db, bc, hoan2)).loai).toBe("DA_DAO");
    const rong = async (leadId: string) => {
      const r = await db.$queryRaw<{ s: bigint | null }[]>(Prisma.sql`
        SELECT sum(ct."amount")::bigint AS s FROM "CommissionTransaction" ct JOIN "LeadAttribution" la ON la."id" = ct."attributionId"
        WHERE la."leadId" = ${leadId} AND ct."resolverType" = 'SOURCE_OWNER'`);
      return Number(r[0]?.s ?? 0);
    };
    expect(await rong(k.lead!.id), "đối chứng: hoàn trọn ⇒ Σ ròng 0").toBe(0);
    expect(await rong(k2.lead!.id), "đối chứng: hoàn một phần ⇒ Σ ròng còn dương").toBeGreaterThan(0);

    await db.employee.update({ where: { id: A.empId }, data: { status: "RESIGNED" } });
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: B.empId } });
    expect(await docCanChupLai(db, g.id)).toMatchObject({ tong: 1, giuChuCu: 1, theoLyDo: { CHU_NGHI_VIEC: 1 } });
    expect(await chay(g.id, B.empId)).toMatchObject({ ok: true, daChup: 1, hetLead: true });
    expect((await snap(k.lead!.id)).signals, "lead hoàn trọn ⇒ không còn khoản chi ⇒ chụp lại sang B").toMatchObject({ nguon: { chuNhanVienId: B.empId } });
    expect((await snap(k2.lead!.id)).signals, "lead hoàn một phần ⇒ vẫn còn khoản chi cho A ⇒ GIỮ A").toMatchObject({ nguon: { chuNhanVienId: A.empId } });
    // Phép GHI tự kiểm lại ngay trong WHERE: dù người gọi đưa id của lead đã chi cho A vào, dòng không bị ghi (chọn lô và ghi KHÔNG tin nhau).
    const idGiu = (await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k2.lead!.id }, select: { id: true } })).id;
    const truocGiu = JSON.stringify(await snap(k2.lead!.id));
    expect(await db.$transaction((tx) => ghiChuNguonChupLo(tx, { nguonId: g.id, ids: [idGiu], chuMoi: B.empId, thieuChu: false, chuKhongConHieuLuc: [A.empId], now: NOW_CHUP }))).toEqual([]);
    expect(JSON.stringify(await snap(k2.lead!.id)), "ghi qua id của lead đã chi cho chủ cũ").toBe(truocGiu);
  });

  // ── Khoá: hai ca dưới đây trả lời «bỏ khoá thì ca nào đỏ?» (fin3 R5 M3 — các phép cấy N2/N3 từng làm 0 ca đỏ). Mỗi ca GIỮ khoá bằng một kết nối thứ hai rồi chứng minh lượt chụp lại PHẢI chờ.
  /** Giữ một transaction MỞ (đã làm `viec`, chưa commit) cho tới khi gọi `tha()`. Nhả luôn nằm trong `finally` của ca gọi. */
  async function giuGiaoDich(viec: (tx: Prisma.TransactionClient) => Promise<void>) {
    let tha!: () => void;
    let daGiu!: () => void;
    let hong!: (e: unknown) => void;
    const chaGiu = new Promise<void>((res, rej) => {
      daGiu = res;
      hong = rej;
    });
    const chaTha = new Promise<void>((r) => (tha = r));
    const xong = db.$transaction(
      async (tx) => {
        try {
          await viec(tx);
          daGiu();
        } catch (e) {
          hong(e);
          throw e;
        }
        await chaTha;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    xong.catch(() => undefined); // lỗi (nếu có) đã đi qua `chaGiu`; tránh unhandled rejection
    await chaGiu;
    return { tha, xong };
  }
  /** Chờ tới khi CÓ phiên đang đứng chờ một khoá (advisory · hàng · transactionid) — xác định, không phụ thuộc đồng hồ. Quá 8 giây không thấy ⇒ ném: lượt chụp lại KHÔNG chờ gì. */
  async function doiCoPhienChoKhoa(): Promise<void> {
    for (let i = 0; i < 80; i++) {
      const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (Number(r[0]?.n ?? 0) > 0) return;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error("không thấy phiên nào đang chờ khoá — lượt chụp lại không bị chặn bởi khoá được giữ");
  }
  const daXong = async <T,>(p: Promise<T>): Promise<boolean> => {
    let xong = false;
    void p.then(
      () => (xong = true),
      () => (xong = true),
    );
    await new Promise((r) => setTimeout(r, 400));
    return xong;
  };

  it("[CLC-DB-12] khoá hàng nguồn (FOR SHARE): người khác đang đổi chủ nguồn (chưa commit) ⇒ chụp lại CHỜ, rồi thấy chủ mới và từ chối (chuDoi); không ghi dòng nào bằng chủ cũ", async () => {
    // Cấy: bỏ `FOR SHARE` ở `LeadSourceGroup` ⇒ lượt chụp lại đọc chủ cũ B (bản đã commit), không chờ, chụp lead sang B rồi chủ đổi sang C ⇒ lead mang chủ KHÔNG còn là chủ nguồn ⇒ đỏ.
    const k = await kb("c12");
    const B = await nhanSu(k, "b");
    const C = await nhanSu(k, "c");
    const g = await taoNhom("M", { chuEmployeeId: null });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: B.empId } });
    const goc = JSON.stringify(await snap(k.lead!.id));
    const giu = await giuGiaoDich(async (tx) => {
      await tx.$executeRaw`UPDATE "LeadSourceGroup" SET "ownerEmployeeId" = ${C.empId} WHERE "id" = ${g.id}`;
    });
    let p: Promise<unknown> | undefined;
    try {
      p = chay(g.id, B.empId);
      await doiCoPhienChoKhoa();
      expect(await daXong(p), "lượt chụp lại phải CHỜ khoá hàng nguồn").toBe(false);
    } finally {
      giu.tha();
      await giu.xong;
    }
    expect(await p).toMatchObject({ ok: false, truong: "chuDoi" });
    expect(JSON.stringify(await snap(k.lead!.id)), "chủ đổi giữa chừng mà dòng vẫn bị ghi").toBe(goc);
    expect(await demAudit(g.id)).toBe(0);
  });

  it("[CLC-DB-13] khoá advisory theo nguồn: khi khoá đang bị giữ, chụp lại CHỜ; nhả ra mới chạy và ghi đúng một lần", async () => {
    // Cấy: bỏ `pg_advisory_xact_lock` ⇒ lượt chụp lại không chờ ai (FOR SHARE không chạm khoá advisory) ⇒ chạy ngay ⇒ đỏ.
    const k = await kb("c13");
    const A = await nhanSu(k, "a");
    const g = await taoNhom("N", { chuEmployeeId: null });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED);
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { ownerEmployeeId: A.empId } });
    const giu = await giuGiaoDich(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${khoaChupLaiTheoNguon(g.id)}, 0))`;
    });
    let p: Promise<unknown> | undefined;
    try {
      p = chay(g.id, A.empId);
      await doiCoPhienChoKhoa();
      expect(await daXong(p), "lượt chụp lại phải CHỜ khoá advisory của nguồn").toBe(false);
      expect((await snap(k.lead!.id)).signals, "chờ khoá mà dòng đã đổi").toMatchObject({ nguon: { chuNhanVienId: null } });
    } finally {
      giu.tha();
      await giu.xong;
    }
    expect(await p).toMatchObject({ ok: true, daChup: 1, hetLead: true });
    expect(await demAudit(g.id)).toBe(1);
    // khoá của nguồn KHÁC không chặn: đối chứng dương cho chuỗi khoá (khoá theo nguồn, không phải khoá toàn cục)
    const g2 = await taoNhom("O", { chuEmployeeId: null });
    const giu2 = await giuGiaoDich(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${khoaChupLaiTheoNguon(g2.id)}, 0))`;
    });
    try {
      expect(await daXong(chay(g.id, A.empId)), "khoá của nguồn khác không được chặn nguồn này").toBe(true);
    } finally {
      giu2.tha();
      await giu2.xong;
    }
  });

  it("[CLC-DB-10] ghiChuNguonChupLo tự kiểm lại điều kiện trong WHERE: id của dòng KHÔNG thuộc diện bị bỏ qua dù người gọi đưa vào", async () => {
    // Cấy: bỏ `AND dieuKienTheoChu(...)` khỏi UPDATE ⇒ dòng chủ còn làm bị ghi đè ⇒ đỏ.
    const k = await kb("c10");
    const A = await nhanSu(k, "a");
    const B = await nhanSu(k, "b");
    const g = await taoNhom("J", { chuEmployeeId: B.empId });
    await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, ATTRIBUTED); // chụp B (còn làm)
    const kThieu = await themLead(k, "thieu");
    await ghiNguonQuaDuongThat(kThieu, { nguonChon: chon(g.id) }, ATTRIBUTED, kThieu.lead!.id);
    await db.leadAttribution.update({ where: { leadId: kThieu.lead!.id }, data: { signals: { nguon: { cuaSoNgay: 90, chuNhanVienId: null } } } });
    const idB = (await db.leadAttribution.findUniqueOrThrow({ where: { leadId: k.lead!.id }, select: { id: true } })).id;
    const idThieu = (await db.leadAttribution.findUniqueOrThrow({ where: { leadId: kThieu.lead!.id }, select: { id: true } })).id;
    const truocB = JSON.stringify((await snap(k.lead!.id)).signals);

    const ghi = await db.$transaction((tx) => ghiChuNguonChupLo(tx, { nguonId: g.id, ids: [idB, idThieu], chuMoi: A.empId, thieuChu: true, chuKhongConHieuLuc: [], now: NOW_CHUP }));
    expect(ghi).toEqual([idThieu]);
    expect(JSON.stringify((await snap(k.lead!.id)).signals)).toBe(truocB);
    // sai nguồn: id của dòng thuộc nguồn KHÁC ⇒ 0 dòng. Dòng này CÒN thuộc diện (bản chụp `null`, đúng hình dạng) nên nó là dòng DUY NHẤT thoả mọi điều kiện còn lại — bỏ `"groupId" = nguonId`
    // khỏi WHERE là dòng bị ghi (fin3 R5 LOW1: bản cũ dùng `idThieu` vừa được ghi ở trên, tức đã RA KHỎI diện, nên bỏ điều kiện nhóm không làm ca nào đỏ).
    const g2 = await taoNhom("K", { chuEmployeeId: null });
    const kKhac = await themLead(k, "khac");
    await ghiNguonQuaDuongThat(kKhac, { nguonChon: chon(g2.id) }, ATTRIBUTED, kKhac.lead!.id);
    const idKhac = (await db.leadAttribution.findUniqueOrThrow({ where: { leadId: kKhac.lead!.id }, select: { id: true } })).id;
    expect((await snap(kKhac.lead!.id)).signals, "đối chứng: dòng nguồn khác còn trong diện (chụp null)").toMatchObject({ nguon: { chuNhanVienId: null } });
    const truocKhac = JSON.stringify(await snap(kKhac.lead!.id));
    expect(await db.$transaction((tx) => ghiChuNguonChupLo(tx, { nguonId: g.id, ids: [idKhac], chuMoi: A.empId, thieuChu: true, chuKhongConHieuLuc: [], now: NOW_CHUP }))).toEqual([]);
    expect(JSON.stringify(await snap(kKhac.lead!.id)), "id của nguồn khác bị ghi qua nguồn này").toBe(truocKhac);
    // đối chứng dương: đúng nguồn của dòng ấy ⇒ ghi
    expect(await db.$transaction((tx) => ghiChuNguonChupLo(tx, { nguonId: g2.id, ids: [idKhac], chuMoi: A.empId, thieuChu: true, chuKhongConHieuLuc: [], now: NOW_CHUP }))).toEqual([idKhac]);
    // không có vế nào ⇒ KHÔNG BAO GIỜ rơi về «mọi dòng»
    expect(await db.$transaction((tx) => ghiChuNguonChupLo(tx, { nguonId: g.id, ids: [idB, idThieu], chuMoi: A.empId, thieuChu: false, chuKhongConHieuLuc: [], now: NOW_CHUP }))).toEqual([]);
  });
});
