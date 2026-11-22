// lib/orders/loc-pham-vi.ts — Ô LỌC PHẠM VI NÀO ĐƯỢC BÀY, VÀ LỌC RA ĐƯỢC GÌ. THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI [25/09/2026]
//
// Chủ dự án: *"thiết kế để quản lý cho nhiều cơ sở, nhiều role khác nhau, ví dụ sale thì
// không có phần lọc cơ sở, qlcs thì không có phần lọc của khu vực"*.
//
// ⚠️ **KHÔNG hiện thực bằng một danh sách vai.** Hai lý do, cả hai đều đã trả giá trong
// repo này:
//   · CLAUDE.md cấm thẳng: *"KHÔNG hardcode danh sách center / 'HO + CS2' — đi qua OrgUnit
//     tree (CS3/CS4… thêm không sửa code)"*. Một bảng `vai → ô lọc` là đúng thứ đó, chỉ
//     đội lốt khác.
//   · Vai không quyết định tầm nhìn — **nơi NEO VAI** mới quyết định. Một Quản lý cơ sở
//     kiêm hai cơ sở thì ô "Cơ sở" là thứ họ cần nhất; cùng vai ấy ở một cơ sở thì ô đó
//     là một lời hứa suông.
//
// Luật thật sự, một câu, suy từ DỮ LIỆU:
//
//     MỘT Ô LỌC PHẠM VI CHỈ ĐƯỢC BÀY KHI NÓ CHO ÍT NHẤT **HAI** LỰA CHỌN.
//
// Nó cho ra đúng hành vi chủ dự án mô tả, mà không cần biết ai là sale:
//   · Sale / QLCS một cơ sở → `coSo.length === 1` ⇒ **không** ô "Cơ sở";
//   · QLCS kiêm hai cơ sở   → có ô "Cơ sở", **không** ô "Khu vực";
//   · Hội sở                → có cả hai — **khi nào tổ chức có ≥2 khu vực**.
//
// ⚠️ ĐO ĐƯỢC HÔM NAY (`satarobo_local`, 25/09/2026): cây tổ chức có **HO ×1 · REGION ×1
// (`Khối Đà Nẵng`) · CENTER ×2**. Tức ô "Khu vực" **chưa hiện với bất kỳ ai**, kể cả Hội
// sở — và đó là ĐÚNG, không phải thiếu tính năng: lọc theo khối duy nhất thì bằng không
// lọc. Ngày mở khối thứ hai (Khối Hà Nội…) ô ấy tự bật, không ai phải sửa dòng nào.
//
// ⚠️ Cùng luật với `components/admin/scope-filter-bar.tsx` (`multiCenter =
// visibleCenters.length > 1`) — đây là bản thứ hai của MỘT luật đã chạy, cố ý viết lại
// thành hàm có test thay vì chép biểu thức.

export type TuyChonPhamVi = {
  id: string;
  ten: string;
};

/** Một cơ sở kèm khu vực cha — `khuVucId` `null` khi cơ sở chưa gắn vào cây. */
export type CoSoCoKhuVuc = TuyChonPhamVi & { khuVucId: string | null };

export type OLocPhamVi = {
  /** Có bày ô chọn KHU VỰC không. */
  hienKhuVuc: boolean;
  /** Có bày ô chọn CƠ SỞ không. */
  hienCoSo: boolean;
};

/**
 * Ô nào được bày. Xem luật ở đầu tệp — một câu, không có ngoại lệ theo vai.
 *
 * ⚠️ Hai tham số BẮT BUỘC (luật 7). Mặc định ở đây nguy hiểm theo chiều BÀY THỪA: chỗ gọi
 * quên truyền danh sách khu vực thì `[]`, `hienKhuVuc` thành `false`, và một Hội sở nhiều
 * khối mất ô lọc mà không lỗi nào báo — đúng lớp lỗi câm đã ghi ở CLAUDE.md luật 11.
 */
export function oLocPhamVi(q: {
  khuVuc: readonly TuyChonPhamVi[];
  coSo: readonly TuyChonPhamVi[];
}): OLocPhamVi {
  return {
    hienKhuVuc: q.khuVuc.length > 1,
    hienCoSo: q.coSo.length > 1,
  };
}

/**
 * KẸP lựa chọn của client về đúng tầm nhìn.
 *
 * ⚠️ ĐÂY LÀ CỔNG BẢO MẬT, không phải phép dọn dẹp. `centerIds` tới từ URL/payload, tức
 * người dùng gõ được. Không kẹp thì một sale gửi `coSo=<id cơ sở khác>` và câu tra mang
 * điều kiện ấy đi.
 *
 * `scopedDb` đứng sau vẫn chặn (Order ∈ `SCOPED_MODELS`), nhưng dựa vào MỘT lớp cho một
 * cổng đọc là thói quen sai: ngày nào đó câu tra này đi đường khác — `count`, export,
 * một báo cáo — và lớp kia không còn ở đó. Hai lớp, mỗi lớp tự đủ.
 *
 * Trả `[]` nghĩa là "không lọc theo cơ sở" (xem hết tầm nhìn), KHÔNG phải "không thấy gì".
 * Phân biệt ấy quan trọng: trả `[]` cho câu `where` nghĩa là bỏ điều kiện, còn muốn chặn
 * sạch thì phải là một danh sách rỗng CÓ CHỦ ĐÍCH — nên hàm này không bao giờ dùng để
 * chặn, chỉ để thu hẹp.
 */
export function kepCoSoTheoTamNhin(
  xin: readonly string[] | undefined,
  choPhep: readonly string[],
): string[] {
  if (!xin || xin.length === 0) return [];
  const duoc = new Set(choPhep);
  return [...new Set(xin.filter((id) => duoc.has(id)))];
}

/**
 * Các cơ sở thuộc một khu vực — dùng để dịch "lọc theo khu vực" thành điều kiện `centerId`.
 *
 * Vì sao dịch chứ không lọc thẳng theo `orgUnitId`: cơ chế cách ly của repo **vẫn đo bằng
 * `centerId`** cho tới P4 (CLAUDE.md, luật cứng #3 bản đính chính 27/08). Lọc theo
 * `orgUnitId` ở đây là dựng một trục thứ hai cho cùng một câu hỏi, và hai trục thì có
 * ngày lệch.
 *
 * ⚠️ Khu vực không có cơ sở nào trong tầm nhìn ⇒ trả `[]`. Chỗ gọi phải hiểu `[]` ở đây
 * là "không cơ sở nào khớp" — KHÁC nghĩa `[]` của `kepCoSoTheoTamNhin`. Đó là lý do hai
 * hàm không gộp làm một.
 */
export function coSoTrongKhuVuc(
  khuVucId: string,
  coSo: readonly CoSoCoKhuVuc[],
): string[] {
  return coSo.filter((c) => c.khuVucId === khuVucId).map((c) => c.id);
}

/** Một bộ lọc đang bật, để vẽ thành chip gỡ-được-từng-cái trên thanh công cụ. */
export type ChipLoc = {
  /** Khoá của bộ lọc — bấm × là xoá đúng khoá này. */
  khoa: string;
  nhan: string;
};
