// tests/finance/gan-them-khoan-db.test.ts — [GKH-DB-*] «gắn thêm MỘT khoản thu vào hoá đơn ĐÃ XÁC NHẬN» trên Postgres THẬT: đọc → kế hoạch → cổng ký → ghi → bất biến → idempotent → rollback.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/gan-them-khoan-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `fx-gtk-`; KHÔNG `resetDb()`.
//
// Fixture mang HÌNH DẠNG CA THẬT (đo 06/11/2026): đơn 8.976.000đ thu hai lần — đợt 1 1.000.000đ (đã nằm trong hoá đơn 1C26MAI-16, đã xác nhận),
// đợt 2 7.976.000đ (CHỜ xác nhận, chưa gắn hoá đơn nào). Tờ giấy MISA số 16 ghi 8.976.000đ.
//
// Ánh xạ yêu cầu → ca:
//   ghi đúng HAI bảng, không đụng Payment/Receipt/tệp/số/email ⇒ [00] [01]   |   idempotent (không cổng, không claim) ⇒ [02]   |   cổng ký (thiếu · sai workflow · sai dòng · dùng lại nonce) ⇒ [03..06]
//   từ chối nghiệp vụ không ghi gì ⇒ [07..11]   |   rollback khi phép ghi hỏng giữa chừng ⇒ [12]   |   bất biến bị phá ⇒ rollback ⇒ [13]   |   kiểm sau ghi ⇒ [14]   |   khoản gắn tay (BankTransaction) ⇒ [15]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi, type TenWorkflowWave1 } from "@/lib/security/cong-ghi-wave1";
import { gatewayMarker, maGiaoDichMarker } from "@/lib/finance/payment-markers";
import type { MucTieuGanKhoan } from "@/lib/finance/hoa-don/gan-them-khoan";
import {
  ACTOR_GAN_THEM_KHOAN,
  docKeHoachGanKhoan,
  ghiGanKhoan,
  ghiGanKhoanTrongTx,
  kiemSauGhiGanKhoan,
  type DauVaoGhiGanKhoan,
} from "@/lib/finance/hoa-don/gan-them-khoan-db";

if (!RUN_DB_TESTS) console.warn(`[GKH-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const T = "fx-gtk-";
const CS = `${T}center`;
const DON = `${T}don`;
const MA_DON = "ORD-269926-000301";
const HD16 = `${T}hd-16`;
const HD17 = `${T}hd-17`;
const P1 = `${T}p-dot1`;
const P2 = `${T}p-dot2`;
const FT2 = "FT26310040803067";
const FT1 = "FT26285380625068";
const BT2 = `${T}bt-dot2`;
const KT = `${T}ke-toan`;
const NOW = new Date("2699-11-06T08:00:00Z");
const DB_LOT = "luot:9830001";
const nonceDaDung: string[] = [];
const LUOT = { batDauLuc: NOW, nguonChay: { actor: "a", triggeringActor: "b", runId: "9830001", runAttempt: "1" } } as const;

const MUC: MucTieuGanKhoan = { maDon: MA_DON, kyHieu: "1C26MAI", soHoaDon: "16", maGiaoDich: FT2, tongTrenToGiay: 8_976_000 };

async function don() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gtk_boom_trg ON "HoaDonKhoan"`);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS gtk_leak_trg ON "HoaDonKhoan"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gtk_boom()`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS gtk_leak()`);
  await db.auditLog.deleteMany({
    where: { OR: [{ entityId: { startsWith: T } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: DB_LOT } }] },
  });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Hoá đơn 16: ĐÃ XÁC NHẬN, tải lên, 1.000.000đ, giữ đợt 1. Hình dạng thật: có tệp PDF, ngày phát hành, người mua, email đã chụp. */
