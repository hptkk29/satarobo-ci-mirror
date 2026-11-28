// @vitest-environment node
/**
 * [KHL-DB-*] P8/QtCauHoi — thao tác HÀNG LOẠT của ngân hàng câu hỏi (chuyển nhánh · nhân bản), chạy trên Postgres THẬT với đúng handler + `scopedDb` + actor thật.
 *
 * Mỗi ca âm tính có ĐỐI CHỨNG DƯƠNG (luật 11). ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_KHL_` / nhánh `/ci-khl/`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { scopedDb } from "../../lib/db-scope";
import { cauHinhChuyenNhanh, cauHinhNhanBan, cauHinhSuaCauHoi, cauHinhTaoCauHoi, chuyenNhanhSchema, nhanBanSchema } from "../../lib/elearning/question-bank";
import { ActionError } from "../../lib/actions/factory";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_KHL_";
const NHANH = "/ci-khl/";

let F: { dtCs1: string; dtCs2: string; dtHo: string; cs1CenterId: string; cs2CenterId: string };

async function cleanup() {
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnChoice.deleteMany({ where: { question: { bankPath: { startsWith: NHANH } } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: NHANH } } });
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function gan(userId: string, orgUnitId: string, vai: string) {
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: rd.id, status: "ACTIVE", grantedById: userId } });
}

const chay = <I, O>(cfg: { handler: (a: never) => Promise<O> }, actor: Actor, input: I) => cfg.handler({ db: scopedDb(actor), actor, input } as never);
const maLoi = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ActionError ? e.code : `KHAC:${String(e)}`));
const nhanhCua = async (id: string) => (await db.trnQuestion.findUniqueOrThrow({ where: { id }, select: { bankPath: true } })).bankPath;

const CAU = (stem: string, tuyChon: Record<string, unknown> = {}) => ({
  bankPath: `${NHANH}goc/`,
  type: "SINGLE",
  stem,
  choices: [
    { text: "Đáp án A", isCorrect: false },
    { text: "Đáp án B", isCorrect: true },
  ],
  ...tuyChon,
});

describe.skipIf(!RUN)("[KHL-DB] hàng loạt trên kho câu hỏi (Postgres thật)", () => {
  let dt1: Actor;
  let dt2: Actor;
  let ho: Actor;
  let cau1: string;
  let cau2: string;
  let cauCs2: string;
  let cauChung: string;

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [hoOu, cs1, cs2] = await Promise.all(["HO", "CS1", "CS2"].map((code) => db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true, centerId: true } })));
    const u1 = await seedUser({ email: `${P}dt1@ci.test`, name: `${P}DT1`, role: "TRAINING" });
    const u2 = await seedUser({ email: `${P}dt2@ci.test`, name: `${P}DT2`, role: "TRAINING" });
    const u3 = await seedUser({ email: `${P}ho@ci.test`, name: `${P}HO`, role: "TRAINING" });
    await gan(u1.id, cs1.id, "TRAINING");
    await gan(u2.id, cs2.id, "TRAINING");
    await gan(u3.id, hoOu.id, "TRAINING");
    F = { dtCs1: u1.id, dtCs2: u2.id, dtHo: u3.id, cs1CenterId: cs1.centerId as string, cs2CenterId: cs2.centerId as string };
    dt1 = await resolveActorUncached(F.dtCs1);
    dt2 = await resolveActorUncached(F.dtCs2);
    ho = await resolveActorUncached(F.dtHo);
    const tao = async (a: Actor, stem: string, t: Record<string, unknown> = {}) =>
      (await chay<unknown, { data: { questionId: string } }>(cauHinhTaoCauHoi as never, a, CAU(stem, t))).data.questionId;
    cau1 = await tao(dt1, `${P}Câu 1 của CS1`);
    cau2 = await tao(dt1, `${P}Câu 2 của CS1`);
    cauCs2 = await tao(dt2, `${P}Câu của CS2`);
    cauChung = await tao(ho, `${P}Câu DÙNG CHUNG`);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it("[KHL-DB-00] fixture: câu của CS1 gắn CS1, câu của CS2 gắn CS2, câu Hội sở là DÙNG CHUNG (centerId null)", async () => {
    const c = async (id: string) => (await db.trnQuestion.findUniqueOrThrow({ where: { id }, select: { centerId: true } })).centerId;
    expect(await c(cau1)).toBe(F.cs1CenterId);
    expect(await c(cauCs2)).toBe(F.cs2CenterId);
    expect(await c(cauChung)).toBeNull();
  });

  it("[KHL-DB-01] CHUYỂN NHÁNH: đổi bankPath của cả lô, KỂ CẢ câu đã nằm trong đề (khác với SỬA); nội dung/đáp án KHÔNG đổi", async () => {
    const de = await db.trnExam.create({ data: { title: `${P}Đề`, durationMin: 5, passScore: 1, maxScore: 1, isActive: true }, select: { id: true } });
    await db.trnExamQuestion.create({ data: { examId: de.id, questionId: cau2, orderIndex: 1, points: 1 } });
    const truoc = await db.trnQuestion.findUniqueOrThrow({ where: { id: cau2 }, select: { stem: true, contentJson: true } });
    // đối chứng: SỬA câu đã vào đề bị từ chối (đường mà chuyển nhánh KHÔNG đi qua)
    expect(await maLoi(chay(cauHinhSuaCauHoi as never, dt1, { questionId: cau2, ...CAU("sửa"), stem: "cố sửa câu đã vào đề" }))).toBe("CAU_DA_VAO_DE");
    const r = await chay<unknown, { data: { soCau: number } }>(cauHinhChuyenNhanh as never, dt1, { questionIds: [cau1, cau2, cau2], bankPath: `${NHANH}moi/` });
    expect(r.data.soCau).toBe(2); // id lặp được gộp
    expect(await nhanhCua(cau1)).toBe(`${NHANH}moi/`);
    expect(await nhanhCua(cau2)).toBe(`${NHANH}moi/`);
    const sau = await db.trnQuestion.findUniqueOrThrow({ where: { id: cau2 }, select: { stem: true, contentJson: true } });
    expect(sau).toEqual(truoc);
  }, CASE_TIMEOUT);

  it("[KHL-DB-02] 🔴 TẤT CẢ HOẶC KHÔNG: lẫn một câu của CƠ SỞ KHÁC ⇒ NOT_FOUND và KHÔNG câu nào đổi (đối chứng dương: ca 01 chuyển được khi cả lô hợp lệ)", async () => {
    const truoc = [await nhanhCua(cau1), await nhanhCua(cauCs2)];
    expect(await maLoi(chay(cauHinhChuyenNhanh as never, dt1, { questionIds: [cau1, cauCs2], bankPath: `${NHANH}lan/` }))).toBe("NOT_FOUND");
    expect([await nhanhCua(cau1), await nhanhCua(cauCs2)]).toEqual(truoc);
  }, CASE_TIMEOUT);

  it("[KHL-DB-03] 🔴 câu DÙNG CHUNG: người cấp cơ sở KHÔNG chuyển được (cả lô bị chặn); người Hội sở chuyển được (đối chứng dương)", async () => {
    const truocCau1 = await nhanhCua(cau1);
    const loi = await maLoi(chay(cauHinhChuyenNhanh as never, dt1, { questionIds: [cau1, cauChung], bankPath: `${NHANH}chung/` }));
    expect(loi, "người cấp cơ sở không được ghi vào bản ghi dùng chung").not.toBeNull();
    expect(loi).not.toBe("NOT_FOUND");
    expect(await nhanhCua(cauChung)).toBe(`${NHANH}goc/`);
    expect(await nhanhCua(cau1)).toBe(truocCau1); // câu hợp lệ trong lô cũng KHÔNG bị chuyển
    await chay(cauHinhChuyenNhanh as never, ho, { questionIds: [cauChung], bankPath: `${NHANH}chung/` });
    expect(await nhanhCua(cauChung)).toBe(`${NHANH}chung/`);
  }, CASE_TIMEOUT);

  it("[KHL-DB-04] NHÂN BẢN: bản sao giống hệt (đề bài, lựa chọn, điểm đúng), nội dung chấm DỰNG LẠI với id MỚI, thuộc cơ sở người nhân bản; câu gốc giữ nguyên; câu đã vào đề nhân bản được", async () => {
    const goc = await db.trnQuestion.findUniqueOrThrow({ where: { id: cau2 }, select: { contentJson: true, stem: true, centerId: true } });
    const r = await chay<unknown, { data: { questionIds: string[] } }>(cauHinhNhanBan as never, dt1, { questionIds: [cau2], bankPath: `${NHANH}ban-sao/` });
    expect(r.data.questionIds).toHaveLength(1);
    const moiId = r.data.questionIds[0]!;
    const moi = await db.trnQuestion.findUniqueOrThrow({ where: { id: moiId }, select: { stem: true, bankPath: true, centerId: true, contentJson: true, choices: { select: { text: true, isCorrect: true }, orderBy: { orderIndex: "asc" } } } });
    expect(moi.stem).toBe(goc.stem);
    expect(moi.bankPath).toBe(`${NHANH}ban-sao/`);
    expect(moi.centerId).toBe(F.cs1CenterId);
    expect(moi.choices).toEqual([{ text: "Đáp án A", isCorrect: false }, { text: "Đáp án B", isCorrect: true }]);
    const noiDung = moi.contentJson as { id?: string };
    expect(noiDung.id, "nội dung chấm mang id của CÂU MỚI, không phải câu gốc").toBe(moiId);
    expect((goc.contentJson as { id?: string }).id).toBe(cau2);
    // gốc không đổi và vẫn nằm trong đề
    expect(await db.trnExamQuestion.count({ where: { questionId: cau2 } })).toBe(1);
    expect((await db.trnQuestion.findUniqueOrThrow({ where: { id: cau2 }, select: { centerId: true } })).centerId).toBe(goc.centerId);
  }, CASE_TIMEOUT);

  it("[KHL-DB-05] 🔴 nhân bản câu DÙNG CHUNG: người cấp cơ sở nhận bản RIÊNG (centerId = cơ sở mình), người Hội sở nhận bản dùng chung (null); câu của CƠ SỞ KHÁC không nhân bản được", async () => {
    const a = await chay<unknown, { data: { questionIds: string[] } }>(cauHinhNhanBan as never, dt1, { questionIds: [cauChung] });
    expect((await db.trnQuestion.findUniqueOrThrow({ where: { id: a.data.questionIds[0]! }, select: { centerId: true } })).centerId).toBe(F.cs1CenterId);
    const b = await chay<unknown, { data: { questionIds: string[] } }>(cauHinhNhanBan as never, ho, { questionIds: [cauChung] });
    expect((await db.trnQuestion.findUniqueOrThrow({ where: { id: b.data.questionIds[0]! }, select: { centerId: true } })).centerId).toBeNull();
    const dem = () => db.trnQuestion.count({ where: { bankPath: { startsWith: NHANH } } });
    const truoc = await dem();
    expect(await maLoi(chay(cauHinhNhanBan as never, dt1, { questionIds: [cauCs2] }))).toBe("NOT_FOUND");
    expect(await dem()).toBe(truoc);
  }, CASE_TIMEOUT);

  it("[KHL-DB-06] 🔴 cổng TRƯỚC phép ghi: lô có một câu NHẬP SỐ hỏng ⇒ CAU_HONG và KHÔNG tạo câu nào (kể cả câu tốt đứng trước); câu nhập số tốt thì giữ đáp án/sai số (đối chứng dương)", async () => {
    const tot = (await chay<unknown, { data: { questionId: string } }>(cauHinhTaoCauHoi as never, dt1, { bankPath: `${NHANH}goc/`, type: "NUMERIC", stem: `${P}Câu nhập số tốt`, so: { dapAn: "12,5", saiSo: "0,5", donVi: "V" } })).data.questionId;
    const hong = await db.trnQuestion.create({ data: { bankPath: `${NHANH}goc/`, type: "NUMERIC", stem: `${P}Câu nhập số hỏng`, contentJson: {}, defaultPoints: 1, centerId: F.cs1CenterId }, select: { id: true } });
    const dem = () => db.trnQuestion.count({ where: { bankPath: { startsWith: NHANH } } });
    const truoc = await dem();
    expect(await maLoi(chay(cauHinhNhanBan as never, dt1, { questionIds: [cau1, hong.id] }))).toBe("CAU_HONG");
    expect(await dem()).toBe(truoc);
    const r = await chay<unknown, { data: { questionIds: string[] } }>(cauHinhNhanBan as never, dt1, { questionIds: [tot] });
    const moi = await db.trnQuestion.findUniqueOrThrow({ where: { id: r.data.questionIds[0]! }, select: { contentJson: true } });
    expect(moi.contentJson).toMatchObject({ type: "numeric", answer: 12.5, tolerance: 0.5, unit: "V", id: r.data.questionIds[0] });
  }, CASE_TIMEOUT);

  it("[KHL-DB-07] khuôn nhập: rỗng / quá trần / nhánh sai dạng bị từ chối trước khi chạm DB", () => {
    expect(chuyenNhanhSchema.safeParse({ questionIds: [], bankPath: `${NHANH}a/` }).success).toBe(false);
    expect(chuyenNhanhSchema.safeParse({ questionIds: Array.from({ length: 201 }, (_, i) => `q${i}`), bankPath: `${NHANH}a/` }).success).toBe(false);
    expect(chuyenNhanhSchema.safeParse({ questionIds: ["q1"], bankPath: "khong-co-gach" }).success).toBe(false);
    expect(chuyenNhanhSchema.safeParse({ questionIds: ["q1"], bankPath: `${NHANH}a/` }).success).toBe(true);
    expect(nhanBanSchema.safeParse({ questionIds: Array.from({ length: 51 }, (_, i) => `q${i}`) }).success).toBe(false);
    expect(nhanBanSchema.safeParse({ questionIds: ["q1"] }).success).toBe(true);
  });
});
