// lib/affiliate/website-hop-le.ts — HỢP ĐỒNG BẢO MẬT của danh sách website + trang đích Affiliate (AFF-P0b, docs/source-commission/12 §2.6; đặc tả §14, §64).
//
// «User Affiliate chỉ chọn trong danh sách được Admin cho phép; không tự nhập arbitrary URL.» Hàm `kiemUrlDuocPhep` là CỔNG chặn open-redirect / link giả mạo:
// P1 (tạo link, `GET /r/:token`, chuyển hướng) PHẢI gọi nó trước khi dựng hay chuyển tới bất kỳ địa chỉ nào — không tự viết lại phép so host/đường dẫn ở chỗ khác.
//
// THUẦN: không DB, không next/react, không đồng hồ — dùng được ở route công khai, edge và cả trình duyệt (màn «Thử URL» chạy CHÍNH hàm này ở máy người dùng,
// URL dán vào không rời trình duyệt).
//
// ── Vì sao KHÔNG chỉ `new URL()` ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Bộ phân tích URL của WHATWG SỬA CHỮA thay vì từ chối (đo bằng node trên máy này):
//   `https:///quatang.edu.vn/x`            ⇒ host quatang.edu.vn       (dư dấu gạch chéo bị bỏ)
//   `https:\\evil.com`                      ⇒ host evil.com             (`\` bị coi như `/`)
//   `…/khoa-<TAB>hoc/x`                     ⇒ `/khoa-hoc/x`            (TAB/CR/LF bị XOÁ khỏi bất cứ đâu)
//   `…/khoa-hoc/../admin`, `/%2e%2e/admin`  ⇒ `/admin`                  (đi lên thư mục cha được giải quyết ngầm)
//   `quatang。edu。vn`, `quatang%2eedu.vn`  ⇒ quatang.edu.vn            (dấu chấm toàn chiều rộng / mã hoá % trong host)
//   `0x7f.1`                                ⇒ 127.0.0.1                 (số viết kiểu khác)
//   `quatang.edu.vn:443`                    ⇒ cổng "" (cổng mặc định bị nuốt); `quatang.edu.vn.` GIỮ dấu chấm cuối
//   `…/x%2f..%2fadmin`                      ⇒ GIỮ NGUYÊN (`%2f` không được giải mã) — nhưng máy chủ đích giải mã thì đi lên thư mục cha.
// Mỗi dòng trên là một «lệch pha bộ phân tích» (parser differential): chỗ này hiểu một địa chỉ, chỗ kia hiểu địa chỉ khác. Nên thứ tự bắt buộc là
//   (1) kiểm chuỗi THÔ → (2) phân tích → (3) so sánh SAU KHI chuẩn hoá, và mọi thứ không chắc ⇒ TỪ CHỐI (deny-by-default). Host so BẰNG-CHÍNH-XÁC trên chuỗi đã chuẩn hoá
// (không `endsWith`, không `includes`, không wildcard — `www.quatang.edu.vn` KHÔNG khớp khi chỉ khai `quatang.edu.vn`).
//
// ── Quyết định ngữ nghĩa (đã chốt trong đợt này; đổi một dòng là đổi hợp đồng cho P1) ───────────────────────────────────────────────────────────────────
//  · Chỉ `https`, KHÔNG cổng (kể cả `:443` tường minh — từ chối còn hơn đoán), KHÔNG userinfo (`evil.com@quatang.edu.vn`), KHÔNG địa chỉ IP / `[::1]`.
//  · Query và fragment BỊ BỎ khi so khớp và KHÔNG được trả về như một phần được phép (kết quả chỉ có host + đường dẫn); P1 tự gắn tham số của nó.
//  · Đường dẫn mẫu: «đúng» (`/khoa-robotics`) hoặc «tiền tố» (`/khoa-hoc/*`). Tiền tố PHẢI kết thúc bằng `/*` (chặt hơn CHECK của DB cho phép `/khoa*`: `/khoa*` sẽ khớp
//    `/khoa-admin`). `/khoa-hoc/*` khớp `/khoa-hoc`, `/khoa-hoc/` và `/khoa-hoc/a/b`, KHÔNG khớp `/khoa-hocx`. Một dấu `/` cuối được bỏ khi so (`/x` khớp `/x/`).
//    Phân biệt hoa/thường (đường dẫn máy chủ phân biệt). `/*` = cả website (Admin chủ động khai).
//  · Ký tự trong mẫu: chữ ASCII, số, `- . _ ~ /` — KHÔNG `%` (slug có dấu khai bằng dạng đã mã hoá là việc của P1+, chưa cần cho P0).
//  · Tên miền khai: chữ thường, ≥ 2 nhãn, mỗi nhãn 1–63 ký tự `[a-z0-9-]` không bắt đầu/kết thúc bằng `-`, tổng ≤ 253; nhãn `xn--` được nhận NẾU bộ phân tích chấp nhận (round-trip).
//    Không đoán: dấu chấm cuối, ký tự ngoài ASCII, đường dẫn, scheme, `*`, cổng ⇒ từ chối (người khai gõ lại, không bị sửa ngầm).
//  · Gốc URL (baseUrl): `https://<tên-miền>` — KHÔNG đường dẫn (đường dẫn cụ thể khai ở Trang đích), KHÔNG query/fragment. Chuẩn hoá bỏ dấu `/` cuối.

