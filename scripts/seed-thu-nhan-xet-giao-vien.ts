/**
 * scripts/seed-thu-nhan-xet-giao-vien.ts — SEED THỬ nhận xét buổi ĐI ĐÚNG ĐƯỜNG GIÁO VIÊN (26/09/2026).
 *
 *   DATABASE_URL=… DIRECT_URL=… pnpm exec tsx scripts/seed-thu-nhan-xet-giao-vien.ts            # DRY-RUN
 *   DATABASE_URL=… DIRECT_URL=… pnpm exec tsx scripts/seed-thu-nhan-xet-giao-vien.ts --ghi      # GHI
 *     --lop=<classId,…>   chỉ các lớp này (mặc định: mọi lớp ĐANG HỌC có giáo viên đứng lớp)
 *     --thay-seed-cu      xoá phiếu do bộ seed UAT CHÈN THẲNG BẢNG (id `uat-…`, không rubric/không
 *                         văn xuôi) trong phạm vi rồi để giáo viên nhập lại qua đường thật
 *     --viet-lai          xoá + nhập lại các phiếu do CHÍNH script này sinh ra (nhận ra theo câu mở
 *                         đầu) — dùng khi sửa bộ câu mẫu
 *     --xoa-toan-bo-seed-cu  xoá MỌI phiếu seed chèn thẳng bảng (kể cả ngoài phạm vi: lớp đã xong,
 *                         lớp không có giáo viên) — để màn chỉ còn phiếu giáo viên nhập
 *     --song-song=<N>     số em CÙNG MỘT BUỔI ghi song song (mặc định 5). Buổi vẫn đi tuần tự theo
 *                         ngày. Xem scripts/_chay-gioi-han.ts vì sao cần.
 *
 * CHẠY LẠI ĐƯỢC: bị cắt giữa chừng (job quá giờ) thì lượt sau bỏ qua phiếu đã ghi qua đường giáo
 * viên và làm tiếp phần còn lại — không sinh trùng.
 *
 * Chủ dự án 26/09: "nhận xét phải lấy từ giáo viên nhập". Bộ seed UAT cũ (03-hoc-vu.ts) chèn
 * thẳng `StudentSessionFeedback` — chỉ một câu + số sao, không rubric (hub của giáo viên coi là
 * CHƯA nhận xét), người tạo cố định, cả buổi em vắng có phép. Script này đi qua ĐÚNG hàm mà hộp
 * thoại "Nhận xét buổi học" của giáo viên gọi — `saveSessionEvalCore` — với người thao tác là
 * GIÁO VIÊN ĐỨNG LỚP (`giaoVienDuocQuyCong`), nên mọi luật của đường thật áp nguyên: cổng sở hữu
 * buổi, học viên phải thuộc danh sách buổi, phiếu phải có nội dung, trần độ dài…
 *
 * Luật mà CORE không kiểm nhưng MÀN giáo viên kiểm — script tự áp y hệt, để không sinh dữ liệu
 * giáo viên không thể tạo được: buổi không huỷ, đã diễn ra (≤ hết hôm nay giờ VN), buổi đã điểm
 * danh thì chỉ em CÓ MẶT / ĐI MUỘN. Tên dự án tính như hub (`deriveSessionProjectName`, số buổi
 * theo TOÀN BỘ buổi của lớp). Phiếu gửi theo ngày buổi TĂNG DẦN để buổi mới nhất nổi lên đầu hồ sơ.
 *
 * Email: gọi core với `guiEmailPhuHuynh: false` — KHÔNG xếp email NEW_FEEDBACK (hàng đợi email
 * không có trạng thái huỷ, và trên env `test` cron gửi thật mỗi 5 phút). Thông báo trong cổng phụ
 * huynh (DomainEvent `comment.added`) vẫn phát như giáo viên nhập thật.
 *
 * Chạy trên DB không-local phải có `SEED_THU_DB_TEST=1` (workflow "Seed dữ liệu TEST" đặt; nó đã
 * chặn secret TEST trùng PROD).
 */
import "./_cho-phep-server-only";
import { Prisma } from "@prisma/client";
import { db } from "../lib/db";
import { laDbCucBo } from "../lib/security/url-db-cuc-bo";
import { rosterWhere } from "../lib/enrollment-scope";
import { buildSessionNumberMap } from "../lib/lms/session-order";
import { deriveSessionProjectName } from "../lib/lms/session-project-name";
import { EVAL_CRITERIA } from "../lib/lms/session-eval-rubric";
import { FEEDBACK_ATTENDED_STATUSES } from "../lib/lms/session-feedback-roster";
import { vnEndOfDay } from "../lib/time/vn";
import { chayGioiHan } from "./_chay-gioi-han";

