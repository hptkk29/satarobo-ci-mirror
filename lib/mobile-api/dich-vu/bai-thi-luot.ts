import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

import { db } from "@/lib/db";
import { markHomeworkAfterAttempt, studentCanAccessExam } from "@/lib/lms/exam-access";
import { CHINH_SACH_MAC_DINH, chamCau, chieuCauHoi, chuanHoaCau, hoanViTheoHat, kiemDeThi, kiemTraTraLoi, tongKetLuot, traLoiSchema, type CauHoiGoc, type ChinhSachCham, type TraLoi } from "@/lib/lms/cham-bai";
import { rateLimit } from "@/lib/rate-limit";
import { getSigningSecret } from "@/lib/security/signing-key";

import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTat, dieuKienDe, duocXemDiem, kyUrlTepMacDinh, lopCuaHocVien, type KyUrl } from "./hoc-tap";

/**
 * LƯỢT THI cho app (B-LMS3): bắt đầu/tiếp tục · khôi phục bản nháp · lưu từng câu · nộp NGUYÊN TỬ · kết quả · lịch sử.
 *
 * Nguyên tắc (mỗi cái có ca test riêng, tiền tố [BT-]):
 *  · MÁY CHỦ giữ đồng hồ: `ExamAttempt.deadlineAt` = min(bắt đầu + thời lượng, đóng đề). Mất mạng KHÔNG tự gia hạn; app chỉ nhận `conLaiGiay` do máy chủ tính.
 *  · BẢN GHIM ĐỀ: lúc bắt đầu chụp toàn bộ câu + đáp án chuẩn vào `contentSnapshot`; chiếu/xáo/chấm đều theo bản này. `phienBanDe` = băm bản ghim; lệch ⇒ 409 `NOI_DUNG_DA_DOI`.
 *  · KHÔNG đáp án xuống client (hình chiếu ALLOW-LIST — lib/lms/cham-bai/chieu.ts); câu trả lời chỉ chấm ở máy chủ.
 *  · IDEMPOTENT: bắt đầu (có lượt dở ⇒ trả lại chính nó; cùng `khoaGuiLai` ⇒ cùng lượt); lưu theo `thuTuGhi` (số ≤ đã nhận bị bỏ qua, không ghi đè bản mới bằng bản cũ); nộp lần hai ⇒ trả đúng kết quả đã có.
 *  · CHẤM: mọi câu chấm máy đi qua `chamCau`; có MỘT câu chấm tay ⇒ cả lượt `CHO_CHAM`. Đề có câu LỖI/không thuộc 13 dạng ⇒ KHÔNG cho bắt đầu (422 `DE_CHUA_HO_TRO`), không bao giờ chấm 0 ngầm.
 *  · KHÔNG thưởng SataCoin, KHÔNG tự đổi chính sách thi: hai quyết định chưa được Owner duyệt nằm trong `ChinhSachThi` (bên dưới).
 * Trong giao dịch CHỈ dùng `tx` (kết nối có trần nhỏ); mọi lượt của CÙNG lượt thi xếp hàng bằng khoá tư vấn.
 */

/** QUYẾT ĐỊNH CHƯA ĐƯỢC OWNER DUYỆT — cô lập ở một chỗ, có test cho cả hai giá trị. */
export type ChinhSachThi = {
  /** Nộp SAU hạn: `NHAN_CAU_DA_LUU` (như web: chấm các câu đã lưu, cờ `tre`) hoặc `TU_CHOI` (422 HET_GIO). Lưu câu mới sau hạn LUÔN bị từ chối. */
  nopTreSauHan: "NHAN_CAU_DA_LUU" | "TU_CHOI";
  cham: ChinhSachCham;
};
export const CHINH_SACH_THI_MAC_DINH: ChinhSachThi = { nopTreSauHan: "NHAN_CAU_DA_LUU", cham: CHINH_SACH_MAC_DINH };

export const GIOI_HAN_THI = {
  batDau: { max: 20, windowMs: 10 * 60_000 },
  luu: { max: 600, windowMs: 10 * 60_000 },
  nop: { max: 20, windowMs: 10 * 60_000 },
} as const;