/** Trần độ dài của một URL nhận vào (ký tự). Trình duyệt/máy chủ thường cắt ở 2–8 KB; quá 2 KB là bất thường với link giới thiệu. */
export const DO_DAI_URL_TOI_DA = 2048;
/** Trần độ dài của một mẫu đường dẫn. */
export const DO_DAI_MAU_TOI_DA = 200;

// ── Mã lỗi máy + nhãn tiếng Việt ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `as const` + `Record<MaLyDo, string>`: thêm mã mà quên nhãn là LỖI BIÊN DỊCH (luật 7). Mã là hợp đồng với P1 (log, đo lường) — đừng đổi tên.
export const MA_LY_DO = [
  "RONG",
  "QUA_DAI",
  "KY_TU_CAM",
  "GACH_CHEO_NGUOC",
  "KHONG_PHAI_HTTPS",
  "THIEU_TEN_MIEN",
  "CO_USERINFO",
  "TEN_MIEN_MA_HOA",
  "CONG_LA",
  "URL_KHONG_HOP_LE",
  "TEN_MIEN_KHONG_CHUAN",
  "TEN_MIEN_DAU_CHAM_CUOI",
  "HOST_KHONG_DUOC_PHEP",
  "SITE_NGUNG",
  "SITE_TAT_THEO_DOI",
  "DUONG_DAN_HAI_GACH",
  "DUONG_DAN_MA_HOA_NGUY_HIEM",
  "DUONG_DAN_LEO_THANG",
  "KHONG_CO_TRANG_DICH",
  "CO_QUERY",
  "BASEURL_CO_DUONG_DAN",
] as const;
export type MaLyDo = (typeof MA_LY_DO)[number];

