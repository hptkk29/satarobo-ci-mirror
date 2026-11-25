// @vitest-environment node
/**
 * [DDB-CL-*] nhận (claim) bài DISC trên Postgres THẬT (ci_test). OTP là GIẢ (không gửi ZNS/SMS thật); mọi thứ khác là thật.
 *   [DDB-CL-01] hai phiên cùng gắn một bài (Promise.all) ⇒ ĐÚNG MỘT thắng, claimedUserId = người thắng
 *   [DDB-CL-02] 10 lượt song song SAI năm sinh ⇒ claimAttempts == ngưỡng (3) đúng, KHÔNG vượt; sau đó mã+năm ĐÚNG vẫn bị khoá
 *   [DDB-CL-03] 10 lượt song song ĐÚNG mã+năm ⇒ chỉ đúng `ngưỡng` lượt chạm tới so khớp (không phải 10)
 *   [DDB-CL-04] thách đố năm sinh con: đúng mã + sai năm ⇒ null (và tốn 1 lượt); sai mã + đúng năm ⇒ null; đúng cả hai ⇒ ok
 *   [DDB-CL-05] nhanBaiDisc: hai phiên đua cùng bài, cùng SĐT, chưa đăng nhập ⇒ đúng 1 ok, đúng 1 User, bài CLAIMED bởi User đó
 *   [DDB-CL-06] maNhanStore.thuBangMa (đường XOÁ): 10 lượt song song sai mã ⇒ claimAttempts == 5; mã đúng sau khoá ⇒ null
 *   [DDB-CL-07] bài EXPIRED / REVOKED / của SĐT khác / đã CLAIMED ⇒ thu() = null (không oracle)
 *   [DDB-CL-08] phát lại (replay) KHÔNG đặt lại claimAttempts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { phoneKeyTuSdtChuan } from "../../lib/disc/phone-key";
import { bamMaNhan } from "../../lib/disc/luu";
import { maNhanStore, discStore } from "../../lib/disc/store-prisma";
import { TOI_DA_LAN_THU_MA } from "../../lib/disc/chinh-sach";
import { TOI_DA_LAN_THU_NHAN, nhanBaiDisc } from "../../lib/disc/nhan";
import { taoNhanDeps, thachDoStore } from "../../lib/disc/nhan-prisma";
import { KHOA, NAM_SINH_CON, NOW, RUN, assertCiTest, crmKhong, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const MA = "ABCDEFGHJK";
const maHash = bamMaNhan(MA, KHOA);

async function luuBai(sdt: string) {
  const key = khoaIdem("cl");
  const r = await luu(dauVao(sdt, { key }), depLuu(crmKhong, { sinhMa: () => MA }));
  if (!r.ok) throw new Error(`fixture lưu hỏng: ${r.loi}`);
  const ban = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
  return { key, id: ban.id, phoneKey: phoneKeyTuSdtChuan(sdtChuan(sdt), KHOA), submissionId: r.submissionId };
}
const thu = (phoneKey: string, nam: number, mh = maHash) => thachDoStore.thu({ phoneKey, maHash: mh, namSinhCon: nam, now: NOW, toiDaLanThu: TOI_DA_LAN_THU_NHAN });
const demThu = async (id: string) => (await db.discSubmission.findUniqueOrThrow({ where: { id }, select: { claimAttempts: true } })).claimAttempts;
let uSeq = 0;
const taoUser = (sdt: string) => db.user.create({ data: { phone: sdtChuan(sdt) + `${(uSeq += 1)}`.padStart(0, ""), role: "PARENT", roles: ["PARENT"], password: "x", accountStatus: "ACTIVE", isActive: true }, select: { id: true } });

describeDb("[DDB-CL] claim trên Postgres thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { phone: { startsWith: "8490" }, role: "PARENT", lastLoginAt: null, password: "x" } });
    await don();
    await db.$disconnect();
  });

  it("[DDB-CL-01] hai phiên cùng gắn một bài ⇒ đúng một thắng", async () => {
    const sdt = sdtMoi();
    const b = await luuBai(sdt);
    const [u1, u2] = [await taoUser(sdtMoi()), await taoUser(sdtMoi())];
    const kq = await Promise.all([
      thachDoStore.gan({ submissionId: b.id, phoneKey: b.phoneKey, userId: u1.id, now: NOW }),
      thachDoStore.gan({ submissionId: b.id, phoneKey: b.phoneKey, userId: u2.id, now: NOW }),
    ]);
    expect(kq.filter(Boolean)).toHaveLength(1);
    const dong = await db.discSubmission.findUniqueOrThrow({ where: { id: b.id } });
    expect(dong.claimStatus).toBe("CLAIMED");
    expect(dong.claimedUserId).toBe(kq[0] ? u1.id : u2.id);
    // Lượt thứ ba (sau khi đã nhận) cũng bị từ chối
    expect(await thachDoStore.gan({ submissionId: b.id, phoneKey: b.phoneKey, userId: u2.id, now: NOW })).toBe(false);
  });

  it("[DDB-CL-02] 10 lượt song song sai năm sinh ⇒ claimAttempts đúng bằng ngưỡng; sau đó đúng cả hai vẫn bị khoá", async () => {
    const b = await luuBai(sdtMoi());
    const sai = await Promise.all(Array.from({ length: 10 }, () => thu(b.phoneKey, NAM_SINH_CON + 1)));
    expect(sai.every((x) => x === null)).toBe(true);
    expect(await demThu(b.id)).toBe(TOI_DA_LAN_THU_NHAN);
    expect(await thu(b.phoneKey, NAM_SINH_CON)).toBeNull(); // khoá: kể cả mã+năm đúng
    expect(await demThu(b.id)).toBe(TOI_DA_LAN_THU_NHAN); // và không tăng thêm
  });

  it("[DDB-CL-03] 10 lượt song song ĐÚNG ⇒ đúng `ngưỡng` lượt chạm tới so khớp", async () => {
    const b = await luuBai(sdtMoi());
    const kq = await Promise.all(Array.from({ length: 10 }, () => thu(b.phoneKey, NAM_SINH_CON)));
    expect(kq.filter((x) => x !== null)).toHaveLength(TOI_DA_LAN_THU_NHAN);
    expect(await demThu(b.id)).toBe(TOI_DA_LAN_THU_NHAN);
  });

  it("[DDB-CL-04] thách đố năm sinh con", async () => {
    const b = await luuBai(sdtMoi());
    expect(await thu(b.phoneKey, NAM_SINH_CON + 1)).toBeNull(); // đúng mã, sai năm
    expect(await demThu(b.id)).toBe(1); // tốn một lượt (đếm TRƯỚC khi so)
    expect(await thu(b.phoneKey, NAM_SINH_CON, bamMaNhan("MNPQRSTUVW", KHOA))).toBeNull(); // sai mã, đúng năm
    expect(await demThu(b.id)).toBe(2);
    const ok = await thu(b.phoneKey, NAM_SINH_CON);
    expect(ok).toEqual({ submissionId: b.id });
  });

  it("[DDB-CL-05] nhanBaiDisc: hai phiên đua cùng bài/cùng SĐT ⇒ đúng 1 ok, 1 User, bài CLAIMED bởi User đó", async () => {
    const sdt = sdtMoi();
    const b = await luuBai(sdt);
    const deps = {
      ...taoNhanDeps(NOW),
      khoaBam: () => KHOA,
      choPhepGuiOtp: async () => true,
      otp: { yeuCau: async () => ({ ok: true as const, cooldownSec: 60 }), xacMinh: async () => ({ ok: true as const }) }, // OTP GIẢ
      sauKhiNhan: undefined,
    };
    const goi = () => nhanBaiDisc({ soDienThoai: sdt, otp: "123456", maNhan: MA, namSinhCon: NAM_SINH_CON, matKhau: "MatKhau-Gia-123", phien: null, deps });
    const kq = await Promise.all([goi(), goi()]);
    expect(kq.filter((r) => r.ok)).toHaveLength(1);
    const thua = kq.find((r) => !r.ok)!;
    expect(!thua.ok && thua.loi).toBe("MA_KHONG_KHOP"); // không lộ lý do thật
    const users = await db.user.findMany({ where: { phone: sdtChuan(sdt) }, select: { id: true } });
    expect(users).toHaveLength(1);
    const dong = await db.discSubmission.findUniqueOrThrow({ where: { id: b.id } });
    expect(dong.claimStatus).toBe("CLAIMED");
    expect(dong.claimedUserId).toBe(users[0]!.id);
  });

  it("[DDB-CL-06] đường XOÁ bằng mã: 10 lượt song song sai mã ⇒ claimAttempts == TOI_DA_LAN_THU_MA; đúng mã sau khoá ⇒ null", async () => {
    const b = await luuBai(sdtMoi());
    const sai = bamMaNhan("XYZ2345678", KHOA);
    const kq = await Promise.all(
      Array.from({ length: 10 }, () => maNhanStore.thuBangMa({ phoneKey: b.phoneKey, maHash: sai, now: NOW, toiDaLanThu: TOI_DA_LAN_THU_MA, hanhDong: { loai: "XOA" } })),
    );
    expect(kq.every((x) => x === null)).toBe(true);
    expect(await demThu(b.id)).toBe(TOI_DA_LAN_THU_MA);
    expect(await maNhanStore.thuBangMa({ phoneKey: b.phoneKey, maHash, now: NOW, toiDaLanThu: TOI_DA_LAN_THU_MA, hanhDong: { loai: "XOA" } })).toBeNull();
    const con = await db.discSubmission.findUniqueOrThrow({ where: { id: b.id }, include: { subjects: true } });
    expect(con.claimStatus).toBe("PENDING_CLAIM"); // chưa bị xoá
    expect(con.subjects).toHaveLength(2);
  });

  it("[DDB-CL-06b] đường XOÁ đúng mã (dưới ngưỡng) ⇒ REVOKED + xoá nội dung", async () => {
    const b = await luuBai(sdtMoi());
    const r = await maNhanStore.thuBangMa({ phoneKey: b.phoneKey, maHash, now: NOW, toiDaLanThu: TOI_DA_LAN_THU_MA, hanhDong: { loai: "XOA" } });
    expect(r).toEqual({ submissionId: b.id });
    const d = await db.discSubmission.findUniqueOrThrow({ where: { id: b.id }, include: { subjects: true } });
    expect(d.claimStatus).toBe("REVOKED");
    expect(d.subjects).toHaveLength(0);
    expect(d.claimCodeHash).toBeNull();
  });

  it("[DDB-CL-07] EXPIRED / REVOKED / SĐT khác / đã CLAIMED ⇒ thu() null", async () => {
    const hetHan = await luuBai(sdtMoi());
    await db.discSubmission.update({ where: { id: hetHan.id }, data: { retainUntil: new Date(NOW.getTime() - 1000) } });
    expect(await thu(hetHan.phoneKey, NAM_SINH_CON)).toBeNull();
    const thuHoi = await luuBai(sdtMoi());
    await db.discSubmission.update({ where: { id: thuHoi.id }, data: { claimStatus: "REVOKED" } });
    expect(await thu(thuHoi.phoneKey, NAM_SINH_CON)).toBeNull();
    const cuaA = await luuBai(sdtMoi());
    const phoneKeyB = phoneKeyTuSdtChuan(sdtChuan(sdtMoi()), KHOA);
    expect(await thu(phoneKeyB, NAM_SINH_CON)).toBeNull();
    expect(await demThu(cuaA.id)).toBe(0); // SĐT khác không đốt lượt của chủ bài
    const daNhan = await luuBai(sdtMoi());
    const u = await taoUser(sdtMoi());
    expect(await thachDoStore.gan({ submissionId: daNhan.id, phoneKey: daNhan.phoneKey, userId: u.id, now: NOW })).toBe(true);
    expect(await thu(daNhan.phoneKey, NAM_SINH_CON)).toBeNull();
    // Đối chứng dương: bài hợp lệ thì nhận được
    expect(await thu(cuaA.phoneKey, NAM_SINH_CON)).toEqual({ submissionId: cuaA.id });
  });

  it("[DDB-CL-08] phát lại (replay) KHÔNG đặt lại claimAttempts", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("rp");
    const vao = dauVao(sdt, { key });
    expect((await luu(vao, depLuu(crmKhong, { sinhMa: () => MA }))).ok).toBe(true);
    const ban = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
    await thu(ban.phoneKey, NAM_SINH_CON + 1);
    await thu(ban.phoneKey, NAM_SINH_CON + 1);
    expect(await demThu(ban.id)).toBe(2);
    expect((await luu(vao, depLuu(crmKhong, { sinhMa: () => "MNPQRSTUVW" }))).ok).toBe(true); // replay xoay mã
    expect(await demThu(ban.id)).toBe(2);
    // và mã MỚI mới đúng, mã cũ hết hiệu lực
    expect(await thu(ban.phoneKey, NAM_SINH_CON, maHash)).toBeNull();
    void discStore;
  });
});