export const batDauLuotSchema = z.strictObject({ khoaGuiLai: z.string().min(8).max(64) });
export const luuTraLoiSchema = z.strictObject({ phienBanDe: z.string().min(1).max(64), cauHoiId: z.string().min(1).max(64), traLoi: traLoiSchema, thuTuGhi: z.number().int().min(1).max(1_000_000) });
export const nopLuotSchema = z.strictObject({ phienBanDe: z.string().min(1).max(64), khoaGuiLai: z.string().min(8).max(64) });

const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
const TRAN_CAU = 200;

type AnhChupDe = { v: 1; tieuDe: string; thoiLuongPhut: number; tongDiem: number; diemDat: number; xaoCau: boolean; xaoLuaChon: boolean; hienKetQua: boolean; soLuotToiDa: number; cau: CauHoiGoc[] };
const bamAnhChup = (a: AnhChupDe): string => createHash("sha256").update(JSON.stringify(a)).digest("hex").slice(0, 32);
/** Hạt HIỆU LỰC của lượt: trộn bí mật máy chủ — id mờ/xáo không tính lại được từ dữ liệu DB một mình. */
const seedHieuLuc = (seed: string): string => createHmac("sha256", getSigningSecret()).update(`lms-seed|${seed}`).digest("hex");

function docAnhChup(raw: unknown): AnhChupDe {
  const a = raw as AnhChupDe | null;
  if (!a || a.v !== 1 || !Array.isArray(a.cau)) throw new LoiApiMobile("SERVER", 500, "Bản ghim đề của lượt này hỏng — liên hệ trung tâm.");
  return a;
}

// ── DTO ──
export type LuotLamDto = {
  luotId: string; baiThiId: string; tieuDe: string; lanThu: number; soLuotToiDa: number; phienBanDe: string; conLaiGiay: number; tongDiem: number;
  cauHoi: Record<string, unknown>[]; daLuu: Record<string, unknown>;
};
export type KetQuaNopLuotDto = { trangThai: "CHO_CHAM" | "DA_CHAM"; nopLuc: string; tre: boolean; trungLap: boolean };
export type XemLaiDto = { cauHoiId: string; dung: boolean | null; diem: number | null; ghiChu: string | null };
export type KetQuaLuotDto = { luotId: string; tieuDe: string; trangThai: "DANG_LAM" | "CHO_CHAM" | "DA_CHAM"; diem: number | null; tongDiem: number; dat: boolean | null; nhanXet: string | null; nopLuc: string | null; xemLai: XemLaiDto[] | null };

const giay = (hanChot: Date, now: Date) => Math.max(0, Math.floor((hanChot.getTime() - now.getTime()) / 1000));
const hanCuaLuot = (batDau: Date, thoiLuongPhut: number, dongLuc: Date | null): Date => {
  const theoGio = new Date(batDau.getTime() + thoiLuongPhut * 60_000);
  return dongLuc && dongLuc.getTime() < theoGio.getTime() ? dongLuc : theoGio;
};

/** Lấy câu trả lời đã lưu → dạng của hợp đồng. Ưu tiên `answerData` (đã kiểm); dòng cũ từ web dựng lại cho 3 dạng đơn giản. */
function traLoiTuHang(cau: CauHoiGoc, h: { answerData: unknown; selectedChoiceIds: string[]; textAnswer: string | null }): TraLoi | null {
  if (h.answerData) {
    const p = traLoiSchema.safeParse(h.answerData);
    return p.success ? p.data : null;
  }
  const c = chuanHoaCau(cau);
  if (!c.ok) return null;
  if ((c.cau.dang === "chon_mot" || c.cau.dang === "dung_sai") && h.selectedChoiceIds[0]) return { dang: c.cau.dang, luaChonId: h.selectedChoiceIds[0] } as TraLoi;
  if (c.cau.dang === "chon_nhieu" && h.selectedChoiceIds.length) return { dang: "chon_nhieu", luaChonIds: h.selectedChoiceIds };
  if ((c.cau.dang === "ngan" || c.cau.dang === "tu_luan") && h.textAnswer) return { dang: c.cau.dang, vanBan: h.textAnswer };
  return null;
}

type KyTep = Map<string, string | null>;
async function kyAnhCuaDe(cau: readonly CauHoiGoc[], ky: KyUrl): Promise<KyTep> {
  const urls = new Set<string>();
  for (const q of cau) {
    if (q.imageUrl) urls.add(q.imageUrl);
    for (const c of q.choices) if (c.imageUrl) urls.add(c.imageUrl);
    const m = q.meta as { image?: { url?: string } } | null;
    if (q.type === "HOTSPOT" && m?.image?.url) urls.add(m.image.url);
  }
  const kq: KyTep = new Map();
  await Promise.all([...urls].map(async (u) => kq.set(u, await ky(u))));
  return kq;
}

