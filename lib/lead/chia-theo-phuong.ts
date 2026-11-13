/**
 * CHIA LEAD THEO PHƯỜNG/XÃ (05/11/2026, chủ dự án): lead chưa có cơ sở được chia về cơ sở GẦN NHÀ KHÁCH hơn, thay vì «cơ sở ít lead mở hơn»
 * (`pickCenterEvenly` — không dùng địa lý; ba lead liên tiếp cùng vào một cơ sở chỉ vì cơ sở kia đang đông hơn, không phải vì gần hơn).
 *
 * VÌ SAO THEO PHƯỜNG/XÃ mà không tính khoảng cách thật:
 *  · phường/xã là thứ khách chọn được CHẮC CHẮN trong danh sách có sẵn (chủ dự án: «số nhà, đường thì không chắc PH nhập rõ», phường thì bắt buộc);
 *  · cơ sở chưa có toạ độ (`Center.latitude/longitude` trống), phường/xã trong gói địa chỉ cũng không có toạ độ;
 *  · không phải gửi địa chỉ nhà của khách ra dịch vụ bản đồ bên ngoài (NĐ 13/2023 — phải cập nhật thông báo xử lý dữ liệu, cần khoá API và chi phí).
 * Quản trị đặt MỘT LẦN «phường này gần cơ sở nào hơn» (màn «Quản lý chia lead» → «Chia theo phường»). Phường chưa đặt / khách không khai ⇒ chia đều như cũ.
 *
 * TẮT MẶC ĐỊNH (`IntegrationConfig.isEnabled = false`): chưa có dòng cấu hình ⇒ hành vi hôm nay giữ nguyên 100%.
 *
 * Phần THUẦN (không DB): chuẩn hoá tên + chọn cơ sở + áp lượt chỉnh. Phần đọc/ghi DB: `chia-theo-phuong-db.ts`.
 */
import { z } from "zod";

/** Khoá dòng `IntegrationConfig` giữ bảng «phường → cơ sở». */
export const PROVIDER_PHUONG_CO_SO = "LEAD_PHUONG_CO_SO";

const TIEN_TO = /^(?:thanh pho|tp|tinh|phuong|xa|thi tran|thi xa|quan|huyen)\s+/;

/**
 * Tên địa danh → khoá so khớp: bỏ dấu, hạ chữ, bỏ dấu câu, bỏ tiền tố hành chính («Phường», «Tp»…).
 * «Phường Hải Châu» ≡ «Hải Châu» ≡ «phuong hai chau»; «Tp Đà Nẵng» ≡ «Thành phố Đà Nẵng» ≡ «Đà Nẵng».
 */
