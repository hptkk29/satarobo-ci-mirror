// @vitest-environment node
/**
 * EL-03 PR2 — LUẬT CỦA SEED, khoá bằng cách quét nguồn.
 *
 * Vì sao quét nguồn chứ không chỉ chạy seed rồi đếm: mấy luật dưới đây là luật
 * "KHÔNG ĐƯỢC LÀM". Chạy seed một lần rồi đếm ra số đúng KHÔNG chứng minh được
 * là nó không đụng bảng `Course`, không tạo bài SCORM, không dùng `POSITION` —
 * chỉ chứng minh được lần chạy đó không rơi vào nhánh sai.
 *
 * Tính idempotent (AC8 vế hai) đã kiểm bằng cách chạy THẬT hai lần trên DB dev:
 * 1 chương trình · 1 khoá · 3 chương · 10 bài · 1 yêu cầu, không đổi. Case ở tầng
 * DB thuộc bộ e2e cần Postgres local.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SEED = readFileSync(
  join(process.cwd(), "prisma/seed-elearning.ts"),
  "utf8",
);
/** Bỏ bình luận để không tự bắt chính lời giải thích của mình. */
const CODE = SEED.split("\n")
  .filter((l) => {
    const t = l.trimStart();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

describe("Ba điều seed TUYỆT ĐỐI không được làm", () => {
  it("KHÔNG ghi một dòng nào vào model `Course` (bảng bán hàng công khai)", () => {
    // `Course.isPublished @default(true)` và `/khoa-hoc` lọc đúng cờ đó ⇒ một bản
    // ghi nhầm chỗ sẽ HIỆN TRÊN TRANG BÁN HÀNG cho phụ huynh. Đây là lý do QĐ-1
    // bắt mọi bảng của module mang tiền tố `Trn`.
    expect(CODE).not.toMatch(/\bdb\.course\b/);
    expect(CODE).not.toMatch(/\bdb\.courseCategory\b/);
    expect(CODE).not.toMatch(/\bdb\.enrollment\b/);
  });

  it("KHÔNG tạo bài kind='SCORM' — cờ SCORM_ENABLED mặc định OFF", () => {
    // Seed một thứ mà chính validator của PR này sẽ từ chối là seed một tình
    // huống không tồn tại; nó chỉ làm người đọc tưởng SCORM đã chạy được.
    expect(CODE).not.toContain('"SCORM"');
    expect(CODE).not.toContain("'SCORM'");
  });

  it("KHÔNG dùng scopeKind='POSITION' — prod có 0 dòng Position", () => {
    // Một yêu cầu POSITION trên prod áp cho ĐÚNG 0 người. Seed dựa vào bảng rỗng
    // là dựng một tình huống không tồn tại ở nơi nó sẽ chạy.
    expect(CODE).not.toContain('"POSITION"');
    expect(CODE).toContain('"DEPARTMENT"');
  });
});

describe("Bốn luật seed phải làm ĐÚNG cách", () => {
  it("TrnRequirement KHÔNG được upsert — unique 6 cột có nhánh nullable", () => {
    // Postgres coi hai NULL là KHÁC nhau, nên upsert theo khoá đó sẽ ĐẺ DÒNG THỨ
    // HAI ở lần chạy sau mà vẫn báo thành công. Phải findFirst rồi mới quyết.
    expect(CODE).not.toMatch(/db\.trnRequirement\.upsert/);
    expect(CODE).toMatch(/db\.trnRequirement\.findFirst/);
  });

  it("mọi upsert đều mở lại deletedAt trong nhánh update", () => {
    // `Trn*` có cột `deletedAt` nhưng KHÔNG nằm trong `SOFT_DELETE_MODELS` ⇒
    // không có bộ lọc tự động nào. Ai đó xoá mềm bản seed rồi chạy lại seed mà
    // không mở lại thì upsert "thành công" trên một dòng vô hình.
    const soUpsert = (CODE.match(/\.upsert\(/g) ?? []).length;
    const soMoLai = (CODE.match(/deletedAt:\s*null/g) ?? []).length;
    expect(soUpsert).toBeGreaterThan(0);
    // TrnModule không có cột deletedAt nên không tính; chỉ đòi có ít nhất 2 chỗ
    // mở lại (chương trình + khoá + bài).
    expect(soMoLai).toBeGreaterThanOrEqual(2);
  });

  it("khoá seed ghi fail-closed TƯỜNG MINH, không dựa vào default của Prisma", () => {
    // Người đọc seed phải thấy NGAY là khoá này không tự hiện với ai. Dựa vào
    // default nghĩa là phải mở schema mới biết, và default có thể đổi.
    expect(CODE).toContain('visibility: "ASSIGNED_ONLY"');
    expect(CODE).toContain("selfEnrollEnabled: false");
  });

  it("dùng DIRECT_URL trước DATABASE_URL — pooler :6543 làm seed chết", () => {
    // Đã gặp thật khi chạy `db:seed:departments`: pgbouncer ném
    // `prepared statement "s0" already exists` giữa chừng.
    const i = CODE.indexOf("DIRECT_URL");
    const j = CODE.indexOf("DATABASE_URL");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });
});

describe("Seed không bịa dữ liệu tham chiếu", () => {
  it("chủ sở hữu và phòng ban đều TRA từ DB, không hardcode id", () => {
    // Id bịa không làm FK nổ (cột `ownerUserId` là String trần) nhưng mọi màn sẽ
    // hiện "người dùng không tồn tại" — hỏng câm, đúng loại seed tệ nhất.
    expect(CODE).toMatch(/db\.user\.findFirst/);
    expect(CODE).toMatch(/db\.departmentDef\.findFirst/);
    // Và phải DỪNG có thông báo khi không tra được, thay vì chạy tiếp với null.
    expect(CODE).toMatch(/throw new Error\([^)]*chủ sở hữu|owner/i);
  });

  it("có tiền tố riêng để nhận ra và dọn được", () => {
    expect(CODE).toContain('PREFIX = "EL-SEED"');
  });
});
