// @vitest-environment node
/**
 * [DDB-OTP-*] S-05 — `verifyAndConsumeOtp` giành lượt thử NGUYÊN TỬ trên Postgres THẬT.
 *   [DDB-OTP-01] 40 lượt đoán song song vào maxAttempts=5 ⇒ đúng ≤5 lượt được so mã; attempts cuối == 5, không vượt
 *   [DDB-OTP-02] mã ĐÚNG đua với nhiều lượt đoán sai ⇒ mã đúng thành công đúng 1 lần (nếu giành được lượt), attempts ≤ max
 *   [DDB-OTP-03] mã đúng khi còn lượt ⇒ ok một lần duy nhất (20 lượt song song cùng mã đúng ⇒ đúng 1 ok)
 *   [DDB-OTP-04] đủ lượt sai ⇒ mã đúng sau đó bị chặn (không còn so)
 * Chỉ chạy trên DB `ci_test`/`satarobo_test`; dọn theo target riêng (SĐT bịa, tiền tố 8499000…).
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { verifyAndConsumeOtp } from "../../lib/otp/service";
import { RUN, assertCiTest } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const KHOA = process.env.NEXTAUTH_SECRET ?? "";
const hash = (c: string) => createHmac("sha256", KHOA).update(c).digest("hex");
const DUNG = "123456";
let seq = 0;
const goc = 9_000_000 + (Date.now() % 900_000);
const daTao: string[] = [];
const targetMoi = () => {
  const t = `84${goc}${String((seq += 1)).padStart(2, "0")}`.slice(0, 11);
  daTao.push(t);
  return t;
};
async function taoOtp(target: string, maxAttempts = 5) {
  return db.otpRequest.create({
    data: { target, purpose: "DISC_CLAIM", codeHash: hash(DUNG), expiresAt: new Date(Date.now() + 5 * 60_000), maxAttempts },
    select: { id: true },
  });
}
const sai = (i: number) => String(100000 + i).replace(DUNG, "999999");
const laSoSanh = (r: { ok: boolean; error?: string }) => !r.ok && /Mã không đúng|Đã khoá/.test(r.error ?? "");

describeDb("[DDB-OTP] OTP: lượt thử nguyên tử (S-05)", () => {
  beforeAll(async () => {
    await assertCiTest();
  });
  afterAll(async () => {
    await db.otpRequest.deleteMany({ where: { target: { in: daTao } } });
  });

  it("[DDB-OTP-01] 40 lượt đoán song song, maxAttempts=5 ⇒ ≤5 lượt được so mã, attempts cuối == 5", async () => {
    const t = targetMoi();
    const row = await taoOtp(t);
    const kq = await Promise.all(Array.from({ length: 40 }, (_, i) => verifyAndConsumeOtp({ target: t, purpose: "DISC_CLAIM", code: sai(i) })));
    expect(kq.filter(laSoSanh).length).toBeLessThanOrEqual(5);
    expect(kq.some((r) => r.ok)).toBe(false);
    const sau = await db.otpRequest.findUniqueOrThrow({ where: { id: row.id }, select: { attempts: true, maxAttempts: true } });
    expect(sau.attempts).toBeLessThanOrEqual(sau.maxAttempts);
    expect(sau.attempts).toBe(5);
  });

  it("[DDB-OTP-02] mã đúng đua với 30 lượt đoán sai ⇒ tối đa 1 ok; attempts ≤ max", async () => {
    const t = targetMoi();
    const row = await taoOtp(t);
    const kq = await Promise.all([
      verifyAndConsumeOtp({ target: t, purpose: "DISC_CLAIM", code: DUNG }),
      ...Array.from({ length: 30 }, (_, i) => verifyAndConsumeOtp({ target: t, purpose: "DISC_CLAIM", code: sai(i) })),
    ]);
    expect(kq.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
    expect(kq.filter(laSoSanh).length).toBeLessThanOrEqual(5);
    const sau = await db.otpRequest.findUniqueOrThrow({ where: { id: row.id }, select: { attempts: true, maxAttempts: true } });
    expect(sau.attempts).toBeLessThanOrEqual(sau.maxAttempts);
  });

  it("[DDB-OTP-03] 20 lượt song song cùng mã ĐÚNG ⇒ đúng 1 ok", async () => {
    const t = targetMoi();
    await taoOtp(t);
    const kq = await Promise.all(Array.from({ length: 20 }, () => verifyAndConsumeOtp({ target: t, purpose: "DISC_CLAIM", code: DUNG })));
    expect(kq.filter((r) => r.ok)).toHaveLength(1);
  });

  it("[DDB-OTP-04] đủ lượt sai ⇒ mã đúng sau đó bị chặn", async () => {
    const t = targetMoi();
    await taoOtp(t, 3);
    for (let i = 0; i < 3; i++) expect((await verifyAndConsumeOtp({ target: t, purpose: "DISC_CLAIM", code: sai(i) })).ok).toBe(false);
    const r = await verifyAndConsumeOtp({ target: t, purpose: "DISC_CLAIM", code: DUNG });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/quá số lần/);
  });
});
