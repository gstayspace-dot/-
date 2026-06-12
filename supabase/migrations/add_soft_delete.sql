-- 주문/채팅 소프트 삭제(30일 보관) 기능용 마이그레이션
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 삭제 시 실제로 지우지 않고 deleted_at 에 삭제 시각만 기록합니다.
-- 관리자 '보관함'에서 30일간 재확인/복원 가능하며, 30일 경과분은 자동 영구삭제됩니다.

alter table public.orders          add column if not exists deleted_at timestamptz;
alter table public.chat_customers  add column if not exists deleted_at timestamptz;

-- 활성 목록 조회 성능을 위한 부분 인덱스(선택 사항)
create index if not exists orders_deleted_at_idx         on public.orders (deleted_at);
create index if not exists chat_customers_deleted_at_idx on public.chat_customers (deleted_at);
