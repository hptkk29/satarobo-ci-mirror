// tests/finance/portal-pham-vi-lich-tuan.test.ts — [PVL] LỊCH TUẦN + "BUỔI HỌC CỦA HỌC SINH" THEO PHẠM VI ĐÃ ĐĂNG KÝ, trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts)
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (`fx-pl-`). Chạy được MỘT MÌNH (luật 18).
//
// Đi qua ĐÚNG hai hàm công khai mà hai trang gọi: `getStudentSchedule` (lịch tuần — /portal/lich, /portal/hoc-sinh/lich) và
// `getStudentSessionsView` (Buổi học của học sinh — /portal/hoc-sinh/buoi-hoc). Trang cần phiên đăng nhập nên không đi qua trang.
//
// Hai loại ca:
//   · GOLDEN — mọi ca "đường cũ" so với ẢNH CHỤP chụp từ mã TRƯỚC khi sửa (PR này). Cờ TẮT / không quyền học / hai lớp cùng khoá phải ra
//     GIỐNG HỆT từng trường, không chỉ "trông giống". Ảnh chụp lấy với đồng hồ đóng băng ở NOW, nên tái hiện được.
//   · HÀNH VI — cờ BẬT + quyền học thật: nhãn buổi, done/total/chuaCham, cộng gộp nhiều lớp, cách ly con / cơ sở / khoá.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { tinhGiaTheoMoc } from "@/lib/pricing/tinh-gia-theo-moc";
import { capQuyenHoc, xepLop, type PhuThuoc } from "@/lib/entitlements/dich-vu";
import { nhanLyDo } from "@/lib/entitlements/roster";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";

if (!RUN_DB_TESTS) console.warn(`[PVL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-pl-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const OU2 = `${T}ou2`;
const K1 = `${T}k1`;
const K2 = `${T}k2`;
const LOP = `${T}lop`; // K1 · CS1 · 30 buổi: bài 1..18 đã qua, 19 = hôm nay (chiều), 20..30 tương lai
const LOP2 = `${T}lop2`; // K1 · CS1 (lớp thứ hai CÙNG khoá)
const LOP_K2 = `${T}lop-k2`; // K2 · CS2 (cơ sở KHÁC, cờ tắt)
const A = `${T}hv-a`;
const B = `${T}hv-b`;
const NGUOI = { id: `${T}nguoi`, name: "Người thử lịch tuần" };
/** 19/10/2026 10:00 giờ VN (thứ Hai). Tuần này = 19/10..25/10. */
const NOW = new Date("2026-10-19T03:00:00Z");
const NGAY = 24 * 3600 * 1000;
const GIO = 3600 * 1000;
const BAT: PhuThuoc = { batChoCoSo: async () => true };
const SO_BAI = 30;

/** Ảnh chụp kết quả của mã TRƯỚC khi sửa (fixture + NOW cố định) — `thuong`: một lớp, không quyền học, không cờ; `haiLop`: hai lớp cùng khoá, có quyền học, cờ BẬT. */
const GOLDEN = JSON.parse(readFileSync(resolve(process.cwd(), "tests/finance/pvl-golden.json"), "utf8")) as { thuong: Awaited<ReturnType<typeof anh>>; haiLop: Awaited<ReturnType<typeof anh>> };

/** bài b<19 ở QUÁ KHỨ (NOW − (19−b) ngày); bài 19 = 12:00 hôm nay (chưa tới); bài b>19 = NOW + (b−19) ngày + 2 giờ. */
const ngayBai = (b: number) => new Date(NOW.getTime() + (b - 19) * NGAY + (b >= 19 ? 2 * GIO : 0));
const buoi = (lop: string, b: number) => `${lop}-s${b}`;

async function don() {
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.attendance.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlementUsage.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: NGUOI.id }, { module: "entitlements", entityType: "StudyEntitlement", entityId: { startsWith: T } }] } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: { in: [OU1, OU2] } } });
}

async function xoaHet() {
  await don();
  await db.enrollment.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.course.deleteMany({ where: { id: { in: [K1, K2] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU1, OU2] } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  clearSettingsCache();
}

async function dungLop(id: string, courseId: string, centerId: string) {
  await db.class.create({ data: { id, name: id, classCode: id, courseId, centerId, status: "ACTIVE", maxStudents: 12 } });
  for (let b = 1; b <= SO_BAI; b++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${id}-p${b}`, classId: id, seq: b, order: b - 1 } });
    await db.classSession.create({
      data: { id: buoi(id, b), classId: id, centerId, planId: plan.id, date: ngayBai(b), status: b < 19 ? "COMPLETED" : "SCHEDULED" },
    });
  }
}

