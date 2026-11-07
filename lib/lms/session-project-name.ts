// lib/lms/session-project-name.ts — tên DỰ ÁN + NHÃN của một buổi học.
//
// 25/08 (chủ dự án): tên dự án gửi phụ huynh = TÊN BÀI TRẦN của giáo trình
// ("Bàn Tay Ma Thuật"), còn cột "Buổi học" của bảng điểm danh/nhận xét in nhãn đầy đủ
// "Buổi 1 - HP1 - Bàn Tay Ma Thuật" (deriveSessionLabel). Tên bài thật nạp từ
// `prisma/seed-curriculum-sata.ts` ← `lib/lms/curriculum-sata.ts`; trước đó bảng
// `Lesson` chỉ có chỗ trống tự sinh "Buổi N" nên mọi giáo trình in ra tên sai.
//
// Trước 21/08 ô "Dự án" trong phiếu nhận xét là một <input> trống được mồi sẵn hằng số
// DEFAULT_PROJECT_NAME ("Dự án 1: Làm quen hệ thống"), nên mỗi giáo viên gõ một kiểu và
// phiếu buổi 9 vẫn đề "Dự án 1". Yêu cầu 21/08: tên dự án SUY RA từ chính buổi học,
// không nhập tay nữa.
//
// PURE (không DB). Đây là nguồn tên cho Ô NHẬP của phiếu — nơi quyết định giá trị sẽ
// được LƯU. Các màn chỉ-đọc (PDF, portal phụ huynh, thẻ phiếu ở admin) vẫn in cột
// `StudentSessionFeedback.projectName` ĐÃ LƯU, nên phiếu cũ còn giữ tên cũ (thường là
// hằng "Dự án 1: Làm quen hệ thống") cho tới khi có người mở ra bấm Lưu lại. Cố ý:
// hộp thoại là trình sửa, phải hiện thứ nó sắp ghi; và tự suy lại ở mọi đường đọc thì
// giá trị đã lưu thành vô nghĩa.
import { DEFAULT_PROJECT_NAME } from "@/lib/lms/session-eval-rubric";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";

export type SessionProjectSource = {
  /** Số buổi trong lớp (lib/lms/session-order). */
  sessionNumber?: number | null;
  /** ClassSessionPlan.customTitle — tiêu đề buổi do lớp tự đặt (ưu tiên cao nhất). */
  planTitle?: string | null;
  /** Lesson.title của giáo án gắn buổi. */
  lessonTitle?: string | null;
  /**
   * `ClassSessionPlan.order` (0-based) — NGUỒN TỐT NHẤT của số buổi in ra: đây là thứ tự
   * LỘ TRÌNH của lớp. Đo prod 08/09: phủ 687/687 buổi.
   */
  planOrder?: number | null;
  /** Lesson.order (1-based) — nấc hai khi lớp không có plan. */
  lessonOrder?: number | null;
  /** ClassSession.topic — chủ đề nhập tay ở cấp buổi. */
  topic?: string | null;
  /** Lesson.moduleCode — học phần của bài ("HP1"); null với khoá không chia học phần. */
  moduleCode?: string | null;
};

/**
 * Chuẩn hoá chuỗi trước MỌI phép so sánh và mọi lần in: cắt hai đầu, và **gộp mọi cụm
 * khoảng trắng thành một dấu cách**.
 *
 * ⚠️ Vế gộp thêm 08/09/2026. Đo prod cùng ngày: `Lesson.title` đang có tên gõ thừa dấu
 * cách — `"HP1 -   Chiến Xa Tốc Độ"` (3 dấu cách), `"HP1 -  Ôn tập kiến thức"` (2).
 * Sau khi bỏ bản sao đông cứng `customTitle`, đây là chuỗi đi thẳng tới phụ huynh.
 *
 * Vá ở ĐÂY chứ không sửa 3 dòng trong DB: sửa dữ liệu chỉ chữa đúng 3 tên đang bẩn, còn
 * lần sau Đào tạo gõ thừa dấu cách là hỏng lại. Một chỗ chặn cho cả tên cũ lẫn tên mới.
 *
 * Gộp trước khi so cũng khiến `"A  B"` và `"A B"` được coi là một — đúng ý: chúng in ra
 * giống hệt nhau nên coi là khác là đếm nhầm.
 */
