// prisma/seed-uat/chay-hoc-bu-giaovien.ts — dựng dữ liệu HỌC BÙ để nghiệm thu bằng tài khoản uat.giaovien (13/10/2026).
//
//   UAT_SEED=1 SEED_THU_DB_TEST=1 pnpm exec tsx prisma/seed-uat/chay-hoc-bu-giaovien.ts          # DRY-RUN: chỉ in kế hoạch
//   UAT_SEED=1 SEED_THU_DB_TEST=1 pnpm exec tsx prisma/seed-uat/chay-hoc-bu-giaovien.ts --ghi    # GHI
//
// Vì sao lối riêng, không qua `index.ts`: `index.ts` LUÔN đặt lại mật khẩu 12 tài khoản uat.* và ghi đè giá khoá học
// (xem đầu `chay-noi-lead.ts`). Trên DB test đang có người nghiệm thu, đó là sửa dữ liệu dưới chân họ chỉ để thêm vài case.
// Lối này CHỈ THÊM: một khoá + một lớp + 4 bé + buổi vắng + case dạy bù, mọi tên mang tiền tố "UAT Học bù".
//
// Case được tạo bằng ĐÚNG dịch vụ thật (`taoCaseVaXep`) chứ không chèn dòng thô — nên sổ lượt, nhật ký, sự kiện
// `makeup.case.scheduled` và cổng trùng lịch chạy y như khi quản lý cơ sở bấm "Xếp case". Bộ kiểm toàn vẹn
// (`scripts/kiem-hoc-bu.ts`) vì vậy không đỏ vì dữ liệu seed.
//
// Dữ liệu dựng (cơ sở CS1, giáo viên uat.giaovien, Sale uat.sale1 phụ trách các bé):
//   Case A  NGÀY GẦN NHẤT giáo viên có ca (khung 90 phút trong ca thật, ưu tiên quanh 20:00)  bé 1 + bé 2 (cùng bài 1)  ⇒ điểm danh hai tầng được khi tới ngày
//   Case B  NGÀY KẾ TIẾP có ca (khung như trên)  bé 3 (bài 2)                ⇒ case sắp tới, chưa điểm danh được
//   Dòng cần bù CHƯA xếp case: bé 4 (bài 1), sổ lượt 0       ⇒ thử "Thêm vào case" + nhãn "Cần thu phí"
//
// Chịu được chạy lại: phần nền (khoá/lớp/bé/buổi vắng) nằm trong MỘT transaction nên lỗi thì rollback sạch; nhận ra lần
// trước bằng khoá học slug `uat-hoc-bu-giaovien`. Bước xếp case kiểm TỪNG dòng cần bù đã vào case chưa nên chạy lại chỉ
// xếp phần còn thiếu, không bao giờ xếp đôi. Không xoá gì.
import "../../scripts/_cho-phep-server-only";
import { assertSeedAllowed, db, layCoSo, layUat } from "./_common";
import { taoCaseVaXep } from "../../lib/hoc-bu/case-db";
import type { NguoiHocBu } from "../../lib/hoc-bu/pham-vi";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { vnYmd } from "../../lib/time/vn";

const GHI = process.argv.includes("--ghi");
const SLUG = "uat-hoc-bu-giaovien";
const TIEN_TO = "UAT Học bù";
const GIO_BAT_DAU = "20:00";

