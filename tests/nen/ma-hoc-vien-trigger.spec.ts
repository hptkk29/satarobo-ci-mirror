// @vitest-environment node
/**
 * MÃ HỌC VIÊN — TRIGGER Ở TẦNG DB, đo trên Postgres thật. [chủ dự án chốt 06/11/2026: "không được bị lại nữa"]
 *
 * Thứ bộ này canh mà test thuần KHÔNG canh được: tầng ứng dụng (`lib/students/ma-hoc-vien-dang.ts`) có thể bị đi vòng bởi SQL tay
 * / script ghi thẳng DB — trigger `Student_studentCode_dang_trg` (migration `20261126090000_student_code_dang_duy_nhat`) là hàng
 * rào cuối. Ca gắt nhất là `[MHV-DB-03]`: đúng mã đã lên prod (`COSONGUYENHUUTHO-26-FD8Q6T`) KHỚP hình dạng nhưng sai tiền tố —
 * CHECK chỉ-hình-dạng sẽ cho qua, nên phải đối chiếu `Center.code`.
 *
 * ⚠️ LUẬT 18 — mỗi ca dựng cơ sở của CHÍNH nó (mã duy nhất theo ca), không mượn trạng thái ca trước.
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `MHVT` ở beforeAll + afterAll. `assertTestDb()` chặn DB ngoài local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { assertTestDb, disconnectDb } from "../e2e/_helpers/seed";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
const P = "MHVT";
const CASE = 30_000;

let n = 0;
/** Cơ sở RIÊNG của ca: mã `MHVT<n>` (chuẩn hoá giữ nguyên), nên tiền tố hợp lệ là `MHVT<n>-`. */
async function dungCoSo(coMa = true) {
  n += 1;
  const code = `${P}${n}`;
  const c = await db.center.create({
    data: { ...(coMa ? { code } : {}), name: `${P} cơ sở ${n}`, slug: `${P.toLowerCase()}-cs-${n}-${Date.now()}`, address: "x" },
    select: { id: true, code: true },
  });
  return { id: c.id, code };
}

const THAN = "AB3K9P";
const loiCuaTrigger = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
};

async function don() {
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.center.deleteMany({ where: { slug: { startsWith: `${P.toLowerCase()}-cs-` } } });
}

