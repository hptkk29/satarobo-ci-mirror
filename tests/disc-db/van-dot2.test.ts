// @vitest-environment node
/**
 * [DDB-V2-*] Vá đợt 2 của rà soát bảo mật (06 §G) — trên Postgres THẬT (ci_test), dữ liệu GIẢ.
 *   [DDB-V2-N12-*] đường XOÁ: điều kiện + tăng + so khớp trên CÙNG một dòng (repro của reviewer)
 *   [DDB-V2-N6-*]  trần theo cặp (SĐT, IP): kẻ gõ 5 lần không khoá được chủ số lưu từ IP khác
 *   [DDB-V2-N9-*]  pepper có phiên bản được ghi vào dòng
 *   [DDB-V2-F11-*] token tải chết khi bài đã CLAIMED
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { phoneKeyTuSdtChuan } from "../../lib/disc/phone-key";
import { maNhanStore, taiStore } from "../../lib/disc/store-prisma";
import { bamMaNhan, bam } from "../../lib/disc/luu";
import { taiBaoCao } from "../../lib/disc/tai-bao-cao";
import { KHOA, NOW, RUN, assertCiTest, crmKhong, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const TUONG_LAI = new Date("2027-06-01T00:00:00Z");

/** Dòng GIẢ tối thiểu (không qua luuKetQuaDisc) để dựng đúng hiện trường bộ đếm. */
async function taoDong(p: { phoneKey: string; maHash: string; lanThu: number; key?: string }) {
  return db.discSubmission.create({
    data: {
      idempotencyKey: p.key ?? khoaIdem("n12"),
      phoneKey: p.phoneKey,
      consentVersion: "test",
      consentAt: NOW,
      engineVersion: "engine-GIA-1",
      reportSnapshot: {},
      claimCodeHash: p.maHash,
      claimAttempts: p.lanThu,
      retainUntil: TUONG_LAI,
      subjects: { create: [{ role: "STUDENT", fullName: "Trẻ Giả", birthYear: 2016, grade: "4", questionSetVersion: "gia-1", result: {} }] },
    },
  });
}

