// lib/hoc-bu/case-nhieu-bai-thuan.ts — THUẦN: luật của CASE NHIỀU BÀI + ĐIỂM DANH HAI TẦNG (T07, 08/10/2026). Không chạm DB.
//
// Mô hình:  Case ─< Bài (1..3) ;  Case ─< Participant (bé) ─< Mục (một buổi vắng cần bù, kết quả riêng).
//   · TẦNG 1 — bé có tới buổi bù không (participant: PENDING / PRESENT / ABSENT / REMOVED).
//   · TẦNG 2 — bé có HỌC XONG bài đó không (mục: PLANNED / COMPLETED / NOT_COMPLETED / RELEASED). Không bao giờ tự suy "có mặt ⇒ xong".
//
// Mọi quyết định "chuyển mục từ A sang B thì sổ lượt / dòng cần bù đổi gì" nằm Ở ĐÂY, một bảng duy nhất (`chuyenMuc`) — để phần ghi DB
// chỉ làm theo bảng và để bảng có chỗ cấy lỗi mà không cần Postgres.
import type { MakeupCaseStudentStatus, MakeupItemResult, MakeupParticipantAttendance, MakeupCaseStatus } from "@prisma/client";

export const TOI_DA_BAI_MOI_CASE = 3;

// ── Bộ bài của case ─────────────────────────────────────────────────────────────────────────────────────────────────
export type KetQuaBoBai = { ok: true; ids: string[] } | { ok: false; lyDo: string };

/** Bộ bài hợp lệ: 1..3 bài, không trùng. Giữ nguyên THỨ TỰ người gọi đưa vào (thứ tự = `order` 1..n). */
export function kiemBoBai(lessonIds: readonly string[]): KetQuaBoBai {
  const ids = [...new Set(lessonIds)];
  if (ids.length !== lessonIds.length) return { ok: false, lyDo: "Bộ bài của case có bài bị chọn hai lần" };
  if (ids.length === 0) return { ok: false, lyDo: "Case phải có ít nhất một bài" };
  if (ids.length > TOI_DA_BAI_MOI_CASE) {
    return { ok: false, lyDo: `Một case dạy tối đa ${TOI_DA_BAI_MOI_CASE} bài (đang chọn ${ids.length}) — tách thành case khác` };
  }
  return { ok: true, ids };
}

export type NhomBuV2 = { centerId: string | null; courseId: string; lessonId: string | null; hocVien: string };

/**
 * Nhóm các dòng cần bù chọn CÙNG LÚC để tạo case: cùng cơ sở, cùng khoá, mọi dòng có bài, và số bài khác nhau ≤ 3.
 * (Khác `kiemNhom` cũ: bản cũ bắt mọi bé vắng ĐÚNG MỘT bài.) Trả bộ bài theo thứ tự xuất hiện.
 */
export function kiemNhomNhieuBai(
  be: readonly NhomBuV2[],
): { ok: true; centerId: string; courseId: string; lessonIds: string[] } | { ok: false; lyDo: string } {
  const dau = be[0];
  if (!dau) return { ok: false, lyDo: "Chưa chọn học viên nào" };
  if (!dau.centerId) return { ok: false, lyDo: `${dau.hocVien}: lớp chưa gắn cơ sở — không xếp case được` };
  for (const b of be) {
    if (!b.lessonId) return { ok: false, lyDo: `${b.hocVien}: buổi vắng chưa gắn bài — không xác định được buổi bù` };
    if (b.centerId !== dau.centerId) return { ok: false, lyDo: `${b.hocVien} khác cơ sở — tạo case riêng` };
    if (b.courseId !== dau.courseId) return { ok: false, lyDo: `${b.hocVien} khác khoá — tạo case riêng` };
  }
  const bo = kiemBoBai(be.map((b) => b.lessonId!).filter((x, i, a) => a.indexOf(x) === i));
  if (!bo.ok) return bo;
  return { ok: true, centerId: dau.centerId, courseId: dau.courseId, lessonIds: bo.ids };
}

/** Case có sẵn nhận thêm các dòng này được không: còn SCHEDULED, cùng cơ sở + khoá, và MỌI bài của dòng nằm trong bộ bài của case. */
export function caseNhanThemV2(
  c: { status: string; centerId: string; courseId: string; lessonIds: readonly string[] },
  be: readonly NhomBuV2[],
): { ok: true } | { ok: false; lyDo: string } {
  if (c.status !== "SCHEDULED") return { ok: false, lyDo: "Case đã điểm danh hoặc đã huỷ" };
  for (const b of be) {
    if (b.centerId !== c.centerId) return { ok: false, lyDo: `${b.hocVien} khác cơ sở với case` };
    if (b.courseId !== c.courseId) return { ok: false, lyDo: `${b.hocVien} khác khoá với case` };
    if (!b.lessonId || !c.lessonIds.includes(b.lessonId)) {
      return { ok: false, lyDo: `${b.hocVien} vắng bài không nằm trong bộ bài của case — sửa bộ bài của case hoặc tạo case khác` };
    }
  }
  return { ok: true };
}

