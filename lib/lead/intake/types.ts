// =============================================================================
// LEAD INTAKE — kiểu dữ liệu chung cho mọi nguồn nhập ngoài (form Sale, quatang…).
//
// Ranh giới cố ý: MAPPER là hàm THUẦN (không đụng DB) — nhận payload thô của
// một nguồn, trả về `MappedLead`. Việc tra `centerId`/`assignedToId` trong DB
// nằm ở tầng ingest. Nhờ vậy mapper test được bằng unit test thuần, không cần
// Postgres, và thêm nguồn mới chỉ là thêm 1 file mapper.
// =============================================================================

/** Một người con trong phiếu đăng ký (map thẳng sang `LeadChild`). */
export type IntakeChild = {
  fullName: string;
  schoolName?: string | null;
  gradeLevel?: string | null;
  /**
   * KHOÁ QUAN TÂM của riêng em này (`LeadChild.interestedCourseId`), 03/09/2026.
   *
   * Đặt ở TỪNG CON, không đặt ở phiếu: hai em cùng một phụ huynh thường hỏi hai
   * khoá khác nhau theo tuổi. Và đây là trường mà màn Chuyển đổi dùng để lọc ô
   * "Lớp đăng ký" — để trống thì ô đó rơi về "hiện đủ mọi lớp".
   */
  interestedCourseId?: string | null;
};

/**
 * Gợi ý cơ sở lấy từ payload. KHÔNG phải `centerId` — tầng ingest mới tra DB.
 * - `code`  : nguồn gửi mã dạng "CS1" (form Sale gửi số 1/2 → quy ra CS1/CS2).
 * - `text`  : nguồn gửi chuỗi tự do ("Cơ sở 2 - 114 Hoàng Diệu, Đà Nẵng").
 */
export type CenterHint =
  | { kind: "code"; value: string }
  | { kind: "text"; value: string };

/** Kết quả map 1 payload → dữ liệu sẵn sàng ghi Lead. */
export type MappedLead = {
  parentName: string;
  /**
   * Đã chuẩn hoá canonical `84XXXXXXXXX` (qua `canonicalPhone`).
   *
   * Chuỗi RỖNG chỉ hợp lệ khi caller bật `allowMissingPhone` (biểu mẫu nội bộ
   * `/nhap-khach-hang` — chốt 22/08/2026: không ô nào bắt buộc). Mọi nguồn ngoài
   * vẫn bị `ingestIntakeLead` từ chối nếu thiếu số.
   */
  phone: string;
  email?: string | null;
  /**
   * Link Facebook/Messenger của phụ huynh → `Lead.facebookUrl`. Với lead từ
   * quảng cáo FB, đây thường là đường liên hệ DUY NHẤT lúc mới thu về.
   */
  facebookUrl?: string | null;
  /**
   * Nguồn khách do NGƯỜI NHẬP khai (ô "Nguồn" trên biểu mẫu) → ghi đè
   * `IntakeContext.source` khi ghi `Lead.source`.
   *
   * Hai khái niệm khác nhau, đừng gộp: `ctx.source` là **kênh kỹ thuật** phiếu
   * đi vào (dùng cho log, `LeadDuplicate.source`, cảnh báo sức khoẻ đường nhận),
   * còn cái này là **nguồn marketing** mà người nhập biết ("chạy ads bài A",
   * "PH cũ giới thiệu"). Trống ⇒ giữ nguyên `ctx.source` như trước.
   */
  leadSource?: string | null;
  centerHint?: CenterHint | null;
  /**
   * Các con được tạo thành bản ghi `LeadChild` thật.
   *
   * 03/09/2026 — đổi từ `child?: IntakeChild | null` (MỘT con) sang mảng. Phiếu
   * thật hay có 2 em: trước đó biểu mẫu nội bộ chỉ nhận được một, em thứ hai
   * phải gõ thành phiếu riêng rồi bị chính cơ chế chống trùng SĐT gộp lại —
   * tức là mất.
   *
   * Rỗng/vắng ⇒ KHÔNG tạo `LeadChild` nào (giữ hành vi cũ của `child: null`,
   * để không đẻ bản ghi rác từ 3 webhook cũ chỉ moi được tên từ text tự do).
   */
  children?: IntakeChild[] | null;
  /**
   * Tên con khi nguồn CHỈ có chuỗi tên, không đủ tin để đẻ `LeadChild`
   * (3 webhook cũ moi tên từ text tự do). Chỉ set `Lead.childName`.
   * Đặt `child` thì không cần trường này — tầng ingest tự lấy từ `child.fullName`.
   */
  childName?: string | null;
  /** Mã nhân viên giới thiệu/nhập hộ → tầng ingest quy ra `assignedToId`. */
  employeeCode?: string | null;
  /** Các dòng ghép vào `Lead.note` (tỉnh/TP, địa chỉ, nguồn phụ…). */
  noteLines: string[];
  externalId?: string | null;
  consentMarketing: boolean;
  /**
   * Chuyện bất thường nhưng KHÔNG đủ để từ chối (mã NV không khớp, thiếu tên
   * PH, mã tỉnh lạ…). Tầng ingest ghép vào `note` để người xử lý lead thấy —
   * nuốt im lặng là cách hỏng tệ nhất.
   */
  warnings: string[];
};

export type MapResult =
  | { ok: true; lead: MappedLead }
  | { ok: false; error: string };