describeDb("[DDB-V2] vá đợt 2 trên Postgres thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[DDB-V2-N12-01] dòng A đã khoá (5 lần), dòng B 2 lần: mã của A KHÔNG xoá được A qua lượt tăng của B", async () => {
    const sdt = sdtMoi();
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    const maA = bamMaNhan("ABCDEFGHJK", KHOA);
    const maB = bamMaNhan("MNPQRSTUVW", KHOA);
    const a = await taoDong({ phoneKey, maHash: maA, lanThu: 5 });
    const b = await taoDong({ phoneKey, maHash: maB, lanThu: 2 });

    const r = await maNhanStore.thuBangMa({ phoneKey, maHash: maA, now: NOW, toiDaLanThu: 5, hanhDong: { loai: "XOA" } });
    expect(r).toBeNull();
    const a2 = await db.discSubmission.findUniqueOrThrow({ where: { id: a.id } });
    expect(a2.claimStatus).toBe("PENDING_CLAIM");
    expect(a2.deletedAt).toBeNull();
    expect(a2.claimAttempts).toBe(5); // dòng đã khoá không bị đụng
    expect(await db.discSubject.count({ where: { submissionId: a.id } })).toBe(1);
    // B vẫn bị tính một lần thử (đúng thiết kế: bộ đếm tăng TRƯỚC khi so).
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: b.id } })).claimAttempts).toBe(3);
  });

  it("[DDB-V2-N12-02] đối chứng dương: mã đúng của dòng CÒN dưới ngưỡng vẫn xoá được dòng đó (và chỉ dòng đó)", async () => {
    const sdt = sdtMoi();
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    const a = await taoDong({ phoneKey, maHash: bamMaNhan("ABCDEFGHJK", KHOA), lanThu: 5 });
    const b = await taoDong({ phoneKey, maHash: bamMaNhan("MNPQRSTUVW", KHOA), lanThu: 2 });
    const r = await maNhanStore.thuBangMa({ phoneKey, maHash: bamMaNhan("MNPQRSTUVW", KHOA), now: NOW, toiDaLanThu: 5, hanhDong: { loai: "XOA" } });
    expect(r).toEqual({ submissionId: b.id });
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: b.id } })).claimStatus).toBe("REVOKED");
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: a.id } })).claimStatus).toBe("PENDING_CLAIM");
  });

  it("[DDB-V2-N12-03] mọi dòng đã khoá ⇒ null và không dòng nào đổi", async () => {
    const sdt = sdtMoi();
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    const a = await taoDong({ phoneKey, maHash: bamMaNhan("ABCDEFGHJK", KHOA), lanThu: 5 });
    expect(await maNhanStore.thuBangMa({ phoneKey, maHash: bamMaNhan("ABCDEFGHJK", KHOA), now: NOW, toiDaLanThu: 5, hanhDong: { loai: "XOA" } })).toBeNull();
    const a2 = await db.discSubmission.findUniqueOrThrow({ where: { id: a.id } });
    expect(a2.claimStatus).toBe("PENDING_CLAIM");
    expect(a2.claimAttempts).toBe(5);
  });

  // ── N6 ─────────────────────────────────────────────────────────────────────────────────────────────────────
  it("[DDB-V2-N6-01] kẻ gõ SĐT nạn nhân 5 lần từ IP-X: lần 6 từ IP-X bị chặn, nhưng chủ số lưu bình thường từ IP-Y", async () => {
    const sdt = sdtMoi();
    const dep = (ip: string) => depLuu(crmKhong, { nguonIp: ip });
    for (let i = 0; i < 5; i++) {
      const r = await luu(dauVao(sdt, { key: khoaIdem("xau"), tenCon: `Giả Mạo ${i}` }), dep("203.0.113.9"));
      expect(r.ok).toBe(true);
    }
    const sau = await luu(dauVao(sdt, { key: khoaIdem("xau6") }), dep("203.0.113.9"));
    expect(sau.ok).toBe(false);
    expect(!sau.ok && sau.loi).toBe("QUA_NHIEU_YEU_CAU");

    const chuSo = await luu(dauVao(sdt, { key: khoaIdem("that") }), dep("198.51.100.7"));
    expect(chuSo.ok).toBe(true);
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    expect(await db.discSubmission.count({ where: { phoneKey } })).toBe(6);
  });

  it("[DDB-V2-N6-02] trần cứng theo SĐT (30/24h, nhiều IP) ⇒ phản hồi Y HỆT lỗi lưu chung (LUU_THAT_BAI), không lộ 'SĐT này bị dùng nhiều'", async () => {
    const sdt = sdtMoi();
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    // 30 dòng từ 30 IP khác nhau (dựng thẳng để khỏi chạy 30 lượt đầy đủ).
    for (let i = 0; i < 30; i++) {
      await db.discSubmission.create({
        data: {
          idempotencyKey: khoaIdem(`cung${i}`), phoneKey, ipKey: `ip-gia-${i}`, consentVersion: "t", consentAt: NOW, engineVersion: "e",
          reportSnapshot: {}, retainUntil: TUONG_LAI,
        },
      });
    }
    const r = await luu(dauVao(sdt, { key: khoaIdem("vuot") }), depLuu(crmKhong, { nguonIp: "192.0.2.77" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toBe("LUU_THAT_BAI");
  });

  // ── N9 ─────────────────────────────────────────────────────────────────────────────────────────────────────
  it("[DDB-V2-N9-01] dòng mới ghi pepperVersion + ipKey là HMAC (không phải IP thô)", async () => {
    const sdt = sdtMoi();
    const r = await luu(dauVao(sdt, { key: khoaIdem("pep") }), depLuu(crmKhong, { nguonIp: "203.0.113.55", phienBanPepper: () => "v1" }));
    expect(r.ok).toBe(true);
    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    const d = await db.discSubmission.findFirstOrThrow({ where: { phoneKey } });
    expect(d.pepperVersion).toBe("v1");
    expect(d.ipKey).toMatch(/^[0-9a-f]{64}$/);
    expect(d.ipKey).not.toContain("203.0.113.55");
  });

  // ── F-11 ───────────────────────────────────────────────────────────────────────────────────────────────────
  it("[DDB-V2-F11-01] token tải dùng được khi PENDING_CLAIM, và CHẾT ngay khi bài đã CLAIMED (dù còn hạn 30 phút)", async () => {
    const sdt = sdtMoi();
    const token = `TOKEN-F11-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-xxxxxxxx`;
    const r = await luu(dauVao(sdt, { key: khoaIdem("f11") }), depLuu(crmKhong, { nguonIp: "203.0.113.1", sinhToken: () => token }));
    expect(r.ok).toBe(true);
    expect((await taiBaoCao({ token, store: taiStore, now: NOW })).ok).toBe(true);

    const phoneKey = phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA);
    await db.discSubmission.updateMany({ where: { phoneKey }, data: { claimStatus: "CLAIMED", claimedAt: NOW } });
    const sau = await taiBaoCao({ token, store: taiStore, now: NOW });
    expect(sau).toEqual({ ok: false, loi: "TOKEN_KHONG_HOP_LE" });
    expect(bam(token)).toBeTruthy();
  });
});
