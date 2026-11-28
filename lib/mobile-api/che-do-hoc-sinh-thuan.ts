/**
 * H-S3 — CHẾ ĐỘ HỌC SINH ép ở máy chủ: luật THUẦN (không DB) quyết định một yêu cầu của PHIÊN đang ở chế độ học sinh có được đi tiếp không.
 *
 * Nguyên tắc: **mặc định TỪ CHỐI**. Chỉ những cặp (phương thức, đường dẫn) liệt kê dưới đây mới qua; mọi endpoint mới thêm sau này tự động bị chặn ở chế độ học sinh
 * cho tới khi có người cố ý thêm vào danh sách — nên không có «quên khoá» (học phí, chat, hồ sơ ba mẹ, khuyến mãi, góp ý, thu nhập thêm… đều chặn mà không cần sửa từng route).
 * Học sinh KHÔNG xem tài chính, chat, thông báo/hồ sơ của ba mẹ; KHÔNG đổi sang anh/chị/em (studentId trên đường dẫn phải đúng học viên đang khoá).
 */

const TIEN_TO = "/api/mobile/v1";

/** Phần của học viên mà HỌC SINH được dùng (đường dẫn con sau `/students/:id/`). Đổi quà: HS được gửi yêu cầu, trung tâm duyệt (OD-02). */
const MUC_DOC_DUOC = ["schedule", "progress", "attendance", "report-card", "satacoin", "gifts", "notifications", "photos", "teacher-evaluations", "personality-robot", "contact"] as const; // V8.45: «contact» = liên hệ trung tâm cho màn Hướng dẫn của HS (chỉ chữ, không liên kết ngoài) // V8.2: «Tin mới» của CHÍNH học sinh (chỉ tin STUDENT/LỚP — xem thong-bao-hoc-sinh.ts)

export type KetQuaCheDo = { ok: true } | { ok: false; ma: "DANG_CHE_DO_HOC_SINH" | "KHAC_HOC_SINH" };

