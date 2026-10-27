// @vitest-environment node
/**
 * [CUT-DT-*] — CỔNG «DI TRÚ NGUỒN CHƯA SẴN SÀNG» của cutover, chạy bằng công cụ di trú THẬT (hướng EF) trên Postgres thật.
 *
 * Vì sao có bộ này: mọi ca của `cutover-hanh-dong.spec.ts` hoặc bơm `phuThuoc` giả (bốn số tự khai) hoặc chỉ khẳng định cổng ĐÓNG. Không ca nào đi đường
 * `phuThuocCutoverThat` → `docChiTietDiTru` → `docTinhTrangBackfill` với câu hỏi «dữ liệu SẠCH thì cổng có MỞ không». Hệ quả đã đo (reviewer 11/10, nhánh gộp):
 * `TinhTrangBackfill` không mang `sanSang` mà D đọc nó ⇒ `!undefined` = true ⇒ cutover bị chặn VĨNH VIỄN, 141 unit + 12 ca DB vẫn xanh. Cổng chỉ-biết-đóng là
 * cổng không chứng minh được gì — nên ở đây mỗi bước đòi cả hai chiều: dữ liệu sạch ⇒ KHÔNG chặn; thêm đúng MỘT thứ hỏng ⇒ chặn ĐÚNG mã đó và không mã nào khác.
 *
 *   [CUT-DT-01]  DB sạch (0 lead, danh mục đủ): bốn số + tình trạng di trú sạch, KHÔNG có mã chặn nào, và `datMocCutover` thật (cùng `phuThuocCutoverThat`) GHI ĐƯỢC mốc
 *   [CUT-DT-02]  một lead nhãn hợp lệ nhưng chưa quy nguồn ⇒ ĐÚNG MỘT mã `DI_TRU_CHUA_SAN_SANG`; backfill THẬT (`thucHienDiTru`) xong ⇒ cổng mở lại, ghi được
 *   [CUT-DT-05]  ĐỐI CHỨNG ÂM của [CUT-DT-02]: nguồn chưa có chủ mà KHÔNG khai / khai thừa ⇒ lệnh ghi TỪ CHỐI `NGUON_CHUA_CO_CHU`, không ghi gì, cổng cutover VẪN đóng; khai ĐÚNG ⇒ ghi, cổng mở
 *   [CUT-DT-03]  một lead nhãn ngoài 28 dòng ⇒ `CO_INVALID_NGUON` + `DI_TRU_CHUA_SAN_SANG`; lệnh backfill từ chối nó nên cổng KHÔNG mở sau khi «chạy backfill»
 *   [CUT-DT-04a] bảng quy nguồn VẮNG (migration chưa chạy), đo trong transaction rồi rollback: không NÉM, `sanSang = false` kể cả khi 0 lead
 *   [CUT-DT-04b] cùng tình huống, đường D: nhánh `thieuBangQuyNguon` chạy thật, câu chữ nói đúng «migration chưa chạy», xem trước không sập thành «lỗi lạ»
 *
 * ⚠️ AN TOÀN DB: không `resetDb()` (cả thư mục `tests/hoa-hong` dùng chung một DB và nhiều spec tự dựng cơ sở/vai riêng). Các câu đo di trú là TOÀN CỤC (`TAT_CA`) nên bộ này
 * tạm xoá-mềm mọi lead đang sống TRƯỚC khi chạy và khôi phục ĐÚNG những dòng đó ở `afterAll`. Chỉ đụng cột `deletedAt` và bằng SQL thô: `Lead.updatedAt` là `@updatedAt`, nên `updateMany`
 * của Prisma sẽ dời `updatedAt` của lead người khác mỗi lần xoá-mềm / khôi phục (cảnh báo «lead nằm im» đọc đúng cột đó). Lead của bộ này mang tiền tố `CDT_`.
 * LUẬT 18: mỗi ca tự dựng hiện trường. LUẬT 19: `NOW` và cửa sổ là mốc tuyệt đối — cửa sổ nằm ở 2025, trước mọi khoản thu của bộ khác.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { cacChanPrecheck } from "../../lib/hoa-hong/cutover-kiem-tra";
import { datMocCutover, docMocCutover, napGoiBangChung, danhGiaDatMoc } from "../../lib/hoa-hong/cutover";
import { docChiTietDiTru, phuThuocCutoverThat } from "../../lib/hoa-hong/cutover-kiem-tra-db";
import { xemTruocCutover } from "../../lib/hoa-hong/cutover-hanh-dong";
import { docDuLieuDiTru, docNhomDiTru } from "../../lib/nguon/di-tru-db";
import { dungKeHoachDiTru, type KeHoachDiTru, type NhomDiTru } from "../../lib/nguon/di-tru-ke-hoach";
import { KICH_THUOC_LO_DI_TRU, thucHienDiTru } from "../../lib/nguon/di-tru-ghi";
import { congChoKeHoach } from "../_helpers/cong-ghi-wave1";
import { docTinhTrangBackfill } from "../../lib/nguon/di-tru-tinh-trang";
import { coBangQuyNguon } from "../../lib/nguon/co-bang-quy-nguon";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { actorCua, D, datMocCutover as datMocTay, donViHoiSo, ganVai } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[CUT-DT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "CDT_";
const KHOA = "hoaHong.kyCutover";
const MOC = "2031-05";
const NOW = D("2027-02-10");
const TRUOC = new Date("2026-09-15T03:00:00.000Z");
const DEN_SAU = new Date("2026-10-05T00:00:00.000Z");
const CUA_SO_MAC_DINH_NGAY = 90;
const LY_DO = "BGĐ duyệt chuyển hoa hồng mới (ca test di trú thật)";
// Cửa sổ MỘT NGÀY ở 2025: trước mọi khoản thu mà bộ khác dựng ⇒ so bóng đo 0 khoản, 0 hàng chờ, 0 chênh — chỉ còn di trú là biến số.
const CUA_SO = { tuNgay: "2025-06-15", denNgay: "2025-06-15" };
const TEN_TAM = "LeadAttribution_cdt_vang";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

let stt = 0;
const sdt = () => `09917${String(++stt).padStart(5, "0")}`;
let SA: { actor: Awaited<ReturnType<typeof actorCua>>; ten: string };
let leadDaXoaMem: string[] = [];

const thuoc = () => phuThuocCutoverThat({ client: db, cuaSo: CUA_SO, tranSoKhoan: 500 });
const giaTriMoc = async () => (await db.systemSetting.findUnique({ where: { key: KHOA } }))?.valueJson ?? null;

async function taoLead(ten: string, source: string | null): Promise<string> {
  const l = await db.lead.create({ data: { parentName: `${P}${ten}`, phone: sdt(), status: "MOI", source, createdAt: TRUOC }, select: { id: true } });
  return l.id;
}

async function don(): Promise<void> {
  const ls = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = ls.map((l) => l.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // quy nguồn + touchpoint đi theo (Cascade)
  }
  await db.auditLog.deleteMany({ where: { entityType: "NguonDiTru", actorName: `${P}actor` } });
}

/** Đo qua đúng đường mà trang xem trước và nút xác nhận đi: nạp bằng chứng THẬT rồi chạy cổng. */
async function doThat() {
  const pt = thuoc();
  const xem = await napGoiBangChung(db, pt, { moi: MOC, now: NOW });
  const { chiTiet, chuaSanSang } = await docChiTietDiTru(db);
  const dg = await danhGiaDatMoc(db, { cu: xem.cu, moi: MOC, now: NOW, bangChung: xem.goi.bangChung });
  return { pt, xem, chiTiet, chuaSanSang, dg, ma: cacChanPrecheck(xem.goi.bangChung, chiTiet).map((c) => c.ma) };
}

