// lib/scorm/dem-dia.ts — ĐỆM ĐĨA cho asset SCORM (12/10/2026).
//
// Vì sao: số đo thật từ VPS (container test, 419 tệp của một gói): 396/419 tệp ≤ 200 KB, và mỗi tệp lấy từ R2 mất ~270 ms
// (TTFB). Bài nặng ở SỐ LƯỢT tệp chứ không ở số byte: 20 tệp nối đuôi = 5,5 giây, 40 tệp song song = 0,56 giây. Trên mạng yếu
// mỗi bước của chuỗi tải bài cộng thêm ~270 ms phía server. Đĩa VPS trả tệp trong vài ms.
// Cũng giải phóng KẾT NỐI R2 sớm: video lớn phát cho client chậm không còn giữ một socket R2 cả buổi (pool mặc định 50, không hạn chờ).
//
// Làm gì: (1) tệp lấy từ R2 được ghi xuống đĩa (nhỏ: ghi sau khi đã trả; lớn: do lượt LÀM NÓNG), (2) `lamNongGoi` tải cả gói về đĩa
// song song khi giáo viên mở bài/tab tài liệu — lúc iframe xin tệp thì đã nằm trên đĩa. (3) Route phục vụ từ đĩa, hỗ trợ Range.
//
// An toàn: tệp chỉ được phục vụ SAU khi route đã xác vé + phiên + mã gói (đệm nằm sau các hàng rào, không có đường vào riêng).
// Khoá đĩa = sha256(key R2) nên không có path traversal. Đĩa của container (overlay) — mất khi triển khai lại, và đó là chấp nhận
// được (đệm nguội lại được làm nóng ở lượt mở đầu tiên). Gói là BẤT BIẾN theo mã gói (bản mới = gói mới); hạn dùng của một mục đệm
// là `SCORM_CACHE_TTL_HOURS` (mặc định 72h) để tệp ghi lại cùng khoá không bị phục vụ vô hạn.
//
// Cấu hình (đọc lúc gọi, test đổi được): SCORM_CACHE_DIR · SCORM_CACHE_MAX_MB (mặc định 3072) · SCORM_CACHE_TTL_HOURS (72) ·
// SCORM_CACHE_OFF=1 để tắt hẳn (rollback không cần triển khai lại mã).
//
// ── 24/10/2026 (vòng 2) — GỘP LƯỢT TẢI + LÀM NÓNG GỌN ────────────────────────────────────────────────────────────────────────
// Đo (docs/scorm-hieu-nang/benchmark.md): lượt mở NGUỘI đầu tiên của gói 369 tệp vẫn 7,3 s (route cũ 7,6 s) và tốn 715 request R2 thay vì 370,
// vì lượt làm nóng tải lại đúng các tệp người dùng đang xin; 10 giáo viên mở cùng lúc vẫn ≈ 21 s vì mỗi lượt trượt đệm tự đi R2.
//   · `taiTepNhoDungChung` — SINGLE-FLIGHT theo khoá R2 cho tệp NHỎ (≤ NGUONG_DEM_BYTE): route và lượt làm nóng dùng CHUNG một bản đồ
//     "đang tải", bên sau chờ kết quả của bên trước thay vì gọi R2 lần nữa. Chỉ gộp tệp nhỏ; tệp lớn / Range vẫn truyền dòng riêng.
//   · Làm nóng chỉ tải tệp ≤ NGUONG_LAM_NONG_BYTE (8 MB), tệp nhỏ trước — video để Range-stream lo, đừng tranh băng thông với tệp nhỏ.
import "server-only";
import { createHash } from "node:crypto";
import { close as dongFd, createReadStream, createWriteStream, fstat as fstatFd, open as moFd } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { HAN_CHO_R2_MS as HAN_CHO_HEADER_MS, HAN_TREO_THAN_MS, NGUONG_DEM_BYTE, canhGacTreo, docHetLuong } from "@/lib/scorm/luong-r2";
import { getR2Bucket, getR2Client } from "@/lib/storage/r2-client";
import { chungTienTrinh } from "@/lib/scorm/chung-tien-trinh";