export const NHAN_LY_DO: Record<MaLyDo, string> = {
  RONG: "Chưa có địa chỉ nào để kiểm.",
  QUA_DAI: `Địa chỉ dài quá ${DO_DAI_URL_TOI_DA} ký tự.`,
  KY_TU_CAM: "Địa chỉ chứa dấu cách, ký tự xuống dòng, tab hoặc ký tự điều khiển — bỏ chúng đi.",
  GACH_CHEO_NGUOC: "Địa chỉ chứa dấu gạch chéo ngược (\\). Chỉ dùng dấu gạch chéo xuôi (/).",
  KHONG_PHAI_HTTPS: "Địa chỉ phải bắt đầu bằng https:// (không nhận http://, //, javascript:, data: hay dạng viết tắt).",
  THIEU_TEN_MIEN: "Sau https:// phải có tên miền ngay (không để dư dấu gạch chéo).",
  CO_USERINFO: "Địa chỉ có phần «tên@» trước tên miền — dạng này hay dùng để giả mạo, không được phép.",
  TEN_MIEN_MA_HOA: "Tên miền chứa ký tự mã hoá (%). Gõ tên miền thẳng.",
  CONG_LA: "Địa chỉ có cổng hoặc là địa chỉ IP. Chỉ nhận tên miền, cổng mặc định.",
  URL_KHONG_HOP_LE: "Địa chỉ không đọc được. Kiểm tra lại cách gõ.",
  TEN_MIEN_KHONG_CHUAN: "Tên miền không ở dạng chuẩn (ký tự lạ, số viết kiểu khác hoặc chữ ngoài ASCII).",
  TEN_MIEN_DAU_CHAM_CUOI: "Tên miền kết thúc bằng dấu chấm. Bỏ dấu chấm cuối.",
  HOST_KHONG_DUOC_PHEP: "Tên miền không nằm trong danh sách tên miền được phép của website này (so khớp chính xác, không tính tên miền con).",
  SITE_NGUNG: "Website này đang ngừng hoạt động.",
  SITE_TAT_THEO_DOI: "Website này đang tắt theo dõi.",
  DUONG_DAN_HAI_GACH: "Đường dẫn chứa hai dấu gạch chéo liền nhau (//).",
  DUONG_DAN_MA_HOA_NGUY_HIEM: "Đường dẫn chứa ký tự mã hoá nguy hiểm (%2f, %5c, %00, %25).",
  DUONG_DAN_LEO_THANG: "Đường dẫn có đoạn «.» hoặc «..» (đi lên thư mục cha), kể cả dạng mã hoá.",
  KHONG_CO_TRANG_DICH: "Đường dẫn này chưa có trang đích nào đang bật khớp với nó.",
  CO_QUERY: "Gốc URL không được kèm dấu ? hoặc #.",
  BASEURL_CO_DUONG_DAN: "Gốc URL chỉ gồm https://tên-miền. Đường dẫn cụ thể khai ở mục Trang đích.",
};

export function nhanLyDo(ma: MaLyDo): string {
  return NHAN_LY_DO[ma];
}

// ── Chuẩn hoá tên miền ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaTenMien = { ok: true; tenMien: string } | { ok: false; loi: string };

/**
 * Kiểm + chuẩn hoá MỘT tên miền người dùng khai trong «Tên miền được phép». Chỉ cắt khoảng trắng hai đầu và hạ chữ thường; mọi thứ khác sai ⇒ từ chối kèm câu nói rõ sai gì.
 * Đi qua bộ phân tích URL để bảo đảm tên miền giữ nguyên (round-trip) — bắt nhãn `xn--` hỏng, ký tự lạ.
 */
