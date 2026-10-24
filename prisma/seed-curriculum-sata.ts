// prisma/seed-curriculum-sata.ts — nạp GIÁO TRÌNH SATA THẬT (tên dự án từng buổi)
// vào Curriculum + Lesson.
//
// Vì sao cần: tên dự án thật ("Bàn Tay Ma Thuật", "Đấu Trường Con Quay", …) lâu nay
// chỉ nằm hardcode ở data marketing của site public. Bảng `Lesson` thì hoặc trống,
// hoặc chứa chỗ trống tự sinh `"Buổi N"` (lib/lms/curriculum.ts), nên phiếu nhận xét
// gửi phụ huynh in tên sai cho MỌI giáo trình.
//
// Chạy (idempotent — upsert theo (courseId,version) và (curriculumId,order)):
//   pnpm exec dotenv -e .env -- tsx prisma/seed-curriculum-sata.ts
//
// Cờ:
//   --force   ghi đè cả giáo trình đã có tên bài do NGƯỜI soạn (mặc định bỏ qua khoá đó)
//   --relink  nối lại các LỚP ĐANG CÓ vào giáo trình mới
//   --dry-run xem trước phần --relink (không đụng Class/ClassSessionPlan/ClassSession).
//             ⚠️ Curriculum + Lesson VẪN ĐƯỢC GHI: bản xem trước phải tra `Lesson.id` thật
//             để biết buổi nào sẽ nối vào bài nào, không có bài trong DB thì không xem
//             trước được gì. Con số in ra ở chế độ này là con số Y HỆT lần chạy thật.
//
// Nối lại các LỚP ĐANG CÓ vào giáo trình mới (ghi đè ClassSessionPlan.customTitle +
// ClassSession.lessonId của lớp thuộc 9 khoá Sata) — CHẠY TAY, có xem trước:
//   pnpm exec dotenv -e .env -- tsx prisma/seed-curriculum-sata.ts --relink --dry-run
//   pnpm exec dotenv -e .env -- tsx prisma/seed-curriculum-sata.ts --relink
//
// ⚠️ `--relink` GHI ĐÈ tiêu đề buổi mà giáo vụ đã sửa tay ở /admin/classes/[id]
// (tab Chương trình). Mặc định TẮT vì lý do đó; chỉ bật khi muốn dựng lại mockup.
import { db } from "../lib/db";
import { buildSataCurricula } from "../lib/lms/curriculum-sata";
import { isPlaceholderTitle } from "../lib/lms/curriculum-merge";

const RELINK = process.argv.includes("--relink");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

/**
 * Ghi vào version 1 — CHÍNH LÀ version mà `/admin/curriculums` dùng, cố ý: lớp mới tạo
 * ghim `Class.curriculumVersion` theo giáo trình đang ACTIVE của khoá, nên nạp vào một
 * version riêng thì chẳng lớp nào thấy. Đổi lại, phải có chốt chặn ghi đè bên dưới.
 */
const VERSION = 1;

