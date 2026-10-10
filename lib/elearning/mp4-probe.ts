/**
 * EL-10 — ĐỌC HEADER MP4 để xác minh chuẩn nộp SAU khi tải lên (chốt 24/08).
 *
 * Vì sao phải có: video đi thẳng từ trình duyệt lên R2 (presign), nên máy chủ
 * không bao giờ thấy byte nào và không kiểm được codec hay thời lượng THẬT. Con
 * số trình duyệt khai chỉ dùng để chặn sớm; nó không phải bằng chứng.
 *
 * Cách làm: tải vài chục KB bằng HTTP Range, đọc cây hộp (box) của MP4. Hàm ở
 * đây THUẦN — nhận `Uint8Array` và nói cần đọc thêm ở đâu; người gọi lo phần
 * mạng. Nhờ vậy toàn bộ logic khó nhất test được không cần R2, không cần mạng.
 *
 * ⚠️ Điểm dễ sai nhất: hộp `moov` (chứa thời lượng và codec) có thể nằm ở ĐẦU
 * hoặc ở CUỐI tệp. Nhiều bộ xuất video để nó ở cuối; chỉ đọc đầu tệp thì với
 * những tệp đó ta không tìm thấy gì và sẽ kết luận nhầm là "tệp hỏng".
 */

export type CodecVideo = "avc1" | "hev1" | "khac";
export type CodecAudio = "mp4a" | "khac";

export type KetQuaDoc =
  | {
      xong: true;
      brand: string;
      durationSec: number | null;
      videoCodec: CodecVideo | null;
      audioCodec: CodecAudio | null;
      /** Độ phân giải MÃ HOÁ của track hình, đọc từ mục mẫu trong `stsd`. */
      rong: number | null;
      cao: number | null;
    }
  /** Chưa đủ dữ liệu — người gọi tải thêm đúng khoảng này rồi gọi lại. */
  | { xong: false; canDoc: { tu: number; dai: number } }
  | { xong: false; loi: "KHONG_PHAI_MP4" | "HONG" };

const TEN_HOP = (b: Uint8Array, i: number): string =>
  String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);

const u16 = (b: Uint8Array, i: number): number => ((b[i]! << 8) | b[i + 1]!) >>> 0;

const u32 = (b: Uint8Array, i: number): number =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

const u64 = (b: Uint8Array, i: number): number =>
  // MP4 cho phép kích thước 64-bit. JavaScript chỉ chính xác tới 2^53, nhưng một
  // hộp lớn hơn 9 petabyte thì không phải bài toán của hệ này.
  u32(b, i) * 2 ** 32 + u32(b, i + 4);

type Hop = { ten: string; batDau: number; noiDung: number; het: number };

/** Duyệt các hộp ở một mức, trong phạm vi bộ đệm đang có. */
function duyetHop(
  b: Uint8Array,
  tu: number,
  den: number,
  goc: number,
): { hop: Hop[]; thieuTu: number | null } {
  const hop: Hop[] = [];
  let i = tu;
  while (i + 8 <= den) {
    let size = u32(b, i);
    let noiDung = i + 8;
    if (size === 1) {
      if (i + 16 > den) return { hop, thieuTu: goc + i };
      size = u64(b, i + 8);
      noiDung = i + 16;
    } else if (size === 0) {
      // size 0 = hộp chạy tới hết tệp.
      size = den - i;
    }
    if (size < 8) return { hop, thieuTu: null };
    const het = i + size;
    hop.push({ ten: TEN_HOP(b, i + 4), batDau: i, noiDung, het });
    if (het > den) return { hop, thieuTu: goc + i };
    i = het;
  }
  return { hop, thieuTu: i < den ? goc + i : null };
}

function doMvhd(b: Uint8Array, h: Hop): number | null {
  // mvhd: version(1) flags(3) [creation, modification, timescale, duration]
  const v = b[h.noiDung];
  const p = h.noiDung + 4;
  if (v === 1) {
    if (p + 28 > h.het || p + 28 > b.length) return null;
    const timescale = u32(b, p + 16);
    const duration = u64(b, p + 20);
    return timescale > 0 ? duration / timescale : null;
  }
  if (p + 16 > h.het || p + 16 > b.length) return null;
  const timescale = u32(b, p + 8);
  const duration = u32(b, p + 12);
  return timescale > 0 ? duration / timescale : null;
}

export type Track = {
  loai: "vide" | "soun" | "khac";
  fourcc: string | null;
  rong: number | null;
  cao: number | null;
};

/** Một mục mẫu trong `stsd`: mã hoá, và với track hình là cả kích thước khung. */
type MauTrack = { fourcc: string | null; rong: number | null; cao: number | null };

