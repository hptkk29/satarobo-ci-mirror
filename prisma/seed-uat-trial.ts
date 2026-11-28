// prisma/seed-uat-trial.ts — dựng dữ liệu THẬT cho lớp trải nghiệm (UAT).
//
// VÌ SAO CÓ FILE NÀY. Bộ seed UAT tạo 100 lớp trial nhưng đo lại thì: 1 buổi, 0 điểm
// danh, 0 phiếu đánh giá, 0 ca có giáo viên phân công, 0 lượt dời lịch. Tức là màn Lớp
// Trial mở ra thì có danh sách lớp, còn mọi việc BÊN TRONG lớp — điểm danh, chấm phiếu,
// đề xuất/phân công giáo viên, dời lịch — đều không có gì để bấm. Nghiệm thu bốn mục
// đó bằng dữ liệu rỗng là nghiệm thu cái khung, không phải cái chạy.
//
// CHẠY:
//   UAT_SEED=1 pnpm exec tsx prisma/seed-uat-trial.ts            # ghi thật
//   UAT_SEED=1 UAT_TRIAL_DRY=1 pnpm exec tsx prisma/seed-uat-trial.ts   # chỉ đếm
//
// ⚠️ Ép `DATABASE_URL` = `DIRECT_URL` (session pooler :5432) khi chạy. Qua transaction
// pooler :6543 script rời sẽ đâm `42P05 prepared statement "s0" already exists`.
//
// CHỈ THÊM — không một câu xoá nào. Id sinh TẤT ĐỊNH từ dữ liệu nguồn nên chạy lại là
// ghi đè chính nó (idempotent), không đẻ bản sao.
//
// ĐỂ LẠI VIỆC CHO NGƯỜI NGHIỆM THU — cố ý, đừng "sửa" thành seed đầy:
//   · lớp nhóm A: đủ buổi + điểm danh + phiếu + GV đã phân công  → xem kết quả
//   · lớp nhóm B: có buổi + có ca, GV mới ở mức ĐỀ XUẤT          → Đào tạo bấm duyệt
//   · lớp nhóm C: có buổi + có ca, chưa điểm danh chưa chấm      → Sale/GV có việc làm
// Seed đầy cả ba nhóm thì không còn chỗ nào để bấm thử.
import { createHash } from "node:crypto";
import { PrismaClient, type TrialAttendanceStatus } from "@prisma/client";
import { RUBRIC_CRITERIA, computeTotal, rankOf } from "@/lib/trial/rubric";

const db = new PrismaClient();
const DRY = process.env.UAT_TRIAL_DRY === "1";

/** Id tất định: cùng đầu vào → cùng id, chạy lại không đẻ dòng mới. */
function uid(...phan: string[]): string {
  return "uat" + createHash("sha1").update(phan.join("|")).digest("hex").slice(0, 22);
}

/** Số giả ngẫu nhiên TẤT ĐỊNH theo khoá — để hai lượt chạy ra cùng dữ liệu. */
function rnd(khoa: string): number {
  const h = createHash("sha1").update(khoa).digest();
  return ((h[0]! << 8) | h[1]!) / 65536;
}

/** Ngày @db.Date: nửa đêm UTC của ngày VN tương ứng. */
function ngayVN(lechNgay: number): Date {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  const d = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + lechNgay);
  return d;
}

function assertChoPhep(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("Thiếu DATABASE_URL");
  console.log(`\n  Đích ghi: ${(() => { try { return new URL(url).host; } catch { return "(không đọc được)"; } })()}`);
  if (process.env.UAT_SEED !== "1") {
    throw new Error("Chưa bật cờ an toàn. Xem host ở trên, đúng chỗ thì chạy lại với UAT_SEED=1.");
  }
  if (url.includes(":6543")) {
    console.warn("  ⚠ Đang dùng pooler giao dịch :6543 — vấp 42P05 thì đổi sang DIRECT_URL (:5432).");
  }
}

/** Ba khung giờ trong ngày — lớp trial thật chạy theo ca. */
const CA = [
  { startTime: "09:00", endTime: "10:30" },
  { startTime: "14:00", endTime: "15:30" },
  { startTime: "17:30", endTime: "19:00" },
];

