/**
 * AI ĐƯỢC SỬA Ô NÀO CỦA LEAD. Hàm THUẦN, không chạm DB, không hỏi `auth()`.
 *
 * ── CHỐT 17/09/2026 ──────────────────────────────────────────────────────────────────────
 * Chủ dự án: "khoá sale không sửa được nguồn lead, và nguồn lead mặc định là nguồn đầu tiên
 * khi vào hệ thống, các nguồn sau nhập bị trùng không được đè được nguồn đầu tiên, chỉ quản
 * lý cơ sở hoặc admin mới có quyền đè, role sale nhập chỉ thêm vào ghi chú nếu trùng […]
 * sale được sửa các thông tin: tên PH, email, tên con, tuổi con, khoá quan tâm, ghi chú
 * (sửa ghi chú thì ghi bổ sung ở phía sau), các trường khác: sđt, đơn vị, nguồn, không được
 * sửa nhé".
 *
 * Ba câu đó là BA MẶT của cùng MỘT quyền, nên chúng đi qua đúng một khoá: `leads:overwrite`.
 *   · sửa tay ba ô khoá (SĐT · đơn vị · nguồn)
 *   · bật cột "Đè" khi nhập Excel
 *   · thay thế (thay vì nối thêm) ghi chú
 *
 * ⚠️ VÌ SAO GỘP LÀM MỘT KHOÁ: ba mặt ấy là cùng một hành vi — LÀM MẤT dữ liệu người khác đã
 * ghi. Tách thành ba khoá là mở đường cho một vai có mặt này mà không có mặt kia, rồi ai đó
 * đi vòng: không sửa được `source` ở biểu mẫu thì nhập một file Excel một dòng có tick Đè.
 * Một khoá thì không có cửa sau.
 *
 * ── VÌ SAO LÀ HÀM THUẦN, TÁCH RIÊNG ──────────────────────────────────────────────────────
 * Luật cứng Nền Hệ thống #1 cấm viết điều kiện quyền tại chỗ (`no-inline-authz` = build
 * fail). Tệp này KHÔNG kiểm quyền — nó chỉ trả lời "cho biết có quyền đè hay không thì ô nào
 * đi lọt". Việc hỏi quyền vẫn là `can()`/`checkPermission` ở call-site, và kết quả được
 * truyền vào đây dưới dạng một `boolean`.
 *
 * Tách ra để có chỗ CẤY LỖI: danh sách ô khoá nằm trong một Server Action thì không test
 * được nếu không dựng `auth()` + DB, và một danh sách viết thiếu không ném lỗi, không làm
 * test đỏ — chỉ lộ ra khi có người sửa được thứ đáng lẽ không được (luật 12b).
 */

/**
 * BA Ô KHOÁ — không có `leads:overwrite` thì KHÔNG đường nào sửa được.
 *
 * ⚠️ `orgUnitId` PHẢI có mặt cạnh `centerId`. Người dùng thấy đúng một ô "Đơn vị", nhưng
 * biểu mẫu gửi lên `orgUnitId` còn `centerId` được SUY RA từ nó (dual-write 2-phase,
 * `lib/org/dual-write.ts`). Khoá mỗi `centerId` là khoá cái tên mà biểu mẫu không gửi —
 * nghe như đã khoá, mà thực tế ô vẫn đổi được. Đây đúng là loại lỗ im lặng mà bộ test
 * `[QUYEN-T11]` sinh ra để canh.
 */
export const O_KHOA_LEAD = ["phone", "centerId", "orgUnitId", "source"] as const;

/**
 * Ô ai có `leads:edit` cũng sửa được — kể cả Sale.
 *
 * ALLOWLIST có chủ đích, đối xứng với `INTAKE_EDITABLE_FIELDS`: thêm cột mới cho `Lead` mà
 * quên khai ở đây thì nó KHÔNG sửa được — hỏng theo chiều an toàn. Blocklist thì mỗi cột mới
 * tự động mở toang.
 */
export const O_SALE_SUA_DUOC = [
  "parentName",
  "email",
  "childName",
  "childAge",
  "courseId",
  "note",
  "facebookUrl",
] as const;

/** Nhãn người vận hành đọc được. Khoá phải trùng tên cột Prisma. */
const NHAN: Record<string, string> = {
  phone: "SĐT",
  centerId: "đơn vị",
  orgUnitId: "đơn vị",
  source: "nguồn",
};

