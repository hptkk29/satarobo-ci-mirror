// [HN2-MP-W*] — LƯỚI GHIM DÂY NỐI của Việc 2: khai máy POS dời từ Cấu hình vận hành về màn Cơ sở
// (docs/pos-hai-nut-khai-may.md §2). THUẦN: đọc mã nguồn.
//
// Thứ cần khoá KHÔNG phải một giá trị trả về mà là HÌNH DẠNG của dây nối — loại luật mà test hành vi không chứng minh được:
//   · "mục máy POS có mặt trong trang cơ sở, đúng chỗ, qua loader gác HAI lớp" — gỡ lời gọi `docMucMayPos` thì không ca hành vi nào đỏ;
//   · "tab Máy POS không còn ở Cấu hình vận hành" + "không còn chuỗi `tab=may-pos`" — quên một link là một lối đi chết;
//   · "redirect `?tab=may-pos` đứng TRƯỚC cổng tab" — đặt sau cổng thì Kế toán HO (không còn tab nào) bị đá về dashboard;
//   · "prop mới của trang đơn truyền đủ hai bậc và BẮT BUỘC" (luật 11).
//
// Luật 11: neo vào BIỂU THỨC chứ không neo cách viết; bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi
// đang tìm); đếm SỐ LẦN khớp. Mọi ca đã được CẤY LẠI lỗi (luật 14) — xem docs/pos-hai-nut-khai-may.md §2.7.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  QUYEN_TAB,
  TAB_CAU_HINH,
  TAB_TU_QUAN_QUYEN_GHI,
  duongTabDaDoi,
} from "@/lib/settings/nhan-van-hanh";

const GOC = process.cwd();
const docTho = (p: string) => readFileSync(resolve(GOC, p), "utf8");

function bocChuThich(v: string): string {
  return v
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
    .join("\n");
}
const ma = (p: string) => bocChuThich(docTho(p));
const dem = (src: string, re: RegExp) => [...src.matchAll(new RegExp(re.source, "g"))].length;

const TRANG_CO_SO = "app/(admin)/admin/centers/[id]/edit/page.tsx";
const FORM_CO_SO = "app/(admin)/admin/centers/_components/center-form.tsx";
const MUC = "app/(admin)/admin/centers/_components/muc-may-pos.tsx";
const ACTION = "app/(admin)/admin/centers/_may-pos-actions.ts";
const TRANG_CO_SO_MOI = "app/(admin)/admin/centers/new/page.tsx";
const TRANG_CAU_HINH = "app/(admin)/admin/cau-hinh-van-hanh/page.tsx";
const TRANG_BIEN_DONG = "app/(admin)/admin/bien-dong-so-du/page.tsx";
const TRANG_AGENT = "app/(admin)/admin/bien-dong-so-du/pos-agent/page.tsx";
const TRANG_DON = "app/(admin)/admin/orders/[id]/page.tsx";
const CHI_TIET_DON = "app/(admin)/admin/orders/_components/order-detail-client.tsx";
const BANG_DON = "app/(admin)/admin/orders/_components/payment-requests-section.tsx";

