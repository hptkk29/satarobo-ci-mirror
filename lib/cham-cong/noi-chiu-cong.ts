/**
 * lib/cham-cong/noi-chiu-cong.ts — NƠI CHỊU CÔNG của một NGÀY, và AI thuộc sổ công của một cơ sở.
 *
 * THUẦN — không `@/lib/db`, không `next/*`. Test được không cần Postgres.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LUẬT (đã chốt, xem `noi-quet.ts`): hai khái niệm, ĐỪNG TRỘN
 *
 *   · **NƠI CHỊU CÔNG** của một NGÀY  → nơi người đó TRỰC THUỘC / được xếp ca.
 *   · **NƠI QUÉT** của một LƯỢT       → chỗ cái QR nằm.
 *
 * Người Hội sở quét QR ở CS1 thì **ngày công vẫn thuộc Hội sở**; chỉ cái LƯỢT mang "CS1".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ FILE NÀY — bug prod 13/09/2026
 *
 * Luật trên đã chốt từ trước, nhưng có HAI chỗ chưa thi hành nó, và cả hai đều kéo NƠI QUÉT
 * vào chỗ đáng ra chỉ NƠI TRỰC THUỘC được đứng:
 *
 * **1. `recompute.ts` — thứ tự ba vế.**
 *
 *     centerId = assignment?.centerId ?? logs[0]?.centerId ?? home.centerId
 *                                        ^^^^^^^^^^^^^^^^^^ NƠI QUÉT chen vào giữa
 *
 * Ngày KHÔNG có ca xếp (cuối tuần, ngày lưới chưa sinh) thì vế giữa thắng ⇒ ngày công của
 * người Hội sở rơi vào cơ sở họ vừa quét. Và vế ấy **không bao giờ cần thiết**:
 * `resolveHomeCenter` luôn trả về một `centerId` (cùng lắm là HO), nên vế ba không bao giờ
 * rỗng. Một vế không bao giờ đúng mà luôn chen trước vế đúng — bỏ hẳn, không phải đổi chỗ.
 *
 * ⚠️ Nó còn kéo theo `orgUnitId` của NƠI QUÉT, và `orgUnitId` là thứ `loadEngineRules` +
 * `getSetting("shift.weeklyOffDays")` đọc ⇒ ngày công của người Hội sở bị tính bằng THAM SỐ
 * VẬN HÀNH của cơ sở họ ghé qua. Đây là nửa im lặng của cùng một bug.
 *
 * **2. Màn Bảng công ngày — danh sách người.**
 *
 * `userIds` gộp BA nguồn, trong đó có `StaffTimeLog where centerId = <cơ sở đang xem>`.
 * Nên ai quét ở CS1 là lọt vào sổ công CS1, dù ngày công của họ thuộc nơi khác.
 *
 * 📌 `StaffAttendanceDay` có `@@unique([userId, workDate])` ⇒ một người một ngày **đúng MỘT
 * dòng**. Triệu chứng "hiện ở cả hai cơ sở lẫn HO" KHÔNG phải nhiều dòng công — mà là MỘT
 * dòng bị nhiều màn cùng liệt kê.
 */

/**
 * NƠI CHỊU CÔNG của một ngày.
 *
 * @param centerIdCaDuocXep `ShiftAssignment.centerId` của ngày đó — `null` khi không có ca.
 *   (Cột này NOT NULL, nên `null` ở đây chỉ có một nghĩa: **không có ca nào**.)
 * @param centerIdNha `resolveHomeCenter().centerId` — luôn có giá trị.
 *
 * ⚠️ Hàm này **cố ý không nhận** nơi quét. Thêm tham số ấy vào là mở lại đúng cái cửa vừa đóng.
 */
export function noiChiuCongCuaNgay(input: {
  centerIdCaDuocXep: string | null;
  centerIdNha: string;
}): string {
  return input.centerIdCaDuocXep ?? input.centerIdNha;
}

/**
 * AI phải hiện trên Bảng công ngày của một cơ sở.
 *
 * Đúng HAI nguồn — ngày công đã tính, và ca đã xếp. Cả hai đều đã lọc theo cơ sở đang xem ở
 * tầng truy vấn, nên ở đây chỉ còn việc gộp và khử trùng.
 *
 * ⚠️ **KHÔNG có nguồn thứ ba từ lượt quét.** Trước 13/09 sổ công gộp thêm
 * `StaffTimeLog where centerId = <cơ sở đang xem>` với lý do "người quét ở đây mà không được
 * xếp ca ở đây vẫn phải hiện" (chốt 07/09). Lý do ấy nay đã có chỗ khác phục vụ **đúng hơn**:
 * D1 (10/09, `noi-quet.ts`) in thẳng " · quét ở CS2" lên dòng của người đó **tại cơ sở chịu
 * công của họ**. Thông tin không mất — nó chuyển sang đúng cái sổ có thẩm quyền về ngày đó.
 *
 * ⚠️ **Cái MẤT, và chỗ nó đi về** — đừng đọc nhầm thành sót: người CS1 quét ở CS2 KHÔNG còn
 * hiện trên sổ công CS2. Nhu cầu *"ai có mặt ở cơ sở tôi hôm nay"* là THẬT, nhưng nó là một
 * CÂU HỎI KHÁC với *"ai ăn công ở đây"*, và chốt 07/09 đã dùng câu hỏi này bù cho câu hỏi kia
 * (luật 5 — tập dựng cho mục đích A đem phục vụ mục đích B). Nó có vé riêng:
 * `docs/cham-cong/VE-AI-CO-MAT-O-CO-SO.md` — một danh sách LƯỢT QUÉT, đọc thẳng
 * `StaffTimeLog`, tách hẳn khỏi sổ công.
 *
 * Giữ thứ tự xuất hiện: ngày công trước, rồi ca xếp. Đảo thứ tự là kể sai câu chuyện của sổ.
 */
export function nguoiThuocSoCong(input: {
  /** userId của các dòng `StaffAttendanceDay` thuộc cơ sở đang xem. */
  coNgayCong: readonly string[];
  /** userId của các dòng `ShiftAssignment` ACTIVE thuộc cơ sở đang xem. */
  coCaXep: readonly string[];
}): string[] {
  return [...new Set([...input.coNgayCong, ...input.coCaXep])];
}
