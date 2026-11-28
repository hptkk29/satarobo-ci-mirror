// @vitest-environment node
/**
 * Tầng Prisma của luồng nhận bài (nhan-prisma.ts) — KHÔNG chạm DB thật:
 *  · [DISC-NPR-01..04] hành vi `thachDoStore` trên một "transaction" giả giữ đúng ngữ nghĩa where/updateMany/findFirst cần dùng;
 *  · [DISC-NPR-06] lưới đọc mã ghim thứ tự "tăng bộ đếm CÓ ĐIỀU KIỆN → rồi mới so" và so CHỈ trong dòng vừa tăng;
 *  · [DISC-NPR-08] `taoNhanDeps`: khoá HMAC, trần OTP theo số, nối đồng ý tiếp thị.
 * Lưu ý giới hạn: fake không chứng minh an toàn ĐUA ở Postgres (cái đó nhờ điều kiện `claimAttempts < N` nằm TRONG `updateMany`, ghim ở NPR-06).
 * Dữ liệu GIẢ.
 */
import { describe, expect, it, vi } from "vitest";
import { boChuThich, docTep, tuongDoi } from "../../tests/disc/_quet";
import { resolve } from "node:path";

type Dong = {
  id: string;
  phoneKey: string;
  claimStatus: "PENDING_CLAIM" | "CLAIMED";
  deletedAt: Date | null;
  retainUntil: Date;
  claimAttempts: number;
  claimCodeHash: string | null;
  claimedUserId?: string | null;
  claimedAt?: Date | null;
  subjects: Array<{ role: "PARENT" | "STUDENT"; birthYear: number }>;
};

const M = vi.hoisted(() => ({ rows: [] as unknown[], rateLimit: vi.fn(async (_a: { key: string; max: number; windowMs: number }) => ({ success: true })), tiepThi: vi.fn(async (_p: unknown) => "DA_BAT"), referral: vi.fn(async (_p: unknown) => "DA_GHI"), gatEmail: vi.fn(async (_id: string) => "DA_GAT") }));

/** Bộ so khớp `where` tối thiểu cho đúng các toán tử mà nhan-prisma.ts dùng. */
function khop(r: Dong, w: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(w)) {
    if (k === "subjects") {
      const s = (v as { some: { role: string; birthYear: number } }).some;
      if (!r.subjects.some((x) => x.role === s.role && x.birthYear === s.birthYear)) return false;
      continue;
    }
    const gt = r[k as keyof Dong];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as { in?: string[]; lt?: number; gt?: Date; not?: unknown };
      if (o.in && !o.in.includes(gt as string)) return false;
      if (o.lt !== undefined && !((gt as number) < o.lt)) return false;
      if (o.gt !== undefined && !((gt as Date).getTime() > o.gt.getTime())) return false;
      if ("not" in o && gt === o.not) return false;
    } else if (gt instanceof Date && v instanceof Date ? gt.getTime() !== v.getTime() : gt !== v) return false;
  }
  return true;
}

vi.mock("server-only", () => ({}));
vi.mock("bcryptjs", () => ({ default: { hash: async (m: string) => `h(${m})` } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: M.rateLimit }));
vi.mock("@/lib/otp/service", () => ({ requestOtp: vi.fn(), verifyAndConsumeOtp: vi.fn() }));
vi.mock("@/lib/security/signing-key", () => ({ getSigningSecret: () => "khoa-thu-nghiem-gia-0123456789abcdef0123" }));
vi.mock("./crm-that", () => ({ xacNhanTiepThiSauNhan: M.tiepThi, ghiReferralSauNhan: M.referral }));
vi.mock("./crm-email", () => ({ gatEmailDaXacMinhChoLead: M.gatEmail }));
vi.mock("@/lib/db", () => {
  const rows = () => M.rows as Dong[];
  const discSubmission = {
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows().filter((r) => khop(r, where)).map((r) => ({ id: r.id })),
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows().find((r) => khop(r, where)) ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const dich = rows().filter((r) => khop(r, where));
      for (const r of dich) {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) (r as Record<string, unknown>)[k] = (r[k as keyof Dong] as number) + (v as { increment: number }).increment;
          else (r as Record<string, unknown>)[k] = v;
        }
      }
      return { count: dich.length };
    },
    count: async ({ where }: { where: Record<string, unknown> }) => rows().filter((r) => khop(r, where)).length,
  };
  return { db: { discSubmission, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ discSubmission }) } };
});