/** Ô này có nằm trong nhóm khoá không. */
export function laOKhoa(ten: string): boolean {
  return (O_KHOA_LEAD as readonly string[]).includes(ten);
}

/**
 * Những ô KHOÁ mà lượt sửa này đang cố đụng vào.
 *
 * ⚠️ Chỉ tính ô THỰC SỰ ĐỔI. Biểu mẫu gửi cả phiếu nên `source` luôn có mặt trong `oGui` dù
 * người dùng không sờ tới nó; chặn theo "có mặt" là Sale không lưu nổi một lượt sửa tên con.
 * Đó là kiểu chặn đúng luật mà sai việc, và người dùng sẽ báo là màn hình hỏng chứ không báo
 * là bị chặn.
 */
export function oKhoaBiDung(params: {
  oGui: Record<string, unknown>;
  dangLuu: Record<string, unknown>;
}): string[] {
  const { oGui, dangLuu } = params;
  const ra: string[] = [];
  for (const cot of O_KHOA_LEAD) {
    if (!(cot in oGui)) continue;
    const moi = oGui[cot];
    if (moi === undefined) continue;
    // `null` và `""` cùng nghĩa "để trống" ở tầng biểu mẫu; so thẳng thì đổi chỗ hai cách
    // viết cùng một thứ lại thành "có đổi".
    const a = moi === null || moi === "" ? null : moi;
    const b = dangLuu[cot] === null || dangLuu[cot] === "" ? null : dangLuu[cot];
    if (a !== b) ra.push(cot);
  }
  return ra;
}

/** Câu từ chối — nói rõ ô nào và ai mở được, đừng để người dùng đoán. */
export function loiOKhoa(viPham: readonly string[]): string {
  const ten = [...new Set(viPham.map((c) => NHAN[c] ?? c))].join(", ");
  // ⚠️ KHÔNG nhắc lại tên ô nào ngoài danh sách động ở trên. Bản đầu có thêm câu "SĐT và
  // đơn vị cũng vậy" — nghe đầy đủ, nhưng nó kể cả những ô người dùng KHÔNG hề đụng tới,
  // nên câu từ chối rộng hơn việc bị từ chối. Bộ test bắt được vì "đơn vị" in ra hai lần.
  return (
    `Bạn không có quyền sửa ${ten} của lead đã có — các ô này giữ theo lần đầu lead vào ` +
    `hệ thống. Cần đổi thì nhờ Quản lý cơ sở hoặc Quản trị hệ thống.`
  );
}

/**
 * GHI CHÚ: nối thêm, không thay thế.
 *
 * Chủ dự án: "sửa ghi chú thì ghi bổ sung ở phía sau". Người không có `leads:overwrite` gõ
 * ghi chú thì phần họ gõ được NỐI xuống dưới, và phần cũ không mất — kể cả khi ô nhập gửi
 * lên một chuỗi đã bị xoá bớt.
 *
 * ⚠️ Vì sao không tin ô nhập: biểu mẫu nạp sẵn ghi chú cũ rồi gửi lại cả chuỗi. Người dùng
 * bôi đen xoá một đoạn của đồng nghiệp rồi bấm Lưu là mất vĩnh viễn, mà không màn hình nào
 * cảnh báo. Nối phía server là cách duy nhất chắc chắn.
 *
 * Trả `null` = không có gì để ghi (người dùng không thêm chữ nào mới).
 */
export function noiThemGhiChu(
  cu: string | null | undefined,
  gui: string | null | undefined,
): string | null {
  const c = (cu ?? "").trim();
  const g = (gui ?? "").trim();
  if (!g) return null; // không gõ gì
  if (!c) return g; // chưa có ghi chú nào → lấy nguyên
  if (g === c) return null; // không đổi gì
  // Ô nhập nạp sẵn ghi chú cũ: người dùng gõ TIẾP xuống dưới. Phần mới là phần đuôi.
  if (g.startsWith(c)) {
    const them = g.slice(c.length).trim();
    return them ? `${c}\n${them}` : null;
  }
  // Không bắt đầu bằng ghi chú cũ ⇒ họ đã sửa/xoá phần cũ. GIỮ phần cũ, nối nguyên phần họ
  // gửi xuống dưới. Không mất gì, và người đọc thấy rõ hai lượt ghi.
  if (c.includes(g)) return null; // phần gửi đã nằm sẵn trong ghi chú cũ
  return `${c}\n${g}`;
}
