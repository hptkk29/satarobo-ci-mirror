// lib/payments/pos/agent/canh-bao-luat.ts — LUẬT chuông của máy đồng bộ (GĐ4 POS — T23). THUẦN.
//
// Thiết kế: docs/pos-gd4-thiet-ke.md §8. Khoá chuông theo (cơ sở + NGÀY VN) — đặc tả "dedupe theo cơ sở +
// ngày"; lần hết phiên / mất kết nối MỚI trong ngày đổi thân (mang giờ) + `reopen` ⇒ rung lại. Thân chuông
// KHÔNG in số tiền, mã phiếu hay tên khách.
import { gioVN, ngayVN } from "@/lib/format/thoi-gian-vn";

/** Nhãn cơ sở cho câu chữ ("CS1") — mã cơ sở, không có thì tên. */
export function nhanCoSo(center: { code: string | null; name: string }): string {
  return center.code?.trim() || center.name;
}

/** Đích mọi chuông agent — màn Sức khoẻ POS Agent. */
export const HREF_SUC_KHOE = "/bien-dong-so-du/pos-agent";

export type LoaiChuongAgent = "het-phien" | "mat-ket-noi" | "sap-het-phien" | "loi";

/** `pos.agent-<loại>:<centerId>:<YYYY-MM-DD giờ VN>`. 16:59:59Z (23:59:59 VN) và 17:00Z là HAI ngày. */
export function khoaChuongAgent(loai: LoaiChuongAgent, centerId: string, now: Date): string {
  return `pos.agent-${loai}:${centerId}:${ngayVN(now)}`;
}

/** Thứ trong tuần theo lịch VN: 0 = Chủ nhật, 1 = thứ Hai … */
function thuVN(now: Date): number {
  return new Date(`${ngayVN(now)}T00:00:00Z`).getUTCDay();
}

/**
 * Giờ hoạt động của trung tâm (đặc tả mục 5): 08:00–21:00, thứ Ba – Chủ nhật, giờ VN. Biên: 08:00 trong,
 * 21:00 ngoài; cả ngày thứ Hai ngoài. Chỉ cảnh báo MẤT KẾT NỐI chịu khung này — hết phiên báo mọi giờ.
 */
export function trongGioHoatDong(now: Date): boolean {
  if (thuVN(now) === 1) return false;
  const hhmm = gioVN(now).slice(11, 16);
  return hhmm >= "08:00" && hhmm < "21:00";
}

/**
 * 07:30 sáng: phiên hết hạn TRƯỚC 21:00 hôm nay (giờ VN) ⇒ báo đăng nhập lại trước giờ mở cửa. Biên: 20:59
 * báo, đúng 21:00 không; ngày mai không; không biết mốc (`null`) không báo.
 */
export function canBaoSang(sessionExpiresAt: Date | null, now: Date): boolean {
  if (sessionExpiresAt === null) return false;
  const moc21 = new Date(`${ngayVN(now)}T21:00:00+07:00`);
  return sessionExpiresAt.getTime() < moc21.getTime();
}

/**
 * Chốt hợp đồng 1.1 (RV5.4 #5): mốc hết hạn phiên heartbeat gửi có TIN được không. `sessionExpiresSource: "SESSION"`
 * = `expires` của session NextAuth — TRƯỢT tới "lúc gọi + 30 ngày" ở mỗi lần gọi, không phải hạn access token (24 giờ)
 * ⇒ KHÔNG rõ hạn (`null`): màn không in một hạn bịa, 07:30 không báo theo nó (`canBaoSang(null)` = false). Nguồn
 * `ACCESS_TOKEN`, vắng hoặc `null` (hợp đồng 1.0 để trường này tuỳ chọn) ⇒ dùng mốc như gửi.
 */
export function mocHetHanTinDuoc(x: {
  sessionExpiresAt: string | null;
  sessionExpiresSource?: "ACCESS_TOKEN" | "SESSION" | null;
}): Date | null {
  if (x.sessionExpiresAt === null || x.sessionExpiresSource === "SESSION") return null;
  return new Date(x.sessionExpiresAt);
}

