/**
 * [GDC-DB-*] Gỡ ghi danh đã kết thúc để xếp LẠI vào cùng lớp — Postgres THẬT.
 *
 * Test thuần (lib/enrollments/ghi-danh-cu-trong-lop.test.ts) không chạm được hai thứ quyết
 * định ở đây:
 *   · chỉ mục duy nhất từng phần `Enrollment_studentId_classId_active_key … WHERE "deletedAt"
 *     IS NULL` THẬT SỰ chặn dòng thứ hai khi dòng "Đã huỷ" còn sống (đó là gốc sự cố 09/10);
 *   · phép ghi có điều kiện của `goGhiDanhCuDaKetThuc` (lọc theo quan hệ `none`) chạy được
 *     trên Prisma thật và từ chối dòng chưa kết thúc.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, dọn theo tiền tố `GDC_`.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  goGhiDanhCuDaKetThuc,
  GhiDanhCuDaDoiError,
  SELECT_GHI_DANH_CU,
  whereGhiDanhCu,
  xetGhiDanhCu,
} from "../../lib/enrollments/ghi-danh-cu-trong-lop";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "gdc_";

async function don() {
  const hv = await db.student.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  const ids = hv.map((s) => s.id);
  if (ids.length) {
    await db.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await db.student.deleteMany({ where: { id: { in: ids } } });
  }
  await db.class.deleteMany({ where: { name: { startsWith: P } } });
  await db.course.deleteMany({ where: { slug: { startsWith: P } } });
  await db.center.deleteMany({ where: { slug: { startsWith: P } } });
}

async function dung(status: "CANCELLED" | "WITHDREW" | "ACTIVE") {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const center = await db.center.create({ data: { name: `${P}CS`, slug: `${P}cs-${tag}`, address: "x" } });
  const course = await db.course.create({ data: { name: `${P}Sata 6`, slug: `${P}k-${tag}` } });
  const cls = await db.class.create({ data: { name: `${P}lop-${tag}`, courseId: course.id, centerId: center.id } });
  const hv = await db.student.create({ data: { name: `${P}Khang-${tag}`, centerId: center.id } });
  const cu = await db.enrollment.create({
    data: { studentId: hv.id, classId: cls.id, courseId: course.id, centerId: center.id, status },
  });
  return { hv, cls, course, center, cu };
}

describe.skipIf(!RUN)("ghi danh cũ trong lớp — Postgres thật", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[GDC-DB-01] đối chứng: dòng 'Đã huỷ' còn sống ⇒ tạo dòng thứ hai nổ P2002 (đúng gốc sự cố)", async () => {
    const { hv, cls, course, center } = await dung("CANCELLED");
    await expect(
      db.enrollment.create({
        data: { studentId: hv.id, classId: cls.id, courseId: course.id, centerId: center.id, status: "PENDING" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("[GDC-DB-02] dòng 'Đã huỷ' sạch ⇒ xếp loại GO_DUOC, gỡ + tạo lại trong một transaction", async () => {
    const { hv, cls, course, center, cu } = await dung("CANCELLED");
    const x = xetGhiDanhCu(
      await db.enrollment.findFirst({ where: whereGhiDanhCu(hv.id, cls.id), select: SELECT_GHI_DANH_CU }),
    );
    expect(x).toEqual({ loai: "GO_DUOC", id: cu.id, status: "CANCELLED" });

    const moi = await db.$transaction(async (tx) => {
      await goGhiDanhCuDaKetThuc(tx, cu.id, new Date());
      return tx.enrollment.create({
        data: { studentId: hv.id, classId: cls.id, courseId: course.id, centerId: center.id, status: "PENDING" },
      });
    });
    const cuSau = await db.enrollment.findUnique({ where: { id: cu.id }, select: { deletedAt: true, status: true } });
    // Dòng cũ còn nguyên (lịch sử), chỉ bị xoá mềm; dòng mới chiếm chỗ.
    expect(cuSau?.status).toBe("CANCELLED");
    expect(cuSau?.deletedAt).toBeInstanceOf(Date);
    expect(moi.status).toBe("PENDING");
  });

  it("[GDC-DB-03] 'Đã rút' sạch cũng gỡ được", async () => {
    const { cu } = await dung("WITHDREW");
    await db.$transaction((tx) => goGhiDanhCuDaKetThuc(tx, cu.id, new Date()));
    expect((await db.enrollment.findUnique({ where: { id: cu.id } }))?.deletedAt).toBeInstanceOf(Date);
  });

  it("[GDC-DB-04] dòng CÒN SỐNG ⇒ phép ghi có điều kiện đổi 0 dòng ⇒ ném, rollback, dòng không bị xoá", async () => {
    const { cu } = await dung("ACTIVE");
    await expect(
      db.$transaction((tx: Prisma.TransactionClient) => goGhiDanhCuDaKetThuc(tx, cu.id, new Date())),
    ).rejects.toBeInstanceOf(GhiDanhCuDaDoiError);
    expect((await db.enrollment.findUnique({ where: { id: cu.id } }))?.deletedAt).toBeNull();
  });
});