/**
 * Đọc từng `trak`: nó là hình hay tiếng (`hdlr`), và mã hoá bằng gì (`stsd`).
 *
 * ⚠️ Phải đọc `hdlr` chứ KHÔNG suy loại track từ chính fourcc. Bản đầu gộp mọi
 * fourcc vào một danh sách rồi hỏi "có `mp4a` không" — với video KHÔNG CÓ TIẾNG
 * thì câu trả lời là "không", và nó bị đọc thành "tiếng sai codec". Video minh
 * hoạ không lời là nội dung hợp lệ, chặn nó là chặn nhầm.
 */
function docTracks(b: Uint8Array, tu: number, den: number): Track[] {
  const ra: Track[] = [];
  const { hop } = duyetHop(b, tu, Math.min(den, b.length), 0);
  for (const h of hop) {
    if (h.ten !== "trak") continue;
    const noi = Math.min(h.het, b.length);
    const loai = loaiTrack(b, h.noiDung, noi);
    // ⚠️ CHỈ đọc kích thước khi track là HÌNH. `AudioSampleEntry` có cách xếp
    // trường khác hẳn `VisualSampleEntry`: đúng chỗ chứa chiều rộng của video thì
    // ở track tiếng là số kênh và tần số mẫu. Đọc chung một công thức cho cả hai
    // là sinh ra "video 2×16 điểm ảnh" từ một track tiếng hoàn toàn bình thường.
    const mau = docMauTrack(b, h.noiDung, noi, loai === "vide");
    ra.push({
      loai,
      fourcc: mau?.fourcc ?? null,
      rong: mau?.rong ?? null,
      cao: mau?.cao ?? null,
    });
  }
  return ra;
}

function loaiTrack(b: Uint8Array, tu: number, den: number): Track["loai"] {
  const mdia = duyetHop(b, tu, den, 0).hop.find((x) => x.ten === "mdia");
  if (!mdia) return "khac";
  const hdlr = duyetHop(b, mdia.noiDung, Math.min(mdia.het, b.length), 0).hop.find(
    (x) => x.ten === "hdlr",
  );
  if (!hdlr) return "khac";
  // hdlr: version+flags(4) pre_defined(4) handler_type(4)
  const p = hdlr.noiDung + 8;
  if (p + 4 > Math.min(hdlr.het, b.length)) return "khac";
  const t = TEN_HOP(b, p);
  return t === "vide" || t === "soun" ? t : "khac";
}

/**
 * Đọc mục mẫu đầu tiên trong `stsd`.
 *
 * `VisualSampleEntry` (ISO/IEC 14496-12) xếp trường như sau, tính từ đầu mục:
 * `size(4) type(4)` · `reserved(6) data_reference_index(2)` ·
 * `pre_defined(2) reserved(2) pre_defined(12)` · **`width(2) height(2)`** ⇒ chiều
 * rộng nằm ở byte 32, chiều cao ở byte 34. Mục mẫu hình thật luôn dài ≥86 byte;
 * mục ngắn hơn 36 byte là tệp dị dạng ⇒ trả `null`, KHÔNG đoán.
 */
