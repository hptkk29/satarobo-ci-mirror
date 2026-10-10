// [CNW-*] — LƯỚI GHIM MÃ NGUỒN cho T07 (case nhiều bài + điểm danh hai tầng).
//
// Hành vi đã có test thật trên Postgres (`tests/hoc-bu/case-nhieu-bai.test.ts`). Thứ chúng KHÔNG canh: một đường GHI mới (hay đường cũ bị sửa)
// quên khoá hàng case, quên nâng case đời cũ, tự đổi `result` của mục ngoài bảng, hay XOÁ lịch sử — test hành vi của đường đó vẫn xanh vì nó không
// khẳng định những điều ấy. Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích, neo chuỗi HẸP vào LỜI GỌI, đếm số lần khớp.
import { execFileSync } from "node:child_process";
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
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
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

const CASE = "lib/hoc-bu/case-db.ts";
const DD = "lib/hoc-bu/case-diem-danh-db.ts";
const NC = "lib/hoc-bu/case-nang-cap-db.ts";
const KHOA_HANG = 'FROM "MakeupCase" WHERE id =';

/** Mọi lời gọi `token(` trong `src` — trả phần ĐỐI SỐ (đếm ngoặc cân bằng, không đoán độ dài). */
function cacLoiGoi(src: string, token: string): string[] {
  const ra: string[] = [];
  for (let i = src.indexOf(token); i !== -1; i = src.indexOf(token, i + token.length)) {
    let sau = i + token.length;
    let sau_ = 1;
    while (sau < src.length && sau_ > 0) {
      const ch = src[sau++];
      if (ch === "(") sau_++;
      else if (ch === ")") sau_--;
    }
    ra.push(src.slice(i + token.length, sau - 1));
  }
  return ra;
}
/** Khối `data: { … }` của một lời gọi Prisma (cân bằng ngoặc nhọn). */
function khoiData(goi: string): string {
  const i = goi.indexOf("data:");
  if (i === -1) return "";
  const dau = goi.indexOf("{", i);
  let d = 1;
  let j = dau + 1;
  while (j < goi.length && d > 0) {
    if (goi[j] === "{") d++;
    else if (goi[j] === "}") d--;
    j++;
  }
  return goi.slice(dau, j);
}

const tepMaNguon = () =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx", "scripts/**/*.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));

