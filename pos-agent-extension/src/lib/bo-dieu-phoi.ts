/**
 * BỘ ĐIỀU PHỐI của service worker — mọi quyết định "làm gì, lúc nào" của POS Agent.
 *
 * Không đụng `chrome.*` trực tiếp: mọi thứ bên ngoài đi qua `PhuThuoc` (kho, tab, fetch, hẹn
 * giờ, huy hiệu, đồng hồ) ⇒ chạy thật trong service worker (`nen-chrome.ts`) và chạy được trong
 * test với đồ giả. Mọi thao tác xếp HÀNG MỘT: không bao giờ hai lượt đồng bộ song song (§8.4).
 *
 * Nhịp (roadmap §6 GĐ5 + hợp đồng §5, §8):
 *   khởi động      heartbeat (kiểm merchant TRƯỚC khi chạm portal) → kiểm phiên → READY thì quét bù
 *   alarm 1′       gửi status còn treo → GET /jobs (nhịp "còn sống") → READY thì đồng bộ (+ jobIds)
 *   alarm 10′      keepalive GET /api/auth/session (qua trang) → heartbeat
 *   nhanh 2s       khi máy chủ trả nextPollMs 2000 — chỉ hỏi job, có job mới đồng bộ
 *   trang tải xong /login ⇒ hết phiên; trang khác khi chưa READY ⇒ kiểm phiên ngay (đăng nhập lại)
 */
import { docCauHinhDaLuu, gocChoPhepTuManifest, kiemBiMat, kiemCauHinh, xemCongKhai } from "./cau-hinh.js";
import type { CauHinh, LoiCauHinh, XemCauHinh } from "./cau-hinh.js";
import { chonCuaSo, mocDongBo, tuQuetBuSauReady } from "./cua-so.js";
import { chayDongBo, type LoiDongBo } from "./dong-bo.js";
import { isoVN, maThoiGianVN } from "./gio-vn.js";
import {
  API_AGENT,
  CHO_KHI_CHUA_CAU_HINH_MAY_CHU_MS,
  CHO_SAU_TRANG_MOI_MS,
  KENH,
  PAGE_SIZE,
  PHIEN_BAN,
  TIMEOUT_GIAO_DICH_MS,
  TIMEOUT_LENH_TAB_MS,
  TIMEOUT_THUONG_MS,
  TRANG_GIAO_DICH,
} from "./hang-so.js";
import type { KhoLuuTru } from "./kho.js";
import { capNhatNhanh, henHoiNhanh } from "./lich.js";
import { PHIEN_DAU, xuLyTinHieu, type LyDoHet, type Phien, type TinHieuPhien, type TrangThaiPhien } from "./phien.js";
import { docKetQuaMain, lenhPhien, lenhTimKiem, loiMain, type KetQuaMain, type LenhGoi } from "./portal.js";
import { goiSatarobo, type FetchSatarobo, type KetQuaApi, type YeuCauApi } from "./satarobo.js";
import { damBaoTab, laTrangDangNhap, URL_TRANG_GIAO_DICH, type TabApi, type TabInfo } from "./tab-portal.js";
import {
  docJobs,
  docMerchantHeartbeat,
  docTuChoi,
  thanHeartbeat,
  thanStatus,
  truongQuaDai,
  type JobDongBo,
  type SuKienStatus,
  type TuChoiDong,
} from "./than-api.js";
import { taoNonce } from "./ky.js";
import type { KhoaGiaoDich } from "./payload.js";

export interface HienThi {
  /** Chữ trên huy hiệu icon (≤ 4 ký tự). */
  nhan: string;
  mau: "XANH" | "DO" | "CAM" | "XAM";
  tieuDe: string;
}

export interface PhuThuoc {
  dongHo(): number;
  kho: KhoLuuTru;
  khoPhien: KhoLuuTru;
  tab: TabApi;
  fetch: FetchSatarobo;
  datHenGio(fn: () => void, ms: number): void;
  hienThi(h: HienThi): Promise<void>;
  /** Giữ service worker sống trong lúc chờ một việc dài (gọi API extension định kỳ). */
  giuSong<T>(p: Promise<T>): Promise<T>;
  hostPermissions: readonly string[];
}

/** Lý do DỪNG hẳn — đến từ phản hồi của satarobo (hợp đồng §7.1, §8.6). */
export type MaDung = "BAD_SIGNATURE" | "AGENT_DISABLED" | "MERCHANT_CONFIG_MISMATCH";

