// @vitest-environment node
/**
 * [DXD-*] — LỚP DƯỚI CÙNG của ĐỀ XUẤT ĐIỀU CHỈNH hoa hồng: CHECK + TRIGGER + chỉ mục từng phần + RLS của migration `20261016100000_hoa_hong_de_xuat_dieu_chinh`,
 * thử TRỰC TIẾP trên Postgres THẬT (hướng B+C, 16/10/2026). Service chặn TRƯỚC bằng câu lỗi riêng nên bộ ca của service KHÔNG chứng minh lớp này còn sống:
 * ca ở đây ghi thẳng bằng Prisma/SQL và đòi đúng TÊN ràng buộc trong lỗi.
 *
 *   [DXD-01]  khac_nguoi_chk: tách nhiệm hai cặp + cấp 2 ≠ cấp 1; đối chứng dương: ba người khác nhau ghi được
 *   [DXD-02]  trang_thai_chk: SECOND mà POSTED thiếu cấp 2 · APPROVED_L1 với SINGLE · PENDING đã có người duyệt…; đối chứng dương từng trạng thái
 *   [DXD-03]  trigger: gói/quản trị/ngưỡng bất biến; không xoá; đồ thị trạng thái; trạng thái cuối đóng băng; người duyệt đã ghi không đổi
 *   [DXD-04]  ngưỡng chụp lúc lập: sửa setting SAU không đổi snapshot; không có dòng ⇒ mặc định; hỏng (sai kiểu · sai miền · vượt INT4) ⇒ fail-closed cấp hai VÀ đề xuất vẫn lập được
 *   [DXD-05]  chỉ mục từng phần: một yêu cầu mở mỗi khiếu nại / mỗi ô; một sự kiện đổi nguồn một đề xuất mỗi ô kể cả đã bị từ chối
 *   [DXD-06]  nguon_goc_chk + goi_chk + ly_do_chk; RLS bật
 *   [DXD-V1]  `docNenQuanTri`: tích luỹ = Σ absTotal đề xuất POSTED/PENDING/APPROVED_L1 của ô (mọi nguồn gốc), KHÔNG đếm REJECTED/STALE; cận = hoa hồng GỐC (không đếm điều chỉnh); không ô ⇒ cận null
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import type { Prisma } from "@prisma/client";

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docNenQuanTri, luuDeXuat, quyetDinhQuanTriTrongTx, type GoiDong } from "../../lib/hoa-hong/de-xuat-dieu-chinh";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, ganNguon, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[DXD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
/** Khoá yêu cầu logic của các ca KHÔNG canh luật theo yêu cầu: một sự kiện đổi nguồn riêng, chưa có đề xuất anh em nào, không dự báo gói nào khác. */
const YC_RIENG = { khoa: { origin: "SOURCE_CHANGE", refEventId: "yc-rieng-khong-anh-em" }, duBaoTong: 0 } as const;

