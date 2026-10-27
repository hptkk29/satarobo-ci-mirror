/**
 * EL-13 — BỘ LUẬT GẮN CỜ NGHI NGỜ HỌC ĐỐI PHÓ.
 *
 * Tệp thuần: không DB, không giờ hệ thống. Mọi mốc thời gian truyền vào.
 *
 * ⚠️ NGUYÊN TẮC BAO TRÙM — Ở ĐÂY NGHIÊNG VỀ PHÍA **KHÔNG GẮN CỜ**, ngược hẳn với
 * bộ lọc giao bài (EL-05) vốn nghiêng về phía chặt.
 *
 * Lý do là hậu quả bất đối xứng: bỏ sót một người đối phó thì mất một lượt học
 * hình thức. Gắn cờ nhầm một người học thật thì đó là một cáo buộc về hành vi
 * của người lao động, có tên người xử, có hồ sơ, và người bị gắn phải đi khiếu
 * nại để gỡ. Một bên là lãng phí; bên kia là tổn hại.
 *
 * Vì thế mọi ngưỡng ở đây đều để RỘNG, và mỗi luật chỉ bắt những gì **gần như
 * không thể xảy ra khi xem thật** — chủ yếu là các bất khả thi vật lý (khai đã
 * xem nhiều nội dung hơn số giây đồng hồ đã trôi).
 */
import { congNgayLamViec } from "@/lib/elearning/ngay-lam-viec";

/** Mã luật — KHÔNG phải câu văn. Câu tiếng Việt nằm ở tầng hiển thị. */
export type MaLuatCo =
  | "WATCH_TIME_TOO_LOW"
  | "SEEK_ABUSE"
  | "TOO_FAST"
  | "HEARTBEAT_FLOOD";

export const CAU_LUAT: Record<MaLuatCo, string> = {
  WATCH_TIME_TOO_LOW:
    "Số nội dung ghi nhận đã xem nhiều hơn thời gian thực tế cho phép",
  SEEK_ABUSE: "Nhiều lần tua tới phần chưa xem",
  TOO_FAST: "Tốc độ ghi nhận vượt trần tốc độ phát",
  HEARTBEAT_FLOOD: "Nhịp gửi lên dày bất thường so với chu kỳ chuẩn",
};

/** Cửa sổ khiếu nại, tính từ lúc mở cờ. */
export const CUA_SO_KHIEU_NAI_NGAY = 14;
/** Thời hạn trả lời khiếu nại, tính bằng NGÀY LÀM VIỆC. */
export const HAN_TRA_LOI_NGAY_LAM = 5;

/**
 * Số liệu đầu vào của một lần xét.
 *
 * ⚠️ Toàn bộ là SỐ ĐẾM và MỐC THỜI GIAN. Cố ý không nhận bitmap, không nhận nhật
 * ký nhịp: thứ gì lọt vào đây là thứ sẽ nằm trong `evidenceJson`, mà bằng chứng
 * thì KHÔNG bị dọn sau 90 ngày. Nhận dữ liệu thô ở đây là vô hiệu hoá chính hạn
 * dọn đó — bằng cách chép dữ liệu thô sang một bảng không ai dọn.
 */
export type SoLieuXet = {
  coveredSec: number;
  contentSec: number;
  /** Tổng giây nội dung đã ghi nhận trong phiên. */
  totalWatchSec: number;
  /** Số giây ĐỒNG HỒ đã trôi giữa nhịp đầu và nhịp cuối của phiên. */
  wallSec: number;
  blockedSeekCount: number;
  seekCount: number;
  /** Số nhịp đã nhận (chính là `seq` mới nhất). */
  soNhip: number;
  /** Trần tốc độ phát của lượt giao. */
  tranTocDo: number;
};

export type ChungCu = {
  ruleCode: MaLuatCo;
  /** CHỈ số liệu tổng hợp — xem chú thích của `SoLieuXet`. */
  evidenceJson: Record<string, number>;
};

/** Chu kỳ nhịp chuẩn của trình phát (giây). */
const CHU_KY_NHIP_GIAY = 15;
/**
 * Hệ số nới cho mọi so sánh với thời gian đồng hồ.
 *
 * 1.35 nghĩa là: phải khai nhanh hơn mức vật lý cho phép tới 35% mới bị cờ. Nới
 * rộng vì `wallSec` đo từ nhịp đầu tới nhịp cuối, mà nhịp cuối lúc rời trang đi
 * bằng `sendBeacon` và có thể tới muộn; đo chặt là gắn cờ người có mạng chậm.
 */
