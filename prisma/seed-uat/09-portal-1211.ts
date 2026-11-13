// prisma/seed-uat/09-portal-1211.ts — DỮ LIỆU NGHIỆM THU cho gói 10 hạng mục cổng phụ huynh / giáo viên / admin (12/11/2026).
//
// Vì sao có tệp này: chủ dự án vào test nghiệm thu mà «chả thấy data gì» — các tính năng mới cần dữ liệu ĐÚNG HÌNH DẠNG
// (ảnh đã duyệt nhiều buổi, ảnh chờ duyệt, lượt bù, bài tập yêu cầu video, đơn trước/sau mốc 01/11, khuyến mãi đang chạy…) mà bộ seed UAT cũ
// không dựng. Tài khoản được nuôi: uat.phuhuynh · uat.phuhuynh1 · uat.giaovien · uat.admin.
//
// BA LUẬT (cùng `_common.ts`): CHỈ THÊM, không xoá, không đặt lại mật khẩu · id cố định `uat-p11-*` ⇒ chạy lại không đẻ thêm dòng ·
// KHÔNG đụng dữ liệu người thật gõ tay. Mỗi MỤC chạy độc lập trong try/catch: một mục lỗi không làm mất các mục khác, nhưng tiến trình
// thoát mã 1 để workflow ĐỎ (lỗi thật, không im lặng). Dry-run (mặc định) chỉ ĐỌC và in hiện trạng từng tài khoản.
//
// Khác bộ cũ ở MỘT điểm: ngày lấy theo ĐỒNG HỒ THẬT (hôm nay), không theo MOC — buổi học «sắp tới», khuyến mãi «đang chạy», đơn «sau 01/11»
// phải đúng so với ngày nghiệm thu. Dòng đã có KHÔNG bị cập nhật ngày (trừ khuyến mãi — làm tươi để còn hiệu lực).
import { db, buoc, xong, uid } from "./_common";

const GHI_DANH_DANG_HOC = ["ACTIVE", "STUDYING", "CONFIRMED"] as const;
const EMAIL = (local: string) => `${local}@satarobo.vn`;
const MP4_MAU = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

type Ctx = {
  ghi: boolean;
  giaovien: { id: string; name: string | null; employeeId: string | null };
  ketoan: { id: string } | null;
  admin: { id: string };
  ph: { local: string; id: string; name: string | null }[];
  /** Học viên của hai phụ huynh + ghi danh đang học (lớp đầu tiên). */
  con: ConCuaPh[];
  loi: string[];
};

type ConCuaPh = {
  phLocal: string;
  id: string;
  name: string;
  centerId: string | null;
  enrollmentId: string | null;
  classId: string | null;
  courseId: string | null;
  tuition: number;
};

const ngayDen = (d: number) => new Date(Date.now() + d * 86_400_000);

async function muc(ctx: Ctx, ten: string, viec: () => Promise<void>): Promise<void> {
  buoc(ten);
  try {
    await viec();
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n").slice(-3).join(" ").slice(0, 400) : String(e);
    console.error(`     ✗ MỤC LỖI «${ten}»: ${msg}`);
    ctx.loi.push(`${ten}: ${msg}`);
  }
}

async function docNgucNguon(opts: { ghi: boolean }): Promise<Ctx> {
  const giaovien = await db.user.findUnique({ where: { email: EMAIL("uat.giaovien") }, select: { id: true, name: true, employeeId: true } });
  const admin = await db.user.findUnique({ where: { email: EMAIL("uat.admin") }, select: { id: true } });
  if (!giaovien || !admin) throw new Error("Thiếu tài khoản uat.giaovien / uat.admin — chạy `tai-khoan-thieu-ghi` trước.");
  const ketoan = await db.user.findUnique({ where: { email: EMAIL("uat.ketoan") }, select: { id: true } });
  const ph: Ctx["ph"] = [];
  for (const local of ["uat.phuhuynh", "uat.phuhuynh1"]) {
    const u = await db.user.findUnique({ where: { email: EMAIL(local) }, select: { id: true, name: true } });
    if (u) ph.push({ local, id: u.id, name: u.name });
    else console.log(`  ⚠ chưa có tài khoản ${local}@satarobo.vn — các mục của tài khoản này bị bỏ qua (tạo bằng noi_hoc_vien_lead=tai-khoan-thieu-ghi).`);
  }
  return { ghi: opts.ghi, giaovien, ketoan, admin, ph, con: [], loi: [] };
}