const MB = 1024 * 1024;
/** Tệp ≤ ngưỡng này nạp RAM khi làm nóng; lớn hơn ghi thẳng luồng xuống đĩa (không giữ cả tệp trong RAM). */
const NGUONG_RAM_BYTE = 4 * MB;
/**
 * Làm nóng CHỈ tải tệp ≤ ngưỡng này (24/10/2026, trước đó 120 MB). Lý do:
 *  · tệp lớn gần như luôn là video (đo: ≤ 200 KB cho 396/419 tệp của gói thật, video tới 72 MB) và video được phục vụ bằng `Range` stream
 *    — trình duyệt xin từng khoảng, tua không tải lại — nên nạp trước cả tệp không giúp ai mà còn là phần lớn byte của đợt làm nóng
 *    (benchmark ca D: 130 MB kéo từ R2 cho một gói 29 MB cần thật sự);
 *  · nó chiếm khe tải + băng thông R2 đúng lúc các tệp nhỏ (thứ trình duyệt cần để HIỆN bài) đang tranh nhau.
 * Tệp lớn hơn vẫn được phục vụ bình thường (route truyền dòng/Range từ R2), chỉ không được nạp trước xuống đĩa.
 */
export const NGUONG_LAM_NONG_BYTE = 8 * MB;
/**
 * Số tệp tải song song khi làm nóng — TOÀN CỤC cho cả tiến trình (không phải mỗi gói): chừa chỗ cho request thật trong pool R2 (50 socket)
 * và chặn RAM đỉnh ≈ 12 × NGUONG_RAM_BYTE dù có bao nhiêu gói đang được làm nóng cùng lúc.
 */
const SONG_SONG_LAM_NONG_MAC_DINH = 12;
/** Đọc lúc gọi (test và vận hành đổi được không cần deploy mã): `SCORM_LAM_NONG_SONG_SONG`, kẹp trong [4, 32] — pool R2 của SDK là 50 socket dùng chung với người dùng thật. */
export function songSongLamNong(): number {
  const n = Number(process.env.SCORM_LAM_NONG_SONG_SONG);
  return Number.isFinite(n) && n >= 4 ? Math.min(32, Math.floor(n)) : SONG_SONG_LAM_NONG_MAC_DINH;
}
/** Số gói được làm nóng cùng lúc; gói thứ ba trở đi bỏ qua (KHÔNG xếp hàng — lần mở sau sẽ làm), tránh dồn hàng đợi vô hạn. */
const TOI_DA_GOI_LAM_NONG = 2;
/** R2 lỗi liên tiếp ngần này tệp ⇒ dừng đợt làm nóng và nghỉ (đừng đập thêm vào một R2 đang ốm). */
const LOI_LIEN_TIEP_DUNG = 5;
const NGHI_SAU_LOI_MS = 2 * 60_000;
const HAN_CHO_R2_MS = 30_000;
const KHOANG_DON_MS = 5 * 60_000;

export type MetaDem = {
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  size: number;
  /** Lúc ghi (epoch ms) — tính hạn dùng. */
  luc: number;
};

export const demDangBat = (): boolean => process.env.SCORM_CACHE_OFF !== "1";
const thuMuc = (): string => process.env.SCORM_CACHE_DIR || join(tmpdir(), "satarobo-scorm-cache");
const tranByte = (): number => (Number(process.env.SCORM_CACHE_MAX_MB) > 0 ? Number(process.env.SCORM_CACHE_MAX_MB) : 3072) * MB;
const hanMs = (): number => (Number(process.env.SCORM_CACHE_TTL_HOURS) > 0 ? Number(process.env.SCORM_CACHE_TTL_HOURS) : 72) * 3600_000;

function duongDan(key: string): { bin: string; json: string; thuMucCon: string } {
  const h = createHash("sha256").update(key).digest("hex");
  const thuMucCon = join(thuMuc(), h.slice(0, 2));
  return { bin: join(thuMucCon, `${h}.bin`), json: join(thuMucCon, `${h}.json`), thuMucCon };
}

/** Meta của mục đệm — null nếu chưa có / hỏng / hết hạn. `.json` được ghi SAU `.bin` nên có json = bản ghi trọn vẹn. */
export async function docMetaDem(key: string, now = Date.now()): Promise<MetaDem | null> {
  if (!demDangBat()) return null;
  const p = duongDan(key);
  try {
    const meta = JSON.parse(await readFile(p.json, "utf8")) as MetaDem;
    if (typeof meta.size !== "number" || typeof meta.luc !== "number") return null;
    if (now - meta.luc > hanMs()) return null;
    const st = await stat(p.bin);
    if (st.size !== meta.size) return null; // dở dang / bị cắt
    return meta;
  } catch {
    return null;
  }
}

/** Luồng đọc từ đĩa (cả tệp hoặc một khoảng `[start, end]` đóng, theo byte). */
export function moLuongDem(key: string, khoang?: { start: number; end: number }): Readable {
  return createReadStream(duongDan(key).bin, khoang ? { start: khoang.start, end: khoang.end } : undefined);
}

