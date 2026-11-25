// lib/cham-cong/xin-vi-tri.ts — XIN TOẠ ĐỘ, và khi hỏng thì NÓI ĐÚNG VÌ SAO.
//
// ── Sự cố 16/09/2026 ───────────────────────────────────────────────────────────────────
//
// Chủ dự án báo: trên máy Android, chấm công báo *"không lấy được vị trí"* dù đã bật định
// vị và đã cho Chrome quyền "chỉ khi dùng ứng dụng" — **và không có hộp thoại nào hỏi**.
//
// Nguyên do đọc được trong mã, không phải đoán: CẢ HAI chỗ gọi định vị đều viết callback lỗi
// là `() => resolve(null)`, tức **vứt sạch `GeolocationPositionError`**. Ba nguyên nhân khác
// hẳn nhau — trang không chạy HTTPS · trình duyệt đã chặn quyền cho trang này · máy không
// bắt được tín hiệu — đều rơi về đúng một câu "không lấy được vị trí". Người dùng không có
// cách nào biết phải làm gì, và cả ba cách sửa đều khác nhau.
//
// Đây đúng luật 12: một câu thông báo là LỜI HỨA. "Không lấy được vị trí" nghe như lỗi sóng,
// nên người ta đi ra chỗ thoáng — trong khi thứ cần làm là bấm ổ khoá cạnh thanh địa chỉ.
//
// ── Hai thứ làm "không hiện hộp thoại nào" ─────────────────────────────────────────────
//
// 1. **Không phải secure context.** Mở trang qua `http://192.168.x.x:3000` (máy khác trong
//    mạng LAN trỏ vào máy dev) thì Chrome CHẶN geolocation và **không hỏi gì cả**. Đây là
//    ca rất dễ dính khi thử trên điện thoại, vì `next dev` in sẵn dòng "Network:
//    http://192.168.…" mời người ta mở. `localhost` thì vẫn được coi là an toàn.
// 2. **Quyền của TRANG đã bị từ chối trong Chrome.** Quyền định vị có HAI TẦNG: tầng hệ điều
//    hành (Android cho Chrome) và tầng TRANG (Chrome cho satarobo.vn). Bật tầng một không
//    mở tầng hai. Mà một khi tầng hai đã "chặn", Chrome **không bao giờ hỏi lại** — gọi
//    `getCurrentPosition` là rơi thẳng vào callback lỗi với mã 1.
//
// Hàm này hỏi `navigator.permissions` TRƯỚC để biết mình đang ở ca nào, nên phân biệt được
// "bạn vừa bấm Từ chối" với "trang đã bị chặn từ trước nên không có gì để bấm".
//
// ── Vì sao có hai lượt gọi ────────────────────────────────────────────────────────────
//
// Lượt 1 `enableHighAccuracy: true` — GPS thật, chính xác vài mét, nhưng TRONG NHÀ có thể
// mất 20–30 giây hoặc không bao giờ xong. Lượt 2 hạ xuống định vị theo wifi/sóng: kém chính
// xác hơn nhiều nhưng gần như tức thì. Chấm công cần biết "có ở cơ sở không", sai số 50m vẫn
// trả lời được câu đó — còn không có toạ độ nào thì không trả lời được gì.
//
// ⚠️ KHÔNG BAO GIỜ CHẶN việc chấm công. Chốt của chủ dự án: *"Người ở chỗ sóng kém mà không
// chấm được là hỏng đúng mục đích."* Hàm này chỉ trả về lý do; nơi gọi vẫn gửi lượt quét với
// toạ độ `null` và để máy chủ gắn cờ `THIEU_GPS`.

/** Vì sao không lấy được toạ độ. Mỗi lý do một CÁCH SỬA khác nhau — đó là lý do phải tách. */
export type LyDoKhongCoViTri =
  | "KHONG_HTTPS"
  | "TRINH_DUYET_KHONG_HO_TRO"
  | "TRANG_BI_CHAN"
  | "VUA_TU_CHOI"
  | "KHONG_CO_TIN_HIEU"
  | "QUA_HAN";

