// @vitest-environment node
/**
 * [PLB-DB-*] Làm bài DISC TRONG cổng học viên — Postgres thật + engine thật, KHÔNG nhập lại hồ sơ.
 * Dữ liệu GIẢ (tên, SĐT, năm sinh bịa). Không gửi OTP/email/ZNS (luồng này không dùng chúng).
 *   [PLB-DB-01] đủ hồ sơ trong tài khoản ⇒ lưu một phát; bài CLAIMED bởi đúng tài khoản; hiện ở lịch sử portal; KHÔNG tạo lead
 *   [PLB-DB-02] con của tài khoản KHÁC ⇒ KHONG_CO_QUYEN, không có bài nào được ghi
 *   [PLB-DB-03] trả lời phẳng (HL-1) ⇒ từ chối kèm lỗi bai.*, không có bài CLAIMED / PENDING nào còn lại
 *   [PLB-DB-04] thiếu năm sinh con ⇒ THIEU_HO_SO; bổ sung xong thì lưu được
 *   [PLB-DB-05] tài khoản chưa có SĐT ⇒ THIEU_SDT
 *   [PLB-DB-06] lưu lặp cùng khoá sau khi đã nhận ⇒ không tạo thêm bài, không ném lỗi
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

import { db } from "../../lib/db";
import { ensureDiscEngine } from "../../lib/disc/engine-dang-ky";
import { docDanhSachLuot } from "../../lib/disc/portal-doc";
import { luuBaiPortalThat } from "../../lib/disc/portal-lam-bai-prisma";
import { RUN, assertCiTest, don, khoaIdem, sdtChuan, sdtMoi } from "./_fx";
import { batMoiTruongThu, layBoDe, traLoiBienThien, traLoiPhang } from "./_hanh-trinh";

const describeDb = RUN ? describe : describe.skip;
batMoiTruongThu();

const NAM_CON = 2017;
const NAM_PH = 1988;

async function taoGiaDinh(o: { coSdt?: boolean; coNgaySinh?: boolean } = {}) {
  const sdt = sdtMoi();
  const user = await db.user.create({
    data: {
      name: "Mẹ Kiểm Thử",
      phone: o.coSdt === false ? null : sdt,
      role: "PARENT",
      roles: ["PARENT"],
      password: "x-plb",
      accountStatus: "ACTIVE",
      isActive: true,
    },
    select: { id: true },
  });
  const hs = await db.student.create({
    data: {
      name: "Bé Kiểm Thử",
      parentUserId: user.id,
      dateOfBirth: o.coNgaySinh === false ? null : new Date(`${NAM_CON}-05-10T05:00:00Z`),
      parentDob: new Date(`${NAM_PH}-03-03T00:00:00Z`),
    },
    select: { id: true },
  });
  return { sdt, userId: user.id, studentId: hs.id };
}

async function baiHopLe(lech = 0) {
  const ph = await layBoDe("PH", NAM_PH);
  const hs = await layBoDe("HS", NAM_CON, "4");
  return {
    phuHuynh: { maBoDe: ph.ma, traLoi: traLoiBienThien(ph, lech) },
    hocSinh: { maBoDe: hs.ma, traLoi: traLoiBienThien(hs, lech) },
  };
}

describeDb("[PLB-DB] làm bài DISC trong cổng học viên (engine thật)", () => {
  const userIds: string[] = [];
  const studentIds: string[] = [];
  beforeAll(async () => {
    await assertCiTest();
    ensureDiscEngine();
    await don();
  });
  afterAll(async () => {
    if (studentIds.length) await db.student.deleteMany({ where: { id: { in: studentIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    await don();
  });
  const dang = async (o?: Parameters<typeof taoGiaDinh>[0]) => {
    const g = await taoGiaDinh(o);
    userIds.push(g.userId);
    studentIds.push(g.studentId);
    return g;
  };

  it("[PLB-DB-01] đủ hồ sơ ⇒ lưu một phát, bài thuộc đúng tài khoản, hiện ở lịch sử, không tạo lead", async () => {
    const g = await dang();
    const truocLead = await db.lead.count({ where: { phone: { in: [g.sdt, sdtChuan(g.sdt)] } } });
    const key = khoaIdem("plb1");
    const r = await luuBaiPortalThat({ userId: g.userId, studentId: g.studentId, idempotencyKey: key, boSung: {}, bai: await baiHopLe() });
    expect(r.ok).toBe(true);
    const bai = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key }, include: { subjects: true } });
    expect(bai.claimStatus).toBe("CLAIMED");
    expect(bai.claimedUserId).toBe(g.userId);
    expect(bai.leadId).toBeNull();
    expect(bai.consentMarketing).toBe(false);
    expect(bai.subjects.map((s) => s.fullName).sort()).toEqual(["Bé Kiểm Thử", "Mẹ Kiểm Thử"]);
    expect(bai.subjects.find((s) => s.role === "STUDENT")?.grade).toBe("4");
    const ds = await docDanhSachLuot(g.userId, { trang: 1 });
    expect(ds.tong).toBe(1);
    expect(await db.lead.count({ where: { phone: { in: [g.sdt, sdtChuan(g.sdt)] } } })).toBe(truocLead);
  });

  it("[PLB-DB-02] con của tài khoản KHÁC ⇒ KHONG_CO_QUYEN, không ghi bài nào", async () => {
    const a = await dang();
    const b = await dang();
    const key = khoaIdem("plb2");
    const r = await luuBaiPortalThat({ userId: a.userId, studentId: b.studentId, idempotencyKey: key, boSung: {}, bai: await baiHopLe() });
    expect(r).toEqual({ ok: false, loi: "KHONG_CO_QUYEN" });
    expect(await db.discSubmission.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it("[PLB-DB-03] trả lời phẳng ⇒ từ chối kèm lỗi bai.*; không để lại bài", async () => {
    const g = await dang();
    const ph = await layBoDe("PH", NAM_PH);
    const hs = await layBoDe("HS", NAM_CON, "4");
    const key = khoaIdem("plb3");
    const r = await luuBaiPortalThat({
      userId: g.userId,
      studentId: g.studentId,
      idempotencyKey: key,
      boSung: {},
      bai: { phuHuynh: { maBoDe: ph.ma, traLoi: traLoiBienThien(ph) }, hocSinh: { maBoDe: hs.ma, traLoi: traLoiPhang(hs) } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi).toBe("DU_LIEU_KHONG_HOP_LE");
    expect(r.chiTiet?.some((c) => c.truong.startsWith("bai."))).toBe(true);
    expect(await db.discSubmission.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it("[PLB-DB-04] thiếu năm sinh con ⇒ THIEU_HO_SO; bổ sung xong thì lưu được", async () => {
    const g = await dang({ coNgaySinh: false });
    const bai = await baiHopLe();
    const thieu = await luuBaiPortalThat({ userId: g.userId, studentId: g.studentId, idempotencyKey: khoaIdem("plb4a"), boSung: {}, bai });
    expect(thieu).toEqual({ ok: false, loi: "THIEU_HO_SO", thieu: ["namSinhHocSinh"] });
    const ok = await luuBaiPortalThat({ userId: g.userId, studentId: g.studentId, idempotencyKey: khoaIdem("plb4b"), boSung: { namSinhHocSinh: NAM_CON }, bai });
    expect(ok.ok).toBe(true);
  });

  it("[PLB-DB-05] tài khoản chưa có SĐT ⇒ THIEU_SDT", async () => {
    const g = await dang({ coSdt: false });
    const r = await luuBaiPortalThat({ userId: g.userId, studentId: g.studentId, idempotencyKey: khoaIdem("plb5"), boSung: {}, bai: await baiHopLe() });
    expect(r).toEqual({ ok: false, loi: "THIEU_SDT" });
  });

  it("[PLB-DB-06] gửi lặp cùng khoá sau khi đã lưu ⇒ không thêm bài, không ném lỗi", async () => {
    const g = await dang();
    const key = khoaIdem("plb6");
    const bai = await baiHopLe();
    const a = await luuBaiPortalThat({ userId: g.userId, studentId: g.studentId, idempotencyKey: key, boSung: {}, bai });
    expect(a.ok).toBe(true);
    const b = await luuBaiPortalThat({ userId: g.userId, studentId: g.studentId, idempotencyKey: key, boSung: {}, bai });
    expect(typeof b.ok).toBe("boolean");
    expect(await db.discSubmission.count({ where: { idempotencyKey: key } })).toBe(1);
    expect((await docDanhSachLuot(g.userId, { trang: 1 })).tong).toBe(1);
  });
});