export function kiemTenMien(raw: unknown): KetQuaTenMien {
  if (typeof raw !== "string") return { ok: false, loi: "Tên miền không hợp lệ." };
  const d = raw.trim().toLowerCase();
  if (d === "") return { ok: false, loi: "Tên miền đang trống." };
  if (d.length > 253) return { ok: false, loi: "Tên miền dài quá 253 ký tự." };
  if (d.includes("://") || d.includes("/") || d.includes("?") || d.includes("#") || d.includes("\\")) {
    return { ok: false, loi: "Chỉ gõ tên miền (ví dụ quatang.edu.vn), không kèm https:// hay đường dẫn." };
  }
  if (d.includes("@")) return { ok: false, loi: "Tên miền không được có ký tự @." };
  if (d.includes(":")) return { ok: false, loi: "Tên miền không được kèm cổng hoặc là địa chỉ IPv6." };
  if (d.includes("*")) return { ok: false, loi: "Chưa hỗ trợ ký tự đại diện (*). Khai từng tên miền, kể cả tên miền con." };
  if (/\s/u.test(d)) return { ok: false, loi: "Tên miền không được có dấu cách." };
  if (/[^\x21-\x7e]/.test(d)) return { ok: false, loi: "Tên miền chỉ gồm chữ không dấu, số, dấu chấm và dấu gạch ngang. Tên miền có dấu phải khai ở dạng xn--…" };
  if (d.startsWith(".") || d.endsWith(".")) return { ok: false, loi: "Tên miền không được bắt đầu hoặc kết thúc bằng dấu chấm." };
  if (d.includes("..")) return { ok: false, loi: "Tên miền có hai dấu chấm liền nhau." };
  const nhan = d.split(".");
  if (nhan.length < 2) return { ok: false, loi: "Tên miền cần ít nhất hai phần (ví dụ quatang.edu.vn)." };
  for (const n of nhan) {
    if (n.length < 1 || n.length > 63) return { ok: false, loi: "Mỗi phần của tên miền dài 1–63 ký tự." };
    if (!/^[a-z0-9-]+$/.test(n)) return { ok: false, loi: "Tên miền chỉ gồm chữ không dấu, số, dấu chấm và dấu gạch ngang." };
    if (n.startsWith("-") || n.endsWith("-")) return { ok: false, loi: "Mỗi phần của tên miền không được bắt đầu hoặc kết thúc bằng dấu gạch ngang." };
  }
  if (/^[0-9]+$/.test(nhan[nhan.length - 1] ?? "")) return { ok: false, loi: "Phần cuối của tên miền không thể toàn số (đó là địa chỉ IP, không phải tên miền)." };
  let host: string;
  try {
    host = new URL(`https://${d}/`).hostname;
  } catch {
    return { ok: false, loi: "Tên miền không hợp lệ." };
  }
  if (host !== d) return { ok: false, loi: "Tên miền không ở dạng chuẩn." };
  return { ok: true, tenMien: d };
}

/** Dạng rút gọn của `kiemTenMien`: tên miền đã chuẩn hoá hoặc `null`. */
export function chuanHoaTenMien(raw: unknown): string | null {
  const kq = kiemTenMien(raw);
  return kq.ok ? kq.tenMien : null;
}

/** Danh sách tên miền ĐÃ chuẩn hoá, bỏ mục không hợp lệ, bỏ trùng (giữ thứ tự). Dùng để so khớp — mục hỏng KHÔNG BAO GIỜ khớp. */
function tenMienHopLe(ds: readonly string[]): string[] {
  const ra: string[] = [];
  for (const raw of ds) {
    const d = chuanHoaTenMien(raw);
    if (d !== null && !ra.includes(d)) ra.push(d);
  }
  return ra;
}

// ── Chuỗi THÔ: những thứ phải chặn TRƯỚC khi đưa cho bộ phân tích ────────────────────────────────────────────────────────────────────────────────────

/** Ký tự điều khiển, khoảng trắng mọi loại (kể cả Unicode), ký tự định dạng vô hình (zero-width, bidi). Bộ phân tích URL XOÁ NGẦM tab/CR/LF — phải chặn ở chuỗi thô. */
const KY_TU_CAM_RE = /[\p{Cc}\p{Cf}\p{Z}]/u;

type PhanTich = { ok: true; url: URL; host: string; duongTho: string; conLai: string } | { ok: false; lyDo: MaLyDo };

