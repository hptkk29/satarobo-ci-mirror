// tests/hoc-bu/pham-vi.test.ts — T10: PHẠM VI ở MÁY CHỦ (HB-23/24/35) trên Postgres THẬT.
//
// Giao diện ẩn nút không phải kiểm soát. Mỗi ca ở đây gọi THẲNG dịch vụ (đúng thứ một Server Action gọi) với một người có `chiCuaSale` hay không, và đo
// trạng thái dữ liệu sau đó — "bị từ chối" phải đi kèm "không đổi gì" (dòng cần bù, mục, sổ lượt, đơn).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { nguoiHocBu, CAU_KHONG_CUA_SALE } from "@/lib/hoc-bu/pham-vi";
import {
  diemDanhBe,
  diemDanhBu,
  ghiDanhGiaMuc,
  goBeKhoiCase,
  goKhoiCase,
  huyCase,
  suaCase,
  taoCaseVaXep,
  taoPhiBu,
  xepVaoCaseCoSan,
} from "@/lib/hoc-bu/case-db";
import { guiBaiKiemTraBu } from "@/lib/hoc-bu/tai-lieu-bu";
import { ADMIN, CS, GV, GV2, HV, KHUNG, NOW, beCua, don, dung, id, lyDoLoi, mucCua, need, needId, so } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[PQ] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const SALE1 = id("sale1");
const SALE2 = id("sale2");
/** Người gọi là Sale: cùng tầm nhìn cơ sở như ADMIN (scopedDb không cách ly) nhưng `chiCuaSale` = chính họ. */
const sale = (saleId: string) => nguoiHocBu(ADMIN, saleId);
const QUAN_LY = nguoiHocBu(ADMIN, null);
/** Giáo viên thường vào action của ADMIN: userId của họ, không có `makeup:manage` ⇒ chiGiaoVien = userId. */
const gvThuong = (userId: string) => ({ ...ADMIN, userId });

const tao = (nguoi: typeof QUAN_LY, needIds: string[], them: { ymd?: string; teacherId?: string; roomId?: string | null } = {}) =>
  taoCaseVaXep(nguoi, { ...KHUNG, needIds, ...them });

