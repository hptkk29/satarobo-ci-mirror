// @vitest-environment node
/**
 * [LIE-DB-*] — lead legacy «Import Excel» và chủ nguồn, đầu-cuối trên Postgres THẬT (chủ dự án chốt 21/10/2026).
 *
 *   «Import Excel không phải nguồn khách hàng … Source = UNKNOWN, xem tay, LEGACY_IMPORT_SOURCE_UNKNOWN. Không được tạo commission từ các lead này nếu chưa được xử lý tay.»
 *   «Chỉ bắt buộc chủ nguồn khi chính sách thật sự cần chủ; fail-closed với nguồn thực sự cần chủ.»
 *
 *   01  khoản thu của lead mang lý do legacy ⇒ engine GIỮ NGUYÊN khoản ở hàng chờ cứng `MANUAL_REVIEW_REQUIRED` (maLuat riêng), 0 dòng sổ;
 *   02  ĐỐI CHỨNG DƯƠNG — cùng kịch bản, lý do bị gỡ (người đã xử lý tay) ⇒ quét lại: ra dòng sổ, hàng chờ tự đóng;
 *   03  ĐỐI CHỨNG — lead UNKNOWN với lý do xem tay KHÁC (THIEU_NGUOI) KHÔNG bị giữ bởi luật này (luật hẹp, đúng một lý do);
 *   04  đường di trú THẬT: lead nhãn «Import Excel» ⇒ kế hoạch không INVALID, ghi ra LeadAttribution nhóm UNKNOWN + signals.xemTay, KHÔNG người giới thiệu;
 *   05  `docNhomCanChuNguon` đọc chính sách ACTIVE thật: thêm rule SOURCE_OWNER ở PAID_ADS ⇒ đúng PAID_ADS được thêm vào tập.
 *
 * Chạy: `pnpm test:hoa-hong-db`. Mỗi ca tự dựng kịch bản (luật 18); ngày TUYỆT ĐỐI (luật 19).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docDuLieuDiTru, docNhomCanChuNguon, docNhomDiTru } from "../../lib/nguon/di-tru-db";
import { dungKeHoachDiTru } from "../../lib/nguon/di-tru-ke-hoach";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, ganNguon, themChinhSachNhom, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[LIE-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const LY_DO = "LEGACY_IMPORT_SOURCE_UNKNOWN";
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

/** Lead của kịch bản vào nhóm UNKNOWN với `signals` cho trước (ghi thẳng — đây là fixture, không phải đường sản phẩm). */
async function leadUnknownVoiSignals(k: KichBan, signals: Record<string, unknown> | null) {
  await ganNguon(k, "UNKNOWN");
  await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: (signals ?? undefined) as never } });
}

