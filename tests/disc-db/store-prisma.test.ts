// @vitest-environment node
/**
 * [DDB-ST-*] store Prisma + vòng đời DISC trên Postgres THẬT (ci_test). Không mock DB.
 *   [DDB-ST-01] 5 lượt Promise.all cùng khoá ⇒ ĐÚNG 1 dòng Submission, 2 Subject, 1 lead (CRM thật)
 *   [DDB-ST-02] replay cùng khoá nhưng payload KHÁC ⇒ LUU_THAT_BAI, token/mã nhận không xoay, không thêm dòng
 *   [DDB-ST-03] replay hợp lệ tuần tự ⇒ ok, vẫn 1 dòng, token xoay
 *   [DDB-PK-01] phoneKey = HMAC; truy vấn theo cột đúng; SĐT thô / token / mã nhận KHÔNG xuất hiện ở bất kỳ cột Disc*
 *   [DDB-VD-01] hết hạn: EXPIRED + xoá DiscSubject + tẩy payloadHash/claimCodeHash/emailTo; bài CLAIMED / còn hạn KHÔNG bị đụng
 *   [DDB-VD-02] chạy lại chayHetHan là idempotent
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { phoneKeyTuSdtChuan } from "../../lib/disc/phone-key";
import { vongDoiStore } from "../../lib/disc/store-prisma";
import { chayHetHan } from "../../lib/disc/vong-doi";
import { taoCongCrmThat } from "../../lib/disc/crm-that";
import { damBaoDanhMucGoc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { KHOA, NOW, RUN, assertCiTest, crmKhong, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;

describeDb("[DDB-ST] store-prisma trên Postgres thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon({ enabled: true, autoAttribution: true, pageMapping: true, referral: true, manualReview: true, affiliate: false });
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[DDB-ST-01] 5 lượt đồng thời cùng khoá ⇒ đúng 1 bài + 2 subject + 1 lead", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("dua");
    const vao = dauVao(sdt, { key });
    const crm = taoCongCrmThat(() => NOW);
    const kq = await Promise.all(Array.from({ length: 5 }, () => luu(vao, depLuu(crm))));
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    const dong = await db.discSubmission.findMany({ where: { phoneKey }, include: { subjects: true } });
    expect(dong).toHaveLength(1);
    expect(dong[0]!.idempotencyKey).toBe(key);
    expect(dong[0]!.subjects.map((s) => s.role).sort()).toEqual(["PARENT", "STUDENT"]);
    // Cả 5 lượt đều trả ok: lượt thua đua (P2002 ở UNIQUE idempotencyKey) phải rơi vào nhánh replay hợp lệ, KHÔNG lộ lỗi ra người dùng.
    expect(kq.map((r) => (r.ok ? "ok" : r.loi))).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    const leads = await db.lead.findMany({ where: { phone: { in: [sdt, sdtChuan(sdt)] } } });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.eventId).toBe(`disc:${dong[0]!.id}`);
    expect(dong[0]!.leadId).toBe(leads[0]!.id);
  });

  it("[DDB-ST-02] cùng khoá + payload khác ⇒ bị từ chối, KHÔNG xoay token/mã, KHÔNG thêm dòng", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("khac");
    const a = await luu(dauVao(sdt, { key }), depLuu(crmKhong));
    expect(a.ok).toBe(true);
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    const truoc = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
    const b = await luu(dauVao(sdt, { key, tenCon: "Tên Con Khác Hẳn" }), depLuu(crmKhong));
    expect(b.ok).toBe(false);
    expect(!b.ok && b.loi).toBe("LUU_THAT_BAI");
    const sau = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(sau.downloadTokenHash).toBe(truoc.downloadTokenHash);
    expect(sau.claimCodeHash).toBe(truoc.claimCodeHash);
    expect(sau.payloadHash).toBe(truoc.payloadHash);
    expect(await db.discSubmission.count({ where: { phoneKey } })).toBe(1);
    // Tên con KHÁC không được lọt vào DB.
    const ten = await db.discSubject.findMany({ where: { submissionId: truoc.id }, select: { fullName: true } });
    expect(ten.map((t) => t.fullName)).not.toContain("Tên Con Khác Hẳn");
  });

  it("[DDB-ST-02b] cùng khoá + SĐT khác ⇒ bị từ chối", async () => {
    const key = khoaIdem("sdt");
    expect((await luu(dauVao(sdtMoi(), { key }), depLuu(crmKhong))).ok).toBe(true);
    const r = await luu(dauVao(sdtMoi(), { key }), depLuu(crmKhong));
    expect(r.ok).toBe(false);
  });

  it("[DDB-ST-03] replay hợp lệ tuần tự ⇒ ok, vẫn 1 dòng, token xoay", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("replay");
    const a = await luu(dauVao(sdt, { key }), depLuu(crmKhong));
    const h1 = (await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } })).downloadTokenHash;
    const b = await luu(dauVao(sdt, { key }), depLuu(crmKhong));
    expect(a.ok && b.ok).toBe(true);
    const h2 = (await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } })).downloadTokenHash;
    expect(h2).not.toBe(h1);
    expect(await db.discSubmission.count({ where: { phoneKey: phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA) } })).toBe(1);
  });

  it("[DDB-PK-01] phoneKey là HMAC; SĐT thô / token / mã nhận không xuất hiện ở BẤT KỲ cột Disc*", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("pk");
    let tokenTho = "";
    let maTho = "";
    const r = await luu(dauVao(sdt, { key, email: "gia.kiem.thu@example.test" }), depLuu(crmKhong, { guiEmail: async () => ({ ok: true }) }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      tokenTho = r.tokenTai;
      maTho = r.maNhan ?? "";
    }
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    expect(phoneKey).toMatch(/^[0-9a-f]{64}$/);
    // Truy vấn ĐÚNG cột
    expect(await db.discSubmission.count({ where: { phoneKey } })).toBe(1);
    // SĐT thô (cả nội địa lẫn 84) KHÔNG phải phoneKey: tra theo chúng ra rỗng
    expect(await db.discSubmission.count({ where: { phoneKey: { in: [sdt, sdtChuan(sdt)] } } })).toBe(0);
    // Quét TOÀN BỘ dòng thô của hai bảng Disc*: chuỗi SĐT / token / mã nhận không được xuất hiện ở đâu cả.
    const sub = await db.$queryRaw<unknown[]>`select * from "DiscSubmission" where "idempotencyKey" = ${key}`;
    const id = (sub[0] as { id: string }).id;
    const subj = await db.$queryRaw<unknown[]>`select * from "DiscSubject" where "submissionId" = ${id}`;
    const nhat = JSON.stringify([sub, subj]);
    for (const cam of [sdt, sdtChuan(sdt), sdt.slice(1), tokenTho, maTho, "ABCDEFGHJK"]) {
      if (cam) expect(nhat, `rò "${cam.slice(0, 4)}…"`).not.toContain(cam);
    }
    // Đối chứng dương: dữ liệu CẦN có thì có (tên con ở bảng Subject)
    expect(nhat).toContain("Kiểm-Thử");
  });

  it("[DDB-VD-01] hết hạn: EXPIRED + xoá nội dung; bài CLAIMED / còn hạn không bị đụng", async () => {
    const sdtHet = sdtMoi();
    const sdtNhan = sdtMoi();
    const sdtSong = sdtMoi();
    const keyHet = khoaIdem("het");
    const keyNhan = khoaIdem("nhan");
    const keySong = khoaIdem("song");
    // Lưu cả ba tại NOW. Hết hạn = retainUntil (NOW + 90d). Đẩy bài "sống" tới tương lai xa để chứng minh không bị đụng.
    expect((await luu(dauVao(sdtHet, { key: keyHet, email: "het@example.test" }), depLuu(crmKhong, { guiEmail: async () => ({ ok: true }) }))).ok).toBe(true);
    expect((await luu(dauVao(sdtNhan, { key: keyNhan }), depLuu(crmKhong))).ok).toBe(true);
    expect((await luu(dauVao(sdtSong, { key: keySong }), depLuu(crmKhong))).ok).toBe(true);
    const nhan = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: keyNhan } });
    const user = await db.user.create({ data: { phone: sdtChuan(sdtNhan), role: "PARENT", roles: ["PARENT"], password: "x", accountStatus: "ACTIVE", isActive: true } });
    await db.discSubmission.update({ where: { id: nhan.id }, data: { claimStatus: "CLAIMED", claimedUserId: user.id, claimedAt: NOW } });
    await db.discSubmission.update({ where: { idempotencyKey: keySong }, data: { retainUntil: new Date("2099-01-01T00:00:00.000Z") } });

    const sauHan = new Date(NOW.getTime() + 91 * 86_400_000);
    const kq = await chayHetHan({ store: vongDoiStore, now: sauHan });
    expect(kq.daXuLy).toBeGreaterThanOrEqual(1);

    const het = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: keyHet }, include: { subjects: true } });
    expect(het.claimStatus).toBe("EXPIRED");
    expect(het.deletedAt).not.toBeNull();
    expect(het.subjects).toHaveLength(0); // xoá cả DiscSubject (tên/năm sinh/điểm của trẻ)
    expect(het.payloadHash).toBeNull();
    expect(het.claimCodeHash).toBeNull();
    expect(het.emailTo).toBeNull();
    expect(het.downloadTokenHash).toBeNull();
    // Đối chứng dương: bài đã nhận KHÔNG bị xoá, subject còn nguyên
    const daNhan = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: keyNhan }, include: { subjects: true } });
    expect(daNhan.claimStatus).toBe("CLAIMED");
    expect(daNhan.deletedAt).toBeNull();
    expect(daNhan.subjects).toHaveLength(2);
    const song = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: keySong }, include: { subjects: true } });
    expect(song.claimStatus).toBe("PENDING_CLAIM");
    expect(song.subjects).toHaveLength(2);

    // [DDB-VD-02] idempotent: chạy lại không đổi gì thêm cho bài vừa hết hạn
    const lai = await chayHetHan({ store: vongDoiStore, now: sauHan });
    const het2 = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: keyHet } });
    expect(het2.deletedAt?.getTime()).toBe(het.deletedAt!.getTime());
    expect(lai.daXuLy).toBeGreaterThanOrEqual(0); // có thể >0 nếu bộ khác để lại bài quá hạn trong ci_test; bài của ta đã kiểm ở trên
    await db.user.deleteMany({ where: { id: user.id } });
  });
});
