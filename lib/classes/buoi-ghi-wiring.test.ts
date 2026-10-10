// [BGW-*] — LƯỚI GHIM MÃ NGUỒN cho T03: mọi đường GHI buổi học của lớp đi qua `lib/classes/buoi-ghi.ts`.
//
// Hành vi đã có test thật trên Postgres (`tests/hoc-bu/lich-lop*.test.ts`). Thứ chúng KHÔNG canh là việc đường ghi cũ MỌC LẠI:
// một người thêm `classSession.update({ data: { date } })` ở chỗ thứ 17, đúng như 21 chỗ cũ — không khoá, không kiểm lại ngày
// cũ, không dấu chỉnh tay — mọi test hành vi vẫn xanh vì không ai gọi chỗ đó. Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM
// MÃ NGUỒN": bóc chú thích, neo chuỗi HẸP vào LỜI GỌI, đếm số lần khớp, chưa cấy thử thì coi như vô dụng.
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
const dem = (s: string, x: string) => s.split(x).length - 1;
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:export )?(?:async )?(?:function|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}

/** Phần ruột (giữa cặp ngoặc tròn khớp nhau) của MỌI lời gọi `ten(...)` trong `src`. */
function cacLoiGoi(src: string, ten: string): string[] {
  const ra: string[] = [];
  let i = src.indexOf(ten);
  while (i !== -1) {
    let sau = i + ten.length;
    let sau_ = 1;
    while (sau < src.length && sau_ > 0) {
      if (src[sau] === "(") sau_++;
      else if (src[sau] === ")") sau_--;
      sau++;
    }
    ra.push(src.slice(i + ten.length, sau - 1));
    i = src.indexOf(ten, sau);
  }
  return ra;
}

const SERVICE = "lib/classes/buoi-ghi.ts";
const GEN = "lib/classes/generate.ts";
const SYNC = "lib/classes/session-sync.ts";
const LUI = "lib/classes/lui-lich.ts";
const ADJ = "lib/classes/adjust.ts";
const PHASES = "lib/classes/phases-service.ts";
const SCHED = "app/(admin)/admin/classes/[id]/_schedule-actions.ts";
const CLASSES = "app/(admin)/admin/classes/_actions.ts";
const SESS = "app/(admin)/admin/sessions/_actions.ts";

const GHI_BUOI = /\bclassSession\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/g;

/**
 * Bảng KIỂM KÊ mọi lời gọi ghi `ClassSession` trong `app/` + `lib/` (không tính test, seed, script — công cụ một lần).
 * Khi T03 xong: 17 lời gọi ở 9 tệp (từ 21 ở 10 tệp). Thêm một lời gọi mới ⇒ test này ĐỎ để người viết phải TỰ HỎI:
 *   · nó đổi `date` hoặc TẠO buổi? ⇒ phải đi qua `buoi-ghi.ts` (khoá + kiểm trùng + dấu chỉnh tay), không viết ở đây;
 *   · nó chỉ đổi trạng thái/nội dung/checklist? ⇒ thêm dòng vào bảng này kèm lý do.
 */
const KIEM_KE: Record<string, { so: number; vi: string }> = {
  "lib/classes/buoi-ghi.ts": { so: 3, vi: "dịch ngày (updateMany) + thêm buổi (create) + sinh lô (createMany) — dưới khoá lớp" },
  "lib/classes/buoi-trung-db.ts": { so: 1, vi: "dọn buổi trùng: HUỶ (không xoá) buổi dư dưới khoá, có `expect` chặn trước — chỉ script/test gọi" },
  "lib/classes/adjust.ts": { so: 3, vi: "huỷ có điều kiện (updateMany) · đổi ngày dưới khoá (updateMany) · đổi phòng/GV dạy thay (update, không đổi ngày)" },
  "lib/classes/lui-lich.ts": { so: 2, vi: "nghiBuoiLop: huỷ buổi nghỉ + lùi nội dung bài — chỉ trạng thái/nội dung, KHÔNG đổi ngày; buổi mới đi qua themBuoi" },
  "lib/classes/snapshot.ts": { so: 1, vi: "gán lại planId/lessonId khi đổi phiên bản giáo trình — chỉ nội dung" },
  "lib/lms/session-lifecycle.ts": { so: 1, vi: "hoàn tất buổi: status + sĩ số chốt + thực tế — không đổi ngày" },
  "app/(admin)/admin/classes/_actions.ts": { so: 1, vi: "cancelClassAction: chuyển buổi tương lai sang CANCELLED — rời phạm vi chỉ mục, không đổi ngày" },
  "app/(admin)/admin/sessions/_actions.ts": { so: 2, vi: "updateSession (trong giao dịch, có khoá + kiểm trùng + dấu) · deleteSession (xoá cứng — nợ ghi ở báo cáo T03)" },
  "app/(admin)/admin/sessions/[id]/_actions.ts": { so: 3, vi: "checklist · bắt đầu · hoàn tất buổi — không đổi ngày" },
  "lib/cham-cong/don/hoan-tac.ts": { so: 2, vi: "hoàn tác đơn nghỉ buổi dạy ĐÃ DUYỆT (đơn từ đợt 11): huỷ buổi bù do đơn sinh ra + khôi phục buổi gốc — updateMany CÓ điều kiện phiên bản, dưới `khoaLopBuoi`; lỗi chỉ mục trùng giờ dịch thành DecideError [BGW-03]" },
};

