/**
 * TRIAL-CASE-GATES — các cổng GHI của mô hình "case trial" (23/09/2026).
 * Postgres LOCAL. Service-level: gọi thẳng lib/trial/service + lib/lms/teacher-schedule,
 * không dựng HTTP (mẫu của trial-session-fixes.spec.ts). Không dùng `page` — job R7 không
 * cài trình duyệt.
 *
 * VÌ SAO CÓ SPEC NÀY. Một lượt kiểm chứng trên app thật (23/09) tìm ra các cửa ghi không
 * giữ luật mà màn hình hứa: điểm danh nhận bé của case KHÁC (chỉ kiểm cùng lớp), "Hoàn
 * tất" hồi sinh case ĐÃ HUỶ, gắn được bé vào case đã huỷ / lớp đã huỷ, và site giáo viên
 * rải bé "chưa xếp case" vào ca của MỌI giáo viên. Bộ unit của các hàm thuần xanh suốt —
 * luật sống ở tầng DB nên chỉ tầng này bắt được.
 *
 * Mỗi ca dựng lớp của RIÊNG nó sau `resetDb()` (luật 18 — xanh khi chạy một mình). Ngày
 * tính TƯƠNG ĐỐI từ hôm nay như spec anh em, nên không có ngày tuyệt đối nào để hẹn giờ
 * nổ (luật 19).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import {
  createTrialClass,
  addTrialSession,
  enrollLeadChild,
  markAttendance,
  completeTrialSession,
  cancelTrialClass,
  goHocVienKhoiCase,
  rescheduleTrialEnrollment,
  doiBeVangSangLopKhac,
  unenrollLeadChild,
  vnTodayUtc,
} from "../../../lib/trial/service";
import { huyCaseNeuTrong } from "../../../lib/trial/huy-case-trong-db";
import { loadBuoiDay } from "../../../lib/cham-cong/cong-day-db";
import { getTeacherTrialTable, getTeacherTrialRubricContext } from "../../../lib/lms/teacher-schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
const plusDays = (n: number) => new Date(vnTodayUtc().getTime() + n * DAY_MS);

test.describe("[TCG] cổng ghi của case trial", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  async function nen() {
    const center = await db.center.create({
      data: { code: "CS1", name: "Cơ sở CS1", slug: `cs1-${uniq()}`, address: "x" },
    });
    const gv1 = await seedUser({ email: `gv1-${uniq()}@test.com`, role: "TEACHER", name: "GV Một", centerId: center.id });
    const gv2 = await seedUser({ email: `gv2-${uniq()}@test.com`, role: "TEACHER", name: "GV Hai", centerId: center.id });
    const sale = await seedUser({ email: `sale-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale", centerId: center.id });
    return { center, gv1, gv2, sale };
  }

  /**
   * Lớp THEO KHUNG (mô hình case) hoặc lớp slot CŨ. Lớp theo khung mang đủ ngày + khung;
   * lớp cũ để null cả ba — đúng hình dạng hai loại lớp đang cùng tồn tại.
   */
  async function lop(centerId: string, actorId: string, theoKhung: boolean) {
    const res = await createTrialClass({ centerId, actorId });
    expect(res.ok).toBe(true);
    const id = res.trialClassId!;
    // 27/10 (chốt lượt 2 điểm 1): buổi Trial MỚI bắt buộc phòng — lớp có phòng để buổi kế thừa.
    const phong = await db.room.create({ data: { name: "Phòng trial", code: `p-${id}`, centerId }, select: { id: true } });
    await db.trialClassV2.update({ where: { id }, data: { roomId: phong.id } });
    if (theoKhung) {
      await db.trialClassV2.update({
        where: { id },
        data: { startDate: plusDays(2), startTime: "17:30", endTime: "21:00", theoKhung: true },
      });
    }
    return id;
  }

  async function caseCua(trialClassId: string, teacherId: string, startTime: string, endTime: string, actorId: string) {
    const r = await addTrialSession({ trialClassId, date: plusDays(2), startTime, endTime, teacherId, actorId });
    expect(r.ok).toBe(true);
    return r.sessionId!;
  }

  async function be(centerId: string, ten: string) {
    const lead = await db.lead.create({
      data: { parentName: `PH ${ten}`, phone: `09${String(10_000_000 + seq++).padStart(8, "0")}`, centerId },
    });
    return db.leadChild.create({ data: { leadId: lead.id, fullName: ten } });
  }

  async function ghiDanh(trialClassId: string, leadChildId: string, sessionId: string | null, addedById: string) {
    const r = await enrollLeadChild({ trialClassId, leadChildId, addedById, sessionId });
    expect(r.ok, r.error).toBe(true);
    return db.trialEnrollment.findFirstOrThrow({ where: { trialClassId, leadChildId, status: "ACTIVE" } });
  }

  test("[TCG-01] điểm danh bé của case A vào case B (cùng lớp) ⇒ TỪ CHỐI, không sinh dòng", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const caseB = await caseCua(lopId, gv2.id, "18:00", "19:00", sale.id);
    const an = await be(center.id, "Bé An");
    const enr = await ghiDanh(lopId, an.id, caseA, sale.id);

    const r = await markAttendance({ trialSessionId: caseB, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("không thuộc case này");
    // Không có dòng nào ở case B — đây mới là thứ thổi số buổi đã dự.
    expect(await db.trialAttendance.count({ where: { trialSessionId: caseB } })).toBe(0);

    // Và đúng case thì vẫn điểm danh được — cổng không nuốt ca thật.
    const ok = await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(ok.ok, ok.error).toBe(true);
  });

  test("[TCG-02] lớp THEO KHUNG: bé chưa xếp case (NULL) ⇒ không điểm danh được ở case nào", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const binh = await be(center.id, "Bé Bình");
    const enr = await ghiDanh(lopId, binh.id, null, sale.id);

    const r = await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(r.ok).toBe(false);
    expect(await db.trialAttendance.count({ where: { trialEnrollmentId: enr.id } })).toBe(0);
  });

  test("[TCG-03] lớp CŨ: bé NULL (học cả lớp, chốt 28/08) ⇒ VẪN điểm danh được ở mọi buổi", async () => {
    // Ca canh HỒI QUY trên dữ liệu prod: gần như mọi ghi danh từ 28/08 đều NULL ở lớp cũ.
    // Nếu ca này đỏ thì bản vá đã rút cả loạt bé thật khỏi bảng điểm danh.
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, false);
    const b1 = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const b2 = await caseCua(lopId, gv2.id, "18:30", "19:30", sale.id);
    const chi = await be(center.id, "Bé Chi");
    const enr = await ghiDanh(lopId, chi.id, null, sale.id);

    for (const buoi of [b1, b2]) {
      const r = await markAttendance({ trialSessionId: buoi, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
      expect(r.ok, r.error).toBe(true);
    }
  });

  test("[TCG-04] buổi ĐÃ HUỶ: không điểm danh, không 'Hoàn tất' (không hồi sinh)", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const dung = await be(center.id, "Bé Dũng");
    const enr = await ghiDanh(lopId, dung.id, caseA, sale.id);
    await db.trialClassSession.update({ where: { id: caseA }, data: { status: "CANCELLED" } });

    const diemDanh = await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(diemDanh.ok).toBe(false);
    expect(await db.trialAttendance.count({ where: { trialSessionId: caseA } })).toBe(0);

    const hoanTat = await completeTrialSession({ trialSessionId: caseA, actorId: sale.id });
    expect(hoanTat.ok).toBe(false);
    const sau = await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } });
    expect(sau.status).toBe("CANCELLED");
  });

  test("[TCG-05] gắn bé vào case ĐÃ HUỶ ⇒ TỪ CHỐI, không để lại ghi danh ACTIVE", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    await db.trialClassSession.update({ where: { id: caseA }, data: { status: "CANCELLED" } });
    const em = await be(center.id, "Bé Em");

    const r = await enrollLeadChild({ trialClassId: lopId, leadChildId: em.id, addedById: sale.id, sessionId: caseA });
    expect(r.ok).toBe(false);
    expect(await db.trialEnrollment.count({ where: { leadChildId: em.id, status: "ACTIVE" } })).toBe(0);
  });

  test("[TCG-06] gắn bé vào LỚP ĐÃ HUỶ ⇒ TỪ CHỐI (case vẫn SCHEDULED sau khi huỷ lớp)", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const huy = await cancelTrialClass({ trialClassId: lopId, actorId: sale.id });
    expect(huy.ok).toBe(true);
    // Điều kiện làm lộ lỗi: huỷ lớp KHÔNG huỷ buổi, nên nếu cổng chỉ nhìn buổi thì lọt.
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } })).status).toBe("SCHEDULED");

    const giang = await be(center.id, "Bé Giang");
    const r = await enrollLeadChild({ trialClassId: lopId, leadChildId: giang.id, addedById: sale.id, sessionId: caseA });
    expect(r.ok).toBe(false);
    expect(await db.trialEnrollment.count({ where: { leadChildId: giang.id, status: "ACTIVE" } })).toBe(0);
  });

  test("[TCG-07] site GV: bé chưa xếp case ở lớp THEO KHUNG KHÔNG hiện trong ca của giáo viên", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    await caseCua(lopId, gv2.id, "18:00", "19:00", sale.id);
    const ha = await be(center.id, "Bé Hà");
    await ghiDanh(lopId, ha.id, null, sale.id);

    // Trước bản vá: bé hiện ở CẢ HAI giáo viên, và cả hai đều nhập phiếu được.
    for (const gv of [gv1, gv2]) {
      const bang = await getTeacherTrialTable(gv.id, { today: vnTodayUtc(), days: 7 });
      const ten = [...bang.upcoming, ...bang.done].map((r) => r.studentName);
      expect(ten, `giáo viên ${gv.email}`).not.toContain("Bé Hà");
    }
  });

  test("[TCG-08] site GV: lớp CŨ vẫn giữ nghĩa 'học cả lớp' — bé NULL hiện với giáo viên của lớp", async () => {
    // Ca canh hồi quy: đây là hình dạng dữ liệu thật trên prod.
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, false);
    await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const khoa = await be(center.id, "Bé Khoa");
    await ghiDanh(lopId, khoa.id, null, sale.id);

    const bang = await getTeacherTrialTable(gv1.id, { today: vnTodayUtc(), days: 7 });
    expect([...bang.upcoming, ...bang.done].map((r) => r.studentName)).toContain("Bé Khoa");
  });

  test("[TCG-10] lớp CŨ tạo TRƯỚC 28/08 (vẫn mang ngày + giờ cấp lớp): bé NULL vẫn là HỌC CẢ LỚP", async () => {
    // Hình dạng THẬT trên prod mà TCG-03/TCG-08 không phủ (hai ca đó dựng lớp không giờ):
    // migration 28/08 chỉ DROP NOT NULL, giữ nguyên giờ cấp lớp của lớp cũ. Bản vá đầu
    // suy "có giờ ⇒ theo khung" và đổi nghĩa bé NULL của các lớp này — đo được trên lớp
    // UAT `uat-lopthu-CS1-1`. Ca này giữ: GV thấy bé, và điểm danh được.
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, false);
    await db.trialClassV2.update({
      where: { id: lopId },
      data: { startDate: plusDays(-40), startTime: "14:00", endTime: "19:00", theoKhung: false },
    });
    const buoi = await caseCua(lopId, gv1.id, "08:30", "10:00", sale.id);
    const tam = await be(center.id, "Bé Tâm");
    const enr = await ghiDanh(lopId, tam.id, null, sale.id);

    const bang = await getTeacherTrialTable(gv1.id, { today: vnTodayUtc(), days: 7 });
    expect([...bang.upcoming, ...bang.done].map((r) => r.studentName)).toContain("Bé Tâm");
    const r = await markAttendance({ trialSessionId: buoi, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
  });

  test("[TCG-11] phiếu qua URL: GV có case trong lớp KHÔNG mở được phiếu của bé ở case GV khác", async () => {
    // Đo được 23/09: GV1 kèm `sessionId` = case của mình vào URL phiếu của bé thuộc case
    // song song của GV2, và phiếu mở ra (lưu cũng đi qua đúng cổng này).
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseGv1 = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const caseGv2 = await caseCua(lopId, gv2.id, "18:00", "19:00", sale.id);
    const dung = await be(center.id, "Bé Dũng");
    const enr = await ghiDanh(lopId, dung.id, caseGv2, sale.id);

    expect(await getTeacherTrialRubricContext(gv1.id, enr.id, caseGv1)).toBeNull();
    // GV của đúng case thì vẫn mở được — cổng không nuốt ca thật.
    expect(await getTeacherTrialRubricContext(gv2.id, enr.id, caseGv2)).not.toBeNull();
  });

  test("[TCG-12] phiếu: bé trỏ vào case ĐÃ HUỶ ⇒ GV của case huỷ KHÔNG còn là người chấm", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const quan = await be(center.id, "Bé Quân");
    const enr = await ghiDanh(lopId, quan.id, caseA, sale.id);
    await db.trialClassSession.update({ where: { id: caseA }, data: { status: "CANCELLED" } });
    expect(await getTeacherTrialRubricContext(gv1.id, enr.id)).toBeNull();
    expect(await getTeacherTrialRubricContext(gv1.id, enr.id, caseA)).toBeNull();
  });

  test("[TCG-09] lớp THEO KHUNG: xếp bé mà chưa chọn case ⇒ KHÔNG báo nhầm giáo viên nào", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const truocKhi = await db.staffNotification.count({ where: { userId: gv1.id } });
    const lan = await be(center.id, "Bé Lan");
    await ghiDanh(lopId, lan.id, null, sale.id);
    // Chưa có case ⇒ chưa có ai dạy bé. Bản cũ báo GV của buổi sắp tới "học toàn bộ buổi".
    expect(await db.staffNotification.count({ where: { userId: gv1.id } })).toBe(truocKhi);
  });

  test("[TCG-13] gỡ khỏi CASE ⇒ bé về \"Chưa xếp case\" (vẫn ở lớp), hết phân công GV theo ca", async () => {
    // Chủ dự án 23/09: "học viên khi bị gỡ khỏi case thì phải về chưa xếp case".
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const mai = await be(center.id, "Bé Mai");
    const enr = await ghiDanh(lopId, mai.id, caseA, sale.id);

    const r = await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCu?.id).toBe(caseA);
    expect(r.caseCu?.teacherId).toBe(gv1.id);

    const sau = await db.trialEnrollment.findUniqueOrThrow({ where: { id: enr.id } });
    expect(sau.status).toBe("ACTIVE"); // vẫn trong LỚP
    expect(sau.scheduledSessionId).toBeNull(); // nhưng không còn thuộc case nào
    expect(sau.gvPhanCongId).toBeNull();
    // 22/10/2026 — Mai là bé DUY NHẤT ⇒ case trống TỰ HUỶ (chi tiết ở [TRIAL-EMPTY-01]).
    expect(r.caseCuDaHuy?.id).toBe(caseA);

    // Gỡ lần hai: bé đã ở "Chưa xếp case" ⇒ từ chối, không phải "thành công" câm.
    const lan2 = await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id });
    expect(lan2.ok).toBe(false);
  });

  test("[TCG-14] lớp THEO KHUNG: bé đã điểm danh ở case ⇒ KHÔNG gỡ khỏi case được", async () => {
    // Gỡ rồi xếp sang case khác điểm danh lại là đếm trùng buổi đã dự.
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const nam = await be(center.id, "Bé Nam");
    const enr = await ghiDanh(lopId, nam.id, caseA, sale.id);
    const dd = await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(dd.ok, dd.error).toBe(true);

    const r = await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("đã được điểm danh");
    const sau = await db.trialEnrollment.findUniqueOrThrow({ where: { id: enr.id } });
    expect(sau.scheduledSessionId).toBe(caseA);
  });

  test("[TCG-15] lớp CŨ: gỡ khỏi buổi riêng ⇒ bé về học cả lớp, kể cả khi đã điểm danh", async () => {
    // Lớp cũ: NULL = học toàn bộ buổi (chốt 28/08), nên điểm danh đã có vẫn thuộc về bé
    // — cổng "đã điểm danh" chỉ dành cho lớp theo khung.
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, false);
    const b1 = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const oanh = await be(center.id, "Bé Oanh");
    const enr = await ghiDanh(lopId, oanh.id, b1, sale.id);
    const dd = await markAttendance({ trialSessionId: b1, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(dd.ok, dd.error).toBe(true);

    const r = await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    const sau = await db.trialEnrollment.findUniqueOrThrow({ where: { id: enr.id } });
    expect(sau.status).toBe("ACTIVE");
    expect(sau.scheduledSessionId).toBeNull();
  });

  // ── 21/10/2026 — case không bé nào có mặt ⇒ TỰ HUỶ, GV không công (`lib/trial/ket-cuc-case.ts`) ──

  test("[TCG-16] 'Hoàn tất' case mà bé duy nhất VẮNG ⇒ case CANCELLED (không phải COMPLETED), trả lý do", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Vắng")).id, caseA, sale.id);
    expect((await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "ABSENT", actorId: sale.id })).ok).toBe(true);

    const r = await completeTrialSession({ trialSessionId: caseA, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.daHuy).toBeTruthy();
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } })).status).toBe("CANCELLED");
    // Bằng chứng vắng giữ nguyên.
    expect(await db.trialAttendance.count({ where: { trialSessionId: caseA, status: "ABSENT" } })).toBe(1);
  });

  test("[TCG-17] 'Hoàn tất' case có ≥1 bé có mặt ⇒ COMPLETED như cũ (bé khác vắng không kéo huỷ)", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const co = await ghiDanh(lopId, (await be(center.id, "Bé Có")).id, caseA, sale.id);
    const vang = await ghiDanh(lopId, (await be(center.id, "Bé Vắng")).id, caseA, sale.id);
    await markAttendance({ trialSessionId: caseA, trialEnrollmentId: co.id, status: "PRESENT", actorId: sale.id });
    await markAttendance({ trialSessionId: caseA, trialEnrollmentId: vang.id, status: "ABSENT", actorId: sale.id });

    const r = await completeTrialSession({ trialSessionId: caseA, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.daHuy).toBeUndefined();
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } })).status).toBe("COMPLETED");
  });

  test("[TCG-18] dời bé DUY NHẤT (đã vắng) sang case khác ⇒ case cũ TỰ HUỶ — kể cả case cũ đã lỡ COMPLETED", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const caseB = await caseCua(lopId, gv2.id, "19:00", "20:00", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Dời")).id, caseA, sale.id);
    await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "ABSENT", actorId: sale.id });
    // Hình dạng dữ liệu prod 18/10: case toàn vắng đã bị bấm hoàn tất trước khi có luật.
    await db.trialClassSession.update({ where: { id: caseA }, data: { status: "COMPLETED" } });

    const r = await rescheduleTrialEnrollment({ trialEnrollmentId: enr.id, toSessionId: caseB, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy?.id).toBe(caseA);
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } })).status).toBe("CANCELLED");
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: caseB } })).status).toBe("SCHEDULED");
  });

  test("[TCG-19] dời một bé khi case cũ CÒN bé khác ⇒ case cũ giữ nguyên", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const caseB = await caseCua(lopId, gv2.id, "19:00", "20:00", sale.id);
    const di = await ghiDanh(lopId, (await be(center.id, "Bé Đi")).id, caseA, sale.id);
    await ghiDanh(lopId, (await be(center.id, "Bé Ở")).id, caseA, sale.id);

    const r = await rescheduleTrialEnrollment({ trialEnrollmentId: di.id, toSessionId: caseB, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toBeUndefined();
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } })).status).toBe("SCHEDULED");
  });

  test("[TCG-20] lớp CŨ: dời bé khỏi buổi ⇒ buổi cũ KHÔNG bị huỷ (NULL = học cả lớp, không đếm được 'trống')", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, false);
    const b1 = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const b2 = await caseCua(lopId, gv2.id, "18:30", "19:30", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Cũ")).id, b1, sale.id);

    const r = await rescheduleTrialEnrollment({ trialEnrollmentId: enr.id, toSessionId: b2, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toBeUndefined();
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: b1 } })).status).toBe("SCHEDULED");
  });

  // ── 22/10/2026 — case không còn bé hiệu lực ⇒ TỰ HUỶ ở MỌI đường rời case (`huyCaseNeuTrong`) ──
  // Mã TRƯỚC 22/10: chỉ `rescheduleTrialEnrollment` hỏi luật; gỡ khỏi case / rút khỏi lớp để case trống vẫn SCHEDULED/COMPLETED.

  const trangThai = async (id: string) => (await db.trialClassSession.findUniqueOrThrow({ where: { id } })).status;

  test("[TRIAL-EMPTY-01] 1 bé ⇒ gỡ khỏi case ⇒ 0 bé hiệu lực ⇒ case CANCELLED, không xoá cứng gì", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Một")).id, caseA, sale.id);

    const r = await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toEqual({ id: caseA, lyDo: "Tự huỷ: học viên đã được gỡ khỏi case, case không còn ai" });
    expect(await trangThai(caseA)).toBe("CANCELLED");
    // Không xoá cứng: case còn, bé vẫn trong lớp.
    expect(await db.trialClassSession.count({ where: { id: caseA } })).toBe(1);
    expect((await db.trialEnrollment.findUniqueOrThrow({ where: { id: enr.id } })).status).toBe("ACTIVE");
  });

  test("[TRIAL-EMPTY-02] 2 bé ⇒ gỡ 1 ⇒ case GIỮ NGUYÊN", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const di = await ghiDanh(lopId, (await be(center.id, "Bé Đi")).id, caseA, sale.id);
    await ghiDanh(lopId, (await be(center.id, "Bé Ở")).id, caseA, sale.id);

    const r = await goHocVienKhoiCase({ trialEnrollmentId: di.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toBeUndefined();
    expect(await trangThai(caseA)).toBe("SCHEDULED");
  });

  test("[TRIAL-EMPTY-03] dời bé cuối cùng sang case khác ⇒ case nguồn CANCELLED, case đích SCHEDULED", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const caseB = await caseCua(lopId, gv2.id, "19:00", "20:00", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Dời")).id, caseA, sale.id);

    const r = await rescheduleTrialEnrollment({ trialEnrollmentId: enr.id, toSessionId: caseB, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy?.id).toBe(caseA);
    expect(await trangThai(caseA)).toBe("CANCELLED");
    expect(await trangThai(caseB)).toBe("SCHEDULED");
  });

  test("[TRIAL-EMPTY-04] bé cuối cùng RÚT khỏi lớp khi còn trỏ vào case (đường dịch vụ) ⇒ case CANCELLED", async () => {
    // Màn admin chặn rút khi case còn sống; đây là lưới ở tầng dịch vụ cho mọi đường gọi khác.
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const con = await be(center.id, "Bé Rút");
    await ghiDanh(lopId, con.id, caseA, sale.id);

    const r = await unenrollLeadChild({ trialClassId: lopId, leadChildId: con.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toEqual({ id: caseA, lyDo: "Tự huỷ: học viên đã rút khỏi lớp, case không còn ai" });
    expect(await trangThai(caseA)).toBe("CANCELLED");
  });

  test("[TRIAL-EMPTY-05] bé đã bị huỷ ghi danh (WITHDRAWN) không tính là bé của case ⇒ gỡ bé còn lại ⇒ CANCELLED", async () => {
    // Trạng thái "huỷ người học" duy nhất của trial là WITHDRAWN. Bé WITHDRAWN vẫn trỏ vào case nhưng không được đếm.
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const huy = await ghiDanh(lopId, (await be(center.id, "Bé Đã Huỷ")).id, caseA, sale.id);
    await db.trialEnrollment.update({ where: { id: huy.id }, data: { status: "WITHDRAWN" } });
    const con = await ghiDanh(lopId, (await be(center.id, "Bé Còn")).id, caseA, sale.id);

    const r = await goHocVienKhoiCase({ trialEnrollmentId: con.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy?.id).toBe(caseA);
    expect(await trangThai(caseA)).toBe("CANCELLED");
  });

  test("[TRIAL-EMPTY-06] case đã huỷ ⇒ chạy lại phép kiểm không đổi gì, không trả gì (không làm phần sau-huỷ lần hai)", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Lặp")).id, caseA, sale.id);
    expect((await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id })).caseCuDaHuy?.id).toBe(caseA);
    const truoc = await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } });
    const auditTruoc = await db.auditLog.count();
    const tbTruoc = await db.staffNotification.count();

    const lai = await db.$transaction((tx) => huyCaseNeuTrong(tx, { sessionId: caseA, viec: "GO" }));
    expect(lai).toBeUndefined();
    const sau = await db.trialClassSession.findUniqueOrThrow({ where: { id: caseA } });
    expect(sau.status).toBe("CANCELLED");
    expect(sau.updatedAt.getTime()).toBe(truoc.updatedAt.getTime());
    expect(await db.auditLog.count()).toBe(auditTruoc);
    expect(await db.staffNotification.count()).toBe(tbTruoc);
  });

  test("[TRIAL-EMPTY-07] case ĐÃ COMPLETED, 0 có mặt ⇒ gỡ bé cuối ⇒ CANCELLED và rơi khỏi công dạy", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Lỡ")).id, caseA, sale.id);
    // Hình dạng dữ liệu prod trước 21/10: case không ai điểm danh đã bị bấm hoàn tất.
    await db.trialClassSession.update({ where: { id: caseA }, data: { status: "COMPLETED" } });
    const ngay = plusDays(2);
    const trial = async () => (await loadBuoiDay([gv1.id], ngay, ngay)).filter((b) => b.source === "TRIAL").map((b) => b.id);
    expect(await trial()).toContain(caseA);

    const r = await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(await trangThai(caseA)).toBe("CANCELLED");
    expect(await trial()).not.toContain(caseA);
  });

  test("[TRIAL-EMPTY-07b] case ĐÃ COMPLETED trong kỳ công ĐÃ CHỐT ⇒ gỡ bé cuối KHÔNG huỷ (không rút công đã chốt)", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Chốt")).id, caseA, sale.id);
    await db.trialClassSession.update({ where: { id: caseA }, data: { status: "COMPLETED" } });
    await db.attendancePeriod.create({ data: { centerId: center.id, periodKey: plusDays(2).toISOString().slice(0, 7), status: "LOCKED" } });

    const r = await goHocVienKhoiCase({ trialEnrollmentId: enr.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toBeUndefined();
    expect(await trangThai(caseA)).toBe("COMPLETED");
  });

  test("[TRIAL-EMPTY-08] case ĐÃ COMPLETED có bé CÓ MẶT ⇒ gỡ bé còn lại (chưa điểm danh) KHÔNG huỷ", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const co = await ghiDanh(lopId, (await be(center.id, "Bé Có Mặt")).id, caseA, sale.id);
    const khac = await ghiDanh(lopId, (await be(center.id, "Bé Chưa ĐD")).id, caseA, sale.id);
    expect((await markAttendance({ trialSessionId: caseA, trialEnrollmentId: co.id, status: "PRESENT", actorId: sale.id })).ok).toBe(true);
    // 04/11/2026 — "Hoàn tất" nay đòi điểm danh ĐỦ, nên ca này (còn bé chưa điểm danh) không đi qua nút được nữa. Dựng
    // trạng thái "case đã COMPLETED" thẳng ở DB — hình dạng dữ liệu prod có từ trước luật (xem TCG-18) — đúng thứ ca cần.
    await db.trialClassSession.update({ where: { id: caseA }, data: { status: "COMPLETED" } });
    // Bé có mặt về sau rút khỏi lớp: dòng có mặt vẫn còn — case đã dạy thật, không được huỷ.
    await db.trialEnrollment.update({ where: { id: co.id }, data: { status: "WITHDRAWN" } });

    const r = await goHocVienKhoiCase({ trialEnrollmentId: khac.id, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toBeUndefined();
    expect(await trangThai(caseA)).toBe("COMPLETED");
  });

  test("[TRIAL-EMPTY-09] case không còn bé nào: điểm danh bé ĐÃ RÚT bị chặn ⇒ 'Hoàn tất' ra CANCELLED, không ra COMPLETED", async () => {
    // Lối biên: bé rút khỏi lớp vẫn trỏ vào case. Trước 22/10 `markAttendance` không đọc trạng thái ghi danh ⇒ ghi được "có
    // mặt" cho bé đã rút ⇒ "Hoàn tất" thấy 1 có mặt ⇒ COMPLETED ⇒ case không còn ai mà vẫn sinh công.
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const enr = await ghiDanh(lopId, (await be(center.id, "Bé Ma")).id, caseA, sale.id);
    await db.trialEnrollment.update({ where: { id: enr.id }, data: { status: "WITHDRAWN" } });

    const dd = await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    expect(dd.ok).toBe(false);
    expect(await db.trialAttendance.count({ where: { trialSessionId: caseA } })).toBe(0);
    const ht = await completeTrialSession({ trialSessionId: caseA, actorId: sale.id });
    expect(ht.ok, ht.error).toBe(true);
    expect(ht.daHuy).toBeTruthy();
    expect(await trangThai(caseA)).toBe("CANCELLED");
  });

  test("[TRIAL-EMPTY-10] case đã huỷ KHÔNG vào công dạy; case hoàn tất có bé có mặt thì VÀO (đối chứng dương)", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseHuy = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const caseDay = await caseCua(lopId, gv1.id, "19:00", "20:00", sale.id);
    const a = await ghiDanh(lopId, (await be(center.id, "Bé Huỷ")).id, caseHuy, sale.id);
    const b = await ghiDanh(lopId, (await be(center.id, "Bé Học")).id, caseDay, sale.id);
    await goHocVienKhoiCase({ trialEnrollmentId: a.id, actorId: sale.id });
    await markAttendance({ trialSessionId: caseDay, trialEnrollmentId: b.id, status: "PRESENT", actorId: sale.id });
    await completeTrialSession({ trialSessionId: caseDay, actorId: sale.id });

    const ngay = plusDays(2);
    const ids = (await loadBuoiDay([gv1.id], ngay, ngay)).filter((x) => x.source === "TRIAL").map((x) => x.id);
    expect(ids).toContain(caseDay);
    expect(ids).not.toContain(caseHuy);
  });

  // ── 04/11/2026 — ĐIỂM DANH BẮT BUỘC + dời bé VẮNG sang lớp trial KHÁC ─────────────────────────────

  test("[TCG-20] 'Hoàn tất' khi còn bé CHƯA điểm danh ⇒ TỪ CHỐI, case giữ SCHEDULED; điểm danh đủ (vắng cũng tính) ⇒ hoàn tất", async () => {
    const { center, gv1, sale } = await nen();
    const lopId = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopId, gv1.id, "17:30", "18:30", sale.id);
    const co = await ghiDanh(lopId, (await be(center.id, "Bé Có")).id, caseA, sale.id);
    const chua = await ghiDanh(lopId, (await be(center.id, "Bé Chưa")).id, caseA, sale.id);
    expect((await markAttendance({ trialSessionId: caseA, trialEnrollmentId: co.id, status: "PRESENT", actorId: sale.id })).ok).toBe(true);

    const tuChoi = await completeTrialSession({ trialSessionId: caseA, actorId: sale.id });
    expect(tuChoi.ok).toBe(false);
    expect(tuChoi.error).toMatch(/Còn 1 học viên chưa điểm danh/);
    expect(await trangThai(caseA)).toBe("SCHEDULED");

    // Đối chứng dương: đánh VẮNG bé còn lại (PH không đến) là đã điểm danh ⇒ hoàn tất được.
    expect((await markAttendance({ trialSessionId: caseA, trialEnrollmentId: chua.id, status: "ABSENT", actorId: sale.id })).ok).toBe(true);
    const ok = await completeTrialSession({ trialSessionId: caseA, actorId: sale.id });
    expect(ok.ok, ok.error).toBe(true);
    expect(await trangThai(caseA)).toBe("COMPLETED");
  });

  test("[TCG-21] bé VẮNG duy nhất dời sang lớp trial KHÁC ⇒ lượt cũ WITHDRAWN (giữ bản ghi vắng), lượt mới ACTIVE ở lớp đích, case cũ TỰ HUỶ", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopA = await lop(center.id, sale.id, true);
    const lopB = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopA, gv1.id, "17:30", "18:30", sale.id);
    const caseB = await caseCua(lopB, gv2.id, "19:00", "20:00", sale.id);
    const enr = await ghiDanh(lopA, (await be(center.id, "Bé Dời Lớp")).id, caseA, sale.id);
    await db.trialEnrollment.update({ where: { id: enr.id }, data: { courseId: "khoa-x" } });
    expect((await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "ABSENT", actorId: sale.id })).ok).toBe(true);

    const r = await doiBeVangSangLopKhac({ trialEnrollmentId: enr.id, toSessionId: caseB, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy?.id).toBe(caseA);

    expect((await db.trialEnrollment.findUniqueOrThrow({ where: { id: enr.id } })).status).toBe("WITHDRAWN");
    expect(await db.trialAttendance.count({ where: { trialEnrollmentId: enr.id, status: "ABSENT" } })).toBe(1);
    const moi = await db.trialEnrollment.findUniqueOrThrow({ where: { id: r.trialEnrollmentMoiId! } });
    expect([moi.status, moi.trialClassId, moi.scheduledSessionId, moi.courseId, moi.rescheduleCount]).toEqual([
      "ACTIVE", lopB, caseB, "khoa-x", 1,
    ]);
    expect(await trangThai(caseA)).toBe("CANCELLED");
    expect(await trangThai(caseB)).toBe("SCHEDULED");
    expect(await db.trialReschedule.count({ where: { trialEnrollmentId: moi.id, fromSessionId: caseA, toSessionId: caseB } })).toBe(1);
  });

  test("[TCG-22] case còn bé KHÁC ⇒ chỉ bé vắng rời đi, case cũ giữ nguyên", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopA = await lop(center.id, sale.id, true);
    const lopB = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopA, gv1.id, "17:30", "18:30", sale.id);
    const caseB = await caseCua(lopB, gv2.id, "19:00", "20:00", sale.id);
    const vang = await ghiDanh(lopA, (await be(center.id, "Bé Vắng")).id, caseA, sale.id);
    const o = await ghiDanh(lopA, (await be(center.id, "Bé Ở Lại")).id, caseA, sale.id);
    await markAttendance({ trialSessionId: caseA, trialEnrollmentId: vang.id, status: "ABSENT", actorId: sale.id });

    const r = await doiBeVangSangLopKhac({ trialEnrollmentId: vang.id, toSessionId: caseB, actorId: sale.id });
    expect(r.ok, r.error).toBe(true);
    expect(r.caseCuDaHuy).toBeUndefined();
    expect(await trangThai(caseA)).toBe("SCHEDULED");
    expect((await db.trialEnrollment.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ACTIVE");
  });

  test("[TCG-23] cổng của dời lớp: chưa đánh vắng · đã có mặt · cùng lớp ⇒ TỪ CHỐI và KHÔNG ghi gì", async () => {
    const { center, gv1, gv2, sale } = await nen();
    const lopA = await lop(center.id, sale.id, true);
    const lopB = await lop(center.id, sale.id, true);
    const caseA = await caseCua(lopA, gv1.id, "17:30", "18:30", sale.id);
    const caseA2 = await caseCua(lopA, gv2.id, "19:00", "20:00", sale.id);
    const caseB = await caseCua(lopB, gv2.id, "19:00", "20:00", sale.id);
    const enr = await ghiDanh(lopA, (await be(center.id, "Bé Cổng")).id, caseA, sale.id);

    const chuaDiemDanh = await doiBeVangSangLopKhac({ trialEnrollmentId: enr.id, toSessionId: caseB, actorId: sale.id });
    expect(chuaDiemDanh.ok).toBe(false);
    expect(chuaDiemDanh.error).toMatch(/VẮNG trước/);

    await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "ABSENT", actorId: sale.id });
    const cungLop = await doiBeVangSangLopKhac({ trialEnrollmentId: enr.id, toSessionId: caseA2, actorId: sale.id });
    expect(cungLop.ok).toBe(false);

    // Đã từng có mặt ⇒ không phải "PH không đến".
    await markAttendance({ trialSessionId: caseA, trialEnrollmentId: enr.id, status: "PRESENT", actorId: sale.id });
    const daCoMat = await doiBeVangSangLopKhac({ trialEnrollmentId: enr.id, toSessionId: caseB, actorId: sale.id });
    expect(daCoMat.ok).toBe(false);

    expect((await db.trialEnrollment.findUniqueOrThrow({ where: { id: enr.id } })).status).toBe("ACTIVE");
    expect(await db.trialEnrollment.count({ where: { trialClassId: lopB } })).toBe(0);
  });
});
