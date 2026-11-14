// @vitest-environment node
/**
 * [VDC-*] S-01 vòng đời dữ liệu bài ĐÃ NHẬN (CLAIMED) trên Postgres THẬT — chủ tự xoá / tải, hạn lưu cấu hình.
 *   [VDC-01] IDOR: user khác không xoá được bài của A (id cụ thể lẫn "tất cả"); dữ liệu của A còn nguyên
 *   [VDC-02] A xoá: Subject mất, REVOKED + deletedAt + consentWithdrawnAt, PII bị tẩy, email queue/log của bài mất, lead GIỮ nhưng gỡ liên kết, audit không PII, portal không còn
 *   [VDC-03] idempotent: xoá lần hai = KHONG_CO_GI_DE_XOA, không thêm audit
 *   [VDC-04] thiếu/sai xác nhận ⇒ từ chối, không đổi gì
 *   [VDC-05] xoá theo id chỉ xoá đúng bài đó
 *   [VDC-06] tải dữ liệu: có trường người dùng nhập + điểm; không có khoá nội bộ; không lẫn người khác
 *   [VDC-07] hạn lưu: chưa đặt ⇒ không làm gì; đặt ⇒ chỉ CLAIMED quá hạn bị EXPIRED, idempotent
 *   [VDC-08] hanLuuClaimedNgay: chỉ số nguyên dương, còn lại = tắt
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { docChiTietLuot, docDanhSachLuot, docDuLieuCuaToi } from "../../lib/disc/portal-doc";
import { vongDoiClaimedStore, xoaCuaChuStore } from "../../lib/disc/store-prisma";
import { chayHetHanClaimed, hanLuuClaimedNgay, xoaKetQuaCuaToi } from "../../lib/disc/vong-doi";
import { NOW, P, RUN, TEN_CON, assertCiTest, crmKhong, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
let uSeq = 0;
const taoUser = (sdt: string) =>
  db.user.create({ data: { phone: `${sdtChuan(sdt)}${(uSeq += 1)}`, role: "PARENT", roles: ["PARENT"], password: "x-vdc", accountStatus: "ACTIVE", isActive: true }, select: { id: true } });
const idsBai: string[] = [];

async function baiDaNhan(userId: string, sdt: string, o: { claimedAt?: Date; email?: string } = {}) {
  const key = khoaIdem("vdc");
  const r = await luu(dauVao(sdt, { key, email: o.email ?? null }), depLuu(crmKhong));
  if (!r.ok) throw new Error(`fixture hỏng: ${r.loi}`);
  const b = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
  idsBai.push(b.id);
  await db.discSubmission.update({
    where: { id: b.id },
    data: { claimStatus: "CLAIMED", claimedUserId: userId, claimedAt: o.claimedAt ?? NOW, emailTo: o.email ?? null, consentMarketing: true, consentMarketingAt: NOW },
  });
  return b.id;
}
const xoa = (userId: string, id: unknown, o: { xacNhan?: unknown } = { xacNhan: "XOA" }) => xoaKetQuaCuaToi({ userId, id, xacNhan: o.xacNhan, store: xoaCuaChuStore, now: NOW });

describeDb("[VDC] vòng đời bài CLAIMED trên Postgres thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
  });
  afterAll(async () => {
    await don();
    await db.auditLog.deleteMany({ where: { entityType: "DiscSubmission", entityId: { in: idsBai } } });
    await db.emailQueue.deleteMany({ where: { contextId: { in: [...idsBai, "bai-khac-vdc"] } } });
    await db.emailLog.deleteMany({ where: { contextId: { in: idsBai } } });
    await db.user.deleteMany({ where: { password: "x-vdc" } });
    await db.$disconnect();
  });

  it("[VDC-01] IDOR: B không xoá được bài của A", async () => {
    const [sa, sb] = [sdtMoi(), sdtMoi()];
    const [a, b] = [await taoUser(sa), await taoUser(sb)];
    const id = await baiDaNhan(a.id, sa);
    expect(await xoa(b.id, id)).toEqual({ ok: false, loi: "KHONG_CO_GI_DE_XOA" });
    expect(await xoa(b.id, null)).toEqual({ ok: false, loi: "KHONG_CO_GI_DE_XOA" });
    expect(await xoa(b.id, "id-khong-ton-tai")).toEqual({ ok: false, loi: "KHONG_CO_GI_DE_XOA" });
    expect((await docChiTietLuot(a.id, id))?.nguoi).toHaveLength(2); // đối chứng dương: A còn đủ
    expect(await db.discSubject.count({ where: { submissionId: id } })).toBe(2);
    expect(await xoa(a.id, id)).toEqual({ ok: true, soBai: 1 }); // đối chứng dương của chính hàm xoá
  });

  it("[VDC-02] A xoá: nội dung tẩy sạch, lead giữ nhưng gỡ liên kết, email dọn, audit không PII", async () => {
    const sdt = sdtMoi();
    const a = await taoUser(sdt);
    const id = await baiDaNhan(a.id, sdt, { email: "vdc-test@example.invalid" });
    const lead = await db.lead.create({ data: { parentName: `${P} lead`, phone: sdt, source: "web", status: "MOI", eventId: `disc:${id}`, consentMarketing: true }, select: { id: true } });
    await db.discSubmission.update({ where: { id }, data: { leadId: lead.id, claimCodeHash: "h", downloadTokenHash: "t", payloadHash: "p" } });
    await db.emailQueue.createMany({
      data: [
        { toEmail: "vdc-test@example.invalid", subject: "x", payload: {}, contextType: "DISC_EMAIL_VERIFY", contextId: id },
        { toEmail: "vdc-test@example.invalid", subject: "x", payload: {}, contextType: "DISC_REPORT", contextId: id, status: "SENT" },
        { toEmail: "khac@example.invalid", subject: "x", payload: {}, contextType: "DISC_REPORT", contextId: "bai-khac-vdc" },
      ],
    });
    await db.emailLog.create({ data: { toEmail: "vdc-test@example.invalid", subject: "x", bodyText: "x", bodyHtml: "x", triggerType: "test", contextType: "DISC_REPORT", contextId: id } });

    expect(await xoa(a.id, id)).toEqual({ ok: true, soBai: 1 });

    const b = await db.discSubmission.findUniqueOrThrow({ where: { id } });
    expect(b.claimStatus).toBe("REVOKED");
    expect(b.deletedAt).not.toBeNull();
    expect(b.consentWithdrawnAt?.toISOString()).toBe(NOW.toISOString());
    expect(b).toMatchObject({ emailTo: null, claimCodeHash: null, downloadTokenHash: null, payloadHash: null, leadId: null, consentMarketing: false, consentMarketingAt: null, emailStatus: "NONE" });
    expect(b.reportSnapshot).toEqual({});
    expect(await db.discSubject.count({ where: { submissionId: id } })).toBe(0);
    // Lead KHÔNG bị xoá; chỉ gỡ khoá DISC + cờ tiếp thị
    const l = await db.lead.findUnique({ where: { id: lead.id } });
    expect(l).toMatchObject({ id: lead.id, eventId: null, consentMarketing: false });
    // email của bài mất; email của bài khác còn
    expect(await db.emailQueue.count({ where: { contextId: id } })).toBe(0);
    expect(await db.emailLog.count({ where: { contextId: id } })).toBe(0);
    expect(await db.emailQueue.count({ where: { contextId: "bai-khac-vdc" } })).toBe(1);
    // audit: có, không PII
    const au = await db.auditLog.findMany({ where: { entityType: "DiscSubmission", entityId: id } });
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ module: "disc", action: "disc.claimed.xoa_boi_chu", actorId: a.id });
    const json = JSON.stringify(au[0]);
    for (const pii of [TEN_CON, "vdc-test@example.invalid", sdt, sdtChuan(sdt)]) expect(json).not.toContain(pii);
    // Portal không còn thấy
    expect(await docChiTietLuot(a.id, id)).toBeNull();
    expect((await docDanhSachLuot(a.id)).tong).toBe(0);
    expect((await docDuLieuCuaToi(a.id, NOW)).luot).toEqual([]);
  });

  it("[VDC-03] idempotent: lần hai không làm gì thêm", async () => {
    const sdt = sdtMoi();
    const a = await taoUser(sdt);
    const id = await baiDaNhan(a.id, sdt);
    expect((await xoa(a.id, id)).ok).toBe(true);
    const truoc = await db.discSubmission.findUniqueOrThrow({ where: { id } });
    expect(await xoa(a.id, id)).toEqual({ ok: false, loi: "KHONG_CO_GI_DE_XOA" });
    expect(await xoa(a.id, null)).toEqual({ ok: false, loi: "KHONG_CO_GI_DE_XOA" });
    const sau = await db.discSubmission.findUniqueOrThrow({ where: { id } });
    expect(sau.updatedAt.toISOString()).toBe(truoc.updatedAt.toISOString());
    expect(await db.auditLog.count({ where: { entityType: "DiscSubmission", entityId: id } })).toBe(1);
  });

  it("[VDC-04] thiếu/sai xác nhận ⇒ từ chối, không đổi gì", async () => {
    const sdt = sdtMoi();
    const a = await taoUser(sdt);
    const id = await baiDaNhan(a.id, sdt);
    for (const xn of [undefined, "", "xoa", "YES", true, null]) expect(await xoa(a.id, id, { xacNhan: xn })).toEqual({ ok: false, loi: "CHUA_XAC_NHAN" });
    expect(await xoa(a.id, 123)).toEqual({ ok: false, loi: "ID_KHONG_HOP_LE" });
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id } })).claimStatus).toBe("CLAIMED");
    expect(await db.discSubject.count({ where: { submissionId: id } })).toBe(2);
    expect(await xoa(a.id, id)).toEqual({ ok: true, soBai: 1 }); // đối chứng dương
  });

  it("[VDC-05] xoá theo id chỉ xoá đúng bài đó; không id ⇒ xoá tất cả của chủ", async () => {
    const sdt = sdtMoi();
    const a = await taoUser(sdt);
    const [i1, i2, i3] = [await baiDaNhan(a.id, sdt), await baiDaNhan(a.id, sdt), await baiDaNhan(a.id, sdt)];
    expect(await xoa(a.id, i1)).toEqual({ ok: true, soBai: 1 });
    expect((await docDanhSachLuot(a.id)).luot.map((l) => l.id).sort()).toEqual([i2, i3].sort());
    expect(await xoa(a.id, null)).toEqual({ ok: true, soBai: 2 });
    expect((await docDanhSachLuot(a.id)).tong).toBe(0);
  });

  it("[VDC-06] tải dữ liệu: đủ trường người dùng nhập, không khoá nội bộ, không lẫn người khác", async () => {
    const [sa, sb] = [sdtMoi(), sdtMoi()];
    const [a, b] = [await taoUser(sa), await taoUser(sb)];
    const id = await baiDaNhan(a.id, sa, { email: "vdc-a@example.invalid" });
    await baiDaNhan(b.id, sb);
    await db.discSubmission.update({ where: { id }, data: { claimCodeHash: "BI-MAT-CLAIM", downloadTokenHash: "BI-MAT-TOKEN" } });
    const dl = await docDuLieuCuaToi(a.id, NOW);
    expect(dl.luot).toHaveLength(1);
    expect(dl.luot[0]!.id).toBe(id);
    expect(dl.luot[0]!.emailDaKhai).toBe("vdc-a@example.invalid");
    expect(dl.luot[0]!.nguoi.map((n) => n.hoTen)).toContain(TEN_CON);
    expect(dl.luot[0]!.nguoi.every((n) => n.diem !== null)).toBe(true);
    const s = JSON.stringify(dl);
    for (const cam of ["phoneKey", "claimCodeHash", "downloadTokenHash", "BI-MAT", "leadId", "ipKey", "payloadHash", sa, sdtChuan(sa)]) expect(s).not.toContain(cam);
  });

  it("[VDC-07] hạn lưu CLAIMED: chưa đặt = không làm gì; đặt = chỉ bài CLAIMED quá hạn", async () => {
    const sdt = sdtMoi();
    const a = await taoUser(sdt);
    const cu = await baiDaNhan(a.id, sdt, { claimedAt: new Date(NOW.getTime() - 40 * 86_400_000) });
    const moi = await baiDaNhan(a.id, sdt, { claimedAt: new Date(NOW.getTime() - 5 * 86_400_000) });
    // Bài CHƯA nhận, cũ 40 ngày: đường hết hạn CLAIMED KHÔNG được đụng (nó có hạn riêng 90 ngày, retainUntil).
    const chuaNhan = await baiDaNhan(a.id, sdt, { claimedAt: new Date(NOW.getTime() - 40 * 86_400_000) });
    await db.discSubmission.update({ where: { id: chuaNhan }, data: { claimStatus: "PENDING_CLAIM", claimedUserId: null, claimedAt: null, createdAt: new Date(NOW.getTime() - 40 * 86_400_000), retainUntil: new Date(NOW.getTime() + 50 * 86_400_000) } });
    expect(await chayHetHanClaimed({ store: vongDoiClaimedStore, now: NOW, hanNgay: null })).toEqual({ batHan: false, daXuLy: 0, soLo: 0 });
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: cu } })).claimStatus).toBe("CLAIMED");
    const r = await chayHetHanClaimed({ store: vongDoiClaimedStore, now: NOW, hanNgay: 30 });
    expect(r.batHan).toBe(true);
    expect(r.daXuLy).toBeGreaterThanOrEqual(1);
    const bCu = await db.discSubmission.findUniqueOrThrow({ where: { id: cu } });
    expect(bCu).toMatchObject({ claimStatus: "EXPIRED", emailTo: null });
    expect(bCu.consentWithdrawnAt).toBeNull(); // hết hạn ≠ chủ rút đồng ý
    expect(await db.discSubject.count({ where: { submissionId: cu } })).toBe(0);
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: chuaNhan } })).claimStatus).toBe("PENDING_CLAIM");
    expect(await db.discSubject.count({ where: { submissionId: chuaNhan } })).toBe(2);
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: moi } })).claimStatus).toBe("CLAIMED");
    expect(await db.discSubject.count({ where: { submissionId: moi } })).toBe(2);
    expect(await db.auditLog.count({ where: { entityType: "DiscSubmission", entityId: cu, action: "disc.claimed.het_han" } })).toBe(1);
    await chayHetHanClaimed({ store: vongDoiClaimedStore, now: NOW, hanNgay: 30 }); // idempotent
    expect(await db.auditLog.count({ where: { entityType: "DiscSubmission", entityId: cu } })).toBe(1);
  });

  it("[VDC-08] hanLuuClaimedNgay: mặc định TẮT, chỉ nhận số nguyên dương", () => {
    expect(hanLuuClaimedNgay({})).toBeNull();
    for (const v of ["", " ", "0", "-5", "abc", "1.5", "30d", "999999"]) expect(hanLuuClaimedNgay({ DISC_HAN_LUU_CLAIMED_NGAY: v })).toBeNull();
    expect(hanLuuClaimedNgay({ DISC_HAN_LUU_CLAIMED_NGAY: "365" })).toBe(365);
    expect(hanLuuClaimedNgay({ DISC_HAN_LUU_CLAIMED_NGAY: " 30 " })).toBe(30);
  });
});
