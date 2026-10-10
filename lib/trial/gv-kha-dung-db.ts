/**
 * lib/trial/gv-kha-dung-db.ts — VỎ DB của bộ lọc "giáo viên nào rảnh cho buổi trải nghiệm".
 *
 * Việc DUY NHẤT của file này: đọc LƯỚI CA của một ngày cho một nhóm người, rồi trả về đúng
 * hình dạng `CaNgay` mà hàm THUẦN `lib/trial/gv-kha-dung.ts` ăn vào. Mọi phép LUẬT — phủ trọn
 * hay không, đỏ hay cam, ai được miễn — nằm ở hàm thuần, KHÔNG nằm ở đây. Tách vậy để phần
 * luật kiểm được bằng vitest mà không cần Postgres (luật 18: mỗi ca phải xanh khi chạy một
 * mình), còn file này chỉ còn một việc dễ soi: lấy dữ liệu ra cho đúng.
 *
 * ── BA CÁI BẪY ĐÃ ĐO ĐƯỢC, ĐỪNG DẪM LẠI ─────────────────────────────────────────────────
 *
 * 1. **`ShiftAssignment` KHÔNG có cột `kind`.** Loại mã ca (`TIMED`/`OFF`/`LEAVE`/…) nằm ở
 *    `ShiftTemplate.kind`, nên PHẢI join `template: { select: { kind: true } }`. Cột thay thế
 *    gần nhất là `isLeave`, và dùng nó là sai: mã `X` (Nghỉ) mang `kind: OFF` nhưng
 *    `isLeave: FALSE` — nó không phải nghỉ PHÉP. Lọc bằng `isLeave` thì `X` lọt qua thành ca
 *    LÀM, và một người đang nghỉ sẽ được đề xuất đi dạy trial. Đó đúng là bug prod 10/09/2026
 *    (xem `lib/cham-cong/nhan-ca.ts`, khối chú thích đầu file).
 *
 * 2. **KHÔNG đưa `centerId` vào `where`.** Cột `ShiftAssignment.centerId` là "cơ sở LÀM /
 *    chịu công HÔM ĐÓ", khác `User.centerId` là bình thường (schema tự chú, dòng 9080).
 *    Một GV thuộc biên chế CS2 được điều sang dạy CS1 hôm nay thì ô ca hôm nay mang
 *    `centerId = CS1` — lọc tay theo cơ sở của buổi trial hay theo cơ sở nhà của người đó đều
 *    làm họ BIẾN MẤT khỏi danh sách. Việc lọc cơ sở làm TƯỜNG MINH ở hàm thuần, vì ở đó mới
 *    phân biệt được "không có ca" với "có ca nhưng ở cơ sở khác" — hai thứ hiện hai nhãn khác
 *    nhau cho người dùng.
 *
 *    ⚠️ `scopedDb` VẪN tự chèn `centerId IN (visibleCenterIds)` — `ShiftAssignment` nằm trong
 *    `SCOPED_MODELS`. Đó là CỔNG CÁCH LY, cố ý giữ, và nó KHÔNG phá ca ở mục trên: nó lọc theo
 *    đúng cột "cơ sở làm hôm đó", nên GV được điều sang CS1 vẫn hiện với người CS1. Cái mất đi
 *    là GV hôm đó làm ở CS2 — người ấy dù sao cũng không dạy được buổi trial ở CS1. Hệ quả cần
 *    nhớ: với actor cấp cơ sở, "có ca ở cơ sở ngoài tầm nhìn" trả về y như "không có ca"
 *    (`null`) ⇒ người đó bị ẨN khỏi danh sách (fail-closed), KHÔNG phải rò rỉ.
 *
 * 3. **`luoiDaSinh` phải là một phép đếm RIÊNG.** Lưới tháng do người vận hành bấm sinh TAY
 *    (`vercel.json` không có cron nào sinh nó), nên tháng sau thường RỖNG. Nếu gộp "chưa sinh
 *    lưới" vào "người này không có ca" thì cả hai cùng ra `null`, trong khi hai tình huống đó
 *    dẫn tới hai hành vi NGƯỢC NHAU ở hàm thuần: chưa có lưới ⇒ `CHUA_CO_LUOI` (không được ẩn
 *    ai, vì hệ thống chưa biết gì); có lưới mà người này trống ⇒ `KHONG_CO_CA` (ẩn, fail-closed).
 *    Gộp là hỏng một trong hai, và hỏng kiểu im lặng.
 *
 * 4. **`coTrongLuoi` là phép đếm THỨ BA, theo THÁNG** (thêm 17/09/2026). Cùng lý do bẫy số 3,
 *    một cấp nữa: "hôm nay người này không có ô" và "người này chưa từng có ô nào" cũng cùng
 *    ra `null` trên đường ngày. Người mới tuyển rơi vào vế sau, và fail-closed trên vế sau là
 *    ẩn họ vĩnh viễn. Đo bằng MỘT `groupBy` gộp cho cả nhóm — n+1 ở đây là 30 truy vấn cho một
 *    lượt gõ phím trong ô giờ.
 */
