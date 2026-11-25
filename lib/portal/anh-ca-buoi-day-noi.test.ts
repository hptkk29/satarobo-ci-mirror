// Lưới ghim DÂY NỐI luồng "ảnh cả buổi" [chủ dự án chốt 12/11/2026]:
// giáo viên tải ảnh cho CẢ BUỔI → QLCS duyệt tấm nào thì tấm đó tới phụ huynh cả lớp →
// tấm không duyệt bị xoá thật. Các luật này nằm ở lời gọi Prisma / R2 nên test thuần không
// chứng minh được — ghim bằng văn bản mã nguồn (mẫu "lưới ghim mã nguồn" của CLAUDE.md),
// neo vào BIỂU THỨC chứ không neo vào chỗ đặt `await`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    // bỏ chú thích để câu giải thích bản vá không tự khớp mẫu cần đếm (luật 11)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DUYET = "app/(admin)/admin/duyet-media/_actions.ts";
const MEDIA = "app/(admin)/admin/media/actions.ts";

describe("[ACB] ảnh cả buổi — dây nối", () => {
  it("[ACB-01] duyệt ⇒ ảnh CHƯA gắn thẻ thành chung cả lớp; ảnh ĐÃ gắn thẻ giữ phạm vi cũ", () => {
    const s = doc(DUYET);
    // Đúng MỘT lệnh bật cờ, và nó chỉ áp cho tấm không có thẻ nào.
    expect((s.match(/isClassWide:\s*true/g) ?? []).length).toBe(1);
    expect(s).toMatch(/tags:\s*\{\s*none:\s*\{\}\s*\}[\s\S]{0,120}isClassWide:\s*true/);
    // Nhánh có thẻ chỉ đổi trạng thái, không đụng cờ (nới ra là lộ ảnh của một bé cho cả lớp).
    expect(s).toMatch(/tags:\s*\{\s*some:\s*\{\}\s*\}[\s\S]{0,80}data:\s*\{\s*status:\s*"APPROVED"\s*\}/);
  });

  it("[ACB-02] loại ảnh ⇒ xoá R2 TRƯỚC rồi mới ghi DB, không còn 'xoá mềm 7 ngày'", () => {
    const s = doc(DUYET);
    expect(s).toContain("purgeMediaFilesThen(");
    expect(s).toContain('status: "PURGED"');
    expect(s).toContain("classSessionMedia.deleteMany");
    // Không còn đường ghi REJECTED cho tấm mới + không còn hạn dọn 7 ngày.
    const loai = s.slice(
      s.indexOf("export async function rejectMediaAction"),
      s.indexOf("export async function restoreMediaAction"),
    );
    expect(loai.length).toBeGreaterThan(200);
    expect(loai).not.toMatch(/status:\s*"REJECTED"/);
    expect(s).not.toContain("PURGE_AFTER_DAYS");
  });

  it("[ACB-03] QLCS tự tải (autoApprove) ⇒ ảnh chung cả lớp NGAY và hàng duyệt mới khớp", () => {
    const s = doc(MEDIA);
    expect(s).toMatch(/approvedAt:\s*new Date\(\),\s*isClassWide:\s*true/);
    expect(s).toMatch(/mediaAsset\.updateMany\(\{[\s\S]{0,160}legacyMediaId:\s*\{\s*in:\s*created\.ids\s*\}/);
  });

  it("[ACB-04] đã GỠ hẳn đường 'Chọn ảnh' từng học viên (nút, hộp thoại, hai action)", () => {
    const media = doc(MEDIA);
    expect(media).not.toContain("toggleMediaStudentTagAction");
    expect(media).not.toContain("getSessionPhotoPicker");
    const hub = doc("app/(teacher)/teacher/lop/_components/hub-reviews-tab.tsx");
    expect(hub).not.toContain("PickSessionPhotoDialog");
  });

  it("[ACB-05] 'Góc sản phẩm': buổi mới nhất KHÔNG vẽ lặp ở danh sách các buổi trước", () => {
    const s = doc("components/portal/san-pham-page.tsx");
    expect(s).not.toContain("[moiNhat, ...con].map");
    expect(s).toMatch(/\{con\.map\(\(g\) =>/);
    // Nút slideshow có ở cả thẻ lớn lẫn thẻ từng buổi.
    expect((s.match(/<NutXemAnhBuoi/g) ?? []).length).toBe(2);
  });
});
