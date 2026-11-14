// lib/integrations/zalocrm/pham-vi-nick.ts — AI ĐƯỢC DÙNG MỘT NICK, VÀ Ở MỨC NÀO.
//
// ── CHÍNH SÁCH (chủ dự án chốt 24/09/2026, gồm cả lượt ĐẢO cuối ngày) ──────
//   MỌI nhân sự của cơ sở → GIAO TAY, chọn mức `read` / `chat` / `admin`. Quản lý cơ sở
//                    KHÔNG còn ngoại lệ: thêm/gỡ/đổi mức như mọi người.
//   Nick CHƯA giao ai → chỉ vai trong `VAI_DUOC_CAP_NICK` (quản lý + tư vấn viên) dùng
//                    được, ở mức `chat` — đúng hành vi trước 24/09.
//
// ⚠️ Bản giữa ngày 24/09 có nhánh "quản lý cơ sở `admin` TỰ ĐỘNG"; chủ dự án đã ĐẢO để
// phân quyền của quản lý cơ sở cũng sửa được ngay trên màn. Nhánh ấy KHÔNG còn — đừng
// thêm lại vì thấy "quản lý mà không thấy nick thì lạ": đó là lựa chọn có chủ đích, và
// hệ quả (gỡ quản lý khỏi nick ⇒ họ mất tầm nhìn nick đó) đã được cân nhắc.
//
// Ba mức là mô hình CÓ SẴN của ZaloCRM, không phải ta bịa:
//   `read` xem tin · `chat` gửi tin · `admin` quản lý nick
//   (`backend/src/modules/zalo/zalo-access-routes.ts` — `VALID_PERMISSIONS`).
//
// ── 🔴 VÌ SAO NHÁNH "CHƯA GIAO" PHẢI GIỮ ───────────────────────────────────
// Bỏ nó đi thì một nick mới quét QR xong là KHÔNG AI đọc được cho tới khi có người nhớ
// vào giao — hộp thư khách nằm im, không lỗi nào báo. Đó đúng là kiểu hỏng câm mà cả
// đợt này sinh ra để tránh. "Chưa giao" là trạng thái BÌNH THƯỜNG của mọi nick mới.
//
// ── VÌ SAO TÁCH RA FILE THUẦN ──────────────────────────────────────────────
// `capQuyenMotOrg` chạm DB + gọi mạng. Luật "ai thấy nick nào, mức nào" thì không cần
// gì cả — nó là một phép trên bốn danh sách. Tách ra là cấy lỗi được.

/** Ba mức ZaloCRM hiểu. Thứ tự từ HẸP đến RỘNG — `xepHang` dựa vào chính thứ tự này. */
export const MUC_QUYEN = ["read", "chat", "admin"] as const;
export type MucQuyen = (typeof MUC_QUYEN)[number];

/**
 * Vai quản lý cơ sở — **NHÃN**, KHÔNG phải quyền.
 *
 * ⚠️ 24/09/2026 (lượt sau) — chủ dự án ĐẢO quyết định "QLCS `admin` tự động". Nay quản lý
 * cơ sở là một dòng giao như mọi người khác: thêm được, gỡ được, đổi mức được. Hằng này
 * chỉ còn hai việc, cả hai đều ở tầng HIỂN THỊ:
 *   · gắn nhãn "quản lý cơ sở" dưới tên trên màn;
 *   · chọn mức mặc định `admin` khi mới thêm họ (người dùng đổi ngay được).
 *
 * 🔴 ĐỪNG cho nó quay lại làm cổng quyền. Tên cũ `VAI_THAY_MOI_NICK` đã bị đổi vì nó NÓI
 * DỐI sau lượt đảo — một hằng tên "thấy mọi nick" mà không cấp gì là thứ người sau sẽ
 * đọc rồi kết luận sai.
 */
export const VAI_QUAN_LY_CO_SO: readonly string[] = ["CENTER_MANAGER"];