/** Gán thêm học viên UAT cho uat.phuhuynh1 nếu tài khoản chưa có con nào (dùng học viên UAT chưa có phụ huynh: đã có sẵn lớp/buổi/điểm danh). */
async function bamConChoPhuHuynh1(ctx: Ctx): Promise<void> {
  const p1 = ctx.ph.find((p) => p.local === "uat.phuhuynh1");
  if (!p1) return;
  const da = await db.student.count({ where: { parentUserId: p1.id, deletedAt: null } });
  if (da > 0) {
    console.log(`     · uat.phuhuynh1 đã có ${da} con — giữ nguyên.`);
    return;
  }
  const ungVien = await db.student.findMany({
    where: {
      id: { startsWith: "uat-hv-" },
      parentUserId: null,
      deletedAt: null,
      enrollments: { some: { status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null } },
    },
    orderBy: { id: "asc" },
    select: { id: true, name: true, centerId: true },
    take: 60,
  });
  // Một bé mỗi cơ sở (nếu có) để thấy cả hai phạm vi khuyến mãi; tối đa 2 bé.
  const chon: typeof ungVien = [];
  const coSoDa = new Set<string | null>();
  for (const s of ungVien) {
    if (coSoDa.has(s.centerId)) continue;
    coSoDa.add(s.centerId);
    chon.push(s);
    if (chon.length === 2) break;
  }
  if (chon.length === 0) {
    console.log("     ⚠ không còn học viên UAT trống phụ huynh để gán cho uat.phuhuynh1.");
    return;
  }
  console.log(`     · gán cho uat.phuhuynh1: ${chon.map((s) => `${s.name} (${s.id})`).join(", ")}`);
  if (!ctx.ghi) return;
  for (const s of chon) {
    await db.student.update({ where: { id: s.id }, data: { parentUserId: p1.id } });
  }
}

async function docCon(ctx: Ctx): Promise<void> {
  ctx.con = [];
  for (const p of ctx.ph) {
    const hs = await db.student.findMany({
      where: { parentUserId: p.id, deletedAt: null },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        centerId: true,
        enrollments: {
          where: { status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null },
          orderBy: { enrolledAt: "desc" },
          take: 1,
          select: { id: true, classId: true, courseId: true, finalPrice: true, tuition: true },
        },
      },
    });
    for (const s of hs) {
      const e = s.enrollments[0];
      ctx.con.push({
        phLocal: p.local,
        id: s.id,
        name: s.name,
        centerId: s.centerId,
        enrollmentId: e?.id ?? null,
        classId: e?.classId ?? null,
        courseId: e?.courseId ?? null,
        tuition: e?.finalPrice ?? e?.tuition ?? 4_400_000,
      });
    }
  }
}

function inHienTrang(ctx: Ctx): void {
  console.log("\n  HIỆN TRẠNG (đọc từ DB):");
  for (const p of ctx.ph) {
    const con = ctx.con.filter((c) => c.phLocal === p.local);
    console.log(`   · ${p.local}: ${con.length} con${con.length ? " — " + con.map((c) => `${c.name}${c.classId ? "" : " (CHƯA có lớp đang học)"}`).join("; ") : ""}`);
  }
}

// ─── Mục 1: đồng ý hình ảnh ──────────────────────────────────────────────────
async function mucDongY(ctx: Ctx) {
  let n = 0;
  // Con ĐẦU của mỗi phụ huynh có đồng ý; bé THỨ HAI của uat.phuhuynh1 CỐ Ý không có (đối chứng: bé chưa đồng ý ⇒ không thấy ảnh).
  const doiChung = ctx.con.filter((c) => c.phLocal === "uat.phuhuynh1").slice(1);
  const khongDongY = new Set(doiChung.map((c) => c.id));
  for (const c of ctx.con) {
    if (khongDongY.has(c.id)) {
      console.log(`     · ${c.name}: để CHƯA đồng ý hình ảnh (đối chứng).`);
      continue;
    }
    const co = await db.studentConsent.findUnique({ where: { studentId_type: { studentId: c.id, type: "CLASS_MEDIA" } }, select: { status: true } });
    if (co) continue; // đã có (kể cả đã thu hồi) — không đè ý người dùng
    if (ctx.ghi) await db.studentConsent.create({ data: { studentId: c.id, type: "CLASS_MEDIA", status: "GRANTED" } });
    n++;
  }
  xong("Đồng ý hình ảnh", n);
}

