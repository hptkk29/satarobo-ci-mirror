// [CTX-W*] — lưới ghim dây nối của ngữ cảnh một nút "Chấm công" (SR.QD.238). Hành vi: ngu-canh-cham-cong.test.ts (thuần) +
// tests/cham-cong/parttime-ngu-canh.spec.ts (Postgres thật). Ở đây chỉ canh những luật mà test hành vi KHÔNG nói được vì nó
// nằm ở CHỖ GỌI: dự đoán = lượt ghi (cùng một hàm hướng), client không gửi hướng / vai / ngữ cảnh, trực chỉ từ dòng trực
// tường minh, không phân loại theo vai RBAC, lỗi bộ suy ngữ cảnh không bao giờ chặn chấm công.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, x: string | RegExp) => (typeof x === "string" ? s.split(x).length - 1 : (s.match(new RegExp(x.source, "g")) ?? []).length);

const THUAN = doc("lib/parttime/ngu-canh-cham-cong.ts");
const NC_DB = doc("lib/parttime/ngu-canh-cham-cong-db.ts");
const CHE_DO = doc("lib/parttime/che-do-huong.ts");
const SUY_DB = doc("lib/cham-cong/suy-huong-db.ts");
const ACTION = doc("lib/attendance/checkin-action.ts");
const CLIENT = doc("components/cham-cong/checkin-client.tsx");
const KHOI = doc("components/cham-cong/khoi-ngu-canh.tsx");
const TRANG_QL = doc("app/(admin)/admin/cham-cong/checkin/page.tsx");
const TRANG_GV = doc("app/(teacher)/teacher/cham-cong/checkin/page.tsx");