const NOI = 1.35;
/** Dưới ngần này giây đồng hồ thì KHÔNG xét — mẫu số quá nhỏ, tỉ lệ nào cũng loạn. */
const SAN_WALL_SEC = 60;
/** Số lượt tua bị chặn trong MỘT phiên, vượt thì mới coi là bất thường. */
const NGUONG_TUA_CHAN = 12;

/**
 * Xét một phiên xem, trả về các cờ NÊN mở.
 *
 * Trả mảng rỗng là kết quả BÌNH THƯỜNG và mong đợi. Hàm này không ném, không
 * quyết định gì về người — nó chỉ nói "số liệu này bất thường ở chỗ nào".
 */
export function xetCo(s: SoLieuXet): ChungCu[] {
  const ra: ChungCu[] = [];

  // Mẫu số quá nhỏ thì mọi tỉ lệ đều vô nghĩa. Không xét, và cũng KHÔNG coi đó là
  // dấu hiệu đáng ngờ — người mở bài rồi đóng ngay là chuyện thường ngày.
  if (s.wallSec < SAN_WALL_SEC) return ra;

  // ── 1. Khai đã xem nhiều nội dung hơn thời gian vật lý cho phép ───────────
  // Đây là bất khả thi, không phải "đáng ngờ": kể cả phát ở trần tốc độ suốt
  // phiên thì số nội dung đi qua cũng không vượt được `wallSec × tranTocDo`.
  const tranNoiDung = s.wallSec * s.tranTocDo * NOI;
  if (s.totalWatchSec > tranNoiDung) {
    ra.push({
      ruleCode: "WATCH_TIME_TOO_LOW",
      evidenceJson: {
        totalWatchSec: Math.round(s.totalWatchSec),
        wallSec: Math.round(s.wallSec),
        tranTocDo: s.tranTocDo,
        tranNoiDungSec: Math.round(tranNoiDung),
      },
    });
  }

  // ── 2. Tỉ lệ phủ tăng nhanh hơn trần tốc độ ───────────────────────────────
  // Khác luật 1 ở chỗ nó soi PHẦN NỘI DUNG MỚI (bitmap), không soi tổng giờ. Một
  // người tua qua tua lại có thể có `totalWatchSec` bình thường mà phần phủ mới
  // vẫn tăng vọt.
  const tocDoPhu = s.coveredSec / s.wallSec;
  if (s.coveredSec > 0 && tocDoPhu > s.tranTocDo * NOI) {
    ra.push({
      ruleCode: "TOO_FAST",
      evidenceJson: {
        coveredSec: Math.round(s.coveredSec),
        wallSec: Math.round(s.wallSec),
        tocDoPhu: Math.round(tocDoPhu * 100) / 100,
        tranTocDo: s.tranTocDo,
      },
    });
  }

  // ── 3. Tua tới bị chặn quá nhiều lần ──────────────────────────────────────
  // ⚠️ Đếm lượt BỊ CHẶN, không đếm lượt tua. Tua lùi để xem lại là hành vi học
  // tốt; gắn cờ nó là phạt đúng người chịu khó nhất.
  if (s.blockedSeekCount > NGUONG_TUA_CHAN) {
    ra.push({
      ruleCode: "SEEK_ABUSE",
      evidenceJson: {
        blockedSeekCount: s.blockedSeekCount,
        seekCount: s.seekCount,
        nguong: NGUONG_TUA_CHAN,
      },
    });
  }

  // ── 4. Nhịp dày bất thường ────────────────────────────────────────────────
  // Trình phát gửi mỗi 15 giây. Gấp ba mức đó nghĩa là nhịp không đến từ trình
  // phát này — hoặc ai đó đang gọi thẳng API.
  const nhipToiDa = (s.wallSec / CHU_KY_NHIP_GIAY) * 3;
  if (s.soNhip > nhipToiDa) {
    ra.push({
      ruleCode: "HEARTBEAT_FLOOD",
      evidenceJson: {
        soNhip: s.soNhip,
        wallSec: Math.round(s.wallSec),
        nhipToiDa: Math.round(nhipToiDa),
      },
    });
  }

  return ra;
}

