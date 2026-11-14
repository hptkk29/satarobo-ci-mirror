import { TinTucThe } from '@/components/blog/tin-tuc-the'
import { TrangThaiRong } from '@/components/blog/trang-thai-rong'
import type { TinTucItem } from '@/components/blog/tin-tuc-thuan'
import { Pagination } from './pagination'

// Phần thân dùng chung của trang chuyên mục và trang tag: lưới thẻ bài + phân trang (server).
export function DanhSachPhanTrang({
  posts,
  currentPage,
  totalPages,
  baseHref,
  tieuDeRong,
}: {
  posts: TinTucItem[]
  currentPage: number
  totalPages: number
  baseHref: string
  tieuDeRong: string
}) {
  return (
    <section className="sec" style={{ paddingTop: 'clamp(40px,5vw,64px)' }}>
      <div className="wrap">
        {posts.length === 0 ? (
          <TrangThaiRong tieuDe={tieuDeRong}>Ba mẹ quay lại sau nhé!</TrangThaiRong>
        ) : (
          <>
            <div className="g3">
              {posts.map((post) => (
                <TinTucThe key={post.slug} post={post} />
              ))}
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} baseHref={baseHref} />
          </>
        )}
      </div>
    </section>
  )
}
