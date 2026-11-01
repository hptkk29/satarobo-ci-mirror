// prisma/seed-uat/chay-nghiem-thu-gop.ts — NGHIỆM THU phía máy chủ của hai thay đổi Học bù ngày 13/10/2026, trên DB TEST với dữ liệu UAT thật.
//
//   UAT_SEED=1 SEED_THU_DB_TEST=1 pnpm exec tsx prisma/seed-uat/chay-nghiem-thu-gop.ts          # DRY-RUN: chỉ in kế hoạch
//   UAT_SEED=1 SEED_THU_DB_TEST=1 pnpm exec tsx prisma/seed-uat/chay-nghiem-thu-gop.ts --ghi    # dựng dữ liệu + chạy các ca
//
// Hai thay đổi:
//   (1) HB-GOP    — TẠO case nhiều bài: dòng cần bù của chính bé ở các bài thuộc bộ bài tự gộp vào case; "Thêm vào case có sẵn" KHÔNG tự gộp.
//   (2) HB-PHIEU-SOM — phiếu nhận xét lưu được TRƯỚC điểm danh; phụ huynh không thấy phiếu nháp.
//
// Dùng ĐÚNG các hàm dịch vụ thật (`taoCaseVaXep`, `xepVaoCaseCoSan`, `ghiDanhGiaMuc`, `getStudentMakeup`) — không chèn thẳng bảng case — nên đây là hành vi của đường người dùng bấm.
// Không có đường điểm danh ở đây: điểm danh làm trôi trạng thái case theo giờ và để lại dữ liệu lệch (TV-12/13); phần điểm danh được nghiệm thu bằng trình duyệt thật
// ở `tests/e2e/teacher/hoc-bu-nhan-xet-som.spec.ts` và bằng DB test [PSOM-02]. Mọi case ở đây nằm TƯƠNG LAI và nhất quán, nên checker T01 không đỏ vì chúng.
//
// CHỈ THÊM, không xoá, không ghi ca làm (lưới [GOW-01]: chỉ `ghi-o.ts` ghi ShiftAssignment) — seed ĐỌC ca có sẵn của uat.giaovien. Chạy lại: đã có khoá `uat-hoc-bu-nt-gop` thì
// không dựng lại, chỉ in lại hiện trạng. Thoát mã 1 nếu có ca FAIL.
import "../../scripts/_cho-phep-server-only";
import { assertSeedAllowed, db, layCoSo, layUat } from "./_common";
import { taoCaseVaXep, xepVaoCaseCoSan, ghiDanhGiaMuc } from "../../lib/hoc-bu/case-db";
import type { NguoiHocBu } from "../../lib/hoc-bu/pham-vi";
import { getStudentMakeup } from "../../lib/portal/makeup";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { vnYmd } from "../../lib/time/vn";

const GHI = process.argv.includes("--ghi");
const SLUG = "uat-hoc-bu-nt-gop";
const TIEN_TO = "UAT Học bù NT";
const GIO_UU_TIEN = "20:00";
const PHIEU_NHAP = "Phiếu nháp nghiệm thu — không được lộ cho phụ huynh";

const congNgay = (ymd: string, d: number) => {
  const t = new Date(`${ymd}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const tenBe = (k: "P" | "Q" | "R") => `${TIEN_TO} — Bé ${k}`;

const ketQua: Array<{ ma: string; dat: boolean; ghiChu: string }> = [];
function kiem(ma: string, dat: boolean, ghiChu = "") {
  ketQua.push({ ma, dat, ghiChu });
  console.log(`  ${dat ? "PASS" : "FAIL"}  ${ma}${ghiChu ? ` — ${ghiChu}` : ""}`);
}
async function thu(ma: string, viec: () => Promise<void>) {
  try {
    await viec();
  } catch (e) {
    kiem(ma, false, `NÉM LỖI: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function kiemDichGhi() {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url) && process.env.SEED_THU_DB_TEST !== "1") {
    throw new Error('DB đích không phải local. Chạy trên DB test qua workflow "Seed dữ liệu TEST" (đặt SEED_THU_DB_TEST=1 và chặn secret trùng PROD).');
  }
}

