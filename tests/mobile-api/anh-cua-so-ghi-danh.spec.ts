import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getStudentPhotos } from "@/lib/portal/photos";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [ANH-CS] V8.20 P4 — ảnh buổi học theo CỬA SỔ GHI DANH (Postgres thật, truy vấn dùng chung web ≡ mobile `getStudentPhotos`).
 * CHƯA CÓ chính sách được duyệt cho «ảnh chung cả lớp chụp NGOÀI khoảng ghi danh của con» (xem PRIVATE-MEDIA-V819 PM-1) ⇒ KHÔNG đổi hành vi production. Bộ này:
 *   · KHOÁ những gì đã đúng (chuyển lớp/rời lớp/ảnh gắn thẻ riêng/ảnh không thẻ không chung/chưa duyệt/thu hồi đồng ý);
 *   · GHIM rủi ro đã biết bằng `it.fails` (hôm nay ảnh chung lớp chụp TRƯỚC khi vào lớp / SAU khi hoàn thành VẪN hiện ⇒ ca mô tả hành vi ĐÚNG sẽ ĐỎ khi vá, buộc người vá gỡ ghim);
 *   · V8.21: BẢN VÁ ĐỀ XUẤT sau cờ `MEDIA_CLASSWIDE_ENROLLMENT_WINDOW` (MẶC ĐỊNH TẮT, chờ Owner) — [ANH-CS-09..12] chứng minh cờ BẬT làm hết rủi ro, cờ TẮT = hành vi cũ ([ANH-CS-06/07] vẫn it.fails);
 *   · CHỈ ĐẶC TẢ (không khẳng định đúng/sai) hành vi bảo lưu — chưa có chính sách.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "anhcs-";
const A = (k: string) => `${NS}${k}`;
const NGAY = 86_400_000;
const T = (soNgay: number) => new Date(Date.UTC(2026, 5, 15) + soNgay * NGAY);

async function don() {
  await db.mediaStudentTag.deleteMany({ where: { media: { classId: { startsWith: NS } } } });
  await db.classSessionMedia.deleteMany({ where: { classId: { startsWith: NS } } });
  await db.studentConsent.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
}
const ids = async (sid: string) => (await getStudentPhotos(sid, { urlTho: true })).groups.flatMap((g) => g.photos.map((p) => p.id)).sort();
const anh = (id: string, lop: string, o: { ngay: number; chung?: boolean; tag?: string[]; status?: string }) =>
  db.classSessionMedia.create({ data: { id: A(id), classId: A(lop), fileUrl: `private:class-media/${NS}x.png`, status: o.status ?? "APPROVED", isClassWide: o.chung ?? false, takenAt: T(o.ngay), ...(o.tag ? { tags: { create: o.tag.map((studentId) => ({ studentId })) } } : {}) } as never });
const dk = (id: string, sv: string, lop: string, status: string, enrolledNgay: number) =>
  db.enrollment.create({ data: { id: A(id), studentId: A(sv), classId: A(lop), courseId: A("kh"), status, centerId: A("cs"), enrolledAt: T(enrolledNgay) } as never });
const dongY = (sv: string, status: "GRANTED" | "REVOKED" = "GRANTED") => db.studentConsent.create({ data: { studentId: A(sv), type: "CLASS_MEDIA", status } as never });

