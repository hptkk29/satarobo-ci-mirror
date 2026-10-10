// lib/classes/buoi-ghi.ts — NƠI DUY NHẤT quyết định "ghi buổi học của một lớp có an toàn không" (T03, 07/10/2026).
//
// Trước T03 có 21 lời gọi ghi `ClassSession` (10 tệp) và KHÔNG CÁI NÀO khoá, không cái nào kiểm lại `date`/`status`
// trong lúc ghi, không cái nào bắt lỗi trùng đúng nguyên nhân. Hai việc đo được:
//   · `generateClassSessions` đọc `count()` rồi `createMany` không khoá — bấm hai lần (hoặc hai tab) sinh GẤP ĐÔI buổi.
//   · mọi đường dời hàng loạt tính kế hoạch ở NGOÀI giao dịch rồi `update` theo id, không kiểm ngày cũ ⇒ một lượt xen
//     giữa (đổi buổi, hoàn tất buổi) bị đè mất.
//
// Ba thứ ở đây, và CHỈ ba thứ đó:
//   1. `khoaLopBuoi`  — khoá cố vấn (advisory) theo LỚP trong giao dịch: mọi lượt ghi buổi của MỘT lớp xếp hàng.
//   2. `dichNgayBuoi` / `themBuoi` / `themNhieuBuoi` — ghi dưới khoá, kiểm lại trạng thái dưới khoá, từ chối thay vì đoán.
//   3. `dauSuaTay`    — dấu "chỉnh tay": MỘT hàm, mọi đường sửa tay gọi (lưới `[BGW-*]` canh).
//
// KHOÁ LÀ HÀNG RÀO CHÍNH. Chỉ mục duy nhất từng phần `ClassSession_class_date_active_key` là hàng rào CUỐI và có thể
// chưa tồn tại (migration bỏ qua nó khi dữ liệu còn trùng) — mã ở đây KHÔNG được dựa vào nó để đúng.
import "server-only";
import { Prisma } from "@prisma/client";
import { lapThuTuDich, type DoiNgay } from "@/lib/classes/dich-ngay";
import { vnHm } from "@/lib/classes/slots";
import { vnYmd } from "@/lib/time/vn";

type Tx = Prisma.TransactionClient;

export const TEN_CHI_MUC_BUOI = "ClassSession_class_date_active_key";

export type MaLoiLichLop = "BUOI_DA_DOI" | "TRUNG_BUOI" | "XUNG_DOT_LICH";

/** Lỗi nghiệp vụ của ghi lịch lớp — `message` nói được thẳng với người dùng. */
export class LoiLichLop extends Error {
  constructor(
    readonly ma: MaLoiLichLop,
    message: string,
  ) {
    super(message);
    this.name = "LoiLichLop";
  }
}

const ngayGio = (d: Date) => `${vnYmd(d).split("-").reverse().join("/")} ${vnHm(d)}`;

export const cauBuoiDaDoi = "Lịch của lớp vừa được người khác sửa trong lúc bạn thao tác — tải lại trang rồi làm lại.";
const cauTrung = (d: Date) => `Lớp đã có một buổi học vào ${ngayGio(d)} — không xếp thêm buổi trùng giờ.`;

/** Khoá cố vấn theo LỚP, tự nhả khi giao dịch kết thúc. `$executeRaw`, KHÔNG `$queryRaw` (hàm trả void). */
export async function khoaLopBuoi(tx: Tx, classId: string): Promise<void> {
  const khoa = `lop-buoi:${classId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${khoa}))`;
}

/**
 * Dấu "chỉnh tay" — buổi do NGƯỜI đặt (đổi ngày/phòng/GV, hoặc tạo tay). Các lần áp lại lịch tự động coi nó là buổi
 * KHOÁ. `now` BẮT BUỘC (luật 19: không đọc đồng hồ ngầm), `actorId` null khi không rõ người thao tác.
 */
export function dauSuaTay(actorId: string | null, now: Date) {
  return { manualOverride: true, manualOverrideAt: now, manualOverrideById: actorId } as const;
}

const BO_DAU_SUA_TAY = { manualOverride: false, manualOverrideAt: null, manualOverrideById: null } as const;

/** Dịch lỗi trùng buổi (của ta, hoặc P2002 trên đúng chỉ mục của ta) sang `LoiLichLop`; không phải thì null. */
export function dichLoiTrungBuoi(err: unknown): LoiLichLop | null {
  if (err instanceof LoiLichLop) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    // Chỉ mục từng phần KHÔNG có trong schema nên Prisma báo `target` là CỘT (["classId","date"]) chứ không phải tên chỉ mục
    // (đo trên Postgres thật, 07/10/2026). Nhận cả hai dạng: tên chỉ mục (driver khác) hoặc đúng cặp cột này.
    const target = err.meta?.target;
    const cot = Array.isArray(target) ? target.map(String) : [];
    const chu = Array.isArray(target) ? target.join(",") : String(target ?? "");
    const dungCot = err.meta?.modelName === "ClassSession" && cot.length === 2 && cot.includes("classId") && cot.includes("date");
    if (dungCot || chu.includes(TEN_CHI_MUC_BUOI)) {
      return new LoiLichLop("TRUNG_BUOI", "Lớp đã có một buổi học vào đúng thời điểm này — không xếp thêm buổi trùng giờ.");
    }
  }
  return null;
}