const datThat = (xem: Awaited<ReturnType<typeof doThat>>["xem"], pt = thuoc()) =>
  datMocCutover(db, SA, { mocMoi: MOC, lyDo: LY_DO, now: NOW, cuDaXem: xem.cu, dauVanDaXem: xem.goi.dauVan, phuThuoc: pt });

/** Dựng kế hoạch backfill trên ĐÚNG phạm vi fixture, trong transaction READ ONLY như lệnh thật. */
async function lapKeHoach(ids: string[]): Promise<{ kh: KeHoachDiTru; nhomDm: NhomDiTru[] }> {
  return db.$transaction(async (tx: Tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const kq = await docDuLieuDiTru(tx, { coBangQuyNguon: true, phamVi: { leadIds: ids }, den: null });
    const nhomDm = await docNhomDiTru(tx);
    const kh = dungKeHoachDiTru({ hang: kq.hang, chiTiet: kq.chiTiet, nhom: nhomDm, nhomCanChu: new Set(nhomDm.map((g) => g.code)), cuaSoMacDinhNgay: CUA_SO_MAC_DINH_NGAY });
    return { kh, nhomDm };
  });
}

/**
 * Mặc định CHẤP NHẬN ĐÚNG tập nguồn chưa có chủ của kế hoạch (bộ này xoá mọi chủ nguồn) để ca KHÔNG nhắm vào cổng đó vẫn ghi được — y như `nguon-di-tru-ghi.spec.ts`.
 * Ca nhắm vào cổng `NGUON_CHUA_CO_CHU` ([CUT-DT-05]) truyền `chap` tường minh.
 */
