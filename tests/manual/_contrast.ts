/**
 * Máy đo TƯƠNG PHẢN CHỮ theo WCAG AA, chạy trong trang.
 *
 * Dùng chung cho spec site giáo viên và site quản trị — đừng chép lại, một bản
 * thì sửa một chỗ. Trả về danh sách nút chữ TRƯỢT ngưỡng (4,5:1 chữ thường /
 * 3:1 chữ lớn), đã gộp trùng theo (màu chữ, màu nền, cỡ chữ).
 *
 * Cách dùng: `await page.evaluate(`(${AUDIT})()`)` — Playwright coi chuỗi là BIỂU
 * THỨC nên phải tự gọi bằng IIFE, viết trần `() => {}` chỉ trả về chính hàm.
 *
 * Đã tự kiểm: cắm một đoạn chữ #334155 lên nền tối → bắt đúng 1,73:1.
 *
 * KHÔNG đo được (cố ý bỏ qua): phần tử có nền ảnh/gradient — `backgroundColor`
 * của chúng trong suốt nên đo mò sẽ ra "chữ trắng trên nền trắng".
 */
export const AUDIT = `() => {
  // Đọc màu QUA CANVAS thay vì bóc chuỗi "rgb(...)": Tailwind v4 phát màu dạng
  // oklch(...) và getComputedStyle giữ nguyên dạng đó. Bản đầu chỉ khớp rgb() nên
  // coi mọi nền oklch là TRONG SUỐT — nút nền tối bị đo thành "chữ trắng trên nền
  // trắng" (1:1 giả), và nguy hiểm hơn là có thể BỎ SÓT chỗ trượt thật.
  const cv = document.createElement("canvas");
  cv.width = 1; cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const memo = new Map();
  const parse = (s) => {
    if (!s || s === "transparent" || s === "none") return null;
    if (memo.has(s)) return memo.get(s);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#010203";            // mồi: nếu chuỗi không hợp lệ, fillStyle giữ nguyên mồi
    ctx.fillStyle = s;
    if (ctx.fillStyle === "#010203") { memo.set(s, null); return null; }
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    // ImageData KHÔNG nhân alpha (theo spec) — dùng thẳng d[0..2]. Bản trước chia
    // cho alpha để "khử nhân alpha", làm số nền vọt lên quá 255 (thấy rgb(454,308,48))
    // và mọi tỉ lệ tương phản trên nền tint đều sai.
    const out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    memo.set(s, out);
    return out;
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // Nền THỰC: trộn ngược các lớp nền trong suốt cho tới lớp đục đầu tiên.
  const bgOf = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      n = n.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const bad = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const txt = (node.textContent || "").trim();
    if (!txt) continue;
    const el = node.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.closest(".sr-only")) continue;
    // Nền là ảnh/gradient thì KHÔNG đo được bằng backgroundColor — đo mò sẽ ra
    // "chữ trắng trên nền trắng" (avatar .brand-gradient báo nhầm 1.07:1).
    let anh = false;
    for (let q = el; q && q !== document.documentElement; q = q.parentElement) {
      if (getComputedStyle(q).backgroundImage !== "none") { anh = true; break; }
      if (parse(getComputedStyle(q).backgroundColor)?.a === 1) break;
    }
    if (anh) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const cr = ratio(eff, bg);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    if (cr >= need) continue;
    const key = cs.color + "|" + Math.round(bg.r) + "," + Math.round(bg.g) + "," + Math.round(bg.b) + "|" + Math.round(size);
    if (seen.has(key)) continue;
    seen.add(key);
    bad.push({
      chu: txt.slice(0, 34),
      mau: cs.color,
      nen: "rgb(" + Math.round(bg.r) + "," + Math.round(bg.g) + "," + Math.round(bg.b) + ")",
      ty: Math.round(cr * 100) / 100,
      can: need,
      co: Math.round(size),
      cls: (el.className || "").toString().slice(0, 58),
    });
  }
  return bad;
}`;

export type ChoTruot = {
  chu: string;
  mau: string;
  nen: string;
  ty: number;
  can: number;
  co: number;
  cls: string;
};
