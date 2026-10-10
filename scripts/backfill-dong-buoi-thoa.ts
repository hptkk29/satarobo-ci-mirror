/**
 * scripts/backfill-dong-buoi-thoa.ts — ĐÓNG những buổi đã THOẢ cổng tự đóng mà còn kẹt.
 *
 * ⚠️ CHẠY THỬ LÀ MẶC ĐỊNH. Ghi thật phải có `--apply`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CHÚNG KẸT — đo, không đoán
 *
 * Cổng tự đóng buổi CHỈ chạy trong đường LƯU ĐIỂM DANH (`teacher/lop/_actions.ts`). Buổi
 * nào đã đủ điểm danh TRƯỚC khi bản vá cổng lên prod thì không có lượt lưu nào nữa để đánh
 * thức nó — nó kẹt vĩnh viễn, không phải vì cổng hỏng.
 *
 * Đo prod 09/09/2026 (workflow ĐO, user chỉ-đọc): 188 buổi đã qua ngày mà chưa chốt, trong
 * đó **90 THOẢ** cổng đã sửa. Và cả **90/90** có lượt điểm danh cuối TRƯỚC mốc bản vá
 * (PR #227, 2026-09-08T01:30:54Z) — **0 buổi** thuộc nhóm sau. Nên đây đúng là backlog cũ.
 *
 * 98 buổi còn lại KHÔNG được đóng: chúng chưa từng điểm danh đủ sĩ số. Đóng là bịa dữ liệu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BA ĐIỀU KIỆN CHỦ DỰ ÁN CHỐT — mỗi cái chặn một đường hỏng khác nhau
 *
 * 1. KHÔNG phát `session.taught`. Chặn ở TẦNG PHÁT (`session-lifecycle.ts`), không chặn
 *    bằng `assignMode` — `r7-lifecycle` KHÔNG đọc `assignMode`, nên chặn kiểu đó chỉ chặn
 *    được hai trong ba consumer trong khi người viết tin là đã chặn cả ba.
 *    Ba người nghe: giao bài tập hồi tố · gửi tin "Bài tập mới" cho phụ huynh · hệ quả R7.
 *
 * 2. `nguonChot: "BACKFILL"` — giá trị THỨ BA, không mượn `TU_DONG` cũng không mượn `TAY`.
 *    Mượn cái nào cũng làm hỏng đúng phép đếm vừa dựng ra để đo cổng tự đóng: 90 dòng này
 *    sẽ đội lên một trong hai cột và câu trả lời "cổng có nổ không" thành vô nghĩa.
 *
 * 3. `rosterSource: "BACKFILL_CLOSE"` — `completeSession` đếm ghi danh ĐANG CÓ lúc gọi, nên
 *    với buổi dạy tháng 4 đóng tháng 9 thì đó là sĩ số HÔM NAY. Ghi `SNAPSHOT` là dán nhãn
 *    "số đo" lên số suy đoán và `lib/payroll/roster-guard.ts` sẽ NHẬN nó vào công thức
 *    lương. Với `BACKFILL_CLOSE` thì cổng lương vẫn TỪ CHỐI — đúng ý.
 *
 * ⚠️ KHÔNG chép lại luật "buổi nào thoả": script gọi CHÍNH `quyetDinhTuHoanTat`, cùng hàm mà
 * cổng thật dùng và cùng hàm mà phép đo backlog dùng. Ba chỗ một luật (luật 9).
 *
 * CHẠY:
 *   pnpm tsx scripts/backfill-dong-buoi-thoa.ts             # chạy thử, in bảng phạm vi
 *   pnpm tsx scripts/backfill-dong-buoi-thoa.ts --apply     # ghi thật
 */
