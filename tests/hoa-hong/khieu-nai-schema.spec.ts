// @vitest-environment node
/**
 * [NHH-DSP-SC-*] — LỚP DƯỚI CÙNG của khiếu nại: CHECK + TRIGGER + RLS của migration `20261014120000_hoa_hong_khieu_nai`, thử TRỰC TIẾP trên Postgres THẬT.
 *
 * Prisma 5 KHÔNG đọc CHECK / trigger nên kiểm drift `--from-url` không thấy chúng; service (`lib/hoa-hong/khieu-nai.ts`) chặn TRƯỚC bằng câu lỗi riêng
 * nên bộ ca của service KHÔNG chứng minh được lớp này còn sống. Ca ở đây ghi thẳng bằng Prisma/SQL, bỏ qua service, và đòi đúng TÊN ràng buộc trong lỗi
 * (một lỗi nào đó từ chối không phải bằng chứng ràng buộc nào đó còn đó).
 *
 * Đồ thị trạng thái: ĐỦ 25 cặp, viết tay — cặp cấm phải bị TRIGGER từ chối ("không đi A → B"), không phải CHECK (BEFORE trigger chạy trước CHECK, và mỗi cặp
 * được dựng với đủ cột của trạng thái đích để CHECK không phải là thứ từ chối).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import type { CommissionDisputeStatus, Prisma } from "@prisma/client";

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, ganNguon, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-DSP-SC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const ES: CommissionDisputeStatus[] = ["OPEN", "UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"];

describe.skipIf(!RUN_DB_TESTS)("[NHH-DSP-SC] khiếu nại — CHECK · trigger · RLS", () => {
  let k: KichBan;
  let dongId: string;
  let paymentId: string;
  let hrId: string;
  let hr2Id: string;
  const nguoiKn = () => k.sale.id;

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    k = await dungKichBan("dspsc");
    await ganNguon(k, "PAID_ADS");
    const pay = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), pay);
    paymentId = pay;
    dongId = (await dongSoCuaKhoan(pay)).find((d) => d.roleCode === "SALE")!.id;
    hrId = (await seedUser({ email: `${k.ma}-hr@ci.test`, role: "HR", name: "HR sc", phone: null })).id;
    hr2Id = (await seedUser({ email: `${k.ma}-hr2@ci.test`, role: "HR", name: "HR sc 2", phone: null })).id;
  }, 120_000);
  afterAll(async () => {
    await db.$executeRaw`TRUNCATE "CommissionDispute"`;
    await donKichBan([k]);
    await datMocCutover(null);
  }, 60_000);

  const goc = (extra: Partial<Prisma.CommissionDisputeUncheckedCreateInput> = {}): Prisma.CommissionDisputeUncheckedCreateInput => ({
    transactionId: dongId,
    raisedByUserId: nguoiKn(),
    reason: "Dòng hoa hồng này tính thiếu so với thoả thuận",
    evidence: [{ ghiChu: "Tin nhắn Zalo ngày 05/10 xác nhận mức hưởng" }],
    centerId: k.centerId,
    orgUnitId: k.ouId,
    ...extra,
  });

  /** Cột đủ cho MỘT trạng thái (khớp `trang_thai_chk`). */
  const cotCua = (s: CommissionDisputeStatus): Prisma.CommissionDisputeUncheckedUpdateInput => {
    const nhan = { assignedToUserId: hrId, assignedAt: NOW };
    const quyet = { decisionReason: "Đã đối chiếu hồ sơ và quyết định", decidedById: hrId, decidedAt: NOW };
    switch (s) {
      case "OPEN":
        return { status: "OPEN", assignedToUserId: null, assignedAt: null, resolution: null, decisionReason: null, decidedById: null, decidedAt: null, closedAt: null };
      case "UNDER_REVIEW":
        return { status: s, ...nhan, resolution: null, decisionReason: null, decidedById: null, decidedAt: null, closedAt: null };
      case "APPROVED":
        return { status: s, ...nhan, ...quyet, resolution: "SOURCE_CORRECTION", closedAt: null };
      case "REJECTED":
        return { status: s, ...nhan, ...quyet, resolution: null, closedAt: null };
      case "CLOSED":
        return { status: s, ...nhan, ...quyet, resolution: null, closedAt: NOW };
    }
  };
  const taoO = (s: CommissionDisputeStatus) => db.commissionDispute.create({ data: { ...goc(), ...(cotCua(s) as object) } as Prisma.CommissionDisputeUncheckedCreateInput });

  it("[NHH-DSP-SC-01] dich_chk: đúng MỘT trong (dòng sổ, khoản thu) — cả hai hoặc không cái nào đều bị từ chối", async () => {
    await expect(db.commissionDispute.create({ data: goc({ transactionId: dongId, paymentId }) })).rejects.toThrow(/dich_chk/);
    await expect(db.commissionDispute.create({ data: goc({ transactionId: null, paymentId: null }) })).rejects.toThrow(/dich_chk/);
    // đối chứng dương
    await expect(db.commissionDispute.create({ data: goc({ transactionId: null, paymentId }) })).resolves.toMatchObject({ paymentId });
    await expect(db.commissionDispute.create({ data: goc() })).resolves.toMatchObject({ transactionId: dongId });
  });

  it("[NHH-DSP-SC-02] ly_do_chk + bang_chung_chk: lý do < 10 ký tự sau trim; bằng chứng không phải MẢNG hoặc mảng rỗng", async () => {
    await expect(db.commissionDispute.create({ data: goc({ reason: "         ngắn   " }) })).rejects.toThrow(/ly_do_chk/);
    await expect(db.commissionDispute.create({ data: goc({ evidence: [] }) })).rejects.toThrow(/bang_chung_chk/);
    await expect(db.commissionDispute.create({ data: goc({ evidence: { ghiChu: "không phải mảng" } }) })).rejects.toThrow(/bang_chung_chk/);
    await expect(db.commissionDispute.create({ data: goc({ evidence: "chuỗi" }) })).rejects.toThrow(/bang_chung_chk/);
  });

  it("[NHH-DSP-SC-03] trang_thai_chk: mỗi trạng thái đòi ĐÚNG cột nó ngụ ý — thiếu hoặc thừa đều bị từ chối", async () => {
    const sai: Array<[string, Prisma.CommissionDisputeUncheckedCreateInput]> = [
      ["OPEN mà đã có người nhận", goc({ status: "OPEN", assignedToUserId: hrId })],
      ["UNDER_REVIEW thiếu người nhận", goc({ status: "UNDER_REVIEW" })],
      ["UNDER_REVIEW mà đã có quyết định", goc({ status: "UNDER_REVIEW", assignedToUserId: hrId, decidedAt: NOW, decidedById: hrId, decisionReason: "đã quyết định rồi nhé" })],
      ["APPROVED thiếu cách giải", goc({ status: "APPROVED", assignedToUserId: hrId, decidedAt: NOW, decidedById: hrId, decisionReason: "đã quyết định rồi nhé" })],
      ["APPROVED thiếu lý do quyết định", goc({ status: "APPROVED", assignedToUserId: hrId, resolution: "MONEY_ADJUSTMENT", decidedAt: NOW, decidedById: hrId })],
      ["APPROVED lý do quyết định < 10 ký tự", goc({ status: "APPROVED", assignedToUserId: hrId, resolution: "MONEY_ADJUSTMENT", decidedAt: NOW, decidedById: hrId, decisionReason: "ok" })],
      ["REJECTED mà có cách giải", goc({ status: "REJECTED", assignedToUserId: hrId, resolution: "MONEY_ADJUSTMENT", decidedAt: NOW, decidedById: hrId, decisionReason: "đã quyết định rồi nhé" })],
      ["REJECTED thiếu lý do", goc({ status: "REJECTED", assignedToUserId: hrId, decidedAt: NOW, decidedById: hrId })],
      ["CLOSED thiếu closedAt", goc({ status: "CLOSED", assignedToUserId: hrId, decidedAt: NOW, decidedById: hrId, decisionReason: "đã quyết định rồi nhé" })],
      ["CLOSED mà chưa từng được quyết", goc({ status: "CLOSED", closedAt: NOW })],
    ];
    for (const [ten, data] of sai) await expect(db.commissionDispute.create({ data }), ten).rejects.toThrow(/trang_thai_chk/);
    // đối chứng dương: đủ cột cho cả năm trạng thái ⇒ tạo được
    for (const s of ES) await expect(taoO(s), s).resolves.toMatchObject({ status: s });
  });

  it("[NHH-DSP-SC-04] khac_nguoi_chk: người nhận / người quyết KHÔNG được là người khiếu nại (lớp dưới của phép so ở service)", async () => {
    await expect(db.commissionDispute.create({ data: goc({ status: "UNDER_REVIEW", assignedToUserId: nguoiKn(), assignedAt: NOW }) })).rejects.toThrow(/khac_nguoi_chk/);
    await expect(
      db.commissionDispute.create({
        data: goc({ status: "REJECTED", assignedToUserId: hrId, decidedById: nguoiKn(), decidedAt: NOW, decisionReason: "người duyệt là người khiếu nại" }),
      }),
    ).rejects.toThrow(/khac_nguoi_chk/);
  });

  it("[NHH-DSP-SC-05] dong_dieu_chinh_chk: chỉ cách giải 'điều chỉnh tiền' mới được gắn dòng điều chỉnh", async () => {
    // dòng điều chỉnh THẬT để có id hợp lệ cho FK: dùng một dòng sổ bất kỳ (FK chỉ đòi tồn tại)
    await expect(
      db.commissionDispute.create({
        data: goc({ status: "APPROVED", assignedToUserId: hrId, resolution: "SOURCE_CORRECTION", decidedAt: NOW, decidedById: hrId, decisionReason: "đã quyết định rồi nhé", resolutionEntryId: dongId }),
      }),
    ).rejects.toThrow(/dong_dieu_chinh_chk/);
  });

  // ── ĐỒ THỊ: đủ 25 cặp ───────────────────────────────────────────────────────────────────────

  const DUOC: ReadonlyArray<[CommissionDisputeStatus, CommissionDisputeStatus]> = [
    ["OPEN", "UNDER_REVIEW"],
    ["UNDER_REVIEW", "APPROVED"],
    ["UNDER_REVIEW", "REJECTED"],
    ["APPROVED", "CLOSED"],
    ["REJECTED", "CLOSED"],
  ];

  it("[NHH-DSP-SC-06] trigger đồ thị trạng thái: 15 cặp khác nhau còn lại (nhảy cóc · lùi · APPROVED↔REJECTED · CLOSED đi tiếp) bị TRIGGER từ chối; 5 cặp hợp lệ đi được (5 cặp giữ nguyên không phải một lần chuyển)", async () => {
    let tuChoi = 0;
    let duoc = 0;
    for (const tu of ES) {
      for (const den of ES) {
        if (tu === den) continue;
        const hopLe = DUOC.some(([a, b]) => a === tu && b === den);
        const row = await taoO(tu);
        // Sang CLOSED chỉ đóng (giữ nguyên quyết định đã chốt — đổi `resolution` về NULL là sửa quyết định, trigger sẽ chặn đúng chỗ ấy).
        const dich = db.commissionDispute.update({ where: { id: row.id }, data: den === "CLOSED" ? { status: "CLOSED", closedAt: NOW } : cotCua(den) });
        if (hopLe) {
          await expect(dich, `${tu} → ${den}`).resolves.toMatchObject({ status: den });
          duoc += 1;
        } else {
          await expect(dich, `${tu} → ${den}`).rejects.toThrow(/không đi/);
          expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: row.id } })).status, `${tu} giữ nguyên sau khi bị từ chối`).toBe(tu);
          tuChoi += 1;
        }
      }
    }
    expect({ duoc, tuChoi }).toEqual({ duoc: 5, tuChoi: 15 });
  });

  it("[NHH-DSP-SC-07] quyết định đã chốt thì KHÔNG sửa lại (lý do · người quyết · cách giải) — kể cả khi trạng thái không đổi", async () => {
    const row = await taoO("APPROVED");
    await expect(db.commissionDispute.update({ where: { id: row.id }, data: { decisionReason: "Đổi lại lý do quyết định sau khi đã chốt" } })).rejects.toThrow(/đã chốt/);
    await expect(db.commissionDispute.update({ where: { id: row.id }, data: { decidedById: hr2Id } })).rejects.toThrow(/đã chốt/);
    await expect(db.commissionDispute.update({ where: { id: row.id }, data: { resolution: "MONEY_ADJUSTMENT" } })).rejects.toThrow(/đã chốt/);
    // đối chứng: GIAO LẠI (đổi người xử lý khi còn UNDER_REVIEW) vẫn được — trigger không cấm mọi UPDATE
    const dang = await taoO("UNDER_REVIEW");
    await expect(db.commissionDispute.update({ where: { id: dang.id }, data: { assignedToUserId: hr2Id } })).resolves.toMatchObject({ assignedToUserId: hr2Id });
  });

  it("[NHH-DSP-SC-08] bảng KHÔNG xoá được và có RLS; hàm + trigger tồn tại đúng tên (Prisma không đọc trigger ⇒ đây là lưới duy nhất)", async () => {
    const row = await taoO("OPEN");
    await expect(db.$executeRaw`DELETE FROM "CommissionDispute" WHERE "id" = ${row.id}`).rejects.toThrow(/không bao giờ bị xoá/);
    const rls = await db.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT c.relrowsecurity FROM pg_class c WHERE c.relname = 'CommissionDispute'`;
    expect(rls[0]?.relrowsecurity).toBe(true);
    const tg = await db.$queryRaw<{ tgname: string }[]>`
      SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'CommissionDispute' AND NOT t.tgisinternal`;
    expect(tg.map((t) => t.tgname)).toEqual(["CommissionDispute_bat_bien_bud"]);
    const ck = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE conrelid = '"CommissionDispute"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(ck.map((c) => c.conname)).toEqual([
      "CommissionDispute_bang_chung_chk",
      "CommissionDispute_dich_chk",
      "CommissionDispute_dong_dieu_chinh_chk",
      "CommissionDispute_khac_nguoi_chk",
      "CommissionDispute_ly_do_chk",
      "CommissionDispute_trang_thai_chk",
    ]);
  });
});
