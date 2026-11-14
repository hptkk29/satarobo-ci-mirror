// lib/lms/session-order.ts — "buổi thứ mấy" + thứ tự hiển thị danh sách buổi.
//
// Một chỗ duy nhất trả lời hai câu mà trước 21/08 mỗi màn tự trả lời một kiểu (hoặc
// không trả lời được):
//   1. Buổi này là BUỔI SỐ MẤY của lớp?  → buildSessionNumberMap
//   2. Danh sách buổi phải xếp thế nào?  → sortSessionsForWork
//
// ⚠️ 08/09/2026 — FILE NÀY TỪNG TRẢ LỜI HAI CÂU HỎI BẰNG MỘT CON SỐ. Đó là gốc của sự
// cố "lệch tên bài" (xem `docs/dieu-tra-lech-bai-hoc.md`). Nay tách đôi:
//
//   · THỨ TỰ LỘ TRÌNH  → `soBuoiTheoLoTrinh`  — buổi này là BÀI thứ mấy của giáo trình.
//                        Dùng để IN NHÃN.
//   · THỨ TỰ THỜI GIAN → `soBuoiTheoLich`     — buổi này là buổi thứ mấy theo NGÀY.
//                        Dùng để SẮP XẾP, và làm nấc CUỐI của nhãn.
//
// Hai thứ này KHÁC NHAU ngay khi một buổi bị dời ngày. Đo prod 08/09: lớp
// `CS2.SATA6.26.001` có 6 buổi mang bài 43–48 bị dời lên tháng 6–7, nên nhãn ghép
// "Buổi {hạng ngày}" với "{tên bài theo FK}" đọc ra "Buổi 2 — bài 43".
//
// ── VÌ SAO BẢN CŨ KHÔNG DÙNG plan.order, VÀ VÌ SAO NAY DÙNG ───────────────────────
// Câu cũ ở đây là: *"Không lấy ClassSessionPlan.seq / Lesson.order làm nguồn: hai cột
// đó rỗng ở lớp không ghim giáo trình và bị SetNull khi dời/huỷ buổi."*
//
// Câu đó nay SAI VỚI DỮ LIỆU nhưng VẪN ĐÚNG VỚI MÃ. Đo prod 08/09:
//   · 16/16 lớp ghim giáo trình · 687/687 buổi có `planId`
//   · 16/16 lớp `plan.order` liên tục 0..N-1, 0 lớp trùng, 0 lớp hổng
//   · 0 buổi có `lessonId` khác lesson của plan chính nó
// ⇒ `plan.order` phủ 100 % prod hôm nay.
//
// Nhưng hai đường vẫn còn đẻ ra buổi KHÔNG plan, nên fallback là BẮT BUỘC:
//   · `lib/classes/generate.ts:169-199` — nhánh lớp chưa ghim giáo trình;
//   · `ClassSession.planId` là `onDelete: SetNull` — xoá một plan là buổi mất plan
//     trong im lặng.
//
// (1) `soBuoiTheoLich` = HẠNG theo NGÀY tăng dần TRONG TỪNG LỚP (1-based), tính trên
// TOÀN BỘ buổi của lớp — kể cả buổi đã huỷ, vì bỏ chúng ra sẽ làm mọi buổi sau đó tụt số
// và "Buổi 7" hôm nay khác "Buổi 7" tuần trước. ⚠️ Caller PHẢI nạp đủ buổi của lớp (chỉ
// cần id + classId + date); dựng từ một CỬA SỔ đã lọc (`take: 60`, `date <= hôm nay`, …)
// sẽ ra số sai.
//
// (2) Yêu cầu 21/08: buổi ĐÃ XONG VIỆC (điểm danh + nhận xét + ảnh) lùi xuống DƯỚI các
// buổi chưa xong / sắp tới, để giáo viên mở tab ra là thấy ngay việc còn nợ. Trong mỗi
// nhóm vẫn xếp theo THỨ TỰ BUỔI tăng dần.
//
// PURE (không DB, không "use server") — dùng được ở RSC, client và test.

export type SessionRankRow = {
  id: string;
  /** Bỏ trống khi mảng chỉ có buổi của MỘT lớp. */
  classId?: string | null;
  date: Date | string | number;
};