function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Ô TRỐNG mang hình dạng tiêu đề: `"Buổi 7"` và không gì khác.
 *
 * Hai nơi đẻ ra nó: nút "Áp dụng số buổi" ở /admin/curriculums (`lib/lms/curriculum.ts`
 * tạo `title: "Buổi N"`), và `createSessionPlansForClass` chép nguyên cái đó sang
 * `ClassSessionPlan.customTitle` lúc tạo lớp (`lib/classes/snapshot.ts`).
 *
 * Vì sao phải LOẠI nó khỏi chuỗi ưu tiên (25/08): `customTitle` là bản sao ĐÔNG CỨNG,
 * không bao giờ tự đồng bộ khi giáo trình đổi tên. Lớp tạo trước khi có giáo trình thật
 * mang `customTitle = "Buổi 7"`; nạp giáo trình xong thì `Lesson.title` đã là
 * "Bàn Tay Ma Thuật" nhưng `customTitle` vẫn thắng ⇒ nhãn in ra `"Buổi 7 - HP1 - Buổi 7"`
 * và phiếu gửi phụ huynh in `"Buổi 7"` — XẤU HƠN trước khi nạp. Coi ô trống là "không có
 * tên" thì nó tự rơi xuống `Lesson.title`, và mọi lớp cũ được vá mà không cần chạy
 * `--relink`.
 *
 * KHÔNG dùng `isPlaceholderTitle(title, order)` của curriculum-merge: ở đây không có số
 * thứ tự của plan để đối chiếu, và bất kỳ `"Buổi <số>"` nào cũng đều là ô trống.
 */
function isBlankSessionTitle(s: string): boolean {
  return /^buổi\s+\d+$/i.test(s);
}

/**
 * Bỏ tiền tố `"Buổi N"` thừa ở ĐẦU tên bài.
 *
 * Nhiều giáo trình đặt tên bài kèm sẵn số buổi — `"Buổi 1 — Làm quen bộ học cụ"`,
 * `"Buổi 3: Cảm biến"`. Nhãn buổi vốn đã mở đầu bằng `"Buổi N"` rồi, giữ nguyên là in ra
 * `"Buổi 1 - Buổi 1 — Làm quen bộ học cụ"` — đọc như lỗi. Cắt phần trùng, còn
 * `"Buổi 1 - Làm quen bộ học cụ"`.
 *
 * PHẢI có dấu ngăn (— – - : .) sau con số mới cắt: `"Buổi diễn tập"` hay
 * `"Buổi 2 ôn tập"` không phải tiền tố đánh số, cắt là mất chữ.
 */
function stripSessionNumberPrefix(s: string): string {
  return s.replace(/^buổi\s+\d+\s*[—–\-:.]\s*/i, "").trim();
}

/**
 * Tiền tố học phần `"HP2 - "` ở ĐẦU tên bài.
 *
 * Đo trên PROD 26/08: giáo trình do Đào tạo soạn tay đặt tên bài kèm sẵn học phần —
 * `"HP2 - Họa Sĩ Robot"`, `"HP1 - Máy đập bóng cơ"`, `"HP3 - Ôn tập kiến thức"`. Khác hẳn
 * dev/test (tên bài kiểu `"Buổi 2 — …"`), nên bẫy này chỉ lộ ra khi chạm dữ liệu thật.
 *
 * Hai chỗ đau khác nhau:
 *   • phiếu gửi PHỤ HUYNH phải là TÊN TRẦN (chốt 25/08) ⇒ `"Dự án: Họa Sĩ Robot"`,
 *     không phải `"Dự án: HP2 - Họa Sĩ Robot"`;
 *   • NHÃN BUỔI vẫn muốn có học phần ⇒ `"Buổi 5 - HP2 - Họa Sĩ Robot"`.
 * Nên KHÔNG vứt tiền tố đi: cắt khỏi tên, rồi trả lại qua `moduleCodeFromTitle` để
 * `deriveSessionLabel` dựng lại đúng chỗ. Bài đã seed có `Lesson.moduleCode` thật thì
 * cột đó thắng — đây chỉ là đường lùi cho giáo trình gõ tay chưa có moduleCode.
 *
 * PHẢI có dấu ngăn sau số mới cắt: `"HP2"` trần hay `"HPV cảm biến"` không phải tiền tố.
 */
