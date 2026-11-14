// @vitest-environment node
/**
 * Bài video dùng LINK YOUTUBE — canh DÂY NỐI mà test hành vi không với tới.
 *
 * Mỗi mục dưới đây là một chỗ mà quên một dòng thì KHÔNG lỗi biên dịch, KHÔNG ca hành vi nào
 * đỏ, và triệu chứng nằm xa chỗ sai:
 *  · quên `select` cột ở trang học ⇒ mọi bài YouTube hiện "Bài này chưa có video";
 *  · quên chép cột khi nhân bản khoá ⇒ bản sao có bài video RỖNG;
 *  · quên cột ở màn soạn ⇒ ô dán link luôn hiện như chưa gắn gì;
 *  · máy chủ ghi nhịp xem bắt đầu đọc `videoKey` ⇒ % của bài YouTube về 0 mà không ai thấy.
 *
 * Neo vào BIỂU THỨC (đã bỏ chú thích), không neo vào chỗ đặt dòng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Bỏ chú thích dòng và chú thích khối — chú thích giải thích bản vá thường chứa đúng chuỗi đang cấm. */
const chiMa = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");

const dem = (src: string, re: RegExp) => (src.match(re) ?? []).length;

const TRANG_HOC = chiMa(doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx"));
const TRANG_SOAN = chiMa(doc("app/(elearning)/elearning/soan/[lessonId]/page.tsx"));
const AUTHORING = chiMa(doc("lib/elearning/course-authoring.ts"));
const HEARTBEAT = chiMa(doc("lib/elearning/video-heartbeat.ts"));
const NEXT_CONFIG = doc("next.config.ts");
const SCHEMA = doc("prisma/schema.prisma");
const MIGRATION = doc("prisma/migrations/20261107090000_bai_video_nguon_youtube/migration.sql");

describe("[YTW-01] trang HỌC đọc và truyền nguồn YouTube", () => {
  it("select `youtubeId` của bài", () => {
    expect(dem(TRANG_HOC, /youtubeId: true/g)).toBe(1);
  });

  it("truyền `youtubeId` cho trình phát", () => {
    expect(dem(TRANG_HOC, /youtubeId=\{lesson\.youtubeId\}/g)).toBe(1);
  });

  it("bài chỉ bị coi là 'chưa có video' khi thiếu CẢ tệp lẫn link", () => {
    expect(TRANG_HOC).toMatch(/!lesson\.videoKey && !lesson\.youtubeId/);
  });

  it("nguồn YouTube thắng nếu dữ liệu lỡ mang cả hai (không phát hai nguồn)", () => {
    expect(TRANG_HOC).toMatch(/videoKey=\{lesson\.youtubeId \? null : lesson\.videoKey\}/);
  });
});

describe("[YTW-02] trang SOẠN đọc và truyền nguồn YouTube cho ô dán link", () => {
  it("select cả hai cột", () => {
    expect(dem(TRANG_SOAN, /youtubeId: true/g)).toBe(1);
    expect(dem(TRANG_SOAN, /youtubePhuDe: true/g)).toBe(1);
  });

  it("render ô dán link và truyền đủ trạng thái hiện có", () => {
    expect(dem(TRANG_SOAN, /<YoutubeLinkForm/g)).toBe(1);
    expect(TRANG_SOAN).toMatch(/youtubeIdHienCo=\{lesson\.youtubeId\}/);
    expect(TRANG_SOAN).toMatch(/coPhuDeHienCo=\{lesson\.youtubePhuDe\}/);
  });

  it("'đang có tệp' tính từ videoKey, để cảnh báo thay thế đúng chỗ", () => {
    expect(TRANG_SOAN).toMatch(/coTepHienCo=\{Boolean\(lesson\.videoKey\)\}/);
  });
});

describe("[YTW-03] course-authoring: đọc cho cổng phụ đề VÀ chép khi nhân bản khoá", () => {
  // Mỗi cột xuất hiện đúng 2 lần ở `select` (đọc dàn bài + nhân bản) và 2 lần ở chỗ ghi
  // (dựng đối tượng trả về + `create` của bản sao). Thiếu một ⇒ số đếm lệch.
  it("`select` hai cột ở HAI nơi", () => {
    expect(dem(AUTHORING, /youtubeId: true/g)).toBe(2);
    expect(dem(AUTHORING, /youtubePhuDe: true/g)).toBe(2);
  });

  it("chép hai cột ở HAI nơi (dàn bài → cổng, nhân bản → bản sao)", () => {
    expect(dem(AUTHORING, /youtubeId: b\.youtubeId/g)).toBe(2);
    expect(dem(AUTHORING, /youtubePhuDe: b\.youtubePhuDe/g)).toBe(2);
  });
});

describe("[VID-W1] cổng xuất bản `BAI_VIDEO_CHUA_CO_NGUON` được cho ăn đủ cột", () => {
  // Cổng đọc `videoKey` + `durationSec` (cùng `youtubeId`). Mỗi cột có đúng 2 chỗ `select`
  // (đọc dàn bài → cổng, nhân bản khoá) và 2 chỗ chép. Quên `select` ở đường dàn bài thì mock
  // của test hành vi vẫn xanh (mock không áp `select`) mà cổng nổ OAN trên mọi bài video.
  it("`select` `videoKey` và `durationSec` ở HAI nơi", () => {
    expect(dem(AUTHORING, /videoKey: true/g)).toBe(2);
    expect(dem(AUTHORING, /durationSec: true/g)).toBe(2);
  });

  it("chép hai cột ở HAI nơi (dàn bài → cổng, nhân bản → bản sao)", () => {
    expect(dem(AUTHORING, /videoKey: b\.videoKey/g)).toBe(2);
    expect(dem(AUTHORING, /durationSec: b\.durationSec/g)).toBe(2);
  });

  it("cả hai chỗ gọi `kiemDanBai` (xuất bản + màn soạn) đọc dàn bài qua `docDanBai`", () => {
    expect(dem(AUTHORING, /kiemDanBai\(/g)).toBe(2);
    expect(dem(AUTHORING, /await docDanBai\(/g)).toBe(2);
  });
});

describe("[YTW-04] ghi nhịp xem KHÔNG biết nguồn video", () => {
  it("🔴 `video-heartbeat.ts` không đọc `videoKey` hay `youtubeId`", () => {
    // % xem tính trên `durationSec` + bitmap vị trí. Đọc nguồn ở đây là mở đường cho một nguồn
    // được đo khác nguồn kia — và báo cáo tuân thủ đứng lên con số đó.
    expect(HEARTBEAT).not.toMatch(/videoKey|youtubeId/);
  });
});

describe("[YTW-05] cột mới: schema ↔ migration ↔ CSP", () => {
  it("schema khai hai cột trong TrnLesson", () => {
    const model = SCHEMA.slice(SCHEMA.indexOf("model TrnLesson {"));
    const hetModel = model.slice(0, model.indexOf("\n}"));
    expect(hetModel).toMatch(/youtubeId\s+String\?/);
    expect(hetModel).toMatch(/youtubePhuDe\s+Boolean\s+@default\(false\)/);
  });

  it("migration chỉ THÊM cột, chạy lại được, không đụng cột có sẵn", () => {
    const sql = chiMa(MIGRATION.replace(/^--.*$/gm, ""));
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "youtubeId" TEXT;/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "youtubePhuDe" BOOLEAN NOT NULL DEFAULT false;/);
    expect(sql).not.toMatch(/DROP|ALTER COLUMN|RENAME|UPDATE|DELETE/i);
  });

  it("CSP cho phép nạp `iframe_api` và nhúng youtube-nocookie", () => {
    const script = NEXT_CONFIG.match(/"script-src[^"]*"/)?.[0] ?? "";
    const frame = NEXT_CONFIG.match(/"frame-src[^"]*"/)?.[0] ?? "";
    expect(script).toContain("https://www.youtube.com");
    expect(frame).toContain("https://www.youtube-nocookie.com");
  });
});
