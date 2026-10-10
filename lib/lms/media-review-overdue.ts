// F-21 — "quá hạn mà chưa duyệt hết thì báo cho quản lý cơ sở": phần THUẦN.
// Không chạm DB, không đọc cấu hình, không đọc đồng hồ hệ thống (mọi hàm nhận `now`).
// Phần chạm DB + gửi thông báo nằm ở `media-review-overdue-run.ts`.
//
// ── ĐƠN VỊ LÀ FOLDER, KHÔNG PHẢI TỪNG TẤM ẢNH ────────────────────────────────
// F-10/F-11 dựng màn duyệt theo cây NGÀY → LỚP, và F-16 nói một lớp chỉ coi là xong
// khi MỌI ảnh của nó đã duyệt/đã xoá. Vậy thứ "quá hạn" là cái folder, không phải
// từng tấm. Bắn thông báo theo từng tấm ảnh thì một buổi 40 ảnh thành 40 dòng chuông
// — đúng loại nhiễu mà PRD dựng trần 30 mục/ngày để chặn.
// Folder = BUỔI khi ảnh có `classSessionId`; ảnh không gắn buổi thì gom theo
// LỚP × NGÀY VN (đúng cái folder mà QLCS nhìn thấy trên màn duyệt).
//
// ── VÌ SAO NGÀY PHẢI CẮT THEO GIỜ VN ─────────────────────────────────────────
// Khoá chống trùng cắt theo ngày. Trên Vercel/CI (TZ = UTC) mà cắt bằng `getDate()`
// thì khoảng 00:00–07:00 giờ VN vẫn bị tính là ngày hôm trước ⇒ cùng một buổi ăn hai
// thông báo trong một ngày làm việc, và folder "lớp × ngày" bị xẻ đôi sai chỗ.
// Đây là cùng một lớp lỗi mà `lib/time/vn.ts` sinh ra để chặn.
import { vnParts, vnYmd } from "@/lib/time/vn";
import { isMediaReviewOverdue } from "./media-review-deadline";

/**
 * Bao lâu thì thôi nhắc một folder đã quá hạn.
 *
 * Có trần là BẮT BUỘC: khoá chống trùng cắt theo ngày (xem `mediaOverdueDedupeKey`),
 * nên một folder không ai đụng tới sẽ sinh mỗi ngày một thông báo cho tới đời nào.
 * 7 ngày = một tuần làm việc: đủ để người trực nghỉ phép về vẫn thấy, đủ ngắn để
 * đống ảnh bỏ hoang từ quý trước không chôn sống cái chuông.
 *
 * Việc cũ hơn 7 ngày KHÔNG biến mất — nó vẫn nằm trong hàng duyệt `/media` và vẫn
 * được đếm ở nhóm việc tồn; chỉ là thôi bắn thông báo mới.
 */
export const MEDIA_OVERDUE_LOOKBACK_DAYS = 7;

/** Tiền tố dedupeKey — phải khớp dòng khai trong `lib/notifications/catalog.ts`. */
export const MEDIA_OVERDUE_KEY_PREFIX = "media_review.overdue";

/** Một tấm ảnh/video đang chờ duyệt (chỉ những cột cần để xếp folder). */
export interface PendingMediaRow {
  id: string;
  classId: string;
  /** Buổi được gắn lúc gửi ảnh; null = ảnh chỉ gắn ở mức lớp. */
  classSessionId: string | null;
  /** Ngày chụp (thường bằng ngày buổi); null thì rơi về ngày tải lên. */
  takenAt: Date | null;
  createdAt: Date;
}

/** Buổi dạy — chỉ phần cần để biết folder thuộc lớp nào, ngày nào. */
export interface SessionRef {
  id: string;
  classId: string;
  date: Date;
}

export interface MediaFolder {
  /** `s:<sessionId>` hoặc `c:<classId>:<YYYY-MM-DD VN>`. Ổn định giữa các lượt chạy. */
  key: string;
  classId: string;
  classSessionId: string | null;
  /** Mốc dùng để TÍNH HẠN: ngày dạy của buổi (hoặc ngày của folder lớp×ngày). */
  folderAt: Date;
  /** Id ảnh trong folder, giữ đúng thứ tự đầu vào. */
  mediaIds: string[];
  /** Ảnh mới nhất trong folder — dùng cho câu chữ, không dùng để tính hạn. */
  latestUploadAt: Date;
}

export interface FolderWithDeadline extends MediaFolder {
  /** Hạn duyệt (F-20) đã tính cho folder này. */
  deadlineAt: Date;
}

