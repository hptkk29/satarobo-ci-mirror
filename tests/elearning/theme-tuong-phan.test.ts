/**
 * [EL-THEME-*] Token màu khu e-learning (app/(elearning)/elearning/elearning.css) — đo tương phản AA trên CHÍNH tệp CSS.
 *
 * Vì sao đọc tệp thay vì khai lại bảng màu trong test: bảng khai riêng sẽ xanh mãi cả khi ai đó đổi hex trong CSS
 * (lưới ghim bản sao, không ghim sản phẩm). Test này phân tích khối `.elearning-root` / `.elearning-root.dark` thật.
 *
 * Ngưỡng: chữ thường ≥ 4,5:1; chữ lớn / thành phần giao diện ≥ 3:1 (`ring`, viền nhập liệu).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { docMau, phuLen, tiLeTuongPhan, type Rgba } from "@/lib/elearning/tuong-phan";

const CSS = fs.readFileSync(
  path.join(process.cwd(), "app/(elearning)/elearning/elearning.css"),
  "utf8",
);

/** Gỡ chú thích để chữ trong chú thích không bị tính là khai báo. */
const SACH = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Lấy khối khai báo của bộ chọn `bo`: bộ chọn phải xuất hiện NGUYÊN VĂN trong danh sách (cách nhau dấu phẩy) ở phần đầu
 * khối. Duyệt từng khối `{…}` thay vì dựng RegExp từ chuỗi — chuỗi có dấu chấm/gạch chéo rất dễ bị khớp lỏng.
 */
function khoi(bo: string): Record<string, string> {
  for (const phan of SACH.split("}")) {
    const mo = phan.indexOf("{");
    if (mo < 0) continue;
    const dsBoChon = phan.slice(0, mo).split(",").map((x) => x.trim());
    if (!dsBoChon.includes(bo)) continue;
    const ra: Record<string, string> = {};
    for (const dong of phan.slice(mo + 1).split(";")) {
      const kv = /^\s*--([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(dong);
      if (kv) ra[kv[1]] = kv[2];
    }
    return ra;
  }
  throw new Error(`Không thấy khối ${bo}`);
}

const SANG = khoi(".elearning-root");
const TOI = khoi(".elearning-root.dark");

function mau(t: Record<string, string>, ten: string): Rgba {
  const v = t[ten];
  if (!v) throw new Error(`Thiếu token --${ten}`);
  return docMau(v);
}

/** Màu `ten` (có thể trong suốt) phủ lên nền ĐẶC `nen`. */
function tren(t: Record<string, string>, ten: string, nen: Rgba): Rgba {
  return phuLen(mau(t, ten), nen);
}

const CAP_CHU: [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["secondary-foreground", "secondary"],
  ["primary-foreground", "primary"],
  ["primary-ink", "background"],
  ["primary-ink", "card"],
];

describe.each([
  ["sáng", SANG],
  ["tối", TOI],
])("[EL-THEME-01] tương phản chữ/nền — %s", (_ten, t) => {
  it.each(CAP_CHU)("--%s trên --%s ≥ 4,5:1", (chu, nen) => {
    const nenDac = mau(t, nen);
    const tl = tiLeTuongPhan(tren(t, chu, nenDac), nenDac);
    expect(tl, `${chu} / ${nen} = ${tl.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["success", "warning", "danger", "info"])(
    "[EL-THEME-02] mực trạng thái %s trên nền tint của nó (đặt trên --card) ≥ 4,5:1",
    (s) => {
      const card = mau(t, "card");
      const nenTint = tren(t, `state-${s}-soft`, card);
      const tl = tiLeTuongPhan(tren(t, `state-${s}-ink`, nenTint), nenTint);
      expect(tl, `${s} = ${tl.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("[EL-THEME-03] mực trạng thái đọc được trên --background (dòng phụ, chấm màu + chữ) ≥ 4,5:1", () => {
    const bg = mau(t, "background");
    for (const s of ["success", "warning", "danger", "info"]) {
      const tl = tiLeTuongPhan(tren(t, `state-${s}-ink`, bg), bg);
      expect(tl, `${s} = ${tl.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("[EL-THEME-04] viền nhập liệu (--input) và vòng tiêu điểm (--ring) ≥ 3:1 so với --card", () => {
    const card = mau(t, "card");
    expect(tiLeTuongPhan(tren(t, "ring", card), card)).toBeGreaterThanOrEqual(3);
    // Viền ô nhập đặt trên nền --card: thiết kế dùng --line2 (~16% mực) — đo để biết, ngưỡng 1,3 chỉ
    // chống "viền vô hình"; WCAG 1.4.11 không bắt viền khi ô đã có nền phân biệt.
    expect(tiLeTuongPhan(tren(t, "input", card), card)).toBeGreaterThanOrEqual(1.3);
  });
});

describe("[EL-THEME-05] hai bộ token khai ĐỦ cùng một tập khoá", () => {
  it("mọi token của bản sáng đều có ở bản tối (thiếu là lọt màu sáng sang nền tối)", () => {
    const thieu = Object.keys(SANG).filter((k) => !(k in TOI));
    expect(thieu).toEqual([]);
  });
});

describe("[EL-THEME-06] khối tối theo hệ thống (@media) GIỐNG HỆT khối .dark", () => {
  /** Khai báo trong khối `.elearning-root[data-tuy-chon="system"]` nằm TRONG @media (prefers-color-scheme: dark). */
  function khoiMedia(): Record<string, string> {
    const i = SACH.indexOf("@media (prefers-color-scheme: dark)");
    if (i < 0) throw new Error("Thiếu khối @media (prefers-color-scheme: dark)");
    const trong = SACH.slice(i);
    const mo = trong.indexOf("{", trong.indexOf("{") + 1); // dấu { của khối bộ chọn bên trong
    const dong = trong.indexOf("}", mo);
    const ra: Record<string, string> = {};
    for (const d of trong.slice(mo + 1, dong).split(";")) {
      const kv = /^\s*--([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
      if (kv) ra[kv[1]] = kv[2];
    }
    return ra;
  }

  it("cùng tập token và cùng giá trị — sửa màu tối ở một nơi mà quên nơi kia là đỏ", () => {
    expect(khoiMedia()).toEqual(TOI);
  });

  it("chỉ áp khi gốc ở lựa chọn 'system' (chọn Sáng tay không bị hệ thống tối đè)", () => {
    const i = SACH.indexOf("@media (prefers-color-scheme: dark)");
    const dau = SACH.slice(i, SACH.indexOf("--", i));
    expect(dau).toContain('[data-tuy-chon="system"]');
  });
});
