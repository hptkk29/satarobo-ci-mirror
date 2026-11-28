// Tab theo URL (`?tab=`) của khu e-learning — hàm THUẦN. Mỗi tab có địa chỉ riêng mở thẳng được (HANDOFF §4).
//
// Vì sao không dùng `components/ui/tabs.tsx`: nó giữ trạng thái trong client nên tab không có URL, F5 là mất, và không gửi
// được liên kết "Khoá quá hạn" cho người khác. Ở đây tab là một liên kết thật, trang đọc `searchParams` ở server.
//
// Tương thích ngược: liên kết cũ (`?tt=`, `?status=`) từ Tổng quan / thông báo / chuông vẫn phải đúng ⇒ `bietDanh` ánh xạ
// giá trị cũ sang tab mới. Chuỗi lạ ⇒ rơi về tab mặc định (không ném lỗi, không trang trắng).

export type SearchParamsTho = Record<string, string | string[] | undefined>;

function mot(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Tab đang mở. Ưu tiên `?tab=`; không có thì thử từng khoá cũ trong `khoaCu` qua `bietDanh`; vẫn không khớp tab nào ⇒ `macDinh`.
 * `cacTab` là danh sách tab HỢP LỆ — không bao giờ trả về giá trị ngoài danh sách (chống tab "ma" do người dùng gõ URL).
 */
export function tabDangMo(
  sp: SearchParamsTho,
  cacTab: readonly string[],
  macDinh: string,
  opts: { khoaCu?: readonly string[]; bietDanh?: Readonly<Record<string, string>> } = {},
): string {
  const hopLe = (t: string | undefined): t is string => t !== undefined && cacTab.includes(t);
  const moi = mot(sp.tab);
  if (hopLe(moi)) return moi;
  for (const k of opts.khoaCu ?? []) {
    const cu = mot(sp[k]);
    if (cu === undefined) continue;
    const dich = opts.bietDanh?.[cu] ?? cu;
    if (hopLe(dich)) return dich;
  }
  return macDinh;
}

/**
 * Địa chỉ của một tab. Giữ lại các tham số lọc khác (`giuLai`, bỏ giá trị rỗng) NHƯNG KHÔNG BAO GIỜ giữ `page`:
 * sang tab khác mà ở lại trang 3 là trang trống. `tab` luôn được ghi tường minh, kể cả tab mặc định — URL không mơ hồ.
 */
export function hrefTab(
  duongDan: string,
  tab: string,
  giuLai: Readonly<Record<string, string | undefined>> = {},
): string {
  const q = new URLSearchParams();
  q.set("tab", tab);
  for (const [k, v] of Object.entries(giuLai)) {
    if (k === "tab" || k === "page") continue;
    if (v !== undefined && v !== "") q.set(k, v);
  }
  return `${duongDan}?${q.toString()}`;
}