describe("[CTX-W] dây nối ngữ cảnh chấm công", () => {
  it("[CTX-W1] bộ ngữ cảnh THUẦN không tự tính hướng: chỉ chuyển nguyên `v.huong.huong` (không gọi suyHuongLuot / so giờ để ra VÀO-RA)", () => {
    expect(THUAN).not.toMatch(/suyHuongLuot|cacBuoiTuCa/);
    expect(dem(THUAN, "direction: v.huong.huong")).toBe(1);
    expect(THUAN).not.toMatch(/direction:(?!\s*(v\.huong\.huong|HuongLuot;))/);
  });

  it("[CTX-W2] hai trang Chấm công dựng ngữ cảnh TRÊN đúng kết quả `suyHuongHomNay` đã tính (dự đoán không suy lần hai)", () => {
    for (const [ten, s] of [["admin", TRANG_QL], ["site GV", TRANG_GV]] as const) {
      expect(s, ten).toMatch(/docNguCanhAnToan\(\{[^}]*huong: duDoan[^}]*now \}\)/);
      expect(s, ten).not.toMatch(/docNguCanhChamCong\(/); // bản an toàn, không bao giờ bản ném
      expect(s, ten).toMatch(/nguCanh=\{nguCanh\}/);
    }
    // Cùng mốc `now` cho hướng và ngữ cảnh (không `new Date()` thứ hai giữa hai lời gọi).
    expect(TRANG_QL).toMatch(/suyHuongHomNay\(\{ userId: session\.user\.id, workLocationId: gate\.workLocation\.id, now \}\)/);
    expect(TRANG_GV).toMatch(/suyHuongHomNay\(\{ userId: session\.user\.id, workLocationId: gate\.workLocation\.id, now \}\)/);
  });

  it("[CTX-W3] lượt GHI: hướng ghi = `suy` của `suyHuongHomNay`; ngữ cảnh sau ghi dùng CHÍNH `suy` + `now` đó, qua bản an toàn", () => {
    expect(dem(ACTION, /const suy = await suyHuongHomNay\(/)).toBe(1);
    expect(ACTION).toMatch(/docNguCanhAnToan\(\{ userId: session\.user\.id, workLocationId: c\.workLocationId, huong: suy, now \}\)/);
    expect(ACTION).not.toMatch(/docNguCanhChamCong\(/);
    // Ngữ cảnh đọc SAU khi ghi — không bao giờ đứng trước và không bao giờ quyết điều gì của lượt ghi.
    expect(ACTION.indexOf("docNguCanhAnToan({")).toBeGreaterThan(ACTION.indexOf("recordTimeLog("));
    expect(ACTION).not.toMatch(/nguCanh\.(direction|primary|contexts)/);
  });

  it("[CTX-W4] client KHÔNG gửi hướng / vai / ngữ cảnh / mã phân công; máy chủ không đọc `type` client gửi", () => {
    const goi = CLIENT.slice(CLIENT.indexOf("await recordCheckin({"), CLIENT.indexOf("});", CLIENT.indexOf("await recordCheckin({")));
    expect(goi).toContain("ticketId");
    expect(goi).not.toMatch(/\b(type|huong|direction|role|contextType|assignmentId|dutyId|cheDo)\b/);
    const sch = ACTION.slice(ACTION.indexOf("const schema = z.object({"), ACTION.indexOf("});", ACTION.indexOf("const schema = z.object({")));
    expect(sch).not.toMatch(/\b(role|contextType|assignmentId|dutyId|direction|huong)\b/);
    expect(ACTION).not.toMatch(/data\.type\b|parsed\.data\.type|input\.type\b/);
  });

  it("[CTX-W5] trực CHỈ từ `OperationsDutyAssignment` — mảng `truc` không dựng từ ô ca, lượt chấm hay buổi dạy", () => {
    const dungTruc = NC_DB.slice(NC_DB.indexOf("const truc: TrucVao[]"), NC_DB.indexOf("const segs"));
    expect(dungTruc).toMatch(/^const truc: TrucVao\[\] = trucRaw\.flatMap/);
    expect(dem(NC_DB, /trucRaw\s*\]?\s*=|\btrucRaw,/)).toBe(1); // trucRaw sinh đúng một chỗ: phần tử thứ 2 của Promise.all
    const pa = NC_DB.slice(NC_DB.indexOf("const [bc, trucRaw, ca, wl] = await Promise.all(["), NC_DB.indexOf("]);", NC_DB.indexOf("const [bc, trucRaw")));
    const phanTu = pa.split("\n").map((l) => l.trim()).filter((l) => /^(docBangChung|db\.|p\.workLocationId)/.test(l));
    expect(phanTu[1]).toMatch(/^db\.operationsDutyAssignment\.findMany\(/);
    expect(dungTruc).not.toMatch(/shiftAssignment|staffTimeLog|\bday\b|\btiet\b|segments/);
    // Thuần: chỉ đẩy OPERATIONS_DUTY khi có dòng trực ĐÃ NHẬN.
    expect(dem(THUAN, 'contexts.push("OPERATIONS_DUTY")')).toBe(1);
    expect(THUAN).toMatch(/if \(truc\.length\) contexts\.push\("OPERATIONS_DUTY"\)/);
  });

  it("[CTX-W6] KHÔNG phân loại theo vai RBAC ở mọi tệp của luồng (không `User.role` / `roles` / so 'TEACHER')", () => {
    for (const [ten, s] of [["thuần", THUAN], ["db", NC_DB], ["cổng hướng", CHE_DO], ["suy-huong-db", SUY_DB], ["khối UI", KHOI]] as const) {
      // `.role` của PHÂN CÔNG (WorkRole MAIN_TEACHER / TEACHING_ASSISTANT) là dữ liệu hôm nay — được. Vai RBAC (`Role`) thì không.
      expect(s, ten).not.toMatch(/\buser\.role\b|\broles\b|["'](TEACHER|SALES_CSM|CENTER_MANAGER|SUPER_ADMIN|TRAINING|HR)["']|\bRole\b/);
    }
  });

  it("[CTX-W7] cổng hướng ngày Parttime: công tắc là câu ĐẦU (TẮT ⇒ không tra gì), và lỗi ⇒ luật ca cũ (không chặn chấm công)", () => {
    const than = CHE_DO.slice(CHE_DO.indexOf("export async function laNgayParttime("));
    const dong = than.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(dong[1]).toBe("if (!(await phanCongBat())) return false;");
    expect(SUY_DB).toMatch(/async function cheDoAnToan\([^)]*\)[^{]*\{\s*try \{\s*return await laNgayParttime\(/);
    expect(SUY_DB).toMatch(/catch \(e\) \{[^}]*return false;/);
    expect(dem(SUY_DB, "laNgayParttime(")).toBe(1);
    expect(dem(SUY_DB, "cheDoAnToan(input.userId, workDate)")).toBe(1);
    // Ngày Parttime ⇒ bỏ buổi ô ca khỏi luật hướng; ngày khác ⇒ y như cũ.
    expect(SUY_DB).toMatch(/const cacBuoi = assignment && !parttime \? cacBuoiTuCa\(/);
    // Ngữ cảnh: công tắc + chính sách là hai cổng đầu; bản an toàn nuốt lỗi.
    expect(NC_DB).toMatch(/if \(!\(await phanCongBat\(\)\)\) return null;/);
    expect(NC_DB).toMatch(/if \(!cs \|\| cs\.thamSo\.loai !== "SR_QD_238"\) return null;/);
    expect(NC_DB).toMatch(/export async function docNguCanhAnToan[\s\S]*?try \{\s*return await docNguCanhChamCong\(p\);\s*\} catch[\s\S]*?return null;/);
  });

  it("[CTX-W8] cổng hướng chỉ tính phân công DẠY / TRỢ GIẢNG còn sống + dòng trực còn sống — không suy từ ô ca hay vai", () => {
    expect(CHE_DO).toMatch(/sessionStaffAssignment\.count\(\{ where: \{ userId: p\.userId, ngay: p\.workDate, status: \{ in: \[\.\.\.SONG\] \}, role: \{ in: \["MAIN_TEACHER", "TEACHING_ASSISTANT"\] \} \} \}\)/);
    expect(CHE_DO).toMatch(/operationsDutyAssignment\.count\(\{ where: \{ userId: p\.userId, workDate: p\.workDate, status: \{ in: \[\.\.\.SONG\] \} \} \}\)/);
    expect(CHE_DO).not.toMatch(/shiftAssignment|staffTimeLog|"CANCELLED"|"REPLACED"|"DECLINED"/);
    expect(CHE_DO).toMatch(/return !!cs && cs\.thamSo\.loai === "SR_QD_238" && day \+ truc > 0;/);
  });

  it("[CTX-W9] giao diện: MỘT nút, khối ngữ cảnh chỉ THAY dòng ca khi việc chính ≠ ca thường; không chữ công / tiền", () => {
    expect(dem(CLIENT, /onClick=\{submit\}/)).toBe(1);
    expect(CLIENT).not.toMatch(/CHECK_IN"\s*\)\s*}|chọn (vào|ra)|Chấm ca|Chấm tiết/i);
    // MỘT hàm quyết "thẻ có dùng khối ngữ cảnh không" cho cả trước khi bấm lẫn màn "Đã ghi" — không chép điều kiện tại chỗ.
    expect(dem(CLIENT, /hienKhoiNguCanh\(/)).toBe(2);
    expect(CLIENT).not.toMatch(/\.primary !== "NORMAL_SHIFT"/);
    expect(KHOI).not.toMatch(/\d\s?đ\b|thù lao|tiền|lương|WorkUnit|payable/i);
  });
});
