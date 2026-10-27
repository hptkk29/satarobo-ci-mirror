// components/admin/sidebar-bao-luu-flag.test.ts — LƯỚI GHIM MÃ NGUỒN: mục sidebar "Bảo lưu" phải ẨN khi cờ `pause.enabled` TẮT.
// Khuôn: CLAUDE.md mục "Mẫu test: LƯỚI GHIM MÃ NGUỒN". Bổ trợ `sidebar-flag-wiring.test.ts` (`[SB-FLAG]`) — lưới đó ghim DÂY NỐI của mọi cờ,
// lưới này ghim hai thứ nó không biết: (1) mục này CÓ khai `flag`, (2) layout hỏi ĐÚNG câu hỏi mà trang `/bao-luu` tự hỏi.
//
// 🔴 VÌ SAO — nghiệm thu bảo lưu trên test 11/10/2026, ô A1: cờ TẮT ở mọi cơ sở mà Sale/QLCS vẫn thấy mục "Bảo lưu" ở sidebar (và bấm vào ra trang "chưa
// được bật"). Trước bản vá mục này không khai `flag:` ("sidebar không biết cơ sở nào đang xem" — TODO Q-nav-flag). Promote `test → main` với cờ TẮT ⇒ prod
// thêm một mục menu cho mọi vai có `bao-luu:view`, trái chốt "cờ tắt ⇒ không có gì mới" của chính module.
//
// ⚠️ Luật 11: đếm số lần khớp, neo hẹp, bỏ chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang cấm — đã vấp ở `[NDC-07]`, `[DST-01]`).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
// Chỉ bỏ dòng chú thích `//` đứng riêng một dòng. KHÔNG bỏ khối `/* … */`: chuỗi như "/api/*" mở một "khối" giả và nuốt cả mã
// tới `*/` kế tiếp (đo ở lượt viết lưới này — `coNoiNaoBatBaoLuu(` biến mất khỏi mã đã lọc).
const boChuThich = (s: string) => s.replace(/^[ \t]*\/\/.*$/gm, "");

const SIDEBAR = boChuThich(doc("components/admin/sidebar.tsx"));
const LAYOUT = boChuThich(doc("app/(admin)/admin/layout.tsx"));
const TRANG = boChuThich(doc("app/(admin)/admin/bao-luu/page.tsx"));

describe("[SBL] mục sidebar Bảo lưu ẩn khi cờ pause.enabled TẮT", () => {
  it('[SBL-01] mục href "/bao-luu" khai `flag: "baoLuu"`, và đúng MỘT mục như vậy', () => {
    const muc = [...SIDEBAR.matchAll(/\{[^{}]*href:\s*"\/bao-luu"[^{}]*\}/g)].map((m) => m[0]);
    expect(muc).toHaveLength(1);
    expect(muc[0]).toMatch(/flag:\s*"baoLuu"/);
  });

  it("[SBL-02] sidebar lọc mục baoLuu theo prop `baoLuuEnabled` (mặc định TẮT)", () => {
    expect(SIDEBAR.match(/it\.flag\s*===\s*"baoLuu"\s*&&\s*baoLuuEnabled/g) ?? []).toHaveLength(1);
    expect(SIDEBAR.match(/baoLuuEnabled\s*=\s*false/g) ?? []).toHaveLength(1);
  });

  it("[SBL-03] menu, trang /bao-luu và đường ký URL tải tệp hỏi CÙNG MỘT biểu thức `visibleOrgUnitIds` (không còn nhánh Hội sở riêng), đọc hỏng ⇒ ẨN", () => {
    const goi = LAYOUT.match(/coNoiNaoBatBaoLuu\(([^;]*?)\)\.catch\(\(\)\s*=>\s*false\)/g) ?? [];
    expect(goi).toHaveLength(1); // fail-closed: `.catch(() => false)`, không phải `true`
    expect(goi[0]).toMatch(/coNoiNaoBatBaoLuu\(menuActor\?\.visibleOrgUnitIds\s*\?\?\s*\[\]\)/);
    // Chốt 11/10: cấp Hội sở thấy menu khi cờ bật ở ÍT NHẤT MỘT cơ sở ⇒ `buildActor` đã cho HO/ROOT thấy MỌI đơn vị, nên KHÔNG được còn `isHoLevel ? [] : …`
    // (nhánh đó đọc cờ TOÀN HỆ và giấu menu đúng lúc thí điểm một cơ sở). Ba nơi cùng biểu thức — menu hiện mà trang báo "chưa bật" là lời hứa suông (luật 12).
    const trang = TRANG.match(/coNoiNaoBatBaoLuu\([^)]*\)\)?/g) ?? [];
    expect(trang).toHaveLength(1);
    expect(trang[0]).toMatch(/coNoiNaoBatBaoLuu\(actor\.visibleOrgUnitIds\s*\?\?\s*\[\]\)/);
    const upload = boChuThich(doc("app/api/admin/bao-luu/tep/upload-url/route.ts")).match(/coNoiNaoBatBaoLuu\([^)]*\)\)?/g) ?? [];
    expect(upload).toHaveLength(1);
    expect(upload[0]).toMatch(/coNoiNaoBatBaoLuu\(actor\.visibleOrgUnitIds\s*\?\?\s*\[\]\)/);
    for (const nguon of [goi[0], trang[0], upload[0]]) expect(nguon).not.toMatch(/isHoLevel/);
  });

  it("[SBL-04] layout truyền `baoLuuEnabled` xuống AdminShell", () => {
    expect(LAYOUT.match(/baoLuuEnabled=\{baoLuuEnabled\}/g) ?? []).toHaveLength(1);
  });
});
