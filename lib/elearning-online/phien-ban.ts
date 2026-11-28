import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { caiDatHocTapSchema, docCaiDatHocTap, type CaiDatHocTap } from "./cai-dat-hoc-tap";
import { banNhapHopLe } from "./noi-dung";
import { ChinhSachThieuError, soSanhPhienBan, tinhTacDong, type BaiSoSanh, type ChinhSachTienDo, type HocVienDangHoc, type SoSanhPhienBan, type TacDongTong } from "./phat-hanh";

/**
 * E-LEARNING ONLINE — PHIÊN BẢN: cài đặt học tập · xem trước tác động · PHÁT HÀNH (thiết kế QoCaiDat, QoPhatHanh1–3, V7 §10).
 *
 * Bất biến của giao dịch phát hành:
 * 1. Khoá dòng `OnlCourse` (FOR UPDATE) ⇒ hai lượt phát hành song song xếp hàng; lượt sau không còn bản nháp ⇒ bị từ chối.
 * 2. Tác động ĐƯỢC TÍNH LẠI trong giao dịch; dấu vết (hash) phải KHỚP bản xem trước người dùng đã xác nhận, nếu không ⇒ `TAC_DONG_DA_THAY_DOI`
 *    (có học viên vào/ra hoặc ai đó sửa nháp sau khi xem trước) — không phát hành theo con số người dùng chưa thấy.
 * 3. Chính sách tiến độ BẮT BUỘC từ bản thứ 2 trở đi, không mặc định.
 * 4. Thứ tự lật: bản chạy cũ → SUPERSEDED TRƯỚC, bản nháp → PUBLISHED SAU (chỉ mục duy nhất từng phần: một bản PUBLISHED/khoá).
 * 5. Chỉ đụng `OnlLessonProgress` của bài PHẢI HỌC LẠI (status/percent/completedAt về trạng thái chưa học). KHÔNG đụng `bestScore`, điểm, bài nộp,
 *    chứng nhận, lịch sử quyền học.
 */

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type MaLoiPhienBan =
  | "KHOA_KHONG_TON_TAI"
  | "BAN_KHONG_TON_TAI"
  | "BAN_KHONG_PHAI_NHAP"
  | "KHONG_CO_BAN_NHAP"
  | "CAI_DAT_KHONG_HOP_LE"
  | "THIEU_CHINH_SACH"
  | "CHINH_SACH_KHONG_HOP_LE"
  | "CHUA_DAT_CONG_CHAT_LUONG"
  | "TAC_DONG_DA_THAY_DOI"
  | "THIEU_DAU_VET";
export type Fail = { ok: false; ma: MaLoiPhienBan; thongBao: string };
const fail = (ma: MaLoiPhienBan, thongBao: string): Fail => ({ ok: false, ma, thongBao });

// ───────── Cài đặt học tập ─────────

export const luuCaiDatSchema = z.object({ versionId: z.string().min(1), caiDat: caiDatHocTapSchema }).strict();
export type LuuCaiDatInput = z.infer<typeof luuCaiDatSchema>;

export async function luuCaiDat(db: Db, input: LuuCaiDatInput): Promise<{ ok: true; truoc: CaiDatHocTap | null; sau: CaiDatHocTap } | Fail> {
  const h = await banNhapHopLe(db, input.versionId);
  if (!h.ok) return fail(h.ma === "BAN_KHONG_TON_TAI" ? "BAN_KHONG_TON_TAI" : "BAN_KHONG_PHAI_NHAP", h.thongBao);
  const cu = await db.onlCourseVersion.findUniqueOrThrow({ where: { id: input.versionId }, select: { settingsJson: true } });
  const truoc = docCaiDatHocTap(cu.settingsJson);
  await db.onlCourseVersion.update({ where: { id: input.versionId }, data: { settingsJson: input.caiDat as object } });
  return { ok: true, truoc: truoc.ok ? truoc.caiDat : null, sau: input.caiDat };
}

// ───────── Chính sách tiến độ (đầu vào phát hành) ─────────

