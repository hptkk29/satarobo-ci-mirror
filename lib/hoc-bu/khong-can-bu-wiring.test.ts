// [KCW-*] — LƯỚI GHIM MÃ NGUỒN cho nút "Không cần bù" ở màn điểm danh (22/10/2026).
//
// Hành vi đã có test thật (`giu-da-bu.test.ts` [GDB-09..13] cho luật thuần, `tests/hoc-bu/khong-can-bu.test.ts` cho Postgres). Thứ chúng KHÔNG canh: cờ `khongCanBu` bị
// truyền ở ĐƯỜNG KHÁC (phiếu nghỉ, dịch vụ) làm hành vi mới rò sang chỗ không được có; panel GV quên `statusCu` nên giáo viên mở lại buổi bấm Lưu là xoá lựa chọn người
// khác đã chọn; nút ở lưới mất khỏi danh sách; hay nhánh thu hồi bị dời trước nhánh "cần bù". Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
const vi = (s: string, x: string) => {
  const i = s.indexOf(x);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};
const dem = (s: string, x: string) => s.split(x).length - 1;

const ADMIN = "app/(admin)/admin/attendance/_actions.ts";
const GV = "app/(teacher)/teacher/lop/_actions.ts";
const LUOI = "app/(admin)/admin/attendance/_components/attendance-grid.tsx";
const DONGBO = "lib/hoc-bu/dong-diem-danh.ts";
const DICHVU = "lib/hoc-bu/dong-service.ts";

