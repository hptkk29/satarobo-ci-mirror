// Tab của trang Thông báo (khu e-learning): `?tab=tat-ca|chua-doc`, ánh xạ SANG `?status=unread` của bộ lọc dùng chung với site GV.
// Hàm THUẦN. Không sửa luật của bộ lọc dùng chung: trang e-learning chỉ DỊCH tham số.
//
// Vì sao phải mang CẢ HAI tham số: API "tải thêm" (`/api/notifications?…`) chỉ hiểu `status`, còn thanh tab đọc `tab`. Tab "Chưa đọc"
// mà thiếu `status=unread` thì trang đầu lọc đúng, nhưng bấm "Tải thêm" lại kéo cả mục đã đọc — lỗi chỉ thấy khi cuộn.
// Liên kết cũ `?status=unread` (chuông, thông báo) vẫn đúng: suy ra tab "Chưa đọc".

export const TAB_THONG_BAO = [
  { id: "tat-ca", nhan: "Tất cả" },
  { id: "chua-doc", nhan: "Chưa đọc" },
] as const;
export type TabThongBao = (typeof TAB_THONG_BAO)[number]["id"];

type Tho = Record<string, string | string[] | undefined>;
const mot = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Khai báo hai tab cho `TabNav`: tab "Chưa đọc" mang `status=unread` (API tải thêm chỉ hiểu `status`) và số chưa đọc thật. */
export function tabThongBaoKhaiBao(soChuaDoc: number) {
  return TAB_THONG_BAO.map((x) =>
    x.id === "chua-doc"
      ? { id: x.id, nhan: x.nhan, dem: soChuaDoc, them: { status: "unread" } }
      : { id: x.id, nhan: x.nhan },
  );
}

export type ThongBaoChuanHoa = {
  tab: TabThongBao;
  status: "unread" | "all";
  /** `true` khi URL hiện tại KHÔNG ở dạng chuẩn (thiếu/lệch `tab` hoặc `status`) ⇒ trang nên chuyển hướng tới `query`. */
  canChuyenHuong: boolean;
  /** Chuỗi truy vấn chuẩn (giữ `group`/`range`/`q`, KHÔNG giữ `cursor`). */
  query: string;
};

export function chuanHoaThongBao(sp: Tho): ThongBaoChuanHoa {
  const tabTho = mot(sp.tab);
  const statusTho = mot(sp.status);
  const tab: TabThongBao = tabTho === "chua-doc" || tabTho === "tat-ca" ? tabTho : statusTho === "unread" ? "chua-doc" : "tat-ca";
  const status = tab === "chua-doc" ? "unread" : "all";

  const q = new URLSearchParams();
  q.set("tab", tab);
  if (status === "unread") q.set("status", "unread");
  for (const k of ["group", "range", "q"] as const) {
    const v = mot(sp[k]);
    if (v) q.set(k, v);
  }
  // Trang gốc không tham số (đích "Xem tất cả" của chuông) cũng là dạng chuẩn của tab Tất cả — không chuyển hướng thừa.
  const tabDung = tabTho === tab || (tabTho === undefined && tab === "tat-ca");
  const dungDang = tabDung && (status === "unread" ? statusTho === "unread" : statusTho === undefined);
  return { tab, status, canChuyenHuong: !dungDang, query: q.toString() };
}