/** Các bước 1–2 dùng chung cho gốc URL và URL đích: chuỗi thô → phân tích → khẳng định bộ phân tích không sửa gì đáng kể. */
function phanTichHttps(raw: unknown): PhanTich {
  if (typeof raw !== "string" || raw === "") return { ok: false, lyDo: "RONG" };
  if (raw.length > DO_DAI_URL_TOI_DA) return { ok: false, lyDo: "QUA_DAI" };
  if (KY_TU_CAM_RE.test(raw)) return { ok: false, lyDo: "KY_TU_CAM" };
  if (raw.includes("\\")) return { ok: false, lyDo: "GACH_CHEO_NGUOC" };
  if (raw.slice(0, 8).toLowerCase() !== "https://") return { ok: false, lyDo: "KHONG_PHAI_HTTPS" };

  const sau = raw.slice(8);
  let iHetTenMien = sau.length;
  for (let i = 0; i < sau.length; i += 1) {
    const c = sau[i];
    if (c === "/" || c === "?" || c === "#") {
      iHetTenMien = i;
      break;
    }
  }
  const authority = sau.slice(0, iHetTenMien);
  const conLai = sau.slice(iHetTenMien);
  if (authority === "") return { ok: false, lyDo: "THIEU_TEN_MIEN" };
  if (authority.includes("@")) return { ok: false, lyDo: "CO_USERINFO" };
  if (authority.includes("%")) return { ok: false, lyDo: "TEN_MIEN_MA_HOA" };
  if (authority.includes(":")) return { ok: false, lyDo: "CONG_LA" };

  // Đường dẫn THÔ = từ chỗ hết tên miền tới dấu ? hoặc # đầu tiên.
  let iHetDuong = conLai.length;
  for (let i = 0; i < conLai.length; i += 1) {
    const c = conLai[i];
    if (c === "?" || c === "#") {
      iHetDuong = i;
      break;
    }
  }
  const duongTho = conLai.slice(0, iHetDuong);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, lyDo: "URL_KHONG_HOP_LE" };
  }
  if (url.protocol !== "https:") return { ok: false, lyDo: "KHONG_PHAI_HTTPS" };
  if (url.username !== "" || url.password !== "") return { ok: false, lyDo: "CO_USERINFO" };
  if (url.port !== "") return { ok: false, lyDo: "CONG_LA" };
  if (url.hostname.endsWith(".")) return { ok: false, lyDo: "TEN_MIEN_DAU_CHAM_CUOI" };
  // Bộ phân tích đổi tên miền thành thứ khác (chấm toàn chiều rộng, số kiểu 0x7f, Unicode → punycode…) ⇒ hai bên hiểu hai địa chỉ ⇒ từ chối.
  if (url.hostname !== authority.toLowerCase()) return { ok: false, lyDo: "TEN_MIEN_KHONG_CHUAN" };
  return { ok: true, url, host: url.hostname, duongTho, conLai };
}

/**
 * Kiểm một đường dẫn: không `//`, không `%2f` `%5c` `%00` `%25`, không đoạn `.`/`..` (kể cả `%2e`). Dùng cho đường dẫn THÔ (trước khi bộ phân tích giải quyết `..`)
 * lẫn đường dẫn đã chuẩn hoá (lớp phòng thủ thứ hai). `null` = sạch.
 */
function loiDuongDan(duong: string): MaLyDo | null {
  if (duong.includes("//")) return "DUONG_DAN_HAI_GACH";
  const thuong = duong.toLowerCase();
  if (thuong.includes("%2f") || thuong.includes("%5c") || thuong.includes("%00") || thuong.includes("%25")) return "DUONG_DAN_MA_HOA_NGUY_HIEM";
  for (const doan of thuong.split("/")) {
    const giaiMa = doan.split("%2e").join(".");
    if (giaiMa === "." || giaiMa === "..") return "DUONG_DAN_LEO_THANG";
  }
  return null;
}

// ── Gốc URL của website ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaBaseUrl = { ok: true; baseUrl: string; host: string } | { ok: false; lyDo: MaLyDo };

/**
 * Kiểm + chuẩn hoá gốc URL của một website: https, tên miền ∈ `allowedDomains` (so bằng-chính-xác), không cổng/userinfo/đường dẫn/query/fragment.
 * Trả `baseUrl` ở dạng `https://<host>` (bỏ dấu `/` cuối).
 */