import { TOI_DA_LAN_THU_NHAN, TRAN_OTP_NHAN_MOI_SDT_MOI_NGAY, TRAN_THU_NHAN_MOI_SDT_MOI_GIO } from "./nhan";
import { taoNhanDeps, thachDoStore } from "./nhan-prisma";
import { phoneKeyCuaSdt, phoneKeyTuSdtChuan } from "./phone-key";

const NOW = new Date("2026-11-01T00:00:00Z");
const HAN = new Date("2027-01-01T00:00:00Z");
const PK = "hmac-gia-A";
const dong = (o: Partial<Dong> & { id: string }): Dong => ({
  phoneKey: PK,
  claimStatus: "PENDING_CLAIM",
  deletedAt: null,
  retainUntil: HAN,
  claimAttempts: 0,
  claimCodeHash: "hash-A",
  subjects: [{ role: "PARENT", birthYear: 1985 }, { role: "STUDENT", birthYear: 2015 }],
  ...o,
});
const thu = (o: Partial<Parameters<typeof thachDoStore.thu>[0]> = {}) =>
  thachDoStore.thu({ phoneKey: PK, maHash: "hash-A", namSinhCon: 2015, now: NOW, toiDaLanThu: TOI_DA_LAN_THU_NHAN, ...o });

describe("[DISC-NPR-01] thachDoStore.thu — mã + năm sinh của HỌC SINH", () => {
  it("đúng cả hai ⇒ trả id (chưa gắn); sai năm / sai mã / năm của PHỤ HUYNH ⇒ null", async () => {
    M.rows = [dong({ id: "A" })];
    expect(await thu()).toEqual({ submissionId: "A" });
    expect((M.rows as Dong[])[0]!.claimStatus).toBe("PENDING_CLAIM"); // `thu` KHÔNG gắn
    M.rows = [dong({ id: "A" })];
    expect(await thu({ namSinhCon: 2014 })).toBeNull();
    expect(await thu({ maHash: "hash-B" })).toBeNull();
    expect(await thu({ namSinhCon: 1985 })).toBeNull(); // 1985 là năm sinh PHỤ HUYNH, không phải học sinh
  });
  it("bộ đếm tăng cả khi sai (transaction giữ lại, không ném) và dừng ở ngưỡng", async () => {
    M.rows = [dong({ id: "A" })];
    for (let i = 0; i < TOI_DA_LAN_THU_NHAN + 4; i++) await thu({ namSinhCon: 1999 });
    expect((M.rows as Dong[])[0]!.claimAttempts).toBe(TOI_DA_LAN_THU_NHAN);
  });
  it("đã khoá ⇒ mã + năm ĐÚNG vẫn null; đối chứng dương: dòng chưa khoá thì khớp", async () => {
    M.rows = [dong({ id: "A", claimAttempts: TOI_DA_LAN_THU_NHAN })];
    expect(await thu()).toBeNull();
    M.rows = [dong({ id: "A", claimAttempts: TOI_DA_LAN_THU_NHAN - 1 })];
    expect(await thu()).toEqual({ submissionId: "A" });
  });
});

