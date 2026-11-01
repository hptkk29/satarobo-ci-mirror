// Màn "Dạy thay" của site giáo viên (11/10/2026). Luật nghiệp vụ thuần (`laNguoiDayThay`) đã có ca ở
// `lib/lms/nguoi-dung-lop.test.ts` [NDL-07..10]; file này ghim DÂY NỐI — những thứ test hành vi không với tới vì
// mọi tab đều chạm DB / Server Action (gỡ lời gọi thì không ca hành vi nào đỏ, cùng lý do `[NDL-W*]`).
//
// Chủ dự án chốt 11/10: Nhận xét / Bài tập & Kiểm tra / Tài liệu của màn này PHẢI là CHÍNH các tab của lớp chính thức
// (`/teacher/lop?classId=…&tab=…`), chỉ thu hẹp vào đúng buổi dạy thay — nên lưới canh "không có bản sao" và "chế độ
// một-buổi không rò sang cả lớp".
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEACHER_ROUTE_SEGMENTS } from "@/lib/auth/route-policy";

const GOC = join(__dirname, "..", "..");
const DT = "app/(teacher)/teacher/day-thay";
const HUB = "app/(teacher)/teacher/lop/_components";
/** Đọc tệp, BỎ chú thích — chú thích giải thích bản vá thường chứa đúng chuỗi đang canh (luật 11). */
function ma(p: string): string {
  return readFileSync(join(GOC, p), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(d))
    .join("\n");
}
const dem = (src: string, chuoi: string) => src.split(chuoi).length - 1;