/**
 * Gom ảnh chờ duyệt thành folder.
 *
 * `sessionById` là buổi tra được. Ảnh trỏ tới buổi KHÔNG tra ra (buổi bị xoá, hoặc
 * nằm ngoài cửa sổ quét) vẫn được giữ lại ở folder lớp×ngày thay vì bị bỏ — bỏ là
 * ảnh đó biến khỏi mọi cảnh báo trong khi nó vẫn đang chờ người duyệt.
 */
export function groupPendingMedia(
  rows: readonly PendingMediaRow[],
  sessionById: ReadonlyMap<string, SessionRef>,
): MediaFolder[] {
  const theoKhoa = new Map<string, MediaFolder>();

  for (const r of rows) {
    const ses = r.classSessionId ? sessionById.get(r.classSessionId) : undefined;
    const moc = r.takenAt ?? r.createdAt;
    const key = ses ? `s:${ses.id}` : `c:${r.classId}:${vnYmd(moc)}`;
    const folderAt = ses ? ses.date : moc;

    const cu = theoKhoa.get(key);
    if (cu) {
      cu.mediaIds.push(r.id);
      if (r.createdAt.getTime() > cu.latestUploadAt.getTime()) cu.latestUploadAt = r.createdAt;
      continue;
    }
    theoKhoa.set(key, {
      key,
      // Lấy classId của BUỔI khi có: ảnh là cột phẳng, buổi mới là nguồn đúng.
      classId: ses?.classId ?? r.classId,
      classSessionId: ses?.id ?? null,
      folderAt,
      mediaIds: [r.id],
      latestUploadAt: r.createdAt,
    });
  }

  return [...theoKhoa.values()];
}

/**
 * Folder nào đang quá hạn và còn đáng nhắc.
 *
 * `completedAt` cố tình KHÔNG có mặt: folder chỉ lọt vào đây khi vẫn còn ảnh PENDING,
 * tức chưa duyệt xong theo F-16. Duyệt xong là folder không còn trong danh sách nữa.
 */
export function pickOverdueFolders<T extends FolderWithDeadline>(
  folders: readonly T[],
  now: Date,
  lookbackDays: number = MEDIA_OVERDUE_LOOKBACK_DAYS,
): T[] {
  const somNhat = now.getTime() - lookbackDays * 86_400_000;
  return folders.filter(
    (f) =>
      isMediaReviewOverdue({ deadlineAt: f.deadlineAt, completedAt: null, now }) &&
      f.deadlineAt.getTime() >= somNhat,
  );
}

/**
 * Khoá chống trùng: MỘT folder × MỘT ngày làm việc VN.
 *
 * Cron chạy mỗi giờ, nên khoá chỉ theo folder thì... vẫn đúng (upsert theo
 * `(userId, dedupeKey)` không nhân bản), nhưng khi giáo viên tải thêm ảnh vào folder
 * đã bị bỏ qua thì không còn tín hiệu nào mới. Ngược lại, khoá theo từng lượt chạy
 * thì 24 thông báo/ngày cho cùng một việc. Cắt theo NGÀY là điểm giữa: mỗi ngày còn
 * treo thì nhắc lại đúng một lần, và trần `MEDIA_OVERDUE_LOOKBACK_DAYS` chặn nhắc mãi.
 */
export function mediaOverdueDedupeKey(folderKey: string, now: Date): string {
  return `${MEDIA_OVERDUE_KEY_PREFIX}:${folderKey}:${vnYmd(now)}`;
}

/** `dd/MM/yyyy` theo lịch VN — KHÔNG dùng `toLocaleDateString` (chạy theo TZ máy). */
export function vnDMY(d: Date): string {
  const p = vnParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${p.year}`;
}

/** `HH:mm` theo đồng hồ VN. */
export function vnHM(d: Date): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export interface OverdueNotice {
  title: string;
  body: string;
}

/**
 * Câu chữ thông báo. Chỉ tên lớp + ngày + số lượng — không tên học viên, không SĐT,
 * không tiền (PRD T5: panel chuông hay được mở giữa chỗ đông người).
 */
export function buildOverdueNotice(input: {
  folder: FolderWithDeadline;
  /** Tên/mã lớp để người nhận biết mở folder nào; bỏ trống thì nói "một lớp". */
  className?: string | null;
  soAnh: number;
}): OverdueNotice {
  const { folder, className, soAnh } = input;
  const ten = className?.trim() || "Lớp chưa rõ tên";
  return {
    title: "Ảnh buổi học quá hạn duyệt",
    body:
      `${ten} — buổi ngày ${vnDMY(folder.folderAt)} còn ${soAnh} ảnh/video chưa duyệt. ` +
      `Hạn duyệt là ${vnHM(folder.deadlineAt)} ngày ${vnDMY(folder.deadlineAt)} và đã trôi qua.`,
  };
}