// ─── Mục 2: ảnh ĐÃ DUYỆT nhiều buổi (slideshow, «không lặp buổi mới nhất») ────
async function mucAnhDaDuyet(ctx: Ctx) {
  const lop = [...new Set(ctx.con.map((c) => c.classId).filter((x): x is string => !!x))];
  let nAnh = 0;
  let nBuoi = 0;
  for (const classId of lop) {
    const cls = await db.class.findUnique({ where: { id: classId }, select: { id: true, centerId: true } });
    if (!cls?.centerId) continue;
    const buoi = await db.classSession.findMany({
      where: { classId, date: { lt: new Date() }, status: { not: "CANCELLED" } },
      orderBy: { date: "desc" },
      take: 4,
      select: { id: true, date: true },
    });
    for (const b of buoi) {
      nBuoi++;
      // Buổi MỚI NHẤT có 6 ảnh (slideshow nhiều ảnh), các buổi trước 3–4 ảnh.
      const soAnh = b === buoi[0] ? 6 : 3 + (buoi.indexOf(b) % 2);
      for (let k = 0; k < soAnh; k++) {
        const id = uid("p11", "anh", b.id.slice(-10), k);
        const url = `https://picsum.photos/seed/p11${b.id.slice(-6)}${k}/960/720`;
        if (await db.classSessionMedia.findUnique({ where: { id }, select: { id: true } })) continue;
        if (ctx.ghi) {
          await db.classSessionMedia.create({
            data: {
              id,
              classId,
              classSessionId: b.id,
              fileUrl: url,
              fileName: `p11-${k + 1}.jpg`,
              caption: ["Con lắp khung robot theo bản vẽ", "Thử cho bánh răng ăn khớp", "Cả nhóm cùng kiểm tra mô hình", "Robot chạy được ở lần thử thứ hai", "Sản phẩm hoàn chỉnh của con", "Con giới thiệu sản phẩm với bạn"][k % 6]!,
              status: "APPROVED",
              isClassWide: true,
              takenAt: b.date,
              uploadedById: ctx.giaovien.id,
              uploadedByName: ctx.giaovien.name ?? "UAT — Giáo viên",
              approvedById: ctx.admin.id,
              approvedByName: "UAT — Quản trị hệ thống",
              approvedAt: new Date(),
            },
          });
          // Bản «kho + duyệt» song sinh để màn /admin/duyet-media thấy ở tab «Đã gửi PH».
          await db.mediaAsset.create({
            data: {
              centerId: cls.centerId,
              classId,
              classSessionId: b.id,
              sessionDate: b.date,
              uploadedById: ctx.giaovien.id,
              uploadedByName: ctx.giaovien.name ?? "UAT — Giáo viên",
              legacyMediaId: id,
              type: "IMAGE",
              r2Key: url,
              status: "APPROVED",
              reviewedById: ctx.admin.id,
              reviewedByName: "UAT — Quản trị hệ thống",
              reviewedAt: new Date(),
            },
          });
        }
        nAnh++;
      }
    }
  }
  xong("Ảnh đã duyệt (cả buổi, gửi PH)", { buổi: nBuoi, ảnh_mới: nAnh });
}

