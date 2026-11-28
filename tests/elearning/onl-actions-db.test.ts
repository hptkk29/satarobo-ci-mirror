// @vitest-environment node
/**
 * [ONL-ACT-*] E-learning ONLINE — action chạy qua `runAction` THẬT (zod → can() → handler → AuditLog) trên Postgres thật.
 *
 * Quyền lấy từ CHÍNH `ROLE_SEED` (nguồn của RoleDef v2 trên prod) — không tự bịa bảng quyền trong test. Mỗi ca âm có ca dương đối chứng
 * (luật 11: ca "KHÔNG thấy/KHÔNG được" mà thiếu đối chứng dương luôn ĐẠT khi tính năng hỏng hoàn toàn).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { runAction, type ActionConfig } from "../../lib/actions/factory";
import { ROLE_SEED } from "../../prisma/seed-roles";
import {
  cauHinhCapChungNhanTay, cauHinhCapQuyen, cauHinhChamTay, cauHinhLuuCaiDat, cauHinhLuuCauHoi, cauHinhLuuDeThi, cauHinhLuuTruCauHoi, cauHinhMoBanNhap, cauHinhPhatHanh, cauHinhSuaKhoa, cauHinhTaoKhoa,
  cauHinhThemBai, cauHinhThemChuong, cauHinhThuHoiChungNhan, cauHinhThuHoiQuyen, cauHinhXemTruocPhatHanh, cauHinhXoaBai,
} from "../../lib/elearning-online/actions";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLA_";
let n = 0;
let nguoiThucHien = "";
const khoaKey = (t: string) => `${P}${t}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

/** Actor dựng từ RoleDef của seed (quyền GLOBAL như seed khai). */
function actorCua(code: string): Actor {
  const role = ROLE_SEED.find((r) => r.code === code);
  if (!role) throw new Error(`Thiếu vai ${code}`);
  return {
    userId: nguoiThucHien,
    isSuperAdmin: code === "SUPER_ADMIN",
    isHoLevel: true,
    orgRoles: [],
    permissions: role.perms.map((p) => ({ action: p.action, scopeType: p.scopeType, centerScope: "ALL" })),
    permissionGrants: [],
    roleIds: [],
    groupIds: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

const chay = <I, T>(cfg: ActionConfig<I, T>, code: string, input: unknown, reason?: string) => runAction(cfg, actorCua(code), input, { actorName: "Người thử", reason });
const loiMa = (r: { res: { ok: boolean; error?: { code: string } } }) => (r.res.ok ? "OK" : r.res.error!.code);

async function don() {
  await donBangOnl(db);
  await db.auditLog.deleteMany({ where: { module: "elearning-online", actorName: "Người thử" } });
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onla-" } } });
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-ACT] action Online qua runAction (Postgres thật)", () => {
  beforeAll(async () => {
    await don();
    const u = await db.user.create({ data: { name: `${P}admin`, email: `ci-onla-${Date.now()}@example.test`, role: "SUPER_ADMIN" }, select: { id: true } });
    nguoiThucHien = u.id;
  }, 120_000);
  afterAll(don, 120_000);

  const khoaMau = () => ({ code: `CI-ONLA-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 900_000, salePrice: 800_000, validityMonths: 12, renewalEnabled: false });

  it("[ONL-ACT-01] 🔴 ai được TẠO khoá: Đào tạo & Quản trị CÓ; Marketing/Kế toán/CSKH/Phụ huynh/GV/QLCS KHÔNG — và bị từ chối thì KHÔNG ghi DB lẫn sổ audit", async () => {
    const truocKhoa = await db.onlCourse.count();
    const truocAudit = await db.auditLog.count({ where: { module: "elearning-online", entityType: "OnlCourse", action: "CREATE", actorName: "Người thử" } });
    for (const code of ["TRAINING", "SUPER_ADMIN"]) {
      const r = await chay(cauHinhTaoKhoa, code, khoaMau());
      expect(loiMa(r), code).toBe("OK");
    }
    expect(await db.onlCourse.count()).toBe(truocKhoa + 2);
    expect(await db.auditLog.count({ where: { module: "elearning-online", entityType: "OnlCourse", action: "CREATE", actorName: "Người thử" } })).toBe(truocAudit + 2);
    const giua = await db.onlCourse.count();
    for (const code of ["HO_MARKETING", "HO_ACCOUNTANT", "CENTER_SALES_CSM", "PARENT", "TEACHER", "CENTER_MANAGER", "AUDITOR"]) {
      expect(loiMa(await chay(cauHinhTaoKhoa, code, khoaMau())), code).toBe("PERMISSION_DENIED");
    }
    expect(await db.onlCourse.count()).toBe(giua);
    expect(await db.auditLog.count({ where: { module: "elearning-online", entityType: "OnlCourse", action: "CREATE", actorName: "Người thử" } })).toBe(truocAudit + 2);
  });

  it("[ONL-ACT-02] 🔴 Marketing CHỈ ĐỌC: sửa khoá, mở nháp, xem trước phát hành, cấp quyền, thu hồi đều bị từ chối", async () => {
    const t = await chay(cauHinhTaoKhoa, "TRAINING", khoaMau());
    if (!t.res.ok) throw new Error("tao");
    const { courseId, draftVersionId } = t.res.data;
    const hv = await db.student.create({ data: { name: `${P}hv-mk` }, select: { id: true } });
    const thu = [
      chay(cauHinhSuaKhoa, "HO_MARKETING", { courseId, name: "đổi", listPrice: 1, salePrice: 1, validityMonths: 1, renewalEnabled: false }),
      chay(cauHinhMoBanNhap, "HO_MARKETING", { courseId }),
      chay(cauHinhThemChuong, "HO_MARKETING", { versionId: draftVersionId, title: "x" }),
      chay(cauHinhXemTruocPhatHanh, "HO_MARKETING", { courseId }),
      chay(cauHinhCapQuyen, "HO_MARKETING", { courseId, studentId: hv.id, loai: "CAP_MIEN_PHI", idempotencyKey: khoaKey("mk") }, "Marketing thử cấp quyền"),
      chay(cauHinhThuHoiQuyen, "HO_MARKETING", { courseId, studentId: hv.id, idempotencyKey: khoaKey("mk") }, "Marketing thử thu hồi"),
    ];
    for (const r of await Promise.all(thu)) expect(loiMa(r)).toBe("PERMISSION_DENIED");
    // đối chứng dương: Đào tạo làm được đúng những việc đó
    expect(loiMa(await chay(cauHinhSuaKhoa, "TRAINING", { courseId, name: "Tên mới", listPrice: 900_000, salePrice: 800_000, validityMonths: 12, renewalEnabled: false }))).toBe("OK");
    expect(loiMa(await chay(cauHinhThemChuong, "TRAINING", { versionId: draftVersionId, title: "Chương 1" }))).toBe("OK");
    expect(loiMa(await chay(cauHinhXemTruocPhatHanh, "TRAINING", { courseId }))).toBe("OK"); // xem trước vẫn được dù bản chưa đạt chất lượng (chỉ báo lỗi)
  });

  it("[ONL-ACT-03] 🔴 CẤP / THU HỒI quyền: bắt buộc LÝ DO; Quản trị/Đào tạo được, Kế toán/CSKH không; ghi sổ audit kèm lý do; thu hồi chặn nội dung ngay", async () => {
    const t = await chay(cauHinhTaoKhoa, "TRAINING", khoaMau());
    if (!t.res.ok) throw new Error("tao");
    const { courseId, draftVersionId } = t.res.data;
    const ch = await chay(cauHinhThemChuong, "TRAINING", { versionId: draftVersionId, title: "C" });
    if (!ch.res.ok) throw new Error("chuong");
    const bai = await chay(cauHinhThemBai, "TRAINING", { versionId: draftVersionId, chapterId: ch.res.data.chapterId, kind: "READ", title: "B", contentJson: { body: "x" } });
    if (!bai.res.ok) throw new Error("bai");
    const xt = await chay(cauHinhXemTruocPhatHanh, "TRAINING", { courseId });
    if (!xt.res.ok) throw new Error("xt");
    const ph = await chay(cauHinhPhatHanh, "SUPER_ADMIN", { courseId, dauVet: xt.res.data.dauVet, xacNhan: "PHAT HANH" });
    expect(loiMa(ph)).toBe("OK");
    const hv = await db.student.create({ data: { name: `${P}hv-cap` }, select: { id: true } });
    const cap = (code: string, reason?: string, key = khoaKey("cap")) => chay(cauHinhCapQuyen, code, { courseId, studentId: hv.id, loai: "CAP_MIEN_PHI", idempotencyKey: key }, reason);

    expect(loiMa(await cap("TRAINING"))).toBe("VALIDATION"); // thiếu lý do
    expect(loiMa(await cap("TRAINING", "   "))).toBe("VALIDATION");
    for (const code of ["HO_ACCOUNTANT", "CENTER_SALES_CSM", "PARENT"]) expect(loiMa(await cap(code, "Lý do đầy đủ cho việc cấp")), code).toBe("PERMISSION_DENIED");
    expect(await db.onlEntitlement.count({ where: { studentId: hv.id } })).toBe(0);
    const key = khoaKey("ok");
    const ok = await cap("TRAINING", "Tặng học bổng theo quyết định BGĐ", key);
    expect(loiMa(ok)).toBe("OK");
    // bấm lại cùng khoá (nhấp đúp) ⇒ không cấp hai lần
    const lai = await cap("TRAINING", "Tặng học bổng theo quyết định BGĐ", key);
    expect(lai.res.ok && lai.res.data.daXuLyTruocDo).toBe(true);
    expect(await db.onlEntitlementEvent.count({ where: { entitlement: { studentId: hv.id } } })).toBe(1);
    const sk = await db.onlEntitlementEvent.findFirstOrThrow({ where: { entitlement: { studentId: hv.id } } });
    expect(sk).toMatchObject({ kind: "GRANTED", source: "FREE_GRANT", reason: "Tặng học bổng theo quyết định BGĐ", actorUserId: nguoiThucHien });
    const audit = await db.auditLog.findFirst({ where: { module: "elearning-online", entityType: "OnlEntitlement", action: "GRANT", actorName: "Người thử" }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
    expect(audit?.reason).toBe("Tặng học bổng theo quyết định BGĐ");

    // thu hồi: thiếu lý do / lý do ngắn / sai vai bị từ chối; đúng thì quyền chuyển REVOKED
    const thuHoi = (code: string, reason?: string) => chay(cauHinhThuHoiQuyen, code, { courseId, studentId: hv.id, idempotencyKey: khoaKey("th") }, reason);
    expect(loiMa(await thuHoi("TRAINING"))).toBe("VALIDATION");
    expect(loiMa(await thuHoi("HO_ACCOUNTANT", "Hoàn tiền đơn hàng ABC"))).toBe("PERMISSION_DENIED");
    expect(loiMa(await thuHoi("TRAINING", "ngắn"))).toBe("LY_DO_QUA_NGAN");
    expect((await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id } })).status).toBe("ACTIVE");
    expect(loiMa(await thuHoi("SUPER_ADMIN", "Hoàn tiền đơn hàng ABC"))).toBe("OK");
    const sau = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id } });
    expect(sau).toMatchObject({ status: "REVOKED", revokedReason: "Hoàn tiền đơn hàng ABC", revokedByUserId: nguoiThucHien });
  });

  it("[ONL-ACT-04] 🔴 phát hành qua action: Đào tạo/Quản trị được, Marketing/Kế toán không; thiếu chính sách ở bản 2 ⇒ THIEU_CHINH_SACH (mã ổn định cho giao diện)", async () => {
    const t = await chay(cauHinhTaoKhoa, "TRAINING", khoaMau());
    if (!t.res.ok) throw new Error("tao");
    const { courseId, draftVersionId } = t.res.data;
    const ch = await chay(cauHinhThemChuong, "TRAINING", { versionId: draftVersionId, title: "C" });
    if (!ch.res.ok) throw new Error("c");
    const b = await chay(cauHinhThemBai, "TRAINING", { versionId: draftVersionId, chapterId: ch.res.data.chapterId, kind: "READ", title: "B", contentJson: { body: "x" } });
    if (!b.res.ok) throw new Error("b");
    const xt = await chay(cauHinhXemTruocPhatHanh, "TRAINING", { courseId });
    if (!xt.res.ok) throw new Error("xt");
    const input = { courseId, dauVet: xt.res.data.dauVet, xacNhan: "PHAT HANH" };
    expect(loiMa(await chay(cauHinhPhatHanh, "HO_MARKETING", input))).toBe("PERMISSION_DENIED");
    expect(loiMa(await chay(cauHinhPhatHanh, "HO_ACCOUNTANT", input))).toBe("PERMISSION_DENIED");
    expect(await db.onlCourseVersion.count({ where: { courseId, status: "PUBLISHED" } })).toBe(0);
    expect(loiMa(await chay(cauHinhPhatHanh, "TRAINING", input))).toBe("OK");
    // bản 2: mở nháp, sửa 1 bài, phát hành KHÔNG chính sách
    const mo = await chay(cauHinhMoBanNhap, "TRAINING", { courseId });
    expect(loiMa(mo)).toBe("OK");
    const cai = await chay(cauHinhLuuCaiDat, "TRAINING", { versionId: mo.res.ok ? mo.res.data.versionId : "", caiDat: { ...caiDatKhoiDauChoBanNhap(), khongChoXemLaiBaiDaQua: true } });
    expect(loiMa(cai)).toBe("OK");
    const xt2 = await chay(cauHinhXemTruocPhatHanh, "TRAINING", { courseId });
    if (!xt2.res.ok) throw new Error("xt2");
    expect(loiMa(await chay(cauHinhPhatHanh, "TRAINING", { courseId, dauVet: xt2.res.data.dauVet, xacNhan: "PHAT HANH" }))).toBe("THIEU_CHINH_SACH");
    const cs = { loai: "KEEP_PROGRESS" as const };
    const xt3 = await chay(cauHinhXemTruocPhatHanh, "TRAINING", { courseId, chinhSach: cs });
    if (!xt3.res.ok) throw new Error("xt3");
    expect(loiMa(await chay(cauHinhPhatHanh, "TRAINING", { courseId, chinhSach: cs, dauVet: xt3.res.data.dauVet, xacNhan: "PHAT HANH" }))).toBe("OK");
    const audit = await db.auditLog.findFirst({ where: { module: "elearning-online", action: "PUBLISH" }, orderBy: { createdAt: "desc" } });
    expect(audit?.newValues).toMatchObject({ courseId, chinhSach: cs });
  });

  it("[ONL-ACT-05] xoá bài / xoá chương bắt buộc lý do; nội dung bài KHÔNG bị ghi vào sổ audit (chỉ tên trường đổi)", async () => {
    const t = await chay(cauHinhTaoKhoa, "TRAINING", khoaMau());
    if (!t.res.ok) throw new Error("tao");
    const ch = await chay(cauHinhThemChuong, "TRAINING", { versionId: t.res.data.draftVersionId, title: "C" });
    if (!ch.res.ok) throw new Error("c");
    const b = await chay(cauHinhThemBai, "TRAINING", { versionId: t.res.data.draftVersionId, chapterId: ch.res.data.chapterId, kind: "READ", title: "B", contentJson: { body: "THÂN-BÀI-BÍ-MẬT-ĐỪNG-GHI-VÀO-AUDIT" } });
    if (!b.res.ok) throw new Error("b");
    expect(loiMa(await chay(cauHinhXoaBai, "TRAINING", { lessonId: b.res.data.lessonId }))).toBe("VALIDATION");
    expect(loiMa(await chay(cauHinhXoaBai, "TRAINING", { lessonId: b.res.data.lessonId }, "Bài trùng nội dung"))).toBe("OK");
    const kho = await db.auditLog.findMany({ where: { module: "elearning-online", entityType: "OnlLesson" } });
    expect(JSON.stringify(kho)).not.toContain("THÂN-BÀI-BÍ-MẬT");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-ACT] đánh giá + chứng nhận qua runAction (Postgres thật)", () => {
  beforeAll(async () => {
    await don();
    const u = await db.user.create({ data: { name: `${P}admin2`, email: `ci-onla-dg-${Date.now()}@example.test`, role: "SUPER_ADMIN" }, select: { id: true } });
    nguoiThucHien = u.id;
  }, 120_000);
  afterAll(don, 120_000);

  it("[ONL-ACT-06] 🔴 soạn câu hỏi/đề: Đào tạo + Quản trị CÓ; Marketing/Kế toán/CSKH KHÔNG (ngân hàng chứa đáp án); câu sai bị từ chối; audit KHÔNG chép đáp án", async () => {
    const t = await chay(cauHinhTaoKhoa, "TRAINING", { code: `CI-ONLA-DG-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá DG`, listPrice: 1, salePrice: 1, validityMonths: 1, renewalEnabled: false });
    if (!t.res.ok) throw new Error("tao");
    const courseId = t.res.data.courseId;
    const cau = { courseId, type: "SINGLE_CHOICE" as const, stem: "1+1=?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: "a" };
    for (const code of ["HO_MARKETING", "HO_ACCOUNTANT", "CENTER_SALES_CSM", "PARENT"]) expect(loiMa(await chay(cauHinhLuuCauHoi, code, cau)), code).toBe("PERMISSION_DENIED");
    expect(await db.onlQuestion.count({ where: { courseId } })).toBe(0);
    expect(loiMa(await chay(cauHinhLuuCauHoi, "TRAINING", cau))).toBe("OK");
    expect(loiMa(await chay(cauHinhLuuCauHoi, "SUPER_ADMIN", { ...cau, stem: "2+2=?", correct: "b" }))).toBe("OK");
    expect(loiMa(await chay(cauHinhLuuCauHoi, "TRAINING", { ...cau, correct: "z" }))).toBe("CAU_HOI_KHONG_HOP_LE");
    const kho = JSON.stringify(await db.auditLog.findMany({ where: { module: "elearning-online", entityType: "OnlQuestion" } }));
    expect(kho).not.toContain('"correct"');
    expect(kho).toContain("SINGLE_CHOICE"); // đối chứng dương: audit vẫn ghi loại câu
    const ids = (await db.onlQuestion.findMany({ where: { courseId }, select: { id: true } })).map((x) => x.id);
    expect(loiMa(await chay(cauHinhLuuDeThi, "HO_MARKETING", { courseId, kind: "QUIZ", title: "T", passPercent: 70, status: "ACTIVE", cau: [{ questionId: ids[0]! }] }))).toBe("PERMISSION_DENIED");
    expect(loiMa(await chay(cauHinhLuuDeThi, "TRAINING", { courseId, kind: "QUIZ", title: "T", passPercent: 70, status: "ACTIVE", cau: [{ questionId: ids[0]! }] }))).toBe("OK");
    // lưu trữ câu hỏi: bắt buộc lý do
    expect(loiMa(await chay(cauHinhLuuTruCauHoi, "TRAINING", { courseId, questionId: ids[0]! }))).toBe("VALIDATION");
    expect(loiMa(await chay(cauHinhLuuTruCauHoi, "TRAINING", { courseId, questionId: ids[0]! }, "Câu trùng nội dung"))).toBe("OK");
  });

  it("[ONL-ACT-07] 🔴 chấm tay cần `onl:assessment:grade`; chứng nhận tay cần `onl:certificate:issue` + lý do; Marketing/Kế toán không làm được cả hai", async () => {
    const t = await chay(cauHinhTaoKhoa, "TRAINING", { code: `CI-ONLA-CN-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá CN`, listPrice: 1, salePrice: 1, validityMonths: 1, renewalEnabled: false });
    if (!t.res.ok) throw new Error("tao");
    const courseId = t.res.data.courseId;
    const hv = await db.student.create({ data: { name: `${P}hv-cn` }, select: { id: true } });
    for (const code of ["HO_MARKETING", "HO_ACCOUNTANT", "CENTER_SALES_CSM"]) {
      expect(loiMa(await chay(cauHinhChamTay, code, { attemptId: "x", diem: {} })), code).toBe("PERMISSION_DENIED");
      expect(loiMa(await chay(cauHinhCapChungNhanTay, code, { courseId, studentId: hv.id }, "Lý do đủ dài để cấp")), code).toBe("PERMISSION_DENIED");
      expect(loiMa(await chay(cauHinhThuHoiChungNhan, code, { courseId, studentId: hv.id }, "Lý do đủ dài để thu hồi")), code).toBe("PERMISSION_DENIED");
    }
    // đối chứng dương: Đào tạo qua cổng quyền (thất bại vì NGHIỆP VỤ — chưa có quyền học/chứng nhận — chứ không phải vì quyền)
    expect(loiMa(await chay(cauHinhCapChungNhanTay, "TRAINING", { courseId, studentId: hv.id }, "Lý do đủ dài để cấp"))).toBe("KHONG_CO_QUYEN");
    expect(loiMa(await chay(cauHinhCapChungNhanTay, "TRAINING", { courseId, studentId: hv.id }))).toBe("VALIDATION"); // thiếu lý do
    expect(loiMa(await chay(cauHinhChamTay, "TRAINING", { attemptId: "khong-co", diem: {} }))).toBe("LUOT_KHONG_TON_TAI");
    expect(loiMa(await chay(cauHinhThuHoiChungNhan, "TRAINING", { courseId, studentId: hv.id }, "Lý do đủ dài để thu hồi"))).toBe("CHUNG_NHAN_KHONG_TON_TAI");
  });
});
