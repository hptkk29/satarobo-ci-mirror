// tests/hoc-bu/lich-lop-ap-dung.test.ts — T03, phần 2: các ĐƯỜNG GHI thật (không chỉ `buoi-ghi`) trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Phần 1 (`lich-lop.test.ts`) thử từng viên gạch. Phần này thử NHÀ: kế hoạch → phạm vi → khoá → dời, và các đường
// huỷ/đổi/nghỉ chạy chồng nhau. Mỗi ca là một lỗ có số đo trong bản khảo sát 07/10/2026:
//   · xếp lại theo khai giảng cuốn chiếu → vỡ ngay khi có chỉ mục duy nhất (không cần đua)
//   · buổi chỉnh tay / kỳ công đã chốt bị dời như buổi thường
//   · bấm "Huỷ buổi" hai lần sinh hai buổi bù; hai buổi nghỉ cùng lớp sinh hai buổi mới trùng ngày
//   · kế hoạch làm hai buổi trùng giờ mà không ai báo
//
// Giờ: mọi mốc "bây giờ" TRUYỀN VÀO (luật 19) — ngày trong fixture là tuyệt đối (tháng 11/2026) và không ca nào đọc đồng hồ thật.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dauSuaTay } from "@/lib/classes/buoi-ghi";
import { planScheduleApply } from "@/lib/classes/phases-service";
import { resyncClassSessions } from "@/lib/classes/session-sync";
import { LoiNghiBuoi, luiLichLop, nghiBuoiLop } from "@/lib/classes/lui-lich";
import { adjustSession, cancelSession } from "@/lib/classes/adjust";
import type { SchedulePhase } from "@/lib/classes/phases";
import { vnDateAt, vnYmd } from "@/lib/time/vn";

if (!RUN_DB_TESTS) console.warn(`[LLA] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t03b-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const LOP = id("lop");
const GV = id("gv");
const NGUOI = { id: GV, name: "GV T03b" };

const GIO_UTC = "T11:00:00.000Z"; // 18:00 giờ VN
const ngay = (d: number, m = 11) => new Date(`2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}${GIO_UTC}`);
/** Lịch T3+T5 từ 3/11: 3, 5, 10, 12, 17, 19. */
const LICH = [ngay(3), ngay(5), ngay(10), ngay(12), ngay(17), ngay(19)];
const batDau = (y: number, m0: number, d: number) => vnDateAt(y, m0, d, 0, 0);
/** Mốc "bây giờ" cố định: 1/11/2026 09:00 giờ VN — trước mọi buổi của lớp. */
const NOW = vnDateAt(2026, 10, 1, 9, 0);

async function don() {
  const bs = await db.classSession.findMany({ where: { classId: LOP }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { entityType: "ClassSession", entityId: { in: bs.map((b) => b.id) } } });
  await db.classAuditLog.deleteMany({ where: { classId: LOP } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.attendancePeriod.deleteMany({ where: { centerId: CS } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.user.deleteMany({ where: { id: GV } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung(opts: { startDate?: Date } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở T03b", slug: `${T}cs`, address: "211 Nguyễn Hữu Thọ" } });
  await db.user.create({ data: { id: GV, name: "GV T03b", email: `${GV}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá T03b", slug: `${T}khoa`, totalSessions: 6, price: 6_000_000 } });
  await db.class.create({
    data: {
      id: LOP,
      name: "Lớp T03b",
      courseId: KHOA,
      centerId: CS,
      status: "ACTIVE",
      scheduleDays: [2, 4],
      startTime: "18:00",
      endTime: "19:30",
      startDate: opts.startDate ?? new Date("2026-11-03T00:00:00.000Z"),
    },
  });
  await db.classSession.createMany({ data: LICH.map((date) => ({ classId: LOP, date, centerId: CS })) });
}

const tatChiMuc = () => db.$executeRaw`DROP INDEX IF EXISTS "ClassSession_class_date_active_key"`;
const batChiMuc = () =>
  db.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_class_date_active_key" ON "ClassSession" ("classId", "date") WHERE "status" <> 'CANCELLED'`;