// ─── Mục 3: ảnh CHỜ DUYỆT (giáo viên đã đăng, QLCS/admin duyệt) ───────────────
async function mucAnhChoDuyet(ctx: Ctx) {
  const lop = [...new Set(ctx.con.map((c) => c.classId).filter((x): x is string => !!x))].slice(0, 2);
  let n = 0;
  for (const classId of lop) {
    const cls = await db.class.findUnique({ where: { id: classId }, select: { id: true, centerId: true } });
    if (!cls?.centerId) continue;
    const b = await db.classSession.findFirst({
      where: { classId, date: { lt: new Date() }, status: { not: "CANCELLED" } },
      orderBy: { date: "desc" },
      skip: 4, // buổi KHÔNG trùng 4 buổi đã có ảnh duyệt ở mục trên — để hàng chờ duyệt rõ ràng
      select: { id: true, date: true },
    });
    if (!b) continue;
    for (let k = 0; k < 4; k++) {
      const id = uid("p11", "cho", b.id.slice(-10), k);
      if (await db.classSessionMedia.findUnique({ where: { id }, select: { id: true } })) continue;
      const url = `https://picsum.photos/seed/p11cho${b.id.slice(-6)}${k}/960/720`;
      if (ctx.ghi) {
        await db.classSessionMedia.create({
          data: {
            id,
            classId,
            classSessionId: b.id,
            fileUrl: url,
            fileName: `cho-duyet-${k + 1}.jpg`,
            caption: null,
            status: "PENDING",
            isClassWide: false,
            takenAt: b.date,
            uploadedById: ctx.giaovien.id,
            uploadedByName: ctx.giaovien.name ?? "UAT — Giáo viên",
          },
        });
        await db.mediaAsset.create({
          data: {
            centerId: cls.centerId,
            classId,
            classSessionId: b.id,
            sessionDate: b.date,
            uploadedById: ctx.giaovien.id,
            uploadedByName: ctx.giaovien.name ?? "UAT — Giáo viên",
            legacyMediaId: id,
            type: "IMAGE",
            r2Key: url,
            status: "PENDING",
          },
        });
      }
      n++;
    }
    const coReview = await db.sessionMediaReview.findUnique({ where: { classSessionId: b.id }, select: { id: true } });
    if (!coReview && ctx.ghi) {
      await db.sessionMediaReview.create({
        data: { classSessionId: b.id, centerId: cls.centerId, sessionDate: b.date, status: "OPEN", deadlineAt: ngayDen(2) },
      });
    }
  }
  xong("Ảnh chờ duyệt (GV đăng cả buổi)", n);
}

