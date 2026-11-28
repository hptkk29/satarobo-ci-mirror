import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";
import { capChungNhanTuDong } from "./chung-nhan";
import { chamBai, kiemCauHoi, ketQuaChoHocVien, veChoHocVien, xaoTron, type CauHoiInput, type CauHoiSnapshot, type ChinhSachDapAn, type KetQuaBai, type KetQuaChoHocVien, type SnapshotDe } from "./cham-diem";
import { cauHinhTuLuu, laLoaiChamTay, laLoaiMoRong } from "./dang-cau-hoi";
import { lamMoMaCau, type NguonMo } from "./ma-dap-an-mo";
import { diemSanPhamCuaLuot } from "./san-pham-db";
import { layBoiHoanKhaDung } from "./gian-doan-db";
import { DUNG_SAI_CHOT_GIAY, chotLuotQuaHanTrongTx, ghiKetQuaChotLuot, ghiTienDoTuKetQua } from "./luot-nhap-db";
import { kiemTraTruyCapChoPhuHuynh, kiemTraXemLichSuChoPhuHuynh } from "./hoc-tap";
import type { MaTruyCapDb } from "./quyen-hoc-db";

/**
 * E-LEARNING ONLINE — ĐÁNH GIÁ (DB): ngân hàng câu hỏi · đề (kiểm tra / bài tập / thi cuối) · lượt làm bài có SNAPSHOT · chấm · chấm tay · ghi tiến độ · cấp chứng nhận.
 *
 * Bất biến (mỗi cái có ca DB, `tests/elearning/onl-danh-gia-db.test.ts`):
 * 1. Học viên đi qua `kiemTraTruyCapChoPhuHuynh` (sở hữu + quyền + hạn + thứ tự mở bài + không xem lại) cho CẢ bắt đầu lẫn nộp bài.
 * 2. Lượt làm bài giữ SNAPSHOT (đề + đáp án + điểm + ngưỡng đạt): sửa/xoá đề sau đó KHÔNG đổi lượt đã làm; chấm luôn theo snapshot.
 * 3. Đáp án đúng KHÔNG BAO GIỜ rời server khi đang làm bài.
 * 4. Mỗi quyền chỉ có MỘT lượt đang làm cho mỗi đề (khoá dòng quyền + chỉ mục duy nhất từng phần); bắt đầu lại ⇒ trả lượt đang làm (tiếp tục).
 * 5. Nộp bài idempotent (nộp lại ⇒ trả kết quả cũ); nộp quá hạn (+ 60 giây dung sai) ⇒ lượt HẾT GIỜ, tính một lượt đã dùng, không điểm.
 * 6. Điểm tốt nhất được giữ (`bestScore`); đạt ⇒ bài hoàn thành; hoàn thành khoá ⇒ cấp chứng nhận TRONG CÙNG giao dịch.
 * 7. Phát hành bản mới / đặt lại tiến độ không xoá lượt làm bài, điểm hay chứng nhận.
 */

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export const DUNG_SAI_GIAY = DUNG_SAI_CHOT_GIAY;

export type MaLoiDanhGia =
  | "KHOA_KHONG_TON_TAI"
  | "CAU_HOI_KHONG_TON_TAI"
  | "DE_KHONG_TON_TAI"
  | "CAU_HOI_KHAC_KHOA"
  | "CAU_HOI_TRUNG"
  | "DE_CAN_CAU_HOI"
  | "CAU_HOI_KHONG_HOP_LE"
  | "BAI_KHONG_PHAI_DANH_GIA"
  | "CHUA_GAN_DE"
  | "DE_KHONG_HOAT_DONG"
  | "DE_RONG"
  | "LUOT_KHONG_TON_TAI"
  | "HET_GIO"
  | "KHONG_CO_CAU_TU_LUAN"
  | "LUOT_BI_GIAN_DOAN"
  | "SAN_PHAM_CHUA_CHAM"
  | "SAN_PHAM_KHONG_CHAM_DUOC"
  | "DA_CHAM"
  | "DIEM_TU_LUAN_KHONG_HOP_LE"
  | "LY_DO_CHAM_LAI_QUA_NGAN"
  | "CHUA_CHAM"
  | "SAI_PHU_HUYNH"
  | MaTruyCapDb;
export type Fail = { ok: false; ma: MaLoiDanhGia; thongBao: string };
const fail = (ma: MaLoiDanhGia, thongBao: string): Fail => ({ ok: false, ma, thongBao });

// ───────── Soạn: câu hỏi ─────────

