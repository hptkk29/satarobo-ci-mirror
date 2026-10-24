// tests/hoc-bu/phuc-hoc.test.ts — HỢP ĐỒNG TÍCH HỢP Bảo lưu P6 × Học bù (chủ dự án chốt 09/10/2026), trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
// Chốt: buổi bù sinh khi PHỤC HỌC vào lớp đi trước (`MakeupNeed.nguon = 'PHUC_HOC'`, BR-22)
//   · đi qua CÙNG cửa tạo dòng (`taoDongHocBu`) — không còn `createMany` thẳng (cột `sourceType`/`courseId` NOT NULL, luật tạo dòng ở một nơi);
//   · phân biệt RÕ với vắng thường: `nguon = PHUC_HOC` + `sourceType = OTHER` (không có điểm danh gốc);
//   · KHÔNG phải một lần dùng lượt học bù: không HOLD, không CONSUME, không RELEASE, không phí — dù học viên có 0 lượt.
// Ca "đối chứng dương" ở mỗi mục: cùng dòng mà bỏ nhãn PHUC_HOC thì RƠI vào luật thường (nếu không, ca xanh vì lý do khác).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { diemDanhBe, mienPhiBu, taoPhiBu } from "@/lib/hoc-bu/case-db";
import { scopedDb } from "@/lib/db-scope";
import { ADMIN, CS, GV, KHOA, LOP, buoiGoc, don, dung, id, kiem, sach, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[PHC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const E = id("hvE-phuc-hoc");
const NOW = new Date("2026-10-15T11:30:00.000Z"); // 18:30 VN — giữa buổi dạy của KHUNG (18:00–19:30)

async function xoaE() {
  await db.makeupCase.deleteMany({ where: { centerId: CS } }); // cascade mục + bé + bộ bài (như `don()`)
  await db.makeupNeed.deleteMany({ where: { studentId: E } });
  await db.makeupCreditEntry.deleteMany({ where: { account: { studentId: E } } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: E } });
  await db.enrollment.deleteMany({ where: { studentId: E } });
  await db.student.deleteMany({ where: { id: E } });
}

/** Bé E: vào lớp từ buổi 8, KHÔNG có điểm danh nào ở buổi 5–6; sổ lượt = 0 (nếu có dùng lượt thì lộ ngay). */
async function dungE() {
  await db.student.create({ data: { id: E, name: "Bé E phục học", centerId: CS } });
  await db.enrollment.create({ data: { id: id("gd-E-ph"), studentId: E, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  await db.makeupCreditAccount.create({ data: { studentId: E, courseId: KHOA, granted: 0 } });
}

const phucHoc = (b: 5 | 6, nguonBaoLuu: "PHUC_HOC" | undefined = "PHUC_HOC") =>
  db.$transaction((tx) =>
    taoDongHocBu(tx, { studentId: E, missedSessionId: buoiGoc(b), nguon: "OTHER", nguonBaoLuu, createdById: ADMIN.userId, note: "Bù bài chưa học khi phục học" }),
  );
const taiKhoanE = () => db.makeupCreditAccount.findUniqueOrThrow({ where: { studentId_courseId: { studentId: E, courseId: KHOA } } });
const buteToan = () => db.makeupCreditEntry.count({ where: { account: { studentId: E } } });

describe.skipIf(!RUN_DB_TESTS)("[PHC] PHUC_HOC × học bù — hợp đồng tích hợp", () => {
  beforeEach(async () => {
    await xoaE();
    await dung();
    await dungE();
  });
  afterAll(async () => {
    await xoaE();
    await don();
  });

  it("[PHC-01] tạo qua cửa chung: sourceType = OTHER, nguon = PHUC_HOC, có khoá khoá/cơ sở, KHÔNG có điểm danh gốc, KHÔNG phát `makeup.requested`; chạy lại là idempotent", async () => {
    const r = await phucHoc(5);
    expect(r.ket).toBe("TAO");
    const dong = await db.makeupNeed.findUniqueOrThrow({ where: { id: r.id! } });
    expect(dong).toMatchObject({ sourceType: "OTHER", nguon: "PHUC_HOC", courseId: KHOA, centerId: CS, classId: LOP, status: "PENDING", originalAttendanceId: null });
    // Nguồn KHÁC ABSENCE ⇒ không báo phụ huynh "nhu cầu bù đã ghi nhận" (không có buổi nào bị vắng).
    expect(await db.domainEvent.count({ where: { dedupeKey: { startsWith: `makeup.requested:${r.id}` } } })).toBe(0);
    const lai = await phucHoc(5);
    expect(lai).toMatchObject({ ket: "DA_CO", id: r.id });
    expect(await db.makeupNeed.count({ where: { studentId: E } })).toBe(1);
  });

  it("[PHC-02] ĐỌC RA là MIỄN PHÍ và không dùng lượt dù sổ lượt = 0; đối chứng: bỏ nhãn PHUC_HOC thì thành 'Cần thu phí' và KHÔNG xếp được", async () => {
    const a = await phucHoc(5);
    const doc = () => docDongTheoId(scopedDb(ADMIN), [a.id!], null);
    const [d] = await doc();
    expect(d!.phi).toEqual({ loai: "MIEN_PHI" });
    expect(d!.xep).toEqual({ ok: true, dungLuot: false });
    await db.makeupNeed.update({ where: { id: a.id! }, data: { nguon: null } });
    const [d2] = await doc();
    expect(d2!.phi.loai).toBe("CAN_THU");
    expect(d2!.xep.ok).toBe(false);
  });

  it("[PHC-03] xếp vào case + có mặt: KHÔNG HOLD, KHÔNG CONSUME, không bút toán nào; dòng COMPLETED; checker T01 sạch", async () => {
    const [a, b] = [await phucHoc(5), await phucHoc(6)];
    const caseId = await tao([a.id!, b.id!]);
    const muc = await db.makeupCaseStudent.findMany({ where: { caseId } });
    expect(muc).toHaveLength(2);
    expect(muc.every((m) => m.dungLuot === false && m.status === "PLACED")).toBe(true);
    expect(await taiKhoanE()).toMatchObject({ granted: 0, held: 0, consumed: 0 });
    expect(await buteToan()).toBe(0);

    const be = await db.makeupCaseParticipant.findFirstOrThrow({ where: { caseId, studentId: E } });
    await diemDanhBe(null, {
      participantId: be.id,
      coMat: true,
      ketQuaMuc: Object.fromEntries(muc.map((m) => [m.id, { ketQua: "COMPLETED" as const, danhGia: "Con theo kịp" }])),
      nhanXetChung: "Con học tốt",
      chiGiaoVien: GV,
      now: NOW,
    });
    expect((await db.makeupNeed.findMany({ where: { studentId: E } })).every((n) => n.status === "COMPLETED")).toBe(true);
    expect(await taiKhoanE()).toMatchObject({ granted: 0, held: 0, consumed: 0 }); // vẫn không đụng sổ lượt
    expect(await buteToan()).toBe(0);
    await sach(new Date("2026-10-15T11:45:00.000Z"));
  });

  it("[PHC-03b] checker T01 sạch ở MỌI trạng thái của dòng PHUC_HOC (PENDING chưa xếp · SCHEDULED trong case); đối chứng dương: dòng đã học xong mà bỏ nhãn ⇒ checker BÁO", async () => {
    const a = await phucHoc(5);
    await sach(new Date("2026-10-15T11:00:00.000Z")); // PENDING
    await tao([a.id!]);
    await sach(new Date("2026-10-15T11:00:00.000Z")); // SCHEDULED
    const caseId = (await db.makeupCase.findFirstOrThrow({ where: { centerId: CS } })).id;
    const be = await db.makeupCaseParticipant.findFirstOrThrow({ where: { caseId, studentId: E } });
    const muc = await db.makeupCaseStudent.findMany({ where: { caseId } });
    await diemDanhBe(null, {
      participantId: be.id,
      coMat: true,
      ketQuaMuc: Object.fromEntries(muc.map((m) => [m.id, { ketQua: "COMPLETED" as const, danhGia: "Con theo kịp" }])),
      nhanXetChung: null,
      chiGiaoVien: GV,
      now: NOW,
    });
    await sach(new Date("2026-10-15T11:45:00.000Z")); // COMPLETED
    await db.makeupNeed.update({ where: { id: a.id! }, data: { nguon: null } });
    const f = await kiem(new Date("2026-10-15T11:45:00.000Z"));
    expect(f.some((x) => x.luat === "TV-22")).toBe(true); // bỏ nhãn ⇒ rơi vào luật thường: "bù xong mà buổi gốc không có điểm danh"
  });

  it("[PHC-04] vắng buổi bù: dòng về PENDING, sổ lượt vẫn nguyên (không có gì để nhả vì chưa từng giữ)", async () => {
    const a = await phucHoc(5);
    const caseId = await tao([a.id!]);
    const be = await db.makeupCaseParticipant.findFirstOrThrow({ where: { caseId, studentId: E } });
    await diemDanhBe(null, { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, chiGiaoVien: GV, now: NOW });
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: a.id! } })).status).toBe("PENDING");
    expect(await taiKhoanE()).toMatchObject({ granted: 0, held: 0, consumed: 0 });
    expect(await buteToan()).toBe(0);
  });

  it("[PHC-05] máy chủ từ chối tạo phí / miễn phí ngoại lệ cho dòng PHUC_HOC (nút không vẽ ⇒ cổng cũng đóng); đối chứng: bỏ nhãn thì cổng KHÔNG nói câu đó", async () => {
    const a = await phucHoc(5);
    const loi = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e)));
    // Từ chối (bất kể cổng nào chặn trước — cổng đọc "không cần thu phí", hay cổng trong giao dịch nói "phục học"): KHÔNG đơn phí, KHÔNG miễn phí được ghi.
    expect(await loi(taoPhiBu(ADMIN, a.id!))).not.toBeNull();
    expect(await loi(mienPhiBu(ADMIN, { needId: a.id!, lyDo: "thử miễn phí cho dòng phục học", ten: "Quản lý" }))).not.toBeNull();
    const dong = await db.makeupNeed.findUniqueOrThrow({ where: { id: a.id! } });
    expect(dong).toMatchObject({ freeApprovedAt: null, feeOrderItemId: null });
    // Đối chứng dương: bỏ nhãn ⇒ cùng dòng đó miễn phí ngoại lệ ĐƯỢC (cổng không chặn nhầm dòng thường).
    await db.makeupNeed.update({ where: { id: a.id! }, data: { nguon: null } });
    expect(await loi(mienPhiBu(ADMIN, { needId: a.id!, lyDo: "thử miễn phí đối chứng dương", ten: "Quản lý" }))).toBeNull();
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: a.id! } })).freeApprovedAt).not.toBeNull();
  });
});
