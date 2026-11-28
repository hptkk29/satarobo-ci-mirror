import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as pdfGet } from "@/app/api/mobile/v1/parent/receipts/[paymentId]/pdf/route";
import { POST as lienKetPost } from "@/app/api/mobile/v1/parent/receipts/[paymentId]/download-link/route";
import { GET as dlGet } from "@/app/api/dl/phieu-thu/[token]/route";
import { khoanOnlineTaiDuoc, taoPdfPhieuThuOnlineChoPhuHuynh } from "@/lib/online-checkout/phieu-thu-online";
import { POST as huyPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { confirmPayment } from "@/lib/finance/payment";
import { TOI_DA_LAN_THU, capQuyenOnlineChoDon, hanThuLai } from "@/lib/online-checkout/cap-quyen-sau-thanh-toan";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ONL-P2T] V8.17 G4 — TRẠNG THÁI THANH TOÁN/CẤP QUYỀN + WEBHOOK (HTTP route-handler + Postgres + `ingestPayosWebhook` thật). Không gọi ngân hàng/nhà cung cấp thật.
 * Trạng thái KHÔNG có «thanh toán thất bại»/«hết hạn thanh toán»: hệ không có tín hiệu thật cho hai điều đó ⇒ không bịa.
 *   [ONL-P2T-01] webhook SAI đơn: memo lạ ⇒ không chạm đơn nào; tiền của đơn A không bao giờ rơi vào đơn B
 *   [ONL-P2T-02] theo tiền: CHO ⇒ THU_MOT_PHAN ⇒ THU_DU + DA_CAP_DU; thu DƯ vẫn MỘT quyền; webhook lặp không cấp đôi
 *   [ONL-P2T-03] 🔴 thu ĐỦ mà cấp quyền lỗi hạ tầng ⇒ DA_THU_DANG_CAP_QUYEN (KHÔNG «chờ thanh toán»), có `thuLaiLuc`; thử lại thật ⇒ DA_CAP_QUYEN
 *   [ONL-P2T-04] đơn 2 dòng, 1 dòng lỗi luật sau khi thu ⇒ dòng kia vẫn cấp, `CAN_XU_LY` + canDoiSoat; gọi lại không cấp đôi
 *   [ONL-P2T-05] đơn ĐÃ HUỶ mà có tiền về ⇒ DA_HUY + canDoiSoat, KHÔNG cấp quyền
 *   [ONL-P2T-06] thu đủ KHÔNG cần hoá đơn: quyền cấp khi chưa có HoaDonDienTu nào
 *   [ONL-P2T-08] V8.19 một đơn, HAI con cùng mua MỘT khoá: thu một nửa ⇒ chưa cấp ai; thu đủ ⇒ mỗi con đúng MỘT quyền; webhook lặp không cấp thêm
 *   [ONL-P2T-10] V8.19 phiếu thu PDF của khoản ONLINE (không ghi danh Offline, không cơ sở): chủ đơn tải được (route + liên kết ký); người khác/chế độ học sinh/chưa có pháp nhân ⇒ 404/403/503; pháp nhân theo Order.legalEntityId
 *   [ONL-P2T-09] V8.19 tiền về SAI THỨ TỰ + lệch số: phần lớn trước, phần nhỏ sau (cùng tổng) ⇒ cùng kết quả; giao dịch số tiền 0 / âm không đổi đơn
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onlp2t-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.100.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
let n = 0;