/** Mức cho người của cơ sở khi nick CHƯA giao cho ai. */
export const MUC_MAC_DINH_CHUA_GIAO: MucQuyen = "chat";

export type GiaoTay = { sataUserId: string; mucQuyen: MucQuyen };
export type QuyenTrenNick = { sataUserId: string; mucQuyen: MucQuyen };

/**
 * Nhãn tiếng Việt của từng mức — NÓI BẰNG VIỆC LÀM ĐƯỢC, không bằng từ kỹ thuật.
 *
 * Người vận hành không biết `read`/`chat`/`admin` nghĩa là gì, và đoán sai thì hậu quả
 * là phân quyền sai trên chat khách thật. `Record` ĐỦ nên thêm mức thứ tư mà quên đặt
 * nhãn là lỗi biên dịch, không phải một ô trống trên màn.
 */
export const NHAN_MUC: Record<MucQuyen, string> = {
  read: "Chỉ xem",
  chat: "Xem và nhắn tin",
  admin: "Quản lý nick",
};

/**
 * Câu tóm tắt "nick này đang giao cho ai" để in trên bảng.
 *
 * 🔴 Rỗng ra "Cả cơ sở dùng chung", KHÔNG phải "chưa gán" hay một ô trống. Đó là SỰ
 * THẬT về hành vi (xem nhánh ③ của `nguoiDuocDungMotNick`), và hai cách nói kia đọc như
 * một việc còn bỏ dở — người vận hành sẽ đi "sửa" một thứ đang đúng.
 */
export function tomTatGiao(
  giao: readonly { ten: string; mucQuyen: string }[],
): string {
  if (giao.length === 0) return "Cả cơ sở dùng chung";
  return giao.map((g) => `${g.ten} (${NHAN_MUC[docMucQuyen(g.mucQuyen)]})`).join(", ");
}

export type ThamSoPhamViNick = {
  /** Các dòng GIAO TAY của nick này (`ZaloCrmNickGiao`). Rỗng = chưa giao ai. */
  giaoTay: readonly GiaoTay[];
  /**
   * MỌI NHÂN SỰ còn hiệu lực của cơ sở — tập GIAO TAY hợp lệ (24/09/2026).
   *
   * Dòng giao cho người NGOÀI tập này sẽ rụng (xem `nguoiDuocDungMotNick`). Đó là vế
   * GỠ: nghỉ việc, chuyển cơ sở, hết nhiệm kỳ.
   */
  nguoiCuaCoSo: readonly string[];
  /**
   * Tập CON của `nguoiCuaCoSo` dùng nick MẶC ĐỊNH khi nick CHƯA giao ai.
   *
   * 🔴 BẮT BUỘC, KHÔNG có mặc định (luật 7). Để nó rơi về `nguoiCuaCoSo` là cấp quyền
   * mặc định cho MỌI nhân sự của cơ sở trên MỌI nick chưa giao — một lượt nới quyền
   * không ai bấm nút nào, và không triệu chứng nào báo.
   */
  macDinhDungDuoc: readonly string[];
};

/** Mức rộng hơn thắng. Dùng khi một người vừa là quản lý vừa được giao tay. */
function rongHon(a: MucQuyen, b: MucQuyen): MucQuyen {
  return MUC_QUYEN.indexOf(a) >= MUC_QUYEN.indexOf(b) ? a : b;
}

/**
 * Đọc mức từ một chuỗi (cột `ZaloCrmNickGiao.mucQuyen`, hoặc giá trị từ trình duyệt).
 *
 * 🔴 KHÔNG DÙNG `as MucQuyen`. Cột là `String` (ràng bằng CHECK ở DB, không phải enum),
 * và giá trị trên form đến từ trình duyệt — cả hai đường đều có thể mang chuỗi lạ.
 * Ép kiểu là nói với `tsc` một điều không kiểm được, rồi chuỗi lạ ấy đi thẳng sang
 * ZaloCRM.
 *
 * Mức lạ rơi về `read` (HẸP NHẤT), không phải mặc định `chat`: một lỗi gõ hay một cột
 * hỏng phải làm người ta thấy ÍT đi, không phải nhiều hơn. Cùng luật với endpoint bên
 * ZaloCRM — hai đầu lệch nhau ở điểm này là mỗi lượt đối soát đặt một mức khác nhau.
 */