export function kiemBaseUrl(raw: unknown, allowedDomains: readonly string[]): KetQuaBaseUrl {
  const p = phanTichHttps(raw);
  if (!p.ok) return p;
  if (p.conLai.includes("?") || p.conLai.includes("#")) return { ok: false, lyDo: "CO_QUERY" };
  if (p.duongTho !== "" && p.duongTho !== "/") return { ok: false, lyDo: "BASEURL_CO_DUONG_DAN" };
  if (!tenMienHopLe(allowedDomains).includes(p.host)) return { ok: false, lyDo: "HOST_KHONG_DUOC_PHEP" };
  return { ok: true, baseUrl: `https://${p.host}`, host: p.host };
}

// ── Đường dẫn mẫu của trang đích ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaMau = { ok: true; mau: string; kieu: "CHINH_XAC" | "TIEN_TO" } | { ok: false; loi: string };

/**
 * Kiểm + chuẩn hoá một MẪU đường dẫn (trang đích): `/khoa-robotics` (đúng) hoặc `/khoa-hoc/*` (tiền tố). Khớp CHECK `AffiliateLandingPage_path_chk` của migration và CHẶT HƠN nó
 * (tiền tố phải kết thúc `/*`; chỉ ký tự `[A-Za-z0-9-._~/]`; không `//`; không đoạn chỉ gồm dấu chấm). Dấu `/` cuối của mẫu «đúng» được bỏ (trừ gốc `/`).
 */
export function chuanHoaDuongDanMau(raw: unknown): KetQuaMau {
  if (typeof raw !== "string") return { ok: false, loi: "Đường dẫn không hợp lệ." };
  const m = raw.trim();
  if (m === "") return { ok: false, loi: "Đường dẫn đang trống." };
  if (m.length > DO_DAI_MAU_TOI_DA) return { ok: false, loi: `Đường dẫn dài quá ${DO_DAI_MAU_TOI_DA} ký tự.` };
  if (!m.startsWith("/")) return { ok: false, loi: "Đường dẫn phải bắt đầu bằng dấu / (ví dụ /khoa-robotics)." };
  if (/\s/u.test(m) || KY_TU_CAM_RE.test(m)) return { ok: false, loi: "Đường dẫn không được có dấu cách hay ký tự điều khiển." };
  if (m.includes("?") || m.includes("#")) return { ok: false, loi: "Đường dẫn không kèm dấu ? hoặc # (tham số do hệ thống gắn sau)." };
  if (m.includes("\\")) return { ok: false, loi: "Chỉ dùng dấu gạch chéo xuôi (/)." };
  if (m.includes("%")) return { ok: false, loi: "Đường dẫn không chứa ký tự mã hoá (%). Dùng đường dẫn không dấu." };
  const daoSao = m.indexOf("*");
  const tienTo = daoSao !== -1;
  if (tienTo && (daoSao !== m.length - 1 || m.length < 2 || m[m.length - 2] !== "/")) {
    return { ok: false, loi: "Dấu * chỉ được đứng ở cuối và ngay sau dấu / (ví dụ /khoa-hoc/*)." };
  }
  const than = tienTo ? m.slice(0, -1) : m; // tiền tố: giữ dấu / cuối của phần gốc
  if (!/^[A-Za-z0-9\-._~/]+$/.test(than)) return { ok: false, loi: "Đường dẫn chỉ gồm chữ không dấu, số và các ký tự - . _ ~ /." };
  if (than.includes("//")) return { ok: false, loi: "Đường dẫn không có hai dấu / liền nhau." };
  for (const doan of than.split("/")) {
    if (doan !== "" && /^\.+$/.test(doan)) return { ok: false, loi: "Đường dẫn không có đoạn chỉ gồm dấu chấm (. hoặc ..)." };
  }
  if (tienTo) return { ok: true, mau: m, kieu: "TIEN_TO" };
  const chuan = m.length > 1 && m.endsWith("/") ? m.slice(0, -1) : m;
  return { ok: true, mau: chuan, kieu: "CHINH_XAC" };
}