const MODULE_PREFIX = /^hp\s*(\d+)\s*[—–\-:.]\s*/i;

function stripModulePrefix(s: string): string {
  return s.replace(MODULE_PREFIX, "").trim();
}

/** `"HP2 - Họa Sĩ Robot"` → `"HP2"`; không có tiền tố → `""`. */
export function moduleCodeFromTitle(s: string | null | undefined): string {
  const m = MODULE_PREFIX.exec(clean(s));
  return m ? `HP${m[1]}` : "";
}

/**
 * `clean()` + coi ô trống `"Buổi N"` như chuỗi rỗng + cắt tiền tố `"Buổi N —"` thừa.
 *
 * Export vì cổng phụ huynh cũng phải làm y hệt: `lib/portal/{feedback,photos,schedule}.ts`
 * tự ghép `"Buổi N: <tên bài>"` (portal V2 cắt lại tiền tố đó để in số buổi ở huy hiệu
 * riêng), nên nếu tên bài đã mang sẵn `"Buổi 7 — "` thì phụ huynh đọc ra
 * `"Buổi 7: Buổi 7 — Vòng lặp và điều kiện"`.
 */
export function meaningfulSessionTitle(s: string | null | undefined): string {
  const t = clean(s);
  if (isBlankSessionTitle(t)) return "";
  // Cắt CẢ HAI tiền tố, theo thứ tự này: `"Buổi 5 - HP2 - Họa Sĩ Robot"` có cả hai.
  return stripModulePrefix(stripSessionNumberPrefix(t));
}

/** Bí danh nội bộ cho gọn — cùng một hàm. */
const meaningful = meaningfulSessionTitle;

/**
 * TIÊU ĐỀ BUỔI lấy từ giáo trình của lớp — chuỗi TRẦN, không có tiền tố "Dự án N".
 *
 * Thứ tự ưu tiên là thứ tự "ai gần buổi này nhất" — BỎ QUA ô trống `"Buổi N"`
 * (xem `isBlankSessionTitle`):
 *   1. `ClassSessionPlan.customTitle` — giáo trình đã ghim cho CHÍNH lớp này, giáo vụ
 *      sửa được từng buổi;
 *   2. `Lesson.title` — tên bài trong giáo trình gốc của khoá;
 *   3. `ClassSession.topic` — chủ đề gõ tay ở cấp buổi (lớp không ghim giáo trình).
 *
 * Trả `""` khi cả ba đều trống — chỗ gọi tự quyết hiển thị gì (bảng thì để trống cho
 * sạch, phiếu thì rơi về DEFAULT_PROJECT_NAME). Cố ý KHÔNG bịa "Buổi N" ở đây: đó là
 * việc của `sessionNumberLabel`, và trộn hai thứ vào một chuỗi thì cột "Buổi" và cột
 * "Tiêu đề" sẽ in trùng nhau.
 */
export function deriveSessionTitle(
  src: Pick<SessionProjectSource, "planTitle" | "lessonTitle" | "topic">,
): string {
  return meaningful(src.planTitle) || meaningful(src.lessonTitle) || meaningful(src.topic);
}

/**
 * TÊN DỰ ÁN in trên phiếu nhận xét gửi phụ huynh = TÊN BÀI TRẦN của giáo trình,
 * vd `Bàn Tay Ma Thuật`.
 *
 * 25/08 — bỏ tiền tố `Dự án {N}: ` (chủ dự án chốt: phụ huynh chỉ cần tên dự án).
 * Lý do kỹ thuật đi kèm: số N ở đây là số buổi THEO NGÀY của lớp
 * (`buildSessionNumberMap`), không phải `Lesson.order`; chèn buổi bù hay huỷ buổi làm
 * hai số lệch nhau, nên `Dự án 8` có thể dán vào bài số 7 của giáo trình. Bỏ tiền tố
 * là hết nguy cơ đó. Số buổi vẫn hiện đầy đủ ở NHÃN BUỔI (`deriveSessionLabel`).
 *
 * Không tra được tên bài → `Dự án {số buổi}`; không có gì → DEFAULT_PROJECT_NAME
 * (ô Dự án không bao giờ để trống).
 */