describe("[DISC-NPR-02] phạm vi: chỉ bài CÒN HIỆU LỰC của ĐÚNG khoá SĐT", () => {
  it("bài của khoá khác / đã nhận / đã xoá / hết hạn ⇒ null và không đụng bộ đếm của bài người khác", async () => {
    M.rows = [
      dong({ id: "khac", phoneKey: "hmac-gia-B" }),
      dong({ id: "daNhan", claimStatus: "CLAIMED" }),
      dong({ id: "daXoa", deletedAt: NOW }),
      dong({ id: "hetHan", retainUntil: new Date("2026-10-01T00:00:00Z") }),
    ];
    expect(await thu()).toBeNull();
    expect((M.rows as Dong[]).map((r) => r.claimAttempts)).toEqual([0, 0, 0, 0]);
  });
});

describe("[DISC-NPR-03] so khớp CHỈ trong dòng VỪA được tăng (dòng đã khoá không được khớp nhờ dòng khác)", () => {
  it("A đã khoá (mã+năm đúng) + B chưa khoá ⇒ gửi mã của A vẫn null", async () => {
    M.rows = [dong({ id: "A", claimAttempts: TOI_DA_LAN_THU_NHAN }), dong({ id: "B", claimCodeHash: "hash-B", subjects: [{ role: "STUDENT", birthYear: 2012 }] })];
    expect(await thu()).toBeNull();
    const [a, b] = M.rows as Dong[];
    expect(a!.claimAttempts).toBe(TOI_DA_LAN_THU_NHAN);
    expect(b!.claimAttempts).toBe(1);
  });
  it("nhiều bài cùng SĐT: khớp đúng bài có mã + năm; các bài còn lại cùng bị đếm", async () => {
    M.rows = [dong({ id: "A", claimCodeHash: "hash-A" }), dong({ id: "B", claimCodeHash: "hash-B", subjects: [{ role: "STUDENT", birthYear: 2012 }] })];
    expect(await thu({ maHash: "hash-B", namSinhCon: 2012 })).toEqual({ submissionId: "B" });
    expect((M.rows as Dong[]).map((r) => r.claimAttempts)).toEqual([1, 1]);
  });
});

describe("[DISC-NPR-04] thachDoStore.gan — CAS", () => {
  it("chỉ một lượt gắn được; bài khác khoá SĐT / đã gắn / hết hạn ⇒ false", async () => {
    M.rows = [dong({ id: "A" })];
    expect(await thachDoStore.gan({ submissionId: "A", phoneKey: PK, userId: "u1", now: NOW })).toBe(true);
    expect(await thachDoStore.gan({ submissionId: "A", phoneKey: PK, userId: "u2", now: NOW })).toBe(false);
    expect(M.rows as Dong[]).toMatchObject([{ claimStatus: "CLAIMED", claimedUserId: "u1" }]);
    M.rows = [dong({ id: "A" })];
    expect(await thachDoStore.gan({ submissionId: "A", phoneKey: "hmac-gia-B", userId: "u1", now: NOW })).toBe(false);
    M.rows = [dong({ id: "A", retainUntil: new Date("2026-10-01T00:00:00Z") })];
    expect(await thachDoStore.gan({ submissionId: "A", phoneKey: PK, userId: "u1", now: NOW })).toBe(false);
  });
});

