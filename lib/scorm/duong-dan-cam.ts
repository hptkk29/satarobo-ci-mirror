// lib/scorm/duong-dan-cam.ts — đường dẫn TRONG prefix gói SCORM mà route asset KHÔNG được phục vụ cho giáo viên. THUẦN.
//
// Vì sao có file này (đo 24/10/2026): `uploadKey` của gói là `<prefix>source.zip` (admin/scorm/_actions.ts) hoặc
// `<prefix>_src/package.zip` (api/admin/scorm/presign) — tức bản ZIP GỐC nằm CÙNG prefix với nội dung phục vụ và không bị xoá sau
// khi giải nén. Route ghép khoá = prefix + đường dẫn người dùng gửi ⇒ mọi giáo viên có vé tải được zip gốc (≈ 94MB), trái với ràng
// buộc "GV không tải được file nguồn". Cả 144 gói PUBLISHED đều có đúng một `source.zip` ở gốc.
//
// Hợp đồng (route gọi SAU `tachDuongDanAsset`, TRƯỚC mọi truy cập đệm đĩa/R2): trả true ⇒ route trả 404 (không lộ là có tồn tại).
// `rel` là các segment ĐÃ giải mã phần trăm lần đầu bởi Next.
//
// Khoá R2 khớp TỪNG BYTE và phân biệt hoa/thường, nên `Source.ZIP` hay `%2573ource.zip` tự nó không trúng object thật. Hàm này vẫn
// chuẩn hoá RỘNG TAY (giải mã tới khi hết đổi, NFKC, chữ thường, bỏ ký tự điều khiển/độ rộng-không, bỏ dấu chấm/khoảng trắng cuối,
// tách theo `/` và `\`) vì cái hại của chuẩn hoá thừa chỉ là chặn nhầm một tên lạ, còn cái hại của chuẩn hoá thiếu là lộ zip gốc khi
// một tầng phía dưới (proxy, bản Next khác, SDK) giải mã/gộp đường dẫn theo cách khác. Chỉ dùng để QUYẾT ĐỊNH chặn — khoá R2 vẫn dựng
// từ `rel` gốc, không bao giờ từ bản đã chuẩn hoá.
//
// Chọn có chủ đích: `.zip` chỉ bị chặn ở GỐC gói (ca duy nhất đo được: một `source.zip`/gói). Zip nằm sâu (`res/tai-ve/bai.zip`) là
// học liệu hợp lệ của gói và vẫn phục vụ. `source.pdf` của giáo án PDF là CHÍNH nội dung phát (launch) nên không nằm trong danh sách.

/** Số lần giải mã phần trăm tối đa. Hơn thế mà còn đổi ⇒ coi là cố tình lách, chặn luôn. */
const SO_LAN_GIAI_MA_TOI_DA = 5;

export function laDuongDanNoiBo(rel: readonly string[]): boolean {
  if (rel.length === 0) return false;
  const phan: string[] = [];
  for (const seg of rel) {
    const chuan = chuanHoaSegment(seg);
    if (chuan === null) return true; // mã hoá chồng quá sâu ⇒ chặn
    // Một segment giải mã ra `_src/package.zip` hay `res/../source.zip` phải được đối xử như nhiều segment.
    for (const p of chuan.split(/[\\/]+/)) phan.push(p);
  }
  // Dấu chấm, rỗng (sau khi bỏ dấu chấm/khoảng trắng cuối `..` thành rỗng ⇒ cũng rơi vào đây): không phải tên tệp thật.
  if (phan.some((p) => p === "" || p === "." || p === "..")) return true;
  // Thư mục nguồn của đường presign mới.
  if (phan.some((p) => p === "_src")) return true;
  // Bản zip gốc nằm ở GỐC gói (mọi gói thật chỉ có đúng một tệp .zip, và là tệp này).
  if (phan.length === 1 && phan[0].endsWith(".zip")) return true;
  return false;
}

/** Chuẩn hoá một segment để SO SÁNH. `null` ⇒ còn đổi sau `SO_LAN_GIAI_MA_TOI_DA` lần giải mã. */
function chuanHoaSegment(s: string): string | null {
  let v = s;
  let daOnDinh = false;
  for (let i = 0; i < SO_LAN_GIAI_MA_TOI_DA; i++) {
    const truoc = v;
    v = giaiMaMotLan(v);
    if (v === truoc) {
      daOnDinh = true;
      break;
    }
  }
  if (!daOnDinh) return null;
  return v
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Cc}\p{Cf}]/gu, "") // NUL, điều khiển, độ rộng-không (U+200B…), BOM — vô hình nhưng có thể nằm giữa tên
    .replace(/[\s.]+$/g, "");
}

/** Giải mã phần trăm một lượt. Chuỗi hỏng (`%zz`, `%` lẻ) thì giải mã được tới đâu hay tới đó, không ném. */
function giaiMaMotLan(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v.replace(/%([0-9a-f]{2})/gi, (m, hex: string) => {
      const ma = parseInt(hex, 16);
      return ma < 0x80 ? String.fromCharCode(ma) : m;
    });
  }
}
