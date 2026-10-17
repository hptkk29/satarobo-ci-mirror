/**
 * EL-10 — PHÂN TÍCH HEADER `Range` cho đường phát video.
 *
 * Thuần, không biết gì về HTTP hay R2 — nhận chuỗi header và dung lượng tệp, trả
 * ra khoảng byte phải đọc. Nhờ vậy toàn bộ số học biên kiểm được bằng test
 * thường, không cần dựng máy chủ.
 *
 * ⚠️ Vì sao phải làm cho đúng: trình phát video của trình duyệt KHÔNG tải cả
 * tệp. Nó xin từng khoảng, và khi người xem tua thì nó xin một khoảng ở giữa.
 * Trả sai một byte ở biên thì video chạy được vài giây rồi đứng, không có lỗi
 * nào hiện ra — người học chỉ thấy màn hình treo.
 *
 * ⚠️ Trả 200 (cả tệp) khi client xin Range cũng "chạy được" — cho tới khi có
 * người mở video 200MB trên 4G.
 */

export type KetQuaRange =
  | { loai: "toan-bo" }
  | {
      loai: "mot-phan";
      start: number;
      end: number;
      contentLength: number;
      contentRange: string;
    }
  | { loai: "khong-thoa-man"; contentRange: string };

/**
 * @param header Giá trị header `Range` (có thể `null`).
 * @param size   Dung lượng tệp, tính bằng byte.
 */
export function docRange(header: string | null | undefined, size: number): KetQuaRange {
  if (!header) return { loai: "toan-bo" };

  const s = header.trim().toLowerCase();
  if (!s.startsWith("bytes=")) {
    // Đơn vị khác `bytes` là thứ không hệ nào dùng thật. Bỏ qua header và trả cả
    // tệp — đúng theo RFC, và an toàn hơn là đoán.
    return { loai: "toan-bo" };
  }

  const spec = s.slice(6).trim();
  if (!spec) return { loai: "toan-bo" };

  // ⚠️ Nhiều khoảng (`bytes=0-99,200-299`) là hợp lệ theo RFC nhưng đòi phản hồi
  // multipart/byteranges. Không hệ phát video nào gửi kiểu đó. Chốt một hành vi
  // rõ ràng: chỉ phục vụ khoảng ĐẦU TIÊN — làm im lặng thì về sau không ai biết
  // nó có được xử hay không.
  const dau = spec.split(",")[0]!.trim();

  const m = /^(\d*)-(\d*)$/.exec(dau);
  if (!m) return { loai: "toan-bo" };

  const [, trai, phai] = m;

  // Tệp rỗng: không có khoảng nào thoả mãn được.
  if (size <= 0) {
    return { loai: "khong-thoa-man", contentRange: `bytes */${size}` };
  }

  let start: number;
  let end: number;

  if (trai === "") {
    // `bytes=-500` = 500 byte CUỐI. Đọc nhầm thành "từ 0 tới 500" là trả đúng
    // phần đầu tệp cho một client đang xin phần đuôi — và trình phát sẽ dựng
    // sai bảng thời gian.
    if (phai === "") return { loai: "toan-bo" };
    const dai = Number(phai);
    if (dai <= 0) {
      return { loai: "khong-thoa-man", contentRange: `bytes */${size}` };
    }
    start = Math.max(0, size - dai);
    end = size - 1;
  } else {
    start = Number(trai);
    if (start >= size) {
      // Xin quá cuối tệp ⇒ 416, kèm dung lượng thật để client tự chỉnh.
      return { loai: "khong-thoa-man", contentRange: `bytes */${size}` };
    }
    // `bytes=500-` = từ 500 tới hết. Và `end` vượt cuối tệp thì KẸP về cuối, đây
    // là hành vi RFC đòi — không phải lỗi của client.
    end = phai === "" ? size - 1 : Math.min(Number(phai), size - 1);
    if (end < start) {
      return { loai: "khong-thoa-man", contentRange: `bytes */${size}` };
    }
  }

  return {
    loai: "mot-phan",
    start,
    end,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${size}`,
  };
}

/** Chuỗi `Range` gửi cho R2 cho một khoảng đã chốt. */
export function rangeChoR2(start: number, end: number): string {
  return `bytes=${start}-${end}`;
}
