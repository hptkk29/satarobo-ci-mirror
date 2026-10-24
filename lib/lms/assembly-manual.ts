import { z } from "zod";

// TÀI LIỆU LẮP RÁP 3D (ZMROBO) — luật kiểm đường dẫn, MỘT chỗ cho cả ba nơi dùng:
//   · server action lưu (curriculums/_actions.ts)  — chặn ở tầng GHI
//   · form admin (báo lỗi sớm, nút "Mở kiểm tra")   — chỉ để người nhập đỡ phải chờ server
//   · site giáo viên (hub-materials-tab)            — kiểm LẠI trước khi dựng <a href>
// Module thuần (không chạm DB), nên import được cả ở client lẫn server.
//
// V1 chỉ nhận đúng một dạng đường dẫn:
//   https://www.zmrobo.net/modelmanual/model?modelUrl=<đường dẫn mô hình>
// Server chỉ chịu trách nhiệm CẤU TRÚC — không tải trang, không biết mô hình có thật không.
// ⚠️ `z.string().url()` / `includes("zmrobo.net")` KHÔNG đủ: `new URL("javascript:alert(1)")` hợp lệ
// và `https://zmrobo.net.evil.com` có chứa chuỗi. Dùng bộ phân tích URL chuẩn, so host CHÍNH XÁC.

export const ASSEMBLY_MANUAL_HOST = "www.zmrobo.net";
export const ASSEMBLY_MANUAL_PATH = "/modelmanual/model";
export const ASSEMBLY_MANUAL_PARAM = "modelUrl";
export const ASSEMBLY_URL_MAX = 500;
export const ASSEMBLY_NAME_MAX = 120;

/** Ký tự điều khiển (kể cả tab/xuống dòng — bộ phân tích URL âm thầm NUỐT chúng, nên phải chặn trước). */
function coKyTuDieuKhien(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

export type AssemblyUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Kiểm cấu trúc đường dẫn. Trả về `url` ĐÃ CHUẨN HOÁ (`URL.href`): khoảng trắng trong tham số được
 * mã hoá thành `%20` đúng MỘT lần, còn `%20` có sẵn giữ nguyên (không mã hoá đôi).
 */
export function checkAssemblyManualUrl(raw: string): AssemblyUrlCheck {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Chưa nhập đường dẫn tài liệu lắp ráp" };
  if (text.length > ASSEMBLY_URL_MAX) {
    return { ok: false, error: `Đường dẫn dài quá ${ASSEMBLY_URL_MAX} ký tự` };
  }
  if (coKyTuDieuKhien(text)) {
    return { ok: false, error: "Đường dẫn chứa ký tự điều khiển (xuống dòng/tab…)" };
  }
  // Fragment: bộ phân tích coi "#" trơ là hash rỗng, nên phải soi chuỗi gốc.
  if (text.includes("#")) {
    return { ok: false, error: "Đường dẫn không được có phần # (fragment)" };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "Đường dẫn không đúng định dạng" };
  }

  if (url.protocol !== "https:") return { ok: false, error: "Đường dẫn phải bắt đầu bằng https://" };
  if (url.username || url.password) {
    return { ok: false, error: "Đường dẫn không được chứa tên đăng nhập/mật khẩu" };
  }
  // `:443` rõ ràng được bộ phân tích chuẩn hoá thành rỗng; mọi cổng khác đều bị chặn.
  if (url.port !== "") return { ok: false, error: "Đường dẫn không được dùng cổng khác" };
  if (url.hostname !== ASSEMBLY_MANUAL_HOST) {
    return { ok: false, error: `Chỉ nhận đường dẫn của ${ASSEMBLY_MANUAL_HOST}` };
  }
  if (url.pathname !== ASSEMBLY_MANUAL_PATH) {
    return {
      ok: false,
      error: `Đường dẫn phải là trang mô hình (${ASSEMBLY_MANUAL_PATH}?${ASSEMBLY_MANUAL_PARAM}=…)`,
    };
  }

  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== ASSEMBLY_MANUAL_PARAM || url.search.includes("&")) {
    return {
      ok: false,
      error: `Đường dẫn chỉ được có đúng một tham số ${ASSEMBLY_MANUAL_PARAM}`,
    };
  }
  const model = url.searchParams.get(ASSEMBLY_MANUAL_PARAM) ?? "";
  if (!model.trim()) return { ok: false, error: `Tham số ${ASSEMBLY_MANUAL_PARAM} đang trống` };

  // Độ dài đo CẢ trên dạng đã chuẩn hoá: dấu cách → %20, chữ có dấu → %XX%XX%XX làm chuỗi dài ra. Nếu chỉ đo
  // chuỗi thô thì giá trị lưu được có thể bị CHÍNH validator này từ chối lúc hiển thị (nút biến mất dù Đào tạo
  // thấy "Đã lưu") — lỗi câm.
  if (url.href.length > ASSEMBLY_URL_MAX) {
    return { ok: false, error: `Đường dẫn dài quá ${ASSEMBLY_URL_MAX} ký tự (sau khi mã hoá)` };
  }
  return { ok: true, url: url.href };
}

/**
 * Dùng lúc HIỂN THỊ: trả URL an toàn để dựng <a href>, hoặc null (⇒ ẩn nút). Kiểm lại dù lúc lưu
 * đã kiểm — dữ liệu có thể đến từ đường khác (SQL tay, import sau này) mà không qua action.
 */
export function safeAssemblyManualUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const r = checkAssemblyManualUrl(raw);
  return r.ok ? r.url : null;
}

/** Giá trị đã chuẩn hoá của MỘT bài; `null` = bài không có tài liệu lắp ráp. */
export type AssemblyManual = {
  url: string;
  setName: string | null;
  modelName: string | null;
};

function tenTuyChon(label: string) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      const t = (v ?? "").trim();
      if (!t) return null;
      if (t.length > ASSEMBLY_NAME_MAX) {
        ctx.addIssue({ code: "custom", message: `${label} dài quá ${ASSEMBLY_NAME_MAX} ký tự` });
        return z.NEVER;
      }
      if (coKyTuDieuKhien(t)) {
        ctx.addIssue({ code: "custom", message: `${label} chứa ký tự điều khiển` });
        return z.NEVER;
      }
      return t;
    });
}

/**
 * Đầu vào của action lưu. Kết quả là `AssemblyManual | null`:
 *   · cả ba ô trống                → null  (GỠ liên kết — xoá luôn cả hai tên, không để tên mồ côi)
 *   · có đường dẫn                 → đã kiểm + chuẩn hoá
 *   · chỉ có tên mà thiếu đường dẫn → LỖI (không đoán, không âm thầm bỏ tên)
 */
export const assemblyManualInputSchema = z
  .object({
    url: z.union([z.string(), z.null()]).optional(),
    setName: tenTuyChon("Tên bộ mô hình"),
    modelName: tenTuyChon("Tên mô hình"),
  })
  .transform((v, ctx): AssemblyManual | null => {
    const rawUrl = (v.url ?? "").trim();
    if (!rawUrl) {
      if (v.setName || v.modelName) {
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: "Nhập đường dẫn trước — hoặc xoá cả tên bộ/tên mô hình để gỡ liên kết",
        });
        return z.NEVER;
      }
      return null;
    }
    const r = checkAssemblyManualUrl(rawUrl);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", path: ["url"], message: r.error });
      return z.NEVER;
    }
    return { url: r.url, setName: v.setName, modelName: v.modelName };
  });

export type AssemblyManualInput = z.input<typeof assemblyManualInputSchema>;