async function ghiDanh(studentId: string, classId: string) {
  const lop = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { courseId: true } });
  return db.enrollment.create({
    data: {
      id: `${T}gd-${studentId.slice(T.length)}-${classId.slice(T.length)}`,
      student: { connect: { id: studentId } },
      class: { connect: { id: classId } },
      course: { connect: { id: lop.courseId } },
      status: "STUDYING",
      centerId: CS1,
    },
  });
}

let dem = 0;
/** Quyền học 12 buổi của (học viên, khoá), xếp lớp ở bài `bai`. */
async function capVaXep(studentId: string, o: { courseId: string; classId: string; centerId?: string; bai: number; consumed?: number }) {
  const k = ++dem;
  const { quyenHoc } = await capQuyenHoc(
    {
      studentId,
      courseId: o.courseId,
      orderId: `${T}don-${k}`,
      orderItemId: `${T}dong-${k}`,
      centerId: o.centerId ?? CS1,
      gia: tinhGiaTheoMoc({ gia48: 10_560_000, soBuoi: 12, thuTuCon: 1 }),
      pricingSnapshot: { gia48: 10_560_000 },
      actor: NGUOI,
    },
    BAT,
  );
  const r = await xepLop({ entitlementId: quyenHoc.id, enrollmentId: `${T}gd-x-${k}`, classId: o.classId, baiKeTiepCuaLop: o.bai, actor: NGUOI, now: NOW }, BAT);
  if (o.consumed) await db.studyEntitlement.update({ where: { id: r.quyenHoc.id }, data: { consumedSessions: o.consumed } });
}

async function datCo(orgUnitId: string, bat: boolean) {
  await db.centerSetting.upsert({
    where: { orgUnitId_key: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } },
    create: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
    update: { valueJson: bat },
  });
  clearSettingsCache();
}

type St = "PRESENT" | "ABSENT_UNEXCUSED" | "ABSENT_EXCUSED";
async function diemDanh(studentId: string, classId: string, bai: number, status: St, makeupStatus: "NONE" | "NEEDS_MAKEUP" | "MADE_UP" = "NONE") {
  await db.attendance.create({ data: { sessionId: buoi(classId, bai), studentId, status, makeupStatus, centerId: CS1 } });
}

/** Điểm danh CỐ ĐỊNH của bé A ở lớp `lop` (cùng bộ dữ liệu cho mọi ca, để so được với ảnh chụp). */
async function diemDanhMau(studentId: string, lop: string) {
  await diemDanh(studentId, lop, 5, "ABSENT_UNEXCUSED"); //     trước phạm vi 13–24
  await diemDanh(studentId, lop, 14, "PRESENT");
  await diemDanh(studentId, lop, 15, "PRESENT");
  await diemDanh(studentId, lop, 16, "ABSENT_UNEXCUSED");
  await diemDanh(studentId, lop, 17, "ABSENT_EXCUSED", "NEEDS_MAKEUP");
}

/** Hai kết quả công khai, chuyển qua JSON để so từng trường (kể cả trường vắng mặt ≠ trường `undefined`). */
async function anh(studentId: string) {
  const [lich, buoiView] = await Promise.all([getStudentSchedule(studentId, NOW), getStudentSessionsView(studentId, NOW)]);
  return JSON.parse(JSON.stringify({ lich, buoiView })) as { lich: NonNullable<typeof lich>; buoiView: typeof buoiView };
}