export async function luuCauHoi(db: Db, input: CauHoiInput, actorUserId: string | null): Promise<{ ok: true; id: string } | Fail> {
  const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  const k = kiemCauHoi(input);
  if (!k.ok) return fail("CAU_HOI_KHONG_HOP_LE", k.thongBao);
  // Câu "Nộp sản phẩm" chỉ được trỏ tới khung chấm của CHÍNH khoá này và còn dùng (trước đây id lạ/khác khoá bị lặng lẽ bỏ qua lúc học viên nộp ⇒ bài chấm không khung).
  const khungId = input.type === "PRODUCT" ? (input.cauHinh as { rubricId?: unknown } | undefined)?.rubricId : undefined;
  if (typeof khungId === "string" && khungId) {
    // Sửa câu ĐANG dùng khung đã lưu trữ mà không đổi khung thì vẫn lưu được; chỉ khung MỚI được chọn phải còn dùng.
    const hienTai = input.id ? ((await db.onlQuestion.findFirst({ where: { id: input.id, courseId: input.courseId }, select: { optionsJson: true } }))?.optionsJson as { rubricId?: unknown } | null) : null;
    const giuNguyen = hienTai?.rubricId === khungId;
    const kc = await db.onlRubric.findFirst({ where: { id: khungId, courseId: input.courseId, ...(giuNguyen ? {} : { archived: false }) }, select: { id: true } });
    if (!kc) return fail("CAU_HOI_KHONG_HOP_LE", "Khung chấm không thuộc khoá này hoặc đã lưu trữ");
  }
  const data = {
    type: input.type,
    stem: input.stem,
    optionsJson: k.optionsJson as unknown as Prisma.InputJsonValue,
    answerKeyJson: k.answerKeyJson as unknown as Prisma.InputJsonValue,
    explanation: input.explanation ?? null,
    points: input.points ?? 1,
  };
  if (input.id) {
    const cu = await db.onlQuestion.findUnique({ where: { id: input.id }, select: { id: true, courseId: true } });
    if (!cu || cu.courseId !== input.courseId) return fail("CAU_HOI_KHONG_TON_TAI", "Câu hỏi không tồn tại trong khoá này");
    await db.onlQuestion.update({ where: { id: input.id }, data });
    return { ok: true, id: input.id };
  }
  const c = await db.onlQuestion.create({ data: { ...data, courseId: input.courseId, createdByUserId: actorUserId }, select: { id: true } });
  return { ok: true, id: c.id };
}

export type CauHoiDeSua = {
  id: string; type: string; stem: string; points: number; explanation: string | null; status: string;
  options: { id: string; text: string }[]; correct: string | string[] | boolean | null; accepted: string[]; cauHinh: Record<string, unknown> | null;
};

/**
 * Đọc MỘT câu của khoá để SỬA (người soạn có quyền xem đáp án). Dạng cơ bản trả `options/correct/accepted`; dạng mở rộng trả `cauHinh` dựng ngược từ dữ liệu đã lưu (`cauHinhTuLuu`).
 * Câu của khoá khác ⇒ null (cùng một câu trả lời với "không có").
 */
export async function docCauHoiDeSua(db: Db, courseId: string, questionId: string): Promise<CauHoiDeSua | null> {
  const q = await db.onlQuestion.findFirst({ where: { id: questionId, courseId }, select: { id: true, type: true, stem: true, points: true, explanation: true, status: true, optionsJson: true, answerKeyJson: true } });
  if (!q) return null;
  const key = (q.answerKeyJson ?? {}) as { correct?: string | string[] | boolean; accepted?: string[] };
  const co = { id: q.id, type: q.type as string, stem: q.stem, points: q.points, explanation: q.explanation, status: q.status as string };
  if (laLoaiMoRong(q.type)) return { ...co, options: [], correct: null, accepted: [], cauHinh: cauHinhTuLuu(q.type, q.optionsJson, q.answerKeyJson) };
  const opts = Array.isArray(q.optionsJson) ? (q.optionsJson as { id: string; text: string }[]) : [];
  return { ...co, options: opts, correct: key.correct ?? null, accepted: Array.isArray(key.accepted) ? key.accepted : [], cauHinh: null };
}

/** Lưu trữ câu hỏi: đề đang dùng giữ tham chiếu; LƯỢT LÀM BÀI đã có không đổi (snapshot). Lượt MỚI bỏ qua câu đã lưu trữ. */
export async function luuTruCauHoi(db: Db, courseId: string, questionId: string): Promise<{ ok: true } | Fail> {
  const q = await db.onlQuestion.findFirst({ where: { id: questionId, courseId }, select: { id: true } });
  if (!q) return fail("CAU_HOI_KHONG_TON_TAI", "Câu hỏi không tồn tại");
  await db.onlQuestion.update({ where: { id: questionId }, data: { status: "ARCHIVED" } });
  return { ok: true };
}

// ───────── Soạn: đề ─────────

export const deThiSchema = z
  .object({
    id: z.string().min(1).optional(),
    courseId: z.string().min(1),
    kind: z.enum(["QUIZ", "ASSIGNMENT", "FINAL_EXAM"]),
    title: z.string().trim().min(1, "Đề cần có tên").max(200),
    instructions: z.string().trim().max(5000).nullable().optional(),
    passPercent: z.number().int().min(0).max(100),
    timeLimitMin: z.number().int().min(1).max(600).nullable().optional(),
    maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
    shuffle: z.boolean().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    cau: z.array(z.object({ questionId: z.string().min(1), points: z.number().int().min(1).max(1000).nullable().optional() }).strict()).max(500),
  })
  .strict();
export type DeThiInput = z.infer<typeof deThiSchema>;

