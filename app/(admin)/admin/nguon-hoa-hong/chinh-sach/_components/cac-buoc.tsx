"use client";

// Sáu bước đầu của builder chính sách (06 §5.2) — mỗi bước một khối, chỉ vẽ + gọi `dat`; mọi luật kiểm nằm ở
// `lib/hoa-hong/chinh-sach-form.ts`. Bước 7 (Kích hoạt) nằm ở `buoc-kich-hoat.tsx` vì nó cần trạng thái máy chủ.
import { Ban, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import { PercentageInput } from "@/components/admin/nguon-hoa-hong/phan-tram-input";
import { TepVanBan } from "@/components/admin/nguon-hoa-hong/tep-van-ban";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import {
  khoaO,
  LOAI_GD_SOAN,
  NHAN_LOAI_GD,
  type FormChinhSach,
  type LoaiGdSoan,
} from "@/lib/hoa-hong/chinh-sach-form";
import { goiYVaiVoiNguon, type PhamViGoiY } from "@/lib/hoa-hong/goi-y-nguoi-huong";
import { ngayDMY, type KetQuaKiemHangRao } from "@/lib/hoa-hong/hang-rao-ui";
import { nguonQuaCongHoatDong, nhanLuaChonNguon } from "@/lib/hoa-hong/nguon-cho-soan";
import { tachNhomVai } from "@/lib/hoa-hong/nhom-hoa-hong";
import { dinhDangPhanTram } from "@/lib/hoa-hong/phan-tram";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { tongTheoLoai, viDuTinh } from "@/lib/hoa-hong/vi-du-tinh";
import { moTaCachXacDinhVai, MO_TA_NHOM_HOA_HONG, NHAN_TRANG_THAI_NGUON } from "@/lib/nguon/nhan-hien-thi";
import { cn } from "@/lib/utils";

import type { PropsBuoc, VanBanLuaChon } from "./kieu-soan";
import { LuaChon, NhomChon, Truong } from "./truong";

// ── 1 · Bối cảnh ────────────────────────────────────────────────────────────

export function BuocBoiCanh({ form, dat, loi, dl, khoaDinhDanh, coQuyenQuanLyNguon }: PropsBuoc) {
  const pv = form.phamVi;
  const nguonDangChon = pv.loai === "SOURCE_GROUP" ? dl.nhomNguon.find((n) => n.id === pv.sourceGroupId) : undefined;
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Truong truong="policyCode" nhan="Mã chính sách" batBuoc loi={loi("policyCode")} goiY={khoaDinhDanh ? "Mã và tên không đổi giữa các phiên bản." : "Dùng số hiệu văn bản làm gốc, vd SR.QD.300/HV_MOI."}>
          {(p) => <input {...p} type="text" value={form.policyCode} disabled={khoaDinhDanh} onChange={(e) => dat({ policyCode: e.target.value })} className={O_NHAP} autoComplete="off" />}
        </Truong>
        <Truong truong="name" nhan="Tên chính sách" batBuoc loi={loi("name")}>
          {(p) => <input {...p} type="text" value={form.name} disabled={khoaDinhDanh} onChange={(e) => dat({ name: e.target.value })} className={O_NHAP} autoComplete="off" />}
        </Truong>
      </div>

      <Truong truong="description" nhan="Mô tả" goiY="Không bắt buộc. Chính sách này dành cho ai, áp dụng khi nào.">
        {(p) => <Textarea {...p} value={form.description} disabled={khoaDinhDanh} onChange={(e) => dat({ description: e.target.value })} rows={2} />}
      </Truong>

      <Truong
        truong="chuSoHuu"
        nhan="Đơn vị sở hữu"
        loi={loi("chuSoHuu")}
        goiY={khoaDinhDanh ? "Đơn vị sở hữu không đổi sau khi tạo." : "Chính sách của Hội sở áp cho mọi cơ sở; chính sách của một cơ sở chỉ áp cho giao dịch của cơ sở đó."}
      >
        {(p) => (
          <select
            {...p}
            value={form.chuSoHuuOrgUnitId ?? ""}
            disabled={khoaDinhDanh}
            onChange={(e) => dat({ chuSoHuuOrgUnitId: e.target.value === "" ? null : e.target.value })}
            className={O_NHAP}
          >
            {dl.coTheSoHuuHoiSo && <option value="">Hội sở (toàn hệ thống)</option>}
            {dl.coSo.map((c) => (
              <option key={c.orgUnitId} value={c.orgUnitId}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Truong>

      <NhomChon truong="phamVi" nhan="Áp dụng cho" loi={loi("phamVi") ?? loi("phamVi.sourceGroupId") ?? loi("phamVi.orgUnitId")}>
        <div className="grid gap-2">
          <LuaChon loai="radio" name="pham-vi" checked={pv.loai === "GLOBAL"} onChange={() => dat({ phamVi: { loai: "GLOBAL" } })} nhan="Mọi giao dịch thuộc đơn vị sở hữu" moTa="Mức nền. Chính sách riêng cho một nhóm nguồn hoặc cơ sở sẽ thắng mức nền khi cụ thể hơn." />
          <LuaChon loai="radio" name="pham-vi" checked={pv.loai === "SOURCE_GROUP"} onChange={() => dat({ phamVi: { loai: "SOURCE_GROUP", sourceGroupId: "" } })} nhan="Một nhóm nguồn" />
          {pv.loai === "SOURCE_GROUP" && (
            <div className="pl-7">
              <select
                aria-label="Nhóm nguồn"
                data-truong="phamVi.sourceGroupId"
                aria-invalid={loi("phamVi.sourceGroupId") ? true : undefined}
                value={pv.sourceGroupId}
                onChange={(e) => dat({ phamVi: { loai: "SOURCE_GROUP", sourceGroupId: e.target.value } })}
                className={O_NHAP}
              >
                <option value="">— Chọn nhóm nguồn —</option>
                {/* Nguồn Lưu trữ không mời chọn; nguồn Nháp / Ngừng hiện để người soạn biết nó ở đâu nhưng KHÔNG chọn được (chọn thì Kích hoạt bị chặn). Nguồn bản nháp ĐANG mang luôn có mặt, kể cả đã ngừng. */}
                {dl.nhomNguon
                  .filter((n) => n.id === pv.sourceGroupId || n.trangThai !== "LUU_TRU")
                  .map((n) => (
                    <option key={n.id} value={n.id} disabled={!nguonQuaCongHoatDong(n.trangThai) && n.id !== pv.sourceGroupId}>
                      {nhanLuaChonNguon(n)}
                    </option>
                  ))}
              </select>
              {nguonDangChon && <GhiChuNguonDangChon nguon={nguonDangChon} coQuyenQuanLyNguon={coQuyenQuanLyNguon} />}
            </div>
          )}
          <LuaChon loai="radio" name="pham-vi" checked={pv.loai === "ORG_UNIT"} onChange={() => dat({ phamVi: { loai: "ORG_UNIT", orgUnitId: form.chuSoHuuOrgUnitId ?? "" } })} nhan="Một cơ sở" />
          {pv.loai === "ORG_UNIT" && (
            <div className="pl-7">
              <select
                aria-label="Cơ sở áp dụng"
                data-truong="phamVi.orgUnitId"
                aria-invalid={loi("phamVi.orgUnitId") ? true : undefined}
                value={pv.orgUnitId}
                onChange={(e) => dat({ phamVi: { loai: "ORG_UNIT", orgUnitId: e.target.value } })}
                className={O_NHAP}
              >
                <option value="">— Chọn cơ sở —</option>
                {dl.coSo.map((c) => (
                  <option key={c.orgUnitId} value={c.orgUnitId}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </NhomChon>

      <NhomChon truong="loaiGd" nhan="Loại giao dịch" loi={loi("loaiGd")} goiY="Loại nào không có rule thì KHÔNG sinh hoa hồng — hệ thống không tự trả mức 0%.">
        <div className="grid gap-2 sm:grid-cols-2">
          {dl.loaiGdBat.map((l) => (
            <LuaChon
              key={l}
              loai="checkbox"
              checked={form.loaiGd.includes(l)}
              onChange={(c) => dat({ loaiGd: LOAI_GD_SOAN.filter((x) => (x === l ? c : form.loaiGd.includes(x))) })}
              nhan={NHAN_LOAI_GD[l]}
              moTa={l === "NEW" ? "Học viên mua lần đầu." : "Học viên đã mua trước đó, mua thêm."}
            />
          ))}
        </div>
      </NhomChon>
    </div>
  );
}

// ── 2 · Người hưởng ─────────────────────────────────────────────────────────

/** Phạm vi của form → phạm vi mà bộ gợi ý hiểu (chỉ cần biết «chung» hay «một nguồn»). */
function phamViGoiY(pv: PropsBuoc["form"]["phamVi"]): PhamViGoiY {
  return pv.loai === "SOURCE_GROUP" ? { loai: "SOURCE_GROUP", sourceGroupId: pv.sourceGroupId } : pv.loai === "ORG_UNIT" ? { loai: "ORG_UNIT" } : { loai: "GLOBAL" };
}

export function BuocNguoiHuong({ form, dat, loi, dl, coQuyenQuanLyNguon }: PropsBuoc) {
  const nhom = tachNhomVai(dl.vai);
  const goiY = goiYVaiVoiNguon({ vai: dl.vai.filter((v) => form.vai.includes(v.code)), phamVi: phamViGoiY(form.phamVi), nguon: dl.nhomNguon });
  const idNguon = form.phamVi.loai === "SOURCE_GROUP" ? form.phamVi.sourceGroupId : null;
  const nguonDangChon = idNguon === null ? undefined : dl.nhomNguon.find((n) => n.id === idNguon);
  return (
    <div className="grid gap-4">
      <NhomChon truong="vai" nhan="Vai được hưởng hoa hồng" loi={loi("vai")} goiY="Chọn các vai có phần trong chính sách này. Người nhận cụ thể được xác định lúc tính, theo cách của từng vai.">
        <div className="grid gap-5">
          {nhom.map((n) => (
            <section key={n.khoa} aria-label={n.nhan} data-nhom-hoa-hong={n.khoa} className="grid gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{n.nhan}</h3>
                <p className="text-xs text-muted-foreground">{MO_TA_NHOM_HOA_HONG[n.khoa]}</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {n.vai.map((v) => (
                  <LuaChon
                    key={v.code}
                    loai="checkbox"
                    checked={form.vai.includes(v.code)}
                    onChange={(c) => dat({ vai: dl.vai.map((x) => x.code).filter((code) => (code === v.code ? c : form.vai.includes(code))) })}
                    nhan={v.name}
                    moTa={`${moTaCachXacDinhVai(v)}${v.isAcquisition ? " · chỉ trong cửa sổ ghi công" : ""}`}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </NhomChon>
      {goiY.length > 0 && (
        <ul role="note" aria-label="Điều kiện của vai với nguồn" data-testid="goi-y-vai" className="grid gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-xs text-state-warning-ink">
          {goiY.map((g) => (
            <li key={`${g.vai}:${g.ma}`} data-ma={g.ma} className="break-words">
              {g.noiDung}
              {nguonDangChon && g.ma !== "NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH" && coQuyenQuanLyNguon && (
                <>
                  {" "}
                  <Link href={`/nguon-hoa-hong/nguon/${nguonDangChon.code}`} className="whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline">
                    Mở cấu hình nguồn
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Ghi chú dưới ô chọn nguồn. Nói ĐÚNG điều guardrail sẽ làm (chặn hay không), kèm lối ra: «bật ở cấu hình nguồn» chỉ có liên kết khi người xem quản lý được nguồn (`sources:manage`) —
 * không thì nói nhờ ai. Nguồn ngoài khoảng hiệu lực thì chỉ NÓI (chính sách vẫn kích hoạt được): khoảng đó chỉ chặn việc chọn nguồn cho lead MỚI.
 */
function GhiChuNguonDangChon({ nguon, coQuyenQuanLyNguon }: { nguon: PropsBuoc["dl"]["nhomNguon"][number]; coQuyenQuanLyNguon: boolean }) {
  const duongNguon = `/nguon-hoa-hong/nguon/${nguon.code}`;
  const lienKet = coQuyenQuanLyNguon ? (
    <Link href={duongNguon} className="whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline">
      Mở cấu hình nguồn
    </Link>
  ) : (
    <span>Cấu hình nguồn chỉ mở được khi quản lý nguồn đang bật và bạn có quyền sources:manage — nhờ người có quyền mở cấu hình nguồn này.</span>
  );
  const ghi: { khoa: string; mucDo: "warning" | "info"; noiDung: ReactNode }[] = [];
  if (!nguonQuaCongHoatDong(nguon.trangThai)) {
    ghi.push({
      khoa: "khong-hoat-dong",
      mucDo: "warning",
      noiDung: (
        <>
          Nguồn «{nguon.name}» đang ở trạng thái <b>{NHAN_TRANG_THAI_NGUON[nguon.trangThai]}</b> nên chính sách riêng của nó không kích hoạt được. Đưa nguồn về hoạt động trước, hoặc chọn mức chung. {lienKet}
        </>
      ),
    });
  } else if (nguon.trangThai !== "HOAT_DONG") {
    ghi.push({
      khoa: "ngoai-hieu-luc",
      mucDo: "info",
      noiDung: (
        <>
          Nguồn «{nguon.name}» đang <b>{NHAN_TRANG_THAI_NGUON[nguon.trangThai].toLowerCase()}</b>: lead mới không chọn được nguồn này. Chính sách vẫn kích hoạt được và vẫn tính cho lead đã mang nguồn.
        </>
      ),
    });
  }
  if (!nguon.coHoaHong) {
    ghi.push({
      khoa: "khong-hoa-hong",
      mucDo: "warning",
      noiDung: (
        <>
          Nguồn «{nguon.name}» đang tắt «tham gia hoa hồng theo nguồn» nên các dòng thu hút (có tỉ lệ) của chính sách riêng của nó sẽ không chạy và không kích hoạt được; chỉ dòng «loại trừ» (nguồn này không trả một vai nào đó) mới chạy. Bật ở cấu hình nguồn trước, hoặc chọn mức chung. {lienKet}
        </>
      ),
    });
  }
  if (ghi.length === 0) return null;
  return (
    <div className="mt-1.5 grid gap-1.5">
      {ghi.map((g) => (
        <p key={g.khoa} role="note" data-testid={g.khoa === "khong-hoa-hong" ? "nguon-khong-hoa-hong" : `nguon-${g.khoa}`} className={cn("text-xs", g.mucDo === "warning" ? "text-state-warning-ink" : "text-muted-foreground")}>
          {g.noiDung}
        </p>
      ))}
    </div>
  );
}

// ── 3 · Cách tính ───────────────────────────────────────────────────────────

export function BuocCachTinh({ form, dat, loi, dl }: PropsBuoc) {
  const vai = dl.vai.filter((v) => form.vai.includes(v.code));
  const loaiCo = LOAI_GD_SOAN.filter((l) => form.loaiGd.includes(l));
  const tong = new Map(tongTheoLoai(form, dl.tran).map((t) => [t.loai, t]));
  const datO = (loai: LoaiGdSoan, code: string, o: FormChinhSach["o"][string]) => dat({ o: { ...form.o, [khoaO(loai, code)]: o } });

  if (vai.length === 0 || loaiCo.length === 0) {
    return <p className="text-sm text-muted-foreground">Chọn ít nhất một loại giao dịch (bước Bối cảnh) và một vai (bước Người hưởng) để nhập tỉ lệ.</p>;
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Nhập <b className="text-foreground">phần trăm trên thực thu</b> (sau VAT, kế toán đã xác nhận). Gõ <b className="text-foreground">3</b> là 3%. Ô để trống = vai đó
        không có rule ở loại giao dịch này. Chỉ tính học phí; học cụ, vật tư chưa tính.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Vai
              </th>
              {loaiCo.map((l) => (
                <th key={l} scope="col" className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {NHAN_LOAI_GD[l]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vai.map((v) => (
              <tr key={v.code} className="border-b border-border/60 align-top last:border-0">
                <th scope="row" className="w-36 px-3 py-3 text-sm font-medium text-foreground">
                  {v.name}
                </th>
                {loaiCo.map((l) => {
                  const k = khoaO(l, v.code);
                  const o = form.o[k] ?? { kieu: "PERCENT" as const, phanTram: "" };
                  const truong = `o.${k}`;
                  return (
                    <td key={l} className="min-w-[10.5rem] px-3 py-2.5">
                      {o.kieu === "EXCLUDE" ? (
                        <div className="flex items-center gap-2">
                          <span data-truong={truong} tabIndex={-1} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm font-medium text-muted-foreground">
                            <Ban aria-hidden className="h-4 w-4" />
                            Không trả
                          </span>
                          <button type="button" onClick={() => datO(l, v.code, { kieu: "PERCENT", phanTram: "" })} aria-label={`Bỏ loại trừ: ${v.name} · ${NHAN_LOAI_GD[l]}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                            <Undo2 aria-hidden className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5">
                          <PercentageInput
                            value={o.phanTram}
                            onChange={(raw) => datO(l, v.code, { kieu: "PERCENT", phanTram: raw })}
                            error={loi(truong)}
                            ariaLabel={`Tỉ lệ ${v.name} · ${NHAN_LOAI_GD[l]}`}
                            truong={truong}
                            className="flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => datO(l, v.code, { kieu: "EXCLUDE", phanTram: "" })}
                            aria-label={`Không trả hoa hồng: ${v.name} · ${NHAN_LOAI_GD[l]}`}
                            title="Không trả hoa hồng cho vai này (loại trừ rõ ràng, thắng mức nền)"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Ban aria-hidden className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/40">
              <th scope="row" className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-foreground">
                Tổng trong chính sách này
              </th>
              {loaiCo.map((l) => {
                const t = tong.get(l);
                const vuot = t?.vuotTran === true;
                return (
                  <td key={l} className={cn("whitespace-nowrap px-3 py-3 text-sm font-semibold tabular-nums", vuot ? "text-state-danger-ink" : "text-foreground")}>
                    {t ? `${t.tongPhanTram}%` : "—"}
                    {vuot && dl.tran !== null && <span className="ml-1.5 font-medium"> vượt trần {dinhDangPhanTram(dl.tran)}%</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {dl.tran !== null ? `Trần tổng ${dinhDangPhanTram(dl.tran)}% trên một khoản thu (gồm cả giáo viên dạy Trial), đọc từ cấu hình. ` : ""}
        Hàng này chỉ cộng các vai trong chính sách này; lúc kích hoạt máy chủ còn cộng với các chính sách khác đang hiệu lực. Vượt trần là lỗi cấu hình — hệ thống không tự cắt.
      </p>
    </div>
  );
}

// ── 4 · Văn bản ─────────────────────────────────────────────────────────────

function dongVanBan(v: VanBanLuaChon): string {
  return `${v.documentCode} — ${v.title}`;
}

export function BuocVanBan({ form, dat, loi, dl, vanBanThem }: PropsBuoc & { vanBanThem: VanBanLuaChon[] }) {
  const vb = form.vanBan;
  const danhSach = [...vanBanThem.filter((x) => !dl.vanBan.some((y) => y.id === x.id)), ...dl.vanBan];
  const chon = vb.kieu === "co-san" ? danhSach.find((x) => x.id === vb.id) : undefined;
  const moi = vb.kieu === "moi" ? vb : null;
  const datMoi = (patch: Partial<NonNullable<typeof moi>>) => moi && dat({ vanBan: { ...moi, ...patch } });

  return (
    <div className="grid gap-5">
      <NhomChon truong="vanBan" nhan="Văn bản quy định" loi={loi("vanBan")} goiY="Chính sách chỉ kích hoạt được khi có văn bản đủ thông tin và có tệp đính kèm. Lưu nháp thì chưa cần.">
        <div className="grid gap-2">
          <LuaChon loai="radio" name="van-ban" checked={vb.kieu === "co-san"} onChange={() => dat({ vanBan: { kieu: "co-san", id: "" } })} nhan="Dùng văn bản đã có" />
          <LuaChon
            loai="radio"
            name="van-ban"
            checked={vb.kieu === "moi"}
            onChange={() => dat({ vanBan: { kieu: "moi", documentCode: "", title: "", issuedOn: "", publishedOn: "", effectiveOn: "", approvedByName: "", tep: null } })}
            nhan="Tạo văn bản mới"
          />
          <LuaChon loai="radio" name="van-ban" checked={vb.kieu === "chua"} onChange={() => dat({ vanBan: { kieu: "chua" } })} nhan="Chưa gắn văn bản" moTa="Lưu nháp được; chưa kích hoạt được." />
        </div>
      </NhomChon>

      {vb.kieu === "co-san" && (
        <Truong truong="vanBan.id" nhan="Chọn văn bản" batBuoc loi={loi("vanBan.id")}>
          {(p) => (
            <select {...p} value={vb.id} onChange={(e) => dat({ vanBan: { kieu: "co-san", id: e.target.value } })} className={O_NHAP}>
              <option value="">— Chọn văn bản —</option>
              {danhSach.map((x) => (
                <option key={x.id} value={x.id}>
                  {dongVanBan(x)}
                </option>
              ))}
            </select>
          )}
        </Truong>
      )}
      {chon && (
        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1.5 border-t border-border pt-4 text-sm">
          <dt className="text-muted-foreground">Số hiệu</dt>
          <dd className="font-medium text-foreground">{chon.documentCode}</dd>
          <dt className="text-muted-foreground">Công bố</dt>
          <dd className="tabular-nums text-foreground">{ngayDMY(chon.publishedOn)}</dd>
          <dt className="text-muted-foreground">Tệp đính kèm</dt>
          <dd className={chon.coTep ? "text-foreground" : "font-medium text-state-warning-ink"}>{chon.coTep ? "Có" : "Chưa có — cần có trước khi kích hoạt"}</dd>
          {chon.daThuHoi && (
            <>
              <dt className="text-muted-foreground">Tình trạng</dt>
              <dd className="font-medium text-state-danger-ink">Văn bản đã bị thu hồi</dd>
            </>
          )}
        </dl>
      )}
      {vb.kieu === "co-san" && danhSach.length === 0 && <p className="text-sm text-muted-foreground">Chưa có văn bản nào trong phạm vi của bạn. Chọn “Tạo văn bản mới”.</p>}

      {moi && (
        <div className="grid gap-5 border-t border-border pt-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Truong truong="vanBan.documentCode" nhan="Số hiệu văn bản" batBuoc loi={loi("vanBan.documentCode")}>
              {(p) => <input {...p} type="text" value={moi.documentCode} onChange={(e) => datMoi({ documentCode: e.target.value })} className={O_NHAP} autoComplete="off" />}
            </Truong>
            <Truong truong="vanBan.approvedByName" nhan="Người duyệt" batBuoc loi={loi("vanBan.approvedByName")}>
              {(p) => <input {...p} type="text" value={moi.approvedByName} onChange={(e) => datMoi({ approvedByName: e.target.value })} className={O_NHAP} autoComplete="off" />}
            </Truong>
          </div>
          <Truong truong="vanBan.title" nhan="Tiêu đề" batBuoc loi={loi("vanBan.title")}>
            {(p) => <input {...p} type="text" value={moi.title} onChange={(e) => datMoi({ title: e.target.value })} className={O_NHAP} autoComplete="off" />}
          </Truong>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <Truong truong="vanBan.issuedOn" nhan="Ngày ban hành" batBuoc loi={loi("vanBan.issuedOn")}>
              {(p) => <input {...p} type="date" value={moi.issuedOn} onChange={(e) => datMoi({ issuedOn: e.target.value })} className={O_NHAP} />}
            </Truong>
            <Truong truong="vanBan.publishedOn" nhan="Ngày công bố" batBuoc loi={loi("vanBan.publishedOn")} goiY="Mốc tính 15 ngày làm việc trước khi có hiệu lực.">
              {(p) => <input {...p} type="date" value={moi.publishedOn} onChange={(e) => datMoi({ publishedOn: e.target.value })} className={O_NHAP} />}
            </Truong>
            <Truong truong="vanBan.effectiveOn" nhan="Hiệu lực ghi trong văn bản" batBuoc loi={loi("vanBan.effectiveOn")}>
              {(p) => <input {...p} type="date" value={moi.effectiveOn} onChange={(e) => datMoi({ effectiveOn: e.target.value })} className={O_NHAP} />}
            </Truong>
          </div>
          <div data-truong="vanBan.tep" tabIndex={-1} className="outline-none">
            <p className="mb-1 text-sm font-semibold text-foreground">Tệp văn bản gốc</p>
            <TepVanBan value={moi.tep} onChange={(tep) => datMoi({ tep })} />
            {loi("vanBan.tep") && (
              <p role="alert" className="mt-1 text-xs font-medium text-state-danger-ink">
                {loi("vanBan.tep")}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Cần có tệp (PDF bản ký, ảnh chụp hoặc Word) thì mới kích hoạt được. Lưu nháp thì chưa bắt buộc.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 5 · Hiệu lực ────────────────────────────────────────────────────────────

export function BuocHieuLuc({ form, dat, loi, hangRao }: PropsBuoc & { hangRao: KetQuaKiemHangRao | null }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Truong
          truong="hieuLucTu"
          nhan="Có hiệu lực từ ngày"
          batBuoc
          loi={loi("hieuLucTu")}
          goiY={
            hangRao?.somNhat
              ? `Máy chủ tính: sớm nhất ${ngayDMY(hangRao.somNhat)} (công bố + 15 ngày làm việc, trừ ngày nghỉ lễ).`
              : "Phải sau ngày công bố ít nhất 15 ngày làm việc. Lưu nháp để biết ngày sớm nhất hợp lệ."
          }
        >
          {(p) => <input {...p} type="date" value={form.hieuLucTu} onChange={(e) => dat({ hieuLucTu: e.target.value })} className={O_NHAP} />}
        </Truong>
        <Truong truong="hieuLucDen" nhan="Áp dụng đến hết ngày" loi={loi("hieuLucDen")} goiY="Để trống nếu chưa có ngày kết thúc. Khoản thu trước mốc hiệu lực vẫn tính theo phiên bản cũ.">
          {(p) => <input {...p} type="date" value={form.hieuLucDen} onChange={(e) => dat({ hieuLucDen: e.target.value })} className={O_NHAP} />}
        </Truong>
      </div>
      <Truong truong="lyDo" nhan="Lý do / căn cứ của phiên bản này" batBuoc loi={loi("lyDo")} goiY="Ghi vào nhật ký thay đổi: vì sao có phiên bản này (số quyết định, người đề xuất).">
        {(p) => <Textarea {...p} value={form.lyDo} onChange={(e) => dat({ lyDo: e.target.value })} rows={3} />}
      </Truong>
    </div>
  );
}

// ── 6 · Thử tính ────────────────────────────────────────────────────────────


export function BuocThuTinh({ form, dl }: PropsBuoc) {
  const [coSo, setCoSo] = useState<number | null>(10_000_000);
  const ten = (code: string) => dl.vai.find((v) => v.code === code)?.name ?? code;
  const ket = coSo !== null && coSo > 0 ? viDuTinh(form, coSo, dl.tran) : [];
  return (
    <div className="grid gap-6">
      <section aria-labelledby="vi-du">
        <h3 id="vi-du" className="text-sm font-semibold text-foreground">
          Tính ví dụ trên một khoản thu
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Nhập một khoản thực thu (sau VAT) để xem các tỉ lệ vừa soạn cho ra bao nhiêu tiền. Đây là phép nhân theo số bạn nhập, không phải dữ liệu thật.</p>
        <div className="mt-3 max-w-xs">
          <label htmlFor="vi-du-co-so" className="mb-1 block text-sm font-semibold text-foreground">
            Thực thu ví dụ
          </label>
          <MoneyInput id="vi-du-co-so" name="vi-du-co-so" value={coSo} onValueChange={setCoSo} min={1} className="h-9" />
        </div>
        {ket.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Chưa có tỉ lệ hợp lệ để tính — nhập ở bước Cách tính.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {ket.map((k) => (
              <div key={k.loai} className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[24rem] border-collapse text-left">
                  <caption className="border-b border-border bg-muted/40 px-3 py-2 text-left text-sm font-semibold text-foreground">{NHAN_LOAI_GD[k.loai as LoaiGdSoan] ?? k.loai}</caption>
                  <tbody>
                    {k.vai.map((v) => (
                      <tr key={v.code} className="border-b border-border/60 last:border-0">
                        <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-sm font-normal text-foreground">
                          {ten(v.code)}
                        </th>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-foreground">{v.loaiTru ? <span className="text-muted-foreground">Không trả</span> : dinhDangDong(v.tien)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/40">
                      <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-foreground">
                        Tổng ({k.tongPhanTram}%)
                      </th>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">{dinhDangDong(k.tongTien)}</td>
                    </tr>
                    {k.vuotTran === true && dl.tran !== null && (
                      <tr>
                        <td colSpan={2} className="px-3 py-2 text-sm font-medium text-state-danger-ink">
                          Tổng {k.tongPhanTram}% vượt trần {dinhDangPhanTram(dl.tran)}% — chính sách này sẽ bị chặn khi kích hoạt.
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

