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
import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getR2Bucket, getR2Client } from "@/lib/storage/r2-client";

const MB = 1024 * 1024;
/** Tệp ≤ ngưỡng này nạp RAM khi làm nóng; lớn hơn ghi thẳng luồng xuống đĩa (không giữ cả tệp trong RAM). */
const NGUONG_RAM_BYTE = 4 * MB;
/** Bỏ qua tệp quá lớn (không phải slide/video bài giảng). */
const TEP_TOI_DA_BYTE = 120 * MB;
/** Số tệp tải song song khi làm nóng — chừa chỗ cho request thật trong pool R2 (50 socket). */
const SONG_SONG_LAM_NONG = 12;
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
  try {
    await pipeline(luong, createWriteStream(tmp));
    const st = await stat(tmp);
    if (size > 0 && st.size !== size) throw new Error("tệp tải về không đủ byte");
    await chotMuc(key, tmp, { ...meta, size: st.size }, now);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// ── Dọn đệm: quá hạn trước, rồi cũ nhất cho tới khi ≤ 80% trần ───────────────────────────────────────────────────────────
let donCuoi = 0;
export async function donDem(now = Date.now(), ep = false): Promise<{ xoa: number; conLaiByte: number }> {
  if (!demDangBat()) return { xoa: 0, conLaiByte: 0 };
  if (!ep && now - donCuoi < KHOANG_DON_MS) return { xoa: 0, conLaiByte: -1 };
  donCuoi = now;
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

// ── Làm nóng cả gói ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type KetQuaLamNong = { tai: number; daCo: number; boQua: number; loi: number; ms: number };
const dangLamNong = new Map<string, Promise<KetQuaLamNong>>();
const lanCuoiLamNong = new Map<string, number>();
/** Một gói vừa làm nóng xong thì chưa làm lại ngay — tệp còn trượt (quá lớn / lỗi) sẽ không kéo cả đợt liệt kê R2 mỗi lượt. */
const NGHI_GIUA_HAI_LAN_MS = 10 * 60_000;

/**
 * Tải cả gói (theo prefix R2) về đĩa. Một gói chỉ làm nóng MỘT lần tại một thời điểm (gộp các lượt gọi), và nghỉ
 * `NGHI_GIUA_HAI_LAN_MS` giữa hai lần. Không bao giờ ném.
 */
export function lamNongGoi(prefix: string, now = Date.now()): Promise<KetQuaLamNong> {
  const khoa = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const dang = dangLamNong.get(khoa);
  if (dang) return dang;
  const truoc = lanCuoiLamNong.get(khoa);
  if (truoc !== undefined && now - truoc < NGHI_GIUA_HAI_LAN_MS) {
    return Promise.resolve({ tai: 0, daCo: 0, boQua: 0, loi: 0, ms: 0 });
  }
  lanCuoiLamNong.set(khoa, now);
  const p = chayLamNong(khoa)
    .catch((): KetQuaLamNong => ({ tai: 0, daCo: 0, boQua: 0, loi: 1, ms: 0 }))
    .finally(() => dangLamNong.delete(khoa));
  dangLamNong.set(khoa, p);
  return p;
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
      // `source.zip` là bản ZIP GỐC lúc tải lên — không bao giờ phục vụ cho giáo viên; đừng tốn đĩa/băng thông cho nó.
      if (/\.zip$/i.test(o.Key) || o.Size > TEP_TOI_DA_BYTE) {
        kq.boQua++;
        continue;
      }
      cacTep.push({ key: o.Key, size: o.Size });
    }
    tok = r.NextContinuationToken;
  } while (tok);

  let i = 0;
  const lam = async () => {
    for (;;) {
      const t = cacTep[i++];
      if (!t) return;
      try {
        const co = await docMetaDem(t.key);
        if (co && co.size === t.size) {
          kq.daCo++;
          continue;
        }
        const ctl = new AbortController();
        const hen = setTimeout(() => ctl.abort(), HAN_CHO_R2_MS);
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
          await ghiDemTuBytes(t.key, await obj.Body.transformToByteArray(), meta);
        } else {
          await ghiDemTuLuong(t.key, obj.Body as unknown as Readable, meta, t.size);
        }
        kq.tai++;
      } catch {
        kq.loi++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SONG_SONG_LAM_NONG, cacTep.length) }, lam));
  await donDem().catch(() => {});
  kq.ms = Date.now() - t0;
  return kq;
}

/** Chỉ cho test: xoá trạng thái nhớ trong tiến trình. */
export function _datLaiTrangThai(): void {
  donCuoi = 0;
  dangLamNong.clear();
  lanCuoiLamNong.clear();
}
