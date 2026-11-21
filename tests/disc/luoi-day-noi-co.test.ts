/**
 * [DISC-QA-WIRE-*] Lưới ghim DÂY NỐI cờ của nhóm «Góc gia đình» (DISC · Tủ sách · Sức khỏe) — CLAUDE.md luật 11: prop cờ
 * mặc định false mà không ai truyền = lỗi CÂM; chỉ ghim được bằng đọc mã nguồn vì thứ cần kiểm là một lời gọi/prop, không phải
 * giá trị trả về. Mọi khẳng định chạy trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa
 * đúng chuỗi đang cấm) và đếm SỐ LẦN khớp.
 *
 * 10/11/2026: ba lối vào gom thành MỘT nhóm. Trước đó lưới này canh `chenMucDisc` + `chenMucCongThongTin`; luật nó bảo vệ vẫn
 * nguyên — «thanh trên, menu điện thoại, nút nổi cùng đọc MỘT nguồn; quên truyền cờ thì mục biến mất» — chỉ đổi hình dạng mã.
 * Phần hành vi (cờ bật ⇒ có, tắt ⇒ không) nằm ở [DISC-QA-NAV-*] bên dưới, ở lib/public/goc-gia-dinh.test.ts và ở
 * components/public/floating-cta.disc.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { boChuThich, docTep, GOC_REPO } from "./_quet";
import { join } from "node:path";
import { chenNhomGoc, type MucNhom } from "../../lib/public/goc-gia-dinh";

const ma = (rel: string) => boChuThich(docTep(join(GOC_REPO, rel)));
const dem = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

describe("[DISC-QA-WIRE-01] layout public truyền ĐỦ ba cờ cho đúng HAI nơi", () => {
  const s = ma("app/(public)/layout.tsx");
  it("<Header …> và <FloatingCta …> đều nhận isDiscEnabled() VÀ congThongTin", () => {
    expect(dem(s, /<Header discEnabled=\{isDiscEnabled\(\)\} congThongTin=\{\{ tuSach: isTuSachEnabled\(\), sucKhoe: isSucKhoeEnabled\(\) \}\} \/>/g)).toBe(1);
    // Cho phép prop khác đứng sau (chatbot, 06/11/2026) — luật là "ba cờ đi từ máy chủ", không phải "thẻ chỉ có ngần ấy prop".
    expect(dem(s, /<FloatingCta discEnabled=\{isDiscEnabled\(\)\} congThongTin=\{\{ tuSach: isTuSachEnabled\(\), sucKhoe: isSucKhoeEnabled\(\) \}\}[^>]*\/>/g)).toBe(1);
  });
  it("cờ đọc ở SERVER (layout không phải 'use client')", () => {
    expect(s).not.toMatch(/^\s*["']use client["']/m);
  });
  it("không có chỗ nào render Header/FloatingCta trần (thiếu prop = mục menu biến mất)", () => {
    expect(dem(s, /<Header\s*\/>/g)).toBe(0);
    expect(dem(s, /<FloatingCta\s*\/>/g)).toBe(0);
  });
});

describe("[DISC-QA-WIRE-02] mọi nơi render Header / FloatingCta trong app phải truyền cờ — kể cả trang 404", () => {
  it("không có <Header /> hay <FloatingCta /> trần ở cây public", () => {
    const dsTep = ["app/(public)/layout.tsx", "components/public/header.tsx", "app/not-found.tsx"];
    for (const rel of dsTep) {
      const s = ma(rel);
      expect(dem(s, /<FloatingCta\s*\/>/g), `${rel}: <FloatingCta /> trần`).toBe(0);
      if (!rel.endsWith("header.tsx")) expect(dem(s, /<Header\s*\/>/g), `${rel}: <Header /> trần`).toBe(0);
    }
  });
  it("trang 404 truyền ĐỦ cờ cho cả hai (trước 10/11 nó chỉ truyền cờ DISC ⇒ «Tủ sách»/«Sức khỏe» vắng khỏi menu ở trang này)", () => {
    const s = ma("app/not-found.tsx");
    expect(dem(s, /<Header discEnabled=\{discEnabled\} congThongTin=\{congThongTin\} \/>/g)).toBe(1);
    expect(dem(s, /<FloatingCta discEnabled=\{discEnabled\} congThongTin=\{congThongTin\}[^>]*\/>/g)).toBe(1);
    expect(dem(s, /isTuSachEnabled\(\)/g)).toBe(1);
    expect(dem(s, /isSucKhoeEnabled\(\)/g)).toBe(1);
  });
});

describe("[DISC-QA-WIRE-03] Header + drawer: cùng đi qua chenNhomGoc, cờ là prop BẮT BUỘC", () => {
  const h = ma("components/public/header.tsx");
  const d = ma("components/sections/mobile-nav-drawer.tsx");
  it("Header: dựng navLinks bằng chenNhomGoc(NAV_LINKS, discEnabled, congThongTin) và RENDER navLinks (không NAV_LINKS)", () => {
    expect(dem(h, /chenNhomGoc\(\s*NAV_LINKS\s*,\s*discEnabled\s*,\s*congThongTin\s*\)/g)).toBe(1);
    expect(dem(h, /navLinks\.map\(/g)).toBe(1);
    // Render thẳng mảng gốc = bỏ qua nhóm mà không lỗi nào báo.
    expect(dem(h, /NAV_LINKS\.map\(/g)).toBe(0);
    // Mục nhóm phải được vẽ bằng NhomGocGiaDinh (không rơi vào nhánh liên kết thường với href undefined).
    expect(dem(h, /"nhom" in l\) return <NhomGocGiaDinh /g)).toBe(1);
  });
  it("Header truyền CẢ HAI cờ xuống drawer đúng MỘT lần", () => {
    expect(dem(h, /<MobileNavDrawer\s+discEnabled=\{discEnabled\}\s+congThongTin=\{congThongTin\}\s*\/>/g)).toBe(1);
    expect(dem(h, /<MobileNavDrawer\s*\/>/g)).toBe(0);
  });
  it("Drawer: dựng navItems bằng chenNhomGoc(NAV_ITEMS, discEnabled, congThongTin) và RENDER navItems (không NAV_ITEMS)", () => {
    expect(dem(d, /chenNhomGoc\(\s*NAV_ITEMS\s*,\s*discEnabled\s*,\s*congThongTin\s*\)/g)).toBe(1);
    expect(dem(d, /navItems\.map\(/g)).toBe(1);
    expect(dem(d, /NAV_ITEMS\.map\(/g)).toBe(0);
    expect(dem(d, /"nhom" in item\) return <NhomGocTrongMenu /g)).toBe(1);
  });
  it("Header: cờ là prop BẮT BUỘC (không mặc định) — quên truyền là lỗi biên dịch chứ không phải mục biến mất", () => {
    expect(h).toMatch(/export function Header\(\{ discEnabled, congThongTin \}: \{ discEnabled: boolean; congThongTin: CoCongThongTin \}\)/);
    expect(h).not.toMatch(/discEnabled\s*=\s*false/);
  });
  it("Drawer vẫn khai discEnabled mặc định false (chỉ Header mount nó; ca trên ghim Header truyền đủ)", () => {
    expect(d).toMatch(/discEnabled\s*=\s*false/);
  });
  it("không còn chèn TỪNG mục riêng: Header/Drawer không đọc DISC_NAV / TU_SACH_NAV / SUC_KHOE_NAV (đó là nguồn của hai bản trôi khỏi nhau)", () => {
    for (const [ten, s] of [["header", h], ["drawer", d]] as const) {
      expect(s, ten).not.toMatch(/DISC_NAV|TU_SACH_NAV|SUC_KHOE_NAV|chenMucDisc|chenMucCongThongTin/);
    }
  });
  it("cả hai danh sách đều còn mục 'Liên hệ' => /lien-he (điểm neo để nhóm đứng ngay trước)", () => {
    expect(h).toMatch(/label:\s*"Liên hệ",\s*href:\s*"\/lien-he"/);
    expect(d).toMatch(/label:\s*"Liên hệ",\s*href:\s*"\/lien-he"/);
  });
});

describe("[DISC-QA-WIRE-04] nút nổi: một nguồn với menu, không còn Messenger, ẩn ở /disc, cờ là prop bắt buộc", () => {
  const f = ma("components/public/floating-cta.tsx");
  const n = ma("components/public/nut-goc-gia-dinh.tsx");
  it("dựng danh sách bằng mucGocGiaDinh(discEnabled, congThongTin) và chỉ vẽ nút khi CÓ mục (goc.length > 0)", () => {
    expect(f).toMatch(/from "@\/lib\/public\/goc-gia-dinh"/);
    expect(dem(f, /mucGocGiaDinh\(\s*discEnabled\s*,\s*congThongTin\s*\)/g)).toBe(1);
    expect(dem(f, /\{goc\.length > 0 && <NutGocGiaDinh /g)).toBe(1);
  });
  it("không chép tay nhãn/đường dẫn: không DISC_NAV, không chữ 'Khám phá DISC', không viên thuốc DISC cũ", () => {
    expect(f).not.toMatch(/DISC_NAV|Khám phá DISC|disc-pill|disc-floating/);
    expect(n).not.toMatch(/Khám phá DISC|Tủ sách|Sức khỏe/); // nhãn chỉ có ở lib/disc/nav.ts + lib/cong-thong-tin/nav.ts
    expect(n).toMatch(/GOC_GIA_DINH_NHAN/);
  });
  it("nút Messenger đã gỡ (chủ dự án chốt 10/11/2026)", () => {
    expect(f).not.toMatch(/m\.me\/|Nhắn Messenger/);
  });
  it("cờ là prop BẮT BUỘC (không mặc định false) ở FloatingCta", () => {
    expect(f).toMatch(/export function FloatingCta\(\{ discEnabled, congThongTin, chatbot: duChatbot \}: \{ discEnabled: boolean; congThongTin: CoCongThongTin; chatbot: DuLieuChatbot \}\)/);
    expect(f).not.toMatch(/discEnabled\s*=\s*false/);
  });
  it("/disc nằm trong danh sách ẩn nút nổi (trang làm bài cần toàn màn hình)", () => {
    expect(f).toMatch(/HIDDEN_PREFIXES\s*=\s*\[[^\]]*"\/disc"/);
  });
  it("bảng của nút nổi và khung chat KHÔNG mở cùng lúc: mở cái nào thì đóng cái kia", () => {
    expect(dem(f, /if \(moChat\) setMoGoc\(false\)/g)).toBe(1);
    expect(dem(f, /if \(moGoc\) setMoChat\(false\)/g)).toBe(1);
  });
});

describe("[DISC-QA-NAV-*] hành vi chenNhomGoc với ĐÚNG hai danh sách thật (đối chứng dương/âm)", () => {
  // Trích mục thật từ mã nguồn để test không dựa vào bản sao tự viết.
  const trich = (rel: string, tenMang: string) => {
    const s = ma(rel);
    const kh = new RegExp(`${tenMang}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`).exec(s);
    expect(kh, `không thấy mảng ${tenMang} trong ${rel}`).toBeTruthy();
    return [...kh![1]!.matchAll(/label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)].map((m) => ({ label: m[1]!, href: m[2]! }));
  };
  const headerMuc = trich("components/public/header.tsx", "NAV_LINKS");
  const drawerMuc = trich("components/sections/mobile-nav-drawer.tsx", "NAV_ITEMS");
  const TAT_CA = { tuSach: true, sucKhoe: true };

  it("trích được mục thật (lưới không rỗng)", () => {
    expect(headerMuc.length).toBeGreaterThanOrEqual(5);
    expect(drawerMuc.length).toBeGreaterThanOrEqual(5);
  });
  it.each([
    ["header", headerMuc],
    ["drawer", drawerMuc],
  ] as const)("%s — cả ba cờ BẬT: đúng 1 mục nhóm với đủ 3 lối vào, đứng ngay trước /lien-he; thứ tự các mục khác giữ nguyên", (_t, muc) => {
    const r = chenNhomGoc(muc, true, TAT_CA);
    const nhom = r.filter((m): m is MucNhom => "nhom" in m);
    expect(nhom).toHaveLength(1);
    expect(nhom[0]!.nhom.map((m) => m.href)).toEqual(["/disc", "/tu-sach", "/suc-khoe"]);
    const i = r.findIndex((m) => "nhom" in m);
    expect((r[i + 1] as { href: string }).href).toBe("/lien-he");
    expect(r.filter((m) => !("nhom" in m)).map((m) => (m as { href: string }).href)).toEqual(muc.map((m) => m.href));
  });
  it.each([
    ["header", headerMuc],
    ["drawer", drawerMuc],
  ] as const)("%s — cả ba cờ TẮT: danh sách giữ nguyên, không có nhóm (đối chứng của ca trên)", (_t, muc) => {
    const r = chenNhomGoc(muc, false, { tuSach: false, sucKhoe: false });
    expect(r).toEqual(muc);
    expect(r.some((m) => "nhom" in m)).toBe(false);
  });
  it("chenNhomGoc không đổi mảng đầu vào (không rò trạng thái giữa hai lần render)", () => {
    const goc = [...headerMuc];
    chenNhomGoc(headerMuc, true, TAT_CA);
    expect(headerMuc).toEqual(goc);
  });
});