export function docMucQuyen(raw: string | null | undefined): MucQuyen {
  return (MUC_QUYEN as readonly string[]).includes(raw ?? "") ? (raw as MucQuyen) : "read";
}

/**
 * Ai được dùng MỘT nick, và ở mức nào — để đẩy sang ZaloCRM.
 *
 * THUẦN: không DB, không mạng, không đồng hồ. Thứ tự trả về ỔN ĐỊNH (theo
 * `nguoiCuaCoSo`) để hai lượt liên tiếp sinh cùng một payload — lượt đối soát so danh
 * sách chứ không so tập hợp, và payload xáo thứ tự làm nhật ký đầy tiếng ồn.
 *
 * 🔴 GIAO NHAU với `nguoiCuaCoSo`, KHÔNG phải hợp. Dòng giao tay là con trỏ ĐƯỢC LƯU —
 * người được giao có thể đã nghỉ việc hoặc đổi cơ sở. Cộng vào là vô hiệu hoá vế GỠ của
 * hệ thống: người không còn phận sự vẫn đọc chat khách, và không triệu chứng nào báo.
 */
export function nguoiDuocDungMotNick(t: ThamSoPhamViNick): QuyenTrenNick[] {
  const hopLe = new Set(t.nguoiCuaCoSo);
  const muc = new Map<string, MucQuyen>();

  // ① Giao tay. Lọc theo `hopLe` nên dòng giao cho người đã rời cơ sở tự rụng.
  //
  //    ⚠️ KHÔNG còn nhánh "quản lý cơ sở `admin` tự động" (chủ dự án đảo 24/09, lượt
  //    sau). Quản lý cơ sở nay là một dòng giao như mọi người: muốn họ có quyền trên
  //    một nick ĐÃ GIAO thì phải thêm họ vào — xem `VAI_QUAN_LY_CO_SO`.
  const giaoConHieuLuc = t.giaoTay.filter((g) => hopLe.has(g.sataUserId));
  for (const g of giaoConHieuLuc) {
    const cu = muc.get(g.sataUserId);
    muc.set(g.sataUserId, cu ? rongHon(cu, g.mucQuyen) : g.mucQuyen);
  }

  // ② CHƯA GIAO AI (sau khi lọc) ⇒ mức mặc định cho `macDinhDungDuoc`. Xem khối chú
  //    thích đầu file về vì sao nhánh này phải tồn tại.
  //
  //    🔴 Lặp trên `macDinhDungDuoc`, KHÔNG phải `nguoiCuaCoSo`. Từ 24/09 hai tập đã
  //    KHÁC NHAU: tập sau gồm mọi nhân sự của cơ sở (để giao tay được), tập trước chỉ
  //    gồm vai được dùng nick mặc định. Đổi sang `nguoiCuaCoSo` là cho cả Giáo viên,
  //    Kế toán… đọc mọi nick chưa giao — `[PVN-07]` canh đúng chỗ này.
  if (giaoConHieuLuc.length === 0) {
    for (const id of t.macDinhDungDuoc) {
      if (!hopLe.has(id)) continue;
      const cu = muc.get(id);
      muc.set(id, cu ? rongHon(cu, MUC_MAC_DINH_CHUA_GIAO) : MUC_MAC_DINH_CHUA_GIAO);
    }
  }

  return t.nguoiCuaCoSo
    .filter((id) => muc.has(id))
    .map((id) => ({ sataUserId: id, mucQuyen: muc.get(id)! }));
}
