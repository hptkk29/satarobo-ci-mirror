// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { GET as cronGet } from "@/app/api/cron/mobile-upload-don-dep/route";
import { db } from "@/lib/db";
import { GIU_DA_TAI_LEN_MS, LUI_HET_HAN_MS, donVeTaiLenBoDo } from "@/lib/mobile-api/dich-vu/don-ve-tai-len";
import type { KhoTepRieng } from "@/lib/mobile-api/kho-tep-rieng";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [DVTL] SEC-07 — DỌN TỆP TẢI LÊN BỎ DỞ của kho riêng, Postgres thật + kho GIẢ ghi lại lệnh xoá.
 *   [DVTL-01] chỉ báo cáo (mặc định): đếm đúng tập đủ điều kiện, KHÔNG đổi hàng nào, KHÔNG xoá đối tượng nào
 *   [DVTL-02] xoá thật: ISSUED hết hạn > 1 giờ + UPLOADED > 7 ngày ⇒ EXPIRED + xoá ĐÚNG khoá; ATTACHED / REJECTED / ISSUED còn hạn hoặc mới hết hạn / UPLOADED mới KHÔNG bị đụng
 *   [DVTL-03] xoá đối tượng lỗi ⇒ trả trạng thái cũ (lượt sau thử lại và xong)
 *   [DVTL-04] đua: giữa lúc chọn và lúc nhận app xin lại vé (đẩy expiresAt) / báo hoàn tất (UPLOADED) ⇒ bỏ qua, KHÔNG xoá đối tượng
 *   [DVTL-05] kho chưa cấu hình ⇒ bỏ qua (không đổi gì); trần mỗi lượt ⇒ catNgang, lượt sau dọn nốt
 *   [DVTL-06] route cron: thiếu/sai CRON_SECRET ⇒ 401; đúng ⇒ 200 ở chế độ chỉ báo cáo (env MOBILE_UPLOAD_DON_XOA chưa đặt)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "dvttest-";
const NOW = new Date("2026-11-26T10:00:00.000Z");
const phut = (n: number) => new Date(NOW.getTime() + n * 60_000);
const ids: Record<string, string> = {};

function khoGia() {
  const daXoa: string[] = [];
  const hong = new Set<string>();
  const kho: KhoTepRieng = {
    ten: "gia",
    kyPut: async () => ({ url: "x", headers: {} }),
    dau: async () => null,
    docByteDau: async () => null,
    kyGet: async () => null,
    xoa: async (k) => {
      if (hong.has(k)) throw new Error("R2 down");
      daXoa.push(k);
    },
  };
  return { kho, daXoa, hong };
}

const K = (n: string) => `${NS}key-${n}`;
type Cau = { n: string; status: "ISSUED" | "UPLOADED" | "ATTACHED" | "REJECTED" | "EXPIRED"; expiresAt?: Date; verifiedAt?: Date | null };
async function tao(c: Cau) {
  await db.mobileUpload.create({
    data: {
      id: `${NS}${c.n}`, parentUserId: ids.U!, studentId: `${NS}hs`, purpose: "ASSIGNMENT_SUBMISSION", storageKey: K(c.n), fileName: "a.png", declaredMime: "image/png", declaredSize: 100,
      status: c.status, expiresAt: c.expiresAt ?? phut(10), verifiedAt: c.verifiedAt ?? null, createdAt: new Date(NOW.getTime() - 10 * 24 * 3600_000),
    } as never,
  });
}
const trangThai = async () => Object.fromEntries((await db.mobileUpload.findMany({ where: { id: { startsWith: NS } }, select: { id: true, status: true } })).map((r) => [r.id.slice(NS.length), r.status]));
async function don() {
  await db.mobileUpload.deleteMany({ where: { id: { startsWith: NS } } });
}
/** Bộ hàng chuẩn: 2 hàng ĐÁNG dọn + 7 hàng KHÔNG được đụng. */
async function boChuan() {
  await tao({ n: "i-het2h", status: "ISSUED", expiresAt: phut(-120) }); // ĐÁNG DỌN
  await tao({ n: "u-cu8d", status: "UPLOADED", verifiedAt: new Date(NOW.getTime() - GIU_DA_TAI_LEN_MS - 3600_000) }); // ĐÁNG DỌN
  await tao({ n: "i-het10p", status: "ISSUED", expiresAt: phut(-10) }); // mới hết hạn: còn trong ân hạn 1 giờ
  await tao({ n: "i-conhan", status: "ISSUED", expiresAt: phut(10) });
  await tao({ n: "u-moi", status: "UPLOADED", verifiedAt: new Date(NOW.getTime() - 24 * 3600_000) });
  await tao({ n: "a-cu", status: "ATTACHED", expiresAt: phut(-60 * 24 * 30), verifiedAt: new Date(NOW.getTime() - 30 * 24 * 3600_000) });
  await tao({ n: "r-cu", status: "REJECTED", expiresAt: phut(-60 * 24 * 30) });
  await tao({ n: "e-cu", status: "EXPIRED", expiresAt: phut(-60 * 24 * 30) });
}
const DANG_DON = ["i-het2h", "u-cu8d"].map(K).sort();

