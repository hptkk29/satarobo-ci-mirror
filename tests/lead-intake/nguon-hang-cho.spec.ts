import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import {
  KICH_THUOC_TRANG_HANG_CHO,
  demHangChoNguon,
  demHangChoTheoLyDo,
  docHangChoNguon,
} from "../../lib/nguon/doc-hang-cho";
import { damBaoDanhMucGoc, duLieuNguon, type IdNhom } from "./_nguon-fixture";

// =============================================================================
// HÀNG CHỜ NGUỒN (tab Nguồn, chỉ phần ĐỌC) — Postgres LOCAL thật, scopedDb thật.
//
//   [NHH-FE-HC-03] cách ly cơ sở: QLCS A chỉ thấy lead hàng chờ của A; HO thấy cả hai (đối chứng dương)
//   [NHH-FE-HC-04] đúng bốn lý do; lead sạch / đã xoá / chưa có dòng nguồn KHÔNG nằm trong hàng chờ
//   [NHH-FE-HC-05] MỘT nguồn cho số và danh sách: đếm == tổng == số dòng đọc được, và khớp lyDoCuaDong
//   [NHH-FE-HC-06] PII: canViewPii=false ⇒ tên bị che; true ⇒ nguyên (đối chứng dương)
//   [NHH-FE-HC-07] phân trang theo server, thứ tự ổn định, không trùng/thiếu dòng giữa hai trang
//   [NHH-FE-HC-08] tầm nhìn rỗng ⇒ 0 dòng (fail-closed, không rơi về "tất cả") — CẢ số đếm LẪN danh sách dòng
//   [NHH-FE-HC-09] CÙNG createdAt ⇒ thứ tự theo id tăng dần, bất kể thứ tự chèn (trang không trùng/thiếu dòng)
//   [NHH-FE-HC-10] "thiếu giải trình" gồm cả note RỖNG '' (không chỉ NULL)
//   [NHH-FE-HC-11] tuổi ngày: làm tròn XUỐNG theo `now` truyền vào, không âm khi lead sinh sau mốc `now`
//
// Cách ly: tiền tố `NHC_`, dọn theo tiền tố — KHÔNG resetDb.
// =============================================================================

const RUN = RUN_DB_TESTS;
const P = "NHC_";
const NOW = new Date("2026-10-08T05:00:00.000Z");

