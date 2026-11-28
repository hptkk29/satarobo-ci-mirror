// @vitest-environment node
/**
 * [NQH-01..NQH-03] — TÁCH NHIỆM Ở ĐƯỜNG GIẢI HÀNG CHỜ: người QUYẾT ghi sổ không được là NGƯỜI HƯỞNG của một dòng điều chỉnh sắp ghi. Postgres THẬT.
 *
 * Lỗ đo được (rà độc lập 20/10/2026): đường đề xuất điều chỉnh cấm người hưởng duyệt (`lyDoKhongDuocDuyet`) nhưng `giaiHangCho` không có cổng tương đương — người giữ `commission_periods:manage` đồng thời là
 * Sale của ô «Giải phóng» hàng chờ dưới ngưỡng hai cấp và ghi INPUT_CORRECTION vào sổ của CHÍNH MÌNH, không ai thứ hai.
 *
 * LUẬT 18: mỗi ca tự dựng hiện trường, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import type { NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, nguoiKyHo, tienVe, tuChoi, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NQH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const LY_DO = "Áp dụng theo biên bản đối chiếu với kế toán";
let NGUOI: NguoiThaoTacKy & { userId: string };
const cuaToi: KichBan[] = [];
/** Cùng QUYỀN và phạm vi của Kế toán HO nhưng là NGƯỜI KHÁC (`userId`): `giaiHangCho` không kiểm quyền chức năng — action gác — nên đủ để đóng vai «người hưởng đang giữ khoá quản lý». */
const lamNguoi = (userId: string): NguoiThaoTacKy & { userId: string } => ({ ...NGUOI, userId, ten: `người ${userId}` });

describe.skipIf(!RUN_DB_TESTS)("[NQH] người quyết ≠ người hưởng", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    NGUOI = await nguoiKyHo();
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  async function dung(ten: string) {
    const k = await dungKichBan(ten, { rules: [{ vai: "SALE", rate: 0.03 }] });
    cuaToi.push(k);
    const bc = await boiCanh(k, NOW);
    const bi = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, bi);
    return { k, bc, bi };
  }

  it("[NQH-01] PAYMENT_WITHDRAWN: Sale hưởng của ô KHÔNG tự «Giải phóng» (0 dòng, hàng chờ OPEN); đối chứng dương: người khác giải được", async () => {
    const { k, bc, bi } = await dung("nqh01");
    await tuChoi(k, bi);
    await quetKhoan(db, bc, bi);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: bi } });
    const truoc = (await dongSoCuaKhoan(bi)).length;
    await expect(giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, nguoi: lamNguoi(k.sale.id) })).rejects.toMatchObject({ ma: "NGUOI_QUYET_LA_NGUOI_HUONG" });
    expect((await dongSoCuaKhoan(bi)).length).toBe(truoc);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, nguoi: NGUOI })).toMatchObject({ loai: "DA_AP_DUNG", soDong: 1, tong: -300_000 });
  });

  it("[NQH-02] INPUT_DRIFT: cả người ĐƯỢC THÊM lẫn người BỊ THU HỒI trong chênh lệch đều không tự quyết; người ngoài chênh lệch quyết được", async () => {
    const { k, bc, bi } = await dung("nqh02");
    const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
    const ngoai = await seedUser({ email: `${k.ma}-ngoai@ci.test`, role: "SALES_CSM", name: `${k.ma}-ngoai`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
    await quetKhoan(db, bc, bi);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "INPUT_DRIFT", paymentId: bi, status: "OPEN" } });
    const truoc = (await dongSoCuaKhoan(bi)).length;
    for (const huong of [moi.id, k.sale.id]) {
      await expect(giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, nguoi: lamNguoi(huong) })).rejects.toMatchObject({ ma: "NGUOI_QUYET_LA_NGUOI_HUONG" });
    }
    expect((await dongSoCuaKhoan(bi)).length).toBe(truoc);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, nguoi: lamNguoi(ngoai.id) })).toMatchObject({ loai: "DA_AP_DUNG", soDong: 2, tong: 0 });
  });

  it("[NQH-03] XEM TRƯỚC không bị cổng chặn (nó không ghi gì): người hưởng vẫn thấy con số; chỉ bước GHI mới từ chối", async () => {
    const { k, bc, bi } = await dung("nqh03");
    await tuChoi(k, bi);
    await quetKhoan(db, bc, bi);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: bi } });
    expect(await giaiHangCho(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "", nguoi: lamNguoi(k.sale.id), xemTruoc: true })).toMatchObject({ loai: "XEM_TRUOC", tongTuyetDoi: 300_000 });
  });
});
