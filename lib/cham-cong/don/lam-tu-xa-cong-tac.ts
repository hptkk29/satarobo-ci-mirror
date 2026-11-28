// lib/cham-cong/don/lam-tu-xa-cong-tac.ts — handler duyệt đơn LÀM TỪ XA (đợt 5, BA 4.12) và ĐI CÔNG TÁC
// (đợt 6, BA 4.13).
//
// Cả hai KHÔNG đổi ca (BA: "shift vẫn giữ nguyên") và KHÔNG sinh bản ghi lịch riêng: chính đơn đã
// duyệt là "lịch công tác / làm từ xa" của từng ngày trong khoảng (`don-trong-ngay.ts`). Nhờ vậy
// duyệt lại / tính lại bao nhiêu lần cũng không đẻ bản ghi trùng (BA §12), và huỷ đơn = đổi trạng thái.
// Duyệt chỉ đánh dấu các ngày để tính lại.
//
// Hệ quả thật nằm ở hai chỗ khác, cùng đọc đơn qua `quyenChamNgoai` / `dungNguCanhDon`:
//   · lúc QUÉT (`timelog.ts`): trong khung được duyệt thì chấm ngoài văn phòng được, không "sai nơi";
//   · lúc TÍNH (`engine.ts`): cờ "Làm từ xa / Đi công tác — Đã duyệt"; công tác chế độ ĐỦ CÔNG (QĐ-3)
//     thì không đòi quét.
import { getSetting } from "@/lib/settings/service";
import { khoangTu } from "../khoang-gio";
import { markAttendanceDaysDirtyMany } from "../recompute";
import { DecideError, HREF_DON_CUA_TOI, type HandlerDon, type NguCanhDuyet } from "./kieu";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function danhDauKhoang(ctx: NguCanhDuyet, lyDo: string): Promise<{ tu: string; den: string; soNgay: number }> {
  const { tx, don } = ctx;
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  const den = don.toDate ?? don.fromDate;
  if (den < don.fromDate) throw new DecideError("Ngày kết thúc trước ngày bắt đầu");
  const ngay: { userId: string; workDate: Date }[] = [];
  for (let d = new Date(don.fromDate); d <= den; d = new Date(d.getTime() + 86_400_000)) ngay.push({ userId: don.requesterId, workDate: d });
  await markAttendanceDaysDirtyMany(ngay, { tx, reason: lyDo });
  return { tu: ymd(don.fromDate), den: ymd(den), soNgay: ngay.length };
}

export const duyetLamTuXa: HandlerDon = async (ctx) => {
  const { don, actor, note, dateLabel, kindLabel } = ctx;
  // Khai giờ thì phải khai ĐỦ và đúng chiều — nửa khung là mở cả ngày một cách không ai định.
  const coGio = !!(don.startTime || don.endTime);
  const khung = coGio ? khoangTu(don.startTime, don.endTime) : null;
  if (coGio && !khung) throw new DecideError("Khung giờ làm từ xa không hợp lệ (cần đủ giờ bắt đầu và kết thúc)");
  const k = await danhDauKhoang(ctx, "REMOTE");
  const khungChu = khung ? ` ${don.startTime}–${don.endTime}` : " cả ngày";
  return {
    applied: true,
    messages: [`Làm từ xa${khungChu}, ${k.soNgay} ngày (${k.tu} → ${k.den}): chấm công ngoài văn phòng được trong thời gian này, ca giữ nguyên`],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`,
        body: `${actor.name} đã duyệt — bạn vẫn chấm công theo ca, bấm nút "Chấm công" trên trang Chấm công (không cần quét QR tại văn phòng)${khungChu}${note ? ` — ${note}` : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: { tu: k.tu, den: k.den, khung: khung ? `${don.startTime}–${don.endTime}` : "CA_NGAY" },
  };
};

export const duyetCongTac: HandlerDon = async (ctx) => {
  const { don, actor, note, dateLabel, kindLabel, map } = ctx;
  const k = await danhDauKhoang(ctx, "BUSINESS_TRIP");
  const orgUnitId = Object.values(map.byCode).find((c) => c.centerId === don.centerId)?.orgUnitId ?? null;
  const cheDo = await getSetting("shift.congTacCheDo", { orgUnitId });
  const cachTinh =
    cheDo === "DU_CONG" ? "đủ công theo ca, không cần quét" : "vẫn chấm công (ở đâu cũng được), thiếu lượt thì báo như ngày thường";
  return {
    applied: true,
    messages: [`Đã ghi nhận lịch công tác ${k.soNgay} ngày (${k.tu} → ${k.den}) — ${cachTinh}; không cần xếp thêm ca công tác`],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`,
        body: `${actor.name} đã duyệt công tác ${k.tu} → ${k.den} — ${cachTinh}${note ? ` — ${note}` : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: { tu: k.tu, den: k.den, cheDo },
  };
};
