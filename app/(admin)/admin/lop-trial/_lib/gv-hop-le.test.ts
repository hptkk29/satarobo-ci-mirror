/**
 * Cổng GHI của ô "Giáo viên" — vá 17/09/2026.
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────
 * Một lớp lỗi CHẶN CỨNG, không phải lớp lỗi rò rỉ: giá trị ĐANG NẰM TRÊN bản ghi bị
 * chính cổng của nó từ chối. Triệu chứng trên màn hình là một hộp đỏ chỉ vào ô Giáo viên
 * ("Người được chọn không phải giáo viên đang hoạt động") trong lúc người dùng chỉ đang
 * đổi GIỜ của buổi — nên cách họ "xử lý" là đổi sang giáo viên khác, tức xoá mất ghi chép
 * ai THẬT SỰ đã dạy buổi đó. Hỏng theo hướng mất dữ liệu sổ sách, không ai báo lỗi.
 *
 * ── HÌNH DẠNG FIXTURE LẤY TỪ ĐÂU (luật: fixture phải mang hình dạng thật) ────────────
 * `dsChonDuoc` = kết quả `getAssignableTeachers({ includeIds: giuThem })`. Hình dạng
 * nguy hiểm — tập đó KHÔNG chứa một id có trong `includeIds` — không phải tưởng tượng:
 * `lib/teachers/assignable.ts:41` đặt `deletedAt: null` ở tầng NGOÀI của `where`, cạnh
 * `OR`, nên Prisma dựng ra
 *
 *     deletedAt IS NULL AND ( <GV đang hoạt động> OR id IN (includeIds) )
 *
 * và mọi tài khoản đã xoá mềm rơi ra khỏi kết quả dù được nêu đích danh trong `includeIds`.
 * Đó là lý do cả hai ca `[GV-01]`/`[GV-02]` dựng `dsChonDuoc` THIẾU người đang gán —
 * dựng một tập "tròn trịa" có đủ mọi id là tự bỏ qua đúng thứ đang canh.
 *
 * Không ca nào đọc đồng hồ thật (luật 19) và không ca nào dùng trạng thái chung (luật 18).
 */
import { describe, expect, it } from "vitest";
import { gvXepDuocTheoDanhSach } from "./gv-hop-le";

describe("gvXepDuocTheoDanhSach — giữ nguyên ≠ chọn mới", () => {
  // ⭐ [GV-01] CA KHOÁ. Tài khoản đã XOÁ MỀM: `getAssignableTeachers` không trả về họ dù
  // `includeIds` nêu đích danh, nên `dsChonDuoc` thiếu — và cổng vẫn phải cho qua.
  it("[GV-01] GV đang gán trên buổi vẫn hợp lệ dù KHÔNG có trong danh sách chọn được", () => {
    expect(
      gvXepDuocTheoDanhSach({
        teacherId: "gv-da-nghi",
        dsChonDuoc: ["gv-lan", "gv-toai"], // người đã xoá mềm rơi ra khỏi truy vấn
        giuThem: ["gv-da-nghi"],
      }),
    ).toBe(true);
  });

  it("[GV-02] buổi chưa có giáo viên (null trong giuThem) không làm cổng mở toang", () => {
    expect(
      gvXepDuocTheoDanhSach({
        teacherId: "nguoi-la",
        dsChonDuoc: ["gv-lan"],
        giuThem: [null],
      }),
    ).toBe(false);
  });

  // Chiều ngược lại của cổng — phải còn gác được, nếu không bản vá biến nó thành đồ trang trí.
  it("[GV-03] người KHÔNG trong danh sách và KHÔNG đang gán ⇒ TỪ CHỐI", () => {
    expect(
      gvXepDuocTheoDanhSach({
        teacherId: "ph-nao-do", // tài khoản phụ huynh POST thẳng lên
        dsChonDuoc: ["gv-lan", "gv-toai"],
        giuThem: ["gv-kiet"],
      }),
    ).toBe(false);
  });

  it("[GV-04] người có trong danh sách chọn được ⇒ CHO QUA (đường bình thường)", () => {
    expect(
      gvXepDuocTheoDanhSach({
        teacherId: "gv-lan",
        dsChonDuoc: ["gv-lan", "gv-toai"],
        giuThem: [],
      }),
    ).toBe(true);
  });

  it("[GV-05] cửa THÊM buổi (giuThem rỗng) chỉ dựa vào danh sách — không có ngoại lệ nào", () => {
    // Cửa thêm buổi truyền `giuThem: []`, nên nhánh cứu hộ không được đụng tới. Nếu bản vá
    // lỡ viết thành "rỗng thì cho qua hết" thì đúng ca này đỏ.
    expect(
      gvXepDuocTheoDanhSach({ teacherId: "gv-da-xoa", dsChonDuoc: [], giuThem: [] }),
    ).toBe(false);
  });
});
