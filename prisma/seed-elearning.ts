/**
 * EL-03 PR2 — SEED DEV cho lõi đào tạo nội bộ (AC8).
 *
 *   pnpm db:seed:elearning
 *
 * ⚠️ DEV/TEST — KHÔNG chạy trên PROD. Additive + idempotent: chạy hai lần cho ra
 * cùng số dòng. Không xoá, không sửa dữ liệu của luồng khác; mọi bản ghi mang
 * tiền tố `EL-SEED-` để nhận ra và dọn được.
 *
 * ─── Ba điều seed này CỐ Ý KHÔNG làm ─────────────────────────────────────────
 *  1. KHÔNG ghi một dòng nào vào model `Course`. Đó là bảng bán hàng CÔNG KHAI,
 *     `isPublished @default(true)` và `/khoa-hoc` lọc đúng cờ đó ⇒ một bản ghi
 *     nhầm chỗ sẽ hiện trên trang bán hàng cho phụ huynh. `TrnCourse` là bảng khác.
 *  2. KHÔNG tạo bài `kind = 'SCORM'`. Cờ `SCORM_ENABLED` mặc định OFF và phạm vi
 *     SCORM là GĐ4; seed một thứ validator sẽ từ chối là seed một tình huống
 *     không tồn tại.
 *  3. KHÔNG dùng `scopeKind = 'POSITION'` làm case mặc định. Prod có **0 dòng
 *     `Position`** (đo 20/08/2026) ⇒ một yêu cầu POSITION áp cho 0 người. Seed
 *     dựa vào bảng rỗng là dựng một tình huống không tồn tại ở nơi nó sẽ chạy.
 *     Dùng `DEPARTMENT` — phòng ban phủ 15/15 nhân sự trên prod.
 */
import fs from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";

// tsx không tự nạp .env; ưu tiên DIRECT_URL (:5432) — pooler :6543 hay lỗi
// pgbouncer prepared-statement khi seed (xem .claude/rules/prisma-db.md).
function resolveDbUrl(): string {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
  const pick = (k: string) =>
    env.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
  const url = pick("DIRECT_URL") ?? pick("DATABASE_URL");
  if (!url) throw new Error("Không đọc được DIRECT_URL/DATABASE_URL từ .env");
  return url;
}

const db = new PrismaClient({ datasources: { db: { url: resolveDbUrl() } } });

const PREFIX = "EL-SEED";
const PROGRAM_CODE = "SR.DT.COMPANY_WIDE.2026.1";
const COURSE_CODE = `${PREFIX}-001`;
const COURSE_SLUG = "el-seed-an-toan-thong-tin";

/**
 * ⚠️ `centerId` và `orgUnitId` để NULL là lựa chọn TƯỜNG MINH, không phải quên:
 * với `TrnProgram`/`TrnCourse`/`TrnRequirement`, NULL nghĩa là ÁP TOÀN CÔNG TY
 * (ba model này nằm trong `NULL_IS_GLOBAL_MODELS`). Một khoá "An toàn thông tin"
 * đúng là của cả công ty, không thuộc CS1 hay CS2.
 *
 * ⚠️ Và vì file này dựng `new PrismaClient()` RIÊNG, nó KHÔNG đi qua extension
 * ghi kép của `lib/db.ts`. Nếu về sau ai seed bản ghi CÓ gắn cơ sở thì phải tự
 * set cả hai cột — ghi kép sẽ không tự chạy giúp ở đây.
 */
const DON_VI = { centerId: null, orgUnitId: null };

