// lib/online-revenue/route-chung.ts — phần DÙNG CHUNG của ba route GET `/api/admin/online-revenue/*`: quyền → tham số → tính → phản hồi (no-store).
import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { LoiDoanhThu, tinhDoanhThuOnline, type DoanhThuOnline } from "./doc";
import { doiSoatDoanhThuOnline } from "./doi-soat";
import { nguoiXemDoanhThuOnline } from "./quyen";
import { docKhoangNgay, laNhomThoiGian, TRAN_SO_NGAY, type KhoangNgay, type NhomThoiGian } from "./thoi-gian";

export const KHONG_LUU = { "Cache-Control": "no-store" } as const;
const THAM_SO_DUOC_PHEP = new Set(["tu", "den", "nhom", "khoaId"]);

type ThamSo = { khoang: KhoangNgay; nhom: NhomThoiGian; khoaId: string | null };

function docThamSo(req: Request, cho: { khoaId: boolean }, now: Date): { ok: true; p: ThamSo } | { ok: false; res: Response } {
  const u = new URL(req.url).searchParams;
  const duocPhep = cho.khoaId ? THAM_SO_DUOC_PHEP : new Set(["tu", "den", "nhom"]);
  for (const k of u.keys()) if (!duocPhep.has(k)) return { ok: false, res: fail("VALIDATION", `Tham số lạ: ${k}.`, { status: 400, field: k, headers: KHONG_LUU }) };
  const nhom = u.get("nhom") ?? "day";
  if (!laNhomThoiGian(nhom)) return { ok: false, res: fail("VALIDATION", "`nhom` phải là day | week | month.", { status: 400, field: "nhom", headers: KHONG_LUU }) };
  const kh = docKhoangNgay(u.get("tu"), u.get("den"), now);
  if (!kh.ok) return { ok: false, res: fail(kh.loi.ma === "KHOANG_QUA_DAI" ? "KHOANG_QUA_DAI" : "VALIDATION", kh.loi.thongBao, { status: kh.loi.ma === "KHOANG_QUA_DAI" ? 422 : 400, field: kh.loi.ma === "THIEU_THAM_SO" ? "tu" : undefined, headers: KHONG_LUU }) };
  const khoaId = u.get("khoaId");
  if (khoaId !== null && (khoaId.length < 1 || khoaId.length > 64)) return { ok: false, res: fail("VALIDATION", "`khoaId` không hợp lệ.", { status: 400, field: "khoaId", headers: KHONG_LUU }) };
  return { ok: true, p: { khoang: kh.khoang, nhom, khoaId } };
}

type Chon = "summary" | "by-course" | "reconcile";

export async function chayBaoCaoDoanhThuOnline(req: Request, chon: Chon): Promise<Response> {
  const n = await nguoiXemDoanhThuOnline();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  const t = docThamSo(req, { khoaId: chon !== "reconcile" }, new Date());
  if (!t.ok) return t.res;
  const { khoang, nhom, khoaId } = t.p;
  if (khoaId && !(await db.onlCourse.findFirst({ where: { id: khoaId, deletedAt: null }, select: { id: true } }))) return fail("NOT_FOUND", "Không có khoá học này.", { status: 404, field: "khoaId", headers: KHONG_LUU });
  try {
    const kyBaoCao = {
      tu: khoang.tu,
      den: khoang.den,
      soNgay: khoang.soNgay,
      nhom,
      khoaId,
      mocThoiGian: "Giờ Việt Nam (UTC+7), nửa mở: [00:00 ngày `tu`, 00:00 ngày sau `den`). Tiền theo NGÀY THU (Payment.paidDate); đơn theo NGÀY TẠO (Order.createdAt); quyền học theo NGÀY CẤP (OrderOnlineGrant.grantedAt).",
    };
    if (chon === "reconcile") return ok({ kyBaoCao, ...(await doiSoatDoanhThuOnline(db, { khoang, nhom })) }, { headers: KHONG_LUU });
    const bc: DoanhThuOnline = await tinhDoanhThuOnline(db, { khoang, nhom, khoaId });
    const meta = { quyTheoTyLe: bc.quyTheoTyLe, tranSoNgay: TRAN_SO_NGAY };
    if (chon === "by-course") return ok({ kyBaoCao, theoKhoa: bc.theoKhoa }, { meta, headers: KHONG_LUU });
    return ok(
      { kyBaoCao, tien: bc.tien, donHang: bc.donHang, quyenHoc: bc.quyenHoc, giamGia: bc.giamGia, yeuCauHoan: bc.yeuCauHoan, hoaHong: bc.hoaHong, theoThoiGian: bc.theoThoiGian, theoPhapNhan: bc.theoPhapNhan, canhBao: bc.canhBao },
      { meta, headers: KHONG_LUU },
    );
  } catch (e) {
    if (e instanceof LoiDoanhThu) return fail(e.ma, e.message, { status: 422, headers: KHONG_LUU });
    throw e;
  }
}