/** "hh:mm" giờ VN; khác NGÀY VN với `now` ⇒ "hh:mm ngày dd/mm". */
export function gioNgan(d: Date, now: Date): string {
  const v = gioVN(d);
  const hhmm = v.slice(11, 16);
  return v.slice(0, 10) === ngayVN(now) ? hhmm : `${hhmm} ngày ${v.slice(8, 10)}/${v.slice(5, 7)}`;
}

export type NoiDungChuong = { title: string; body: string };

/** Hết phiên portal — câu đặc tả mục 5 + giờ hết phiên. */
export function noiDungHetPhien(coSo: string, luc: Date, now: Date): NoiDungChuong {
  return {
    title: `Portal Techcombank ${coSo} đã hết phiên`,
    body: `Remote vào máy POS Agent, mở hồ sơ Chrome ${coSo} và đăng nhập lại. Hết phiên lúc ${gioNgan(luc, now)}.`,
  };
}

/** Phiên sắp hết hạn trong ngày (07:30). */
export function noiDungSapHetPhien(coSo: string, hetLuc: Date, now: Date): NoiDungChuong {
  const gio = gioNgan(hetLuc, now);
  return {
    title: `Phiên Techcombank ${coSo} hết hạn lúc ${gio} hôm nay`,
    body: `Phiên ${coSo} hết hạn lúc ${gio} hôm nay — đăng nhập lại trước giờ mở cửa.`,
  };
}

export type LyDoMatKetNoi = "MAT_KET_NOI" | "CHUA_KET_NOI" | "CHUA_SAN_SANG" | "JOB_KHONG_TRA_LOI";

/** Máy POS Agent mất kết nối / chưa sẵn sàng — câu theo lý do (luật 12: câu nói đúng chuyện đang xảy ra). */
export function noiDungMatKetNoi(coSo: string, lyDo: LyDoMatKetNoi, tuLuc: Date | null, now: Date): NoiDungChuong {
  const tu = tuLuc ? ` Lần cuối liên lạc lúc ${gioNgan(tuLuc, now)}.` : "";
  switch (lyDo) {
    case "MAT_KET_NOI":
      return {
        title: `Máy POS Agent ${coSo} mất kết nối`,
        body: `Máy POS Agent mất kết nối.${tu} Kiểm máy agent còn bật, có mạng và Chrome đang mở hồ sơ ${coSo}.`,
      };
    case "CHUA_KET_NOI":
      return {
        title: `Máy POS Agent ${coSo} chưa kết nối lần nào`,
        body: `Sale vừa cần kiểm thẻ nhưng máy POS Agent ${coSo} chưa từng gọi về. Kiểm extension đã cài và dán cấu hình chưa.`,
      };
    case "CHUA_SAN_SANG":
      return {
        title: `Máy POS Agent ${coSo} chưa báo phiên portal`,
        body: `Máy POS Agent ${coSo} chưa báo được trạng thái phiên Techcombank.${tu} Mở hồ sơ Chrome ${coSo} kiểm tra.`,
      };
    case "JOB_KHONG_TRA_LOI":
      return {
        title: `Máy POS Agent ${coSo} không trả lời yêu cầu kiểm`,
        body: `Máy POS Agent ${coSo} vẫn gọi về nhưng không trả lời yêu cầu kiểm thẻ của sale.${tu} Mở hồ sơ Chrome ${coSo} kiểm tra tab portal.`,
      };
  }
}

/** Agent tự báo lỗi (`/status ERROR`) — chỉ MÃ, không chữ tự do. */
export function noiDungLoi(coSo: string, ma: string, luc: Date, now: Date): NoiDungChuong {
  return {
    title: `Máy POS Agent ${coSo} báo lỗi ${ma}`,
    body: `Lúc ${gioNgan(luc, now)}. Mở màn Sức khoẻ POS Agent xem chi tiết; giao dịch thẻ vẫn nhập được bằng file.`,
  };
}
