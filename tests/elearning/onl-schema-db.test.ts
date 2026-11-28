// @vitest-environment node
/**
 * [ONL-SCH-*] E-learning ONLINE — HÌNH DẠNG schema trên Postgres thật: trigger bất biến, CHECK, chỉ mục từng phần, RLS.
 *
 * Vì sao cần: `CREATE TABLE IF NOT EXISTS` chạy lại hai lần chỉ chứng minh SQL không nổ, KHÔNG chứng minh bảng còn đúng hình (một bảng
 * tạo dở ở lượt trước giữ nguyên hình sai). Bộ này đo thẳng catalog.
 *
 * ⚠️ RLS: các bảng `Onl*` BẬT RLS nhưng KHÔNG có policy nào, và ứng dụng nối bằng vai chủ bảng/superuser (bỏ qua RLS) — RLS ở đây chỉ chặn
 * đường PostgREST/anon, KHÔNG cô lập giữa người dùng của ứng dụng. Ranh giới thật là cổng truy cập `kiemTraTruyCapNoiDungDb` + kiểm
 * quyền sở hữu học viên ở lớp gọi. Test này ghim phần RLS CÓ THẬT (đã bật) và KHÔNG khẳng định thêm gì.
 */
import { describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const CAC_CHECK = [
  "OnlCourse_gia_check",
  "OnlCourse_gia_han_check",
  "OnlCourse_ky_han_check",
  "OnlCourse_ma_check",
  "OnlEntitlement_anchor_check",
  "OnlEntitlement_thu_hoi_check",
  "OnlCourseVersion_phat_hanh_check",
  "OnlLessonProgress_percent_check",
  "OnlLessonProgress_xong_check",
  "OnlLesson_nguong_check",
];

describe.skipIf(!RUN_DB_TESTS)("[ONL-SCH] hình dạng schema Online (Postgres thật)", () => {
  it("[ONL-SCH-01] MỌI bảng Onl* đều đã BẬT RLS (bảng mới quên bật là đỏ)", async () => {
    const rows = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'Onl%' order by 1`;
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("[ONL-SCH-02] trigger bất biến của sổ sự kiện tồn tại VÀ đang bật", async () => {
    const rows = await db.$queryRaw<{ tgenabled: string }[]>`
      select tgenabled from pg_trigger where tgname = 'OnlEntitlementEvent_bat_bien_trg' and not tgisinternal`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tgenabled).toBe("O"); // O = bật theo chế độ mặc định
  });

  it("[ONL-SCH-03] đủ các CHECK nghiệp vụ", async () => {
    const rows = await db.$queryRaw<{ conname: string }[]>`select conname from pg_constraint where contype = 'c' and conname like 'Onl%'`;
    const co = new Set(rows.map((r) => r.conname));
    expect(CAC_CHECK.filter((c) => !co.has(c))).toEqual([]);
  });

  it("[ONL-SCH-04] hai chỉ mục từng phần (một bản NHÁP + một bản ĐANG CHẠY) có mệnh đề WHERE đúng", async () => {
    const rows = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes where tablename = 'OnlCourseVersion' and indexname in ('OnlCourseVersion_mot_ban_nhap_key','OnlCourseVersion_mot_ban_chay_key')`;
    const by = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(by["OnlCourseVersion_mot_ban_nhap_key"]).toMatch(/UNIQUE/);
    expect(by["OnlCourseVersion_mot_ban_nhap_key"]).toMatch(/DRAFT/);
    expect(by["OnlCourseVersion_mot_ban_chay_key"]).toMatch(/UNIQUE/);
    expect(by["OnlCourseVersion_mot_ban_chay_key"]).toMatch(/PUBLISHED/);
  });

  it("[ONL-SCH-05] mỗi (học viên × khoá) đúng MỘT dòng quyền (ràng buộc duy nhất ở DB) và sự kiện có khoá idempotency duy nhất", async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      select indexname from pg_indexes where indexname in ('OnlEntitlement_studentId_courseId_key','OnlEntitlementEvent_idempotencyKey_key')`;
    expect(rows.map((r) => r.indexname).sort()).toEqual(["OnlEntitlementEvent_idempotencyKey_key", "OnlEntitlement_studentId_courseId_key"]);
  });
});