// ── Bản gương của `result` sang `status` cũ ─────────────────────────────────────────────────────────────────────────
/**
 * `MakeupCaseStudent.status` là BẢN GƯƠNG của `result` cho mọi nơi đọc cũ. RELEASED có hai nghĩa cũ khác nhau: mục bị GỠ (status
 * RELEASED — không phải "đã điểm danh") và mục của bé VẮNG buổi bù (status ABSENT — đã điểm danh, đúng nghĩa cũ). Người gọi nói rõ
 * là trường hợp nào bằng `beVang`.
 */
export function guongTrangThai(result: MakeupItemResult, beVang: boolean): MakeupCaseStudentStatus {
  switch (result) {
    case "PLANNED":
      return "PLACED";
    case "COMPLETED":
      return "PRESENT";
    case "NOT_COMPLETED":
      return "ABSENT";
    case "RELEASED":
      return beVang ? "ABSENT" : "RELEASED";
  }
}

// ── Chuyển trạng thái MỘT mục ───────────────────────────────────────────────────────────────────────────────────────
/** Việc phải làm với sổ lượt khi chuyển mục (chỉ áp cho mục xếp BẰNG LƯỢT — mục trả phí / miễn phí ngoại lệ không đụng sổ). */
export type ViecLuot =
  | "KHONG" // không đổi sổ
  | "NHA" // held −1
  | "TIEU_TU_GIU" // held −1, consumed +1 (đang giữ)
  | "TIEU_KHONG_GIU" // consumed +1 (lượt đã nhả trước đó, nay tiêu lại — cần còn lượt)
  | "DAO_TIEU"; // consumed −1 (ADJUSTMENT có lý do) — trả lượt đã tiêu

/** Việc phải làm với DÒNG CẦN BÙ (MakeupNeed) khi chuyển mục. */
export type ViecDong =
  | { tu: "SCHEDULED"; sang: "PENDING"; lyDo: "BE_VANG_CASE" | "GO_KHOI_CASE" | "HUY_CASE" }
  | { tu: "SCHEDULED"; sang: "COMPLETED"; lyDo: "BE_CO_MAT_HOAN_THANH" }
  | { tu: "COMPLETED"; sang: "PENDING"; lyDo: "SUA_DIEM_DANH_DAO_NGUOC" }
  | { tu: "PENDING"; sang: "COMPLETED"; lyDo: "SUA_DIEM_DANH_HOAN_THANH" }
  | null;

export type LyDoNha = "BE_VANG" | "GO_KHOI" | "HUY_CASE";

export type ChuyenMuc = { luot: ViecLuot; dong: ViecDong; /** mục có tính là đang chiếm chỗ / đã học (cho gương) */ den: MakeupItemResult };

/**
 * Bảng chuyển trạng thái của MỘT mục. `null` = cạnh không tồn tại (người gọi PHẢI ném, không tự bịa).
 *
 *   PLANNED       → RELEASED       nhả lượt; dòng SCHEDULED→PENDING (lý do theo `lyDoNha`)
 *   PLANNED       → COMPLETED      lượt giữ → đã tiêu; dòng SCHEDULED→COMPLETED
 *   PLANNED       → NOT_COMPLETED  nhả lượt; dòng SCHEDULED→PENDING   (bé có mặt nhưng chưa học xong bài này)
 *   COMPLETED     → NOT_COMPLETED  trả lượt đã tiêu; dòng COMPLETED→PENDING   (sửa điểm danh)
 *   COMPLETED     → RELEASED       trả lượt đã tiêu; dòng COMPLETED→PENDING   (sửa: bé thực ra VẮNG buổi bù)
 *   NOT_COMPLETED → COMPLETED      tiêu lại lượt (cần còn lượt); dòng PENDING→COMPLETED (sửa: thực ra đã xong)
 *   NOT_COMPLETED → RELEASED       không đổi gì (lượt đã nhả, dòng đã PENDING)   (sửa: bé thực ra VẮNG)
 */
