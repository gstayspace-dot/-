-- 상품 노출 순서 관리 기능용 마이그레이션
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 관리자 상품관리 화면의 ▲▼ 버튼으로 정한 순서를 sort_order 에 저장하고,
-- 전체상품/메인 페이지가 이 순서대로 상품을 노출합니다.

-- 1) 노출 순서 컬럼 추가
alter table public.products add column if not exists sort_order integer;

-- 2) 기존 상품에 현재 노출 순서(최신 등록순) 그대로 번호 부여
with ranked as (
  select id, row_number() over (order by created_at desc) as rn from public.products
)
update public.products p set sort_order = ranked.rn
from ranked where p.id = ranked.id;

-- 3) 정렬 조회 성능을 위한 인덱스(선택 사항)
create index if not exists products_sort_order_idx on public.products (sort_order);
