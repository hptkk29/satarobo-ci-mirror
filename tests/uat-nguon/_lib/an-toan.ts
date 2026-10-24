// tests/uat-nguon/_lib/an-toan.ts — các cổng AN TOÀN THUẦN của bộ UAT Nguồn trên test.satarobo.vn (không import Playwright, không chạm mạng).
//
// Bộ này đăng nhập THẬT bằng tài khoản `uat.*` vào một địa chỉ HTTPS. Hai việc không được sai:
//   1. nó chỉ được nói chuyện với `test.satarobo.vn` — không bao giờ prod (`satarobo.vn`, `admin.`, `hocvien.`, `giaovien.`…);
//   2. mật khẩu UAT không được lọt vào nhật ký / ảnh chụp JSON / báo cáo.
//
// Hai cổng ở đây được dùng ở BA nơi (cấu hình Playwright · fixture phiên · workflow) — và workflow còn ghim cứng địa chỉ,
// không nhận từ input. Lưới `lib/uat/uat-nguon-harness.test.ts` cấy lỗi vào từng cổng.

/** Host DUY NHẤT được phép ở chế độ chạy thật. So sánh NGUYÊN CHUỖI (không `endsWith`, không `includes`). */
export const HOST_TEST = "test.satarobo.vn";

/** Chỉ dùng cho người viết bộ này chạy thử trên máy mình (cờ `UAT_MAY_DEV=1`). Workflow KHÔNG BAO GIỜ đặt cờ đó. */
const HOST_MAY_DEV: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

export type MoiTruongUat = {
  /** `https://test.satarobo.vn` (không dấu `/` cuối) — hoặc `http://localhost:<cổng>` khi `mayDev`. */
  origin: string;
  /** host:cổng của origin — thứ duy nhất request được phép gọi tới (xem `phanLoaiRequest`). */
  host: string;
  mayDev: boolean;
};

export type KetQuaMoiTruong = { ok: true; env: MoiTruongUat } | { ok: false; lyDo: string };

/**
 * Địa chỉ đưa vào có phải môi trường TEST không. Fail-closed: mọi thứ lạ ⇒ `ok: false`.
 *
 * `mayDev` KHÔNG có mặc định (luật 7): người gọi phải nói rõ. Chỉ `true` khi biến `UAT_MAY_DEV === "1"`.
 */
export function kiemMoiTruong(raw: string | undefined | null, mayDev: boolean): KetQuaMoiTruong {
  const s = (raw ?? "").trim();
  if (s === "") return { ok: false, lyDo: "Thiếu địa chỉ môi trường (UAT_BASE_URL)." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, lyDo: `Địa chỉ không phân tích được: «${s.slice(0, 80)}».` };
  }
  // Thông tin đăng nhập nhúng trong URL (`https://test.satarobo.vn@satarobo.vn`) là mẹo đánh lừa kinh điển.
  if (u.username !== "" || u.password !== "") return { ok: false, lyDo: "Địa chỉ không được chứa user:pass@." };
  if (u.search !== "" || u.hash !== "" || (u.pathname !== "/" && u.pathname !== "")) {
    return { ok: false, lyDo: "Địa chỉ phải là gốc (origin) thuần: không đường dẫn, không query, không #." };
  }
  if (u.hostname === HOST_TEST) {
    if (u.protocol !== "https:") return { ok: false, lyDo: "Môi trường test phải là https." };
    if (u.port !== "") return { ok: false, lyDo: "Môi trường test không có cổng riêng." };
    return { ok: true, env: { origin: `https://${HOST_TEST}`, host: HOST_TEST, mayDev: false } };
  }
  if (mayDev && HOST_MAY_DEV.has(u.hostname) && u.protocol === "http:") {
    return { ok: true, env: { origin: `http://${u.host}`, host: u.host, mayDev: true } };
  }
  return {
    ok: false,
    lyDo: `Host «${u.hostname}» không được phép. Bộ UAT này chỉ chạy trên ${HOST_TEST} — KHÔNG BAO GIỜ trên prod.`,
  };
}

/** Như `kiemMoiTruong` nhưng ném lỗi — dùng ở cấu hình/fixture để dừng cả lượt chạy. */
export function layMoiTruong(raw: string | undefined | null, mayDev: boolean): MoiTruongUat {
  const r = kiemMoiTruong(raw, mayDev);
  if (!r.ok) throw new Error(`[UAT-NGUON] Từ chối chạy: ${r.lyDo}`);
  return r.env;
}

