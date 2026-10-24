// tests/hoc-bu/lich-lop.test.ts — T03: lịch lớp → `ClassSession` trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
//
// Mỗi ca là MỘT lỗ T03 bịt (số đo ở bản khảo sát 07/10/2026):
//   · sinh buổi KHÔNG idempotent: `count()` rồi `createMany` không khoá ⇒ bấm hai lần/hai tab sinh GẤP ĐÔI
//   · dời hàng loạt cuốn chiếu (buổi i nhận ngày của buổi i+1) VỠ NGAY khi có chỉ mục duy nhất, không cần đua
//   · kế hoạch tính ngoài giao dịch rồi ghi theo id, không kiểm ngày cũ ⇒ đè mất lượt xen giữa
//   · buổi do người đặt tay không có dấu ⇒ lần áp lịch sau dời nó như buổi thường
//
// Hai tầng hàng rào được thử RIÊNG: có chỉ mục (hàng rào cuối) và KHÔNG có chỉ mục (prod có thể chưa tạo được nó vì
// dữ liệu còn trùng) — khoá + kiểm trong khoá phải tự đứng được.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { generateClassSessions } from "@/lib/classes/generate";
import {
  LoiLichLop,
  TEN_CHI_MUC_BUOI,
  dauSuaTay,
  dichLoiTrungBuoi,
  dichNgayBuoi,
  themBuoi,
  themNhieuBuoi,
} from "@/lib/classes/buoi-ghi";
import { apDungDonBuoiTrung, docNhomBuoiTrung, taoChiMucBuoi } from "@/lib/classes/buoi-trung-db";

if (!RUN_DB_TESTS) console.warn(`[LL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t03-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const LOP = id("lop");
const LOP2 = id("lop2");
const GV = id("gv");

/** Thứ ba 3/11/2026 18:00 giờ VN = 11:00 UTC. Lịch T3+T5, 6 buổi. */
const GIO_UTC = "T11:00:00.000Z";
const ngay = (y: number, m: number, d: number) => new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}${GIO_UTC}`);
const SO_BUOI = 6;
const LICH = [ngay(2026, 11, 3), ngay(2026, 11, 5), ngay(2026, 11, 10), ngay(2026, 11, 12), ngay(2026, 11, 17), ngay(2026, 11, 19)];

async function don() {
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.user.deleteMany({ where: { id: GV } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung(opts: { khongSinh?: boolean } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở T03", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: GV, name: "GV T03", email: `${GV}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá T03", slug: `${T}khoa`, totalSessions: SO_BUOI, price: 6_000_000 } });
  const lop = (lid: string, ten: string) => ({
    id: lid,
    name: ten,
    courseId: KHOA,
    centerId: CS,
    status: "ACTIVE" as const,
    scheduleDays: [2, 4],
    startTime: "18:00",
    endTime: "19:30",
    startDate: new Date("2026-11-03T00:00:00.000Z"),
  });
  await db.class.create({ data: lop(LOP, "Lớp T03") });
  await db.class.create({ data: lop(LOP2, "Lớp T03 phụ") });
  if (!opts.khongSinh) {
    await db.classSession.createMany({
      data: LICH.map((date) => ({ classId: LOP, date, centerId: CS })),
    });
  }
}

const tatChiMuc = () => db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${TEN_CHI_MUC_BUOI}"`);
const batChiMuc = () =>
  db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "${TEN_CHI_MUC_BUOI}" ON "ClassSession" ("classId", "date") WHERE "status" <> 'CANCELLED'`,
  );
const coChiMuc = async () =>
  Number((await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint n FROM pg_indexes WHERE indexname = ${TEN_CHI_MUC_BUOI}`)[0]!.n) === 1;