export async function luuDeThi(db: Db, input: DeThiInput, actorUserId: string | null): Promise<{ ok: true; id: string } | Fail> {
  const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  const ids = input.cau.map((c) => c.questionId);
  if (new Set(ids).size !== ids.length) return fail("CAU_HOI_TRUNG", "Một câu hỏi xuất hiện hai lần trong đề");
  const cauDb = ids.length ? await db.onlQuestion.findMany({ where: { id: { in: ids } }, select: { id: true, courseId: true, status: true, points: true } }) : [];
  if (cauDb.length !== ids.length) return fail("CAU_HOI_KHONG_TON_TAI", "Có câu hỏi không tồn tại");
  if (cauDb.some((c) => c.courseId !== input.courseId)) return fail("CAU_HOI_KHAC_KHOA", "Đề chỉ được dùng câu hỏi của CHÍNH khoá này");
  if (input.status === "ACTIVE") {
    const hoatDong = cauDb.filter((c) => c.status === "ACTIVE");
    const tong = input.cau.reduce((s, c) => s + (c.points ?? cauDb.find((x) => x.id === c.questionId)!.points), 0);
    if (hoatDong.length === 0 || tong <= 0) return fail("DE_CAN_CAU_HOI", "Đề đang dùng cần ít nhất một câu hỏi còn hoạt động");
  }
  const data = {
    kind: input.kind,
    title: input.title,
    instructions: input.instructions ?? null,
    passPercent: input.passPercent,
    timeLimitMin: input.timeLimitMin ?? null,
    maxAttempts: input.maxAttempts ?? null,
    shuffle: input.shuffle ?? false,
    status: input.status,
  };
  return db.$transaction(async (tx) => {
    let id = input.id;
    if (id) {
      const cu = await tx.onlAssessment.findUnique({ where: { id }, select: { courseId: true } });
      if (!cu || cu.courseId !== input.courseId) return fail("DE_KHONG_TON_TAI", "Đề không tồn tại trong khoá này");
      await tx.onlAssessment.update({ where: { id }, data });
      await tx.onlAssessmentQuestion.deleteMany({ where: { assessmentId: id } });
    } else {
      id = (await tx.onlAssessment.create({ data: { ...data, courseId: input.courseId, createdByUserId: actorUserId }, select: { id: true } })).id;
    }
    if (input.cau.length) await tx.onlAssessmentQuestion.createMany({ data: input.cau.map((c, i) => ({ assessmentId: id!, questionId: c.questionId, orderIndex: i, points: c.points ?? null })) });
    return { ok: true as const, id: id! };
  });
}

export async function docDeThiCuaKhoa(db: Db, courseId: string) {
  return db.onlAssessment.findMany({
    where: { courseId },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, title: true, passPercent: true, timeLimitMin: true, maxAttempts: true, shuffle: true, status: true, _count: { select: { questions: true, attempts: true } }, questions: { orderBy: { orderIndex: "asc" }, select: { questionId: true } } },
  });
}

/**
 * Đề kiểm tra của MỌI khoá online (màn Đề thi của khu nội bộ, phần "Đề của khoá online" — CHỈ ĐỌC, dẫn sang màn khoá). Mới nhất trước; `tong` là số THẬT
 * (trần `take` chỉ cắt dòng). Chỉ bảng Online (`OnlAssessment`) — KHÔNG đọc `TrnExam`; không PII (không đọc lượt làm của học viên, chỉ đếm).
 */
export async function docDeThiOnlineTatCa(db: Db, o: { take?: number } = {}) {
  const take = Math.max(1, Math.min(o.take ?? 100, 200));
  const where = { course: { deletedAt: null } };
  const [dong, tong] = await Promise.all([
    db.onlAssessment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        courseId: true,
        kind: true,
        title: true,
        passPercent: true,
        timeLimitMin: true,
        maxAttempts: true,
        status: true,
        course: { select: { name: true, code: true } },
        _count: { select: { questions: true, attempts: true } },
      },
    }),
    db.onlAssessment.count({ where }),
  ]);
  return { dong, tong };
}

export async function docCauHoiCuaKhoa(db: Db, courseId: string) {
  return db.onlQuestion.findMany({ where: { courseId }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, stem: true, points: true, status: true, optionsJson: true, answerKeyJson: true, explanation: true } });
}

// ───────── Học viên: bắt đầu / nộp ─────────

type DauVao = { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; now: Date };

/** Đề gắn với bài học trong BẢN ĐANG CHẠY. Bài không phải loại đánh giá / chưa gắn đề ⇒ lỗi riêng. */
async function layDeCuaBai(tx: Db | Tx, courseId: string, lessonStableId: string): Promise<{ ok: true; assessmentId: string; soBan: number; xemKetQua: ReturnType<typeof docCaiDatHocTap> } | Fail> {
  const khoa = await tx.onlCourse.findUnique({ where: { id: courseId }, select: { publishedVersionId: true } });
  if (!khoa?.publishedVersionId) return fail("KHOA_CHUA_PHAT_HANH", "Khoá chưa phát hành");
  const [ban, bai] = await Promise.all([
    tx.onlCourseVersion.findUnique({ where: { id: khoa.publishedVersionId }, select: { number: true, settingsJson: true } }),
    tx.onlLesson.findUnique({ where: { versionId_stableId: { versionId: khoa.publishedVersionId, stableId: lessonStableId } }, select: { kind: true, contentJson: true } }),
  ]);
  if (!ban || !bai) return fail("BAI_KHONG_TON_TAI", "Bài không tồn tại");
  if (bai.kind !== "QUIZ" && bai.kind !== "ASSIGNMENT" && bai.kind !== "FINAL_EXAM") return fail("BAI_KHONG_PHAI_DANH_GIA", "Bài này không phải bài kiểm tra/bài tập/thi");
  const id = (bai.contentJson as { assessmentId?: unknown } | null)?.assessmentId;
  if (typeof id !== "string" || !id) return fail("CHUA_GAN_DE", "Bài chưa được gắn đề");
  return { ok: true, assessmentId: id, soBan: ban.number, xemKetQua: docCaiDatHocTap(ban.settingsJson) };
}

export type LuotDangLam = {
  attemptId: string;
  soLuot: number;
  batDauLuc: Date;
  hetGioLuc: Date | null;
  daTiepTuc: boolean;
  de: ReturnType<typeof veChoHocVien>;
};

