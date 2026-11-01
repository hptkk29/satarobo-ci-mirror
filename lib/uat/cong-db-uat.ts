// lib/uat/cong-db-uat.ts — CỔNG CHẶN DB LẠ của bộ nạp dữ liệu UAT hoa hồng. THUẦN (không DB, không env, không đồng hồ).
//
// Script `scripts/hoa-hong/uat-nap-du-lieu.ts` GHI dữ liệu (lead · đơn · khoản thu · chính sách nháp) nên chỉ được chạy trên DB UAT.
// Ba lớp, đều phải qua, và lớp nào cũng đọc BẰNG CHỨNG của chính DB chứ không tin tên người gõ:
//
//   1. URL (trước khi kết nối): host là máy này; KHÔNG phải cổng tunnel PROD; tunnel TEST chỉ qua khi người chạy nói rõ;
//      TÊN DB (đã tách khỏi URL) không thuộc tên prod đã biết VÀ là DB test dùng chung (hoặc DB làm việc của máy dev).
//   2. `current_database()` (sau khi kết nối, trước mọi lệnh ghi): trùng tên DB trong URL và vẫn là DB UAT.
//      URL có thể trỏ một proxy / pooler mà tên đổi — chỉ DB tự khai tên mới đáng tin.
//   3. Chỉ khi `--apply`: người chạy phải gõ lại đúng tên DB (`--xac-nhan-db=<tên>`) — chặn thói quen "bấm Enter cho nhanh".
//
// Phép nhận diện "máy này / tunnel VPS" KHÔNG viết lại ở đây: nó sống ở MỘT chỗ (`lib/security/url-db-cuc-bo.ts`, luật 28/09/2026 —
// 17 bản chép tay đã từng để tunnel lọt). Tunnel PROD (:5433) bị từ chối VÔ ĐIỀU KIỆN; tunnel TEST (:5435, tên DB `satarobo_test`
// của test.satarobo.vn) chỉ qua khi `choPhepTunnelTest` — vì nó trông y hệt DB máy mà dữ liệu phía sau là của môi trường chung.
//
// ── "DB test" KHÔNG định nghĩa lại ở đây (§31, vòng UAT cuối) ──
// Bản đầu của cổng giữ một regex RIÊNG (`satarobo_test*` + `satarobo_lamviec`) nên từ chối `ci_test` — tên DB của CI — và lưới `[UAT-SO-00]` phải tự dựng một tên DB khác để né: cổng
// chỉ đúng trên máy dev. Định nghĩa "tên này là DB dùng-để-test" nay là MỘT chỗ (`laTenDbLaDbTest`, cùng tệp với phép nhận diện tunnel VPS); cổng này chỉ THÊM hai thứ của riêng bộ nạp UAT:
// DB làm việc của máy dev (`satarobo_lamviec`, checklist 09 dùng nó) và danh sách tên prod/hệ thống bị từ chối TRƯỚC (để câu từ chối nói đúng lý do, và để một tên prod không bao giờ
// "tình cờ" khớp mẫu nào). Tên prod thật của VPS không nằm trong repo (docs/VPS-VAN-HANH.md ghi `<tên db>`) — danh sách là đường rào phụ, KHÔNG phải lớp chính; lớp chính vẫn là host + tunnel + allowlist.
import { congTunnelVps, laDbCucBo, laTenDbLaDbTest, loiTunnelVps, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/** DB làm việc của máy dev (nạp từ bản sao DB test) — checklist 09 chạy bộ nạp UAT trên đó. Không phải tên DB test nên phải khai riêng. */
export const TEN_DB_LAM_VIEC = "satarobo_lamviec";

/** Tên DB prod / hệ thống đã biết — bị từ chối TRƯỚC allowlist, kèm mã riêng. Đường rào phụ (xem đầu tệp). */
export const TEN_DB_PROD_DA_BIET: ReadonlySet<string> = new Set(["satarobo", "satarobo_prod", "satarobo_production", "prod", "production", "postgres"]);

/** DB UAT = DB test dùng chung (`satarobo_test*`, `ci_test*`) HOẶC DB làm việc của máy dev. */
export function laTenDbUat(ten: string): boolean {
  return laTenDbLaDbTest(ten) || ten === TEN_DB_LAM_VIEC;
}

const HOST_MAY_NAY: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type MaTuChoiDbUat =
  | "URL_TRONG"
  | "URL_KHONG_DOC_DUOC"
  | "TUNNEL_PROD"
  | "TUNNEL_TEST_CHUA_CHO_PHEP"
  | "HOST_KHONG_PHAI_MAY_NAY"
  | "TEN_DB_PROD_DA_BIET"
  | "TEN_DB_KHONG_PHAI_UAT"
  | "CURRENT_DATABASE_KHONG_RO"
  | "CURRENT_DATABASE_LECH_URL"
  | "CHUA_XAC_NHAN_TEN_DB";

export type KetQuaCongDbUat =
  | { ok: true; tenDb: string; host: string; cong: string; quaTunnelTest: boolean }
  | { ok: false; ma: MaTuChoiDbUat; lyDo: string };

const tuChoi = (ma: MaTuChoiDbUat, lyDo: string): KetQuaCongDbUat => ({ ok: false, ma, lyDo });

type ThanhPhanUrl = { host: string; cong: string; tenDb: string };

/** Đọc host · cổng · tên DB; `null` nếu không đọc được. KHÔNG bao giờ đưa chuỗi gốc (có mật khẩu) vào thông điệp lỗi. Tên DB lấy từ MỘT chỗ (`tenDbCuaUrl`). */
function docUrl(url: string): ThanhPhanUrl | null {
  const tenDb = tenDbCuaUrl(url);
  if (tenDb === null) return null;
  try {
    const u = new URL(url);
    return { host: u.hostname, cong: u.port === "" ? "5432" : u.port, tenDb };
  } catch {
    return null;
  }
}

/** Cổng TÊN chung cho cả hai lớp: prod/hệ thống đã biết ⇒ mã riêng; không phải DB UAT ⇒ mã chung. `null` = qua. */
function tuChoiTheoTen(ten: string, nguon: "URL" | "current_database()"): KetQuaCongDbUat | null {
  if (TEN_DB_PROD_DA_BIET.has(ten)) {
    return tuChoi("TEN_DB_PROD_DA_BIET", `${nguon} = "${ten}" là tên DB prod/hệ thống đã biết — bộ nạp UAT KHÔNG BAO GIỜ chạy trên đó.`);
  }
  if (!laTenDbUat(ten)) {
    return tuChoi("TEN_DB_KHONG_PHAI_UAT", `${nguon} = "${ten}" không phải DB UAT (chỉ nhận DB test dùng chung — định nghĩa ở lib/security/url-db-cuc-bo.ts — hoặc \`${TEN_DB_LAM_VIEC}\`).`);
  }
  return null;
}

/** Lớp 1 — chỉ cần URL, chạy TRƯỚC khi mở kết nối. */
export function kiemUrlDbUat(i: { url: string; choPhepTunnelTest: boolean }): KetQuaCongDbUat {
  if (i.url.trim() === "") return tuChoi("URL_TRONG", "Không có chuỗi DB (DATABASE_URL trống) — dừng, không đoán DB nào.");
  const tp = docUrl(i.url);
  if (tp === null) return tuChoi("URL_KHONG_DOC_DUOC", "Không đọc được chuỗi DB (cần dạng postgresql://…@host:cổng/tên_db) — dừng.");

  const tunnel = congTunnelVps(i.url);
  if (tunnel === "5433") {
    return tuChoi("TUNNEL_PROD", `${loiTunnelVps(i.url) ?? "TỪ CHỐI: cổng 5433 là SSH tunnel tới DB PROD."} Bộ nạp UAT KHÔNG BAO GIỜ chạy trên đường này.`);
  }
  if (tunnel === "5435" && !i.choPhepTunnelTest) {
    return tuChoi(
      "TUNNEL_TEST_CHUA_CHO_PHEP",
      `${loiTunnelVps(i.url) ?? "Cổng 5435 là SSH tunnel tới DB test của test.satarobo.vn."} Nếu ĐÚNG là muốn nạp dữ liệu UAT vào môi trường test chung, thêm --cho-phep-tunnel-test.`,
    );
  }
  // Tunnel TEST đã được cho phép: kiểm host bằng cách thay cổng tunnel bằng cổng Postgres máy rồi hỏi lại hàm dùng chung.
  const urlDeKiemHost = tunnel === "5435" ? i.url.replace(/:5435(?=[/?#]|$)/, ":5432").replace(/([?&])port=5435(?=[&#]|$)/, "$1port=5432") : i.url;
  // Hai vế cùng phải đúng: hàm dùng chung nhìn CHUỖI, còn host THẬT là phần URL parse ra (`u:x@127.0.0.1:5432@evil.com/…` qua vế đầu, rớt vế sau).
  if (!laDbCucBo(urlDeKiemHost) || !HOST_MAY_NAY.has(tp.host)) {
    return tuChoi("HOST_KHONG_PHAI_MAY_NAY", `Host "${tp.host}" không phải Postgres trên máy này — bộ nạp UAT chỉ chạy trên localhost / 127.0.0.1.`);
  }
  const theoTen = tuChoiTheoTen(tp.tenDb, "URL");
  if (theoTen !== null) return theoTen;
  return { ok: true, tenDb: tp.tenDb, host: tp.host, cong: tp.cong, quaTunnelTest: tunnel === "5435" };
}

/** Cả ba lớp. `tenDbThat` = kết quả `SELECT current_database()`; `xacNhanDb` = giá trị `--xac-nhan-db`; `apply` = có ghi thật không. */
export function kiemCongDbUat(i: {
  url: string;
  tenDbThat: string | null;
  choPhepTunnelTest: boolean;
  xacNhanDb: string | null;
  apply: boolean;
}): KetQuaCongDbUat {
  const u = kiemUrlDbUat({ url: i.url, choPhepTunnelTest: i.choPhepTunnelTest });
  if (!u.ok) return u;

  if (i.tenDbThat === null || i.tenDbThat.trim() === "") {
    return tuChoi("CURRENT_DATABASE_KHONG_RO", "DB không tự khai được tên (current_database() trống) — dừng, không đoán.");
  }
  if (i.tenDbThat !== u.tenDb) {
    return tuChoi("CURRENT_DATABASE_LECH_URL", `URL nói DB "${u.tenDb}" nhưng current_database() báo "${i.tenDbThat}" — có proxy/pooler đổi tên? Dừng.`);
  }
  const theoTenThat = tuChoiTheoTen(i.tenDbThat, "current_database()");
  if (theoTenThat !== null) return theoTenThat;
  if (i.apply && i.xacNhanDb !== i.tenDbThat) {
    return tuChoi("CHUA_XAC_NHAN_TEN_DB", `--apply cần gõ lại đúng tên DB: --xac-nhan-db=${i.tenDbThat}`);
  }
  return u;
}