describe("[HN2-MP-W01] trang cơ sở: mục máy POS có mặt, qua loader gác HAI lớp, đúng chỗ", () => {
  const t = ma(TRANG_CO_SO);

  it("nạp bằng `docMucMayPos` ĐÚNG MỘT lần, trong một lô song song; trang không tự đọc `posTerminal` / tự `passesScope(\"PosTerminal\")`", () => {
    expect(dem(t, /\bdocMucMayPos\(/)).toBe(1);
    // Cổng nằm ở MỘT chỗ (loader). Trang tự đọc là đẻ bản thứ hai của cổng — và là chỗ cấy "bỏ passesScope" không có ca nào đỏ.
    expect(dem(t, /\.posTerminal\b/), "trang không đọc máy POS trực tiếp").toBe(0);
    expect(dem(t, /passesScope\("PosTerminal"/), "cách ly cơ sở của máy POS nằm trong loader").toBe(0);
    const i = t.indexOf("docMucMayPos(");
    const truoc = t.slice(0, i);
    const batDauLo = truoc.lastIndexOf("Promise.all([");
    expect(batDauLo, "có một Promise.all([ trước lời gọi").toBeGreaterThan(-1);
    expect(truoc.slice(batDauLo).includes("]);"), "lời gọi nằm TRONG lô, chưa đóng").toBe(false);
  });

  it("quyền: dùng CHÍNH kết quả `payments:view` (có đích) đã hỏi cho mục Thanh toán; hỏi `payments:import-pos` đúng một lần", () => {
    expect(dem(t, /checkPermission\("payments:view",/), "payments:view hỏi MỘT lần, có đích").toBe(1);
    expect(dem(t, /coQuyenXem:\s*hasPaymentsView\b/)).toBe(1);
    expect(dem(t, /checkPermission\("payments:import-pos"\)/)).toBe(1);
    expect(dem(t, /coQuyenGhi:\s*hasImportPos\b/)).toBe(1);
  });

  it("truyền vào `CenterForm` qua prop `mayPos`, đúng một lần", () => {
    expect(dem(t, /\bmayPos=\{/)).toBe(1);
    expect(dem(t, /<MucMayPos\b/)).toBe(1);
  });

  // [HN2-RD-04] BỐN lời hỏi quyền trong MỘT lô, đọc ra bằng DESTRUCTURING THEO VỊ TRÍ (mảng boolean) — `tsc` không bắt được đảo hai
  // phần tử vì cả bốn đều boolean. Đảo `payments:manage` ↔ `payments:import-pos` thì Kế toán cơ sở (có manage, KHÔNG có import-pos)
  // nhận `hasImportPos = true`: loader đọc và vẽ dòng POS Agent cho họ, đồng thời mất nút "Tạo phương thức thanh toán". Bản cũ chỉ đếm
  // SỐ LẦN gọi nên cấy đảo vị trí vẫn 0 ca đỏ. Nay ghép TÊN ↔ LỜI GỌI theo thứ tự.
  it("[HN2-RD-04] ghép tên ↔ lời hỏi quyền theo VỊ TRÍ trong `Promise.all` (cả bốn cặp)", () => {
    const m = t.match(/const \[([^\]]+)\] = await Promise\.all\(\[([\s\S]*?)\]\);/);
    expect(m, "có `const [...] = await Promise.all([...])` hỏi quyền").not.toBeNull();
    const ten = m![1]!.split(",").map((x) => x.trim()).filter(Boolean);
    const quyen = [...m![2]!.matchAll(/checkPermission\("([^"]+)"/g)].map((x) => x[1]);
    expect(ten).toEqual(["hasPaymentsView", "canManageMethods", "hasImportPos", "coQuyenSuaHoSo"]);
    expect(quyen).toEqual(["payments:view", "payments:manage", "payments:import-pos", "centers:edit"]);
  });

  // [HN2-RD-05] Nút "Cập nhật" của form hồ sơ cơ sở nói thật: Kế toán HO (có `payments:import-pos`, KHÔNG có `centers:edit`) là người
  // DÙNG CHÍNH của trang này sau Việc 2, mà bấm "Cập nhật" thì `updateCenter → requireOrgAdmin` đá về /dashboard?error=unauthorized
  // không một câu giải thích. Trang hỏi CHÍNH câu máy chủ hỏi (`checkPermission("centers:edit")`, trần, cùng `requireOrgAdmin`).
  it("[HN2-RD-05] trang hỏi `centers:edit` đúng một lần (trần, y hệt `requireOrgAdmin`) và truyền `suaDuocHoSo={coQuyenSuaHoSo}` cho form, đúng một lần", () => {
    expect(dem(t, /checkPermission\("centers:edit"\)/)).toBe(1);
    expect(dem(t, /\bsuaDuocHoSo=\{coQuyenSuaHoSo\}/)).toBe(1);
  });

  it("[HN2-RD-05] `CenterForm`: prop `suaDuocHoSo` BẮT BUỘC (không `?`, không mặc định — quên truyền thì `tsc` đỏ); trang tạo cơ sở mới cũng truyền", () => {
    const f = ma(FORM_CO_SO);
    expect(dem(f, /\bsuaDuocHoSo:\s*boolean/)).toBe(1);
    expect(dem(f, /\bsuaDuocHoSo\?:/)).toBe(0);
    expect(dem(f, /\bsuaDuocHoSo\s*=\s*(?:true|false)\b/), "không mặc định trong destructuring").toBe(0);
    const moi = ma(TRANG_CO_SO_MOI);
    expect(dem(moi, /checkPermission\("centers:edit"\)/)).toBe(1);
    expect(dem(moi, /\bsuaDuocHoSo=\{/)).toBe(1);
  });

  it("tên cơ sở + trạng thái hoạt động lấy từ bản ghi Center đã đọc, không câu tra thêm", () => {
    expect(dem(t, /docMucMayPos\(\{[\s\S]*?isActive:\s*center\.isActive/), "cờ hoạt động đi từ Center đã đọc").toBe(1);
    expect(dem(t, /docMucMayPos\(\{[\s\S]*?name:\s*center\.name/)).toBe(1);
  });
});

describe("[HN2-MP-W02] CenterForm vẽ `mayPos` NGAY SAU 'Thanh toán' và TRƯỚC 'Hình ảnh'; `Section` có `id` để neo #may-pos", () => {
  const t = ma(FORM_CO_SO);

  it("thứ tự trong JSX: Thanh toán → {mayPos} → Hình ảnh", () => {
    const iTT = t.indexOf('title="Thanh toán"');
    const iMay = t.search(/\{isEdit && mayPos\}/);
    const iAnh = t.indexOf('title="Hình ảnh"');
    expect(iTT).toBeGreaterThan(-1);
    expect(iMay, "có chỗ vẽ mayPos").toBeGreaterThan(iTT);
    expect(iAnh).toBeGreaterThan(iMay);
  });

  it("`mayPos` là prop TUỲ CHỌN (trang tạo cơ sở mới không có máy), `Section` được export và nhận `id`", () => {
    expect(t).toMatch(/\bmayPos\?:\s*React\.ReactNode/);
    expect(t).toMatch(/export function Section\(/);
    expect(t).toMatch(/\bid\?:\s*string/);
  });
});

describe("[HN2-MP-W03] tab 'Máy POS' ĐÃ GỠ khỏi Cấu hình vận hành (cả sổ tab, sổ quyền, trang, hai tệp tab, tệp action cũ)", () => {
  it("sổ tab / sổ quyền / sổ tự-quản-quyền-ghi không còn `may-pos`", () => {
    expect(TAB_CAU_HINH.map((t) => t.id)).not.toContain("may-pos");
    expect(Object.keys(QUYEN_TAB)).not.toContain("may-pos");
    expect([...TAB_TU_QUAN_QUYEN_GHI]).not.toContain("may-pos");
    // Đối chứng dương: tab tự quản quyền ghi còn lại (nick Zalo) VẪN ở sổ — sổ không bị xoá sạch.
    expect([...TAB_TU_QUAN_QUYEN_GHI]).toContain("nick-zalo");
  });

  it("sidebar 'Cấu hình vận hành' suy quyền từ `QUYEN_TAB` ⇒ KHÔNG còn `payments:import-pos` (đó là quyền của màn Cơ sở, không phải của màn cấu hình)", () => {
    expect(new Set(Object.values(QUYEN_TAB))).not.toContain("payments:import-pos");
  });

  it("hai tệp tab và tệp action cũ không còn; trang cấu hình không import `TabMayPos`", () => {
    for (const p of [
      "app/(admin)/admin/cau-hinh-van-hanh/_components/tab-may-pos.tsx",
      "app/(admin)/admin/cau-hinh-van-hanh/_components/tab-may-pos-bang.tsx",
      "app/(admin)/admin/cau-hinh-van-hanh/_may-pos-actions.ts",
      "app/(admin)/admin/cau-hinh-van-hanh/_may-pos-actions.test.ts",
    ]) {
      expect(existsSync(resolve(GOC, p)), `${p} đã dời / xoá`).toBe(false);
    }
    const t = ma(TRANG_CAU_HINH);
    expect(dem(t, /\bTabMayPos\b/)).toBe(0);
    expect(dem(t, /["']may-pos["']/), "trang không nhắc tab may-pos").toBe(0);
  });

  it("đối chứng dương: nơi MỚI có đủ — mục, tệp action và test action", () => {
    for (const p of [MUC, ACTION, "app/(admin)/admin/centers/_may-pos-actions.test.ts"]) {
      expect(existsSync(resolve(GOC, p)), `${p} tồn tại`).toBe(true);
    }
  });
});

describe("[HN2-MP-W04] không còn chuỗi `tab=may-pos` trong mã nguồn (app · components · lib) — lối đi cũ không còn dấu vết", () => {
  function quet(thuMuc: string, ra: string[]) {
    for (const ten of readdirSync(thuMuc)) {
      if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
      const duong = join(thuMuc, ten);
      const st = statSync(duong);
      if (st.isDirectory()) quet(duong, ra);
      else if (/\.(ts|tsx|mjs)$/.test(ten) && !/\.test\.(ts|tsx)$/.test(ten)) ra.push(duong);
    }
  }

  it("quét app/**, components/**, lib/** (bỏ tệp test, bóc chú thích) ⇒ 0 lần `tab=may-pos`", () => {
    const tep: string[] = [];
    for (const g of ["app", "components", "lib"]) quet(resolve(GOC, g), tep);
    expect(tep.length, "quét được nhiều tệp (phép quét không mù)").toBeGreaterThan(500);
    const dinh = tep.filter((p) => /tab=may-pos/.test(bocChuThich(readFileSync(p, "utf8"))));
    expect(dinh.map((p) => p.split(sep).slice(-3).join("/"))).toEqual([]);
  });

  it("đối chứng: phép quét THẤY chuỗi khi nó có (nếu không, ca trên xanh vì phép đo mù)", () => {
    expect(/tab=may-pos/.test(bocChuThich('const x = "/cau-hinh-van-hanh?tab=may-pos";'))).toBe(true);
    expect(/tab=may-pos/.test(bocChuThich("// ghi chú /cau-hinh-van-hanh?tab=may-pos"))).toBe(false);
  });
});

describe("[HN2-MP-W05] `?tab=may-pos` redirect về /centers, đứng TRƯỚC cổng tab", () => {
  it("duongTabDaDoi: may-pos ⇒ /centers; tab còn sống / lạ / vắng ⇒ null", () => {
    expect(duongTabDaDoi("may-pos")).toBe("/centers");
    expect(duongTabDaDoi("hoa-hong")).toBeNull();
    expect(duongTabDaDoi("nick-zalo")).toBeNull();
    expect(duongTabDaDoi("khong-ton-tai")).toBeNull();
    expect(duongTabDaDoi(undefined)).toBeNull();
    expect(duongTabDaDoi("")).toBeNull();
  });

  it("trang cấu hình: `await searchParams` rồi redirect bằng `duongTabDaDoi` — cả hai đứng trước `tabDuocXem.size === 0`", () => {
    const t = ma(TRANG_CAU_HINH);
    expect(dem(t, /\bawait searchParams\b/), "đọc searchParams đúng một lần").toBe(1);
    expect(dem(t, /\bduongTabDaDoi\(/)).toBe(1);
    const iSp = t.search(/\bawait searchParams\b/);
    const iDoi = t.search(/\bduongTabDaDoi\(/);
    const iCong = t.search(/tabDuocXem\.size === 0/);
    expect(iSp, "đọc searchParams trước khi chuyển hướng").toBeLessThan(iDoi);
    expect(iDoi, "chuyển hướng TRƯỚC cổng tab (Kế toán HO không còn tab nào)").toBeLessThan(iCong);
    expect(t).toMatch(/redirect\(dich\)|redirect\(duong\)|redirect\(\s*duongTabDaDoi/);
  });
});

describe("[HN2-MP-W06] các lối vào CŨ nay trỏ vào màn Cơ sở", () => {
  it("Biến động số dư: ĐÚNG MỘT link /centers, trong khối `canImportPos`, và chỉ khi người xem mở được /centers", () => {
    const t = ma(TRANG_BIEN_DONG);
    expect(dem(t, /href="\/centers"/)).toBe(1);
    expect(dem(t, /cau-hinh-van-hanh/), "không còn nhắc Cấu hình vận hành").toBe(0);
    const khoi = t.match(/\{canImportPos && \(([\s\S]*?)\n {8}\)\}/)?.[1] ?? "";
    expect(khoi, "link nằm trong khối {canImportPos && (…)}").toContain('href="/centers"');
    // Đích đến /centers đòi `centers:view` ⇒ link chỉ vẽ khi người xem có quyền đó (luật 12) — và hỏi Y HỆT trang đích
    // (CÓ đích `{ centerId }`: gọi trần một action seed scope CENTER bị lưới `rbac-scope` R1 chặn).
    expect(dem(t, /checkPermission\("centers:view", \{ centerId: session\.user\.centerId \?\? null \}\)/)).toBe(1);
    expect(dem(t, /checkPermission\("centers:view"\)/), "không gọi trần").toBe(0);
    expect(khoi).toMatch(/\{coQuyenXemCoSo && \(/);
  });

  it("Sức khoẻ POS Agent: link 'Khai máy POS' dùng `duongKhaiMay(a.centerId)` — biết cơ sở thì tới đúng trang cơ sở", () => {
    const t = ma(TRANG_AGENT);
    expect(dem(t, /\bduongKhaiMay\(a\.centerId\)/)).toBe(1);
    expect(dem(t, /cau-hinh-van-hanh/)).toBe(0);
  });

  // [HN2-RD-07] Nhãn "Khai máy POS / Xem máy POS" ở màn POS Agent trước đây KHÔNG lưới nào canh: cấy (M3) `phamViGhiMoiCoSo: true`,
  // (M4) nhãn luôn "Khai máy POS", (M11) `khaiMayDuoc={false}` đều 15153 xanh / 0 đỏ — vai chỉ-xem đọc một lời hứa suông, hoặc Kế toán
  // HO đọc "Xem máy POS". Chữ nằm ở hàm thuần `nhanLinkKhaiMay` (`[HN2-RD-02]` đo CẢ HAI nhánh); lưới này ghim DÂY NỐI vào nó.
  it("[HN2-RD-07] màn POS Agent: `khaiMayDuoc` suy từ `duocKhaiMayPos({ coQuyenGhi: true, phamViGhiMoiCoSo: nhapPosDuocMoiCoSo(actor) })`, truyền xuống thẻ máy, nhãn qua `nhanLinkKhaiMay`", () => {
    const t = ma(TRANG_AGENT);
    expect(
      dem(
        t,
        /const khaiMayDuoc = duocKhaiMayPos\(\{\s*coQuyenGhi:\s*true,\s*phamViGhiMoiCoSo:\s*nhapPosDuocMoiCoSo\(actor\)\s*\}\)/,
      ),
    ).toBe(1);
    expect(dem(t, /\bkhaiMayDuoc=\{khaiMayDuoc\}/), "truyền cho thẻ máy").toBe(1);
    expect(dem(t, /\{nhanLinkKhaiMay\(khaiMayDuoc\)\}/), "nhãn đi qua hàm thuần").toBe(1);
    expect(dem(t, /["'`]Khai máy POS["'`]|["'`]Xem máy POS["'`]/), "không còn chữ nhãn gõ tay trong trang").toBe(0);
    expect(dem(t, /\bkhaiMayDuoc:\s*boolean/), "prop của thẻ máy BẮT BUỘC").toBe(1);
    expect(dem(t, /\bkhaiMayDuoc\?:/)).toBe(0);
  });

  // [HN2-RD-08] Khối nút của Biến động số dư bị `shrink-0` ⇒ không co, không xuống dòng: ở 375px 4 mục nằm một hàng dài 637px, <main>
  // tràn 302px, "Import file POS" ra ngoài khung nhìn. Đo bằng trình duyệt ở `[HN2-RD-E2]`; lưới này ghim đúng nguyên nhân.
  it("[HN2-RD-08] Biến động số dư: khối nút trong `{canImportPos && (…)}` được phép CO và XUỐNG DÒNG (không `shrink-0`, có `flex-wrap`)", () => {
    const t = ma(TRANG_BIEN_DONG);
    const lop = t.match(/\{canImportPos && \(\s*<div className="([^"]*)"/)?.[1] ?? "";
    expect(lop, "tìm thấy thẻ bao khối nút").not.toBe("");
    expect(lop).toMatch(/\bflex-wrap\b/);
    expect(lop, "shrink-0 giữ khối ở bề ngang tự nhiên ⇒ tràn ở màn hẹp").not.toMatch(/\bshrink-0\b/);
  });

  // [HN2-RD-09] Bookmark `?tab=may-pos` mở lúc CHƯA đăng nhập: proxy đá /login?callbackUrl=/admin/cau-hinh-van-hanh (mất query), nên
  // redirect `duongTabDaDoi` (đứng SAU auth) không bao giờ chạy cho người này. Sau đăng nhập trang thấy Kế toán HO không giữ tab nào
  // ⇒ về dashboard. Lớp thứ hai: không giữ tab nào mà có `payments:import-pos` (đúng tập người dùng tab cũ) ⇒ /centers.
  it("[HN2-RD-09] cấu hình vận hành: không giữ tab nào ⇒ có `payments:import-pos` thì /centers, không thì dashboard", () => {
    const t = ma(TRANG_CAU_HINH);
    const i = t.search(/tabDuocXem\.size === 0/);
    expect(i, "có cổng 'không giữ tab nào'").toBeGreaterThan(-1);
    const khoi = t.slice(i, i + 500);
    // Một biểu thức: CÓ import-pos ⇒ /centers, KHÔNG ⇒ dashboard (đảo hai nhánh là đá người không liên quan tới màn cơ sở, hoặc đá Kế toán HO về dashboard).
    expect(dem(khoi, /redirect\(\s*\(await checkPermission\("payments:import-pos"\)\)\s*\?\s*"\/centers"\s*:\s*"\/admin\/dashboard"\s*\)/)).toBe(1);
    expect(dem(t, /checkPermission\("payments:import-pos"\)/), "chỉ hỏi trong nhánh này").toBe(1);
  });
});

describe("[HN2-MP-W07] trang ĐƠN: link 'Chưa khai máy POS' do SERVER quyết, truyền đủ hai bậc, BẮT BUỘC (luật 11)", () => {
  const trang = ma(TRANG_DON);
  const chiTiet = ma(CHI_TIET_DON);
  const bang = ma(BANG_DON);

  it("trang đơn: hỏi `payments:import-pos` TRONG lô quyền có sẵn; dựng link bằng `khaiMayChoDon` (một định nghĩa, nhận NGUYÊN ĐƠN)", () => {
    expect(dem(trang, /checkPermission\("payments:import-pos"\)/)).toBe(1);
    expect(dem(trang, /\bkhaiMayChoDon\(/)).toBe(1);
    // Hai hàm thấp hơn nằm TRONG `khaiMayChoDon` (`may-o-co-so.ts`), trang không tự ghép lại.
    expect(dem(trang, /\blienKetKhaiMay\(/)).toBe(0);
    expect(dem(trang, /\bduocKhaiMayPos\(/)).toBe(0);
    expect(dem(trang, /\bkhaiMay=\{/)).toBe(1);
    // Không câu tra mới: tên cơ sở đi theo `order.center` đã include; máy POS vẫn đọc ĐÚNG MỘT lần ([POS1-UI-W1]).
    expect(dem(trang, /\.posTerminal\.findMany\(/)).toBe(1);
    expect(dem(trang, /center:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true\s*\}\s*\}/), "đơn include tên cơ sở").toBe(1);
  });

  // [HN2-RD-06] Cơ sở của link là cơ sở GIỮ ĐƠN. Bản cũ chỉ đếm số lần gọi `lienKetKhaiMay(` / `nhapPosDuocMoiCoSo(actor)` nên đổi
  // `centerId: order.centerId ?? null` thành `session.user.centerId ?? null` (Kế toán HO có `centerId = null` ⇒ link về /centers thay vì
  // cơ sở của đơn) vẫn 15153/15153 xanh; chỉ e2e `[HN2-MP-E5]` bắt phép thay thẳng. Neo vào BIỂU THỨC bên trong khối lời gọi.
  it("[HN2-RD-06] khối `khaiMayChoDon({...})`: `don: order`, quyền ghi từ `coQuyenImportPos`, tầm nhìn từ `nhapPosDuocMoiCoSo(actor)`, KHÔNG nhắc `session`", () => {
    const khoi = trang.match(/\bkhaiMayChoDon\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
    expect(khoi, "tìm thấy khối lời gọi").not.toBe("");
    expect(dem(khoi, /\bdon:\s*order\s*,/)).toBe(1);
    expect(dem(khoi, /\bcoQuyenGhi:\s*coQuyenImportPos\b/)).toBe(1);
    expect(dem(khoi, /\bphamViGhiMoiCoSo:\s*nhapPosDuocMoiCoSo\(actor\)/)).toBe(1);
    expect(dem(khoi, /\bsession\b/), "cơ sở của link không được lấy từ người xem").toBe(0);
  });

  it("truyền tiếp qua order-detail-client và khai BẮT BUỘC ở cả hai nơi nhận (không `?`, không mặc định)", () => {
    expect(dem(chiTiet, /\bkhaiMay=\{khaiMay\}/)).toBe(1);
    for (const [ten, src] of [
      ["order-detail-client", chiTiet],
      ["payment-requests-section", bang],
    ] as const) {
      expect(dem(src, /\bkhaiMay:\s/), `${ten} khai khaiMay bắt buộc`).toBeGreaterThanOrEqual(1);
      expect(dem(src, /\bkhaiMay\?:/), `${ten} không khai khaiMay tuỳ chọn`).toBe(0);
      // Mặc định trong destructuring: `khaiMay = null` / `khaiMay = { title: … }` (KHÔNG khớp thuộc tính JSX `khaiMay={khaiMay}`).
      expect(dem(src, /\bkhaiMay\s*=\s*(?:null\b|\{\s*title\b)/), `${ten} không mặc định khaiMay`).toBe(0);
    }
  });

  it("bảng vẽ link CHỈ khi `khaiMay.href` có; nhánh không link giữ `title`", () => {
    expect(dem(bang, /khaiMay\.href\s*\?/)).toBe(1);
    expect(dem(bang, /title=\{khaiMay\.title\}/)).toBeGreaterThanOrEqual(2);
    expect(dem(bang, /Cấu hình vận hành → Máy POS/), "câu cũ chỉ vào tab đã gỡ").toBe(0);
  });
});

describe("[HN2-MP-W08] action máy POS: cổng không đổi, làm mới trang cơ sở, nói thật về lỗi trùng", () => {
  const t = ma(ACTION);

  it("cả BA action vẫn hỏi `nhapPosDuocMoiCoSo(actor)` và `payments:import-pos` ở đầu", () => {
    expect(dem(t, /if \(!nhapPosDuocMoiCoSo\(actor\)\) return/)).toBe(3);
    expect(dem(t, /if \(!\(await checkPermission\(QUYEN\)\)\) return/)).toBe(3);
    expect(dem(t, /const QUYEN = "payments:import-pos"/)).toBe(1);
  });

  it("làm mới qua MỘT hàm `lamMoi(centerId)`: gọi ở cả ba action (+ một lần cho cơ sở CŨ khi đổi cơ sở); hàm làm mới trang cơ sở lẫn đường cũ", () => {
    expect(dem(t, /(?<!function )\blamMoi\(/), "tạo · sửa · sửa (cơ sở cũ) · bật-tắt").toBe(4);
    expect(dem(t, /revalidatePath\(DUONG_DAN\)/), "đường cũ giữ cho [MPOS-03]").toBe(1);
    expect(dem(t, /revalidatePath\(`\/admin\/centers\/\$\{centerId\}\/edit`\)/), "trang cơ sở").toBe(1);
    expect(dem(t, /revalidatePath\(/), "không còn lời gọi revalidatePath trần nào ngoài hàm").toBe(2);
  });
});

describe("[HN2-MP-W09] mục máy POS trong form cơ sở: nút không bao giờ là submit, hộp thoại portal ra khỏi form", () => {
  const t = ma(MUC);

  it("mọi <Button>/<button> có `type` tường minh (bare Button = nút submit của form cơ sở)", () => {
    const soNut = dem(t, /<Button\b|<button\b/);
    const soKieu = dem(t, /\btype="(?:button|submit)"/);
    expect(soNut, "mục có nút").toBeGreaterThanOrEqual(6);
    expect(soKieu, "số `type=` bằng số nút").toBe(soNut);
    // Đúng MỘT nút submit — nút gửi của hộp thoại (nằm trong <form> của hộp thoại, portal ra ngoài form cơ sở).
    expect(dem(t, /\btype="submit"/)).toBe(1);
  });

  it("đúng MỘT <form> và nó nằm SAU <DialogContent> (portal); hộp thoại mang `admin-scope`; submit chặn nổi bọt", () => {
    expect(dem(t, /<form\b/)).toBe(1);
    expect(t.search(/<form\b/)).toBeGreaterThan(t.search(/<DialogContent\b/));
    expect(dem(t, /<DialogContent[^>]*className="[^"]*\badmin-scope\b/)).toBeGreaterThanOrEqual(2);
    expect(dem(t, /\.stopPropagation\(\)/)).toBeGreaterThanOrEqual(1);
  });

  it("không chọn cơ sở: không import Select, không state `centerId` (cơ sở lấy từ view)", () => {
    expect(dem(t, /@\/components\/ui\/select/)).toBe(0);
    expect(dem(t, /useState[^;]*centerId|\bdatCenterId\b/)).toBe(0);
    // [HN2-RD-01] CHỈ lời gọi TẠO gửi `centerId` của trang. Lời gọi SỬA không gửi: gửi thì trang CS1 cũ kéo máy vừa chuyển sang CS2
    // về lại CS1. Cắt theo lời gọi (đếm cả tệp sẽ lẫn hai bên).
    const khoiSua = t.match(/\bsuaMayPosAction\(\{([\s\S]*?)\}\)/)?.[1] ?? "";
    const khoiTao = t.match(/\btaoMayPosAction\(\{([\s\S]*?)\}\)/)?.[1] ?? "";
    expect(khoiSua, "tìm thấy lời gọi sửa").not.toBe("");
    expect(khoiTao, "tìm thấy lời gọi tạo").not.toBe("");
    expect(dem(khoiSua, /\bcenterId\b/), "sửa KHÔNG gửi centerId").toBe(0);
    expect(dem(khoiTao, /\bcenterId:\s*coSo\.id\b/), "tạo gửi centerId của trang").toBe(1);
  });
});

describe("[HN2-MP-W10] đối chứng dương: người khai máy (Kế toán HO) còn QUYỀN vào màn Cơ sở", () => {
  // ⚠️ Ca này chứng minh QUYỀN (seed), KHÔNG chứng minh có LỐI ĐI trên giao diện: trên PROD, "menu gọn" (`AN_MENU_KE_TOAN`) ẩn mục sidebar "Cơ sở" khỏi
  // Kế toán HO dù họ giữ `centers:view` — đo 09/10/2026, docs/pos-hai-nut-khai-may.md §2.10 mục 2. Lối đi thật là các link (Biến động số dư · trang đơn
  // · màn POS Agent), do `[HN2-MP-E3]` / `E5` / `E6` đo bằng trình duyệt. Bản đầu của tiêu đề này viết "đây là đường duy nhất tới máy POS" — sai.
  it("`HO_ACCOUNTANT` giữ cả `payments:import-pos` lẫn `centers:view` trong seed — đủ quyền mở `/centers/<id>/edit` (còn lối đi hay không: xem chú thích)", () => {
    const seed = docTho("prisma/seed-roles.ts");
    const i = seed.search(/code:\s*"HO_ACCOUNTANT"/);
    expect(i).toBeGreaterThan(-1);
    const j = seed.slice(i + 10).search(/code:\s*"[A-Z_]+"/);
    const khoi = seed.slice(i, j < 0 ? undefined : i + 10 + j);
    expect(khoi).toMatch(/action:\s*"payments:import-pos"/);
    expect(khoi).toMatch(/action:\s*"centers:view"/);
    expect(khoi).toMatch(/action:\s*"payments:view"/);
  });
});