// ─── Mục 4: lượt bù + buổi cần bù ────────────────────────────────────────────
async function mucHocBu(ctx: Ctx) {
  let nTk = 0;
  let nCan = 0;
  for (const c of ctx.con) {
    if (!c.classId || !c.courseId) continue;
    // Sổ lượt: chưa có thì cấp 2 lượt (đúng nghĩa «còn 2/2 lượt») — thiếu sổ là lý do màn hình KHÔNG hiện «còn bao nhiêu lượt bù».
    const tk = await db.makeupCreditAccount.findUnique({ where: { studentId_courseId: { studentId: c.id, courseId: c.courseId } }, select: { id: true } });
    if (!tk) {
      if (ctx.ghi) {
        await db.makeupCreditAccount.create({
          data: {
            studentId: c.id,
            courseId: c.courseId,
            granted: 2,
            held: 0,
            consumed: 0,
            entries: { create: { type: "GRANT", grantedDelta: 2, reason: "UAT 12/11: cấp lượt để nghiệm thu màn Học bù", idemKey: "uat-p11-khoi-tao" } },
          },
        });
      }
      nTk++;
    }
    // Buổi cần bù: đảm bảo ≥ 2 dòng ĐANG CHỜ (PENDING, chưa miễn) của con.
    const dangCho = await db.makeupNeed.count({ where: { studentId: c.id, status: "PENDING", waivedAt: null } });
    for (let k = dangCho; k < 2; k++) {
      const da = await db.makeupNeed.findMany({ where: { studentId: c.id }, select: { missedSessionId: true } });
      const buoi = await db.classSession.findFirst({
        where: { classId: c.classId, date: { lt: new Date() }, status: { not: "CANCELLED" }, id: { notIn: da.map((x) => x.missedSessionId) } },
        orderBy: { date: "desc" },
        select: { id: true, lessonId: true },
      });
      if (!buoi) break;
      if (ctx.ghi) {
        const dd = await db.attendance.findFirst({ where: { sessionId: buoi.id, studentId: c.id }, select: { id: true } });
        const ddId = dd?.id ?? uid("p11", "dd", c.id.slice(-8), buoi.id.slice(-8));
        if (!dd) {
          await db.attendance.create({
            data: { id: ddId, sessionId: buoi.id, studentId: c.id, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm (UAT)", centerId: c.centerId, notifiedAt: new Date() },
          });
        } else {
          await db.attendance.update({ where: { id: dd.id }, data: { status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" } });
        }
        await db.makeupNeed.create({
          data: {
            id: uid("p11", "bu", c.id.slice(-8), buoi.id.slice(-8)),
            studentId: c.id,
            classId: c.classId,
            courseId: c.courseId,
            centerId: c.centerId,
            missedSessionId: buoi.id,
            missedLessonId: buoi.lessonId,
            sourceType: "ABSENCE",
            status: "PENDING",
            note: "UAT 12/11: buổi vắng có phép đang chờ xếp bù",
            originalAttendanceId: ddId,
          },
        });
      }
      nCan++;
    }
  }
  xong("Học bù", { sổ_lượt_mới: nTk, buổi_cần_bù_mới: nCan });
}

// ─── Mục 5: bài tập YÊU CẦU VIDEO ────────────────────────────────────────────
async function mucBaiTapVideo(ctx: Ctx) {
  if (!ctx.giaovien.employeeId) throw new Error("uat.giaovien chưa có hồ sơ nhân sự (employeeId) — không tạo được bài tập.");
  const lop = [...new Set(ctx.con.map((c) => c.classId).filter((x): x is string => !!x))];
  let n = 0;
  let nNop = 0;
  for (const classId of lop) {
    const id = uid("p11", "bt-video", classId.slice(-12));
    let bt = await db.assignment.findUnique({ where: { id }, select: { id: true } });
    if (!bt) {
      if (ctx.ghi) {
        bt = await db.assignment.create({
          data: {
            id,
            title: "Quay video giới thiệu robot của em",
            description: MO_TA_BAI_VIDEO,
            instructions: "Quay ngang, đủ sáng. Video lớn sẽ được tự nén trước khi gửi.",
            kind: "HOMEWORK",
            classId,
            allowText: true,
            allowFile: true,
            requireVideo: true,
            totalPoints: 10,
            status: "PUBLISHED",
            assignedAt: new Date(),
            dueAt: ngayDen(6),
            createdById: ctx.giaovien.employeeId,
          },
          select: { id: true },
        });
      }
      n++;
    }
    // "Nộp video" là MỘT LOẠI CÂU HỎI (12/11/2026): bài mẫu mang đúng một câu VIDEO; bài đã nạp từ lần trước được vá mô tả + thêm câu (không đụng gì khác).
    if (bt && ctx.ghi) {
      await db.assignment.update({ where: { id: bt.id }, data: { description: MO_TA_BAI_VIDEO } });
      const coCau = await db.question.findFirst({ where: { assignmentId: bt.id, type: "VIDEO" }, select: { id: true } });
      if (!coCau) {
        await db.question.create({
          data: {
            id: uid("p11", "cau-video", classId.slice(-12)),
            type: "VIDEO",
            text: "Quay video giới thiệu robot của em: robot làm được gì và em đã sửa lỗi nào?",
            isPublic: false,
            assignmentId: bt.id,
          },
        });
      }
    }
    // Một bài nộp MẪU có video (để giáo viên mở màn chấm là xem được video ngay): chỉ cho bé đầu tiên của lớp.
    const be = ctx.con.find((c) => c.classId === classId);
    if (be && bt) {
      const coNop = await db.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: bt.id, studentId: be.id } }, select: { id: true } });
      if (!coNop && ctx.ghi) {
        await db.assignmentSubmission.create({
          data: {
            assignmentId: bt.id,
            studentId: be.id,
            textAnswer: "Em quay robot đang chạy và giải thích cách đổi bánh răng ạ.",
            status: "SUBMITTED",
            submittedAt: new Date(),
            fileUrl: MP4_MAU,
            fileName: "robot-cua-em.mp4",
            mimeType: "video/mp4",
            files: { create: { fileUrl: MP4_MAU, fileName: "robot-cua-em.mp4", mimeType: "video/mp4", fileSize: 1_200_000 } },
          },
        });
        nNop++;
      } else if (!coNop) nNop++;
    }
  }
  xong("Bài tập yêu cầu video", { bài_giao: n, bài_nộp_mẫu: nNop });
}

const MO_TA_BAI_VIDEO = "Em quay một video nói robot của em làm được gì và em đã sửa lỗi nào. Video dài bao lâu cũng được.";