/** Số NHÓM (lớp, thời điểm) có ≥2 buổi còn sống của lớp fixture — đúng vị từ của TV-23 và của chỉ mục. */
async function soNhomTrung(lop = LOP) {
  const r = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint n FROM (
      SELECT 1 FROM "ClassSession" WHERE "classId" = ${lop} AND "status" <> 'CANCELLED'
      GROUP BY "date" HAVING COUNT(*) > 1
    ) t`;
  return Number(r[0]!.n);
}
const cacNgay = async (lop = LOP) =>
  (await db.classSession.findMany({ where: { classId: lop, status: { not: "CANCELLED" } }, orderBy: { date: "asc" }, select: { date: true } })).map((s) => s.date.getTime());
const lyDo = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiLichLop ? `${e.ma}` : `LOI-KHAC: ${String(e)}`;
  }
};
const hien = (ds: Date[]) => ds.map((d) => d.getTime());

describe.skipIf(!RUN_DB_TESTS)("[LL] lịch lớp → ClassSession — T03", () => {
  beforeEach(async () => {
    // Dọn TRƯỚC khi bật chỉ mục: ca trước có thể để lại buổi trùng (đúng thứ nó đang chứng minh) và CREATE UNIQUE INDEX
    // sẽ nổ trên chúng, kéo mọi ca sau đỏ theo. Mọi ca bắt đầu với chỉ mục BẬT; ca cần tắt tự tắt rồi `finally` bật lại.
    await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP2] } } });
    await batChiMuc();
  });
  afterAll(async () => {
    await don();
    await batChiMuc();
  });

  it("[LL-00] đối chứng: migration T03 đã chạy — cột manualOverride mặc định false + chỉ mục từng phần có mặt", async () => {
    await dung();
    expect(await coChiMuc()).toBe(true);
    const r = await db.classSession.findFirstOrThrow({ where: { classId: LOP } });
    expect(r.manualOverride).toBe(false);
    expect(r.manualOverrideAt).toBeNull();
    expect(r.manualOverrideById).toBeNull();
    expect(await soNhomTrung()).toBe(0);
  });

  // ── chỉ mục ────────────────────────────────────────────────────────────────────────────
  it("[LL-01] chỉ mục chặn hai buổi SỐNG cùng giờ; buổi ĐÃ HUỶ không chặn; P2002 được dịch theo TÊN chỉ mục", async () => {
    await dung({ khongSinh: true });
    await db.classSession.create({ data: { classId: LOP, date: LICH[0]!, centerId: CS } });
    let loi: unknown = null;
    try {
      await db.classSession.create({ data: { classId: LOP, date: LICH[0]!, centerId: CS } });
    } catch (e) {
      loi = e;
    }
    expect(loi, "chỉ mục phải chặn buổi trùng").toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((loi as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    const dich = dichLoiTrungBuoi(loi);
    expect(dich?.ma).toBe("TRUNG_BUOI");
    // Buổi huỷ cùng giờ thì được (sinh lại đúng giờ buổi đã huỷ là hợp lệ).
    await db.classSession.create({ data: { classId: LOP, date: LICH[0]!, centerId: CS, status: "CANCELLED" } });
    // Lớp khác cùng giờ thì được.
    await db.classSession.create({ data: { classId: LOP2, date: LICH[0]!, centerId: CS } });
    // Lỗi lạ KHÔNG bị nuốt thành "trùng buổi".
    expect(dichLoiTrungBuoi(new Error("khác"))).toBeNull();
  });

  // ── sinh buổi idempotent ───────────────────────────────────────────────────────────────
  it("[LL-02] sinh buổi hai lần liên tiếp: lần hai không sinh gì; không trùng", async () => {
    await dung({ khongSinh: true });
    const a = await generateClassSessions(LOP);
    expect(a.ok).toBe(true);
    expect(a.generated).toBe(SO_BUOI);
    const b = await generateClassSessions(LOP);
    expect(b).toMatchObject({ ok: true, generated: 0 });
    expect((await cacNgay()).length).toBe(SO_BUOI);
    expect(await soNhomTrung()).toBe(0);
  });

  it("[LL-03] sinh buổi ĐỒNG THỜI 4 lượt (có chỉ mục): đúng MỘT lượt sinh đủ, còn lại 0; không lượt nào ném lỗi", async () => {
    await dung({ khongSinh: true });
    const kq = await Promise.allSettled([1, 2, 3, 4].map(() => generateClassSessions(LOP)));
    const loi = kq.filter((k) => k.status === "rejected");
    expect(loi.map((l) => String((l as PromiseRejectedResult).reason))).toEqual([]);
    const so = kq.map((k) => (k as PromiseFulfilledResult<{ generated: number }>).value.generated).sort();
    expect(so).toEqual([0, 0, 0, SO_BUOI]);
    expect((await cacNgay()).length).toBe(SO_BUOI);
    expect(await soNhomTrung()).toBe(0);
  }, 60_000);

  it("[LL-04] KHÔNG có chỉ mục (prod có thể chưa tạo được): khoá + kiểm trong khoá vẫn đủ — 4 lượt song song vẫn đúng 6 buổi", async () => {
    await dung({ khongSinh: true });
    await tatChiMuc();
    try {
      expect(await coChiMuc()).toBe(false);
      const kq = await Promise.allSettled([1, 2, 3, 4].map(() => generateClassSessions(LOP)));
      expect(kq.filter((k) => k.status === "rejected").length).toBe(0);
      expect((await cacNgay()).length).toBe(SO_BUOI);
      expect(await soNhomTrung()).toBe(0);
    } finally {
      await batChiMuc();
    }
  }, 60_000);

  it("[LL-05] `themNhieuBuoi` chỉ-khi-rỗng=false: chèn ĐÚNG những giờ còn thiếu; buổi huỷ không chặn sinh lại giờ đó", async () => {
    await dung({ khongSinh: true });
    await db.classSession.createMany({
      data: [
        { classId: LOP, date: LICH[0]!, centerId: CS },
        { classId: LOP, date: LICH[1]!, centerId: CS },
        { classId: LOP, date: LICH[2]!, centerId: CS, status: "CANCELLED" },
      ],
    });
    const r = await db.$transaction((tx) =>
      themNhieuBuoi(tx, { classId: LOP, chiKhiRong: false, data: LICH.map((date) => ({ classId: LOP, date, centerId: CS })) }),
    );
    expect(r).toMatchObject({ generated: 4, skipped: 2, daCoBuoi: true });
    expect(await soNhomTrung()).toBe(0);
    expect((await cacNgay()).length).toBe(SO_BUOI); // 2 cũ + 4 mới; buổi huỷ không tính
    // Chỉ-khi-rỗng=true trên lớp ĐÃ có buổi (kể cả chỉ có buổi huỷ) ⇒ không sinh gì.
    const r2 = await db.$transaction((tx) =>
      themNhieuBuoi(tx, { classId: LOP, chiKhiRong: true, data: LICH.map((date) => ({ classId: LOP, date, centerId: CS })) }),
    );
    expect(r2.generated).toBe(0);
  });

  // ── dời hàng loạt ──────────────────────────────────────────────────────────────────────
  const DICH_TIEN = () => {
    // 3/11 giữ; còn lại mỗi buổi nhận ngày của buổi kế, buổi cuối sang 24/11.
    const moi = [LICH[0]!, LICH[2]!, LICH[3]!, LICH[4]!, LICH[5]!, ngay(2026, 11, 24)];
    return LICH.map((oldDate, i) => ({ oldDate, newDate: moi[i]! })).slice(1);
  };
  async function layMoves(lop = LOP, dsDich = DICH_TIEN()) {
    const bs = await db.classSession.findMany({ where: { classId: lop, status: { not: "CANCELLED" } }, orderBy: { date: "asc" }, select: { id: true, date: true } });
    return dsDich.map((d) => {
      const b = bs.find((x) => x.date.getTime() === d.oldDate.getTime())!;
      return { id: b.id, oldDate: d.oldDate, newDate: d.newDate };
    });
  }

  it("[LL-06] đối chứng: dời cuốn chiếu bằng vòng UPDATE ngây thơ (cách CŨ) VỠ với chỉ mục — đó là lý do `dichNgayBuoi` tồn tại", async () => {
    await dung();
    const moves = await layMoves();
    let loi: unknown = null;
    try {
      await db.$transaction(async (tx) => {
        for (const m of moves) await tx.classSession.update({ where: { id: m.id }, data: { date: m.newDate } }); // tăng dần
      });
    } catch (e) {
      loi = e;
    }
    expect(loi, "vòng ngây thơ phải nổ — nếu không thì ca này không chứng minh được gì").not.toBeNull();
    expect(dichLoiTrungBuoi(loi)?.ma).toBe("TRUNG_BUOI");
    expect(hien(LICH)).toEqual(await cacNgay()); // rollback: không đổi gì
  });

  it("[LL-07] `dichNgayBuoi` cuốn chiếu tiến: không vỡ, đủ ngày mới, không bước đỗ", async () => {
    await dung();
    const moves = await layMoves();
    const r = await db.$transaction((tx) => dichNgayBuoi(tx, { classId: LOP, moves, xoaSuaTay: false }));
    expect(r).toEqual({ daDoi: 5, soBuocDo: 0 });
    expect(await cacNgay()).toEqual([LICH[0]!, LICH[2]!, LICH[3]!, LICH[4]!, LICH[5]!, ngay(2026, 11, 24)].map((d) => d.getTime()));
    expect(await soNhomTrung()).toBe(0);
  });

  it("[LL-08] hai buổi ĐỔI CHỖ cho nhau (vòng): xong, đúng đích, đúng một bước đỗ", async () => {
    await dung();
    const bs = await db.classSession.findMany({ where: { classId: LOP }, orderBy: { date: "asc" }, select: { id: true, date: true } });
    const [b0, b1] = [bs[0]!, bs[1]!];
    const r = await db.$transaction((tx) =>
      dichNgayBuoi(tx, {
        classId: LOP,
        xoaSuaTay: false,
        moves: [
          { id: b0.id, oldDate: b0.date, newDate: b1.date },
          { id: b1.id, oldDate: b1.date, newDate: b0.date },
        ],
      }),
    );
    expect(r.soBuocDo).toBe(1);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: b0.id } })).date.getTime()).toBe(b1.date.getTime());
    expect((await db.classSession.findUniqueOrThrow({ where: { id: b1.id } })).date.getTime()).toBe(b0.date.getTime());
    expect(await soNhomTrung()).toBe(0);
  });

  it("[LL-09] kế hoạch CŨ (buổi đã bị sửa giữa chừng): từ chối `BUOI_DA_DOI`, KHÔNG ghi nửa chừng", async () => {
    await dung();
    const moves = await layMoves();
    // Ai đó dời buổi thứ 3 sang một ngày khác sau khi kế hoạch được tính.
    await db.classSession.update({ where: { id: moves[2]!.id }, data: { date: ngay(2026, 12, 1) } });
    const truoc = await cacNgay();
    expect(await lyDo(db.$transaction((tx) => dichNgayBuoi(tx, { classId: LOP, moves, xoaSuaTay: false })))).toBe("BUOI_DA_DOI");
    expect(await cacNgay()).toEqual(truoc);
  });

  it("[LL-10] buổi đã HOÀN TẤT giữa chừng cũng làm kế hoạch cũ: `BUOI_DA_DOI`", async () => {
    await dung();
    const moves = await layMoves();
    await db.classSession.update({ where: { id: moves[1]!.id }, data: { status: "COMPLETED" } });
    expect(await lyDo(db.$transaction((tx) => dichNgayBuoi(tx, { classId: LOP, moves, xoaSuaTay: false })))).toBe("BUOI_DA_DOI");
  });

  it("[LL-11] dời vào ngày đang có buổi KHÁC của lớp (không nằm trong lô): `TRUNG_BUOI`, không đổi gì", async () => {
    await dung();
    const bs = await db.classSession.findMany({ where: { classId: LOP }, orderBy: { date: "asc" }, select: { id: true, date: true } });
    const truoc = await cacNgay();
    expect(
      await lyDo(
        db.$transaction((tx) =>
          dichNgayBuoi(tx, { classId: LOP, xoaSuaTay: false, moves: [{ id: bs[0]!.id, oldDate: bs[0]!.date, newDate: bs[3]!.date }] }),
        ),
      ),
    ).toBe("TRUNG_BUOI");
    expect(await cacNgay()).toEqual(truoc);
  });

  it("[LL-12] `xoaSuaTay`: true gỡ dấu chỉnh tay của buổi vừa dời; false giữ nguyên dấu", async () => {
    await dung();
    const bs = await db.classSession.findMany({ where: { classId: LOP }, orderBy: { date: "asc" }, select: { id: true, date: true } });
    const dau = dauSuaTay(GV, new Date("2026-10-07T03:00:00.000Z"));
    await db.classSession.updateMany({ where: { id: { in: [bs[4]!.id, bs[5]!.id] } }, data: dau });
    const doiMot = (b: (typeof bs)[number], den: Date, xoa: boolean) =>
      db.$transaction((tx) => dichNgayBuoi(tx, { classId: LOP, xoaSuaTay: xoa, moves: [{ id: b.id, oldDate: b.date, newDate: den }] }));
    await doiMot(bs[4]!, ngay(2026, 11, 26), false);
    await doiMot(bs[5]!, ngay(2026, 11, 28), true);
    const a = await db.classSession.findUniqueOrThrow({ where: { id: bs[4]!.id } });
    const b = await db.classSession.findUniqueOrThrow({ where: { id: bs[5]!.id } });
    expect(a.manualOverride).toBe(true);
    expect(a.manualOverrideById).toBe(GV);
    expect(b.manualOverride).toBe(false);
    expect(b.manualOverrideAt).toBeNull();
    expect(b.manualOverrideById).toBeNull();
  });

  it("[LL-13] hai lượt dời ĐỒNG THỜI cùng một kế hoạch: đúng MỘT thắng, lượt kia `BUOI_DA_DOI`; kết quả nhất quán", async () => {
    await dung();
    const moves = await layMoves();
    const kq = await Promise.allSettled([1, 2].map(() => db.$transaction((tx) => dichNgayBuoi(tx, { classId: LOP, moves, xoaSuaTay: false }), { timeout: 30_000 })));
    const ok = kq.filter((k) => k.status === "fulfilled").length;
    const loi = kq.filter((k) => k.status === "rejected").map((k) => ((k as PromiseRejectedResult).reason as LoiLichLop).ma);
    expect(ok).toBe(1);
    expect(loi).toEqual(["BUOI_DA_DOI"]);
    expect(await cacNgay()).toEqual([LICH[0]!, LICH[2]!, LICH[3]!, LICH[4]!, LICH[5]!, ngay(2026, 11, 24)].map((d) => d.getTime()));
  }, 60_000);

  it("[LL-19] `chiKhiRong`: lớp ĐÃ có một phần buổi ⇒ true thì KHÔNG sinh thêm gì, false thì chỉ chèn đúng phần còn thiếu", async () => {
    await dung({ khongSinh: true });
    await db.classSession.createMany({
      data: [LICH[0]!, LICH[1]!].map((date) => ({ classId: LOP, date, centerId: CS })),
    });
    const lo = LICH.map((date) => ({ classId: LOP, date, centerId: CS }));
    const rong = await db.$transaction((tx) => themNhieuBuoi(tx, { classId: LOP, chiKhiRong: true, data: lo }));
    expect(rong).toMatchObject({ generated: 0, daCoBuoi: true });
    expect((await cacNgay()).length).toBe(2);
    const dien = await db.$transaction((tx) => themNhieuBuoi(tx, { classId: LOP, chiKhiRong: false, data: lo }));
    expect(dien).toMatchObject({ generated: 4, skipped: 2 });
    expect((await cacNgay()).length).toBe(SO_BUOI);
  });

  // ── dọn buổi trùng + tạo chỉ mục ───────────────────────────────────────────────────────
  /** Dựng hình dạng PROD hôm nay: chỉ mục chưa có vì dữ liệu còn trùng. Ba nhóm: tự sửa (trống/trống), tự sửa (một bên có dữ liệu), xem tay. */
  async function dungTrung() {
    await dung({ khongSinh: true });
    await tatChiMuc();
    const mk = (idb: string, date: Date, extra: Record<string, unknown> = {}) =>
      db.classSession.create({ data: { id: id(idb), classId: LOP, date, centerId: CS, ...extra } });
    await mk("t1a", LICH[0]!, { createdAt: new Date("2026-09-01T00:00:00Z") });
    await mk("t1b", LICH[0]!, { createdAt: new Date("2026-09-02T00:00:00Z") });
    await mk("t2a", LICH[1]!, { createdAt: new Date("2026-09-01T00:00:00Z") });
    await mk("t2b", LICH[1]!, { createdAt: new Date("2026-09-05T00:00:00Z"), status: "COMPLETED" });
    await mk("t3a", LICH[2]!);
    await mk("t3b", LICH[2]!);
    await mk("ok", LICH[3]!);
  }

  it("[LL-16] đọc nhóm trùng: ba nhóm, phân loại đúng; buổi KHÔNG trùng không có mặt; buổi của lớp đã XOÁ MỀM vẫn bị thấy", async () => {
    await dungTrung();
    // t3a/t3b cùng mang dữ liệu: cho cả hai trạng thái IN_PROGRESS (công dạy tính theo trạng thái — đủ để là 'mang dữ liệu').
    await db.$executeRaw`UPDATE "ClassSession" SET "status" = 'IN_PROGRESS' WHERE "id" IN (${id("t3a")}, ${id("t3b")})`;
    const nhom = await db.$transaction((tx) => docNhomBuoiTrung(tx));
    const cua = nhom.filter((n) => n.classId === LOP);
    expect(cua.length).toBe(3);
    const theoNgay = (d: Date) => cua.find((n) => n.luc.getTime() === d.getTime())!;
    expect(theoNgay(LICH[0]!).phanLoai).toMatchObject({ loai: "TU_SUA", giu: id("t1a"), huy: [id("t1b")], lyDoGiu: "TAO_SOM_NHAT" });
    expect(theoNgay(LICH[1]!).phanLoai).toMatchObject({ loai: "TU_SUA", giu: id("t2b"), huy: [id("t2a")], lyDoGiu: "CO_DU_LIEU" });
    expect(theoNgay(LICH[2]!).phanLoai.loai).toBe("XEM_TAY");
    // Lớp xoá mềm: vị từ của chỉ mục không biết `deletedAt` nên nhóm vẫn phải hiện ra (TV-23 cũ bỏ sót đúng chỗ này).
    await db.class.update({ where: { id: LOP }, data: { deletedAt: new Date("2026-10-01T00:00:00Z") } });
    const sauXoa = (await db.$transaction((tx) => docNhomBuoiTrung(tx))).filter((n) => n.classId === LOP);
    expect(sauXoa.length).toBe(3);
    expect(sauXoa.every((n) => n.lopDaXoa)).toBe(true);
  });

  it("[LL-17] áp dụng với `expect` SAI ⇒ ném và KHÔNG ghi gì (cổng đứng trước phép ghi đầu tiên)", async () => {
    await dungTrung();
    const truoc = await db.classSession.count({ where: { classId: LOP, status: "CANCELLED" } });
    const loi = await db.$transaction((tx) => apDungDonBuoiTrung(tx, { expect: 99 })).then(
      () => null,
      (e: unknown) => String(e),
    );
    expect(loi).toContain("--expect=99");
    expect(await db.classSession.count({ where: { classId: LOP, status: "CANCELLED" } })).toBe(truoc);
  });

  it("[LL-18] áp dụng đúng `expect`: huỷ (KHÔNG xoá) buổi dư của nhóm tự sửa được, nhóm XEM TAY còn nguyên; sau khi xử lý nốt nhóm xem tay thì tạo được chỉ mục", async () => {
    await dungTrung();
    await db.$executeRaw`UPDATE "ClassSession" SET "status" = 'IN_PROGRESS' WHERE "id" IN (${id("t3a")}, ${id("t3b")})`;
    const tong = await db.classSession.count({ where: { classId: LOP } });
    const r = await db.$transaction((tx) => apDungDonBuoiTrung(tx, { expect: 2 }));
    expect(r.nhomTuSua).toBe(2);
    expect(r.daHuy.sort()).toEqual([id("t1b"), id("t2a")].sort());
    expect(r.xemTay.length).toBe(1);
    // Không xoá hàng nào; chỉ đổi trạng thái đúng hai buổi.
    expect(await db.classSession.count({ where: { classId: LOP } })).toBe(tong);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: id("t1b") } })).status).toBe("CANCELLED");
    expect((await db.classSession.findUniqueOrThrow({ where: { id: id("t1a") } })).status).toBe("SCHEDULED");
    expect((await db.classSession.findUniqueOrThrow({ where: { id: id("t2b") } })).status).toBe("COMPLETED");
    for (const x of ["t3a", "t3b"]) expect((await db.classSession.findUniqueOrThrow({ where: { id: id(x) } })).status).toBe("IN_PROGRESS");
    // Còn nhóm xem tay ⇒ KHÔNG tạo chỉ mục.
    expect(await db.$transaction((tx) => taoChiMucBuoi(tx))).toEqual({ daTao: false, conTrung: 1 });
    expect(await coChiMuc()).toBe(false);
    // Người xử lý tay nhóm xem tay (huỷ một bên) rồi tạo chỉ mục.
    await db.classSession.update({ where: { id: id("t3b") }, data: { status: "CANCELLED" } });
    expect(await db.$transaction((tx) => taoChiMucBuoi(tx))).toEqual({ daTao: true, conTrung: 0 });
    expect(await coChiMuc()).toBe(true);
  });

  // ── thêm một buổi ──────────────────────────────────────────────────────────────────────
  it("[LL-14] `themBuoi`: trùng giờ buổi sống ⇒ TRUNG_BUOI; trùng giờ buổi huỷ ⇒ được; buổi tạo tay mang dấu", async () => {
    await dung();
    expect(await lyDo(db.$transaction((tx) => themBuoi(tx, { classId: LOP, date: LICH[0]!, centerId: CS }, null)))).toBe("TRUNG_BUOI");
    const bs = await db.classSession.findFirstOrThrow({ where: { classId: LOP }, orderBy: { date: "asc" } });
    await db.classSession.update({ where: { id: bs.id }, data: { status: "CANCELLED" } });
    const now = new Date("2026-10-07T03:00:00.000Z");
    const moi = await db.$transaction((tx) => themBuoi(tx, { classId: LOP, date: LICH[0]!, centerId: CS }, { actorId: GV, now }));
    const r = await db.classSession.findUniqueOrThrow({ where: { id: moi.id } });
    expect(r).toMatchObject({ manualOverride: true, manualOverrideById: GV });
    expect(r.manualOverrideAt?.getTime()).toBe(now.getTime());
    // Buổi hệ thống sinh: KHÔNG có dấu.
    const sg = await db.$transaction((tx) => themBuoi(tx, { classId: LOP, date: ngay(2026, 12, 8), centerId: CS }, null));
    expect((await db.classSession.findUniqueOrThrow({ where: { id: sg.id } })).manualOverride).toBe(false);
  });

  it("[LL-15] `themBuoi` ĐỒNG THỜI 4 lượt cùng một giờ (KHÔNG có chỉ mục): đúng MỘT buổi được tạo", async () => {
    await dung({ khongSinh: true });
    await tatChiMuc();
    try {
      const kq = await Promise.allSettled(
        [1, 2, 3, 4].map(() => db.$transaction((tx) => themBuoi(tx, { classId: LOP, date: LICH[0]!, centerId: CS }, null), { timeout: 30_000 })),
      );
      expect(kq.filter((k) => k.status === "fulfilled").length).toBe(1);
      expect(kq.filter((k) => k.status === "rejected").every((k) => ((k as PromiseRejectedResult).reason as LoiLichLop).ma === "TRUNG_BUOI")).toBe(true);
      expect(await soNhomTrung()).toBe(0);
    } finally {
      await batChiMuc();
    }
  }, 60_000);
});
