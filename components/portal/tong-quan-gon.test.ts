// @vitest-environment node
// [TQG] «Tổng quan» + «Hành trình» gọn lại (chủ dự án 13/11/2026). Lưới ghim mã nguồn (mẫu ở CLAUDE.md) — đọc mã ĐÃ BỎ chú thích.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideRoute } from "@/lib/auth/route-policy";
import { legalUrlTuyetDoi } from "@/lib/legal-pages";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const trang = doc("components/portal/tong-quan-page.tsx");
const tq = doc("lib/portal/tong-quan.ts");
const htTrang = doc("components/portal/hanh-trinh-page.tsx");
const ht = doc("lib/portal/hanh-trinh.ts");
const vo = doc("components/portal/sr-shell.tsx");

describe("[TQG] Tổng quan bỏ thông tin lặp", () => {
  it("[TQG-01] không còn hàng 4 ô «Đi học · Nhận xét · Học phí · Đã học» (cả khối lẫn dữ liệu riêng cho nó)", () => {
    expect(trang).not.toContain('aria-label="Tình hình nhanh"');
    expect(trang).not.toMatch(/function TheSo\b/);
    expect(trang).not.toMatch(/d\.(diHoc|nhanXetThe|hocPhi|daHoc)\b/);
    expect(tq).not.toMatch(/\b(nhanXetThe|daHoc):/);
  });

  it("[TQG-02] thẻ buổi tiếp theo KHÔNG còn dòng mục tiêu («Nhận biết linh kiện» — kỹ năng chung của cả học phần)", () => {
    expect(trang).not.toMatch(/t\.mucTieu/);
    expect(tq).not.toMatch(/objectives/);
    expect(htTrang).not.toMatch(/mucTieu/);
    expect(ht).not.toMatch(/objectives/);
  });

  it("[TQG-03] nút nhắn tin «Nhắn tin cho thầy Kiệt»: dữ liệu đi qua goiGiaoVien, không in thẳng cả họ tên", () => {
    expect(trang).toContain("`Nhắn tin cho ${d.giaoVienNhan}`");
    expect(tq).toMatch(/giaoVienNhan: goiGv\(sched\?\.next\?\.teacher\)/);
    expect(tq).not.toMatch(/giaoVienNhan: sched\?\.next\?\.teacher/);
    expect(tq).toMatch(/docGioiTinhGvTheoTen\(\[sched\?\.next\?\.teacher, moiNhat\?\.teacher\]\)/);
    // chip giáo viên ở thẻ buổi tiếp theo + tên trong khối nhận xét cũng đi qua goiGv
    expect(tq.match(/goiGv\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(tq).not.toMatch(/giaoVien: next\.teacher/);
    expect(tq).not.toMatch(/giaoVien: moiNhat\.teacher/);
  });
});

describe("[TQG] Hành trình", () => {
  it("[TQG-04] «Buổi cần học bù» đếm theo LỚP NÀY (idCanBu), buổi vắng lớp khác nói riêng — không dùng needCount của cả học viên", () => {
    expect(ht).toMatch(/canBu: canBuLop,/);
    expect(ht).toMatch(/const canBuLop = idCanBu\.size;/);
    expect(ht).toMatch(/const canBuLopKhac = Math\.max\(0, makeup\.needCount - canBuLop\);/);
    expect(ht).not.toMatch(/canBu: makeup\.needCount,\s*\n\s*conLai/);
    expect(htTrang).toMatch(/ghi=\{t\.canBuLopKhac > 0 \?/);
  });

  it("[TQG-05] mốc lớn theo buổi CUỐI học phần (idBuoiMoc), không theo tên «Demo…»", () => {
    expect(ht).toMatch(/const mocIds = idBuoiMoc\(buoi\);/);
    expect(ht).toMatch(/d\.laMoc\)/);
    expect(htTrang).toMatch(/d\.laMoc \?/);
    expect(`${ht}${htTrang}`).not.toMatch(/laBuoiMoc|\/\^demo/i);
  });

  it("[TQG-06] dòng lịch dưới tiêu đề gọi «Thầy Kiệt», không in next.teacher thẳng", () => {
    expect(ht).not.toMatch(/next\.room, next\.teacher\]/);
    expect(ht).toMatch(/gv \? vietHoaDau\(gv\) : null/);
  });
});

describe("[TQG] Chính sách bảo mật ở cuối menu", () => {
  it("[TQG-07] link TUYỆT ĐỐI sang satarobo.vn, gạch chân, ở CẢ menu bên lẫn trang «Thêm»", () => {
    expect(legalUrlTuyetDoi("chinh-sach-bao-mat")).toBe("https://satarobo.vn/chinh-sach-bao-mat");
    expect(vo).toContain('const URL_CHINH_SACH_BAO_MAT = legalUrlTuyetDoi("chinh-sach-bao-mat");');
    expect(vo.match(/<LinkChinhSachBaoMat /g)).toHaveLength(2);
    expect(vo).toMatch(/underline underline-offset-2/);
    expect(vo).not.toMatch(/href="\/chinh-sach-bao-mat"/);
  });

  it("[TQG-08] VÌ SAO phải tuyệt đối — đo trên luật định tuyến thật: ở host hocvien, `/chinh-sach-bao-mat` bị viết lại thành `/portal/…` (đã đăng nhập) hoặc đá về /login (chưa)", () => {
    const daDangNhap = decideRoute({ hostKind: "portal", pathname: "/chinh-sach-bao-mat", role: "PARENT", sessionValid: true });
    expect(daDangNhap).toMatchObject({ type: "rewrite", path: "/portal/chinh-sach-bao-mat" });
    const chuaDangNhap = decideRoute({ hostKind: "portal", pathname: "/chinh-sach-bao-mat", role: null, sessionValid: false });
    expect(chuaDangNhap).toMatchObject({ type: "redirectPath", path: "/login" });
  });

  it("[TQG-09] dải pháp lý dưới cổng (DaiLinkPhapLy — cổng phụ huynh + trang đăng nhập/kích hoạt) cũng đi bằng link TUYỆT ĐỐI", () => {
    const dai = doc("components/public/dai-link-phap-ly.tsx");
    expect(dai.match(/href=\{legalUrlTuyetDoi\(/g)).toHaveLength(2);
    expect(dai).not.toMatch(/href=\{legalHref\(/);
  });
});
