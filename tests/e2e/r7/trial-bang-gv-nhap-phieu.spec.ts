/**
 * TRIAL-BẢNG-GV — sự cố 04/09/2026: "xếp buổi trial chọn giáo viên, nhưng ở site giáo
 * viên không thấy trong danh sách trial để nhập phiếu".
 *
 * Service-level trên Postgres LOCAL (.env.test), KHÔNG dùng trình duyệt — job CI
 * "E2E Phase R7" cố ý không cài browser (bước `playwright install` từng treo apt 19 phút
 * và giết cả job). Cùng mẫu với `trial-session-fixes.spec.ts` cạnh đây.
 *
 * HAI lỗi độc lập, cả hai đều làm bảng RỖNG SẠCH:
 *
 *  A. `getTeacherTrialTable` lọc `scheduledSessionId: { in: [...] }`. `in` không bao giờ
 *     khớp NULL, mà từ 28/08 (gỡ auto-gán buổi) mọi ghi danh tạo qua giao diện admin đều
 *     mang null — cả hai màn xếp chỗ (`trial-enroll-widget`, `enroll-panel`) đều không
 *     truyền `sessionId`. Ca thường gặp nhất chính là ca bị loại.
 *
 *  B. Câu tra buổi chỉ có HAI nhánh own-rows (`teacherId`, `trialClass.teacherId`), thiếu
 *     nhánh `gvPhanCongId` mà `getTeacherTrialRoster` có từ GĐ3 — trong khi docblock của
 *     chính nó đã khai "own-rows y như getTeacherTrialRoster". Giáo viên được Đào tạo
 *     phân công theo TỪNG CA thấy 0 buổi ⇒ rỗng KỂ CẢ khi ghi danh đã gắn buổi.
 *
 * Và một lỗi thứ ba chỉ lộ ra SAU khi vá A: cờ `evaluated` khoá theo CA trong khi phiếu
 * khoá theo CẶP (ca, buổi). Em học cả lớp cần N phiếu; chấm xong buổi 1 là cả ca hoá
 * "đã đánh giá" vĩnh viễn và giáo viên không bao giờ được nhắc chấm buổi 2..N.
 *
 * [T-05] là ca quan trọng nhất: nó chốt HỢP ĐỒNG giữa hai hàm. Nới bảng mà quên chở
 * `sessionId` lên link thì cổng sở hữu của phiếu mất hai nhánh cuối và giáo viên bấm vào
 * ra "Buổi Trial không thuộc bạn phụ trách" — đổi từ "không thấy gì" sang "thấy rồi bấm
 * vào lỗi", tệ hơn lúc đầu.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import {
  createTrialClass,
  addTrialSession,
  enrollLeadChild,
  vnTodayUtc,
} from "../../../lib/trial/service";
import {
  getTeacherTrialTable,
  getTeacherTrialRubricContext,
} from "../../../lib/lms/teacher-schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
const plusDays = (n: number) => new Date(vnTodayUtc().getTime() + n * DAY_MS);

test.describe("[TRIAL-BẢNG] Giáo viên phải thấy suất Trial để nhập phiếu", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  async function seedCenter(code = "CS1") {
    return db.center.create({
      data: { code, name: `Cơ sở ${code}`, slug: `cs-${code.toLowerCase()}-${uniq()}`, address: "x" },
    });
  }
  async function seedTeacher(centerId: string, tag = "gv") {
    return seedUser({ email: `${tag}-${uniq()}@test.com`, role: "TEACHER", name: `GV ${tag}`, centerId });
  }
  async function seedSale(centerId: string) {
    return seedUser({ email: `sale-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale", centerId });
  }
  async function seedLeadChild(centerId: string, childName: string) {
    const lead = await db.lead.create({
      data: { parentName: "PH Trial", phone: `090${String(seq++).padStart(7, "0")}`, centerId },
    });
    const child = await db.leadChild.create({ data: { leadId: lead.id, fullName: childName } });
    return { lead, child };
  }
  async function seedTrialClass(centerId: string, actorId: string) {
    const res = await createTrialClass({ centerId, actorId });
    expect(res.ok).toBe(true);
    return res.trialClassId!;
  }
  async function themBuoi(
    trialClassId: string,
    ngay: Date,
    teacherId: string | null,
    actorId: string,
  ) {
    const res = await addTrialSession({
      trialClassId,
      date: ngay,
      startTime: "18:00",
      endTime: "19:30",
      teacherId,
      actorId,
    });
    expect(res.ok).toBe(true);
    return res.sessionId!;
  }
  /** Đúng đường mà giao diện admin đi: KHÔNG truyền sessionId. */
  async function xepEmVaoLop(trialClassId: string, leadChildId: string, actorId: string) {
    const res = await enrollLeadChild({ trialClassId, leadChildId, addedById: actorId });
    expect(res.ok).toBe(true);
    return res;
  }
  const bang = (teacherId: string) =>
    getTeacherTrialTable(teacherId, { today: vnTodayUtc(), days: 7 });

  test("[T-01] HỒI QUY GỐC: xếp em qua đúng đường giao diện (không truyền sessionId) → GV vẫn thấy dòng", async () => {
    const center = await seedCenter();
    const gv = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, sale.id);
    await themBuoi(classId, plusDays(2), gv.id, sale.id);
    const { child } = await seedLeadChild(center.id, "Bé An");
    await xepEmVaoLop(classId, child.id, sale.id);

    // Chốt tiền đề: ghi danh THẬT SỰ mang null — nếu ngày nào đó auto-gán quay lại thì
    // test này phải đỏ để người sửa biết tiền đề đã đổi, chứ không xanh giả.
    const enr = await db.trialEnrollment.findFirstOrThrow({ where: { leadChildId: child.id } });
    expect(enr.scheduledSessionId).toBeNull();

    const t = await bang(gv.id);
    expect(t.upcoming.length + t.done.length).toBe(1);
    const row = [...t.upcoming, ...t.done][0]!;
    expect(row.studentName).toBe("Bé An");
    expect(row.hocCaLop).toBe(true);
    // Mọi dòng phải có ngày giờ — chốt 26/08 cấm bày dòng trống ngày ở site GV.
    expect(row.date).not.toBeNull();
    expect(row.sessionId).toBeTruthy();
  });

  test("[T-02] buổi còn ở tương lai → dòng nằm bảng 'sắp Trial', không rơi xuống 'Đã Trial'", async () => {
    const center = await seedCenter();
    const gv = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, sale.id);
    await themBuoi(classId, plusDays(-5), gv.id, sale.id);
    const idSapToi = await themBuoi(classId, plusDays(3), gv.id, sale.id);
    const { child } = await seedLeadChild(center.id, "Bé Bình");
    await xepEmVaoLop(classId, child.id, sale.id);

    const t = await bang(gv.id);
    expect(t.upcoming).toHaveLength(1);
    expect(t.done).toHaveLength(0);
    // Buổi đại diện là buổi GẦN NHẤT CHƯA QUA, không phải buổi đầu tiên của lớp.
    expect(t.upcoming[0]!.sessionId).toBe(idSapToi);
  });

  test("[T-03] chỉ còn buổi đã qua → rơi xuống 'Đã Trial' với buổi CUỐI đã qua", async () => {
    const center = await seedCenter();
    const gv = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, sale.id);
    await themBuoi(classId, plusDays(-9), gv.id, sale.id);
    const idCuoi = await themBuoi(classId, plusDays(-2), gv.id, sale.id);
    const { child } = await seedLeadChild(center.id, "Bé Cường");
    await xepEmVaoLop(classId, child.id, sale.id);

    const t = await bang(gv.id);
    expect(t.upcoming).toHaveLength(0);
    expect(t.done).toHaveLength(1);
    expect(t.done[0]!.sessionId).toBe(idCuoi);
  });

  test("[T-04] LỖ gvPhanCongId: lớp của GV khác, buổi không ghi GV, nhưng ca phân công đích danh → vẫn thấy", async () => {
    const center = await seedCenter();
    const gvChinh = await seedTeacher(center.id, "chinh");
    const gvDuocGiao = await seedTeacher(center.id, "duoc-giao");
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, sale.id);
    await themBuoi(classId, plusDays(2), null, sale.id);
    await db.trialClassV2.update({ where: { id: classId }, data: { teacherId: gvChinh.id } });

    const { child: emCuaToi } = await seedLeadChild(center.id, "Bé Của Tôi");
    const { child: emNguoiKhac } = await seedLeadChild(center.id, "Bé Người Khác");
    await xepEmVaoLop(classId, emCuaToi.id, sale.id);
    await xepEmVaoLop(classId, emNguoiKhac.id, sale.id);
    await db.trialEnrollment.updateMany({
      where: { leadChildId: emCuaToi.id },
      data: { gvPhanCongId: gvDuocGiao.id },
    });
    await db.trialEnrollment.updateMany({
      where: { leadChildId: emNguoiKhac.id },
      data: { gvPhanCongId: gvChinh.id },
    });

    const t = await bang(gvDuocGiao.id);
    const ten = [...t.upcoming, ...t.done].map((r) => r.studentName);
    // Thấy ca của mình…
    expect(ten).toContain("Bé Của Tôi");
    // …và KHÔNG thấy ca của người khác trong cùng lớp. Đây là bẫy khi bê nguyên dạng
    // truy vấn của roster (`trialClass: { enrollments: { some: {...} } }`): nó kéo cả lớp
    // về, dòng hiện ra rồi bấm vào báo "không thuộc bạn phụ trách".
    expect(ten).not.toContain("Bé Người Khác");
  });

  test("[T-05] HỢP ĐỒNG: mọi dòng bảng trả về đều mở được phiếu VÀ lưu được", async () => {
    const center = await seedCenter();
    const gvLop = await seedTeacher(center.id, "gv-lop");
    const gvBuoi = await seedTeacher(center.id, "gv-buoi");
    const sale = await seedSale(center.id);

    // Lớp 1: GV chính là gvLop, buổi không ghi GV.
    const lop1 = await seedTrialClass(center.id, sale.id);
    await themBuoi(lop1, plusDays(2), null, sale.id);
    await db.trialClassV2.update({ where: { id: lop1 }, data: { teacherId: gvLop.id } });
    const { child: e1 } = await seedLeadChild(center.id, "Bé Một");
    await xepEmVaoLop(lop1, e1.id, sale.id);

    // Lớp 2: GV chính là người khác, nhưng gvBuoi dạy đích danh một buổi.
    const lop2 = await seedTrialClass(center.id, sale.id);
    await themBuoi(lop2, plusDays(4), gvBuoi.id, sale.id);
    await db.trialClassV2.update({ where: { id: lop2 }, data: { teacherId: gvLop.id } });
    const { child: e2 } = await seedLeadChild(center.id, "Bé Hai");
    await xepEmVaoLop(lop2, e2.id, sale.id);

    for (const gv of [gvLop, gvBuoi]) {
      const t = await bang(gv.id);
      const rows = [...t.upcoming, ...t.done];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const ctx = await getTeacherTrialRubricContext(gv.id, row.enrollmentId, row.sessionId);
        // null ⇒ màn "Buổi Trial không thuộc bạn phụ trách".
        expect(ctx, `GV ${gv.email} bấm vào ${row.studentName} mà ra NotYours`).not.toBeNull();
        // null ⇒ mở được phiếu nhưng bấm Lưu bị từ chối "Chưa chọn buổi để chấm".
        expect(ctx!.trialClassSessionId, `phiếu của ${row.studentName} không gắn buổi`).toBeTruthy();
      }
    }
  });

  test("[T-06] cờ 'đã đánh giá' khoá theo CẶP (ca, buổi) — chấm buổi 1 không khoá buổi 2", async () => {
    const center = await seedCenter();
    const gv = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, sale.id);
    const buoi1 = await themBuoi(classId, plusDays(2), gv.id, sale.id);
    const buoi2 = await themBuoi(classId, plusDays(5), gv.id, sale.id);
    const { child } = await seedLeadChild(center.id, "Bé Dũng");
    await xepEmVaoLop(classId, child.id, sale.id);
    const enr = await db.trialEnrollment.findFirstOrThrow({ where: { leadChildId: child.id } });

    // Chấm xong buổi 1.
    await db.trialRubricEval.create({
      data: {
        trialEnrollmentId: enr.id,
        trialClassSessionId: buoi1,
        scores: {},
        totalScore: 7,
        rank: "Khá",
        evaluatedById: gv.id,
      },
    });

    // Buổi đại diện lúc này vẫn là buổi 1 (gần nhất chưa qua) ⇒ đã đánh giá.
    let t = await bang(gv.id);
    let row = [...t.upcoming, ...t.done][0]!;
    expect(row.sessionId).toBe(buoi1);
    expect(row.evaluated).toBe(true);

    // Buổi 1 trôi vào quá khứ ⇒ đại diện chuyển sang buổi 2, và buổi 2 CHƯA có phiếu.
    await db.trialClassSession.update({
      where: { id: buoi1 },
      data: { date: plusDays(-1) },
    });
    t = await bang(gv.id);
    row = [...t.upcoming, ...t.done].find((r) => r.sessionId === buoi2)!;
    expect(row, "buổi 2 phải còn trong bảng").toBeTruthy();
    // Khoá theo CA thì chỗ này là true và giáo viên không bao giờ được nhắc chấm buổi 2.
    expect(row.evaluated).toBe(false);
  });

  test("[T-07] không rò rỉ: GV không liên quan → 0 dòng; lead xoá mềm → 0 dòng", async () => {
    const center = await seedCenter();
    const gv = await seedTeacher(center.id, "co-lien-quan");
    const gvLa = await seedTeacher(center.id, "khong-lien-quan");
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, sale.id);
    await themBuoi(classId, plusDays(2), gv.id, sale.id);
    const { lead, child } = await seedLeadChild(center.id, "Bé Én");
    await xepEmVaoLop(classId, child.id, sale.id);

    const cuaNguoiLa = await bang(gvLa.id);
    expect(cuaNguoiLa.upcoming.length + cuaNguoiLa.done.length).toBe(0);

    // `aliveLead` phải áp cho CẢ nhánh mới, không chỉ nhánh cũ.
    await db.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
    const sauKhiXoa = await bang(gv.id);
    expect(sauKhiXoa.upcoming.length + sauKhiXoa.done.length).toBe(0);
  });
});
