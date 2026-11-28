// Lưới chống GHSA-8fpg-xm3f-6cx3 (next-auth 5.0.0-beta.31 / @auth/core 0.41.2): khi cấu hình Auth hỏng, `auth()` trả OBJECT LỖI `{ message }` (truthy) chứ không phải `null`.
// Đã đo 29/10/2026 bằng PoC offline: chỉ cần kẻ lạ gửi cookie `__Secure-authjs.callback-url=x` là `auth()` ra object lỗi cho CHÍNH request của họ.
// Hệ quả: mã kiểm theo «có/không có đối tượng phiên» (`if (!session)`, `if (session)`, `!!session`, `session ? …`) sẽ coi kẻ lạ là ĐÃ ĐĂNG NHẬP. Chỉ kiểm thuộc tính mà phiên
// thật mới có (`session?.user`, `session?.user?.id`) là an toàn. `requireLiveSession()` an toàn vì nó trả null trừ khi `session?.user?.id` có thật.
// Hàm THUẦN (không đọc đĩa) để test được bằng chuỗi giả; việc quét cây nằm ở `quet-auth-truthy.test.ts`.
//
// Giới hạn đã biết (heuristic, không phải phân tích kiểu): chỉ nhìn 30 dòng sau chỗ gán; bắt các dạng điều kiện thường gặp; `const { user } = await auth()` và `req.auth` (middleware
// bọc) không được xét (đã đo 29/10: 0 chỗ destructuring; proxy.ts dùng `session?.user`). Đây là LƯỚI CHẶN TÁI PHÁT cho tới khi nâng next-auth, không phải bằng chứng an toàn tuyệt đối.

export type PhatHienAuthTruthy = { dong: number; ten: string; noiDung: string };

const NGUON = String.raw`(?:await\s+)?auth\(\s*\)`;

/** Bỏ chú thích nhưng GIỮ số dòng. */
function boChuThich(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p: string) => p + " ".repeat(m.length - p.length));
}

/** Nhóm ngoặc đơn bao quanh vị trí `idx` (điều kiện `if (...)`); không nằm trong ngoặc ⇒ cả câu lệnh tới `;`. */
function nhomQuanh(s: string, idx: number): string {
  let sau = 0;
  let bat = -1;
  for (let k = idx - 1; k >= 0; k--) {
    const c = s[k];
    if (c === ")") sau++;
    else if (c === "(") {
      if (sau === 0) {
        bat = k;
        break;
      }
      sau--;
    } else if (c === ";" || c === "{" || c === "}") break;
  }
  if (bat >= 0) {
    let d = 0;
    for (let k = bat; k < s.length; k++) {
      if (s[k] === "(") d++;
      else if (s[k] === ")" && --d === 0) return s.slice(bat, k + 1);
    }
    return s.slice(bat);
  }
  const dau = Math.max(s.lastIndexOf(";", idx), s.lastIndexOf("{", idx), s.lastIndexOf("}", idx)) + 1;
  const cuoi = s.indexOf(";", idx);
  return s.slice(dau, cuoi < 0 ? s.length : cuoi);
}

export function timAuthTruthy(text: string): PhatHienAuthTruthy[] {
  if (!/\bauth\(/.test(text)) return [];
  const sach = boChuThich(text);
  const ra: PhatHienAuthTruthy[] = [];
  const khai = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*${NGUON}`, "g");
  let m: RegExpExecArray | null;
  while ((m = khai.exec(sach))) {
    const ten = m[1]!;
    const batDau = m.index + m[0].length;
    const soDong = sach.slice(0, m.index).split("\n").length;
    // cửa sổ: 30 dòng sau chỗ gán
    let cuoiCua = batDau;
    for (let n = 0; n < 30 && cuoiCua >= 0; n++) cuoiCua = sach.indexOf("\n", cuoiCua + 1);
    const cua = sach.slice(batDau, cuoiCua < 0 ? sach.length : cuoiCua);
    const N = ten.replace(/\$/g, "\\$");
    const tran = [
      new RegExp(String.raw`!\s*${N}(?![\w$.?\[])`),
      new RegExp(String.raw`\bif\s*\(\s*${N}\s*\)`),
      new RegExp(String.raw`\b${N}\s*\?\s*[^.?]`),
      new RegExp(String.raw`\b${N}\s*(?:&&|\|\|)`),
      new RegExp(String.raw`(?:&&|\|\|)\s*${N}\s*(?:\)|&&|\|\||;)`),
      new RegExp(String.raw`\b${N}\s*(?:===|!==|==|!=)\s*(?:null|undefined)`),
      new RegExp(String.raw`Boolean\(\s*${N}\s*\)`),
    ];
    const thuocTinh = new RegExp(String.raw`${N}\s*\??\.\s*user\b`);
    const truyCapCung = new RegExp(String.raw`${N}\.user\.`);
    // phép thử trần ĐẦU TIÊN trong cửa sổ
    let viTri = -1;
    for (const r of tran) {
      const kq = r.exec(cua);
      if (kq && (viTri < 0 || kq.index < viTri)) viTri = kq.index;
    }
    if (viTri < 0) continue; // không có phép thử trần nào trong cửa sổ ⇒ không phải mẫu bị lưới này canh
    const nhom = nhomQuanh(cua, viTri);
    if (thuocTinh.test(nhom)) continue; // cùng điều kiện đòi `.user` ⇒ object lỗi bị loại
    // phép thử trần rồi chỉ truy cập CỨNG `.user.` ⇒ với object lỗi sẽ NÉM TypeError (đóng cửa bằng lỗi 500, không mở)
    const sauThu = cua.slice(viTri);
    if (truyCapCung.test(sauThu) && !new RegExp(String.raw`${N}\s*\?\.\s*user\b`).test(sauThu)) continue;
    ra.push({ dong: soDong, ten, noiDung: nhom.replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  return ra;
}