async function dungKhoa(gia = 500_000) {
  const t = await taoKhoa(db, { code: `ONLP2T-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung" } });
  if (!b.ok) throw new Error("bai");
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: caiDatKhoiDauChoBanNhap() });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, new Date());
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, gia };
}

async function don() {
  await donBangOnl(db);
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  const orders = await db.order.findMany({ where: { createdById: { in: uids } }, select: { id: true } });
  const oid = orders.map((o) => o.id);
  if (oid.length) {
    await db.voucherRedemption.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderOnlineGrant.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oid } } } });
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: oid } } } });
    await db.payment.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
    await db.order.deleteMany({ where: { id: { in: oid } } });
  }
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[ONL-P2T] trạng thái thanh toán + webhook đơn Online", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  const P = (k: string) => ids[k]!;
  afterEach(() => vi.restoreAllMocks());
  const taoDon = async (dong: Array<{ khoa: string; con: string }>) => {
    const r = await taoDonPost(req("POST", "/x", { dong: dong.map((d) => ({ studentId: d.con, khoaId: d.khoa })) }, bearer(tA)));
    expect(r.status).toBe(200);
    return (await json(r)).data as { orderId: string; tongTien: number; dong: Array<{ orderItemId: string }> };
  };
  const chiTiet = async (oid: string) => (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tA)), { params: Promise.resolve({ orderId: oid }) as never }))).data;
  const veTien = (matchKey: string, reference: string, amount: number) => ({ reference, description: `${matchKey} HOC PHI ONLINE`, amount, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" });
  const traTien = async (orderId: string, soTien: number, ref: string) => {
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    return ingestPayosWebhook(veTien(phieu.matchKey!, ref, soTien), "SEPAY");
  };
  const soQuyen = (sid: string, courseId: string) => db.onlEntitlement.count({ where: { studentId: sid, courseId } });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    ids.A = (await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: "PH A", phone: "84966990001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    for (const k of ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"]) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids.A } as never, select: { id: true } })).id;
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966990001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9f00-000000000001", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    tA = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(tA)));
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-P2T-01] webhook sai đơn: memo lạ không chạm đơn nào; tiền đơn A không rơi vào đơn B", async () => {
    const k1 = await dungKhoa();
    const k2 = await dungKhoa();
    const a = await taoDon([{ khoa: k1.courseId, con: P("sa1") }]);
    const b = await taoDon([{ khoa: k2.courseId, con: P("sa2") }]);
    const lac = await ingestPayosWebhook(veTien("ONLKHONGCO999999", `ONP2T-LAC-${Date.now()}`, 500_000), "SEPAY");
    expect(lac.status).not.toBe("MATCHED");
    for (const x of [a, b]) expect(await chiTiet(x.orderId)).toMatchObject({ daThu: 0, trangThaiThanhToan: "CHO_THANH_TOAN", trangThaiCapQuyen: "CHUA_CAP", canDoiSoat: false });
    expect((await traTien(a.orderId, 500_000, `ONP2T-A-${Date.now()}`)).status).toBe("MATCHED");
    expect(await chiTiet(b.orderId)).toMatchObject({ daThu: 0, trangThaiThanhToan: "CHO_THANH_TOAN", trangThaiCapQuyen: "CHUA_CAP" }); // B không bị chạm
    expect(await soQuyen(P("sa2"), k2.courseId)).toBe(0);
    expect(await soQuyen(P("sa1"), k1.courseId)).toBe(1);
  });

  it("[ONL-P2T-02] theo tiền: CHO ⇒ THU_MOT_PHAN ⇒ THU_DU + DA_CAP_DU; thu dư vẫn MỘT quyền; webhook lặp không cấp đôi", async () => {
    const k = await dungKhoa(500_000);
    const d = await taoDon([{ khoa: k.courseId, con: P("sa3") }]);
    let ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ trangThaiThanhToan: "CHO_THANH_TOAN", trangThaiCapQuyen: "CHUA_CAP" });
    expect(ct.dong[0]).toMatchObject({ trangThai: "DANG_CHO_THANH_TOAN", thuLaiLuc: null });
    await traTien(d.orderId, 200_000, `ONP2T-B1-${Date.now()}`);
    ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ daThu: 200_000, trangThaiThanhToan: "DA_THU_MOT_PHAN", trangThaiCapQuyen: "CHUA_CAP", canDoiSoat: false });
    expect(ct.dong[0].trangThai).toBe("DANG_CHO_THANH_TOAN"); // chưa đủ tiền ⇒ vẫn chờ
    const ref = `ONP2T-B2-${Date.now()}`;
    await traTien(d.orderId, 400_000, ref); // dư 100.000
    ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ trangThaiThanhToan: "DA_THU_DU", trangThaiCapQuyen: "DA_CAP_DU", canDoiSoat: false });
    expect(ct.dong[0]).toMatchObject({ trangThai: "DA_CAP_QUYEN" });
    expect(ct.dong[0].hetHan).toBeTruthy();
    await traTien(d.orderId, 400_000, ref); // gửi lại cùng mã giao dịch
    expect(await soQuyen(P("sa3"), k.courseId)).toBe(1);
    expect(await db.orderOnlineGrant.count({ where: { orderId: d.orderId, status: "GRANTED" } })).toBe(1);
  });

  it("[ONL-P2T-03] 🔴 thu đủ mà cấp quyền lỗi hạ tầng ⇒ DA_THU_DANG_CAP_QUYEN (không «chờ thanh toán») + thuLaiLuc; thử lại thật ⇒ DA_CAP_QUYEN", async () => {
    const k = await dungKhoa(500_000);
    const d = await taoDon([{ khoa: k.courseId, con: P("sa4") }]);
    const NOW = new Date();
    await db.payment.create({ data: { orderId: d.orderId, amount: 500_000, method: "BANK_TRANSFER", paidDate: NOW } }); // tiền đã ghi sổ, CHƯA qua cầu nối cấp quyền
    vi.spyOn(db, "$transaction").mockImplementationOnce((() => Promise.reject(new Error("mất kết nối giả"))) as never);
    const loi = await capQuyenOnlineChoDon(db, d.orderId, NOW);
    expect(loi.dong[0]).toMatchObject({ ketQua: "LOI_HA_TANG" });
    vi.restoreAllMocks();
    let ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ trangThaiThanhToan: "DA_THU_DU", trangThaiCapQuyen: "DANG_CAP_QUYEN", canDoiSoat: false });
    expect(ct.dong[0].trangThai).toBe("DA_THU_DANG_CAP_QUYEN");
    expect(new Date(ct.dong[0].thuLaiLuc).getTime()).toBe(hanThuLai(NOW, 1).getTime());
    expect(await soQuyen(P("sa4"), k.courseId)).toBe(0);
    await capQuyenOnlineChoDon(db, d.orderId, new Date(NOW.getTime() + 3600_000)); // thử lại THẬT
    ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ trangThaiCapQuyen: "DA_CAP_DU" });
    expect(ct.dong[0]).toMatchObject({ trangThai: "DA_CAP_QUYEN", thuLaiLuc: null });
    expect(await soQuyen(P("sa4"), k.courseId)).toBe(1);
    // quá số lần thử ⇒ người xử lý (không lặp mãi)
    const k2 = await dungKhoa(500_000);
    const d2 = await taoDon([{ khoa: k2.courseId, con: P("sa5") }]);
    await db.payment.create({ data: { orderId: d2.orderId, amount: 500_000, method: "BANK_TRANSFER", paidDate: NOW } });
    vi.spyOn(db, "$transaction").mockImplementation((() => Promise.reject(new Error("hạ tầng chết"))) as never);
    for (let i = 0; i < TOI_DA_LAN_THU; i++) await capQuyenOnlineChoDon(db, d2.orderId, NOW);
    vi.restoreAllMocks();
    ct = await chiTiet(d2.orderId);
    expect(ct).toMatchObject({ trangThaiCapQuyen: "CAN_XU_LY", canDoiSoat: true });
    expect(ct.dong[0].trangThai).toBe("CAN_NHAN_VIEN_XU_LY");
  });

  it("[ONL-P2T-04] đơn 2 dòng, 1 dòng lỗi luật sau khi thu ⇒ dòng kia vẫn cấp; CAN_XU_LY + canDoiSoat; gọi lại không cấp đôi", async () => {
    const kOk = await dungKhoa(300_000);
    const kLoi = await dungKhoa(200_000);
    const d = await taoDon([{ khoa: kOk.courseId, con: P("sa6") }, { khoa: kLoi.courseId, con: P("sa6") }]);
    expect(d.tongTien).toBe(500_000);
    await db.onlCourse.update({ where: { id: kLoi.courseId }, data: { deletedAt: new Date() } }); // khoá bị xoá giữa lúc đặt và trả
    expect((await traTien(d.orderId, 500_000, `ONP2T-C-${Date.now()}`)).status).toBe("MATCHED");
    const ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ trangThaiThanhToan: "DA_THU_DU", trangThaiCapQuyen: "CAN_XU_LY", canDoiSoat: true });
    expect(ct.dong.map((x: { trangThai: string }) => x.trangThai).sort()).toEqual(["CAN_NHAN_VIEN_XU_LY", "DA_CAP_QUYEN"]);
    await capQuyenOnlineChoDon(db, d.orderId, new Date());
    await capQuyenOnlineChoDon(db, d.orderId, new Date());
    expect(await soQuyen(P("sa6"), kOk.courseId)).toBe(1);
    expect(await soQuyen(P("sa6"), kLoi.courseId)).toBe(0);
  });

  it("[ONL-P2T-05] đơn ĐÃ HUỶ mà có tiền về ⇒ DA_HUY + canDoiSoat, KHÔNG cấp quyền", async () => {
    const k = await dungKhoa(500_000);
    const d = await taoDon([{ khoa: k.courseId, con: P("sa7") }]);
    const h = await huyPost(req("POST", "/x", {}, bearer(tA)), { params: Promise.resolve({ orderId: d.orderId }) as never });
    expect(h.status).toBe(200);
    await db.payment.create({ data: { orderId: d.orderId, amount: 500_000, method: "BANK_TRANSFER", paidDate: new Date() } }); // tiền về muộn sau khi đã huỷ
    const kq = await capQuyenOnlineChoDon(db, d.orderId, new Date());
    expect(kq.dong.every((x) => x.ketQua !== "DA_CAP")).toBe(true);
    expect(await soQuyen(P("sa7"), k.courseId)).toBe(0);
    const ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ trangThaiThanhToan: "DA_HUY", canDoiSoat: true, trangThaiCapQuyen: "CHUA_CAP" });
    expect(ct.dong[0].trangThai).toBe("DANG_CHO_THANH_TOAN");
  });

  it("[ONL-P2T-06] thu đủ KHÔNG cần hoá đơn: quyền cấp khi chưa có HoaDonDienTu nào cho đơn", async () => {
    const k = await dungKhoa(500_000);
    const sid = (await db.student.create({ data: { id: `${NS}shd`, name: "Bé hd", parentUserId: P("A") } as never, select: { id: true } })).id;
    const d = await taoDon([{ khoa: k.courseId, con: sid }]);
    expect((await traTien(d.orderId, 500_000, `ONP2T-HD-${Date.now()}`)).status).toBe("MATCHED");
    expect(await db.hoaDonDienTu.count({ where: { orderId: d.orderId } })).toBe(0);
    expect(await chiTiet(d.orderId)).toMatchObject({ trangThaiCapQuyen: "DA_CAP_DU" });
    expect(await soQuyen(sid, k.courseId)).toBe(1);
  });

  it("[ONL-P2T-07] lịch sử thanh toán + trạng thái hoá đơn: chỉ khoản ĐÃ GHI NHẬN (không khoản bị từ chối), không lộ người chuyển; hoá đơn CHUA_PHAT_HANH, quyền học không phụ thuộc", async () => {
    const k = await dungKhoa(500_000);
    const sid = (await db.student.create({ data: { id: `${NS}sls`, name: "Bé ls", parentUserId: P("A") } as never, select: { id: true } })).id;
    const d = await taoDon([{ khoa: k.courseId, con: sid }]);
    await traTien(d.orderId, 200_000, `ONP2T-LS1-${Date.now()}`);
    await db.payment.create({ data: { orderId: d.orderId, amount: 999_000, method: "BANK_TRANSFER", paidDate: new Date(), accountantStatus: "REJECTED" } as never }); // khoản kế toán TỪ CHỐI
    await traTien(d.orderId, 300_000, `ONP2T-LS2-${Date.now()}`);
    const ct = await chiTiet(d.orderId);
    expect(ct.lichSuThanhToan.map((x: { soTien: number }) => x.soTien)).toEqual([200_000, 300_000]);
    expect(ct.daThu).toBe(500_000);
    expect(Object.keys(ct.lichSuThanhToan[0]).sort()).toEqual(["ngay", "paymentId", "phuongThuc", "soTien"]); // không có tên/tài khoản người chuyển
    expect(ct.hoaDon.trangThai).toBe("CHUA_PHAT_HANH");
    expect(ct.hoaDon.ghiChu).toMatch(/Quyền học không phụ thuộc hoá đơn/);
    expect(ct.trangThaiCapQuyen).toBe("DA_CAP_DU");
    // V8.18: biên nhận = Receipt gắn thẳng Payment, chỉ sinh khi KẾ TOÁN xác nhận khoản (không cần ghi danh Offline); chưa xác nhận ⇒ chưa có biên nhận
    expect(ct.bienNhan).toEqual([]);
    const idKhoan = ct.lichSuThanhToan[0].paymentId as string;
    const xn = await confirmPayment({ paymentId: idKhoan, confirmedById: P("A") });
    expect(xn).toMatchObject({ ok: true });
    await confirmPayment({ paymentId: idKhoan, confirmedById: P("A") }); // bấm đôi
    const ct2 = await chiTiet(d.orderId);
    expect(ct2.bienNhan).toHaveLength(1);
    expect(ct2.bienNhan[0]).toMatchObject({ paymentId: idKhoan });
    expect(ct2.bienNhan[0].maPhieu).toMatch(/^RCP-SR-\d{2}-\d{4}$/);
    expect(await db.enrollment.count({ where: { studentId: sid } })).toBe(0); // không ghi danh Offline giả
  });

  it("[ONL-P2T-08] một đơn, hai con cùng mua một khoá: nửa tiền chưa cấp ai; đủ tiền ⇒ mỗi con đúng MỘT quyền; webhook lặp không cấp thêm", async () => {
    const k = await dungKhoa(500_000);
    const d = await taoDon([{ khoa: k.courseId, con: P("sa8") }, { khoa: k.courseId, con: P("sa9") }]);
    expect(d.tongTien).toBe(1_000_000);
    await traTien(d.orderId, 500_000, `ONP2T-H1-${Date.now()}`);
    let ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ daThu: 500_000, trangThaiThanhToan: "DA_THU_MOT_PHAN", trangThaiCapQuyen: "CHUA_CAP" });
    expect(await soQuyen(P("sa8"), k.courseId)).toBe(0);
    expect(await soQuyen(P("sa9"), k.courseId)).toBe(0);
    const ref = `ONP2T-H2-${Date.now()}`;
    await traTien(d.orderId, 500_000, ref);
    await traTien(d.orderId, 500_000, ref); // gửi lại cùng mã giao dịch
    ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ daThu: 1_000_000, trangThaiThanhToan: "DA_THU_DU", trangThaiCapQuyen: "DA_CAP_DU" });
    expect(await soQuyen(P("sa8"), k.courseId)).toBe(1);
    expect(await soQuyen(P("sa9"), k.courseId)).toBe(1);
    expect(await db.orderOnlineGrant.count({ where: { orderId: d.orderId, status: "GRANTED" } })).toBe(2);
  });

  it("[ONL-P2T-09] tiền về sai thứ tự (phần lớn trước, nhỏ sau) cùng tổng ⇒ cùng kết quả; giao dịch số tiền 0/âm không đổi đơn", async () => {
    const k = await dungKhoa(500_000);
    const d = await taoDon([{ khoa: k.courseId, con: P("sa7") }]);
    for (const so of [0, -100_000]) {
      const r = await traTien(d.orderId, so, `ONP2T-Z-${so}-${Date.now()}`).catch(() => ({ status: "LOI" }));
      expect(r.status).not.toBe("MATCHED");
    }
    expect(await chiTiet(d.orderId)).toMatchObject({ daThu: 0, trangThaiThanhToan: "CHO_THANH_TOAN" });
    await traTien(d.orderId, 450_000, `ONP2T-S1-${Date.now()}`);
    expect(await chiTiet(d.orderId)).toMatchObject({ daThu: 450_000, trangThaiCapQuyen: "CHUA_CAP" });
    await traTien(d.orderId, 50_000, `ONP2T-S2-${Date.now()}`);
    expect(await chiTiet(d.orderId)).toMatchObject({ daThu: 500_000, trangThaiThanhToan: "DA_THU_DU", trangThaiCapQuyen: "DA_CAP_DU" });
    expect(await soQuyen(P("sa7"), k.courseId)).toBe(1);
  });

  it("[ONL-P2T-10] phiếu thu PDF khoản Online: chủ đơn tải được (route + liên kết ký); người khác 404; chưa gắn pháp nhân ⇒ không in; pháp nhân theo Order.legalEntityId", async () => {
    const k = await dungKhoa(500_000);
    const sid = (await db.student.create({ data: { id: `${NS}spdf`, name: "Bé pdf", parentUserId: P("A") } as never, select: { id: true } })).id;
    const d = await taoDon([{ khoa: k.courseId, con: sid }]);
    await traTien(d.orderId, 500_000, `ONP2T-PDF-${Date.now()}`);
    const idKhoan = (await chiTiet(d.orderId)).lichSuThanhToan[0].paymentId as string;
    expect(await confirmPayment({ paymentId: idKhoan, confirmedById: P("A") })).toMatchObject({ ok: true });
    const goc = await db.legalEntity.findFirstOrThrow({ where: { isPrimary: true, isActive: true, deletedAt: null }, select: { id: true } });
    const pdf = () => pdfGet(req("GET", "/x", undefined, bearer(tA)), { params: Promise.resolve({ paymentId: idKhoan }) as never });

    // chưa có Order.legalEntityId (đơn tạo trước cấu hình) ⇒ KHÔNG in phiếu với MST đoán bừa (503 phía mobile)
    expect((await pdf()).status).toBe(503);
    expect(await khoanOnlineTaiDuoc(P("A"), idKhoan)).toBe(true);

    await db.order.update({ where: { id: d.orderId }, data: { legalEntityId: goc.id } });
    const r = await pdf();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");

    // liên kết ký → mở bằng trình duyệt hệ thống (không Authorization)
    const lk = await lienKetPost(req("POST", "/x", {}, bearer(tA)), { params: Promise.resolve({ paymentId: idKhoan }) as never });
    expect(lk.status).toBe(200);
    const url = ((await json(lk)).data as { url: string }).url;
    const token = url.split("/").pop()!;
    const dl = await dlGet(new Request(url), { params: Promise.resolve({ token }) as never });
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");

    // người khác (chủ khác / id lạ) ⇒ null/false; khoản chưa đóng/không phải của mình không tải được
    const khac = await db.user.create({ data: { email: `${NS}khac@seed.invalid`, name: "PH khác", phone: "84966990009", password: "x", role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    expect(await khoanOnlineTaiDuoc(khac.id, idKhoan)).toBe(false);
    expect(await taoPdfPhieuThuOnlineChoPhuHuynh(khac.id, idKhoan)).toBeNull();
    expect(await taoPdfPhieuThuOnlineChoPhuHuynh(P("A"), "khong-co")).toBeNull();
    expect(await khoanOnlineTaiDuoc(P("A"), "x".repeat(65))).toBe(false);
    // pháp nhân gắn trên đơn KHÔNG nằm trong cấu hình hoá đơn của môi trường ⇒ 409 (không in)
    const la = await db.legalEntity.create({ data: { taxCode: `9${Date.now() % 1000000000}`.slice(0, 10), legalName: "Pháp nhân lạ", isPrimary: false } });
    await db.order.update({ where: { id: d.orderId }, data: { legalEntityId: la.id } });
    const r409 = await taoPdfPhieuThuOnlineChoPhuHuynh(P("A"), idKhoan);
    expect(r409).toMatchObject({ ok: false, status: 409 });
    await db.order.update({ where: { id: d.orderId }, data: { legalEntityId: goc.id } });
    await db.legalEntity.delete({ where: { id: la.id } });
    await db.user.delete({ where: { id: khac.id } });
  }, 90_000);
});