type HangLuot = {
  id: string; examId: string; attemptNo: number; status: string; startedAt: Date; deadlineAt: Date | null; contentSnapshot: unknown; contentHash: string | null; seed: string | null;
  answers: { examQuestionId: string; answerData: unknown; selectedChoiceIds: string[]; textAnswer: string | null }[];
};

/** Dựng LuotLam từ bản ghim (không đọc lại đề sống). */
export async function dungLuotLam(l: HangLuot, now: Date, ky: KyUrl = kyUrlTepMacDinh): Promise<LuotLamDto> {
  if (!l.contentSnapshot || !l.seed || !l.deadlineAt || !l.contentHash) throw khongThay();
  const a = docAnhChup(l.contentSnapshot);
  const hat = seedHieuLuc(l.seed);
  const kyMap = await kyAnhCuaDe(a.cau, ky);
  const thuTu = a.xaoCau ? hoanViTheoHat(hat, "cau", a.cau.length, false) : a.cau.map((_, i) => i);
  const cauHoi: Record<string, unknown>[] = [];
  for (const i of thuTu) {
    const goc = a.cau[i]!;
    const c = chuanHoaCau(goc);
    if (!c.ok) throw new LoiApiMobile("DE_CHUA_HO_TRO", 422, "Đề có câu chưa được hỗ trợ trên ứng dụng.");
    const r = chieuCauHoi(c.cau, { seed: hat, xaoLuaChon: a.xaoLuaChon, kyAnh: (u) => kyMap.get(u) ?? null });
    if (!r.ok) throw new LoiApiMobile("DE_CHUA_HO_TRO", 422, r.loi);
    cauHoi.push(r.cau);
  }
  const daLuu: Record<string, unknown> = {};
  for (const h of l.answers) {
    const goc = a.cau.find((q) => q.id === h.examQuestionId);
    if (!goc) continue;
    const tl = traLoiTuHang(goc, h);
    if (tl) daLuu[goc.id] = tl;
  }
  return { luotId: l.id, baiThiId: l.examId, tieuDe: a.tieuDe, lanThu: l.attemptNo, soLuotToiDa: a.soLuotToiDa, phienBanDe: l.contentHash, conLaiGiay: giay(l.deadlineAt, now), tongDiem: a.tongDiem, cauHoi, daLuu };
}

const CHON_LUOT = { id: true, startKey: true, examId: true, attemptNo: true, status: true, startedAt: true, deadlineAt: true, contentSnapshot: true, contentHash: true, seed: true, answers: { select: { examQuestionId: true, answerData: true, selectedChoiceIds: true, textAnswer: true } } } as const;

async function gioiHan(khoa: string, c: { max: number; windowMs: number }, thongBao: string): Promise<void> {
  const rl = await rateLimit({ key: khoa, max: c.max, windowMs: c.windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, thongBao, Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));
}

