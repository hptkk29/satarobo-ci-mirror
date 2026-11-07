/**
 * Tiện ích dùng chung cho lưới quét mã nguồn DISC (QA đợt 1). THUẦN: chỉ đọc chuỗi/tệp.
 *
 * Hai việc:
 *  1. `boChuThich` — bỏ chú thích dòng và chú thích khối NHƯNG GIỮ NGUYÊN chuỗi ký tự ("https://…" không bị cắt).
 *     Lưới ghim mã nguồn mà không bỏ chú thích sẽ khớp cả câu giải thích bản vá (CLAUDE.md luật 11).
 *  2. `quetLogChuaPii` — tìm lời gọi ghi log và đánh dấu lời gọi có thể mang dữ liệu của trẻ/phụ huynh.
 *
 * Giới hạn đã biết: bộ tách chuỗi không hiểu regex literal chứa dấu nháy chưa cân. Lưới có ca tự kiểm
 * (`[DISC-QA-PII-SELF]`) để biết bộ quét còn bắt được mẫu mong đợi.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// DISC_QA_ROOT chỉ dành cho harness cấy lỗi (tests/disc/cay-loi): trỏ lưới quét vào BẢN SAO đã cấy lỗi.
export const GOC_REPO = process.env.DISC_QA_ROOT ? resolve(process.env.DISC_QA_ROOT) : resolve(__dirname, "..", "..");

/** Bỏ chú thích, giữ số dòng (thay bằng khoảng trắng/newline) để vị trí báo cáo vẫn đúng. */
export function boChuThich(ma: string): string {
  let ra = "";
  let i = 0;
  let nhay: "'" | '"' | "`" | null = null;
  while (i < ma.length) {
    const c = ma[i]!;
    const k = ma[i + 1];
    if (nhay) {
      ra += c;
      if (c === "\\") {
        ra += ma[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === nhay) nhay = null;
      i++;
      continue;
    }
    if (c === "/" && k === "/") {
      while (i < ma.length && ma[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && k === "*") {
      const het = ma.indexOf("*/", i + 2);
      const doan = ma.slice(i, het === -1 ? ma.length : het + 2);
      ra += doan.replace(/[^\n]/g, " ");
      i += doan.length;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") nhay = c;
    ra += c;
    i++;
  }
  return ra;
}

/** Liệt kê đệ quy tệp theo đuôi; thư mục không tồn tại ⇒ []. Bỏ `node_modules`, `_cay-tam`. */
export function lietKeTep(thuMucTuongDoi: string, duoi: RegExp): string[] {
  const goc = join(GOC_REPO, thuMucTuongDoi);
  const kq: string[] = [];
  const di = (d: string) => {
    let ds: string[];
    try {
      ds = readdirSync(d);
    } catch {
      return;
    }
    for (const ten of ds) {
      if (ten === "node_modules" || ten === "_cay-tam") continue;
      const p = join(d, ten);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (duoi.test(ten)) kq.push(p);
    }
  };
  di(goc);
  return kq.sort();
}

export const docTep = (p: string) => readFileSync(p, "utf8");
export const tuongDoi = (p: string) => relative(GOC_REPO, p).replace(/\\/g, "/");

/** Mã nguồn sản phẩm (không phải test) của DISC mà lưới PII/đồng hồ quét. */
export function tepSanPhamDisc(): string[] {
  return [
    ...lietKeTep("lib/disc", /\.(ts|tsx)$/),
    ...lietKeTep("app/api/disc", /\.(ts|tsx)$/),
    ...lietKeTep("app/(public)/disc", /\.(ts|tsx)$/),
  ].filter((p) => !/\.test\.(ts|tsx)$/.test(p));
}

/* ───────────────────────── Quét log chứa PII ───────────────────────── */

// Cửa ghi log/telemetry: console, logger, Sentry (capture / set / addBreadcrumb).
const CUA_LOG = /\b(?:console\.(?:log|info|debug|warn|error|trace|dir)|logger\.\w+|Sentry\.(?:capture\w+|set\w+|addBreadcrumb))\s*\(/g;

/** Từ khoá chỉ dữ liệu cá nhân của hồ sơ DISC. Khớp theo ranh giới từ, không phân biệt hoa thường. */
const TU_PII =
  /\b(?:hoTen|ho_ten|tenCon|tenPhuHuynh|namSinh|nam_sinh|bacHoc|diem|ketQua|reportSnapshot|tomTat|phuHuynh|hocSinh|soDienThoai|phoneKey|phone|email|emailTo|nguoi|payload|body|input|raw|d|data)\b/i;

export type ViPham = { dong: number; trich: string; lyDo: string };

/**
 * Che NỘI DUNG chuỗi ký tự bằng khoảng trắng (giữ dấu nháy, giữ độ dài, giữ biểu thức `${…}` của
 * template). Để mẫu `console.log(x)` nằm TRONG một chuỗi không bị coi là lời gọi thật.
 */
export function cheChuoi(ma: string): string {
  let ra = "";
  let nhay: string | null = null;
  for (let i = 0; i < ma.length; i++) {
    const c = ma[i]!;
    if (!nhay) {
      if (c === "'" || c === '"' || c === "`") nhay = c;
      ra += c;
      continue;
    }
    if (c === "\\") {
      ra += "  ";
      i++;
      continue;
    }
    if (c === nhay) {
      nhay = null;
      ra += c;
      continue;
    }
    if (nhay === "`" && c === "$" && ma[i + 1] === "{") {
      // Giữ nguyên biểu thức nội suy tới `}` tương ứng (đếm ngoặc nhọn).
      let sau = 0;
      let j = i + 1;
      for (; j < ma.length; j++) {
        if (ma[j] === "{") sau++;
        else if (ma[j] === "}" && --sau === 0) break;
      }
      ra += ma.slice(i, j + 1);
      i = j;
      continue;
    }
    ra += c === "\n" ? "\n" : " ";
  }
  return ra;
}

/** Lấy phần tham số của lời gọi bắt đầu ngay sau dấu `(` ở vị trí `batDau`. Cân ngoặc, bỏ qua chuỗi. */
function layThamSo(ma: string, batDau: number): string {
  let sau = 1;
  let nhay: string | null = null;
  let j = batDau;
  for (; j < ma.length; j++) {
    const c = ma[j]!;
    if (nhay) {
      if (c === "\\") j++;
      else if (c === nhay) nhay = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") nhay = c;
    else if (c === "(") sau++;
    else if (c === ")" && --sau === 0) break;
  }
  return ma.slice(batDau, j);
}

export function quetLogChuaPii(maGoc: string): ViPham[] {
  const ma = cheChuoi(boChuThich(maGoc));
  const vp: ViPham[] = [];
  CUA_LOG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CUA_LOG.exec(ma))) {
    const thamSo = layThamSo(ma, m.index + m[0].length);
    const dong = ma.slice(0, m.index).split("\n").length;
    const trich = (m[0] + thamSo).replace(/\s+/g, " ").slice(0, 120);
    if (/\$\{/.test(thamSo)) {
      vp.push({ dong, trich, lyDo: "nội suy chuỗi trong lời gọi log (có thể kéo dữ liệu cá nhân vào log)" });
      continue;
    }
    if (/JSON\.stringify\s*\(/.test(thamSo)) {
      vp.push({ dong, trich, lyDo: "JSON.stringify trong lời gọi log" });
      continue;
    }
    const conLai = thamSo;
    const t = TU_PII.exec(conLai);
    if (t) {
      vp.push({ dong, trich, lyDo: `tham số log nhắc tới "${t[0]}"` });
      continue;
    }
    // Danh sách trắng: chỉ mã định danh kỹ thuật, không mang dữ liệu người dùng.
    const conLaiSauTrang = conLai.replace(/\b(?:requestId|submissionId|code|status|route|ma)\b/g, "");
    if (/[A-Za-z_$]/.test(conLaiSauTrang)) {
      vp.push({ dong, trich, lyDo: "tham số log không thuộc danh sách trắng (lỗi/đối tượng có thể mang dữ liệu cá nhân)" });
    }
  }
  return vp;
}