describe("[CNW] T07 — case nhiều bài + điểm danh hai tầng: dây nối", { timeout: 60_000 }, () => {
  it("[CNW-01] bảng MỚI theo cơ sở khai đủ BA chỗ (luật nền hệ thống #3): SCOPED_MODELS · getModelPrefixes · BACKFILL_SPECS — thiếu getModelPrefixes là tầm nhìn rơi về diện rộng", () => {
    const sc = doc("lib/db-scope.ts");
    expect(sc).toMatch(/"MakeupCase", "MakeupCaseStudent", "MakeupCaseParticipant",/);
    expect(sc).toMatch(/case "MakeupCaseParticipant":\n\s+return \["makeup:", "classes:"\];/);
    expect(doc("lib/org/center-bridge.ts")).toMatch(/model: "MakeupCaseParticipant",\n\s+nullMeaning: "BAT_BUOC",/);
    // MakeupCaseLesson KHÔNG có cột cơ sở (đi theo case) nên KHÔNG khai ở scope — khai nhầm là truy vấn bị lọc theo cột không có.
    expect(sc).not.toContain('"MakeupCaseLesson"');
  });

  it("[CNW-02] KHÔNG xoá lịch sử: không nơi nào `delete`/`deleteMany` mục (MakeupCaseStudent) hay bé tham gia (MakeupCaseParticipant) ngoài test; bộ bài chỉ bỏ ở `suaCase`", () => {
    const xoa = /\b(makeupCaseStudent|makeupCaseParticipant)\.(delete|deleteMany)\s*\(/;
    for (const f of tepMaNguon()) expect(ma(f), f).not.toMatch(xoa);
    const lessonDel = tepMaNguon().filter((f) => /makeupCaseLesson\.(delete|deleteMany)\s*\(/.test(ma(f)));
    expect(lessonDel).toEqual([CASE]);
    expect(dem(than(ma(CASE), "suaCase"), "makeupCaseLesson.deleteMany(")).toBe(1);
  });

  it("[CNW-03] ghi lên `MakeupCaseParticipant` / `MakeupCaseLesson` CHỈ ở ba tệp (case-db · case-diem-danh-db · case-nang-cap-db) — kiểm kê", () => {
    const ghi = /\b(makeupCaseParticipant|makeupCaseLesson)\.(create|createMany|createManyAndReturn|update|updateMany|upsert)\s*\(/;
    const co = tepMaNguon().filter((f) => ghi.test(ma(f)));
    expect(co.sort()).toEqual([CASE, DD, NC].sort());
  });

  it("[CNW-04] `result` của mục CHỈ đổi ở `doiKetQuaMuc` (theo bảng chuyenMuc) và phép nâng đời cũ; chỗ khác chỉ TẠO mục mới (PLANNED mặc định)", () => {
    const chamResult: string[] = [];
    for (const f of tepMaNguon()) {
      const src = ma(f);
      for (const tok of ["makeupCaseStudent.update(", "makeupCaseStudent.updateMany("]) {
        for (const g of cacLoiGoi(src, tok)) if (/\bresult\s*:/.test(khoiData(g))) chamResult.push(f);
      }
    }
    expect([...new Set(chamResult)].sort()).toEqual([DD, NC].sort());
    const doi = than(ma(DD), "doiKetQuaMuc");
    expect(dem(doi, "makeupCaseStudent.updateMany(")).toBe(1);
    expect(doi).toContain("result: den,");
    expect(doi).toContain("where: { id: m.id, result: m.result },"); // so-và-đổi: hai người đổi cùng lúc thì một người thua
    // Ngoài `doiKetQuaMuc`, tệp điểm danh không còn lời gọi nào đổi `result`.
    const ngoai = ma(DD).replace(doi, "");
    for (const tok of ["makeupCaseStudent.update(", "makeupCaseStudent.updateMany("]) {
      for (const g of cacLoiGoi(ngoai, tok)) expect(khoiData(g)).not.toMatch(/\bresult\s*:/);
    }
  });

  it("[CNW-05] mọi đường GHI đổi case lấy KHOÁ HÀNG case TRƯỚC phép ghi đầu tiên và NÂNG case đời cũ sau khoá", () => {
    const cd = ma(CASE);
    const dd = ma(DD);
    const kiem = (ten: string, src: string) => {
      const t = than(src, ten);
      const khoa = vi(t, KHOA_HANG);
      expect(t, ten).toContain("FOR UPDATE");
      const nang = vi(t, "nangCapCase(");
      expect(nang, `${ten}: nâng case phải SAU khoá`).toBeGreaterThan(khoa);
      return { t, khoa, nang };
    };
    // `xepVaoCaseCoSan` khoá hàng case rồi giao cho `ghiBeVaoCase` (tự nâng ĐẦU hàm — kiểm ở cuối ca này).
    const xep = than(cd, "xepVaoCaseCoSan");
    expect(vi(xep, KHOA_HANG)).toBeLessThan(vi(xep, "ghiBeVaoCase("));
    expect(vi(xep, KHOA_HANG)).toBeLessThan(vi(xep, "kiemLichTrongTx("));
    // Trạng thái case phải được ĐỌC LẠI trong khoá (lần đọc ngoài transaction có thể đã cũ: huỷ / chốt case chen vào giữa) và chặn TRƯỚC khi ghi.
    expect(vi(xep, 'song?.status !== "SCHEDULED"')).toBeGreaterThan(vi(xep, KHOA_HANG));
    expect(vi(xep, 'song?.status !== "SCHEDULED"')).toBeLessThan(vi(xep, "ghiBeVaoCase("));
    for (const ten of ["goBeKhoiCase", "huyCase", "suaCase"]) {
      const { t, nang } = kiem(ten, cd);
      // Phép ghi đầu tiên (mục / bé / case / dòng / sổ) đứng SAU khi đã nâng.
      const ghiDau = Math.min(...[/\.updateMany\(/, /\.update\(/, /\.create\(/, /\.createMany\(/, /\.upsert\(/, /giuLuot\(/, /doiKetQuaMuc\(/, /nhaMucTrongTx\(/, /ghiBeVaoCase\(/].map((re) => {
        const m = re.exec(t.slice(nang));
        return m ? nang + m.index : Infinity;
      }));
      expect(ghiDau, `${ten}: có phép ghi trước khi nâng`).toBeGreaterThan(nang);
    }
    kiem("nhaMucTrongTx", dd);
    kiem("ganDiemDanhBeTrongTx", dd);
    // `ghiBeVaoCase` tự nâng ĐẦU hàm (được gọi cả từ test dựng trực tiếp) — trước mọi phép ghi.
    const g = than(cd, "ghiBeVaoCase");
    expect(vi(g, "nangCapCase(")).toBeLessThan(vi(g, "chuyenTrangThaiDong("));
    expect(vi(g, "nangCapCase(")).toBeLessThan(vi(g, "makeupCaseParticipant.create("));
  });

  it("[CNW-06] sửa điểm danh: audit CÙNG giao dịch; phiên bản của bé là điều kiện của phép ghi; quyền ghi đè quá hạn chỉ truyền xuống sau cổng quyền", () => {
    const s = than(ma(DD), "suaDiemDanhBe");
    expect(dem(s, "writeAudit(")).toBe(1);
    expect(vi(s, "$transaction(")).toBeLessThan(vi(s, "writeAudit("));
    expect(s).toContain("tx,");
    expect(s).toContain("if (lyDo.length < 10) throw");
    const g = than(ma(DD), "ganDiemDanhBeTrongTx");
    expect(g).toContain("where: { id: be.id, version: be.version, attendanceStatus: be.attendanceStatus },");
    expect(g).toContain("p.phienBan === undefined || be.version !== p.phienBan");
    // Action: ghi đè đòi `makeup:waive` TRƯỚC khi gọi service.
    const ad = doc("app/(admin)/admin/hoc-bu/_actions.ts");
    const gd = than(ad, "ghiDeTuInput");
    expect(gd).toContain('checkPermission("makeup:waive")');
    for (const ten of ["diemDanhBeAction", "suaDiemDanhBeAction"]) {
      const t = than(ad, ten);
      expect(vi(t, 'cong("makeup:attend")'), ten).toBeLessThan(vi(t, "ghiDeTuInput("));
      expect(vi(t, "ghiDeTuInput("), ten).toBeLessThan(vi(t, "try {"));
    }
  });

  it("[CNW-07] action ghi mới: quyền ở ĐẦU hàm; site GV chốt 'đúng giáo viên của case' bằng `chiGiaoVien`, không nhận id giáo viên từ trình duyệt", () => {
    const ad = doc("app/(admin)/admin/hoc-bu/_actions.ts");
    for (const [ten, quyen] of [
      ["diemDanhBeAction", "makeup:attend"],
      ["suaDiemDanhBeAction", "makeup:attend"],
      ["goBeKhoiCaseAction", "makeup:manage"],
      ["suaCaseAction", "makeup:manage"],
    ] as const) {
      const t = than(ad, ten);
      expect(vi(t, `cong("${quyen}")`), ten).toBeLessThan(vi(t, "try {"));
    }
    const gv = doc("app/(teacher)/teacher/hoc-bu/_actions.ts");
    for (const ten of ["diemDanhBeGvAction", "suaDiemDanhBeGvAction"]) {
      const t = than(gv, ten);
      expect(vi(t, 'checkPermission("makeup:attend")'), ten).toBeLessThan(vi(t, "try {"));
      expect(t, ten).toContain("chiGiaoVien: session.user.id");
      expect(t, ten).not.toMatch(/teacherId|giaoVienId/);
    }
  });

  it("[CNW-08] trạng thái CASE chỉ đổi ở `chotLaiCaseTrongTx` (sau điểm danh / gỡ) và `huyCase` — không `status: \"COMPLETED\"` viết tay ở nơi khác", () => {
    for (const f of tepMaNguon()) {
      const src = ma(f);
      for (const tok of ["makeupCase.update(", "makeupCase.updateMany("]) {
        for (const g of cacLoiGoi(src, tok)) {
          if (!/\bstatus\s*:/.test(khoiData(g))) continue;
          expect([DD, CASE], `${f} đổi status của case`).toContain(f);
        }
      }
    }
    const chot = than(ma(DD), "chotLaiCaseTrongTx");
    expect(chot).toContain("chotCase(c.participants)");
    expect(chot).toContain('if (!c || c.status === "CANCELLED") return null;');
    expect(than(ma(CASE), "huyCase")).toContain('data: { status: "CANCELLED" }');
    // Trong `case-db.ts` chỉ `huyCase` đổi status của case; mọi đường khác (sửa case) không đổi status.
    const trongCase = cacLoiGoi(ma(CASE), "makeupCase.updateMany(").filter((g) => /\bstatus\s*:/.test(khoiData(g)));
    expect(trongCase).toHaveLength(1);
  });
});
