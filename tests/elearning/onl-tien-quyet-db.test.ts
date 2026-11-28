// @vitest-environment node
/**
 * [ONL-TQ-*] C13 (Owner 25/11/2026, xác nhận trực tiếp trong phiên E) — TIÊN QUYẾT `REQUIRED` khi CẤP quyền học (Postgres thật).
 *
 * Luật Owner: "hoàn thành khoá trước" = trạng thái hoàn thành HỢP LỆ **HOẶC** chứng nhận HỢP LỆ đã cấp; CHỈ chặn khi `REQUIRED`, `RECOMMENDED` chỉ cảnh báo (không chặn);
 * kiểm ở SERVER (`capQuyenHoc`, cùng giao dịch, trước mọi phép ghi).
 * Diễn giải của E (ghi rõ để Owner đổi được): "hợp lệ" = quyền khoá trước KHÔNG bị thu hồi (hết hạn vẫn tính) và `tinhTienDoKhoa(...).hoanThanh`; HOẶC có `OnlCertificate` `ISSUED`
 * (bền, kể cả quyền đã thu hồi). Chỉ kiểm khi TẠO MỚI / MỞ LẠI quyền (gia hạn người đang có quyền KHÔNG bị chặn). Khoá tiên quyết đã xoá mềm ⇒ không chặn.
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG cùng bộ.
 *
 * ⚠️ AN TOÀN DB: dọn bằng `donBangOnl` ở beforeAll VÀ afterAll; chỉ chạy trên DB thử.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { sinhMaChungNhan } from "../../lib/elearning-online/chung-nhan";
import { docTienDoKhoaTheoQuyen } from "../../lib/elearning-online/hoc-tap";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONL_TQ_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
let dem = 0;
const key = (t: string) => `${P}${t}-${++dem}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
}

type Mode = "NONE" | "RECOMMENDED" | "REQUIRED";
type Khoa = { id: string; baiA: string; baiB: string };
let seq = 0;
async function dungKhoa(o: { mode?: Mode; tienQuyetId?: string | null; thang?: number | null; choGiaHan?: boolean } = {}): Promise<Khoa> {
  const n = ++seq;
  const code = `CI-ONL-TQ-${Date.now().toString(36).toUpperCase()}-${n}`;
  const khoa = await db.onlCourse.create({
    data: {
      code,
      slug: code.toLowerCase(),
      name: `${P}Khoá ${n}`,
      validityMonths: o.thang === undefined ? 12 : o.thang,
      renewalEnabled: o.choGiaHan ?? true,
      saleStatus: "ON_SALE",
      listPrice: 890_000,
      salePrice: 890_000,
      prerequisiteMode: o.mode ?? "NONE",
      prerequisiteCourseId: o.tienQuyetId ?? null,
    },
    select: { id: true },
  });
  const ban = await db.onlCourseVersion.create({
    data: { courseId: khoa.id, number: 1, status: "PUBLISHED", publishedAt: NOW, settingsJson: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } as object },
    select: { id: true },
  });
  const ch = await db.onlChapter.create({ data: { versionId: ban.id, stableId: `ch-${n}`, title: "Chương 1", orderIndex: 0 }, select: { id: true } });
  for (const [i, s] of ["a", "b"].entries()) {
    await db.onlLesson.create({ data: { versionId: ban.id, chapterId: ch.id, stableId: `${s}-${n}`, kind: "VIDEO", title: `Bài ${s}`, orderIndex: i }, select: { id: true } });
  }
  await db.onlCourse.update({ where: { id: khoa.id }, data: { publishedVersionId: ban.id } });
  return { id: khoa.id, baiA: `a-${n}`, baiB: `b-${n}` };
}
const taoHocVien = (t: string) => db.student.create({ data: { name: `${P}${t}` }, select: { id: true } });
const capMienPhi = (studentId: string, courseId: string, now = NOW) => capQuyenHoc(db, { studentId, courseId, loai: "CAP_MIEN_PHI", now, idempotencyKey: key("tq") });
const mua = (studentId: string, courseId: string, k = key("mua")) => capQuyenHoc(db, { studentId, courseId, loai: "MUA", now: NOW, idempotencyKey: k });

/** Học viên có quyền ở khoá tiên quyết + hoàn thành MỌI bài bắt buộc. Trả entitlementId. */
async function hocXong(studentId: string, kq: Khoa, now = NOW): Promise<string> {
  const r = await capMienPhi(studentId, kq.id, now);
  if (!r.ok) throw new Error(`dựng fixture: ${r.ma}`);
  await db.onlLessonProgress.createMany({
    data: [kq.baiA, kq.baiB].map((s) => ({ entitlementId: r.entitlementId, lessonStableId: s, status: "COMPLETED" as const, percent: 100, completedAt: now, completedVersionNumber: 1 })),
  });
  return r.entitlementId;
}
const soQuyen = (studentId: string, courseId: string) => db.onlEntitlement.count({ where: { studentId, courseId } });
const soSuKien = (studentId: string, courseId: string) => db.onlEntitlementEvent.count({ where: { entitlement: { studentId, courseId } } });
async function chungNhan(studentId: string, courseId: string, entitlementId: string, status: "ISSUED" | "REVOKED") {
  await db.onlCertificate.create({
    data: { studentId, courseId, entitlementId, code: sinhMaChungNhan(), status, studentName: "T", courseName: "K", courseCode: "K", versionNumber: 1, issuedAt: NOW, ...(status === "REVOKED" ? { revokedAt: NOW, revokedReason: "thu hồi thử nghiệm" } : {}) },
  });
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-TQ] tiên quyết REQUIRED khi cấp quyền học (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-TQ-01] 🔴 REQUIRED + CHƯA học khoá tiên quyết ⇒ MUA bị từ chối TIEN_QUYET_CHUA_DAT và KHÔNG ghi gì (0 quyền, 0 sự kiện); đối chứng DƯƠNG: học xong rồi cùng khoá ⇒ cấp được", async () => {
    const tq = await dungKhoa();
    const k = await dungKhoa({ mode: "REQUIRED", tienQuyetId: tq.id });
    const hv = await taoHocVien("01");
    const r = await mua(hv.id, k.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("TIEN_QUYET_CHUA_DAT");
    expect(await soQuyen(hv.id, k.id)).toBe(0);
    expect(await soSuKien(hv.id, k.id)).toBe(0);
    // đối chứng dương (cùng học viên, cùng khoá)
    const eid = await hocXong(hv.id, tq);
    const td = await docTienDoKhoaTheoQuyen(db, eid, tq.id);
    expect(td.hoanThanh, "fixture phải thật sự hoàn thành, không thì ca dương vô nghĩa").toBe(true);
    const r2 = await mua(hv.id, k.id);
    expect(r2.ok).toBe(true);
    expect(await soQuyen(hv.id, k.id)).toBe(1);
  });

  it("[ONL-TQ-02] 🔴 REQUIRED + CÓ quyền khoá trước nhưng CHƯA hoàn thành (mới xong 1/2 bài) ⇒ chặn; hoàn thành nốt ⇒ cấp được", async () => {
    const tq = await dungKhoa();
    const k = await dungKhoa({ mode: "REQUIRED", tienQuyetId: tq.id });
    const hv = await taoHocVien("02");
    const r0 = await capMienPhi(hv.id, tq.id);
    if (!r0.ok) throw new Error(r0.ma);
    await db.onlLessonProgress.create({ data: { entitlementId: r0.entitlementId, lessonStableId: tq.baiA, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
    const chan = await mua(hv.id, k.id);
    expect(chan.ok).toBe(false);
    await db.onlLessonProgress.create({ data: { entitlementId: r0.entitlementId, lessonStableId: tq.baiB, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
    expect((await mua(hv.id, k.id)).ok).toBe(true);
  });

  it("[ONL-TQ-03] 🔴 chứng nhận ISSUED thay cho tiến độ ⇒ cấp được; chứng nhận REVOKED + chưa hoàn thành ⇒ chặn (chứng nhận phải HỢP LỆ)", async () => {
    const tq = await dungKhoa();
    const k = await dungKhoa({ mode: "REQUIRED", tienQuyetId: tq.id });
    const hvDuong = await taoHocVien("03a");
    const eA = await capMienPhi(hvDuong.id, tq.id);
    if (!eA.ok) throw new Error(eA.ma);
    await chungNhan(hvDuong.id, tq.id, eA.entitlementId, "ISSUED"); // KHÔNG có dòng tiến độ nào
    expect((await mua(hvDuong.id, k.id)).ok, "ISSUED ⇒ đạt").toBe(true);
    const hvAm = await taoHocVien("03b");
    const eB = await capMienPhi(hvAm.id, tq.id);
    if (!eB.ok) throw new Error(eB.ma);
    await chungNhan(hvAm.id, tq.id, eB.entitlementId, "REVOKED");
    const r = await mua(hvAm.id, k.id);
    expect(r.ok, "REVOKED không tính").toBe(false);
  });

  it("[ONL-TQ-04] 🔴 RECOMMENDED và NONE KHÔNG chặn dù chưa học; đối chứng: cùng cấu hình khoá tiên quyết nhưng REQUIRED thì chặn", async () => {
    const tq = await dungKhoa();
    const hv = await taoHocVien("04");
    const kRec = await dungKhoa({ mode: "RECOMMENDED", tienQuyetId: tq.id });
    const kNone = await dungKhoa({ mode: "NONE", tienQuyetId: null });
    const kReq = await dungKhoa({ mode: "REQUIRED", tienQuyetId: tq.id });
    expect((await mua(hv.id, kRec.id)).ok, "RECOMMENDED").toBe(true);
    expect((await mua(hv.id, kNone.id)).ok, "NONE").toBe(true);
    expect((await mua(hv.id, kReq.id)).ok, "REQUIRED (đối chứng)").toBe(false);
  });

  it("[ONL-TQ-05] 🔴 quyền khoá trước đã THU HỒI + đã hoàn thành, không chứng nhận ⇒ chặn; quyền HẾT HẠN + đã hoàn thành ⇒ cấp được (hết hạn vẫn tính, thu hồi không tính)", async () => {
    const tq = await dungKhoa({ thang: 12 });
    const k = await dungKhoa({ mode: "REQUIRED", tienQuyetId: tq.id });
    const hvThuHoi = await taoHocVien("05a");
    await hocXong(hvThuHoi.id, tq);
    const th = await thuHoiQuyenHoc(db, { studentId: hvThuHoi.id, courseId: tq.id, reason: "thu hồi thử nghiệm tiên quyết", idempotencyKey: key("th"), now: NOW });
    expect(th.ok).toBe(true);
    expect((await mua(hvThuHoi.id, k.id)).ok, "thu hồi không tính").toBe(false);
    const hvHetHan = await taoHocVien("05b");
    await hocXong(hvHetHan.id, tq, new Date(NOW.getTime() - 400 * 86_400_000)); // cấp cách đây 400 ngày, hạn 12 tháng ⇒ đã hết hạn lúc NOW
    expect((await mua(hvHetHan.id, k.id)).ok, "hết hạn vẫn tính").toBe(true);
  });

  it("[ONL-TQ-06] 🔴 GIA HẠN người ĐANG có quyền KHÔNG bị chặn dù tiên quyết nay không đạt; đối chứng: học viên MỚI cùng khoá vẫn bị chặn", async () => {
    const tq = await dungKhoa();
    const k = await dungKhoa({ mode: "NONE", thang: 12, choGiaHan: true });
    const hv = await taoHocVien("06");
    expect((await mua(hv.id, k.id)).ok).toBe(true); // có quyền khi khoá còn tự do
    await db.onlCourse.update({ where: { id: k.id }, data: { prerequisiteMode: "REQUIRED", prerequisiteCourseId: tq.id } });
    const gh = await capQuyenHoc(db, { studentId: hv.id, courseId: k.id, loai: "GIA_HAN", now: NOW, idempotencyKey: key("gh") });
    expect(gh.ok, "gia hạn không bị chặn").toBe(true);
    const moi = await taoHocVien("06b");
    expect((await mua(moi.id, k.id)).ok, "người mới vẫn bị chặn").toBe(false);
  });

  it("[ONL-TQ-07] 🔴 gọi LẠI cùng khoá idempotency sau khi đã cấp ⇒ vẫn ok (không bị tiên quyết biến thành lỗi — webhook retry); khoá tiên quyết đã XOÁ MỀM ⇒ không chặn", async () => {
    const tq = await dungKhoa();
    const k = await dungKhoa({ mode: "NONE" });
    const hv = await taoHocVien("07");
    const khoa = key("lap");
    const r1 = await mua(hv.id, k.id, khoa);
    expect(r1.ok).toBe(true);
    await db.onlCourse.update({ where: { id: k.id }, data: { prerequisiteMode: "REQUIRED", prerequisiteCourseId: tq.id } });
    const r2 = await mua(hv.id, k.id, khoa);
    expect(r2.ok, "lặp cùng khoá ⇒ kết quả cũ").toBe(true);
    if (r2.ok) expect(r2.daXuLyTruocDo).toBe(true);
    // xoá mềm khoá tiên quyết ⇒ người mới không bị chặn (không có gì để đạt)
    await db.onlCourse.update({ where: { id: tq.id }, data: { deletedAt: NOW } });
    const moi = await taoHocVien("07b");
    expect((await mua(moi.id, k.id)).ok).toBe(true);
  });
});
