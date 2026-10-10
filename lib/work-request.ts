// lib/work-request.ts — cấu hình Đơn từ GV (pure, dùng chung client/server/PDF).
// 10 loại / 3 nhóm + nhãn + quy tắc field theo loại (khớp reference :3001 don-tu).

export const WORK_REQUEST_KINDS = [
  "CLASS_CHANGE",
  "SUB_TEACH",
  "CLASS_OFF",
  "SHIFT_SWAP",
  "OT",
  "LATE_EARLY",
  "TIMESHEET_FIX",
  "LEAVE",
  "REMOTE",
  "BUSINESS_TRIP",
  "COMP_LEAVE",
  "HOLIDAY_WORK",
  "OUTSIDE_ATTENDANCE",
] as const;
export type WorkRequestKindV = (typeof WORK_REQUEST_KINDS)[number];

// WITHDRAWN — người nộp thu hồi khi đơn còn chờ (đợt 1 đơn từ, chốt Q-2 08/10/2026).
// CANCEL_REQUESTED / CANCELLED — huỷ đơn ĐÃ DUYỆT (đợt 11): xin huỷ ⇒ quản lý duyệt huỷ ⇒ hoàn tác.
export const WORK_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "CANCEL_REQUESTED", "CANCELLED"] as const;
export type WorkRequestStatusV = (typeof WORK_REQUEST_STATUSES)[number];

/**
 * Trạng thái đang CHỜ QUẢN LÝ làm gì đó — đơn mới chờ duyệt, và đơn đã duyệt đang xin huỷ (đợt 11).
 * Mọi bộ đếm "việc chờ duyệt" (chuông, dashboard, hàng chờ, cảnh báo chốt kỳ) đọc hằng này.
 */
export const TRANG_THAI_CHO_QUAN_LY = ["PENDING", "CANCEL_REQUESTED"] as const satisfies readonly WorkRequestStatusV[];

export const WR_KIND_LABEL: Record<WorkRequestKindV, string> = {
  CLASS_CHANGE: "Đổi lớp dạy",
  SUB_TEACH: "Dạy thay",
  CLASS_OFF: "Nghỉ buổi dạy",
  SHIFT_SWAP: "Đổi ca",
  OT: "Tăng ca (OT)",
  LATE_EARLY: "Đi muộn / Về sớm",
  TIMESHEET_FIX: "Chỉnh công",
  LEAVE: "Nghỉ phép",
  REMOTE: "Làm từ xa",
  BUSINESS_TRIP: "Đi công tác",
  COMP_LEAVE: "Nghỉ bù",
  HOLIDAY_WORK: "Làm ngày nghỉ / ngày lễ",
  OUTSIDE_ATTENDANCE: "Chấm công ngoài địa điểm",
};

export type WrCategoryKey = "class" | "shift" | "leave";
export const WR_CATEGORIES: { key: WrCategoryKey; label: string; kinds: WorkRequestKindV[] }[] = [
  { key: "class", label: "Liên quan lớp học", kinds: ["CLASS_CHANGE", "SUB_TEACH", "CLASS_OFF"] },
  { key: "shift", label: "Ca làm & chấm công", kinds: ["SHIFT_SWAP", "OT", "HOLIDAY_WORK", "LATE_EARLY", "TIMESHEET_FIX", "OUTSIDE_ATTENDANCE"] },
  { key: "leave", label: "Nghỉ phép & khác", kinds: ["LEAVE", "COMP_LEAVE", "REMOTE", "BUSINESS_TRIP"] },
];

export function wrCategoryOf(k: WorkRequestKindV): (typeof WR_CATEGORIES)[number] {
  return WR_CATEGORIES.find((c) => c.kinds.includes(k))!;
}
export const isClassKind = (k: WorkRequestKindV) => wrCategoryOf(k).key === "class";
/** Đơn 1 ngày + có mốc giờ/số giờ. */
export const isSingleKind = (k: WorkRequestKindV) =>
  k === "LATE_EARLY" ||
  k === "OT" ||
  k === "TIMESHEET_FIX" ||
  k === "COMP_LEAVE" ||
  k === "HOLIDAY_WORK" ||
  k === "OUTSIDE_ATTENDANCE";
