/**
 * scripts/seed-thu-hoc-ba-giao-vien.ts — SEED THỬ học bạ năng lực ĐI ĐÚNG ĐƯỜNG GIÁO VIÊN (26/09/2026).
 *
 *   DATABASE_URL=… DIRECT_URL=… pnpm exec tsx scripts/seed-thu-hoc-ba-giao-vien.ts            # DRY-RUN
 *   … --ghi                          ghi thật
 *     --lop=<classId,…>              chỉ các lớp này (mặc định: mọi lớp ĐANG HỌC có giáo viên)
 *     --moi-lop=<N>                  số học viên mỗi lớp (mặc định 4)
 *     --nguoi-duyet=<email>          người PHÁT HÀNH (mặc định uat.giamdoc@satarobo.vn) — phải có
 *                                    quyền `report-cards:review` tại cơ sở của lớp
 *     --thay-seed-cu                 xoá học bạ do bộ seed UAT CHÈN THẲNG BẢNG (id `uat-hocba-…`) của
 *                                    đúng học viên được chọn rồi lập lại qua đường thật
 *     --xoa-toan-bo-seed-cu          xoá MỌI học bạ `uat-hocba-…` (kể cả ngoài phạm vi)
 *
 * Chủ dự án 26/09: "học bạ cũng tương tự" — phải từ giáo viên nhập. Script gọi đúng hai hàm lõi mà
 * màn giáo viên / quản lý gọi (`lib/lms/report-card-ghi.ts`): giáo viên đứng lớp LƯU (chấm đủ tiêu
 * chí, nhận xét mốc buổi 5/12 mà lớp đã đạt, kết quả, tổng kết) rồi NỘP DUYỆT; người duyệt PHÁT
 * HÀNH (snapshot + DomainEvent `reportcard.published`). Quyền của từng người được hỏi bằng ĐÚNG cơ
 * chế `checkPermission` dùng (`decidePermissionWithGrant`) — không cấp tay.
 *
 * Mỗi lớp: 2 em đầu → ĐÃ PHÁT HÀNH, em thứ 3 → CHỜ DUYỆT, em thứ 4 → NHÁP (xem trạng thái nào
 * cũng có). Đường học bạ không gửi email; phát hành chỉ tạo thông báo trong cổng phụ huynh.
 *
 * Các em trong một lớp chạy SONG SONG (mỗi em một học bạ riêng) — xem scripts/_chay-gioi-han.ts.
 * CHẠY LẠI ĐƯỢC: bị cắt giữa "lưu" và "nộp/phát hành" thì lượt sau đi tiếp bước còn thiếu của học
 * bạ do CHÍNH script này lập (nhận ra theo câu tổng kết); học bạ giáo viên thật nhập thì không đụng.
 *
 * Chạy trên DB không-local phải có `SEED_THU_DB_TEST=1` (workflow "Seed dữ liệu TEST" đặt; nó đã
 * chặn secret TEST trùng PROD).
 */
import "./_cho-phep-server-only";
import { db } from "../lib/db";
import { laDbCucBo } from "../lib/security/url-db-cuc-bo";
import { rosterWhere } from "../lib/enrollment-scope";
import { chayGioiHan } from "./_chay-gioi-han";

