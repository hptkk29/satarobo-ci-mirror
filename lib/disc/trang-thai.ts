/**
 * Động cơ DISC (bộ câu hỏi + chấm điểm) ĐÃ được tích hợp vào repo: `lib/disc/engine-goc/**` (mã vendoring từ repo
 * `hodacphuchtc/DISC`, commit 5630a1c5) + adapter `lib/disc/engine-that.ts`, có test hồi quy chấm điểm so với golden
 * vectors sinh từ chính engine gốc (`tests/disc-engine/**`).
 *
 * Hằng này là CÔNG TẮC TRUNG THỰC của giao diện: true ⇒ nút "Bắt đầu khám phá" trên /disc dẫn tới /disc/bat-dau
 * (trang đó vẫn tự kiểm `layEngine()`: chưa `ensureDiscEngine()` thì hiện "đang hoàn thiện", không bao giờ dẫn tới trang chết).
 *
 * ⚠️ `true` KHÔNG có nghĩa "được phép phục vụ khách thật". Phần còn thiếu, ghi thẳng để không ai đọc nhầm:
 *  - Quyền dùng mã DISC dựa trên CHỈ ĐẠO CỦA BGĐ + tài liệu bàn giao của chủ repo (HUONG-DAN-CAM-VAO-APP.md);
 *    CHƯA có văn bản/chữ ký của chủ repo — xem `docs/disc-tich-hop/12-engine-tich-hop.md` mục "XÁC NHẬN QUYỀN DÙNG".
 *  - Nội dung chuyên môn (Gói A/B: diễn giải, lời khuyên) CHƯA được người có thẩm quyền ký.
 *  ⇒ cờ `DISC_ENABLED` vẫn TẮT với khách thật cho tới khi hai điều trên xong. Hằng này chỉ nói "mã chấm đã có và đã được kiểm".
 */
export const DISC_ENGINE_READY = true as boolean;