export async function batDauLamBai(db: Db, input: DauVao & { ngauNhien?: () => number }): Promise<{ ok: true; luot: LuotDangLam } | Fail> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return fail(cong.ma, "Không vào được bài này");
  const de = await layDeCuaBai(db, input.courseId, input.lessonStableId);
  if (!de.ok) return de;

  return db.$transaction(async (tx): Promise<{ ok: true; luot: LuotDangLam } | Fail> => {
    const q = await tx.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
    // Khoá dòng quyền: hai thiết bị cùng bấm "Bắt đầu" xếp hàng ⇒ thiết bị sau thấy lượt của thiết bị trước (tiếp tục), không đẻ lượt thứ hai.
    await tx.$queryRaw`SELECT "id" FROM "OnlEntitlement" WHERE "id" = ${q.id} FOR UPDATE`;
    const ds = await tx.onlAssessment.findUnique({
      where: { id: de.assessmentId },
      select: { id: true, courseId: true, kind: true, title: true, status: true, passPercent: true, timeLimitMin: true, maxAttempts: true, shuffle: true, questions: { orderBy: { orderIndex: "asc" }, select: { points: true, question: { select: { id: true, type: true, stem: true, optionsJson: true, answerKeyJson: true, explanation: true, points: true, status: true } } } } },
    });
    if (!ds || ds.courseId !== input.courseId) return fail("DE_KHONG_TON_TAI", "Đề không tồn tại");
    if (ds.status !== "ACTIVE") return fail("DE_KHONG_HOAT_DONG", "Đề chưa mở cho học viên");

    const dang = await tx.onlAttempt.findFirst({ where: { entitlementId: q.id, assessmentId: ds.id, status: "IN_PROGRESS" }, select: { id: true, number: true, startedAt: true, dueAt: true, snapshotJson: true } });
    if (dang) {
      const qua = dang.dueAt && input.now.getTime() > dang.dueAt.getTime() + DUNG_SAI_GIAY * 1000;
      if (!qua) {
        return { ok: true, luot: { attemptId: dang.id, soLuot: dang.number, batDauLuc: dang.startedAt, hetGioLuc: dang.dueAt, daTiepTuc: true, de: veChoHocVien(dang.snapshotJson as unknown as SnapshotDe) } };
      }
      await chotLuotQuaHanTrongTx(tx, dang.id, input.now); // quá hạn: máy chủ chốt từ nháp (có nháp ⇒ chấm; không ⇒ EXPIRED tính một lượt như cũ)
    }
    const da = await tx.onlAttempt.aggregate({ where: { entitlementId: q.id, assessmentId: ds.id }, _count: { _all: true }, _max: { number: true } });
    // D2 (Owner 21/11/2026): THI LẠI KHÔNG GIỚI HẠN — `OnlAssessment.maxAttempts` KHÔNG còn chặn bắt đầu lượt (cột giữ nguyên để không phá dữ liệu cũ; mã `HET_LUOT` không còn được trả).
    // D3: nếu có lượt bị Admin thu hồi giữa chừng đang chờ lượt thay thế ⇒ lượt MỚI này là lượt thay thế và dùng ĐÚNG bản chụp đề của lượt bị gián đoạn (không đổi sang đề mới).
    const thayThe = await layBoiHoanKhaDung(tx, q.id, ds.id);
    const daCoBanChup = thayThe !== null;

    const cau: CauHoiSnapshot[] = ds.questions
      .filter((x) => x.question.status === "ACTIVE")
      .map((x) => ({ id: x.question.id, type: x.question.type, stem: x.question.stem, ...(Array.isArray(x.question.optionsJson) ? { options: x.question.optionsJson as never } : { options: [], cauHinh: (x.question.optionsJson ?? {}) as Record<string, unknown> }), key: x.question.answerKeyJson as never, points: x.points ?? x.question.points, explanation: x.question.explanation }));
    if (!daCoBanChup && (cau.length === 0 || cau.reduce((s, c) => s + c.points, 0) <= 0)) return fail("DE_RONG", "Đề chưa có câu hỏi nào còn hoạt động");
    // V10.2: mã lựa chọn của ghép cặp / sắp xếp / phân loại là NGẪU NHIÊN riêng của lượt (khuôn cũ l1→r1, s1..sn, c/g đoán được và bị gửi xuống học viên). Chỉ lượt MỚI; lượt thay thế (D3) dùng đúng bản chụp cũ.
    const nguonMo: NguonMo = { sinhMa: () => "o" + randomBytes(6).toString("hex"), xao: (ds2) => xaoTron(ds2, input.ngauNhien ?? Math.random) };
    const cauMo: CauHoiSnapshot[] = daCoBanChup ? cau : cau.map((c) => {
      if (!laLoaiMoRong(c.type)) return c;
      const m = lamMoMaCau({ type: c.type, options: c.cauHinh ?? {}, key: c.key }, nguonMo);
      return { ...c, cauHinh: m.options as Record<string, unknown>, key: m.key as typeof c.key };
    });
    const sapXep = ds.shuffle ? xaoTron(cauMo, input.ngauNhien ?? Math.random) : cauMo;
    const snapshot: SnapshotDe = thayThe ? thayThe.snapshot : { assessmentId: ds.id, title: ds.title, kind: ds.kind, passPercent: ds.passPercent, timeLimitMin: ds.timeLimitMin, cau: sapXep };
    const gioiHanPhut = thayThe ? thayThe.snapshot.timeLimitMin : ds.timeLimitMin;
    const dueAt = gioiHanPhut ? new Date(input.now.getTime() + gioiHanPhut * 60_000) : null;
    const moi = await tx.onlAttempt.create({
      data: { assessmentId: ds.id, entitlementId: q.id, studentId: input.studentId, lessonStableId: input.lessonStableId, number: (da._max.number ?? 0) + 1, status: "IN_PROGRESS", startedAt: input.now, dueAt, versionNumber: thayThe ? (thayThe.versionNumber ?? de.soBan) : de.soBan, snapshotJson: snapshot as unknown as Prisma.InputJsonValue },
      select: { id: true, number: true },
    });
    if (thayThe) await tx.onlAttemptCompensation.update({ where: { id: thayThe.compensationId }, data: { status: "USED", usedAttemptId: moi.id, usedAt: input.now } });
    return { ok: true, luot: { attemptId: moi.id, soLuot: moi.number, batDauLuc: input.now, hetGioLuc: dueAt, daTiepTuc: false, de: veChoHocVien(snapshot) } };
  });
}