function actorCoSo(centerIds: string[]): Actor {
  return {
    userId: "nhc-actor",
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
  if (ids.length) await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo theo quy nguồn
  await db.center.deleteMany({ where: { code: { startsWith: "NHC" } } });
}

describe.skipIf(!RUN)("Hàng chờ nguồn — đọc qua Lead đã scope", () => {
  let nhom: IdNhom;
  let cA = "";
  let cB = "";
  const id: Record<string, string> = {};

  async function taoLead(ten: string, centerId: string, sdt: string, extra: { deletedAt?: Date; createdAt?: Date; id?: string } = {}) {
    const l = await db.lead.create({
      data: { parentName: `${P}${ten}`, phone: sdt, status: "MOI", centerId, source: "sale-form", ...extra },
    });
    id[ten] = l.id;
    return l.id;
  }

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cA = (await db.center.create({ data: { code: "NHC-A", name: "NHC A", slug: "nhc-a", address: "a", city: "" } })).id;
    cB = (await db.center.create({ data: { code: "NHC-B", name: "NHC B", slug: "nhc-b", address: "b", city: "" } })).id;
    const a1 = await taoLead("A1_unknown", cA, "0990400001");
    const a2 = await taoLead("A2_thieunguoi", cA, "0990400002");
    const a3 = await taoLead("A3_thieugiaitrinh", cA, "0990400003");
    const a4 = await taoLead("A4_sach", cA, "0990400004");
    const a5 = await taoLead("A5_canhbao", cA, "0990400005");
    const a6 = await taoLead("A6_daxoa", cA, "0990400006", { deletedAt: new Date("2026-10-01T00:00:00Z") });
    await taoLead("A7_chuacodong", cA, "0990400007"); // lead chưa có dòng nguồn (trước di trú / cờ tắt)
    const b1 = await taoLead("B1_unknown", cB, "0990400008");
    await db.$transaction(async (tx) => {
      await taoNguonBanDau(tx, a1, duLieuNguon(nhom.UNKNOWN, { identificationMethod: "UNKNOWN", signals: { nhanGoc: "Facebook ads cũ" } }), null);
      await taoNguonBanDau(tx, a2, duLieuNguon(nhom.EMPLOYEE_REFERRAL, { referrerMissing: true }), null);
      await taoNguonBanDau(tx, a3, duLieuNguon(nhom.OTHER, { otherSourceNote: null }), null);
      await taoNguonBanDau(tx, a4, duLieuNguon(nhom.PAID_ADS), null);
      await taoNguonBanDau(tx, a5, duLieuNguon(nhom.PARTNER, { canhBao: ["SDT_NHAN_VIEN"] }), null);
      await taoNguonBanDau(tx, a6, duLieuNguon(nhom.UNKNOWN, { identificationMethod: "UNKNOWN" }), null);
      await taoNguonBanDau(tx, b1, duLieuNguon(nhom.UNKNOWN, { identificationMethod: "UNKNOWN" }), null);
    });
  }, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  const ten = (r: { dong: { tenLead: string }[] }) => r.dong.map((d) => d.tenLead.replace(P, "")).sort();
  const co = { coSoId: null, lyDo: null, trang: 1, now: NOW, canViewPii: true } as const;

  it("[NHH-FE-HC-03] QLCS A chỉ thấy hàng chờ của A; QLCS B của B; HO thấy cả hai", async () => {
    const a = await docHangChoNguon(actorCoSo([cA]), co);
    expect(ten(a)).toEqual(["A1_unknown", "A2_thieunguoi", "A3_thieugiaitrinh", "A5_canhbao"]);
    expect(a.tong).toBe(4);
    const b = await docHangChoNguon(actorCoSo([cB]), co);
    expect(ten(b)).toEqual(["B1_unknown"]);
    // Đối chứng dương: HO thấy đủ 5 — nếu A và B cùng rỗng ca trên chỉ đo "không thấy gì".
    // Hỏi HO THEO TỪNG CƠ SỞ (không hỏi "tất cả"): DB dùng chung có thể còn lead của spec khác/dữ liệu UAT trong
    // hàng chờ, và trang đầu 25 dòng có thể không chứa dòng của ca này. `coSoId` là cơ sở riêng của ca (NHC-A/B).
    const hoA = await docHangChoNguon(actorHo(), { ...co, coSoId: cA });
    const hoB = await docHangChoNguon(actorHo(), { ...co, coSoId: cB });
    expect([...ten(hoA), ...ten(hoB)]).toEqual(["A1_unknown", "A2_thieunguoi", "A3_thieugiaitrinh", "A5_canhbao", "B1_unknown"]);
    expect(hoA.tong + hoB.tong).toBe(5);
    // `coSoId` ngoài tầm nhìn không mở đường rò: A hỏi cơ sở B ⇒ 0.
    const ro = await docHangChoNguon(actorCoSo([cA]), { ...co, coSoId: cB });
    expect(ro.tong).toBe(0);
    expect(ro.dong).toEqual([]);
  }, 60_000);

  it("[NHH-FE-HC-04] đúng bốn lý do; lead sạch / đã xoá / chưa có dòng nguồn không nằm trong hàng chờ", async () => {
    const r = await docHangChoNguon(actorCoSo([cA]), co);
    const lyDo = Object.fromEntries(r.dong.map((d) => [d.tenLead.replace(P, ""), d.lyDo]));
    expect(lyDo).toEqual({
      A1_unknown: ["UNKNOWN"],
      A2_thieunguoi: ["THIEU_NGUOI"],
      A3_thieugiaitrinh: ["THIEU_GIAI_TRINH"],
      A5_canhbao: ["CANH_BAO"],
    });
    const names = ten(r);
    expect(names).not.toContain("A4_sach");
    expect(names).not.toContain("A6_daxoa");
    expect(names).not.toContain("A7_chuacodong");
    // dữ liệu kèm theo của dòng
    const a1 = r.dong.find((d) => d.tenLead === `${P}A1_unknown`)!;
    expect(a1).toMatchObject({ nguon: { code: "UNKNOWN" }, nhanGoc: "Facebook ads cũ", duongVao: "sale-form", tuoiNgay: expect.any(Number) });
    expect(a1.coSo?.code).toBe("NHC-A");
    const a5 = r.dong.find((d) => d.tenLead === `${P}A5_canhbao`)!;
    expect(a5.canhBao).toEqual(["SDT_NHAN_VIEN"]);
  }, 60_000);

  it("[NHH-FE-HC-05] MỘT nguồn: đếm == tổng == số dòng đọc được; từng lý do khớp phép thuần lyDoCuaDong", async () => {
    const act = actorCoSo([cA]);
    const [dem, theo, ds] = await Promise.all([
      demHangChoNguon(act, null),
      demHangChoTheoLyDo(act, null),
      docHangChoNguon(act, co),
    ]);
    expect(dem).toBe(4);
    expect(ds.tong).toBe(dem);
    expect(ds.dong).toHaveLength(dem);
    expect(theo).toEqual({ UNKNOWN: 1, THIEU_NGUOI: 1, THIEU_GIAI_TRINH: 1, CANH_BAO: 1 });
    // Lọc một lý do trả đúng tập mà phép thuần gán lý do đó cho.
    for (const l of ["UNKNOWN", "THIEU_NGUOI", "THIEU_GIAI_TRINH", "CANH_BAO"] as const) {
      const rl = await docHangChoNguon(act, { ...co, lyDo: l });
      expect(rl.tong, l).toBe(theo[l]);
      for (const d of rl.dong) expect(d.lyDo).toContain(l);
    }
    // số theo cơ sở: chip cơ sở dùng cùng hàm
    expect(await demHangChoNguon(actorHo(), cA)).toBe(4);
    expect(await demHangChoNguon(actorHo(), cB)).toBe(1);
  }, 60_000);

  it("[NHH-FE-HC-06] PII: canViewPii=false che tên phụ huynh; true giữ nguyên (đối chứng dương)", async () => {
    const act = actorCoSo([cA]);
    const co1 = await docHangChoNguon(act, { ...co, canViewPii: true });
    const khong = await docHangChoNguon(act, { ...co, canViewPii: false });
    expect(co1.dong.map((d) => d.tenLead)).toContain(`${P}A1_unknown`);
    expect(khong.dong.map((d) => d.tenLead)).not.toContain(`${P}A1_unknown`);
    expect(khong.dong).toHaveLength(co1.dong.length);
    // không rò tên thật qua trường nào khác
    expect(JSON.stringify(khong.dong)).not.toContain(`${P}A1_unknown`);
  }, 60_000);

  it("[NHH-FE-HC-07] phân trang theo server: thứ tự ổn định, hai trang không trùng và không thiếu dòng", async () => {
    const them = KICH_THUOC_TRANG_HANG_CHO + 5; // 30 lead UNKNOWN thêm ⇒ 34 dòng hàng chờ ở cơ sở A
    for (let i = 0; i < them; i++) {
      const lid = await taoLead(`A9_${String(i).padStart(2, "0")}`, cA, `09904${String(10000 + i)}`);
      await db.$transaction((tx) => taoNguonBanDau(tx, lid, duLieuNguon(nhom.UNKNOWN, { identificationMethod: "UNKNOWN" }), null));
    }
    const act = actorCoSo([cA]);
    const t1 = await docHangChoNguon(act, { ...co, trang: 1 });
    const t2 = await docHangChoNguon(act, { ...co, trang: 2 });
    const t3 = await docHangChoNguon(act, { ...co, trang: 3 });
    expect(t1.tong).toBe(4 + them);
    expect(t1.dong).toHaveLength(KICH_THUOC_TRANG_HANG_CHO);
    expect(t2.dong).toHaveLength(4 + them - KICH_THUOC_TRANG_HANG_CHO);
    expect(t3.dong).toHaveLength(0);
    const gop = [...t1.dong, ...t2.dong].map((d) => d.leadId);
    expect(new Set(gop).size).toBe(gop.length); // không trùng
    expect(gop).toHaveLength(4 + them); // không thiếu
    // trang âm/0 coi là 1
    expect((await docHangChoNguon(act, { ...co, trang: 0 })).dong.map((d) => d.leadId)).toEqual(t1.dong.map((d) => d.leadId));
  }, 120_000);

  it("[NHH-FE-HC-08] tầm nhìn rỗng ⇒ 0 dòng, 0 đếm (fail-closed)", async () => {
    const trong = actorCoSo([]);
    const ds = await docHangChoNguon(trong, co);
    expect(ds.tong).toBe(0);
    // Danh sách DÒNG phải rỗng chứ không chỉ con số: `tong` đến từ câu COUNT, `dong` từ câu findMany RIÊNG — đọc
    // dòng bằng db trần (không scope) cho `tong = 0` mà vẫn rò nguyên danh sách (đợt cấy 08/10, D04).
    expect(ds.dong).toEqual([]);
    expect(await demHangChoNguon(trong, null)).toBe(0);
    expect(await demHangChoTheoLyDo(trong, null)).toEqual({ UNKNOWN: 0, THIEU_NGUOI: 0, THIEU_GIAI_TRINH: 0, CANH_BAO: 0 });
  }, 60_000);

  it("[NHH-FE-HC-09] CÙNG createdAt ⇒ thứ tự theo id tăng dần, bất kể thứ tự CHÈN", async () => {
    const cung = new Date("2026-10-01T03:00:00.000Z");
    // Chèn theo id GIẢM dần: thứ tự vật lý (heap) ngược thứ tự id, nên bỏ tie-break `{ id: "asc" }` là ra ngay thứ tự khác.
    let i = 0;
    for (const k of ["z", "y", "x", "w"]) {
      const lid = await taoLead(`TIE_${k}`, cA, `09904200${String(i++).padStart(2, "0")}`, { createdAt: cung, id: `nhc-tie-${k}` });
      await db.$transaction((tx) => taoNguonBanDau(tx, lid, duLieuNguon(nhom.UNKNOWN, { identificationMethod: "UNKNOWN" }), null));
    }
    const r = await docHangChoNguon(actorCoSo([cA]), co);
    const tie = r.dong.filter((d) => d.tenLead.startsWith(`${P}TIE_`)).map((d) => d.leadId);
    expect(tie).toEqual(["nhc-tie-w", "nhc-tie-x", "nhc-tie-y", "nhc-tie-z"]);
  }, 60_000);

  it("[NHH-FE-HC-10] thiếu giải trình: note NULL vào hàng chờ, note có chữ KHÔNG vào; DB không cho lưu note ''", async () => {
    const du = await taoLead("A9_giaitrinh_du", cA, "0990400021");
    await db.$transaction((tx) =>
      taoNguonBanDau(tx, du, duLieuNguon(nhom.OTHER, { otherSourceNote: "Khách quen của chị Lan, giới thiệu qua Zalo" }), null),
    );
    const r = await docHangChoNguon(actorCoSo([cA]), { ...co, lyDo: "THIEU_GIAI_TRINH" });
    expect(ten(r)).toEqual(["A3_thieugiaitrinh"]); // A3 (note NULL) vào; A9 (đủ giải trình) không
    expect((await demHangChoTheoLyDo(actorCoSo([cA]), null)).THIEU_GIAI_TRINH).toBe(1);
    // Vì sao điều kiện có thêm nhánh `otherSourceNote: ""` mà KHÔNG có ca DB cho nó: CHECK
    // `LeadAttribution_giai_trinh_chk` cấm note rỗng, nên trạng thái đó không dựng được. Nhánh '' chỉ là phòng thủ và
    // được ghim ở dạng cấu trúc (`[NHH-FE-HC-02b]`, doc-hang-cho.test.ts) — đừng thêm ca DB cho nó.
    await expect(db.leadAttribution.update({ where: { leadId: du }, data: { otherSourceNote: "" } })).rejects.toThrow(/giai_trinh_chk/);
  }, 60_000);

  it("[NHH-FE-HC-11] tuổi ngày làm tròn XUỐNG theo `now` truyền vào; lead sinh sau mốc `now` ⇒ 0, không âm", async () => {
    const gio = 60 * 60 * 1000;
    const mk = async (ten: string, lech: number, sdt: string) => {
      const lid = await taoLead(ten, cA, sdt, { createdAt: new Date(NOW.getTime() + lech) });
      await db.$transaction((tx) => taoNguonBanDau(tx, lid, duLieuNguon(nhom.UNKNOWN, { identificationMethod: "UNKNOWN" }), null));
    };
    await mk("AGE_3d1h", -(72 + 1) * gio, "0990400030"); // 3 ngày 1 giờ ⇒ 3 (làm tròn lên sẽ ra 4)
    await mk("AGE_23h", -23 * gio, "0990400031"); // 23 giờ ⇒ 0 (làm tròn lên sẽ ra 1)
    await mk("AGE_tuonglai", 2 * gio, "0990400032"); // sau mốc now 2 giờ ⇒ 0 (không âm)
    const r = await docHangChoNguon(actorCoSo([cA]), co);
    const tuoi = Object.fromEntries(r.dong.map((d) => [d.tenLead.replace(P, ""), d.tuoiNgay]));
    expect(tuoi["AGE_3d1h"]).toBe(3);
    expect(tuoi["AGE_23h"]).toBe(0);
    expect(tuoi["AGE_tuonglai"]).toBe(0);
  }, 60_000);
});