describe.skipIf(!RUN_DB_TESTS)("[LIE-DB] «Import Excel» legacy: không hoa hồng tới khi xử lý tay · chủ nguồn chỉ bắt buộc khi chính sách cần", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[LIE-DB-01] lead mang lý do legacy ⇒ khoản bị GIỮ ở MANUAL_REVIEW_REQUIRED (maLuat riêng), 0 dòng sổ, lý do nói rõ phải chọn nguồn", async () => {
    const k = await kb("lie01");
    await leadUnknownVoiSignals(k, { coXemTay: true, xemTay: [LY_DO], diTru: true, nhanGoc: "import excel" });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a");
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });

    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "GIU", hangCho: ["MANUAL_REVIEW_REQUIRED"] });
    expect(await db.commissionTransaction.count({ where: { paymentId: id } })).toBe(0);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id } });
    expect(hold).toMatchObject({ code: "MANUAL_REVIEW_REQUIRED", status: "OPEN", severity: "HARD" });
    const detail = hold.detail as { maLuat?: string; lyDo?: string };
    expect(detail.maLuat).toBe("NGUON_LEGACY_IMPORT_CHUA_XU_LY");
    expect(detail.lyDo).toMatch(/Excel/);
    expect(detail.lyDo).toMatch(/nguồn/);
  });

  it("[LIE-DB-02] ĐỐI CHỨNG DƯƠNG: người xử lý tay (gỡ lý do khỏi signals) ⇒ quét lại ra dòng sổ và hàng chờ tự đóng", async () => {
    const k = await kb("lie02");
    await leadUnknownVoiSignals(k, { coXemTay: true, xemTay: [LY_DO], diTru: true });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a");
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "GIU" });
    expect(await db.commissionTransaction.count({ where: { paymentId: id } })).toBe(0);

    // Đúng như `doi-nguon-lead.ts`: gỡ CẢ coXemTay lẫn xemTay khỏi signals khi người đổi nguồn.
    await db.leadAttribution.update({ where: { leadId: k.lead!.id }, data: { signals: { nhanGoc: "import excel" } } });
    const kq = await quetKhoan(db, bc, id);
    expect(kq.loai).toBe("DA_GHI");
    expect(await db.commissionTransaction.count({ where: { paymentId: id } })).toBeGreaterThan(0);
    expect(await db.commissionHold.count({ where: { paymentId: id, code: "MANUAL_REVIEW_REQUIRED", status: "OPEN" } })).toBe(0);
  });

  it("[LIE-DB-03] ĐỐI CHỨNG: lead UNKNOWN với lý do xem tay KHÁC (THIEU_NGUOI) KHÔNG bị luật này giữ — luật chỉ bắt đúng một lý do", async () => {
    const k = await kb("lie03");
    await leadUnknownVoiSignals(k, { coXemTay: true, xemTay: ["THIEU_NGUOI"], diTru: true });
    const bc = await boiCanh(k, NOW);
    const be = await dungBe(k, "a");
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    const kq = await quetKhoan(db, bc, id);
    expect(kq.loai).not.toBe("GIU");
    const hold = await db.commissionHold.findMany({ where: { paymentId: id, status: "OPEN" } });
    expect(hold.some((h) => (h.detail as { maLuat?: string } | null)?.maLuat === "NGUON_LEGACY_IMPORT_CHUA_XU_LY")).toBe(false);
  });

  it("[LIE-DB-04] di trú THẬT: lead nhãn «Import Excel» ⇒ kế hoạch không INVALID, đích UNKNOWN + xem tay, KHÔNG người giới thiệu / loại giới thiệu", async () => {
    const k = await kb("lie04");
    await db.lead.update({ where: { id: k.lead!.id }, data: { source: "Import Excel", createdAt: new Date("2026-10-15T03:00:00.000Z") } });
    const { kh } = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const kq = await docDuLieuDiTru(tx, { coBangQuyNguon: true, phamVi: { leadIds: [k.lead!.id] }, den: null });
      const nhom = await docNhomDiTru(tx);
      return { kh: dungKeHoachDiTru({ hang: kq.hang, chiTiet: kq.chiTiet, nhom, nhomCanChu: await docNhomCanChuNguon(tx, nhom), cuaSoMacDinhNgay: 90 }) };
    });
    expect(kh.tong).toMatchObject({ invalid: 0, review: 1, auto: 0, unknown: 0, ghi: 1 });
    expect(kh.dong[0]).toMatchObject({ groupCode: "UNKNOWN", loai: "MANUAL_REVIEW", referrerEmployeeId: null, referrerRoleCode: null, xemTay: [LY_DO] });
  });

  it("[LIE-DB-05] docNhomCanChuNguon đọc chính sách ACTIVE thật: thêm rule vai SOURCE_OWNER ở PAID_ADS ⇒ đúng PAID_ADS được thêm vào tập, không nguồn nào khác, không UNKNOWN", async () => {
    const k = await kb("lie05");
    const doc = () =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return [...(await docNhomCanChuNguon(tx, await docNhomDiTru(tx)))].sort();
      });
    const truoc = await doc();
    expect(truoc).not.toContain("PAID_ADS");
    await themChinhSachNhom(k, "PAID_ADS", [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
    const sau = await doc();
    expect(sau).toEqual([...new Set([...truoc, "PAID_ADS"])].sort());
    expect(sau).not.toContain("UNKNOWN");
  });
});