// ── BẮT ĐẦU / TIẾP TỤC ──
export async function batDauLuot(hs: MaHocVienDaKiem, examId: string, parentUserId: string, input: z.infer<typeof batDauLuotSchema>, now: Date = new Date(), ky: KyUrl = kyUrlTepMacDinh): Promise<LuotLamDto> {
  batNeuTat();
  await gioiHan(`thi-bat-dau:${parentUserId}`, GIOI_HAN_THI.batDau, "Bạn bắt đầu bài thi quá nhanh. Vui lòng thử lại sau ít phút.");

  // Quyền xem đề: cùng luật với phần ĐỌC (lớp ghi danh đang học, hoặc đề dùng chung đã giao riêng cho học viên).
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) throw khongThay();
  const dk = await dieuKienDe(hs, lop);
  const de = await db.exam.findFirst({
    where: { id: examId, status: dk.status, OR: dk.OR },
    select: { id: true, classId: true, title: true, durationMinutes: true, totalPoints: true, passingScore: true, shuffleQuestions: true, shuffleChoices: true, showResultAfterSubmit: true, maxAttempts: true, openAt: true, closeAt: true },
  });
  if (!de) throw khongThay();
  if (!(await studentCanAccessExam({ studentId: hs, examId: de.id, classId: de.classId }))) throw khongThay();

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`thi-bat-dau:${examId}:${hs}`}, 0))`;

    // Lượt dở (hoặc cùng khoá) ⇒ trả lại chính nó (idempotent). Lượt dở tạo từ WEB chưa có bản ghim ⇒ ghim ngay bây giờ.
    const dang = await tx.examAttempt.findFirst({ where: { examId, studentId: hs, OR: [{ status: "IN_PROGRESS" }, { startKey: input.khoaGuiLai }] }, orderBy: { attemptNo: "desc" }, select: { ...CHON_LUOT } });
    if (dang && dang.status === "IN_PROGRESS" && dang.contentSnapshot) return await dungLuotLam(dang, now, ky);
    if (dang && dang.status !== "IN_PROGRESS") throw new LoiApiMobile("LUOT_DA_NOP", 409, "Lượt thi này đã nộp. Hãy bắt đầu lượt mới bằng khoá gửi lại khác.");

    if (de.openAt && de.openAt.getTime() > now.getTime()) throw new LoiApiMobile("CHUA_MO", 422, "Chưa đến giờ mở đề.");
    if (de.closeAt && de.closeAt.getTime() < now.getTime()) throw new LoiApiMobile("DA_DONG", 422, "Đề thi đã đóng.");

    const qs = await tx.examQuestion.findMany({
      where: { examId },
      orderBy: { order: "asc" },
      select: { id: true, points: true, question: { select: { type: true, text: true, imageUrl: true, correctAnswer: true, meta: true, choices: { orderBy: { order: "asc" }, select: { id: true, order: true, text: true, isCorrect: true, imageUrl: true } } } } },
    });
    if (qs.length === 0) throw new LoiApiMobile("DE_CHUA_HO_TRO", 422, "Đề chưa có câu hỏi.");
    if (qs.length > TRAN_CAU) throw new LoiApiMobile("DE_CHUA_HO_TRO", 422, `Đề có quá ${TRAN_CAU} câu.`);
    const cau: CauHoiGoc[] = qs.map((q) => ({ id: q.id, type: q.question.type, text: q.question.text, imageUrl: q.question.imageUrl, correctAnswer: q.question.correctAnswer, meta: q.question.meta, choices: q.question.choices, points: q.points }));
    const kiem = kiemDeThi(cau);
    if (!kiem.ok) throw new LoiApiMobile("DE_CHUA_HO_TRO", 422, `Đề có ${kiem.loi.length} câu chưa hợp lệ/chưa được hỗ trợ (câu số ${kiem.loi.map((x) => x.thuTu).join(", ")}). Liên hệ giáo viên.`);

    const soLuotToiDa = de.maxAttempts ?? 1;
    const daLam = await tx.examAttempt.count({ where: { examId, studentId: hs } });
    if (!dang && daLam >= soLuotToiDa) throw new LoiApiMobile("HET_LUOT", 422, `Đã hết lượt làm bài (tối đa ${soLuotToiDa} lần).`);

    const anh: AnhChupDe = { v: 1, tieuDe: de.title, thoiLuongPhut: de.durationMinutes, tongDiem: de.totalPoints, diemDat: de.passingScore, xaoCau: de.shuffleQuestions, xaoLuaChon: de.shuffleChoices, hienKetQua: de.showResultAfterSubmit, soLuotToiDa, cau };
    const hash = bamAnhChup(anh);
    const seed = randomBytes(16).toString("hex");
    const han = hanCuaLuot(now, de.durationMinutes, de.closeAt);

    let luot;
    if (dang) {
      // Lượt dở từ web ⇒ ghim đề + hạt + hạn (giữ nguyên giờ bắt đầu thật của lượt).
      luot = await tx.examAttempt.update({ where: { id: dang.id }, data: { contentSnapshot: anh as never, contentHash: hash, seed, startKey: dang.startKey ?? input.khoaGuiLai, deadlineAt: hanCuaLuot(dang.startedAt, de.durationMinutes, de.closeAt) }, select: { ...CHON_LUOT } });
    } else {
      luot = await tx.examAttempt.create({ data: { examId, studentId: hs, status: "IN_PROGRESS", attemptNo: daLam + 1, startedAt: now, contentSnapshot: anh as never, contentHash: hash, seed, startKey: input.khoaGuiLai, deadlineAt: han }, select: { ...CHON_LUOT } });
    }
    return await dungLuotLam(luot, now, ky);
  });
}

/** Khôi phục bản nháp: đọc lượt hiện có (đúng người, còn dở hoặc đã nộp). */
export async function layLuot(hs: MaHocVienDaKiem, attemptId: string, now: Date = new Date(), ky: KyUrl = kyUrlTepMacDinh): Promise<LuotLamDto> {
  batNeuTat();
  const l = await db.examAttempt.findFirst({ where: { id: attemptId, studentId: hs }, select: { ...CHON_LUOT } });
  if (!l || !l.contentSnapshot) throw khongThay();
  if (l.status !== "IN_PROGRESS") throw new LoiApiMobile("LUOT_DA_NOP", 409, "Lượt thi đã nộp.");
  return dungLuotLam(l, now, ky);
}

// ── LƯU TỪNG CÂU ──
export type KetQuaLuuDto = { conLaiGiay: number; boQua: boolean };
export async function luuTraLoi(hs: MaHocVienDaKiem, attemptId: string, parentUserId: string, input: z.infer<typeof luuTraLoiSchema>, now: Date = new Date()): Promise<KetQuaLuuDto> {
  batNeuTat();
  await gioiHan(`thi-luu:${parentUserId}`, GIOI_HAN_THI.luu, "Bạn lưu bài quá nhanh. Vui lòng thử lại sau ít phút.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`thi-luot:${attemptId}`}, 0))`;
    const l = await tx.examAttempt.findFirst({ where: { id: attemptId, studentId: hs }, select: { id: true, status: true, deadlineAt: true, contentSnapshot: true, contentHash: true, seed: true } });
    if (!l || !l.contentSnapshot || !l.seed || !l.deadlineAt) throw khongThay();
    if (l.status !== "IN_PROGRESS") throw new LoiApiMobile("LUOT_DA_NOP", 409, "Lượt thi đã nộp — không lưu thêm được.");
    if (input.phienBanDe !== l.contentHash) throw new LoiApiMobile("NOI_DUNG_DA_DOI", 409, "Đề đã thay đổi. Hãy tải lại lượt làm.");
    if (now.getTime() > l.deadlineAt.getTime()) throw new LoiApiMobile("HET_GIO", 422, "Đã hết giờ làm bài.");

    const a = docAnhChup(l.contentSnapshot);
    const goc = a.cau.find((q) => q.id === input.cauHoiId);
    if (!goc) throw new LoiApiMobile("VALIDATION", 400, "Câu hỏi không thuộc lượt làm này.");
    const c = chuanHoaCau(goc);
    if (!c.ok) throw new LoiApiMobile("DE_CHUA_HO_TRO", 422, c.loi);
    const kt = kiemTraTraLoi(c.cau, input.traLoi, seedHieuLuc(l.seed));
    if (!kt.ok) throw new LoiApiMobile("VALIDATION", 400, kt.loi);

    // Tệp nộp sản phẩm: chỉ nhận vé tải lên ĐÃ XÁC MINH của đúng học viên + đúng lượt + đúng câu.
    if (input.traLoi.dang === "nop_san_pham") {
      const ok = await tx.mobileUpload.count({ where: { id: { in: input.traLoi.tepIds }, studentId: hs, purpose: "EXAM_ANSWER", attemptId, examQuestionId: goc.id, status: { in: ["UPLOADED", "ATTACHED"] } } });
      if (ok !== input.traLoi.tepIds.length) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Tệp chưa tải lên hoặc không thuộc câu hỏi này.");
    }

    const cu = await tx.examAnswer.findUnique({ where: { attemptId_examQuestionId: { attemptId, examQuestionId: goc.id } }, select: { answerSeq: true } });
    if (cu && input.thuTuGhi <= cu.answerSeq) return { conLaiGiay: giay(l.deadlineAt, now), boQua: true }; // đến muộn/trùng: KHÔNG ghi đè bản mới bằng bản cũ

    // Bản sao cho dạng cũ để màn giáo viên trên web vẫn đọc được.
    const tl = input.traLoi;
    const song = {
      selectedChoiceIds: tl.dang === "chon_mot" || tl.dang === "dung_sai" ? [tl.luaChonId] : tl.dang === "chon_nhieu" ? tl.luaChonIds : [],
      textAnswer: tl.dang === "ngan" || tl.dang === "tu_luan" ? tl.vanBan.trim() || null : null,
    };
    const du = { ...song, answerData: tl as never, answerSeq: input.thuTuGhi, answeredAt: now };
    await tx.examAnswer.upsert({ where: { attemptId_examQuestionId: { attemptId, examQuestionId: goc.id } }, create: { attemptId, examQuestionId: goc.id, ...du }, update: du });
    return { conLaiGiay: giay(l.deadlineAt, now), boQua: false };
  });
}