describe.skipIf(!RUN)("[DVTL] SEC-07 dọn tệp tải lên bỏ dở — Postgres thật + kho giả", () => {
  beforeAll(async () => {
    await don();
    await db.student.deleteMany({ where: { id: `${NS}hs` } });
    await db.center.deleteMany({ where: { id: `${NS}cs` } });
    await db.user.deleteMany({ where: { email: { startsWith: NS } } });
    ids.U = (await db.user.create({ data: { email: `${NS}u@seed.invalid`, name: `${NS}u`, phone: "84966930001", role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: `${NS}cs`, name: "Cơ sở DVT", slug: `${NS}cs`, address: "Địa chỉ" } });
    await db.student.create({ data: { id: `${NS}hs`, name: "HS", parentUserId: ids.U, centerId: `${NS}cs` } as never });
  }, 60_000);
  afterAll(async () => {
    await don();
    await db.student.deleteMany({ where: { id: `${NS}hs` } });
    await db.center.deleteMany({ where: { id: `${NS}cs` } });
    await db.user.deleteMany({ where: { id: ids.U } });
  });
  beforeEach(don); // mỗi ca tự đủ

  it("[DVTL-01] chỉ báo cáo (mặc định): đếm đúng 2 hàng đủ điều kiện, KHÔNG đổi trạng thái, KHÔNG xoá đối tượng", async () => {
    await boChuan();
    const truoc = await trangThai();
    const { kho, daXoa } = khoGia();
    const kq = await donVeTaiLenBoDo(NOW, { choPhepXoa: false, kho });
    expect(kq).toMatchObject({ boQua: null, seDon: 2, daDon: 0, choPhepXoa: false, catNgang: false });
    expect(daXoa).toEqual([]);
    expect(await trangThai()).toEqual(truoc);
  });

  it("[DVTL-02] xoá thật: chỉ ISSUED hết hạn > 1 giờ và UPLOADED > 7 ngày ⇒ EXPIRED + xoá ĐÚNG khoá; mọi hàng khác nguyên vẹn", async () => {
    await boChuan();
    const { kho, daXoa } = khoGia();
    const kq = await donVeTaiLenBoDo(NOW, { choPhepXoa: true, kho });
    expect(kq).toMatchObject({ seDon: 2, daDon: 2, loiXoa: 0, boQuaDua: 0 });
    expect([...daXoa].sort()).toEqual(DANG_DON);
    expect(await trangThai()).toEqual({ "i-het2h": "EXPIRED", "u-cu8d": "EXPIRED", "i-het10p": "ISSUED", "i-conhan": "ISSUED", "u-moi": "UPLOADED", "a-cu": "ATTACHED", "r-cu": "REJECTED", "e-cu": "EXPIRED" });
    // chạy lại: không còn gì để dọn (idempotent)
    expect(await donVeTaiLenBoDo(NOW, { choPhepXoa: true, kho })).toMatchObject({ seDon: 0, daDon: 0 });
    expect(daXoa).toHaveLength(2);
    expect(LUI_HET_HAN_MS).toBe(3_600_000);
  });

  it("[DVTL-03] xoá đối tượng lỗi ⇒ trả trạng thái cũ (không mất dấu); lượt sau thử lại và xong", async () => {
    await boChuan();
    const { kho, daXoa, hong } = khoGia();
    hong.add(K("i-het2h"));
    const l1 = await donVeTaiLenBoDo(NOW, { choPhepXoa: true, kho });
    expect(l1).toMatchObject({ daDon: 1, loiXoa: 1 });
    expect((await trangThai())["i-het2h"]).toBe("ISSUED"); // trả lại ⇒ còn trong tập dọn
    expect((await trangThai())["u-cu8d"]).toBe("EXPIRED");
    hong.clear();
    const l2 = await donVeTaiLenBoDo(NOW, { choPhepXoa: true, kho });
    expect(l2).toMatchObject({ seDon: 1, daDon: 1, loiXoa: 0 });
    expect([...daXoa].sort()).toEqual(DANG_DON);
    expect((await trangThai())["i-het2h"]).toBe("EXPIRED");
  });

  it("[DVTL-04] ĐUA: giữa lúc chọn và lúc nhận app xin lại vé (expiresAt đẩy xa) hoặc báo hoàn tất ⇒ bỏ qua, KHÔNG xoá đối tượng", async () => {
    await boChuan();
    const { kho, daXoa } = khoGia();
    const kq = await donVeTaiLenBoDo(NOW, {
      choPhepXoa: true,
      kho,
      sauKhiChon: async () => {
        await db.mobileUpload.update({ where: { id: `${NS}i-het2h` }, data: { expiresAt: phut(30) } }); // xin lại vé
        await db.mobileUpload.update({ where: { id: `${NS}u-cu8d` }, data: { status: "ATTACHED", attachedAt: NOW } }); // vừa được gắn vào bài nộp
      },
    });
    expect(kq).toMatchObject({ seDon: 2, daDon: 0, boQuaDua: 2 });
    expect(daXoa).toEqual([]);
    expect(await trangThai()).toMatchObject({ "i-het2h": "ISSUED", "u-cu8d": "ATTACHED" });
  });

  it("[DVTL-05] kho chưa cấu hình ⇒ bỏ qua (không đổi gì); trần mỗi lượt ⇒ catNgang rồi lượt sau dọn nốt", async () => {
    await boChuan();
    const truoc = await trangThai();
    expect(await donVeTaiLenBoDo(NOW, { choPhepXoa: true, kho: null })).toMatchObject({ boQua: "KHO_CHUA_CAU_HINH", seDon: 0, daDon: 0 });
    expect(await trangThai()).toEqual(truoc);
    const { kho, daXoa } = khoGia();
    const l1 = await donVeTaiLenBoDo(NOW, { choPhepXoa: true, kho, tran: 1 });
    expect(l1).toMatchObject({ seDon: 1, daDon: 1, catNgang: true });
    const l2 = await donVeTaiLenBoDo(NOW, { choPhepXoa: true, kho, tran: 1 });
    expect(l2).toMatchObject({ seDon: 1, daDon: 1, catNgang: false });
    expect([...daXoa].sort()).toEqual(DANG_DON);
  });

  it("[DVTL-06] route cron: không / sai CRON_SECRET ⇒ 401; đúng ⇒ 200 và CHỈ BÁO CÁO khi chưa đặt MOBILE_UPLOAD_DON_XOA", async () => {
    const cu = { secret: process.env.CRON_SECRET, xoa: process.env.MOBILE_UPLOAD_DON_XOA };
    process.env.CRON_SECRET = "dvt-cron-secret-test";
    delete process.env.MOBILE_UPLOAD_DON_XOA;
    try {
      await boChuan();
      const goi = (auth?: string) => cronGet(new Request("http://localhost/api/cron/mobile-upload-don-dep", { headers: auth ? { authorization: auth } : {} }) as never);
      expect((await goi()).status).toBe(401);
      expect((await goi("Bearer sai")).status).toBe(401);
      const truoc = await trangThai();
      const ok = await goi("Bearer dvt-cron-secret-test");
      expect(ok.status).toBe(200);
      const b = (await ok.json()) as { ok: boolean; data: { choPhepXoa: boolean; daDon: number } };
      expect([b.ok, b.data.choPhepXoa, b.data.daDon]).toEqual([true, false, 0]);
      expect(await trangThai()).toEqual(truoc); // báo cáo thôi — không đổi gì
    } finally {
      if (cu.secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = cu.secret;
      if (cu.xoa === undefined) delete process.env.MOBILE_UPLOAD_DON_XOA; else process.env.MOBILE_UPLOAD_DON_XOA = cu.xoa;
    }
  });
});