describe.skipIf(!RUN_DB_TESTS)("[PVL] lịch tuần + buổi học của học sinh — theo phạm vi (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await xoaHet();
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await xoaHet();
    for (const id of [CS1, CS2]) await db.center.create({ data: { id, name: id, slug: id, address: "x" } });
    await db.orgUnit.create({ data: { id: OU1, code: "PLOU1", name: "OU1", type: "CENTER", centerId: CS1 } });
    await db.orgUnit.create({ data: { id: OU2, code: "PLOU2", name: "OU2", type: "CENTER", centerId: CS2 } });
    for (const id of [K1, K2]) await db.course.create({ data: { id, name: id, slug: id, price: 10_560_000, totalSessions: 48 } });
    for (const id of [A, B]) await db.student.create({ data: { id, name: id, centerId: CS1, status: "ACTIVE" } });
    await dungLop(LOP, K1, CS1);
    await dungLop(LOP2, K1, CS1);
    await dungLop(LOP_K2, K2, CS2);
    clearSettingsCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    vi.useRealTimers();
    await xoaHet();
  });

  /** Bé A giữa khoá: lớp K1 từ bài 13 (quyền 13–24, đã dùng 3), cờ BẬT ở CS1. */
  async function dungCaGiuaKhoa() {
    await ghiDanh(A, LOP);
    await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
    await diemDanhMau(A, LOP);
    await datCo(OU1, true);
  }

  const hang = <T extends { id: string }>(ds: T[], lop: string, b: number) => ds.find((r) => r.id === buoi(lop, b))!;
  const nhanNgoai = nhanLyDo("NGOAI_PHAM_VI", { start: 13, end: 24 });

  /** Cùng dữ liệu, cờ TẮT rồi BẬT: hai ảnh phải GIỐNG HỆT (cờ bật mà không áp dụng được thì không được đổi gì). */
  async function tatRoiBat(studentId: string) {
    await datCo(OU1, false);
    const tat = await anh(studentId);
    await datCo(OU1, true);
    const bat = await anh(studentId);
    return { tat, bat };
  }

  // ═══ ĐƯỜNG CŨ — so với ẢNH CHỤP từ mã TRƯỚC khi sửa ════════════════════════════════════════════════════════════════
  describe("đường cũ giữ NGUYÊN TỪNG TRƯỜNG", () => {
    it("[PVL-01] một lớp, không quyền học, không cờ ⇒ bằng ảnh chụp; không hàng buổi nào có trường phạm vi", async () => {
      await ghiDanh(A, LOP);
      await diemDanhMau(A, LOP);
      const r = await anh(A);
      expect(r).toStrictEqual(GOLDEN.thuong);
      for (const s of [...r.lich.thisWeek, ...r.lich.upcoming, ...r.buoiView.sessions]) {
        expect("ngoaiPhamVi" in s, `${s.id} có ngoaiPhamVi`).toBe(false);
        expect("nhanPhamVi" in s, `${s.id} có nhanPhamVi`).toBe(false);
      }
      expect(r.lich).toMatchObject({ done: 18, total: 30, remaining: 12 }); // mẫu số = CẢ LỚP, như trước
      expect(r.buoiView).toMatchObject({ done: 18, total: 30, chuaCham: 13 });
    });

    it("[PVL-02] có quyền học 13–24 nhưng cờ TẮT ⇒ bằng ảnh chụp", async () => {
      await ghiDanh(A, LOP);
      await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
      await diemDanhMau(A, LOP);
      await datCo(OU1, false);
      expect(await anh(A)).toStrictEqual(GOLDEN.thuong);
    });

    it("[PVL-03] cờ BẬT nhưng bé KHÔNG có quyền học ⇒ bằng ảnh chụp", async () => {
      await ghiDanh(A, LOP);
      await diemDanhMau(A, LOP);
      await datCo(OU1, true);
      expect(await anh(A)).toStrictEqual(GOLDEN.thuong);
    });

    it("[PVL-04] HAI LỚP CÙNG MỘT KHOÁ (cờ BẬT, có quyền học) ⇒ bằng ảnh chụp, cả hai lớp", async () => {
      await ghiDanh(A, LOP);
      await ghiDanh(A, LOP2);
      await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
      await diemDanhMau(A, LOP);
      await datCo(OU1, true);
      const r = await anh(A);
      expect(r).toStrictEqual(GOLDEN.haiLop);
      expect(r.lich).toMatchObject({ done: 36, total: 60 });
      expect(r.buoiView.sessions.some((s) => "ngoaiPhamVi" in s)).toBe(false);
    });

    it("[PVL-05] cờ chỉ bật ở CƠ SỞ KHÁC (CS2) mà lớp thuộc CS1 ⇒ bằng ảnh chụp", async () => {
      await ghiDanh(A, LOP);
      await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
      await diemDanhMau(A, LOP);
      await datCo(OU2, true);
      expect(await anh(A)).toStrictEqual(GOLDEN.thuong);
    });

    it("[PVL-06] quyền học của CƠ SỞ KHÁC (centerId = CS2) trên lớp CS1 ⇒ bị lọc ⇒ đường cũ", async () => {
      await ghiDanh(A, LOP);
      await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
      await db.studyEntitlement.updateMany({ where: { studentId: A }, data: { centerId: CS2 } });
      await diemDanhMau(A, LOP);
      await datCo(OU1, true);
      expect(await anh(A)).toStrictEqual(GOLDEN.thuong);
    });

    it("[PVL-07] một buổi đã qua CHƯA ghim giáo trình ⇒ lớp đó giữ đường cũ (bật cờ = tắt cờ)", async () => {
      await ghiDanh(A, LOP);
      await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
      await diemDanhMau(A, LOP);
      await db.classSession.update({ where: { id: buoi(LOP, 7) }, data: { planId: null } });
      const { tat, bat } = await tatRoiBat(A);
      expect(bat).toStrictEqual(tat);
      expect(bat.buoiView.sessions.some((s) => "ngoaiPhamVi" in s)).toBe(false);
    });
  });

  // ═══ THEO PHẠM VI ═══════════════════════════════════════════════════════════════════════════════════════════════════
  describe("cờ BẬT + quyền học 13–24", () => {
    it("[PVL-10] Buổi học của học sinh: done/total theo GÓI, chuaCham chỉ đếm buổi TRONG phạm vi, nhãn đúng buổi (kể cả buổi sau gói)", async () => {
      await dungCaGiuaKhoa();
      const { buoiView: v } = await anh(A);
      expect(v).toMatchObject({ done: 6, total: 12, present: 3, absent: 2, chuaCham: 2 });
      expect(v.sessions, "không buổi nào bị ẩn").toHaveLength(SO_BAI);
      for (const b of [1, 5, 12]) expect(hang(v.sessions, LOP, b)).toMatchObject({ ngoaiPhamVi: true, nhanPhamVi: nhanNgoai });
      for (const b of [13, 14, 18, 19, 24]) expect(hang(v.sessions, LOP, b)).toMatchObject({ ngoaiPhamVi: false, nhanPhamVi: null });
      for (const b of [25, 30]) expect(hang(v.sessions, LOP, b)).toMatchObject({ ngoaiPhamVi: true, nhanPhamVi: nhanNgoai });
      // huy hiệu điểm danh vẫn là SỰ THẬT của buổi: bài 5 có dòng điểm danh 'vắng', không bị thay
      expect(hang(v.sessions, LOP, 5).attendance).toBe("ABSENT");
      // 'chưa chấm' cũ đếm cả bài 1–4, 6–12 (ngoài phạm vi); nay chỉ còn bài 13 và 18
      expect(v.sessions.filter((s) => s.attendance === "UNMARKED" && !s.ngoaiPhamVi).map((s) => s.id).sort()).toEqual([buoi(LOP, 13), buoi(LOP, 18)].sort());
    });

    it("[PVL-11] lịch tuần: done/total/remaining theo GÓI, chuyên cần cùng mốc; buổi tuần này + sắp tới có nhãn đúng", async () => {
      await dungCaGiuaKhoa();
      const { lich: l } = await anh(A);
      expect(l).toMatchObject({ done: 6, total: 12, remaining: 6, rate: 50 });
      expect(l.thisWeek.map((s) => s.id)).toEqual(Array.from({ length: 7 }, (_, i) => buoi(LOP, 19 + i))); // 19..25
      for (const b of [19, 20, 24]) expect(hang(l.thisWeek, LOP, b)).toMatchObject({ ngoaiPhamVi: false, nhanPhamVi: null });
      expect(hang(l.thisWeek, LOP, 25)).toMatchObject({ ngoaiPhamVi: true, nhanPhamVi: nhanNgoai }); // Chủ nhật 25/10: SAU gói
      expect(hang(l.upcoming, LOP, 26)).toMatchObject({ ngoaiPhamVi: true, nhanPhamVi: nhanNgoai });
      expect(l.next).toMatchObject({ id: buoi(LOP, 19), ngoaiPhamVi: false }); // lựa chọn 'buổi kế tiếp' KHÔNG đổi (câu hỏi mở)
    });

    it("[PVL-12] CON HỌC HAI LỚP — một áp dụng, một không (cờ tắt ở CS2): cộng THEO TỪNG LỚP; lớp CS2 giữ đường cũ từng trường", async () => {
      await dungCaGiuaKhoa();
      await ghiDanh(A, LOP_K2);
      await diemDanh(A, LOP_K2, 4, "PRESENT");
      const { lich: l, buoiView: v } = await anh(A);
      expect(l).toMatchObject({ done: 6 + 18, total: 12 + 30, remaining: 6 + 12 });
      expect(v).toMatchObject({ done: 6 + 18, total: 12 + 30 });
      expect(v.sessions.filter((s) => s.id.startsWith(LOP_K2)).some((s) => "ngoaiPhamVi" in s || "nhanPhamVi" in s)).toBe(false);
      expect(l.thisWeek.filter((s) => s.id.startsWith(LOP_K2)).some((s) => "ngoaiPhamVi" in s || "nhanPhamVi" in s)).toBe(false);
      expect(hang(v.sessions, LOP, 5).ngoaiPhamVi).toBe(true); // lớp áp dụng vẫn có nhãn
      // chuaCham: lớp áp dụng 2 (bài 13, 18) + lớp CS2 (18 buổi đã qua − 1 buổi có dòng điểm danh) = 2 + 17
      expect(v.chuaCham).toBe(2 + 17);
    });
  });

  describe("số bài của buổi", () => {
    it("[PVL-13] nhãn theo BÀI CỦA LỘ TRÌNH (plan.order+1), không theo hạng theo ngày: buổi bài 14 bị dời lên ngày của bài 5 vẫn là 'trong phạm vi'", async () => {
      await dungCaGiuaKhoa();
      // hoán vị NGÀY của bài 5 và bài 14 (lệch 1 giờ để khỏi đụng khoá duy nhất): hạng-theo-ngày của buổi s14 thành 5, của buổi s5 thành 14
      await db.classSession.update({ where: { id: buoi(LOP, 5) }, data: { date: new Date(ngayBai(14).getTime() + GIO) } });
      await db.classSession.update({ where: { id: buoi(LOP, 14) }, data: { date: new Date(ngayBai(5).getTime() + GIO) } });
      // cùng phép hoán vị ở RANH GIỚI SAU GÓI (bài 24 ∈ 13–24, bài 25 ∉) cho phía lịch tuần — chỉ buổi chưa diễn ra mới có mặt ở đó
      await db.classSession.update({ where: { id: buoi(LOP, 25) }, data: { date: new Date(ngayBai(24).getTime() + GIO) } });
      await db.classSession.update({ where: { id: buoi(LOP, 24) }, data: { date: new Date(ngayBai(25).getTime() + GIO) } });
      const { lich, buoiView } = await anh(A);
      for (const v of [hang(buoiView.sessions, LOP, 14), hang(buoiView.sessions, LOP, 5)]) expect(v.order, "đã dời ngày thật").toBe(v.id === buoi(LOP, 14) ? 5 : 14);
      expect(hang(lich.upcoming, LOP, 24).order, "lịch tuần: đã dời ngày thật").toBe(25);
      expect(hang(lich.upcoming, LOP, 24)).toMatchObject({ ngoaiPhamVi: false, nhanPhamVi: null });
      expect(hang(lich.upcoming, LOP, 25)).toMatchObject({ ngoaiPhamVi: true, nhanPhamVi: nhanNgoai });
      expect(hang(buoiView.sessions, LOP, 24)).toMatchObject({ ngoaiPhamVi: false });
      expect(hang(buoiView.sessions, LOP, 25)).toMatchObject({ ngoaiPhamVi: true });
      expect(hang(buoiView.sessions, LOP, 14)).toMatchObject({ ngoaiPhamVi: false, nhanPhamVi: null }); // bài 14 ∈ 13–24
      expect(hang(buoiView.sessions, LOP, 5)).toMatchObject({ ngoaiPhamVi: true, nhanPhamVi: nhanNgoai }); // bài 5 ∉ 13–24
      expect(lich).toMatchObject({ done: 6, total: 12 });
    });
  });

  // ═══ CÁCH LY ════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("cách ly giữa các con", () => {
    it("[PVL-20] bé B cùng lớp, KHÔNG quyền học, trong khi A có ⇒ B giữ nguyên đường cũ (bật cờ = tắt cờ) và không thấy phạm vi của A", async () => {
      await dungCaGiuaKhoa();
      await ghiDanh(B, LOP);
      await diemDanh(B, LOP, 3, "PRESENT");
      await datCo(OU1, false);
      const tat = await anh(B);
      await datCo(OU1, true);
      const bat = await anh(B);
      expect(bat).toStrictEqual(tat);
      expect(bat.buoiView.sessions.some((s) => "ngoaiPhamVi" in s)).toBe(false);
      expect(bat.lich).toMatchObject({ done: 18, total: 30 });
      // đối chứng dương: cùng trạng thái DB, A thì CÓ phạm vi
      expect((await anh(A)).lich).toMatchObject({ done: 6, total: 12 });
    });

    it("[PVL-21] hai con cùng lớp, HAI quyền học khác nhau ⇒ mỗi con đọc quyền CỦA MÌNH (bài 5 ngoài phạm vi của A, trong phạm vi của B)", async () => {
      await ghiDanh(A, LOP);
      await ghiDanh(B, LOP);
      await capVaXep(A, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
      await capVaXep(B, { courseId: K1, classId: LOP, bai: 1, consumed: 7 });
      await datCo(OU1, true);
      const [ra, rb] = [await anh(A), await anh(B)];
      expect(hang(ra.buoiView.sessions, LOP, 5).ngoaiPhamVi).toBe(true);
      expect(hang(rb.buoiView.sessions, LOP, 5).ngoaiPhamVi).toBe(false);
      expect(rb.buoiView.sessions.filter((s) => s.ngoaiPhamVi).map((s) => s.id).sort()).toEqual(
        Array.from({ length: SO_BAI - 12 }, (_, i) => buoi(LOP, 13 + i)).sort(), // gói của B là bài 1–12 ⇒ 13..30 ngoài
      );
      expect(ra.lich).toMatchObject({ total: 12, done: 6 });
      expect(rb.lich).toMatchObject({ total: 12, done: 12 });
    });

    it("[PVL-22] chỉ B có quyền học ⇒ A (không quyền) giữ nguyên đường cũ", async () => {
      await ghiDanh(A, LOP);
      await ghiDanh(B, LOP);
      await diemDanhMau(A, LOP);
      await capVaXep(B, { courseId: K1, classId: LOP, bai: 13, consumed: 3 });
      await datCo(OU1, true);
      expect(await anh(A)).toStrictEqual(GOLDEN.thuong);
    });
  });
});