export interface TrangThaiCongKhai {
  phienBan: string;
  trangThaiPhien: TrangThaiPhien;
  lyDoHet: LyDoHet | null;
  hetHanLuc: string | null;
  lastSyncedAt: string | null;
  dung: MaDung | null;
  loiMo: string[];
  tabId: number | null;
  nhanhDen: string | null;
  canQuetBuTu: string | null;
  lanDongBoCuoi: { luc: string; ok: boolean; soDong: number; soLo: number; loi: string | null } | null;
  /** 1.1 — khoá §6.1 máy chủ báo vượt trần (`FIELD_TOO_LONG` + `rejected[].field`): extension lệch hợp đồng ở đó. */
  truongQuaDai: KhoaGiaoDich[];
}

export type KetQuaLuu = { ok: true; xem: XemCauHinh } | { ok: false; loi: LoiCauHinh };

export interface BoDieuPhoi {
  khoiDong(lyDo: "INSTALL" | "STARTUP" | "CAU_HINH"): Promise<void>;
  nhipPhut(): Promise<void>;
  nhipKeepalive(): Promise<void>;
  hoiNhanh(): Promise<void>;
  dongBoNgay(): Promise<void>;
  tabCapNhat(tabId: number, url: string | null, trangThai: string | null): Promise<void>;
  tabDong(tabId: number): Promise<void>;
  trangSanSang(tabId: number, duongDan: string): Promise<void>;
  layCauHinh(): Promise<XemCauHinh>;
  luuCauHinh(input: unknown): Promise<KetQuaLuu>;
  layTrangThai(): Promise<TrangThaiCongKhai>;
  guiHeartbeatNgay(): Promise<void>;
  /** Chờ mọi việc đang xếp hàng xong (test + chẩn đoán). */
  choXong(): Promise<void>;
}

interface NguCanh {
  cauHinh: CauHinh;
  biMat: string;
  dung: MaDung | null;
}

interface TapLoi {
  daTaiLai: boolean;
  daBao: boolean;
}

/** Lỗi ERROR có thể tự khỏi khi một lượt đồng bộ chạy trọn. */
const LOI_DONG_BO = [
  "HEADER_NOT_CAPTURED",
  "BODY_ENCRYPTED",
  "PORTAL_HTTP_ERROR",
  "PORTAL_BAD_SHAPE",
  "PORTAL_TAB_MISSING",
  "SYNC_FAILED",
] as const;

/** Khoá kho phiên được xoá khi đổi danh tính (agent / merchant / địa chỉ / bí mật). */
const KHOA_PHIEN_TRANG_THAI = [
  "phien",
  "nhanhDen",
  "nextPollGanNhat",
  "lechGio",
  "dung",
  "statusCho",
  "loiMo",
  "tapHeader",
  "tapNhan",
  "canQuetBuTu",
  "chanDen",
  "lanDongBoCuoi",
  "truongQuaDai",
];

class HetGioLenh extends Error {}

