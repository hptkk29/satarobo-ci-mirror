import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { onCoinEarnedNotif, onCoinRedemptionNotif } from "@/lib/_handlers/coin-notif";
import { db } from "@/lib/db";
import { layThongBao } from "@/lib/mobile-api/dich-vu/thong-bao";
import { layTinHocSinh, TIEN_TO_TIN_HOC_SINH } from "@/lib/mobile-api/dich-vu/thong-bao-hoc-sinh";
import type { MaHocVienDaKiem } from "@/lib/mobile-api/so-huu";
import { recordTransaction } from "@/lib/satacoin/service";
import { taoYeuCauDoiQua, xuLyYeuCauDoiQua } from "@/lib/satacoin/doi-qua";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [TBCOIN] V8.24 (BR-COIN-01) — thông báo SataCoin cho PHỤ HUYNH.
 *   [TBCOIN-W1] (lưới mã nguồn) sự kiện phát TRONG transaction ghi sổ cái / xử lý yêu cầu; handler đã đăng ký; nội dung không ghi chú nhân viên / push; tin KHÔNG vào danh sách cho phép của học sinh
 *   [TBCOIN-DB-01] cộng coin ⇒ sự kiện `coin.earned` + thông báo + loại `coin` trong `GET /notifications` của ĐÚNG phụ huynh (không của nhà khác); lọc `loai=coin`
 *   [TBCOIN-DB-02] trừ coin / cộng trùng khoá ⇒ KHÔNG có sự kiện; sự kiện giả (giao dịch âm · của học viên khác) ⇒ không thông báo
 *   [TBCOIN-DB-04] cờ PORTAL_SATACOIN_ENABLED TẮT ⇒ cả hai handler KHÔNG tạo thông báo (tính năng đang ẩn)
 *   [TBCOIN-DB-03] đổi quà: duyệt / từ chối / trao ⇒ thông báo đúng trạng thái, KHÔNG lộ ghi chú nhân viên; sự kiện cũ (trạng thái đã đi tiếp) ⇒ bỏ; học sinh KHÔNG thấy
 */
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[TBCOIN-W1] dây nối thông báo SataCoin", () => {
  it("sự kiện trong tx; handler; nội dung sạch; học sinh không thấy", () => {
    const sv = doc("lib/satacoin/service.ts");
    const i = sv.search(/publishEvent\("coin\.earned"/);
    expect(i).toBeGreaterThan(sv.indexOf("tx.sataCoinTransaction.create(")); // sau khi ghi dòng sổ cái
    expect(sv.slice(i, i + 260)).toMatch(/\{ tx, dedupeKey: `coin\.earned:/);
    expect(sv.slice(i - 140, i)).toMatch(/params\.amount > 0 && \(params\.type === "EARN" \|\| params\.type === "ADJUST"\)/); // chỉ khi CỘNG
    const dq = doc("lib/satacoin/doi-qua.ts");
    expect((dq.match(/publishEvent\("coin\.redemption"/g) ?? []).length).toBe(1);
    expect(dq.indexOf('publishEvent("coin.redemption"')).toBeGreaterThan(dq.indexOf("export async function xuLyYeuCauDoiQua"));
    expect(doc("lib/events/register.ts")).toContain("registerCoinNotifHandlers();");
    const h = doc("lib/_handlers/coin-notif.ts");
    expect(h).toContain('on("coin.earned"');
    expect(h).toContain('on("coin.redemption"');
    expect((h.match(/mucSataCoinDangHien\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2); // cờ ẩn tính năng ở CẢ hai handler
    expect(h).not.toMatch(/decisionNote|\.note\b|ghiChu|webPush|fcm|apns|sendPush/i); // không ghi chú nhân viên, không push
    expect(TIEN_TO_TIN_HOC_SINH.some((t) => t.startsWith("coin."))).toBe(false);
    expect(doc("lib/mobile-api/dich-vu/thong-bao.ts")).toMatch(/loai: i\.loai \?\? LOAI_TU_NGUON/);
  });
});

const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));
const NS = "tbcoin-";
const A = (k: string) => `${NS}${k}`;
const ev = (payload: Record<string, unknown>) => ({ id: A("ev"), type: "x", payload });

async function don() {
  await db.notification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: "coin." }, studentId: { startsWith: NS } }, { studentId: { startsWith: NS } }] } });
  const txs = await db.sataCoinTransaction.findMany({ where: { studentId: { startsWith: NS } }, select: { id: true } });
  const yc = await db.sataCoinRedemption.findMany({ where: { studentId: { startsWith: NS } }, select: { id: true } });
  const khoa = [...txs.map((t) => `coin.earned:${t.id}`), ...yc.flatMap((r) => ["APPROVED", "REJECTED", "DELIVERED"].map((st) => `coin.redemption:${r.id}:${st}`))];
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: khoa } } });
  await db.sataCoinRedemption.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.sataCoinGiftStock.deleteMany({ where: { giftId: { startsWith: NS } } });
  await db.sataCoinGift.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { email: { startsWith: NS } } });
}

describe.skipIf(!RUN)("[TBCOIN-DB] thông báo SataCoin — Postgres thật", () => {
  const S1 = A("s1"); // nhà A
  const S2 = A("s2"); // nhà B
  const ids: Record<string, string> = {};
  const noiDung = async (parentId: string, loc: Record<string, unknown> = {}) => layThongBao(parentId, new Date(), { trang: 1, soLuong: 100, ...loc } as never);

  beforeAll(async () => {
    process.env.PORTAL_SATACOIN_ENABLED = "true";
    await don();
    for (const k of ["pa", "pb", "nv"]) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: k, password: "x", role: k === "nv" ? "CENTER_MANAGER" : "PARENT", roles: [k === "nv" ? "CENTER_MANAGER" : "PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở TBCOIN", slug: A("cs"), address: "Địa chỉ" } });
    await db.student.create({ data: { id: S1, name: "An", parentUserId: ids.pa, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S2, name: "Bình", parentUserId: ids.pb, centerId: A("cs") } as never });
    await db.sataCoinGift.create({ data: { id: A("qua"), name: "Bút TBCOIN", coinCost: 30, isActive: true } });
    await db.sataCoinGiftStock.create({ data: { giftId: A("qua"), centerId: A("cs"), quantity: 10 } });
  }, 60_000);
  afterAll(async () => {
    await don();
    delete process.env.PORTAL_SATACOIN_ENABLED;
  });

  it("[TBCOIN-DB-01] cộng coin ⇒ sự kiện + thông báo + loại coin của ĐÚNG phụ huynh; lọc loai=coin", async () => {
    const r = await recordTransaction({ studentId: S1, amount: 50, type: "EARN", reason: "UAT", eventKey: A("e1") });
    expect(r.ok).toBe(true);
    const e = await db.domainEvent.findFirst({ where: { dedupeKey: `coin.earned:${r.txId}` }, select: { payloadJson: true } });
    expect(e).not.toBeNull();
    await onCoinEarnedNotif(ev(e!.payloadJson as Record<string, unknown>));
    await onCoinEarnedNotif(ev(e!.payloadJson as Record<string, unknown>)); // phát lại ⇒ không trùng
    expect(await db.notification.count({ where: { dedupeKey: `coin.earned:${r.txId}` } })).toBe(1);
    const a = await noiDung(ids.pa);
    const tin = a.items.filter((i) => i.loai === "coin");
    expect(tin).toHaveLength(1);
    expect(tin[0]).toMatchObject({ title: "SataCoin mới", category: "THONG_BAO", childName: "An" });
    expect(tin[0]!.body).toContain("50 SataCoin");
    expect((await noiDung(ids.pa, { loai: "coin" })).items.every((i) => i.loai === "coin")).toBe(true);
    expect((await noiDung(ids.pb)).items.filter((i) => i.loai === "coin")).toHaveLength(0); // nhà khác không thấy
    const hs = await layTinHocSinh(S1 as MaHocVienDaKiem, { soLuong: 30 });
    expect(hs.items.filter((i) => /SataCoin/.test(i.title))).toHaveLength(0); // học sinh không thấy tin coin của ba mẹ
  });

  it("[TBCOIN-DB-02] trừ coin / cộng trùng khoá ⇒ không sự kiện; sự kiện giả ⇒ không thông báo", async () => {
    const truoc = await db.domainEvent.count({ where: { dedupeKey: { startsWith: "coin.earned:" } } });
    const trung = await recordTransaction({ studentId: S1, amount: 50, type: "EARN", reason: "UAT", eventKey: A("e1") });
    expect(trung.trungLap).toBe(true);
    const tru = await recordTransaction({ studentId: S1, amount: -10, type: "ADJUST", reason: "UAT", eventKey: A("e2") });
    expect(tru.ok).toBe(true);
    expect(await db.domainEvent.count({ where: { dedupeKey: { startsWith: "coin.earned:" } } })).toBe(truoc);
    await onCoinEarnedNotif(ev({ txId: tru.txId, studentId: S1 })); // giao dịch ÂM
    const moi = await recordTransaction({ studentId: S1, amount: 7, type: "EARN", reason: "UAT", eventKey: A("e-moi") }); // chưa chạy handler ⇒ chưa có thông báo
    await onCoinEarnedNotif(ev({ txId: moi.txId, studentId: S2 })); // payload nêu học viên KHÁC giao dịch ⇒ bỏ
    expect(await db.notification.count({ where: { dedupeKey: `coin.earned:${moi.txId}` } })).toBe(0);
    await onCoinEarnedNotif(ev({ txId: "khong-co", studentId: S1 }));
    expect(await db.notification.count({ where: { dedupeKey: `coin.earned:${tru.txId}` } })).toBe(0);
    expect(await db.notification.count({ where: { studentId: S2, dedupeKey: { startsWith: "coin." } } })).toBe(0);
  });

  it("[TBCOIN-DB-03] đổi quà: duyệt/từ chối/trao ⇒ thông báo đúng; không lộ ghi chú; sự kiện cũ bỏ; học sinh không thấy", async () => {
    const yc = await taoYeuCauDoiQua({ studentId: S1, giftId: A("qua"), requestedByUserId: ids.pa, idempotencyKey: `${NS}idem-0001` });
    const id = yc.yeuCau.id;
    const dem = (st: string) => db.notification.count({ where: { dedupeKey: `coin.redemption:${id}:${st}` } });
    const chay = async (st: string) => {
      const e = await db.domainEvent.findFirst({ where: { dedupeKey: `coin.redemption:${id}:${st}` }, select: { payloadJson: true } });
      expect(e).not.toBeNull();
      await onCoinRedemptionNotif(ev(e!.payloadJson as Record<string, unknown>));
    };
    await xuLyYeuCauDoiQua({ redemptionId: id, actorUserId: ids.nv, hanhDong: "DUYET", ghiChu: "NOI-BO-XYZ-123" });
    await chay("APPROVED");
    expect(await dem("APPROVED")).toBe(1);
    await xuLyYeuCauDoiQua({ redemptionId: id, actorUserId: ids.nv, hanhDong: "HOAN_TAT", ghiChu: "NOI-BO-XYZ-123" });
    await chay("DELIVERED");
    expect(await dem("DELIVERED")).toBe(1);
    const tin = (await noiDung(ids.pa)).items.filter((i) => i.loai === "coin");
    expect(tin.map((i) => i.title)).toEqual(expect.arrayContaining(["Yêu cầu đổi quà đã được duyệt", "Đã trao quà"]));
    expect(JSON.stringify(tin)).not.toContain("NOI-BO-XYZ-123"); // không lộ ghi chú nhân viên
    expect(tin.find((i) => i.title === "Đã trao quà")!.body).toContain("Bút TBCOIN");
    // sự kiện cũ: yêu cầu đã DELIVERED nhưng sự kiện nói REJECTED ⇒ bỏ
    await onCoinRedemptionNotif(ev({ redemptionId: id, status: "REJECTED" }));
    expect(await dem("REJECTED")).toBe(0);
    // từ chối thật
    await recordTransaction({ studentId: S1, amount: 100, type: "EARN", reason: "UAT", eventKey: A("e3") }); // đủ coin cho yêu cầu thứ hai
    const yc2 = await taoYeuCauDoiQua({ studentId: S1, giftId: A("qua"), requestedByUserId: ids.pa, idempotencyKey: `${NS}idem-0002` });
    await xuLyYeuCauDoiQua({ redemptionId: yc2.yeuCau.id, actorUserId: ids.nv, hanhDong: "TU_CHOI", ghiChu: "NOI-BO-XYZ-123" });
    const e2 = await db.domainEvent.findFirstOrThrow({ where: { dedupeKey: `coin.redemption:${yc2.yeuCau.id}:REJECTED` }, select: { payloadJson: true } });
    await onCoinRedemptionNotif(ev(e2.payloadJson as Record<string, unknown>));
    const tin2 = (await noiDung(ids.pa)).items.find((i) => i.title === "Yêu cầu đổi quà bị từ chối");
    expect(tin2?.body).toContain("hoàn lại");
    const hs = await layTinHocSinh(S1 as MaHocVienDaKiem, { soLuong: 30 });
    expect(hs.items.filter((i) => /đổi quà|Đã trao quà|SataCoin/.test(i.title))).toHaveLength(0);
  });

  it("[TBCOIN-DB-04] cờ PORTAL_SATACOIN_ENABLED tắt ⇒ không thông báo (cộng coin lẫn đổi quà); bật lại ⇒ có", async () => {
    const r = await recordTransaction({ studentId: S2, amount: 40, type: "EARN", reason: "UAT", eventKey: A("e-cotat") });
    const yc = await taoYeuCauDoiQua({ studentId: S2, giftId: A("qua"), requestedByUserId: ids.pb, idempotencyKey: `${NS}idem-cotat` });
    await xuLyYeuCauDoiQua({ redemptionId: yc.yeuCau.id, actorUserId: ids.nv, hanhDong: "DUYET" });
    process.env.PORTAL_SATACOIN_ENABLED = "false";
    try {
      await onCoinEarnedNotif(ev({ txId: r.txId, studentId: S2 }));
      await onCoinRedemptionNotif(ev({ redemptionId: yc.yeuCau.id, status: "APPROVED" }));
      expect(await db.notification.count({ where: { studentId: S2, dedupeKey: { startsWith: "coin." } } })).toBe(0);
    } finally {
      process.env.PORTAL_SATACOIN_ENABLED = "true";
    }
    await onCoinEarnedNotif(ev({ txId: r.txId, studentId: S2 }));
    await onCoinRedemptionNotif(ev({ redemptionId: yc.yeuCau.id, status: "APPROVED" }));
    expect(await db.notification.count({ where: { studentId: S2, dedupeKey: { startsWith: "coin." } } })).toBe(2);
  });
});