function timeOf(d: Date | string | number): number {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Bảng tra `sessionId → số buổi` (1-based), xếp theo ngày tăng dần trong từng lớp.
 * Tie-break theo `id` để hai buổi trùng ngày luôn ra cùng một số ở mọi lần render.
 */
export function soBuoiTheoLich(rows: SessionRankRow[]): Map<string, number> {
  return buildSessionNumberMap(rows);
}

/**
 * @deprecated Tên cũ của `soBuoiTheoLich`. Giữ vì 20 nơi đang gọi — đổi dần từng đợt,
 * đổi hết trong một PR là 20 file cùng lúc. Ý nghĩa KHÔNG đổi: hạng theo NGÀY.
 */
export function buildSessionNumberMap(
  rows: SessionRankRow[],
): Map<string, number> {
  const byClass = new Map<string, SessionRankRow[]>();
  for (const r of rows) {
    const key = r.classId ?? "";
    const list = byClass.get(key) ?? [];
    list.push(r);
    byClass.set(key, list);
  }
  const out = new Map<string, number>();
  for (const list of byClass.values()) {
    const sorted = [...list].sort(
      (a, b) => timeOf(a.date) - timeOf(b.date) || a.id.localeCompare(b.id),
    );
    sorted.forEach((s, i) => out.set(s.id, i + 1));
  }
  return out;
}

/** Nhãn ngắn cho cột "Buổi": `Buổi 7`, hoặc `—` khi không tra được số. */
export function sessionNumberLabel(n: number | null | undefined): string {
  return typeof n === "number" && n > 0 ? `Buổi ${n}` : "—";
}

// ─── THỨ TỰ LỘ TRÌNH (in nhãn) ──────────────────────────────────────────────

/** Hai cột suy ra được số lộ trình, xếp theo độ tin cậy giảm dần. */
export type NguonSoLoTrinh = {
  /** `ClassSessionPlan.order` — 0-based. Nguồn TỐT NHẤT: đây là thứ tự lộ trình của lớp. */
  planOrder?: number | null;
  /** `Lesson.order` — 1-based. Nấc hai: lớp không có plan nhưng buổi vẫn gắn bài. */
  lessonOrder?: number | null;
};

/**
 * Buổi này là BÀI THỨ MẤY của giáo trình (1-based). `null` = không suy được.
 *
 * Thang: `plan.order + 1` → `Lesson.order` → `null`.
 *
 * ⚠️ KHÔNG lùi về hạng-theo-ngày ở đây. Hạng-theo-ngày là số THỜI GIAN, không phải số
 * lộ trình; trộn hai thứ vào một hàm chính là lỗi mà file này vừa được tách ra để sửa.
 * Nơi gọi tự quyết có in số theo lịch hay không — xem `nhanSoBuoi`.
 */
export function soBuoiTheoLoTrinh(src: NguonSoLoTrinh): number | null {
  if (typeof src.planOrder === "number" && src.planOrder >= 0) return src.planOrder + 1;
  if (typeof src.lessonOrder === "number" && src.lessonOrder > 0) return src.lessonOrder;
  return null;
}

/**
 * Nhãn số buổi, đủ ba nấc của thang fallback.
 *
 * Nấc cuối PHẢI nói rõ đó là số THEO LỊCH — nếu in trần `Buổi 7` thì người đọc tưởng đó
 * là bài số 7 của giáo trình, mà nó chỉ là buổi thứ 7 tính theo ngày. Chính chỗ nhập
 * nhằng đó đẻ ra sự cố 07/09.
 */
export function nhanSoBuoi(src: {
  loTrinh: number | null | undefined;
  lich: number | null | undefined;
}): string {
  if (typeof src.loTrinh === "number" && src.loTrinh > 0) return `Buổi ${src.loTrinh}`;
  if (typeof src.lich === "number" && src.lich > 0) return `Buổi ${src.lich} (theo lịch)`;
  return "—";
}

/**
 * Nhãn cho nơi phải nói CẢ HAI con số — danh sách/ô chọn buổi sắp theo NGÀY.
 *
 * Đợt 1c. Ba màn quản lý lớp (ô chọn buổi ở tab Điểm danh và tab Nhận xét, danh sách quản
 * lý buổi) xếp theo ngày, nên số đứng đầu dòng PHẢI là số theo lịch — in số lộ trình ở đó
 * là danh sách nhảy cóc `1, 43, 2, 44…` và người dùng không dò được nữa. Nhưng chỉ in số
 * theo lịch thì lại giấu mất bài đang dạy, đúng chỗ nhập nhằng đã đẻ ra sự cố lệch tên bài.
 *
 * Nên: in cả hai, và CHỈ khi chúng khác nhau.
 *
 *   lịch 2, lộ trình 43  →  `Buổi 2 · bài 43`   (lớp CS2.SATA6.26.001, buổi 25/06)
 *   lịch 7, lộ trình 7   →  `Buổi 7`            (trùng nhau thì nói một lần cho gọn)
 *   chỉ có lịch          →  `Buổi 7 (theo lịch)`
 *   chỉ có lộ trình      →  `Bài 43`
 *   không có gì          →  `—`
 *
 * Vì sao KHÔNG luôn in cả hai: 95 % buổi có hai số trùng nhau (đo prod 08/09 — chỉ lớp có
 * buổi dời ngày mới lệch). In `Buổi 7 · bài 7` ở mọi dòng là rác, và rác thì người ta thôi
 * đọc — rồi thôi đọc luôn dòng thật sự lệch.
 */
export function nhanSoBuoiVaBai(src: {
  lich: number | null | undefined;
  loTrinh: number | null | undefined;
}): string {
  const lich = typeof src.lich === "number" && src.lich > 0 ? src.lich : null;
  const bai = typeof src.loTrinh === "number" && src.loTrinh > 0 ? src.loTrinh : null;
  if (lich !== null && bai !== null) {
    return lich === bai ? `Buổi ${lich}` : `Buổi ${lich} · bài ${bai}`;
  }
  if (lich !== null) return `Buổi ${lich} (theo lịch)`;
  if (bai !== null) return `Bài ${bai}`;
  return "—";
}

// ─── Thứ tự hiển thị: việc còn nợ lên trước ──────────────────────────────────

/** Ba việc sau buổi mà giáo viên phải làm. */
export type SessionWorkState = {
  /**
   * Điểm danh ĐỦ CẢ LỚP (số bản ghi Attendance ≥ sĩ số), KHÔNG phải "có ≥1 bản ghi".
   * ⚠️ Chấm 1/12 em rồi bỏ dở vẫn là việc còn nợ — dùng "≥1 bản ghi" ở đây sẽ đẩy buổi
   * làm dở xuống cuối bảng và giáo viên không bao giờ thấy nó nữa.
   *
   * ĐÁNH ĐỔI đã cân nhắc: sĩ số là sĩ số HÔM NAY, không phải sĩ số lúc buổi đó diễn ra.
   * Học viên ghi danh muộn ⇒ buổi cũ (đã điểm danh đủ người có mặt khi đó) tụt xuống
   * "còn nợ việc" và nổi lên đầu bảng. Chấp nhận: sai theo hướng BÀY RA việc, còn hướng
   * ngược lại là giấu mất buổi làm dở. Muốn chính xác tuyệt đối thì phải biết ai đang
   * ghi danh tại NGÀY của buổi — dữ liệu đó không tra rẻ được trong một bảng nhiều dòng.
   */
  attendanceDone: boolean;
  /**
   * Mọi học viên đi học đều đã có phiếu nhận xét. Phải TỰ NÓ đã bao hàm "buổi đã điểm
   * danh" (xem summarizeSessionFeedback: chưa điểm danh ⇒ attended = 0 ⇒ không complete),
   * nếu không buổi chưa ai đụng sẽ được bật đèn xanh vì phép so 0 ≥ 0.
   */
  feedbackDone: boolean;
  /**
   * Mọi học viên ĐI HỌC đều đã có ảnh/video — dùng `mediaCoversAttendees`, đừng truyền
   * "buổi có ảnh nào không": học viên vắng không cần ảnh, còn em đi học thì BẮT BUỘC có.
   */
  photoDone: boolean;
};

/** Buổi "đã hoàn thành" = đủ CẢ BA: điểm danh + nhận xét + ảnh. */
export function isSessionWorkComplete(w: SessionWorkState): boolean {
  return w.attendanceDone && w.feedbackDone && w.photoDone;
}

/**
 * `attendanceDone`: điểm danh đã phủ hết sĩ số chưa — so theo DANH SÁCH studentId,
 * KHÔNG so số lượng.
 *
 * ⚠️ ĐỪNG thay bằng `marked >= rosterCount`. Đã thử và sai hai chiều cùng lúc:
 *   • Học viên HỌC BÙ từ lớp khác cũng sinh bản ghi Attendance ⇒ `marked` phồng lên,
 *     buổi chấm thiếu vẫn đủ số và bị đẩy xuống đáy bảng (giấu mất việc còn nợ).
 *   • Sĩ số đếm bằng `_count` ở vài màn KHÔNG lọc `deletedAt` ⇒ enrollment đã gỡ mềm
 *     vẫn cộng vào mẫu số và buổi không bao giờ "xong", R2 chết hẳn ở lớp đó.
 * Sĩ số rỗng ⇒ false: lớp chưa có ai thì không có gì để gọi là điểm danh xong.
 */
export function attendanceCoversRoster(
  markedStudentIds: Iterable<string>,
  rosterStudentIds: Iterable<string>,
): boolean {
  const marked =
    markedStudentIds instanceof Set
      ? markedStudentIds
      : new Set(markedStudentIds);
  const roster = [...rosterStudentIds];
  return roster.length > 0 && roster.every((id) => marked.has(id));
}

/** Ảnh/video của một buổi, rút gọn đúng phần cần cho `mediaCoversAttendees`. */
export type SessionMediaRow = {
  classSessionId: string | null;
  isClassWide: boolean;
  tags: { studentId: string }[];
};

export type SessionMediaCoverage = { classWide: boolean; tagged: Set<string> };

/**
 * Gom ảnh/video theo buổi → ai đã có ảnh. Dùng chung cho mọi màn tính "buổi xong chưa".
 * ⚠️ Truy vấn nguồn PHẢI select `isClassWide` + `tags.studentId` và KHÔNG được dùng
 * `distinct: ["classSessionId"]` — cắt còn một dòng/buổi là mất hết thẻ học viên, và
 * `mediaCoversAttendees` sẽ báo thiếu ảnh cho cả lớp.
 */
export function buildSessionMediaCoverage(
  rows: SessionMediaRow[],
): Map<string, SessionMediaCoverage> {
  const out = new Map<string, SessionMediaCoverage>();
  for (const m of rows) {
    if (!m.classSessionId) continue; // ảnh không gắn buổi — không quy được về buổi nào
    const cur = out.get(m.classSessionId) ?? {
      classWide: false,
      tagged: new Set<string>(),
    };
    if (m.isClassWide) cur.classWide = true;
    for (const t of m.tags) cur.tagged.add(t.studentId);
    out.set(m.classSessionId, cur);
  }
  return out;
}

/** Select dùng chung cho truy vấn ảnh phục vụ `buildSessionMediaCoverage`. */
export const SESSION_MEDIA_SELECT = {
  classSessionId: true,
  isClassWide: true,
  tags: { select: { studentId: true } },
} as const;

/**
 * `photoDone`: ảnh/video đã phủ hết học viên ĐI HỌC chưa.
 *
 * Luật nghiệp vụ (chủ dự án chốt 21/08): học viên VẮNG thì không cần nhận xét, không cần
 * ảnh; học viên KHÔNG VẮNG thì BẮT BUỘC cả hai. Vì thế điều kiện là "mỗi em đi học có ít
 * nhất một ảnh/video", KHÔNG phải "buổi có ít nhất một ảnh" — một tấm ảnh chụp một em
 * không nói được gì về chín em còn lại.
 *
 * Ảnh CHUNG CẢ LỚP (`ClassSessionMedia.isClassWide`) tính cho MỌI em: theo giao kèo ở
 * lib/lms/media-consent, đó là ảnh mọi phụ huynh của lớp đều xem được.
 * Không có em nào đi học ⇒ false: buổi chưa điểm danh hoặc cả lớp vắng thì chưa có gì để
 * gọi là xong (khớp `attendanceCoversRoster` và `summarizeSessionFeedback`).
 */
export function mediaCoversAttendees(input: {
  attendedStudentIds: Iterable<string>;
  /** studentId được gắn thẻ trong ảnh/video của BUỔI này. */
  taggedStudentIds: Iterable<string>;
  /** Buổi có ít nhất một ảnh/video đánh dấu "chung cả lớp". */
  hasClassWide: boolean;
}): boolean {
  const attended = [...input.attendedStudentIds];
  if (attended.length === 0) return false;
  if (input.hasClassWide) return true;
  const tagged =
    input.taggedStudentIds instanceof Set
      ? input.taggedStudentIds
      : new Set(input.taggedStudentIds);
  return attended.every((id) => tagged.has(id));
}

/**
 * Buổi KHÔNG còn việc gì phải làm → xếp xuống nhóm dưới. Rộng hơn `isSessionWorkComplete`
 * vì có hai ca "không có việc" chứ không phải "đã làm xong việc":
 *   • buổi ĐÃ HUỶ — không huỷ thì nó ghim vĩnh viễn ở đầu bảng, trên cả buổi vừa dạy;
 *   • lớp KHÔNG CÒN AI đang học (khoá đã kết thúc, mọi enrollment sang COMPLETED, hoặc
 *     lớp mới chưa xếp học viên) — sĩ số rỗng thì `attendanceCoversRoster` trả false cho
 *     MỌI buổi, và ở bảng gộp nhiều lớp cả lớp đã xong khoá sẽ nổi lên trên lớp đang chạy.
 */
/**
 * Các việc còn thiếu, dạng danh sách. Tách khỏi câu chữ để nút trên giao diện và câu
 * server trả về nói CÙNG một thứ tiếng — trước D1 hai bên tự ghép chuỗi riêng và đã
 * lệch chữ ("nhận xét" vs "nhận xét đủ học viên đi học").
 */
export function thieuDanhSach(work: {
  attendanceDone: boolean;
  feedbackDone: boolean;
  photoDone: boolean;
}): string[] {
  return [
    work.attendanceDone ? null : "điểm danh đủ lớp",
    work.feedbackDone ? null : "nhận xét đủ học viên đi học",
    work.photoDone ? null : "ảnh/video cho mọi học viên đi học",
  ].filter((x): x is string => x !== null);
}

/** Câu báo thiếu việc mà server trả về. */
export function thieuGi(work: {
  attendanceDone: boolean;
  feedbackDone: boolean;
  photoDone: boolean;
}): string {
  return `Chưa hoàn tất: còn thiếu ${thieuDanhSach(work).join(", ")}.`;
}

export function isSessionSettled(input: {
  cancelled?: boolean;
  rosterEmpty?: boolean;
  work: SessionWorkState;
}): boolean {
  return (
    Boolean(input.cancelled) ||
    Boolean(input.rosterEmpty) ||
    isSessionWorkComplete(input.work)
  );
}

/**
 * Nhãn trạng thái của MỘT buổi, đọc từ `ClassSession.status` — không suy ra.
 *
 * ── Vì sao có hàm này (D0, 07/09/2026) ──────────────────────────────────────
 *
 * Tab "Điểm danh" của Class Hub trước đây in nhãn xanh "Hoàn tất" ngay khi
 * `isSessionWorkComplete` trả true, và CHE luôn pill trạng thái thật ở đúng ca đó.
 * Nhưng làm xong ba việc KHÔNG đặt `status = COMPLETED` — chỉ nút chốt buổi mới đặt.
 *
 * Hậu quả đo trên prod ngày 07/09/2026: 2 buổi COMPLETED / 287 SCHEDULED trong 4
 * tháng. Giáo viên KHÔNG quên bấm — màn hình đã nói với họ là xong. Suốt một tháng
 * ai nhìn cũng tưởng buổi đã đóng, trong khi kỳ công, công dạy, học bạ và đề xuất
 * hoàn tiền đều đọc `status` nên đều đọc ra 0.
 *
 * Luật từ đây: nguồn duy nhất của nhãn là `status`. Ba việc chỉ được nói tới như
 * mức độ SẴN SÀNG chốt (`sanSangChot`), không bao giờ được đóng vai trạng thái.
 *
 * `daQuaNgay` tách "chưa tới giờ" khỏi "đã dạy nhưng chưa chốt": buổi tương lai còn
 * SCHEDULED là bình thường, buổi đã qua ngày mà còn SCHEDULED mới là việc còn nợ.
 */
export type NhanTrangThaiBuoi =
  /** status = COMPLETED. Đây là ca DUY NHẤT được hiện là đã xong. */
  | { loai: "da-day" }
  /** status = CANCELLED. */
  | { loai: "da-huy" }
  /** Buổi tương lai, chưa tới lượt làm gì. */
  | { loai: "chua-toi-gio" }
  /** Đã qua ngày, status vẫn chưa COMPLETED. `sanSangChot` = đủ ba việc, chỉ còn bấm chốt. */
  | { loai: "chua-chot"; sanSangChot: boolean };

export function nhanTrangThaiBuoi(input: {
  status: string;
  /** Buổi đã tới/qua ngày (≤ hết hôm nay giờ VN). */
  daQuaNgay: boolean;
  /** Đủ cả ba việc (isSessionWorkComplete). */
  workDone: boolean;
}): NhanTrangThaiBuoi {
  if (input.status === "COMPLETED") return { loai: "da-day" };
  if (input.status === "CANCELLED") return { loai: "da-huy" };
  if (!input.daQuaNgay) return { loai: "chua-toi-gio" };
  return { loai: "chua-chot", sanSangChot: input.workDone };
}

export type SessionOrderRow = {
  /**
   * ⚠️ 08/09 — KHOÁ SẮP XẾP LÀ THỜI GIAN, không phải số buổi.
   *
   * Mốc thời gian của buổi (ms). Trước đây danh sách sắp theo SỐ BUỔI, mà số buổi lúc
   * ấy chính là hạng-theo-ngày nên vô tình đúng. Từ khi nhãn chuyển sang số LỘ TRÌNH
   * (`soBuoiTheoLoTrinh`), sắp theo nhãn là sai: lớp CS2.SATA6.26.001 có buổi ngày
   * 25/06 mang nhãn "Buổi 43" — sắp theo nhãn thì nó rơi xuống SAU buổi ngày 12/09
   * ("Buổi 19"), và danh sách việc còn nợ của giáo viên thôi theo thứ tự thời gian.
   */
  thoiGian?: number | null;
  /**
   * @deprecated Chỉ dùng khi KHÔNG có `thoiGian`. Giữ để các nơi gọi chuyển dần.
   * Nếu truyền số LỘ TRÌNH vào đây thì danh sách sẽ sắp sai — xem ghi chú trên.
   */
  number?: number | null | undefined;
  /** Đã xong cả ba việc (isSessionWorkComplete). */
  complete: boolean;
};

/**
 * So sánh 2 buổi cho danh sách "điểm danh"/"nhận xét":
 *   • buổi CHƯA hoàn thành (gồm cả buổi sắp tới, chưa tới) lên TRƯỚC;
 *   • trong mỗi nhóm: NGÀY tăng dần (`thoiGian`), KHÔNG phải số buổi.
 */
export function compareSessionWorkOrder(
  a: SessionOrderRow,
  b: SessionOrderRow,
): number {
  if (a.complete !== b.complete) return a.complete ? 1 : -1;
  // THỜI GIAN thắng; chỉ khi cả hai đều thiếu mới lùi về `number`.
  const at = a.thoiGian ?? null;
  const bt = b.thoiGian ?? null;
  if (at !== null && bt !== null) return at - bt;
  if (at !== null) return -1;
  if (bt !== null) return 1;
  const an = a.number ?? Number.MAX_SAFE_INTEGER;
  const bn = b.number ?? Number.MAX_SAFE_INTEGER;
  return an - bn;
}

/** `compareSessionWorkOrder` áp lên một mảng bất kỳ (KHÔNG sửa mảng gốc). */
export function sortSessionsForWork<T>(
  rows: T[],
  pick: (row: T) => SessionOrderRow,
): T[] {
  return [...rows].sort((a, b) => compareSessionWorkOrder(pick(a), pick(b)));
}
