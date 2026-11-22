/**
 * tests/cham-cong/_do-ap-khung-thoi-gian.ts — ĐO thời gian "Áp khung lịch" một tháng, mỗi tuần một giao dịch (chốt lượt 2 điểm 5, 27/10/2026).
 *
 * Dựng một cơ sở GIẢ (`doak-*`) với khối lượng một tuần cho trước (lấy từ mục ⑬ của `scripts/do-phan-cong-gop.ts` — số prod CS2), áp
 * khung một tháng (4 tuần đích) bằng ĐÚNG `apKhung` của màn, in số giây MỖI TUẦN, rồi DỌN SẠCH.
 *
 * ⚠️ CHỈ chạy trên Postgres test CỤC BỘ (`laDbCucBo` + tên `satarobo_test*`) — script GHI rồi xoá. Không bao giờ trỏ tunnel VPS.
 * ⚠️ Số đo ở máy có RTT DB < 1 ms ⇒ THẤP HƠN đường VPS (mỗi câu lệnh một lượt đi-về qua mạng). Đọc kèm số câu lệnh mỗi tuần.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test_pcg pnpm exec tsx tests/cham-cong/_do-ap-khung-thoi-gian.ts \
 *     --lop 40 --buoi-moi-lop 1 --ta 0.5 --truc 12
 *
 * Không in tên / email / SĐT — chỉ số.
 */
import "../../scripts/_cho-phep-server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const url = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(url) || !laTenDbTest(url)) {
  console.error("Từ chối: DATABASE_URL phải trỏ Postgres test cục bộ (satarobo_test*) — script này GHI rồi xoá.");
  process.exit(1);
}

const thamSo = (ten: string, macDinh: number) => {
  const i = process.argv.indexOf(`--${ten}`);
  return i > 0 ? Number(process.argv[i + 1]) : macDinh;
};
const LOP = thamSo("lop", 40);
const BUOI_MOI_LOP = Math.min(2, Math.max(1, thamSo("buoi-moi-lop", 1)));
const TI_LE_TA = thamSo("ta", 0.5);
const TRUC = thamSo("truc", 12);
const TAG = "doak";
const TUAN_MAU = "2026-11-02"; // Thứ Hai
const DICH_TU = "2026-11-09";
const DICH_DEN = "2026-12-06"; // 4 tuần
const HOM_NAY = "2026-11-08";

const congNgay = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const gio = (h: number) => `${String(h).padStart(2, "0")}:00`;