const GHI = process.argv.includes("--ghi");
const THAY_SEED_CU = process.argv.includes("--thay-seed-cu");
const XOA_TOAN_BO_SEED_CU = process.argv.includes("--xoa-toan-bo-seed-cu");
const thamSo = (ten: string) => process.argv.find((a) => a.startsWith(`--${ten}=`))?.slice(ten.length + 3);
const LOP = (thamSo("lop") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MOI_LOP = Math.max(1, Number(thamSo("moi-lop") ?? 4) || 4);
const NGUOI_DUYET = thamSo("nguoi-duyet") ?? "uat.giamdoc@satarobo.vn";

function kiemDb(): string {
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

const NX_GIAI_DOAN = [
  "Con bắt nhịp lớp nhanh, lắp ráp chắc tay và đã tự viết được chương trình điều khiển đơn giản.",
  "Con tiến bộ rõ ở phần lập trình, chủ động hỏi khi gặp lỗi và biết cách thử lại.",
  "Con tập trung tốt, hợp tác với bạn cùng nhóm; cần luyện thêm phần căn chỉnh cảm biến.",
  "Con nắm chắc các khối lệnh cơ bản; buổi tới cần tự tin hơn khi trình bày sản phẩm.",
];
const NX_TONG_KET = [
  "Sau giai đoạn vừa qua, con nắm vững kiến thức cơ bản của khoá, lắp ráp và lập trình robot độc lập. Con có tinh thần học hỏi tốt, hay giúp đỡ bạn. Cô đề xuất con tiếp tục luyện tư duy thuật toán để chuẩn bị cho khoá nâng cao.",
  "Con có nhiều tiến bộ về kỹ năng lắp ráp và gỡ lỗi chương trình. Con cần mạnh dạn trình bày ý tưởng hơn trước lớp. Ba mẹ khuyến khích con kể lại các dự án đã làm để con tự tin hơn nhé.",
  "Con hoàn thành tốt các dự án của khoá, sản phẩm chạy ổn định. Điểm mạnh của con là sự kiên trì khi gặp lỗi. Giai đoạn tới con nên ôn lại vòng lặp và điều kiện để làm dự án phức tạp hơn.",
  "Con đi học đều, tiếp thu bài tốt và giữ gìn đồ dùng cẩn thận. Phần lập trình con làm chắc tay; con cần luyện thêm cách chia bài toán thành từng bước nhỏ.",
];
const bam = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

async function main() {
  const host = kiemDb();
  const [{ current_database: tenDb }] = await db.$queryRaw<{ current_database: string }[]>`select current_database()`;
  console.log(`Đích: ${host}/${tenDb}${GHI ? " — CHẾ ĐỘ GHI" : " — DRY-RUN (chưa ghi gì)"}`);

  // Nhập ĐỘNG sau shim server-only.
  const { luuHocBaCore, chuyenTrangThaiHocBaCore } = await import("../lib/lms/report-card-ghi");
  const { actorCapabilities, getCourseCriteria } = await import("../lib/lms/report-card");
  const { countCompletedClassSessions } = await import("../lib/lms/report-card-editor-data");
  const { ensureMilestonePeriods } = await import("../lib/lms/report-card-milestone");
  const { resolveActorUncached } = await import("../lib/auth/actor");
  const { decidePermissionWithGrant } = await import("../lib/auth/permission-decision");

  /** Người thao tác dựng từ quyền THẬT (cùng cơ chế checkPermission). */
  async function nguoiThaoTac(userId: string) {
    const u = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, roles: true },
    });
    const actor = await resolveActorUncached(u.id);
    const sessionUser = { role: u.role, roles: u.roles };
    const manage = decidePermissionWithGrant({ sessionUser, actor, action: "report-cards:manage" });
    const review = decidePermissionWithGrant({ sessionUser, actor, action: "report-cards:review" });
    return {
      userId: u.id,
      auditActor: { id: u.id, name: u.name ?? u.email ?? u.id },
      actor,
      capabilities: actorCapabilities({ manage, review }),
    };
  }

  const nguoiDuyet = await db.user.findUnique({ where: { email: NGUOI_DUYET }, select: { id: true } });
  if (!nguoiDuyet) throw new Error(`Không có người duyệt ${NGUOI_DUYET}`);
  const ctxDuyet = await nguoiThaoTac(nguoiDuyet.id);

  const tong = { lop: 0, luu: 0, nop: 0, phatHanh: 0, boQuaCo: 0, xoaSeedCu: 0, tuChoi: 0 };
  const loi = new Map<string, number>();
  const baoLoi = (e: string) => {
    tong.tuChoi++;
    loi.set(e, (loi.get(e) ?? 0) + 1);
  };

  const lopDs = await db.class.findMany({
    where: LOP.length ? { id: { in: LOP } } : { status: "ACTIVE", teacherId: { not: null } },
    select: { id: true, teacherId: true, courseId: true },
    orderBy: { name: "asc" },
  });
  const ctxGvCache = new Map<string, Awaited<ReturnType<typeof nguoiThaoTac>>>();
  const batDau = Date.now();

  for (const [thuTuLop, lop] of lopDs.entries()) {
    if (!lop.teacherId) continue;
    const criteria = await getCourseCriteria(lop.courseId);
    if (criteria.length === 0) continue;
    const ghiDanh = await db.enrollment.findMany({
      where: { classId: lop.id, ...rosterWhere("dang-hoc") },
      select: { id: true },
      orderBy: { enrolledAt: "asc" },
      take: MOI_LOP,
    });
    if (ghiDanh.length === 0) continue;
    // ReportCard trỏ PHẲNG bằng enrollmentId (không có quan hệ Prisma) ⇒ tra riêng.
    const hocBaCo = new Map(
      (
        await db.reportCard.findMany({
          where: { enrollmentId: { in: ghiDanh.map((g) => g.id) } },
          select: { id: true, enrollmentId: true, status: true, finalComment: true },
        })
      ).map((r) => [r.enrollmentId, r]),
    );
    tong.lop++;
    const daXong = await countCompletedClassSessions(lop.id);
    const ctxGv = ctxGvCache.get(lop.teacherId) ?? (await nguoiThaoTac(lop.teacherId));
    ctxGvCache.set(lop.teacherId, ctxGv);
    const truocLop = { ...tong };

    const viec: Array<() => Promise<void>> = [];
    for (const [i, g] of ghiDanh.entries()) {
      const dich = i < 2 ? "PUBLISHED" : i === 2 ? "PENDING_REVIEW" : "DRAFT";
      const coSan = hocBaCo.get(g.id);
      // Bắt đầu từ bước nào. Học bạ do CHÍNH script lập (câu tổng kết thuộc bộ mẫu) mà lượt trước bị
      // cắt giữa chừng thì đi tiếp bước còn thiếu; học bạ giáo viên thật nhập thì không đụng.
      const doScriptLap = NX_TONG_KET.includes(coSan?.finalComment ?? "");
      let tuBuoc: "luu" | "nop" | "phatHanh";
      let xoaId: string | null = null;
      if (!coSan) tuBuoc = "luu";
      else if (THAY_SEED_CU && coSan.id.startsWith("uat-hocba-")) {
        tuBuoc = "luu";
        xoaId = coSan.id;
        tong.xoaSeedCu++;
      } else if (doScriptLap && coSan.status === "DRAFT" && dich !== "DRAFT") tuBuoc = "nop";
      else if (doScriptLap && coSan.status === "PENDING_REVIEW" && dich === "PUBLISHED") tuBuoc = "phatHanh";
      else {
        tong.boQuaCo++;
        continue;
      }
      if (!GHI) {
        if (tuBuoc === "luu") tong.luu++;
        if (tuBuoc !== "phatHanh" && dich !== "DRAFT") tong.nop++;
        if (dich === "PUBLISHED") tong.phatHanh++;
        continue;
      }
      const h = bam(g.id);
      const periodComments = ensureMilestonePeriods(daXong, []).map((p, k) => ({
        period: p.period,
        comment: NX_GIAI_DOAN[(h + k) % NX_GIAI_DOAN.length]!,
      }));
      const scores = criteria.map((c, k) => ({ criterionId: c.id, level: 2 + ((h + k) % 3), note: "" }));

      // Mỗi em một học bạ riêng ⇒ các em trong lớp chạy song song; các bước của MỘT em vẫn tuần tự.
      viec.push(async () => {
        if (xoaId) await db.reportCard.delete({ where: { id: xoaId } });
        if (tuBuoc === "luu") {
          const luu = await luuHocBaCore(ctxGv, {
            enrollmentId: g.id,
            finalComment: NX_TONG_KET[h % NX_TONG_KET.length],
            completionStatus: h % 2 === 0 ? "Hoàn thành tốt" : "Đạt yêu cầu",
            periodComments,
            scores,
          });
          if (!luu.ok) return baoLoi(`lưu: ${luu.error}`);
          tong.luu++;
          if (dich === "DRAFT") return;
        }
        if (tuBuoc !== "phatHanh") {
          const nop = await chuyenTrangThaiHocBaCore(ctxGv, { enrollmentId: g.id, to: "PENDING_REVIEW" });
          if (!nop.ok) return baoLoi(`nộp: ${nop.error}`);
          tong.nop++;
          if (dich !== "PUBLISHED") return;
        }
        const ph = await chuyenTrangThaiHocBaCore(ctxDuyet, { enrollmentId: g.id, to: "PUBLISHED" });
        if (!ph.ok) return baoLoi(`phát hành: ${ph.error}`);
        tong.phatHanh++;
      });
    }
    await chayGioiHan(viec, MOI_LOP);
    console.log(
      `[${thuTuLop + 1}/${lopDs.length}] lưu ${tong.luu - truocLop.luu} · nộp ${tong.nop - truocLop.nop}` +
        ` · phát hành ${tong.phatHanh - truocLop.phatHanh} · bỏ qua ${tong.boQuaCo - truocLop.boQuaCo}` +
        (tong.tuChoi > truocLop.tuChoi ? ` · TỪ CHỐI ${tong.tuChoi - truocLop.tuChoi}` : "") +
        ` · ${Math.round((Date.now() - batDau) / 1000)} giây`,
    );
  }

  let xoaNgoai = 0;
  if (XOA_TOAN_BO_SEED_CU) {
    xoaNgoai = GHI
      ? (await db.reportCard.deleteMany({ where: { id: { startsWith: "uat-hocba-" } } })).count
      : await db.reportCard.count({ where: { id: { startsWith: "uat-hocba-" } } });
  }

  const dong = GHI ? "ĐÃ" : "SẼ";
  console.log(`Lớp xét: ${tong.lop} · ${MOI_LOP} em/lớp · người duyệt ${NGUOI_DUYET}`);
  console.log(`${dong} lưu (giáo viên): ${tong.luu} · nộp duyệt: ${tong.nop} · phát hành (người duyệt): ${tong.phatHanh}`);
  console.log(`Bỏ qua — đã có học bạ (giữ nguyên): ${tong.boQuaCo}`);
  console.log(`${dong} xoá học bạ seed chèn thẳng bảng trong phạm vi: ${tong.xoaSeedCu}`);
  if (XOA_TOAN_BO_SEED_CU) console.log(`${dong} xoá MỌI học bạ seed cũ (uat-hocba-…): ${xoaNgoai}`);
  if (tong.tuChoi > 0) {
    console.log(`Đường thật TỪ CHỐI: ${tong.tuChoi}`);
    for (const [e, n] of loi) console.log(`  ${n} × ${e}`);
  }
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e).slice(0, 1500));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