export type KetQuaViTri =
  | { ok: true; latitude: number; longitude: number; accuracyMeters: number | null }
  | { ok: false; lyDo: LyDoKhongCoViTri; loi: string; cachSua: string | null };

/**
 * Câu chữ cho người đi làm đọc, không phải cho lập trình viên.
 *
 * `cachSua` tách khỏi `loi` vì hai vế trả lời hai câu: "chuyện gì vừa xảy ra" và "giờ tôi
 * phải làm gì". Nhét chung một dòng thì phần hành động chìm mất.
 */
export function moTaLyDo(lyDo: LyDoKhongCoViTri): { loi: string; cachSua: string | null } {
  switch (lyDo) {
    case "KHONG_HTTPS":
      return {
        loi: "Trang đang mở qua kết nối KHÔNG bảo mật (http) nên trình duyệt chặn định vị.",
        cachSua:
          "Mở lại trang bằng địa chỉ https:// chính thức. Nếu đang thử bằng địa chỉ dạng http://192.168.x.x thì trình duyệt sẽ luôn chặn, không hỏi gì cả.",
      };
    case "TRINH_DUYET_KHONG_HO_TRO":
      return { loi: "Trình duyệt này không hỗ trợ định vị.", cachSua: "Thử mở bằng Chrome hoặc Safari bản mới." };
    case "TRANG_BI_CHAN":
      return {
        loi: "Trình duyệt đã CHẶN vị trí cho trang này từ trước, nên nó không hiện hộp thoại hỏi nữa.",
        cachSua:
          "Bấm hình ổ khoá cạnh thanh địa chỉ → Quyền (Permissions) → Vị trí → chọn Cho phép, rồi tải lại trang. Bật định vị trong Cài đặt máy KHÔNG mở được quyền này — đây là quyền riêng của trang.",
      };
    case "VUA_TU_CHOI":
      return {
        loi: "Bạn vừa chọn Không cho phép ở hộp thoại xin vị trí.",
        cachSua: "Bấm lại và chọn Cho phép. Nếu không thấy hộp thoại nữa thì mở ổ khoá cạnh thanh địa chỉ → Quyền → Vị trí.",
      };
    case "KHONG_CO_TIN_HIEU":
      return {
        loi: "Máy không bắt được tín hiệu vị trí.",
        cachSua: "Kiểm tra đã bật Vị trí (GPS) trong Cài đặt máy chưa, rồi thử ra chỗ thoáng hơn.",
      };
    case "QUA_HAN":
      return { loi: "Chờ quá lâu mà vẫn chưa lấy được vị trí.", cachSua: "Thử lại một lần nữa, hoặc ra chỗ thoáng hơn." };
  }
}

/** Mã lỗi chuẩn của `GeolocationPositionError`. Đặt tên thay vì rải số 1/2/3 khắp nơi. */
const TU_CHOI = 1;
const KHONG_CO_VI_TRI = 2;

/**
 * Giới hạn thời gian cho MỘT lượt gọi, tính từ lúc trình duyệt bắt đầu dò — theo chuẩn,
 * `timeout` KHÔNG tính thời gian người dùng đọc hộp thoại xin quyền.
 */
const HAN_GPS_MS = 15_000;
const HAN_MANG_MS = 8_000;

/**
 * Lưới an toàn BAO TRÙM cả thời gian người dùng đọc hộp thoại.
 *
 * ⚠️ Bản 15/09 đặt mốc này 8 giây và đó là một lỗi tôi tự gây ra: trên Android, hộp thoại
 * xin quyền hiện lên rồi người ta còn đọc — 8 giây là bấm xong đã quá hạn, và màn báo "không
 * lấy được vị trí" trong khi hộp thoại vẫn đang mở. Nay để rộng, vì nó chỉ còn là lưới chống
 * treo cho vài trình duyệt không gọi callback khi hộp thoại bị bỏ lửng.
 */
