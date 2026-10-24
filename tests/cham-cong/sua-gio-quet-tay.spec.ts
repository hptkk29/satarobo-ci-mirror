// tests/cham-cong/sua-gio-quet-tay.spec.ts — BỐN CỔNG của `suaGioQuetTayAction`, trên Postgres THẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO PHẢI LÀ CSDL THẬT, KHÔNG PHẢI HÀM THUẦN
//
// Điều đáng vỡ nhất ở đây là lời hứa của GHI ĐÈ (đảo 06/10/2026, chủ dự án chốt): **lượt
// quét gốc GIỮ trong DB — giờ, chiều, nguồn, cờ không đổi — nhưng KHÔNG còn tính công.** Một
// hàm thuần không nhìn thấy điều đó — nó chỉ trả về danh sách dòng SẼ ghi. Chỉ CSDL thật mới
// trả lời được "sau lượt sửa, dòng cũ còn không, đã bị đánh dấu chưa, và engine có còn đọc nó
// không" (luật 9).
//
// ~~Lời hứa cũ: "dòng quét gốc BẤT BIẾN — sửa giờ chỉ GHI THÊM"~~ — đảo 06/10/2026: ghi thêm
// hai mốc lên một ngày đã có bốn lượt thì engine ghép cặp trên cả sáu, người sửa không đoán
// được kết quả.
//
// Phần dựng dòng (thuần) đã có 25 ca ở `lib/cham-cong/sua-gio-quet.test.ts`. Bộ này kiểm
// bốn CỔNG và hệ quả trên DB, không lặp lại phần kia.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO MOCK `auth` / `checkPermission` / `resolveActor`
//
// Ba thứ đó là hạ tầng của Next + RBAC, không phải thứ bộ này canh. Mock chúng để ĐIỀU
// KHIỂN chính xác từng cổng — muốn kiểm "vai không có adjust bị từ chối" thì phải bật/tắt
// được đúng một quyền. Mọi thứ còn lại (`scopedDb`, `writeAudit`, engine, Prisma) đều THẬT.
//
// ⚠️ `resolveActor` mock trả actor SUPER_ADMIN để `scopedDb` không lọc — nếu không, mỗi ca
// test phải seed đủ cây OrgUnit + RoleDef + UserOrgRole, và khi đó bộ này lại đang kiểm
// RBAC chứ không kiểm bốn cổng.
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal =
  laDbCucBo(DB_URL) && laTenDbTest(DB_URL) /* từ chối cả tunnel VPS (CONG_TUNNEL_VPS) */;
const d = isLocal ? describe : describe.skip;
if (!isLocal) {
  console.warn("[cham-cong/sua-gio-quet-tay] SKIP: DATABASE_URL không trỏ Postgres local");
}

const TAG = "cc-suagio";
const QL_ID = "cc-suagio-quanly";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const NGAY = utc(2026, 9, 9);

/** Bảng quyền bật/tắt được cho từng ca test. */
const quyen = { adjust: true, closePeriod: false };

vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: QL_ID, name: "Quản lý test" } }),
}));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: async (action: string) =>
    action === "hr_attendance:adjust"
      ? quyen.adjust
      : action === "hr_attendance:close-period"
        ? quyen.closePeriod
        : false,
}));
vi.mock("@/lib/auth/actor", () => ({
  resolveActor: async () => ({
    userId: QL_ID,
    isSuperAdmin: true,
    isHoLevel: true,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    guardianStudentIds: new Set<string>(),
    centerScope: "ALL",
  }),
}));
// ⚠️ Mock TỪNG PHẦN: `next/cache` còn được `lib/cache/safe-cache.ts` dùng cho
// `unstable_cache`. Thay cả module là chuỗi nhập chết ở một chỗ chẳng liên quan gì
// tới bộ này, và thông báo lỗi không chỉ về đây.
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: () => undefined,
}));