describe.skipIf(!RUN)("[ANH-CS] ảnh buổi học theo cửa sổ ghi danh", () => {
  beforeAll(async () => {
    await don();
    await db.center.create({ data: { id: A("cs"), name: "CS ảnh", slug: A("cs"), address: "Đ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá ảnh", slug: A("kh"), totalSessions: 12 } });
    for (const l of ["l1", "l2"]) await db.class.create({ data: { id: A(l), name: l, classCode: A(l), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    for (const s of ["moi", "cu", "xong", "luu", "chuyen", "khac", "thu"]) await db.student.create({ data: { id: A(s), name: s, centerId: A("cs") } as never });
    for (const s of ["moi", "cu", "xong", "luu", "chuyen", "khac"]) await dongY(s);
    await dongY("thu", "REVOKED");
    // dòng thời gian lớp l1 (ngày tương đối): ảnh chung ngày 0 · 10 · 20 · 30
    await dk("dk-moi", "moi", "l1", "ACTIVE", 15); // vào lớp ngày 15
    await dk("dk-cu", "cu", "l1", "ACTIVE", -30); // vào từ trước
    await dk("dk-xong", "xong", "l1", "COMPLETED", -30); // đã hoàn thành (ngày kết thúc ~ 12)
    await db.enrollment.update({ where: { id: A("dk-xong") }, data: { endDate: T(12) } });
    await dk("dk-luu", "luu", "l1", "PAUSED", -30); // đang bảo lưu
    await dk("dk-chuyen-cu", "chuyen", "l1", "TRANSFERRED", -30); // đã chuyển khỏi l1
    await dk("dk-chuyen-moi", "chuyen", "l2", "ACTIVE", 5); // sang l2
    await dk("dk-thu", "thu", "l1", "ACTIVE", -30);
    await dk("dk-khac", "khac", "l2", "ACTIVE", -30);
    await anh("c0", "l1", { ngay: 0, chung: true });
    await anh("c10", "l1", { ngay: 10, chung: true });
    await anh("c20", "l1", { ngay: 20, chung: true });
    await anh("c30", "l1", { ngay: 30, chung: true });
    await anh("t-cu", "l1", { ngay: 10, tag: [A("cu")] }); // gắn thẻ riêng
    await anh("t-moi-truoc", "l1", { ngay: 3, tag: [A("moi")] }); // gắn thẻ con vào muộn nhưng ảnh chụp trước khi vào
    await anh("khong-the", "l1", { ngay: 10 }); // không thẻ, không chung
    await anh("cho-duyet", "l1", { ngay: 10, chung: true, status: "PENDING" });
    await anh("tu-choi", "l1", { ngay: 10, chung: true, status: "REJECTED" });
    await anh("l2-chung", "l2", { ngay: 20, chung: true });
  }, 60_000);
  afterAll(don);

  it("[ANH-CS-01] KHOÁ: chỉ APPROVED; ảnh không thẻ/không chung ẩn; ảnh gắn thẻ riêng chỉ hiện cho con được gắn", async () => {
    const cu = await ids(A("cu"));
    expect(cu).toContain(A("t-cu"));
    expect(cu).not.toContain(A("khong-the"));
    expect(cu).not.toContain(A("cho-duyet"));
    expect(cu).not.toContain(A("tu-choi"));
    expect(cu).not.toContain(A("l2-chung")); // lớp khác
    expect(await ids(A("khac"))).not.toContain(A("t-cu")); // con khác lớp không thấy ảnh gắn thẻ con khác
    expect(await ids(A("moi"))).not.toContain(A("t-cu"));
  });

  it("[ANH-CS-02] KHOÁ: chuyển lớp — ảnh lớp CŨ không còn; lớp mới có; rời lớp (không còn ghi danh hợp lệ) ⇒ không ảnh lớp đó", async () => {
    const d = await ids(A("chuyen"));
    expect(d.some((x) => x.startsWith(`${NS}c`) && x !== A("l2-chung"))).toBe(false); // không còn ảnh l1
    expect(d).toContain(A("l2-chung"));
  });

  it("[ANH-CS-03] KHOÁ: thu hồi đồng ý ⇒ 0 ảnh, kể cả ảnh chung và ảnh gắn thẻ", async () => {
    expect(await ids(A("thu"))).toEqual([]);
  });

  it("[ANH-CS-04] KHOÁ: ảnh chung lớp chụp TRONG thời gian con học và con đang học ⇒ hiện", async () => {
    const cu = await ids(A("cu"));
    for (const id of ["c0", "c10", "c20", "c30"]) expect(cu).toContain(A(id));
  });

  it("[ANH-CS-05] ĐẶC TẢ HIỆN HÀNH (chưa có chính sách): bảo lưu PAUSED vẫn thuộc danh sách ghi danh có lịch sử ⇒ thấy ảnh chung lớp", async () => {
    expect(await ids(A("luu"))).toEqual(expect.arrayContaining([A("c10"), A("c20")]));
  });

  // ── RỦI RO ĐÃ BIẾT (PM-1): ghim bằng it.fails — vá xong ca đỏ ⇒ gỡ ghim ──
  it.fails("[ANH-CS-06] 🔴 PM-1: con vào lớp ngày 15 KHÔNG được thấy ảnh CHUNG LỚP chụp ngày 0/10 (trước khi vào)", async () => {
    const moi = await ids(A("moi"));
    expect(moi).not.toContain(A("c0"));
    expect(moi).not.toContain(A("c10"));
    expect(moi).toContain(A("c20")); // sau khi vào thì thấy
  });

  it.fails("[ANH-CS-07] 🔴 PM-1: con đã HOÀN THÀNH khoá (endDate ngày 12) KHÔNG được thấy ảnh chung lớp chụp ngày 20/30 (sau khi xong)", async () => {
    const xong = await ids(A("xong"));
    expect(xong).not.toContain(A("c20"));
    expect(xong).not.toContain(A("c30"));
    expect(xong).toContain(A("c10"));
  });

  it("[ANH-CS-08] KHOÁ: ảnh gắn thẻ RIÊNG con luôn hiện (thẻ là bằng chứng quyền), kể cả chụp trước ngày vào — không thuộc rủi ro class-wide", async () => {
    expect(await ids(A("moi"))).toContain(A("t-moi-truoc"));
  });

  // ── BẢN VÁ ĐỀ XUẤT (cờ BẬT) ──
  const voiCo = async (fn: () => Promise<void>) => {
    const cu = process.env.MEDIA_CLASSWIDE_ENROLLMENT_WINDOW;
    process.env.MEDIA_CLASSWIDE_ENROLLMENT_WINDOW = "true";
    try {
      await fn();
    } finally {
      if (cu === undefined) delete process.env.MEDIA_CLASSWIDE_ENROLLMENT_WINDOW;
      else process.env.MEDIA_CLASSWIDE_ENROLLMENT_WINDOW = cu;
    }
  };

  it("[ANH-CS-09] cờ BẬT: con vào lớp ngày 15 chỉ thấy ảnh chung lớp từ ngày 15 trở đi (không ảnh ngày 0/10); ảnh gắn thẻ riêng trước ngày vào VẪN hiện", () =>
    voiCo(async () => {
      const moi = await ids(A("moi"));
      expect(moi).not.toContain(A("c0"));
      expect(moi).not.toContain(A("c10"));
      expect(moi).toEqual(expect.arrayContaining([A("c20"), A("c30"), A("t-moi-truoc")]));
    }));

  it("[ANH-CS-10] cờ BẬT: con HOÀN THÀNH (endDate ngày 12) thấy ảnh chung lớp ≤ ngày 12, KHÔNG thấy ngày 20/30", () =>
    voiCo(async () => {
      const xong = await ids(A("xong"));
      expect(xong).toEqual(expect.arrayContaining([A("c0"), A("c10")]));
      expect(xong).not.toContain(A("c20"));
      expect(xong).not.toContain(A("c30"));
    }));

  it("[ANH-CS-11] cờ BẬT, fail-closed: ảnh chung lớp THIẾU takenAt ẩn; ghi danh COMPLETED thiếu endDate ⇒ ẩn mọi ảnh chung lớp", () =>
    voiCo(async () => {
      await db.classSessionMedia.update({ where: { id: A("c20") }, data: { takenAt: null } });
      expect(await ids(A("cu"))).not.toContain(A("c20"));
      await db.enrollment.update({ where: { id: A("dk-xong") }, data: { endDate: null } });
      const xong = await ids(A("xong"));
      expect(xong.filter((x) => [A("c0"), A("c10"), A("c30")].includes(x))).toEqual([]);
      await db.enrollment.update({ where: { id: A("dk-xong") }, data: { endDate: T(12) } });
      await db.classSessionMedia.update({ where: { id: A("c20") }, data: { takenAt: T(20) } });
    }));

  it("[ANH-CS-12] cờ BẬT không đổi: con cũ (vào từ trước, đang học) vẫn thấy mọi ảnh chung lớp; thu hồi đồng ý vẫn 0 ảnh; chuyển lớp: ảnh lớp cũ vẫn ẩn", () =>
    voiCo(async () => {
      expect(await ids(A("cu"))).toEqual(expect.arrayContaining([A("c0"), A("c10"), A("c20"), A("c30")]));
      expect(await ids(A("thu"))).toEqual([]);
      const d = await ids(A("chuyen"));
      expect(d).toContain(A("l2-chung"));
      expect(d.filter((x) => [A("c0"), A("c10"), A("c20"), A("c30")].includes(x))).toEqual([]);
    }));
});