describe("[KCW] 'Không cần bù' — dây nối", { timeout: 30_000 }, () => {
  it("[KCW-01] CHỈ lưới admin truyền `khongCanBu` (từ chính giá trị client gửi); panel GV chỉ truyền `statusCu`; phiếu nghỉ và dịch vụ KHÔNG truyền gì mới", () => {
    const ad = than(ma(ADMIN), "markAttendance");
    expect(dem(ad, "makeupStatusSauKhiLuu(")).toBe(1);
    expect(ad).toContain('khongCanBu: r.makeupStatus === "NONE"');
    expect(dem(ma(GV), "statusCu: old?.status")).toBe(1);
    expect(ma(GV)).not.toContain("khongCanBu");
    for (const f of ["app/(admin)/admin/parent-requests/actions.ts", "lib/lms/attendance-record.ts"]) {
      expect(ma(f), `${f} không được thấy hành vi mới`).not.toMatch(/khongCanBu|statusCu/);
    }
  });

  it("[KCW-02] action admin: chặn 'Không cần bù' cho bé ĐÃ XẾP case TRƯỚC giao dịch ghi, và nói tên", () => {
    const ad = than(ma(ADMIN), "markAttendance");
    expect(vi(ad, "docHocVienDaXepCaseO(")).toBeLessThan(vi(ad, "giaoDichDiemDanh("));
    expect(dem(ad, "docHocVienDaXepCaseO(")).toBe(1);
    expect(ad).toContain('đã được xếp vào buổi học bù — gỡ khỏi case ở màn Học bù trước');
    // cổng THẬT: có bé đã xếp case ⇒ TRẢ LỖI (không chỉ có câu chữ nằm đó) — đã cấy `if (false)` và ghim chỉ-câu-chữ không đỏ
    expect(ad).toMatch(/if \(daXepCase\.length > 0\) \{\s*return \{ error:/);
    // danh sách bé chọn "Không cần bù" lấy từ giá trị ĐÃ TÍNH (sau luật), không từ payload thô
    expect(ad).toContain('if (sau === "NONE" && laVangDiemDanh(r.status)) chonKhongCanBu.push(r.studentId);');
  });

  it("[KCW-03] đồng bộ dòng sau điểm danh: nhánh 'Không cần bù' đứng SAU 'cần bù' và SAU 'có mặt'; thu hồi rồi mới ghi nhật ký, đúng một lần", () => {
    const d = than(ma(DONGBO), "dongBoDongSauDiemDanh");
    const iCan = vi(d, 'r.makeupStatus === "NEEDS_MAKEUP"');
    const iMat = vi(d, "CO_MAT.has(r.status)");
    const iKhong = vi(d, 'r.makeupStatus === "NONE"');
    expect(iCan).toBeLessThan(iMat);
    expect(iMat).toBeLessThan(iKhong);
    expect(vi(d, "huyDongKhongCanBu(tx")).toBeLessThan(vi(d, "ghiNhatKy(tx"));
    expect(dem(d, "huyDongKhongCanBu(")).toBe(1);
    expect(dem(d, 'action: "hoc-bu.khong-can-bu"')).toBe(1);
    // mặc định KHÔNG tạo dòng ở nhánh này
    const nhanh = d.slice(iKhong);
    expect(nhanh).not.toContain("taoDongHocBu(");
  });

  it("[KCW-04] dịch vụ thu hồi: chỉ dòng PENDING, đúng cạnh `TU_HUY_KHONG_CAN_BU`, KHÔNG đặt `waived*` (đó là quyết định có lý do của quản lý ở /hoc-bu)", () => {
    const h = than(ma(DICHVU), "huyDongKhongCanBu");
    expect(h).toContain('dong.status !== "PENDING"');
    expect(h).toContain('lyDo: "TU_HUY_KHONG_CAN_BU"');
    expect(h).toContain('tu: "PENDING", sang: "CANCELLED"');
    expect(h).not.toMatch(/waived/);
    expect(h).toContain("chiNeuCo: true");
  });

  it("[KCW-05] lưới admin: có đủ BA nút 'Cần học bù' · 'Đã học bù' · 'Không cần bù' (giá trị NONE) và dòng giải thích khi đang chọn NONE", () => {
    const u = ma(LUOI);
    expect(u).toContain('["NEEDS_MAKEUP", "Cần học bù"]');
    expect(u).toContain('["MADE_UP", "Đã học bù"]');
    expect(u).toContain('["NONE", "Không cần bù"]');
    expect(u).toContain('s.makeupStatus === "NONE"');
    expect(u).toContain("Không tạo buổi học bù cho buổi vắng này.");
  });

  it("[KCW-06] chỉ cấp quản lý cơ sở: `markAttendance` đòi `makeup:waive` CHỈ khi có lựa chọn MỚI, đứng TRƯỚC giao dịch ghi; lý do kiểm sau quyền (người không có quyền không bị hỏi lý do)", () => {
    const ad = than(ma(ADMIN), "markAttendance");
    const iMoi = vi(ad, "if (moiKhongCanBu.length > 0) {");
    const iQuyen = vi(ad, 'checkPermission("makeup:waive")');
    const iLyDo = vi(ad, "kiemLyDoKhongCanBu(");
    expect(iMoi).toBeLessThan(iQuyen);
    expect(iQuyen).toBeLessThan(iLyDo);
    expect(iLyDo).toBeLessThan(vi(ad, "giaoDichDiemDanh("));
    // quyền được kiểm TRONG khối "có lựa chọn mới": hàng cũ gửi lại NONE không làm người thường bị chặn oan
    expect(dem(ad, 'checkPermission("makeup:waive")')).toBe(1);
    expect(ad).toContain("if (laChonKhongCanBuMoi({ status: r.status, cu, sau })) moiKhongCanBu.push(r);");
    expect(ad).toMatch(/if \(!\(await checkPermission\("makeup:waive"\)\)\) \{\s*return \{ error:/);
    // lý do đi vào bản ghi đồng bộ CHỈ cho hàng mới
    expect(ad).toContain('lyDoKhongCanBu: moiKhongCanBu.includes(r) ? (r.lyDoKhongCanBu ?? "").trim() : null,');
  });

  it("[KCW-07] trang điểm danh truyền `coQuyenKhongCanBu` từ CHÍNH quyền `makeup:waive`; lưới ẩn nút khi không có quyền và đòi lý do cho hàng mới", () => {
    const p = ma("app/(admin)/admin/attendance/page.tsx");
    expect(p).toContain('const coQuyenKhongCanBu = await checkPermission("makeup:waive");');
    expect(p).toContain("coQuyenKhongCanBu={coQuyenKhongCanBu}");
    // lưới còn được dựng ở MỘT nơi nữa: tab điểm danh trong trang chi tiết lớp (qua ClassAttendancePanel) — cả hai nơi lấy quyền từ CHÍNH `makeup:waive`
    expect(ma("app/(admin)/admin/classes/[id]/page.tsx")).toContain('coQuyenKhongCanBu={await checkPermission("makeup:waive")}');
    expect(ma("app/(admin)/admin/classes/[id]/_components/class-attendance-panel.tsx")).toContain("coQuyenKhongCanBu={coQuyenKhongCanBu}");
    const u = ma(LUOI);
    expect(u).toContain('.filter(([value]) => value !== "NONE" || coQuyenKhongCanBu)');
    expect(u).toContain('aria-label="Lý do không cần bù"');
    // payload: chỉ hàng MỚI mang lý do; hàng cũ gửi null
    expect(u).toContain("lyDoKhongCanBu: laChonMoi(studentId, r) ? r.lyDoKhongCanBu.trim() : null,");
    // lưới chặn lưu ở phía client TRƯỚC khi gọi máy chủ
    expect(vi(u, "LY_DO_TOI_THIEU) {")).toBeLessThan(vi(u, "markAttendance("));
  });

  it("[KCW-08] nhật ký 'không cần bù': thực thể là bản ghi ĐIỂM DANH, ghi cho MỌI lần chọn mới (kể cả khi chưa có dòng nào để thu hồi) và mang lý do; `lyDo: true` trong danh sách đóng", () => {
    const d = than(ma(DONGBO), "dongBoDongSauDiemDanh");
    const nhanh = d.slice(vi(d, 'r.makeupStatus === "NONE"'));
    expect(nhanh).toContain('entityType: "Attendance"');
    expect(nhanh).toContain("entityId: r.attendanceId");
    expect(nhanh).toContain("reason: r.lyDoKhongCanBu.trim()");
    // điều kiện ghi là "có lý do" (lựa chọn mới), KHÔNG phải "có dòng thu hồi"
    expect(nhanh).toContain("if (r.lyDoKhongCanBu) {");
    expect(ma("lib/hoc-bu/nhat-ky-thuan.ts")).toMatch(/KHONG_CAN_BU: \{[^}]*lyDo: true \}/);
  });
});