// ── NỘP NGUYÊN TỬ ──
export async function nopLuot(hs: MaHocVienDaKiem, attemptId: string, parentUserId: string, input: z.infer<typeof nopLuotSchema>, now: Date = new Date(), cs: ChinhSachThi = CHINH_SACH_THI_MAC_DINH): Promise<KetQuaNopLuotDto> {
  batNeuTat();
  await gioiHan(`thi-nop:${parentUserId}`, GIOI_HAN_THI.nop, "Bạn nộp bài quá nhanh. Vui lòng thử lại sau ít phút.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`thi-luot:${attemptId}`}, 0))`;
    const l = await tx.examAttempt.findFirst({
      where: { id: attemptId, studentId: hs },
      select: { id: true, examId: true, status: true, submittedAt: true, deadlineAt: true, contentSnapshot: true, contentHash: true, seed: true, answers: { select: { id: true, examQuestionId: true, answerData: true, selectedChoiceIds: true, textAnswer: true } } },
    });
    if (!l || !l.contentSnapshot || !l.seed || !l.deadlineAt) throw khongThay();
    // Nộp lần hai (mọi khoá) ⇒ đúng kết quả đã có, không chấm lại, không ghi gì.
    if (l.status !== "IN_PROGRESS") return { trangThai: l.status === "GRADED" || l.status === "REVIEWED" ? "DA_CHAM" : "CHO_CHAM", nopLuc: (l.submittedAt ?? now).toISOString(), tre: l.submittedAt ? l.submittedAt.getTime() > l.deadlineAt.getTime() : false, trungLap: true };
    if (input.phienBanDe !== l.contentHash) throw new LoiApiMobile("NOI_DUNG_DA_DOI", 409, "Đề đã thay đổi. Hãy tải lại lượt làm.");
    const tre = now.getTime() > l.deadlineAt.getTime();
    if (tre && cs.nopTreSauHan === "TU_CHOI") throw new LoiApiMobile("HET_GIO", 422, "Đã hết giờ làm bài.");

    const a = docAnhChup(l.contentSnapshot);
    const hat = seedHieuLuc(l.seed);
    const ketQua: ReturnType<typeof chamCau>[] = [];
    const ghi: { examQuestionId: string; id?: string; isCorrect: boolean | null; score: number }[] = [];
    for (const goc of a.cau) {
      const c = chuanHoaCau(goc);
      const hang = l.answers.find((x) => x.examQuestionId === goc.id);
      // Câu lỗi chuẩn hoá (không thể xảy ra với đề đã qua cổng bắt đầu) ⇒ CHỜ GIÁO VIÊN, không chấm 0.
      if (!c.ok) { ketQua.push({ trangThai: "cho_cham" }); continue; }
      const tl = hang ? traLoiTuHang(goc, hang) : null;
      const kq = chamCau(c.cau, tl, hat, cs.cham);
      ketQua.push(kq);
      if (kq.trangThai === "tu_dong") ghi.push({ examQuestionId: goc.id, id: hang?.id, isCorrect: kq.dung, score: kq.diem });
    }
    for (const g of ghi) {
      if (g.id) await tx.examAnswer.update({ where: { id: g.id }, data: { isCorrect: g.isCorrect, score: g.score } });
      else await tx.examAnswer.create({ data: { attemptId, examQuestionId: g.examQuestionId, isCorrect: g.isCorrect, score: g.score } });
    }
    const tk = tongKetLuot(ketQua);
    await tx.examAttempt.update({
      where: { id: attemptId },
      data: tk.canGiaoVien ? { status: "SUBMITTED", submittedAt: now } : { status: "GRADED", submittedAt: now, gradedAt: now, totalScore: tk.tongDiem, passed: tk.tongDiem >= a.diemDat },
    });
    // Tệp nộp sản phẩm đã dùng ⇒ ATTACHED (không dùng lại cho lượt khác).
    const tepDung = l.answers.flatMap((x) => { const t = traLoiSchema.safeParse(x.answerData); return t.success && t.data.dang === "nop_san_pham" ? t.data.tepIds : []; });
    if (tepDung.length > 0) await tx.mobileUpload.updateMany({ where: { id: { in: tepDung }, attemptId, studentId: hs, status: "UPLOADED" }, data: { status: "ATTACHED", attachedAt: now } });
    await markHomeworkAfterAttempt(tx, { studentId: hs, examId: l.examId, graded: !tk.canGiaoVien });
    return { trangThai: tk.canGiaoVien ? "CHO_CHAM" : "DA_CHAM", nopLuc: now.toISOString(), tre, trungLap: false };
  });
}