export type KetQuaNop = { ok: true; daNopTruocDo: boolean; trangThai: "GRADED" | "SUBMITTED"; ketQua: KetQuaChoHocVien; vuaCapChungNhan: boolean; chungNhan: string | null } | Fail;

async function ketQuaTuLuot(tx: Db | Tx, a: { entitlementId: string; assessmentId: string; snapshotJson: unknown; answersJson: unknown; manualJson: unknown; status: string }, xemKetQua: ReturnType<typeof docCaiDatHocTap>, now: Date, chiDiem = false) {
  const de = a.snapshotJson as SnapshotDe;
  const kq: KetQuaBai = chamBai(de, (a.answersJson ?? {}) as Record<string, unknown>, ((a.manualJson as { diem?: Record<string, number> } | null)?.diem ?? {}) as Record<string, number>);
  // D2: thi lại không giới hạn ⇒ không còn "hết lượt". D6: thời điểm lộ đáp án do Đào tạo cấu hình (`hienDapAn`); cài đặt hỏng ⇒ chỉ điểm (fail-closed).
  // `chiDiem` (bài khoá xem lại) đè MỌI cài đặt: `CHI_DIEM` trả về TRƯỚC nhánh `chiTiet` và `hienDapAn` của `ketQuaChoHocVien`.
  const cd = !chiDiem && xemKetQua.ok ? xemKetQua.caiDat : null;
  const chinhSachDapAn: ChinhSachDapAn | undefined = cd?.hienDapAn ? { che: cd.hienDapAn, dongLuc: cd.dongDapAnLuc ? new Date(cd.dongDapAnLuc) : null } : undefined;
  return ketQuaChoHocVien({ de, ketQua: kq, xemKetQua: cd ? cd.xemKetQua : "CHI_DIEM", conLuot: true, chinhSachDapAn, now });
}

export const nopBaiSchema = z.object({ attemptId: z.string().min(1), traLoi: z.record(z.string(), z.unknown()) }).strict();

export async function nopBai(db: Db, input: DauVao & { attemptId: string; traLoi: Record<string, unknown> }): Promise<KetQuaNop> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return fail(cong.ma, "Không vào được bài này");
  const de = await layDeCuaBai(db, input.courseId, input.lessonStableId);
  if (!de.ok) return de;

  return db.$transaction(async (tx): Promise<KetQuaNop> => {
    const q = await tx.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
    await tx.$queryRaw`SELECT "id" FROM "OnlEntitlement" WHERE "id" = ${q.id} FOR UPDATE`;
    const a = await tx.onlAttempt.findUnique({ where: { id: input.attemptId } });
    // Lượt phải của ĐÚNG quyền + ĐÚNG bài này (không nộp lượt của người khác bằng cách đoán id).
    if (!a || a.entitlementId !== q.id || a.lessonStableId !== input.lessonStableId) return fail("LUOT_KHONG_TON_TAI", "Không tìm thấy lượt làm bài");

    if (a.status === "INTERRUPTED") return fail("LUOT_BI_GIAN_DOAN", "Lượt làm bài đã bị gián đoạn do thu hồi quyền — dùng lượt thay thế sau khi được cấp lại");
    if (a.status !== "IN_PROGRESS") {
      if (a.status === "EXPIRED") return fail("HET_GIO", "Lượt làm bài đã hết giờ");
      return { ok: true, daNopTruocDo: true, trangThai: a.status === "GRADED" ? "GRADED" : "SUBMITTED", ketQua: await ketQuaTuLuot(tx, a, de.xemKetQua, input.now), vuaCapChungNhan: false, chungNhan: null };
    }
    if (a.dueAt && input.now.getTime() > a.dueAt.getTime() + DUNG_SAI_GIAY * 1000) {
      // Quá hạn: máy chủ chốt từ NHÁP đã ACK (không dùng đáp án gửi muộn). Có nháp ⇒ trả kết quả đã chốt; không có ⇒ hết giờ như cũ.
      const r = await chotLuotQuaHanTrongTx(tx, a.id, input.now);
      if (r.ket === "DA_CHOT_TU_NHAP") {
        const luot = await tx.onlAttempt.findUniqueOrThrow({ where: { id: a.id } });
        return { ok: true, daNopTruocDo: true, trangThai: luot.status === "GRADED" ? "GRADED" : "SUBMITTED", ketQua: await ketQuaTuLuot(tx, luot, de.xemKetQua, input.now), vuaCapChungNhan: false, chungNhan: null };
      }
      return fail("HET_GIO", "Đã quá thời gian làm bài — lượt này tính là đã dùng");
    }

    const chot = await ghiKetQuaChotLuot(tx, a, { traLoi: input.traLoi, now: input.now, submittedAt: input.now, lyDo: "SUBMIT", soBan: de.soBan });
    const luot = await tx.onlAttempt.findUniqueOrThrow({ where: { id: a.id } });
    return { ok: true, daNopTruocDo: false, trangThai: chot.chamXong ? "GRADED" : "SUBMITTED", ketQua: await ketQuaTuLuot(tx, luot, de.xemKetQua, input.now), vuaCapChungNhan: chot.vuaCap, chungNhan: chot.chungNhan };
  });
}

// ───────── Chấm tay (tự luận) ─────────