export function deriveSessionProjectName(src: SessionProjectSource): string {
  const title = deriveSessionTitle(src);
  if (title) return title;

  const n = sessionOrLessonNumber(src);
  if (n) return `Dự án ${n}`;
  return DEFAULT_PROJECT_NAME;
}

/**
 * Số buổi để IN RA — ⚠️ 08/09/2026 ĐẢO THỨ TỰ ƯU TIÊN. Đây là bản vá của sự cố
 * "lệch tên bài" (`docs/dieu-tra-lech-bai-hoc.md`).
 *
 * TRƯỚC: `sessionNumber` (hạng theo NGÀY) thắng → nhãn ghép "Buổi {hạng ngày}" với
 * "{tên bài theo FK}". Buổi bị dời ngày là hai vế nói hai chuyện khác nhau: lớp
 * `CS2.SATA6.26.001` có buổi 25/06 mang bài 43 nhưng in ra "Buổi 2".
 *
 * NAY: số LỘ TRÌNH thắng (`plan.order + 1` → `Lesson.order`), hạng-theo-ngày chỉ còn là
 * nấc CUỐI. Một chỗ sửa này chữa cho MỌI nơi in nhãn — 22 file vốn đã truyền
 * `lessonOrder` sẵn, nên chúng đúng ngay mà không phải đụng tới.
 *
 * ⚠️ Nấc cuối ở ĐÂY in "Buổi N" TRẦN, không kèm "(theo lịch)". Cố ý: nhãn ghép đi qua
 * `stripSessionNumberPrefix` ở cổng phụ huynh — hàm đó khớp "Buổi N" rồi NGAY dấu
 * ngăn cách, nên chèn chữ vào giữa là hỏng việc cắt tiền tố. Chỗ in số TRẦN dùng
 * `nhanSoBuoi` (`lib/lms/session-order.ts`), hàm đó có kèm chú thích.
 */
function sessionOrLessonNumber(src: SessionProjectSource): number | null {
  const loTrinh = soBuoiTheoLoTrinh({
    planOrder: src.planOrder,
    lessonOrder: src.lessonOrder,
  });
  if (loTrinh !== null) return loTrinh;
  if (typeof src.sessionNumber === "number" && src.sessionNumber > 0) {
    return src.sessionNumber;
  }
  return null;
}

/**
 * NHÃN BUỔI HỌC cho cột "Buổi học" của bảng điểm danh / nhận xét:
 * `Buổi 1 - HP1 - Bàn Tay Ma Thuật`.
 *
 * 25/08 — gộp hai cột `Buổi` ("Buổi 1") và `Buổi học` ("Buổi học") vốn dư một cột, mà
 * cột thứ hai thì in hằng số vì `ClassSession.topic` gần như luôn null.
 *
 * Rút gọn dần khi thiếu mảnh, không bao giờ để lại dấu `-` cụt:
 *   đủ ba              → `Buổi 1 - HP1 - Bàn Tay Ma Thuật`
 *   không có học phần  → `Buổi 1 - Bàn Tay Ma Thuật`   (khoá luyện thi Sata1/2/8)
 *   chưa có giáo trình → `Buổi 1`
 *   chưa tra được số   → `HP1 - Bàn Tay Ma Thuật`
 *   không có gì        → `""` (chỗ gọi tự quyết, thường in "Buổi học")
 */
export function deriveSessionLabel(src: SessionProjectSource): string {
  const parts: string[] = [];

  const n = sessionOrLessonNumber(src);
  if (n) parts.push(`Buổi ${n}`);

  // `Lesson.moduleCode` (bài đã seed) thắng; giáo trình gõ tay chưa có cột đó thì lấy lại
  // tiền tố `"HPn - "` vừa bị cắt khỏi chính tên bài — xem `stripModulePrefix`.
  const mod =
    clean(src.moduleCode) ||
    moduleCodeFromTitle(src.planTitle) ||
    moduleCodeFromTitle(src.lessonTitle) ||
    moduleCodeFromTitle(src.topic);
  if (mod) parts.push(mod);

  const title = deriveSessionTitle(src);
  if (title) parts.push(title);

  return parts.join(" - ");
}