describe.skipIf(!RUN_DB_TESTS)("[DXD] đề xuất điều chỉnh — CHECK · trigger · chỉ mục · RLS", () => {
  let k: KichBan;
  let paymentId: string;
  let slotId: string;
  let dongId: string;
  let u: { kn: string; a1: string; a2: string; a3: string };
  let ban = 0;

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    k = await dungKichBan("dxd");
    await ganNguon(k, "PAID_ADS");
    paymentId = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), paymentId);
    slotId = (await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId }, select: { id: true } })).id;
    dongId = (await dongSoCuaKhoan(paymentId)).find((d) => d.roleCode === "SALE")!.id;
    const nv = async (t: string) => (await seedUser({ email: `${k.ma}-${t}@ci.test`, role: "HR", name: `HR ${t}`, phone: null })).id;
    u = { kn: k.sale.id, a1: await nv("a1"), a2: await nv("a2"), a3: await nv("a3") };
  }, 120_000);

  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
    // TRUNCATE không chạy trigger hàng (khác DELETE) — dọn được bảng bất biến; và phải cùng lúc vì đề xuất tham chiếu khiếu nại.
    await db.$executeRaw`TRUNCATE "CommissionAdjustmentRequest", "CommissionDispute"`;
    await donKichBan([k]);
    await datMocCutover(null);
  }, 60_000);

  const goi: GoiDong[] = [{ key: "SOURCE_OWNER|USER|x", chenh: 500, kyVong: 500, rong: 0 }];
  const A = (userId: string) => ({ approver1Id: userId, approver1At: NOW, approver1Reason: "Đã đối chiếu và đồng ý điều chỉnh" });
  const B = (userId: string) => ({ approver2Id: userId, approver2At: NOW, approver2Reason: "Cấp hai đã soát lại và đồng ý" });

  /** Hàng gốc ĐỔI NGUỒN hợp lệ ở PENDING. `ban` tăng để mỗi hàng một sự kiện riêng (chỉ mục su_kien). */
  const goc = (extra: Partial<Prisma.CommissionAdjustmentRequestUncheckedCreateInput> = {}): Prisma.CommissionAdjustmentRequestUncheckedCreateInput => ({
    origin: "SOURCE_CHANGE",
    leadId: k.lead!.id,
    paymentId,
    calcSlotId: slotId,
    refEventType: "ATTRIBUTION",
    refEventId: `sk-${k.ma}-${(ban += 1)}`,
    goi: goi as unknown as Prisma.InputJsonValue,
    absTotal: 500,
    netTotal: 500,
    governance: "SECOND_APPROVAL_REQUIRED",
    governanceWhy: { lyDo: [] },
    thresholdSnapshot: 1_000,
    boundSnapshot: 10_000,
    requestedById: u.kn,
    centerId: k.centerId,
    orgUnitId: k.ouId,
    ...extra,
  });
  /** Dọn các hàng đang MỞ của ô (chỉ mục từng phần sẽ chặn ca sau) — trigger tạm tắt, CHỈ trong test. */
  const don = async () => {
    await db.$executeRaw`TRUNCATE "CommissionAdjustmentRequest"`;
  };

  it("[DXD-01] khac_nguoi_chk: cấp 1 ≠ người đề xuất; cấp 2 ≠ người đề xuất và ≠ cấp 1; đối chứng dương", async () => {
    await don();
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ status: "APPROVED_L1", ...A(u.kn) }) })).rejects.toThrow(/khac_nguoi_chk/);
    await expect(
      db.commissionAdjustmentRequest.create({ data: goc({ status: "POSTED", ...A(u.a1), ...B(u.kn), postedEntryIds: [], postingPeriodId: (await kyId()) }) }),
    ).rejects.toThrow(/khac_nguoi_chk/);
    await expect(
      db.commissionAdjustmentRequest.create({ data: goc({ status: "POSTED", ...A(u.a1), ...B(u.a1), postedEntryIds: [], postingPeriodId: (await kyId()) }) }),
    ).rejects.toThrow(/khac_nguoi_chk/);
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ status: "REJECTED", rejectedById: u.kn, rejectedAt: NOW, rejectedReason: "Người bị từ chối chính mình" }) })).rejects.toThrow(/khac_nguoi_chk/);
    // đối chứng dương: ba người khác nhau
    await expect(
      db.commissionAdjustmentRequest.create({ data: goc({ status: "POSTED", ...A(u.a1), ...B(u.a2), postedEntryIds: [], postingPeriodId: await kyId() }) }),
    ).resolves.toMatchObject({ status: "POSTED" });
  });

  async function kyId(): Promise<string> {
    return (await db.commissionPeriod.findFirstOrThrow({ where: { centerId: k.centerId }, select: { id: true } })).id;
  }

  it("[DXD-02] trang_thai_chk: mỗi trạng thái đòi đúng cột của nó", async () => {
    await don();
    const ky = await kyId();
    const sai: Array<[string, Prisma.CommissionAdjustmentRequestUncheckedCreateInput]> = [
      ["PENDING mà đã có người duyệt cấp 1", goc({ status: "PENDING", ...A(u.a1) })],
      ["APPROVED_L1 thiếu người duyệt cấp 1", goc({ status: "APPROVED_L1" })],
      ["APPROVED_L1 với SINGLE_APPROVAL (một người thì không có cấp 2 để chờ)", goc({ governance: "SINGLE_APPROVAL", status: "APPROVED_L1", ...A(u.a1) })],
      ["APPROVED_L1 mà đã có cấp 2", goc({ status: "APPROVED_L1", ...A(u.a1), ...B(u.a2) })],
      ["POSTED với SECOND mà THIẾU cấp 2", goc({ status: "POSTED", ...A(u.a1), postedEntryIds: [], postingPeriodId: ky })],
      ["POSTED thiếu danh sách dòng đã ghi", goc({ governance: "SINGLE_APPROVAL", status: "POSTED", ...A(u.a1), postingPeriodId: ky })],
      ["POSTED thiếu kỳ ghi sổ", goc({ governance: "SINGLE_APPROVAL", status: "POSTED", ...A(u.a1), postedEntryIds: [] })],
      ["REJECTED thiếu người từ chối", goc({ status: "REJECTED" })],
      ["REJECTED mà có dòng đã ghi", goc({ status: "REJECTED", rejectedById: u.a1, rejectedAt: NOW, rejectedReason: "Không đồng ý điều chỉnh này", postedEntryIds: [] })],
      ["STALE thiếu lý do", goc({ status: "STALE" })],
    ];
    for (const [ten, data] of sai) await expect(db.commissionAdjustmentRequest.create({ data }), ten).rejects.toThrow(/trang_thai_chk/);
    // đối chứng dương từng trạng thái
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ status: "PENDING" }) })).resolves.toMatchObject({ status: "PENDING" });
    await don();
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ status: "APPROVED_L1", ...A(u.a1) }) })).resolves.toMatchObject({ status: "APPROVED_L1" });
    await don();
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ governance: "SINGLE_APPROVAL", status: "POSTED", ...A(u.a1), postedEntryIds: [], postingPeriodId: ky }) })).resolves.toMatchObject({ status: "POSTED" });
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ status: "REJECTED", rejectedById: u.a1, rejectedAt: NOW, rejectedReason: "Không đồng ý điều chỉnh này" }) })).resolves.toMatchObject({ status: "REJECTED" });
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ status: "STALE", closeReason: "Số ròng đã đổi giữa hai lần duyệt" }) })).resolves.toMatchObject({ status: "STALE" });
  });

  it("[DXD-03] trigger: gói · quản trị · ngưỡng bất biến; không xoá; trạng thái cuối đóng băng; người duyệt đã ghi không đổi; đồ thị", async () => {
    await don();
    const r = await db.commissionAdjustmentRequest.create({ data: goc({ status: "APPROVED_L1", ...A(u.a1) }) });
    const sua = (data: Prisma.CommissionAdjustmentRequestUncheckedUpdateInput) => db.commissionAdjustmentRequest.update({ where: { id: r.id }, data });
    await expect(sua({ goi: [{ key: "x", chenh: 999999, kyVong: 1, rong: 0 }] })).rejects.toThrow(/bất biến/);
    await expect(sua({ governance: "SINGLE_APPROVAL" })).rejects.toThrow(/bất biến/);
    await expect(sua({ thresholdSnapshot: 999_999_999 })).rejects.toThrow(/bất biến/);
    await expect(sua({ boundSnapshot: null })).rejects.toThrow(/bất biến/);
    await expect(sua({ absTotal: 1 })).rejects.toThrow(/bất biến/);
    await expect(sua({ requestedById: u.a3 })).rejects.toThrow(/bất biến/);
    await expect(sua({ approver1Id: u.a3 })).rejects.toThrow(/Người duyệt đã ghi/);
    await expect(db.commissionAdjustmentRequest.delete({ where: { id: r.id } })).rejects.toThrow(/không bao giờ bị xoá/);
    // đồ thị: APPROVED_L1 → PENDING bị cấm
    await expect(sua({ status: "PENDING", approver1Id: null, approver1At: null, approver1Reason: null })).rejects.toThrow(/Người duyệt đã ghi|không đi/);
    // đi đúng: APPROVED_L1 → POSTED, rồi đóng băng
    const ky = await kyId();
    await sua({ status: "POSTED", ...B(u.a2), postedEntryIds: [], postingPeriodId: ky });
    await expect(sua({ closeReason: "x" })).rejects.toThrow(/trạng thái cuối/);
    await expect(sua({ status: "STALE", closeReason: "muộn rồi" })).rejects.toThrow(/trạng thái cuối/);
  });

  it("[DXD-04] ngưỡng CHỤP lúc lập: sửa setting sau không đổi; không có dòng ⇒ mặc định (không ép cấp hai); dòng hỏng ⇒ fail-closed cấp hai", async () => {
    await don();
    const nho: GoiDong[] = [{ key: "SOURCE_OWNER|USER|x", chenh: 500, kyVong: 500, rong: 0 }];
    // không có dòng setting ⇒ mặc định của registry (10.000.000) ⇒ 500đ là MỘT người
    await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
    const macDinh = await db.$transaction((tx) => quyetDinhQuanTriTrongTx(tx, { goi: nho, calcSlotId: slotId, yeuCau: YC_RIENG, canhBao: [] }));
    expect(macDinh.nguong).toEqual({ nguong: 10_000_000, nguon: "MAC_DINH" });
    expect(macDinh.quanTri).toBe("SINGLE_APPROVAL");

    // admin đặt ngưỡng 400 ⇒ 500đ phải cấp hai; snapshot ghi 400
    await db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: 400 }, create: { key: KHOA_NGUONG, valueJson: 400 } });
    const qd = await db.$transaction((tx) => quyetDinhQuanTriTrongTx(tx, { goi: nho, calcSlotId: slotId, yeuCau: YC_RIENG, canhBao: [] }));
    expect(qd.nguong).toEqual({ nguong: 400, nguon: "SETTING" });
    expect(qd.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    const { id } = await db.$transaction((tx) =>
      luuDeXuat(tx, {
        origin: "SOURCE_CHANGE", disputeId: null, leadId: k.lead!.id, paymentId, calcSlotId: slotId, refEventType: "ATTRIBUTION", refEventId: `snap-${k.ma}`,
        goi: nho, qd, canhBao: [], requestedById: u.kn, centerId: k.centerId, orgUnitId: k.ouId, holdId: null, trangThai: { loai: "CHO_DUYET" },
      }),
    );
    // sửa setting về 1 tỷ: hàng ĐÃ LẬP vẫn mang 400 và vẫn cấp hai
    await db.systemSetting.update({ where: { key: KHOA_NGUONG }, data: { valueJson: 1_000_000_000 } });
    const sau = await db.commissionAdjustmentRequest.findUniqueOrThrow({ where: { id } });
    expect(sau.thresholdSnapshot).toBe(400);
    expect(sau.governance).toBe("SECOND_APPROVAL_REQUIRED");
    // cận chụp = hoa hồng GỐC engine tính cho ô (Σ ORIGINAL/LATE_ARRIVAL/REVERSAL), không phải số gõ tay
    const canGoc = (await db.commissionTransaction.aggregate({ where: { calcSlotId: slotId, entryKind: { in: ["ORIGINAL", "LATE_ARRIVAL", "REVERSAL"] } }, _sum: { amount: true } }))._sum.amount!;
    expect(canGoc).toBeGreaterThan(500);
    expect(sau.boundSnapshot).toBe(canGoc);

    // dòng hỏng (sai kiểu / âm / không nguyên) ⇒ null ⇒ cấp hai dù số bé
    // — kể cả: chuỗi số "10000000" · đối tượng · mảng · boolean · số vượt cột INT4 (3 tỷ, 100 tỷ — trần CŨ của registry cho qua 100 tỷ): hỏng hình dạng/miền thì ngưỡng = null, KHÔNG ngầm hiểu.
    const hongCa = ["mười triệu", -5, 1.5, null, "10000000", { a: 1 }, [10_000_000], true, 3_000_000_000, 100_000_000_000];
    for (const hong of hongCa) {
      await db.$executeRaw`UPDATE "SystemSetting" SET "valueJson" = ${JSON.stringify(hong)}::jsonb WHERE "key" = ${KHOA_NGUONG}`;
      const h = await db.$transaction((tx) => quyetDinhQuanTriTrongTx(tx, { goi: nho, calcSlotId: slotId, yeuCau: YC_RIENG, canhBao: [] }));
      expect(h.nguong, JSON.stringify(hong)).toEqual({ nguong: null, nguon: "HONG" });
      expect(h.quanTri, JSON.stringify(hong)).toBe("SECOND_APPROVAL_REQUIRED");
      expect(h.lyDo.map((l) => l.ma), JSON.stringify(hong)).toContain("NGUONG_KHONG_DOC_DUOC");
    }
    await don(); // đề xuất `snap-` ở trên đang MỞ trên ô — chỉ mục từng phần sẽ chặn đề xuất thứ hai
    // ngưỡng hỏng KHÔNG làm đề xuất nổ lỗi: vẫn lập được, snapshot null, cấp hai (đối chứng với trần INT4: nếu để 3 tỷ lọt, chụp snapshot ném "out of range for type integer")
    await db.$executeRaw`UPDATE "SystemSetting" SET "valueJson" = ${JSON.stringify(3_000_000_000)}::jsonb WHERE "key" = ${KHOA_NGUONG}`;
    const qdHong = await db.$transaction((tx) => quyetDinhQuanTriTrongTx(tx, { goi: nho, calcSlotId: slotId, yeuCau: { khoa: { origin: "SOURCE_CHANGE", refEventId: `hong-${k.ma}` }, duBaoTong: 0 }, canhBao: [] }));
    const luuHong = await db.$transaction((tx) =>
      luuDeXuat(tx, {
        origin: "SOURCE_CHANGE", disputeId: null, leadId: k.lead!.id, paymentId, calcSlotId: slotId, refEventType: "ATTRIBUTION", refEventId: `hong-${k.ma}`,
        goi: nho, qd: qdHong, canhBao: [], requestedById: u.kn, centerId: k.centerId, orgUnitId: k.ouId, holdId: null, trangThai: { loai: "CHO_DUYET" },
      }),
    );
    expect(await db.commissionAdjustmentRequest.findUniqueOrThrow({ where: { id: luuHong.id } })).toMatchObject({ governance: "SECOND_APPROVAL_REQUIRED", thresholdSnapshot: null });
    // đối chứng dương: ngưỡng hợp lệ sát trần INT4 được CHỤP nguyên vẹn
    await don();
    await db.$executeRaw`UPDATE "SystemSetting" SET "valueJson" = ${JSON.stringify(2_147_483_647)}::jsonb WHERE "key" = ${KHOA_NGUONG}`;
    expect((await db.$transaction((tx) => quyetDinhQuanTriTrongTx(tx, { goi: nho, calcSlotId: slotId, yeuCau: YC_RIENG, canhBao: [] }))).nguong).toEqual({ nguong: 2_147_483_647, nguon: "SETTING" });
  });

  it("[DXD-05] chỉ mục từng phần: một yêu cầu MỞ mỗi khiếu nại / mỗi ô; một sự kiện đổi nguồn một đề xuất mỗi ô, kể cả đã bị từ chối", async () => {
    await don();
    // — đổi nguồn: một đề xuất mở mỗi ô
    const sk = `su-kien-${k.ma}`;
    await db.commissionAdjustmentRequest.create({ data: goc({ refEventId: sk }) });
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ refEventId: `${sk}-khac` }) })).rejects.toThrow(/Unique constraint failed[\s\S]*calcSlotId/);
    // đóng đề xuất đầu (REJECTED) ⇒ ô mở lại được cho SỰ KIỆN KHÁC, nhưng CÙNG sự kiện thì không
    await db.commissionAdjustmentRequest.updateMany({ where: { refEventId: sk }, data: { status: "REJECTED", rejectedById: u.a1, rejectedAt: NOW, rejectedReason: "Không đồng ý điều chỉnh này" } });
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ refEventId: sk }) })).rejects.toThrow(/Unique constraint failed[\s\S]*calcSlotId[\s\S]*refEventId/);
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ refEventId: `${sk}-khac` }) })).resolves.toMatchObject({ status: "PENDING" });

    // — khiếu nại: một yêu cầu mở mỗi khiếu nại (calcSlotId có thể NULL nên khoá theo khiếu nại, không theo ô)
    const kn = await db.commissionDispute.create({
      data: { transactionId: dongId, raisedByUserId: u.kn, reason: "Dòng hoa hồng này tính thiếu so với thoả thuận", evidence: [{ ghiChu: "Tin nhắn Zalo xác nhận mức hưởng" }], centerId: k.centerId, orgUnitId: k.ouId },
    });
    const dispute = (extra: Partial<Prisma.CommissionAdjustmentRequestUncheckedCreateInput> = {}) =>
      goc({ origin: "DISPUTE", disputeId: kn.id, leadId: null, calcSlotId: null, refEventType: "DISPUTE", refEventId: kn.id, ...extra });
    await db.commissionAdjustmentRequest.create({ data: dispute({ status: "APPROVED_L1", ...A(u.a1) }) });
    await expect(db.commissionAdjustmentRequest.create({ data: dispute({ status: "APPROVED_L1", ...A(u.a2) }) })).rejects.toThrow(/Unique constraint failed[\s\S]*disputeId/);
  });

  it("[DXD-V1] docNenQuanTri: tích luỹ = Σ absTotal đề xuất POSTED/PENDING/APPROVED_L1 của ô (mọi nguồn gốc), KHÔNG đếm REJECTED/STALE; cận = hoa hồng GỐC; không ô ⇒ cận null", async () => {
    await don();
    const ky = await kyId();
    // đối chứng ban đầu: ô chưa có đề xuất nào ⇒ tích luỹ 0, cận > 0 (đã có dòng ORIGINAL)
    const truoc = await db.$transaction((tx) => docNenQuanTri(tx, slotId, YC_RIENG.khoa));
    expect(truoc.tichLuy).toBe(0);
    expect(truoc.canGoc).toBeGreaterThan(0);

    // POSTED 300 (đổi nguồn) — đếm
    await db.commissionAdjustmentRequest.create({ data: goc({ governance: "SINGLE_APPROVAL", status: "POSTED", ...A(u.a1), postedEntryIds: [], postingPeriodId: ky, absTotal: 300 }) });
    // REJECTED 1000 và STALE 2000 (đổi nguồn) — KHÔNG đếm
    await db.commissionAdjustmentRequest.create({ data: goc({ absTotal: 1_000, status: "REJECTED", rejectedById: u.a1, rejectedAt: NOW, rejectedReason: "Không đồng ý điều chỉnh này" }) });
    await db.commissionAdjustmentRequest.create({ data: goc({ absTotal: 2_000, status: "STALE", closeReason: "Số ròng đã đổi giữa hai lần duyệt" }) });
    // PENDING 200 (đổi nguồn, đang mở) — đếm
    await db.commissionAdjustmentRequest.create({ data: goc({ absTotal: 200, status: "PENDING" }) });
    // APPROVED_L1 100 của KHIẾU NẠI trên cùng ô — đếm (khác nguồn gốc vẫn cùng giao dịch)
    const kn = await db.commissionDispute.create({
      data: { transactionId: dongId, raisedByUserId: u.kn, reason: "Dòng hoa hồng này tính thiếu so với thoả thuận", evidence: [{ ghiChu: "Tin nhắn Zalo xác nhận mức hưởng" }], centerId: k.centerId, orgUnitId: k.ouId },
    });
    await db.commissionAdjustmentRequest.create({
      data: goc({ origin: "DISPUTE", disputeId: kn.id, leadId: null, refEventType: "DISPUTE", refEventId: kn.id, absTotal: 100, status: "APPROVED_L1", ...A(u.a1) }),
    });
    const sau = await db.$transaction((tx) => docNenQuanTri(tx, slotId, YC_RIENG.khoa));
    expect(sau.tichLuy).toBe(600);
    expect(sau.canGoc).toBe(truoc.canGoc); // điều chỉnh đề xuất không nâng cận
    // không có ô ⇒ không có cận (⇒ cấp hai) và không có tích luỹ
    expect(await db.$transaction((tx) => docNenQuanTri(tx, null, YC_RIENG.khoa))).toEqual({ canGoc: null, tichLuy: 0, tichLuyAnhEm: 0 });
    // ô khác (không có đề xuất) không bị lẫn tích luỹ
    expect((await db.$transaction((tx) => docNenQuanTri(tx, "khong-ton-tai", YC_RIENG.khoa))).tichLuy).toBe(0);
  });

  it("[DXD-06] nguon_goc_chk · goi_chk · ly_do_chk; RLS bật", async () => {
    await don();
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ origin: "DISPUTE", disputeId: null }) })).rejects.toThrow(/nguon_goc_chk/);
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ leadId: null }) })).rejects.toThrow(/nguon_goc_chk/);
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ calcSlotId: null }) })).rejects.toThrow(/nguon_goc_chk/);
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ goi: [] }) })).rejects.toThrow(/goi_chk/);
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ goi: { khong: "phai mang" } }) })).rejects.toThrow(/goi_chk/);
    await expect(db.commissionAdjustmentRequest.create({ data: goc({ status: "APPROVED_L1", ...A(u.a1), approver1Reason: "ngắn quá" }) })).rejects.toThrow(/ly_do_chk/);
    const rls = await db.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'CommissionAdjustmentRequest'`;
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
  });
});
