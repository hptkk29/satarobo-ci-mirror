// @vitest-environment node
/**
 * [B11-W] B-11 — lưới GHIM DÂY NỐI (mã nguồn). Test hành vi của từng cổng đều gọi thẳng `kiemBaiTrongBan`, nên gỡ lời gọi khỏi MỘT trong
 * năm cổng bài / quên ghim phiên bản ở một đường tạo lượt học là KHÔNG ca hành vi nào đỏ — lưới này canh đúng chỗ đó.
 * Neo vào LỜI GỌI (đã bỏ chú thích) chứ không vào dòng import, và đếm SỐ LẦN khớp.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function duyet(dir: string, ra: string[] = []): string[] {
  for (const t of readdirSync(dir)) {
    const f = join(dir, t);
    if (statSync(f).isDirectory()) duyet(f, ra);
    else if (/\.(ts|tsx)$/.test(t) && !/\.test\./.test(t)) ra.push(f);
  }
  return ra;
}

describe("[B11-W] dây nối B-11", () => {
  const CONG = [
    "lib/elearning/exam-taking.ts",
    "lib/elearning/reading-progress.ts",
    "lib/elearning/video-heartbeat.ts",
    "lib/elearning/task-submit.ts",
    "app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx",
  ];
  for (const f of CONG) {
    it(`[B11-W1] ${f}: có ĐÚNG MỘT lời gọi kiemBaiTrongBan(db, …) và đọc courseVersionId của lượt học`, () => {
      const s = doc(f);
      expect(s.match(/kiemBaiTrongBan\(db,/g)?.length).toBe(1);
      expect(s).toMatch(/courseVersionId: true/);
      // đứng SAU cổng nội dung, không trước: cổng 4 điều kiện phải chạy trước để không lộ sự tồn tại của khoá.
      expect(s.indexOf("kiemBaiTrongBan(db,")).toBeGreaterThan(s.indexOf("checkContentAccess("));
    });
  }

  it("[B11-W2] MỌI chỗ tạo TrnEnrollment trong lib/ đều ghim courseVersionId (trừ bộ dựng hàng, nơi nó là trường BẮT BUỘC của kiểu)", () => {
    const loi: string[] = [];
    for (const f of duyet(resolve(process.cwd(), "lib"))) {
      const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const re = /trnEnrollment\.(create|createMany)\(\{([\s\S]*?)\n\s*\}\);?/g;
      for (const m of s.matchAll(re)) {
        const than = m[2] ?? "";
        const coGhim = /courseVersionId/.test(than);
        // `createMany` nhận hàng từ `dungHangGhiDanh` (kiểu `HangGhiDanh.courseVersionId` bắt buộc ⇒ tsc chặn quên).
        const tuBoDung = /data:\s*(dungDon|rows)\.map/.test(than);
        if (!coGhim && !tuBoDung) loi.push(f.replace(process.cwd(), ""));
      }
    }
    expect(loi).toEqual([]);
  });

  it("[B11-W3] bộ dựng hàng ghi danh có courseVersionId là trường BẮT BUỘC của kiểu (không `?`)", () => {
    const s = doc("lib/elearning/enrollment-rows.ts");
    expect(s).toMatch(/courseVersionId: string \| null;/);
    expect(s).toMatch(/banTheoKhoa: Record<string, string \| null>;/);
  });

  it("[B11-W4] rollup và đề cương người học đọc phiên bản qua banCuaLuot (không còn đếm theo bản PUBLISHED mới nhất)", () => {
    expect(doc("lib/elearning/rollup.ts")).toMatch(/banCuaLuot\(db,/);
    expect(doc("lib/elearning/course-view.ts")).toMatch(/banCuaLuot\(db,/);
    expect(doc("lib/elearning/course-view.ts")).not.toMatch(/where: \{ courseId: khoa\.id, status: "PUBLISHED" \}/);
  });

  /**
   * [B11-W5] CỔNG GHI DUY NHẤT: mọi phép ghi lên `TrnLesson` / `TrnLessonCue` trong mã chạy (lib/ + app/) phải nằm trong tệp được cho phép, và tệp ghi NỘI DUNG phải
   * gọi `layBaiDeGhi` đúng số lần đã biết. Thêm một đường ghi bài mới mà quên cổng này ⇒ người đang học bản đã xuất bản bị đổi nội dung dưới chân — không ca hành vi nào
   * đỏ vì mỗi test hành vi chỉ gọi đường nó biết. `taoBai`/`nhanBanKhoa` chỉ TẠO bài mới (thuộc bản nháp), không sửa bài đã khoá.
   */
  const GHI = /(?:trnLesson|trnLessonCue)\.(?:update|updateMany|create|createMany|delete|deleteMany|upsert)\(/g;
  const CHO_PHEP: Record<string, { ghi: number; cong: number | null }> = {
    // fork (create) + ghiBaiDoc (update) + sao chép câu hỏi (createMany) — định nghĩa và gọi cổng.
    "lib/elearning/sao-chep-khi-ghi.ts": { ghi: 3, cong: 2 },
    // taoBai + nhanBanKhoa: chỉ TẠO bài mới (bản nháp / khoá mới).
    "lib/elearning/course-authoring.ts": { ghi: 2, cong: null },
    "lib/elearning/lesson-cue-authoring.ts": { ghi: 4, cong: 2 },
    "lib/elearning/exam-authoring.ts": { ghi: 1, cong: 1 },
    "lib/elearning/rubric-authoring.ts": { ghi: 1, cong: 1 },
    "lib/elearning/video-doi-nguon.ts": { ghi: 2, cong: 1 },
  };
  it("[B11-W5] mọi phép ghi TrnLesson/TrnLessonCue nằm trong tệp cho phép và đi qua layBaiDeGhi đúng số lần", () => {
    const thua: string[] = [];
    for (const dir of ["lib", "app"]) {
      for (const f of duyet(resolve(process.cwd(), dir))) {
        const rel = relative(process.cwd(), f).split(sep).join("/");
        const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        const ghi = s.match(GHI)?.length ?? 0;
        if (ghi === 0) continue;
        const cp = CHO_PHEP[rel];
        if (!cp) {
          thua.push(`${rel}: ${ghi} phép ghi ngoài danh sách`);
          continue;
        }
        if (ghi !== cp.ghi) thua.push(`${rel}: ${ghi} phép ghi, mong ${cp.ghi}`);
        const cong = s.match(/layBaiDeGhi\(/g)?.length ?? 0;
        if (cp.cong !== null && cong !== cp.cong) thua.push(`${rel}: ${cong} lời gọi layBaiDeGhi, mong ${cp.cong}`);
      }
    }
    expect(thua).toEqual([]);
  });

  it("[B11-W6] đường soạn bài ĐỌC đi qua ghiBaiDoc (không còn ghi trực tiếp trong action)", () => {
    const s = doc("app/(elearning)/elearning/soan/_actions.ts");
    expect(s.match(/ghiBaiDoc\(db,/g)?.length).toBe(1);
    expect(s).not.toMatch(/trnLesson\.update/);
  });

  it("[B11-W7] mọi `trnLesson.update` sau cổng ghi nhắm vào id bài cổng TRẢ VỀ (g.lessonId), không phải id client gửi lên", () => {
    for (const f of [
      "lib/elearning/sao-chep-khi-ghi.ts",
      "lib/elearning/exam-authoring.ts",
      "lib/elearning/rubric-authoring.ts",
      "lib/elearning/lesson-cue-authoring.ts",
    ]) {
      const s = doc(f);
      const dich = [...s.matchAll(/trnLesson\.update\(\{\s*where:\s*\{\s*id:\s*([^}\s,]+)/g)].map((m) => m[1]);
      expect(dich.length, f).toBeGreaterThan(0);
      expect(dich.every((x) => x === "g.lessonId"), `${f}: ${dich.join(", ")}`).toBe(true);
    }
    // Đổi nguồn video: dòng bài được khoá + ghi là dòng của `dich` (id cổng trả về).
    const v = doc("lib/elearning/video-doi-nguon.ts");
    expect(v).toMatch(/"id" = \$\{dich\.lessonId\} AND "deletedAt" IS NULL FOR UPDATE/);
  });

  it("[B11-W8] không mã chạy nào (lib/ + app/) tắt cổng tách bản của đổi nguồn video bằng `tachBan: false` — nó chỉ dành cho test bộ máy chụp/đặt lại", () => {
    const loi: string[] = [];
    for (const dir of ["lib", "app"]) {
      for (const f of duyet(resolve(process.cwd(), dir))) {
        const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (/tachBan:\s*false/.test(s)) loi.push(relative(process.cwd(), f));
      }
    }
    // Định nghĩa của tham số nằm trong video-doi-nguon.ts (`i.tachBan === false`) — không khớp mẫu `tachBan: false`.
    expect(loi).toEqual([]);
  });

  it("[B11-W9] trang soạn bài tính cờ báo trước bằng CHÍNH `daKhoaBai` (hàm cổng ghi dùng); khung của loại bài CÓ nút Lưu nhận cờ đó, khung KHÔNG có nút Lưu (điểm danh · loại chưa có trình soạn) truyền `false`", () => {
    const s = doc("app/(elearning)/elearning/soan/[lessonId]/page.tsx");
    expect(s.match(/await daKhoaBai\(db, lesson\.id\)/g) ?? []).toHaveLength(1);
    const dung = s.match(/<KhungSoan\s/g)?.length ?? 0;
    const theoCong = s.match(/<KhungSoan\s+seTachBan=\{seTachBan\}/g)?.length ?? 0;
    const khongCoLuu = s.match(/<KhungSoan\s+seTachBan=\{false\}/g)?.length ?? 0;
    // VIDEO · QUIZ · TASK · READ đi qua cổng ghi; LIVE_SESSION (điểm danh) + loại chưa có trình soạn thì không.
    // VIDEO · QUIZ · TASK dùng KhungSoan (có cờ); bài ĐỌC tự xếp đầu trang trong LessonEditor nên nhận cờ ở prop của nó.
    expect(dung).toBe(5);
    expect(theoCong).toBe(3);
    expect(khongCoLuu).toBe(2);
    expect(s.match(/<LessonEditor[^>]*seTachBan=\{seTachBan\}/g) ?? []).toHaveLength(1);
    expect(s.match(/<BaoTruocTachBan seTachBan=\{seTachBan\} \/>/g) ?? []).toHaveLength(1);
  });

  it("[B11-W10] hai đường người học từng đọc CÂY SỐNG nay đọc theo phiên bản đã ghim: khung trình học truyền courseVersionId; ghiXongBaiThi lọc theo bản; cron đối soát chọn bài bằng chonBaiCuaDeTrongBan", () => {
    const trang = doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx");
    expect(trang.match(/napCayBaiHoc\(db, \{[^}]*courseVersionId: enrollment\.courseVersionId/g) ?? []).toHaveLength(1);
    const cay = doc("lib/elearning/lesson-tree.ts");
    expect(cay.match(/docCayTheoBan\(db, ban\.versionId\)/g) ?? []).toHaveLength(1);
    const thi = doc("lib/elearning/exam-taking.ts");
    expect(thi.match(/versionLessons: \{ some: \{ versionId: ban\.versionId \} \}/g) ?? []).toHaveLength(1);
    const cron = doc("lib/elearning/cron-dong-luot-thi.ts");
    expect(cron.match(/chonBaiCuaDeTrongBan\(/g) ?? []).toHaveLength(1);
    expect(cron).not.toMatch(/baiThi\.find\(/);
  });

  it("[B11-W11] báo cáo xem video liệt kê bài qua nhomDongDoiBai (bản tách ngay dưới bài gốc, có nhãn) và vẽ nhãn đó, không còn vẽ `b.title` trần", () => {
    const s = doc("app/(elearning)/elearning/bao-cao/video/page.tsx");
    expect(s.match(/nhomDongDoiBai\(/g) ?? []).toHaveLength(1);
    expect(s).toMatch(/dsBaiHienThi\.map\(/);
    expect(s).toMatch(/\{b\.nhan\}/);
    expect(s).not.toMatch(/\{b\.title\}/);
  });
});