/**
 * TÊN DỰ ÁN ĐỂ HIỂN THỊ — cắt tiền tố `"Dự án N:"` khỏi giá trị ĐÃ LƯU.
 *
 * Vì sao (26/08): mọi màn in tên dự án đều đã có nhãn `"Dự án:"` đứng trước, mà
 * `StudentSessionFeedback.projectName` của phiếu cũ lại lưu sẵn cả tiền tố ⇒ phụ huynh
 * đọc ra `"Dự án: Dự án 3: Robot tránh vật cản"`.
 *
 * Tệ hơn: con số trong tiền tố là số buổi TẠI THỜI ĐIỂM LƯU, nên phiếu của **Buổi 2**
 * vẫn đề **"Dự án 3"** — hai con số chọi nhau ngay trên một thẻ. Không sửa được dữ liệu
 * đã lưu (phiếu là bản ghi tại thời điểm gửi, xem ghi chú đầu file), nhưng cắt tiền tố
 * lúc HIỂN THỊ thì vừa hết lặp nhãn vừa hết con số nói dối.
 *
 * Chỉ cắt khi có dấu ngăn ngay sau số — `"Dự án cuối khoá"` là tên bài thật, giữ nguyên.
 */
export function displayProjectName(saved: string | null | undefined): string {
  const t = clean(saved);
  if (!t) return "";
  return t.replace(/^dự\s*án\s+\d+\s*[:\-–—.]\s*/i, "").trim() || t;
}

/**
 * TÊN DỰ ÁN ĐỂ HIỂN THỊ trên phiếu nhận xét đã lưu (portal PH · admin · PDF · site GV).
 *
 * ⚠️ Ưu tiên tên suy từ BUỔI HỌC, không phải giá trị đã lưu trên phiếu.
 *
 * Vì sao (26/08 — lỗi NT-09 lần 3): `StudentSessionFeedback.projectName` là bản sao ĐÔNG
 * CỨNG ghi lúc giáo viên bấm lưu, và nó **theo từng học viên**. Đo trên dữ liệu thật của
 * lớp CS1.LAPTRI.006 buổi 8 ("Buổi 8 — Tay gắp cơ khí"): năm học viên trong CÙNG một buổi
 * mang năm "dự án" khác nhau — *Xe dò vạch · Cánh tay gắp · Robot tránh vật cản · Xe điều
 * khiển từ xa · Xe vượt địa hình* — không cái nào dính đến bài học của buổi. Phụ huynh mở
 * báo cáo ra đọc được "Buổi 8: Tay gắp cơ khí" ở tiêu đề nhưng "Dự án: Robot tránh vật
 * cản" ngay dưới.
 *
 * Cả lớp học chung một bài thì cả lớp làm chung một dự án ⇒ tên dự án là thuộc tính của
 * BUỔI, suy ra từ giáo trình, giống hệt cách `deriveSessionLabel` dựng nhãn buổi. Ô nhập
 * ở phiếu giáo viên đã ghi giá trị suy sẵn này từ 25/08, nhưng phiếu CŨ vẫn giữ giá trị
 * cũ — sửa ở chỗ ĐỌC thì mọi phiếu cũ tự đúng, không cần migration đụng dữ liệu prod.
 *
 * Chỉ lùi về giá trị đã lưu khi buổi KHÔNG suy được tên (chưa gắn giáo án): lúc đó thứ
 * giáo viên gõ tay vẫn hơn `DEFAULT_PROJECT_NAME` trống rỗng.
 */
export function resolveDisplayProjectName(
  src: SessionProjectSource,
  saved: string | null | undefined,
): string {
  const fromSession = deriveSessionTitle(src);
  if (fromSession) return fromSession;

  const fromSaved = displayProjectName(saved);
  if (fromSaved) return fromSaved;

  return deriveSessionProjectName(src);
}