/**
 * DỜI NGÀY một lô buổi của MỘT lớp. Gọi BÊN TRONG giao dịch; tự khoá lớp rồi mới đọc.
 *
 *  · mỗi buổi phải vẫn ĐÚNG ngày cũ + còn SCHEDULED dưới khoá — kế hoạch tính ngoài giao dịch có thể đã cũ;
 *  · đích không được đè buổi KHÁC còn sống của lớp (kể cả buổi không đổi);
 *  · thứ tự UPDATE do `lapThuTuDich` quyết: không lúc nào hai buổi cùng chỗ (cuốn chiếu đi từ cuối, vòng thì đỗ);
 *  · `xoaSuaTay`: buổi được dời CHÍNH BẰNG kế hoạch thì không còn là "chỉnh tay" — nó đi theo lịch lại.
 *    BẮT BUỘC khai (luật 7).
 * Từ chối = `throw LoiLichLop` ⇒ giao dịch của người gọi rollback; không ghi nửa chừng.
 */
export async function dichNgayBuoi(
  tx: Tx,
  p: { classId: string; moves: readonly DoiNgay[]; xoaSuaTay: boolean },
): Promise<{ daDoi: number; soBuocDo: number }> {
  if (p.moves.length === 0) return { daDoi: 0, soBuocDo: 0 };
  await khoaLopBuoi(tx, p.classId);

  const dang = await tx.classSession.findMany({
    where: { classId: p.classId, status: { not: "CANCELLED" } },
    select: { id: true, date: true, status: true },
  });
  const theoId = new Map(dang.map((s) => [s.id, s]));
  for (const m of p.moves) {
    const s = theoId.get(m.id);
    if (!s || s.date.getTime() !== m.oldDate.getTime() || s.status !== "SCHEDULED") {
      throw new LoiLichLop("BUOI_DA_DOI", cauBuoiDaDoi);
    }
  }

  const ids = new Set(p.moves.map((m) => m.id));
  const kh = lapThuTuDich(
    p.moves,
    dang.filter((s) => !ids.has(s.id)).map((s) => s.date),
  );
  if (!kh.ok) {
    if (kh.loi.ma === "LAP_ID" || kh.loi.ma === "KHONG_LAP_DUOC") throw new LoiLichLop("BUOI_DA_DOI", cauBuoiDaDoi);
    throw new LoiLichLop("TRUNG_BUOI", cauTrung(kh.loi.ngay));
  }

  for (const b of kh.buoc) {
    const r = await tx.classSession.updateMany({
      where: { id: b.id, classId: p.classId, date: b.tu, status: "SCHEDULED" },
      data: { date: b.den, ...(!b.tam && p.xoaSuaTay ? BO_DAU_SUA_TAY : {}) },
    });
    if (r.count !== 1) throw new LoiLichLop("BUOI_DA_DOI", cauBuoiDaDoi);
  }
  return { daDoi: kh.buoc.filter((b) => !b.tam).length, soBuocDo: kh.buoc.filter((b) => b.tam).length };
}

/**
 * THÊM một buổi. Khoá lớp, từ chối nếu lớp đã có buổi CÒN SỐNG cùng thời điểm. `suaTay` có ⇒ buổi mang dấu chỉnh tay
 * (buổi do người tạo tay); không ⇒ buổi do hệ thống sinh.
 */
export async function themBuoi(
  tx: Tx,
  data: Prisma.ClassSessionUncheckedCreateInput,
  suaTay: { actorId: string | null; now: Date } | null,
): Promise<{ id: string }> {
  await khoaLopBuoi(tx, data.classId);
  if ((data.status ?? "SCHEDULED") !== "CANCELLED") {
    const trung = await tx.classSession.findFirst({
      where: { classId: data.classId, date: data.date as Date, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (trung) throw new LoiLichLop("TRUNG_BUOI", cauTrung(data.date as Date));
  }
  return tx.classSession.create({
    data: { ...data, ...(suaTay ? dauSuaTay(suaTay.actorId, suaTay.now) : {}) },
    select: { id: true },
  });
}

/**
 * SINH một lô buổi cho lớp — IDEMPOTENT: gọi bao nhiêu lần, từ bao nhiêu tab, mỗi thời điểm chỉ có MỘT buổi còn sống.
 *  · `chiKhiRong`: lớp đã có BẤT KỲ buổi nào (kể cả đã huỷ) ⇒ không sinh gì;
 *  · không thì chỉ chèn những thời điểm CHƯA có buổi còn sống (buổi đã huỷ không chặn: sinh lại đúng giờ đó là hợp lệ).
 * Trả số buổi thực sự chèn và số bị bỏ vì đã có.
 */
export async function themNhieuBuoi(
  tx: Tx,
  p: { classId: string; data: readonly Prisma.ClassSessionCreateManyInput[]; chiKhiRong: boolean },
): Promise<{ generated: number; skipped: number; daCoBuoi: boolean }> {
  await khoaLopBuoi(tx, p.classId);
  const hien = await tx.classSession.findMany({
    where: { classId: p.classId },
    select: { date: true, status: true },
  });
  if (p.chiKhiRong && hien.length > 0) return { generated: 0, skipped: p.data.length, daCoBuoi: true };
  const coRoi = new Set(hien.filter((s) => s.status !== "CANCELLED").map((s) => s.date.getTime()));
  const moi: Prisma.ClassSessionCreateManyInput[] = [];
  for (const d of p.data) {
    const k = (d.date as Date).getTime();
    if (coRoi.has(k)) continue;
    coRoi.add(k); // lô tự trùng nhau (không nên xảy ra) cũng chỉ lấy MỘT
    moi.push(d);
  }
  if (moi.length > 0) await tx.classSession.createMany({ data: moi });
  return { generated: moi.length, skipped: p.data.length - moi.length, daCoBuoi: hien.length > 0 };
}
