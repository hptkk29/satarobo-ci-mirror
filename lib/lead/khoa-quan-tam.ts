/**
 * KHOÁ QUAN TÂM CỦA LEAD — khi nào con được phép ghi đè lên nó. Hàm THUẦN.
 *
 * ── CHỐT 17/09/2026 ──────────────────────────────────────────────────────────────────────
 * Chủ dự án bấm vào ô "Khoá quan tâm" ở màn sửa lead (vai Tư vấn & CSKH) và thấy nó xám,
 * kèm dòng "Lấy theo khoá quan tâm của con — sửa ở khối Con của phụ huynh bên dưới". Yêu
 * cầu: "làm hướng sửa được đi".
 *
 * ⚠️ MỞ KHOÁ Ô THÔI LÀ CHƯA ĐỦ — và nếu chỉ làm thế thì tệ hơn hiện trạng.
 *
 * Đo trước khi sửa: `Lead.courseId` đang là BẢN SAO được suy ra từ con.
 * `syncLeadCourseFromChildren` ghi đè nó VÔ ĐIỀU KIỆN bằng khoá của đứa con sửa gần nhất,
 * và chạy ở BA chỗ (`addLeadChild`, `updateLeadChild`, `deleteLeadChild`). Nên nếu chỉ bỏ
 * `disabled` khỏi ô: Sale gõ khoá đúng, lưu, thấy đã lưu — rồi lần sau ai đó đụng vào một
 * đứa con là giá trị ấy biến mất, không thông báo, không dấu vết. Ô mở ra mà không giữ được
 * giá trị là một lời hứa suông, đúng thứ luật 12 cấm.
 *
 * ── LUẬT ─────────────────────────────────────────────────────────────────────────────────
 * Con chỉ được ghi đè khoá của lead khi khoá đó TRÔNG NHƯ DO CON ĐẶT RA:
 *
 *   lead chưa có khoá                       → ĐIỀN theo con
 *   khoá của lead = khoá con vừa sửa (bản cũ) → CẬP NHẬT theo con  (đúng là của nó)
 *   khoá của lead = khoá của MỘT con nào đó  → CẬP NHẬT theo con  (vốn suy ra từ đám con)
 *   khoá của lead KHÁC mọi con               → GIỮ NGUYÊN          (người dùng đặt tay)
 *
 * Vế cuối là toàn bộ điểm của tệp này. Nó không đoán ý ai; nó chỉ nói: một giá trị không
 * khớp con nào thì không thể do con sinh ra, nên đừng đụng vào.
 *
 * Nếp này KHÔNG mới — `updateLeadChild` vốn đã dùng đúng phép so ấy cho ca "gỡ trắng khoá
 * của con" (`child.lead?.courseId === child.interestedCourseId`). Ở đây chỉ mở rộng nó ra
 * cho mọi ca, và đưa vào một hàm có tên, có test, có chỗ cấy lỗi.
 */

export interface DauVaoDongBoKhoa {
  /** Khoá quan tâm đang lưu trên lead. */
  khoaLead: string | null | undefined;
  /**
   * Khoá của các con SAU khi sửa, xếp con mới đụng gần nhất lên trước.
   * Dùng cho cả hai việc: chọn giá trị mới, và nhận ra khoá của lead có phải của con không.
   */
  khoaCacCon: readonly (string | null | undefined)[];
  /**
   * Khoá của đứa con vừa bị sửa, GIÁ TRỊ TRƯỚC KHI SỬA. `undefined` khi không áp dụng
   * (thêm con mới, hoặc gọi từ chỗ không biết).
   *
   * ⚠️ Không có vế này thì luồng thường bị gãy: lead đang lấy khoá theo con A, người dùng
   * đổi khoá của A sang cái khác ⇒ khoá cũ của lead không còn khớp con nào ⇒ luật trên
   * tưởng là "đặt tay" và GIỮ NGUYÊN, tức sửa con mà lead không đổi theo.
   */
  khoaConTruocKhiSua?: string | null | undefined;
}

export interface KetQuaDongBoKhoa {
  /** Có ghi `Lead.courseId` không. */
  doiKhoa: boolean;
  /** Giá trị mới — chỉ có nghĩa khi `doiKhoa`. */
  khoaMoi: string | null;
  /** Vì sao — để nhật ký và test nói được cùng một ngôn ngữ. */
  vi: "chua-co" | "cua-con-nay" | "cua-mot-con" | "nguoi-dung-dat-tay";
}

function sach(v: string | null | undefined): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

/**
 * Đám con có được ghi đè khoá của lead lúc này không, và ghi giá trị gì.
 *
 * Giá trị chọn là khoá của con ĐẦU TIÊN trong `khoaCacCon` có khoá — giữ đúng hành vi cũ
 * (`orderBy: { updatedAt: "desc" }` ⇒ con vừa đụng thắng). Không con nào có khoá ⇒ `null`,
 * tức xoá trắng khoá của lead, cũng đúng hành vi cũ.
 */