/** Đơn khoảng ngày (từ → đến). */
export const isRangeKind = (k: WorkRequestKindV) =>
  k === "LEAVE" || k === "REMOTE" || k === "BUSINESS_TRIP";

export const WR_STATUS_LABEL: Record<WorkRequestStatusV, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  WITHDRAWN: "Đã thu hồi",
  CANCEL_REQUESTED: "Chờ duyệt huỷ",
  CANCELLED: "Đã huỷ",
};

/** Số giờ từ 2 mốc "HH:mm" (dương mới hợp lệ). */
export function diffHours(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const [h1, m1] = a.split(":").map(Number);
  const [h2, m2] = b.split(":").map(Number);
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return null;
  const v = (h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
  return v > 0 ? Number(v.toFixed(1)) : null;
}

/**
 * Kiểm khoảng ngày của đơn — dùng ở SERVER, không phải chỉ ở form.
 *
 * QA site GV vòng 1 (NV-005) đo được trên UAT những đơn vô nghĩa: "Đi muộn / Về sớm"
 * kéo 27 ngày, và đơn có ngày gửi SAU ngày bắt đầu. Truy ra thì đó là dữ liệu seed —
 * `isRangeKind` đã ép `to = from` cho các loại một-ngày nên form không tạo ra được.
 * Nhưng vẫn còn một lỗ THẬT: không chỗ nào kiểm `to >= from` cho loại CÓ khoảng, nên
 * một lời gọi thẳng vào Server Action với `toDate` lùi trước `fromDate` vẫn ghi được.
 *
 * Trả `null` khi hợp lệ, hoặc câu lỗi tiếng Việt để hiện thẳng cho người dùng.
 */
export function kiemKhoangNgayDon(
  kind: WorkRequestKindV,
  from: Date | null,
  to: Date | null,
): string | null {
  if (!from || Number.isNaN(from.getTime())) return "Chọn ngày cho đơn này.";
  if (!isRangeKind(kind)) return null;
  if (!to || Number.isNaN(to.getTime())) return "Chọn ngày kết thúc.";
  if (to.getTime() < from.getTime()) {
    return "Ngày kết thúc không được trước ngày bắt đầu.";
  }
  return null;
}

// ─── Giải thích từng loại đơn — nội dung chữ "i" (06/10/2026) ─────────────────────────
//
// Chủ dự án: *"thêm chữ i nhỏ giải thích cho từng trường hợp đơn cho người dùng đỡ thắc
// mắc"*. Bảng này là NGUỒN DUY NHẤT của lời giải thích: thẻ chọn loại ở form nộp (admin +
// site GV), nhãn loại ở màn duyệt của QLCS và danh sách "đơn của tôi" cùng đọc từ đây —
// hai bản chữ là hai lời hứa trôi khỏi nhau.
//
// ⚠️ LUẬT 12 — mục `khiDuyet` phải nói ĐÚNG việc hệ thống làm, không hơn. Đọc từ mã thật
// (đo 06/10/2026):
//   · CLASS_OFF / SUB_TEACH → `lib/cham-cong/don/lop-hoc.ts` (huỷ buổi + buổi bù cuối lịch /
//     gán GV dạy thay; SUB_TEACH thiếu người thay ⇒ KHÔNG duyệt được).
//   · SHIFT_SWAP / LEAVE / TIMESHEET_FIX / LATE_EARLY → handler ở `lib/cham-cong/don/ca-nghi-cong.ts`
//     (người nhận/làm thay CHỈ được xếp ca khi đơn chọn mã ca cho họ; nghỉ chỉ xếp người
//     làm thay ngày ĐẦU; chỉnh công đủ bộ mốc của ca ⇒ ghi đè, thiếu ⇒ ghi thêm; đi muộn/về
//     sớm ⇒ tính lại ngày, engine miễn trừ trong khung đã xin — đợt 2, 08/10/2026).
//   · CLASS_CHANGE / OT / REMOTE / BUSINESS_TRIP → `duyetChiGhiNhan`: chỉ đổi trạng thái; đơn đã
//     duyệt hiện cạnh ngày công ở `/cham-cong`. Không cộng giờ OT, không tự xếp ca công tác
//     (nút công tác đòi ca `placeMode = OFFSITE`).
//   Bảng loại → handler: `lib/cham-cong/don/registry.ts`.
//   · Không có quỹ phép: `LeaveType.maxDaysPerYear` chưa nơi nào chặn ⇒ KHÔNG hứa "trừ phép".
//   · `shift.requestNoticeDays` chỉ gắn cờ "Nộp muộn", không chặn; `LeaveType.noticeDays` thì
//     CHẶN nộp sát ngày nếu không chọn người làm thay (`submitAttendanceRequest`).
// Sửa luật ở các file trên mà không sửa chữ ở đây là màn hình nói dối — `lib/work-request-giai-thich.test.ts`
// ghim các câu then chốt vào đúng nhánh mã.

export type GiaiThichLoaiDon = {
  /** Một dòng dưới nhãn ở thẻ chọn loại đơn. */
  moTaNgan: string;
  /** Dùng khi nào — một câu, có ví dụ đời thường. */
  dungKhi: string;
  /** Cần điền gì. */
  canDien: string;
  /** Khi quản lý DUYỆT, hệ thống tự làm gì — đúng mã, không hứa thêm. */
  khiDuyet: string;
  /** Lưu ý riêng của loại này (có thể rỗng). */
  luuY: readonly string[];
  /** Gợi ý ô "Lý do" — placeholder của form. */
  goiYLyDo: string;
};

export const WR_KIND_GIAI_THICH: Record<WorkRequestKindV, GiaiThichLoaiDon> = {
  CLASS_CHANGE: {
    moTaNgan: "Xin đổi lớp mình phụ trách",
    dungKhi: "Khi bạn cần đổi lớp đang dạy, ví dụ lớp mới mở trùng giờ với lớp đang phụ trách.",
    canDien: "Lớp liên quan, ngày áp dụng và lý do.",
    khiDuyet:
      "Hệ thống chỉ ghi nhận đơn đã duyệt — KHÔNG tự đổi lớp hay lịch dạy. Quản lý đổi giáo viên phụ trách trên màn lớp học.",
    luuY: [],
    goiYLyDo: "VD: Lớp Sata 3 mới mở trùng giờ với lớp đang dạy",
  },
  SUB_TEACH: {
    moTaNgan: "Nhờ đồng nghiệp dạy thay một buổi",
    dungKhi:
      "Khi bạn không dạy được một buổi và đã có đồng nghiệp nhận dạy thay, ví dụ đi khám bệnh đúng giờ lớp.",
    canDien: "Lớp, ngày buổi dạy, người dạy thay và lý do.",
    khiDuyet:
      "Hệ thống tự gán người dạy thay vào buổi học của lớp ngày đó. Chặn nếu người dạy thay đang có buổi dạy lớp khác cùng giờ. Giờ và phòng của buổi không đổi nên không kiểm lại phòng — phòng đang trùng sẵn với lớp khác chỉ hiện cảnh báo cho người duyệt.",
    luuY: [
      "Bắt buộc chọn người dạy thay — đơn không có người thay thì quản lý không duyệt được.",
      "Lớp không có buổi học vào ngày đã chọn thì đơn không duyệt được.",
    ],
    goiYLyDo: "VD: Đi khám bệnh, cô Lan đã nhận dạy thay",
  },
  CLASS_OFF: {
    moTaNgan: "Huỷ một buổi dạy, lớp học bù sau",
    dungKhi: "Khi buổi học phải nghỉ hẳn và không ai dạy thay, ví dụ giáo viên ốm đột xuất.",
    canDien: "Lớp, ngày buổi dạy và lý do.",
    khiDuyet:
      "Hệ thống huỷ buổi học của lớp ngày đó và tự thêm một buổi bù ở cuối lịch, để lớp không mất buổi.",
    luuY: [
      "Buổi đã điểm danh, đã có nhận xét, bài tập hoặc ảnh lớp thì không huỷ được — đơn quay lại chờ duyệt kèm lý do.",
      "Có người dạy thay thì chọn đơn “Dạy thay” thay vì đơn này.",
    ],
    goiYLyDo: "VD: Sốt cao, không có người dạy thay",
  },
  SHIFT_SWAP: {
    moTaNgan: "Làm ca khác với lịch đã xếp",
    dungKhi:
      "Khi bạn cần làm ca khác trong một ngày, ví dụ đổi ca sáng sang ca chiều, hoặc đổi ca cho nhau với đồng nghiệp.",
    canDien: "Ngày, mã ca mới của bạn; đổi với người khác thì chọn thêm người nhận và ca của họ.",
    khiDuyet:
      "Hệ thống ghi ca mới lên lịch ca của bạn ngày đó (và của người nhận, nếu đơn có chọn ca cho họ), rồi tính lại công.",
    luuY: [
      "Chọn người nhận mà KHÔNG chọn ca cho họ thì lịch của người nhận giữ nguyên.",
      "Mỗi đơn đổi một ngày.",
    ],
    goiYLyDo: "VD: Buổi sáng có việc gia đình, xin làm ca chiều",
  },
  OT: {
    moTaNgan: "Làm thêm giờ ngoài ca",
    dungKhi: "Khi bạn làm thêm ngoài giờ ca đã xếp, ví dụ ở lại 18:00–20:00 hỗ trợ sự kiện.",
    canDien: "Ngày, giờ bắt đầu – giờ kết thúc (hệ thống tự tính số giờ) và lý do.",
    khiDuyet:
      "Khi duyệt, thời gian OT hợp lệ sẽ được đối chiếu với chấm công thực tế: chỉ phút bạn THẬT SỰ làm, nằm trong khung được duyệt và ngoài giờ ca, mới được tính.",
    luuY: [
      "Giờ kết thúc phải sau giờ bắt đầu.",
      "Quản lý có thể duyệt một khung hẹp hơn khung bạn xin.",
      "Ngày nghỉ, ngày lễ hoặc ngày không có ca thì dùng đơn \"Làm ngày nghỉ / ngày lễ\".",
      "Nhớ chấm công lúc bắt đầu và kết thúc tăng ca — không có lượt quét thì không có phút OT.",
    ],
    goiYLyDo: "VD: Hỗ trợ sự kiện trải nghiệm cuối tuần",
  },
  LATE_EARLY: {
    moTaNgan: "Báo đến muộn hoặc về sớm",
    dungKhi: "Khi bạn biết trước mình sẽ đến muộn hoặc phải về sớm, ví dụ đưa con đi khám buổi sáng.",
    canDien: "Ngày, chọn Đi muộn hay Về sớm, giờ dự kiến và lý do.",
    khiDuyet:
      "Phần đến muộn / về sớm NẰM TRONG giờ bạn xin không bị tính vi phạm: không đếm lần trễ, ô công không tô đỏ. Đến muộn hơn (hoặc về sớm hơn) giờ đã xin thì phần vượt vẫn tính như bình thường.",
    luuY: ["Ghi đúng giờ bạn dự kiến đến/về — hệ thống chỉ miễn trong khung giờ đó, không miễn cả ngày."],
    goiYLyDo: "VD: Đưa con đi khám, đến cơ sở khoảng 9:00",
  },
  TIMESHEET_FIX: {
    moTaNgan: "Quên quét, quét nhầm hoặc máy lỗi",
    dungKhi: "Khi giờ vào/ra của một ngày bị thiếu hoặc sai, ví dụ quên quét mã lúc về.",
    canDien:
      "Ngày cần chỉnh và giờ đúng theo thứ tự Vào 1 · Ra 1 (ca hai buổi thì thêm Vào 2 · Ra 2), cùng lý do.",
    khiDuyet:
      "Hệ thống ghi các mốc giờ bạn khai (đánh dấu “chỉnh tay”) rồi tính lại công ngày đó. Khai ĐỦ mốc của ca thì các lượt quét cũ được giữ để xem nhưng thôi tính công (ghi đè); khai thiếu thì chỉ thêm mốc, lượt quét cũ vẫn tính.",
    luuY: [
      "Giờ phải tăng dần: Vào 1 < Ra 1 < Vào 2 < Ra 2.",
      "Chỉ quên một đầu (vd quên quét ra) thì chỉ điền ô đó.",
    ],
    goiYLyDo: "VD: Quên quét mã lúc về, ra về 17:30",
  },
  LEAVE: {
    moTaNgan: "Nghỉ một hoặc nhiều ngày",
    dungKhi: "Khi bạn nghỉ cả ngày, ví dụ nghỉ phép năm, nghỉ ốm hay việc hiếu hỉ.",
    canDien: "Loại nghỉ, cả ngày / nửa buổi sáng / nửa buổi chiều / theo giờ, ngày (và khung giờ nếu nghỉ theo giờ), người làm thay (nếu có) và lý do.",
    khiDuyet:
      "Nghỉ CẢ NGÀY: hệ thống ghi mã nghỉ lên lịch ca từng ngày (P nếu loại nghỉ có lương, X nếu không lương) rồi tính lại công; chọn người làm thay KÈM ca của họ thì hệ thống xếp ca đó cho người làm thay vào ngày đầu tiên. Nghỉ NỬA BUỔI / THEO GIỜ: ca giữ nguyên, chỉ thời gian được duyệt mới được miễn nghĩa vụ chấm công — phần còn lại của ca vẫn chấm như bình thường.",
    luuY: [
      "Hệ thống KHÔNG tự trừ vào số ngày phép còn lại — chưa có quỹ phép năm.",
      "Nghỉ nửa buổi chỉ dùng cho ca có buổi sáng và buổi chiều riêng (vd ca hành chính); nghỉ nửa buổi / theo giờ chỉ một ngày mỗi đơn.",
      "Một số loại nghỉ phải báo trước (vd nghỉ phép năm, kết hôn); nộp sát ngày thì bắt buộc chọn người làm thay. Ốm, ma chay, thai sản không cần báo trước.",
      "Tối đa 62 ngày một đơn.",
    ],
    goiYLyDo: "VD: Về quê dự đám cưới em gái",
  },
  REMOTE: {
    moTaNgan: "Làm việc tại nhà, không đến cơ sở",
    dungKhi: "Khi bạn làm việc từ xa thay vì đến cơ sở, ví dụ soạn giáo án tại nhà một ngày.",
    canDien: "Từ ngày – đến ngày, khung giờ nếu chỉ làm từ xa một phần ngày, và lý do.",
    khiDuyet:
      "Khi duyệt, bạn vẫn chấm công theo ca nhưng không bị yêu cầu chấm tại văn phòng trong thời gian được duyệt — bấm nút \"Chấm công\" trên trang Chấm công thay cho quét QR. Ca và công giữ nguyên.",
    luuY: [
      "Tối đa 62 ngày một đơn.",
      "Không khai giờ = cả ngày. Khai giờ thì chỉ trong khung đó (thêm dung sai vài chục phút hai đầu) mới chấm ngoài văn phòng được.",
      "Vẫn phải chấm công đủ lượt như ngày thường — làm từ xa không tự tính đủ công.",
    ],
    goiYLyDo: "VD: Soạn bộ giáo án Sata 4 tại nhà",
  },
  BUSINESS_TRIP: {
    moTaNgan: "Đi làm việc ở nơi khác",
    dungKhi: "Khi bạn đi làm việc ngoài cơ sở, ví dụ hỗ trợ cơ sở khác hay đưa học viên đi thi.",
    canDien: "Từ ngày – đến ngày, nơi đến và lý do.",
    khiDuyet:
      "Khi duyệt, hệ thống tự ghi nhận lịch công tác; không cần quản lý xếp thêm ca công tác. Lịch phủ từng ngày trong khoảng, mặc định những ngày đó đủ công theo ca, không cần quét (quản lý hệ thống có thể đổi sang \"vẫn phải chấm công\").",
    luuY: [
      "Tối đa 62 ngày một đơn.",
      "Muốn chấm công trong lúc công tác thì bấm nút \"Chấm công\" trên trang Chấm công, ở đâu cũng được.",
      "Ngày công tác mà bạn không có ca thì chưa tính công — báo quản lý xếp ca nếu cần.",
    ],
    goiYLyDo: "VD: Đưa đội tuyển đi thi RoboSim",
  },
  COMP_LEAVE: {
    moTaNgan: "Dùng quỹ nghỉ bù",
    dungKhi: "Khi bạn muốn nghỉ bằng thời gian đã tích luỹ, ví dụ nghỉ buổi chiều bù cho đợt tăng ca sự kiện (nếu công ty quy đổi tăng ca / làm ngày nghỉ sang nghỉ bù).",
    canDien: "Ngày, cả ngày / nửa buổi / theo giờ (kèm khung giờ) và lý do.",
    khiDuyet:
      "Hệ thống kiểm số dư quỹ nghỉ bù, trừ đúng số phút nghỉ khỏi quỹ, rồi tính lại công: thời gian nghỉ được miễn chấm công và vẫn hưởng lương. Không đủ quỹ thì không duyệt được.",
    luuY: [
      "Không đủ quỹ nghỉ bù thì quản lý không duyệt được — không cho nghỉ trước trừ sau.",
      "Đơn nghỉ bù đã duyệt mà bị huỷ thì số phút được hoàn lại vào quỹ.",
      "Một ngày mỗi đơn; ngày đó phải có ca.",
    ],
    goiYLyDo: "VD: Nghỉ bù buổi chiều sau đợt tăng ca sự kiện",
  },
  HOLIDAY_WORK: {
    moTaNgan: "Đi làm vào ngày nghỉ hoặc ngày lễ",
    dungKhi: "Khi bạn được yêu cầu làm việc vào ngày không có ca (ngày nghỉ tuần) hoặc ngày lễ, ví dụ trực sự kiện ngày Chủ nhật.",
    canDien: "Ngày, giờ bắt đầu – giờ kết thúc và lý do.",
    khiDuyet:
      "Khi duyệt, hệ thống KHÔNG tự cộng đủ giờ: chỉ phút bạn thật sự chấm công trong khung được duyệt mới được ghi vào cột riêng “Làm ngày lễ” hoặc “Làm ngày nghỉ” — không cộng vào công thường hay tăng ca. Nếu lúc duyệt công ty đang quy đổi làm ngày nghỉ sang nghỉ bù, số phút đó được cộng vào quỹ nghỉ bù.",
    luuY: [
      "Ngày có ca làm việc bình thường thì dùng đơn “Tăng ca”.",
      "Nhớ chấm công lúc bắt đầu và kết thúc — không có lượt quét thì không có phút nào.",
      "Hệ thống chỉ ghi số phút; hệ số lương ngày lễ do bảng lương tính.",
      "Một ngày mỗi đơn.",
    ],
    goiYLyDo: "VD: Trực sự kiện trải nghiệm ngày Chủ nhật",
  },
  OUTSIDE_ATTENDANCE: {
    moTaNgan: "Chấm công ở nơi khác trong một khung giờ",
    dungKhi: "Khi trong ca bạn phải làm việc ở chỗ khác điểm chấm công vài giờ, ví dụ đi gặp phụ huynh hay mua thiết bị.",
    canDien: "Ngày, khung giờ, địa điểm và lý do.",
    khiDuyet:
      "Khi duyệt, trong khung giờ được duyệt (cộng dung sai vài chục phút hai đầu) bạn chấm công bằng nút “Chấm công” trên trang Chấm công ở bất cứ đâu, không bị báo sai nơi làm. Ca và công giữ nguyên — vẫn tính theo lượt chấm thật.",
    luuY: [
      "Ngoài khung giờ đã duyệt thì chấm công như bình thường tại điểm chấm.",
      "Không tự tính đủ công — vẫn phải chấm đủ lượt.",
      "Một ngày mỗi đơn.",
    ],
    goiYLyDo: "VD: Đi mua linh kiện robot cho lớp Sata 4",
  },
};

/** Lưu ý chung mọi loại — in cuối mỗi chữ "i". `shift.requestNoticeDays` CHỈ gắn cờ, không chặn. */
export const WR_LUU_Y_CHUNG =
  "Nộp sát ngày vẫn gửi được, nhưng đơn mang cờ “Nộp muộn” để quản lý thấy.";

/**
 * Mã ca ghi lên lưới khi duyệt đơn NGHỈ — `P` nếu loại nghỉ có lương, `X` nếu không (hoặc không
 * khai loại). MỘT chỗ cho cả đường duyệt (`requests.ts`) lẫn câu "Khi duyệt sẽ: …" trên màn —
 * chép phép so sang lớp hiển thị là hai nơi giữ một luật rồi trôi khỏi nhau.
 */
export function maNghiTrenLuoi(paidRatio: number | null | undefined): "P" | "X" {
  return paidRatio != null && paidRatio > 0 ? "P" : "X";
}