export const chamTaySchema = z
  .object({
    attemptId: z.string().min(1),
    /** Điểm từng câu TỰ LUẬN (0..điểm tối đa của câu); phải đủ mọi câu tự luận của lượt. */
    diem: z.record(z.string(), z.number().int().min(0).max(1000)),
    feedback: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

export async function danhSachChoCham(db: Db, courseId: string) {
  return db.onlAttempt.findMany({
    where: { status: "SUBMITTED", assessment: { courseId } },
    orderBy: { submittedAt: "asc" },
    take: 200,
    select: { id: true, number: true, submittedAt: true, studentId: true, student: { select: { name: true } }, assessment: { select: { title: true } } },
  });
}

/** D5: các lượt ĐÃ chấm tay (có `manualJson`) — nguồn cho nút "Chấm lại". Mới chấm nhất lên đầu; lượt chấm tự động không có `manualJson` nên không vào đây. */
export async function danhSachDaCham(db: Db, courseId: string) {
  return db.onlAttempt.findMany({
    where: { status: "GRADED", assessment: { courseId }, manualJson: { not: Prisma.DbNull } },
    orderBy: { gradedAt: "desc" },
    take: 100,
    select: { id: true, number: true, gradedAt: true, scorePercent: true, passed: true, manualJson: true, student: { select: { name: true } }, assessment: { select: { title: true } } },
  });
}

/** Dữ liệu để người chấm xem: câu tự luận + bài làm (trả đủ snapshot — người chấm có quyền xem đáp án). Lượt ĐÃ chấm: kèm điểm hiện hành + lịch sử chấm lại (D5). */
export async function docLuotDeCham(db: Db, attemptId: string) {
  const a = await db.onlAttempt.findUnique({ where: { id: attemptId }, select: { id: true, status: true, snapshotJson: true, answersJson: true, manualJson: true, feedback: true, scorePercent: true, passed: true, assessment: { select: { courseId: true, title: true } }, student: { select: { name: true } } } });
  if (!a) return null;
  const manual = (a.manualJson ?? null) as { diem?: Record<string, number>; lichSu?: LichSuChamLai[] } | null;
  const daCham = a.status === "GRADED";
  const snap = a.snapshotJson as unknown as SnapshotDe;
  const dsSp = snap.cau.filter((c) => c.type === "PRODUCT");
  const bai = dsSp.length ? await db.onlSubmission.findMany({ where: { attemptId: a.id, questionId: { in: dsSp.map((c) => c.id) }, status: { in: ["SUBMITTED", "GRADED", "RESUBMIT_REQUESTED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, questionId: true, status: true, fileName: true, mimeType: true, sizeBytes: true, durationSec: true, rubricSnapshotJson: true, scoresJson: true, points: true, feedback: true } }) : [];
  const sanPham = dsSp.map((c) => {
    const s = bai.find((x) => x.questionId === c.id);
    return { questionId: c.id, stem: c.stem, toiDa: c.points, bai: s ? { id: s.id, status: s.status, fileName: s.fileName, mimeType: s.mimeType, sizeBytes: s.sizeBytes, durationSec: s.durationSec, khung: ((s.rubricSnapshotJson as { criteria?: { id: string; name: string; max: number }[] } | null)?.criteria ?? null), points: s.points, feedback: s.feedback } : null };
  });
  return { id: a.id, status: a.status, daCham, diemHienTai: daCham ? (manual?.diem ?? {}) : {}, nhanXetHienTai: daCham ? a.feedback : null, scorePercentHienTai: daCham ? a.scorePercent : null, passedHienTai: daCham ? a.passed : null, lichSu: daCham && Array.isArray(manual?.lichSu) ? manual.lichSu : ([] as LichSuChamLai[]), courseId: a.assessment.courseId, tenDe: a.assessment.title, tenHocVien: a.student.name, sanPham, tuLuan: snap.cau.filter((c) => c.type === "ESSAY").map((c) => ({ id: c.id, loai: c.type, stem: c.stem, toiDa: c.points })), baiLam: a.answersJson as Record<string, unknown> };
}

export async function chamTay(db: Db, input: { attemptId: string; diem: Record<string, number>; feedback?: string | null; graderUserId: string; now: Date }): Promise<{ ok: true; scorePercent: number; passed: boolean; vuaCapChungNhan: boolean } | Fail> {
  return db.$transaction(async (tx): Promise<{ ok: true; scorePercent: number; passed: boolean; vuaCapChungNhan: boolean } | Fail> => {
    await tx.$queryRaw`SELECT "id" FROM "OnlAttempt" WHERE "id" = ${input.attemptId} FOR UPDATE`;
    const a = await tx.onlAttempt.findUnique({ where: { id: input.attemptId }, include: { entitlement: { select: { id: true, courseId: true } } } });
    if (!a) return fail("LUOT_KHONG_TON_TAI", "Không tìm thấy lượt làm bài");
    if (a.status === "GRADED") return fail("DA_CHAM", "Lượt này đã được chấm");
    if (a.status !== "SUBMITTED") return fail("LUOT_KHONG_TON_TAI", "Lượt này chưa nộp hoặc đã hết giờ");
    const snap = a.snapshotJson as unknown as SnapshotDe;
    const tuLuan = snap.cau.filter((c) => c.type === "ESSAY");
    if (!snap.cau.some((c) => laLoaiChamTay(c.type))) return fail("KHONG_CO_CAU_TU_LUAN", "Lượt này không có câu tự luận");
    // Câu SẢN PHẨM không nhận điểm gõ tay ở đây: điểm = điểm bài nộp đã chấm theo khung (chưa chấm ⇒ từ chối; không nộp ⇒ 0).
    const sp = await diemSanPhamCuaLuot(tx, a, snap);
    if (!sp.ok) return fail(sp.ma as MaLoiDanhGia, sp.thongBao);
    const diemTay: Record<string, number> = { ...Object.fromEntries(tuLuan.map((c) => [c.id, input.diem[c.id]!])), ...sp.diem };
    for (const c of tuLuan) {
      const d = input.diem[c.id];
      if (typeof d !== "number" || d < 0 || d > c.points) return fail("DIEM_TU_LUAN_KHONG_HOP_LE", `Điểm câu "${c.stem.slice(0, 40)}" phải từ 0 đến ${c.points}`);
    }
    const kq = chamBai(snap, (a.answersJson ?? {}) as Record<string, unknown>, diemTay);
    if (kq.scorePercent === null || kq.passed === null) return fail("DIEM_TU_LUAN_KHONG_HOP_LE", "Thiếu điểm câu tự luận");
    await tx.onlAttempt.update({
      where: { id: a.id },
      data: { status: "GRADED", earnedPoints: kq.earned, totalPoints: kq.total, scorePercent: kq.scorePercent, passed: kq.passed, manualJson: { diem: diemTay } as Prisma.InputJsonValue, feedback: input.feedback ?? null, gradedAt: input.now, gradedByUserId: input.graderUserId },
    });
    const ban = await tx.onlCourseVersion.findFirst({ where: { courseId: a.entitlement.courseId, status: "PUBLISHED" }, select: { number: true } });
    await ghiTienDoTuKetQua(tx, { entitlementId: a.entitlementId, lessonStableId: a.lessonStableId, scorePercent: kq.scorePercent, passed: kq.passed, now: input.now, soBan: ban?.number ?? 1 });
    let vuaCap = false;
    if (kq.passed) {
      const cn = await capChungNhanTuDong(tx, a.entitlementId, input.now);
      vuaCap = cn.ok && !cn.daCo;
    }
    return { ok: true, scorePercent: kq.scorePercent, passed: kq.passed, vuaCapChungNhan: vuaCap };
  });
}

// ───────── Chấm lại có kiểm soát (D5, Owner 21/11/2026) ─────────

export const chamLaiTaySchema = z
  .object({
    attemptId: z.string().min(1),
    diem: z.record(z.string(), z.number().int().min(0).max(1000)),
    feedback: z.string().trim().max(5000).nullable().optional(),
    /** Bắt buộc: vì sao chấm lại (≥ 10 ký tự) — nằm trong lịch sử bất biến. */
    lyDo: z.string().trim().min(1).max(1000),
  })
  .strict();

export type LichSuChamLai = {
  lan: number;
  /** Trạng thái CHẤM TRƯỚC khi chấm lại (nguyên văn). */
  truoc: { diem: Record<string, number>; scorePercent: number | null; passed: boolean | null; feedback: string | null; gradedAt: string | null; gradedByUserId: string | null };
  lyDo: string;
  chamLaiLuc: string;
  chamLaiBoi: string;
};

/**
 * CHẤM LẠI một lượt ĐÃ CHẤM (tự luận / sản phẩm). Quyền `onl:assessment:grade` kiểm ở action.
 * - Lịch sử BẤT BIẾN: mỗi lần chấm lại thêm MỘT mục vào `manualJson.lichSu` (điểm + người chấm + thời điểm + nhận xét của lần TRƯỚC, kèm lý do ≥ 10 ký tự); không mục nào bị sửa/xoá.
 * - Điểm hiện hành = lần chấm lại mới nhất. Tiến độ: chỉ NÂNG (bài đã hoàn thành không bị hạ — luật cũ của `ghiTienDoTuKetQua`); chuyển lên ĐẠT ⇒ hoàn thành + cấp chứng nhận tự động như thường.
 * - Chuyển từ ĐẠT xuống KHÔNG ĐẠT KHÔNG tự thu hồi chứng nhận đã cấp (hệ chứng nhận bất biến — D4): trả `canhBaoChungNhanDaCap` để Admin quyết định thu hồi riêng.
 * - Đồng thời hai lần chấm lại: khoá dòng lượt; lần sau thấy lịch sử của lần trước (không mất mục nào).
 */
export async function chamLaiTay(db: Db, input: { attemptId: string; diem: Record<string, number>; feedback?: string | null; lyDo: string; graderUserId: string; now: Date }): Promise<{ ok: true; lan: number; scorePercent: number; passed: boolean; vuaCapChungNhan: boolean; canhBaoChungNhanDaCap: boolean } | Fail> {
  if (input.lyDo.trim().length < 10) return fail("LY_DO_CHAM_LAI_QUA_NGAN", "Cần lý do chấm lại (ít nhất 10 ký tự)");
  return db.$transaction(async (tx): Promise<{ ok: true; lan: number; scorePercent: number; passed: boolean; vuaCapChungNhan: boolean; canhBaoChungNhanDaCap: boolean } | Fail> => {
    await tx.$queryRaw`SELECT "id" FROM "OnlAttempt" WHERE "id" = ${input.attemptId} FOR UPDATE`;
    const a = await tx.onlAttempt.findUnique({ where: { id: input.attemptId }, include: { entitlement: { select: { id: true, courseId: true } } } });
    if (!a) return fail("LUOT_KHONG_TON_TAI", "Không tìm thấy lượt làm bài");
    if (a.status !== "GRADED") return fail("CHUA_CHAM", "Chỉ chấm lại được lượt đã chấm — lượt này chưa chấm lần đầu");
    const snap = a.snapshotJson as unknown as SnapshotDe;
    const tuLuan = snap.cau.filter((c) => c.type === "ESSAY");
    if (!snap.cau.some((c) => laLoaiChamTay(c.type))) return fail("KHONG_CO_CAU_TU_LUAN", "Lượt này không có câu chấm tay");
    const sp = await diemSanPhamCuaLuot(tx, a, snap);
    if (!sp.ok) return fail(sp.ma as MaLoiDanhGia, sp.thongBao);
    for (const c of tuLuan) {
      const d = input.diem[c.id];
      if (typeof d !== "number" || d < 0 || d > c.points) return fail("DIEM_TU_LUAN_KHONG_HOP_LE", `Điểm câu "${c.stem.slice(0, 40)}" phải từ 0 đến ${c.points}`);
    }
    const diemMoi: Record<string, number> = { ...Object.fromEntries(tuLuan.map((c) => [c.id, input.diem[c.id]!])), ...sp.diem };
    const kq = chamBai(snap, (a.answersJson ?? {}) as Record<string, unknown>, diemMoi);
    if (kq.scorePercent === null || kq.passed === null) return fail("DIEM_TU_LUAN_KHONG_HOP_LE", "Thiếu điểm câu tự luận");
    const cu = (a.manualJson ?? {}) as { diem?: Record<string, number>; lichSu?: LichSuChamLai[] };
    const lichSu = Array.isArray(cu.lichSu) ? cu.lichSu : [];
    const muc: LichSuChamLai = {
      lan: lichSu.length + 1,
      truoc: { diem: cu.diem ?? {}, scorePercent: a.scorePercent, passed: a.passed, feedback: a.feedback, gradedAt: a.gradedAt ? a.gradedAt.toISOString() : null, gradedByUserId: a.gradedByUserId },
      lyDo: input.lyDo.trim(),
      chamLaiLuc: input.now.toISOString(),
      chamLaiBoi: input.graderUserId,
    };
    const daCapTruoc = await tx.onlCertificate.count({ where: { entitlementId: a.entitlementId, status: "ISSUED" } });
    await tx.onlAttempt.update({
      where: { id: a.id },
      data: { earnedPoints: kq.earned, totalPoints: kq.total, scorePercent: kq.scorePercent, passed: kq.passed, manualJson: { diem: diemMoi, lichSu: [...lichSu, muc] } as unknown as Prisma.InputJsonValue, feedback: input.feedback ?? null, gradedAt: input.now, gradedByUserId: input.graderUserId },
    });
    const ban = await tx.onlCourseVersion.findFirst({ where: { courseId: a.entitlement.courseId, status: "PUBLISHED" }, select: { number: true } });
    await ghiTienDoTuKetQua(tx, { entitlementId: a.entitlementId, lessonStableId: a.lessonStableId, scorePercent: kq.scorePercent, passed: kq.passed, now: input.now, soBan: ban?.number ?? 1 });
    let vuaCap = false;
    if (kq.passed) {
      const cn = await capChungNhanTuDong(tx, a.entitlementId, input.now);
      vuaCap = cn.ok && !cn.daCo;
    }
    return { ok: true, lan: muc.lan, scorePercent: kq.scorePercent, passed: kq.passed, vuaCapChungNhan: vuaCap, canhBaoChungNhanDaCap: a.passed === true && kq.passed === false && daCapTruoc > 0 };
  });
}

/** Lịch sử chấm lại của một lượt (cho NGƯỜI CHẤM/Admin; quyền kiểm ở action). Chỉ-đọc, theo thứ tự lần. */
export async function docLichSuChamLai(db: Db, attemptId: string): Promise<LichSuChamLai[]> {
  const a = await db.onlAttempt.findUnique({ where: { id: attemptId }, select: { manualJson: true } });
  const l = (a?.manualJson as { lichSu?: LichSuChamLai[] } | null)?.lichSu;
  return Array.isArray(l) ? l : [];
}

/** Kết quả các lượt của MỘT con ở MỘT bài (học viên/phụ huynh xem), theo cài đặt xem kết quả. Sai phụ huynh ⇒ lỗi. D23: khoá HẾT HẠN vẫn xem được (chỉ đọc); thu hồi vẫn chặn. Bài đã khoá xem lại ⇒ CHỈ điểm + đạt/không (`chiDiem` của cổng). */
export async function docKetQuaCacLuot(db: Db, input: Omit<DauVao, "now"> & { now: Date }): Promise<{ ok: true; luot: { soLuot: number; trangThai: string; nopLuc: Date | null; ketQua: KetQuaChoHocVien | null }[] } | Fail> {
  const cong = await kiemTraXemLichSuChoPhuHuynh(db, input);
  if (!cong.ok) return fail(cong.ma, "Không vào được bài này");
  const de = await layDeCuaBai(db, input.courseId, input.lessonStableId);
  if (!de.ok) return de;
  const q = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
  // `lessonStableId`: cổng ở trên chỉ xét BÀI ĐƯỢC GỌI, nên chỉ trả lượt làm Ở bài đó (như nộp / đọc lại lượt / lưu nháp). Lọc theo đề thôi thì đề dùng chung, hay chuyển sang bài khác ở bản mới,
  // đưa ra chi tiết + đáp án của lượt làm ở bài ĐÃ KHOÁ xem lại qua một bài chưa khoá (trái quyết định Owner 27/11/2026).
  const luot = await db.onlAttempt.findMany({ where: { entitlementId: q.id, lessonStableId: input.lessonStableId, assessmentId: de.assessmentId, status: { not: "IN_PROGRESS" } }, orderBy: { number: "asc" } });
  const out = [];
  for (const l of luot) out.push({ soLuot: l.number, trangThai: l.status, nopLuc: l.submittedAt, ketQua: l.status === "EXPIRED" || l.status === "INTERRUPTED" ? null : await ketQuaTuLuot(db, l, de.xemKetQua, input.now, cong.chiDiem) }); // lượt bị gián đoạn KHÔNG có kết quả (không chấm 0, không lộ đáp án)
  return { ok: true, luot: out };
}
