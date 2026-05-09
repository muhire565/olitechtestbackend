create extension if not exists "pgcrypto";

do $$ begin
  create type user_role as enum ('owner', 'cashier', 'developer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_type as enum ('stock_in', 'sale', 'adjustment', 'void_return');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_status as enum ('completed', 'voided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sold_as_type as enum ('unit', 'package');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('CASH', 'MOMO_CODE', 'PHONE_NUMBER', 'POS');
exception when duplicate_object then null; end $$;

do $$ begin
  create type eod_status as enum ('pending', 'approved', 'flagged');
exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique,
  email text unique,
  role user_role not null,
  is_active boolean not null default true,
  is_blocked boolean not null default false,
  blocked_at timestamptz,
  blocked_by uuid references profiles(id),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id bigserial primary key,
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists suppliers (
  id bigserial primary key,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settings (
  id int primary key check (id = 1),
  store_name text not null default 'Supermarket',
  store_address text,
  store_phone text,
  store_logo_url text,
  receipt_footer text default 'Thank you for shopping with us.',
  default_low_stock_threshold int not null default 10,
  accepted_payment_methods text[] not null default array['CASH','MOMO_CODE','PHONE_NUMBER','POS'],
  currency text not null default 'RWF',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

create table if not exists products (
  id bigserial primary key,
  name text not null,
  category_id bigint references categories(id),
  supplier_id bigint references suppliers(id),
  barcode text not null unique,
  buying_price numeric(14,2) not null check (buying_price > 0),
  selling_price numeric(14,2) not null check (selling_price > 0),
  unit_of_measure text not null default 'piece',
  is_weighed boolean not null default false,
  is_package boolean not null default false,
  package_size int check (package_size is null or package_size > 1),
  package_buying_price numeric(14,2),
  package_selling_price numeric(14,2),
  low_stock_threshold numeric(14,3) not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_package = false) or (is_package = true and package_size is not null and package_size > 1 and package_selling_price is not null and package_selling_price > 0))
);

create table if not exists inventory (
  id bigserial primary key,
  product_id bigint not null unique references products(id) on delete cascade,
  quantity_in_stock numeric(14,3) not null default 0,
  last_updated timestamptz not null default now()
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  cashier_id uuid not null references profiles(id),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  discount_amount numeric(14,2) not null default 0,
  status sale_status not null default 'completed',
  void_reason text,
  void_approved_by uuid references profiles(id),
  print_receipt boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sale_items (
  id bigserial primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  product_id bigint not null references products(id),
  sold_as sold_as_type not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price > 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id bigserial primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  method payment_method not null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists stock_movements (
  id bigserial primary key,
  product_id bigint not null references products(id),
  movement_type movement_type not null,
  quantity_change numeric(14,3) not null,
  reference_id text,
  note text,
  performed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table products add column if not exists is_weighed boolean not null default false;
alter table products alter column low_stock_threshold type numeric(14,3) using low_stock_threshold::numeric(14,3);
alter table inventory alter column quantity_in_stock type numeric(14,3) using quantity_in_stock::numeric(14,3);
alter table sale_items alter column quantity type numeric(14,3) using quantity::numeric(14,3);
alter table stock_movements alter column quantity_change type numeric(14,3) using quantity_change::numeric(14,3);

create table if not exists audit_logs (
  id bigserial primary key,
  user_id uuid references profiles(id),
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create table if not exists eod_sessions (
  id bigserial primary key,
  cashier_id uuid not null references profiles(id),
  date date not null,
  opening_balance numeric(14,2) not null default 0,
  expected_cash numeric(14,2) not null default 0,
  counted_cash numeric(14,2) not null default 0,
  discrepancy numeric(14,2) generated always as (counted_cash - expected_cash) stored,
  status eod_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cashier_id, date)
);

create table if not exists expenses (
  id bigserial primary key,
  description text not null,
  category text not null default 'Operations',
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_created_at on sales(created_at);
create index if not exists idx_sales_cashier_created_status on sales(cashier_id, created_at, status);
create index if not exists idx_sale_items_sale_id on sale_items(sale_id);
create index if not exists idx_sale_items_product_id on sale_items(product_id);
create index if not exists idx_payments_created_at on payments(created_at);
create index if not exists idx_payments_sale_method_created on payments(sale_id, method, created_at);
create index if not exists idx_stock_movements_product_id on stock_movements(product_id);
create index if not exists idx_stock_movements_product_created on stock_movements(product_id, created_at);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at);
create index if not exists idx_products_filter on products(category_id, supplier_id, is_active);
create index if not exists idx_inventory_product_id on inventory(product_id);
create index if not exists idx_expenses_date on expenses(expense_date);
create index if not exists idx_expenses_created_by_date on expenses(created_by, expense_date);

alter table profiles disable row level security;
alter table categories disable row level security;
alter table suppliers disable row level security;
alter table settings disable row level security;
alter table products disable row level security;
alter table inventory disable row level security;
alter table sales disable row level security;
alter table sale_items disable row level security;
alter table payments disable row level security;
alter table stock_movements disable row level security;
alter table audit_logs disable row level security;
alter table eod_sessions disable row level security;
alter table expenses disable row level security;

-- =========================================================
-- Bootstrap profiles (replace UUIDs with real auth.users IDs)
-- Steps:
-- 1) Create 3 users in Supabase Authentication UI (owner/cashier/developer)
-- 2) Copy each Auth user UUID
-- 3) Replace placeholder UUIDs below and run this section
-- =========================================================
insert into profiles (id, full_name, role, is_active)
values (
  '5f5a97d5-5d2e-439d-bde2-c143f0a14b22',
  'System Owner',
  'owner',
  true
)
on conflict (id) do update
set
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = excluded.is_active,
  updated_at = now();