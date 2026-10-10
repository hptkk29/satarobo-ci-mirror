// Khung "Lead nguồn" ở cột phải hồ sơ học viên (25/09/2026, chủ dự án chốt D1 + D2).
//
// "Tách theo chủ dữ liệu": các ô PHỄU (nguồn, người nhập, khoá quan tâm, sale, AFF, cơ sở
// của phiếu, lớp tại trung tâm của phiếu…) thuộc phiếu lead ⇒ CHỈ ĐỌC ở đây, kèm link mở
// lead để sửa. Thông tin con + phụ huynh thì sửa trên form hồ sơ bên trái.
//
// Dữ liệu đến từ `docLeadNguon` (`lib/students/lead-nguon.ts`): đã qua cách ly cơ sở +
// `canSeeLead` + che PII theo quyền người xem. Khung này KHÔNG tự đọc lead.
//
// Ba trạng thái, ba cách nói — không trạng thái nào là khung trống câm:
//   · CO_LEAD        — bảng ô chỉ đọc + "Mở lead" + (được sửa) Đổi lead / Gỡ liên kết;
//   · KHONG_DUOC_XEM — nói "CÓ lead nguồn" + vì sao không xem được + hỏi ai. KHÔNG link
//                      (link tới trang sẽ đá mình về là lời hứa suông — luật 12);
//   · CHUA_NOI       — giải thích vì sao trống + gợi ý + ô tìm để gắn ngay tại chỗ.

import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { formatDateTimeVNZoned } from "@/lib/format/date";
import type { LeadNguonChiTiet, LeadNguonKetQua } from "@/lib/students/lead-nguon-types";
import { cn } from "@/lib/utils";
import { BoChonLead, NutMoChonLead } from "./chon-lead";
import { NutGoLienKet } from "./go-lien-ket";
import { NUT_CHU } from "./o-nhap";

const VO = "@container rounded-xl border border-border bg-card shadow-sm";
const DAU = "flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3";