function docMauTrack(
  b: Uint8Array,
  tu: number,
  den: number,
  laHinh: boolean,
  sau = 0,
): MauTrack | null {
  if (sau > 8) return null;
  const { hop } = duyetHop(b, tu, Math.min(den, b.length), 0);
  for (const h of hop) {
    const noi = Math.min(h.het, b.length);
    if (h.ten === "stsd") {
      // stsd: version+flags(4) entryCount(4) rồi tới mục mẫu [size(4) type(4)]
      const p = h.noiDung + 8;
      if (p + 8 > noi) return null;
      const coKichThuoc = laHinh && u32(b, p) >= 36 && p + 36 <= noi;
      return {
        fourcc: TEN_HOP(b, p + 4),
        rong: coKichThuoc ? u16(b, p + 32) : null,
        cao: coKichThuoc ? u16(b, p + 34) : null,
      };
    }
    if (["mdia", "minf", "stbl"].includes(h.ten)) {
      const r = docMauTrack(b, h.noiDung, noi, laHinh, sau + 1);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Đọc phần đã tải được và cho biết đã đủ chưa.
 *
 * @param b       Byte đã tải.
 * @param offset  `b` bắt đầu từ byte thứ mấy của tệp.
 * @param coTep   Tổng dung lượng tệp (để biết đọc đuôi ở đâu).
 */
export function docMp4(b: Uint8Array, offset: number, coTep: number): KetQuaDoc {
  if (offset === 0) {
    if (b.length < 12) return { xong: false, canDoc: { tu: 0, dai: 65536 } };
    if (TEN_HOP(b, 4) !== "ftyp") {
      // Không có `ftyp` ở đầu thì đây không phải MP4 — kể cả khi đuôi tệp là
      // `.mp4`. Đây chính là trường hợp đổi tên tệp cho lọt cổng.
      return { xong: false, loi: "KHONG_PHAI_MP4" };
    }
  }

  const { hop, thieuTu } = duyetHop(b, 0, b.length, offset);
  const brand = offset === 0 && b.length >= 12 ? TEN_HOP(b, 8) : "";

  const moov = hop.find((h) => h.ten === "moov");
  if (moov) {
    if (moov.het > b.length) {
      // Thấy `moov` nhưng chưa tải hết nó.
      return {
        xong: false,
        canDoc: { tu: offset + moov.batDau, dai: moov.het - moov.batDau },
      };
    }
    const mvhd = duyetHop(b, moov.noiDung, moov.het, offset).hop.find(
      (h) => h.ten === "mvhd",
    );
    const durationSec = mvhd ? doMvhd(b, mvhd) : null;
    const tracks = docTracks(b, moov.noiDung, moov.het);
    const hinh = tracks.find((t) => t.loai === "vide");
    const tieng = tracks.find((t) => t.loai === "soun");

    return {
      xong: true,
      brand,
      durationSec,
      // `null` = KHÔNG CÓ track loại đó. Khác hẳn "có nhưng sai codec".
      videoCodec: hinh
        ? hinh.fourcc === "avc1" || hinh.fourcc === "avc3"
          ? "avc1"
          : hinh.fourcc === "hev1" || hinh.fourcc === "hvc1"
            ? "hev1"
            : "khac"
        : null,
      audioCodec: tieng ? (tieng.fourcc === "mp4a" ? "mp4a" : "khac") : null,
      rong: hinh?.rong ?? null,
      cao: hinh?.cao ?? null,
    };
  }

  // ⚠️ Chưa thấy `moov` ở khúc này. Nếu còn hộp chưa duyệt hết thì đọc tiếp từ
  // đó; nếu đã duyệt hết phần đang có mà vẫn chưa tới cuối tệp thì `moov` nằm ở
  // CUỐI — đọc đuôi. Bỏ nhánh đuôi là kết luận nhầm "tệp hỏng" cho mọi tệp xuất
  // ra mà không bật fast-start.
  if (thieuTu !== null && thieuTu < coTep) {
    return { xong: false, canDoc: { tu: thieuTu, dai: 1024 * 1024 } };
  }
  const daDuyetToi = offset + b.length;
  if (daDuyetToi < coTep) {
    const duoi = Math.min(4 * 1024 * 1024, coTep);
    return { xong: false, canDoc: { tu: coTep - duoi, dai: duoi } };
  }

  return { xong: false, loi: "HONG" };
}

export type ChuanCodec =
  | { ok: true }
  | { ok: false; code: "CODEC_VIDEO_SAI" | "CODEC_AUDIO_SAI" | "KHONG_DOC_DUOC" };

/**
 * Đối chiếu kết quả đọc với chuẩn nộp.
 *
 * ⚠️ `null` (không đọc được) KHÔNG được coi là đạt. Cho qua khi không đọc được
 * nghĩa là ai muốn lách chỉ cần nộp tệp mà bộ đọc không hiểu.
 */
export function kiemCodec(kq: Extract<KetQuaDoc, { xong: true }>): ChuanCodec {
  // Không có track hình nào = không phải video bài học, dù tệp có hợp lệ.
  if (kq.videoCodec === null) return { ok: false, code: "KHONG_DOC_DUOC" };
  if (kq.videoCodec !== "avc1") return { ok: false, code: "CODEC_VIDEO_SAI" };
  // Không có tiếng là hợp lệ (video minh hoạ không lời); có tiếng thì phải AAC.
  if (kq.audioCodec !== null && kq.audioCodec !== "mp4a") {
    return { ok: false, code: "CODEC_AUDIO_SAI" };
  }
  return { ok: true };
}

export const THONG_BAO_CODEC: Record<
  Exclude<ChuanCodec, { ok: true }>["code"],
  string
> = {
  CODEC_VIDEO_SAI:
    "Video phải mã hoá H.264 (AVC). Xuất lại bằng H.264 rồi tải lên lần nữa.",
  CODEC_AUDIO_SAI: "Âm thanh phải mã hoá AAC. Xuất lại rồi tải lên lần nữa.",
  KHONG_DOC_DUOC:
    "Không đọc được thông tin mã hoá của tệp — có thể tệp hỏng hoặc không phải MP4 thật.",
};