export const chinhSachSchema = z.discriminatedUnion("loai", [
  z.object({ loai: z.literal("KEEP_PROGRESS") }).strict(),
  z.object({ loai: z.literal("RELEARN_SELECTED"), baiHocLai: z.array(z.string().min(1)).max(2000) }).strict(),
  z.object({ loai: z.literal("RESET_BY_SCOPE"), chuongStableIds: z.array(z.string().min(1)).min(1).max(500), entitlementIds: z.array(z.string().min(1)).max(100_000).optional() }).strict(),
  z.object({ loai: z.literal("ADD_NEW_ONLY") }).strict(),
]);

// ───────── Đọc bản → đầu vào của hàm thuần ─────────

type BanDayDu = {
  id: string;
  number: number;
  settingsJson: unknown;
  chapters: { id: string; stableId: string; title: string; orderIndex: number; hidden: boolean }[];
  lessons: { stableId: string; chapterId: string; kind: string; title: string; required: boolean; hidden: boolean; freePreview: boolean; orderIndex: number; durationSec: number | null; passPercent: number | null; contentJson: unknown }[];
};

async function docBan(tx: Db | Tx, versionId: string): Promise<BanDayDu> {
  const b = await tx.onlCourseVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: {
      id: true, number: true, settingsJson: true,
      chapters: { orderBy: { orderIndex: "asc" }, select: { id: true, stableId: true, title: true, orderIndex: true, hidden: true } },
      lessons: { select: { stableId: true, chapterId: true, kind: true, title: true, required: true, hidden: true, freePreview: true, orderIndex: true, durationSec: true, passPercent: true, contentJson: true } },
    },
  });
  return b;
}

const bam = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

/** Khoá của JSON ổn định (sắp xếp khoá) để băm không phụ thuộc thứ tự khoá lưu. */
function chuanHoa(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(chuanHoa);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, chuanHoa(x)]));
  return v;
}

/** Bài của một bản → `BaiSoSanh`. Bài trong chương ẨN coi như ẩn. `thuTu` toàn khoá = (thứ tự chương, thứ tự bài). */
export function baiSoSanhTuBan(ban: BanDayDu): BaiSoSanh[] {
  const chuong = new Map(ban.chapters.map((c) => [c.id, c]));
  const sapXep = [...ban.lessons].sort((a, b) => (chuong.get(a.chapterId)?.orderIndex ?? 0) - (chuong.get(b.chapterId)?.orderIndex ?? 0) || a.orderIndex - b.orderIndex);
  return sapXep.map((b, i) => {
    const c = chuong.get(b.chapterId)!;
    return {
      stableId: b.stableId,
      chapterStableId: c.stableId,
      title: b.title,
      kind: b.kind,
      required: b.required,
      hidden: b.hidden || c.hidden,
      noiDungHash: bam(chuanHoa({ k: b.kind, c: b.contentJson, d: b.durationSec, p: b.passPercent })),
      thuTu: i,
    };
  });
}

function tenBai(ban: BanDayDu): XemTruocPhatHanh["bai"] {
  const ch = new Map(ban.chapters.map((c) => [c.id, c.title]));
  return Object.fromEntries(ban.lessons.map((b) => [b.stableId, { title: b.title, chapterTitle: ch.get(b.chapterId) ?? "", kind: b.kind }]));
}

function tenChuong(ban: BanDayDu): XemTruocPhatHanh["chuong"] {
  return [...ban.chapters].sort((a, b) => a.orderIndex - b.orderIndex).map((c) => ({ stableId: c.stableId, title: c.title }));
}

// ───────── Cổng chất lượng ─────────

export type CanhBaoChatLuong = { ma: string; muc: "LOI" | "CANH_BAO"; thongBao: string };