/** Đọc từ biến môi trường của tiến trình. `UAT_MAY_DEV` chỉ nhận đúng chuỗi "1". */
export function moiTruongTuEnv(env: Readonly<Record<string, string | undefined>>): MoiTruongUat {
  return layMoiTruong(env.UAT_BASE_URL, env.UAT_MAY_DEV === "1");
}

/**
 * Một request của trình duyệt có được đi tiếp không.
 *
 * Vì sao cần: test chạy qua `unknown`-host nên không có chuyển host, nhưng cookie phiên của app có thể rộng, và một
 * redirect lạc sang `admin.satarobo.vn` (prod) kèm cookie là đúng loại tai nạn phải chặn bằng MÁY, không bằng niềm tin.
 *   · cùng host với môi trường        ⇒ cho;
 *   · `data:` / `blob:` / `about:`    ⇒ cho;
 *   · chuyển trang (navigation) sang host khác, hoặc BẤT KỲ request nào tới `satarobo.vn` / `*.satarobo.vn` khác host test
 *                                     ⇒ CHẶN (và ghi lại thành lỗi);
 *   · tài nguyên tĩnh bên thứ ba (font, ảnh…) ⇒ cho — chặn hết sẽ làm ảnh chụp vỡ mà không bảo vệ thêm gì.
 */
export function phanLoaiRequest(url: string, laChuyenTrang: boolean, env: MoiTruongUat): "cho" | "chan" {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "chan";
  }
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return "cho";
  if (u.host === env.host) return "cho";
  const hostThat = u.hostname.toLowerCase();
  if (hostThat === "satarobo.vn" || hostThat.endsWith(".satarobo.vn")) return "chan";
  if (laChuyenTrang) return "chan";
  return "cho";
}

/**
 * Thay mọi lần xuất hiện của bí mật trong một chuỗi bằng `***`. Bí mật ngắn hơn 6 ký tự bị bỏ qua (tránh thay lung tung
 * trên chuỗi thường) — mật khẩu UAT bắt buộc ≥ 8 ký tự nên không sót.
 */
export function cheBiMat(s: string, biMat: readonly string[]): string {
  let ra = s;
  for (const b of biMat) {
    if (b.length >= 6) ra = ra.split(b).join("***");
  }
  return ra;
}

/** Đi sâu qua object/mảng, che bí mật trong mọi chuỗi (cả khoá). Giá trị không phải chuỗi giữ nguyên. */
export function cheBiMatSau<T>(v: T, biMat: readonly string[]): T {
  if (typeof v === "string") return cheBiMat(v, biMat) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => cheBiMatSau(x, biMat)) as unknown as T;
  if (v !== null && typeof v === "object") {
    const ra: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) ra[cheBiMat(k, biMat)] = cheBiMatSau(x, biMat);
    return ra as T;
  }
  return v;
}

/** Tách mã ca `[SRC-01]` ở đầu tên test. `null` nếu tên không theo khuôn. */
export function maCaTuTen(tenTest: string): string | null {
  const m = /^\[(SRC-\d{2}[a-z]?)\]/.exec(tenTest.trim());
  return m ? m[1]! : null;
}

/**
 * Mã đợt chạy dùng làm tiền tố dữ liệu (`UAT SOURCE FINAL <mã>`) — chữ HOA + số, 6–14 ký tự, ổn định trong MỘT lượt chạy.
 * Workflow đặt `UAT_RUN_CODE` từ run id; chạy tay thì sinh một lần từ `bayGio`.
 */
export function maDotChay(envMa: string | undefined, bayGio: number): string {
  const sach = (envMa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (sach.length >= 4 && sach.length <= 14) return sach;
  return `L${bayGio.toString(36).toUpperCase()}`.slice(0, 14);
}

/** Tiền tố của MỌI bản ghi bộ UAT này tạo ra — để người sau tìm lại / để lane khác nhận ra là dữ liệu bằng chứng. */
export const TIEN_TO_DU_LIEU = "UAT SOURCE FINAL";

/** Mã nguồn (`code`: HOA + số + gạch dưới, 3–40 ký tự) cho nguồn thử của đợt chạy. */
export function maNguon(dot: string, hau: string): string {
  return `UAT_SOURCE_FINAL_${dot}_${hau}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 40);
}

/** Tên hiển thị của nguồn/phiếu thử. */
export function tenDuLieu(dot: string, hau: string): string {
  return `${TIEN_TO_DU_LIEU} ${dot} ${hau}`.trim();
}