export function dongBoKhoaTuCon(dv: DauVaoDongBoKhoa): KetQuaDongBoKhoa {
  const khoaLead = sach(dv.khoaLead);
  const con = dv.khoaCacCon.map(sach);
  const khoaMoi = con.find((k) => k !== null) ?? null;

  if (khoaLead === null) return { doiKhoa: true, khoaMoi, vi: "chua-co" };

  const truoc = sach(dv.khoaConTruocKhiSua);
  if (truoc !== null && khoaLead === truoc) {
    return { doiKhoa: true, khoaMoi, vi: "cua-con-nay" };
  }

  if (con.includes(khoaLead)) return { doiKhoa: true, khoaMoi, vi: "cua-mot-con" };

  // Khác mọi con ⇒ không thể do con sinh ra ⇒ của người dùng. KHÔNG ĐỤNG.
  return { doiKhoa: false, khoaMoi: khoaLead, vi: "nguoi-dung-dat-tay" };
}

// ════════════════════════════════════════════════════════════════════════════════════
// ĐỒNG BỘ HAI CHIỀU — chốt 26/09/2026 (chủ dự án): "tất cả dữ liệu phải đồng bộ với
// nhau, 1 cái đổi thì đổi hết cùng nhau".
//
// Khoá quan tâm sống ở HAI chỗ: `LeadChild.interestedCourseId` (theo từng bé — cũng là
// khoá trial mà lớp trial và site giáo viên đọc) và `Lead.courseId` (bản sao cấp phụ
// huynh). Hai hàm dưới là luật cho hai chiều ĐỔI THẬT SỰ. Chúng thay luật 17/09 ở trên
// cho đường SỬA; `dongBoKhoaTuCon` vẫn là luật của đường THÊM/GỠ con.
//
// ⚠️ Chỉ khi GIÁ TRỊ ĐỔI. Biểu mẫu con gửi lại toàn bộ ô mỗi lần Lưu: dội theo "có gửi
// khoá" (thay vì "khoá đã đổi") là sửa tên bé cũng đè mất khoá của lead.
// ════════════════════════════════════════════════════════════════════════════════════

/**
 * Khoá của MỘT bé vừa đổi ⇒ lead ghi gì. Bé được chọn một khoá (khác cũ, không trống)
 * là lựa chọn tường minh ⇒ lead nhận đúng khoá đó. Gỡ trắng khoá của bé ⇒ trả `null` ở
 * đây: bên gọi tính lại bằng `dongBoKhoaTuCon` như cũ (không bịa khoá cho lead).
 */
export function leadTheoConDoi(o: {
  khoaConCu: string | null | undefined;
  khoaConMoi: string | null | undefined;
}): { ghi: true; khoa: string } | { ghi: false } {
  const cu = sach(o.khoaConCu);
  const moi = sach(o.khoaConMoi);
  if (moi === null || moi === cu) return { ghi: false };
  return { ghi: true, khoa: moi };
}

/**
 * Khoá của LEAD vừa đổi ⇒ bé nào đổi theo. Bé CHƯA có khoá, hoặc đang mang ĐÚNG khoá cũ
 * của lead (tức khoá lead vốn lấy từ bé đó) ⇒ đổi theo. Bé đã được chọn một khoá KHÁC là
 * lựa chọn riêng cho bé ấy (nhà hai con học hai khoá) ⇒ giữ nguyên.
 *
 * Lead bị gỡ trắng khoá ⇒ KHÔNG bé nào đổi: xoá khoá của bé đang ở lớp trial là để giáo
 * viên lại thấy "—".
 */
export function conTheoLeadDoi(o: {
  khoaLeadCu: string | null | undefined;
  khoaLeadMoi: string | null | undefined;
  con: readonly { id: string; khoa: string | null | undefined }[];
}): string[] {
  const cu = sach(o.khoaLeadCu);
  const moi = sach(o.khoaLeadMoi);
  if (moi === null || moi === cu) return [];
  return o.con
    .filter((c) => {
      const k = sach(c.khoa);
      return k !== moi && (k === null || k === cu);
    })
    .map((c) => c.id);
}

/**
 * KHOÁ HIỆU LỰC của một bé — MỘT định nghĩa cho mọi nơi đọc "bé học khoá gì": ô Khoá học
 * ở lớp trial, cổng "phải có khoá trước khi vào case", và cột Khoá học trên site giáo viên.
 *
 * = khoá riêng của bé; trống thì khoá quan tâm của lead (chủ dự án 26/09: "case nào có khoá
 * quan tâm rồi thì lấy mặc định khoá học trial là khoá quan tâm đó"). Đọc lùi thay vì chép
 * sẵn xuống bé: lead đổi khoá thì mọi nơi đổi theo ngay, không cần đường ghi nào nhớ dội.
 *
 * `lead` BẮT BUỘC trong kiểu (luật 7): quên `select: { lead: { select: { courseId } } }` ở
 * câu tra là lỗi biên dịch, không phải một ô "—" im lặng.
 */
export function khoaHieuLucCuaBe(be: {
  interestedCourseId: string | null;
  lead: { courseId: string | null } | null;
}): string | null {
  return sach(be.interestedCourseId) ?? sach(be.lead?.courseId);
}
