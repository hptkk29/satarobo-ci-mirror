/**
 * EL-05 — GỘP TẬP NGƯỜI HỌC: `(∪ luật) ∪ thêm tay ⊖ loại trừ`.
 *
 * Hàm thuần, nhận sẵn các bản ghi đã tra từ DB. Tách khỏi truy vấn vì đây là chỗ
 * quyết định AI NHẬN BÀI — thứ phải test được không cần dựng cơ sở dữ liệu.
 *
 * Hai luật của §10.2 mà tệp này gánh, cả hai đều là luật về CÁCH NÓI VỚI NGƯỜI
 * DÙNG chứ không phải về truy vấn:
 *
 * - **Luật 5** — xem trước phải LIỆT KÊ ĐỦ TÊN, không chỉ đếm. Ở quy mô 15 người,
 *   một luật sai chỉ lộ ra khi nhìn thấy tên; con số "8 người" thì luôn trông
 *   đúng.
 * - **Luật 6** — người chưa có `centerId` bị TỪ CHỐI, và phải được nêu ĐÍCH DANH
 *   (prod chỉ 4/15 người có cơ sở).
 *
 * ⚠️ Nguyên tắc chung: người bị loại KHÔNG BIẾN MẤT. Họ chuyển sang một nhóm có
 * tên, có lý do. Biến mất im lặng là cách chắc chắn nhất để người giao bài tưởng
 * mình đã giao đủ.
 */

export type NguoiTrongTap = {
  employeeId: string;
  /** `null` = có hồ sơ nhân sự nhưng chưa có tài khoản đăng nhập ⇒ không học được. */
  userId: string | null;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  centerId: string | null;
  orgUnitId: string | null;
  departmentId: string | null;
  managerId: string | null;
  joinedAt: Date | null;
};

export type TapNguoiHoc = {
  /** Những người THẬT SỰ nhận bài. */
  nhan: NguoiTrongTap[];
  /** Luật 6 — khớp luật nhưng chưa có cơ sở ⇒ từ chối, nêu tên để Nhân sự vá. */
  thieuCoSo: NguoiTrongTap[];
  /** Có hồ sơ nhưng chưa có tài khoản ⇒ không đăng nhập được, không học được. */
  thieuTaiKhoan: NguoiTrongTap[];
  /** Bị danh sách loại trừ chặn — hiện ra để không ai tưởng loại trừ chưa chạy. */
  biLoaiTru: NguoiTrongTap[];
  /** Bằng đúng `nhan.length`. Xem ghi chú ở dưới về việc KHÔNG đếm riêng. */
  tong: number;
};

const theoTen = (a: NguoiTrongTap, b: NguoiTrongTap) =>
  a.fullName.localeCompare(b.fullName, "vi-VN") ||
  a.employeeCode.localeCompare(b.employeeCode);

export function gopTapNguoiHoc(input: {
  theoLuat: NguoiTrongTap[];
  themTay: NguoiTrongTap[];
  /** `TrnAssignmentExclude.userId` — danh sách loại trừ khai theo tài khoản. */
  loaiTruUserId: string[];
}): TapNguoiHoc {
  // Khử trùng theo `employeeId`: `User.employeeId` là 1-1 (`@unique`) nên với
  // người đã có tài khoản thì khử theo hồ sơ ≡ khử theo tài khoản — và cách này
  // còn khử được cả người CHƯA có tài khoản. Trùng lặp ở đây nghĩa là hai lượt
  // ghi danh cho cùng một người, tức vỡ `@@unique([courseId, userId, cycle])`
  // của `TrnEnrollment` ngay lúc ghi.
  const hop = new Map<string, NguoiTrongTap>();
  for (const n of [...input.theoLuat, ...input.themTay]) hop.set(n.employeeId, n);

  const loaiTru = new Set(input.loaiTruUserId);
  const nhan: NguoiTrongTap[] = [];
  const thieuCoSo: NguoiTrongTap[] = [];
  const thieuTaiKhoan: NguoiTrongTap[] = [];
  const biLoaiTru: NguoiTrongTap[] = [];

  for (const n of hop.values()) {
    // Loại trừ xét TRƯỚC: `⊖` là phép cuối trong `(∪ luật) ∪ thêm tay ⊖ loại trừ`,
    // nên nó thắng cả luật lẫn thêm tay. Người đã bị loại trừ thì không cần báo
    // họ thiếu cơ sở — họ vốn không định nhận bài.
    if (n.userId && loaiTru.has(n.userId)) {
      biLoaiTru.push(n);
      continue;
    }

    // ⚠️ Một người thiếu CẢ HAI thứ thì vào CẢ HAI nhóm, cố ý. Chỉ báo một lỗi thì
    // Nhân sự vá xong cái đó, giao lại, và người này vẫn trượt — lần này vì lý do
    // kia. Hai vòng cho một người.
    let hong = false;
    if (!n.userId) {
      thieuTaiKhoan.push(n);
      hong = true;
    }
    if (!n.centerId) {
      // Luật 6 áp cho CẢ đường thêm tay — đường dễ quên nhất, vì tự gõ tên vào
      // cho cảm giác đã xác nhận thủ công rồi.
      thieuCoSo.push(n);
      hong = true;
    }
    if (!hong) nhan.push(n);
  }

  nhan.sort(theoTen);
  thieuCoSo.sort(theoTen);
  thieuTaiKhoan.sort(theoTen);
  biLoaiTru.sort(theoTen);

  // `tong` suy TỪ danh sách, không đếm riêng một đường. Đếm riêng là cách sinh ra
  // màn hình tự mâu thuẫn: "sẽ giao cho 8 người" bên trên, 6 dòng tên bên dưới.
  return { nhan, thieuCoSo, thieuTaiKhoan, biLoaiTru, tong: nhan.length };
}
