/**
 * Giữ ĐÚNG MỘT tab portal ghim ở /soft-pos-transaction (roadmap §6 GĐ5) — mất thì mở lại.
 *
 * TỰ QUYẾT (an toàn nhất):
 *   · Chỉ NHẬN tab portal ĐÃ GHIM có sẵn (Chrome khôi phục tab ghim khi khởi động lại); KHÔNG
 *     chiếm tab thường người dùng đang mở, KHÔNG đóng tab nào.
 *   · Tab của agent đặt `autoDiscardable: false` (Memory Saver không được xả nó); tab đã bị
 *     xả ⇒ tải lại.
 */
import { DUONG_DANG_NHAP, PORTAL_MATCH, PORTAL_ORIGIN, TRANG_GIAO_DICH } from "./hang-so.js";

export interface TabInfo {
  id: number;
  url: string | null;
  pinned: boolean;
  discarded: boolean;
  status: "loading" | "complete" | null;
}

export interface TabApi {
  get(tabId: number): Promise<TabInfo | null>;
  query(urlPattern: string): Promise<TabInfo[]>;
  create(p: { url: string; pinned: boolean; active: boolean }): Promise<TabInfo>;
  update(tabId: number, p: { url?: string; pinned?: boolean; autoDiscardable?: boolean }): Promise<TabInfo | null>;
  reload(tabId: number): Promise<void>;
  sendMessage(tabId: number, msg: unknown): Promise<unknown>;
}

export function laUrlPortal(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(`${PORTAL_ORIGIN}/`);
}

/** Đường dẫn của một URL portal hoặc một pathname trần; khác ⇒ null. */
function duongDanCua(urlHoacDuong: string): string | null {
  if (urlHoacDuong.startsWith("/")) return urlHoacDuong.split(/[?#]/)[0];
  if (!laUrlPortal(urlHoacDuong)) return null;
  try {
    return new URL(urlHoacDuong).pathname;
  } catch {
    return null;
  }
}

/** Trang đăng nhập của portal (tín hiệu hết phiên thứ 3). */
export function laTrangDangNhap(urlHoacDuong: string | null | undefined): boolean {
  if (!urlHoacDuong) return false;
  const d = duongDanCua(urlHoacDuong);
  return d === DUONG_DANG_NHAP || (d !== null && d.startsWith(`${DUONG_DANG_NHAP}/`));
}

export const URL_TRANG_GIAO_DICH = `${PORTAL_ORIGIN}${TRANG_GIAO_DICH}`;

async function chinhTab(api: TabApi, t: TabInfo): Promise<TabInfo> {
  const sau = (await api.update(t.id, { pinned: true, autoDiscardable: false })) ?? t;
  if (sau.discarded) {
    await api.reload(t.id);
    return (await api.get(t.id)) ?? sau;
  }
  return sau;
}

export interface KetQuaDamBaoTab {
  tab: TabInfo;
  moiTao: boolean;
  /** Nhận một tab ghim có sẵn (chưa chắc đã có content script — vd vừa cài extension). */
  nhanTabCu: boolean;
}

export async function damBaoTab(api: TabApi, tabIdDaLuu: number | null): Promise<KetQuaDamBaoTab> {
  if (tabIdDaLuu !== null) {
    const t = await api.get(tabIdDaLuu);
    if (t && laUrlPortal(t.url)) return { tab: await chinhTab(api, t), moiTao: false, nhanTabCu: false };
  }
  const ghim = (await api.query(PORTAL_MATCH)).filter((t) => t.pinned && laUrlPortal(t.url));
  if (ghim.length > 0) return { tab: await chinhTab(api, ghim[0]), moiTao: false, nhanTabCu: true };
  const moi = await api.create({ url: URL_TRANG_GIAO_DICH, pinned: true, active: false });
  return { tab: await chinhTab(api, moi), moiTao: true, nhanTabCu: false };
}