// `_load-env` phải chạy TRƯỚC mọi import chạm Prisma.
// `_cho-phep-server-only` phải chạy TRƯỚC khi nhập `lib/lms/session-lifecycle` — file đó
// mở đầu bằng `import "server-only"`, package do Next cấp lúc build và KHÔNG có trong
// node_modules. Vì `import` tĩnh bị hoist, `completeSession` phải nhập ĐỘNG ở trong `main`.
import "./_cho-phep-server-only";
import { currentDbHost } from "./_load-env";
import { scriptDb } from "./_script-db";
import { inQuyen, kiemQuyen } from "./_kiem-quyen";
import { db } from "../lib/db";
import { quyetDinhTuHoanTat } from "../lib/lms/tu-hoan-tat-buoi";
import { rosterWhere } from "../lib/enrollment-scope";
import { vnDateOnly, vnYmd } from "../lib/time/vn";

const kiemDb = scriptDb();
const GHI = process.argv.includes("--apply");

/** Tên hiện trong `AuditLog.actorName`. `actorId` để null — KHÔNG người nào bấm. */
const TEN_TAC_NHAN = "Backfill đóng buổi thoả (09/09/2026)";

function tieu(s: string) {
  console.log("");
  console.log("═".repeat(88));
  console.log(s);
  console.log("═".repeat(88));
}
function dong(nhan: string, n: number | string) {
  console.log(`  ${nhan.padEnd(56)} ${String(n).padStart(10)}`);
}