async function seedCurricula(): Promise<Map<string, { id: string; lessons: Map<number, string> }>> {
  const blueprints = buildSataCurricula();
  const out = new Map<string, { id: string; lessons: Map<number, string> }>();

  for (const bp of blueprints) {
    const course = await db.course.findUnique({
      where: { slug: bp.courseSlug },
      select: { id: true, name: true },
    });
    if (!course) {
      console.log(`  ⚠️  bỏ qua ${bp.productCode} — chưa có Course slug="${bp.courseSlug}"`);
      console.log(`      (chạy prisma/seed-courses.ts trước)`);
      continue;
    }

    // ── Chặn ghi đè giáo trình NGƯỜI THẬT đã soạn ────────────────────────────
    //
    // Seed này ghi vào `version = 1`, mà `/admin/curriculums` cũng tạo giáo trình ở
    // version 1. Nếu Đào tạo đã ngồi gõ tên 48 bài cho Sata3 rồi, chạy seed sẽ xoá
    // sạch công đó mà không ai biết — đúng kiểu mất mát im lặng, và không có đường lùi
    // vì `Lesson.title` không có bản sao nào khác.
    //
    // Nên: chỉ ghi đè khi giáo trình hiện có TOÀN Ô TRỐNG do nút "Áp dụng số buổi" sinh
    // ra (`isPlaceholderTitle` — tiêu đề đúng dạng "Buổi N"). Có bài mang tên thật →
    // BỎ QUA khoá đó và nói rõ, người vận hành tự quyết bằng `--force`.
    const existing = await db.curriculum.findUnique({
      where: { courseId_version: { courseId: course.id, version: VERSION } },
      select: { id: true, lessons: { select: { order: true, title: true } } },
    });
    if (existing && !FORCE) {
      const handWritten = existing.lessons.filter(
        (l) => !isPlaceholderTitle(l.title, l.order),
      );
      if (handWritten.length > 0) {
        console.log(
          `  ⏭  BỎ QUA ${bp.productCode} — giáo trình v${VERSION} đã có ` +
            `${handWritten.length}/${existing.lessons.length} bài mang tên do người soạn ` +
            `(vd "${handWritten[0]!.title}").`,
        );
        console.log(`      Muốn ghi đè thật thì chạy lại kèm --force.`);
        continue;
      }
    }

    const curriculum = await db.curriculum.upsert({
      where: { courseId_version: { courseId: course.id, version: VERSION } },
      update: { name: bp.name, description: bp.description, isActive: true, status: "ACTIVE" },
      create: {
        courseId: course.id,
        version: VERSION,
        name: bp.name,
        description: bp.description,
        isActive: true,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    const lessonIds = new Map<number, string>();
    for (const l of bp.lessons) {
      const row = await db.lesson.upsert({
        where: { curriculumId_order: { curriculumId: curriculum.id, order: l.order } },
        update: {
          title: l.title,
          moduleCode: l.moduleCode,
          moduleName: l.moduleName,
          description: l.description,
          objectives: l.objectives,
          // KHÔNG đụng `archivedAt`: bài bị lưu trữ là do người ta cố ý gỡ khỏi giáo
          // trình; seed hồi sinh nó là tự ý đảo quyết định của Đào tạo.
        },
        create: {
          curriculumId: curriculum.id,
          order: l.order,
          title: l.title,
          moduleCode: l.moduleCode,
          moduleName: l.moduleName,
          description: l.description,
          objectives: l.objectives,
          status: "COMPLETE",
        },
        select: { id: true },
      });
      lessonIds.set(l.order, row.id);
    }

    // Bài thừa của lần seed trước (giáo trình rút ngắn) → lưu trữ mềm, không xoá
    // để không cắt đứt ClassSession đang trỏ tới.
    const extra = await db.lesson.updateMany({
      where: { curriculumId: curriculum.id, order: { gt: bp.lessons.length }, archivedAt: null },
      data: { archivedAt: new Date() },
    });

    out.set(bp.courseSlug, { id: curriculum.id, lessons: lessonIds });
    const hp = new Set(bp.lessons.map((l) => l.moduleCode).filter(Boolean)).size;
    console.log(
      `  ✓ ${bp.productCode} (${bp.courseSlug}) — ${bp.lessons.length} buổi` +
        (hp ? ` · ${hp} học phần` : " · không chia học phần") +
        (extra.count ? ` · lưu trữ ${extra.count} bài thừa` : ""),
    );
  }
  return out;
}

type RelinkStats = {
  classes: number;
  plans: number;
  sessions: number;
  beyondPlans: number;
  beyondSessions: number;
  orphanSessions: number;
  wipedTitles: number;
  /** Lớp mà thứ tự bài ở đuôi lịch chỉ là phỏng đoán (xem `hasGuess` bên dưới). */
  guessedClasses: string[];
};

/**
 * Tra `Lesson.id → order`, nhớ xuyên lớp: các lớp cùng khoá trỏ chung một bộ bài cũ nên
 * hỏi lại từng lớp là thừa. `null` = id không còn trong DB (bài đã bị xoá) — nhớ luôn để
 * khỏi bắn lại một truy vấn rỗng cho mỗi lớp.
 */
const lessonOrderCache = new Map<string, number | null>();

async function lessonOrderOf(ids: string[]): Promise<Map<string, number | null>> {
  const missing = [...new Set(ids)].filter((id) => !lessonOrderCache.has(id));
  if (missing.length > 0) {
    const rows = await db.lesson.findMany({
      where: { id: { in: missing } },
      select: { id: true, order: true },
    });
    for (const id of missing) lessonOrderCache.set(id, null);
    for (const r of rows) lessonOrderCache.set(r.id, r.order);
  }
  return lessonOrderCache;
}

/**
 * Nối LỚP ĐANG CÓ vào giáo trình mới.
 *
 * Phải làm cả 3 việc, vì `deriveSessionTitle` đọc theo thứ tự
 * `plan.customTitle` → `lesson.title` → `topic`:
 *   1. `Class.curriculumId/curriculumVersion` — ghim giáo trình cho lớp;
 *   2. `ClassSessionPlan.customTitle` + `.lessonId` — bản sao per-lớp (thắng mọi thứ);
 *   3. `ClassSession.lessonId` — nguồn `moduleCode` cho nhãn buổi.
 *
 * Kế hoạch buổi ghép theo THỨ TỰ (`order`/`seq`) ↔ `Lesson.order`. Buổi học thì KHÔNG
 * ghép theo vị trí trong lịch nữa — xem `relinkOneClass`, vị trí trong lịch chỉ là
 * phương án chót. Buổi vượt quá số bài của giáo trình để nguyên (và được đếm).
 *
 * Mọi bộ đếm chỉ tính bản ghi THẬT SỰ ĐỔI: chạy lần 2 phải in 0, và `--dry-run` phải in
 * đúng con số của lần chạy thật (đó là con số người vận hành dùng để đo sức công phá).
 */
async function relinkClasses(
  curricula: Map<string, { id: string; lessons: Map<number, string> }>,
): Promise<void> {
  const st: RelinkStats = {
    classes: 0,
    plans: 0,
    sessions: 0,
    beyondPlans: 0,
    beyondSessions: 0,
    orphanSessions: 0,
    wipedTitles: 0,
    guessedClasses: [],
  };

  for (const [slug, cur] of curricula) {
    const course = await db.course.findUnique({ where: { slug }, select: { id: true } });
    if (!course) continue;

    const classes = await db.class.findMany({
      where: { courseId: course.id, deletedAt: null },
      select: { id: true, name: true, curriculumId: true, curriculumVersion: true },
    });

    for (const cls of classes) await relinkOneClass(cls, cur, st);
  }

  console.log(
    `\n  ${DRY_RUN ? "[DRY-RUN] sẽ nối" : "Đã nối"}: ${st.classes} lớp · ` +
      `${st.plans} kế hoạch buổi · ${st.sessions} buổi học`,
  );
  if (st.beyondSessions || st.beyondPlans) {
    console.log(
      `  · giữ nguyên ${st.beyondSessions} buổi + ${st.beyondPlans} kế hoạch VƯỢT ` +
        `số bài của giáo trình mới (lịch lớp dài hơn giáo trình).`,
    );
  }
  if (st.orphanSessions) {
    console.log(
      `  · ${st.orphanSessions} buổi KHÔNG thuộc kế hoạch nào (planId trống) — đã ghép ` +
        `theo bài đang mang / theo ngày, KHÔNG bỏ qua im lặng.`,
    );
  }
  if (st.wipedTitles) {
    console.log(
      `  · ⚠️  XOÁ ${st.wipedTitles} tiêu đề buổi do giáo vụ gõ tay (customTitle) — ` +
        `không có bản sao nào khác, không lùi được.`,
    );
  }
  if (st.guessedClasses.length > 0) {
    const shown = st.guessedClasses.slice(0, 6).join(", ");
    console.log(
      `  · ⚠️  ${st.guessedClasses.length} lớp vừa có buổi HUỶ vừa có buổi chưa neo bài ⇒ ` +
        `đuôi lịch chỉ là PHỎNG ĐOÁN: ${shown}${st.guessedClasses.length > 6 ? ", …" : ""}`,
    );
    console.log(
      `      (buổi bù không mang lessonId thì không cách nào biết nó dạy lại bài nào — ` +
        `soát tay ở /admin/classes/[id] tab Chương trình)`,
    );
  }
  if (st.classes + st.plans + st.sessions === 0) {
    console.log("  (không có gì để đổi — lớp đã bám đúng giáo trình này rồi)");
  }
  if (DRY_RUN) console.log("  (chưa ghi gì — bỏ --dry-run để chạy thật)");
}

/**
 * Nối MỘT lớp. Thứ tự ưu tiên khi quyết định "buổi này dạy bài nào" — cố ý xếp vị trí
 * trong lịch xuống CUỐI:
 *
 *   (1) `planId` → bài của kế hoạch đó. Kế hoạch buổi là bản chụp per-lớp của "buổi thứ
 *       mấy dạy bài nào", và buổi bù do `lib/classes/adjust.ts` sinh ra CHÉP nguyên
 *       `planId` của buổi gốc ⇒ đường này tự khớp buổi bù.
 *   (2) `lessonId` đang mang → dịch sang bài CÙNG `order` của giáo trình mới. Buổi bù
 *       cũng chép `lessonId` của buổi gốc, nên nó tự biết nó dạy lại bài nào — ghép theo
 *       vị trí sẽ dán bài số 41 vào buổi bù của bài số 5 và phụ huynh đọc phiếu nhận xét
 *       thấy tên dự án của một buổi họ chưa từng học. KHÔNG đè lên nó; nhưng vẫn phải
 *       DỊCH sang bài của giáo trình mới, bỏ trắng là lớp nằm nửa giáo trình cũ nửa mới.
 *   (3) Vị trí trong lịch (ngày tăng dần). Chỉ dùng cho buổi chưa neo được bài nào —
 *       `lib/classes/generate.ts` có nhánh sinh buổi KHÔNG kèm lessonId, và
 *       `adoptCurriculumVersion` xoá trắng planId/lessonId của buổi dư khi đổi version.
 *
 * Bộ đếm vị trí cho (3): buổi HUỶ VẪN GIỮ CHỖ. Huỷ buổi không xoá nó khỏi lịch (giữ
 * nguyên ngày, chỉ đổi status) và bài của nó được dạy lại ở buổi bù cuối lịch, nên buổi
 * kế tiếp vẫn là bài kế tiếp — bỏ chỗ của buổi huỷ là kéo TOÀN BỘ phần sau lùi 1 bài.
 * Gặp buổi đã neo bài thì bộ đếm nhảy theo bài đó (`slot = max(slot, anchor)`) để lớp
 * nửa neo nửa không vẫn thẳng hàng, và để buổi bù ở cuối không kéo bộ đếm thụt lùi.
 */
async function relinkOneClass(
  cls: { id: string; name: string; curriculumId: string | null; curriculumVersion: number | null },
  cur: { id: string; lessons: Map<number, string> },
  st: RelinkStats,
): Promise<void> {
  if (cls.curriculumId !== cur.id || cls.curriculumVersion !== VERSION) {
    if (!DRY_RUN) {
      await db.class.update({
        where: { id: cls.id },
        data: { curriculumId: cur.id, curriculumVersion: VERSION },
      });
    }
    st.classes += 1;
  }

  const plans = await db.classSessionPlan.findMany({
    where: { classId: cls.id },
    orderBy: [{ order: "asc" }, { seq: "asc" }],
    select: { id: true, lessonId: true, customTitle: true },
  });

  const planTarget = new Map<string, string>();
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]!;
    const lessonId = cur.lessons.get(i + 1);
    if (!lessonId) {
      st.beyondPlans += 1;
      continue;
    }
    // Ghi bảng tra TRƯỚC nhánh "đã đúng rồi": buổi trỏ vào kế hoạch này vẫn phải bám nó,
    // kể cả khi bản thân kế hoạch không cần ghi lại.
    planTarget.set(p.id, lessonId);
    if (p.lessonId === lessonId && p.customTitle === null) continue;
    if (p.customTitle !== null) st.wipedTitles += 1;
    if (!DRY_RUN) {
      await db.classSessionPlan.update({
        where: { id: p.id },
        data: { lessonId, customTitle: null },
      });
    }
    st.plans += 1;
  }

  const sessions = await db.classSession.findMany({
    where: { classId: cls.id },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { id: true, lessonId: true, planId: true, status: true },
  });
  const orders = await lessonOrderOf(
    sessions.map((s) => s.lessonId).filter((id): id is string => id !== null),
  );

  let slot = 0;
  let hasCancelled = false;
  let hasGuess = false;
  const byLesson = new Map<string, string[]>();

  for (const s of sessions) {
    if (s.status === "CANCELLED") hasCancelled = true;
    if (plans.length > 0 && s.planId === null) st.orphanSessions += 1;

    const viaPlan = s.planId !== null ? planTarget.get(s.planId) : undefined;
    const anchor = s.lessonId !== null ? (orders.get(s.lessonId) ?? undefined) : undefined;

    if (typeof anchor === "number") {
      if (anchor > slot) slot = anchor;
    } else {
      slot += 1;
      // Không neo được bài NÀO cho buổi này: chỉ còn vị trí trong lịch để đoán.
      if (viaPlan === undefined) hasGuess = true;
    }

    const target =
      viaPlan ?? (typeof anchor === "number" ? cur.lessons.get(anchor) : cur.lessons.get(slot));
    if (target === undefined) {
      st.beyondSessions += 1;
      continue;
    }
    if (s.lessonId === target) continue;

    const bucket = byLesson.get(target);
    if (bucket) bucket.push(s.id);
    else byLesson.set(target, [s.id]);
  }

  // Buổi huỷ + buổi chưa neo bài đứng chung một lớp = buổi bù nằm cuối lịch mà không mang
  // dấu vết bài gốc ⇒ (3) đếm nó thành một bài MỚI và đẩy lệch. Không im lặng: báo tên lớp.
  if (hasCancelled && hasGuess) st.guessedClasses.push(cls.name);

  for (const [lessonId, ids] of byLesson) {
    if (!DRY_RUN) {
      await db.classSession.updateMany({ where: { id: { in: ids } }, data: { lessonId } });
    }
    // Đếm NGOÀI nhánh ghi. Bản cũ cộng `updateMany().count` nên `--dry-run` in 0 buổi rồi
    // lần chạy thật đụng hàng nghìn — số xem trước phải là số thật. `ids` chính là tập sẽ
    // ghi nên hai chế độ khớp nhau theo cấu tạo, không cần đếm lại bằng truy vấn thứ hai.
    st.sessions += ids.length;
  }
}

async function main() {
  console.log(`\n🌱 Giáo trình Sata — nạp tên dự án thật vào Curriculum + Lesson\n`);
  if (FORCE) {
    console.log(`   ⚠️  --force: GHI ĐÈ cả giáo trình đã có tên bài do người soạn.\n`);
  }
  if (DRY_RUN) {
    // Nói thẳng kẻo người vận hành đọc "--dry-run" thành "không ghi gì cả": bước nạp
    // Curriculum + Lesson VẪN chạy thật (bản xem trước cần Lesson.id có thật để tra).
    console.log(`   ⚠️  --dry-run CHỈ che phần --relink. Curriculum + Lesson vẫn được ghi.\n`);
  }
  const curricula = await seedCurricula();

  if (RELINK) {
    console.log(`\n🔗 Nối lớp đang có vào giáo trình mới${DRY_RUN ? " (DRY-RUN)" : ""}…`);
    console.log(`   ⚠️  Ghi đè tiêu đề buổi giáo vụ đã sửa tay ở tab Chương trình.`);
    await relinkClasses(curricula);
  } else {
    console.log(`\n(Lớp ĐANG CÓ giữ nguyên giáo trình cũ — thêm --relink để nối lại.)`);
  }

  console.log(`\nXong ${curricula.size} giáo trình.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