describe.skipIf(!RUN)("[MHV-DB] trigger mã học viên — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await don();
  }, 60_000);
  afterAll(async () => {
    await don();
    await disconnectDb();
  }, 60_000);

  it("[MHV-DB-01] đúng dạng + đúng tiền tố cơ sở ⇒ ghi được", async () => {
    const cs = await dungCoSo();
    const s = await db.student.create({ data: { name: `${P} 01`, studentCode: `${cs.code}-26-${THAN}`, centerId: cs.id } });
    expect(s.studentCode).toBe(`${cs.code}-26-${THAN}`);
  }, CASE);

  it("[MHV-DB-02] sai DẠNG (HV-001, dạng cũ CS1.HV.26.001, chữ thường, ký tự cấm O/0/1/I/L, thiếu/thừa ký tự) ⇒ DB từ chối", async () => {
    const cs = await dungCoSo();
    const sai = [`HV-001`, `${cs.code}.HV.26.001`, `${cs.code.toLowerCase()}-26-${THAN}`, `${cs.code}-26-AB3K9O`, `${cs.code}-26-AB3K91`, `${cs.code}-26-AB3K9`, `${cs.code}-26-AB3K9PQ`, `${cs.code}-2026-${THAN}`];
    for (const ma of sai) {
      const loi = await loiCuaTrigger(db.student.create({ data: { name: `${P} 02`, studentCode: ma, centerId: cs.id } }));
      expect(loi, ma).toMatch(/sai dạng/);
    }
    expect(await db.student.count({ where: { name: `${P} 02` } })).toBe(0);
  }, CASE);

  it("[MHV-DB-03] ĐÚNG MÃ ĐÃ LÊN PROD: khớp hình dạng nhưng tiền tố KHÁC mã cơ sở ⇒ DB từ chối", async () => {
    const cs = await dungCoSo();
    for (const ma of [`COSONGUYENHUUTHO-26-FD8Q6T`, `${P}999-26-${THAN}` /* mã của cơ sở khác */]) {
      const loi = await loiCuaTrigger(db.student.create({ data: { name: `${P} 03`, studentCode: ma, centerId: cs.id } }));
      expect(loi, ma).toMatch(new RegExp(`phải bắt đầu bằng mã cơ sở.*${cs.code}-`));
    }
    expect(await db.student.count({ where: { name: `${P} 03` } })).toBe(0);
  }, CASE);

  it("[MHV-DB-04] không đặt mã (null) ⇒ cho qua", async () => {
    const cs = await dungCoSo();
    const s = await db.student.create({ data: { name: `${P} 04`, centerId: cs.id } });
    expect(s.studentCode).toBeNull();
  }, CASE);

  it("[MHV-DB-05] chưa gắn cơ sở ⇒ chỉ kiểm hình dạng: đúng dạng qua, sai dạng bị từ chối", async () => {
    const ok = await db.student.create({ data: { name: `${P} 05`, studentCode: `XYZ-26-${THAN}` } });
    expect(ok.studentCode).toBe(`XYZ-26-${THAN}`);
    const loi = await loiCuaTrigger(db.student.create({ data: { name: `${P} 05b`, studentCode: "HV-001" } }));
    expect(loi).toMatch(/sai dạng/);
  }, CASE);

  it("[MHV-DB-06] cơ sở CHƯA CÓ MÃ ⇒ chỉ kiểm hình dạng (tầng ứng dụng mới là nơi từ chối cơ sở thiếu mã)", async () => {
    const cs = await dungCoSo(false);
    const ok = await db.student.create({ data: { name: `${P} 06`, studentCode: `ABC-26-${THAN}`, centerId: cs.id } });
    expect(ok.studentCode).toBe(`ABC-26-${THAN}`);
    const loi = await loiCuaTrigger(db.student.create({ data: { name: `${P} 06b`, studentCode: "HV-001", centerId: cs.id } }));
    expect(loi).toMatch(/sai dạng/);
  }, CASE);

  it("[MHV-DB-07] ĐỔI mã sang sai tiền tố ⇒ từ chối; đổi sang đúng ⇒ qua (mã cũ giữ nguyên khi bị từ chối)", async () => {
    const cs = await dungCoSo();
    const s = await db.student.create({ data: { name: `${P} 07`, studentCode: `${cs.code}-26-${THAN}`, centerId: cs.id } });
    const loi = await loiCuaTrigger(db.student.update({ where: { id: s.id }, data: { studentCode: `COSOKHAC-26-${THAN}` } }));
    expect(loi).toMatch(/phải bắt đầu bằng mã cơ sở/);
    expect((await db.student.findUniqueOrThrow({ where: { id: s.id } })).studentCode).toBe(`${cs.code}-26-${THAN}`);
    const moi = `${cs.code}-26-${THAN.split("").reverse().join("")}`;
    await db.student.update({ where: { id: s.id }, data: { studentCode: moi } });
    expect((await db.student.findUniqueOrThrow({ where: { id: s.id } })).studentCode).toBe(moi);
  }, CASE);

  it("[MHV-DB-08] học viên mang mã CŨ (dữ liệu có trước trigger) vẫn sửa được ô khác, kể cả gửi lại ĐÚNG mã cũ; đổi sang mã cũ KHÁC thì không", async () => {
    const cs = await dungCoSo();
    // Dựng dòng "có trước trigger": tạm tắt trigger CHỈ để chèn dữ liệu cũ, rồi bật lại ngay.
    await db.$executeRawUnsafe(`ALTER TABLE "Student" DISABLE TRIGGER "Student_studentCode_dang_trg"`);
    let id: string;
    try {
      const cu = await db.student.create({ data: { name: `${P} 08`, studentCode: `${cs.code}.HV.26.001`, centerId: cs.id }, select: { id: true } });
      id = cu.id;
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "Student" ENABLE TRIGGER "Student_studentCode_dang_trg"`);
    }
    await db.student.update({ where: { id }, data: { name: `${P} 08 đã sửa` } });
    await db.student.update({ where: { id }, data: { studentCode: `${cs.code}.HV.26.001`, school: "Trường X" } }); // gửi lại đúng mã cũ
    const loi = await loiCuaTrigger(db.student.update({ where: { id }, data: { studentCode: `${cs.code}.HV.26.002` } }));
    expect(loi).toMatch(/sai dạng/);
  }, CASE);

  it("[MHV-DB-09] upsert theo mã: nhánh update không đụng mã ⇒ qua; nhánh create mang mã sai ⇒ từ chối", async () => {
    const cs = await dungCoSo();
    const ma = `${cs.code}-26-${THAN}`;
    await db.student.create({ data: { name: `${P} 09`, studentCode: ma, centerId: cs.id } });
    await db.student.upsert({ where: { studentCode: ma }, update: { school: "Trường Y" }, create: { name: `${P} 09x`, studentCode: ma, centerId: cs.id } });
    const loi = await loiCuaTrigger(
      db.student.upsert({ where: { studentCode: "SAI-26-AB3K9P" }, update: {}, create: { name: `${P} 09y`, studentCode: "HV-9", centerId: cs.id } }),
    );
    expect(loi).toMatch(/sai dạng/);
  }, CASE);
});