describe("[DT-W*] màn Dạy thay — đọc đúng người, ghi qua đúng đường, nói thật", () => {
  it("[DT-W1] danh sách: chỉ buổi MÌNH được xếp (khoá theo userId) và lọc bằng đúng luật `laNguoiDayThay`", () => {
    const src = ma("lib/teachers/day-thay.ts");
    expect(dem(src, "{ substituteTeacherId: userId }")).toBeGreaterThanOrEqual(1);
    expect(dem(src, "{ actualTeacherId: userId }")).toBe(1);
    // Câu tra danh sách KHÔNG được thiếu bộ lọc luật — thiếu là người đã chốt buổi của lớp mình cũng hiện ở "Dạy thay".
    expect(dem(src, "raw.filter((s) => laNguoiDayThay(userId, s))")).toBe(1);
    expect(dem(src, 'status: { not: "CANCELLED" }')).toBeGreaterThanOrEqual(2);
  });

  it("[DT-W2] cổng chi tiết: null nếu không phải buổi mình dạy thay / đã huỷ — và không có đường đọc chi tiết nào khác", () => {
    const src = ma("lib/teachers/day-thay.ts");
    expect(dem(src, 'if (!s || s.status === "CANCELLED" || !laNguoiDayThay(userId, s)) return null;')).toBe(1);
    // Các hàm đọc theo buổi nhận `ChiTietDayThay` (đã qua cổng), không nhận sessionId trần.
    for (const ham of ["docTienDoDayThay", "docNhanXetBuoiTruoc"]) {
      expect(src).toMatch(new RegExp(`export async function ${ham}\\(\\s*ct: ChiTietDayThay`));
    }
    // Actor mở rộng chỉ cộng CƠ SỞ DẠY — tuyệt đối không động vào assignedClassIds (nuôi SCORM / học bạ / chat DM).
    const ham = src.slice(src.indexOf("export function actorChoBuoiDayThay"));
    expect(ham).toContain("teachingCenterIds");
    expect(ham).not.toContain("assignedClassIds");
  });

  it("[DT-W3] trang chi tiết gọi cổng TRƯỚC mọi tab; null ⇒ màn 'không phải buổi của bạn', không render tab", () => {
    const src = ma(`${DT}/[sessionId]/page.tsx`);
    expect(dem(src, "await docChiTietDayThay(userId, sessionId)")).toBe(1);
    expect(dem(src, "if (!ct) return <KhongPhaiBuoiCuaBan />;")).toBe(1);
    expect(src.indexOf("if (!ct) return")).toBeLessThan(src.indexOf("<TabHocVien"));
    for (const tab of ["TabHocVien", "TabDiemDanh", "HubReviewsTab", "HubAssignmentsTab", "HubMaterialsTab"]) {
      expect(dem(src, `<${tab}`), tab).toBe(1);
    }
    // Ba tab hub đọc bằng actor đã mở rộng cơ sở dạy, KHÔNG phải actor gốc.
    expect(dem(src, "actorChoBuoiDayThay(actorGoc, ct)")).toBe(1);
  });

  it("[DT-W4] KHÔNG có bản sao: Nhận xét / Bài tập / Tài liệu là chính tab của Class Hub; điểm danh dùng panel của GV chính", () => {
    const page = ma(`${DT}/[sessionId]/page.tsx`);
    expect(page).toContain('from "../../lop/_components/hub-reviews-tab"');
    expect(page).toContain('from "../../lop/_components/hub-assignments-tab"');
    expect(page).toContain('from "../../lop/_components/hub-materials-tab"');
    expect(existsSync(join(GOC, DT, "_components/tab-nhan-xet.tsx"))).toBe(false);
    expect(existsSync(join(GOC, DT, "_components/tab-bai-tap.tsx"))).toBe(false);
    expect(existsSync(join(GOC, DT, "_components/tab-tai-lieu.tsx"))).toBe(false);
    const dd = ma(`${DT}/_components/tab-diem-danh.tsx`);
    expect(dd).toContain('from "../../lop/_components/attendance-panel"');
    // Cờ chỉ-xem tính bằng CÙNG hàm với server (luật 12) và có dòng DÙNG kết quả.
    expect(dem(dd, 'loiKhongPhaiNguoiDay(userId, ct.sohuu, "điểm danh")')).toBe(1);
    expect(dd).toContain("lyDoChiXem === null");
    // Không có tệp 'use server' nào trong thư mục màn này: ghi đi qua action đã có gác quyền.
    const tatCa: string[] = [];
    const duyet = (d: string) => {
      for (const e of readdirSync(join(GOC, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) duyet(rel);
        else if (/\.(ts|tsx)$/.test(e.name)) tatCa.push(rel);
      }
    };
    duyet(DT);
    for (const f of tatCa) expect(readFileSync(join(GOC, f), "utf8"), f).not.toMatch(/["']use server["']/);
  });

  it("[DT-W5] Nhận xét một-buổi: đúng buổi này, không có đường về danh sách cả lớp, không vẽ nút chắc chắn bị từ chối", () => {
    const page = ma(`${DT}/[sessionId]/page.tsx`);
    expect(page).toContain("reviewSessionId={ct.id}");
    expect(page).toContain("veDanhSach: null");
    expect(page).toContain("chonAnh: false");
    const hub = ma(`${HUB}/hub-reviews-tab.tsx`);
    // Chế độ nhúng bật bằng prop; hub gốc (không truyền) GIỮ NGUYÊN đường về và nút chọn ảnh.
    expect(hub).toContain("dieuHuong?.chonAnh !== false");
    expect(hub).toContain("`?classId=${classId}&tab=nhan-xet`");
    expect(hub).toContain("dieuHuong?.diemDanh ?? `?classId=${classId}&sessionId=${reviewSessionId}`");
    expect(ma("app/(teacher)/teacher/lop/page.tsx")).not.toContain("dieuHuong");
  });

  it("[DT-W6] Bài tập & Kiểm tra: chỉ đúng buổi / đúng bài; giao bài gắn đúng buổi; nộp bù và chấm bài không mở", () => {
    const page = ma(`${DT}/[sessionId]/page.tsx`);
    expect(page).toContain("sessionId: ct.id, lessonId: ct.lessonId, choGiaoBai");
    // Nút Giao bài vẽ theo CÙNG pipeline quyền với server (luật 12) — không vẽ bằng `true` cứng.
    expect(dem(page, 'action: "assignments:assign-own"')).toBe(1);
    const hub = ma(`${HUB}/hub-assignments-tab.tsx`);
    // Lọc danh sách theo buổi / bài; chi tiết cũng phải nằm trong phạm vi (chống đổi asgId trên URL).
    expect(dem(hub, "{ classSessionId: phamVi.sessionId }")).toBe(1);
    expect(dem(hub, "!trongPhamVi(asg)")).toBe(1);
    // Chấm bài / nộp bù: vẫn khoá theo LỚP MÌNH PHỤ TRÁCH ⇒ ở chế độ buổi thì không vẽ, không đi vào.
    expect(dem(hub, "if (submissionId && !phamVi) {")).toBe(1);
    expect(dem(hub, "canGrade && sub && !phamVi")).toBe(1);
    expect(dem(hub, "canAssign && !phamVi && (")).toBe(1);
    // Giao bài: dialog KHOÁ buổi (không chọn được buổi khác); kho chỉ đọc khi thật sự giao được.
    expect(dem(hub, "canAssign && assignData")).toBe(1);
    expect(dem(hub, "buoiCoDinh={phamVi?.sessionId}")).toBe(1);
    expect(hub).toMatch(/phamVi\s*&&\s*!canAssign\s*\?\s*null\s*:\s*loadTeacherAssignData/);
    const dlg = ma("app/(teacher)/teacher/cham-bai/_components/assign-dialog.tsx");
    expect(dem(dlg, "buoiCoDinh ? null : sessionField")).toBe(2);
    expect(dem(dlg, "useState(buoiCoDinh ?? NO_SESSION)")).toBe(1);
  });

  it("[DT-W9] giao bài của người dạy thay: ngoại lệ HẸP ở server — đúng buổi mình dạy thay, đúng lớp, gắn vào buổi đó", () => {
    const src = ma("app/(teacher)/teacher/cham-bai/_actions.ts");
    // Cổng lớp gốc VẪN còn: người không dạy thay không đi qua nhánh ngoại lệ.
    expect(dem(src, "if (!actorGoc.assignedClassIds.has(classId)) {")).toBe(1);
    // Nhánh ngoại lệ: phải nêu buổi, buổi thuộc đúng lớp, chưa huỷ, và mình là người dạy thay của buổi đó.
    expect(dem(src, "const sid = parsed.data.sessionId;")).toBe(1);
    expect(dem(src, "buoi.classId !== classId")).toBe(1);
    expect(dem(src, 'buoi.status === "CANCELLED"')).toBe(1);
    expect(dem(src, "!laNguoiDayThay(session.user.id, buoi)")).toBe(1);
    // Cổng đứng TRƯỚC mọi phép đọc/ghi dữ liệu bài giao; quyền đi qua cùng pipeline (không bỏ qua `can()`).
    const cong = src.indexOf("if (!actorGoc.assignedClassIds.has(classId)) {");
    expect(cong).toBeGreaterThan(-1);
    expect(cong).toBeLessThan(src.indexOf("const sdb = scopedDb(actorGiangDay(actor));"));
    expect(cong).toBeLessThan(src.indexOf("sdb.assignmentTemplate.findUnique"));
    expect(dem(src, "dayThay &&")).toBe(1);
    expect(dem(src, "decidePermissionWithGrant({")).toBe(1);
    expect(dem(src, "moRongCoSoDay(actorGoc, centerId)")).toBe(1);
    // Bài giao gắn vào CHÍNH buổi đã chứng minh (nhánh "Buổi học" dùng cùng sessionId, buổi phải thuộc `classId`).
    expect(src).toContain("where: { id: parsed.data.sessionId, classId }");
    expect(src).toContain("classSessionId = ses.id;");
  });

  it("[DT-W7] Tài liệu: chỉ bài của buổi này; SCORM mở bằng đúng buổi được giao; trình xem tài liệu nhận người dạy thay", () => {
    const page = ma(`${DT}/[sessionId]/page.tsx`);
    expect(page).toContain("quayVe: `${urlBuoi}?tab=tai-lieu`");
    const hub = ma(`${HUB}/hub-materials-tab.tsx`);
    expect(dem(hub, "(l) => !phamVi || l.id === phamVi.lessonId")).toBe(1);
    expect(hub).toContain("{ id: phamVi.sessionId, lessonId: phamVi.lessonId }");
    expect(hub).toContain("courseId && !phamVi");
    // SCORM: buổi phải đọc qua `withMakeupException` — `ClassSession` là model SCOPED, nên đọc qua `sdb` thì người dạy thay ở
    // cơ sở KHÁC lớp (CS1 dạy thay lớp CS2) không thấy buổi ⇒ cổng từ chối ⇒ "Mở trình chiếu" bị đá về trang chủ (11/10).
    const play = ma("app/(teacher)/teacher/scorm/play/[id]/page.tsx");
    expect(dem(play, "withMakeupException(actorGiangDay(actor)).classSession.findUnique")).toBe(1);
    expect(play).not.toMatch(/sdb\.classSession\.findUnique/);
    const xem = ma("app/(teacher)/teacher/tai-lieu/xem/page.tsx");
    expect(dem(xem, "{ substituteTeacherId: session.user.id }")).toBe(1);
    expect(dem(xem, "if (!dayThay) return <NotFound />;")).toBe(1);
  });

  it("[DT-W8] lối vào: menu có href literal, segment khai ở route-policy, trang chủ dẫn buổi dạy thay vào màn này", () => {
    expect(ma("app/(teacher)/teacher/_components/nav-config.ts")).toContain('href: "/teacher/day-thay"');
    expect(TEACHER_ROUTE_SEGMENTS.has("day-thay")).toBe(true);
    const home = ma("app/(teacher)/teacher/page.tsx");
    expect(dem(home, "`/teacher/day-thay/${s.id}?tab=diem-danh`")).toBe(1);
    expect(dem(home, "`/teacher/day-thay/${s.id}?tab=nhan-xet`")).toBe(1);
    expect(home).toContain("demBuoiDayThaySapToi(session.user.id, now)");
    // Màn điểm danh kiểu cũ: nút quay lại của người dạy thay không được dẫn vào hub lớp (sẽ NotYours).
    expect(ma("app/(teacher)/teacher/lop/page.tsx")).toContain("/teacher/day-thay/${sessionId}?tab=diem-danh");
    for (const f of ["page.tsx", "loading.tsx", "[sessionId]/page.tsx"]) {
      expect(existsSync(join(GOC, DT, f)), f).toBe(true);
    }
  });
});