const buoiSong = () => db.classSession.findMany({ where: { classId: LOP, status: { not: "CANCELLED" } }, orderBy: { date: "asc" } });
const cacNgay = async () => (await buoiSong()).map((s) => s.date.getTime());
async function soNhomTrung() {
  const r = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint n FROM (SELECT 1 FROM "ClassSession" WHERE "classId" = ${LOP} AND "status" <> 'CANCELLED' GROUP BY "date" HAVING COUNT(*) > 1) t`;
  return Number(r[0]!.n);
}
const idCua = async (ngayCan: Date) => (await db.classSession.findFirstOrThrow({ where: { classId: LOP, date: ngayCan, status: { not: "CANCELLED" } } })).id;

/** Kế hoạch ghi đè: một giai đoạn mở từ 1/11/2026, học T2 + T4 (weekday 1, 3) lúc 18:00. */
const PHASE_T2_T4: SchedulePhase[] = [
  { effectiveFrom: batDau(2026, 10, 1), effectiveTo: null, slots: [{ weekday: 1, startTime: "18:00", endTime: "19:30" }, { weekday: 3, startTime: "18:00", endTime: "19:30" }] },
];
const plan = async (phamVi: Parameters<typeof planScheduleApply>[0]["phamVi"], ghiDe = false, phases: SchedulePhase[] | undefined = PHASE_T2_T4) => {
  const r = await planScheduleApply({ classId: LOP, phamVi, ghiDeSuaTay: ghiDe, now: NOW, phasesOverride: phases });
  return r;
};

describe.skipIf(!RUN_DB_TESTS)("[LLA] đường ghi lịch lớp — T03", () => {
  beforeEach(async () => {
    await dung();
    // Mọi ca bắt đầu với chỉ mục BẬT (một ca trước có thể đã tắt nó rồi chết giữa chừng).
    await batChiMuc();
  });
  afterAll(async () => {
    await don();
    await batChiMuc();
  });

  // ── xếp lại cuốn chiếu ─────────────────────────────────────────────────────────────────
  it("[LLA-01] xếp lại theo khai giảng (cuốn chiếu 3→5, 5→10…) KHÔNG vỡ chỉ mục duy nhất; ngày bế giảng đi theo", async () => {
    await db.class.update({ where: { id: LOP }, data: { startDate: new Date("2026-11-05T00:00:00.000Z") } });
    const r = await resyncClassSessions({ classId: LOP, wholeSeries: true, ghiDeSuaTay: false, actor: NGUOI });
    expect(r).toMatchObject({ ok: true, moved: 6 });
    expect(await cacNgay()).toEqual([ngay(5), ngay(10), ngay(12), ngay(17), ngay(19), ngay(24)].map((d) => d.getTime()));
    expect(await soNhomTrung()).toBe(0);
    const lop = await db.class.findUniqueOrThrow({ where: { id: LOP }, select: { endDate: true } });
    expect(lop.endDate && vnYmd(lop.endDate)).toBe("2026-11-24");
  });

  it("[LLA-02] buổi do NGƯỜI đặt tay đứng giữa dãy: xếp lại BỊ TỪ CHỐI bằng câu nói rõ lý do (không sinh buổi trùng), DB nguyên vẹn", async () => {
    await db.class.update({ where: { id: LOP }, data: { startDate: new Date("2026-11-05T00:00:00.000Z") } });
    await db.classSession.update({ where: { id: await idCua(ngay(10)) }, data: dauSuaTay(GV, NOW) });
    const truoc = await cacNgay();
    const r = await resyncClassSessions({ classId: LOP, wholeSeries: true, ghiDeSuaTay: false, actor: NGUOI });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("trùng giờ");
    expect(await cacNgay()).toEqual(truoc);
  });

  it("[LLA-03] cùng ca [LLA-02] nhưng người có quyền chọn GHI ĐÈ buổi chỉnh tay: dời hết, dấu chỉnh tay của buổi được dời bị gỡ", async () => {
    await db.class.update({ where: { id: LOP }, data: { startDate: new Date("2026-11-05T00:00:00.000Z") } });
    const idTay = await idCua(ngay(10));
    await db.classSession.update({ where: { id: idTay }, data: dauSuaTay(GV, NOW) });
    const r = await resyncClassSessions({ classId: LOP, wholeSeries: true, ghiDeSuaTay: true, actor: NGUOI });
    expect(r).toMatchObject({ ok: true, moved: 6 });
    expect(await cacNgay()).toEqual([ngay(5), ngay(10), ngay(12), ngay(17), ngay(19), ngay(24)].map((d) => d.getTime()));
    const sau = await db.classSession.findUniqueOrThrow({ where: { id: idTay } });
    expect(sau.manualOverride).toBe(false);
    expect(sau.manualOverrideById).toBeNull();
  });

  // ── phạm vi áp lịch ────────────────────────────────────────────────────────────────────
  it("[LLA-04] bốn phạm vi trên CÙNG kế hoạch mới (T2+T4): mỗi phạm vi chỉ dời đúng tập buổi của nó", async () => {
    const [s1, s2, s3, s4, s5, s6] = await Promise.all(LICH.map(idCua));
    const dich = (r: Awaited<ReturnType<typeof plan>>) => {
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      return r.plan.items.filter((i) => i.newDate && i.newDate.getTime() !== i.oldDate.getTime()).map((i) => [i.id, i.newDate!.getTime()]);
    };
    // Từ ngày 10/11: s3..s6 nhận T2/T4 kế tiếp ≥ 10/11 = 11/11, 16/11, 18/11, 23/11.
    const tuNgay = dich(await plan({ loai: "TU_NGAY", ngay: batDau(2026, 10, 10) }));
    expect(tuNgay).toEqual([[s3, ngay(11).getTime()], [s4, ngay(16).getTime()], [s5, ngay(18).getTime()], [s6, ngay(23).getTime()]]);
    // "Buổi này và các buổi sau" chọn s3 ≡ từ ngày 10/11.
    expect(dich(await plan({ loai: "TU_BUOI_NAY", sessionId: s3 }))).toEqual(tuNgay);
    // "Chỉ buổi này": chỉ s3 đổi (11/11 < ngày của buổi khoá kế tiếp 12/11).
    const chiMot = dich(await plan({ loai: "CHI_BUOI_NAY", sessionId: s3 }));
    expect(chiMot).toEqual([[s3, ngay(11).getTime()]]);
    // "Toàn bộ chưa diễn ra" với now = 1/11 (trước mọi buổi): mốc = buổi đầu ⇒ từ 3/11: T2/T4 ≥ 3/11 = 4, 9, 11, 16, 18, 23.
    const toanBo = dich(await plan({ loai: "TOAN_BO_CHUA_DIEN_RA" }));
    expect(toanBo.map(([i]) => i)).toEqual([s1, s2, s3, s4, s5, s6]);
    expect(toanBo.map(([, d]) => d)).toEqual([ngay(4), ngay(9), ngay(11), ngay(16), ngay(18), ngay(23)].map((d) => d.getTime()));
  });

  it("[LLA-05] buổi chỉnh tay: kế hoạch GIỮ nó (lý do 'đã chỉnh tay'); chọn ghi đè thì dời cả nó", async () => {
    const s4 = await idCua(ngay(12));
    await db.classSession.update({ where: { id: s4 }, data: dauSuaTay(GV, NOW) });
    const giu = await plan({ loai: "TU_NGAY", ngay: batDau(2026, 10, 10) });
    expect(giu.ok).toBe(true);
    if (!giu.ok) return;
    const it4 = giu.plan.items.find((i) => i.id === s4)!;
    expect(it4.newDate).toBeNull();
    expect(it4.keepReason).toBe("đã chỉnh tay");
    const de = await plan({ loai: "TU_NGAY", ngay: batDau(2026, 10, 10) }, true);
    expect(de.ok && de.plan.items.find((i) => i.id === s4)!.newDate?.getTime()).toBe(ngay(16).getTime());
  });

  it("[LLA-06] kỳ công đã CHỐT: buổi trong tháng chốt không bị dời; dời VÀO tháng chốt bị từ chối nói rõ kỳ", async () => {
    await db.attendancePeriod.create({ data: { centerId: CS, periodKey: "2026-11", status: "LOCKED" } });
    const tatCa = await plan({ loai: "TU_NGAY", ngay: batDau(2026, 10, 3) });
    expect(tatCa.ok).toBe(false); // mọi buổi đều nằm trong tháng 11 đã chốt
    expect(!tatCa.ok && tatCa.error).toContain("chốt công");
    await db.attendancePeriod.deleteMany({ where: { centerId: CS } });

    await db.attendancePeriod.create({ data: { centerId: CS, periodKey: "2026-12", status: "LOCKED" } });
    // Kế hoạch mới chỉ có hiệu lực từ 1/12 ⇒ buổi sẽ bị đưa vào tháng 12 đã chốt.
    const sangThang12: SchedulePhase[] = [{ effectiveFrom: batDau(2026, 11, 1), effectiveTo: null, slots: [{ weekday: 1, startTime: "18:00", endTime: "19:30" }] }];
    const vao = await plan({ loai: "TU_NGAY", ngay: batDau(2026, 10, 17) }, false, sangThang12);
    expect(vao.ok).toBe(false);
    expect(!vao.ok && vao.error).toContain("2026-12");
    expect(!vao.ok && vao.error).toContain("CHỐT");
  });

  it("[LLA-07] kế hoạch làm hai buổi trùng giờ (buổi khoá đứng giữa dãy) ⇒ báo ở XEM TRƯỚC, không phải đợi tới lúc ghi", async () => {
    // s2 (5/11) vừa nhận ngày 5/11 từ s1 dịch chuyển trong khi s3 (10/11) bị khoá ⇒ s2 không còn chỗ trước s3 và giữ 5/11.
    await db.classSession.update({ where: { id: await idCua(ngay(10)) }, data: dauSuaTay(GV, NOW) });
    const dichKhai: SchedulePhase[] = [{ effectiveFrom: batDau(2026, 10, 5), effectiveTo: null, slots: [{ weekday: 4, startTime: "18:00", endTime: "19:30" }, { weekday: 2, startTime: "18:00", endTime: "19:30" }] }];
    await db.class.update({ where: { id: LOP }, data: { startDate: new Date("2026-11-05T00:00:00.000Z") } });
    const r = await plan({ loai: "TU_NGAY", ngay: batDau(2026, 10, 3) }, false, dichKhai);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("trùng giờ");
  });

  // ── huỷ / đổi / nghỉ ───────────────────────────────────────────────────────────────────
  it("[LLA-08] bấm 'Huỷ buổi' HAI LẦN đồng thời trên một buổi: đúng một lượt thành công, đúng MỘT buổi bù, không trùng", async () => {
    const s2 = await idCua(ngay(5));
    const kq = await Promise.allSettled([1, 2].map(() => cancelSession({ sessionId: s2, reason: "GV ốm", actorId: GV, actorName: "GV" })));
    const ok = kq.filter((k) => k.status === "fulfilled" && (k as PromiseFulfilledResult<{ ok: boolean }>).value.ok);
    expect(ok.length).toBe(1);
    expect((await buoiSong()).length).toBe(6); // 5 gốc còn sống + 1 buổi bù
    expect(await db.classSession.count({ where: { classId: LOP, status: "CANCELLED" } })).toBe(1);
    expect(await soNhomTrung()).toBe(0);
  }, 60_000);

  it("[LLA-09] huỷ HAI buổi KHÁC NHAU song song: hai buổi bù rơi vào hai ngày KHÁC nhau", async () => {
    const [s1, s2] = [await idCua(ngay(3)), await idCua(ngay(5))];
    const kq = await Promise.allSettled([s1, s2].map((sessionId) => cancelSession({ sessionId, reason: "nghỉ", actorId: GV, actorName: "GV" })));
    expect(kq.every((k) => k.status === "fulfilled" && (k as PromiseFulfilledResult<{ ok: boolean }>).value.ok)).toBe(true);
    expect(await soNhomTrung()).toBe(0);
    expect((await buoiSong()).length).toBe(6);
  }, 60_000);

  it("[LLA-10] 'Nghỉ & lùi lịch' HAI buổi khác nhau song song: không bao giờ có hai buổi mới trùng ngày", async () => {
    const [s3, s4] = [await idCua(ngay(10)), await idCua(ngay(12))];
    const kq = await Promise.allSettled([s3, s4].map((sessionId) => nghiBuoiLop({ sessionId, actor: NGUOI, lyDo: "Lớp nghỉ" })));
    const loi = kq.filter((k) => k.status === "rejected").map((k) => (k as PromiseRejectedResult).reason);
    expect(loi.every((e) => e instanceof LoiNghiBuoi), `lỗi lạ: ${loi.map(String).join("; ")}`).toBe(true);
    expect(kq.some((k) => k.status === "fulfilled")).toBe(true);
    expect(await soNhomTrung()).toBe(0);
  }, 60_000);

  it("[LLA-11] `adjustSession`: dời vào giờ đã có buổi ⇒ từ chối; dời sang giờ trống ⇒ được và buổi mang dấu chỉnh tay; đổi phòng thì KHÔNG", async () => {
    const s2 = await idCua(ngay(5));
    const trung = await adjustSession({ sessionId: s2, date: ngay(10), actorId: GV, actorName: "GV" });
    expect(trung.ok).toBe(false);
    expect(trung.error).toContain("đã có một buổi học");
    const truocTay = await db.classSession.findUniqueOrThrow({ where: { id: s2 } });
    expect(truocTay.date.getTime()).toBe(ngay(5).getTime());

    const ok = await adjustSession({ sessionId: s2, date: ngay(6), actorId: GV, actorName: "GV" });
    expect(ok.ok).toBe(true);
    const sau = await db.classSession.findUniqueOrThrow({ where: { id: s2 } });
    expect(sau).toMatchObject({ manualOverride: true, manualOverrideById: GV });
    expect(sau.date.getTime()).toBe(ngay(6).getTime());

    const khac = await idCua(ngay(17));
    const doiPhong = await adjustSession({ sessionId: khac, roomId: null, teacherId: null, actorId: GV, actorName: "GV" });
    expect(doiPhong.ok).toBe(true);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: khac } })).manualOverride).toBe(false);
    expect(await soNhomTrung()).toBe(0);
  });

  it("[LLA-10b] cùng ca [LLA-10] nhưng KHÔNG có chỉ mục (prod chưa tạo được): khoá lớp một mình phải đủ — vẫn không có buổi trùng", async () => {
    await tatChiMuc();
    try {
      const [s3, s4] = [await idCua(ngay(10)), await idCua(ngay(12))];
      const kq = await Promise.allSettled([s3, s4].map((sessionId) => nghiBuoiLop({ sessionId, actor: NGUOI, lyDo: "Lớp nghỉ" })));
      const loi = kq.filter((k) => k.status === "rejected").map((k) => (k as PromiseRejectedResult).reason);
      expect(loi.every((e) => e instanceof LoiNghiBuoi), `lỗi lạ: ${loi.map(String).join("; ")}`).toBe(true);
      expect(await soNhomTrung()).toBe(0);
    } finally {
      // Dọn trước khi bật lại: nếu mã sai để lại buổi trùng thì CREATE UNIQUE INDEX sẽ nổ và che mất lỗi thật.
      await db.classSession.deleteMany({ where: { classId: LOP } });
      await batChiMuc();
    }
  }, 60_000);

  it("[LLA-11b] cùng ca [LLA-11] nhưng KHÔNG có chỉ mục: kiểm trùng giờ ở ỨNG DỤNG phải tự chặn (không dựa vào chỉ mục)", async () => {
    await tatChiMuc();
    try {
      const s2 = await idCua(ngay(5));
      const trung = await adjustSession({ sessionId: s2, date: ngay(10), actorId: GV, actorName: "GV" });
      expect(trung.ok).toBe(false);
      expect(trung.error).toContain("đã có một buổi học");
      expect(await soNhomTrung()).toBe(0);
    } finally {
      await db.classSession.deleteMany({ where: { classId: LOP } });
      await batChiMuc();
    }
  });

  it("[LLA-12] ngày nghỉ trung tâm (`luiLichLop`): dời cả dãy một nhịp không vỡ chỉ mục; buổi chỉnh tay đứng yên; số buổi sống giữ nguyên", async () => {
    const s5 = await idCua(ngay(17));
    await db.classSession.update({ where: { id: s5 }, data: dauSuaTay(GV, NOW) });
    const kq = await luiLichLop({ classId: LOP, ngayNghi: new Set(["2026-11-05"]), actor: NGUOI, lyDo: "Nghỉ lễ", now: NOW });
    expect(kq.loi, kq.loi).toBeUndefined();
    expect(kq.moves.length).toBeGreaterThan(0);
    expect((await buoiSong()).length).toBe(6);
    expect(await soNhomTrung()).toBe(0);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: s5 } })).date.getTime()).toBe(ngay(17).getTime());
    // không còn buổi nào rơi vào ngày nghỉ
    expect((await buoiSong()).map((s) => vnYmd(s.date))).not.toContain("2026-11-05");
  });

  it("[LLA-13] ngày nghỉ rơi vào kỳ công đã CHỐT: lớp giữ nguyên lịch và trả `loi` nêu kỳ — không im lặng", async () => {
    await db.attendancePeriod.create({ data: { centerId: CS, periodKey: "2026-11", status: "LOCKED" } });
    const truoc = await cacNgay();
    const kq = await luiLichLop({ classId: LOP, ngayNghi: new Set(["2026-11-05"]), actor: NGUOI, lyDo: "Nghỉ lễ", now: NOW });
    // Mọi buổi đều trong tháng 11 đã chốt ⇒ khoá hết ⇒ không buổi nào dời được; số buổi bị giữ được báo.
    expect(kq.moves).toEqual([]);
    expect(kq.giuNguyen).toBeGreaterThan(0);
    expect(await cacNgay()).toEqual(truoc);
  });
});