export function kiemTraChatLuong(ban: BanDayDu): CanhBaoChatLuong[] {
  const kq: CanhBaoChatLuong[] = [];
  const cd = docCaiDatHocTap(ban.settingsJson);
  if (!cd.ok) kq.push({ ma: "CAI_DAT_KHONG_HOP_LE", muc: "LOI", thongBao: "Cài đặt học tập của bản nháp không hợp lệ — lưu lại ở tab Cài đặt" });
  const chuong = new Map(ban.chapters.map((c) => [c.id, c]));
  const hien = ban.lessons.filter((b) => !b.hidden && !chuong.get(b.chapterId)?.hidden);
  const batBuoc = hien.filter((b) => b.required && b.kind !== "FINAL_EXAM");
  if (hien.length === 0) kq.push({ ma: "KHONG_CO_BAI", muc: "LOI", thongBao: "Bản chưa có bài nào hiển thị" });
  else if (batBuoc.length === 0) kq.push({ ma: "KHONG_CO_BAI_BAT_BUOC", muc: "LOI", thongBao: "Cần ít nhất một bài bắt buộc (không tính bài thi cuối) — không thì khoá không bao giờ hoàn thành" });
  for (const c of ban.chapters) {
    if (!c.hidden && !ban.lessons.some((b) => b.chapterId === c.id && !b.hidden)) kq.push({ ma: "CHUONG_RONG", muc: "CANH_BAO", thongBao: `Chương "${c.title}" chưa có bài hiển thị` });
  }
  const thi = hien.filter((b) => b.kind === "FINAL_EXAM");
  if (cd.ok && cd.caiDat.thiCuoiKhoa.bat && thi.length !== 1) kq.push({ ma: "THI_CUOI_KHONG_KHOP", muc: "LOI", thongBao: cd.caiDat.thiCuoiKhoa.bat && thi.length === 0 ? "Bật thi cuối khoá nhưng bản chưa có bài thi cuối" : "Bản có nhiều hơn một bài thi cuối" });
  if (cd.ok && !cd.caiDat.thiCuoiKhoa.bat && thi.length > 0) kq.push({ ma: "THI_CUOI_KHONG_BAT", muc: "CANH_BAO", thongBao: "Có bài thi cuối nhưng cài đặt đang tắt thi cuối khoá" });
  for (const b of hien) {
    const nd = (b.contentJson ?? {}) as Record<string, unknown>;
    if (b.kind === "VIDEO" && !nd.mediaRef) kq.push({ ma: "VIDEO_CHUA_CO_MEDIA", muc: "CANH_BAO", thongBao: `Bài video "${b.title}" chưa gắn nguồn video` });
    if ((b.kind === "ASSIGNMENT" || b.kind === "QUIZ" || b.kind === "FINAL_EXAM") && !nd.assessmentId) kq.push({ ma: "BAI_DANH_GIA_CHUA_GAN", muc: "CANH_BAO", thongBao: `Bài "${b.title}" chưa gắn nội dung đánh giá` });
  }
  return kq;
}

// ───────── Xem trước tác động ─────────

export type XemTruocPhatHanh = {
  laBanDauTien: boolean;
  soBanNhap: number;
  soSanh: SoSanhPhienBan | null;
  tacDong: TacDongTong | null;
  chatLuong: CanhBaoChatLuong[];
  /** Băm của (so sánh + chính sách + tập học viên + tiến độ) — người dùng xác nhận THEO dấu này. */
  dauVet: string;
  soHocVienDangHoc: number;
  /** Tên + chương của mọi bài xuất hiện ở so sánh (hai bản) — để giao diện hiện tên thay vì mã. */
  bai: Record<string, { title: string; chapterTitle: string; kind: string }>;
  /** Chương (stableId + tên) của hai bản — cho chính sách "đặt lại theo chương". */
  chuong: { stableId: string; title: string }[];
};