// ─── Mục 6: đơn hàng — phiếu thu (đơn cũ) / hoá đơn (đơn mới có yêu cầu) ─────
async function mucDonHang(ctx: Ctx) {
  const MOC = new Date("2026-11-01T00:00:00+07:00");
  let nDon = 0;
  for (const c of ctx.con.slice(0, 4)) {
    if (!c.enrollmentId || !c.centerId) continue;
    const coSo = await db.center.findUnique({ where: { id: c.centerId }, select: { code: true } });
    const ma = coSo?.code ?? "CS1";
    const ph = ctx.ph.find((p) => p.local === c.phLocal);
    const mau: { khoa: string; ngay: Date; hoaDon: boolean; ghiChu: string }[] = [
      { khoa: "cu", ngay: new Date("2026-10-05T03:00:00Z"), hoaDon: false, ghiChu: "Đơn CŨ (trước 01/11) ⇒ PH thấy PHIẾU THU" },
      { khoa: "moi-hd", ngay: new Date("2026-11-05T03:00:00Z"), hoaDon: true, ghiChu: "Đơn MỚI có yêu cầu hoá đơn ⇒ PH thấy HOÁ ĐƠN" },
      { khoa: "moi-pt", ngay: new Date("2026-11-08T03:00:00Z"), hoaDon: false, ghiChu: "Đơn MỚI không yêu cầu hoá đơn ⇒ PH thấy PHIẾU THU" },
    ];
    // Chỉ dựng đủ 3 kiểu đơn cho bé ĐẦU CÓ GHI DANH ĐANG HỌC của mỗi phụ huynh; bé sau chỉ một đơn cũ.
    const laBeDau = ctx.con.find((x) => x.phLocal === c.phLocal && x.enrollmentId && x.centerId) === c;
    for (const m of laBeDau ? mau : mau.slice(0, 1)) {
      const oid = uid("p11", "don", m.khoa, c.id.slice(-8));
      if (await db.order.findUnique({ where: { id: oid }, select: { id: true } })) continue;
      const gia = Math.max(1_000_000, Math.round(c.tuition / 1000) * 1000);
      if (ctx.ghi) {
        await db.order.create({
          data: {
            id: oid,
            code: `ORD-P11-${m.khoa.toUpperCase()}-${c.id.slice(-6).toUpperCase()}`,
            type: "COURSE",
            status: "COMPLETED",
            customerName: ph?.name ?? "UAT — Phụ huynh",
            customerPhone: "0900000011",
            studentId: c.id,
            centerId: c.centerId,
            subtotal: gia,
            totalAmount: gia,
            paidAt: m.ngay,
            confirmedAt: m.ngay,
            confirmedByUserId: ctx.ketoan?.id ?? null,
            internalNote: `UAT 12/11 — ${m.ghiChu}`,
            createdAt: m.ngay,
            ...(m.hoaDon
              ? { invoiceBuyerName: ph?.name ?? "UAT — Phụ huynh", invoiceEmail: "uat.phuhuynh@satarobo.vn", customerAddress: "211 Nguyễn Hữu Thọ, Đà Nẵng" }
              : {}),
            items: {
              create: {
                id: uid("p11", "dong", m.khoa, c.id.slice(-8)),
                type: "COURSE_ENROLLMENT",
                enrollmentId: c.enrollmentId,
                itemName: `Học phí — ${c.name}`,
                quantity: 1,
                unitPrice: gia,
                totalPrice: gia,
              },
            },
          },
        });
        const pid = uid("p11", "thu", m.khoa, c.id.slice(-8));
        await db.payment.create({
          data: {
            id: pid,
            orderId: oid,
            enrollmentId: c.enrollmentId,
            amount: gia,
            method: m.khoa === "cu" ? "CASH" : ma === "CS2" ? "BANK_CS2" : "BANK_CS1",
            paidDate: m.ngay,
            saleStatus: "COLLECT_CONFIRMED",
            accountantStatus: "CONFIRMED",
            confirmedById: ctx.ketoan?.id ?? null,
            confirmedAt: m.ngay,
            recordedById: ctx.admin.id,
            centerId: c.centerId,
            createdAt: m.ngay,
          },
        });
        await db.receipt.create({
          data: { code: `RCP-${ma}-26-9${String(nDon).padStart(2, "0")}${c.id.slice(-4).toUpperCase()}${m.khoa.slice(0, 2).toUpperCase()}`, paymentId: pid, enrollmentId: c.enrollmentId, issuedById: ctx.admin.id, issuedAt: m.ngay, status: "ACTIVE" },
        });
      }
      nDon++;
    }
  }
  void MOC;
  xong("Đơn hàng + khoản thu + phiếu thu", nDon);
}