const LUOI_AN_TOAN_MS = 75_000;

function goiMotLuot(opts: PositionOptions): Promise<GeolocationPosition | GeolocationPositionError> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      // GIỮ NGUYÊN lỗi, không nuốt. Đây chính là dòng mà cả hai bản cũ viết thành
      // `() => resolve(null)` và làm mất sạch nguyên nhân.
      (e) => resolve(e),
      opts,
    );
  });
}

const laLoi = (x: GeolocationPosition | GeolocationPositionError): x is GeolocationPositionError =>
  typeof (x as GeolocationPositionError).code === "number";

export async function xinViTri(): Promise<KetQuaViTri> {
  const hong = (lyDo: LyDoKhongCoViTri): KetQuaViTri => ({ ok: false, lyDo, ...moTaLyDo(lyDo) });

  if (typeof window === "undefined") return hong("TRINH_DUYET_KHONG_HO_TRO");
  // Kiểm HTTPS TRƯỚC: ở ca này `navigator.geolocation` vẫn tồn tại nhưng gọi vào là im lặng
  // hỏng, không hộp thoại nào. Kiểm trước thì nói được ngay thay vì chờ hết giờ.
  if (!window.isSecureContext) return hong("KHONG_HTTPS");
  if (!navigator.geolocation) return hong("TRINH_DUYET_KHONG_HO_TRO");

  // Hỏi trạng thái quyền TRƯỚC KHI gọi, để phân biệt "đã bị chặn từ trước" (không bao giờ có
  // hộp thoại) với "vừa bấm từ chối". `permissions` không có ở mọi trình duyệt nên bọc
  // try/catch và coi như không biết — không biết thì cứ gọi, đừng chặn.
  try {
    const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (st?.state === "denied") return hong("TRANG_BI_CHAN");
  } catch {
    /* không đọc được trạng thái — bỏ qua, cứ gọi như thường */
  }

  const chay = async (): Promise<KetQuaViTri> => {
    // Lượt 1 — GPS thật.
    const l1 = await goiMotLuot({ enableHighAccuracy: true, timeout: HAN_GPS_MS, maximumAge: 0 });
    if (!laLoi(l1)) {
      return {
        ok: true,
        latitude: l1.coords.latitude,
        longitude: l1.coords.longitude,
        accuracyMeters: Number.isFinite(l1.coords.accuracy) ? l1.coords.accuracy : null,
      };
    }
    // Bị từ chối thì lượt 2 cũng vô ích — và hỏi lại là làm phiền.
    if (l1.code === TU_CHOI) return hong("VUA_TU_CHOI");

    // Lượt 2 — hạ độ chính xác, đổi lấy tốc độ. Trong nhà, đây là lượt cứu được phần lớn ca.
    const l2 = await goiMotLuot({ enableHighAccuracy: false, timeout: HAN_MANG_MS, maximumAge: 60_000 });
    if (!laLoi(l2)) {
      return {
        ok: true,
        latitude: l2.coords.latitude,
        longitude: l2.coords.longitude,
        accuracyMeters: Number.isFinite(l2.coords.accuracy) ? l2.coords.accuracy : null,
      };
    }
    if (l2.code === TU_CHOI) return hong("VUA_TU_CHOI");
    return hong(l2.code === KHONG_CO_VI_TRI ? "KHONG_CO_TIN_HIEU" : "QUA_HAN");
  };

  // Lưới chống treo — xem chú thích ở `LUOI_AN_TOAN_MS`.
  return await Promise.race([
    chay(),
    new Promise<KetQuaViTri>((resolve) => setTimeout(() => resolve(hong("QUA_HAN")), LUOI_AN_TOAN_MS)),
  ]);
}