async function dungFixture(o: { nguon?: "TAI_LEN" | "MISA_API"; trangThai?: "DA_XAC_NHAN" | "NHAP" } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture GTK", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  await db.order.create({
    data: { id: DON, code: MA_DON, type: "COURSE", status: "CONFIRMED", customerName: "PH GTK", customerPhone: "0999000777", totalAmount: 8_976_000, centerId: CS },
  });
  await db.payment.create({
    data: {
      id: P1, orderId: DON, amount: 1_000_000, method: "BANK_TRANSFER", paidDate: new Date("2699-10-11T03:00:00Z"), saleStatus: "RECORDED", accountantStatus: "CONFIRMED",
      note: gatewayMarker("sepay", FT1), centerId: CS,
    },
  });
  await db.payment.create({
    data: {
      id: P2, orderId: DON, amount: 7_976_000, method: "BANK_TRANSFER", paidDate: new Date("2699-11-06T03:00:00Z"), saleStatus: "RECORDED", accountantStatus: "PENDING",
      note: gatewayMarker("sepay", FT2), centerId: CS,
    },
  });
  await db.hoaDonDienTu.create({
    data: {
      id: HD16, orderId: DON, centerId: CS, trangThai: o.trangThai ?? "DA_XAC_NHAN", nguonPhatHanh: o.nguon ?? "TAI_LEN", kyHieu: "1C26MAI", soHoaDon: "16", ngayPhatHanh: new Date("2699-11-06T00:00:00Z"),
      tepPdfKey: `hoa-don/CS1/2699/${DON}/16.pdf`, tepPdfTen: "16.pdf", tepPdfCo: 1234, tepPdfSha256: "a".repeat(64), emailNhan: null, guiEmailKhach: false, nguoiMuaTen: "Lê Hải Tuân",
      tongTien: 1_000_000, taoBoiId: KT, xacNhanBoiId: KT, xacNhanLuc: new Date("2699-11-06T05:00:00Z"),
      khoan: { create: [{ paymentId: P1, soTien: 1_000_000 }] },
    },
  });
}

async function cong(rows: readonly string[], o: Partial<TuyChinhCongGhi> = {}, workflow: TenWorkflowWave1 = WORKFLOW_WAVE1.ganKhoanHoaDon): Promise<DauVaoCongGhi> {
  const c = dungCongGhiThu(workflow, rows, { now: NOW, ...o });
  nonceDaDung.push(c.artifact.payload.nonce);
  return c.cong;
}

async function dauVao(o: Partial<DauVaoGhiGanKhoan> = {}, tuyChinhCong: Partial<TuyChinhCongGhi> = {}): Promise<DauVaoGhiGanKhoan> {
  const muc = o.muc ?? MUC;
  // Luôn KÝ theo kế hoạch SẠCH của mục tiêu chuẩn: ca nào cố tình làm hỏng mục tiêu / dữ liệu thì chữ ký vẫn đúng, để ca đỏ vì ĐÚNG lý do nó nhắm tới.
  const khSach = await docKeHoachGanKhoan(db, MUC);
  const rows = khSach.dongDauRa.length > 0 ? khSach.dongDauRa : ["x"];
  return { muc, soDuyet: 1, ghiDuoc: true, actor: ACTOR_GAN_THEM_KHOAN, luotChay: LUOT, congGhi: await cong(rows, tuyChinhCong), ...o };
}

/** Mọi thứ mà lệnh KHÔNG được đụng + hai thứ nó được đổi, đọc một lượt. */
async function trangThai() {
  const [hd, khoan, p1, p2, receipts, guiEmail, dong, audit] = await Promise.all([
    db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD16 } }),
    db.hoaDonKhoan.findMany({ where: { hoaDonId: HD16 }, orderBy: { paymentId: "asc" } }),
    db.payment.findUniqueOrThrow({ where: { id: P1 } }),
    db.payment.findUniqueOrThrow({ where: { id: P2 } }),
    db.receipt.count({ where: { paymentId: { startsWith: T } } }),
    db.hoaDonGuiEmail.count({ where: { hoaDonId: HD16 } }),
    db.hoaDonDong.count({ where: { hoaDonId: HD16 } }),
    db.auditLog.findMany({ where: { OR: [{ entityId: HD16 }, { entityId: { startsWith: DB_LOT } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }] }, select: { id: true, action: true } }),
  ]);
  return { hd, khoan, p1, p2, receipts, guiEmail, dong, audit };
}

