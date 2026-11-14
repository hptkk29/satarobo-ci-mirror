import { beforeEach, describe, expect, it, vi } from "vitest";

// db GIẢ trong bộ nhớ — chỉ đủ các hình `where` mà store-prisma dùng. Test này khoá LOGIC của
// `maNhanStore.thuBangMa` (bộ đếm thử sai nguyên tử, khoá, bài số khác) mà không cần Postgres.
type Dong = Record<string, unknown> & { id: string };
const kho = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown> & { id: string }>,
  subjects: [] as Array<{ submissionId: string }>,
  taoGoi: [] as Array<Record<string, unknown>>,
  chonTai: [] as Array<Record<string, unknown>>,
}));

function khop(row: Dong, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const x = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if ("in" in o) return (o.in as unknown[]).includes(x);
      if ("lt" in o) return (x as number | Date) < (o.lt as number | Date);
      if ("lte" in o) return (x as number | Date) <= (o.lte as number | Date);
      if ("gt" in o) return (x as number | Date) > (o.gt as number | Date);
      if ("gte" in o) return (x as number | Date) >= (o.gte as number | Date);
      if ("not" in o) return x !== o.not;
    }
    return x === v;
  });
}
function ghi(row: Dong, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) row[k] = (row[k] as number) + ((v as { increment: number }).increment);
    else row[k] = v;
  }
}