/**
 * Như `moLuongDem` nhưng MỞ FD TRƯỚC: lỗi (tệp vừa bị `donDem` xoá giữa lúc `docMetaDem` và lúc đọc) ném ngay ở đây để route rơi về R2,
 * thay vì phản hồi đã gửi header 200 rồi đứt giữa thân. Đã có fd thì `donDem` xoá tên tệp cũng không cắt luồng đang chạy (Linux/VPS).
 * `sizeMong` (nếu có) phải khớp kích thước thật — lệch ⇒ ném (tệp bị ghi đè dở dang).
 *
 * ⚠️ Cố ý dùng `fs.open` kiểu callback (fd SỐ), KHÔNG dùng `fs/promises.open` (đối tượng `FileHandle`): Node hiện hành coi việc
 * `FileHandle` bị đóng lúc GC là lỗi KHÔNG BẮT ĐƯỢC (`ERR_INVALID_STATE`) và sập tiến trình. Phản hồi video bị bỏ dở mà không ai
 * `cancel()` (client treo, TCP đầy) sẽ để lại đúng một luồng chưa đóng; fd số thì tệ nhất chỉ rò một fd.
 */
export function moLuongDemAnToan(key: string, khoang?: { start: number; end: number }, sizeMong?: number): Promise<Readable> {
  const bin = duongDan(key).bin;
  return new Promise<Readable>((ok, loi) => {
    moFd(bin, "r", (eMo, fd) => {
      if (eMo) return loi(eMo);
      const huy = (e: unknown) => {
        dongFd(fd, () => {});
        loi(e);
      };
      fstatFd(fd, (eSt, st) => {
        if (eSt) return huy(eSt);
        if (sizeMong !== undefined && st.size !== sizeMong) return huy(new Error("tệp đệm đổi kích thước"));
        try {
          ok(createReadStream(bin, { fd, ...(khoang ? { start: khoang.start, end: khoang.end } : {}), autoClose: true }));
        } catch (e) {
          huy(e);
        }
      });
    });
  });
}

export async function docToanBoDem(key: string): Promise<Buffer> {
  return readFile(duongDan(key).bin);
}

async function chotMuc(key: string, tmp: string, meta: Omit<MetaDem, "luc">, now: number): Promise<void> {
  const p = duongDan(key);
  await rename(tmp, p.bin);
  const day: MetaDem = { ...meta, luc: now };
  const tmpJson = `${p.json}.${process.pid}.tmp`;
  await writeFile(tmpJson, JSON.stringify(day));
  await rename(tmpJson, p.json); // json cuối cùng = mục đã trọn vẹn
}