const GHI = process.argv.includes("--ghi");
const THAY_SEED_CU = process.argv.includes("--thay-seed-cu");
const XOA_TOAN_BO_SEED_CU = process.argv.includes("--xoa-toan-bo-seed-cu");
const VIET_LAI = process.argv.includes("--viet-lai");
const LOP = (process.argv.find((a) => a.startsWith("--lop="))?.slice(6) ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SONG_SONG = Math.max(1, Number(process.argv.find((a) => a.startsWith("--song-song="))?.slice(12) ?? 5) || 5);

// ─── Cổng DB: local, hoặc DB test khi workflow bật cờ ────────────────────────────────────
function kiemDbLocal(): string {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* rơi xuống dưới */
  }
  // 28/09/2026 — `laDbCucBo` từ chối cả tunnel VPS (127.0.0.1:<cổng tunnel PROD> PROD / :<cổng tunnel TEST> TEST): so host thì
  // tunnel thành "local". Ghi DB test qua tunnel có chủ đích ⇒ SEED_THU_DB_TEST=1 như workflow.
  const local = laDbCucBo(url);
  if (!local && process.env.SEED_THU_DB_TEST !== "1") {
    throw new Error(
      `DB đích "${host || "(không đọc được)"}" không phải local. Chạy trên DB test qua workflow ` +
        '"Seed dữ liệu TEST" (đặt SEED_THU_DB_TEST=1 và chặn secret trùng PROD).',
    );
  }
  return host;
}

