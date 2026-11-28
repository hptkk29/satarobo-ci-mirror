import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST as sepayPost } from "@/app/api/public/webhook/sepay/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { rutYeuCauHoanOnline, taoYeuCauHoanOnline } from "@/lib/finance/hoan-tien-online";
import { capQuyenOnlineChoDon, docHangDoiCapQuyenOnline, doiSoatCapQuyenOnline } from "@/lib/online-checkout/cap-quyen-sau-thanh-toan";
import { huyDonOnlineChuaThanhToan } from "@/lib/online-checkout/phu-huynh";
import { taoDonOnline } from "@/lib/online-checkout/tao-don";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [DUA-DB] ĐUA TIỀN/MÃ CỦA ĐƠN ONLINE (vá F2 · F6 · F10 review L5 PR #1284) — đường THẬT (`ingestPayosWebhook`, huỷ, hoàn, tạo đơn) trên Postgres thật.
 * Thời điểm đua được ÉP, không trông vào may rủi: ca giữ một khoá (bảng/dòng/khoá tư vấn) trong giao dịch riêng, chờ tới khi các bên đã ĐỨNG CHỜ KHOÁ (`pg_stat_activity`) rồi mới nhả.
 *   [DUA-01] tiền đang rót (giữ khoá đơn, CHƯA ghi gì) + phụ huynh huỷ ⇒ huỷ phải chờ rồi từ chối DA_CO_TIEN; đơn không CANCELLED
 *   [DUA-02] tiền đang rót (đã ghi phân bổ + đổi phiếu, CHƯA ghi `Payment`) + huỷ ⇒ KHÔNG deadlock; huỷ DA_CO_TIEN, tiền ghi đủ
 *   [DUA-03] huỷ đang chạy + tiền về cùng lúc (ĐUA) ⇒ không deadlock; giao dịch gốc ở nguyên hàng chờ `UNMATCHED` nêu đơn — không `Payment`, phân bổ, tiền dư, quyền học
 *   [DUA-04] huỷ đơn nhà KHÁC không được xếp hàng vào khoá đơn của họ: trả KHONG_TIM_THAY ngay cả khi khoá đang bị giữ
 *   [DUA-05] gửi/rút yêu cầu hoàn cho đơn nhà KHÁC: trả KHONG_TIM_THAY ngay, không lấy khoá đơn của họ
 *   [DUA-06] mã giới hạn 1 lượt/con: hai đơn KHÁC giỏ gửi cùng lúc ⇒ đúng MỘT đơn thắng, đơn kia MA_HET_LUOT_CUA_CON, không để lại gì
 *   [DUA-07] mã giới hạn 2 lượt/con đã dùng 0: giỏ 2 dòng (2 lượt) đua giỏ 1 dòng ⇒ tổng không bao giờ vượt 2
 *   [DUA-08] tiền về đúng lúc đơn bị huỷ ⇒ hiện ở hàng đợi «đơn đã huỷ nhưng có tiền» (trước đây ghim `it.fails`)
 *   [DUA-09] tiền về SAU khi huỷ đã commit ⇒ cùng kết cục; cổng gửi lại không ghi đôi; chuyển khoản thứ hai là dòng thứ hai; phần đã gắn tay được trừ khỏi số chờ
 *   [DUA-10] ĐUA + cổng gửi TRÙNG hai bản song song rồi gửi lại ⇒ đúng MỘT giao dịch, ghi chú y nguyên, đơn vẫn trong hàng đợi
 *   [DUA-11] ĐUA qua ĐÚNG route SePay ⇒ route không lùi sang đường sổ cũ (không chốt đơn, không `Payment`)
 *   [DUA-12] tiền về TRƯỚC (ghi xong) rồi mới huỷ ⇒ DA_CO_TIEN; không nằm ở số «chờ đối soát»
 * Màn đối soát `/bien-dong-so-du` đo ở `online-tien-ve-man-doi-soat.spec.ts`; đường dùng chung với offline ở `tests/finance/online-tien-ve-don-het-nhan.test.ts`.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "duaonl-";
const NOW = new Date(Date.UTC(2026, 10, 20, 5, 0, 0));
let n = 0;

async function don() {
  await donBangOnl(db);
  const uids = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
  const oid = (await db.order.findMany({ where: { createdById: { in: uids } }, select: { id: true } })).map((o) => o.id);
  if (oid.length) {
    await db.creditBalance.deleteMany({ where: { orderId: { in: oid } } });
    await db.voucherRedemption.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderOnlineGrant.deleteMany({ where: { orderId: { in: oid } } });
    await db.refundRequest.deleteMany({ where: { orderItem: { orderId: { in: oid } } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oid } } } });
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: oid } } } });
    await db.payment.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
    await db.order.deleteMany({ where: { id: { in: oid } } });
  }
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: NS } } });
  await db.voucher.deleteMany({ where: { code: { startsWith: NS } } });
  await db.promotionPolicy.deleteMany({ where: { documentCode: { startsWith: NS } } });
  await db.student.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