/** Ghi một tệp đã có trong RAM xuống đĩa (nuốt lỗi: đệm hỏng không được làm hỏng việc dạy). */
export async function ghiDemTuBytes(key: string, bytes: Uint8Array, meta: Omit<MetaDem, "luc" | "size">, now = Date.now()): Promise<void> {
  if (!demDangBat()) return;
  try {
    const p = duongDan(key);
    await mkdir(p.thuMucCon, { recursive: true });
    const tmp = `${p.bin}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, bytes);
    await chotMuc(key, tmp, { ...meta, size: bytes.length }, now);
  } catch {
    /* fail-open */
  }
}

/** Ghi thẳng một luồng xuống đĩa (tệp lớn — không giữ cả tệp trong RAM). */
async function ghiDemTuLuong(key: string, luong: Readable, meta: Omit<MetaDem, "luc" | "size">, size: number, now = Date.now()): Promise<void> {
  const p = duongDan(key);
  await mkdir(p.thuMucCon, { recursive: true });
  const tmp = `${p.bin}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  // Nguồn đứng im giữa thân thì pipeline treo vô hạn và giữ một khe tải toàn cục ⇒ canh treo (huỷ nguồn, pipeline ném).
  const dungCanh = canhGacTreo(luong, HAN_TREO_THAN_MS);
  try {
    await pipeline(luong, createWriteStream(tmp));
    const st = await stat(tmp);
    if (size > 0 && st.size !== size) throw new Error("tệp tải về không đủ byte");
    await chotMuc(key, tmp, { ...meta, size: st.size }, now);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  } finally {
    dungCanh();
  }
}

// ── Dọn đệm: quá hạn trước, rồi cũ nhất cho tới khi ≤ 80% trần ───────────────────────────────────────────────────────────
// Trạng thái cấp TIẾN TRÌNH, dùng chung giữa trang play và route asset (xem chung-tien-trinh.ts); các ô số gom vào một đối tượng.
const so = chungTienTrinh("dem-dia.so", () => ({ donCuoi: 0, nghiDen: 0, dangTai: 0 }));
export async function donDem(now = Date.now(), ep = false): Promise<{ xoa: number; conLaiByte: number }> {
  if (!demDangBat()) return { xoa: 0, conLaiByte: 0 };
  if (!ep && now - so.donCuoi < KHOANG_DON_MS) return { xoa: 0, conLaiByte: -1 };
  so.donCuoi = now;
  const goc = thuMuc();
  type Muc = { bin: string; json: string; size: number; mtime: number };
  const ds: Muc[] = [];
  try {
    for (const con of await readdir(goc)) {
      let tep: string[];
      try {
        tep = await readdir(join(goc, con));
      } catch {
        continue;
      }
      for (const t of tep) {
        if (!t.endsWith(".bin")) {
          // mảnh `.tmp` mồ côi (tiến trình chết giữa chừng) quá 1 giờ thì xoá
          if (t.endsWith(".tmp")) {
            const st = await stat(join(goc, con, t)).catch(() => null);
            if (st && now - st.mtimeMs > 3600_000) await rm(join(goc, con, t), { force: true }).catch(() => {});
          }
          continue;
        }
        const bin = join(goc, con, t);
        const st = await stat(bin).catch(() => null);
        if (st) ds.push({ bin, json: bin.replace(/\.bin$/, ".json"), size: st.size, mtime: st.mtimeMs });
      }
    }
  } catch {
    return { xoa: 0, conLaiByte: 0 }; // thư mục chưa có
  }
  let tong = ds.reduce((s, m) => s + m.size, 0);
  let xoa = 0;
  const bo = async (m: Muc) => {
    await rm(m.json, { force: true }).catch(() => {});
    await rm(m.bin, { force: true }).catch(() => {});
    tong -= m.size;
    xoa++;
  };
  const conHan: Muc[] = [];
  for (const m of ds) {
    if (now - m.mtime > hanMs()) await bo(m);
    else conHan.push(m);
  }
  if (tong > tranByte()) {
    conHan.sort((a, b) => a.mtime - b.mtime);
    for (const m of conHan) {
      if (tong <= tranByte() * 0.8) break;
      await bo(m);
    }
  }
  return { xoa, conLaiByte: tong };
}

// ── Gộp lượt tải tệp NHỎ theo khoá (single-flight) ───────────────────────────────────────────────────────────────────────
//
// Một bản đồ "khoá R2 → lượt tải đang bay" DÙNG CHUNG cho đường route (trượt đệm) và lượt làm nóng. Bên đến sau chờ kết quả (bytes) của
// bên đến trước thay vì gọi R2 lần nữa; bytes được ghi xuống đĩa ĐÚNG MỘT LẦN, trong cùng lượt tải. Bất biến:
//   1. CHỈ tệp nhỏ: lượt tải nhìn `ContentLength` của phản hồi; > NGUONG_DEM_BYTE (hoặc không rõ) ⇒ nhả socket ngay và trả `{loai:"lon"}` —
//      từng bên tự đi đường truyền dòng riêng (mỗi client một luồng + backpressure riêng). Khoá lớn được NHỚ (`tepLonBiet`) để lần sau
//      khỏi tốn một lượt "dò" nữa.
//   2. Lượt tải KHÔNG thuộc về client nào: nó có AbortController riêng. Người chờ ngắt (`signal` abort) chỉ rút tên khỏi danh sách; lượt
//      tải chỉ bị huỷ khi KHÔNG CÒN AI chờ (đếm tham chiếu) — để một client ngắt không làm hỏng lượt mà người khác đang chờ.
//   3. Lỗi KHÔNG ở lại: entry bị xoá khỏi bản đồ ngay khi lượt tải kết thúc (xong, lỗi, hay bị huỷ) — lỗi không bị nhớ vĩnh viễn, lần
//      sau thử R2 lại. Mọi người đang chờ nhận CÙNG một lỗi (404 → 404, treo → 504, ...).
//   4. Entry còn nằm trong bản đồ cho tới khi bytes đã ghi xong xuống đĩa: người đến giữa lúc đó vẫn gộp vào, không gọi R2 thêm.
//   5. Gộp chỉ thay NGUỒN byte. Quyền (vé, phiên, mã gói, đường dẫn nội bộ) do route kiểm TRƯỚC khi gọi hàm này, cho TỪNG request.
export type TepNho = { loai: "nho"; bytes: Buffer; meta: Omit<MetaDem, "luc" | "size"> };
export type KetQuaTaiNho = TepNho | { loai: "lon" };

type LuotTai = {
  p: Promise<KetQuaTaiNho>;
  ctl: AbortController;
  nguoiCho: number;
  hoanTat: boolean;
  /** Xong khi bytes đã ghi xuống đĩa (hoặc lượt tải hỏng/bị huỷ) VÀ entry đã gỡ khỏi bản đồ. Không bao giờ reject. */
  daGhi: Promise<void>;
};
const dangTaiNho = chungTienTrinh("dem-dia.dangTaiNho", () => new Map<string, LuotTai>());
/** Khoá đã biết là tệp LỚN (> NGUONG_DEM_BYTE). Gói bất biến theo mã gói nên không cần hạn; chặn kích thước để không phình. */
const tepLonBiet = chungTienTrinh("dem-dia.tepLonBiet", () => new Set<string>());
const TEP_LON_BIET_TOI_DA = 4096;

/** Ghi nhớ một khoá là tệp lớn (route/làm nóng biết qua `ContentLength` hay danh sách liệt kê). */
export function ghiNhoTepLon(key: string): void {
  if (tepLonBiet.has(key)) return;
  if (tepLonBiet.size >= TEP_LON_BIET_TOI_DA) {
    const dau = tepLonBiet.values().next();
    if (!dau.done) tepLonBiet.delete(dau.value);
  }
  tepLonBiet.add(key);
}

/**
 * Đang có lượt tải gộp cho khoá này không? CHỈ để QUAN SÁT (Server-Timing: phân biệt "bên mở lượt tải" với "bên chờ lượt của người khác"). Gọi NGAY
 * trước `taiTepNhoDungChung(key)` thì chính xác: từ lúc hỏi tới lúc hàm đó đọc `dangTaiNho.get(key)` không có `await` nào xen vào (đã có test ghim).
 */
export function coLuotTaiNhoDangBay(key: string): boolean {
  return dangTaiNho.has(key);
}

const laLuongNode = (b: unknown): b is Readable =>
  typeof b === "object" && b !== null && typeof (b as Readable).pipe === "function" && typeof (b as Readable).on === "function";

function loiHuy(): Error {
  const e = new Error("Request aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Một lượt tải thật: GetObject (hạn chờ header) → nếu nhỏ thì đọc hết vào RAM, nếu lớn thì nhả socket và báo "lớn".
 * `bietNho`: bên MỞ lượt đã biết chắc tệp nhỏ (danh sách liệt kê của R2 nói vậy) nên không đòi `ContentLength` phải khai — vẫn bị trần byte.
 */
async function chayTaiNho(key: string, signal: AbortSignal, bietNho: boolean): Promise<KetQuaTaiNho> {
  if (signal.aborted) throw loiHuy();
  const ctl = new AbortController();
  const noiHuy = () => ctl.abort();
  signal.addEventListener("abort", noiHuy, { once: true });
  let hetHan = false;
  const hen = setTimeout(() => {
    hetHan = true;
    ctl.abort();
  }, HAN_CHO_HEADER_MS);
  try {
    let obj;
    try {
      obj = await getR2Client().send(new GetObjectCommand({ Bucket: getR2Bucket(), Key: key }), { abortSignal: ctl.signal });
    } catch (e) {
      // Quá hạn chờ header: đổi sang TimeoutError để `phanLoaiLoiR2` ra 504 (còn AbortError do người chờ rút hết thì không ai nhận).
      if (hetHan) throw Object.assign(new Error("R2 quá hạn chờ header"), { name: "TimeoutError" });
      throw e;
    } finally {
      clearTimeout(hen);
    }
    const nguon: unknown = obj.Body;
    const dai = Number(obj.ContentLength ?? 0);
    const kichThuocNho = bietNho ? dai <= NGUONG_DEM_BYTE : dai > 0 && dai <= NGUONG_DEM_BYTE;
    if (!kichThuocNho || !laLuongNode(nguon)) {
      if (dai > NGUONG_DEM_BYTE) ghiNhoTepLon(key);
      if (laLuongNode(nguon)) {
        nguon.on("error", () => {});
        nguon.destroy();
      }
      ctl.abort(); // nhả socket R2 ngay (đừng giữ thân đang chảy của tệp lớn)
      return { loai: "lon" };
    }
    const bytes = await docHetLuong(nguon, { toiDaByte: NGUONG_DEM_BYTE, signal: ctl.signal });
    return {
      loai: "nho",
      bytes,
      meta: {
        contentType: obj.ContentType ?? "application/octet-stream",
        etag: obj.ETag ?? null,
        lastModified: obj.LastModified ? obj.LastModified.toUTCString() : null,
      },
    };
  } finally {
    signal.removeEventListener("abort", noiHuy);
  }
}

/**
 * Lấy một tệp NHỎ từ R2 với gộp lượt theo khoá. `signal` = tín hiệu ngắt của NGƯỜI CHỜ (không phải của lượt tải): abort ⇒ promise này
 * reject `AbortError`, còn lượt tải vẫn chạy nếu còn người khác chờ. Reject với lỗi R2 gốc (NoSuchKey, TimeoutError, ...) khi lượt tải hỏng.
 * Khi khoá đã biết là tệp lớn thì trả `{loai:"lon"}` ngay, không gọi R2.
 */
export function taiTepNhoDungChung(
  key: string,
  opt: { signal?: AbortSignal; bietNho?: boolean; choGhiDia?: boolean } = {},
): Promise<KetQuaTaiNho> {
  if (tepLonBiet.has(key)) return Promise.resolve({ loai: "lon" });
  const signal = opt.signal;
  if (signal?.aborted) return Promise.reject(loiHuy());

  let luot = dangTaiNho.get(key);
  if (!luot) {
    const ctl = new AbortController();
    const moi: LuotTai = { p: chayTaiNho(key, ctl.signal, opt.bietNho === true), ctl, nguoiCho: 0, hoanTat: false, daGhi: Promise.resolve() };
    luot = moi;
    dangTaiNho.set(key, moi);
    // Dọn: ghi đĩa (nếu nhỏ) rồi mới gỡ entry. Lỗi/huỷ ⇒ gỡ ngay. `.then(_, onLoi)` cũng là chỗ nhận lỗi để không thành "unhandled rejection".
    moi.daGhi = moi.p
      .then(
        async (kq) => {
          moi.hoanTat = true;
          if (kq.loai === "nho") await ghiDemTuBytes(key, kq.bytes, kq.meta);
        },
        () => {
          moi.hoanTat = true;
        },
      )
      .finally(() => {
        if (dangTaiNho.get(key) === moi) dangTaiNho.delete(key);
      });
  }
  const l = luot;
  l.nguoiCho++;
  return new Promise<KetQuaTaiNho>((ok, loi) => {
    let xong = false;
    const rut = () => {
      xong = true;
      signal?.removeEventListener("abort", khiHuy);
      l.nguoiCho--;
    };
    const khiHuy = () => {
      if (xong) return;
      rut();
      // Hết người chờ mà lượt tải chưa xong ⇒ huỷ nó (nhả socket) và gỡ entry để người đến sau không gộp vào một lượt đã chết.
      if (l.nguoiCho <= 0 && !l.hoanTat) {
        if (dangTaiNho.get(key) === l) dangTaiNho.delete(key);
        l.ctl.abort();
      }
      loi(loiHuy());
    };
    signal?.addEventListener("abort", khiHuy, { once: true });
    l.p.then(
      (kq) => {
        if (xong) return;
        if (opt.choGhiDia) {
          // Lượt làm nóng: chỉ coi là "đã tải" khi tệp đã nằm trên đĩa (và entry đã gỡ) — nếu không, đợt làm nóng báo xong khi đĩa chưa có gì.
          void l.daGhi.then(() => {
            if (xong) return;
            rut();
            ok(kq);
          });
          return;
        }
        rut();
        ok(kq);
      },
      (e: unknown) => {
        if (xong) return;
        rut();
        loi(e);
      },
    );
  });
}

// ── Làm nóng cả gói ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type KetQuaLamNong = { tai: number; daCo: number; boQua: number; loi: number; ms: number; dung?: "loi-lien-tiep" | "dang-nghi" | "day-goi" };
const dangLamNong = chungTienTrinh("dem-dia.dangLamNong", () => new Map<string, Promise<KetQuaLamNong>>());
const lanCuoiLamNong = chungTienTrinh("dem-dia.lanCuoiLamNong", () => new Map<string, number>());
/** Một gói vừa làm nóng xong thì chưa làm lại ngay — tệp còn trượt (quá lớn / lỗi) sẽ không kéo cả đợt liệt kê R2 mỗi lượt. */
const NGHI_GIUA_HAI_LAN_MS = 10 * 60_000;
/** Chưa làm nóng gói nào trước mốc này (epoch ms): R2 vừa lỗi liên tiếp. Route cũng đặt mốc này khi gặp 502/504 thật. */

/** Route gặp lỗi hạ tầng R2 (502/504) ⇒ tạm không làm nóng nữa — đừng thêm tải vào R2 đang ốm. */
export function ghiNhanLoiR2(now = Date.now()): void {
  so.nghiDen = Math.max(so.nghiDen, now + NGHI_SAU_LOI_MS);
}

// Khe tải TOÀN CỤC (mọi gói chung một giới hạn). Tay nắm giao thẳng cho người đợi kế tiếp, không trả về rồi giành lại.
const hangDoiTai = chungTienTrinh("dem-dia.hangDoiTai", () => [] as Array<() => void>);
async function vaoKheTai(): Promise<void> {
  if (so.dangTai < songSongLamNong()) {
    so.dangTai++;
    return;
  }
  await new Promise<void>((xong) => hangDoiTai.push(xong));
}
function raKheTai(): void {
  const ke = hangDoiTai.shift();
  if (ke) ke();
  else so.dangTai--;
}

/**
 * Tải cả gói (theo prefix R2) về đĩa. Một gói chỉ làm nóng MỘT lần tại một thời điểm (gộp các lượt gọi), và nghỉ
 * `NGHI_GIUA_HAI_LAN_MS` giữa hai lần. Tối đa `TOI_DA_GOI_LAM_NONG` gói cùng lúc, tối đa `songSongLamNong()` (mặc định 12) tệp cùng lúc TOÀN CỤC.
 * R2 vừa lỗi thì nghỉ `NGHI_SAU_LOI_MS`. Không bao giờ ném.
 */
export function lamNongGoi(prefix: string, now = Date.now()): Promise<KetQuaLamNong> {
  const khoa = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const dang = dangLamNong.get(khoa);
  if (dang) return dang;
  const khong = (dung: KetQuaLamNong["dung"]): Promise<KetQuaLamNong> => Promise.resolve({ tai: 0, daCo: 0, boQua: 0, loi: 0, ms: 0, dung });
  const truoc = lanCuoiLamNong.get(khoa);
  if (truoc !== undefined && now - truoc < NGHI_GIUA_HAI_LAN_MS) return khong(undefined);
  // Hai vế sau KHÔNG đánh dấu `lanCuoiLamNong`: chưa làm thật nên lần mở sau được thử lại ngay khi hết nghỉ / hết chỗ.
  if (now < so.nghiDen) return khong("dang-nghi");
  if (dangLamNong.size >= TOI_DA_GOI_LAM_NONG) return khong("day-goi");
  lanCuoiLamNong.set(khoa, now);
  const p = chayLamNong(khoa)
    .catch((): KetQuaLamNong => ({ tai: 0, daCo: 0, boQua: 0, loi: 1, ms: 0 }))
    .finally(() => dangLamNong.delete(khoa));
  dangLamNong.set(khoa, p);
  return p;
}

/**
 * Nhóm ưu tiên khi làm nóng (25/10/2026, vòng 2). Trước đó sắp theo CỠ tăng dần, nên với gói thật (đo ListObjectsV2 trên R2 PROD, gói 221 tệp: 154 png p50 577 B, 26 xsd, 12 js
 * p50 10,6 KB + một js 1,7 MB, 9 css, 8 woff) hàng đợi ĐI QUA ~150 ảnh/schema bé trước khi tới các tệp mã mà trình duyệt cần ĐẦU TIÊN, còn js 1,7 MB (runtime) rơi cuối hàng.
 * Nhóm 0 = mã trình duyệt chạy ngay (html/js/css/json); 1 = phông, con trỏ, icon; 2 = còn lại (ảnh, âm thanh…); 3 = schema/manifest SCORM mà trình duyệt KHÔNG xin
 * (.xsd, .dtd, imsmanifest.xml). Chỉ đổi THỨ TỰ làm việc — tổng số tệp và byte không đổi. `SCORM_LAM_NONG_THEO_CO=1` quay về thứ tự cũ (công tắc lùi, không cần deploy mã).
 */
export function nhomLamNong(key: string): 0 | 1 | 2 | 3 {
  const ten = key.slice(key.lastIndexOf("/") + 1).toLowerCase();
  const dot = ten.lastIndexOf(".");
  const duoi = dot >= 0 ? ten.slice(dot + 1) : "";
  if (ten === "imsmanifest.xml" || duoi === "xsd" || duoi === "dtd") return 3;
  if (duoi === "html" || duoi === "htm" || duoi === "js" || duoi === "mjs" || duoi === "css" || duoi === "json" || duoi === "xml") return 0;
  if (duoi === "woff" || duoi === "woff2" || duoi === "ttf" || duoi === "otf" || duoi === "cur" || duoi === "ico") return 1;
  return 2;
}

export function soSanhLamNong(a: { key: string; size: number }, b: { key: string; size: number }): number {
  if (process.env.SCORM_LAM_NONG_THEO_CO === "1") return a.size - b.size;
  return nhomLamNong(a.key) - nhomLamNong(b.key) || a.size - b.size;
}

async function chayLamNong(prefix: string): Promise<KetQuaLamNong> {
  const t0 = Date.now();
  const kq: KetQuaLamNong = { tai: 0, daCo: 0, boQua: 0, loi: 0, ms: 0 };
  if (!demDangBat()) return kq;
  const s3 = getR2Client();
  const bucket = getR2Bucket();

  const cacTep: { key: string; size: number }[] = [];
  let tok: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: tok }));
    for (const o of r.Contents ?? []) {
      if (!o.Key || !o.Size) continue;
      // Biết sẵn tệp lớn thì route khỏi tốn một lượt "dò" kích thước (xem `taiTepNhoDungChung`).
      if (o.Size > NGUONG_DEM_BYTE) ghiNhoTepLon(o.Key);
      // `source.zip` là bản ZIP GỐC lúc tải lên — không bao giờ phục vụ cho giáo viên; đừng tốn đĩa/băng thông cho nó.
      // Tệp > NGUONG_LAM_NONG_BYTE (video) cũng bỏ: phục vụ bằng Range stream, không cần nạp trước (xem hằng).
      if (/\.zip$/i.test(o.Key) || o.Size > NGUONG_LAM_NONG_BYTE) {
        kq.boQua++;
        continue;
      }
      cacTep.push({ key: o.Key, size: o.Size });
    }
    tok = r.NextContinuationToken;
  } while (tok);
  // THỨ TỰ: mã chạy được (html/js/css/json) trước, rồi phông + con trỏ, rồi ảnh/âm thanh, schema SCORM sau cùng; trong cùng nhóm thì tệp nhỏ trước.
  cacTep.sort(soSanhLamNong);

  let i = 0;
  let loiLienTiep = 0;
  const lam = async () => {
    for (;;) {
      if (kq.dung) return; // đã quyết dừng (R2 lỗi liên tiếp)
      const t = cacTep[i++];
      if (!t) return;
      const ctl = new AbortController();
      let hen: ReturnType<typeof setTimeout> | undefined;
      await vaoKheTai();
      try {
        const co = await docMetaDem(t.key);
        if (co && co.size === t.size) {
          kq.daCo++;
          continue;
        }
        if (t.size <= NGUONG_DEM_BYTE) {
          // Tệp nhỏ: đi qua MỘT bản đồ "đang tải" chung với route. Người dùng đang xin đúng khoá này ⇒ gộp vào lượt của họ (KHÔNG đọc thân
          // R2 lần hai); chưa ai xin ⇒ lượt này tải và ghi đĩa. Danh sách nói nhỏ nhưng R2 nói lớn (lỗi thời) ⇒ bỏ qua tệp.
          const gop = await taiTepNhoDungChung(t.key, { bietNho: true, choGhiDia: true });
          if (gop.loai === "nho") kq.tai++;
          else kq.boQua++;
          loiLienTiep = 0;
          continue;
        }
        hen = setTimeout(() => ctl.abort(), HAN_CHO_R2_MS);
        let obj;
        try {
          obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: t.key }), { abortSignal: ctl.signal });
        } finally {
          clearTimeout(hen);
        }
        if (!obj.Body) throw new Error("body rỗng");
        const meta = {
          contentType: obj.ContentType ?? "application/octet-stream",
          etag: obj.ETag ?? null,
          lastModified: obj.LastModified ? obj.LastModified.toUTCString() : null,
        };
        if (t.size <= NGUONG_RAM_BYTE) {
          // Có trần byte (R2 khai sai size ⇒ huỷ, không phình RAM) + canh treo.
          await ghiDemTuBytes(t.key, await docHetLuong(obj.Body as unknown as Readable, { toiDaByte: NGUONG_RAM_BYTE + 1 }), meta);
        } else {
          await ghiDemTuLuong(t.key, obj.Body as unknown as Readable, meta, t.size);
        }
        kq.tai++;
        loiLienTiep = 0;
      } catch {
        // Huỷ request còn dở: thân đang chảy dở mà lỗi thì socket R2 phải được nhả, không để mồ côi.
        ctl.abort();
        kq.loi++;
        if (++loiLienTiep >= LOI_LIEN_TIEP_DUNG) {
          kq.dung = "loi-lien-tiep";
          so.nghiDen = Date.now() + NGHI_SAU_LOI_MS;
        }
      } finally {
        if (hen) clearTimeout(hen);
        raKheTai();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(songSongLamNong(), cacTep.length) }, lam));
  await donDem().catch(() => {});
  kq.ms = Date.now() - t0;
  return kq;
}

/** Chỉ cho test: xoá trạng thái nhớ trong tiến trình. */
export function _datLaiTrangThai(): void {
  so.donCuoi = 0;
  so.nghiDen = 0;
  dangLamNong.clear();
  lanCuoiLamNong.clear();
  hangDoiTai.length = 0;
  so.dangTai = 0;
  dangTaiNho.clear();
  tepLonBiet.clear();
}