async function main() {
  assertSeedAllowed();
  kiemDichGhi();
  const cs1 = (await layCoSo()).find((c) => c.key === "CS1");
  if (!cs1) throw new Error("Không thấy cơ sở CS1 — chạy seed UAT nền trước.");
  const uat = await layUat();
  const gv = uat.giaovien;
  const homNay = vnYmd(new Date());

  if (await db.course.findUnique({ where: { slug: SLUG }, select: { id: true } })) {
    console.log(`\n  Đã nghiệm thu từ trước (khoá ${SLUG}). KHÔNG dựng lại.\n`);
    return;
  }
  console.log("\n  Kế hoạch nghiệm thu (CS1, giáo viên uat.giaovien, dữ liệu mang tiền tố " + `"${TIEN_TO}"):`);
  console.log("   · 1 khoá, 3 bài, 1 lớp, 3 bé P/Q/R — mỗi bé vắng bài 1 và bài 2 (hai dòng cần bù); sổ lượt P=3, Q=1, R=3");
  console.log("   · GOP-01 tạo case cho P chọn dòng bài 1 + bộ bài 1-2 ⇒ dòng bài 2 của P tự gộp");
  console.log("   · GOP-02 Q còn 1 lượt: dòng bài 2 KHÔNG gộp, case vẫn tạo");
  console.log("   · GOP-03 'Thêm vào case có sẵn' R bằng dòng bài 1 ⇒ KHÔNG tự kéo dòng bài 2");
  console.log("   · PSOM  lưu phiếu khi mục còn chờ; phụ huynh không thấy phiếu nháp");
  if (!GHI) {
    console.log("\n  DRY-RUN — chưa ghi gì. Thêm --ghi để dựng và chạy.\n");
    return;
  }

  // ── Nền: một transaction ──
  const ids = await db.$transaction(
    async (tx) => {
      const k = await tx.course.create({ data: { name: `${TIEN_TO} — Khoá nghiệm thu`, slug: SLUG, totalSessions: 12, price: 12_000_000 } });
      const cur = await tx.curriculum.create({ data: { courseId: k.id, name: `${TIEN_TO} — Giáo trình` } });
      const bai1 = await tx.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1 — Làm quen robot", moduleCode: "UATNT" } });
      const bai2 = await tx.lesson.create({ data: { curriculumId: cur.id, order: 2, title: "Bài 2 — Động cơ và cảm biến", moduleCode: "UATNT" } });
      await tx.lesson.create({ data: { curriculumId: cur.id, order: 3, title: "Bài 3 — Chạy theo vạch", moduleCode: "UATNT" } });
      const lop = await tx.class.create({
        data: { name: `${TIEN_TO} — Lớp`, courseId: k.id, centerId: cs1.centerId, teacherId: gv.id, status: "ACTIVE", startTime: "18:00", endTime: "19:30" },
      });
      const buoi1 = await tx.classSession.create({
        data: { classId: lop.id, centerId: cs1.centerId, date: new Date(`${congNgay(homNay, -5)}T11:00:00.000Z`), lessonId: bai1.id, status: "COMPLETED" },
      });
      const buoi2 = await tx.classSession.create({
        data: { classId: lop.id, centerId: cs1.centerId, date: new Date(`${congNgay(homNay, -4)}T11:00:00.000Z`), lessonId: bai2.id, status: "COMPLETED" },
      });
      const be: Record<"P" | "Q" | "R", { id: string; need1: string; need2: string }> = {} as never;
      for (const [ten, luot] of [["P", 3], ["Q", 1], ["R", 3]] as const) {
        const s = await tx.student.create({ data: { name: tenBe(ten), centerId: cs1.centerId } });
        await tx.enrollment.create({ data: { studentId: s.id, classId: lop.id, courseId: k.id, status: "ACTIVE", saleId: uat.sale1.id } });
        const tk = await tx.makeupCreditAccount.create({ data: { studentId: s.id, courseId: k.id, granted: luot } });
        await tx.makeupCreditEntry.create({ data: { accountId: tk.id, type: "GRANT", grantedDelta: luot, reason: `Mở sổ ${TIEN_TO}`, idemKey: "GRANT:khoi-tao" } });
        const needs: string[] = [];
        for (const [buoi, bai] of [[buoi1, bai1], [buoi2, bai2]] as const) {
          const dd = await tx.attendance.create({
            data: { sessionId: buoi.id, studentId: s.id, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm", centerId: cs1.centerId },
          });
          const n = await tx.makeupNeed.create({
            data: {
              studentId: s.id, classId: lop.id, centerId: cs1.centerId, courseId: k.id, sourceType: "ABSENCE",
              originalAttendanceId: dd.id, missedSessionId: buoi.id, missedLessonId: bai.id, status: "PENDING",
            },
          });
          needs.push(n.id);
        }
        be[ten] = { id: s.id, need1: needs[0]!, need2: needs[1]! };
      }
      return { khoa: k.id, bai1: bai1.id, bai2: bai2.id, be };
    },
    { timeout: 60_000, maxWait: 20_000 },
  );

  const nguoi = {
    userId: uat.admin.id, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), chiCuaSale: null,
  } as unknown as NguoiHocBu;
  const phong = await db.room.findFirst({ where: { centerId: cs1.centerId, status: "ACTIVE" }, select: { id: true }, orderBy: { code: "asc" } });

  /** Ca làm có sẵn của giáo viên → khung 90 phút trong đoạn WORK, ưu tiên gần 20:00 (seed ĐỌC, không ghi ca — [GOW-01]). */
  const khungUngVien = async (ymd: string): Promise<Array<[string, string]>> => {
    const hang = await db.shiftAssignment.findMany({ where: { userId: gv.id, workDate: new Date(`${ymd}T00:00:00.000Z`), status: "ACTIVE" }, select: { segments: true } });
    const phut = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const hhmm = (p: number) => `${String(Math.floor(p / 60)).padStart(2, "0")}:${String(p % 60).padStart(2, "0")}`;
    const ra: Array<[string, string]> = [];
    for (const h of hang) {
      const doan = Array.isArray(h.segments) ? (h.segments as Array<{ start?: unknown; end?: unknown; kind?: unknown }>) : [];
      for (const d of doan) {
        if (d.kind !== "WORK" || typeof d.start !== "string" || typeof d.end !== "string") continue;
        for (let b = phut(d.start); b + 90 <= phut(d.end); b += 30) ra.push([hhmm(b), hhmm(b + 90)]);
      }
    }
    ra.sort((x, y) => Math.abs(phut(x[0]) - phut(GIO_UU_TIEN)) - Math.abs(phut(y[0]) - phut(GIO_UU_TIEN)));
    return ra.filter((kh, i) => ra.findIndex((o) => o[0] === kh[0]) === i).slice(0, 14);
  };
  /** Tạo case ở khung đầu tiên xếp được trong 14 ngày tới (từ NGÀY MAI: không dính giờ đã qua). */
  const taoCase = async (needIds: string[], lessonIds: string[], nhan: string) => {
    let loiCuoi = "";
    for (let d = 1; d <= 14; d++) {
      const ymd = congNgay(homNay, d);
      for (const [bd, kt] of await khungUngVien(ymd)) {
        try {
          const id = await taoCaseVaXep(nguoi, { ymd, startTime: bd, endTime: kt, roomId: phong?.id ?? null, teacherId: gv.id, note: `${TIEN_TO} — ${nhan}`, needIds, lessonIds, coQuyenDuyet: true });
          return id;
        } catch (e) {
          loiCuoi = e instanceof Error ? e.message : String(e);
        }
      }
    }
    throw new Error(`không xếp được case "${nhan}" trong 14 ngày tới — lỗi cuối: ${loiCuoi || "uat.giaovien không có ca làm"}`);
  };
  const trangThai = async (needId: string) => (await db.makeupNeed.findUniqueOrThrow({ where: { id: needId }, select: { status: true } })).status;
  const luotGiu = async (studentId: string) => (await db.makeupCreditAccount.findUniqueOrThrow({ where: { studentId_courseId: { studentId, courseId: ids.khoa } } })).held;
  const nhatKy = async (caseId: string, hanhDong: string) =>
    ((await db.auditLog.findFirst({ where: { module: "hoc-bu", entityId: caseId, action: hanhDong }, orderBy: { createdAt: "desc" } }))?.newValues ?? {}) as { needIds?: string[]; gopThem?: string[]; them?: unknown[] };
  const P = ids.be.P, Q = ids.be.Q, R = ids.be.R;
  console.log("");
  let case1 = "";

  await thu("GOP-01", async () => {
    case1 = await taoCase([P.need1], [ids.bai1, ids.bai2], "GOP-01 (P)");
    const muc = await db.makeupCaseStudent.findMany({ where: { caseId: case1, makeupNeedId: { in: [P.need1, P.need2] } }, select: { makeupNeedId: true, lessonId: true } });
    kiem("GOP-01a case tạo được, có mục bài 1 của P", muc.some((m) => m.makeupNeedId === P.need1 && m.lessonId === ids.bai1));
    kiem("GOP-01b mục bài 2 của CÙNG bé tự vào case", muc.some((m) => m.makeupNeedId === P.need2 && m.lessonId === ids.bai2));
    kiem("GOP-01c dòng bài 2 biến khỏi danh sách 'Cần bù' (không còn PENDING)", (await trangThai(P.need2)) !== "PENDING", `trạng thái ${await trangThai(P.need2)}`);
    const nk = await nhatKy(case1, "hoc-bu.tao-case");
    kiem("GOP-01d nhật ký có needIds đầy đủ + gopThem", (nk.needIds ?? []).length === 2 && (nk.gopThem ?? []).join() === P.need2, `needIds=${(nk.needIds ?? []).length} gopThem=${(nk.gopThem ?? []).length}`);
    const trung = await Promise.all([P.need1, P.need2].map((n) => db.makeupCaseStudent.count({ where: { makeupNeedId: n } })));
    kiem("GOP-01e không trùng mục (mỗi dòng đúng MỘT mục)", trung.every((n) => n === 1), `đếm=${trung.join(",")}`);
    kiem("GOP-01f lượt bị giữ đúng số mục (2)", (await luotGiu(P.id)) === 2, `held=${await luotGiu(P.id)}`);
  });

  await thu("GOP-02", async () => {
    const c2 = await taoCase([Q.need1], [ids.bai1, ids.bai2], "GOP-02 (Q hết lượt)");
    kiem("GOP-02a Q còn 1 lượt: case VẪN tạo được, dòng bài 1 vào case", (await trangThai(Q.need1)) === "SCHEDULED" && !!c2);
    kiem("GOP-02b dòng bài 2 của Q KHÔNG bị gộp, vẫn ở danh sách Cần bù", (await trangThai(Q.need2)) === "PENDING", `trạng thái ${await trangThai(Q.need2)}`);
    kiem("GOP-02c lượt giữ = 1 (không vượt sổ)", (await luotGiu(Q.id)) === 1, `held=${await luotGiu(Q.id)}`);
    kiem("GOP-02d nhật ký KHÔNG có gopThem", (await nhatKy(c2, "hoc-bu.tao-case")).gopThem === undefined);
  });

  await thu("GOP-03", async () => {
    if (!case1) throw new Error("thiếu case của GOP-01");
    await xepVaoCaseCoSan(nguoi, { caseId: case1, needIds: [R.need1], coQuyenDuyet: true });
    kiem("GOP-03a 'Thêm vào case có sẵn': chỉ mục người dùng chọn được thêm", (await trangThai(R.need1)) === "SCHEDULED");
    kiem("GOP-03b KHÔNG tự kéo dòng bài 2 của cùng bé", (await trangThai(R.need2)) === "PENDING", `trạng thái ${await trangThai(R.need2)}`);
    const mucR = await db.makeupCaseStudent.count({ where: { caseId: case1, makeupNeed: { studentId: R.id }, result: { not: "RELEASED" } } });
    kiem("GOP-03c bé R có đúng 1 mục trong case", mucR === 1, `mục=${mucR}`);
    kiem("GOP-03d nhật ký xep-vao-case KHÔNG có gopThem", (await nhatKy(case1, "hoc-bu.xep-vao-case")).gopThem === undefined);
  });

  await thu("PSOM", async () => {
    const muc = await db.makeupCaseStudent.findFirstOrThrow({ where: { caseId: case1, makeupNeedId: P.need1 }, select: { id: true } });
    await ghiDanhGiaMuc(null, { caseStudentId: muc.id, danhGia: PHIEU_NHAP, chiGiaoVien: gv.id, ten: "Nghiệm thu UAT" });
    const m = await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: muc.id }, select: { result: true, teacherEvaluation: true } });
    kiem("PSOM-01 lưu được phiếu khi mục còn chờ điểm danh (kết quả vẫn PLANNED)", m.result === "PLANNED" && m.teacherEvaluation === PHIEU_NHAP, `result=${m.result}`);
    const doc = await getStudentMakeup(P.id);
    const mP = [...doc.needList, ...doc.history].find((x) => x.id === P.need1);
    kiem("PSOM-02 phụ huynh KHÔNG thấy phiếu nháp (đối chứng: đọc được dòng của bé)", !!mP && !JSON.stringify(doc).includes(PHIEU_NHAP) && (mP.ketQua.hienTai?.danhGia ?? null) === null);
  });

  const rot = ketQua.filter((k) => !k.dat);
  console.log(`\n  Kết quả: ${ketQua.length - rot.length}/${ketQua.length} PASS${rot.length ? ` — ${rot.length} FAIL: ${rot.map((k) => k.ma).join(", ")}` : ""}\n`);
  if (rot.length) process.exitCode = 1;
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("\n  ✗ NGHIỆM THU DỪNG:", e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
