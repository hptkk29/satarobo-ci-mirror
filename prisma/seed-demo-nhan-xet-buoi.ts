/**
 * DEMO — phiếu nhận xét buổi học (StudentSessionFeedback) cho MỘT lớp, để xem thử màn
 * "Đánh giá & Nhận xét" ở /classes/[id] và /sessions/[id].
 *
 *   pnpm tsx prisma/seed-demo-nhan-xet-buoi.ts            # ghi
 *   pnpm tsx prisma/seed-demo-nhan-xet-buoi.ts --undo     # gỡ đúng những dòng đã ghi
 *   pnpm tsx prisma/seed-demo-nhan-xet-buoi.ts --class=<classId>
 *
 * ⚠️ CHỈ DÙNG CHO DEV/TEST. KHÔNG chạy trên prod.
 *
 * Nguyên tắc an toàn:
 *   · CHỈ ghi model StudentSessionFeedback. KHÔNG đụng điểm danh, ghi danh, buổi học.
 *   · Không bao giờ đè phiếu có sẵn — cặp (buổi × HV) nào đã có dòng thì BỎ QUA.
 *   · `--undo` chỉ xoá đúng những cặp script này tạo ra, và chỉ khi phiếu còn mang
 *     dấu `DEMO_MARK` — phiếu người thật viết đè lên sau đó sẽ không bị xoá nhầm.
 *
 * Phủ đủ 4 dạng phiếu để nhìn thấy khác biệt:
 *   Buổi 1 — phiếu CŨ ĐẦY ĐỦ: tên dự án + 4 mục văn xuôi + rubric 9 tiêu chí.
 *   Buổi 2 — phiếu RUBRIC-ONLY (comment/notes = null): đúng ca từng ra thẻ TRỐNG ở admin.
 *   Buổi 3 — phiếu KIỂU CŨ NHẤT: comment văn xuôi + chấm sao, không rubric.
 *   Buổi 4 — phiếu MỚI (từ 21/08): một ô "Đánh giá chung" (`notes.overall`) + rubric.
 * Ba dạng đầu là DỮ LIỆU CŨ đang nằm trên prod — giữ để mọi đường đọc phải chứng minh
 * còn hiểu chúng sau khi 4 ô gộp thành một.
 * Cố ý chừa vài học viên KHÔNG có phiếu để thấy cột "đã nhận xét x/y" chạy đúng, và
 * thêm 1 học viên NGOÀI SĨ SỐ (mô phỏng học bù) để thấy nhóm "Ngoài sĩ số".
 */
import { db } from "../lib/db";
import { EVAL_CRITERIA } from "../lib/lms/session-eval-rubric";

const DEMO_MARK = "[demo]";
const DEFAULT_CLASS = "slms-cls-00012";

const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const UNDO = process.argv.includes("--undo");
const CLASS_ID = arg("class") ?? DEFAULT_CLASS;

/** Rubric 9 tiêu chí, mức xoay vòng theo chỉ số HV để mỗi em một bức tranh khác nhau. */
function rubricFor(i: number): Record<string, number> {
  const out: Record<string, number> = {};
  EVAL_CRITERIA.forEach((c, k) => {
    out[c.id] = ((i + k) % 5) + 1;
  });
  return out;
}

/** Rubric CHẤM THIẾU (chỉ 4/9 tiêu chí) — phải hiện đúng 4, không bịa mức 3 cho 5 cái kia. */
function rubricThieu(i: number): Record<string, number> {
  const ids = ["kt-cu", "kn-st", "sp-ht", "td-tt"];
  const out: Record<string, number> = {};
  ids.forEach((id, k) => {
    out[id] = ((i + k) % 5) + 1;
  });
  return out;
}

function notesFor(name: string, i: number) {
  const kt = [
    "Nhớ tốt bài cũ, gọi tên lại được các khối lệnh đã học.",
    "Nắm được vòng lặp nhưng còn lẫn giữa lặp vô hạn và lặp có điều kiện.",
    "Tiếp thu nhanh phần cảm biến, tự suy ra được ngưỡng đo.",
  ][i % 3];
  const kn = [
    "Lắp ráp gọn, đi dây sạch, biết kiểm tra lại trước khi chạy thử.",
    "Thao tác còn chậm ở bước cố định động cơ, cần luyện thêm.",
    "Chủ động thử nhiều phương án khi robot chạy lệch.",
  ][i % 3];
  const td = [
    "Tập trung tốt cả buổi, hỗ trợ bạn cùng nhóm.",
    "Hăng hái phát biểu, đôi lúc nói leo khi bạn đang trình bày.",
    "Trầm, làm việc độc lập tốt nhưng ngại hỏi khi bí.",
  ][i % 3];
  const dx = [
    `Đề nghị phụ huynh cho ${name} ôn lại phần vòng lặp trước buổi sau.`,
    `${name} nên tự lắp lại mô hình ở nhà một lần để nhớ thứ tự bước.`,
    `Buổi tới sẽ giao ${name} vai nhóm trưởng để rèn phần trình bày.`,
  ][i % 3];
  return { knowledge: kt, skill: kn, attitude: td, proposal: dx };
}

