/**
 * CHỐT MÔI TRƯỜNG cho kịch bản đối soát/phục hồi video (`scripts/elearning-video-doi-chieu-khoi-phuc.ts`) — THUẦN, có test.
 *
 * Vì sao có: kịch bản chạy qua `DATABASE_URL` của máy người chạy. Qua một đường hầm SSH, hai cổng khác nhau trên cùng `127.0.0.1` có
 * thể là DB TEST và DB PROD — host không phân biệt được gì, và tên DB là thứ DUY NHẤT đáng tin. Ghi vào đúng nơi hay không phải
 * quyết bằng tên DB mà SERVER ĐANG ĐỌC (`select current_database()`), không bằng tham số hay biến môi trường.
 *
 * Luật:
 *  · PHẢI khai `--moi-truong=test|local` tường minh — không có mặc định (mặc định là chỗ chạy nhầm).
 *  · `test` ⇒ chỉ khi `current_database() = 'satarobo_test'` (lệnh UAT TEST).
 *  · `local` ⇒ chỉ các DB làm việc/thử trên máy dev (`satarobo_local` · `satarobo_lamviec` · `satarobo_vitest` · `ci_test`).
 *  · DB PROD (`satarobo`) và mọi tên lạ bị TỪ CHỐI cả khi khai đúng cờ: kịch bản này chưa được phép chạy ở PROD (cần kế hoạch phát
 *    hành riêng, luật cứng Nền Hệ thống #4).
 */

export const DB_TEST = "satarobo_test";
export const DB_LOCAL = ["satarobo_local", "satarobo_lamviec", "satarobo_vitest", "ci_test"] as const;
export const DB_PROD = "satarobo";

export type MoiTruongKichBan = "test" | "local";

export type KetQuaChotMoiTruong = { ok: true; moiTruong: MoiTruongKichBan } | { ok: false; thongBao: string };

export function chotMoiTruong(thamSo: string | null | undefined, tenDb: string | null | undefined): KetQuaChotMoiTruong {
  if (thamSo !== "test" && thamSo !== "local") {
    return { ok: false, thongBao: "Phải khai --moi-truong=test (DB UAT TEST) hoặc --moi-truong=local (DB máy dev). Không có mặc định." };
  }
  const ten = (tenDb ?? "").trim();
  if (!ten) return { ok: false, thongBao: "Không đọc được current_database() — từ chối chạy." };
  if (ten === DB_PROD) {
    return { ok: false, thongBao: `DB '${ten}' là PROD — kịch bản này KHÔNG được chạy ở PROD (cần kế hoạch phát hành riêng).` };
  }
  if (thamSo === "test") {
    return ten === DB_TEST
      ? { ok: true, moiTruong: "test" }
      : { ok: false, thongBao: `--moi-truong=test chỉ chạy được trên DB '${DB_TEST}', nhưng DB đang kết nối là '${ten}'.` };
  }
  return (DB_LOCAL as readonly string[]).includes(ten)
    ? { ok: true, moiTruong: "local" }
    : { ok: false, thongBao: `--moi-truong=local chỉ chạy được trên ${DB_LOCAL.join(" / ")}, nhưng DB đang kết nối là '${ten}'.` };
}