/** Đường dẫn ĐÃ qua bộ phân tích có an toàn để so với mẫu không (bắt đầu `/`, không `//`, không `\`, không đoạn leo thang, không mã hoá nguy hiểm, không ký tự cấm). */
function duongDanAnToan(path: string): boolean {
  if (path === "" || !path.startsWith("/") || path.length > DO_DAI_URL_TOI_DA) return false;
  if (path.includes("\\") || path.includes("?") || path.includes("#")) return false;
  if (KY_TU_CAM_RE.test(path)) return false;
  return loiDuongDan(path) === null;
}

/**
 * Đường dẫn `path` (dạng pathname, KHÔNG query/fragment) có khớp mẫu `pattern` không. Mẫu hỏng ⇒ false. Đường dẫn bất thường (leo thang, `//`, mã hoá nguy hiểm…) ⇒ false.
 * Ngữ nghĩa xem đầu tệp: «đúng» so bằng sau khi bỏ một dấu `/` cuối; «tiền tố» `/a/*` khớp `/a`, `/a/`, `/a/b`, không khớp `/ax`.
 */
export function khopDuongDan(pattern: string, path: string): boolean {
  const m = chuanHoaDuongDanMau(pattern);
  if (!m.ok) return false;
  if (typeof path !== "string" || !duongDanAnToan(path)) return false;
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (m.kieu === "CHINH_XAC") return p === m.mau;
  const goc = m.mau.slice(0, -2); // bỏ "/*" ⇒ "" cho "/*"
  if (goc === "") return true;
  return p === goc || p.startsWith(`${goc}/`);
}

/**
 * Trang đích ĐANG BẬT (bật + bật theo dõi) có đúng tên miền `host` và khớp `path`. Nhiều trang cùng khớp ⇒ chọn CHÍNH XÁC trước (`/x` hơn `/*`), rồi tiền tố dài nhất, rồi theo thứ tự đầu vào
 * (xác định, không phụ thuộc thứ tự bảng). THUẦN — cổng `kiemUrlDuocPhep` và cổng «link còn hiệu lực» (`ghi-link-dau-vao.ts`) cùng dùng, không viết lại phép khớp ở chỗ khác.
 */
export function chonTrangKhop<T extends TrangDichDeKiem>(trangDich: readonly T[], host: string, path: string): T | null {
  let tot: T | null = null;
  let diem = -1;
  for (const t of trangDich) {
    if (!t.isActive || !t.trackingEnabled || t.host !== host || !khopDuongDan(t.pathPattern, path)) continue;
    const m = chuanHoaDuongDanMau(t.pathPattern);
    const d = m.ok && m.kieu === "CHINH_XAC" ? 1_000_000 : t.pathPattern.length;
    if (d > diem) {
      tot = t;
      diem = d;
    }
  }
  return tot;
}

// ── CỔNG chính: URL có được phép không ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Phần của website mà phép kiểm cần. (Trường thừa ở đối tượng truyền vào bị bỏ qua.) */
export type SiteDeKiem = { allowedDomains: readonly string[]; status: "ACTIVE" | "INACTIVE"; trackingEnabled: boolean };
/**
 * Phần của trang đích mà phép kiểm cần. Trang đang tắt (`isActive: false`) hoặc tắt theo dõi RIÊNG (`trackingEnabled: false`) KHÔNG được tính.
 * AFF-L6: `host` là tên miền ĐÃ GIẢI của trang đích (host riêng ∨ host của baseUrl của website) và BẮT BUỘC (luật 7) — thiếu thì `tsc` liệt kê nơi gọi. Trang đích chỉ khớp một URL có ĐÚNG tên miền đó:
 * cùng đường dẫn `/` trên `quatang.edu.vn` và `covua.quatang.edu.vn` là hai trang đích khác nhau.
 */