import "server-only";
import type { Actor } from "@/lib/auth/actor";
import type { PlaceToken, SegmentKind, ShiftSegment } from "@/lib/cham-cong/catalog";
import type { LoaiMaCa } from "@/lib/cham-cong/nhan-ca";
import { scopedDb } from "@/lib/db-scope";
import { khoangThangChua, type CaNgay } from "./gv-kha-dung";

/**
 * Ca của từng người trong MỘT ngày.
 *
 * @param actor người đang xem — cổng cách ly cơ sở đi qua `scopedDb(actor)`, không có đường
 *   vòng và không có tham số "bỏ qua scope" (luật 7: mặc định của SCOPE phải fail-closed).
 * @param userIds danh sách userId cần tra. Rỗng ⇒ `theoNguoi` rỗng, nhưng `luoiDaSinh` VẪN
 *   được đo thật (nó là thuộc tính của NGÀY, không phải của danh sách người).
 * @param workDate 🔴 **NỬA ĐÊM UTC của ngày VN** — đúng quy ước cột `@db.Date`.
 *
 *   Quy đổi: ngày làm việc 19/09/2026 (giờ VN) lưu thành `2026-09-19T00:00:00.000Z`, tức
 *   `new Date(Date.UTC(2026, 8, 19))`, cũng chính là thứ `vnDateOnly(...)` trả về. KHÔNG đổi
 *   múi giờ ở đây: cột không mang giờ, và trừ 7 tiếng là tụt sang ngày hôm trước.
 *
 *   ⚠️ `parseVnYmd("2026-09-19")` KHÔNG hợp lệ cho tham số này — nó trả 00:00 giờ **VN**, tức
 *   `2026-09-18T17:00:00Z`. Bọc thêm `vnDateOnly(...)` hoặc dựng thẳng bằng `Date.UTC(...)`.
 *   Truyền sai thì truy vấn khớp 0 dòng và MỌI giáo viên bị ẩn — một lời nói dối im lặng, nên
 *   hàm này NÉM LỖI thay vì trả danh sách rỗng (xem `kiemNgayLamViec`).
 *
 * @returns `theoNguoi` có ĐỦ khoá cho mọi `userIds` (giá trị `null` = không tìm thấy ca),
 *   nên chỗ gọi không phải phân biệt "thiếu khoá" với "khoá mang null".
 *   `coTrongLuoi` chỉ chứa người CÓ ô — ai vắng mặt trong tập đó là "chưa vào lưới".
 */