async function main() {
  const cls = await db.class.findUnique({
    where: { id: CLASS_ID },
    select: { id: true, name: true, classCode: true, teacherId: true },
  });
  if (!cls) throw new Error(`Không thấy lớp ${CLASS_ID}`);

  const sessions = await db.classSession.findMany({
    where: { classId: cls.id },
    orderBy: { date: "asc" },
    select: { id: true, date: true, lesson: { select: { order: true, title: true } } },
  });
  if (sessions.length < 3) throw new Error(`Lớp ${cls.classCode} có ít hơn 3 buổi, không đủ để demo.`);

  const enrollments = await db.enrollment.findMany({
    where: { classId: cls.id, deletedAt: null, student: { deletedAt: null } },
    orderBy: { student: { name: "asc" } },
    select: { student: { select: { id: true, name: true } } },
  });
  const roster = enrollments.map((e) => e.student);
  if (roster.length === 0) throw new Error(`Lớp ${cls.classCode} chưa có học viên.`);

  // GV viết phiếu: GV chính của lớp + 1 GV khác để thấy trường hợp "buổi dạy thay".
  const gvChinh = cls.teacherId;
  const gvKhac = (
    await db.user.findFirst({
      where: { role: "TEACHER", isActive: true, id: { not: gvChinh ?? undefined } },
      select: { id: true },
    })
  )?.id;
  if (!gvChinh) throw new Error(`Lớp ${cls.classCode} chưa phân GV chính.`);

  // 1 học viên NGOÀI SĨ SỐ (mô phỏng học bù từ lớp khác). Lọc bỏ bản ghi rác của DB dev
  // ("aaaa…", "ZZTEST…") — demo mà lòi ra tên rác thì người xem tưởng màn hình hỏng.
  const ungVien = await db.student.findMany({
    where: {
      deletedAt: null,
      id: { notIn: roster.map((s) => s.id) },
      name: { contains: " " }, // họ + tên, loại chuỗi một từ
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 200,
  });
  const khach =
    ungVien.find((s) => s.name.length >= 5 && !/^(.)\1{2,}/.test(s.name) && !/^zz/i.test(s.name)) ??
    null;

  // b4 CÓ THỂ undefined (lớp chỉ có đúng 3 buổi) — khối dạng-mới bên dưới tự bỏ qua.
  const [b1, b2, b3, b4] = sessions;
  type Ke = {
    sessionId: string;
    studentId: string;
    createdById: string;
    projectName?: string | null;
    notes?: unknown;
    rubric?: unknown;
    comment?: string | null;
    rating?: number | null;
  };
  const ke: Ke[] = [];

  // ── Buổi 1: phiếu ĐẦY ĐỦ. Chừa 2 em cuối để cột "đã nhận xét" KHÔNG đủ (màu cảnh báo).
  roster.slice(0, Math.max(1, roster.length - 2)).forEach((hv, i) => {
    const n = notesFor(hv.name, i);
    ke.push({
      sessionId: b1.id,
      studentId: hv.id,
      createdById: gvChinh,
      projectName: `${DEMO_MARK} Dự án ${(i % 3) + 1}: Xe dò line`,
      notes: n,
      rubric: rubricFor(i),
      // Phiếu thật lưu comment = 4 mục nối lại; giữ đúng vậy để giống dữ liệu sản xuất.
      comment: [
        `Kiến thức: ${n.knowledge}`,
        `Kỹ năng: ${n.skill}`,
        `Thái độ: ${n.attitude}`,
        `Đề xuất: ${n.proposal}`,
      ].join("\n"),
      rating: null,
    });
  });

  // ── Buổi 2: RUBRIC-ONLY cho TOÀN BỘ lớp (comment + notes = null). Một nửa chấm thiếu
  //    tiêu chí, để thấy màn hình chỉ hiện tiêu chí ĐÃ chấm chứ không bịa mức 3.
  roster.forEach((hv, i) => {
    ke.push({
      sessionId: b2.id,
      studentId: hv.id,
      createdById: i % 4 === 0 && gvKhac ? gvKhac : gvChinh,
      projectName: `${DEMO_MARK} Dự án 2: Robot tránh vật cản`,
      notes: null,
      rubric: i % 2 === 0 ? rubricFor(i + 2) : rubricThieu(i),
      comment: null,
      rating: null,
    });
  });

  // ── Buổi 3: phiếu KIỂU CŨ — comment + chấm sao, không rubric. Chỉ 4 em đầu.
  roster.slice(0, 4).forEach((hv, i) => {
    ke.push({
      sessionId: b3.id,
      studentId: hv.id,
      createdById: gvChinh,
      projectName: null,
      notes: null,
      rubric: null,
      comment: `${DEMO_MARK} ${hv.name} làm bài tốt, hoàn thành thử thách trước giờ. Cần giữ nhịp này ở buổi tới.`,
      rating: 5 - (i % 3),
    });
  });

  // ── Buổi 4: phiếu DẠNG MỚI (21/08) — chỉ ô "Đánh giá chung", 4 khoá cũ để rỗng.
  //    Đây là hình dạng mà hộp thoại nhận xét sinh ra từ nay; giữ cạnh 3 dạng cũ để
  //    nhìn được cả hai lối hiển thị trên cùng một lớp.
  if (b4) {
    roster.slice(0, 6).forEach((hv, i) => {
      const chung = `${DEMO_MARK} ${hv.name} tiếp thu tốt nội dung buổi học, nhớ và gọi lại được các khối lệnh đã học. Thao tác lắp ráp gọn gàng, biết tự kiểm tra trước khi chạy thử. Tinh thần học tập tích cực, chủ động hỗ trợ bạn cùng nhóm. Đề xuất: luyện thêm phần điều kiện rẽ nhánh ở nhà để buổi sau vào bài nhanh hơn.`;
      ke.push({
        sessionId: b4.id,
        studentId: hv.id,
        createdById: gvChinh,
        projectName: `${DEMO_MARK} Dự án 4: Robot phân loại màu`,
        notes: { overall: chung, knowledge: "", skill: "", attitude: "", proposal: "" },
        rubric: rubricFor(i + 1),
        // comment = bản sao văn xuôi (đường email/portal cũ) — khớp saveSessionEvalCore.
        comment: chung,
        rating: null,
      });
    });
  }

  // ── Học viên ngoài sĩ số (học bù) ở buổi 3.
  if (khach) {
    ke.push({
      sessionId: b3.id,
      studentId: khach.id,
      createdById: gvChinh,
      projectName: `${DEMO_MARK} Dự án 3: Buổi học bù`,
      notes: {
        knowledge: "Bắt nhịp nhanh dù học bù từ lớp khác.",
        skill: "Cần thêm thời gian làm quen bộ kit của lớp này.",
        attitude: "Hoà đồng, chủ động hỏi bài.",
        proposal: "Xếp học bù tiếp buổi kế để không hụt kiến thức.",
      },
      rubric: rubricThieu(1),
      comment: null,
      rating: null,
    });
  }

  if (UNDO) {
    let xoa = 0;
    for (const k of ke) {
      const cu = await db.studentSessionFeedback.findUnique({
        where: { classSessionId_studentId: { classSessionId: k.sessionId, studentId: k.studentId } },
        select: { id: true, projectName: true, comment: true },
      });
      // Chỉ xoá phiếu CÒN mang dấu demo — ai đó sửa/viết đè thì giữ lại.
      const laDemo =
        (cu?.projectName ?? "").includes(DEMO_MARK) || (cu?.comment ?? "").includes(DEMO_MARK);
      if (cu && laDemo) {
        await db.studentSessionFeedback.delete({ where: { id: cu.id } });
        xoa++;
      }
    }
    console.log(`ĐÃ GỠ ${xoa}/${ke.length} phiếu demo khỏi lớp ${cls.classCode}.`);
    return;
  }

  let them = 0;
  let boQua = 0;
  for (const k of ke) {
    const cu = await db.studentSessionFeedback.findUnique({
      where: { classSessionId_studentId: { classSessionId: k.sessionId, studentId: k.studentId } },
      select: { id: true },
    });
    if (cu) {
      boQua++; // KHÔNG đè phiếu đã có (có thể là dữ liệu thật).
      continue;
    }
    await db.studentSessionFeedback.create({
      data: {
        classSessionId: k.sessionId,
        studentId: k.studentId,
        createdById: k.createdById,
        projectName: k.projectName ?? null,
        notes: (k.notes ?? null) as never,
        rubric: (k.rubric ?? null) as never,
        comment: k.comment ?? null,
        rating: k.rating ?? null,
      },
    });
    them++;
  }

  const nhan = (s: (typeof sessions)[number]) =>
    `${s.date.toISOString().slice(0, 10)}${s.lesson ? ` (Bài ${s.lesson.order})` : ""}`;
  console.log(`Lớp ${cls.classCode} — ${cls.name}: thêm ${them} phiếu, bỏ qua ${boQua} (đã có sẵn).`);
  console.log(`  Buổi 1 ${nhan(b1)} — phiếu đầy đủ (dự án + 4 mục + rubric 9 tiêu chí)`);
  console.log(`  Buổi 2 ${nhan(b2)} — RUBRIC-ONLY, không văn xuôi`);
  console.log(`  Buổi 3 ${nhan(b3)} — kiểu cũ: nhận xét + chấm sao${khach ? ` + 1 HV ngoài sĩ số (${khach.name})` : ""}`);
  if (b4) console.log(`  Buổi 4 ${nhan(b4)} — DẠNG MỚI 21/08: ô "Đánh giá chung" + rubric`);
  console.log(`  Xem tại: /classes/${cls.id} → tab "Đánh giá & Nhận xét"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