function Hang({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 @xs:grid-cols-[8.5rem_minmax(0,1fr)] @xs:gap-3">
      <dt className="text-xs text-muted-foreground @xs:pt-0.5">{nhan}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function giaTri(v: string | null | undefined): string {
  return v && v.trim() ? v : "—";
}

function BangLead({ lead }: { lead: LeadNguonChiTiet }) {
  return (
    <dl className="space-y-2.5">
      <Hang nhan="Nguồn lead">{giaTri(lead.nguon)}</Hang>
      {lead.hienNguoiNhap && <Hang nhan="Người nhập lead">{giaTri(lead.nguoiNhap)}</Hang>}
      <Hang nhan="Khoá quan tâm">{giaTri(lead.khoaQuanTam)}</Hang>
      <Hang nhan="Ngày nhận lead">
        <span className="tabular-nums">{formatDateTimeVNZoned(lead.ngayNhanLead)}</span>
      </Hang>
      <Hang nhan="Tương tác gần nhất">
        {lead.tuongTacGanNhat ? (
          <span className="tabular-nums">{formatDateTimeVNZoned(lead.tuongTacGanNhat)}</span>
        ) : (
          <span className="text-muted-foreground">Chưa có lần chạm nào</span>
        )}
      </Hang>
      <Hang nhan="Sale phụ trách">{giaTri(lead.salePhuTrach)}</Hang>
      <Hang nhan="Cơ sở (lead)">{giaTri(lead.coSo)}</Hang>
      <Hang nhan="Người giới thiệu (AFF)">{giaTri(lead.nguoiGioiThieu)}</Hang>
      {lead.con && <Hang nhan="Con trong phiếu">{lead.con.ten}</Hang>}
      <Hang nhan="Lớp tại trung tâm">{giaTri(lead.con?.lopTaiTrungTam)}</Hang>
      <Hang nhan="Ghi chú lead">
        {lead.ghiChu ? (
          <span className="line-clamp-6 whitespace-pre-wrap">{lead.ghiChu}</span>
        ) : (
          "—"
        )}
      </Hang>
    </dl>
  );
}

export function KhungLeadNguon({
  ketQua,
  studentId,
  tenHocVien,
}: {
  ketQua: LeadNguonKetQua;
  studentId: string;
  tenHocVien: string;
}) {
  if (ketQua.kind === "CO_LEAD") {
    const { lead, coTheSua } = ketQua;
    return (
      <section aria-labelledby="khung-lead-nguon" className={VO}>
        <div className={DAU}>
          <h2 id="khung-lead-nguon" className="text-sm font-semibold text-foreground">
            Lead nguồn
          </h2>
          <Link
            href={lead.href}
            className={cn(NUT_CHU, "border border-border text-foreground hover:bg-muted")}
          >
            Mở lead <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <div className="space-y-4 p-4">
          <div className="space-y-1">
            <p className="break-words text-sm font-semibold text-foreground">{lead.tenPhuHuynh}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {lead.sdt && <span className="tabular-nums">{lead.sdt}</span>}
              <StatusPill tone="muted">{lead.trangThai}</StatusPill>
            </div>
          </div>
          <BangLead lead={lead} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Các ô trên thuộc phiếu lead — muốn sửa thì mở lead. Thông tin con và phụ huynh sửa
            ở hồ sơ bên cạnh hay ở phiếu lead đều được: hai bên tự đồng bộ.
          </p>
        </div>
        {coTheSua && (
          <div className="flex flex-wrap items-start gap-2 border-t border-border px-4 py-2.5">
            <NutMoChonLead
              studentId={studentId}
              tenHocVien={tenHocVien}
              goiY={[]}
              leadDangNoiId={lead.leadId}
              conDangNoiId={lead.con?.id ?? null}
              nhan="Đổi lead"
              className={cn(NUT_CHU, "text-foreground hover:bg-muted")}
            />
            <NutGoLienKet studentId={studentId} />
          </div>
        )}
      </section>
    );
  }

  if (ketQua.kind === "KHONG_DUOC_XEM") {
    return (
      <section aria-labelledby="khung-lead-nguon" className={VO}>
        <div className={DAU}>
          <h2 id="khung-lead-nguon" className="text-sm font-semibold text-foreground">
            Lead nguồn
          </h2>
          <StatusPill tone="muted">Không có quyền xem</StatusPill>
        </div>
        <div className="flex gap-3 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-state-warning-soft text-state-warning-ink">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-semibold text-foreground">Học viên này có lead nguồn</p>
            <p className="leading-relaxed text-muted-foreground">
              {/* Hỏi ĐÚNG người: phiếu ở cơ sở khác thì quản lý cơ sở của mình cũng không xem
                  được (cách ly cơ sở đo theo cơ sở, không theo `leads:view-all`) — chỉ người
                  giữ phiếu ở cơ sở đó hoặc Hội sở mới mở được (DESIGN.md §5). */}
              {ketQua.lyDo === "SALE_KHAC" ? (
                <>
                  Phiếu thuộc Sale khác và chưa được chia sẻ cho bạn. Cần xem nguồn, sale phụ
                  trách hay lịch sử tư vấn thì nhờ quản lý cơ sở (quyền{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                    leads:view-all
                  </code>
                  ).
                </>
              ) : (
                <>
                  Phiếu đang nằm ở cơ sở khác — quản lý cơ sở của bạn cũng không mở được. Cần
                  xem thì nhờ quản lý cơ sở đang giữ phiếu, hoặc Hội sở (vai xem được mọi cơ sở).
                </>
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="khung-lead-nguon" className={VO}>
      <div className={DAU}>
        <h2 id="khung-lead-nguon" className="text-sm font-semibold text-foreground">
          Lead nguồn
        </h2>
        <StatusPill tone="muted">Chưa nối</StatusPill>
      </div>
      <div className="space-y-4 p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Học viên này chưa được nối với phiếu lead nào — thường là học viên nhập tay hoặc
          import từ Excel. Nối để thấy nguồn, sale phụ trách và lịch sử tư vấn; ô còn trống trên
          hồ sơ sẽ lấy thêm từ phiếu.
        </p>
        {ketQua.coTheGan ? (
          <BoChonLead studentId={studentId} tenHocVien={tenHocVien} goiY={ketQua.goiY} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Gắn lead cần quyền{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              students:edit
            </code>{" "}
            — nhờ quản lý cơ sở.
          </p>
        )}
      </div>
    </section>
  );
}