export async function layCaCuaNhieuNguoi(
  actor: Actor,
  userIds: string[],
  workDate: Date,
): Promise<{
  theoNguoi: Record<string, CaNgay | null>;
  luoiDaSinh: boolean;
  coTrongLuoi: Set<string>;
}> {
  kiemNgayLamViec(workDate);

  const sdb = scopedDb(actor);
  const ids = [...new Set(userIds)].filter((id) => id.length > 0);
  const thang = khoangThangChua(workDate);

  // Phép đếm "ngày này đã có lưới chưa" KHÔNG lọc `userId` — xem bẫy số 3 ở đầu file. Đi qua
  // `scopedDb` như mọi câu khác: người CS1 hỏi "lưới của tôi đã sinh chưa", và lưới CS2 đã sinh
  // không trả lời được câu đó.
  if (ids.length === 0) {
    const soO = await sdb.shiftAssignment.count({ where: { workDate, status: "ACTIVE" } });
    return { theoNguoi: {}, luoiDaSinh: soO > 0, coTrongLuoi: new Set() };
  }

  const [soO, oLuoi, oThang] = await Promise.all([
    sdb.shiftAssignment.count({ where: { workDate, status: "ACTIVE" } }),
    sdb.shiftAssignment.findMany({
      // `status: "ACTIVE"` là bắt buộc: đổi ca = `CANCELLED` dòng cũ + tạo dòng mới, nên bỏ
      // điều kiện này là đọc cả ca ĐÃ BỊ HUỶ. Unique riêng phần (userId, workDate) WHERE
      // status='ACTIVE' bảo đảm tối đa MỘT dòng sống mỗi người mỗi ngày.
      where: { userId: { in: ids }, workDate, status: "ACTIVE" },
      select: {
        userId: true,
        templateCode: true,
        centerId: true,
        // Bản CHỤP lúc xếp ca (đã resolve nơi làm) — KHÔNG đọc `ShiftTemplate.segments` ở
        // nhánh này: sửa danh mục hôm nay không được đổi giờ của ngày đã xếp.
        segments: true,
        // Join BẮT BUỘC — bẫy số 1. `include` lồng KHÔNG được `scopedDb` tự lọc, và ở đây
        // không được lọc: `ShiftTemplate` dùng chung (`centerId: null`), lọc là mất sạch.
        template: { select: { kind: true } },
      },
    }),
    // "Ai đã CÓ MẶT trong lưới tháng này" — bẫy số 4. MỘT câu `groupBy` cho cả nhóm, không
    // phải một câu mỗi người: hàm này chạy lại mỗi lần người dùng gõ một phím trong ô giờ.
    //
    // `groupBy` ĐƯỢC `scopedDb` chèn scope (`lib/db-scope.ts:516`), y như `findMany`/`count`
    // — kiểm rồi mới dùng, vì một method KHÔNG nằm trong danh sách đó sẽ chạy TRẦN và đây là
    // câu duy nhất trong file đọc rộng ra cả tháng.
    //
    // Hệ quả của scope, cố ý giữ và đã ghi vào nhãn ở hàm thuần: với người dùng cấp cơ sở,
    // giáo viên cả tháng chỉ làm ở cơ sở khác cũng ra "chưa vào lưới" (và vì thế ĐƯỢC HIỆN
    // kèm nhãn). Đó là nới HIỂN THỊ, không nới dữ liệu: tên họ vốn đã nằm trong danh sách
    // `getAssignableTeachers` mà màn này bơm xuống từ đầu.
    sdb.shiftAssignment.groupBy({
      by: ["userId"],
      where: {
        userId: { in: ids },
        status: "ACTIVE",
        workDate: { gte: thang.tu, lt: thang.den },
      },
    }),
  ]);
  const luoiDaSinh = soO > 0;
  const coTrongLuoi = new Set(oThang.map((o) => o.userId));

  const theoNguoi: Record<string, CaNgay | null> = {};
  for (const id of ids) theoNguoi[id] = null;

  for (const o of oLuoi) {
    theoNguoi[o.userId] = {
      ma: o.templateCode,
      kind: o.template.kind,
      centerId: o.centerId,
      segments: epSegments(o.segments),
    };
  }

  // ĐƯỜNG LÙI — chỉ khi ngày đó CHƯA có ô nào trên lưới. `soO === 0` ⇒ `oLuoi` chắc chắn rỗng
  // (nó là tập con), nên hai nhánh loại trừ nhau, không có chuyện khung ca đè lên ô lưới thật.
  if (!luoiDaSinh) {
    for (const [userId, ca] of Object.entries(await layTheoKhungCaTuan(sdb, ids, workDate))) {
      theoNguoi[userId] = ca;
    }
  }

  return { theoNguoi, luoiDaSinh, coTrongLuoi };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ĐƯỜNG LÙI: khung ca cố định hằng tuần
// ─────────────────────────────────────────────────────────────────────────────────────────

/** `scopedDb(actor)` thu hẹp còn ĐÚNG bảng hàm dưới chạm tới — đủ để test thay bằng đồ giả. */
type KhungCaDb = Pick<ReturnType<typeof scopedDb>, "shiftWeeklyPattern">;

/**
 * Suy ca từ `ShiftWeeklyPattern` khi lưới tháng chưa được sinh.
 *
 * Đây là câu trả lời cho "lưới NẾU sinh thì ngày đó ghi gì", nên cửa sổ hiệu lực lấy ĐÚNG như
 * `planMonthFromPatterns` (`lib/cham-cong/generate.ts`): `effectiveFrom <= ngày` và
 * (`effectiveTo` rỗng HOẶC `>= ngày`). Đây là TẬP CHA của điều kiện `effectiveTo: null` — trên
 * dữ liệu thật hai bên trùng nhau (cả ba đường ghi bảng này đều đặt `effectiveFrom` bằng hằng
 * 01/01/2000 và `effectiveTo` rỗng), nhưng bám theo bộ sinh lưới thì hai bên không thể trôi lệch.
 */
async function layTheoKhungCaTuan(
  sdb: KhungCaDb,
  ids: string[],
  workDate: Date,
): Promise<Record<string, CaNgay>> {
  // Thứ trong tuần (0=CN … 6=T7). `workDate` là nửa đêm UTC của ngày VN, nên `getUTCDay()` cho
  // ĐÚNG thứ của ngày VN — cùng phép mà `weekdayOf()` của bộ sinh lưới dùng. Đừng thay bằng
  // `getDay()`: máy chạy UTC và máy dev +07 sẽ cho hai kết quả khác nhau vào cùng một dòng mã.
  const weekday = workDate.getUTCDay();

  const dong = await sdb.shiftWeeklyPattern.findMany({
    where: {
      userId: { in: ids },
      weekday,
      effectiveFrom: { lte: workDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
    },
    select: {
      userId: true,
      templateCode: true,
      centerId: true,
      // Khác nhánh lưới: bảng khung ca KHÔNG có cột `segments`, giờ giấc nằm ở danh mục.
      template: { select: { kind: true, segments: true } },
    },
  });

  const theoNguoi: Record<string, DongKhung[]> = {};
  for (const d of dong) (theoNguoi[d.userId] ??= []).push(d);

  const ra: Record<string, CaNgay> = {};
  for (const [userId, ds] of Object.entries(theoNguoi)) {
    const chon = chonDongKhung(ds);
    if (!chon) continue;
    ra[userId] = {
      ma: chon.templateCode,
      kind: chon.template.kind,
      centerId: chon.centerId,
      segments: epSegments(chon.template.segments),
    };
  }
  return ra;
}

/** Một dòng khung ca tuần đã rút gọn — export để kiểm luật chọn dòng mà không cần DB. */
export type DongKhung = {
  userId: string;
  templateCode: string;
  centerId: string;
  template: { kind: LoaiMaCa; segments: unknown };
};

/**
 * Một người có thể có NHIỀU dòng khung cùng một thứ — khoá là `(userId, centerId, weekday,
 * effectiveFrom)`, và Sheet gốc dựng đúng như vậy (Mr Phúc có một bộ dòng CS1 và một bộ CS2).
 * `CaNgay` chỉ chứa MỘT ca, nên phải chọn, và phải chọn theo luật cố định — để DB tự quyết
 * thứ tự là để danh sách giáo viên đổi giữa hai lần bấm mà không ai biết vì sao.
 *
 * Luật chọn: dòng nào NÓI ĐƯỢC NHIỀU NHẤT thì thắng.
 *   `TIMED` (có giờ thật) → `OFF`/`LEAVE` (khẳng định nghỉ) → `FLEXIBLE` (LD) → `LOCATION_ONLY`.
 *
 * `LOCATION_ONLY` xếp CUỐI vì đó là ô CON TRỎ (`D1`/`D2`): nó chỉ nói "hôm nay làm ở cơ sở kia",
 * còn mã thật nằm ở dòng của khối kia. Xếp cuối nên khi có dòng thật ta lấy dòng thật — cùng kết
 * quả với `mergePointerCells()` của bộ sinh lưới, mà không phải nạp thêm bảng `Center` để đổi
 * `centerId` ↔ mã khối. Chỉ khi TOÀN con trỏ ta mới trả chính nó, và khi đó `segments` rỗng ⇒
 * hàm thuần đọc ra "không giờ", đúng bản chất.
 *
 * Hoà thì so `centerId` rồi `templateCode` — không mang ý nghĩa nghiệp vụ nào, chỉ để kết quả
 * lặp lại được.
 */
export function chonDongKhung(ds: DongKhung[]): DongKhung | null {
  if (ds.length === 0) return null;
  const hang: Record<LoaiMaCa, number> = {
    TIMED: 0,
    LEAVE: 1,
    OFF: 1,
    FLEXIBLE: 2,
    LOCATION_ONLY: 3,
  };
  return [...ds].sort(
    (a, b) =>
      hang[a.template.kind] - hang[b.template.kind] ||
      a.centerId.localeCompare(b.centerId) ||
      a.templateCode.localeCompare(b.templateCode),
  )[0];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Ép kiểu cột Json
// ─────────────────────────────────────────────────────────────────────────────────────────

/** "07:45" / "7:45" — đủ hẹp để loại chuỗi rác, đủ rộng cho cả hai cách ghi giờ. */
const GIO = /^\d{1,2}:\d{2}$/;

/**
 * `segments` là cột `Json` của Prisma ⇒ kiểu tĩnh chỉ nói "có thể là bất cứ gì JSON". Đi vào
 * qua `unknown` rồi KIỂM HÌNH DẠNG từng phần tử — không `as any`, và cũng không `as
 * ShiftSegment[]` trần: một dòng dữ liệu hỏng sẽ lặng lẽ đi thẳng vào phép tính phủ ca.
 *
 * Phần tử không đọc được (thiếu `start`/`end`, giờ sai hình dạng) bị BỎ. Chiều bỏ là chiều
 * fail-closed: ca hẹp lại ⇒ giáo viên bị ẩn, chứ không phải hiện thêm người không có mặt.
 *
 * `kind` chỉ nhận đúng hai giá trị đang có (`WORK`, `PAID_BREAK`); THIẾU thì coi là `WORK` (dòng
 * đời cũ). Cả hai đều **TÍNH LÀ CÓ MẶT** — nghỉ giữa giờ 16:30–17:30 của `CT`/`SCT` là giờ được
 * tính công, nên bỏ nó đi là làm mã `CT` vỡ thành ba mảnh rời và một buổi trial 16:00–18:00 bị
 * kết luận sai là không phủ.
 *
 * `kind` LẠ (một loại đoạn thêm sau, ví dụ một kiểu nghỉ KHÔNG tính công) → BỎ cả đoạn, không
 * đoán là `WORK`. Đoán rộng ở đây là đề xuất một giáo viên đang vắng mặt; hẹp thì cùng lắm là
 * thiếu một người, và người đó vẫn vào được bằng ô miễn trừ.
 *
 * `orgUnitIds` (ảnh chụp nơi làm trên ô lưới) cố ý bị bỏ — `ShiftSegment` không có trường đó và
 * bộ lọc trial không dùng tới.
 */
export function epSegments(raw: unknown): ShiftSegment[] {
  if (!Array.isArray(raw)) return [];
  const ra: ShiftSegment[] = [];
  for (const phanTu of raw) {
    if (typeof phanTu !== "object" || phanTu === null || Array.isArray(phanTu)) continue;
    const o = phanTu as Record<string, unknown>;
    const { start, end } = o;
    if (typeof start !== "string" || typeof end !== "string") continue;
    if (!GIO.test(start) || !GIO.test(end)) continue;
    const kind = epKind(o.kind);
    if (!kind) continue;
    const doan: ShiftSegment = { start, end, kind };
    const place = epPlace(o.place);
    if (place) doan.place = place;
    ra.push(doan);
  }
  return ra;
}

/** Danh sách TRẮNG loại đoạn. Thiếu `kind` = dòng đời cũ ⇒ `WORK`; giá trị lạ ⇒ `null` (bỏ đoạn). */
function epKind(v: unknown): SegmentKind | null {
  if (v == null) return "WORK";
  if (v === "WORK" || v === "PAID_BREAK") return v;
  return null;
}

/** `place` của một đoạn ca — khớp đúng 5 token cố định hoặc tiền tố `CENTER:`. */
function epPlace(v: unknown): PlaceToken | undefined {
  if (typeof v !== "string") return undefined;
  if (
    v === "HOME" ||
    v === "ANY_CENTER" ||
    v === "ASSIGNED" ||
    v === "OFFSITE" ||
    v === "ANYWHERE"
  ) {
    return v;
  }
  // `startsWith` không thu hẹp được `string` về kiểu mẫu chuỗi, nên phải nói ra bằng `as` —
  // sau khi đã kiểm, và chỉ trong đúng một dòng này.
  return v.startsWith("CENTER:") ? (v as `CENTER:${string}`) : undefined;
}

/**
 * Chặn ngay đầu hàm nếu `workDate` không phải nửa đêm UTC.
 *
 * Không có phép quy đổi nào ở đây — chỉ một lời từ chối. Vì sao cần: truyền nhầm (đặc biệt là
 * `parseVnYmd`, trả 17:00Z hôm trước, hoặc `new Date()` trần) thì truy vấn khớp 0 dòng và
 * người dùng thấy một danh sách giáo viên RỖNG mà không lỗi nào nổi lên — màn hình nói một câu
 * SAI thay vì nói "không biết". Ném lỗi biến nó thành thứ vỡ ngay ở lượt chạy đầu tiên.
 *
 * Không thể dội oan người gọi đúng: giá trị đọc từ cột `@db.Date` và giá trị dựng bằng
 * `vnDateOnly()` / `Date.UTC(y, m, d)` đều có phần giờ bằng 0 tuyệt đối.
 */
function kiemNgayLamViec(workDate: Date): void {
  if (Number.isNaN(workDate.getTime())) {
    throw new Error("layCaCuaNhieuNguoi: workDate không phải một ngày hợp lệ.");
  }
  const duGio =
    workDate.getUTCHours() ||
    workDate.getUTCMinutes() ||
    workDate.getUTCSeconds() ||
    workDate.getUTCMilliseconds();
  if (duGio) {
    throw new Error(
      `layCaCuaNhieuNguoi: workDate phải là NỬA ĐÊM UTC của ngày VN (cột @db.Date), nhận được ` +
        `${workDate.toISOString()}. Dùng vnDateOnly(...) hoặc new Date(Date.UTC(y, m, d)); ` +
        `parseVnYmd() KHÔNG hợp lệ ở đây vì nó trả 00:00 giờ VN (= 17:00Z hôm trước).`,
    );
  }
}
