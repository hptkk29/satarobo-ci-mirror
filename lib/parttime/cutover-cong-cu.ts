// lib/parttime/cutover-cong-cu.ts — tham số dòng lệnh + CỔNG NHẬP của `scripts/parttime-cutover.ts`. THUẦN (test được).
//
// Mặc định là DRY RUN: không có `--apply` thì không một dòng nào được ghi. `--apply` phải qua ĐỦ các vế:
//   · `--xac-nhan-db=<tên>` KHỚP `current_database()` (chống chạy nhầm DB);
//   · sẵn sàng GHI (`checkParttimeReadiness`): RBAC v2 + đủ bảng + đủ migration;
//   · công tắc STAFFING BẬT tại MỌI cơ sở trong phạm vi (nhập khi công tắc tắt = phân công không ai thấy);
//   · DB prod (`satarobo`) ⇒ thêm biến `PARTTIME_CUTOVER_PROD_DUYET` ghi mã duyệt của chủ dự án. Đợt 18/10/2026 KHÔNG chạy prod.
export type ThamSoCli = {
  tu: string | null;
  den: string | null;
  coSo: string[] | null;
  apply: boolean;
  xacNhanDb: string | null;
  json: string | null;
  guiThongBao: boolean;
  /** "YYYY-MM" ⇒ chạy bóng tháng đó thay vì cutover. */
  chayBong: string | null;
};

const NGAY = /^\d{4}-\d{2}-\d{2}$/;

export function docThamSoCli(argv: readonly string[]): { ok: true; v: ThamSoCli } | { ok: false; loi: string } {
  const v: ThamSoCli = { tu: null, den: null, coSo: null, apply: false, xacNhanDb: null, json: null, guiThongBao: false, chayBong: null };
  for (const a of argv) {
    const [k, ...r] = a.split("=");
    const val = r.join("=");
    if (k === "--tu" && NGAY.test(val)) v.tu = val;
    else if (k === "--den" && NGAY.test(val)) v.den = val;
    else if (k === "--co-so" && val) v.coSo = val.split(",").map((x) => x.trim()).filter(Boolean);
    else if (k === "--apply" && !val) v.apply = true;
    else if (k === "--xac-nhan-db" && val) v.xacNhanDb = val;
    else if (k === "--json" && val) v.json = val;
    else if (k === "--gui-thong-bao" && !val) v.guiThongBao = true;
    else if (k === "--chay-bong" && /^\d{4}-\d{2}$/.test(val)) v.chayBong = val;
    else return { ok: false, loi: `Tham số không hiểu: ${a}` };
  }
  if (v.apply && v.chayBong) return { ok: false, loi: "--apply không đi cùng --chay-bong (chạy bóng không bao giờ ghi)." };
  if (v.guiThongBao && !v.apply) return { ok: false, loi: "--gui-thong-bao chỉ có nghĩa khi --apply." };
  return { ok: true, v };
}

export const DB_PROD = "satarobo";

export function kiemApDung(p: {
  v: ThamSoCli;
  dbHienTai: string;
  sanSangGhi: "READY" | "BLOCKED";
  lyDoChan: readonly string[];
  /** mã cơ sở trong phạm vi ⇒ công tắc STAFFING có hiệu lực tại đó. */
  phanCongBat: Readonly<Record<string, boolean>>;
  duyetProd: string | null;
}): { ok: true } | { ok: false; lyDo: string[] } {
  if (!p.v.apply) return { ok: false, lyDo: ["DRY RUN — không có --apply."] };
  const lyDo: string[] = [];
  if (p.v.xacNhanDb !== p.dbHienTai) lyDo.push(`--xac-nhan-db=${p.v.xacNhanDb ?? "(trống)"} không khớp DB đang nối (${p.dbHienTai}).`);
  if (p.sanSangGhi !== "READY") lyDo.push(...p.lyDoChan.map((l) => `Chưa sẵn sàng ghi: ${l}`));
  const tat = Object.entries(p.phanCongBat).filter(([, b]) => !b).map(([c]) => c);
  if (Object.keys(p.phanCongBat).length === 0) lyDo.push("Phạm vi không có cơ sở nào.");
  if (tat.length) lyDo.push(`Công tắc phân công CHƯA bật ở: ${tat.join(", ")}.`);
  if (p.dbHienTai === DB_PROD && !p.duyetProd?.trim()) lyDo.push("DB PROD: thiếu PARTTIME_CUTOVER_PROD_DUYET (mã duyệt của chủ dự án).");
  return lyDo.length ? { ok: false, lyDo } : { ok: true };
}