export type TrangDichDeKiem = { pathPattern: string; isActive: boolean; host: string; trackingEnabled: boolean };

export type KetQuaUrl<T extends TrangDichDeKiem = TrangDichDeKiem> =
  | {
      ok: true;
      /** Tên miền đã chuẩn hoá (chữ thường). */
      host: string;
      /** Đường dẫn đã chuẩn hoá (pathname). KHÔNG có query/fragment. */
      path: string;
      /** `https://<host><path>` — địa chỉ chuẩn, không query/fragment. P1 gắn tham số của nó vào đây. */
      url: string;
      /** Mẫu trang đích đã khớp. */
      trangDichKhop: string;
      /** Trang đích đã khớp (cả đối tượng truyền vào — nơi gọi lấy `id` từ đây). Nhiều trang cùng khớp ⇒ ưu tiên đường dẫn CHÍNH XÁC, rồi tiền tố dài nhất. */
      trang: T;
    }
  | { ok: false; lyDo: MaLyDo };

/** Host của một gốc URL (`https://<host>`), chữ thường — hoặc null nếu không đọc được. */
export function hostCuaBaseUrl(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return u.hostname === "" ? null : u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** `host` có nằm trong danh sách tên miền được phép không (so bằng-chính-xác trên bản đã chuẩn hoá; mục hỏng không bao giờ khớp). */
export function hostTrongDanhSach(allowedDomains: readonly string[], host: string): boolean {
  return tenMienHopLe(allowedDomains).includes(host);
}

/**
 * Cổng chặn open-redirect / link giả mạo: URL `raw` chỉ được phép khi (theo thứ tự kiểm)
 *   chuỗi thô sạch → https, không userinfo/cổng/IP → tên miền ∈ `site.allowedDomains` (bằng-chính-xác) → website ACTIVE ∧ theo dõi bật
 *   → đường dẫn không leo thang/mã hoá nguy hiểm → khớp ÍT NHẤT MỘT trang đích đang bật.
 * Trả mã lỗi máy (`lyDo`, xem `MA_LY_DO`) — chữ tiếng Việt ở `NHAN_LY_DO`/`nhanLyDo`.
 */
export function kiemUrlDuocPhep<T extends TrangDichDeKiem>(raw: unknown, site: SiteDeKiem, trangDich: readonly T[]): KetQuaUrl<T> {
  const p = phanTichHttps(raw);
  if (!p.ok) return p;
  if (!tenMienHopLe(site.allowedDomains).includes(p.host)) return { ok: false, lyDo: "HOST_KHONG_DUOC_PHEP" };
  if (site.status !== "ACTIVE") return { ok: false, lyDo: "SITE_NGUNG" };
  if (!site.trackingEnabled) return { ok: false, lyDo: "SITE_TAT_THEO_DOI" };
  // Lớp 1: đường dẫn THÔ (trước khi bộ phân tích giải quyết `..` / bỏ tab) — nếu chỉ nhìn pathname đã chuẩn hoá thì `/khoa-hoc/../khoa-hoc/x` trông hợp lệ.
  const loiTho = loiDuongDan(p.duongTho);
  if (loiTho !== null) return { ok: false, lyDo: loiTho };
  // Lớp 2: đường dẫn sau chuẩn hoá.
  const path = p.url.pathname;
  const loiSau = loiDuongDan(path);
  if (loiSau !== null) return { ok: false, lyDo: loiSau };
  const khop = chonTrangKhop(trangDich, p.host, path);
  if (khop !== null) return { ok: true, host: p.host, path, url: `https://${p.host}${path}`, trangDichKhop: khop.pathPattern, trang: khop };
  return { ok: false, lyDo: "KHONG_CO_TRANG_DICH" };
}
