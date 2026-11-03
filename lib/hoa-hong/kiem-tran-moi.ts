/**
 * lib/hoa-hong/kiem-tran-moi.ts — PHÉP KIỂM GIÁ TRỊ MỚI của `crm.commissionMaxTotalRate` so với chính sách ĐANG CHẠY (W2, res1 R1-M4). Gọi ở Server Action lưu cấu hình (`saveGlobalSettingAction`).
 *
 * ── Vì sao KHÔNG ở `lib/settings/kiem-theo-db.ts` (nơi lưu chung) ───────────────────────────────────────────
 * Đã thử: nối tĩnh hay `import()` động từ đó sang tệp này đều là VÒNG (`settings/service → kiem-theo-db → kiem-tran-moi → chinh-sach-service → settings/service`); dependency-cruiser `no-circular` đỏ (đo 10/10/2026,
 * dynamic import cũng bị tính). Tách `dauVaoKichHoat` ra khỏi `chinh-sach-service` để cắt vòng là việc lớn hơn bản vá này. Nên phép kiểm đứng ở TẦNG ACTION — đúng khuôn "phép kiểm cần dữ liệu NGOÀI key đó thì đặt ở tầng
 * action" của `luuChinhSachHoaHongAction` — và lưới `[W2-W4]` (`lib/nguon/cong-ghi-w2-wiring.test.ts`) ghim: `saveGlobalSettingAction` PHẢI gọi hàm này cho khoá trần trước `setGlobalSetting`. Hệ quả phải nói thật: đường lưu khoá này KHÔNG qua
 * `saveGlobalSettingAction` (script, SQL tay) thì không bị kiểm.
 *
 * Schema của ô chỉ chặn sàn 8% (`TRAN_HOA_HONG_TOI_THIEU`) — không biết chính sách nào đang chạy. Hạ trần xuống dưới tổng của một chính sách ACTIVE (vd HV_MOI cộng đủ 9%) thì MỌI khoản NEW của chính sách đó ra
 * `VUOT_TRAN` và không sinh dòng hoa hồng nào; chú thích cũ của registry («chỉ chặn lần lưu cấu hình tỉ lệ tiếp theo») đúng cho engine CŨ, sai cho engine mới. Nên chặn ở nơi lưu, kèm đường lui
 * (`cauHaTranVuot`): tổng lớn nhất hiện hành, chính sách nào, giữ trần tối thiểu bằng tổng đó hoặc hạ tỉ lệ trước. Nâng trần, hoặc đặt bằng giá trị hiện tại, không cần kiểm gì.
 * ⚠️ Giới hạn đã biết: đây là cổng ĐỌC trước phép ghi, không khoá. Chính sách kích hoạt ĐÚNG lúc trần được hạ có thể lọt (hẹp; hậu quả = hold `VUOT_TRAN` ở khoản thu mới, không mất tiền đã ghi) — 08 §14.
 */
import { db } from "@/lib/db";
import { docTranHoaHong, kiemTranMoiVoiChinhSachActive } from "./chinh-sach-service";
import { cauHaTranVuot } from "./huong-xu-ly-tran";

/** Câu lỗi nếu `tranMoi` thấp hơn tổng của chính sách đang chạy; `null` = được lưu. `now` BẮT BUỘC (luật 19). */
export async function loiHaTranVoiChinhSachActive(tranMoi: number, now: Date): Promise<string | null> {
  const hienTai = await docTranHoaHong(); // hàm đọc trần DÙNG CHUNG — không tự gọi getSetting (lưới [NHH-W3]: chỉ chinh-sach-service đọc khoá này)
  if (tranMoi >= hienTai) return null; // nâng hoặc giữ nguyên: không thể làm chính sách nào vượt thêm
  return cauHaTranVuot({ tranMoi, vuot: await kiemTranMoiVoiChinhSachActive(db, { tranMoi, now }) });
}