// ── Vòng đời cờ ────────────────────────────────────────────────────────────

export function hanKhieuNai(openedAt: Date, ngay = CUA_SO_KHIEU_NAI_NGAY): Date {
  return new Date(openedAt.getTime() + ngay * 24 * 60 * 60 * 1000);
}

/**
 * Thời hạn trả lời khiếu nại = `appealedAt` + 5 NGÀY LÀM VIỆC.
 *
 * ⚠️ Phép cộng ngày làm việc nay nằm ở `lib/elearning/ngay-lam-viec.ts`, vì EL-15
 * cần đúng phép đó cho hạn chấm bài tập. Chép sang là dựng nguồn sự thật thứ hai,
 * và hai bản chép sẽ trôi khỏi nhau — đúng cách trần độ dài câu hỏi đã trôi ở
 * EL-14e. Lý do PHẢI đếm bằng ngày làm việc thì ghi ở tệp đó.
 */
export function hanTraLoi(appealedAt: Date, soNgayLam = HAN_TRA_LOI_NGAY_LAM): Date {
  return congNgayLamViec(appealedAt, soNgayLam);
}

export type TrangThaiCo = "OPEN" | "APPEALED" | "UPHELD" | "REVOKED";

export type KetQuaChuyen =
  | { ok: true; status: TrangThaiCo }
  | { ok: false; code: string; message: string };

/**
 * Chuyển trạng thái cờ.
 *
 * Máy trạng thái viết tường minh thay vì `if` rải rác ở các action: cờ này là hồ
 * sơ quan hệ lao động, và một đường chuyển sai (vd gỡ cờ đã UPHELD mà không để
 * lại dấu) là thứ chỉ lộ ra khi có tranh chấp — đúng lúc không sửa được nữa.
 */
export function chuyenTrangThaiCo(input: {
  hienTai: TrangThaiCo;
  hanhDong: "KHIEU_NAI" | "GIU_CO" | "GO_CO" | "CHOT_HET_HAN";
  lyDo?: string | null;
}): KetQuaChuyen {
  const { hienTai, hanhDong } = input;

  if (hienTai === "UPHELD" || hienTai === "REVOKED") {
    return {
      ok: false,
      code: "FLAG_CLOSED",
      message: "Cờ này đã có quyết định — mở lại phải tạo hồ sơ mới",
    };
  }

  switch (hanhDong) {
    case "KHIEU_NAI":
      if (hienTai !== "OPEN") {
        return { ok: false, code: "ALREADY_APPEALED", message: "Đã khiếu nại rồi" };
      }
      return { ok: true, status: "APPEALED" };

    case "GO_CO":
      // Bắt buộc lý do: gỡ mà không nói vì sao thì lần sau không ai biết luật đã
      // sai ở đâu, và cùng con số đó sẽ lại sinh ra cùng cái cờ đó.
      if (!input.lyDo || !input.lyDo.trim()) {
        return {
          ok: false,
          code: "REASON_REQUIRED",
          message: "Gỡ cờ bắt buộc phải ghi lý do",
        };
      }
      return { ok: true, status: "REVOKED" };

    case "GIU_CO":
      return { ok: true, status: "UPHELD" };

    case "CHOT_HET_HAN":
      // Hết cửa sổ khiếu nại mà vẫn OPEN ⇒ chốt UPHELD. Chỉ áp cho cờ CHƯA khiếu
      // nại: người đã khiếu nại thì đang chờ NGƯỜI XỬ, và chốt tự động ở đó là
      // phạt họ vì sự chậm trễ của phía kia.
      if (hienTai !== "OPEN") {
        return {
          ok: false,
          code: "NOT_AUTO_CLOSABLE",
          message: "Cờ đang chờ người xử trả lời khiếu nại",
        };
      }
      return { ok: true, status: "UPHELD" };
  }
}

/** Cờ đã hết cửa sổ khiếu nại chưa. */
export function hetCuaSoKhieuNai(input: { appealDeadline: Date; now: Date }): boolean {
  return input.now.getTime() > input.appealDeadline.getTime();
}
