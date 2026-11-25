// [M375] LƯỚI GHIM trình bày 375px của màn Học bù (11/10/2026) — chỉ canh CÁCH BỐ TRÍ, không đụng nghiệp vụ.
//
// Đo thật trên TEST (iframe 375px): bảng 760px cuộn ngang, cột Thao tác dính phải che mất tên học viên (chỉ còn 3–4 ký tự); ô nhập/nút trong hộp thoại Xếp case cao 40px, nút
// "Tạo case" nằm dưới màn hình, nút Close 32px. Jsdom không có bố cục nên không đo được pixel — thứ canh được là các lớp Tailwind làm nên chuyện đó. Đọc mã ĐÃ BỎ chú thích
// (chú thích giải thích bản vá chứa đúng những chuỗi đang tìm).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const BANG = doc("app/(admin)/admin/hoc-bu/_components/bang-can-bu.tsx");
const HOP = doc("app/(admin)/admin/hoc-bu/_components/hop-xep-case.tsx");
const DIALOG = doc("components/ui/dialog.tsx");
const LOC = doc("app/(admin)/admin/hoc-bu/_components/bo-loc.tsx");
const SO_DONG = doc("app/(admin)/admin/hoc-bu/_components/chon-so-dong-nho.tsx");

describe("[M375] màn Học bù ở 375px", () => {
  it("[M375-01] bảng Cần bù là THẺ DỌC dưới `sm` (không còn min-w 760 cuộn ngang); từ `sm` trở lên là bảng thường", () => {
    expect(BANG).toMatch(/<table className="block w-full text-sm sm:table sm:min-w-\[760px\]">/);
    expect(BANG).toMatch(/<thead className="hidden [^"]*sm:table-header-group">/);
    expect(BANG).toMatch(/<tbody className="block sm:table-row-group">/);
    expect(BANG).not.toMatch(/<table className="w-full min-w-\[760px\]/);
    // mỗi hàng là một khối riêng ở mobile (lưới 2 cột — xem [M375-09]), về dòng bảng từ `sm`
    expect(BANG).toMatch(/"relative grid [^"]*border-b border-border [^"]*sm:table-row sm:p-0"/);
  });

  it("[M375-02] cột Thao tác chỉ DÍNH PHẢI từ `sm` — dính ở mobile là che tên học viên (lỗi đã đo)", () => {
    const dong = BANG.split("\n").find((l) => l.includes("sm:sticky") && l.includes("TD_THE"));
    expect(dong, "không thấy ô Thao tác").toBeTruthy();
    expect(dong).not.toMatch(/(^|[\s"])sticky /);
    expect(dong).toContain("sm:sticky");
    // `<th>` Thao tác cũng có `sticky right-0` nhưng cả thead bị ẩn ở mobile (M375-01) nên không che gì.
  });

  it("[M375-03] mỗi ô có NHÃN trên thẻ (data-nhan) — thẻ dọc không có hàng tiêu đề", () => {
    for (const nhan of ["Cơ sở", "Buổi vắng", "Lượt bù", "Đơn PH"]) expect(BANG, nhan).toContain(`data-nhan="${nhan}"`);
    expect(BANG).toContain("before:content-[attr(data-nhan)]");
    expect(BANG).toContain("sm:before:hidden");
  });

  it("[M375-09] thẻ dọc dễ đọc (27/10): tên lớp/buổi XUỐNG DÒNG ở mobile (chỉ cắt từ `sm`), trường xếp lưới 2 cột, nút bấm giãn đều, ô Đơn PH rỗng ẩn ở mobile", () => {
    // trước: `truncate` vô điều kiện cắt mất "(CS2…" — mã lớp là thứ người xếp case cần đọc
    expect(BANG).not.toMatch(/<p className="truncate /);
    expect((BANG.match(/break-words[^"]*sm:truncate/g) ?? []).length).toBe(3); // tên lớp, tên buổi, tên học viên
    // lưới: tên + Buổi vắng + Thao tác chiếm cả hàng; Cơ sở và Lượt bù đứng cạnh nhau (dense lấp chỗ trống)
    expect(BANG).toContain("grid-flow-dense grid-cols-2");
    expect((BANG.match(/col-span-2/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // nhãn nằm TRÊN giá trị (không còn lúc inline lúc xuống dòng tuỳ ô)
    expect(BANG).toContain("before:mb-0.5 before:block");
    expect(BANG).not.toContain("before:mr-2");
    // ô Đơn PH không có đơn: ẩn ở mobile (một dòng chỉ ghi "—" là rác), bảng từ `sm` giữ nguyên
    expect(BANG).toMatch(/!d\.donPhuHuynh && "hidden"/);
    // nút trong ô Thao tác giãn đều ở mobile, trả kích thước tự nhiên từ `sm`
    expect((BANG.match(/h-11 flex-1 sm:h-8 sm:flex-none/g) ?? []).length).toBe(3);
  });

  it("[M375-04] checkbox: vùng bấm là CẢ nhãn 44px (hình vuông 16px giữ nguyên); có 'Chọn tất cả' riêng ở mobile vì thead ẩn", () => {
    expect(BANG).toContain('"-m-2.5 flex size-11 cursor-pointer items-center justify-center sm:m-0 sm:size-6"');
    expect((BANG.match(/<label className=\{VUNG_TICK\}>/g) ?? []).length).toBe(2);
    expect(BANG).toMatch(/<label className="flex min-h-11 [^"]*sm:hidden">/);
    expect(BANG).toContain('className="size-4 accent-primary"');
  });

  it("[M375-05] hộp thoại Xếp case: ô nhập/chọn 44px ở mobile, thanh nút DÍNH ĐÁY, nút Tạo case 44px full-width", () => {
    expect(HOP).toContain('const FIELD = "h-11 sm:h-10";');
    expect(HOP).toMatch(/className="sticky bottom-0 z-\[1\] -mx-4 -mb-4 flex justify-end border-t border-border bg-popover px-4 py-3 sm:static /);
    expect(HOP).toContain('className="h-11 w-full sm:h-8 sm:w-auto" onClick={tao}');
    expect(HOP).toContain('className="h-11 sm:h-7"');
  });

  it("[M375-06] nút Close dùng chung của hộp thoại: 44px ở mobile, 32px từ `sm`", () => {
    expect(DIALOG).toContain('className="absolute top-2 right-2 size-11 sm:size-8"');
  });

  it("[M375-08] hộp thoại Xếp case KHÔNG bị kéo rộng quá khung: con trực tiếp min-w-0 + fieldset min-w-0 (fieldset mặc định min-width:min-content — đo 520px trong khung 322px)", () => {
    expect(HOP).toMatch(/<DialogContent className="[^"]*\[&>\*\]:min-w-0">/);
    expect(HOP).toContain('<fieldset className="min-w-0 space-y-2">');
    expect(HOP).not.toMatch(/<fieldset className="space-y-2">/);
  });

  it("[M375-07] thanh lọc (ô tìm, ba ô chọn) và ô chọn số dòng: 44px ở mobile, 36px từ `sm` như cũ", () => {
    expect(LOC.match(/h-11 [^"]*sm:h-9/g) ?? []).toHaveLength(2); // ô chọn dùng chung 3 lần (một khai báo) + ô tìm
    expect(LOC).not.toMatch(/className="h-9 /);
    expect(SO_DONG).toMatch(/className="h-11 [^"]*sm:h-9/);
    expect(SO_DONG).not.toMatch(/className="h-9 /);
  });
});