vi.mock("@/lib/db", () => {
  const discSubmission = {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const t = kho.rows.filter((r) => khop(r, where));
      t.forEach((r) => ghi(r, data));
      return { count: t.length };
    },
    findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      if (select && "subjects" in select) kho.chonTai.push(select);
      return kho.rows.find((r) => khop(r, where)) ?? null;
    },
    count: async ({ where }: { where: Record<string, unknown> }) => kho.rows.filter((r) => khop(r, where)).length,
    findUnique: async ({ where }: { where: { idempotencyKey: string } }) => kho.rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      kho.taoGoi.push(data);
      if (kho.rows.some((r) => r.idempotencyKey === data.idempotencyKey)) {
        const { Prisma } = await import("@prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("trùng", { code: "P2002", clientVersion: "test" });
      }
      const dong = { claimStatus: "PENDING_CLAIM", deletedAt: null, id: `n${kho.rows.length + 1}`, ...data } as Record<string, unknown> & { id: string };
      kho.rows.push(dong);
      return dong;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => kho.rows.filter((r) => khop(r, where)),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = kho.rows.find((x) => x.id === where.id)!;
      ghi(r, data);
      return r;
    },
  };
  const discSubject = {
    deleteMany: async ({ where }: { where: { submissionId: string | { in: string[] } } }) => {
      const ids = typeof where.submissionId === "string" ? [where.submissionId] : where.submissionId.in;
      kho.subjects = kho.subjects.filter((s) => !ids.includes(s.submissionId));
      return { count: 0 };
    },
  };
  const tx = { discSubmission, discSubject };
  return { db: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { discStore, maNhanStore, taiStore, vongDoiStore } from "./store-prisma";

// Dữ liệu GIẢ. Mốc thời gian tuyệt đối (luật 19).
const NOW = new Date("2026-11-01T03:00:00Z");
const TUONG_LAI = new Date("2027-01-01T00:00:00Z");
const QUA_KHU = new Date("2026-10-01T00:00:00Z");
const TOI_DA = 5;
const dong = (o: Record<string, unknown> = {}): Dong => ({
  id: "s1",
  phoneKey: "84905123456",
  claimStatus: "PENDING_CLAIM",
  deletedAt: null,
  retainUntil: TUONG_LAI,
  claimCodeHash: "HASH-DUNG",
  claimAttempts: 0,
  claimedUserId: null,
  reportSnapshot: { x: 1 },
  emailTo: "a@b.c",
  ...o,
});
const thu = (maHash: string, phoneKey = "84905123456") =>
  maNhanStore.thuBangMa({ phoneKey, maHash, now: NOW, toiDaLanThu: TOI_DA, hanhDong: { loai: "XOA" } });

beforeEach(() => {
  kho.taoGoi = [];
  kho.chonTai = [];
  kho.rows = [dong()];
  kho.subjects = [{ submissionId: "s1" }, { submissionId: "s1" }];
});

describe("[DISC-SP-01] thuBangMa — chỉ còn XOÁ; nhánh NHẬN đã gỡ (nhận bài phải qua thách đố năm sinh ở nhan-prisma.ts)", () => {
  it("[SP-01a] mã ĐÚNG + SĐT đúng nhưng hành động NHAN (ép kiểu) ⇒ null: bài KHÔNG thành CLAIMED, không gắn user", async () => {
    const nhan = { loai: "NHAN", userId: "u1" } as unknown as { loai: "XOA" };
    expect(await maNhanStore.thuBangMa({ phoneKey: "84905123456", maHash: "HASH-DUNG", now: NOW, toiDaLanThu: TOI_DA, hanhDong: nhan })).toBeNull();
    expect(kho.rows[0]).toMatchObject({ claimStatus: "PENDING_CLAIM", claimedUserId: null });
    expect(kho.subjects).toHaveLength(2); // cũng không xoá gì
  });
  it("[SP-01b] không dòng nào trong store.rows trở thành CLAIMED qua thuBangMa dù thử mọi mã", async () => {
    await thu("HASH-DUNG");
    expect(kho.rows.some((r) => r.claimStatus === "CLAIMED")).toBe(false);
  });
});

describe("[DISC-SP-02] thuBangMa — xoá", () => {
  it("mã đúng ⇒ REVOKED, xoá DiscSubject và nội dung nhạy cảm", async () => {
    expect(await thu("HASH-DUNG")).toEqual({ submissionId: "s1" });
    expect(kho.rows[0]).toMatchObject({ claimStatus: "REVOKED", deletedAt: NOW, reportSnapshot: {}, emailTo: null, claimCodeHash: null });
    expect(kho.subjects).toHaveLength(0);
  });
  it("mã sai ⇒ KHÔNG xoá gì, bộ đếm TĂNG và được giữ (không rollback)", async () => {
    expect(await thu("HASH-SAI")).toBeNull();
    expect(kho.subjects).toHaveLength(2);
    expect(kho.rows[0]).toMatchObject({ claimStatus: "PENDING_CLAIM", claimAttempts: 1 });
  });
  it("SĐT khác (kẻ có OTP của số khác nhưng biết mã) ⇒ null, bài KHÔNG đổi, bộ đếm KHÔNG tăng trên bài này", async () => {
    expect(await thu("HASH-DUNG", "84912345678")).toBeNull();
    expect(kho.rows[0]).toMatchObject({ claimStatus: "PENDING_CLAIM", claimAttempts: 0 });
    expect(kho.subjects).toHaveLength(2);
  });
  it("sau đúng TOI_DA lần sai ⇒ KHOÁ: ngay cả mã ĐÚNG cũng bị từ chối (không phân biệt với sai mã)", async () => {
    for (let i = 0; i < TOI_DA; i++) expect(await thu("HASH-SAI")).toBeNull();
    expect(kho.rows[0]!.claimAttempts).toBe(TOI_DA);
    expect(await thu("HASH-DUNG")).toBeNull();
    expect(kho.rows[0]).toMatchObject({ claimStatus: "PENDING_CLAIM", claimAttempts: TOI_DA });
    expect(kho.subjects).toHaveLength(2);
  });
  it("lượt thứ TOI_DA vẫn được thử mã đúng (4 sai rồi đúng ⇒ xoá được)", async () => {
    for (let i = 0; i < TOI_DA - 1; i++) await thu("HASH-SAI");
    expect(await thu("HASH-DUNG")).toEqual({ submissionId: "s1" });
  });
  it("bài hết hạn / đã xoá / đã nhận ⇒ null, không xoá gì", async () => {
    for (const patch of [{ retainUntil: QUA_KHU }, { deletedAt: NOW }, { claimStatus: "CLAIMED" }, { claimStatus: "EXPIRED" }]) {
      kho.rows = [dong(patch)];
      expect(await thu("HASH-DUNG")).toBeNull();
    }
    expect(kho.subjects).toHaveLength(2);
  });
  it("mã đúng của bài A không xoá bài B cùng SĐT (mỗi bài một mã)", async () => {
    kho.rows = [dong({ id: "A", claimCodeHash: "HASH-A" }), dong({ id: "B", claimCodeHash: "HASH-B" })];
    kho.subjects = [{ submissionId: "A" }, { submissionId: "B" }];
    expect(await thu("HASH-B")).toEqual({ submissionId: "B" });
    expect(kho.rows.find((r) => r.id === "A")!.claimStatus).toBe("PENDING_CLAIM");
    expect(kho.subjects).toEqual([{ submissionId: "A" }]);
  });
});

describe("[DISC-SP-03] vongDoiStore", () => {
  it("timHetHan chỉ trả bài PENDING quá hạn chưa xoá", async () => {
    kho.rows = [
      dong({ id: "het", retainUntil: QUA_KHU }),
      dong({ id: "con", retainUntil: TUONG_LAI }),
      dong({ id: "daNhan", retainUntil: QUA_KHU, claimStatus: "CLAIMED" }),
      dong({ id: "daXoa", retainUntil: QUA_KHU, deletedAt: QUA_KHU }),
    ];
    expect(await vongDoiStore.timHetHan(NOW, 10)).toEqual(["het"]);
  });
  it("danhDauHetHan ⇒ EXPIRED + xoá nội dung; bài vừa được nhận giữa hai bước KHÔNG bị xoá nhầm", async () => {
    kho.rows = [dong({ id: "het", retainUntil: QUA_KHU }), dong({ id: "vuaNhan", retainUntil: QUA_KHU, claimStatus: "CLAIMED" })];
    kho.subjects = [{ submissionId: "het" }, { submissionId: "vuaNhan" }];
    expect(await vongDoiStore.danhDauHetHan(["het", "vuaNhan"], NOW)).toBe(1);
    expect(kho.rows.find((r) => r.id === "het")).toMatchObject({ claimStatus: "EXPIRED", deletedAt: NOW, reportSnapshot: {}, emailTo: null });
    expect(kho.rows.find((r) => r.id === "vuaNhan")).toMatchObject({ claimStatus: "CLAIMED", emailTo: "a@b.c" });
    expect(kho.subjects).toEqual([{ submissionId: "vuaNhan" }]);
  });
  it("danhDauHetHan với danh sách rỗng ⇒ 0, không ghi", async () => {
    expect(await vongDoiStore.danhDauHetHan([], NOW)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// discStore (tạo · phát lại · trần theo SĐT) và taiStore — dùng db GIẢ ở trên
// ─────────────────────────────────────────────────────────────────────────────
const CONSENT_AT = new Date("2026-11-01T03:00:00Z");
const taoInput = (o: Record<string, unknown> = {}) =>
  ({
    idempotencyKey: "khoa-ngau-nhien-0123456789",  // gitleaks:allow
    phoneKey: "PK-HMAC-A",
    payloadHash: "PH-A",
    emailTo: null,
    emailStatus: "NONE",
    tiepThi: true,
    consentVersion: "v1",
    consentAt: CONSENT_AT,
    consentMarketingAt: CONSENT_AT,
    consentSubjectRole: "ME",
    consentTextHash: null,
    engineVersion: "e-gia",
    campaign: "DISC",
    tokenHash: "TH",
    tokenHetHan: TUONG_LAI,
    claimCodeHash: "CH",
    retainUntil: TUONG_LAI,
    nguoi: [{ role: "PARENT", hoTen: "Mai Giả", namSinh: 1988, bacHoc: null, nguoiLonQuanSat: false, phienBanBoDe: "g1", ketQua: { diem: { D: 1, I: 2, S: 3, C: 4 } } }],
    ...o,
  }) as Parameters<typeof discStore.taoHoacLayTheoKhoa>[0];

describe("[DISC-SP-10] discStore.taoHoacLayTheoKhoa", () => {
  beforeEach(() => {
    kho.rows = [];
  });
  it("mốc đồng ý lấy từ đầu vào (không đồng hồ), reportSnapshot luôn {}, lưu payloadHash/vai/campaign", async () => {
    const r = await discStore.taoHoacLayTheoKhoa(taoInput());
    expect(r.taoMoi).toBe(true);
    expect(kho.taoGoi[0]).toMatchObject({
      consentAt: CONSENT_AT,
      consentMarketingAt: CONSENT_AT,
      consentSubjectRole: "ME",
      payloadHash: "PH-A",
      campaign: "DISC",
      reportSnapshot: {},
    });
    // Kết quả chỉ nằm ở DiscSubject.result — không có bản thứ hai.
    expect(JSON.stringify(kho.taoGoi[0]!.reportSnapshot)).toBe("{}");
    expect(JSON.stringify(kho.taoGoi[0])).toContain('"result"');
  });
  it("trùng khoá (P2002) ⇒ taoMoi:false và trả ĐỦ trường để dịch vụ quyết replay (hash · trạng thái · xoá · hạn)", async () => {
    await discStore.taoHoacLayTheoKhoa(taoInput());
    const r = await discStore.taoHoacLayTheoKhoa(taoInput({ payloadHash: "PH-B" }));
    expect(r.taoMoi).toBe(false);
    expect(r.ban).toMatchObject({ payloadHash: "PH-A", claimStatus: "PENDING_CLAIM", deletedAt: null, phoneKey: "PK-HMAC-A" });
    expect(r.ban.retainUntil).toBe(TUONG_LAI);
    expect(kho.rows).toHaveLength(1);
  });
});

describe("[DISC-SP-11] discStore.xoayTokenTai — ghi CÓ ĐIỀU KIỆN, nguyên tử", () => {
  beforeEach(() => {
    kho.rows = [dong({ id: "s1", downloadTokenHash: "CU", claimCodeHash: "MA-CU", claimAttempts: 3 })];
  });
  it("bài còn chờ ⇒ true, đổi token + mã, KHÔNG đặt lại claimAttempts", async () => {
    expect(await discStore.xoayTokenTai("s1", "T-MOI", TUONG_LAI, "MA-MOI", NOW)).toBe(true);
    expect(kho.rows[0]).toMatchObject({ downloadTokenHash: "T-MOI", claimCodeHash: "MA-MOI", claimAttempts: 3 });
  });
  it.each([
    ["đã nhận", { claimStatus: "CLAIMED" }],
    ["đã thu hồi", { claimStatus: "REVOKED" }],
    ["đã xoá", { deletedAt: NOW }],
    ["quá hạn", { retainUntil: QUA_KHU }],
  ])("bài %s ⇒ false và token/mã CŨ nguyên vẹn", async (_t, patch) => {
    kho.rows = [dong({ id: "s1", downloadTokenHash: "CU", claimCodeHash: "MA-CU", ...patch })];
    expect(await discStore.xoayTokenTai("s1", "T-MOI", TUONG_LAI, "MA-MOI", NOW)).toBe(false);
    expect(kho.rows[0]).toMatchObject({ downloadTokenHash: "CU", claimCodeHash: "MA-CU" });
  });
});

describe("[DISC-SP-12] discStore.demTheoPhone (N6: theo cặp VÀ theo SĐT)", () => {
  const TU = new Date("2026-10-31T03:00:00Z");
  it("đếm MỌI trạng thái (cả REVOKED/EXPIRED), đúng phoneKey, trong cửa sổ, trừ khoá được loại — cặp chỉ tính đúng ipKey", async () => {
    kho.rows = [
      dong({ id: "a", idempotencyKey: "A", consentAt: NOW, ipKey: "IP-X" }),
      dong({ id: "b", idempotencyKey: "B", consentAt: NOW, claimStatus: "REVOKED", deletedAt: NOW, ipKey: "IP-X" }),
      dong({ id: "c", idempotencyKey: "C", consentAt: NOW, claimStatus: "EXPIRED", ipKey: "IP-Y" }),
      dong({ id: "d", idempotencyKey: "D", consentAt: new Date("2026-10-30T00:00:00Z"), ipKey: "IP-X" }), // ngoài cửa sổ
      dong({ id: "e", idempotencyKey: "E", consentAt: NOW, phoneKey: "84912345678", ipKey: "IP-X" }), // SĐT khác
      dong({ id: "f", idempotencyKey: "F", consentAt: NOW, ipKey: null }), // dòng đời cũ không có ipKey: chỉ tính ở trần cứng
    ];
    expect(await discStore.demTheoPhone("84905123456", "IP-X", TU, "KHONG-CO")).toEqual({ theoCap: 2, theoPhone: 4 });
    expect(await discStore.demTheoPhone("84905123456", "IP-X", TU, "A")).toEqual({ theoCap: 1, theoPhone: 3 });
    // IP khác: kẻ gõ ở IP-X không đẩy số cặp của IP-Z lên.
    expect(await discStore.demTheoPhone("84905123456", "IP-Z", TU, "KHONG-CO")).toEqual({ theoCap: 0, theoPhone: 4 });
  });
});

describe("[DISC-SP-13] taiStore đọc kết quả từ DiscSubject.result", () => {
  it("select có subjects.result và KHÔNG chọn reportSnapshot", async () => {
    kho.rows = [dong({ downloadTokenHash: "H" })];
    await taiStore.timTheoHashToken("H");
    const chon = kho.chonTai[0]! as { subjects: { select: Record<string, boolean> } };
    expect(chon.subjects.select.result).toBe(true);
    expect(chon).not.toHaveProperty("reportSnapshot");
  });
});