async function dungSale() {
  await donSale(); // xoá cả Sale của lần trước (dung() chỉ dọn phần của fixture chung)
  await dung();
  for (const [u, ten] of [[SALE1, "Sale một"], [SALE2, "Sale hai"]] as const) {
    await db.user.create({ data: { id: u, name: ten, email: `${u}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
  }
  // A, B do Sale 1 phụ trách; C, D do Sale 2.
  await db.enrollment.updateMany({ where: { studentId: { in: [HV.A, HV.B] } }, data: { saleId: SALE1 } });
  await db.enrollment.updateMany({ where: { studentId: { in: [HV.C, HV.D] } }, data: { saleId: SALE2 } });
}
async function donSale() {
  await don();
  await db.user.deleteMany({ where: { id: { in: [SALE1, SALE2] } } });
}

describe.skipIf(!RUN_DB_TESTS)("[PQ] phạm vi Sale / giáo viên ở máy chủ — T10", () => {
  beforeEach(dungSale);
  afterAll(donSale);

  it("[PQ-01] Sale tạo case: học viên của MÌNH ⇒ được; có MỘT học viên của Sale khác ⇒ từ chối cả lô, không ghi gì (dòng vẫn PENDING, sổ lượt không đổi)", async () => {
    const loi = await lyDoLoi(tao(sale(SALE1), [needId("A", 5), needId("C", 7)]));
    expect(loi).toContain("không thuộc danh sách bạn phụ trách");
    expect(await db.makeupCase.count({ where: { centerId: CS } })).toBe(0);
    expect((await need("A", 5)).status).toBe("PENDING");
    expect((await need("C", 7)).status).toBe("PENDING");
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    const c = await tao(sale(SALE1), [needId("A", 5), needId("B", 6)]);
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c } })).toBe(2);
  });

  it("[PQ-02] id dòng cần bù của Sale khác bị gọi THẲNG (IDOR): cả tạo case lẫn xếp thêm lẫn tạo phí đều không thấy dòng đó", async () => {
    expect(await lyDoLoi(tao(sale(SALE2), [needId("A", 5)]))).toContain("không thuộc danh sách bạn phụ trách");
    const cua1 = await tao(sale(SALE1), [needId("A", 5)]);
    expect(await lyDoLoi(xepVaoCaseCoSan(sale(SALE2), { caseId: cua1, needIds: [needId("A", 6)] }))).toContain("không thuộc danh sách bạn phụ trách");
    expect(await lyDoLoi(taoPhiBu(sale(SALE2), needId("A", 6)))).toContain("Không tìm thấy buổi cần bù");
    expect(await db.orderItem.count({ where: { studentId: HV.A } })).toBe(0);
    expect((await need("A", 6)).status).toBe("PENDING");
  });

  it("[PQ-03] Sale xếp học viên CỦA MÌNH vào case có sẵn của Sale khác (gộp case — chốt 29/09): được; học viên của họ không bị lộ thêm quyền sửa", async () => {
    const cua1 = await tao(sale(SALE1), [needId("B", 7)]);
    await xepVaoCaseCoSan(sale(SALE2), { caseId: cua1, needIds: [needId("C", 7)] });
    expect(await db.makeupCaseParticipant.count({ where: { caseId: cua1 } })).toBe(2);
    // Sale 2 KHÔNG gỡ được bé của Sale 1 khỏi chính case mình vừa vào — mục và cả bé.
    const mB = await mucCua(cua1, "B", 7);
    expect(await lyDoLoi(goKhoiCase(sale(SALE2), mB.id))).toBe(CAU_KHONG_CUA_SALE);
    expect(await lyDoLoi(goBeKhoiCase(sale(SALE2), (await beCua(cua1, "B")).id))).toBe(CAU_KHONG_CUA_SALE);
    expect(await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: mB.id } })).toMatchObject({ result: "PLANNED" });
    expect((await need("B", 7)).status).toBe("SCHEDULED");
    // Nhưng gỡ bé CỦA MÌNH thì được.
    await goKhoiCase(sale(SALE2), (await mucCua(cua1, "C", 7)).id);
    expect((await need("C", 7)).status).toBe("PENDING");
  });

  it("[PQ-04] Sale huỷ / sửa case chỉ khi MỌI bé còn trong case là của mình; case có bé của Sale khác ⇒ chỉ quản lý", async () => {
    const c = await tao(sale(SALE1), [needId("B", 7)]);
    await xepVaoCaseCoSan(sale(SALE2), { caseId: c, needIds: [needId("C", 7)] });
    const v = (await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).version;
    expect(await lyDoLoi(huyCase(sale(SALE1), c))).toBe(CAU_KHONG_CUA_SALE);
    expect(await lyDoLoi(suaCase(sale(SALE1), { caseId: c, phienBan: v, note: "đổi", ten: "S1", now: NOW }))).toBe(CAU_KHONG_CUA_SALE);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("SCHEDULED");
    // Quản lý (chiCuaSale = null) thì không bị buộc.
    await suaCase(QUAN_LY, { caseId: c, phienBan: v, note: "quản lý sửa", ten: "QL", now: NOW });
    // Bé của Sale 2 rời đi ⇒ còn mỗi bé của Sale 1 ⇒ Sale 1 huỷ được case.
    await goBeKhoiCase(QUAN_LY, (await beCua(c, "C")).id);
    await huyCase(sale(SALE1), c);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("CANCELLED");
  });

  it("[PQ-05] quản lý (chiCuaSale = null) làm được trên học viên của MỌI Sale trong tầm nhìn — phạm vi không phải cờ 'chặn hết'", async () => {
    const c = await tao(QUAN_LY, [needId("A", 5), needId("C", 7)], { teacherId: GV });
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c } })).toBe(2);
    await goBeKhoiCase(QUAN_LY, (await beCua(c, "C")).id);
    await huyCase(QUAN_LY, c);
    expect((await need("A", 5)).status).toBe("PENDING");
  });

  it("[PQ-07] case ĐỜI CŨ chưa nâng cấp (bé nằm ở mục, chưa có participant): cổng 'có bé của Sale khác' vẫn nhìn thấy họ — Sale 1 không huỷ / sửa được", async () => {
    const CU = id("case-cu-pq");
    await db.makeupCase.create({
      data: { id: CU, centerId: CS, courseId: id("khoa"), lessonId: id("bai7"), date: new Date(Date.UTC(2026, 9, 15)), startTime: "18:00", endTime: "19:30", teacherId: GV, status: "SCHEDULED", createdById: SALE1 },
    });
    await db.makeupNeed.updateMany({ where: { id: { in: [needId("B", 7), needId("C", 7)] } }, data: { status: "SCHEDULED" } });
    await db.makeupCaseStudent.createMany({
      data: [
        { id: id("pq-b7"), caseId: CU, makeupNeedId: needId("B", 7), status: "PLACED", dungLuot: false, centerId: CS, addedById: SALE1 },
        { id: id("pq-c7"), caseId: CU, makeupNeedId: needId("C", 7), status: "PLACED", dungLuot: false, centerId: CS, addedById: SALE1 },
      ],
    });
    expect(await db.makeupCaseParticipant.count({ where: { caseId: CU } })).toBe(0);
    expect(await lyDoLoi(huyCase(sale(SALE1), CU))).toBe(CAU_KHONG_CUA_SALE);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: CU } })).status).toBe("SCHEDULED");
    const v = (await db.makeupCase.findUniqueOrThrow({ where: { id: CU } })).version;
    expect(await lyDoLoi(suaCase(sale(SALE1), { caseId: CU, phienBan: v, note: "x", ten: "S1", now: NOW }))).toBe(CAU_KHONG_CUA_SALE);
    // Sale 2 (chỉ có bé C trong số hai) cũng bị chặn; quản lý thì huỷ được.
    expect(await lyDoLoi(huyCase(sale(SALE2), CU))).toBe(CAU_KHONG_CUA_SALE);
    await huyCase(QUAN_LY, CU);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: CU } })).status).toBe("CANCELLED");
  });

  it("[PQ-06] giáo viên thường đi vào action của admin: chỉ điểm danh / đánh giá / gửi bài case MÌNH dạy — GV khác (kể cả cùng cơ sở) bị từ chối, không đổi gì", async () => {
    const c = await tao(QUAN_LY, [needId("C", 7)]); // do GV dạy
    const be = await beCua(c, "C");
    const m = await mucCua(c, "C", 7);
    const dd = (nguoi: ReturnType<typeof gvThuong>, chiGv: string) =>
      diemDanhBe(nguoi as never, { participantId: be.id, coMat: true, ketQuaMuc: { [m.id]: { ketQua: "COMPLETED", danhGia: null } }, nhanXetChung: null, chiGiaoVien: chiGv, now: NOW });
    expect(await lyDoLoi(dd(gvThuong(GV2), GV2))).toContain("không phải giáo viên");
    expect((await beCua(c, "C")).attendanceStatus).toBe("PENDING");
    expect(await so("C")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    await dd(gvThuong(GV), GV);
    expect((await beCua(c, "C")).attendanceStatus).toBe("PRESENT");
    // Đánh giá + vỏ cũ + gửi bài cũng bị buộc.
    expect(await lyDoLoi(ghiDanhGiaMuc(gvThuong(GV2) as never, { caseStudentId: m.id, danhGia: "x", chiGiaoVien: GV2, ten: "GV2" }))).toContain("không phải giáo viên");
    expect(await lyDoLoi(diemDanhBu(gvThuong(GV2) as never, { caseStudentId: m.id, coMat: true, chiGiaoVien: GV2, now: NOW }))).not.toBeNull();
    expect(await lyDoLoi(guiBaiKiemTraBu({ caseId: c, examId: "khong-co", byUserId: GV2, chiGiaoVien: GV2, now: NOW }))).toContain("không phải giáo viên");
    // Quản lý (chiGiaoVien không khai) vẫn được đánh giá hộ.
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: m.id, danhGia: "Quản lý ghi hộ", ten: "QL" });
    expect((await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: m.id } })).teacherEvaluation).toBe("Quản lý ghi hộ");
  });
});