describe("[BGW] T03 — mọi đường ghi buổi học đi qua `buoi-ghi.ts`", () => {
  it("[BGW-03] hoàn tác đơn đã duyệt (hoan-tac.ts) ghi buổi DƯỚI khoá lớp và dịch lỗi trùng giờ — không đi vòng cổng T03", () => {
    const src = boChuThich(readFileSync(resolve(process.cwd(), "lib/cham-cong/don/hoan-tac.ts"), "utf8"));
    const khoa = src.indexOf("khoaLopBuoi(tx, goc.classId)");
    expect(khoa, "thiếu khoá lớp").toBeGreaterThan(-1);
    expect(khoa).toBeLessThan(src.indexOf("tx.classSession.updateMany("));
    expect((src.match(/tx\.classSession\.updateMany\(/g) ?? []).length).toBe(2);
    expect(src).toContain("dichLoiTrungBuoi(err)");
    // Cả hai phép ghi đều CÓ điều kiện phiên bản (updatedAt) — không ghi đè lịch đã đổi sau khi duyệt.
    expect((src.match(/updatedAt: (bu|goc)\.updatedAt/g) ?? []).length).toBe(2);
  });

  it("[BGW-01] kiểm kê: số lời gọi ghi `ClassSession` trong app/ + lib/ ĐÚNG bảng; không tệp lạ nào ghi buổi", () => {
    // `--cached --others`: tệp MỚI chưa `git add` cũng phải bị quét (lưới không được mù với đúng thứ nó canh).
    const tep = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));
    expect(tep.length, "quét ra quá ít tệp — sai cwd? lưới đang không chạm tới gì").toBeGreaterThan(500);
    const thuc: Record<string, number> = {};
    for (const f of tep) {
      const n = (boChuThich(readFileSync(resolve(process.cwd(), f), "utf8")).match(GHI_BUOI) ?? []).length;
      if (n > 0) thuc[f] = n;
    }
    const mongDoi = Object.fromEntries(Object.entries(KIEM_KE).map(([f, v]) => [f, v.so]));
    expect(thuc, "bảng kiểm kê lệch — đọc chú thích trên KIEM_KE trước khi sửa bảng").toEqual(mongDoi);
    // Và SQL thô: không `UPDATE/INSERT/DELETE "ClassSession"` trong app/ + lib/.
    const tho = tep.filter((f) => /(UPDATE|INSERT INTO|DELETE FROM)\s+"ClassSession"/i.test(boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"))));
    expect(tho).toEqual([]);
  }, 60_000); // quét CẢ cây `git ls-files` — trần mặc định 5 s không đủ khi vitest chạy song song nhiều file (đo 08/10: quá hạn ở máy dev)

  it("[BGW-02] bốn đường DỜI NGÀY hàng loạt mỗi nơi gọi ĐÚNG MỘT `dichNgayBuoi(` và KHÔNG tự `classSession.update/updateMany`", () => {
    for (const f of [SYNC, SCHED]) {
      const t = ma(f);
      expect(dem(t, "dichNgayBuoi("), f).toBe(1);
      expect(t, f).not.toMatch(GHI_BUOI);
    }
    expect(dem(than(ma(LUI), "luiLichLop"), "dichNgayBuoi("), "luiLichLop").toBe(1);
    expect(than(ma(LUI), "luiLichLop"), "luiLichLop").not.toMatch(GHI_BUOI);
    expect(dem(than(ma(CLASSES), "applyClassReschedule"), "dichNgayBuoi("), "applyClassReschedule").toBe(1);
    expect(than(ma(CLASSES), "applyClassReschedule"), "applyClassReschedule").not.toMatch(GHI_BUOI);
  });

  it("[BGW-03] sinh buổi: `generate.ts` KHÔNG tự createMany; gọi đúng một `themNhieuBuoi(` và truyền cờ chỉ-khi-rỗng từ `onlyIfEmpty`", () => {
    const t = ma(GEN);
    expect(t).not.toMatch(GHI_BUOI);
    expect(dem(t, "themNhieuBuoi(")).toBe(1);
    expect(t).toContain("chiKhiRong: onlyIfEmpty");
    expect(dem(t, "ghiLoBuoi("), "hai nhánh sinh (có kế hoạch buổi / lớp cũ) cùng đi qua ghiLoBuoi").toBe(3); // 1 định nghĩa + 2 lời gọi
  });

  it("[BGW-04] ĐÚNG những đường người chỉnh tay mới đặt dấu: đổi ngày (adjust, updateSession) + tạo tay (createSession); đường hệ thống truyền null", () => {
    const adj = ma(ADJ);
    expect(dem(than(adj, "adjustSession"), "dauSuaTay("), "adjustSession đặt dấu").toBe(1);
    expect(dem(than(adj, "cancelSession"), "dauSuaTay("), "huỷ buổi KHÔNG đặt dấu").toBe(0);
    expect(than(adj, "cancelSession")).toMatch(/themBuoi\(\s*tx,\s*\{[\s\S]*?\},\s*null,\s*\)/); // buổi bù do hệ thống
    expect(than(ma(LUI), "nghiBuoiLop")).toMatch(/themBuoi\(\s*tx,\s*\{[\s\S]*?\},\s*null,[\s\S]*?\)/); // buổi nối thêm do hệ thống
    const s = ma(SESS);
    expect(dem(s, "dauSuaTay("), "updateSession").toBe(1);
    expect(dem(s, "themBuoi("), "createSession").toBe(1);
    expect(s).toContain("{ actorId: user.id, now: new Date() }");
    // Đổi phòng/GV dạy thay KHÔNG đặt dấu: nhánh không đổi ngày dùng `update` trần.
    expect(than(adj, "adjustSession")).toContain("} else {\n          await tx.classSession.update({");
  });

  it("[BGW-05] service: KHOÁ lớp trước mọi lần ĐỌC buổi; khoá bằng `$executeRaw` + hashtext theo lớp", () => {
    const t = ma(SERVICE);
    expect(t).toMatch(/\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{khoa\}\)\)`/);
    expect(t).not.toMatch(/\$queryRaw`SELECT pg_advisory_xact_lock/);
    expect(t).toContain("`lop-buoi:${classId}`");
    for (const ten of ["dichNgayBuoi", "themBuoi", "themNhieuBuoi"]) {
      const b = than(t, ten);
      expect(dem(b, "khoaLopBuoi("), ten).toBe(1);
      const doc = Math.min(...["classSession.findMany(", "classSession.findFirst("].map((x) => (b.indexOf(x) === -1 ? Infinity : b.indexOf(x))));
      expect(b.indexOf("khoaLopBuoi("), `${ten}: khoá phải đứng TRƯỚC lần đọc đầu tiên`).toBeLessThan(doc);
    }
    // Ghi có điều kiện dưới khoá: updateMany trên đúng (id, ngày cũ, SCHEDULED) và đếm kết quả.
    const dich = than(t, "dichNgayBuoi");
    expect(dich).toContain('where: { id: b.id, classId: p.classId, date: b.tu, status: "SCHEDULED" }');
    expect(dich).toContain("if (r.count !== 1)");
  });

  it("[BGW-06] mọi lời gọi `planScheduleApply(` khai ĐỦ `phamVi` + `ghiDeSuaTay` + `now`; KHÔNG nơi nào bật `ghiDeSuaTay: true` (ô ghi đè chưa mở)", () => {
    for (const f of [SYNC, SCHED, CLASSES]) {
      const t = ma(f);
      const goi = cacLoiGoi(t, "planScheduleApply(");
      expect(goi.length, f).toBeGreaterThan(0);
      for (const [i, g] of goi.entries()) {
        expect(g, `${f} #${i + 1}: thiếu phamVi`).toMatch(/\bphamVi\b\s*[,:}]/);
        expect(g, `${f} #${i + 1}: thiếu ghiDeSuaTay`).toMatch(/\bghiDeSuaTay\b\s*[,:}]/);
        expect(g, `${f} #${i + 1}: thiếu now`).toMatch(/\bnow\b\s*[,:}]/);
      }
      expect(t, f).not.toMatch(/ghiDeSuaTay:\s*true/);
    }
    // `resyncClassSessions` nhận cờ như tham số BẮT BUỘC: hai nơi gọi ở classes/_actions đều khai false.
    const resync = cacLoiGoi(ma(CLASSES), "resyncClassSessions(");
    expect(resync.length).toBe(2);
    for (const g of resync) expect(g).toMatch(/ghiDeSuaTay:\s*false/);
  });

  it("[BGW-07] buổi chỉnh tay / kỳ công đã chốt khoá CHỈ ở đường dời tự động: `findLockedSessions` KHÔNG biết `manualOverride`, `findLockedForReschedule` thì có", () => {
    const t = ma(PHASES);
    expect(than(t, "findLockedSessions")).not.toContain("manualOverride");
    const f = than(t, "findLockedForReschedule");
    expect(f).toContain("s.manualOverride && !p.ghiDeSuaTay");
    expect(f).toContain("layKyCongDaChot(");
    // ba nơi dùng bộ khoá mới
    expect(dem(than(t, "planScheduleApply"), "findLockedForReschedule("), "planScheduleApply").toBe(1);
    expect(dem(than(ma(LUI), "luiLichLop"), "findLockedForReschedule("), "luiLichLop").toBe(1);
    // Huỷ buổi / nghỉ & lùi lịch VẪN dùng bộ khoá cũ: buổi chỉnh tay huỷ được.
    expect(than(ma(ADJ), "cancelSession")).toContain("findLockedSessions(");
    expect(than(ma(ADJ), "cancelSession")).not.toContain("findLockedForReschedule(");
    expect(than(ma(LUI), "nghiBuoiLop")).not.toContain("findLockedForReschedule(");
    // Nút "Dời buổi tương lai" cũ nay dùng CHUNG bộ lập kế hoạch.
    expect(dem(than(ma(CLASSES), "computeFutureReschedule"), "planScheduleApply("), "computeFutureReschedule").toBe(1);
  });

  it("[BGW-08] lược đồ + migration: `manualOverride` NOT NULL DEFAULT false (không nullable) và chỉ mục từng phần đúng vị từ", () => {
    const s = doc("prisma/schema.prisma");
    const model = s.slice(s.indexOf("model ClassSession {"));
    const khoi = model.slice(0, model.indexOf("\n}"));
    expect(khoi).toMatch(/manualOverride\s+Boolean\s+@default\(false\)\n/);
    expect(khoi).toMatch(/manualOverrideAt\s+DateTime\?\s+@db\.Timestamptz\(6\)/);
    const sql = doc("prisma/migrations/20261007200000_lich_lop_chong_trung_buoi/migration.sql");
    expect(sql).toContain('"manualOverride"     BOOLEAN       NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_class_date_active_key"');
    expect(sql).toContain('ON "ClassSession" ("classId", "date")');
    expect(sql).toContain(`WHERE "status" <> 'CANCELLED'`);
    // Tạo chỉ mục có cổng: dữ liệu còn trùng thì BỎ QUA có thông báo chứ không làm đợt deploy chết.
    expect(sql).toContain("RAISE NOTICE");
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE|INDEX)/i); // chỉ thêm
  });

  it("[BGW-09] lỗi trùng/kế hoạch cũ được DỊCH ra câu nói được ở mọi nơi bắt lỗi (không rơi về 'Unknown' hay câu sai nguyên nhân)", () => {
    for (const [f, toiThieu] of [
      [SYNC, 1],
      [SCHED, 1],
      [CLASSES, 1],
      [ADJ, 2],
      [LUI, 2],
      [GEN, 1],
      [SESS, 2],
    ] as const) {
      expect(dem(ma(f), "dichLoiTrungBuoi("), f).toBeGreaterThanOrEqual(toiThieu);
    }
  });
});