export function chuyenMuc(tu: MakeupItemResult, den: MakeupItemResult, dungLuot: boolean, lyDo: LyDoNha): ChuyenMuc | null {
  const luot = (v: ViecLuot): ViecLuot => (dungLuot ? v : "KHONG");
  if (tu === "PLANNED" && den === "RELEASED") {
    const lyDoDong = lyDo === "BE_VANG" ? "BE_VANG_CASE" : lyDo === "GO_KHOI" ? "GO_KHOI_CASE" : "HUY_CASE";
    return { den, luot: luot("NHA"), dong: { tu: "SCHEDULED", sang: "PENDING", lyDo: lyDoDong } };
  }
  if (tu === "PLANNED" && den === "COMPLETED") {
    return { den, luot: luot("TIEU_TU_GIU"), dong: { tu: "SCHEDULED", sang: "COMPLETED", lyDo: "BE_CO_MAT_HOAN_THANH" } };
  }
  if (tu === "PLANNED" && den === "NOT_COMPLETED") {
    return { den, luot: luot("NHA"), dong: { tu: "SCHEDULED", sang: "PENDING", lyDo: "BE_VANG_CASE" } };
  }
  if (tu === "COMPLETED" && (den === "NOT_COMPLETED" || den === "RELEASED")) {
    return { den, luot: luot("DAO_TIEU"), dong: { tu: "COMPLETED", sang: "PENDING", lyDo: "SUA_DIEM_DANH_DAO_NGUOC" } };
  }
  if (tu === "NOT_COMPLETED" && den === "COMPLETED") {
    return { den, luot: luot("TIEU_KHONG_GIU"), dong: { tu: "PENDING", sang: "COMPLETED", lyDo: "SUA_DIEM_DANH_HOAN_THANH" } };
  }
  if (tu === "NOT_COMPLETED" && den === "RELEASED") return { den, luot: "KHONG", dong: null };
  return null;
}

// ── Chốt case ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type KetQuaChot = "CHUA_CHOT" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

/**
 * Case tự chốt khi không còn bé nào PENDING:
 *   · không còn bé nào (mọi người đã bị gỡ) ........ CANCELLED — không ai tới thì không sinh công dạy
 *   · có ít nhất một bé PRESENT .................... COMPLETED
 *   · còn bé nhưng TẤT CẢ ABSENT ................... NO_SHOW — giáo viên có mặt dạy, không bé nào tới
 * Bé REMOVED không được đếm.
 */
export function chotCase(parts: readonly { attendanceStatus: MakeupParticipantAttendance }[]): KetQuaChot {
  const con = parts.filter((p) => p.attendanceStatus !== "REMOVED");
  if (con.length === 0) return "CANCELLED";
  if (con.some((p) => p.attendanceStatus === "PENDING")) return "CHUA_CHOT";
  if (con.some((p) => p.attendanceStatus === "PRESENT")) return "COMPLETED";
  return "NO_SHOW";
}

/** Trạng thái case sau khi chốt, hoặc null nếu giữ nguyên SCHEDULED. */
export const trangThaiCaseSauChot = (k: KetQuaChot): Exclude<MakeupCaseStatus, "SCHEDULED"> | null => (k === "CHUA_CHOT" ? null : k);

// ── Điểm danh tầng 1 → quyết định cho từng mục ──────────────────────────────────────────────────────────────────────
export type MucDiemDanh = { id: string; result: MakeupItemResult; dungLuot: boolean };
export type KetQuaMucNhap = "COMPLETED" | "NOT_COMPLETED";

export type ViecMuc = { id: string; tu: MakeupItemResult; den: MakeupItemResult; chuyen: ChuyenMuc; dungLuot: boolean };

/**
 * Kế hoạch cho các mục của MỘT bé khi điểm danh tầng 1:
 *   · `sau = ABSENT`  mọi mục còn sống (PLANNED / COMPLETED / NOT_COMPLETED) → RELEASED;
 *   · `sau = PRESENT` mỗi mục còn sống PHẢI có kết quả nhập (COMPLETED / NOT_COMPLETED) — KHÔNG bao giờ mặc định "xong".
 * Mục đã RELEASED (đã gỡ trước đó) được bỏ qua. Trả lỗi bằng chữ cho người dùng khi thiếu kết quả / cạnh không hợp lệ.
 */
export function keHoachDiemDanhBe(p: {
  sau: "PRESENT" | "ABSENT";
  muc: readonly MucDiemDanh[];
  ketQua: Readonly<Record<string, KetQuaMucNhap | undefined>>;
}): { ok: true; viec: ViecMuc[] } | { ok: false; lyDo: string } {
  const viec: ViecMuc[] = [];
  const conSong = p.muc.filter((m) => m.result !== "RELEASED");
  if (conSong.length === 0) return { ok: false, lyDo: "Bé này không còn mục nào để điểm danh" };
  for (const m of conSong) {
    let den: MakeupItemResult;
    if (p.sau === "ABSENT") den = "RELEASED";
    else {
      const k = p.ketQua[m.id];
      if (k !== "COMPLETED" && k !== "NOT_COMPLETED") {
        return { ok: false, lyDo: "Bé có mặt: phải chọn từng bài đã học xong hay chưa xong — hệ thống không tự suy" };
      }
      den = k;
    }
    if (m.result === den) continue; // không đổi (sửa lại giữ nguyên mục này)
    const c = chuyenMuc(m.result, den, m.dungLuot, "BE_VANG");
    if (!c) return { ok: false, lyDo: `Không chuyển được mục từ ${m.result} sang ${den}` };
    viec.push({ id: m.id, tu: m.result, den, chuyen: c, dungLuot: m.dungLuot });
  }
  return { ok: true, viec };
}
