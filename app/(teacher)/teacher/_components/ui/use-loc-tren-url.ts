"use client";

// Bộ lọc danh sách sống trên URL thay vì trong bộ nhớ component.
//
// Vì sao (QA site GV vòng 1, BUG-019 — nguyên nhân gốc RC-7): 10 màn của site giáo
// viên giữ bộ lọc bằng `useState` thuần, nên đổi bộ lọc không đổi query string ⇒ không
// gửi link cho đồng nghiệp được, F5 là mất sạch. Trong khi các màn khác của chính site
// này đã làm đúng với `?classId=…&tab=…`.
//
// ⚠️ GIÁ TRỊ BAN ĐẦU ĐẾN TỪ SERVER, KHÔNG ĐỌC URL TRONG useEffect.
//
// Bản đầu (03/09) đọc `window.location.search` trong một effect chạy lúc gắn rồi
// `setGiaTri`. Đo trên trình duyệt thì hỏng một nửa: `?trangThai=COMPLETED` áp đúng
// nhưng `?trangThai=ALL` bị bỏ qua — phân trang ra 2 trang (38 lớp) thay vì 3 (50 lớp).
// Dấu vết cho thấy effect CÓ chạy và tính đúng, nên giá trị bị ghi đè ngay sau đó: một
// cuộc đua giữa effect này và lượt khởi tạo của ô Select (Base UI phát `onValueChange`
// khi hoà giải `value` lúc hydrate, và handler đó gọi ngược `dat()` với giá trị cũ).
//
// Cách chữa là bỏ hẳn cuộc đua: Server Component đọc `searchParams` rồi truyền xuống
// làm prop, hook nhận qua `banDau` và dùng nó ngay ở lượt render ĐẦU TIÊN. Server và
// client vì thế render cùng một giá trị — không còn trạng thái nào đổi sau hydrate, và
// cũng không còn lệch hydrate.
//
// ⚠️ Đường GHI vẫn dùng `history.replaceState`, KHÔNG dùng `router.replace`:
// `router.replace` bắt Next nạp lại RSC payload sau MỖI phím gõ trong ô tìm kiếm — màn
// Học viên đang đổ 273 dòng thì đó là một lượt truy vấn cho mỗi ký tự. Đánh đổi có ý
// thức: URL chia sẻ được và sống sót qua F5, nhưng Back/Forward KHÔNG lần ngược từng
// bước lọc (replaceState không tạo mục lịch sử).
//
// ⚠️ GIỮ NGUYÊN tham số lạ trên URL. Trang hồ sơ học viên dùng `?s=…&ptab=…&classId=…`;
// một hook lọc mà ghi đè cả query string sẽ đá bay ngữ cảnh của màn khác.
import { useCallback, useMemo, useState } from "react";

export type LocTrenUrl<K extends string> = {
  gia_tri: Record<K, string>;
  dat: (khoa: K, gia_tri: string) => void;
  dat_nhieu: (patch: Partial<Record<K, string>>) => void;
  xoa_het: () => void;
  /** Có bộ lọc nào đang khác mặc định không — để hiện nút "Xoá bộ lọc". */
  dang_loc: boolean;
};

/**
 * Gộp giá trị đọc từ `searchParams` với mặc định.
 *
 * Tách hàm THUẦN để test được và để Server Component gọi lại nếu cần: tham số thiếu,
 * rỗng, hay `undefined` đều phải rơi về mặc định chứ không thành chuỗi rỗng.
 */
export function gopLocBanDau<K extends string>(
  macDinh: Record<K, string>,
  banDau?: Partial<Record<K, string | undefined>>,
): Record<K, string> {
  const ra = { ...macDinh };
  if (!banDau) return ra;
  for (const k of Object.keys(macDinh) as K[]) {
    const v = banDau[k];
    if (typeof v === "string" && v !== "") ra[k] = v;
  }
  return ra;
}

/**
 * @param macDinh giá trị mặc định của từng khoá. Khoá đang mang giá trị mặc định thì
 *   KHÔNG xuất hiện trên URL — URL sạch, và "không có tham số" luôn nghĩa là "mặc định".
 * @param banDau giá trị Server Component đọc được từ `searchParams`. Bỏ trống thì màn
 *   đó KHÔNG deep-link được — đừng bỏ trống rồi trông đợi URL có tác dụng, đó đúng là
 *   lỗi của bản đầu.
 */
export function useLocTrenUrl<K extends string>(
  macDinh: Record<K, string>,
  banDau?: Partial<Record<K, string | undefined>>,
): LocTrenUrl<K> {
  const khoas = useMemo(() => Object.keys(macDinh) as K[], [macDinh]);

  // Lazy init: giá trị đúng có NGAY ở lượt render đầu, cả trên server lẫn client.
  const [giaTri, setGiaTri] = useState<Record<K, string>>(() =>
    gopLocBanDau(macDinh, banDau),
  );

  const ghiUrl = useCallback(
    (next: Record<K, string>) => {
      if (typeof window === "undefined") return;
      const q = new URLSearchParams(window.location.search);
      for (const k of khoas) {
        if (next[k] === macDinh[k]) q.delete(k);
        else q.set(k, next[k]);
      }
      const s = q.toString();
      window.history.replaceState(
        null,
        "",
        s ? `${window.location.pathname}?${s}` : window.location.pathname,
      );
    },
    [khoas, macDinh],
  );

  const dat_nhieu = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setGiaTri((cu) => {
        const next = { ...cu, ...patch } as Record<K, string>;
        // Ô Select có thể phát lại ĐÚNG giá trị đang có lúc hydrate. Ghi URL trong ca
        // đó vừa thừa vừa từng là một nửa nguyên nhân của lỗi cũ, nên bỏ qua khi không
        // có gì đổi.
        const doi = khoas.some((k) => next[k] !== cu[k]);
        if (!doi) return cu;
        ghiUrl(next);
        return next;
      });
    },
    [ghiUrl, khoas],
  );

  const dat = useCallback(
    (khoa: K, v: string) => dat_nhieu({ [khoa]: v } as Partial<Record<K, string>>),
    [dat_nhieu],
  );

  const xoa_het = useCallback(() => {
    setGiaTri(macDinh);
    ghiUrl(macDinh);
  }, [ghiUrl, macDinh]);

  const dang_loc = khoas.some((k) => giaTri[k] !== macDinh[k]);

  return { gia_tri: giaTri, dat, dat_nhieu, xoa_het, dang_loc };
}
