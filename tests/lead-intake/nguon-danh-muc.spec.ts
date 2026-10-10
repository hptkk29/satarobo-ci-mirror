import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { docChiTietNguon, docDanhMucNguon } from "../../lib/nguon/doc-danh-muc";
import { clearSettingsCache } from "../../lib/settings/service";
import { damBaoDanhMucGoc, duLieuNguon, type IdNhom } from "./_nguon-fixture";

// =============================================================================
// DANH MỤC NGUỒN + CHI TIẾT NGUỒN (tab Nguồn, chỉ ĐỌC) — Postgres LOCAL thật, scopedDb thật.
//
//   [NHH-FE-DM-01] số lead theo nhóm chỉ đếm lead TRONG tầm nhìn (QLCS A không đếm lead của B); HO đếm cả hai
//   [NHH-FE-DM-02] cửa sổ 30 ngày tính theo `now` truyền vào, biên ĐÚNG (29 ngày vào, 31 ngày ra); lead đã xoá không đếm
//   [NHH-FE-DM-03] lọc theo trạng thái nhóm; chín nhóm gốc (8 nguồn mặc định + UNKNOWN) có mặt, đúng thứ tự `sortOrder`
//   [NHH-FE-DM-04] chi tiết nguồn: nhóm lạ ⇒ null; thống kê tự nhất quán (Σ theo trạng thái = tổng) và cách ly cơ sở
//   [NHH-FE-DM-05] "có người giới thiệu" và "thiếu người" là HAI số khác nhau (fixture 2 ≠ 1, không để 1–1)
//   [NHH-FE-DM-06] Page đã map về nhóm: đúng nhóm, đúng chiến dịch, sắp theo mã Page; nhóm khác không bị lẫn
//   [NHH-FE-DM-07] chip cơ sở LỌC thật: coSoId=A chỉ đếm A, coSoId=B chỉ đếm B, null = cả hai; cơ sở NGOÀI tầm nhìn ⇒ 0
//
// Cách ly: tiền tố `NDM_`, dọn theo tiền tố — KHÔNG resetDb.
// =============================================================================

const RUN = RUN_DB_TESTS;
const P = "NDM_";
const NOW = new Date("2026-10-08T05:00:00.000Z");
const ngayTruoc = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function actorCoSo(centerIds: string[]): Actor {
  return {
    userId: "ndm-actor",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as Actor;
}
const actorHo = (): Actor => ({ ...actorCoSo([]), isHoLevel: true }) as Actor;

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length) await db.lead.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ndm-ph" } } }); // sau khi xoá lead (FK Restrict từ attribution)
  await db.center.deleteMany({ where: { code: { startsWith: "NDM" } } });
}

