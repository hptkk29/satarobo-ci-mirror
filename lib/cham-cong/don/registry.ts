// lib/cham-cong/don/registry.ts — MỘT handler cho MỖI loại đơn (đợt 3 đơn từ, BA §13: "không rải
// if (type === …) khắp codebase").
//
// `Record<WorkRequestKindV, HandlerDon>` ⇒ thêm một loại đơn vào enum mà quên khai handler là LỖI
// BIÊN DỊCH, không phải một nhánh `else` im lặng nuốt đơn mới thành "chỉ ghi nhận".
import type { WorkRequestKindV } from "@/lib/work-request";
import { duyetChiGhiNhan, duyetChinhCong, duyetDoiCa, duyetMuonSom, duyetNghiPhep } from "./ca-nghi-cong";
import type { HandlerDon } from "./kieu";
import { duyetDayThay, duyetNghiBuoiDay } from "./lop-hoc";
import { duyetTangCa } from "./tang-ca";
import { duyetCongTac, duyetLamTuXa } from "./lam-tu-xa-cong-tac";
import { duyetNghiBu } from "./nghi-mot-phan";
import { duyetChamNgoai, duyetLamNgayNghi } from "./lam-ngay-nghi";

export const HANDLER_DON: Record<WorkRequestKindV, HandlerDon> = {
  CLASS_CHANGE: duyetChiGhiNhan,
  SUB_TEACH: duyetDayThay,
  CLASS_OFF: duyetNghiBuoiDay,
  SHIFT_SWAP: duyetDoiCa,
  OT: duyetTangCa,
  LATE_EARLY: duyetMuonSom,
  TIMESHEET_FIX: duyetChinhCong,
  LEAVE: duyetNghiPhep,
  REMOTE: duyetLamTuXa,
  BUSINESS_TRIP: duyetCongTac,
  COMP_LEAVE: duyetNghiBu,
  HOLIDAY_WORK: duyetLamNgayNghi,
  OUTSIDE_ATTENDANCE: duyetChamNgoai,
};
