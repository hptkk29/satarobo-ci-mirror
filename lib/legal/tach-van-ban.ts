// lib/legal/tach-van-ban.ts — TÁCH một văn bản pháp lý Markdown (`content/legal/<slug>.md`) thành
// các MỤC `## N. Tiêu đề` để dựng mục lục, neo `#muc-N` và đầu mục có số ở giao diện công khai.
//
// ⚠️ HÀM THUẦN, KHÔNG ĐỔI MỘT CHỮ NÀO CỦA VĂN BẢN. Văn bản pháp lý thật nằm ở file .md; giao diện chỉ
// đổi cách trình bày. Ràng buộc đó được khoá bằng phép THỬ VÒNG TRÒN trong `tach-van-ban.test.ts`:
// ghép lại `phanDau` + `thanBai` của mọi mục phải bằng đúng từng byte file gốc. Nên ở đây KHÔNG
// trim, KHÔNG chuẩn hoá xuống dòng — mọi thứ giữ nguyên trong `raw`.

/** Một mục `## ...`. */
export type MucVanBan = {
  /** Số thứ tự ghi ở đầu tiêu đề ("1. Chấp nhận" → 1); null nếu tiêu đề không đánh số. */
  so: number | null;
  /** Tiêu đề đã bỏ tiền tố "N. " — dùng làm chữ hiển thị. */
  tieu: string;
  /** Neo trên trang: `muc-<so>` (hoặc `muc-<vị trí>` khi không đánh số). */
  neo: string;
  /** Dòng tiêu đề NGUYÊN VĂN, gồm cả dấu xuống dòng cuối dòng. */
  dongTieuDe: string;
  /** Phần thân sau dòng tiêu đề, NGUYÊN VĂN (tới hết mục). */
  thanBai: string;
};

export type VanBanDaTach = {
  /** Mọi thứ trước mục `##` đầu tiên (gồm `# H1`, dòng cập nhật, đoạn dẫn nhập), NGUYÊN VĂN. */
  phanDau: string;
  /** Tiêu đề `# ...` (không có dấu #), hoặc null. */
  tieuDeH1: string | null;
  /** Ngày ở dòng "**Cập nhật lần cuối:** dd/mm/yyyy", hoặc null nếu file không có. */
  ngayCapNhat: string | null;
  muc: MucVanBan[];
};

const DONG_NGAY = /^\*\*Cập nhật lần cuối:\*\*\s*(.+?)\s*$/m;

/** Dòng bắt đầu một khối mã (``` hoặc ~~~) — bên trong khối đó không có đầu mục nào cả. */
function laRangGioiKhoiMa(dong: string): boolean {
  return /^\s{0,3}(```|~~~)/.test(dong);
}

export function tachVanBan(md: string): VanBanDaTach {
  // Giữ NGUYÊN dấu xuống dòng của từng dòng (kể cả CRLF) để ghép lại không lệch byte.
  const dong = md.match(/[^\n]*\n|[^\n]+$/g) ?? [];

  const chiSoMuc: number[] = [];
  let trongKhoiMa = false;
  dong.forEach((d, i) => {
    if (laRangGioiKhoiMa(d)) {
      trongKhoiMa = !trongKhoiMa;
      return;
    }
    if (!trongKhoiMa && /^## /.test(d)) chiSoMuc.push(i);
  });

  const phanDau = dong.slice(0, chiSoMuc[0] ?? dong.length).join("");
  const h1 = phanDau.match(/^# (.+?)\s*$/m);
  const ngay = phanDau.match(DONG_NGAY);

  const muc: MucVanBan[] = chiSoMuc.map((bd, k) => {
    const kt = chiSoMuc[k + 1] ?? dong.length;
    const dongTieuDe = dong[bd]!;
    const chu = dongTieuDe.replace(/^## /, "").trim();
    const kq = chu.match(/^(\d+)\.\s+(.*)$/);
    const so = kq ? Number(kq[1]) : null;
    return {
      so,
      tieu: kq ? kq[2]! : chu,
      neo: `muc-${so ?? k + 1}`,
      dongTieuDe,
      thanBai: dong.slice(bd + 1, kt).join(""),
    };
  });

  return { phanDau, tieuDeH1: h1 ? h1[1]! : null, ngayCapNhat: ngay ? ngay[1]! : null, muc };
}

/** Ghép lại từ kết quả tách — phải bằng đúng văn bản gốc (khẳng định của test vòng tròn). */
export function ghepVanBan(v: VanBanDaTach): string {
  return v.phanDau + v.muc.map((m) => m.dongTieuDe + m.thanBai).join("");
}

/**
 * Phần dẫn nhập để HIỂN THỊ: bỏ dòng `# H1` (tiêu đề đã nằm ở đầu trang) và dòng "Cập nhật lần cuối"
 * (đã chuyển lên đầu trang). Mọi đoạn khác (căn cứ pháp lý, lời dẫn…) giữ nguyên.
 */
export function phanDauDeHienThi(v: VanBanDaTach): string {
  return v.phanDau
    .replace(/^# .*\r?\n?/m, "")
    .replace(DONG_NGAY, "")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
}