async function phuHuynh(ten: string) {
  const i = ++n;
  const u = await db.user.create({ data: { name: `${NS}${ten}`, email: `${NS}${ten}-${Date.now()}-${i}@seed.invalid`, phone: `0977${String(Date.now()).slice(-5)}${i % 10}`, role: "PARENT" }, select: { id: true } });
  const c = await db.student.create({ data: { name: `${NS}bé-${ten}-${i}`, parentUserId: u.id }, select: { id: true } });
  return { id: u.id, con: c.id };
}

async function dungKhoa(gia = 500_000) {
  const t = await taoKhoa(db, { code: `DUAONL-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung" } });
  if (!b.ok) throw new Error("bai");
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: caiDatKhoiDauChoBanNhap() });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return t.courseId;
}

async function dungMa(khoa: string[], gioiHanMoiCon: number) {
  const i = ++n;
  const cs = await db.promotionPolicy.create({
    data: { documentCode: `${NS}VB${i}-${Date.now() % 100000}`, name: `${NS}CT${i}`, benefitText: "Ưu đãi thử", validFrom: new Date("2026-01-01"), validUntil: new Date("2027-12-31"), channel: "ONLINE", onlineCourseIds: khoa },
    select: { id: true },
  });
  return (
    await db.voucher.create({
      data: { code: `${NS}MA${i}-${Date.now() % 100000}`, name: `${NS}Mã ${i}`, type: "ALL", discountKind: "PERCENT", discountPercent: 10, minOrderValue: 0, validFrom: new Date("2026-01-01T00:00:00Z"), validUntil: new Date("2027-12-31T00:00:00Z"), quantity: null, usageLimitPerUser: gioiHanMoiCon, isActive: true, policyId: cs.id },
      select: { id: true },
    })
  ).id;
}

async function datDon(ph: { id: string; con: string }, courseId?: string) {
  const r = await taoDonOnline(db, { parentUserId: ph.id, gioHang: [{ courseId: courseId ?? (await dungKhoa()), studentId: ph.con }], now: NOW });
  if (!r.ok) throw new Error(`${r.ma}: ${r.thongBao}`);
  return r;
}

const nghi = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Số kết nối của DB này đang ĐỨNG CHỜ một khoá. */
async function soDangCho(): Promise<number> {
  const [r] = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
  return Number(r!.n);
}
/** Chờ tới khi có ít nhất `toiThieu` bên đứng chờ khoá, HOẶC `xongSom` đã kết thúc (mã cũ có thể chạy xuyên không chờ). */
async function choDenKhi(toiThieu: number, xongSom: Array<Promise<unknown>> = []): Promise<void> {
  let daXong = false;
  for (const p of xongSom) void p.then(() => (daXong = true), () => (daXong = true));
  for (let i = 0; i < 150; i++) {
    if (daXong || (await soDangCho()) >= toiThieu) return;
    await nghi(20);
  }
  throw new Error(`không thấy ${toiThieu} bên đứng chờ khoá`);
}

/** Giữ một khoá trong giao dịch riêng cho tới khi gọi `nha()`. `giu` chạy trong giao dịch đó. */
async function giuKhoa(giu: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>) {
  let nha!: () => void;
  const cho = new Promise<void>((r) => (nha = r));
  let daGiu!: () => void;
  const sanSang = new Promise<void>((r) => (daGiu = r));
  const xong = db.$transaction(
    async (tx) => {
      await giu(tx as never);
      daGiu();
      await cho;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  await Promise.race([sanSang, xong]);
  return { nha: async () => { nha(); await xong; } };
}

type KetCuc<T> = { loai: "xong"; v: T } | { loai: "nem"; loi: string };
const ghiKetCuc = <T,>(p: Promise<T>): Promise<KetCuc<T>> => p.then((v) => ({ loai: "xong" as const, v }), (e: unknown) => ({ loai: "nem" as const, loi: e instanceof Error ? e.message : String(e) }));

const TAI_KHOAN = "0011004123456";
const maGiaoDich = () => `${NS}${Date.now()}-${++n}`;
const khoaCua = async (orderId: string) => (await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } })).matchKey!;

async function traTien(orderId: string, soTien: number, ref: string = maGiaoDich()) {
  return ingestPayosWebhook({ reference: ref, description: `${await khoaCua(orderId)} HOC PHI ONLINE`, amount: soTien, accountNumber: TAI_KHOAN, transactionDateTime: "2026-11-20 12:00:00" }, "SEPAY");
}

const giaoDich = (ref: string) => db.bankTransaction.findMany({ where: { providerTxnId: ref } });
const maDon = async (orderId: string) => (await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { code: true } })).code;
const dongHangDoi = async (orderId: string) => (await docHangDoiCapQuyenOnline(db, { gioiHan: 500 })).daHuyNhungCoTien.filter((x) => x.orderId === orderId);

const soTien = async (orderId: string) => {
  const [trangThai, payment, phanBo, du] = await Promise.all([
    db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } }),
    db.payment.aggregate({ where: { orderId, deletedAt: null }, _sum: { amount: true } }),
    db.paymentAllocation.aggregate({ where: { paymentRequest: { orderId } }, _sum: { amount: true } }),
    db.creditBalance.aggregate({ where: { orderId }, _sum: { amount: true } }),
  ]);
  return { don: trangThai.status, payment: payment._sum.amount ?? 0, phanBo: phanBo._sum.amount ?? 0, tienDu: du._sum.amount ?? 0 };
};

describe.skipIf(!RUN)("[DUA-DB] đua tiền/mã đơn Online — Postgres thật", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  /** Ép tiền đang rót dừng giữa giao dịch (chặn đúng MỘT phép ghi bằng khoá bảng), rồi cho phụ huynh huỷ chen vào. Trả tiền THIẾU để đơn không tự chốt sau commit (kết quả tất định). */
  async function huyChenGiuaLucRotTien(bangChan: "PaymentAllocation" | "Payment") {
    const ph = await phuHuynh("dua");
    const d = await datDon(ph);
    const tra = d.tongTien - 100_000;
    const cong = await giuKhoa(async (tx) => {
      if (bangChan === "PaymentAllocation") await tx.$executeRaw`LOCK TABLE "PaymentAllocation" IN EXCLUSIVE MODE`;
      else await tx.$executeRaw`LOCK TABLE "Payment" IN EXCLUSIVE MODE`;
    });
    const tien = ghiKetCuc(traTien(d.orderId, tra));
    await choDenKhi(1, [tien]);
    const huy = ghiKetCuc(huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: d.orderId, now: NOW }));
    await choDenKhi(2, [huy]);
    await cong.nha();
    return { orderId: d.orderId, tra, tien: await tien, huy: await huy };
  }

  it("[DUA-01] tiền đang rót (chưa ghi gì) + huỷ ⇒ huỷ chờ rồi DA_CO_TIEN; đơn không bị huỷ khi tiền đang vào", async () => {
    const k = await huyChenGiuaLucRotTien("PaymentAllocation");
    expect(k.huy).toMatchObject({ loai: "xong", v: { ok: false, ma: "DA_CO_TIEN" } });
    expect(k.tien).toMatchObject({ loai: "xong", v: { status: "MATCHED", allocated: k.tra } });
    expect(await soTien(k.orderId)).toEqual({ don: "PENDING_PAYMENT", payment: k.tra, phanBo: k.tra, tienDu: 0 });
  }, 30_000);

  it("[DUA-02] tiền đã ghi phân bổ, chưa ghi Payment + huỷ ⇒ KHÔNG deadlock; huỷ DA_CO_TIEN, tiền ghi đủ", async () => {
    const k = await huyChenGiuaLucRotTien("Payment");
    expect(k.huy).toMatchObject({ loai: "xong", v: { ok: false, ma: "DA_CO_TIEN" } });
    expect(k.tien).toMatchObject({ loai: "xong", v: { status: "MATCHED", allocated: k.tra } });
    expect(await soTien(k.orderId)).toEqual({ don: "PENDING_PAYMENT", payment: k.tra, phanBo: k.tra, tienDu: 0 });
  }, 30_000);

  /** Lượt huỷ đang chạy (đã qua cổng "chưa có tiền", chưa commit) thì tiền của đơn về: chặn huỷ tại phép ghi lịch sử trạng thái; webhook lúc này tra phiếu vẫn thấy PENDING. */
  async function giuaLucHuy<T>(gui: (d: { orderId: string; tongTien: number }) => Array<() => Promise<T>>) {
    const ph = await phuHuynh("nguoc");
    const d = await datDon(ph);
    const cong = await giuKhoa(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "OrderStatusHistory" IN EXCLUSIVE MODE`;
    });
    const huy = ghiKetCuc(huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: d.orderId, now: NOW }));
    await choDenKhi(1, [huy]);
    const viec = gui(d).map((f) => ghiKetCuc(f()));
    // Mọi bên gửi đều phải ĐỨNG CHỜ (đã tra đích xong, đang đợi khoá đơn) trước khi thả lượt huỷ — không thì ca đo xen kẽ SAU chứ không phải ĐUA.
    await choDenKhi(1 + viec.length);
    await cong.nha();
    return { orderId: d.orderId, tongTien: d.tongTien, con: ph.con, huy: await huy, tien: await Promise.all(viec) };
  }
  async function tienVeGiuaLucHuy() {
    const ref = maGiaoDich();
    const k = await giuaLucHuy((d) => [() => traTien(d.orderId, d.tongTien, ref)]);
    return { ...k, ref, tien: k.tien[0]! };
  }

  /** Bất biến của MỌI tiền về trên đơn đã huỷ: không quyền học, không dòng thu/chi (kể cả hoàn), không tiền dư, phiếu vẫn VOID. */
  async function khongSinhGi(orderId: string, con: string) {
    expect(await soTien(orderId)).toEqual({ don: "CANCELLED", payment: 0, phanBo: 0, tienDu: 0 });
    expect(await db.payment.count({ where: { orderId } })).toBe(0);
    expect((await db.paymentRequest.findMany({ where: { orderId }, select: { status: true } })).map((p) => p.status)).toEqual(["VOID"]);
    expect((await db.orderOnlineGrant.findMany({ where: { orderId }, select: { status: true } })).map((g) => g.status)).toEqual(["PENDING"]);
    await capQuyenOnlineChoDon(db, orderId, NOW);
    await doiSoatCapQuyenOnline(db, NOW, { gioiHan: 500 });
    expect(await db.onlEntitlement.count({ where: { studentId: con } })).toBe(0);
  }

  it("[DUA-03] huỷ đang chạy + tiền về cùng lúc ⇒ không deadlock; giao dịch gốc ở hàng chờ đối soát, nêu đơn, không sinh gì khác", async () => {
    const k = await tienVeGiuaLucHuy();
    expect(k.huy).toMatchObject({ loai: "xong", v: { ok: true, daHuyTruocDo: false } });
    expect(k.tien).toMatchObject({ loai: "xong", v: { status: "UNMATCHED" } });
    const gd = await giaoDich(k.ref);
    expect(gd).toHaveLength(1);
    expect(gd[0]).toMatchObject({ status: "UNMATCHED", provider: "SEPAY", amount: k.tongTien, referenceCode: k.ref, accountNumber: TAI_KHOAN, content: `${await khoaCua(k.orderId)} HOC PHI ONLINE` });
    expect(gd[0]!.transferredAt.toISOString()).toBe("2026-11-20T05:00:00.000Z");
    expect(gd[0]!.unmatchedNote).toContain(await maDon(k.orderId));
    await khongSinhGi(k.orderId, k.con);
  }, 30_000);

  describe("[DUA-08] tiền về đúng lúc đơn bị huỷ", () => {
    let orderId = "";
    let tong = 0;
    beforeAll(async () => {
      const k = await tienVeGiuaLucHuy();
      const so = await soTien(k.orderId);
      if (so.don !== "CANCELLED" || so.tienDu !== 0 || so.payment !== 0 || (await giaoDich(k.ref))[0]?.status !== "UNMATCHED") throw new Error(`dựng sai: ${JSON.stringify(so)}`);
      orderId = k.orderId;
      tong = k.tongTien;
    }, 30_000);

    it("[DUA-08] hàng đợi «đơn đã huỷ nhưng có tiền» phải thấy đơn này", async () => {
      expect(await dongHangDoi(orderId)).toEqual([expect.objectContaining({ orderId, daThu: 0, choDoiSoat: tong })]);
    });
  });

  it("[DUA-09] tiền về SAU khi huỷ xong: vào hàng chờ nêu đơn; gửi lại không ghi đôi; chuyển khoản thứ hai là dòng thứ hai; phần đã gắn tay được trừ", async () => {
    const ph = await phuHuynh("sau");
    const d = await datDon(ph);
    expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: d.orderId, now: NOW })).toMatchObject({ ok: true });
    expect(await dongHangDoi(d.orderId)).toEqual([]);

    const ref = maGiaoDich();
    expect(await traTien(d.orderId, d.tongTien, ref)).toMatchObject({ status: "UNMATCHED" });
    const [dau] = await giaoDich(ref);
    expect(dau).toMatchObject({ status: "UNMATCHED", amount: d.tongTien, referenceCode: ref, accountNumber: TAI_KHOAN });
    expect(dau!.unmatchedNote).toContain(await maDon(d.orderId));
    for (let i = 0; i < 2; i++) expect(await traTien(d.orderId, d.tongTien, ref)).toMatchObject({ status: "UNMATCHED", bankTransactionId: dau!.id });
    expect(await giaoDich(ref)).toHaveLength(1);
    expect((await giaoDich(ref))[0]!.unmatchedNote).toBe(dau!.unmatchedNote);
    expect(await dongHangDoi(d.orderId)).toEqual([expect.objectContaining({ choDoiSoat: d.tongTien, daThu: 0 })]);
    await khongSinhGi(d.orderId, ph.con);

    const ref2 = maGiaoDich();
    expect(await traTien(d.orderId, 120_000, ref2)).toMatchObject({ status: "UNMATCHED" });
    expect(await dongHangDoi(d.orderId)).toEqual([expect.objectContaining({ choDoiSoat: d.tongTien + 120_000 })]);

    // FIN-11: giao dịch UNMATCHED có thể đã gắn MỘT PHẦN sang đơn khác ⇒ số còn chờ = số tiền − Σ phân bổ.
    const dich = await datDon(await phuHuynh("sau-dich"));
    const phieuDich = await db.paymentRequest.findFirstOrThrow({ where: { orderId: dich.orderId }, select: { id: true } });
    await db.paymentAllocation.create({ data: { bankTransactionId: dau!.id, paymentRequestId: phieuDich.id, amount: 100_000 } });
    expect(await dongHangDoi(d.orderId)).toEqual([expect.objectContaining({ choDoiSoat: d.tongTien + 20_000 })]);

    // Kế toán đã xử lý (giao dịch rời hàng chờ) ⇒ cũng rời số đếm.
    await db.paymentAllocation.deleteMany({ where: { bankTransactionId: dau!.id } });
    await db.bankTransaction.updateMany({ where: { providerTxnId: { in: [ref, ref2] } }, data: { status: "IGNORED" } });
    expect(await dongHangDoi(d.orderId)).toEqual([]);
  }, 30_000);

  it("[DUA-10] ĐUA + cổng gửi trùng hai bản song song rồi gửi lại ⇒ đúng một giao dịch, dấu nối không mất", async () => {
    const ref = maGiaoDich();
    const k = await giuaLucHuy((d) => [() => traTien(d.orderId, d.tongTien, ref), () => traTien(d.orderId, d.tongTien, ref)]);
    expect(k.huy).toMatchObject({ loai: "xong", v: { ok: true } });
    for (const t of k.tien) expect(["UNMATCHED", "DUPLICATE"]).toContain(t.loai === "xong" ? t.v.status : t.loi);
    const truoc = await giaoDich(ref);
    expect(truoc).toHaveLength(1);
    expect(truoc[0]).toMatchObject({ status: "UNMATCHED", amount: k.tongTien });
    expect(truoc[0]!.unmatchedNote).toContain(await maDon(k.orderId));
    for (let i = 0; i < 2; i++) expect(await traTien(k.orderId, k.tongTien, ref)).toMatchObject({ status: "UNMATCHED" });
    const sau = await giaoDich(ref);
    expect(sau).toHaveLength(1);
    expect(sau[0]!.unmatchedNote).toBe(truoc[0]!.unmatchedNote);
    expect(await dongHangDoi(k.orderId)).toEqual([expect.objectContaining({ choDoiSoat: k.tongTien })]);
    await khongSinhGi(k.orderId, k.con);
  }, 30_000);

  it("[DUA-11] ĐUA qua đúng route SePay ⇒ route không lùi sang đường sổ cũ; đơn vẫn CANCELLED, không Payment", async () => {
    // Khoá GIẢ của riêng ca này (route đọc env lúc gọi) — không phải bí mật, cùng nếp spec R7 `sepay-webhook-route`.
    const khoaThu = "sepay-test-key";
    process.env.SEPAY_WEBHOOK_API_KEY = khoaThu;
    const ref = maGiaoDich();
    const goiRoute = async (orderId: string, tien: number) =>
      sepayPost(
        new NextRequest("http://localhost/api/public/webhook/sepay", {
          method: "POST",
          headers: { authorization: `Apikey ${khoaThu}`, "content-type": "application/json" },
          body: JSON.stringify({ id: ref, referenceCode: ref, transferType: "in", transferAmount: tien, accountNumber: TAI_KHOAN, content: `${await khoaCua(orderId)} HOC PHI ONLINE`, transactionDate: "2026-11-20 12:00:00" }),
        }),
      ).then(async (r) => ({ http: r.status, than: (await r.json()) as { handled?: boolean } }));
    const k = await giuaLucHuy((d) => [() => goiRoute(d.orderId, d.tongTien)]);
    delete process.env.SEPAY_WEBHOOK_API_KEY;
    expect(k.huy).toMatchObject({ loai: "xong", v: { ok: true } });
    expect(k.tien[0]).toMatchObject({ loai: "xong", v: { http: 200, than: { handled: false } } });
    expect(await giaoDich(ref)).toEqual([expect.objectContaining({ status: "UNMATCHED", amount: k.tongTien })]);
    await khongSinhGi(k.orderId, k.con);
  }, 30_000);

  it("[DUA-12] tiền về TRƯỚC (ghi xong) rồi mới huỷ ⇒ DA_CO_TIEN; tiền đã ghi vào đơn, không nằm ở số chờ đối soát", async () => {
    const ph = await phuHuynh("truoc");
    const d = await datDon(ph);
    const tra = d.tongTien - 100_000;
    expect(await traTien(d.orderId, tra)).toMatchObject({ status: "MATCHED", allocated: tra, credit: 0 });
    expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: d.orderId, now: NOW })).toMatchObject({ ok: false, ma: "DA_CO_TIEN" });
    expect(await soTien(d.orderId)).toEqual({ don: "PENDING_PAYMENT", payment: tra, phanBo: tra, tienDu: 0 });
    expect(await dongHangDoi(d.orderId)).toEqual([]);
  }, 30_000);

  /** Giữ khoá đơn của nhà B rồi đo: việc của người KHÔNG sở hữu phải trả lời ngay, không xếp hàng vào khoá đó. */
  async function khiKhoaDonBiGiu<T>(orderId: string, viec: () => Promise<T>): Promise<T | "TREO"> {
    const cong = await giuKhoa(async (tx) => {
      await khoaDonTrongTx(tx as never, orderId);
    });
    const p = viec();
    const kq = await Promise.race([p, nghi(1_500).then(() => "TREO" as const)]);
    await cong.nha();
    await p.catch(() => undefined);
    return kq;
  }

  it("[DUA-04] huỷ đơn nhà khác trả KHONG_TIM_THAY ngay, không lấy khoá đơn của họ", async () => {
    const [a, b] = [await phuHuynh("k-a"), await phuHuynh("k-b")];
    const dB = await datDon(b);
    expect(await khiKhoaDonBiGiu(dB.orderId, () => huyDonOnlineChuaThanhToan(db, { parentUserId: a.id, orderId: dB.orderId, now: NOW }))).toMatchObject({ ok: false, ma: "KHONG_TIM_THAY" });
    expect((await soTien(dB.orderId)).don).toBe("PENDING_PAYMENT");
  }, 30_000);

  it("[DUA-05] gửi và rút yêu cầu hoàn cho đơn nhà khác trả KHONG_TIM_THAY ngay, không lấy khoá đơn của họ", async () => {
    const [a, b] = [await phuHuynh("h-a"), await phuHuynh("h-b")];
    const dB = await datDon(b);
    const dong = dB.dong[0]!.orderItemId;
    const tao = await khiKhoaDonBiGiu(dB.orderId, () =>
      taoYeuCauHoanOnline(db, { orderId: dB.orderId, orderItemId: dong, lyDo: "Không còn nhu cầu học nữa", nguon: { kenh: "PARENT", parentUserId: a.id }, choPhepPhuHuynh: true, now: NOW }),
    );
    expect(tao).toMatchObject({ ok: false, ma: "KHONG_TIM_THAY" });
    // Yêu cầu của chính nhà B (tạo thẳng để có id thật), nhà A đi rút.
    const yc = await db.refundRequest.create({ data: { orderItemId: dong, trigger: "MANUAL", reason: "Lý do của chủ đơn đủ dài", paidConfirmed: 0, sessionsTotal: 0, sessionsLearned: 0, unitPrice: 0, proposedAmount: 0, status: "PENDING", requestedById: b.id, kenh: "ONLINE", kenhYeuCau: "PARENT", centerId: null, orgUnitId: null }, select: { id: true } });
    const rut = await khiKhoaDonBiGiu(dB.orderId, () => rutYeuCauHoanOnline(db, { parentUserId: a.id, orderId: dB.orderId, id: yc.id, now: NOW }));
    expect(rut).toMatchObject({ ok: false, ma: "KHONG_TIM_THAY" });
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: yc.id }, select: { status: true } })).status).toBe("PENDING");
    // đối chứng dương: chính chủ rút được
    expect(await rutYeuCauHoanOnline(db, { parentUserId: b.id, orderId: dB.orderId, id: yc.id, now: NOW })).toMatchObject({ ok: true });
  }, 30_000);

  /** Hai lượt tạo đơn khác giỏ cùng đọc «số lượt đã dùng» TRƯỚC khi lượt nào ghi: ép bằng cách giữ khoá dòng phụ huynh, chờ cả hai đứng ở đó rồi nhả. */
  async function haiDonCungLuc(parentUserId: string, gioA: unknown, gioB: unknown) {
    const cong = await giuKhoa(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${parentUserId} FOR UPDATE`;
    });
    const a = taoDonOnline(db, { parentUserId, gioHang: gioA, now: NOW });
    const b = taoDonOnline(db, { parentUserId, gioHang: gioB, now: NOW });
    await choDenKhi(2);
    await cong.nha();
    return Promise.all([a, b]);
  }

  it("[DUA-06] mã 1 lượt/con: hai đơn khác giỏ gửi cùng lúc ⇒ đúng một thắng, kẻ thua không để lại đơn/phiếu/lượt", async () => {
    const ph = await phuHuynh("ma1");
    const [k1, k2] = [await dungKhoa(), await dungKhoa()];
    const voucherId = await dungMa([k1, k2], 1);
    const kq = await haiDonCungLuc(ph.id, [{ courseId: k1, studentId: ph.con, voucherId }], [{ courseId: k2, studentId: ph.con, voucherId }]);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect(kq.filter((k) => !k.ok).map((k) => (k.ok ? "" : k.ma))).toEqual(["MA_HET_LUOT_CUA_CON"]);
    expect(await db.voucherRedemption.count({ where: { voucherId } })).toBe(1);
    expect((await db.voucher.findUniqueOrThrow({ where: { id: voucherId }, select: { usedCount: true } })).usedCount).toBe(1);
    expect(await db.order.count({ where: { createdById: ph.id } })).toBe(1);
    expect(await db.paymentRequest.count({ where: { order: { createdById: ph.id } } })).toBe(1);
    expect(await db.orderOnlineGrant.count({ where: { studentId: ph.con } })).toBe(1);
  }, 30_000);

  it("[DUA-07] mã 2 lượt/con: giỏ hai dòng đua giỏ một dòng ⇒ số lượt đã dùng không vượt 2", async () => {
    const ph = await phuHuynh("ma2");
    const [k1, k2, k3] = [await dungKhoa(), await dungKhoa(), await dungKhoa()];
    const voucherId = await dungMa([k1, k2, k3], 2);
    const kq = await haiDonCungLuc(ph.id, [{ courseId: k1, studentId: ph.con, voucherId }, { courseId: k2, studentId: ph.con, voucherId }], [{ courseId: k3, studentId: ph.con, voucherId }]);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect(kq.filter((k) => !k.ok).map((k) => (k.ok ? "" : k.ma))).toEqual(["MA_HET_LUOT_CUA_CON"]);
    const daDung = await db.voucherRedemption.count({ where: { voucherId } });
    expect(daDung).toBeLessThanOrEqual(2);
    expect((await db.voucher.findUniqueOrThrow({ where: { id: voucherId }, select: { usedCount: true } })).usedCount).toBe(daDung);
  }, 30_000);
});