// ─── Mục 7: khuyến mãi đang chạy ─────────────────────────────────────────────
async function mucKhuyenMai(ctx: Ctx) {
  const cs2 = await db.orgUnit.findFirst({ where: { code: "CS2" }, select: { id: true } });
  const cs1 = await db.orgUnit.findFirst({ where: { code: "CS1" }, select: { id: true } });
  const ngay = (d: number) => new Date(ngayDen(d).toISOString().slice(0, 10) + "T00:00:00.000Z");
  const ds: { ma: string; ten: string; loi: string; dk: string | null; tu: number; den: number; don: string[] }[] = [
    { ma: "UAT-KM-1211-A", ten: "Ưu đãi đăng ký học phần kế tiếp", loi: "Giảm 5% học phí khi đăng ký học phần kế tiếp trước hạn.", dk: "Áp dụng cho học viên đang học, đăng ký trước hạn.", tu: -3, den: 40, don: [] },
    { ma: "UAT-KM-1211-B", ten: "Anh chị em cùng học (CS2)", loi: "Giảm 10% học phí cho bé thứ hai trở đi cùng gia đình.", dk: "Chỉ áp dụng tại cơ sở 114 Hoàng Diệu.", tu: -30, den: 20, don: cs2 ? [cs2.id] : [] },
    { ma: "UAT-KM-1211-C", ten: "Mừng khai giảng tháng 12 (CS1)", loi: "Tặng bộ KIT mở rộng khi đóng đủ 48 buổi.", dk: null, tu: -1, den: 25, don: cs1 ? [cs1.id] : [] },
  ];
  let n = 0;
  for (const k of ds) {
    // LÀM TƯƠI ngày để chương trình còn hiệu lực dù chạy lại sau vài ngày.
    if (ctx.ghi) {
      await db.promotionPolicy.upsert({
        where: { documentCode: k.ma },
        create: { documentCode: k.ma, name: k.ten, benefitText: k.loi, conditionText: k.dk, validFrom: ngay(k.tu), validUntil: ngay(k.den), orgUnitIds: k.don, courseIds: [], createdById: ctx.admin.id },
        update: { validFrom: ngay(k.tu), validUntil: ngay(k.den), revokedAt: null },
      });
    }
    n++;
  }
  xong("Khuyến mãi đang chạy", n);
}

export async function seedPortal1211(opts: { ghi: boolean }): Promise<number> {
  const ctx = await docNgucNguon(opts);
  console.log(`\n  CHẾ ĐỘ: ${opts.ghi ? "GHI" : "DRY-RUN (chỉ đọc + in kế hoạch)"}`);
  await muc(ctx, "Gán con cho uat.phuhuynh1", () => bamConChoPhuHuynh1(ctx));
  await docCon(ctx);
  inHienTrang(ctx);
  await muc(ctx, "Đồng ý hình ảnh", () => mucDongY(ctx));
  await muc(ctx, "Ảnh đã duyệt nhiều buổi", () => mucAnhDaDuyet(ctx));
  await muc(ctx, "Ảnh chờ duyệt (GV đăng)", () => mucAnhChoDuyet(ctx));
  await muc(ctx, "Lượt bù + buổi cần bù", () => mucHocBu(ctx));
  await muc(ctx, "Bài tập yêu cầu video", () => mucBaiTapVideo(ctx));
  await muc(ctx, "Đơn hàng / phiếu thu / hoá đơn", () => mucDonHang(ctx));
  await muc(ctx, "Khuyến mãi", () => mucKhuyenMai(ctx));
  if (ctx.loi.length) {
    console.error(`\n  ✗ ${ctx.loi.length} mục lỗi:\n   - ${ctx.loi.join("\n   - ")}`);
  } else {
    console.log("\n  ✓ Không mục nào lỗi.");
  }
  return ctx.loi.length;
}