function soHuuHan(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function taoBoDieuPhoi(pt: PhuThuoc): BoDieuPhoi {
  const { kho, khoPhien } = pt;
  const gocChoPhep = gocChoPhepTuManifest(pt.hostPermissions);
  let duoi: Promise<void> = Promise.resolve();
  let daHenNhanh = false;

  function xepHang<T>(fn: () => Promise<T>): Promise<T> {
    const p = duoi.then(fn, fn);
    duoi = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  // ---------- đọc / ghi trạng thái ----------

  async function docNguCanh(): Promise<NguCanh | null> {
    const cauHinh = docCauHinhDaLuu(await kho.doc("cauHinh"), gocChoPhep);
    const biMat = await kho.doc<string>("biMat");
    if (!cauHinh || typeof biMat !== "string" || !kiemBiMat(biMat).ok) return null;
    const dung = (await khoPhien.doc<MaDung>("dung")) ?? null;
    return { cauHinh, biMat, dung };
  }

  async function docPhien(): Promise<Phien> {
    return (await khoPhien.doc<Phien>("phien")) ?? PHIEN_DAU;
  }

  async function docSo(k: KhoLuuTru, khoa: string): Promise<number | null> {
    const v = await k.doc<number>(khoa);
    return soHuuHan(v) ? v : null;
  }

  async function datDung(ma: MaDung): Promise<void> {
    await khoPhien.ghi({ dung: ma });
  }

  async function dangBiChan(): Promise<boolean> {
    const chanDen = await docSo(khoPhien, "chanDen");
    return chanDen !== null && pt.dongHo() < chanDen;
  }

  async function xepStatus(s: SuKienStatus): Promise<void> {
    const ds = (await khoPhien.doc<SuKienStatus[]>("statusCho")) ?? [];
    ds.push(s);
    await khoPhien.ghi({ statusCho: ds.slice(-20) });
  }

  async function baoLoi(ma: string, httpStatus: number | null = null): Promise<void> {
    const mo = (await khoPhien.doc<string[]>("loiMo")) ?? [];
    if (mo.includes(ma)) return;
    await khoPhien.ghi({ loiMo: [...mo, ma] });
    await xepStatus({ state: "ERROR", reason: ma, occurredAt: pt.dongHo(), httpStatus, sessionExpiresAt: null });
  }

  async function dongLoi(ds: readonly string[]): Promise<void> {
    const mo = (await khoPhien.doc<string[]>("loiMo")) ?? [];
    const con = mo.filter((m) => !ds.includes(m));
    if (con.length !== mo.length) await khoPhien.ghi({ loiMo: con });
  }

  /**
   * Hợp đồng 1.1 §4.4 — máy chủ từ chối dòng `FIELD_TOO_LONG` ⇒ extension LỆCH hợp đồng (bản đúng làm vừa trần trước
   * khi gửi): `/status ERROR FIELD_TOO_LONG` MỘT lần. Mã nằm NGOÀI `LOI_DONG_BO` nên lượt sạch sau đó KHÔNG đóng nó —
   * lệch hợp đồng là lỗi MÃ, chỉ khỏi khi cập nhật extension (nạp lại ⇒ kho phiên mới); dòng mới bị từ chối ở lượt sau
   * không báo lại. Trường lệch (whitelist §6.1) giữ để chẩn đoán (Options + huy hiệu). KHÔNG đụng jobIds: dòng bị từ
   * chối đã có dấu ở máy chủ và không chặn đóng job (§4.4).
   */
  async function baoTruongQuaDai(truong: readonly KhoaGiaoDich[]): Promise<void> {
    const cu = (await khoPhien.doc<KhoaGiaoDich[]>("truongQuaDai")) ?? [];
    const moi = [...cu, ...truong.filter((k) => !cu.includes(k))];
    if (moi.length !== cu.length) await khoPhien.ghi({ truongQuaDai: moi });
    await baoLoi("FIELD_TOO_LONG");
  }

  // ---------- satarobo ----------

  async function goiApi(ctx: NguCanh, yc: YeuCauApi): Promise<KetQuaApi> {
    const lechGioMs = (await docSo(khoPhien, "lechGio")) ?? 0;
    const kq = await pt.giuSong(
      goiSatarobo({
        fetch: pt.fetch,
        dongHo: () => pt.dongHo(),
        lechGioMs,
        cauHinh: { agentId: ctx.cauHinh.agentId, biMat: ctx.biMat, goc: ctx.cauHinh.satAroboBaseUrl },
        yc,
      }),
    );
    if (kq.lechGioMs !== null) await khoPhien.ghi({ lechGio: kq.lechGioMs });
    if (kq.ok) {
      const d = kq.data as { nextPollMs?: unknown } | null;
      const next = d && typeof d === "object" ? d.nextPollMs : undefined;
      if (soHuuHan(next) && next > 0) {
        const nhanhDen = capNhatNhanh(await docSo(khoPhien, "nhanhDen"), next, pt.dongHo());
        await khoPhien.ghi({ nhanhDen, nextPollGanNhat: next });
      }
      return kq;
    }
    if (kq.loai === "HTTP") {
      if (kq.ma === "BAD_SIGNATURE") await datDung("BAD_SIGNATURE");
      else if (kq.ma === "AGENT_DISABLED") await datDung("AGENT_DISABLED");
      else if (kq.ma === "RATE_LIMITED" || kq.httpStatus === 429) {
        await khoPhien.ghi({ chanDen: pt.dongHo() + (kq.retryAfterS ?? 60) * 1000 });
      } else if (kq.ma === "NOT_CONFIGURED" || kq.httpStatus === 503) {
        await khoPhien.ghi({ chanDen: pt.dongHo() + CHO_KHI_CHUA_CAU_HINH_MAY_CHU_MS });
      }
    }
    return kq;
  }

  async function guiStatusCho(ctx: NguCanh): Promise<void> {
    let ds = (await khoPhien.doc<SuKienStatus[]>("statusCho")) ?? [];
    while (ds.length > 0) {
      const hien = await docNguCanh();
      if (!hien || hien.dung === "BAD_SIGNATURE" || hien.dung === "AGENT_DISABLED" || (await dangBiChan())) return;
      const kq = await goiApi(ctx, {
        phuongThuc: "POST",
        duongDan: API_AGENT.status,
        than: thanStatus(ds[0], ctx.cauHinh.centerCode),
        timeoutMs: TIMEOUT_THUONG_MS,
      });
      // 400 = thân sai (lỗi mã) — bỏ dòng đó, không chặn cả hàng đợi mãi.
      if (!kq.ok && !(kq.loai === "HTTP" && kq.httpStatus === 400)) return;
      ds = ds.slice(1);
      await khoPhien.ghi({ statusCho: ds });
    }
  }

  async function guiHeartbeat(ctx: NguCanh): Promise<void> {
    const phien = await docPhien();
    const last = await docSo(kho, "lastSyncedAt");
    const kq = await goiApi(ctx, {
      phuongThuc: "POST",
      duongDan: API_AGENT.heartbeat,
      than: thanHeartbeat({
        sessionState: phien.trangThai,
        sessionExpiresAt: phien.hetHanLuc,
        sessionExpiresSource: phien.hetHanLuc ? phien.nguonHetHan : null,
        lastSyncedAt: last,
        profileName: ctx.cauHinh.centerCode,
      }),
      timeoutMs: TIMEOUT_THUONG_MS,
    });
    if (!kq.ok) return;
    const m = docMerchantHeartbeat(kq.data);
    if (m !== null && m !== ctx.cauHinh.merchantCode) {
      await datDung("MERCHANT_CONFIG_MISMATCH");
      await baoLoi("MERCHANT_CONFIG_MISMATCH");
      return;
    }
    if (ctx.dung === "MERCHANT_CONFIG_MISMATCH" || ctx.dung === "AGENT_DISABLED") await khoPhien.xoa(["dung"]);
    await dongLoi(["MERCHANT_CONFIG_MISMATCH"]);
  }

  async function layJobs(ctx: NguCanh): Promise<JobDongBo[] | null> {
    const kq = await goiApi(ctx, { phuongThuc: "GET", duongDan: API_AGENT.jobs, timeoutMs: TIMEOUT_THUONG_MS });
    return kq.ok ? docJobs(kq.data) : null;
  }

  // ---------- trang portal ----------

  async function choTabTaiXong(tabId: number): Promise<TabInfo | null> {
    for (let i = 0; i < 30; i++) {
      const t = await pt.tab.get(tabId);
      if (!t) return null;
      if (t.status !== "loading") return t;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }

  async function tabSan(laCaiDat = false): Promise<TabInfo | null> {
    const luu = await docSo(khoPhien, "tabId");
    const kq = await damBaoTab(pt.tab, luu);
    if (kq.tab.id !== luu) await khoPhien.ghi({ tabId: kq.tab.id });
    // Vừa cài/cập nhật: Chrome KHÔNG tiêm content script vào trang mở từ trước ⇒ tải lại một lần.
    if (laCaiDat && kq.nhanTabCu) await pt.tab.reload(kq.tab.id);
    return choTabTaiXong(kq.tab.id);
  }

  async function guiLenh(tabId: number, lenh: LenhGoi): Promise<KetQuaMain> {
    let hen: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await pt.giuSong(
        Promise.race([
          pt.tab.sendMessage(tabId, { kenh: KENH, lenh }),
          new Promise<never>((_, tuChoi) => {
            hen = setTimeout(() => tuChoi(new HetGioLenh()), TIMEOUT_LENH_TAB_MS);
          }),
        ]),
      );
      return docKetQuaMain(raw);
    } catch (e) {
      return loiMain(e instanceof HetGioLenh ? "MAIN_TIMEOUT" : "NO_RECEIVER");
    } finally {
      if (hen !== undefined) clearTimeout(hen);
    }
  }

  async function capTap(khoa: "tapHeader" | "tapNhan"): Promise<TapLoi> {
    return (await khoPhien.doc<TapLoi>(khoa)) ?? { daTaiLai: false, daBao: false };
  }

  /** Lỗi của lệnh trang ⇒ việc cần làm. Tải lại tab TỐI ĐA MỘT LẦN mỗi đợt lỗi. */
  async function xuLyLoiLenh(tabId: number, kq: Extract<KetQuaMain, { loai: "LOI" }>): Promise<void> {
    switch (kq.ma) {
      case "HEADER_NOT_CAPTURED": {
        const tap = await capTap("tapHeader");
        if (!tap.daTaiLai) {
          await khoPhien.ghi({ tapHeader: { ...tap, daTaiLai: true } });
          await pt.tab.update(tabId, { url: URL_TRANG_GIAO_DICH });
        } else if (!tap.daBao) {
          await khoPhien.ghi({ tapHeader: { ...tap, daBao: true } });
          await baoLoi("HEADER_NOT_CAPTURED");
        }
        return;
      }
      case "NO_RECEIVER":
      case "MAIN_TIMEOUT": {
        const tap = await capTap("tapNhan");
        if (!tap.daTaiLai) {
          await khoPhien.ghi({ tapNhan: { ...tap, daTaiLai: true } });
          await pt.tab.reload(tabId);
        } else if (!tap.daBao) {
          await khoPhien.ghi({ tapNhan: { ...tap, daBao: true } });
          await baoLoi("PORTAL_TAB_MISSING");
        }
        return;
      }
      case "BODY_ENCRYPTED":
        await baoLoi("BODY_ENCRYPTED");
        return;
      case "PORTAL_HTTP_ERROR":
      case "NETWORK":
        await baoLoi("PORTAL_HTTP_ERROR", kq.httpStatus);
        return;
      case "PORTAL_BAD_SHAPE":
        await baoLoi("PORTAL_BAD_SHAPE");
        return;
      default:
        // URL_BLOCKED / BAD_COMMAND / BAD_RESULT: lỗi mã của chính extension.
        await baoLoi("SYNC_FAILED");
    }
  }

  /** Áp một tín hiệu phiên. Trả `true` nếu vừa CHUYỂN sang READY (nơi gọi quét bù ngay). */
  async function apDung(th: TinHieuPhien): Promise<boolean> {
    const truoc = await docPhien();
    const now = pt.dongHo();
    const kq = xuLyTinHieu(truoc, th, now);
    await khoPhien.ghi({ phien: kq.phien });
    if (kq.quetBu) {
      const last = await docSo(kho, "lastSyncedAt");
      const tu = tuQuetBuSauReady(last, now);
      const dangCho = await docSo(khoPhien, "canQuetBuTu");
      await khoPhien.ghi({ canQuetBuTu: dangCho === null ? tu : Math.min(dangCho, tu) });
    }
    if (kq.suKien) await xepStatus({ ...kq.suKien });
    return kq.phien.trangThai === "READY" && truoc.trangThai !== "READY";
  }

  async function kiemPhien(ctx: NguCanh, tab: TabInfo): Promise<boolean> {
    const kq = await guiLenh(tab.id, lenhPhien(ctx.cauHinh.merchantCode));
    let daReady = false;
    switch (kq.loai) {
      case "PHIEN":
        await khoPhien.xoa(["tapNhan"]);
        await dongLoi(["PORTAL_TAB_MISSING"]);
        daReady = await apDung({
          loai: "PHIEN",
          coUser: kq.coUser,
          hetHanLuc: kq.hetHanLuc,
          nguonHetHan: kq.nguonHetHan,
          dau: kq.dauHeader,
        });
        break;
      case "HET_PHIEN":
        await apDung({ loai: "HTTP", httpStatus: kq.httpStatus, dau: kq.dauHeader });
        break;
      case "CHUYEN_HUONG":
        await apDung({ loai: "VE_DANG_NHAP" });
        break;
      case "LOI":
        await xuLyLoiLenh(tab.id, kq);
        break;
      default:
        await baoLoi("SYNC_FAILED");
    }
    await guiStatusCho(ctx);
    return daReady;
  }

  async function xuLyLoiDongBo(tabId: number, loi: LoiDongBo): Promise<void> {
    switch (loi.nguon) {
      case "PORTAL": {
        const r = loi.ketQua;
        if (r.loai === "HET_PHIEN") await apDung({ loai: "HTTP", httpStatus: r.httpStatus, dau: r.dauHeader });
        // RV5: search (API) bị chuyển hướng — đích không rõ, session có thể VẪN có user ⇒ cần bằng chứng
        // phiên mới như 401/403 (không thì READY↔EXPIRED mỗi 10′). Tab điều hướng tới /login đi đường riêng.
        else if (r.loai === "CHUYEN_HUONG") await apDung({ loai: "API_CHUYEN_HUONG", dau: r.dauHeader });
        else if (r.loai === "LOI") await xuLyLoiLenh(tabId, r);
        else await baoLoi("SYNC_FAILED");
        return;
      }
      case "PHAN_TRANG":
        await baoLoi(loi.ma === "PORTAL_BAD_SHAPE" ? "PORTAL_BAD_SHAPE" : "SYNC_FAILED");
        return;
      case "SATAROBO": {
        const ctx2 = await docNguCanh();
        // Bí mật sai / agent bị tắt: goiApi đã đặt cờ DỪNG — không báo gì thêm (cũng không gửi được).
        if (ctx2 && !ctx2.dung && (loi.httpStatus === 400 || loi.httpStatus === 413 || loi.httpStatus === 415)) {
          await baoLoi("SYNC_FAILED", loi.httpStatus);
        }
        return;
      }
      default:
        await baoLoi("SYNC_FAILED");
    }
  }

  async function dongBo(ctx: NguCanh, jobs: readonly JobDongBo[]): Promise<void> {
    const tab = await tabSan();
    if (!tab) return;
    const now = pt.dongHo();
    // RV5: mốc cuối theo giờ ĐÃ HIỆU CHỈNH + biên; lastSyncedAt không bao giờ vượt giờ thật (cua-so.ts).
    const moc = mocDongBo(now, (await docSo(khoPhien, "lechGio")) ?? 0);
    const cuaSo = chonCuaSo({
      lastSyncedAt: await docSo(kho, "lastSyncedAt"),
      canQuetBuTu: await docSo(khoPhien, "canQuetBuTu"),
      scanFroms: jobs.map((j) => j.scanFrom).filter(soHuuHan),
      now: moc.denTimKiem,
    });
    const syncId = `sync-${maThoiGianVN(now)}-${taoNonce().slice(0, 8)}`;
    // 1.1 §4.4: dòng bị TỪ CHỐI trong `rejected[]` đã có dấu ở máy chủ — không gửi lại, không bỏ, không giữ jobIds.
    const quaDai: TuChoiDong[] = [];
    const kq = await chayDongBo({
      cuaSo,
      jobIds: jobs.map((j) => j.id),
      syncId,
      goiTrang: (manh, pageIndex) => guiLenh(tab.id, lenhTimKiem(ctx.cauHinh.merchantCode, manh, pageIndex, PAGE_SIZE)),
      guiLo: async (lo) => {
        const r = await goiApi(ctx, {
          phuongThuc: "POST",
          duongDan: API_AGENT.transactions,
          than: lo,
          timeoutMs: TIMEOUT_GIAO_DICH_MS,
        });
        if (r.ok) {
          quaDai.push(...docTuChoi(r.data).filter((t) => t.code === "FIELD_TOO_LONG")); // mã khác: không cần làm gì
          return { ok: true, data: r.data };
        }
        return r.loai === "HTTP"
          ? { ok: false, ma: r.ma, httpStatus: r.httpStatus, field: r.field }
          : { ok: false, ma: r.chiTiet, httpStatus: null, field: null };
      },
    });
    if (quaDai.length > 0) await baoTruongQuaDai(truongQuaDai(quaDai));
    await khoPhien.ghi({
      lanDongBoCuoi: {
        luc: isoVN(now),
        ok: kq.ok,
        soDong: kq.soDong,
        soLo: kq.soLo,
        loi: kq.ok ? (kq.dongBiBo > 0 ? "DONG_BI_BO" : null) : kq.loi.nguon,
      },
    });
    if (kq.ok) {
      await kho.ghi({ lastSyncedAt: moc.lastSyncedAt });
      await khoPhien.xoa(["canQuetBuTu", "tapHeader", "tapNhan"]);
      if (kq.dongBiBo > 0) {
        // Lượt chưa trọn (máy chủ từ chối dòng): giữ ERROR mở — báo một lần, không báo lại mỗi phút.
        await dongLoi(LOI_DONG_BO.filter((m) => m !== "SYNC_FAILED"));
        await baoLoi("SYNC_FAILED", 400);
      } else {
        await dongLoi(LOI_DONG_BO);
      }
      return;
    }
    await xuLyLoiDongBo(tab.id, kq.loi);
  }

  // ---------- hiển thị + nhịp nhanh ----------

  async function capNhatHienThi(): Promise<void> {
    const ctx = await docNguCanh();
    if (!ctx) {
      await pt.hienThi({ nhan: "CHƯA", mau: "XAM", tieuDe: "Chưa cấu hình — mở Tuỳ chọn của extension" });
      return;
    }
    if (ctx.dung) {
      const mo: Record<MaDung, string> = {
        BAD_SIGNATURE: "Bí mật agent sai hoặc đã bị tạo lại — dán bí mật mới ở Tuỳ chọn",
        AGENT_DISABLED: "Agent đã bị tắt trên satarobo",
        MERCHANT_CONFIG_MISMATCH: "Mã merchant khác với satarobo — kiểm lại Tuỳ chọn",
      };
      await pt.hienThi({ nhan: "DỪNG", mau: "DO", tieuDe: mo[ctx.dung] });
      return;
    }
    const phien = await docPhien();
    const loiMo = (await khoPhien.doc<string[]>("loiMo")) ?? [];
    if (phien.trangThai === "EXPIRED") {
      await pt.hienThi({ nhan: "HẾT", mau: "DO", tieuDe: "Phiên portal đã hết — đăng nhập lại trong tab ghim" });
    } else if (loiMo.length > 0) {
      const truong = (await khoPhien.doc<string[]>("truongQuaDai")) ?? [];
      const chu = loiMo.map((m) => (m === "FIELD_TOO_LONG" && truong.length > 0 ? `${m} (${truong.join(", ")})` : m));
      await pt.hienThi({ nhan: "LỖI", mau: "CAM", tieuDe: `Lỗi: ${chu.join(", ")}` });
    } else if (phien.trangThai === "READY") {
      await pt.hienThi({ nhan: "OK", mau: "XANH", tieuDe: "Đang đồng bộ giao dịch thẻ" });
    } else {
      await pt.hienThi({ nhan: "…", mau: "XAM", tieuDe: "Đang kiểm phiên portal" });
    }
  }

  async function lenLichNhanh(): Promise<void> {
    if (daHenNhanh) return;
    const ms = henHoiNhanh(await docSo(khoPhien, "nhanhDen"), await docSo(khoPhien, "nextPollGanNhat"), pt.dongHo());
    if (ms === null) return;
    daHenNhanh = true;
    pt.datHenGio(() => {
      daHenNhanh = false;
      void bdp.hoiNhanh();
    }, ms);
  }

  async function ketThuc(): Promise<void> {
    const ctx = await docNguCanh();
    if (ctx && ctx.dung !== "BAD_SIGNATURE" && ctx.dung !== "AGENT_DISABLED") await guiStatusCho(ctx);
    await capNhatHienThi();
    await lenLichNhanh();
  }

  // ---------- việc chính ----------

  async function khoiDongNoiBo(lyDo: "INSTALL" | "STARTUP" | "CAU_HINH"): Promise<void> {
    const ctx = await docNguCanh();
    if (!ctx || ctx.dung === "BAD_SIGNATURE") return capNhatHienThi();
    // Heartbeat TRƯỚC: kiểm danh tính + merchant trước khi chạm portal.
    await guiHeartbeat(ctx);
    const ctx2 = await docNguCanh();
    if (!ctx2 || ctx2.dung) return ketThuc();
    const tab = await tabSan(lyDo === "INSTALL");
    if (tab && (await kiemPhien(ctx2, tab))) await dongBo(ctx2, []);
    await ketThuc();
  }

  const bdp: BoDieuPhoi = {
    khoiDong: (lyDo) => xepHang(() => khoiDongNoiBo(lyDo)),

    nhipPhut: () =>
      xepHang(async () => {
        const ctx = await docNguCanh();
        if (!ctx || ctx.dung === "BAD_SIGNATURE" || ctx.dung === "AGENT_DISABLED" || (await dangBiChan())) {
          return capNhatHienThi();
        }
        await guiStatusCho(ctx);
        const jobs = await layJobs(ctx); // nhịp "còn sống" (§8.2) — gửi cả khi phiên hết
        const ctx2 = await docNguCanh();
        if (!ctx2 || ctx2.dung) return ketThuc();
        if ((await docPhien()).trangThai === "UNKNOWN") {
          const tab = await tabSan();
          if (tab) await kiemPhien(ctx2, tab);
        }
        if ((await docPhien()).trangThai === "READY") await dongBo(ctx2, jobs ?? []);
        await ketThuc();
      }),

    nhipKeepalive: () =>
      xepHang(async () => {
        const ctx = await docNguCanh();
        if (!ctx || ctx.dung === "BAD_SIGNATURE" || (await dangBiChan())) return capNhatHienThi();
        if (!ctx.dung) {
          const tab = await tabSan();
          if (tab && (await kiemPhien(ctx, tab))) await dongBo(ctx, []);
        }
        const ctx2 = await docNguCanh();
        if (ctx2 && ctx2.dung !== "BAD_SIGNATURE") await guiHeartbeat(ctx2);
        await ketThuc();
      }),

    hoiNhanh: () =>
      xepHang(async () => {
        const ctx = await docNguCanh();
        if (!ctx || ctx.dung) return;
        const nhanhDen = await docSo(khoPhien, "nhanhDen");
        if (nhanhDen === null || pt.dongHo() >= nhanhDen) return;
        if (!(await dangBiChan())) {
          const jobs = await layJobs(ctx);
          const ctx2 = await docNguCanh();
          if (ctx2 && !ctx2.dung && jobs && jobs.length > 0 && (await docPhien()).trangThai === "READY") {
            await dongBo(ctx2, jobs);
          }
        }
        await ketThuc();
      }),

    dongBoNgay: () =>
      xepHang(async () => {
        const ctx = await docNguCanh();
        if (!ctx || ctx.dung || (await dangBiChan())) return;
        if ((await docPhien()).trangThai !== "READY") return;
        await dongBo(ctx, []);
        await ketThuc();
      }),

    tabCapNhat: (tabId, url) =>
      xepHang(async () => {
        if (!url || !laTrangDangNhap(url)) return;
        if (tabId !== (await docSo(khoPhien, "tabId"))) return;
        const ctx = await docNguCanh();
        if (!ctx || ctx.dung) return;
        await apDung({ loai: "VE_DANG_NHAP" });
        await ketThuc();
      }),

    tabDong: (tabId) =>
      xepHang(async () => {
        if (tabId === (await docSo(khoPhien, "tabId"))) await khoPhien.xoa(["tabId"]);
      }),

    trangSanSang: (tabId, duongDan) =>
      xepHang(async () => {
        const ctx = await docNguCanh();
        if (!ctx || ctx.dung) return;
        const tabCuaTa = await docSo(khoPhien, "tabId");
        if (laTrangDangNhap(duongDan)) {
          if (tabId === tabCuaTa) {
            await apDung({ loai: "VE_DANG_NHAP" });
            await ketThuc();
          }
          return;
        }
        if ((await docPhien()).trangThai !== "READY") {
          // Có thể admin vừa đăng nhập lại (ở tab nào cũng được — cookie dùng chung): kiểm ngay.
          const tab = await tabSan();
          if (tab && (await kiemPhien(ctx, tab))) await dongBo(ctx, []);
          await ketThuc();
          return;
        }
        if (tabId === tabCuaTa && duongDan === TRANG_GIAO_DICH) {
          // Chờ app gọi search của nó (bắt header) rồi mới đồng bộ.
          pt.datHenGio(() => {
            void bdp.dongBoNgay();
          }, CHO_SAU_TRANG_MOI_MS);
        }
      }),

    layCauHinh: () =>
      xepHang(async () => xemCongKhai(await kho.doc("cauHinh"), typeof (await kho.doc("biMat")) === "string", gocChoPhep)),

    luuCauHinh: (input) =>
      xepHang(async (): Promise<KetQuaLuu> => {
        const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const kq = kiemCauHinh(o.cauHinh, gocChoPhep);
        const loi: LoiCauHinh = kq.ok ? {} : { ...kq.loi };
        let biMatMoi: string | null = null;
        if (typeof o.biMatMoi === "string" && o.biMatMoi.trim() !== "") {
          const b = kiemBiMat(o.biMatMoi);
          if (b.ok) biMatMoi = b.biMat;
          else loi.agentSecret = b.loi;
        }
        const biMatCu = await kho.doc<string>("biMat");
        if (!biMatMoi && typeof biMatCu !== "string" && !loi.agentSecret) {
          loi.agentSecret = "Chưa có bí mật agent — dán bí mật lấy từ màn Sức khoẻ POS Agent.";
        }
        if (!kq.ok || Object.keys(loi).length > 0) return { ok: false, loi };
        const cu = docCauHinhDaLuu(await kho.doc("cauHinh"), gocChoPhep);
        const doiDinhDanh =
          !cu ||
          cu.agentId !== kq.cauHinh.agentId ||
          cu.merchantCode !== kq.cauHinh.merchantCode ||
          cu.satAroboBaseUrl !== kq.cauHinh.satAroboBaseUrl;
        await kho.ghi(biMatMoi ? { cauHinh: kq.cauHinh, biMat: biMatMoi } : { cauHinh: kq.cauHinh });
        if (doiDinhDanh) await kho.xoa(["lastSyncedAt"]);
        if (doiDinhDanh || biMatMoi) await khoPhien.xoa(KHOA_PHIEN_TRANG_THAI);
        else await khoPhien.xoa(["dung", "chanDen", "loiMo", "truongQuaDai"]);
        void xepHang(() => khoiDongNoiBo("CAU_HINH"));
        return { ok: true, xem: xemCongKhai(kq.cauHinh, true, gocChoPhep) };
      }),

    layTrangThai: () =>
      xepHang(async (): Promise<TrangThaiCongKhai> => {
        const phien = await docPhien();
        const last = await docSo(kho, "lastSyncedAt");
        const nhanhDen = await docSo(khoPhien, "nhanhDen");
        const canQuetBuTu = await docSo(khoPhien, "canQuetBuTu");
        return {
          phienBan: PHIEN_BAN,
          trangThaiPhien: phien.trangThai,
          lyDoHet: phien.lyDo,
          hetHanLuc: phien.hetHanLuc,
          lastSyncedAt: last === null ? null : isoVN(last),
          dung: (await khoPhien.doc<MaDung>("dung")) ?? null,
          loiMo: (await khoPhien.doc<string[]>("loiMo")) ?? [],
          tabId: await docSo(khoPhien, "tabId"),
          nhanhDen: nhanhDen === null ? null : isoVN(nhanhDen),
          canQuetBuTu: canQuetBuTu === null ? null : isoVN(canQuetBuTu),
          lanDongBoCuoi: (await khoPhien.doc<TrangThaiCongKhai["lanDongBoCuoi"]>("lanDongBoCuoi")) ?? null,
          truongQuaDai: (await khoPhien.doc<KhoaGiaoDich[]>("truongQuaDai")) ?? [],
        };
      }),

    guiHeartbeatNgay: () =>
      xepHang(async () => {
        const ctx = await docNguCanh();
        if (!ctx || ctx.dung === "BAD_SIGNATURE") return capNhatHienThi();
        if (!ctx.dung) {
          const tab = await tabSan();
          if (tab) await kiemPhien(ctx, tab);
        }
        await guiHeartbeat(ctx);
        await ketThuc();
      }),

    async choXong() {
      let cu: Promise<void>;
      do {
        cu = duoi;
        await cu;
      } while (cu !== duoi);
    },
  };
  return bdp;
}