async function main() {
  console.log(`DB host: ${currentDbHost() ?? "(không đọc được)"}`);
  inQuyen(await kiemQuyen(kiemDb), GHI);
  tieu(GHI ? "BACKFILL ĐÓNG BUỔI THOẢ — GHI THẬT (--apply)" : "BACKFILL ĐÓNG BUỔI THOẢ — CHẠY THỬ");
  if (!GHI) console.log("Không có `--apply` ⇒ chỉ in phạm vi. Không buổi nào bị đóng.");

  const { completeSession } = await import("../lib/lms/session-lifecycle");

  const homNayUtcMs = vnDateOnly(new Date()).getTime();

  const buoi = await db.classSession.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true, classId: true, status: true, date: true },
    orderBy: { date: "asc" },
  });
  const daQua = buoi.filter((b) => vnDateOnly(b.date).getTime() <= homNayUtcMs);

  if (buoi.length === 0) {
    console.log(
      "\n⚠️ Không đọc được buổi nào. Nếu đây là prod thì con số 0 này KHÔNG phải sự thật —\n" +
        '   xem docs/cham-cong/USER-CHI-DOC-PROD.md mục "Nếu số đo ra 0".',
    );
    return;
  }

  const classIds = [...new Set(daQua.map((b) => b.classId))];
  const [ghiDanh, diemDanh] = await Promise.all([
    db.enrollment.findMany({
      where: { classId: { in: classIds }, ...rosterWhere("dang-hoc") },
      select: { classId: true, studentId: true },
    }),
    db.attendance.findMany({
      where: { sessionId: { in: daQua.map((b) => b.id) } },
      select: { sessionId: true, studentId: true },
    }),
  ]);
  const siSoTheoLop = new Map<string, string[]>();
  for (const e of ghiDanh) {
    const a = siSoTheoLop.get(e.classId) ?? [];
    a.push(e.studentId);
    siSoTheoLop.set(e.classId, a);
  }
  const dauTheoBuoi = new Map<string, string[]>();
  for (const a of diemDanh) {
    const x = dauTheoBuoi.get(a.sessionId) ?? [];
    x.push(a.studentId);
    dauTheoBuoi.set(a.sessionId, x);
  }

  // Dùng CHÍNH hàm của cổng thật — không chép lại luật (luật 9).
  const thoa: { id: string; ngay: Date }[] = [];
  const khongThoa = new Map<string, number>();
  for (const b of daQua) {
    const qd = quyetDinhTuHoanTat({
      trangThaiBuoi: b.status,
      ngayBuoi: b.date,
      homNayUtcMs,
      siSoStudentIds: siSoTheoLop.get(b.classId) ?? [],
      daDanhDauStudentIds: dauTheoBuoi.get(b.id) ?? [],
    });
    if (qd.tuHoanTat) thoa.push({ id: b.id, ngay: b.date });
    else khongThoa.set(qd.lyDo, (khongThoa.get(qd.lyDo) ?? 0) + 1);
  }

  // ── BẢNG PHẠM VI — in TRƯỚC khi đóng buổi đầu tiên ───────────────────────────────────
  //
  // Người bấm nút đọc mô tả workflow, còn thứ chạy là script này. Nên script phải TỰ NÓI
  // phạm vi thật ngay trước khi ghi, thay vì để người bấm tin vào một dòng có thể đã cũ.
  tieu("PHẠM VI — đọc bảng này, đừng tin mô tả ở workflow nếu hai bên lệch");
  dong("buổi chưa chốt", buoi.length);
  dong("  trong đó ĐÃ QUA NGÀY", daQua.length);
  dong("SẼ ĐÓNG (thoả cổng tự đóng)", thoa.length);
  console.log("  KHÔNG đóng, theo lý do:");
  for (const [ly, n] of [...khongThoa.entries()].sort((a, b) => b[1] - a[1])) {
    dong(`    ${ly}`, n);
  }
  const theoThang = new Map<string, number>();
  for (const t of thoa) {
    const k = vnYmd(t.ngay).slice(0, 7);
    theoThang.set(k, (theoThang.get(k) ?? 0) + 1);
  }
  console.log("  Buổi sẽ đóng, theo tháng dạy:");
  for (const k of [...theoThang.keys()].sort()) dong(`    ${k}`, theoThang.get(k) ?? 0);

  console.log("");
  console.log("  Mỗi buổi sẽ được ghi:");
  console.log("    status        = COMPLETED");
  console.log('    nguonChot     = "BACKFILL"  (audit) — KHÔNG lẫn vào cột tự-động/bấm-tay');
  console.log('    rosterSource  = "BACKFILL_CLOSE" — cổng lương vẫn TỪ CHỐI số này');
  console.log("    completedById = null — không người nào bấm");
  console.log("    session.taught: KHÔNG phát ⇒ 0 bài tập hồi tố, 0 tin nhắn phụ huynh");

  if (!GHI) {
    console.log("");
    console.log("  Chưa đóng buổi nào. Thêm `--apply` để ghi thật.");
    return;
  }

  // ── GHI ─────────────────────────────────────────────────────────────────────────────
  tieu(`ĐANG ĐÓNG ${thoa.length} BUỔI`);
  let xong = 0;
  const hong: { id: string; loi: string }[] = [];
  for (const t of thoa) {
    try {
      const r = await completeSession({
        sessionId: t.id,
        // Điểm danh đã đủ — đó CHÍNH LÀ điều kiện lọt vào danh sách này.
        confirmNoAttendance: true,
        // Vẫn truyền DEFER cho đúng nghĩa, nhưng nó KHÔNG phải thứ chặn sự kiện ở đây:
        // sự kiện bị chặn ở tầng phát theo `nguonChot`. Xem chú thích đầu file.
        assignMode: "DEFER",
        nguonChot: "BACKFILL",
        actorId: null,
        actorName: TEN_TAC_NHAN,
      });
      if (!r.ok) {
        hong.push({ id: t.id, loi: r.error ?? "không rõ" });
        continue;
      }
      xong += 1;
      if (xong % 20 === 0) console.log(`  … đã đóng ${xong}/${thoa.length}`);
    } catch (e) {
      hong.push({ id: t.id, loi: e instanceof Error ? e.message : String(e) });
    }
  }

  tieu("KẾT QUẢ");
  dong("đã đóng", xong);
  dong("hỏng", hong.length);
  for (const h of hong.slice(0, 10)) console.log(`    ${h.id}: ${h.loi}`);
  if (hong.length > 10) console.log(`    … và ${hong.length - 10} buổi nữa`);
  console.log("");
  console.log("  ⚠️ ĐO LẠI bằng workflow ĐO (viec = backlog) — đừng tin log này.");
  console.log(
    "  ⚠️ Con số COMPLETED sẽ nhảy thêm ~" + xong + " — đó là BACKFILL, KHÔNG phải bằng",
  );
  console.log(
    "     chứng cổng tự đóng chạy. Bằng chứng vẫn chỉ là các dòng `nguonChot = TU_DONG`",
  );
  console.log("     sinh SAU ngày merge.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await kiemDb.$disconnect();
    await db.$disconnect();
  });