d("suaGioQuetTayAction — bốn cổng + lời hứa ghi đè (lượt gốc giữ, thôi tính)", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let cs1 = "";
  let nv = "";
  let tpl = "";
  let goc = ""; // id dòng quét GỐC
  let cs2 = "";
  let gocCs2 = ""; // dòng quét gốc ở CƠ SỞ KHÁC — ghi đè phải thấy cả nó
  let action: typeof import("../../app/(admin)/admin/cham-cong/_actions");

  async function donDep() {
    const us = await db.user.findMany({
      where: { email: { endsWith: `@${TAG}.test` } },
      select: { id: true },
    });
    const ids = [...us.map((u) => u.id), QL_ID];
    await db.auditLog.deleteMany({ where: { entityId: { startsWith: `${ids[0] ?? "x"}:` } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: { in: [cs1, cs2].filter(Boolean) } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.center.deleteMany({ where: { code: { in: [`${TAG}-CS1`, `${TAG}-CS2`] } } });
    await db.shiftTemplate.deleteMany({ where: { code: `${TAG}-HC` } });
  }

  beforeAll(async () => {
    await donDep();
    const c = await db.center.create({
      data: { code: `${TAG}-CS1`, name: "CS1 sửa giờ", slug: `${TAG}-cs1`, address: "x" },
    });
    cs1 = c.id;
    cs2 = (
      await db.center.create({
        data: { code: `${TAG}-CS2`, name: "CS2 sửa giờ", slug: `${TAG}-cs2`, address: "x" },
      })
    ).id;
    const u = await db.user.create({
      data: { email: `nv@${TAG}.test`, name: "Nhân viên", role: "TEACHER" },
    });
    nv = u.id;
    await db.user.create({
      data: { id: QL_ID, email: `ql@${TAG}.test`, name: "Quản lý test", role: "CENTER_MANAGER" },
    });
    const t = await db.shiftTemplate.create({
      data: {
        code: `${TAG}-HC`,
        name: "Hành chính",
        // `ShiftTemplateKind`, KHÔNG phải `kind` của một đoạn trong `segments` — hai enum khác
        // nhau cùng tên trường, và Prisma chỉ báo "Invalid invocation" chứ không nói trúng chỗ.
        kind: "TIMED",
        segments: [{ start: "08:00", end: "17:30", kind: "WORK" }],
        defaultPlace: "ASSIGNED",
        attendanceMode: "REQUIRED",
        dayCredit: 1,
        isLeave: false,
        payMode: "SHIFT",
      },
    });
    tpl = t.id;
    action = await import("../../app/(admin)/admin/cham-cong/_actions");
  });

  afterAll(async () => {
    await donDep();
    await db.$disconnect();
  });

  beforeEach(async () => {
    quyen.adjust = true;
    quyen.closePeriod = false;
    await db.auditLog.deleteMany({ where: { entityId: `${nv}:2026-09-09` } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: nv } });
    await db.staffTimeLog.deleteMany({ where: { userId: nv } });
    await db.attendancePeriod.deleteMany({ where: { centerId: cs1 } });
    await db.shiftAssignment.deleteMany({ where: { userId: nv } });
    await db.shiftAssignment.create({
      data: {
        userId: nv,
        centerId: cs1,
        workDate: NGAY,
        templateId: tpl,
        templateCode: `${TAG}-HC`,
        status: "ACTIVE",
        source: "PATTERN",
        // `ShiftAssignment.segments` là ẢNH CHỤP giờ của ca lúc xếp, không suy từ
        // `templateId` — bắt buộc, và fixture thiếu nó thì mọi ca đỏ ở `beforeEach`.
        segments: [{ start: "08:00", end: "17:30", kind: "WORK" }],
      },
    });
    // Dòng quét GỐC — thứ phải còn nguyên sau mọi lượt sửa.
    const g = await db.staffTimeLog.create({
      data: {
        userId: nv,
        centerId: cs1,
        direction: "CHECK_IN",
        loggedAt: new Date(Date.UTC(2026, 8, 9, 1, 32)), // 08:32 VN
        workDate: NGAY,
        source: "TICKET",
        result: "ACCEPTED",
        flags: ["TRUNG_2_PHUT"],
      },
    });
    goc = g.id;
    // Lượt RA quét ở CS2 — `scopedDb` của quản lý cấp CS1 không thấy nó, nhưng engine vẫn tính
    // nó. Ghi đè mà sót nó là công vẫn ghép theo 12:10, lặng im.
    gocCs2 = (
      await db.staffTimeLog.create({
        data: {
          userId: nv,
          centerId: cs2,
          direction: "CHECK_OUT",
          loggedAt: new Date(Date.UTC(2026, 8, 9, 5, 10)), // 12:10 VN
          workDate: NGAY,
          source: "TICKET",
          result: "ACCEPTED",
        },
      })
    ).id;
  });

  const goiSua = (over: Record<string, unknown> = {}) =>
    action.suaGioQuetTayAction({
      userId: nv,
      workDate: "2026-09-09",
      moc: ["08:00", "17:30"],
      lyDo: "Quầy hỏng sáng 09/09, có mặt đúng giờ",
      ...over,
    });

  const conTinh = () =>
    db.staffTimeLog.findMany({
      where: { userId: nv, workDate: NGAY, result: "ACCEPTED", reviewStatus: { not: "DISMISSED" } },
      orderBy: { loggedAt: "asc" },
    });

  /** "Không có phép ghi nào": vẫn đúng 2 dòng gốc, cả hai CHƯA bị đánh dấu. */
  async function khongGhiGi() {
    const ds = await db.staffTimeLog.findMany({ where: { userId: nv, workDate: NGAY } });
    expect(ds).toHaveLength(2);
    expect(ds.every((x) => x.reviewStatus === "PENDING")).toBe(true);
  }

  // ── LỜI HỨA TRUNG TÂM (đảo 06/10/2026) ─────────────────────────────────────
  it("dòng quét GỐC còn trong DB, giờ/chiều/nguồn/cờ KHÔNG đổi — chỉ bị đánh dấu DISMISSED + ai/khi nào/vì sao", async () => {
    // Ca cũ ở đây khẳng định "dòng gốc không đổi MỘT FIELD NÀO" (chỉ ghi thêm). Chủ dự án chốt
    // 06/10/2026: sửa tay của quản lý là GHI ĐÈ THẬT ⇒ bốn cột duyệt ĐƯỢC đổi; mọi cột còn lại
    // vẫn phải nguyên — đó là thứ giữ được câu "giờ quét thật là gì".
    const truoc = await db.staffTimeLog.findUniqueOrThrow({ where: { id: goc } });
    const r = await goiSua();
    expect(r.ok, `ok=${JSON.stringify(r)}`).toBe(true);

    const sau = await db.staffTimeLog.findUniqueOrThrow({ where: { id: goc } });
    const { reviewStatus, reviewedById, reviewedAt, reviewNote, ...conLai } = sau;
    const { reviewStatus: _a, reviewedById: _b, reviewedAt: _c, reviewNote: _d, ...conLaiTruoc } = truoc;
    expect(conLai).toEqual(conLaiTruoc);
    expect(reviewStatus).toBe("DISMISSED");
    expect(reviewedById).toBe(QL_ID);
    expect(reviewedAt).not.toBeNull();
    expect(reviewNote).toContain("Đã được thay bằng chỉnh tay");
    expect(reviewNote).toContain("Quầy hỏng sáng 09/09");
  });

  it("ghi đè tạo dòng MANUAL_ADJUST mới, và lượt CÒN TÍNH chỉ còn đúng các mốc mới", async () => {
    await goiSua();
    const ds = await db.staffTimeLog.findMany({ where: { userId: nv, workDate: NGAY } });
    expect(ds).toHaveLength(4); // 2 gốc (đã thay) + 2 mốc mới
    const ct = await conTinh();
    expect(ct.map((x) => [x.direction, x.loggedAt.toISOString()])).toEqual([
      ["CHECK_IN", "2026-09-09T01:00:00.000Z"],
      ["CHECK_OUT", "2026-09-09T10:30:00.000Z"],
    ]);
    for (const moi of ct) {
      expect(moi.source).toBe("MANUAL_ADJUST");
      expect(moi.adjustRequestId).toBeNull(); // ← khác đường qua đơn
      expect(moi.flags).toContain("CHINH_TAY");
      expect(moi.reviewStatus).toBe("CONFIRMED");
      expect(moi.reviewedById).toBe(QL_ID);
      expect(moi.reviewNote).toBe("Quầy hỏng sáng 09/09, có mặt đúng giờ");
    }
  });

  it("lượt quét ở CƠ SỞ KHÁC cũng bị thay — ghi đè không đọc qua scope", async () => {
    await goiSua();
    const l = await db.staffTimeLog.findUniqueOrThrow({ where: { id: gocCs2 } });
    expect(l.reviewStatus).toBe("DISMISSED");
  });

  it("ghi đè 4 MỐC ⇒ engine tính công CHỈ từ 4 mốc mới (lượt gốc không vào cặp nào)", async () => {
    const r = await goiSua({ moc: ["08:00", "11:30", "13:30", "17:30"] });
    expect(r.ok, `ok=${JSON.stringify(r)}`).toBe(true);
    // Chốt `now` sau ngày công (luật 19) — không thì ngày bị coi là "chưa diễn ra".
    const { recomputeAttendanceDay } = await import("../../lib/cham-cong/recompute");
    const kq = await recomputeAttendanceDay(nv, NGAY, { now: new Date("2026-09-10T03:00:00Z") });
    expect(kq.ok).toBe(true);

    const moi = await conTinh();
    expect(moi).toHaveLength(4);
    const idMoi = new Set(moi.map((x) => x.id));
    const ngay = await db.staffAttendanceDay.findUniqueOrThrow({
      where: { userId_workDate: { userId: nv, workDate: NGAY } },
    });
    const cap = ngay.pairs as { inId: string | null; outId: string | null }[];
    expect(cap).toHaveLength(2);
    for (const c of cap) {
      expect(idMoi.has(c.inId!)).toBe(true);
      expect(idMoi.has(c.outId!)).toBe(true);
    }
    // 08:00–11:30 (210′) + 13:30–17:30 (240′). Còn tính lượt gốc 08:32/12:10 thì số này lệch.
    expect(ngay.rawPairedMinutes).toBe(450);
  });

  it("ghi đè HAI LẦN ⇒ lần sau thay cả mốc tay của lần trước; lịch sử còn đủ", async () => {
    // Ca cũ: "sửa HAI LẦN ⇒ hai lượt đều được giữ, không lượt nào đè lượt nào". Đảo 06/10/2026:
    // lượt tay cũ cũng bị THAY (DISMISSED), nhưng vẫn còn trong DB kèm ghi chú cũ.
    await goiSua({ moc: ["08:00", "17:30"] });
    await goiSua({ moc: ["08:05", "17:35"], lyDo: "Sửa lại lần hai, gõ nhầm phút" });
    const ds = await db.staffTimeLog.findMany({ where: { userId: nv, workDate: NGAY } });
    expect(ds).toHaveLength(6); // 2 gốc + 2 lần 1 + 2 lần 2
    const ct = await conTinh();
    expect(ct.map((x) => x.loggedAt.toISOString())).toEqual([
      "2026-09-09T01:05:00.000Z",
      "2026-09-09T10:35:00.000Z",
    ]);
    const lan1 = ds.filter((x) => x.source === "MANUAL_ADJUST" && x.reviewStatus === "DISMISSED");
    expect(lan1).toHaveLength(2);
    // Lý do của lần sửa TRƯỚC không bị đè mất.
    expect(lan1.every((x) => x.reviewNote?.includes("trước đó: Quầy hỏng sáng 09/09"))).toBe(true);
  });

  it("ngày được xếp hàng TÍNH LẠI sau khi sửa", async () => {
    await goiSua();
    const ev = await db.domainEvent.findMany({
      where: { dedupeKey: { startsWith: "attday:" } },
      select: { dedupeKey: true },
    });
    expect(ev.some((e) => e.dedupeKey?.includes(nv))).toBe(true);
  });

  // ── CỔNG 2: lý do + mốc ─────────────────────────────────────────────────────
  it.each([
    ["rỗng", ""],
    ["khoảng trắng", "     "],
    ["quá ngắn", "vì"],
  ])("CỔNG lý do — %s ⇒ từ chối, KHÔNG ghi gì", async (_ten, lyDo) => {
    const r = await goiSua({ lyDo });
    expect(r.ok).toBe(false);
    await khongGhiGi();
  });

  it("không mốc giờ nào ⇒ từ chối", async () => {
    const r = await goiSua({ moc: [null, ""] });
    expect(r.ok).toBe(false);
    await khongGhiGi();
  });

  it("mốc sai thứ tự / bỏ trống ô giữa ⇒ từ chối, KHÔNG ghi gì", async () => {
    expect((await goiSua({ moc: ["17:30", "08:00"] })).ok).toBe(false);
    expect((await goiSua({ moc: ["08:00", null, "13:30", "17:30"] })).ok).toBe(false);
    await khongGhiGi();
  });

  // ── CỔNG 1: quyền ───────────────────────────────────────────────────────────
  it("CỔNG quyền — vai KHÔNG có hr_attendance:adjust ⇒ từ chối, không ghi gì", async () => {
    quyen.adjust = false;
    const r = await goiSua();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Không có quyền");
    await khongGhiGi();
  });

  // ── CỔNG 3: kỳ đã chốt ──────────────────────────────────────────────────────
  async function chotKy() {
    await db.attendancePeriod.create({
      data: { centerId: cs1, periodKey: "2026-09", status: "LOCKED" },
    });
  }

  it("CỔNG kỳ đã chốt — từ chối, và KHÔNG có phép ghi nào (lượt gốc chưa bị đánh dấu)", async () => {
    // Hàng đợi tính lại của các ca trước — dọn để đếm được "lượt này không xếp hàng gì".
    await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `attday:${nv}:` } } });
    await chotKy();
    const r = await goiSua();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("CHỐT SỔ");
    await khongGhiGi();
    expect(
      await db.domainEvent.count({ where: { dedupeKey: { startsWith: `attday:${nv}:` } } }),
    ).toBe(0);
  });

  it("xin vượt mà KHÔNG phải cấp Hội sở ⇒ vẫn từ chối, không ghi gì", async () => {
    await chotKy();
    quyen.closePeriod = false;
    const r = await goiSua({ boQuaKyDaChot: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Hội sở");
    await khongGhiGi();
  });

  it("đường vượt HỘI SỞ ⇒ cho qua, và AUDIT ghi rõ cờ vượt", async () => {
    await chotKy();
    quyen.closePeriod = true;
    const r = await goiSua({ boQuaKyDaChot: true });
    expect(r.ok, `ok=${JSON.stringify(r)}`).toBe(true);
    expect(await db.staffTimeLog.count({ where: { userId: nv, workDate: NGAY } })).toBe(4);

    const a = await db.auditLog.findFirstOrThrow({
      where: { entityId: `${nv}:2026-09-09`, action: "MANUAL_TIME_ADJUST" },
      orderBy: { createdAt: "desc" },
    });
    expect((a.newValues as Record<string, unknown>).boQuaKyDaChot).toBe(true);
  });

  // ── CỔNG 4: audit before/after ──────────────────────────────────────────────
  it("CỔNG audit — before = danh sách lượt bị THAY (cả cơ sở khác), after = mốc mới, kèm lý do", async () => {
    await goiSua();
    const a = await db.auditLog.findFirstOrThrow({
      where: { entityId: `${nv}:2026-09-09`, action: "MANUAL_TIME_ADJUST" },
    });
    expect(a.module).toBe("hr_attendance");
    expect(a.entityType).toBe("StaffTimeLog");
    expect(a.actorId).toBe(QL_ID);
    expect(a.reason).toBe("Quầy hỏng sáng 09/09, có mặt đúng giờ");

    const cu = (a.oldValues as { luotQuetDangCo: { id: string; luc: string; nguon: string }[] })
      .luotQuetDangCo;
    // "Before" phải chụp TRƯỚC khi đánh dấu/ghi — nếu không nó chụp luôn dòng mình vừa tạo.
    expect(cu.map((x) => x.id).sort()).toEqual([goc, gocCs2].sort());
    expect(cu.find((x) => x.id === goc)?.luc).toBe("2026-09-09T01:32:00.000Z");
    expect(cu.find((x) => x.id === goc)?.nguon).toBe("TICKET");

    const nv2 = a.newValues as { mocMoi: unknown[]; canCu: string; cheDo: string; soLuotBiThay: number };
    expect(nv2.mocMoi).toHaveLength(2);
    expect(nv2.cheDo).toBe("GHI_DE");
    expect(nv2.soLuotBiThay).toBe(2);
    expect(nv2.canCu).toBe("SUA_TAY_KHONG_DON");
  });

  // ── biên ────────────────────────────────────────────────────────────────────
  it("ngày KHÔNG có ca xếp và chưa tính ⇒ từ chối, không đoán bừa cơ sở", async () => {
    await db.shiftAssignment.deleteMany({ where: { userId: nv } });
    const r = await goiSua({ workDate: "2026-09-10" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("cơ sở chịu công");
  });
});