const loiCua = async (p: Promise<unknown>): Promise<Error | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
};

describe.skipIf(!RUN_DB_TESTS)("[GKH-DB] gắn thêm khoản vào hoá đơn đã xác nhận — Postgres thật", () => {
  beforeEach(() => dungFixture());
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[GKH-DB-00] kế hoạch (chạy thử) tìm đúng khoản đợt 2 qua mã giao dịch và ra MỘT dòng ghi 1.000.000 → 8.976.000", async () => {
    const kh = await docKeHoachGanKhoan(db, MUC);
    expect(kh.loi).toEqual([]);
    expect(kh.ghi).toEqual({ hoaDonId: HD16, paymentId: P2, soTien: 7_976_000, tongTruoc: 1_000_000, tongSau: 8_976_000 });
    expect(kh.dongDauRa).toHaveLength(1);
    // Chạy thử KHÔNG ghi: hai bảng đứng yên.
    const s = await trangThai();
    expect(s.khoan.map((k) => k.paymentId)).toEqual([P1]);
    expect(s.hd.tongTien).toBe(1_000_000);
  });

  it("[GKH-DB-01] GHI: thêm đúng một dòng HoaDonKhoan + nâng tongTien; KHÔNG đụng Payment · Receipt · tệp · số · người mua · email; có audit + claim nonce + audit lượt", async () => {
    const truoc = await trangThai();
    const r = await ghiGanKhoan(db, await dauVao());
    expect(r).toMatchObject({ daGhi: 1, daXong: true, tongSau: 8_976_000 });
    const sau = await trangThai();

    expect(sau.khoan.map((k) => [k.paymentId, k.soTien, k.hieuLuc])).toEqual([[P1, 1_000_000, true], [P2, 7_976_000, true]]);
    expect(sau.hd.tongTien).toBe(8_976_000);
    // Phần được đổi chỉ có hai thứ ấy: so TOÀN BỘ hoá đơn trừ tongTien + updatedAt.
    const { tongTien: _a, updatedAt: _b, ...hdSau } = sau.hd;
    const { tongTien: _c, updatedAt: _d, ...hdTruoc } = truoc.hd;
    void [_a, _b, _c, _d];
    expect(hdSau).toEqual(hdTruoc);
    expect(sau.hd.trangThai).toBe("DA_XAC_NHAN");
    expect(sau.hd.soHoaDon).toBe("16");
    expect(sau.hd.tepPdfSha256).toBe("a".repeat(64));
    // Khoản KHÔNG được xác nhận hộ: vẫn CHỜ, không phiếu thu, không lượt gửi email.
    expect(sau.p2).toEqual(truoc.p2);
    expect(sau.p2.accountantStatus).toBe("PENDING");
    expect(sau.p1).toEqual(truoc.p1);
    expect(sau.receipts).toBe(0);
    expect(sau.guiEmail).toBe(0);
    expect(sau.dong).toBe(0);
    // Dấu vết: audit hoá đơn (cũ → mới + lý do) + claim nonce + audit lượt.
    expect(sau.audit.filter((a) => a.action === "GAN_THEM_KHOAN_HOA_DON")).toHaveLength(1);
    expect(sau.audit.filter((a) => a.action === "GAN_THEM_KHOAN_HOA_DON_LUOT")).toHaveLength(1);
    expect(sau.audit.filter((a) => a.id.startsWith("wg:"))).toHaveLength(1); // claim nonce — dùng-một-lần
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: HD16, action: "GAN_THEM_KHOAN_HOA_DON" } });
    expect(log.reason).toMatch(/MISA/);
    expect(log.oldValues).toMatchObject({ tongTien: 1_000_000 });
    expect(log.newValues).toMatchObject({ tongTien: 8_976_000, paymentIdThem: P2, soTienThem: 7_976_000 });
  });

  it("[GKH-DB-02] chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim thêm (artifact rỗng vẫn qua vì không cần)", async () => {
    await ghiGanKhoan(db, await dauVao());
    const truoc = await trangThai();
    const lai = await dauVao({ congGhi: { ...(await cong(["x"])), artifact: null } });
    const r = await ghiGanKhoan(db, { ...lai, soDuyet: null });
    expect(r).toMatchObject({ daGhi: 0, daXong: true });
    const sau = await trangThai();
    expect(sau.khoan).toEqual(truoc.khoan);
    expect(sau.audit).toEqual(truoc.audit);
    expect(sau.hd.updatedAt).toEqual(truoc.hd.updatedAt);
  });

  it("[GKH-DB-03] thiếu artifact owner ⇒ CongGhiTuChoi, KHÔNG ghi gì (hoá đơn đứng yên)", async () => {
    const e = await loiCua(ghiGanKhoan(db, await dauVao({ congGhi: { ...(await cong(["x"])), artifact: null } })));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    const s = await trangThai();
    expect(s.hd.tongTien).toBe(1_000_000);
    expect(s.khoan).toHaveLength(1);
  });

  it("[GKH-DB-04] artifact ký cho workflow KHÁC (vd sua-gia-theo-don) ⇒ từ chối — chữ ký của việc khác không dùng chéo", async () => {
    const kh = await docKeHoachGanKhoan(db, MUC);
    const e = await loiCua(ghiGanKhoan(db, await dauVao({ congGhi: await cong(kh.dongDauRa, {}, WORKFLOW_WAVE1.suaGiaTheoDon) })));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((await trangThai()).khoan).toHaveLength(1);
  });

  it("[GKH-DB-05] owner KÝ DÒNG KHÁC (khoản / số khác) ⇒ từ chối — đổi ô nhập là đổi chữ ký", async () => {
    const kh = await docKeHoachGanKhoan(db, MUC);
    const dongKhac = kh.dongDauRa.map((d) => d.replace(P2, "pay-khac"));
    const e = await loiCua(ghiGanKhoan(db, await dauVao({ congGhi: await cong(kh.dongDauRa, { rowsKy: dongKhac }) })));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((await trangThai()).khoan).toHaveLength(1);
  });

  it("[GKH-DB-06] dùng lại artifact đã claim (replay nonce) ⇒ từ chối", async () => {
    const kh = await docKeHoachGanKhoan(db, MUC);
    const congDung = await cong(kh.dongDauRa);
    await ghiGanKhoan(db, await dauVao({ congGhi: congDung }));
    // Khôi phục trạng thái «chưa gắn» rồi cố ghi lại bằng CHÍNH artifact cũ.
    await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: HD16, paymentId: P2 } });
    await db.hoaDonDienTu.update({ where: { id: HD16 }, data: { tongTien: 1_000_000 } });
    const e = await loiCua(ghiGanKhoan(db, await dauVao({ congGhi: congDung })));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((await trangThai()).khoan).toHaveLength(1);
  });

  it("[GKH-DB-07] tổng trên tờ giấy LỆCH ⇒ chặn trước khi chạm gì; thiếu tờ giấy ⇒ chặn; sai --expect ⇒ chặn", async () => {
    const lech = await loiCua(ghiGanKhoan(db, await dauVao({ muc: { ...MUC, tongTrenToGiay: 9_000_000 } })));
    expect(lech?.message).toMatch(/TONG_KHONG_KHOP_TO_GIAY/);
    const thieu = await loiCua(ghiGanKhoan(db, await dauVao({ muc: { ...MUC, tongTrenToGiay: null } })));
    expect(thieu?.message).toMatch(/tờ hoá đơn giấy/);
    const sai = await loiCua(ghiGanKhoan(db, await dauVao({ soDuyet: 2 })));
    expect(sai?.message).toMatch(/--expect=2/);
    const s = await trangThai();
    expect(s.hd.tongTien).toBe(1_000_000);
    expect(s.khoan).toHaveLength(1);
    expect(s.audit).toEqual([]);
  });

  it("[GKH-DB-08] kế toán ĐÃ bắt đầu tải số 17 (khoản nằm trong hoá đơn NHÁP) ⇒ từ chối, nói rõ hoá đơn nào", async () => {
    await db.hoaDonDienTu.create({
      data: {
        id: HD17, orderId: DON, centerId: CS, trangThai: "NHAP", kyHieu: "1C26MAI", soHoaDon: "17", ngayPhatHanh: new Date("2699-11-06T00:00:00Z"), tongTien: 7_976_000, taoBoiId: KT,
        khoan: { create: [{ paymentId: P2, soTien: 7_976_000 }] },
      },
    });
    const kh = await docKeHoachGanKhoan(db, MUC);
    expect(kh.loi.map((l) => l.ma)).toContain("KHOAN_DANG_NAM_TRONG_HOA_DON_KHAC");
    expect(kh.loi.find((l) => l.ma === "KHOAN_DANG_NAM_TRONG_HOA_DON_KHAC")?.chiTiet).toMatch(/17/);
    const e = await loiCua(ghiGanKhoan(db, await dauVao()));
    expect(e?.message).toMatch(/KHOAN_DANG_NAM_TRONG_HOA_DON_KHAC/);
    const s = await trangThai();
    expect(s.khoan.map((k) => k.paymentId)).toEqual([P1]);
    expect(s.hd.tongTien).toBe(1_000_000);
  });

  it("[GKH-DB-09] hoá đơn do MISA API phát hành ⇒ từ chối (nguồn sự thật ở MISA)", async () => {
    await dungFixture({ nguon: "MISA_API" });
    const kh = await docKeHoachGanKhoan(db, MUC);
    expect(kh.loi.map((l) => l.ma)).toContain("HOA_DON_KHONG_PHAI_TAI_LEN");
    const e = await loiCua(ghiGanKhoan(db, { muc: MUC, soDuyet: 1, ghiDuoc: true, actor: ACTOR_GAN_THEM_KHOAN, luotChay: LUOT, congGhi: await cong(["x"]) }));
    expect(e?.message).toMatch(/HOA_DON_KHONG_PHAI_TAI_LEN/);
    expect((await trangThai()).khoan).toHaveLength(1);
  });

  it("[GKH-DB-10] hoá đơn còn NHÁP (chưa xác nhận) ⇒ từ chối", async () => {
    await dungFixture({ trangThai: "NHAP" });
    const kh = await docKeHoachGanKhoan(db, MUC);
    expect(kh.loi.map((l) => l.ma)).toContain("HOA_DON_SAI_TRANG_THAI");
  });

  it("[GKH-DB-11] không tìm thấy khoản theo mã giao dịch / mã đơn sai ⇒ lỗi nói rõ, không ghi", async () => {
    const sai = await docKeHoachGanKhoan(db, { ...MUC, maGiaoDich: "FT00000000000000" });
    expect(sai.loi.map((l) => l.ma)).toContain("KHONG_THAY_KHOAN");
    const donSai = await docKeHoachGanKhoan(db, { ...MUC, maDon: "ORD-000000-000000" });
    expect(donSai.loi.map((l) => l.ma)).toEqual(["KHONG_THAY_DON"]);
  });

  it("[GKH-DB-12] phép ghi hỏng GIỮA CHỪNG (trigger ném khi chèn HoaDonKhoan) ⇒ cả lượt lùi: tongTien về cũ, không audit, nonce CHƯA bị đốt", async () => {
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION gtk_boom() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'GTK boom'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER gtk_boom_trg BEFORE INSERT ON "HoaDonKhoan" FOR EACH ROW WHEN (NEW."paymentId" = '${P2}') EXECUTE FUNCTION gtk_boom()`);
    const vao = await dauVao();
    const e = await loiCua(ghiGanKhoan(db, vao));
    expect(e?.message).toMatch(/GTK boom/);
    const s = await trangThai();
    expect(s.hd.tongTien).toBe(1_000_000);
    expect(s.khoan.map((k) => k.paymentId)).toEqual([P1]);
    expect(s.audit).toEqual([]); // kể cả claim `wg:<nonce>` cũng lùi
    // Gỡ trigger: CHÍNH artifact đó dùng lại được (chưa bị đốt) ⇒ chứng minh claim nằm trong cùng transaction.
    await db.$executeRawUnsafe(`DROP TRIGGER gtk_boom_trg ON "HoaDonKhoan"`);
    const r = await ghiGanKhoan(db, vao);
    expect(r.daGhi).toBe(1);
  });

  it("[GKH-DB-13] bất biến bị phá (trigger sửa Payment khi chèn HoaDonKhoan) ⇒ ảnh chụp lệch ⇒ cả lượt lùi", async () => {
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION gtk_leak() RETURNS trigger AS $$ BEGIN UPDATE "Payment" SET note = COALESCE(note, '') || ' LEAK' WHERE id = NEW."paymentId"; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER gtk_leak_trg AFTER INSERT ON "HoaDonKhoan" FOR EACH ROW EXECUTE FUNCTION gtk_leak()`);
    const e = await loiCua(ghiGanKhoan(db, await dauVao()));
    expect(e?.message).toMatch(/Ảnh chụp bất biến/);
    const s = await trangThai();
    expect(s.hd.tongTien).toBe(1_000_000);
    expect(s.khoan).toHaveLength(1);
    expect(s.p2.note).toBe(gatewayMarker("sepay", FT2));
  });

  it("[GKH-DB-14] kiểm sau ghi: trước khi ghi ⇒ KHÔNG đạt; sau khi ghi ⇒ đạt", async () => {
    expect((await kiemSauGhiGanKhoan(db, MUC)).dat).toBe(false);
    await ghiGanKhoan(db, await dauVao());
    const r = await kiemSauGhiGanKhoan(db, MUC);
    expect(r.dat).toBe(true);
    expect(r.luotCuoi?.orderCode).toBe(MA_DON);
  });

  it("[GKH-DB-15] khoản GẮN TAY (marker [gan-tay:<BankTransaction.id>]) vẫn tìm được qua providerTxnId của giao dịch", async () => {
    await db.bankTransaction.create({
      data: { id: BT2, provider: "SEPAY", providerTxnId: FT2, amount: 7_976_000, transferredAt: new Date("2699-11-06T03:00:00Z"), status: "MATCHED", centerId: CS },
    });
    await db.payment.update({ where: { id: P2 }, data: { note: `[gan-tay:${BT2}]` } });
    const kh = await docKeHoachGanKhoan(db, MUC);
    expect(kh.loi).toEqual([]);
    expect(kh.ghi?.paymentId).toBe(P2);
  });

  it("[GKH-DB-17] khoản GHI TAY có khai mã giao dịch (marker [ma-gd:<mã>]) cũng tìm được — kể cả khi người chạy gõ mã có dấu gạch / chữ thường", async () => {
    await db.payment.update({ where: { id: P2 }, data: { note: maGiaoDichMarker(FT2) } });
    const kh = await docKeHoachGanKhoan(db, { ...MUC, maGiaoDich: ` ${FT2.slice(0, 4).toLowerCase()}-${FT2.slice(4)} ` });
    expect(kh.loi).toEqual([]);
    expect(kh.ghi?.paymentId).toBe(P2);
    // Mã KHÁC thì không khớp bừa.
    const khac = await docKeHoachGanKhoan(db, { ...MUC, maGiaoDich: "FT99999999999999" });
    expect(khac.loi.map((l) => l.ma)).toContain("KHONG_THAY_KHOAN");
  });

  it("[GKH-DB-16] gọi THẲNG lõi trong transaction của người khác: thiếu quyền ghi (ghiDuoc = null) ⇒ ném, không ghi", async () => {
    const vao = await dauVao({ ghiDuoc: null });
    const e = await loiCua(db.$transaction((tx) => ghiGanKhoanTrongTx(tx, vao)));
    expect(e?.message).toMatch(/Không kiểm được quyền ghi/);
    expect((await trangThai()).hd.tongTien).toBe(1_000_000);
  });
});