describe.skipIf(!RUN)("Danh mục + chi tiết nguồn — đọc qua Lead đã scope", () => {
  let nhom: IdNhom;
  let cA = "";
  let cB = "";

  async function lead(ten: string, centerId: string, nhomId: string, p: { tuoi?: number; xoa?: boolean; status?: "MOI" | "DA_DANG_KY"; source?: string; referrerMissing?: boolean; referrerParentUserId?: string; sdt: string }) {
    const l = await db.lead.create({
      data: {
        parentName: `${P}${ten}`,
        phone: p.sdt,
        status: p.status ?? "MOI",
        centerId,
        source: p.source ?? "sale-form",
        createdAt: ngayTruoc(p.tuoi ?? 1),
        ...(p.xoa ? { deletedAt: ngayTruoc(0) } : {}),
      },
    });
    await db.$transaction((tx) =>
      taoNguonBanDau(
        tx,
        l.id,
        duLieuNguon(nhomId, {
          referrerMissing: p.referrerMissing ?? false,
          ...(p.referrerParentUserId ? { referrerKind: "PARENT" as const, referrerParentUserId: p.referrerParentUserId } : {}),
        }),
        null,
      ),
    );
    return l.id;
  }

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cA = (await db.center.create({ data: { code: "NDM-A", name: "NDM A", slug: "ndm-a", address: "a", city: "" } })).id;
    cB = (await db.center.create({ data: { code: "NDM-B", name: "NDM B", slug: "ndm-b", address: "b", city: "" } })).id;
    // Nhóm QUẢNG CÁO: A có 3 (1 ngày · 29 ngày · 31 ngày) + 1 đã xoá; B có 2.
    await lead("A_qc_1", cA, nhom.PAID_ADS, { tuoi: 1, sdt: "0990500001", source: "quatang" });
    await lead("A_qc_29", cA, nhom.PAID_ADS, { tuoi: 29, sdt: "0990500002", source: "quatang", status: "DA_DANG_KY" });
    await lead("A_qc_31", cA, nhom.PAID_ADS, { tuoi: 31, sdt: "0990500003", source: "import" });
    await lead("A_qc_xoa", cA, nhom.PAID_ADS, { tuoi: 2, sdt: "0990500004", xoa: true });
    await lead("B_qc_1", cB, nhom.PAID_ADS, { tuoi: 2, sdt: "0990500005" });
    await lead("B_qc_2", cB, nhom.PAID_ADS, { tuoi: 3, sdt: "0990500006" });
    // Nhóm SALE: A có 1 thiếu người.
    await lead("A_sale", cA, nhom.EMPLOYEE_REFERRAL, { tuoi: 5, sdt: "0990500007", referrerMissing: true });
  }, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  const dong = async (a: Actor, code: string, trangThai = null as null | "ACTIVE" | "INACTIVE") => {
    const r = await docDanhMucNguon(a, { now: NOW, trangThai, coSoId: null });
    return r.dong.find((d) => d.code === code);
  };

  it("[NHH-FE-DM-01] số lead chỉ đếm lead TRONG tầm nhìn: A không đếm B; HO đếm cả hai (đối chứng dương)", async () => {
    // Bộ DB dùng chung có thể còn lead nhóm khác của các spec khác — chỉ khẳng định phần của tiền tố NDM_ bằng chênh lệch.
    const a = await dong(actorCoSo([cA]), "PAID_ADS");
    const b = await dong(actorCoSo([cB]), "PAID_ADS");
    const ho = await dong(actorHo(), "PAID_ADS");
    expect(a?.soLeadTong).toBe(3); // 1 · 29 · 31 ngày, KHÔNG tính dòng đã xoá
    expect(b?.soLeadTong).toBe(2);
    expect(ho!.soLeadTong).toBeGreaterThanOrEqual(5); // HO thấy ít nhất cả hai cơ sở (3 + 2)
    expect(ho!.soLeadTong).toBeGreaterThan(a!.soLeadTong);
  }, 60_000);

  it("[NHH-FE-DM-02] cửa sổ 30 ngày theo `now` truyền vào: 29 ngày VÀO, 31 ngày RA", async () => {
    const a = await dong(actorCoSo([cA]), "PAID_ADS");
    expect(a?.soLead30Ngay).toBe(2); // 1 ngày + 29 ngày; 31 ngày không; dòng đã xoá không
    expect(a?.soLeadTong).toBe(3);
    // Dời đồng hồ về TRƯỚC 31 ngày: lead 31 ngày tuổi (so với NOW) vừa lọt vào cửa sổ 30 ngày tính từ mốc đó.
    const lui = await docDanhMucNguon(actorCoSo([cA]), { now: ngayTruoc(1), trangThai: null, coSoId: null });
    const adv = lui.dong.find((d) => d.code === "PAID_ADS")!;
    expect(adv.soLead30Ngay).toBe(3); // 31 ngày trước NOW = 30 ngày trước mốc mới ⇒ vào cửa sổ; đồng hồ là THAM SỐ
    expect(adv.soLeadTong).toBe(3); // tổng không phụ thuộc đồng hồ
  }, 60_000);

  it("[NHH-FE-DM-03] chín nhóm gốc theo sortOrder; lọc trạng thái chỉ giữ nhóm đúng trạng thái", async () => {
    const r = await docDanhMucNguon(actorCoSo([cA]), { now: NOW, trangThai: null, coSoId: null });
    const codes = r.dong.map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(["PARENT_REFERRAL", "PAID_ADS", "OTHER", "UNKNOWN"]));
    const goc = r.dong.filter((d) => d.documentNo !== null).map((d) => d.documentNo);
    expect(goc.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.dong.at(-1)?.code === "UNKNOWN" || r.dong.some((d) => d.code === "UNKNOWN")).toBe(true);
    expect(r.cuaSoGhiCongNgay).toBeGreaterThan(0);
    const inactive = await docDanhMucNguon(actorCoSo([cA]), { now: NOW, trangThai: "INACTIVE", coSoId: null });
    expect(inactive.dong.every((d) => d.status === "INACTIVE")).toBe(true);
    const active = await docDanhMucNguon(actorCoSo([cA]), { now: NOW, trangThai: "ACTIVE", coSoId: null });
    expect(active.dong.length).toBeGreaterThanOrEqual(9); // đối chứng dương: ACTIVE có mặt
  }, 60_000);

  it("[NHH-FE-DM-04] chi tiết nguồn: nhóm lạ ⇒ null; thống kê nhất quán; cách ly cơ sở", async () => {
    expect(await docChiTietNguon(actorCoSo([cA]), "KHONG_CO_NHOM_NAY", NOW)).toBeNull();
    // [DYN-WIN-UI2] màn chi tiết nói THẬT về cửa sổ: nguồn không khai ⇒ null (dùng mặc định); nguồn có cửa sổ riêng ⇒ số riêng
    expect((await docChiTietNguon(actorCoSo([cA]), "PAID_ADS", NOW))!.cuaSoRiengNgay).toBeNull();
    await db.leadSourceGroup.update({ where: { code: "PAID_ADS" }, data: { attributionWindowDays: 45 } });
    try {
      expect((await docChiTietNguon(actorCoSo([cA]), "PAID_ADS", NOW))!.cuaSoRiengNgay).toBe(45);
    } finally {
      await db.leadSourceGroup.update({ where: { code: "PAID_ADS" }, data: { attributionWindowDays: null } });
    }

    const ct = await docChiTietNguon(actorCoSo([cA]), "PAID_ADS", NOW);
    expect(ct).not.toBeNull();
    const tk = ct!.thongKe;
    expect(tk.tong).toBe(3);
    expect(tk.ba30).toBe(2);
    expect(tk.bay7).toBe(1); // chỉ lead 1 ngày tuổi
    expect(tk.theoTrangThaiLead.reduce((n, r) => n + r.so, 0)).toBe(tk.tong); // Σ theo trạng thái = tổng
    expect(Object.fromEntries(tk.theoTrangThaiLead.map((r) => [r.trangThai, r.so]))).toEqual({ MOI: 2, DA_DANG_KY: 1 });
    expect(Object.fromEntries(tk.theoDuongVao.map((r) => [r.duongVao, r.so]))).toEqual({ quatang: 2, import: 1 });

    // B không thấy lead của A trong CHÍNH nhóm đó.
    const ctB = await docChiTietNguon(actorCoSo([cB]), "PAID_ADS", NOW);
    expect(ctB!.thongKe.tong).toBe(2);

    // Nhóm SALE: thiếu người đếm đúng, và hàng chờ theo lý do khớp.
    const sale = await docChiTietNguon(actorCoSo([cA]), "EMPLOYEE_REFERRAL", NOW);
    expect(sale!.thongKe.thieuNguoi).toBe(1);
    expect(sale!.thongKe.hangChoTheoLyDo.THIEU_NGUOI).toBe(1);
    expect(sale!.nguon.referrerRequirement).toBe("EMPLOYEE");
    // Tầm nhìn rỗng ⇒ mọi số về 0 nhưng NHÓM vẫn có (danh mục là dữ liệu chung).
    const trong = await docChiTietNguon(actorCoSo([]), "PAID_ADS", NOW);
    expect(trong!.thongKe.tong).toBe(0);
    expect(trong!.nguon.name).toBeTruthy();
  }, 60_000);

  it("[NHH-FE-DM-05] 'có người giới thiệu' (2) và 'thiếu người' (1) là HAI số khác nhau; không lẫn sang nhóm khác", async () => {
    const ph = await db.user.create({ data: { name: `${P}PH`, email: "ndm-ph@example.test" } });
    await lead("A_pr_1", cA, nhom.PARENT_REFERRAL, { tuoi: 2, sdt: "0990500011", referrerParentUserId: ph.id });
    await lead("A_pr_2", cA, nhom.PARENT_REFERRAL, { tuoi: 3, sdt: "0990500012", referrerParentUserId: ph.id });
    await lead("A_pr_3", cA, nhom.PARENT_REFERRAL, { tuoi: 4, sdt: "0990500013", referrerMissing: true });
    const ct = await docChiTietNguon(actorCoSo([cA]), "PARENT_REFERRAL", NOW);
    expect(ct!.thongKe.tong).toBe(3);
    expect(ct!.thongKe.coNguoiGioiThieu).toBe(2); // khác 'thiếu' — đảo điều kiện (referrerKind null) sẽ ra 1
    expect(ct!.thongKe.thieuNguoi).toBe(1);
    // nhóm QUẢNG CÁO không có ai khai người giới thiệu ⇒ 0 (đối chứng: số không rò sang nhóm khác)
    const qc = await docChiTietNguon(actorCoSo([cA]), "PAID_ADS", NOW);
    expect(qc!.thongKe.coNguoiGioiThieu).toBe(0);
  }, 60_000);

  it("[NHH-FE-DM-06] Page đã map về nhóm: đúng nhóm, đúng chiến dịch, sắp theo mã Page", async () => {
    const KHOA = "nguon.bangNguonTheoPage";
    const cu = await db.systemSetting.findUnique({ where: { key: KHOA } });
    try {
      const bang = {
        "page-222": { groupCode: "PAID_ADS" },
        "page-111": { groupCode: "PAID_ADS", campaignCode: "CAMP-A" },
        "page-333": { groupCode: "OTHER", campaignCode: "CAMP-Z" },
      };
      await db.systemSetting.upsert({
        where: { key: KHOA },
        create: { key: KHOA, valueJson: bang },
        update: { valueJson: bang },
      });
      clearSettingsCache();
      const qc = await docChiTietNguon(actorCoSo([cA]), "PAID_ADS", NOW);
      expect(qc!.pageDaMap).toEqual([
        { pageId: "page-111", campaignCode: "CAMP-A" },
        { pageId: "page-222", campaignCode: null },
      ]);
      const khac = await docChiTietNguon(actorCoSo([cA]), "OTHER", NOW);
      expect(khac!.pageDaMap).toEqual([{ pageId: "page-333", campaignCode: "CAMP-Z" }]);
      const trong = await docChiTietNguon(actorCoSo([cA]), "EMPLOYEE_REFERRAL", NOW);
      expect(trong!.pageDaMap).toEqual([]);
    } finally {
      if (cu) await db.systemSetting.update({ where: { key: KHOA }, data: { valueJson: cu.valueJson as never } });
      else await db.systemSetting.deleteMany({ where: { key: KHOA } });
      clearSettingsCache();
    }
  }, 60_000);

  it("[NHH-FE-DM-07] chip cơ sở lọc THẬT danh mục (không phải lời hứa suông): A≠B≠tất cả; ngoài tầm nhìn ⇒ 0", async () => {
    const ho = actorHo();
    const loc = async (a: Actor, coSoId: string | null) => {
      const r = await docDanhMucNguon(a, { now: NOW, trangThai: null, coSoId });
      return r.dong.find((d) => d.code === "PAID_ADS")!;
    };
    const chiA = await loc(ho, cA);
    const chiB = await loc(ho, cB);
    const tatCa = await loc(ho, null);
    expect(chiA.soLeadTong).toBe(3); // đúng như DM-01 — chỉ A, HO nhìn qua chip
    expect(chiA.soLead30Ngay).toBe(2); // cửa sổ 30 ngày cũng theo chip (1 ngày + 29 ngày)
    expect(chiB.soLeadTong).toBe(2);
    expect(chiB.soLead30Ngay).toBe(2);
    expect(tatCa.soLeadTong).toBeGreaterThanOrEqual(5); // đối chứng dương: không chip = cả hai cơ sở
    expect(tatCa.soLeadTong).toBeGreaterThan(chiA.soLeadTong);
    // QLCS A cố ép sang cơ sở B bằng chip: scopedDb cắt lại ⇒ 0, không bao giờ lộ B.
    expect((await loc(actorCoSo([cA]), cB)).soLeadTong).toBe(0);
    expect((await loc(actorCoSo([cA]), cA)).soLeadTong).toBe(3);
  }, 60_000);
});
