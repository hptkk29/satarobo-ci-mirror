// Ca [BDH-*] — học viên có được học buổi này không. Thuần, không DB.
//
// Luật: đăng ký N buổi của khoá M ⇒ học từ buổi `M − N + 1` tới M; các buổi trước đó bỏ
// qua (chủ dự án 28/09/2026).
//
// ⚠️ Thứ bộ ca này canh nặng nhất là **HAI NHÁNH FAIL-OPEN**. Chúng đúng, nhưng chúng
// cũng là hai cái cửa: viết sai một chút thì cổng cho qua tất và KHÔNG ca nào đỏ nếu chỉ
// test nhánh chặn. Nên mỗi nhánh fail-open đều có đối chứng chặn ngay cạnh.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { xetBuoiDuocHoc, nhanChuaToiLuot } from "./buoi-duoc-hoc";

describe("[BDH-01] đăng ký đủ khoá ⇒ học mọi buổi", () => {
  it.each([null, 1, 0, -3])("buoiBatDau = %s ⇒ được học", (buoiBatDau) => {
    expect(xetBuoiDuocHoc({ buoiBatDau, soBuoiLoTrinh: 1 })).toEqual({
      duocHoc: true,
      khongXet: false,
    });
  });

  it("`null` là trạng thái của MỌI ghi danh cũ ⇒ không được chặn ai", () => {
    // Cột `buoiBatDau` thêm 28/09, KHÔNG backfill. Fail-closed ở đây là mọi học viên đang
    // học biến mất khỏi mọi bảng điểm danh ngay hôm triển khai.
    expect(xetBuoiDuocHoc({ buoiBatDau: null, soBuoiLoTrinh: 47 }).duocHoc).toBe(true);
  });
});

describe("[BDH-02] đăng ký muộn ⇒ chặn các buổi TRƯỚC, cho các buổi TỪ mốc", () => {
  // Ví dụ của chủ dự án: 39 buổi ⇒ bắt đầu buổi 10.
  it.each([
    [1, false],
    [9, false],
    [10, true],
    [11, true],
    [48, true],
  ])("buổi lộ trình %i ⇒ được học = %s", (soBuoiLoTrinh, duocHoc) => {
    expect(xetBuoiDuocHoc({ buoiBatDau: 10, soBuoiLoTrinh })).toEqual({
      duocHoc,
      khongXet: false,
    });
  });

  it("mốc là >= chứ KHÔNG phải >", () => {
    // Lệch một buổi ở đây là học viên mất đúng buổi đầu tiên mình đã trả tiền.
    expect(xetBuoiDuocHoc({ buoiBatDau: 25, soBuoiLoTrinh: 25 }).duocHoc).toBe(true);
    expect(xetBuoiDuocHoc({ buoiBatDau: 25, soBuoiLoTrinh: 24 }).duocHoc).toBe(false);
  });
});

describe("[BDH-03] lớp chưa ghim giáo trình ⇒ fail-open, và TỰ KHAI là không xét", () => {
  it("soBuoiLoTrinh = null ⇒ được học, `khongXet` = true", () => {
    expect(xetBuoiDuocHoc({ buoiBatDau: 25, soBuoiLoTrinh: null })).toEqual({
      duocHoc: true,
      khongXet: true,
    });
  });

  it("ĐỐI CHỨNG CHẶN: cùng `buoiBatDau` ấy, có số lộ trình thì VẪN chặn", () => {
    // Thiếu ca này thì một bản vá làm `xetBuoiDuocHoc` luôn trả `duocHoc: true` vẫn xanh
    // — ca trên tự nó không phân biệt được "fail-open đúng chỗ" với "cổng chết".
    expect(xetBuoiDuocHoc({ buoiBatDau: 25, soBuoiLoTrinh: 24 }).duocHoc).toBe(false);
  });

  it("`khongXet` CHỈ bật ở nhánh thiếu dữ liệu, không bật ở nhánh cho qua bình thường", () => {
    expect(xetBuoiDuocHoc({ buoiBatDau: null, soBuoiLoTrinh: 5 }).khongXet).toBe(false);
    expect(xetBuoiDuocHoc({ buoiBatDau: 25, soBuoiLoTrinh: 30 }).khongXet).toBe(false);
  });
});

describe("[BDH-05] LƯỚI GHIM MÃ NGUỒN — cổng GHI phải loại học viên chưa tới lượt", () => {
  // 🔴 Luật này KHÔNG chứng minh được bằng test thuần: nó nằm ở `getSessionRosterStudentIds`
  // — hàm chạm DB, và là cổng chặn upsert điểm danh/nhận xét cho `studentId` ngoài roster
  // (6 chỗ gọi: điểm danh admin, nhận xét buổi, site GV…).
  //
  // Bỏ phép lọc ở đó thì: hàng vẫn hiện đúng kèm lý do (nên nhìn màn hình thấy ổn), mà
  // điểm danh vẫn GHI được cho buổi học viên chưa trả tiền — và nó đi thẳng vào học bạ
  // lẫn báo cáo chuyên cần. Không ca hành vi nào đỏ.
  const ma = readFileSync(resolve(process.cwd(), "lib/attendance/roster.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("`getSessionRosterStudentIds` lọc theo `chuaToiLuot === null`", () => {
    const i = ma.indexOf("export async function getSessionRosterStudentIds");
    expect(i, "không thấy hàm cổng ghi").toBeGreaterThan(-1);
    expect(ma.slice(i), "cổng GHI không lọc học viên chưa tới lượt").toMatch(
      /\.filter\(\s*\(\w+\)\s*=>\s*\w+\.chuaToiLuot === null\s*\)/,
    );
  });

  it("roster TÍNH `chuaToiLuot` bằng `xetBuoiDuocHoc`, không so tay", () => {
    // Neo vào LỜI GỌI (bài học `[S-1]`: tên hàm có mặt cả trong dòng `import`).
    expect(ma).toMatch(/xetBuoiDuocHoc\(\{/);
    // Và số buổi phải lấy theo LỘ TRÌNH, không theo lịch — dùng nhầm là học viên
    // được/mất một buổi chỉ vì lớp đổi ngày (sự cố 07/09).
    expect(ma).toMatch(/soBuoiTheoLoTrinh\(\{/);
    expect(ma).not.toMatch(/soBuoiTheoLich\(/);
  });

  it("`select` của ghi danh CÓ đọc `buoiBatDau`", () => {
    // Quên `select` là lỗi CÂM: Prisma trả `undefined`, cổng fail-open, mọi học viên mua
    // ít buổi lặng lẽ được điểm danh cả khoá.
    expect(ma).toMatch(/buoiBatDau: true/);
  });
});

describe("[BDH-04] nhãn NÓI THẬT lý do, không ẩn trắng học viên", () => {
  it("nêu đúng buổi bắt đầu", () => {
    // Ẩn trắng học viên khỏi bảng là để giáo viên tự đoán vì sao thiếu người — họ sẽ nghĩ
    // hệ thống lỗi, hoặc nghĩ em đó đã nghỉ học.
    expect(nhanChuaToiLuot({ buoiBatDau: 10 })).toBe("Đăng ký từ buổi 10");
    expect(nhanChuaToiLuot({ buoiBatDau: 25 })).toContain("25");
  });
});
