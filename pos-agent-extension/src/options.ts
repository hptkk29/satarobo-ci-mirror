/**
 * Trang Tuỳ chọn của extension. KHÔNG tự đọc kho: mọi đọc/ghi đi qua service worker
 * (`LAY_CAU_HINH` / `LUU_CAU_HINH` / `LAY_TRANG_THAI`), và service worker không bao giờ trả bí
 * mật. Ô bí mật luôn RỖNG; đã có bí mật thì chỉ báo "đã lưu — dán bí mật mới để thay".
 */
import { docIso, hienThiGioVN } from "./lib/gio-vn.js";

const KENH = "satarobo-pos-agent";
type Gui = (msg: unknown) => Promise<unknown>;

const NHAN_PHIEN: Record<string, string> = {
  READY: "Đang đăng nhập (READY)",
  EXPIRED: "Đã hết phiên — đăng nhập lại trong tab portal ghim (EXPIRED)",
  UNKNOWN: "Chưa kiểm (UNKNOWN)",
};
const NHAN_DUNG: Record<string, string> = {
  BAD_SIGNATURE: "DỪNG — bí mật sai hoặc đã bị tạo lại: dán bí mật mới",
  AGENT_DISABLED: "DỪNG — agent đã bị tắt trên satarobo",
  MERCHANT_CONFIG_MISMATCH: "DỪNG — mã merchant khác với satarobo",
};

function laObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function gio(x: unknown): string {
  const ms = docIso(x);
  return ms === null ? "—" : hienThiGioVN(ms);
}

function o<T extends HTMLElement>(doc: Document, sel: string): T | null {
  return doc.querySelector<T>(sel);
}

function dat(doc: Document, tt: string, chu: string): void {
  const el = o(doc, `[data-tt="${tt}"]`);
  if (el) el.textContent = chu;
}

function veTrangThai(doc: Document, t: unknown): void {
  if (!laObject(t)) return;
  const dung = typeof t.dung === "string" ? NHAN_DUNG[t.dung] ?? `DỪNG — ${t.dung}` : null;
  const phien = typeof t.trangThaiPhien === "string" ? NHAN_PHIEN[t.trangThaiPhien] ?? t.trangThaiPhien : "—";
  dat(doc, "phien", dung ?? phien);
  dat(doc, "hetHan", gio(t.hetHanLuc));
  dat(doc, "lastSynced", gio(t.lastSyncedAt));
  const lan = laObject(t.lanDongBoCuoi) ? t.lanDongBoCuoi : null;
  dat(
    doc,
    "lanCuoi",
    lan ? `${gio(lan.luc)} — ${lan.ok ? "xong" : `dừng (${String(lan.loi)})`}, ${String(lan.soDong)} giao dịch, ${String(lan.soLo)} lô` : "—",
  );
  // 1.1: FIELD_TOO_LONG kèm khoá máy chủ báo vượt trần (service worker chỉ giữ khoá whitelist §6.1).
  const truong = Array.isArray(t.truongQuaDai) ? t.truongQuaDai.filter((x): x is string => typeof x === "string") : [];
  const loi = Array.isArray(t.loiMo) ? t.loiMo.map((m) => (m === "FIELD_TOO_LONG" && truong.length > 0 ? `${m} (${truong.join(", ")})` : String(m))) : [];
  dat(doc, "loi", loi.length > 0 ? loi.join(", ") : "không");
  dat(doc, "phienBan", typeof t.phienBan === "string" ? t.phienBan : "—");
}

function veCauHinh(doc: Document, xem: unknown): void {
  if (!laObject(xem)) return;
  const sel = o<HTMLSelectElement>(doc, '[name="satAroboBaseUrl"]');
  if (sel && Array.isArray(xem.gocChoPhep)) {
    sel.replaceChildren();
    for (const g of xem.gocChoPhep) {
      if (typeof g !== "string") continue;
      const opt = doc.createElement("option");
      opt.value = g;
      opt.textContent = g;
      sel.append(opt);
    }
  }
  const ch = laObject(xem.cauHinh) ? xem.cauHinh : null;
  for (const k of ["agentId", "centerCode", "merchantCode", "satAroboBaseUrl"]) {
    const el = o<HTMLInputElement | HTMLSelectElement>(doc, `[name="${k}"]`);
    if (el && ch && typeof ch[k] === "string") el.value = ch[k] as string;
  }
  const bm = o<HTMLInputElement>(doc, '[name="agentSecret"]');
  if (bm) {
    bm.value = "";
    bm.placeholder = xem.coBiMat === true ? "Đã lưu — dán bí mật mới để thay" : "Dán bí mật 64 ký tự từ màn Sức khoẻ POS Agent";
  }
}

function veLoi(doc: Document, loi: Record<string, unknown>): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-loi]"))) {
    const k = el.dataset.loi ?? "";
    el.textContent = typeof loi[k] === "string" ? (loi[k] as string) : "";
  }
}

function thongBao(doc: Document, chu: string, kieu: "ok" | "loi"): void {
  const el = o(doc, "#thong-bao");
  if (!el) return;
  el.textContent = chu;
  el.dataset.kieu = kieu;
}

export async function khoiTaoTrangOptions(doc: Document, gui: Gui): Promise<void> {
  const taiLaiTrangThai = async () => veTrangThai(doc, await gui({ kenh: KENH, lenh: "LAY_TRANG_THAI" }));
  veCauHinh(doc, await gui({ kenh: KENH, lenh: "LAY_CAU_HINH" }));
  await taiLaiTrangThai();

  const form = o<HTMLFormElement>(doc, "form");
  form?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const val = (k: string) => o<HTMLInputElement | HTMLSelectElement>(doc, `[name="${k}"]`)?.value ?? "";
      const bm = o<HTMLInputElement>(doc, '[name="agentSecret"]');
      const biMatMoi = bm?.value.trim() ?? "";
      const msg: Record<string, unknown> = {
        kenh: KENH,
        lenh: "LUU_CAU_HINH",
        cauHinh: {
          agentId: val("agentId"),
          centerCode: val("centerCode"),
          merchantCode: val("merchantCode"),
          satAroboBaseUrl: val("satAroboBaseUrl"),
        },
      };
      if (biMatMoi !== "") msg.biMatMoi = biMatMoi;
      const kq = await gui(msg);
      if (bm) bm.value = ""; // không để bí mật nằm lại trong ô, kể cả khi lưu hỏng
      if (laObject(kq) && kq.ok === true) {
        veLoi(doc, {});
        veCauHinh(doc, kq.xem);
        thongBao(doc, "Đã lưu. Extension đang kết nối lại.", "ok");
      } else {
        veLoi(doc, laObject(kq) && laObject(kq.loi) ? kq.loi : {});
        thongBao(doc, "Chưa lưu — sửa các ô báo lỗi.", "loi");
      }
      await taiLaiTrangThai();
    })();
  });

  const nut = o<HTMLButtonElement>(doc, "#kiem-tra");
  if (nut) {
    nut.addEventListener("click", () => {
      void (async () => {
        nut.disabled = true;
        try {
          veTrangThai(doc, await gui({ kenh: KENH, lenh: "GUI_HEARTBEAT_NGAY" }));
        } finally {
          nut.disabled = false;
        }
      })();
    });
  }
}

const g = globalThis as unknown as { chrome?: { runtime?: { id?: string; sendMessage(m: unknown): Promise<unknown> } } };
const rt = g.chrome?.runtime;
if (typeof document !== "undefined" && rt?.id) {
  void khoiTaoTrangOptions(document, (m) => rt.sendMessage(m));
}