async function main() {
  const { db } = await import("../../lib/db");
  const { apKhung } = await import("../../lib/phan-cong/ap-khung-db");

  async function don() {
    const cs = await db.center.findUnique({ where: { slug: `${TAG}-cs` }, select: { id: true } });
    if (!cs) return;
    const users = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    await db.auditLog.deleteMany({ where: { OR: [{ entityId: cs.id }, { actorId: { in: users } }] } });
    await db.sessionStaffAssignment.deleteMany({ where: { centerId: cs.id } });
    await db.operationsDutyAssignment.deleteMany({ where: { centerId: cs.id } });
    await db.domainEvent.deleteMany({ where: { type: { in: ["parttime.staffing_dirty", "class.session_changed"] } } });
    const cls = (await db.class.findMany({ where: { centerId: cs.id }, select: { id: true } })).map((c) => c.id);
    await db.classSession.deleteMany({ where: { classId: { in: cls } } });
    await db.class.deleteMany({ where: { id: { in: cls } } });
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-cs` } });
    await db.center.delete({ where: { id: cs.id } });
  }

  await don();
  const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
  const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
  if (!m) throw new Error("không thấy paramsJson SR.QD.238");
  await db.compensationPolicyVersion.upsert({
    where: { code: "SR.QD.238" },
    update: {},
    create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "SR.QD.238", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]!) },
  });
  const cs = (await db.center.create({ data: { slug: `${TAG}-cs`, name: "CS đo áp khung", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
  const ou = (await db.orgUnit.create({ data: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV đo", path: `/${TAG}-cs/`, depth: 0, centerId: cs }, select: { id: true } })).id;
  const khoa = (await db.course.create({ data: { name: "Khoá đo", slug: `${TAG}-k` }, select: { id: true } })).id;
  const gv: string[] = [];
  for (let i = 0; i < LOP; i++) gv.push((await db.user.create({ data: { email: `gv${i}@${TAG}.test`, name: `GV ${i}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id);
  const actor = { id: (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL đo", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id, name: "QL đo" };

  // Mỗi lớp một ô (thứ, giờ) RIÊNG ⇒ không ai trùng lịch: 6 thứ × 14 khung 07:00–20:00. Buổi thứ hai (nếu có) lệch 3 ngày, cùng giờ.
  if (LOP > 6 * 14 / BUOI_MOI_LOP) throw new Error("Quá nhiều lớp cho số khung giờ — giảm --lop");
  const tuanDich = [0, 1, 2, 3].map((k) => congNgay(DICH_TU, k * 7));
  let soPc = 0;
  for (let i = 0; i < LOP; i++) {
    const thu = i % 6;
    const h = 7 + Math.floor(i / 6);
    const lop = await db.class.create({ data: { name: `${TAG} L${i}`, courseId: khoa, centerId: cs, teacherId: gv[i]!, startTime: gio(h), endTime: gio(h + 1) }, select: { id: true } });
    for (const thuHai of [TUAN_MAU, ...tuanDich]) {
      for (let b = 0; b < BUOI_MOI_LOP; b++) {
        const ngay = congNgay(thuHai, (thu + b * 3) % 6);
        const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: new Date(`${ngay}T${gio(h)}:00+07:00`) }, select: { id: true } });
        const pc = (userId: string, role: "MAIN_TEACHER" | "TEACHING_ASSISTANT") =>
          db.sessionStaffAssignment.create({
            data: { sourceType: "CLASS_SESSION", sourceId: s.id, centerId: cs, orgUnitId: ou, ngay: new Date(`${ngay}T00:00:00Z`), gioBatDau: gio(h), gioKetThuc: gio(h + 1), userId, role, activityType: "REGULAR_CLASS", assignmentType: "MANUAL", nguonGiao: "TAY", status: "ACCEPTED" },
          });
        if (thuHai === TUAN_MAU) {
          await pc(gv[(i + 1) % LOP]!, "MAIN_TEACHER"); // mẫu: người KHÁC đứng chính ⇒ đích phải đổi người (bước ghi thật)
          if (i < LOP * TI_LE_TA) await pc(gv[(i + 2) % LOP]!, "TEACHING_ASSISTANT");
          soPc++;
        } else await pc(gv[i]!, "MAIN_TEACHER");
      }
    }
  }
  for (let j = 0; j < TRUC; j++)
    await db.operationsDutyAssignment.create({
      data: { userId: gv[j % LOP]!, centerId: cs, workDate: new Date(`${congNgay(TUAN_MAU, j % 6)}T00:00:00Z`), shiftCode: j % 2 ? "T" : "C", policyVersionId: "cpv_sr_qd_238", nguonGiao: "TAY", status: "ACCEPTED" },
    });
  console.log(`Khối lượng tuần mẫu: ${LOP} lớp × ${BUOI_MOI_LOP} buổi · trợ giảng ~${Math.round(TI_LE_TA * 100)}% · trực ${TRUC} ca · ${soPc} buổi có phân công`);

  try {
    for (const ghiThat of [false, true]) {
      const batDau = performance.now();
      const kq = await apKhung({ centerId: cs, tuanMau: TUAN_MAU, tu: DICH_TU, den: DICH_DEN, cheDo: "BO_SUNG", giaoVien: null, homNay: HOM_NAY, ghiThat, actor });
      console.log(`\n${ghiThat ? "GHI THẬT" : "XEM TRƯỚC"} — tổng ${((performance.now() - batDau) / 1000).toFixed(2)} s · ${kq.buoc.length} bước${kq.loi ? ` · LỖI tuần ${kq.loi.thuHai}: ${kq.loi.thongDiep}` : ""}`);
      for (const t of kq.tuan) console.log(`  tuần ${t.thuHai}: ${t.soBuoc} bước · ${(t.ms / 1000).toFixed(2)} s`);
    }
  } finally {
    await don();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