describe("[DISC-NPR-06] lưới đọc mã: tăng bộ đếm CÓ ĐIỀU KIỆN trước khi so, trong một transaction", () => {
  const ma = boChuThich(docTep(resolve(process.cwd(), "lib/disc/nhan-prisma.ts")));
  const thu_ = ma.slice(ma.indexOf("async thu("), ma.indexOf("async gan("));

  it("nằm trong db.$transaction và KHÔNG ném khi sai (ném ⇒ rollback bộ đếm)", () => {
    expect(thu_).toMatch(/db\.\$transaction\(/);
    expect(thu_).not.toMatch(/\bthrow\b/);
  });
  it("updateMany tăng claimAttempts có điều kiện `lt` (điều kiện nằm TRONG phép ghi) và đứng TRƯỚC findFirst", () => {
    const iTang = thu_.search(/updateMany\(\{[\s\S]*?claimAttempts:\s*\{\s*lt:\s*toiDaLanThu\s*\}[\s\S]*?increment:\s*1/);
    const iSo = thu_.search(/findFirst\(/);
    expect(iTang).toBeGreaterThan(-1);
    expect(iSo).toBeGreaterThan(-1);
    expect(iTang).toBeLessThan(iSo);
    expect((thu_.match(/claimAttempts:\s*\{\s*lt:\s*toiDaLanThu\s*\}/g) ?? []).length).toBe(2); // đọc ứng viên + điều kiện trong chính phép ghi
  });
  it("so khớp CHỈ trong dòng vừa tăng (`id: { in: daTang }`) và đòi vai STUDENT + năm sinh", () => {
    expect(thu_).toMatch(/findFirst\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*daTang\s*\}/);
    expect(thu_).toMatch(/role:\s*"STUDENT",\s*birthYear:\s*namSinhCon/);
  });
  it("gan: CAS trên PENDING_CLAIM trong chính where của updateMany", () => {
    const gan = ma.slice(ma.indexOf("async gan("));
    expect(gan).toMatch(/updateMany\(\{\s*where:\s*\{[^}]*claimStatus:\s*"PENDING_CLAIM"/);
  });
  it(`[tự kiểm] ${tuongDoi(resolve(process.cwd(), "lib/disc/nhan-prisma.ts"))}: bộ cắt đoạn thật sự lấy được thân thu/gan`, () => {
    expect(thu_.length).toBeGreaterThan(300);
    expect(ma.indexOf("async gan(")).toBeGreaterThan(ma.indexOf("async thu("));
  });
});

describe("[DISC-NPR-08] taoNhanDeps", () => {
  it("khoaSdt = HMAC (không phải SĐT thô, ổn định, khác theo số); trần OTP hỏi bằng khoá HMAC + đúng ngưỡng ngày", async () => {
    const d = taoNhanDeps(NOW);
    const k1 = d.khoaSdt("84905000111");
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(k1).not.toContain("905000111");
    expect(d.khoaSdt("84905000111")).toBe(k1);
    expect(d.khoaSdt("84905000112")).not.toBe(k1);
    M.rateLimit.mockClear();
    expect(await d.choPhepGuiOtp(k1)).toBe(true);
    expect(M.rateLimit).toHaveBeenCalledWith({ key: `otp:disc-claim:sdt:${k1}`, max: TRAN_OTP_NHAN_MOI_SDT_MOI_NGAY, windowMs: 86_400_000 });
    expect(JSON.stringify(M.rateLimit.mock.calls)).not.toContain("84905000111");
    M.rateLimit.mockResolvedValueOnce({ success: false });
    expect(await d.choPhepGuiOtp(k1)).toBe(false);
    // S-04: cầu chì NGÂN SÁCH toàn cục tiêu ở CHÍNH điểm này (sau trần theo SĐT): hết ngân sách ngày ⇒ không gửi, dù trần SĐT còn.
    M.rateLimit.mockClear();
    M.rateLimit.mockImplementation(async (a: { key: string }) => ({ success: a.key !== "disc:otp-claim:toan-cuc:ngay" }));
    expect(await d.choPhepGuiOtp(k1)).toBe(false);
    expect(M.rateLimit.mock.calls.map((c) => c[0].key)).toContain("disc:otp-claim:toan-cuc:ngay");
    M.rateLimit.mockImplementation(async () => ({ success: true }));
  });
  it("khoaSdt TRÙNG BYTE với hàm công khai của backend (phoneKeyCuaSdt) — lệch là mọi lượt nhận ra 'không có bài' mà không lỗi nào báo", () => {
    const d = taoNhanDeps(NOW);
    const KHOA_GIA = "khoa-thu-nghiem-gia-0123456789abcdef0123";
    expect(d.khoaSdt("84905000111")).toBe(phoneKeyTuSdtChuan("84905000111", KHOA_GIA));
    expect(d.khoaSdt("84905000111")).toBe(phoneKeyCuaSdt("0905000111", () => KHOA_GIA));
    expect(d.khoaSdt("84905000111")).toBe(phoneKeyCuaSdt("+84 905 000 111", () => KHOA_GIA)); // cùng khoá dù gõ khác kiểu
  });
  it("coBaiDangCho đếm theo khoá HMAC, chỉ bài PENDING còn hạn có mã nhận", async () => {
    const d = taoNhanDeps(NOW);
    M.rows = [dong({ id: "A" }), dong({ id: "B", claimCodeHash: null }), dong({ id: "C", phoneKey: "hmac-gia-B" })];
    expect(await d.coBaiDangCho(PK, NOW)).toBe(true);
    expect(await d.coBaiDangCho("hmac-gia-Z", NOW)).toBe(false);
    M.rows = [dong({ id: "B", claimCodeHash: null })];
    expect(await d.coBaiDangCho(PK, NOW)).toBe(false);
  });
  it("sauKhiNhan nối sang tiếp thị + referral + gắn email; một bước ném KHÔNG cản bước khác", async () => {
    const d = taoNhanDeps(NOW);
    M.referral.mockRejectedValueOnce(new Error("x"));
    await d.sauKhiNhan!({ submissionId: "A", sdtChuan: "84905000111", chuSoDongY: true });
    expect(M.tiepThi).toHaveBeenCalledWith({ submissionId: "A", sdtChuan: "84905000111", chuSoDongY: true });
    expect(M.referral).toHaveBeenCalledWith({ submissionId: "A", sdtChuan: "84905000111" });
    expect(M.gatEmail).toHaveBeenCalledWith("A");
  });
  it("N3 choPhepThuOtp: không có dòng khớp mã băm ⇒ false và KHÔNG chạm trần; có ⇒ hỏi trần theo HMAC-SĐT", async () => {
    const d = taoNhanDeps(NOW);
    M.rows = [dong({ id: "A" })];
    M.rateLimit.mockClear();
    expect(await d.choPhepThuOtp({ khoaSdt: PK, maHash: "hash-SAI", now: NOW })).toBe(false);
    expect(M.rateLimit).not.toHaveBeenCalled(); // kẻ không có mã không chạm tới trần của chủ số
    expect(await d.choPhepThuOtp({ khoaSdt: "hmac-gia-Z", maHash: "hash-A", now: NOW })).toBe(false); // mã đúng nhưng của SĐT khác
    expect(await d.choPhepThuOtp({ khoaSdt: PK, maHash: "hash-A", now: NOW })).toBe(true);
    expect(M.rateLimit).toHaveBeenCalledWith({ key: `disc-claim:thu:${PK}`, max: TRAN_THU_NHAN_MOI_SDT_MOI_GIO, windowMs: 3_600_000 });
    M.rateLimit.mockResolvedValueOnce({ success: false });
    expect(await d.choPhepThuOtp({ khoaSdt: PK, maHash: "hash-A", now: NOW })).toBe(false); // quá trần
  });
  it("N3 choPhepThuOtp: bài đã khoá (claimAttempts ≥ ngưỡng) / hết hạn / đã CLAIMED ⇒ false dù mã đúng", async () => {
    const d = taoNhanDeps(NOW);
    for (const o of [{ claimAttempts: TOI_DA_LAN_THU_NHAN }, { retainUntil: new Date(NOW.getTime() - 1) }, { claimStatus: "CLAIMED" as const }]) {
      M.rows = [dong({ id: "A", ...o })];
      expect(await d.choPhepThuOtp({ khoaSdt: PK, maHash: "hash-A", now: NOW })).toBe(false);
    }
  });
});
