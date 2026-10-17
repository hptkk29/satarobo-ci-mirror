// @vitest-environment node
/**
 * [YC-*] — NGƯỠNG HAI CẤP TÍNH THEO YÊU CẦU LOGIC (08 §17.v4.Q), trên Postgres THẬT.
 *
 * Chủ dự án chốt (17/10/2026): không cho chia một điều chỉnh lớn thành nhiều điều chỉnh nhỏ để né duyệt cấp hai. Ví dụ 3 điều chỉnh 4tr+4tr+4tr cùng MỘT yêu cầu logic = 12tr ⇒ cấp hai khi ngưỡng 10tr.
 * Phạm vi gom: CÙNG khiếu nại (`disputeId`) hoặc CÙNG sự kiện đổi nguồn (`refEventId`). KHÔNG gom theo lead / học viên.
 *
 * Số trong ca này scale xuống (ngưỡng 250.000, mỗi ô +100.000 = 1% × 10tr) — cùng hình dạng 4+4+4 / 10 mà dựng bằng hàm ghi thật rẻ hơn.
 *
 *   [YC-01] MỘT sự kiện đổi nguồn chạm BA ô: mỗi ô +100.000 < 250.000 và tích luỹ ô = 0, tổng 300.000 ≥ 250.000 ⇒ CẢ BA đề xuất cấp hai, mã TU_NGUONG_YEU_CAU (không phải VUOT_CAN / TU_NGUONG của ô)
 *   [YC-02] ĐỐI CHỨNG DƯƠNG: BA sự kiện KHÁC nhau (ba lead), mỗi cái một ô +100.000 ⇒ cả ba vẫn MỘT người; tổng yêu cầu ghi đúng 100.000; một sự kiện hai ô (200.000 < ngưỡng) cũng MỘT người
 *   [YC-03] gói anh em ĐÃ CÓ trong DB (đang mở) được cộng dù dự báo bằng 0; REJECTED / STALE KHÔNG được đếm (đối chứng dương)
 *   [YC-04] khiếu nại: anh em cùng `disputeId` ở ô KHÁC được cộng; khiếu nại khác thì không; trùng chuỗi id nhưng KHÁC nguồn gốc cũng không
 *   [YC-05] chạy lại cùng sự kiện không đẻ thêm đề xuất và không đổi mức đã chụp
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import type { Prisma } from "@prisma/client";

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import type { Actor } from "../../lib/auth/actor";
import { apDungDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { duyetDeXuat } from "../../lib/hoa-hong/duyet-de-xuat";
import { quyetDinhQuanTriTrongTx } from "../../lib/hoa-hong/de-xuat-dieu-chinh";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { doiNguonLead, type KiemQuyen } from "../../lib/nguon/doi-nguon-lead";
import { damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, ganNguon, nguoiKyHo, themChinhSachNhom, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[YC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
const NGUONG = 250_000;

const CO_SAU: KiemQuyen = async (action) => action === "sources:override-after-payment";
const actorCoSo = (userId: string, centerId: string) =>
  ({ userId, isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor;

describe.skipIf(!RUN_DB_TESTS)("[YC] ngưỡng hai cấp theo yêu cầu logic", () => {
  const cuaToi: KichBan[] = [];
  let NGUOI: Awaited<ReturnType<typeof nguoiKyHo>>;

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    NGUOI = await nguoiKyHo();
    await db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: NGUONG }, create: { key: KHOA_NGUONG, valueJson: NGUONG } });
  }, 120_000);
  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
    // TRUNCATE không chạy trigger hàng: dọn được bảng bất biến (đề xuất tham chiếu khiếu nại nên phải cùng lúc).
    await db.$executeRaw`TRUNCATE "CommissionAdjustmentRequest", "CommissionDispute"`;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  /** Lead PAID_ADS có `soKhoan` khoản thu 10tr (mỗi khoản một bé ⇒ một ô), rồi ĐỔI NGUỒN sang PARENT_REFERRAL 1% (đúng quyền) ⇒ mỗi ô +100.000 cho người giới thiệu. */
  async function dungSuKien(ten: string, soKhoan: number) {
    const k = await dungKichBan(ten, { rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    const nhom = await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS");
    const bc = await boiCanh(k, NOW);
    const khoan: string[] = [];
    for (let i = 0; i < soKhoan; i++) {
      const id = await tienVe(k, await dungBe(k, `b${i}`), { soTien: 10_000_000, ngay: D(`2026-10-1${i + 1}`) });
      await quetKhoan(db, bc, id);
      khoan.push(id);
    }
    const nguoiDoi = await seedUser({ email: `${k.ma}-doi-nguon@ci.test`, role: "SALES_CSM", name: `${k.ma}-doi-nguon`, phone: null });
    const kq = await doiNguonLead({
      actor: actorCoSo(nguoiDoi.id, k.centerId),
      actorName: "Người đổi",
      kiemQuyen: CO_SAU,
      leadId: k.lead!.id,
      groupId: nhom.PARENT_REFERRAL,
      thamChieu: { employeeId: null, parentUserId: ph.id, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Phụ huynh xác nhận người giới thiệu sau khi đóng tiền",
      bayGio: NOW,
    });
    expect(kq).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    const ev = await db.domainEvent.findFirstOrThrow({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${k.lead!.id}:` } } });
    return { k, bc, khoan, ev, nguoiDoi: nguoiDoi.id, ph };
  }

  const dxCua = (paymentId: string) => db.commissionAdjustmentRequest.findFirstOrThrow({ where: { paymentId, origin: "SOURCE_CHANGE" }, orderBy: { createdAt: "desc" } });
  const maLyDo = (why: unknown) => ((why as { lyDo: { ma: string }[] }).lyDo ?? []).map((l) => l.ma);

  it("[YC-01] MỘT sự kiện đổi nguồn chạm BA ô, mỗi ô dưới ngưỡng, tổng ≥ ngưỡng ⇒ CẢ BA đề xuất cấp hai, mã TU_NGUONG_YEU_CAU; sổ chưa đổi; cấp 1 chưa ghi, cấp 2 ghi", async () => {
    // Cấy: bỏ `duBaoTongYeuCau` ⇒ hai đề xuất đầu SINGLE · bỏ `tichLuyAnhEm` ⇒ chỉ cái cuối cấp hai · bỏ nhánh TU_NGUONG_YEU_CAU ở hàm thuần ⇒ cả ba SINGLE.
    const { k, bc, khoan, ev, nguoiDoi } = await dungSuKien("yc01", 3);
    const kq = await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi });
    expect(kq.theoKetQua).toEqual({ DE_XUAT: 3 });
    for (const id of khoan) {
      const dx = await dxCua(id);
      expect(dx, id).toMatchObject({ absTotal: 100_000, governance: "SECOND_APPROVAL_REQUIRED", thresholdSnapshot: NGUONG, status: "PENDING", requestedById: nguoiDoi, refEventId: ev.id });
      // lý do ĐÚNG là luật theo yêu cầu: không phải cận (gốc 400.000 > 100.000), không phải tích luỹ ô (0)
      expect(maLyDo(dx.governanceWhy), id).toEqual(["TU_NGUONG_YEU_CAU"]);
      expect(dx.governanceWhy, id).toMatchObject({ tichLuy: 0, tongYeuCau: 300_000 });
    }
    expect(await db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: { in: khoan } } } })).toBe(0);
    // cấp 1 không ghi sổ; cùng người cấp 2 bị chặn; người khác cấp 2 ghi
    const dx0 = await dxCua(khoan[0]!);
    expect(await duyetDeXuat(db, bc, { requestId: dx0.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Cấp 1 đã đối chiếu nguồn mới của sự kiện" })).toMatchObject({ loai: "DA_DUYET_CAP_1" });
    expect(await db.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: khoan[0] } } })).toBe(0);
    await expect(duyetDeXuat(db, bc, { requestId: dx0.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Cấp 1 tự duyệt cấp 2 của chính mình" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
  });

  it("[YC-02] ĐỐI CHỨNG DƯƠNG: BA sự kiện KHÁC nhau (ba lead), mỗi cái MỘT ô +100.000 ⇒ cả ba vẫn MỘT người; tổng yêu cầu của mỗi cái là 100.000, không dồn vào nhau", async () => {
    for (const ten of ["yc02a", "yc02b", "yc02c"]) {
      const { k, bc, khoan, ev, nguoiDoi } = await dungSuKien(ten, 1);
      expect((await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi })).theoKetQua).toEqual({ DE_XUAT: 1 });
      const dx = await dxCua(khoan[0]!);
      expect(dx, ten).toMatchObject({ absTotal: 100_000, governance: "SINGLE_APPROVAL", thresholdSnapshot: NGUONG });
      expect(maLyDo(dx.governanceWhy), ten).toEqual([]);
      expect(dx.governanceWhy, ten).toMatchObject({ tongYeuCau: 100_000 });
    }
    // Biên dưới của MỘT sự kiện nhiều ô: hai ô × 100.000 = 200.000 < 250.000 ⇒ cả hai vẫn MỘT người (luật theo yêu cầu không đẩy mọi sự kiện nhiều ô lên cấp hai).
    const { k, bc, khoan, ev, nguoiDoi } = await dungSuKien("yc02d", 2);
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi });
    for (const id of khoan) expect((await dxCua(id)).governance, id).toBe("SINGLE_APPROVAL");
  });

  it("[YC-03] gói anh em ĐÃ CÓ trong DB (đang mở) được cộng dù dự báo = 0; anh em REJECTED / STALE KHÔNG được đếm (đối chứng dương)", async () => {
    // Cấy: bỏ `tichLuyAnhEm` khỏi max ⇒ giai đoạn 1 SINGLE ⇒ đỏ · đếm cả REJECTED/STALE ⇒ giai đoạn 2 SECOND ⇒ đỏ · lọc sai nguồn gốc/`refEventId` ở `docNenQuanTri` ⇒ đỏ.
    const { k, bc, khoan, nguoiDoi } = await dungSuKien("yc03", 5);
    const [a, b, c, d, e] = khoan as [string, string, string, string, string];
    const slotCua = async (paymentId: string) => (await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId }, select: { id: true } })).id;
    const anhEm = async (paymentId: string, refEventId: string, absTotal: number, tt: Partial<Prisma.CommissionAdjustmentRequestUncheckedCreateInput>) => {
      const goi = [{ key: "REFERRER_PARENT|USER|x", chenh: absTotal, kyVong: absTotal, rong: 0 }];
      await db.commissionAdjustmentRequest.create({
        data: {
          origin: "SOURCE_CHANGE", leadId: k.lead!.id, paymentId, calcSlotId: await slotCua(paymentId), refEventType: "ATTRIBUTION", refEventId,
          goi: goi as unknown as Prisma.InputJsonValue, absTotal, netTotal: absTotal, governance: "SINGLE_APPROVAL", governanceWhy: { lyDo: [] }, thresholdSnapshot: NGUONG, boundSnapshot: 400_000,
          requestedById: nguoiDoi, centerId: k.centerId, orgUnitId: k.ouId, ...tt,
        },
      });
    };
    const quet = (paymentId: string, refEventId: string) => quetKhoan(db, bc, paymentId, { cheDo: "DE_XUAT_DOI_NGUON", refEventId, requestedById: nguoiDoi, duBaoTongYeuCau: 0 });

    // Giai đoạn 1 — sự kiện R1: một anh em đang MỞ 200.000 ở ô a ⇒ ô b (100.000) thấy 300.000 ≥ 250.000 ⇒ cấp hai
    await anhEm(a, "yc03-R1", 200_000, { status: "PENDING" });
    expect(await quet(b, "yc03-R1")).toMatchObject({ loai: "DE_XUAT", quanTri: "SECOND_APPROVAL_REQUIRED" });
    const dxB = await dxCua(b);
    expect(maLyDo(dxB.governanceWhy)).toEqual(["TU_NGUONG_YEU_CAU"]);
    expect(dxB.governanceWhy).toMatchObject({ tongYeuCau: 300_000, tichLuy: 0 });

    // Giai đoạn 2 — sự kiện R2: anh em REJECTED 200.000 (ô c) và STALE 200.000 (ô d) KHÔNG đếm ⇒ ô e một mình 100.000 ⇒ MỘT người
    await anhEm(c, "yc03-R2", 200_000, { status: "REJECTED", rejectedById: NGUOI.userId, rejectedAt: NOW, rejectedReason: "Không đồng ý điều chỉnh này" });
    await anhEm(d, "yc03-R2", 200_000, { status: "STALE", closeReason: "Số ròng đã đổi giữa hai lần duyệt" });
    expect(await quet(e, "yc03-R2")).toMatchObject({ loai: "DE_XUAT", quanTri: "SINGLE_APPROVAL" });
    expect((await dxCua(e)).governanceWhy).toMatchObject({ tongYeuCau: 100_000 });
  });

  it("[YC-04] khiếu nại: anh em cùng `disputeId` ở ô KHÁC được cộng; khiếu nại khác thì không; id trùng chuỗi nhưng KHÁC nguồn gốc cũng không", async () => {
    const { k, khoan, nguoiDoi } = await dungSuKien("yc04", 2);
    const [a, b] = khoan as [string, string];
    const slot = async (paymentId: string) => (await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId }, select: { id: true } })).id;
    const dong = await db.commissionTransaction.findFirstOrThrow({ where: { paymentId: a }, select: { id: true } });
    const khieuNai = () =>
      db.commissionDispute.create({
        data: { transactionId: dong.id, raisedByUserId: k.sale.id, reason: "Dòng hoa hồng này tính thiếu so với thoả thuận", evidence: [{ ghiChu: "Tin nhắn Zalo xác nhận mức hưởng" }], centerId: k.centerId, orgUnitId: k.ouId },
      });
    const kn = await khieuNai();
    // POSTED (không vướng chỉ mục "một yêu cầu MỞ mỗi khiếu nại") 200.000 ở ô a, cùng khiếu nại
    const ky = await db.commissionPeriod.findFirstOrThrow({ where: { centerId: k.centerId }, select: { id: true } });
    await db.commissionAdjustmentRequest.create({
      data: {
        origin: "DISPUTE", disputeId: kn.id, leadId: null, paymentId: a, calcSlotId: await slot(a), refEventType: "DISPUTE", refEventId: kn.id,
        goi: [{ key: "SALE|USER|x", chenh: 200_000, kyVong: 200_000, rong: 0 }] as unknown as Prisma.InputJsonValue, absTotal: 200_000, netTotal: 200_000, governance: "SINGLE_APPROVAL",
        governanceWhy: { lyDo: [] }, thresholdSnapshot: NGUONG, boundSnapshot: 400_000, requestedById: k.sale.id, centerId: k.centerId, orgUnitId: k.ouId,
        status: "POSTED", approver1Id: nguoiDoi, approver1At: NOW, approver1Reason: "Đã đối chiếu và đồng ý điều chỉnh", postedEntryIds: [], postingPeriodId: ky.id,
      },
    });
    const goi = [{ key: "SALE|USER|y", chenh: 100_000, kyVong: 100_000, rong: 0 }];
    const quyet = (khoa: Parameters<typeof quyetDinhQuanTriTrongTx>[1]["yeuCau"]["khoa"], slotId: string) =>
      db.$transaction((tx) => quyetDinhQuanTriTrongTx(tx, { goi, calcSlotId: slotId, yeuCau: { khoa, duBaoTong: 0 }, canhBao: [] }));
    const slotB = await slot(b);
    // cùng khiếu nại, ô khác ⇒ 200.000 + 100.000 ≥ 250.000 ⇒ cấp hai, mã theo YÊU CẦU
    const cung = await quyet({ origin: "DISPUTE", disputeId: kn.id }, slotB);
    expect(cung.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(cung.lyDo.map((l) => l.ma)).toEqual(["TU_NGUONG_YEU_CAU"]);
    expect(cung.tongYeuCau).toBe(300_000);
    // khiếu nại KHÁC ⇒ không cộng ⇒ một người (đối chứng dương)
    const kn2 = await khieuNai();
    const khac = await quyet({ origin: "DISPUTE", disputeId: kn2.id }, slotB);
    expect(khac.quanTri).toBe("SINGLE_APPROVAL");
    expect(khac.tongYeuCau).toBe(100_000);
    // khoá đổi nguồn mang đúng chuỗi id khiếu nại: KHÁC nguồn gốc ⇒ không cộng
    const nhamNguon = await quyet({ origin: "SOURCE_CHANGE", refEventId: kn.id }, slotB);
    expect(nhamNguon.quanTri).toBe("SINGLE_APPROVAL");
    expect(nhamNguon.tongYeuCau).toBe(100_000);
  });

  it("[YC-05] chạy lại cùng sự kiện ⇒ không đẻ thêm đề xuất, mức đã chụp BẤT BIẾN (cả ba vẫn cấp hai, tổng yêu cầu đã chụp vẫn 300.000)", async () => {
    const { k, bc, khoan, ev, nguoiDoi } = await dungSuKien("yc05", 3);
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi });
    const truoc = await Promise.all(khoan.map(dxCua));
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: ev.id, requestedById: nguoiDoi });
    expect(await db.commissionAdjustmentRequest.count({ where: { paymentId: { in: khoan }, origin: "SOURCE_CHANGE" } })).toBe(3);
    const sau = await Promise.all(khoan.map(dxCua));
    expect(sau.map((x) => [x.id, x.governance, x.governanceWhy])).toEqual(truoc.map((x) => [x.id, x.governance, x.governanceWhy]));
    expect(sau.every((x) => x.governance === "SECOND_APPROVAL_REQUIRED")).toBe(true);
  });
});