/** Cộng ngày vào chuỗi YYYY-MM-DD (UTC, không lệch múi giờ). */
const congNgay = (ymd: string, d: number) => {
  const t = new Date(`${ymd}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const tenBe = (i: number) => `${TIEN_TO} — Bé ${i}`;

/** Chỉ ghi vào DB local hoặc DB test đã được workflow cho phép — cùng khuôn `scripts/seed-thu-hoc-bu.ts`. */
function kiemDichGhi() {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url) && process.env.SEED_THU_DB_TEST !== "1") {
    throw new Error('DB đích không phải local. Chạy trên DB test qua workflow "Seed dữ liệu TEST" (đặt SEED_THU_DB_TEST=1 và chặn secret trùng PROD).');
  }
}

async function main() {
  assertSeedAllowed();
  kiemDichGhi();
  const coSo = await layCoSo();
  const uat = await layUat();
  const cs1 = coSo.find((c) => c.key === "CS1");
  if (!cs1) throw new Error("Không thấy cơ sở CS1 — chạy seed UAT nền trước.");
  const gv = uat.giaovien;

  const homNay = vnYmd(new Date());
  let khoa = await db.course.findUnique({ where: { slug: SLUG }, select: { id: true } });

  console.log(khoa ? `\n  Đã có nền từ trước (khoá ${SLUG}) — chỉ bổ sung phần còn thiếu.` : "\n  Kế hoạch (CS1, giáo viên uat.giaovien):");
  if (!khoa) {
    console.log("   · 1 khoá + giáo trình 3 bài + 1 lớp + 4 bé (Sale uat.sale1)");
    console.log("   · 2 buổi gốc đã diễn ra, 4 lần vắng + 4 dòng cần bù; sổ lượt: bé 1–3 được cấp 3 lượt, bé 4 = 0 lượt");
  }
  console.log(`   · Case A: ngày GẦN NHẤT (từ hôm nay) giáo viên có ca, khung 90 phút trong ca (ưu tiên quanh ${GIO_BAT_DAU}): bé 1 + bé 2 (bài 1)`);
  console.log("   · Case B: ngày KẾ TIẾP có ca của giáo viên, cùng cách chọn khung: bé 3 (bài 2)");
  console.log("   · bé 4 (bài 1): dòng cần bù CHƯA xếp case");
  if (!GHI) {
    console.log("\n  DRY-RUN — chưa ghi gì. Thêm --ghi để dựng.\n");
    return;
  }

  // ── 1. Nền: khoá / giáo trình / lớp / bé / buổi vắng / dòng cần bù — MỘT transaction, lỗi thì rollback sạch ──
  if (!khoa) {
    await db.$transaction(
      async (tx) => {
        const k = await tx.course.create({ data: { name: `${TIEN_TO} — Khoá thử`, slug: SLUG, totalSessions: 12, price: 12_000_000 } });
        const cur = await tx.curriculum.create({ data: { courseId: k.id, name: `${TIEN_TO} — Giáo trình thử` } });
        const bai1 = await tx.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1 — Làm quen robot", moduleCode: "UATHB" } });
        const bai2 = await tx.lesson.create({ data: { curriculumId: cur.id, order: 2, title: "Bài 2 — Động cơ và cảm biến", moduleCode: "UATHB" } });
        await tx.lesson.create({ data: { curriculumId: cur.id, order: 3, title: "Bài 3 — Chạy theo vạch", moduleCode: "UATHB" } });
        const lop = await tx.class.create({
          data: { name: `${TIEN_TO} — Lớp thử`, courseId: k.id, centerId: cs1.centerId, teacherId: gv.id, status: "ACTIVE", startTime: "18:00", endTime: "19:30" },
        });
        const be = [];
        for (let i = 1; i <= 4; i++) {
          const s = await tx.student.create({ data: { name: tenBe(i), centerId: cs1.centerId } });
          await tx.enrollment.create({ data: { studentId: s.id, classId: lop.id, courseId: k.id, status: "ACTIVE", saleId: uat.sale1.id } });
          // Sổ lượt khớp bút toán (checker TV-32). Bé 4 mở sổ với 0 lượt để ra nhãn "Cần thu phí".
          const tk = await tx.makeupCreditAccount.create({ data: { studentId: s.id, courseId: k.id, granted: i <= 3 ? 3 : 0 } });
          if (i <= 3) await tx.makeupCreditEntry.create({ data: { accountId: tk.id, type: "GRANT", grantedDelta: 3, reason: `Mở sổ ${TIEN_TO}`, idemKey: "GRANT:khoi-tao" } });
          be.push(s);
        }
        const buoi1 = await tx.classSession.create({
          data: { classId: lop.id, centerId: cs1.centerId, date: new Date(`${congNgay(homNay, -7)}T11:00:00.000Z`), lessonId: bai1.id, status: "COMPLETED" },
        });
        const buoi2 = await tx.classSession.create({
          data: { classId: lop.id, centerId: cs1.centerId, date: new Date(`${congNgay(homNay, -6)}T11:00:00.000Z`), lessonId: bai2.id, status: "COMPLETED" },
        });
        const vang = [
          [0, buoi1, bai1, "ABSENT_EXCUSED", "Con ốm"],
          [1, buoi1, bai1, "ABSENT_EXCUSED", "Gia đình về quê"],
          [2, buoi2, bai2, "ABSENT_UNEXCUSED", null],
          [3, buoi1, bai1, "ABSENT_EXCUSED", "Trùng lịch học khác"],
        ] as const;
        for (const [i, buoi, bai, tt, lyDo] of vang) {
          const dd = await tx.attendance.create({
            data: { sessionId: buoi.id, studentId: be[i]!.id, status: tt, makeupStatus: "NEEDS_MAKEUP", absenceReason: lyDo, centerId: cs1.centerId },
          });
          await tx.makeupNeed.create({
            data: {
              studentId: be[i]!.id, classId: lop.id, centerId: cs1.centerId, courseId: k.id, sourceType: "ABSENCE",
              originalAttendanceId: dd.id, missedSessionId: buoi.id, missedLessonId: bai.id, status: "PENDING",
            },
          });
        }
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
    khoa = await db.course.findUnique({ where: { slug: SLUG }, select: { id: true } });
  }
  if (!khoa) throw new Error("Dựng nền xong mà không đọc lại được khoá — dừng.");

  // ── 2. Case thật qua dịch vụ. Người gọi là uat.admin (quản trị tối cao), đúng khuôn fixture DB của Học bù. ──
  // KHÔNG ghi ca làm của giáo viên: lưới `lib/cham-cong/ghi-o-wiring.test.ts` [GOW-01] chỉ cho `ghi-o.ts` ghi `ShiftAssignment`, và giáo viên UAT đã có ca
  // từ seed lịch. Seed chỉ ĐỌC ca có sẵn rồi xếp case vào khung giờ nằm trong ca đó.
  const nguoi = {
    userId: uat.admin.id, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), chiCuaSale: null,
  } as unknown as NguoiHocBu;
  const phong = await db.room.findFirst({ where: { centerId: cs1.centerId, status: "ACTIVE" }, select: { id: true }, orderBy: { code: "asc" } });

  /** Dòng cần bù của bé thứ i (1..4) trong khoá thử, kèm: đã nằm trong case nào chưa. */
  const dongCua = async (i: number) => {
    const n = await db.makeupNeed.findFirst({
      where: { courseId: khoa!.id, student: { name: tenBe(i) } },
      select: { id: true, status: true },
    });
    if (!n) throw new Error(`Không thấy dòng cần bù của ${tenBe(i)} — nền dựng dở, xem DB.`);
    const trongCase = await db.makeupCaseStudent.count({ where: { makeupNeedId: n.id } });
    return { id: n.id, daVaoCase: trongCase > 0 || n.status !== "PENDING" };
  };

  /**
   * Khung giờ ứng viên của một ngày: các khoảng 90 phút (bước 30 phút) nằm TRỌN trong một đoạn WORK của ca làm THẬT của giáo viên, ưu tiên gần ${GIO_BAT_DAU}
   * nhất (buổi tối ít đụng lớp chính). Ngày giáo viên không có ca ⇒ không có khung nào.
   */
  const khungUngVien = async (ymd: string): Promise<Array<[string, string]>> => {
    const hang = await db.shiftAssignment.findMany({
      where: { userId: gv.id, workDate: new Date(`${ymd}T00:00:00.000Z`), status: "ACTIVE" },
      select: { segments: true },
    });
    const phut = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const hhmm = (p: number) => `${String(Math.floor(p / 60)).padStart(2, "0")}:${String(p % 60).padStart(2, "0")}`;
    const ra: Array<[string, string]> = [];
    for (const h of hang) {
      const doan = Array.isArray(h.segments) ? (h.segments as Array<{ start?: unknown; end?: unknown; kind?: unknown }>) : [];
      for (const d of doan) {
        if (d.kind !== "WORK" || typeof d.start !== "string" || typeof d.end !== "string") continue;
        for (let b = phut(d.start); b + 90 <= phut(d.end); b += 30) ra.push([hhmm(b), hhmm(b + 90)]);
      }
    }
    const gan = (k: [string, string]) => Math.abs(phut(k[0]) - phut(GIO_BAT_DAU));
    ra.sort((x, y) => gan(x) - gan(y));
    return ra.filter((k, i) => ra.findIndex((o) => o[0] === k[0]) === i).slice(0, 14);
  };

  /**
   * Từ ngày `tuNgay` tới +13 ngày: ngày nào giáo viên có ca thì thử từng khung, dừng ở khung đầu tiên xếp được. Lỗi cổng (ca không phủ, trùng lịch…) xảy ra
   * TRƯỚC phép ghi đầu tiên / rollback cả transaction của `taoCaseVaXep`, nên thử khung hoặc ngày khác là an toàn.
   */
  const xepTrongCaLam = async (needIds: string[], tuNgay: string, nhan: string) => {
    let loiCuoi = "";
    let thuDuoc = 0;
    for (let d = 0; d < 14; d++) {
      const ymd = congNgay(tuNgay, d);
      for (const [bd, kt] of await khungUngVien(ymd)) {
        thuDuoc++;
        try {
          const id = await taoCaseVaXep(nguoi, { ymd, startTime: bd, endTime: kt, roomId: phong?.id ?? null, teacherId: gv.id, note: `${TIEN_TO} — ${nhan}`, needIds, coQuyenDuyet: true });
          return { ok: true as const, id, ymd, bd, kt };
        } catch (e) {
          loiCuoi = e instanceof Error ? e.message : String(e);
        }
      }
    }
    return { ok: false as const, thuDuoc, loiCuoi };
  };

  const dsCase: Array<{ nhan: string; be: number[] }> = [
    { nhan: "Case A — gần nhất", be: [1, 2] },
    { nhan: "Case B — sắp tới", be: [3] },
  ];
  let loi = 0;
  let tuNgay = homNay;
  for (const c of dsCase) {
    const dong = await Promise.all(c.be.map(dongCua));
    if (dong.every((d) => d.daVaoCase)) {
      console.log(`  = ${c.nhan}: đã xếp từ trước — bỏ qua.`);
      continue;
    }
    if (dong.some((d) => d.daVaoCase)) {
      console.log(`  ! ${c.nhan}: một phần dòng đã vào case khác — bỏ qua, không xếp đôi.`);
      continue;
    }
    const kq = await xepTrongCaLam(dong.map((d) => d.id), tuNgay, c.nhan);
    if (kq.ok) {
      console.log(`  ✓ ${c.nhan}: case ${kq.id}  (${kq.ymd} ${kq.bd}–${kq.kt})`);
      tuNgay = congNgay(kq.ymd, 1);
    } else {
      loi++;
      console.error(
        `  ✗ ${c.nhan}: thử ${kq.thuDuoc} khung giờ trong 14 ngày tới đều không xếp được` +
          (kq.thuDuoc === 0 ? " — uat.giaovien không có ca làm nào trong 14 ngày tới (xếp ca cho giáo viên rồi chạy lại)" : ` — lỗi cuối: ${kq.loiCuoi}`),
      );
    }
  }
  const be4 = await dongCua(4);
  console.log(`
  Xong. Dòng cần bù chưa xếp case: ${tenBe(4)} (${be4.id}).${loi ? `  CÓ ${loi} case không xếp được — xem lỗi ở trên, chạy lại sau khi sửa.` : ""}
`);
  if (loi) process.exitCode = 1;
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("\n  ✗ SEED DỪNG:", e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