// ─── Nội dung "giáo viên viết" — tất định theo (buổi, học viên) ─────────────────────────
function rngTu(chuoi: string) {
  let h = 2166136261;
  for (const c of chuoi) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bộ câu mẫu đủ rộng để CÙNG một em qua các buổi không lặp y hệt: chỉ số câu XOAY theo số
// buổi (cộng một độ lệch riêng của em), không bốc ngẫu nhiên từ mảng 2 phần tử như bản đầu.
const MO_DAU = [
  "Buổi này con làm dự án {duAn}.",
  "Hôm nay lớp thực hiện dự án {duAn}.",
  "Trong dự án {duAn} hôm nay,",
  "Ở dự án {duAn},",
  "Với dự án {duAn} buổi này,",
];
const KIEN_THUC_TOT = [
  "con nắm chắc kiến thức cũ và áp dụng được ngay vào bài mới",
  "con hiểu nhanh nguyên lý của bài và tự giải thích lại được cho bạn",
  "con nhớ đúng tên và công dụng của từng linh kiện",
  "con trả lời đúng các câu hỏi ôn bài đầu giờ",
  "con nối được kiến thức buổi trước với cách hoạt động của mô hình hôm nay",
  "con hiểu vì sao phải dùng cảm biến trong dự án này",
];
const KIEN_THUC_VUA = [
  "con hiểu được phần chính của bài, vài chỗ cần cô nhắc lại",
  "con còn nhầm ở bước kết nối cảm biến nhưng sửa được khi được gợi ý",
  "con cần ôn lại khái niệm vòng lặp trước khi sang bài sau",
  "con nắm được yêu cầu nhưng còn lúng túng khi chọn khối lệnh",
  "con làm theo hướng dẫn tốt, phần tự suy luận cần luyện thêm",
  "con nhớ được cách lắp nhưng chưa giải thích được vì sao robot chạy như vậy",
];
const KY_NANG_TOT = [
  "Con lắp ráp gọn gàng, lập trình chạy đúng ngay từ lần thử thứ hai.",
  "Con chủ động thử nhiều cách và tìm ra lỗi trong chương trình của mình.",
  "Mô hình của con chắc chắn, dây nối gọn và đúng cổng.",
  "Con hoàn thành sớm và tự làm thêm phần nâng cao.",
  "Con căn chỉnh động cơ chính xác, robot chạy thẳng và ổn định.",
  "Con biết chia chương trình thành từng bước nhỏ để kiểm tra.",
];
const KY_NANG_VUA = [
  "Phần lập trình con cần thêm thời gian, cô đã hướng dẫn chia nhỏ từng bước.",
  "Con lắp ráp chắc tay nhưng còn lúng túng khi căn chỉnh động cơ.",
  "Con hoàn thành mô hình nhưng chương trình còn một lỗi nhỏ ở phần rẽ.",
  "Con cần cẩn thận hơn khi đọc sơ đồ lắp ráp.",
  "Con làm xong phần chính, phần mở rộng chưa kịp thử.",
  "Robot của con chạy được nhưng chưa ổn định, cô đã chỉ cách kiểm tra lại cảm biến.",
];
const THAI_DO_TOT = [
  "Con tập trung suốt buổi và hào hứng chia sẻ sản phẩm với cả lớp.",
  "Con hợp tác tốt với bạn cùng nhóm, biết lắng nghe ý kiến của bạn.",
  "Con mạnh dạn phát biểu và giúp bạn bên cạnh khi bạn gặp lỗi.",
  "Con giữ gìn đồ dùng cẩn thận và dọn bàn gọn gàng sau buổi học.",
  "Con kiên trì thử lại nhiều lần mà không nản.",
];
const THAI_DO_VUA = [
  "Nửa sau buổi con hơi mất tập trung, cô đã nhắc và con quay lại làm bài.",
  "Con còn ngại phát biểu, cô sẽ khuyến khích con trình bày nhiều hơn.",
  "Con dễ nản khi chương trình chưa chạy, cô động viên con thử lại từng bước.",
  "Con cần chú ý nghe hướng dẫn trước khi bắt tay vào lắp.",
  "Con làm việc nhóm còn hơi rụt rè, cô sẽ ghép con với bạn năng nổ hơn.",
];
const DE_XUAT = [
  "Buổi sau con ôn lại cách dùng vòng lặp để làm nhanh hơn.",
  "Ba mẹ khuyến khích con kể lại cho gia đình cách robot hoạt động nhé.",
  "Con có thể thử nâng cấp sản phẩm bằng một cảm biến mới vào buổi sau.",
  "Cô đề xuất con luyện thêm phần căn chỉnh để sản phẩm chạy ổn định.",
  "Ở nhà con có thể vẽ lại sơ đồ hoạt động của robot để nhớ bài lâu hơn.",
  "Buổi tới con thử tự đặt thêm một nhiệm vụ cho robot của mình.",
];

function noiDungGiaoVien(sessionId: string, studentId: string, duAn: string, soBuoi: number) {
  const r = rngTu(`${sessionId}|${studentId}`);
  const lechEm = Math.floor(rngTu(`${studentId}|lech`)() * 97);
  const xoay = <T,>(xs: readonly T[], k: number): T => xs[(soBuoi + lechEm + k) % xs.length]!;
  // Mỗi em một "mặt bằng" riêng (tất định theo em), từng buổi dao động ±1.
  const nen = 2 + Math.floor(rngTu(studentId)() * 3); // 2..4
  const rubric: Record<string, number> = {};
  for (const c of EVAL_CRITERIA) {
    const lech = r() < 0.25 ? -1 : r() > 0.75 ? 1 : 0;
    rubric[c.id] = Math.max(1, Math.min(5, nen + lech));
  }
  const tb = Object.values(rubric).reduce((a, b) => a + b, 0) / EVAL_CRITERIA.length;
  const tot = tb >= 3.2;
  const overall = [
    xoay(MO_DAU, 0).replace("{duAn}", duAn),
    `${xoay(tot ? KIEN_THUC_TOT : KIEN_THUC_VUA, 1)}.`,
    xoay(tot ? KY_NANG_TOT : KY_NANG_VUA, 2),
    xoay(tot ? THAI_DO_TOT : THAI_DO_VUA, 3),
    xoay(DE_XUAT, 4),
  ]
    .join(" ")
    // Sau dấu chấm thì viết hoa chữ đầu câu kế tiếp ("…hôm nay. Con hiểu…").
    .replace(/([.!?])\s+(\p{Ll})/gu, (_m, dau: string, chu: string) => `${dau} ${chu.toUpperCase()}`);
  return { rubric, overall };
}

// ─── Chạy ───────────────────────────────────────────────────────────────────────────────
async function main() {
  const host = kiemDbLocal();
  const [{ current_database: tenDb }] = await db.$queryRaw<{ current_database: string }[]>`select current_database()`;
  console.log(`Đích: ${host}/${tenDb}${GHI ? " — CHẾ ĐỘ GHI" : " — DRY-RUN (chưa ghi gì)"}`);

  // Core cần `server-only` ⇒ nhập ĐỘNG sau shim (xem scripts/_cho-phep-server-only.ts).
  const { saveSessionEvalCore } = await import("../app/(admin)/admin/sessions/[id]/_feedback-core");
  const { giaoVienDuocQuyCong } = await import("../lib/lms/session-ownership");

  const lopDs = await db.class.findMany({
    where: LOP.length ? { id: { in: LOP } } : { status: "ACTIVE", teacherId: { not: null } },
    select: { id: true, name: true, teacherId: true, centerId: true },
    orderBy: { name: "asc" },
  });
  const hetHomNay = vnEndOfDay(new Date());
  const DI_HOC = new Set<string>(FEEDBACK_ATTENDED_STATUSES);

  const tong = { lop: 0, buoi: 0, ghi: 0, boQuaCo: 0, xoaSeedCu: 0, tuChoi: 0, khongGv: 0, chuaDiemDanh: 0 };
  const loi = new Map<string, number>();
  type GiaoVien = { id: string; role: string; roles: string[]; centerId: string | null };
  const gvCache = new Map<string, GiaoVien | null>();
  const batDau = Date.now();

  for (const [thuTuLop, lop] of lopDs.entries()) {
    const truocLop = { ghi: tong.ghi, boQuaCo: tong.boQuaCo, tuChoi: tong.tuChoi };
    const [tatCaBuoi, buoiDs, roster] = await Promise.all([
      db.classSession.findMany({ where: { classId: lop.id }, select: { id: true, date: true, classId: true } }),
      db.classSession.findMany({
        where: { classId: lop.id, status: { not: "CANCELLED" }, date: { lte: hetHomNay } },
        select: {
          id: true,
          date: true,
          topic: true,
          actualTeacherId: true,
          substituteTeacherId: true,
          plan: { select: { customTitle: true, order: true } },
          lesson: { select: { order: true, title: true, moduleCode: true } },
        },
        orderBy: { date: "asc" },
      }),
      db.enrollment.findMany({ where: { classId: lop.id, ...rosterWhere("dang-hoc") }, select: { studentId: true } }),
    ]);
    if (buoiDs.length === 0 || roster.length === 0) continue;
    tong.lop++;
    const soBuoi = buildSessionNumberMap(tatCaBuoi);
    const hocVien = [...new Set(roster.map((r) => r.studentId))];

    for (const b of buoiDs) {
      const gvId = giaoVienDuocQuyCong({ ...b, class: { teacherId: lop.teacherId } });
      if (!gvId) {
        tong.khongGv++;
        continue;
      }
      if (!gvCache.has(gvId)) {
        gvCache.set(
          gvId,
          await db.user.findUnique({ where: { id: gvId }, select: { id: true, role: true, roles: true, centerId: true } }),
        );
      }
      const gv = gvCache.get(gvId);
      if (!gv || !(gv.role === "TEACHER" || gv.roles.includes("TEACHER"))) {
        tong.khongGv++;
        continue;
      }
      const [diemDanh, phieuCo] = await Promise.all([
        db.attendance.findMany({ where: { sessionId: b.id }, select: { studentId: true, status: true } }),
        db.studentSessionFeedback.findMany({
          where: { classSessionId: b.id },
          select: { id: true, studentId: true, rubric: true, notes: true, comment: true, createdById: true },
        }),
      ]);
      const daDiemDanh = diemDanh.length > 0;
      // Màn giáo viên CHO nhận xét buổi chưa điểm danh (mở cả danh sách), nhưng giáo viên thật
      // nhận xét SAU khi điểm danh — seed thử chỉ lấy buổi đã điểm danh cho sát thực tế.
      if (!daDiemDanh) {
        tong.chuaDiemDanh++;
        continue;
      }
      const ttTheoHv = new Map(diemDanh.map((a) => [a.studentId, a.status as string]));
      const phieuTheoHv = new Map(phieuCo.map((p) => [p.studentId, p]));
      const duAn = deriveSessionProjectName({
        sessionNumber: soBuoi.get(b.id) ?? null,
        planTitle: b.plan?.customTitle,
        planOrder: b.plan?.order,
        lessonTitle: b.lesson?.title,
        lessonOrder: b.lesson?.order,
        moduleCode: b.lesson?.moduleCode,
        topic: b.topic,
      });
      tong.buoi++;

      // Các em của CÙNG một buổi độc lập nhau (mỗi em một dòng phiếu, một event riêng) ⇒ ghi song
      // song. Buổi thì vẫn tuần tự theo ngày, để phiếu buổi mới nhất vẫn là phiếu tạo sau cùng.
      const viec: Array<() => Promise<void>> = [];
      for (const hv of hocVien) {
        if (daDiemDanh && !DI_HOC.has(ttTheoHv.get(hv) ?? "ABSENT")) continue;
        const co = phieuTheoHv.get(hv);
        if (co) {
          const laSeedCu = co.id.startsWith("uat-") && co.rubric === null && co.notes === null;
          const laSeedThu =
            co.createdById === gv.id &&
            MO_DAU.some((p) => (co.comment ?? "").startsWith(p.split("{duAn}")[0]!));
          if (!((THAY_SEED_CU && laSeedCu) || (VIET_LAI && laSeedThu))) {
            tong.boQuaCo++;
            continue;
          }
          tong.xoaSeedCu++;
        }
        const { rubric, overall } = noiDungGiaoVien(b.id, hv, duAn, soBuoi.get(b.id) ?? 0);
        if (!GHI) {
          tong.ghi++;
          continue;
        }
        viec.push(async () => {
          if (co) await db.studentSessionFeedback.delete({ where: { id: co.id } });
          const kq = await saveSessionEvalCore(
            { id: gv.id, role: "TEACHER", centerId: gv.centerId },
            { sessionId: b.id, studentId: hv, projectName: duAn, notes: { overall }, rubric },
            { guiEmailPhuHuynh: false },
          );
          if (kq.ok) tong.ghi++;
          else {
            tong.tuChoi++;
            loi.set(kq.error, (loi.get(kq.error) ?? 0) + 1);
          }
        });
      }
      await chayGioiHan(viec, SONG_SONG);
    }
    // Tiến độ theo lớp — job bị cắt giữa chừng thì log vẫn cho biết đã tới đâu.
    console.log(
      `[${thuTuLop + 1}/${lopDs.length}] ${lop.name}: ${GHI ? "ghi" : "sẽ ghi"} ${tong.ghi - truocLop.ghi}` +
        ` · bỏ qua ${tong.boQuaCo - truocLop.boQuaCo}` +
        (tong.tuChoi > truocLop.tuChoi ? ` · TỪ CHỐI ${tong.tuChoi - truocLop.tuChoi}` : "") +
        ` · ${Math.round((Date.now() - batDau) / 1000)} giây`,
    );
  }

  let xoaNgoai = 0;
  if (XOA_TOAN_BO_SEED_CU) {
    const dieuKien = { id: { startsWith: "uat-" }, rubric: { equals: Prisma.DbNull }, notes: { equals: Prisma.DbNull } };
    xoaNgoai = GHI
      ? (await db.studentSessionFeedback.deleteMany({ where: dieuKien })).count
      : await db.studentSessionFeedback.count({ where: dieuKien });
  }

  console.log(`Lớp xét: ${tong.lop} · buổi xét: ${tong.buoi}`);
  console.log(`${GHI ? "ĐÃ GHI qua đường giáo viên" : "SẼ GHI qua đường giáo viên"}: ${tong.ghi} phiếu`);
  console.log(`Bỏ qua — đã có phiếu (giữ nguyên): ${tong.boQuaCo}`);
  console.log(`${GHI ? "Đã xoá" : "Sẽ xoá"} phiếu để nhập lại (--thay-seed-cu / --viet-lai): ${tong.xoaSeedCu}`);
  console.log(`Buổi không có giáo viên đứng lớp (bỏ qua): ${tong.khongGv}`);
  console.log(`Buổi đã qua nhưng CHƯA điểm danh (bỏ qua): ${tong.chuaDiemDanh}`);
  if (XOA_TOAN_BO_SEED_CU) console.log(`${GHI ? "Đã" : "Sẽ"} xoá MỌI phiếu seed cũ còn lại: ${xoaNgoai}`);
  if (tong.tuChoi > 0) {
    console.log(`Đường giáo viên TỪ CHỐI: ${tong.tuChoi}`);
    for (const [e, n] of loi) console.log(`  ${n} × ${e}`);
  }
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e).slice(0, 1500));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