const ghi = (kh: KeHoachDiTru, nhomDm: NhomDiTru[], chap: string[] = kh.nhomPhaiCoChu.map((g) => g.code)) =>
  thucHienDiTru({
    db,
    kh,
    nhom: nhomDm,
    cuaSoMacDinhNgay: CUA_SO_MAC_DINH_NGAY,
    duyet: { soDuyet: kh.tong.ghi, soDuyetReview: kh.tong.review, sha: kh.sha, den: DEN_SAU, chapNhanNguonChuaCoChu: chap },
    actor: { id: null, name: `${P}actor` },
    kichThuocLo: KICH_THUOC_LO_DI_TRU,
    nguonChay: { actor: null, triggeringActor: null, runId: null, runAttempt: null },
    batDauLuc: new Date("2026-10-12T01:02:03.000Z"), // mốc tuyệt đối (luật 19); lõi không đọc đồng hồ
    congGhi: congChoKeHoach(kh, new Date("2026-10-12T01:02:03.000Z")), // cổng Wave 1: artifact ephemeral mới mỗi lượt
  });

/** Đặt `deletedAt` cho đúng các lead đã cho, KHÔNG đụng cột nào khác (đặc biệt là `updatedAt`). */
async function datDeletedAt(ids: readonly string[], luc: Date | null): Promise<void> {
  if (ids.length === 0) return;
  await db.$executeRaw`UPDATE "Lead" SET "deletedAt" = ${luc} WHERE "id" = ANY(${[...ids]}::text[])`;
}

/** Bảng có tồn tại dưới tên này không? (tên cố định trong file này, không phải đầu vào người dùng) */
const tonTai = async (ten: string): Promise<boolean> => {
  const r = await db.$queryRawUnsafe<{ co: boolean }[]>(`SELECT to_regclass('public."${ten}"') IS NOT NULL AS co`);
  return r[0]?.co === true;
};

/** Lưới an toàn: một lần chạy trước chết khi bảng đang mang tên tạm ⇒ trả lại tên thật, kẻo ca sau chạy trên DB thiếu bảng. */
async function traBangNeuMuon(): Promise<void> {
  if ((await tonTai(TEN_TAM)) && !(await tonTai("LeadAttribution"))) await db.$executeRawUnsafe(`ALTER TABLE "${TEN_TAM}" RENAME TO "LeadAttribution"`);
}