function bo(pathname: string): string {
  const p = pathname.startsWith(TIEN_TO) ? pathname.slice(TIEN_TO.length) : pathname;
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/**
 * @param hocSinhId học viên mà phiên đang bị khoá vào; `null` = phiên phụ huynh ⇒ luật này không áp dụng (luôn ok).
 */
export function kiemCheDoHocSinh(p: { pathname: string; method: string; hocSinhId: string | null }): KetQuaCheDo {
  if (p.hocSinhId === null) return { ok: true };
  const duong = bo(p.pathname);
  const m = p.method.toUpperCase();
  const cam: KetQuaCheDo = { ok: false, ma: "DANG_CHE_DO_HOC_SINH" };

  // Thoát chế độ + xem trạng thái + đăng xuất (đăng xuất không né được mã: đăng nhập lại đòi mật khẩu của PHỤ HUYNH).
  if (duong === "/student-mode" && m === "GET") return { ok: true };
  // D1 (22/11/2026): Robot tính cách của CHÍNH học viên đang khoá — học viên lấy từ phiên, không từ đường dẫn.
  if (duong === "/student-mode/personality-robot" && m === "GET") return { ok: true };
  if ((duong === "/student-mode/exit" || duong === "/student-mode/forgot") && m === "POST") return { ok: true };
  if (duong === "/auth/logout" && m === "POST") return { ok: true };

  // V8.45 FREE MODE: lượt PHÁT video học thử (GET/HEAD, Range) KHÔNG nằm dưới `/students/:id/` (vé gắn TÀI KHOẢN, không gắn học viên); vé do route `video-ticket` ở trên cấp. Chỉ đúng đường này.
  if ((m === "GET" || m === "HEAD") && duong === "/online/preview/video/play") return { ok: true };

  const kh = /^\/students\/([^/]+)\/(.+)$/.exec(duong);
  if (!kh) return cam;
  const [, studentId, phan] = kh as unknown as [string, string, string];
  // Đường dẫn trỏ sang học viên khác (anh/chị/em) ⇒ chặn TRƯỚC khi xét phần còn lại.
  const doc = phan.split("/");
  const muc = doc[0] ?? "";
  const hopLe =
    (m === "GET" && doc.length === 1 && (MUC_DOC_DUOC as readonly string[]).includes(muc)) ||
    (m === "GET" && muc === "sessions" && (doc.length === 2 || (doc.length === 3 && doc[2] === "content"))) ||
    // LMS (B-LMS1): CHỈ đọc, CHỈ bốn mục, đúng độ sâu — danh sách (2 đoạn) / chi tiết (3 đoạn); `results` chỉ danh sách. KHÔNG có POST/PUT nào của `learning` (nộp bài/lượt thi sẽ thêm cùng route + test).
    (m === "GET" && muc === "learning" && ((doc.length === 2 && ["assignments", "exams", "lessons", "results", "areas", "session-homework"].includes(doc[1] ?? "")) || (doc.length === 3 && ["assignments", "exams", "lessons"].includes(doc[1] ?? "")))) ||
    // LMS (B-LMS2): HỌC SINH được NỘP bài tập của chính mình (văn bản). Chưa có route lượt thi — mở cùng route + test khi làm.
    (m === "POST" && muc === "learning" && doc.length === 4 && doc[1] === "assignments" && doc[3] === "submissions") ||
    // LMS (B-LMS2): vé tải lên của CHÍNH mình — xin vé (learning/uploads) và báo hoàn tất (learning/uploads/:id/complete).
    (m === "POST" && muc === "learning" && doc[1] === "uploads" && (doc.length === 2 || (doc.length === 4 && doc[3] === "complete"))) ||
    // LMS (B-LMS3): HỌC SINH làm bài thi của CHÍNH mình — bắt đầu/lịch sử (exams/:id/attempts), khôi phục + kết quả (attempts/:id[/result]), lưu câu (…/answers), nộp (…/submit).
    (muc === "learning" && doc.length === 4 && doc[1] === "exams" && doc[3] === "attempts" && (m === "POST" || m === "GET")) ||
    (m === "GET" && muc === "learning" && doc[1] === "attempts" && (doc.length === 3 || (doc.length === 4 && doc[3] === "result"))) ||
    (m === "POST" && muc === "learning" && doc[1] === "attempts" && doc.length === 4 && (doc[3] === "answers" || doc[3] === "submit")) ||
    // V8.9 ONLINE P0: HỌC SINH học khoá Online của CHÍNH mình — CHỈ GET, đúng độ sâu: online/courses (2) · courses/:id (3) · …/outline (4) · …/lessons/:id (5) · online/entitlements (2). KHÔNG có ghi nào (tiến độ/làm bài mở khi làm + test).
    (m === "GET" && muc === "online" && ((doc.length === 2 && (doc[1] === "courses" || doc[1] === "entitlements" || doc[1] === "certificates")) || (doc.length === 3 && doc[1] === "courses") || (doc.length === 4 && doc[1] === "courses" && doc[3] === "outline") || (doc.length === 5 && doc[1] === "courses" && doc[3] === "lessons"))) ||
    // V8.12 ONLINE: HỌC SINH ghi tiến độ + làm bài của CHÍNH mình — đúng độ sâu, đúng phương thức: …/lessons/:id/progress (POST) · …/attempts (POST) · …/attempts/:id/submit (POST) · …/results (GET).
    (muc === "online" && doc[1] === "courses" && doc[3] === "lessons" && ((m === "POST" && doc.length === 6 && (doc[5] === "progress" || doc[5] === "attempts" || doc[5] === "video-ticket")) || (m === "POST" && doc.length === 8 && doc[5] === "attempts" && doc[7] === "submit") || (m === "GET" && doc.length === 6 && doc[5] === "results"))) ||
    // V8.24 ONLINE (khung adapter nháp): HỌC SINH đọc/lưu nháp và xem trạng thái lượt của CHÍNH mình — …/attempts/:id/draft (GET, PUT) · …/attempts/:id/status (GET); đúng độ sâu 8 đoạn, đúng phương thức.
    (muc === "online" && doc[1] === "courses" && doc[3] === "lessons" && doc[5] === "attempts" && doc.length === 8 && ((doc[7] === "draft" && (m === "GET" || m === "PUT")) || (doc[7] === "status" && m === "GET"))) ||
    // V8.45 ONLINE (câu PRODUCT): HỌC SINH xin vé tải lên + đăng ký bài nộp sản phẩm của CHÍNH mình — …/attempts/:id/product/upload-ticket (POST) · …/product/submit (POST); đúng độ sâu 9 đoạn, đúng phương thức.
    (muc === "online" && doc[1] === "courses" && doc[3] === "lessons" && doc[5] === "attempts" && doc.length === 9 && doc[7] === "product" && (doc[8] === "upload-ticket" || doc[8] === "submit") && m === "POST") ||
    // V8.45 FREE MODE (học thử Online, OD06=A): HỌC SINH học thử của CHÍNH mình — danh sách (3 đoạn) · mục lục khoá (4) · mở bài (7, POST) · vé video (7, POST) · tiến độ (7, POST). KHÔNG có `free-claim` (tự nhận khoá là việc của phụ huynh) và KHÔNG có GET bài (học sinh mở bài qua `open` để đếm giới hạn).
    (muc === "online" && doc[1] === "preview" && doc[2] === "courses" && ((m === "GET" && (doc.length === 3 || doc.length === 4)) || (m === "POST" && doc.length === 7 && doc[4] === "lessons" && (doc[6] === "open" || doc[6] === "video-ticket" || doc[6] === "progress")))) ||
    // V8.20 H-Danh-gia: học sinh đánh giá giáo viên của CHÍNH mình (GET đợt mở — qua MUC_DOC_DUOC; POST gửi một đánh giá).
    (m === "POST" && muc === "teacher-evaluations" && doc.length === 1) ||
    (m === "GET" && muc === "gift-redemptions" && doc.length === 1) ||
    (m === "POST" && muc === "gift-redemptions" && doc.length === 1) ||
    (m === "POST" && muc === "gift-redemptions" && doc.length === 3 && doc[2] === "cancel");
  if (!hopLe) return cam;
  if (studentId !== p.hocSinhId) return { ok: false, ma: "KHAC_HOC_SINH" };
  return { ok: true };
}