export function khoaDiaDanh(s: string | null | undefined): string {
  const t = (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.replace(TIEN_TO, "").trim();
}

/** Khoá của một cặp (thành phố, phường/xã); `null` nếu thiếu một trong hai (không đoán). */
export function khoaPhuong(thanhPho: string | null | undefined, phuong: string | null | undefined): string | null {
  const c = khoaDiaDanh(thanhPho);
  const w = khoaDiaDanh(phuong);
  return c && w ? `${c}|${w}` : null;
}

const cauHinhSchema = z.object({
  phienBan: z.literal(1),
  /** khoá `khoaPhuong` → `Center.id`. */
  map: z.record(z.string().min(3).max(200), z.string().min(1).max(64)),
});
export type BangPhuongCoSo = z.infer<typeof cauHinhSchema>;
export const BANG_RONG: BangPhuongCoSo = { phienBan: 1, map: {} };

/** Đọc cấu hình đã lưu; hỏng/lạ ⇒ bảng RỖNG (không bao giờ ném — chia lead không được hỏng vì một dòng cấu hình sai). */
export function docBangPhuong(raw: unknown): BangPhuongCoSo {
  const p = cauHinhSchema.safeParse(raw);
  return p.success ? p.data : BANG_RONG;
}

/**
 * Chọn cơ sở cho một lead theo phường/xã. `null` ⇒ không quyết được (cơ sở của phường không còn hợp lệ, phường chưa đặt, thiếu thông tin) —
 * người gọi rơi về chia đều.
 *
 * `hopLe` = các cơ sở ĐƯỢC PHÉP nhận lead mới (đang hoạt động, không phải Hội sở…): một phường đặt cho cơ sở đã đóng cửa không được kéo lead
 * về nơi không có sale.
 */
export function chonCoSoTheoPhuong(
  diaChi: { thanhPho: string | null | undefined; phuong: string | null | undefined },
  bang: BangPhuongCoSo,
  hopLe: ReadonlySet<string>,
): string | null {
  const k = khoaPhuong(diaChi.thanhPho, diaChi.phuong);
  if (!k) return null;
  const id = bang.map[k];
  return id && hopLe.has(id) ? id : null;
}

/** Đặt (hoặc gỡ khi `coSoId = null`) cơ sở của một phường — trả bảng MỚI, không sửa bảng cũ. */
export function datPhuong(bang: BangPhuongCoSo, thanhPho: string, phuong: string, coSoId: string | null): BangPhuongCoSo {
  const k = khoaPhuong(thanhPho, phuong);
  if (!k) return bang;
  const map = { ...bang.map };
  if (coSoId) map[k] = coSoId;
  else delete map[k];
  return { phienBan: 1, map };
}

export type DongPhuong = { readonly phuong: string; readonly coSoId: string | null };

/** Trần số dòng một lần lưu (Đà Nẵng 94 phường/xã; chừa dư cho tỉnh khác). Chặn payload khổng lồ. */
export const TOI_DA_DONG_MOT_LAN = 400;

/**
 * Áp một lượt chỉnh «phường → cơ sở» của MỘT thành phố lên bảng hiện có. THUẦN, và NGUYÊN KHỐI: chỉ cần một dòng sai thì trả lỗi và KHÔNG trả
 * bảng mới (người lưu thấy lỗi, không có chuyện lưu nửa chừng).
 *
 * Sai khi: cơ sở không nằm trong tập HỢP LỆ (đã đóng / không nhận lead / không tồn tại), phường rỗng, hoặc phường trùng nhau trong cùng lượt
 * (hai dòng mâu thuẫn — không đoán dòng nào thắng).
 */
export function apDungCapNhat(
  bang: BangPhuongCoSo,
  thanhPho: string,
  dong: readonly DongPhuong[],
  hopLe: ReadonlySet<string>,
): { ok: true; bang: BangPhuongCoSo } | { ok: false; loi: string[] } {
  if (!khoaDiaDanh(thanhPho)) return { ok: false, loi: ["Thiếu thành phố."] };
  if (dong.length > TOI_DA_DONG_MOT_LAN) return { ok: false, loi: [`Tối đa ${TOI_DA_DONG_MOT_LAN} phường/xã mỗi lần lưu.`] };
  const loi: string[] = [];
  const daThay = new Set<string>();
  let moi = bang;
  for (const d of dong) {
    const k = khoaPhuong(thanhPho, d.phuong);
    if (!k) {
      loi.push("Có dòng thiếu tên phường/xã.");
      continue;
    }
    if (daThay.has(k)) {
      loi.push(`Phường/xã «${d.phuong}» xuất hiện hai lần.`);
      continue;
    }
    daThay.add(k);
    if (d.coSoId !== null && !hopLe.has(d.coSoId)) {
      loi.push(`Cơ sở của «${d.phuong}» không còn nhận lead mới.`);
      continue;
    }
    moi = datPhuong(moi, thanhPho, d.phuong, d.coSoId);
  }
  return loi.length > 0 ? { ok: false, loi } : { ok: true, bang: moi };
}

/** Số phường/xã của MỘT thành phố đã đặt cơ sở trong bảng (để hiện «đã đặt N/94»). */
export function demPhuongDaDat(bang: BangPhuongCoSo, thanhPho: string): number {
  const tien = `${khoaDiaDanh(thanhPho)}|`;
  return Object.keys(bang.map).filter((k) => k.startsWith(tien)).length;
}

/** Cơ sở đã đặt cho từng phường của một thành phố: khoá = tên phường như người dùng thấy, giá trị = Center.id hoặc null. */
export function coSoCuaCacPhuong(bang: BangPhuongCoSo, thanhPho: string, cacPhuong: readonly string[]): Record<string, string | null> {
  const ra: Record<string, string | null> = {};
  for (const p of cacPhuong) {
    const k = khoaPhuong(thanhPho, p);
    ra[p] = k ? (bang.map[k] ?? null) : null;
  }
  return ra;
}

/**
 * Bản dành cho QUẢN LÝ CƠ SỞ (06/11/2026): «QLCS nào thì cấu hình được cho cơ sở đó». THUẦN, NGUYÊN KHỐI như `apDungCapNhat`.
 *
 * Một dòng chỉ được ĐỔI khi cả hai đầu đều là cơ sở của người lưu (hoặc trống):
 *   · phường đang TRỐNG        → đặt cho cơ sở của mình  ✔ (nhận phường chưa ai giữ)
 *   · phường đang của MÌNH     → trả về trống / đổi sang cơ sở khác của mình  ✔
 *   · phường đang của CƠ SỞ KHÁC → ✘ (chỉ Quản trị đổi — không được «giật» phường của cơ sở khác)
 *   · đặt phường cho cơ sở KHÔNG phải của mình → ✘
 * Dòng KHÔNG ĐỔI được bỏ qua, kể cả khi phường đó thuộc cơ sở khác — biểu mẫu luôn gửi lại cả danh sách, và việc gửi lại không phải là sửa.
 * Giá trị «hiện có» đọc từ BẢNG lúc lưu (người gọi đọc dưới khoá), KHÔNG tin ảnh chụp lúc mở màn hình.
 */
export function apDungCapNhatTheoCoSo(
  bang: BangPhuongCoSo,
  thanhPho: string,
  dong: readonly DongPhuong[],
  coSoCuaToi: ReadonlySet<string>,
  hopLe: ReadonlySet<string>,
): { ok: true; bang: BangPhuongCoSo; soDongDoi: number } | { ok: false; loi: string[] } {
  if (!khoaDiaDanh(thanhPho)) return { ok: false, loi: ["Thiếu thành phố."] };
  if (dong.length > TOI_DA_DONG_MOT_LAN) return { ok: false, loi: [`Tối đa ${TOI_DA_DONG_MOT_LAN} phường/xã mỗi lần lưu.`] };
  const loi: string[] = [];
  const thay = new Set<string>();
  const hienCo = coSoCuaCacPhuong(bang, thanhPho, dong.map((d) => d.phuong));
  const doi: DongPhuong[] = [];
  for (const d of dong) {
    const k = khoaPhuong(thanhPho, d.phuong);
    if (!k) {
      loi.push("Có dòng thiếu tên phường/xã.");
      continue;
    }
    if (thay.has(k)) {
      loi.push(`Phường/xã «${d.phuong}» xuất hiện hai lần.`);
      continue;
    }
    thay.add(k);
    const cu = hienCo[d.phuong] ?? null;
    if (cu === d.coSoId) continue; // không đổi
    if (cu !== null && !coSoCuaToi.has(cu)) {
      loi.push(`«${d.phuong}» đang thuộc cơ sở khác — chỉ Quản trị đổi được.`);
      continue;
    }
    if (d.coSoId !== null && !coSoCuaToi.has(d.coSoId)) {
      loi.push(`Bạn chỉ đặt được phường/xã cho cơ sở của mình («${d.phuong}»).`);
      continue;
    }
    doi.push(d);
  }
  if (loi.length > 0) return { ok: false, loi };
  const kq = apDungCapNhat(bang, thanhPho, doi, hopLe);
  return kq.ok ? { ok: true, bang: kq.bang, soDongDoi: doi.length } : kq;
}
