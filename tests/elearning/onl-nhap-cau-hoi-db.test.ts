// @vitest-environment node
/**
 * [QIM-DB-*] QoImport (Postgres thật): bộ mẫu → đọc tệp → kiểm → GHI vào ngân hàng câu hỏi của khoá online.
 * Mỗi ca ÂM có đối chứng DƯƠNG; ghi là "tất cả hoặc không".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { luuCauHoi, luuDeThi } from "../../lib/elearning-online/danh-gia-db";
import { kiemBangTinh, MAU_THEO_LOAI } from "../../lib/elearning-online/nhap-cau-hoi";
import { docTepXlsx, taoTepMau } from "../../lib/elearning-online/nhap-cau-hoi-tep";
import { nhapCauHoi } from "../../lib/elearning-online/nhap-cau-hoi-db";
import { cauHinhKiemTraNhapCauHoi, cauHinhNhapCauHoi } from "../../lib/elearning-online/actions";
import * as XLSX from "xlsx";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_NCH_";
let courseId = "";
let khoaKhac = "";

describe.skipIf(!RUN_DB_TESTS)("NCH-DB · nhập câu hỏi Online từ Excel", () => {
  beforeAll(async () => {
    await donBangOnl(db);
    const t = await taoKhoa(db, { code: `CI-NCH-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá A`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    courseId = t.courseId;
    const k = await taoKhoa(db, { code: `CI-NCH-K-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá B`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!k.ok) throw new Error(k.thongBao);
    khoaKhac = k.courseId;
  }, 120_000);
  afterAll(async () => {
    await donBangOnl(db);
  }, 120_000);

  const demCau = (id: string) => db.onlQuestion.count({ where: { courseId: id } });

  it("[QIM-DB-01] đi hết đường: bộ mẫu (.xlsx thật) → đọc → kiểm → nhập ⇒ 13 câu, đủ 13 dạng, thuộc đúng khoá, đáp án đúng dạng", async () => {
    const sheets = docTepXlsx(taoTepMau().toString("base64"));
    expect(Object.keys(sheets)).toEqual(expect.arrayContaining([...MAU_THEO_LOAI.map((m) => m.sheet), "HUONG-DAN"]));
    const kq = kiemBangTinh(sheets);
    expect(kq).toMatchObject({ tongDong: 13, hopLe: 13, loi: 0, loiChung: null });
    expect(kq.sheetBoQua).toEqual(["HUONG-DAN"]);
    const cau = kq.chiTiet.flatMap((d) => (d.cau ? [d.cau] : []));
    const truoc = await demCau(courseId);
    const r = await nhapCauHoi(db, { courseId, cau }, "u-nhap");
    expect(r).toEqual({ ok: true, soDaNhap: 13, soGanVaoDe: 0 });
    expect((await demCau(courseId)) - truoc).toBe(13);
    expect(await demCau(khoaKhac), "khoá khác không bị đụng").toBe(0);
    const ds = await db.onlQuestion.findMany({ where: { courseId }, orderBy: { createdAt: "asc" } });
    expect(new Set(ds.map((c) => c.type))).toEqual(new Set(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_TEXT", "ESSAY", "FILL_BLANK", "MATCHING", "ORDERING", "CLASSIFY", "IMAGE_HOTSPOT", "NUMERIC", "PRODUCT", "BLOCK_SEQUENCE"]));
    expect(ds.every((c) => c.createdByUserId === "u-nhap" && c.status === "ACTIVE")).toBe(true);
    const chonMot = ds.find((c) => c.type === "SINGLE_CHOICE")!;
    expect(chonMot.answerKeyJson).toEqual({ correct: "A" });
    expect(ds.find((c) => c.type === "MULTIPLE_CHOICE")!.answerKeyJson).toEqual({ correct: ["A", "B"] });
    expect(ds.find((c) => c.type === "TRUE_FALSE")!.answerKeyJson).toEqual({ correct: true });
    expect(ds.find((c) => c.type === "SHORT_TEXT")!.answerKeyJson).toEqual({ accepted: ["siêu âm", "ultrasonic"] });
    // 8 dạng mở rộng: đáp án nằm trong answerKeyJson, cấu hình hiển thị trong optionsJson — và KHÔNG lẫn nhau
    expect(ds.find((c) => c.type === "FILL_BLANK")!.answerKeyJson).toEqual({ blanks: [["siêu âm", "ultrasonic"], ["khoảng cách"]] });
    expect(ds.find((c) => c.type === "MATCHING")!.answerKeyJson).toEqual({ pairs: { l1: "r1", l2: "r2" } });
    expect(ds.find((c) => c.type === "ORDERING")!.answerKeyJson).toEqual({ order: ["s1", "s2", "s3", "s4"] });
    expect(ds.find((c) => c.type === "NUMERIC")!.answerKeyJson).toMatchObject({ answer: 60 });
    expect(ds.find((c) => c.type === "PRODUCT")!.answerKeyJson).toEqual({});
    expect(ds.find((c) => c.type === "BLOCK_SEQUENCE")!.answerKeyJson).toEqual({});
    expect(JSON.stringify(ds.find((c) => c.type === "MATCHING")!.optionsJson)).not.toContain('"pairs"');
  });

  it("[QIM-DB-02] HÌNH DẠNG DỮ LIỆU GIỐNG ĐƯỜNG LƯU TỪNG CÂU: câu nhập hàng loạt và câu lưu bằng `luuCauHoi` cho cùng đầu vào ra cùng options/đáp án", async () => {
    const cau = { type: "SINGLE_CHOICE" as const, stem: `${P}so sánh`, options: [{ id: "A", text: "x" }, { id: "B", text: "y" }], correct: "B", points: 3, explanation: "vì y" };
    const a = await nhapCauHoi(db, { courseId, cau: [cau] }, "u");
    expect(a.ok).toBe(true);
    const b = await luuCauHoi(db, { courseId, ...cau, stem: `${P}so sánh-luu` }, "u");
    expect(b.ok).toBe(true);
    const [ca, cb] = await Promise.all([db.onlQuestion.findFirstOrThrow({ where: { courseId, stem: `${P}so sánh` } }), db.onlQuestion.findFirstOrThrow({ where: { courseId, stem: `${P}so sánh-luu` } })]);
    expect(ca.optionsJson).toEqual(cb.optionsJson);
    expect(ca.answerKeyJson).toEqual(cb.answerKeyJson);
    expect([ca.points, ca.explanation, ca.status]).toEqual([cb.points, cb.explanation, cb.status]);
  });

  it("[QIM-DB-03] TẤT CẢ HOẶC KHÔNG: một câu không hợp lệ giữa lô ⇒ KHÔNG câu nào được ghi (đối chứng: bỏ câu hỏng thì cả lô vào)", async () => {
    const tot = { type: "TRUE_FALSE" as const, stem: `${P}tot`, correct: true };
    const hong = { type: "SINGLE_CHOICE" as const, stem: `${P}hong`, options: [{ id: "A", text: "chỉ một" }], correct: "A" };
    const truoc = await demCau(courseId);
    const r = await nhapCauHoi(db, { courseId, cau: [tot, hong, { ...tot, stem: `${P}tot2` }] }, "u");
    expect(r).toMatchObject({ ok: false, ma: "CAU_HOI_KHONG_HOP_LE" });
    expect((r as { thongBao: string }).thongBao).toMatch(/^Câu 2:/);
    expect(await demCau(courseId), "không ghi gì").toBe(truoc);
    const ok = await nhapCauHoi(db, { courseId, cau: [tot, { ...tot, stem: `${P}tot2` }] }, "u");
    expect(ok).toEqual({ ok: true, soDaNhap: 2, soGanVaoDe: 0 });
    expect(await demCau(courseId)).toBe(truoc + 2);
  });

  it("[QIM-DB-04] cổng: khoá không tồn tại · lô rỗng · quá 500 ⇒ từ chối, không ghi", async () => {
    const tot = { type: "ESSAY" as const, stem: `${P}x` };
    const truoc = await db.onlQuestion.count();
    expect(await nhapCauHoi(db, { courseId: "khong-co", cau: [tot] }, "u")).toMatchObject({ ok: false, ma: "KHOA_KHONG_TON_TAI" });
    expect(await nhapCauHoi(db, { courseId, cau: [] }, "u")).toMatchObject({ ok: false, ma: "NHAP_RONG" });
    expect(await nhapCauHoi(db, { courseId, cau: Array.from({ length: 501 }, (_, i) => ({ ...tot, stem: `${P}${i}` })) }, "u")).toMatchObject({ ok: false, ma: "NHAP_QUA_NHIEU" });
    expect(await db.onlQuestion.count(), "không ghi gì ở cả ba ca").toBe(truoc);
  });

  it("[QIM-DB-08] 🔴 ĐÍCH: gắn các câu vừa nhập vào MỘT đề của khoá (nối đuôi, cùng giao dịch); đề của KHOÁ KHÁC / không tồn tại / đã lưu trữ ⇒ từ chối và KHÔNG ghi câu nào vào ngân hàng; đối chứng: không chọn đích ⇒ chỉ vào ngân hàng", async () => {
    const cau0 = await luuCauHoi(db, { courseId, type: "TRUE_FALSE", stem: `${P}cau-co-san`, correct: true } as never, "u");
    if (!cau0.ok) throw new Error(cau0.thongBao);
    const de = await luuDeThi(db, { courseId, kind: "QUIZ", title: `${P}Đề đích`, passPercent: 50, status: "DRAFT", cau: [{ questionId: cau0.id }] } as never, "u");
    if (!de.ok) throw new Error(de.thongBao);
    const deKhac = await luuDeThi(db, { courseId: khoaKhac, kind: "QUIZ", title: `${P}Đề khoá khác`, passPercent: 50, status: "DRAFT", cau: [] } as never, "u");
    if (!deKhac.ok) throw new Error(deKhac.thongBao);
    const luuTru = await luuDeThi(db, { courseId, kind: "QUIZ", title: `${P}Đề lưu trữ`, passPercent: 50, status: "ARCHIVED", cau: [] } as never, "u");
    if (!luuTru.ok) throw new Error(luuTru.thongBao);
    const lo = (t: string) => [{ type: "TRUE_FALSE" as const, stem: `${P}${t}-1`, correct: true }, { type: "ESSAY" as const, stem: `${P}${t}-2` }];
    const truoc = await db.onlQuestion.count();
    for (const [ten, id] of [["khoá khác", deKhac.id], ["không có", "de-khong-co"], ["lưu trữ", luuTru.id]] as const) {
      expect(await nhapCauHoi(db, { courseId, cau: lo(ten), deThiId: id }, "u"), ten).toMatchObject({ ok: false, ma: "DE_KHONG_TON_TAI" });
    }
    expect(await db.onlQuestion.count(), "từ chối ⇒ không câu nào vào ngân hàng").toBe(truoc);
    const r = await nhapCauHoi(db, { courseId, cau: lo("dich"), deThiId: de.id }, "u");
    expect(r).toEqual({ ok: true, soDaNhap: 2, soGanVaoDe: 2 });
    const dong = await db.onlAssessmentQuestion.findMany({ where: { assessmentId: de.id }, orderBy: { orderIndex: "asc" }, include: { question: { select: { stem: true } } } });
    expect(dong.map((x) => x.question.stem)).toEqual([`${P}cau-co-san`, `${P}dich-1`, `${P}dich-2`]); // nối đuôi, giữ thứ tự cũ
    expect(dong.map((x) => x.orderIndex)).toEqual([0, 1, 2]);
    // đối chứng: không đích ⇒ vào ngân hàng, KHÔNG vào đề nào
    const khong = await nhapCauHoi(db, { courseId, cau: lo("khong-dich") }, "u");
    expect(khong).toEqual({ ok: true, soDaNhap: 2, soGanVaoDe: 0 });
    expect(await db.onlAssessmentQuestion.count({ where: { assessmentId: de.id } })).toBe(3);
  });

  it("[QIM-DB-05] khoá đã lưu trữ (xoá mềm) không nhận câu hỏi", async () => {
    const t = await taoKhoa(db, { code: `CI-NCH-D-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá xoá`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    await db.onlCourse.update({ where: { id: t.courseId }, data: { deletedAt: new Date() } });
    expect(await nhapCauHoi(db, { courseId: t.courseId, cau: [{ type: "ESSAY", stem: `${P}d` }] }, "u")).toMatchObject({ ok: false, ma: "KHOA_KHONG_TON_TAI" });
    expect(await demCau(t.courseId)).toBe(0);
  });

  // ── Tầng ACTION (handler thật + DB thật): nhập một phần / nhầm khoá / nhầm miền / câu trùng ──
  const tep = (cauTuLuan: string[]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Đề bài", "Điểm", "Giải thích"], ...cauTuLuan.map((c) => [c, "1", ""])]), "Tự luận");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Đề bài", "Đáp án"], ["Câu hỏng", "Có"]]), "Đúng sai");
    return (XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64");
  };
  const chay = (cfg: typeof cauHinhNhapCauHoi | typeof cauHinhKiemTraNhapCauHoi, input: unknown) => (cfg.handler as (a: unknown) => Promise<unknown>)({ actor: { userId: "u-act" }, input } as never);

  it("[QIM-DB-06] NHẬP MỘT PHẦN không được phép: còn dòng lỗi mà boQuaLoi=false ⇒ ném, KHÔNG ghi câu nào (đối chứng: boQuaLoi=true ⇒ nhập phần hợp lệ)", async () => {
    const truoc = await demCau(courseId);
    await expect(chay(cauHinhNhapCauHoi, { courseId, tepBase64: tep(["QIM6 một", "QIM6 hai"]), boQuaLoi: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await demCau(courseId), "không ghi gì").toBe(truoc);
    const ok = (await chay(cauHinhNhapCauHoi, { courseId, tepBase64: tep(["QIM6 một", "QIM6 hai"]), boQuaLoi: true })) as { data?: unknown; newValues?: { soDaNhap: number; soBoQua: number } };
    expect(ok.newValues).toMatchObject({ soDaNhap: 2, soBoQua: 1 });
    expect(await demCau(courseId)).toBe(truoc + 2);
  });

  it("[QIM-DB-07] NHẦM KHOÁ / NHẦM MIỀN: id khoá không tồn tại, và id của khoá OFFLINE/NỘI BỘ (TrnCourse) ⇒ NOT_FOUND, không ghi gì vào Onl* lẫn Trn*", async () => {
    const trn = await db.trnCourse.create({ data: { code: `${P}TRN`, slug: `${P.toLowerCase()}trn`, title: `${P}Khoá nội bộ`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" }, select: { id: true } });
    try {
      const truocOnl = await db.onlQuestion.count();
      const truocTrn = await db.trnCourse.count();
      for (const id of ["khong-co", trn.id]) {
        await expect(chay(cauHinhNhapCauHoi, { courseId: id, tepBase64: tep(["QIM7"]), boQuaLoi: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(chay(cauHinhKiemTraNhapCauHoi, { courseId: id, tepBase64: tep(["QIM7"]) })).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      expect(await db.onlQuestion.count(), "không ghi gì vào Online").toBe(truocOnl);
      expect(await db.trnCourse.count(), "không đụng bảng Trn*").toBe(truocTrn);
    } finally {
      await db.trnCourse.delete({ where: { id: trn.id } });
    }
  });

  it("[QIM-DB-08] CÂU TRÙNG với ngân hàng của khoá ⇒ xem trước báo 'đã có'; nhập lại cùng tệp không nhân đôi; khoá KHÁC có cùng đề bài thì KHÔNG bị coi là trùng (đối chứng)", async () => {
    const t = tep(["QIM8 duy nhất"]);
    const lan1 = (await chay(cauHinhNhapCauHoi, { courseId, tepBase64: t, boQuaLoi: true })) as { newValues: { soDaNhap: number } };
    expect(lan1.newValues.soDaNhap).toBe(1);
    const sau1 = await demCau(courseId);
    const xem = (await chay(cauHinhKiemTraNhapCauHoi, { courseId, tepBase64: t })) as { data: { chiTiet: { loi: string | null; deBai: string }[] } };
    expect(xem.data.chiTiet.find((d) => d.deBai === "QIM8 duy nhất")?.loi).toBe("Câu đã có trong ngân hàng câu hỏi của khoá");
    // nhập lại cùng tệp: câu duy nhất giờ là lỗi "đã có" ⇒ không còn câu hợp lệ ⇒ từ chối và không ghi thêm
    await expect(chay(cauHinhNhapCauHoi, { courseId, tepBase64: t, boQuaLoi: true })).rejects.toMatchObject({ code: "NHAP_RONG" });
    expect(await demCau(courseId), "không nhân đôi").toBe(sau1);
    const khac = (await chay(cauHinhNhapCauHoi, { courseId: khoaKhac, tepBase64: t, boQuaLoi: true })) as { newValues: { soDaNhap: number } };
    expect(khac.newValues.soDaNhap, "khoá khác không bị coi là trùng").toBe(1);
  });
});