describe.skipIf(!RUN_DB_TESTS)("[CUT-DT] cổng di trú của cutover đi qua công cụ di trú THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await traBangNeuMuon();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["SUPER_ADMIN"] });
    await don();
    // Câu đo di trú là TOÀN CỤC: đưa mọi lead đang sống (của bộ khác để lại) ra khỏi tầm đo, nhớ đúng id để trả.
    leadDaXoaMem = (await db.lead.findMany({ where: { deletedAt: null }, select: { id: true } })).map((l) => l.id);
    await datDeletedAt(leadDaXoaMem, new Date("2000-01-01T00:00:00.000Z"));
    const ten = `Quản trị tối cao CUTDT ${Date.now().toString(36)}`;
    const sa = await seedUser({ email: `fx-cutdt-sa-${Date.now().toString(36)}@ci.test`, role: "SUPER_ADMIN", name: ten, phone: null });
    await ganVai(sa.id, await donViHoiSo(), "SUPER_ADMIN");
    SA = { actor: await actorCua(sa.id), ten };
  }, 120_000);

  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db); // đủ 9 mã gốc — thiếu dòng danh mục tự nó đã là một lý do chặn
    await datCoNguon(CO_NGUON_DAY_DU);
    await datMocTay(null);
  }, 60_000);

  afterEach(async () => {
    await traBangNeuMuon();
    await datMocTay(null);
  });

  afterAll(async () => {
    await traBangNeuMuon();
    await don();
    await datDeletedAt(leadDaXoaMem, null);
    await datCoNguon({});
    await datMocTay(null);
  }, 60_000);

  it("[CUT-DT-01] DB SẠCH (0 lead, danh mục đủ): tình trạng sẵn sàng, KHÔNG mã chặn nào, và datMocCutover THẬT ghi được mốc", async () => {
    const r = await doThat();
    expect(r.chiTiet.tinhTrang).toEqual({ conThieuQuyNguon: 0, invalid: 0, manualReview: 0, daDiTru: 0, coBangQuyNguon: true, sanSang: true });
    expect(r.chiTiet).toMatchObject({ thieuBangQuyNguon: false, thieuDanhMuc: [], noiDonNhieu: 0 });
    expect(r.chuaSanSang).toBe(false);
    expect(r.xem.goi.bangChung).toEqual({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta: 0, diTruChuaSanSang: false });
    expect(r.ma).toEqual([]);
    expect(r.dg.quyetDinh, JSON.stringify(r.dg.quyetDinh)).toMatchObject({ ok: true, hanhDong: "DAT_LAN_DAU" });

    // Đường GHI thật: cùng `phuThuocCutoverThat`, không bơm số nào.
    await expect(datThat(r.xem)).resolves.toMatchObject({ cu: null, moi: MOC, hanhDong: "DAT_LAN_DAU" });
    expect(await giaTriMoc()).toBe(MOC);
    expect(await docMocCutover(db)).toBe(MOC);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "SystemSetting", entityId: KHOA }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect((a.newValues as { bangChung: unknown }).bangChung).toEqual({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta: 0, diTruChuaSanSang: false });
  });

  it("[CUT-DT-02] một lead nhãn HỢP LỆ chưa quy nguồn ⇒ ĐÚNG MỘT mã DI_TRU_CHUA_SAN_SANG và không ghi được; backfill THẬT xong ⇒ cổng mở lại, ghi được", async () => {
    const leadId = await taoLead("ads", "Ads");
    const r = await doThat();
    expect(r.chiTiet.tinhTrang).toMatchObject({ conThieuQuyNguon: 1, invalid: 0, daDiTru: 0, coBangQuyNguon: true, sanSang: false });
    expect(r.chuaSanSang).toBe(true);
    expect(r.ma).toEqual(["DI_TRU_CHUA_SAN_SANG"]); // đúng tập: không kéo theo mã nào khác
    await expect(datThat(r.xem)).rejects.toMatchObject({ ma: "DI_TRU_CHUA_SAN_SANG" });
    expect(await giaTriMoc()).toBeNull();

    // Backfill bằng lệnh GHI thật của hướng EF.
    const { kh, nhomDm } = await lapKeHoach([leadId]);
    expect(kh.tong).toMatchObject({ ghi: 1, invalid: 0 });
    expect(await ghi(kh, nhomDm)).toMatchObject({ ok: true, ghi: 1 });

    const sau = await doThat();
    expect(sau.chiTiet.tinhTrang).toMatchObject({ conThieuQuyNguon: 0, invalid: 0, daDiTru: 1, sanSang: true });
    expect(sau.chuaSanSang).toBe(false);
    expect(sau.ma).toEqual([]);
    await expect(datThat(sau.xem)).resolves.toMatchObject({ moi: MOC, hanhDong: "DAT_LAN_DAU" });
    expect(await giaTriMoc()).toBe(MOC);
  });

  it("[CUT-DT-05] nguồn chưa có chủ mà KHÔNG khai (hoặc khai thừa) ⇒ backfill THẬT từ chối NGUON_CHUA_CO_CHU, không ghi gì và cổng cutover VẪN đóng; khai ĐÚNG ⇒ ghi, cổng mở", async () => {
    // Đối chứng âm của [CUT-DT-02]: ở đó `ghi()` mặc định khai ĐÚNG nên cổng chấp-nhận-nguồn-chưa-chủ luôn thấy «đã khai» — không ca nào chứng minh nó còn CHẶN.
    const leadId = await taoLead("ads", "Ads");
    const { kh, nhomDm } = await lapKeHoach([leadId]);
    const caNguon = kh.nhomPhaiCoChu.map((g) => g.code);
    expect(caNguon.length, "fixture phải có nguồn chưa chủ, không thì ca này chẳng chứng minh gì").toBeGreaterThan(0);

    for (const chap of [[], [...caNguon, "NGUON_DU_THUA"]]) {
      const tuChoi = await ghi(kh, nhomDm, chap);
      expect(tuChoi, JSON.stringify(chap)).toMatchObject({ ok: false, cong: { ma: "NGUON_CHUA_CO_CHU" } });
    }
    expect(await db.leadAttribution.count({ where: { leadId } })).toBe(0); // từ chối = KHÔNG ghi dòng nào
    expect(await db.auditLog.count({ where: { entityType: "NguonDiTru", actorName: `${P}actor` } })).toBe(0);

    const dong = await doThat();
    expect(dong.ma).toEqual(["DI_TRU_CHUA_SAN_SANG"]); // cổng cutover vẫn đóng: chưa có gì được quy nguồn
    await expect(datThat(dong.xem)).rejects.toMatchObject({ ma: "DI_TRU_CHUA_SAN_SANG" });
    expect(await giaTriMoc()).toBeNull();

    // Đối chứng dương: khai ĐÚNG tập nguồn chưa chủ ⇒ ghi được, cổng mở.
    expect(await ghi(kh, nhomDm, caNguon)).toMatchObject({ ok: true, ghi: 1 });
    const sau = await doThat();
    expect(sau.ma).toEqual([]);
    await expect(datThat(sau.xem)).resolves.toMatchObject({ moi: MOC, hanhDong: "DAT_LAN_DAU" });
  });

  it("[CUT-DT-03] một lead nhãn NGOÀI 28 dòng ⇒ CO_INVALID_NGUON + DI_TRU_CHUA_SAN_SANG; lệnh backfill từ chối nó nên cổng KHÔNG mở sau khi «chạy backfill»", async () => {
    const leadId = await taoLead("la", "Nhãn lạ hoắc chưa từng có");
    const r = await doThat();
    expect(r.chiTiet.tinhTrang).toMatchObject({ conThieuQuyNguon: 1, invalid: 1, sanSang: false });
    expect(r.xem.goi.bangChung.invalidAttribution).toBe(1);
    expect(r.ma).toEqual(["CO_INVALID_NGUON", "DI_TRU_CHUA_SAN_SANG"]);
    await expect(datThat(r.xem)).rejects.toMatchObject({ ma: "CO_INVALID_NGUON" }); // mã đứng đầu theo thứ tự ưu tiên của cổng

    const { kh, nhomDm } = await lapKeHoach([leadId]);
    const ghiRa = await ghi(kh, nhomDm);
    expect(ghiRa.ok).toBe(false); // INVALID > 0 ⇒ lệnh ghi từ chối
    const sau = await doThat();
    expect(sau.chiTiet.tinhTrang).toMatchObject({ conThieuQuyNguon: 1, invalid: 1, sanSang: false });
    expect(sau.ma).toEqual(["CO_INVALID_NGUON", "DI_TRU_CHUA_SAN_SANG"]);
    expect(await giaTriMoc()).toBeNull();

    // Đối chứng dương: gỡ lead hỏng ⇒ sạch ⇒ ghi được.
    await don();
    const sach = await doThat();
    expect(sach.ma).toEqual([]);
    await expect(datThat(sach.xem)).resolves.toMatchObject({ moi: MOC });
  });

  /** Đổi tên bảng quy nguồn TRONG transaction, đo, rồi ném để ROLLBACK — DDL của Postgres có giao dịch nên không để lại gì. */
  async function doKhiBangVang() {
    class HoanTac extends Error {}
    let tt: Awaited<ReturnType<typeof docTinhTrangBackfill>> | undefined;
    let coBang: boolean | undefined;
    await db
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`ALTER TABLE "LeadAttribution" RENAME TO "${TEN_TAM}"`);
        coBang = await coBangQuyNguon(tx);
        tt = await docTinhTrangBackfill(tx);
        throw new HoanTac();
      })
      .catch((e: unknown) => {
        if (!(e instanceof HoanTac)) throw e;
      });
    expect(await tonTai("LeadAttribution")).toBe(true);
    expect(await tonTai(TEN_TAM)).toBe(false);
    return { tt, coBang };
  }

  it("[CUT-DT-04a] bảng quy nguồn VẮNG: đọc tình trạng KHÔNG ném, sanSang = false — cả khi 0 lead (bốn số đều 0 mà vẫn KHÔNG sẵn sàng) lẫn khi CÓ lead (đọc lead không được include quan hệ tới bảng vắng)", async () => {
    // (1) 0 lead: bốn số đều 0 ⇒ nếu `sanSang` chỉ suy từ bốn số thì cổng MỞ khi chưa có chỗ ghi nguồn.
    const khong = await doKhiBangVang();
    expect(khong.coBang).toBe(false);
    expect(khong.tt).toEqual({ conThieuQuyNguon: 0, invalid: 0, manualReview: 0, daDiTru: 0, coBangQuyNguon: false, sanSang: false });
    // (2) CÓ lead: đường đọc lead phải bỏ `include attribution` khi bảng vắng, không thì Prisma ném «table does not exist».
    await taoLead("ads", "Ads");
    const co = await doKhiBangVang();
    expect(co.coBang).toBe(false);
    expect(co.tt).toEqual({ conThieuQuyNguon: 1, invalid: 0, manualReview: 0, daDiTru: 0, coBangQuyNguon: false, sanSang: false });
  });

  it("[CUT-DT-04b] bảng quy nguồn VẮNG: nhánh `thieuBangQuyNguon` của D chạy THẬT — chặn ĐÚNG lý do «migration chưa chạy», không ném lỗi Prisma", async () => {
    await taoLead("ads", "Ads"); // có lead: đường D cũng phải đọc được khi bảng vắng
    await db.$executeRawUnsafe(`ALTER TABLE "LeadAttribution" RENAME TO "${TEN_TAM}"`);
    try {
      const { chiTiet, chuaSanSang } = await docChiTietDiTru(db);
      expect(chiTiet.tinhTrang).toMatchObject({ conThieuQuyNguon: 1, daDiTru: 0, coBangQuyNguon: false });
      expect(chiTiet.thieuBangQuyNguon).toBe(true);
      expect(chiTiet.tinhTrang.sanSang).toBe(false);
      expect(chuaSanSang).toBe(true);
      const chan = cacChanPrecheck({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta: 0, diTruChuaSanSang: chuaSanSang }, chiTiet);
      expect(chan.map((c) => c.ma)).toEqual(["DI_TRU_CHUA_SAN_SANG"]);
      expect(chan[0]!.lyDo).toContain("migration chưa chạy");

      // Cả đường XEM TRƯỚC cũng không được sập thành «lỗi lạ».
      const xem = await xemTruocCutover({ moi: MOC, now: NOW, cuaSo: CUA_SO });
      expect(xem.ok, JSON.stringify(xem)).toBe(true);
      if (xem.ok) {
        expect(xem.xem.sanSang).toBe(false);
        expect(xem.xem.chan.map((c) => c.ma)).toContain("DI_TRU_CHUA_SAN_SANG");
        expect(xem.xem.chan.find((c) => c.ma === "DI_TRU_CHUA_SAN_SANG")?.lyDo).toContain("migration chưa chạy");
      }
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "${TEN_TAM}" RENAME TO "LeadAttribution"`);
    }
    // Đối chứng dương: bảng về lại và lead đã được quy nguồn bằng backfill thật ⇒ đo lại sạch.
    const lead = await db.lead.findFirstOrThrow({ where: { parentName: { startsWith: P } }, select: { id: true } });
    const { kh, nhomDm } = await lapKeHoach([lead.id]);
    expect(await ghi(kh, nhomDm)).toMatchObject({ ok: true, ghi: 1 });
    expect((await doThat()).ma).toEqual([]);
  });
});
