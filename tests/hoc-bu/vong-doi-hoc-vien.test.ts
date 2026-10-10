// tests/hoc-bu/vong-doi-hoc-vien.test.ts — T14: VÒNG ĐỜI GHI DANH (nghỉ học · bảo lưu · chuyển lớp · hoàn thành) nhìn từ phía HỌC BÙ, trên Postgres THẬT.
//
// Luật (chốt T14, cùng tinh thần quyết định 10 về huỷ lớp): dòng cần bù là NỢ HỌC của bé — đổi trạng thái ghi danh KHÔNG tự huỷ dòng, không tự gỡ bé khỏi case.
// Checker TV-51 chỉ NÊU RA học viên đã rời khoá mà còn nợ để quản lý quyết. Bảo lưu (PAUSED) vẫn thuộc lớp; chuyển lớp CÙNG khoá còn ghi danh ở lớp mới.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { HV, KHOA, LOP, LOP2, don, dung, id, kiem, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[VDH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const tv51 = async () => (await kiem()).filter((f) => f.luat === "TV-51");
const gd = (hv: keyof typeof HV) => id(`gd-${hv}`);
const dongCua = (hv: keyof typeof HV) => db.makeupNeed.findMany({ where: { studentId: HV[hv] }, select: { id: true, status: true, waivedAt: true }, orderBy: { id: "asc" } });

describe.skipIf(!RUN_DB_TESTS)("[VDH] vòng đời ghi danh × học bù — T14", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[VDH-01] NGHỈ HỌC (WITHDREW): dòng chờ xếp KHÔNG bị huỷ, chỉ được NÊU RA (TV-51, LOW); không audit, không sự kiện, không đổi gì", async () => {
    const truoc = await dongCua("D");
    const nhatKyTruoc = await db.auditLog.count({ where: { module: "hoc-bu" } });
    const suKienTruoc = await db.domainEvent.count({ where: { type: { startsWith: "makeup." } } });
    await db.enrollment.update({ where: { id: gd("D") }, data: { status: "WITHDREW" } });
    const f = await tv51();
    expect(f.map((x) => [x.id, x.nghiemTrong, x.phanLoai])).toEqual([[needId("D", 8), "LOW", "NEEDS_MANUAL_REVIEW"]]);
    expect(await dongCua("D")).toEqual(truoc);
    expect(await db.auditLog.count({ where: { module: "hoc-bu" } })).toBe(nhatKyTruoc);
    expect(await db.domainEvent.count({ where: { type: { startsWith: "makeup." } } })).toBe(suKienTruoc);
  });

  it("[VDH-02] BẢO LƯU (PAUSED) vẫn thuộc lớp ⇒ KHÔNG bị nêu; quay lại học thì cũng không", async () => {
    await db.enrollment.update({ where: { id: gd("D") }, data: { status: "PAUSED" } });
    expect(await tv51()).toEqual([]);
    await db.enrollment.update({ where: { id: gd("D") }, data: { status: "STUDYING" } });
    expect(await tv51()).toEqual([]);
  });

  it("[VDH-03] CHUYỂN LỚP CÙNG KHOÁ: ghi danh cũ TRANSFERRED + ghi danh mới ở lớp khác của cùng khoá ⇒ không bị nêu; dòng vẫn trỏ lớp gốc (lịch sử)", async () => {
    await db.enrollment.update({ where: { id: gd("D") }, data: { status: "TRANSFERRED" } });
    expect((await tv51()).map((x) => x.id)).toEqual([needId("D", 8)]); // chưa có ghi danh mới
    await db.enrollment.create({ data: { id: id("gd-D-moi"), studentId: HV.D, classId: LOP2, courseId: KHOA, status: "STUDYING" } });
    expect(await tv51()).toEqual([]);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("D", 8) } })).classId).toBe(LOP);
  });

  it("[VDH-04] ĐÃ XẾP CASE rồi học viên rời khoá (COMPLETED) ⇒ nêu MEDIUM, bé VẪN nằm trong case (không tự gỡ), lượt vẫn giữ", async () => {
    const c = await tao([needId("C", 7)]);
    await db.enrollment.update({ where: { id: gd("C") }, data: { status: "COMPLETED" } });
    const f = await tv51();
    expect(f.map((x) => [x.id, x.nghiemTrong])).toEqual([[needId("C", 7), "MEDIUM"]]);
    expect(f[0]!.deXuat).toContain("KHÔNG tự gỡ");
    expect((await db.makeupCaseParticipant.findFirstOrThrow({ where: { caseId: c, studentId: HV.C } })).attendanceStatus).toBe("PENDING");
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("C", 7) } })).status).toBe("SCHEDULED");
    const tk = await db.makeupCreditAccount.findUniqueOrThrow({ where: { studentId_courseId: { studentId: HV.C, courseId: KHOA } } });
    expect(tk.held).toBe(1);
  });

  it("[VDH-05] GHI DANH BỊ XOÁ MỀM ⇒ coi như không còn; học viên khác của cùng khoá không bị lẫn", async () => {
    await db.enrollment.update({ where: { id: gd("B") }, data: { deletedAt: new Date() } });
    const f = await tv51();
    expect(f.map((x) => x.lienQuan?.hocVien).sort()).toEqual([HV.B, HV.B].sort()); // B có hai dòng (bài 6, 7)
    expect(f.every((x) => x.lienQuan?.hocVien === HV.B)).toBe(true);
  });

  it("[VDH-06] ĐỒNG HỒ: ghi danh cuối cùng quyết định — rời rồi quay lại (ACTIVE) ⇒ hết nêu; dòng đã huỷ/đã bù xong không bao giờ bị nêu", async () => {
    await db.enrollment.update({ where: { id: gd("D") }, data: { status: "WITHDREW" } });
    expect(await tv51()).toHaveLength(1);
    await db.enrollment.update({ where: { id: gd("D") }, data: { status: "ACTIVE" } });
    expect(await tv51()).toEqual([]);
    await db.enrollment.update({ where: { id: gd("D") }, data: { status: "WITHDREW" } });
    await db.makeupNeed.updateMany({ where: { studentId: HV.D }, data: { status: "CANCELLED", waivedAt: new Date(), waivedReason: "Nghỉ học, không bù" } });
    expect(await tv51()).toEqual([]);
  });
});