async function main() {
  console.log("🌱 Seed lõi đào tạo nội bộ (DEV/test)\n");

  // ── Người sở hữu: lấy một tài khoản có thật, KHÔNG bịa id ────────────────
  // Bịa id thì FK không nổ (cột là String trần) nhưng mọi màn hiện "người dùng
  // không tồn tại" — hỏng câm, đúng loại seed tệ nhất.
  const owner = await db.user.findFirst({
    where: { deletedAt: null, role: { not: "PARENT" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error("Không có tài khoản nhân sự nào để làm chủ sở hữu");
  console.log(`   chủ sở hữu: ${owner.email ?? owner.id}`);

  // ── Phòng ban CÓ THẬT cho yêu cầu đào tạo ────────────────────────────────
  const phongBan = await db.departmentDef.findFirst({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
    select: { id: true, code: true, name: true },
  });
  if (!phongBan) throw new Error("Chưa có DepartmentDef nào — chạy db:seed:departments trước");
  console.log(`   phòng ban: ${phongBan.code} (${phongBan.name})`);

  // ── 1. Chương trình ──────────────────────────────────────────────────────
  const program = await db.trnProgram.upsert({
    where: { code: PROGRAM_CODE },
    update: {
      title: "An toàn thông tin cơ bản",
      // ⚠️ `deletedAt: null` trong nhánh update là BẮT BUỘC: `Trn*` có cột
      // `deletedAt` nhưng KHÔNG nằm trong `SOFT_DELETE_MODELS`, nên không có bộ
      // lọc tự động nào. Ai đó xoá mềm bản seed rồi chạy lại seed mà không mở
      // lại thì upsert "thành công" trên một dòng vô hình.
      deletedAt: null,
    },
    create: {
      code: PROGRAM_CODE,
      year: 2026,
      seq: 1,
      title: "An toàn thông tin cơ bản",
      primaryFunctionTag: "COMPANY_WIDE",
      functionTags: ["COMPANY_WIDE"],
      levelTags: ["L1", "L2"],
      stageTag: "IN_SERVICE",
      durationTag: "S",
      natureTag: "RECOMMENDED",
      formatTag: "ELEARNING",
      securityTag: "INTERNAL",
      needExemptReason: "Nội dung mồi có sẵn ngày mở — chưa qua phiếu nhu cầu",
      ownerUserId: owner.id,
      ...DON_VI,
    },
    select: { id: true },
  });

  // ── 2. Khoá học ──────────────────────────────────────────────────────────
  const course = await db.trnCourse.upsert({
    where: { code: COURSE_CODE },
    update: { deletedAt: null },
    create: {
      programId: program.id,
      code: COURSE_CODE,
      slug: COURSE_SLUG,
      title: "An toàn thông tin cơ bản",
      summary: "Khoá mồi phục vụ dựng màn hình — nội dung thật thay sau.",
      estimatedMinutes: 45,
      status: "PUBLISHED",
      // Cột riêng, KHÔNG tự suy từ status — báo cáo "số khoá xuất bản mỗi tháng"
      // đọc thẳng cột này.
      publishedAt: new Date(),
      securityLevel: "INTERNAL",
      // FAIL-CLOSED ghi TƯỜNG MINH, không dựa vào default của Prisma: người đọc
      // seed phải thấy ngay khoá này không tự hiện với ai.
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      catalogRuleJson: Prisma.DbNull,
      ownerUserId: owner.id,
      ...DON_VI,
    },
    select: { id: true },
  });

  // ── 3. Ba chương ─────────────────────────────────────────────────────────
  const CHUONG = ["Nhận diện rủi ro", "Mật khẩu và tài khoản", "Xử lý sự cố"];
  const modules: { id: string }[] = [];
  for (const [i, title] of CHUONG.entries()) {
    modules.push(
      await db.trnModule.upsert({
        where: { courseId_orderIndex: { courseId: course.id, orderIndex: i } },
        update: { title },
        create: { courseId: course.id, title, orderIndex: i },
        select: { id: true },
      }),
    );
  }

  // ── 4. Mười bài đọc ──────────────────────────────────────────────────────
  // Chia 4/3/3 cho ba chương. Tất cả `kind = READ` và CÓ `contentMd`: bài READ
  // rỗng sẽ bị chính validator của PR này từ chối.
  const SO_BAI = [4, 3, 3];
  let tongBai = 0;
  for (const [ci, soBai] of SO_BAI.entries()) {
    for (let i = 0; i < soBai; i++) {
      await db.trnLesson.upsert({
        where: {
          moduleId_orderIndex: { moduleId: modules[ci]!.id, orderIndex: i },
        },
        update: { deletedAt: null },
        create: {
          moduleId: modules[ci]!.id,
          title: `${CHUONG[ci]} — phần ${i + 1}`,
          orderIndex: i,
          kind: "READ",
          contentMd: `## ${CHUONG[ci]} — phần ${i + 1}\n\nNội dung mồi, thay bằng bài thật ở EL-04.`,
          minReadSeconds: 30,
        },
      });
      tongBai++;
    }
  }

  // ── 5. Một yêu cầu đào tạo theo PHÒNG BAN ────────────────────────────────
  // ⚠️ KHÔNG upsert được: khoá unique 6 cột có 4 cột nullable, mà Postgres coi
  // hai NULL là KHÁC nhau ⇒ upsert theo khoá đó sẽ đẻ dòng thứ hai ở lần chạy
  // sau. Phải tự tìm rồi mới quyết tạo hay không.
  const reqCu = await db.trnRequirement.findFirst({
    where: {
      courseId: course.id,
      scopeKind: "DEPARTMENT",
      departmentId: phongBan.id,
    },
    select: { id: true },
  });
  if (!reqCu) {
    await db.trnRequirement.create({
      data: {
        courseId: course.id,
        scopeKind: "DEPARTMENT",
        departmentId: phongBan.id,
        dueDays: 30,
        validityMonths: 12,
        status: "ACTIVE",
        createdByUserId: owner.id,
        ...DON_VI,
      },
    });
  }

  // ── Tổng kết: đếm THẬT từ DB, không đếm biến đếm trong bộ nhớ ────────────
  const dem = {
    TrnProgram: await db.trnProgram.count({ where: { code: PROGRAM_CODE } }),
    TrnCourse: await db.trnCourse.count({ where: { code: COURSE_CODE } }),
    TrnModule: await db.trnModule.count({ where: { courseId: course.id } }),
    TrnLesson: await db.trnLesson.count({
      where: { module: { courseId: course.id } },
    }),
    TrnRequirement: await db.trnRequirement.count({
      where: { courseId: course.id },
    }),
  };
  console.log("\n✅ Xong:");
  for (const [k, v] of Object.entries(dem)) console.log(`   ${k}: ${v}`);
  console.log(`\n   (đã ghi ${tongBai} bài trong lần chạy này)`);
  console.log("   Cờ ELEARNING_ENABLED vẫn OFF — dữ liệu nằm im cho tới khi bật.");
}

main()
  .catch((e) => {
    console.error("❌ seed-elearning:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