async function tinhXemTruoc(tx: Db | Tx, courseId: string, chinhSach: ChinhSachTienDo | null): Promise<(XemTruocPhatHanh & { nhapId: string; chayId: string | null }) | Fail> {
  const khoa = await tx.onlCourse.findFirst({ where: { id: courseId, deletedAt: null }, select: { publishedVersionId: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  const nhap = await tx.onlCourseVersion.findFirst({ where: { courseId, status: "DRAFT" }, select: { id: true, number: true } });
  if (!nhap) return fail("KHONG_CO_BAN_NHAP", "Khoá chưa có bản nháp để phát hành");
  const banNhap = await docBan(tx, nhap.id);
  const chatLuong = kiemTraChatLuong(banNhap);
  const chayId = khoa.publishedVersionId;
  if (!chayId) {
    return { laBanDauTien: true, soBanNhap: nhap.number, soSanh: null, tacDong: null, chatLuong, dauVet: bam({ dau: nhap.id, chatLuong }), soHocVienDangHoc: 0, bai: tenBai(banNhap), chuong: tenChuong(banNhap), nhapId: nhap.id, chayId: null };
  }
  const banChay = await docBan(tx, chayId);
  const cu = baiSoSanhTuBan(banChay);
  const moi = baiSoSanhTuBan(banNhap);
  const soSanh = soSanhPhienBan(cu, moi);

  const quyen = await tx.onlEntitlement.findMany({ where: { courseId, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } });
  const tienDo = quyen.length
    ? await tx.onlLessonProgress.findMany({ where: { entitlementId: { in: quyen.map((q) => q.id) }, status: "COMPLETED" }, select: { entitlementId: true, lessonStableId: true } })
    : [];
  const xong = new Map<string, Set<string>>();
  for (const t of tienDo) (xong.get(t.entitlementId) ?? xong.set(t.entitlementId, new Set()).get(t.entitlementId)!).add(t.lessonStableId);
  const hocVien: HocVienDangHoc[] = quyen.map((q) => ({ entitlementId: q.id, daXong: xong.get(q.id) ?? new Set(), daCoChungNhan: false }));

  let tacDong: TacDongTong | null = null;
  if (chinhSach) tacDong = tinhTacDong({ cu, moi, hocVien, chinhSach });
  const dauVet = bam({
    chay: chayId, nhap: nhap.id, soSanh, chinhSach, chatLuong,
    hv: hocVien.map((h) => [h.entitlementId, [...h.daXong].sort()]),
  });
  return { laBanDauTien: false, soBanNhap: nhap.number, soSanh, tacDong, chatLuong, dauVet, soHocVienDangHoc: quyen.length, bai: { ...tenBai(banChay), ...tenBai(banNhap) }, chuong: [...new Map([...tenChuong(banChay), ...tenChuong(banNhap)].map((c) => [c.stableId, c])).values()], nhapId: nhap.id, chayId };
}

export async function xemTruocPhatHanh(db: Db, courseId: string, chinhSach: ChinhSachTienDo | null): Promise<{ ok: true; xemTruoc: XemTruocPhatHanh } | Fail> {
  let r;
  try {
    r = await tinhXemTruoc(db, courseId, chinhSach);
  } catch (e) {
    if (e instanceof ChinhSachThieuError) return fail("THIEU_CHINH_SACH", e.message);
    throw e;
  }
  if ("ok" in r && r.ok === false) return r;
  const { nhapId: _n, chayId: _c, ...xt } = r as XemTruocPhatHanh & { nhapId: string; chayId: string | null };
  return { ok: true, xemTruoc: xt };
}

// ───────── PHÁT HÀNH ─────────

export const phatHanhSchema = z
  .object({
    courseId: z.string().min(1),
    /** Bắt buộc từ bản thứ 2; bản đầu tiên bỏ trống. */
    chinhSach: chinhSachSchema.nullable().optional(),
    /** Dấu vết của lượt XEM TRƯỚC người dùng đã xác nhận. */
    dauVet: z.string().min(8),
    /** Gõ chính xác để xác nhận (QoPhatHanh3). */
    xacNhan: z.literal("PHAT HANH"),
  })
  .strict();
export type PhatHanhInput = z.infer<typeof phatHanhSchema>;

export type KetQuaPhatHanh = { ok: true; versionId: string; number: number; tacDong: TacDongTong | null; soTienDoDatLai: number } | Fail;

export async function phatHanh(db: Db, input: PhatHanhInput, actorUserId: string | null, now: Date): Promise<KetQuaPhatHanh> {
  return db.$transaction(
    async (tx): Promise<KetQuaPhatHanh> => {
      await tx.$queryRaw`SELECT "id" FROM "OnlCourse" WHERE "id" = ${input.courseId} FOR UPDATE`;

      let r;
      try {
        r = await tinhXemTruoc(tx, input.courseId, input.chinhSach ?? null);
      } catch (e) {
        if (e instanceof ChinhSachThieuError) return fail("THIEU_CHINH_SACH", e.message);
        throw e;
      }
      if ("ok" in r && r.ok === false) return r;
      const xt = r as XemTruocPhatHanh & { nhapId: string; chayId: string | null };

      // ── CỔNG (chưa ghi gì) ──
      if (!xt.laBanDauTien && !input.chinhSach) return fail("THIEU_CHINH_SACH", "Chính sách tiến độ là bắt buộc khi phát hành bản mới — không có lựa chọn mặc định");
      const loi = xt.chatLuong.filter((c) => c.muc === "LOI");
      if (loi.length) return fail("CHUA_DAT_CONG_CHAT_LUONG", loi.map((l) => l.thongBao).join("; "));
      if (xt.dauVet !== input.dauVet) return fail("TAC_DONG_DA_THAY_DOI", "Dữ liệu đã thay đổi sau khi bạn xem trước (bản nháp, học viên hoặc tiến độ) — xem trước lại rồi xác nhận");

      // ── GHI ──
      if (xt.chayId) await tx.onlCourseVersion.update({ where: { id: xt.chayId }, data: { status: "SUPERSEDED" } });
      const soSanhTomTat = xt.soSanh ? { them: xt.soSanh.them.length, sua: xt.soSanh.sua.length, an: xt.soSanh.an.length, hienLai: xt.soSanh.hienLai.length, doiThuTu: xt.soSanh.doiThuTu.length, bien: xt.soSanh.bien.length } : null;
      const batDau = xt.tacDong?.chiTiet.filter((c) => c.phaiHocLai.length > 0 || c.phaiHocMoi.length > 0).slice(0, 5000) ?? [];
      await tx.onlCourseVersion.update({
        where: { id: xt.nhapId },
        data: {
          status: "PUBLISHED",
          publishedAt: now,
          publishedByUserId: actorUserId,
          progressPolicy: input.chinhSach ? input.chinhSach.loai : null,
          progressPolicyDetailJson: input.chinhSach ? (input.chinhSach as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          changeSummaryJson: soSanhTomTat ? (soSanhTomTat as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          impactJson: xt.tacDong
            ? ({ soHocVien: xt.tacDong.soHocVien, soBiAnhHuong: xt.tacDong.soBiAnhHuong, soPhaiHocLai: xt.tacDong.soPhaiHocLai, matChungNhan: 0, chiTiet: batDau } as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      });
      await tx.onlCourse.update({ where: { id: input.courseId }, data: { publishedVersionId: xt.nhapId } });

      // Đặt lại tiến độ CHỈ các bài phải học lại. Không đụng bestScore/điểm/chứng nhận.
      let soDatLai = 0;
      for (const ct of xt.tacDong?.chiTiet ?? []) {
        if (!ct.phaiHocLai.length) continue;
        const kq = await tx.onlLessonProgress.updateMany({
          where: { entitlementId: ct.entitlementId, lessonStableId: { in: ct.phaiHocLai }, status: "COMPLETED" },
          data: { status: "NOT_STARTED", percent: 0, completedAt: null, completedVersionNumber: null },
        });
        soDatLai += kq.count;
      }
      return { ok: true, versionId: xt.nhapId, number: xt.soBanNhap, tacDong: xt.tacDong, soTienDoDatLai: soDatLai };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

// ───────── Lịch sử phiên bản ─────────

export async function lichSuPhienBan(db: Db, courseId: string) {
  return db.onlCourseVersion.findMany({
    where: { courseId },
    orderBy: { number: "desc" },
    select: { id: true, number: true, status: true, publishedAt: true, publishedByUserId: true, progressPolicy: true, changeSummaryJson: true, impactJson: true, createdAt: true },
  });
}
