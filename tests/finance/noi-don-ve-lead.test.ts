// tests/finance/noi-don-ve-lead.test.ts — PR0 "Nối Order.leadId cho đơn cũ" (D8), tầng CHẠM POSTGRES THẬT.
//
// Chạy bộ này:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts <tệp>`)
// `pnpm test:unit` trần sẽ SKIP — và log "SKIP" nghĩa là CHƯA kiểm gì (CLAUDE.md, mục Prisma/DB).
//
// KHÔNG gọi `resetDb()` (nếp của `tests/finance/*`): fixture tự dựng + tự dọn theo tiền tố `NDL_`
// và theo kỳ `2099-*`. Hàm DB nào quét bảng đều nhận PHẠM VI BẮT BUỘC và ở đây luôn truyền đúng id
// fixture — KHÔNG BAO GIỜ `"TAT_CA"` ([PB-10]). Kỳ dùng `2099-09`/`2099-10`: `CommissionStatement.period`
// là `@unique` toàn cục nên không gắn tiền tố được, và `chotKyHoaHong` ghi lại cả kỳ — cấm đụng kỳ thật.
//
// Đặc tả: docs/source-commission/07-dac-ta-thi-cong-pr0-pr1.md §3.1.
import { PaymentAccountantStatus, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";
import { chotKyHoaHong } from "@/lib/crm/commission-run";
import {
  docKeHoachNoiDon,
  ghiNoiDon,
  ghiNoiDonTrongTx,
  tinhBaCot,
} from "@/lib/nguon/noi-don-db";

if (!RUN_DB_TESTS) console.warn(`[NHH-D8-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "NDL_";
const KY1 = "2099-09";
const KY2 = "2099-10";
const KY_CAC = [KY1, KY2];

/** Trạng thái kế toán KHÔNG tham gia thực thu — lấy từ enum trừ hằng, KHÔNG gõ literal (lưới trục A). */
const KHONG_PHAI_THUC_THU = Object.values(PaymentAccountantStatus).find(
  (s) => !(TRANG_THAI_THUC_THU as readonly string[]).includes(s),
)!;

const ACTOR = { id: null, name: "Test nối đơn (NDL_)" } as const;
const CO_SO = `${P}center`;
const USER_QC = `${P}u_qc`;

/** Mốc trong kỳ 2099-09 / 2099-10 (giờ VN: ngày 15 ⇒ không sát biên). */
const NGAY_KY1 = new Date("2099-09-15T03:00:00.000Z");
const NGAY_KY2 = new Date("2099-10-15T03:00:00.000Z");

async function don() {
  await db.commissionRateConfig.deleteMany({ where: { reason: P } });
  const orders = await db.order.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) {
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  const stmts = await db.commissionStatement.findMany({
    where: { period: { in: KY_CAC } },
    select: { id: true },
  });
  if (stmts.length) {
    const ids = stmts.map((s) => s.id);
    await db.auditLog.deleteMany({ where: { entityType: "CommissionStatement", entityId: { in: ids } } });
    await db.commissionLine.deleteMany({ where: { statementId: { in: ids } } });
    await db.commissionStatement.deleteMany({ where: { id: { in: ids } } });
  }
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } });
}

async function donCoDinh() {
  await db.centerCommissionAssignee.deleteMany({ where: { centerId: CO_SO } });
  await db.user.deleteMany({ where: { id: { startsWith: P } } });
  await db.center.deleteMany({ where: { id: CO_SO } });
}

async function taoLead(id: string, phone: string, extra: { convertedById?: string; adminId?: string } = {}) {
  return db.lead.create({
    data: { id: `${P}${id}`, parentName: `${P}${id}`, phone, status: "DA_DANG_KY", ...extra },
    select: { id: true },
  });
}

async function taoDon(ma: string, customerPhone: string, extra: { deletedAt?: Date } = {}) {
  return db.order.create({
    data: {
      id: `${P}o_${ma}`,
      code: `${P}${ma}`,
      type: "COURSE",
      customerName: "PH",
      customerPhone,
      totalAmount: 1,
      centerId: CO_SO,
      ...extra,
    },
    select: { id: true },
  });
}

async function taoThu(
  orderId: string,
  amount: number,
  paidDate: Date,
  extra: { accountantStatus?: PaymentAccountantStatus; deletedAt?: Date; hau?: string } = {},
) {
  return db.payment.create({
    data: {
      id: `${P}p_${orderId}_${paidDate.toISOString().slice(0, 7)}${extra.hau ?? ""}`,
      orderId,
      amount,
      method: "CASH",
      paidDate,
      confirmedAt: new Date(paidDate.getTime() + 3_600_000),
      centerId: CO_SO,
      saleStatus: "RECORDED",
      // Hằng của thực thu (trạng thái đầu tiên tham gia sổ) — không gõ literal.
      accountantStatus: extra.accountantStatus ?? TRANG_THAI_THUC_THU[0],
      deletedAt: extra.deletedAt ?? null,
    },
    select: { id: true },
  });
}

const demAudit = (orderId: string) =>
  db.auditLog.count({ where: { entityType: "Order", action: "NOI_LEAD", entityId: orderId } });

describe.skipIf(!RUN_DB_TESTS)("[NHH-D8-DB] nối Order.leadId — DB thật", () => {
  beforeAll(async () => {
    await don();
    await donCoDinh();
    await db.center.create({
      data: { id: CO_SO, name: "NDL cơ sở", slug: `${P}center-slug`, address: "Không có thật" },
    });
    await db.user.create({ data: { id: USER_QC, name: "NDL QC", email: "ndl-qc@test.invalid" } });
  });
  beforeEach(don);
  afterAll(async () => {
    await don();
    await donCoDinh();
    await db.$disconnect();
  });

  it("[NHH-D8-DB-01] ghi đúng đơn MOT, 1 audit; NHIEU/KHONG giữ null; chạy lại với kế hoạch CŨ ⇒ không ghi lại", async () => {
    const lead = await taoLead("L_mot", "84900000401");
    await taoLead("L_nhieu_1", "0900000402");
    await taoLead("L_nhieu_2", "84900000402");
    const dMot = await taoDon("mot", "0900000401");
    const dNhieu = await taoDon("nhieu", "0900000402");
    const dKhong = await taoDon("khong", "0900000403");
    const phamVi = { orderIds: [dMot.id, dNhieu.id, dKhong.id] };

    const { keHoach } = await docKeHoachNoiDon(db, phamVi);
    expect(keHoach.mot.map((m) => m.orderId)).toEqual([dMot.id]);
    expect(keHoach.nhieu.map((m) => m.orderId)).toEqual([dNhieu.id]);
    expect(keHoach.khong.map((m) => m.orderId)).toEqual([dKhong.id]);

    const input = { keHoach, soDuyet: 1, ghiDuoc: true, actor: ACTOR };
    const kq = await ghiNoiDon(db, input);
    expect(kq).toEqual({ daNoi: 1, boQua: 0 });

    const sau = await db.order.findMany({
      where: { id: { in: phamVi.orderIds } },
      select: { id: true, leadId: true },
    });
    const theoId = Object.fromEntries(sau.map((o) => [o.id, o.leadId]));
    expect(theoId[dMot.id]).toBe(lead.id);
    expect(theoId[dNhieu.id]).toBeNull();
    expect(theoId[dKhong.id]).toBeNull();

    expect(await demAudit(dMot.id)).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityId: dMot.id, action: "NOI_LEAD" } });
    expect(a.entityType).toBe("Order");
    expect(await demAudit(dNhieu.id)).toBe(0);
    expect(await demAudit(dKhong.id)).toBe(0);

    // [PB-20] chạy lại với CHÍNH kế hoạch cũ: updateMany có `leadId: null` ⇒ 0 dòng, 0 audit mới.
    const lan2 = await ghiNoiDon(db, input);
    expect(lan2).toEqual({ daNoi: 0, boQua: 1 });
    expect(await demAudit(dMot.id)).toBe(1);

    // Lập kế hoạch LẠI thì đơn đó không còn trong `mot`.
    const lai = await docKeHoachNoiDon(db, phamVi);
    expect(lai.keHoach.mot).toEqual([]);
    expect(lai.keHoach.nhieu.map((m) => m.orderId)).toEqual([dNhieu.id]);
  });

  it("[NHH-D8-DB-01b] đơn xoá mềm KHÔNG vào kế hoạch; đơn NGOÀI phạm vi không bị lập kế hoạch lẫn bị ghi ([PB-10])", async () => {
    const lead = await taoLead("L_pv", "84900000441");
    const dXoa = await taoDon("xoa", "0900000441", { deletedAt: new Date("2099-01-01T00:00:00.000Z") });
    const dSong = await taoDon("song", "0900000441");
    // Cùng SĐT, cùng lead khớp, `leadId` null, còn sống — nhưng KHÔNG nằm trong phạm vi truyền vào.
    const dNgoai = await taoDon("ngoai", "0900000441");

    const { keHoach, donThieuLead } = await docKeHoachNoiDon(db, { orderIds: [dXoa.id, dSong.id] });
    expect(keHoach.mot.map((m) => m.orderId)).toEqual([dSong.id]);
    expect(keHoach.nhieu).toEqual([]);
    expect(keHoach.khong).toEqual([]);
    expect(donThieuLead).toBe(1);

    expect(await ghiNoiDon(db, { keHoach, soDuyet: 1, ghiDuoc: true, actor: ACTOR })).toEqual({ daNoi: 1, boQua: 0 });
    const leadId = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id } })).leadId;
    expect(await leadId(dSong.id)).toBe(lead.id);
    expect(await leadId(dXoa.id)).toBeNull();
    expect(await leadId(dNgoai.id)).toBeNull();
    expect(await demAudit(dXoa.id)).toBe(0);
    expect(await demAudit(dNgoai.id)).toBe(0);
  });

  describe("[NHH-D8-DB-02] cổng kỳ APPROVED — trước tx VÀ trong tx", () => {
    async function dung() {
      await taoLead("L_a", "84900000411");
      await taoLead("L_b", "84900000412");
      const a = await taoDon("a", "0900000411");
      const b = await taoDon("b", "0900000412");
      // Tiền của đơn A rơi vào kỳ 2099-09 (APPROVED), KHÔNG có statement DRAFT nào cho kỳ đó ([PB-8]).
      await taoThu(a.id, 10_000_000, NGAY_KY1);
      // Đơn B có tiền ở kỳ 2099-10 (DRAFT).
      await taoThu(b.id, 5_000_000, NGAY_KY2);
      await db.commissionStatement.create({ data: { period: KY1, status: "APPROVED" } });
      await db.commissionStatement.create({ data: { period: KY2, status: "DRAFT" } });
      const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [a.id, b.id] });
      expect(keHoach.mot).toHaveLength(2);
      return { a, b, keHoach, input: { keHoach, soDuyet: 2, ghiDuoc: true, actor: ACTOR } };
    }
    const khongDoiGi = async (ids: string[]) => {
      const rows = await db.order.findMany({ where: { id: { in: ids } }, select: { leadId: true } });
      expect(rows.map((r) => r.leadId)).toEqual([null, null]);
      for (const id of ids) expect(await demAudit(id)).toBe(0);
    };

    it("(i) ghiNoiDon ném, 0 đơn đổi, 0 audit — kể cả đơn B ở kỳ DRAFT", async () => {
      const { a, b, input } = await dung();
      await expect(ghiNoiDon(db, input)).rejects.toThrow(/2099-09/);
      await khongDoiGi([a.id, b.id]);
    });

    it("(ii) gọi THẲNG ghiNoiDonTrongTx (bỏ lượt kiểm trước tx) ⇒ vẫn ném, 0 đổi, 0 audit", async () => {
      const { a, b, input } = await dung();
      await expect(db.$transaction((tx) => ghiNoiDonTrongTx(tx, input))).rejects.toThrow(/2099-09/);
      await khongDoiGi([a.id, b.id]);
    });

    it("(iii) lượt kiểm TRƯỚC tx chặn khi CHƯA mở transaction nào (báo sớm, không giữ khoá)", async () => {
      const { a, b, input } = await dung();
      const spy = vi.spyOn(db, "$transaction");
      try {
        await expect(ghiNoiDon(db, input)).rejects.toThrow(/2099-09/);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      await khongDoiGi([a.id, b.id]);
    });

    it("(iv) tinhBaCot IN cả kỳ APPROVED bị ảnh hưởng (để người duyệt thấy) kèm cờ biAnhHuong", async () => {
      const { keHoach } = await dung();
      const { ky } = await tinhBaCot(db, keHoach);
      expect(ky.find((k) => k.period === KY1)).toMatchObject({ status: "APPROVED", biAnhHuong: true });
      expect(ky.find((k) => k.period === KY2)).toMatchObject({ status: "DRAFT", biAnhHuong: true });
    });

    it("(v) tiền KHÔNG phải thực thu (chưa xác nhận / từ chối / xoá mềm) rơi vào kỳ APPROVED ⇒ KHÔNG chặn ghi", async () => {
      await taoLead("L_c", "84900000413");
      const c = await taoDon("c", "0900000413");
      await taoThu(c.id, 1_000_000, NGAY_KY1, { accountantStatus: KHONG_PHAI_THUC_THU, hau: "_kpt" });
      await taoThu(c.id, 2_000_000, new Date("2099-09-16T03:00:00.000Z"), {
        deletedAt: new Date("2099-09-17T00:00:00.000Z"),
        hau: "_xoa",
      });
      await taoThu(c.id, 3_000_000, NGAY_KY2); // thực thu thật, ở kỳ DRAFT
      await db.commissionStatement.create({ data: { period: KY1, status: "APPROVED" } });
      await db.commissionStatement.create({ data: { period: KY2, status: "DRAFT" } });
      const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [c.id] });
      expect(keHoach.mot).toHaveLength(1);
      const kq = await ghiNoiDon(db, { keHoach, soDuyet: 1, ghiDuoc: true, actor: ACTOR });
      expect(kq).toEqual({ daNoi: 1, boQua: 0 });
      expect(await demAudit(c.id)).toBe(1);
    });

    it("đối chứng dương: kỳ 2099-09 ở REOPENED ⇒ ghi được cả hai (ghiNoiDon và gọi thẳng trong tx)", async () => {
      const { a, b, input } = await dung();
      await db.commissionStatement.update({ where: { period: KY1 }, data: { status: "REOPENED" } });
      const kq = await db.$transaction((tx) => ghiNoiDonTrongTx(tx, input));
      expect(kq).toEqual({ daNoi: 2, boQua: 0 });
      expect(await demAudit(a.id)).toBe(1);
      expect(await demAudit(b.id)).toBe(1);
    });

    it("đối chứng dương 2: kỳ không có bảng kê nào ⇒ ghi được", async () => {
      const { a, b, input } = await dung();
      await db.commissionStatement.delete({ where: { period: KY1 } });
      const kq = await ghiNoiDon(db, input);
      expect(kq).toEqual({ daNoi: 2, boQua: 0 });
      expect(await demAudit(a.id)).toBe(1);
      expect(await demAudit(b.id)).toBe(1);
    });
  });

  it("[NHH-D8-DB-03] đua: ai vừa gắn tay leadId khác thì GIỮ NGUYÊN, boQua = 1, 0 audit cho đơn đó", async () => {
    await taoLead("L_dua", "84900000421");
    const khac = await taoLead("L_tay", "84900000429");
    const d = await taoDon("dua", "0900000421");
    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [d.id] });
    expect(keHoach.mot).toHaveLength(1);

    await db.order.update({ where: { id: d.id }, data: { leadId: khac.id } });
    const kq = await ghiNoiDon(db, { keHoach, soDuyet: 1, ghiDuoc: true, actor: ACTOR });
    expect(kq).toEqual({ daNoi: 0, boQua: 1 });
    expect((await db.order.findUniqueOrThrow({ where: { id: d.id } })).leadId).toBe(khac.id);
    expect(await demAudit(d.id)).toBe(0);
  });

  it("[NHH-D8-DB-04] DỰ BÁO = THỰC TẾ: cột (c) của tinhBaCot bằng bảng kê chotKyHoaHong thật sinh ra sau khi nối", async () => {
    await taoLead("L_hh", "84900000431", { convertedById: `${P}u_sale`, adminId: `${P}u_adm` });
    const d = await taoDon("hh", "0900000431");
    await taoThu(d.id, 10_000_000, NGAY_KY1);
    // QC phụ trách cơ sở từ trước kỳ ⇒ tầng QC có người ở CẢ trước lẫn sau; quên truyền sổ phân công
    // vào mapButToanHoaHong thì QC treo và cột (c) lệch bảng kê thật.
    await db.centerCommissionAssignee.create({
      data: {
        centerId: CO_SO,
        role: "QC",
        userId: USER_QC,
        effectiveFrom: new Date("2099-01-01T00:00:00.000Z"),
      },
    });
    // Tỉ lệ SALE ĐỔI so với mặc định (5%): quên truyền sổ tỉ lệ vào phép tính thì "sau" ra 4% ≠ bảng kê thật.
    await db.commissionRateConfig.create({
      data: { tier: "SALE", rate: 0.05, effectiveFrom: new Date("2099-01-01T00:00:00.000Z"), reason: P },
    });
    // Tiền KHÔNG phải thực thu cùng đơn, cùng kỳ: bộ lọc thực thu mà rơi mất thì "thực thu không quy được lead"
    // phình từ 10.000.000 lên 15.000.000 và hoa hồng SALE/SALE_ADMIN phình theo.
    await taoThu(d.id, 3_000_000, new Date("2099-09-16T03:00:00.000Z"), {
      accountantStatus: KHONG_PHAI_THUC_THU,
      hau: "_kpt",
    });
    await taoThu(d.id, 2_000_000, new Date("2099-09-17T03:00:00.000Z"), {
      deletedAt: new Date("2099-09-18T00:00:00.000Z"),
      hau: "_xoa",
    });
    // Một kỳ KHÁC cũng có dòng đang lưu cho cùng người: (a) của kỳ 2099-09 chỉ được đọc từ CHÍNH kỳ đó.
    await db.commissionStatement.create({
      data: {
        period: KY2,
        status: "DRAFT",
        lines: { create: [{ recipientId: `${P}u_cu`, tier: "SALE", amount: 7 }] },
      },
    });
    // Bảng kê DRAFT cũ có một dòng (a) đang lưu.
    await db.commissionStatement.create({
      data: {
        period: KY1,
        status: "DRAFT",
        lines: { create: [{ recipientId: `${P}u_cu`, tier: "SALE", amount: 5 }] },
      },
    });

    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [d.id] });
    expect(keHoach.mot).toHaveLength(1);

    const ba = await tinhBaCot(db, keHoach);
    const ky = ba.ky.find((k) => k.period === KY1);
    expect(ky).toBeDefined();
    expect(ky!.status).toBe("DRAFT");
    const dong = (tier: string, nguoi: string) => ky!.dong.find((x) => x.tier === tier && x.recipientId === nguoi);
    expect(dong("SALE", `${P}u_sale`)).toMatchObject({ dangLuu: 0, truoc: 0, sau: 500_000 });
    expect(dong("SALE_ADMIN", `${P}u_adm`)).toMatchObject({ dangLuu: 0, truoc: 0, sau: 100_000 });
    expect(dong("QC", USER_QC)).toMatchObject({ dangLuu: 0, truoc: 100_000, sau: 100_000 });
    expect(dong("SALE", `${P}u_cu`)).toMatchObject({ dangLuu: 5, truoc: 0, sau: 0 });
    // "thực thu không quy được lead" giảm đúng bằng số tiền của đơn vừa nối.
    expect(ky!.thucThuKhongCoLead).toEqual({ truoc: 10_000_000, sau: 0 });

    await ghiNoiDon(db, { keHoach, soDuyet: 1, ghiDuoc: true, actor: ACTOR });
    await chotKyHoaHong({ id: null, name: "Test chốt kỳ (NDL_)" }, { period: KY1 });

    const dongThat = await db.commissionLine.findMany({
      where: { statement: { period: KY1 } },
      select: { tier: true, recipientId: true, amount: true },
    });
    const thucTe = Object.fromEntries(dongThat.map((l) => [`${l.tier}|${l.recipientId}`, l.amount]));
    const duBao = Object.fromEntries(
      ky!.dong.filter((x) => x.sau !== 0).map((x) => [`${x.tier}|${x.recipientId}`, x.sau]),
    );
    expect(thucTe).toEqual(duBao);
    expect(thucTe[`SALE|${P}u_sale`]).toBe(500_000);
  });

  it("[NHH-D8-DB-06] ghiNoiDonTrongTx dùng ĐÚNG tx cho cả updateMany lẫn audit: tx lùi ⇒ không còn dấu vết nào", async () => {
    await taoLead("L_rb", "84900000451");
    const d = await taoDon("rb", "0900000451");
    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [d.id] });
    expect(keHoach.mot).toHaveLength(1);
    let trongTx: { daNoi: number; boQua: number } | null = null;
    await expect(
      db.$transaction(async (tx) => {
        trongTx = await ghiNoiDonTrongTx(tx, { keHoach, soDuyet: 1, ghiDuoc: true, actor: ACTOR });
        throw new Error("LUI_TX_THU");
      }),
    ).rejects.toThrow("LUI_TX_THU");
    expect(trongTx).toEqual({ daNoi: 1, boQua: 0 }); // chứng minh nó ĐÃ ghi trước khi tx lùi
    expect((await db.order.findUniqueOrThrow({ where: { id: d.id } })).leadId).toBeNull();
    expect(await demAudit(d.id)).toBe(0);
  });

  it("[NHH-D8-DB-07] chống đua: duyệt kỳ xen vào giữa ⇒ ghiNoiDonTrongTx CHỜ khoá (FOR SHARE), rồi thấy APPROVED và ném", async () => {
    await taoLead("L_dr", "84900000461");
    const d = await taoDon("dr", "0900000461");
    await taoThu(d.id, 10_000_000, NGAY_KY1);
    await db.commissionStatement.create({ data: { period: KY1, status: "DRAFT" } });
    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [d.id] });
    const input = { keHoach, soDuyet: 1, ghiDuoc: true, actor: ACTOR };

    // Phiên "duyệt kỳ": giữ khoá GHI trên dòng bảng kê, rồi mới đổi sang APPROVED.
    let nha!: () => void;
    const giu = new Promise<void>((r) => (nha = r));
    let daKhoa!: () => void;
    const khoaXong = new Promise<void>((r) => (daKhoa = r));
    const duyet = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "period" FROM "CommissionStatement" WHERE "period" = ${KY1} FOR UPDATE`;
      daKhoa();
      await giu;
      await tx.commissionStatement.update({ where: { period: KY1 }, data: { status: "APPROVED" } });
    });
    await khoaXong;

    const ghi = db.$transaction((tx) => ghiNoiDonTrongTx(tx, input)).then(
      () => "DA_GHI",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    const luc500ms = await Promise.race([ghi, new Promise<string>((r) => setTimeout(() => r("DANG_CHO"), 500))]);
    // Không có FOR SHARE thì lượt ghi đọc ngay "DRAFT" đã commit và GHI luôn — đó chính là cuộc đua.
    expect(luc500ms).toBe("DANG_CHO");

    nha();
    await duyet;
    expect(await ghi).toMatch(/2099-09/);
    expect((await db.order.findUniqueOrThrow({ where: { id: d.id } })).leadId).toBeNull();
    expect(await demAudit(d.id)).toBe(0);
  });

  // ─── F7 — ghim ba điều kiện của tầng DB mà ca có sẵn không soi tới ───────────────────────────────────────

  it("[NHH-D8-DB-08] (F7a) đơn bị XOÁ MỀM giữa lúc lập kế hoạch và lúc ghi ⇒ KHÔNG nối (boQua), 0 audit; tongDon không đếm đơn xoá mềm", async () => {
    await taoLead("L_f7a", "84900000471");
    const song = await taoDon("f7a_song", "0900000471");
    const xoaSau = await taoDon("f7a_xoa_sau", "0900000471");
    const daXoa = await taoDon("f7a_da_xoa", "0900000471", { deletedAt: new Date("2099-01-01T00:00:00.000Z") });
    const phamVi = { orderIds: [song.id, xoaSau.id, daXoa.id] };

    const { keHoach, tongDon } = await docKeHoachNoiDon(db, phamVi);
    // `tongDon` chỉ đếm đơn CÒN SỐNG: bỏ `deletedAt: null` ở câu đếm thì ra 3.
    expect(tongDon).toBe(2);
    expect(keHoach.mot.map((m) => m.orderId).sort()).toEqual([song.id, xoaSau.id].sort());

    // Giữa kế hoạch và ghi: một đơn bị xoá mềm.
    await db.order.update({ where: { id: xoaSau.id }, data: { deletedAt: new Date("2099-01-02T00:00:00.000Z") } });
    const kq = await ghiNoiDon(db, { keHoach, soDuyet: 2, ghiDuoc: true, actor: ACTOR });
    expect(kq).toEqual({ daNoi: 1, boQua: 1 });
    const leadId = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id } })).leadId;
    expect(await leadId(song.id)).not.toBeNull();
    expect(await leadId(xoaSau.id)).toBeNull(); // đơn đã xoá KHÔNG bị gắn lead
    expect(await demAudit(song.id)).toBe(1);
    expect(await demAudit(xoaSau.id)).toBe(0);
  });

  it("[NHH-D8-DB-09] (F7b) tinhBaCot in cả kỳ REOPENED (kỳ còn sửa được) dù đơn sắp nối KHÔNG có tiền ở kỳ đó; cùng kỳ ở APPROVED thì KHÔNG in", async () => {
    await taoLead("L_f7b", "84900000472");
    const d = await taoDon("f7b", "0900000472");
    await taoThu(d.id, 4_000_000, NGAY_KY1); // tiền của đơn ở KY1 (chưa có bảng kê ⇒ CHUA_CO)
    await db.commissionStatement.create({ data: { period: KY2, status: "REOPENED" } });
    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [d.id] });
    expect(keHoach.mot).toHaveLength(1);

    const { ky } = await tinhBaCot(db, keHoach);
    // KY2 chỉ lọt vào danh sách nhờ `status ∈ {DRAFT, REOPENED}` — đơn không có tiền ở đó (biAnhHuong=false).
    expect(ky.find((k) => k.period === KY2)).toMatchObject({ status: "REOPENED", biAnhHuong: false });
    expect(ky.find((k) => k.period === KY1)).toMatchObject({ status: "CHUA_CO", biAnhHuong: true });

    // Đối chứng dương 1: cùng kỳ ở DRAFT ⇒ cũng in (hai trạng thái còn sửa được).
    await db.commissionStatement.update({ where: { period: KY2 }, data: { status: "DRAFT" } });
    expect((await tinhBaCot(db, keHoach)).ky.find((k) => k.period === KY2)).toMatchObject({ status: "DRAFT", biAnhHuong: false });
    // Đối chứng dương 2 (vế đóng): APPROVED mà đơn không có tiền ở đó ⇒ KHÔNG in (kỳ đã khoá, không liên quan).
    await db.commissionStatement.update({ where: { period: KY2 }, data: { status: "APPROVED" } });
    expect((await tinhBaCot(db, keHoach)).ky.find((k) => k.period === KY2)).toBeUndefined();
  });

  it("[NHH-D8-DB-10] (F7c) kế hoạch có THỨ TỰ XÁC ĐỊNH: theo mã đơn tăng dần, không theo thứ tự chèn", async () => {
    await taoLead("L_f7c", "84900000473");
    // Ba thứ tự KHÁC NHAU cùng lúc, để không đường quét nào "tình cờ" ra đúng theo mã:
    //   mã tăng dần      : a, b, c
    //   thứ tự chèn (heap): c, a, b
    //   id tăng dần (index): c, b, a   — `id IN (…)` có thể quét theo chỉ mục khoá chính
    const taoTheoId = (id: string, ma: string) =>
      db.order.create({
        data: { id: `${P}o_f7c_${id}`, code: `${P}f7c_${ma}`, type: "COURSE", customerName: "PH", customerPhone: "0900000473", totalAmount: 1, centerId: CO_SO },
        select: { id: true },
      });
    const c = await taoTheoId("1", "c");
    const a = await taoTheoId("3", "a");
    const b = await taoTheoId("2", "b");
    const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [c.id, a.id, b.id] });
    expect(keHoach.mot.map((m) => m.code)).toEqual([`${P}f7c_a`, `${P}f7c_b`, `${P}f7c_c`]);
  });

  // ─── F8 — kế hoạch CŨ: lead đích đổi giữa lúc lập kế hoạch và lúc ghi ─────────────────────────────────────

  describe("[NHH-D8-DB-11] (F8) lead đích đổi giữa kế hoạch và ghi ⇒ THROW trong tx, 0 đơn nào được ghi", () => {
    async function dung() {
      const lead = await taoLead("L_f8", "84900000481");
      const a = await taoDon("f8_a", "0900000481");
      // Đơn B thuộc một SĐT KHÁC, lead khác, vẫn hợp lệ — để chứng minh cả LƯỢT lùi chứ không chỉ riêng đơn lệch.
      await taoLead("L_f8_b", "84900000482");
      const b = await taoDon("f8_b", "0900000482");
      const { keHoach } = await docKeHoachNoiDon(db, { orderIds: [a.id, b.id] });
      expect(keHoach.mot).toHaveLength(2);
      return { lead, a, b, keHoach, input: { keHoach, soDuyet: 2, ghiDuoc: true, actor: ACTOR } };
    }
    const khongDoiGi = async (ids: string[]) => {
      const rows = await db.order.findMany({ where: { id: { in: ids } }, select: { leadId: true } });
      expect(rows.map((r) => r.leadId)).toEqual(ids.map(() => null));
      for (const id of ids) expect(await demAudit(id)).toBe(0);
    };

    it("(i) có thêm một lead THỨ HAI cùng SĐT ⇒ từ chối (qua ghiNoiDon VÀ gọi thẳng trong tx), cả hai đơn không đổi", async () => {
      const { a, b, input } = await dung();
      await taoLead("L_f8_hai", "0900000481"); // cùng SĐT khác dạng — vẫn là cùng khoá chuẩn hoá
      await expect(ghiNoiDon(db, input)).rejects.toThrow(/Kế hoạch nối đã CŨ[\s\S]*NDL_f8_a/);
      await khongDoiGi([a.id, b.id]);
      await expect(db.$transaction((tx) => ghiNoiDonTrongTx(tx, input))).rejects.toThrow(/đã CŨ/);
      await khongDoiGi([a.id, b.id]);
    });

    it("(ii) lead đích bị XOÁ MỀM ⇒ từ chối, không đơn nào đổi", async () => {
      const { lead, a, b, input } = await dung();
      await db.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date("2099-01-01T00:00:00.000Z") } });
      await expect(ghiNoiDon(db, input)).rejects.toThrow(/đã CŨ/);
      await khongDoiGi([a.id, b.id]);
    });

    it("(iii) lead đích bị đổi SĐT (không còn khớp) ⇒ từ chối", async () => {
      const { lead, a, b, input } = await dung();
      await db.lead.update({ where: { id: lead.id }, data: { phone: "84900000499" } });
      await expect(ghiNoiDon(db, input)).rejects.toThrow(/đã CŨ/);
      await khongDoiGi([a.id, b.id]);
    });

    it("(vi) lead đích bị xoá mềm NHƯNG có lead khác cùng SĐT còn sống ⇒ kế hoạch mới vẫn là MOT nhưng ĐỔI NGƯỜI ⇒ từ chối", async () => {
      const { lead, a, b, input } = await dung();
      await db.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date("2099-01-01T00:00:00.000Z") } });
      await taoLead("L_f8_thay", "0900000481");
      const moi = await docKeHoachNoiDon(db, { orderIds: [a.id] });
      expect(moi.keHoach.mot).toHaveLength(1); // kế hoạch mới KHÔNG phải NHIEU/KHONG — chỉ khác lead
      expect(moi.keHoach.mot[0]!.lead.leadId).not.toBe(lead.id);
      await expect(ghiNoiDon(db, input)).rejects.toThrow(/đã CŨ/);
      await khongDoiGi([a.id, b.id]);
    });

    it("(iv) ĐỐI CHỨNG DƯƠNG: lead thứ hai đã xoá mềm / cùng SĐT khác khoá / thay đổi KHÔNG liên quan ⇒ vẫn ghi cả hai", async () => {
      const { lead, a, b, input } = await dung();
      const bong = await taoLead("L_f8_bong", "0900000481");
      await db.lead.update({ where: { id: bong.id }, data: { deletedAt: new Date("2099-01-01T00:00:00.000Z") } }); // xoá mềm ⇒ không phải ứng viên
      await taoLead("L_f8_xa", "84900000488"); // SĐT khác hẳn
      await db.lead.update({ where: { id: lead.id }, data: { parentName: `${P}L_f8` } }); // đổi cột không liên quan
      const kq = await ghiNoiDon(db, input);
      expect(kq).toEqual({ daNoi: 2, boQua: 0 });
      expect(await demAudit(a.id)).toBe(1);
      expect(await demAudit(b.id)).toBe(1);
    });

    it("(v) đơn bị gắn tay leadId giữa chừng vẫn là `boQua`, KHÔNG phải lỗi kế hoạch cũ (đường FIX-H9 giữ nguyên)", async () => {
      const { a, b, input } = await dung();
      const khac = await taoLead("L_f8_tay", "84900000489");
      await db.order.update({ where: { id: a.id }, data: { leadId: khac.id } });
      const kq = await ghiNoiDon(db, input);
      expect(kq).toEqual({ daNoi: 1, boQua: 1 });
      expect(await demAudit(a.id)).toBe(0);
      expect(await demAudit(b.id)).toBe(1);
    });
  });
});
