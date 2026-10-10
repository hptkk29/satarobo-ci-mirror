// tests/hoc-bu/thong-bao.test.ts — T13: THÔNG BÁO HỌC BÙ chạy qua đường THẬT: dịch vụ học bù → DomainEvent (trong giao dịch) → dispatcher → handler →
// `Notification` (cổng phụ huynh) / `StaffNotification` (chuông nhân sự). Ma trận ai-nhận-gì: `lib/hoc-bu/thong-bao-thuan.ts` (+ test thuần TBT-*).
//
//   · phụ huynh: đã xếp · đổi lịch · huỷ · nhắc · kết quả kèm đánh giá;  giáo viên: được xếp · đổi · huỷ · nhắc · quá hạn;
//   · Sale: bé vắng buổi bù · hết lượt cần thu phí;  quản lý: giáo viên không còn ca · quá giờ chưa điểm danh;
//   · idempotent (phát lại không nhân đôi) · rollback ⇒ không có sự kiện · khoá TẮT học bù ⇒ không báo "đã ghi nhận yêu cầu".
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dispatchPendingEvents } from "@/lib/events/dispatcher";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { goBeKhoiCase, huyCase, mienPhiBu, suaCase, suaDiemDanhBe, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { chayNhacHocBu } from "@/lib/hoc-bu/nhac-db";
import { phatCaseDoi } from "@/lib/hoc-bu/su-kien";
import { onCaseDaXep } from "@/lib/_handlers/hoc-bu-case-notif";
import {
  ADMIN,
  BAI,
  CA_MAU,
  CS,
  GV,
  GV2,
  HV,
  KHOA,
  NOW,
  QL,
  SALE,
  beCua,
  buoiGoc,
  diemDanh,
  don,
  dung,
  ketQua,
  luc,
  needId,
  tao,
  tatCa,
  ngayDb,
} from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[TBD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const TIEN_TO = ["makeup.case.", "makeup.completed:", "makeup.absent:", "makeup.payment-required:", "makeup.teacher-unavailable:", "makeup.overdue:"];
const chay = async () => {
  ensureHandlersRegistered();
  // Hai lượt: lượt 1 xử lý sự kiện nghiệp vụ, lượt 2 xử lý sự kiện do handler tự nối (makeup.requested → makeup.payment-required).
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
};
const tinPH = (hv: keyof typeof HV) =>
  db.notification.findMany({
    where: { studentId: HV[hv], OR: TIEN_TO.map((t) => ({ dedupeKey: { startsWith: t } })) },
    orderBy: [{ createdAt: "asc" }, { dedupeKey: "asc" }],
  });
const tinNSTat = (userId: string) =>
  db.staffNotification.findMany({ where: { userId, OR: TIEN_TO.map((t) => ({ dedupeKey: { startsWith: t } })) }, orderBy: { dedupeKey: "asc" } });
const suKien = (loai: string) => db.domainEvent.findMany({ where: { type: loai }, orderBy: { createdAt: "asc" } });
const demSuKienT13 = () => db.domainEvent.count({ where: { type: { in: ["makeup.case.scheduled", "makeup.case.changed", "makeup.case.cancelled", "makeup.completed", "makeup.absent"] } } });

/** Sale của học viên + quản lý cơ sở: người nhận phía vận hành. Sale gắn qua ghi danh (`Enrollment.saleId`) — đúng định nghĩa của màn học bù. */
async function dungNguoiNhan() {
  for (const [u, ten, vai] of [[SALE, "Sale T13", "SALES_CSM"], [QL, "Quản lý T13", "CENTER_MANAGER"]] as const) {
    await db.user.create({ data: { id: u, name: ten, email: `${u}@test.local`, role: vai, roles: [vai], centerId: CS } });
  }
  await db.enrollment.updateMany({ where: { studentId: { in: Object.values(HV) } }, data: { saleId: SALE } });
}

// Trần 30 giây cho cả bộ: mỗi ca dựng lại fixture (`beforeEach(dung)`) rồi đẩy sự kiện qua outbox, và hai ca đầu còn gánh khởi động nguội. Đo 10/10 ở CI gương
// (runner GitHub 2 vCPU, chạy nối tiếp sau cả chục bộ DB khác): [TBD-01]/[TBD-02] chạm trần mặc định 5 giây dù logic đúng (local và VPS xanh). Nới trần là đúng ở đây
// vì ca không có vòng chờ vô hạn — nó chỉ chậm theo máy; thứ canh logic (số tin, người nhận, idempotent) không đổi một chữ.
describe.skipIf(!RUN_DB_TESTS)("[TBD] thông báo học bù — T13", { timeout: 30_000 }, () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[TBD-01] XẾP CASE ⇒ phụ huynh của bé nhận tin (bài, giờ, ngày, giáo viên, phòng); bé khác không; giáo viên nhận MỘT tin cho cả case", async () => {
    const c = await tao([...tatCa("A"), needId("B", 6)]);
    await chay();
    const a = await tinPH("A");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ audience: "STUDENT", studentId: HV.A, centerId: CS, title: "Đã xếp lịch học bù" });
    expect(a[0]!.body).toContain("Bài 5, Bài 6, Bài 7");
    expect(a[0]!.body).toContain("18:00–19:30 ngày 15/10/2026");
    expect(a[0]!.body).toContain("GV T07");
    expect(a[0]!.body).toContain("Phòng T07");
    const b = await tinPH("B");
    expect(b).toHaveLength(1);
    expect(b[0]!.body).toContain("Bài 6");
    expect(b[0]!.body).not.toContain("Bài 5");
    expect(await tinPH("C")).toHaveLength(0);
    const gv = await tinNSTat(GV);
    expect(gv.map((x) => x.dedupeKey)).toEqual([`makeup.case.scheduled:gv:${c}`]);
    expect(gv[0]!.body).toContain("cho 2 học viên");
    expect(gv[0]!.href).toBe("/hoc-bu");
    // Không bị bất kỳ ai khác nhận (Sale / quản lý không nhận tin xếp case).
    expect(await tinNSTat(GV2)).toHaveLength(0);
  });

  it("[TBD-02] IDEMPOTENT: phát lại cùng sự kiện / chạy handler lần nữa ⇒ không nhân đôi; sự kiện đã DONE không bị xử lý lại", async () => {
    await tao([needId("C", 7)]);
    await chay();
    const [ev] = await suKien("makeup.case.scheduled");
    expect(ev!.status).toBe("DONE");
    await onCaseDaXep({ id: ev!.id, type: ev!.type, payload: ev!.payloadJson as Record<string, unknown> });
    await onCaseDaXep({ id: ev!.id, type: ev!.type, payload: ev!.payloadJson as Record<string, unknown> });
    await chay();
    expect(await tinPH("C")).toHaveLength(1);
    expect(await tinNSTat(GV)).toHaveLength(1);
    expect(await suKien("makeup.case.scheduled")).toHaveLength(1);
  });

  it("[TBD-03] THÊM bé vào case có sẵn ⇒ chỉ bé đó được báo; giáo viên KHÔNG bị báo lại; XẾP THÊM bài cho bé đã có trong case ⇒ bé đó được báo lần nữa", async () => {
    const c = await tao([needId("A", 5)], { lessonIds: [BAI[5], BAI[6], BAI[7]] });
    await chay();
    expect(await tinPH("A")).toHaveLength(1);
    await xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("B", 6)] });
    await chay();
    expect(await tinPH("B")).toHaveLength(1);
    expect(await tinPH("A")).toHaveLength(1);
    expect(await tinNSTat(GV)).toHaveLength(1); // tin của giáo viên là theo CASE
    await xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("A", 6)] });
    await chay();
    const a = await tinPH("A");
    expect(a).toHaveLength(2);
    expect(a[1]!.body).toContain("Bài 5, Bài 6");
  });

  it("[TBD-04] ĐỔI lịch ⇒ phụ huynh các bé đang chờ + giáo viên được báo kèm điều đã đổi; đổi GIÁO VIÊN ⇒ giáo viên cũ nhận tin 'chuyển cho người khác'; chỉ đổi ghi chú ⇒ KHÔNG có sự kiện", async () => {
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
    await chay();
    const truocDoiGhiChu = await db.domainEvent.count({ where: { type: "makeup.case.changed" } });
    const v0 = (await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).version;
    await suaCase(ADMIN, { caseId: c, phienBan: v0, note: "Chỉ ghi chú", ten: "Admin" });
    expect(await db.domainEvent.count({ where: { type: "makeup.case.changed" } })).toBe(truocDoiGhiChu);

    const v1 = (await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).version;
    await suaCase(ADMIN, { caseId: c, phienBan: v1, ymd: "2026-10-16", startTime: "18:30", endTime: "20:00", teacherId: GV2, ten: "Admin" });
    await chay();
    for (const hv of ["A", "B"] as const) {
      const doi = (await tinPH(hv)).filter((t) => t.dedupeKey!.startsWith("makeup.case.changed:"));
      expect(doi, hv).toHaveLength(1);
      expect(doi[0]!.body).toContain("ngày 15/10/2026 → 16/10/2026");
      expect(doi[0]!.body).toContain("đổi giáo viên");
      expect(doi[0]!.body).toContain("18:30–20:00 ngày 16/10/2026");
    }
    const moi = (await tinNSTat(GV2)).filter((t) => t.dedupeKey.startsWith("makeup.case.changed:"));
    expect(moi).toHaveLength(1);
    const cu = (await tinNSTat(GV)).filter((t) => t.dedupeKey.startsWith("makeup.case.changed:"));
    expect(cu).toHaveLength(1);
    expect(cu[0]!.dedupeKey.endsWith(":cu")).toBe(true);
    expect(cu[0]!.title).toBe("Buổi dạy bù chuyển cho giáo viên khác");
  });

  it("[TBD-05] GỠ một bé ⇒ chỉ phụ huynh bé đó nhận tin huỷ, giáo viên không bị báo; gỡ bé CUỐI ⇒ case tự huỷ ⇒ giáo viên nhận tin huỷ MỘT lần", async () => {
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
    await chay();
    await goBeKhoiCase(ADMIN, (await beCua(c, "A")).id);
    await chay();
    const huyA = (await tinPH("A")).filter((t) => t.dedupeKey!.startsWith("makeup.case.cancelled:"));
    expect(huyA).toHaveLength(1);
    expect(huyA[0]!.body).toContain("đã được huỷ");
    expect((await tinPH("B")).filter((t) => t.dedupeKey!.startsWith("makeup.case.cancelled:"))).toHaveLength(0);
    expect((await tinNSTat(GV)).filter((t) => t.dedupeKey.startsWith("makeup.case.cancelled:"))).toHaveLength(0);

    await goBeKhoiCase(ADMIN, (await beCua(c, "B")).id);
    await chay();
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("CANCELLED");
    expect((await tinPH("B")).filter((t) => t.dedupeKey!.startsWith("makeup.case.cancelled:"))).toHaveLength(1);
    const gv = (await tinNSTat(GV)).filter((t) => t.dedupeKey.startsWith("makeup.case.cancelled:"));
    expect(gv.map((t) => t.dedupeKey)).toEqual([`makeup.case.cancelled:gv:${c}`]);
  });

  it("[TBD-06] HUỶ CASE ⇒ mọi phụ huynh còn chờ nhận tin huỷ + giáo viên MỘT tin; bé đã bị gỡ từ trước không nhận lần hai", async () => {
    const c = await tao([needId("A", 5), needId("B", 6), needId("C", 7)], { lessonIds: [BAI[5], BAI[6], BAI[7]] });
    await goBeKhoiCase(ADMIN, (await beCua(c, "C")).id);
    await chay();
    await huyCase(ADMIN, c);
    await chay();
    for (const hv of ["A", "B", "C"] as const) {
      expect((await tinPH(hv)).filter((t) => t.dedupeKey!.startsWith("makeup.case.cancelled:")), hv).toHaveLength(1);
    }
    expect((await tinNSTat(GV)).filter((t) => t.dedupeKey.startsWith("makeup.case.cancelled:"))).toHaveLength(1);
    expect(await suKien("makeup.case.cancelled")).toHaveLength(4); // C(gỡ) + A,B(huỷ) + giáo viên
  });

  it("[TBD-07] BÉ CÓ MẶT ⇒ phụ huynh nhận KẾT QUẢ TỪNG BÀI kèm đánh giá; bé VẮNG ⇒ Sale nhận tin, phụ huynh không", async () => {
    await dungNguoiNhan();
    const c = await tao([...tatCa("A"), needId("B", 6)], { lessonIds: [BAI[5], BAI[6], BAI[7]] });
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });
    await diemDanh(c, "B", false);
    await chay();
    const ketQuaA = (await tinPH("A")).filter((t) => t.dedupeKey!.startsWith("makeup.completed:"));
    expect(ketQuaA).toHaveLength(1);
    expect(ketQuaA[0]!.title).toBe("Kết quả buổi học bù");
    expect(ketQuaA[0]!.body).toContain("• Bài 5: đã học xong — Đánh giá A5");
    expect(ketQuaA[0]!.body).toContain("• Bài 7: chưa hoàn thành, sẽ xếp bù lại");
    expect(ketQuaA[0]!.body).toContain("Nhận xét chung: Con học tốt");
    expect((await tinPH("B")).filter((t) => t.dedupeKey!.startsWith("makeup.completed:"))).toHaveLength(0);

    const sale = (await tinNSTat(SALE)).filter((t) => t.dedupeKey.startsWith("makeup.absent:"));
    expect(sale).toHaveLength(1);
    expect(sale[0]!.body).toContain("Bé T07 B vắng buổi học bù");
    expect((await tinNSTat(SALE)).filter((t) => t.dedupeKey.startsWith("makeup.absent:") && t.body.includes("Bé T07 A"))).toHaveLength(0);
    expect(await tinNSTat(QL)).toHaveLength(0); // có Sale thì quản lý không bị báo thay
  });

  it("[TBD-08] SỬA điểm danh bé có mặt ⇒ tin kết quả MỚI (khoá theo phiên bản) với tiêu đề 'đã được cập nhật'; tin cũ giữ nguyên", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "NOT_COMPLETED" });
    await chay();
    const be = await beCua(c, "C");
    await suaDiemDanhBe(null, {
      participantId: be.id,
      coMat: true,
      ketQuaMuc: await ketQua(c, "C", { 7: "COMPLETED" }),
      nhanXetChung: "Đã học lại",
      chiGiaoVien: GV,
      now: luc(15, 19, 0),
      phienBan: be.version,
      lyDo: "Sửa kết quả nhập nhầm bài 7",
      ten: "Admin",
    });
    await chay();
    const tin = (await tinPH("C")).filter((t) => t.dedupeKey!.startsWith("makeup.completed:"));
    expect(tin).toHaveLength(2);
    expect(tin.map((t) => t.title).sort()).toEqual(["Kết quả buổi học bù", "Kết quả buổi học bù đã được cập nhật"]);
    expect(tin.find((t) => t.title.includes("cập nhật"))!.body).toContain("• Bài 7: đã học xong");
  });

  it("[TBD-09] HẾT LƯỢT: dòng bù mới của bé hết lượt ⇒ Sale nhận 'cần thu phí' MỘT lần (qua chuỗi makeup.requested → makeup.payment-required); bé còn lượt thì không", async () => {
    await dung({ A: 0, B: 3, C: 3, D: 3 });
    await dungNguoiNhan();
    await db.$transaction(async (tx) => {
      await taoDongHocBu(tx, { studentId: HV.A, missedSessionId: buoiGoc(8), nguon: "ABSENCE", createdById: GV });
      await taoDongHocBu(tx, { studentId: HV.B, missedSessionId: buoiGoc(8), nguon: "ABSENCE", createdById: GV });
    });
    await chay();
    const sale = (await tinNSTat(SALE)).filter((t) => t.dedupeKey.startsWith("makeup.payment-required:"));
    expect(sale).toHaveLength(1);
    expect(sale[0]!.body).toContain("Bé T07 A đã hết lượt học bù");
    // Phụ huynh vẫn nhận tin "đã ghi nhận yêu cầu" của luồng cũ (không đổi).
    expect(await db.notification.count({ where: { studentId: HV.A, dedupeKey: { startsWith: "makeup.requested:" } } })).toBe(1);
    await chay();
    expect((await tinNSTat(SALE)).filter((t) => t.dedupeKey.startsWith("makeup.payment-required:"))).toHaveLength(1);
    expect(await suKien("makeup.payment-required")).toHaveLength(1);
  });

  it("[TBD-10] KHOÁ TẮT học bù ⇒ buổi vắng KHÔNG sinh sự kiện 'đã ghi nhận yêu cầu học bù' (và không báo gì cho phụ huynh)", async () => {
    await dung();
    await db.course.update({ where: { id: KHOA }, data: { choPhepHocBu: false } });
    await db.$transaction(async (tx) => {
      await taoDongHocBu(tx, { studentId: HV.A, missedSessionId: buoiGoc(8), nguon: "ABSENCE", createdById: GV });
    });
    await chay();
    expect(await suKien("makeup.requested")).toHaveLength(0);
    expect(await db.notification.count({ where: { studentId: HV.A } })).toBe(0);
    // Đối chứng dương: khoá BẬT ⇒ đúng một sự kiện.
    await db.course.update({ where: { id: KHOA }, data: { choPhepHocBu: true } });
    await db.$transaction(async (tx) => {
      await taoDongHocBu(tx, { studentId: HV.B, missedSessionId: buoiGoc(8), nguon: "ABSENCE", createdById: GV });
    });
    expect(await suKien("makeup.requested")).toHaveLength(1);
  });

  it("[TBD-11] ROLLBACK ⇒ KHÔNG có sự kiện: giao dịch phát sự kiện rồi nổ thì outbox không giữ lại gì", async () => {
    const c = await tao([needId("C", 7)]);
    await chay();
    const truoc = await demSuKienT13();
    await expect(
      db.$transaction(async (tx) => {
        await phatCaseDoi(tx, {
          caseId: c,
          phienBanSau: 99,
          truoc: { ymd: "2026-10-15", startTime: "18:00", endTime: "19:30", teacherId: GV, roomId: null },
          sau: { ymd: "2026-10-16", startTime: "18:00", endTime: "19:30", teacherId: GV, roomId: null },
        });
        throw new Error("nổ giữa giao dịch");
      }),
    ).rejects.toThrow("nổ giữa giao dịch");
    expect(await demSuKienT13()).toBe(truoc);
    // Đường thật: xếp bé sai bài (lỗi nghiệp vụ trước phép ghi) ⇒ không sự kiện mới, không thông báo mới.
    await expect(xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("A", 5)] })).rejects.toThrow();
    await chay();
    expect(await demSuKienT13()).toBe(truoc);
    expect(await tinPH("A")).toHaveLength(0);
  });

  it("[TBD-12] NHẮC: case 18:00 ngày 15/10 — hôm trước 18:00 (24h) nhắc phụ huynh + giáo viên; hôm trước 12:00 (30h) chưa; chạy lại cron không nhân đôi", async () => {
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
    await chay();
    const som = await chayNhacHocBu({ now: luc(14, 12, 0) });
    expect(som).toMatchObject({ xet: 1, nhac: 0, quaHan: 0 });
    const kq = await chayNhacHocBu({ now: luc(14, 18, 0) });
    expect(kq).toMatchObject({ xet: 1, nhac: 1, quaHan: 0, chamTran: false });
    await chayNhacHocBu({ now: luc(14, 18, 0) });
    await chayNhacHocBu({ now: luc(14, 19, 0) }); // 23h trước — vẫn trong cửa sổ, cùng khoá
    expect(await suKien("makeup.case.reminder")).toHaveLength(1);
    await chay();
    for (const hv of ["A", "B"] as const) {
      const nhac = (await tinPH(hv)).filter((t) => t.dedupeKey!.startsWith("makeup.case.reminder:"));
      expect(nhac, hv).toHaveLength(1);
      expect(nhac[0]!.body).toContain("18:00–19:30 ngày 15/10/2026");
    }
    expect((await tinNSTat(GV)).filter((t) => t.dedupeKey === `makeup.case.reminder:${c}:2026-10-15`)).toHaveLength(1);
  });

  it("[TBD-13] NHẮC bị bỏ khi case đã dời sang ngày khác sau lúc phát (lời nhắc cũ không còn đúng) hoặc không còn bé chờ", async () => {
    const c = await tao([needId("A", 5)]);
    await chayNhacHocBu({ now: luc(14, 18, 0) });
    await db.makeupCase.update({ where: { id: c }, data: { date: ngayDb(16) } });
    await chay();
    expect((await tinPH("A")).filter((t) => t.dedupeKey!.startsWith("makeup.case.reminder:"))).toHaveLength(0);
    expect((await tinNSTat(GV)).filter((t) => t.dedupeKey.startsWith("makeup.case.reminder:"))).toHaveLength(0);
  });

  it("[TBD-14] QUÁ GIỜ chưa điểm danh (≥120 phút sau giờ kết) ⇒ quản lý + giáo viên nhận MỘT tin; chưa đủ 120 phút ⇒ chưa; điểm danh xong ⇒ không báo", async () => {
    await dungNguoiNhan();
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
    expect(await chayNhacHocBu({ now: luc(15, 21, 29) })).toMatchObject({ quaHan: 0 }); // 19:30 + 119'
    expect(await chayNhacHocBu({ now: luc(15, 21, 30) })).toMatchObject({ quaHan: 1 });
    await chayNhacHocBu({ now: luc(15, 23, 0) });
    await chay();
    const ql = (await tinNSTat(QL)).filter((t) => t.dedupeKey === `makeup.overdue:${c}`);
    expect(ql).toHaveLength(1);
    expect(ql[0]!.body).toContain("còn 2 học viên chưa được điểm danh");
    expect((await tinNSTat(GV)).filter((t) => t.dedupeKey === `makeup.overdue:${c}`)).toHaveLength(1);

    // Đã điểm danh hết ⇒ sự kiện cũ (nếu còn treo) cũng không sinh tin; và lượt quét sau không phát nữa.
    await diemDanh(c, "A", true, { 5: "COMPLETED" });
    await diemDanh(c, "B", true, { 6: "COMPLETED" });
    expect(await chayNhacHocBu({ now: luc(16, 9, 0) })).toMatchObject({ xet: 0, quaHan: 0 });
    expect(NOW).toBeTruthy();
  });

  it("[TBD-15] GIÁO VIÊN KHÔNG CÒN CA: ngày nghỉ / ca không phủ / làm cơ sở khác ⇒ quản lý được báo; KHÔNG có ô ca (thiếu dữ liệu) ⇒ KHÔNG báo", async () => {
    await dungNguoiNhan();
    const c = await tao([needId("C", 7)]);
    // 1) Có lưới, GV có ca phủ ⇒ không báo.
    expect(await chayNhacHocBu({ now: luc(14, 9, 0) })).toMatchObject({ gvKhongConCa: 0 });
    // 2) Đổi ô ca ngày 15/10 sang NGÀY NGHỈ (mã kind OFF).
    await db.shiftTemplate.create({ data: { id: `${CA_MAU}-off`, code: "T13X", name: "Nghỉ T13", kind: "OFF", segments: [] } });
    await db.shiftAssignment.updateMany({
      where: { userId: GV, workDate: ngayDb(15) },
      data: { templateId: `${CA_MAU}-off`, templateCode: "T13X", segments: [], dayCredit: 0 },
    });
    const kq = await chayNhacHocBu({ now: luc(14, 9, 0) });
    expect(kq.gvKhongConCa).toBe(1);
    await chayNhacHocBu({ now: luc(14, 10, 0) }); // quét lại: cùng khoá
    await chay();
    const ql = (await tinNSTat(QL)).filter((t) => t.dedupeKey.startsWith("makeup.teacher-unavailable:"));
    expect(ql).toHaveLength(1);
    expect(ql[0]!.dedupeKey).toBe(`makeup.teacher-unavailable:${c}:${GV}:2026-10-15`);
    expect(ql[0]!.body).toContain("GV T07 không còn ca làm phủ");

    // 3) Xoá hẳn ô ca của GV (nhưng lưới ngày 15/10 vẫn có người khác) ⇒ THIẾU dữ liệu ≠ vắng ⇒ không báo thêm.
    await db.makeupCase.update({ where: { id: c }, data: { teacherId: GV2 } });
    await db.shiftAssignment.deleteMany({ where: { userId: GV2, workDate: ngayDb(15) } });
    expect(await chayNhacHocBu({ now: luc(14, 11, 0) })).toMatchObject({ gvKhongConCa: 0 });
  });

  it("[TBD-16] case ĐÃ CHỐT / đã huỷ không bị quét; kết quả trả về nói rõ số case đã xét", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect(await chayNhacHocBu({ now: luc(15, 23, 0) })).toMatchObject({ xet: 0, nhac: 0, quaHan: 0, gvKhongConCa: 0, chamTran: false });
  });

  it("[TBD-17] Học viên KHÔNG có Sale (ghi danh chưa gán, phiếu lead không có người phụ trách) ⇒ tin vắng buổi bù rơi về QUẢN LÝ cơ sở — việc không rơi vào khoảng trống", async () => {
    await dungNguoiNhan();
    await db.enrollment.updateMany({ where: { studentId: HV.C }, data: { saleId: null } });
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", false);
    await chay();
    expect((await tinNSTat(QL)).filter((t) => t.dedupeKey.startsWith("makeup.absent:"))).toHaveLength(1);
    expect((await tinNSTat(SALE)).filter((t) => t.dedupeKey.startsWith("makeup.absent:"))).toHaveLength(0);
  });

  it("[TBD-18] 'Cần thu phí' đọc LẠI lúc xử lý: dòng đã được MIỄN PHÍ trước khi handler chạy ⇒ không báo Sale", async () => {
    await dung({ A: 0, B: 3, C: 3, D: 3 });
    await dungNguoiNhan();
    await db.$transaction(async (tx) => {
      await taoDongHocBu(tx, { studentId: HV.A, missedSessionId: buoiGoc(8), nguon: "ABSENCE", createdById: GV });
    });
    ensureHandlersRegistered();
    await dispatchPendingEvents({ flagOn: true, batchSize: 500 }); // lượt 1: makeup.requested → nối sang makeup.payment-required (còn PENDING)
    expect(await suKien("makeup.payment-required")).toHaveLength(1);
    const dong = await db.makeupNeed.findFirstOrThrow({ where: { studentId: HV.A, missedSessionId: buoiGoc(8) } });
    await mienPhiBu(ADMIN, { needId: dong.id, lyDo: "Miễn phí ngoại lệ do BGĐ duyệt", ten: "Admin" });
    await dispatchPendingEvents({ flagOn: true, batchSize: 500 }); // lượt 2: xử lý sự kiện cần thu phí — nhưng dòng đã miễn phí
    expect((await tinNSTat(SALE)).filter((t) => t.dedupeKey.startsWith("makeup.payment-required:"))).toHaveLength(0);
  });
});
