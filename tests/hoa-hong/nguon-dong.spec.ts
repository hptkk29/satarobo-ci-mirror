// @vitest-environment node
/**
 * [DYN-DB-*] — NGUỒN ĐỘNG trên ENGINE HOA HỒNG (Postgres THẬT; dòng tiền dựng bằng hàm ghi thật như `so-luong-nguon.spec.ts`).
 * Mọi nguồn trong bộ này do TEST TẠO (mã `DYN_*`, không nằm trong 9 mã gốc) — chứng minh nguồn thứ 10 chạy chỉ bằng DỮ LIỆU:
 *
 *   [DYN-DB-01] cửa sổ ghi công THEO NGUỒN: 60 / NULL(=setting 90) / 120 ngày trên cùng khoản ngày thứ 75; biên ngày 60/61; quá hạn GIỮ nguồn, 0 hold
 *   [DYN-DB-02] `commissionEnabled`: false ⇒ chính sách riêng của nguồn BẤT HOẠT (chính sách chung vẫn chạy); true ⇒ chạy
 *   [DYN-DB-03] vai REFERRER_PARENT_SALE: hưởng = ẢNH CHỤP Sale phụ trách PH (không phải người chốt đơn); thiếu ⇒ HOLD nhìn thấy; Sale nghỉ ⇒ HOLD
 *   [DYN-DB-04] vai SOURCE_OWNER: hưởng = người phụ trách NGUỒN; chưa khai ⇒ HOLD; chủ nghỉ việc ⇒ HOLD
 *   [DYN-DB-05] CHUỖI THẬT: tra Sale của PH (hàm đọc thật) → ghi nguồn → PH đổi Sale → engine vẫn trả Sale CŨ
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng; nguồn `DYN_*` dọn ở afterAll. LUẬT 19: ngày tuyệt đối.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docSaleCuaPhuHuynh } from "../../lib/nguon/anh-chup-db";
import { clearSettingsCache } from "../../lib/settings/service";
import { damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
import {
  boiCanh,
  D,
  datMocCutover,
  dongSoCuaKhoan,
  donKichBan,
  dungBe,
  dungKichBan,
  ganNguon,
  lamNhanVien,
  themChinhSachNhom,
  tienVe,
  tomTat,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[DYN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.04 }] });
  cuaToi.push(k);
  return k;
}

type TuyChonNhom = { req?: "NONE" | "PARENT" | "EMPLOYEE"; cuaSo?: number | null; coHoaHong?: boolean; chuEmployeeId?: string | null };
let demNhom = 0;
async function taoNhom(hau: string, o: TuyChonNhom = {}) {
  demNhom += 1;
  return db.leadSourceGroup.create({
    data: {
      code: `DYN_${hau}_${Date.now().toString(36)}${demNhom}`.toUpperCase(),
      name: `DYN ${hau}`,
      referrerRequirement: o.req ?? "PARENT",
      sortOrder: 300 + demNhom,
      commissionEnabled: o.coHoaHong ?? true,
      attributionWindowDays: o.cuaSo ?? null,
      ownerEmployeeId: o.chuEmployeeId ?? null,
    },
    select: { id: true, code: true },
  });
}

async function phuHuynh(k: KichBan, hau: string) {
  return seedUser({ email: `${k.ma}-ph${hau}@ci.test`, role: "PARENT", name: `${k.ma}-ph${hau}`, phone: null });
}

describe.skipIf(!RUN_DB_TESTS)("[DYN-DB] nguồn động trên engine hoa hồng", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await damBaoDanhMucGoc(db); // cần UNKNOWN + 8 nguồn mặc định (luật 18: không mượn danh mục do bộ trước để lại)
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "DYN_" } } });
    await datMocCutover(null);
  }, 60_000);

  it("[DYN-DB-01] cửa sổ ghi công THEO NGUỒN: cùng một khoản ngày thứ 75 — nguồn 60 ngày KHÔNG có hoa hồng thu hút, nguồn NULL (setting 90) và 120 ngày CÓ; biên ngày 60 còn / 61 hết; nguồn GIỮ nguyên, 0 hold", async () => {
    // Cấy: engine đọc `bc.cuaSoNgay` thay cho cửa sổ của nguồn ⇒ ca nguồn-60 có tiền (đỏ).
    const attributedAt = new Date("2026-10-01T03:00:00.000Z"); // ngày thứ 75 = 15/12, ngày 60 = 30/11
    const ca = async (hau: string, cuaSo: number | null, ngay: Date) => {
      const k = await kb(`win${hau}`);
      const g = await taoNhom(`W${hau}`, { cuaSo });
      const ph = await phuHuynh(k, "a");
      await themChinhSachNhom(k, g.code, [{ vai: "REFERRER_PARENT", rate: 0.02 }]);
      await ganNguon(k, g.code, { phHuynhUserId: ph.id, attributedAt });
      const bc = await boiCanh(k, NOW);
      const khoan = await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay });
      await quetKhoan(db, bc, khoan);
      return { k, ph, khoan, tom: tomTat(await dongSoCuaKhoan(khoan)) };
    };
    const ngay75 = new Date("2026-12-15T03:00:00.000Z");
    const a60 = await ca("60", 60, ngay75);
    expect(a60.tom).toEqual({ [`SALE:${a60.k.sale.id}`]: 400_000 }); // KHÔNG REFERRER_PARENT: ngoài cửa sổ 60
    const aNull = await ca("nu", null, ngay75);
    expect(aNull.tom).toEqual({ [`SALE:${aNull.k.sale.id}`]: 400_000, [`REFERRER_PARENT:${aNull.ph.id}`]: 200_000 }); // NULL ⇒ setting 90
    const a120 = await ca("120", 120, ngay75);
    expect(a120.tom).toEqual({ [`SALE:${a120.k.sale.id}`]: 400_000, [`REFERRER_PARENT:${a120.ph.id}`]: 200_000 });
    // biên ngày 60 (23:59 VN 30/11) còn trong; ngày 61 (00:01 VN 01/12) ngoài
    const b60 = await ca("b60", 60, new Date("2026-11-30T16:59:00.000Z"));
    expect(Object.keys(b60.tom).some((x) => x.startsWith("REFERRER_PARENT:"))).toBe(true);
    const b61 = await ca("b61", 60, new Date("2026-11-30T17:01:00.000Z"));
    expect(Object.keys(b61.tom).some((x) => x.startsWith("REFERRER_PARENT:"))).toBe(false);
    // quá hạn GIỮ nguồn (không đổi sang nhóm khác) và không để lại hàng chờ
    const nguon = await db.lead.findUniqueOrThrow({ where: { id: a60.k.lead!.id }, select: { attribution: { select: { group: { select: { code: true } } } } } });
    expect(nguon.attribution?.group.code.startsWith("DYN_W60")).toBe(true);
    expect(await db.commissionHold.count({ where: { paymentId: a60.khoan } })).toBe(0);
  });

  it("[DYN-DB-02] commissionEnabled: nguồn cờ FALSE ⇒ chính sách riêng của nó BẤT HOẠT (Sale chung 4% vẫn chạy, KHÔNG có REFERRER_PARENT); cờ TRUE ⇒ chạy; bật cờ sau đó ⇒ lượt quét kế tiếp CÓ tiền", async () => {
    const attributedAt = new Date("2026-10-01T03:00:00.000Z");
    const ca = async (hau: string, coHoaHong: boolean) => {
      const k = await kb(`ce${hau}`);
      const g = await taoNhom(`CE${hau}`, { coHoaHong });
      const ph = await phuHuynh(k, "a");
      await themChinhSachNhom(k, g.code, [{ vai: "REFERRER_PARENT", rate: 0.02 }]);
      await ganNguon(k, g.code, { phHuynhUserId: ph.id, attributedAt });
      return { k, g, ph };
    };
    const tat = await ca("0", false);
    const bc0 = await boiCanh(tat.k, NOW);
    const k0 = await tienVe(tat.k, await dungBe(tat.k, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc0, k0);
    expect(tomTat(await dongSoCuaKhoan(k0))).toEqual({ [`SALE:${tat.k.sale.id}`]: 400_000 });

    const bat = await ca("1", true);
    const bc1 = await boiCanh(bat.k, NOW);
    const k1 = await tienVe(bat.k, await dungBe(bat.k, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc1, k1);
    expect(tomTat(await dongSoCuaKhoan(k1))).toEqual({ [`SALE:${bat.k.sale.id}`]: 400_000, [`REFERRER_PARENT:${bat.ph.id}`]: 200_000 });

    // bật cờ cho nguồn đang tắt ⇒ khoản MỚI của nguồn đó có tiền (bối cảnh dựng lại — cờ đọc từ master, không từ ảnh chụp cũ)
    await db.leadSourceGroup.update({ where: { id: tat.g.id }, data: { commissionEnabled: true } });
    const bc0b = await boiCanh(tat.k, NOW);
    const k0b = await tienVe(tat.k, await dungBe(tat.k, "b"), { soTien: 10_000_000, ngay: D("2026-11-21") });
    await quetKhoan(db, bc0b, k0b);
    expect(tomTat(await dongSoCuaKhoan(k0b))).toEqual({ [`SALE:${tat.k.sale.id}`]: 400_000, [`REFERRER_PARENT:${tat.ph.id}`]: 200_000 });
  });

  it("[DYN-DB-03] REFERRER_PARENT_SALE: hưởng = ảnh chụp Sale phụ trách PH (KHÔNG phải người chốt đơn); thiếu ảnh chụp ⇒ HOLD nhìn thấy (THIEU_SALE_PHU_HUYNH), không tiền cho ai; Sale nghỉ việc ⇒ HOLD NGUOI_HUONG_NGHI", async () => {
    const attributedAt = new Date("2026-10-01T03:00:00.000Z");
    const k = await kb("rps");
    const g = await taoNhom("RPS");
    const ph = await phuHuynh(k, "a");
    const saleX = await seedUser({ email: `${k.ma}-salex@ci.test`, role: "SALES_CSM", name: `${k.ma}-salex`, phone: null });
    await themChinhSachNhom(k, g.code, [{ vai: "REFERRER_PARENT_SALE", rate: 0.02 }]);
    await ganNguon(k, g.code, { phHuynhUserId: ph.id, attributedAt, saleUserId: saleX.id });
    const bc = await boiCanh(k, NOW);
    const co = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc, co);
    expect(tomTat(await dongSoCuaKhoan(co))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT_SALE:${saleX.id}`]: 200_000 });

    // Sale nghỉ việc ⇒ phần của họ TREO (D13) — không chuyển cho ai
    const saleXEmp = await lamNhanVien(saleX.id, "rps");
    await db.employee.update({ where: { id: saleXEmp }, data: { status: "RESIGNED" } });
    const nghi = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-11-21") });
    await quetKhoan(db, bc, nghi);
    expect(tomTat(await dongSoCuaKhoan(nghi))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: nghi } })).detail).toMatchObject({ vai: "REFERRER_PARENT_SALE", lyDo: "NGUOI_HUONG_NGHI" });

    // thiếu ảnh chụp (PH giới thiệu nhưng không tìm được Sale lúc ghi nhận) ⇒ HOLD, KHÔNG tự gán Sale đang chốt đơn
    const k2 = await kb("rps2");
    const ph2 = await phuHuynh(k2, "a");
    await themChinhSachNhom(k2, g.code, [{ vai: "REFERRER_PARENT_SALE", rate: 0.02 }]);
    await ganNguon(k2, g.code, { phHuynhUserId: ph2.id, attributedAt });
    const bc2 = await boiCanh(k2, NOW);
    const thieu = await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc2, thieu);
    expect(tomTat(await dongSoCuaKhoan(thieu))).toEqual({ [`SALE:${k2.sale.id}`]: 400_000 }); // Sale chốt đơn vẫn nhận 4% của mình, KHÔNG nhận thêm 2%
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: thieu } })).detail).toMatchObject({ vai: "REFERRER_PARENT_SALE", lyDo: "THIEU_SALE_PHU_HUYNH" });
  });

  it("[DYN-DB-04] SOURCE_OWNER: hưởng = User của nhân sự phụ trách NGUỒN; nguồn chưa khai chủ ⇒ HOLD NGUON_CHUA_CO_NGUOI_PHU_TRACH; chủ nghỉ việc ⇒ HOLD NGUOI_HUONG_NGHI", async () => {
    const attributedAt = new Date("2026-10-01T03:00:00.000Z");
    const k = await kb("own");
    const chu = await seedUser({ email: `${k.ma}-chu@ci.test`, role: "SALES_CSM", name: `${k.ma}-chu`, phone: null });
    const chuEmp = await lamNhanVien(chu.id, "own");
    const g = await taoNhom("OWN", { req: "NONE", chuEmployeeId: chuEmp });
    await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ganNguon(k, g.code, { attributedAt });
    const bc = await boiCanh(k, NOW);
    const co = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc, co);
    expect(tomTat(await dongSoCuaKhoan(co))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`SOURCE_OWNER:${chu.id}`]: 100_000 });

    await db.employee.update({ where: { id: chuEmp }, data: { status: "RESIGNED" } });
    const nghi = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-11-21") });
    await quetKhoan(db, bc, nghi);
    expect(tomTat(await dongSoCuaKhoan(nghi))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: nghi } })).detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUOI_HUONG_NGHI" });

    // nguồn CHƯA khai người phụ trách
    const k2 = await kb("own2");
    const gKhong = await taoNhom("OWN0", { req: "NONE", chuEmployeeId: null });
    await themChinhSachNhom(k2, gKhong.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    await ganNguon(k2, gKhong.code, { attributedAt });
    const bc2 = await boiCanh(k2, NOW);
    const khong = await tienVe(k2, await dungBe(k2, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc2, khong);
    expect(tomTat(await dongSoCuaKhoan(khong))).toEqual({ [`SALE:${k2.sale.id}`]: 400_000 });
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: khong } })).detail).toMatchObject({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });
  });

  it("[DYN-DB-05] CHUỖI THẬT: hàm tra Sale của PH (đọc Student → lead gốc) → ghi nguồn → PH chuyển sang Sale Y → engine VẪN trả hoa hồng acquisition về Sale X của lúc ghi nhận", async () => {
    const attributedAt = new Date("2026-10-01T03:00:00.000Z");
    const k = await kb("chain");
    const g = await taoNhom("CHAIN");
    const ph = await phuHuynh(k, "a");
    const saleX = await seedUser({ email: `${k.ma}-sx@ci.test`, role: "SALES_CSM", name: `${k.ma}-sx`, phone: null });
    const saleY = await seedUser({ email: `${k.ma}-sy@ci.test`, role: "SALES_CSM", name: `${k.ma}-sy`, phone: null });
    const leadGoc = await db.lead.create({ data: { parentName: `${k.ma}-goc`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "DA_DANG_KY", convertedById: saleX.id, centerId: k.centerId, createdAt: D("2026-09-01") } }); // ngày TUYỆT ĐỐI (luật 19): lead tạo "bây giờ" sẽ nằm SAU thời điểm ghi nhận
    const hv = await db.student.create({ data: { id: `${k.ma}-hvph`, name: `Bé PH ${k.ma}`, centerId: k.centerId, parentUserId: ph.id, leadId: leadGoc.id } });
    await themChinhSachNhom(k, g.code, [{ vai: "REFERRER_PARENT_SALE", rate: 0.02 }]);

    const saleLucDo = await docSaleCuaPhuHuynh(db, { studentId: hv.id, parentUserId: ph.id }, D("2026-10-01"));
    expect(saleLucDo).toBe(saleX.id);
    await ganNguon(k, g.code, { phHuynhUserId: ph.id, attributedAt, saleUserId: saleLucDo ?? undefined });

    // PH chuyển sang Sale Y SAU khi nguồn đã ghi
    await db.lead.update({ where: { id: leadGoc.id }, data: { convertedById: saleY.id } });
    expect(await docSaleCuaPhuHuynh(db, { studentId: hv.id, parentUserId: ph.id }, D("2026-11-01"))).toBe(saleY.id); // đối chứng dương: tra LẠI hôm nay ra Y

    const bc = await boiCanh(k, NOW);
    const khoan = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc, khoan);
    expect(tomTat(await dongSoCuaKhoan(khoan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT_SALE:${saleX.id}`]: 200_000 });
  });
});