// ── KẾT QUẢ + LỊCH SỬ ──
const TRANG_THAI = { IN_PROGRESS: "DANG_LAM", SUBMITTED: "CHO_CHAM", GRADED: "DA_CHAM", REVIEWED: "DA_CHAM" } as const;

export async function ketQuaLuot(hs: MaHocVienDaKiem, attemptId: string, laHocSinh: boolean): Promise<KetQuaLuotDto> {
  batNeuTat();
  const l = await db.examAttempt.findFirst({
    where: { id: attemptId, studentId: hs },
    select: { id: true, status: true, totalScore: true, passed: true, feedback: true, submittedAt: true, contentSnapshot: true, exam: { select: { title: true, totalPoints: true, showResultAfterSubmit: true } }, answers: { select: { examQuestionId: true, isCorrect: true, score: true, graderNote: true } } },
  });
  if (!l) throw khongThay();
  const trangThai = TRANG_THAI[l.status];
  const hienDiem = await duocXemDiem(laHocSinh);
  const lo = trangThai === "DA_CHAM" && l.exam.showResultAfterSubmit && hienDiem;
  let xemLai: XemLaiDto[] | null = null;
  if (lo) {
    const a = l.contentSnapshot ? docAnhChup(l.contentSnapshot) : null;
    const ids = a ? a.cau.map((q) => q.id) : l.answers.map((x) => x.examQuestionId);
    xemLai = ids.map((id) => { const h = l.answers.find((x) => x.examQuestionId === id); return { cauHoiId: id, dung: h?.isCorrect ?? null, diem: h?.score ?? null, ghiChu: h?.graderNote ?? null }; }); // KHÔNG đáp án đúng, chỉ đúng/sai + điểm + ghi chú giáo viên
  }
  return { luotId: l.id, tieuDe: l.exam.title, trangThai, diem: lo ? l.totalScore : null, tongDiem: l.exam.totalPoints, dat: lo ? l.passed : null, nhanXet: trangThai === "DA_CHAM" && l.exam.showResultAfterSubmit ? l.feedback : null, nopLuc: l.submittedAt ? l.submittedAt.toISOString() : null, xemLai };
}

