import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as huyRoute } from "@/app/api/mobile/v1/students/[studentId]/gift-redemptions/[redemptionId]/cancel/route";
import { GET as dsYeuCauGet, POST as guiRoute } from "@/app/api/mobile/v1/students/[studentId]/gift-redemptions/route";
import { GET as quaGet } from "@/app/api/mobile/v1/students/[studentId]/gifts/route";
import { GET as sataCoinGet } from "@/app/api/mobile/v1/students/[studentId]/satacoin/route";
import { db } from "@/lib/db";
import { GIOI_HAN_GUI_DOI_QUA } from "@/lib/mobile-api/dich-vu/doi-qua";
import { huyYeuCauDoiQua, LoiDoiQua, soDuVi, taoYeuCauDoiQua, xuLyYeuCauDoiQua } from "@/lib/satacoin/doi-qua";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [DQ-DB] Đổi quà SataCoin trên POSTGRES THẬT (WP8, OD-02). Dịch vụ + route handler.
 *   [DQ-DB-01] gửi ⇒ GIỮ coin (khả dụng giảm, sổ cái chưa đổi) + trừ chỗ quà; gửi lại cùng khoá ⇒ bản cũ, không giữ thêm; cùng khoá khác quà ⇒ lỗi
 *   [DQ-DB-02] RACE: hai yêu cầu ĐỒNG THỜI cùng vượt số dư ⇒ ĐÚNG MỘT thắng (khoá hàng học viên); khả dụng không bao giờ âm
 *   [DQ-DB-03] RACE tồn kho: hai học viên cùng lấy chiếc cuối ⇒ ĐÚNG MỘT thắng; tồn kho không âm
 *   [DQ-DB-04] huỷ / từ chối ⇒ hoàn coin + hoàn tồn kho (không thành «hoàn đôi»); huỷ yêu cầu đã duyệt ⇒ từ chối
 *   [DQ-DB-05] duyệt → hoàn tất ⇒ MỘT dòng SPEND (-coin) cùng trạng thái DELIVERED; hoàn tất hai lần ĐỒNG THỜI ⇒ vẫn MỘT dòng SPEND; sổ cái cân bằng (Σ = nạp − đã tiêu)
 *   [DQ-DB-06] HTTP: cờ TẮT ⇒ 404; cờ BẬT: gửi/đọc/huỷ đúng; nhà khác ⇒ 404 (cách ly); coin KHÔNG tự cộng ở bất kỳ bước nào
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "dqtest-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966400001", B: "0966400002" };
let dem = 0;
const ipMoi = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const ctxHs = (id: string) => ({ params: Promise.resolve({ studentId: id }) });
const ids: Record<string, string> = {};

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-8000-${String(n + 400).padStart(12, "0")}`, nenTang: "ios", tenMay: "iPhone", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return (b.data as { accessToken: string }).accessToken;
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.sataCoinRedemption.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.sataCoinGiftStock.deleteMany({ where: { gift: { name: { startsWith: NS } } } });
  await db.sataCoinGift.deleteMany({ where: { name: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

const nap = (studentId: string, amount: number) => db.sataCoinTransaction.create({ data: { studentId, amount, type: "ADJUST", reason: "TEST_NAP", note: "nạp thử", centerId: `${NS}cs1` } as never });
const taoQua = async (ten: string, coin: number, ton: number) => {
  const g = await db.sataCoinGift.create({ data: { name: `${NS}${ten}`, coinCost: coin, isActive: true } });
  await db.sataCoinGiftStock.create({ data: { giftId: g.id, centerId: `${NS}cs1`, quantity: ton } });
  return g.id;
};
const tonKho = async (giftId: string) => (await db.sataCoinGiftStock.findFirstOrThrow({ where: { giftId, centerId: `${NS}cs1` } })).quantity;
const maLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof LoiDoiQua ? e.ma : `LOI_LA:${String(e)}`;
  }
};

// Làm ấm đủ 5 kết nối của pool TRƯỚC mỗi đợt bắn: pool nguội ⇒ lượt đầu commit xong trước khi các lượt sau mở được kết nối ⇒ «song song» thực ra là nối tiếp và ca không bắt được tranh chấp.
const amPool = () => Promise.all(Array.from({ length: 5 }, () => db.$queryRaw`SELECT pg_sleep(0.05)::text AS x`));

describe.skipIf(!RUN)("[DQ-DB] đổi quà SataCoin — Postgres thật", () => {
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.PORTAL_SATACOIN_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B"] as const) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.center.create({ data: { id: `${NS}cs1`, name: "Cơ sở DQ-1", slug: `${NS}cs1`, address: "Địa chỉ 1" } });
    for (const k of ["a", "a2", "b", "c"]) {
      await db.student.create({ data: { id: `${NS}hs-${k}`, name: `${NS}${k}`, parentUserId: k === "b" ? ids.B : ids.A, centerId: `${NS}cs1` } as never });
    }
  }, 60_000);
  afterAll(async () => {
    delete process.env.PORTAL_SATACOIN_ENABLED;
    await don();
  });

  it("[DQ-DB-01] gửi ⇒ giữ coin + giữ chỗ; gửi lại cùng khoá ⇒ bản cũ; cùng khoá khác quà ⇒ lỗi", async () => {
    const hs = `${NS}hs-a`;
    await nap(hs, 100);
    const qua = await taoQua("gấu bông", 60, 3);
    const qua2 = await taoQua("bút", 10, 3);
    const r = await taoYeuCauDoiQua({ studentId: hs, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-01-aaaa" });
    expect(r.trungLap).toBe(false);
    expect(await soDuVi(db, hs)).toEqual({ soDu: 100, dangGiu: 60, khaDung: 40 }); // sổ cái CHƯA đổi, chỉ giữ
    expect(await tonKho(qua)).toBe(2);
    const lai = await taoYeuCauDoiQua({ studentId: hs, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-01-aaaa" });
    expect([lai.trungLap, lai.yeuCau.id]).toEqual([true, r.yeuCau.id]);
    expect(await soDuVi(db, hs)).toEqual({ soDu: 100, dangGiu: 60, khaDung: 40 }); // không giữ thêm
    expect(await tonKho(qua)).toBe(2);
    expect(await maLoi(taoYeuCauDoiQua({ studentId: hs, giftId: qua2, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-01-aaaa" }))).toBe("KHOA_GUI_LAI_KHAC_QUA");
    // Không đủ khả dụng (còn 40, cần 60) ⇒ từ chối, KHÔNG trừ kho.
    expect(await maLoi(taoYeuCauDoiQua({ studentId: hs, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-01-bbbb" }))).toBe("KHONG_DU_COIN");
    expect(await tonKho(qua)).toBe(2);
    // Quà không tồn tại / đã ngừng.
    expect(await maLoi(taoYeuCauDoiQua({ studentId: hs, giftId: "khong-co", requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-01-cccc" }))).toBe("KHONG_TIM_THAY_QUA");
  });

  it("[DQ-DB-02] RACE: 12 yêu cầu đồng thời cùng muốn tiêu hết số dư ⇒ ĐÚNG MỘT thắng; khả dụng không âm", async () => {
    const hs = `${NS}hs-a2`;
    await nap(hs, 100);
    const qua = await taoQua("xe đua", 100, 50);
    const kq = await Promise.all(Array.from({ length: 12 }, (_, i) => maLoi(taoYeuCauDoiQua({ studentId: hs, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: `khoa-dq-02-${String(i).padStart(4, "0")}` }))));
    expect(kq.filter((x) => x === "OK")).toHaveLength(1);
    expect(kq.filter((x) => x === "KHONG_DU_COIN")).toHaveLength(11);
    expect(await db.sataCoinRedemption.count({ where: { studentId: hs } })).toBe(1);
    const vi = await soDuVi(db, hs);
    expect(vi.khaDung).toBe(0);
    expect(await tonKho(qua)).toBe(49);
  }, 60_000);

  it("[DQ-DB-03] RACE tồn kho: hai học viên cùng lấy chiếc cuối ⇒ ĐÚNG MỘT thắng; tồn kho không âm", async () => {
    await nap(`${NS}hs-b`, 50);
    await nap(`${NS}hs-c`, 50);
    const qua = await taoQua("hộp màu cuối", 30, 1);
    const kq = await Promise.all([
      maLoi(taoYeuCauDoiQua({ studentId: `${NS}hs-b`, giftId: qua, requestedByUserId: ids.B!, idempotencyKey: "khoa-dq-03-bbbb" })),
      maLoi(taoYeuCauDoiQua({ studentId: `${NS}hs-c`, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-03-cccc" })),
    ]);
    expect(kq.slice().sort()).toEqual(["HET_QUA", "OK"]);
    expect(await tonKho(qua)).toBe(0);
    // Bên thua KHÔNG bị giữ coin oan (giao dịch đã rollback toàn bộ).
    const thua = kq[0] === "HET_QUA" ? `${NS}hs-b` : `${NS}hs-c`;
    expect((await soDuVi(db, thua)).dangGiu).toBe(0);
    expect(await db.sataCoinRedemption.count({ where: { studentId: thua } })).toBe(0);
  }, 60_000);

  it("[DQ-DB-04] huỷ / từ chối ⇒ hoàn coin + hoàn kho một lần; yêu cầu đã duyệt ⇒ ba mẹ không huỷ được", async () => {
    const hs = `${NS}hs-c`;
    await nap(hs, 200);
    const qua = await taoQua("sổ tay", 20, 5);
    const a = await taoYeuCauDoiQua({ studentId: hs, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-04-aaaa" });
    const b = await taoYeuCauDoiQua({ studentId: hs, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-04-bbbb" });
    expect(await tonKho(qua)).toBe(3);
    const truoc = await soDuVi(db, hs);
    expect((await huyYeuCauDoiQua({ studentId: hs, redemptionId: a.yeuCau.id })).status).toBe("CANCELLED");
    expect(await tonKho(qua)).toBe(4);
    expect((await soDuVi(db, hs)).dangGiu).toBe(truoc.dangGiu - 20);
    expect(await maLoi(huyYeuCauDoiQua({ studentId: hs, redemptionId: a.yeuCau.id }))).toBe("SAI_TRANG_THAI"); // huỷ hai lần ⇒ KHÔNG hoàn đôi
    expect(await tonKho(qua)).toBe(4);
    await xuLyYeuCauDoiQua({ redemptionId: b.yeuCau.id, actorUserId: "nv-test", hanhDong: "DUYET" });
    expect(await maLoi(huyYeuCauDoiQua({ studentId: hs, redemptionId: b.yeuCau.id }))).toBe("SAI_TRANG_THAI");
    expect((await xuLyYeuCauDoiQua({ redemptionId: b.yeuCau.id, actorUserId: "nv-test", hanhDong: "TU_CHOI", ghiChu: "hết quà thật" })).status).toBe("REJECTED");
    expect(await tonKho(qua)).toBe(5);
    expect((await soDuVi(db, hs)).dangGiu).toBe(truoc.dangGiu - 40);
    expect(await maLoi(xuLyYeuCauDoiQua({ redemptionId: b.yeuCau.id, actorUserId: "nv-test", hanhDong: "TU_CHOI" }))).toBe("SAI_TRANG_THAI");
    expect(await tonKho(qua)).toBe(5);
  });

  it("[DQ-DB-05] duyệt → hoàn tất ⇒ MỘT dòng SPEND + DELIVERED; hoàn tất hai lần đồng thời ⇒ vẫn một dòng; sổ cái cân bằng", async () => {
    const hs = `${NS}hs-a`;
    const qua = await taoQua("mô hình robot", 25, 4);
    const so0 = (await soDuVi(db, hs)).soDu;
    const y = await taoYeuCauDoiQua({ studentId: hs, giftId: qua, requestedByUserId: ids.A!, idempotencyKey: "khoa-dq-05-aaaa" });
    expect(await maLoi(xuLyYeuCauDoiQua({ redemptionId: y.yeuCau.id, actorUserId: "nv-test", hanhDong: "HOAN_TAT" }))).toBe("SAI_TRANG_THAI"); // chưa duyệt không trao được
    await xuLyYeuCauDoiQua({ redemptionId: y.yeuCau.id, actorUserId: "nv-test", hanhDong: "DUYET" });
    const kq = await Promise.all([1, 2, 3].map(() => maLoi(xuLyYeuCauDoiQua({ redemptionId: y.yeuCau.id, actorUserId: "nv-test", hanhDong: "HOAN_TAT" }))));
    expect(kq.filter((x) => x === "OK")).toHaveLength(1);
    const spend = await db.sataCoinTransaction.findMany({ where: { studentId: hs, type: "SPEND", reason: "REDEEM_GIFT" } });
    expect(spend).toHaveLength(1);
    expect(spend[0]!.amount).toBe(-25);
    expect(spend[0]!.eventKey).toBe(`doi-qua:${y.yeuCau.id}`); // khoá chống trùng ở DB
    // Lớp DB độc lập với mã: ghi tay dòng SPEND thứ hai cho CÙNG yêu cầu bị chỉ mục (studentId, eventKey) từ chối.
    await expect(db.sataCoinTransaction.create({ data: { studentId: hs, amount: -25, type: "SPEND", reason: "REDEEM_GIFT", centerId: `${NS}cs1`, eventKey: `doi-qua:${y.yeuCau.id}` } as never })).rejects.toMatchObject({ code: "P2002" });
    const yc = await db.sataCoinRedemption.findUniqueOrThrow({ where: { id: y.yeuCau.id } });
    expect([yc.status, yc.spendTxId]).toEqual(["DELIVERED", spend[0]!.id]);
    const vi = await soDuVi(db, hs);
    expect(vi.soDu).toBe(so0 - 25);
    // Sổ cái cân bằng: Σ(amount) = Σ nạp − Σ đã tiêu; không có dòng EARN nào tự sinh.
    const tong = await db.sataCoinTransaction.aggregate({ where: { studentId: hs }, _sum: { amount: true } });
    expect(tong._sum.amount).toBe(vi.soDu);
    expect(await db.sataCoinTransaction.count({ where: { studentId: hs, type: "EARN" } })).toBe(0);
    // Đã trao ⇒ không từ chối / huỷ được nữa (không hoàn lại coin đã trừ qua đường này).
    expect(await maLoi(xuLyYeuCauDoiQua({ redemptionId: y.yeuCau.id, actorUserId: "nv-test", hanhDong: "TU_CHOI" }))).toBe("SAI_TRANG_THAI");
    expect(await maLoi(huyYeuCauDoiQua({ studentId: hs, redemptionId: y.yeuCau.id }))).toBe("SAI_TRANG_THAI");
  }, 60_000);

  it("[DQ-DB-06] HTTP: gửi/đọc/huỷ đúng; nhà khác ⇒ 404; cờ TẮT ⇒ 404", async () => {
    const tokA = await dangNhap(PHONE.A, 1);
    const tokB = await dangNhap(PHONE.B, 2);
    for (const t of [tokA, tokB]) await quyDinhDongY(req("/x", {}, `Bearer ${t}`));
    const hs = `${NS}hs-a2`; // đã dùng hết 100 ở DQ-DB-02 ⇒ nạp thêm
    await nap(hs, 70);
    const qua = await taoQua("cặp sách", 40, 2);
    const gui = (tok: string, sv: string, than: unknown) => guiRoute(req("/x", than, `Bearer ${tok}`), ctxHs(sv));

    expect((await gui(tokB, hs, { giftId: qua, idempotencyKey: "khoa-http-aaaa" })).status).toBe(404); // nhà B không đổi quà cho con nhà A
    expect((await dsYeuCauGet(req("/x", undefined, `Bearer ${tokB}`), ctxHs(hs))).status).toBe(404);
    expect((await gui(tokA, hs, { giftId: qua, idempotencyKey: "x" })).status).toBe(400); // khoá quá ngắn

    const viTruoc = await soDuVi(db, hs);
    const truoc = await db.sataCoinTransaction.count({ where: { studentId: hs } });
    const r = await gui(tokA, hs, { giftId: qua, idempotencyKey: "khoa-http-aaaa" });
    expect(r.status).toBe(200);
    const d = (await json(r)).data as { id: string; trungLap: boolean; trangThai: string };
    expect([d.trungLap, d.trangThai]).toEqual([false, "CHO_DUYET"]);
    expect(await db.sataCoinTransaction.count({ where: { studentId: hs } })).toBe(truoc); // gửi yêu cầu KHÔNG đụng sổ cái

    const lai = (await json(await gui(tokA, hs, { giftId: qua, idempotencyKey: "khoa-http-aaaa" }))).data as { id: string; trungLap: boolean };
    expect([lai.trungLap, lai.id]).toEqual([true, d.id]);

    const km = (await json(await quaGet(req("/x", undefined, `Bearer ${tokA}`), ctxHs(hs)))).data as { qua: Array<{ id: string; conHang: boolean }>; soDu: number; dangGiu: number; khaDung: number };
    // Học viên này còn yêu cầu đang giữ từ DQ-DB-02 (100 coin): kiểm theo ĐỘ LỆCH do yêu cầu 40 coin vừa gửi, không theo số tuyệt đối.
    expect([km.soDu - viTruoc.soDu, km.dangGiu - viTruoc.dangGiu, km.khaDung - viTruoc.khaDung]).toEqual([0, 40, -40]);
    expect(km.qua.find((x) => x.id === qua)?.conHang).toBe(true);

    // Lối vào đổi quà ở app do MÁY CHỦ quyết: có ít nhất một món đang mở ⇒ `doiQua.choPhep = true`; tắt hết món ⇒ false (nếu DB không còn món nào khác).
    const sc = async () => ((await json(await sataCoinGet(req(`/api/mobile/v1/students/${hs}/satacoin`, undefined, `Bearer ${tokA}`), ctxHs(hs)))).data as { doiQua: { choPhep: boolean } }).doiQua.choPhep;
    expect(await sc()).toBe(true);
    const ds = (await json(await dsYeuCauGet(req("/x", undefined, `Bearer ${tokA}`), ctxHs(hs)))).data as { yeuCau: Array<{ id: string; trangThai: string; huyDuoc: boolean; nhan: string }> };
    expect(ds.yeuCau.find((x) => x.id === d.id)).toMatchObject({ trangThai: "CHO_DUYET", huyDuoc: true, nhan: "Chờ trung tâm duyệt" });

    const huyB = await huyRoute(req("/x", {}, `Bearer ${tokB}`), { params: Promise.resolve({ studentId: hs, redemptionId: d.id }) });
    expect(huyB.status).toBe(404);
    const huy = await huyRoute(req("/x", {}, `Bearer ${tokA}`), { params: Promise.resolve({ studentId: hs, redemptionId: d.id }) });
    expect(huy.status).toBe(200);
    expect(((await json(huy)).data as { trangThai: string }).trangThai).toBe("DA_HUY");
    expect((await soDuVi(db, hs)).dangGiu).toBe(viTruoc.dangGiu);

    await db.sataCoinGift.updateMany({ where: { name: { startsWith: NS } }, data: { isActive: false } });
    const conMonKhac = (await db.sataCoinGift.count({ where: { isActive: true } })) > 0;
    expect(await sc()).toBe(conMonKhac); // không còn món nào đang mở ⇒ false
    await db.sataCoinGift.updateMany({ where: { name: { startsWith: NS } }, data: { isActive: true } });

    process.env.PORTAL_SATACOIN_ENABLED = "false"; // cờ TẮT ⇒ mọi đường đổi quà 404 (cùng cờ với GET /satacoin)
    try {
      expect((await quaGet(req("/x", undefined, `Bearer ${tokA}`), ctxHs(hs))).status).toBe(404);
      expect((await gui(tokA, hs, { giftId: qua, idempotencyKey: "khoa-http-bbbb" })).status).toBe(404);
      expect(await db.sataCoinRedemption.count({ where: { studentId: hs, idempotencyKey: "khoa-http-bbbb" } })).toBe(0);
    } finally {
      process.env.PORTAL_SATACOIN_ENABLED = "true";
    }
  }, 60_000);

  it("[CGT-07] gửi đổi quà CÙNG thân (cùng idempotencyKey) × 6 song song ⇒ MỘT yêu cầu, giữ coin + kho MỘT lần; [CGT-08] huỷ × 6 ⇒ hoàn MỘT lần", async () => {
    const tokB = await dangNhap(PHONE.B, 8);
    await quyDinhDongY(req("/x", {}, `Bearer ${tokB}`));
    const hs = `${NS}hs-b`;
    await nap(hs, 200);
    const qua = await taoQua("quà gửi trùng", 20, 5);
    const truoc = await soDuVi(db, hs);
    const chay = async (nhan: string, ds: Promise<Response>[]) => {
      const kq = await Promise.all((await Promise.all(ds)).map(async (r) => { const j = await json(r); return { s: r.status, ma: j.error?.code, data: j.data as { id?: string; trungLap?: boolean } | undefined }; }));
      console.info(`${nhan} phản hồi: ${kq.map((x) => `${x.s}${x.ma ? `:${x.ma}` : ""}${x.data?.trungLap ? ":lặp" : ""}`).sort().join(" ")}`);
      return kq;
    };
    await amPool();
    const kq = await chay("[CGT-07]", Array.from({ length: 6 }, () => guiRoute(req("/x", { giftId: qua, idempotencyKey: "khoa-cgt-07-aaaa" }, `Bearer ${tokB}`), ctxHs(hs))));
    expect(kq.map((x) => x.s)).toEqual(Array(6).fill(200));
    expect(new Set(kq.map((x) => x.data!.id)).size).toBe(1);
    expect(kq.filter((x) => x.data!.trungLap === false)).toHaveLength(1);
    expect(await db.sataCoinRedemption.count({ where: { studentId: hs, idempotencyKey: "khoa-cgt-07-aaaa" } })).toBe(1);
    expect(await tonKho(qua)).toBe(4);
    expect((await soDuVi(db, hs)).dangGiu).toBe(truoc.dangGiu + 20);
    const id = kq[0]!.data!.id!;
    await amPool();
    const kqHuy = await chay("[CGT-08]", Array.from({ length: 6 }, () => huyRoute(req("/x", {}, `Bearer ${tokB}`), { params: Promise.resolve({ studentId: hs, redemptionId: id }) })));
    expect(kqHuy.map((x) => x.s).sort()).toEqual([200, 409, 409, 409, 409, 409]); // gửi lại lệnh huỷ ⇒ 409 (đã huỷ), KHÔNG hoàn lần hai
    expect(await tonKho(qua)).toBe(5);
    expect((await soDuVi(db, hs)).dangGiu).toBe(truoc.dangGiu);
  }, 60_000);

  it("[DQ-DB-07] B-RL1: trần 20 lượt / 10 phút theo phụ huynh ⇒ 429 + Retry-After; không ghi thêm đơn khi bị chặn", async () => {
    const tokA = await dangNhap(PHONE.A, 7);
    await quyDinhDongY(req("/x", {}, `Bearer ${tokA}`));
    const hs = `${NS}hs-a2`;
    const qua = await taoQua("bút chì", 5, 100);
    const kq: Response[] = [];
    for (let i = 0; i < 25; i++) kq.push(await guiRoute(req("/x", { giftId: qua, idempotencyKey: `dq-rl-${i}-xxxxxxxx` }, `Bearer ${tokA}`), ctxHs(hs)));
    const bi429 = kq.filter((r) => r.status === 429);
    expect(bi429.length).toBeGreaterThanOrEqual(1);
    expect(kq.length - bi429.length).toBeLessThanOrEqual(GIOI_HAN_GUI_DOI_QUA.max); // tối đa 20 lượt lọt vào dịch vụ trong cửa sổ
    expect(Number(bi429[0]!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await json(bi429[0]!)).error?.code).toBe("RATE_LIMITED");
    const dem = await db.sataCoinRedemption.count({ where: { studentId: hs, idempotencyKey: { startsWith: "dq-rl-" } } });
    expect(dem).toBeLessThanOrEqual(kq.length - bi429.length); // lượt bị chặn KHÔNG tạo đơn
  }, 60_000);
});