type Nhom = "A" | "B" | "C";

async function main() {
  assertChoPhep();

  // ── Nguồn: lớp trial đang mở, theo cơ sở ─────────────────────────────────
  const lopTatCa = await db.trialClassV2.findMany({
    where: { status: { in: ["OPEN", "RUNNING"] } },
    select: { id: true, code: true, centerId: true, capacity: true, sessionCount: true },
    orderBy: { code: "asc" },
  });
  const theoCoSo = new Map<string, typeof lopTatCa>();
  for (const l of lopTatCa) {
    const ds = theoCoSo.get(l.centerId) ?? [];
    ds.push(l);
    theoCoSo.set(l.centerId, ds);
  }

  // Giáo viên theo cơ sở — dùng để gán gvDeXuat / gvPhanCong.
  const gvTatCa = await db.user.findMany({
    where: { role: "TEACHER", isActive: true },
    select: { id: true, name: true, centerId: true },
  });

  // Ứng viên: con của lead CHƯA có ca học thử nào đang mở.
  //
  // ⚠️ Ràng buộc partial-unique của schema: MỘT bé chỉ được có MỘT ca `ACTIVE` tại một
  // thời điểm. Bỏ qua điều này thì upsert đâm `Unique constraint failed on (leadChildId)`
  // ngay bé đầu tiên đã có ca — và đó là ràng buộc ĐÚNG, đừng nới nó để seed chạy được.
  const daCoCa = new Set(
    (
      await db.trialEnrollment.findMany({
        where: { status: "ACTIVE" },
        select: { leadChildId: true },
      })
    ).map((e) => e.leadChildId),
  );
  const conTatCa = (
    await db.leadChild.findMany({
      // Cột tên của LeadChild là `fullName` (không phải `name` như User/Student).
      select: { id: true, fullName: true, lead: { select: { centerId: true } } },
    })
  ).filter((c) => !daCoCa.has(c.id));

  // Người thao tác để ghi vào `markedById` / `evaluatedById` — lấy tài khoản UAT.
  const uat = await db.user.findMany({
    where: { email: { in: ["uat.sale1@satarobo.vn", "uat.sale2@satarobo.vn", "uat.giaovien@satarobo.vn", "uat.daotao@satarobo.vn", "uat.giamdoc@satarobo.vn"] } },
    select: { id: true, email: true, name: true },
  });
  const byEmail = Object.fromEntries(uat.map((u) => [u.email, u]));

  let soBuoi = 0, soCa = 0, soDiemDanh = 0, soPhieu = 0, soGvDeXuat = 0, soGvPhanCong = 0, soDoiLich = 0;

  for (const [centerId, dsLop] of theoCoSo) {
    const gvCoSo = gvTatCa.filter((g) => g.centerId === centerId);
    const conCoSo = conTatCa.filter((c) => c.lead.centerId === centerId);
    if (conCoSo.length === 0) continue;

    // 9 lớp mỗi cơ sở: 3 nhóm × 3 lớp. Đủ để mỗi nhóm có nhiều hơn một ví dụ mà không
    // biến toàn bộ 100 lớp thành dữ liệu giả.
    const chon = dsLop.slice(0, 9);
    let iCon = 0;

    for (let i = 0; i < chon.length; i++) {
      const lop = chon[i]!;
      const nhom: Nhom = i < 3 ? "A" : i < 6 ? "B" : "C";
      const ca = CA[i % CA.length]!;

      // ── Buổi: 2 buổi đã qua + 1 buổi sắp tới ───────────────────────────────
      const lichBuoi = [
        { seq: 1, lech: -7, status: "COMPLETED" as const },
        { seq: 2, lech: -2, status: "COMPLETED" as const },
        { seq: 3, lech: +3, status: "SCHEDULED" as const },
      ];
      const buoiIds: { id: string; seq: number; daQua: boolean }[] = [];
      for (const b of lichBuoi) {
        const id = uid("buoi", lop.id, String(b.seq));
        buoiIds.push({ id, seq: b.seq, daQua: b.lech < 0 });
        if (DRY) { soBuoi++; continue; }
        await db.trialClassSession.upsert({
          where: { id },
          create: {
            id,
            trialClassId: lop.id,
            seq: b.seq,
            date: ngayVN(b.lech),
            startTime: ca.startTime,
            endTime: ca.endTime,
            // Buổi giữ GV mặc định của lớp — quyết định theo TỪNG CA nằm ở
            // TrialEnrollment.gvPhanCongId, không phải ở đây.
            status: b.status,
          },
          update: { date: ngayVN(b.lech), status: b.status },
        });
        soBuoi++;
      }

      // ── Ca học (ghi danh): 2–3 bé mỗi lớp ─────────────────────────────────
      const soBe = 2 + (rnd(`sobe|${lop.id}`) > 0.5 ? 1 : 0);
      for (let k = 0; k < soBe; k++) {
        // KHÔNG quay vòng danh sách: hết con chưa có ca thì thôi, xếp một bé vào lớp
        // thứ hai là vi phạm đúng ràng buộc "một bé một ca ACTIVE" nói ở trên.
        const con = conCoSo[iCon++];
        if (!con) break;
        const caId = uid("ca", lop.id, con.id);
        const gv = gvCoSo.length ? gvCoSo[k % gvCoSo.length]! : null;

        // Nhóm A: Đào tạo đã phân công. Nhóm B: Sale mới đề xuất, chờ duyệt.
        // Nhóm C: chưa ai đụng — để người nghiệm thu tự làm từ đầu.
        const gvDeXuatId = nhom === "C" ? null : gv?.id ?? null;
        const gvPhanCongId = nhom === "A" ? gv?.id ?? null : null;

        if (!DRY) {
          await db.trialEnrollment.upsert({
            where: { id: caId },
            create: {
              id: caId,
              trialClassId: lop.id,
              leadChildId: con.id,
              status: "ACTIVE",
              scheduledSessionId: buoiIds[0]!.id,
              gvDeXuatId,
              gvPhanCongId,
              // 27/08 — PHƯƠNG ÁN B: người đưa ca vào lớp quyết định ca đó là "đã phân
              // công" hay mới "đề xuất". Nhóm A phải do người CÓ QUYỀN DUYỆT đưa vào,
              // nếu không `scripts/backfill-gv-trial-phuong-an-b.ts` sẽ hạ nó xuống đề
              // xuất ngay lượt chạy sau — seed và backfill đá nhau, số liệu nghiệm thu
              // đổi mỗi lần chạy.
              addedById:
                (nhom === "A"
                  ? byEmail["uat.giamdoc@satarobo.vn"]?.id
                  : byEmail["uat.sale1@satarobo.vn"]?.id) ?? null,
            },
            // Sửa cả trên dòng đã tồn tại: seed cũ ghi `addedById` = Sale cho MỌI nhóm,
            // nên chạy lại phải kéo nhóm A về đúng người duyệt, không thì backfill
            // phương án B lại hạ nó xuống đề xuất.
            update: {
              gvDeXuatId,
              gvPhanCongId,
              addedById:
                (nhom === "A"
                  ? byEmail["uat.giamdoc@satarobo.vn"]?.id
                  : byEmail["uat.sale1@satarobo.vn"]?.id) ?? null,
            },
          });
        }
        soCa++;
        if (gvDeXuatId) soGvDeXuat++;
        if (gvPhanCongId) soGvPhanCong++;

        // ── Điểm danh + phiếu đánh giá: CHỈ nhóm A ─────────────────────────
        // Nhóm B/C cố ý để trống — đó là việc của người nghiệm thu.
        if (nhom !== "A") continue;

        for (const b of buoiIds.filter((x) => x.daQua)) {
          const vang = rnd(`vang|${caId}|${b.seq}`) < 0.15;
          const trangThai: TrialAttendanceStatus = vang ? "ABSENT" : "PRESENT";
          if (!DRY) {
            await db.trialAttendance.upsert({
              where: {
                trialSessionId_trialEnrollmentId: { trialSessionId: b.id, trialEnrollmentId: caId },
              },
              create: {
                trialSessionId: b.id,
                trialEnrollmentId: caId,
                status: trangThai,
                note: vang ? "PH báo bận, xin học bù" : null,
                // GĐ4 — điểm danh là việc của SALE.
                markedById: byEmail["uat.sale1@satarobo.vn"]?.id ?? null,
              },
              update: { status: trangThai },
            });
          }
          soDiemDanh++;

          // Bé vắng thì không có phiếu — đúng đời thật, và cũng là ca biên để kiểm
          // cổng "đã đủ đánh giá" đếm ra sao khi thiếu một buổi.
          if (vang) continue;

          // MỘT phiếu / MỘT buổi — đúng khoá kép của GĐ4. Đây là thứ chứng minh
          // chấm buổi 2 không còn ghi đè phiếu buổi 1.
          const scores: Record<string, number> = {};
          for (const c of RUBRIC_CRITERIA) {
            const muc = c.levels;
            const idx = Math.floor(rnd(`diem|${caId}|${b.seq}|${c.id}`) * muc.length);
            scores[c.id] = muc[Math.min(idx, muc.length - 1)]!.points;
          }
          const total = computeTotal(scores);
          const gvCham = gv ?? null;
          if (!DRY) {
            await db.trialRubricEval.upsert({
              where: {
                trialEnrollmentId_trialClassSessionId: {
                  trialEnrollmentId: caId,
                  trialClassSessionId: b.id,
                },
              },
              create: {
                trialEnrollmentId: caId,
                trialClassSessionId: b.id,
                scores,
                totalScore: total,
                rank: rankOf(total).label,
                generalComment: `Buổi ${b.seq}: ${con.fullName} tham gia đầy đủ, có tiến bộ so với buổi trước.`,
                orientation: "Phù hợp lộ trình Sata 1 — đề xuất ghi danh khoá chính thức.",
                evaluatedById: gvCham?.id ?? null,
                evaluatedByName: gvCham?.name ?? null,
              },
              update: { scores, totalScore: total, rank: rankOf(total).label },
            });
          }
          soPhieu++;
        }

        // ── Dời lịch: một ca của nhóm A, để mục nghiệm thu #12 có dữ liệu ────
        if (k === 0 && rnd(`doi|${lop.id}`) > 0.5) {
          const tu = buoiIds[0]!;
          const den = buoiIds[2]!;
          const dlId = uid("doilich", caId);
          if (!DRY) {
            await db.trialReschedule.upsert({
              where: { id: dlId },
              create: {
                id: dlId,
                trialEnrollmentId: caId,
                fromSessionId: tu.id,
                toSessionId: den.id,
                reason: "PH xin dời sang buổi cuối tuần",
                changedById: byEmail["uat.sale1@satarobo.vn"]?.id ?? null,
                changedByName: byEmail["uat.sale1@satarobo.vn"]?.name ?? null,
                centerId,
              },
              update: {},
            });
            await db.trialEnrollment.update({
              where: { id: caId },
              data: {
                rescheduleCount: 1,
                rescheduledFromSessionId: tu.id,
                rescheduledAt: new Date(),
                rescheduleReason: "PH xin dời sang buổi cuối tuần",
                scheduledSessionId: den.id,
              },
            });
          }
          soDoiLich++;
        }
      }
    }
  }

  console.log(`\n  🧪 Lớp trải nghiệm ${DRY ? "[DRY-RUN — không ghi gì]" : ""}`);
  console.log(`     buổi học        : ${soBuoi}`);
  console.log(`     ca học (ghi danh): ${soCa}`);
  console.log(`     GV đề xuất      : ${soGvDeXuat}`);
  console.log(`     GV đã phân công : ${soGvPhanCong}`);
  console.log(`     điểm danh       : ${soDiemDanh}`);
  console.log(`     phiếu đánh giá  : ${soPhieu}`);
  console.log(`     lượt dời lịch   : ${soDoiLich}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("\n  ✗ SEED DỪNG:", e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