export type LichSuLuotDto = { muc: { luotId: string; lanThu: number; trangThai: "DANG_LAM" | "CHO_CHAM" | "DA_CHAM"; diem: number | null; tongDiem: number; batDauLuc: string; nopLuc: string | null }[] };
export async function lichSuLuot(hs: MaHocVienDaKiem, examId: string, laHocSinh: boolean): Promise<LichSuLuotDto> {
  batNeuTat();
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) throw khongThay();
  const dk = await dieuKienDe(hs, lop);
  const de = await db.exam.findFirst({ where: { id: examId, status: dk.status, OR: dk.OR }, select: { totalPoints: true, showResultAfterSubmit: true } });
  if (!de) throw khongThay();
  const hienDiem = await duocXemDiem(laHocSinh);
  const ds = await db.examAttempt.findMany({ where: { examId, studentId: hs }, orderBy: { attemptNo: "desc" }, take: 50, select: { id: true, attemptNo: true, status: true, totalScore: true, startedAt: true, submittedAt: true } });
  return { muc: ds.map((x) => { const t = TRANG_THAI[x.status]; return { luotId: x.id, lanThu: x.attemptNo, trangThai: t, diem: t === "DA_CHAM" && de.showResultAfterSubmit && hienDiem ? x.totalScore : null, tongDiem: de.totalPoints, batDauLuc: x.startedAt.toISOString(), nopLuc: x.submittedAt ? x.submittedAt.toISOString() : null }; }) };
}
