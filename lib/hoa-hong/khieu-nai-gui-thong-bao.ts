import "server-only";
// lib/hoa-hong/khieu-nai-gui-thong-bao.ts — GỬI thông báo khiếu nại, SAU khi giao dịch nghiệp vụ đã commit.
//
// Nguồn: 05 §3. Nội dung dựng ở `khieu-nai-thong-bao.ts` (thuần, có ca `[NHH-DSP-N*]`).
//
// Quy tắc:
//   · Gọi SAU commit, từ tầng action (`ghiThongBaoNhanSu` cố ý không nhận `tx` — broadcast phải chạy sau commit).
//   · Thông báo là việc PHỤ: lỗi gửi chỉ `console.warn`, KHÔNG làm hỏng nghiệp vụ đã commit (khiếu nại đã tạo / đã quyết rồi, ném lỗi lúc này sẽ khiến
//     người dùng bấm lại và gặp "đã có khiếu nại đang mở").
//   · Người nhận tin "khiếu nại mới" = người giữ `commission_disputes:review` ở cơ sở của giao dịch (kể cả người neo vai ở Hội sở/Khối — `nguoiGiuQuyenTaiCoSo`
//     leo cây tổ tiên), TRỪ chính người khiếu nại.
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";
import { ghiThongBaoNhanSu } from "@/lib/notifications/notify";

import { KEY_DUYET_KHIEU_NAI } from "./khieu-nai-ma";
import { dungTinKhieuNaiKetQua, dungTinKhieuNaiMoi } from "./khieu-nai-thong-bao";
import type { KetQuaKhieuNai } from "./khieu-nai-trang-thai";

export async function baoKhieuNaiMoi(i: { disputeId: string; centerId: string; raisedByUserId: string; ky: string; laKhoanThu: boolean }): Promise<void> {
  try {
    const nguoi = (await nguoiGiuQuyenTaiCoSo(i.centerId, [KEY_DUYET_KHIEU_NAI])).filter((u) => u !== i.raisedByUserId);
    if (nguoi.length === 0) return;
    const tin = dungTinKhieuNaiMoi({ disputeId: i.disputeId, ky: i.ky, laKhoanThu: i.laKhoanThu });
    await ghiThongBaoNhanSu({ userIds: nguoi, dedupeKey: tin.dedupeKey, title: tin.title, body: tin.body, href: tin.href, entityId: i.disputeId });
  } catch (e) {
    console.warn("[khieu-nai] gửi tin 'khiếu nại mới' lỗi:", e instanceof Error ? e.message : e);
  }
}

export async function baoKetQuaKhieuNai(i: { disputeId: string; raisedByUserId: string; ketQua: KetQuaKhieuNai; lyDoQuyetDinh: string }): Promise<void> {
  try {
    const tin = dungTinKhieuNaiKetQua({ disputeId: i.disputeId, ketQua: i.ketQua, lyDoQuyetDinh: i.lyDoQuyetDinh });
    await ghiThongBaoNhanSu({ userIds: [i.raisedByUserId], dedupeKey: tin.dedupeKey, title: tin.title, body: tin.body, href: tin.href, entityId: i.disputeId });
  } catch (e) {
    console.warn("[khieu-nai] gửi tin 'kết quả khiếu nại' lỗi:", e instanceof Error ? e.message : e);
  }
}
