-- 🟢14 仕訳承認フロー: approval_status カラム追加
alter table journal_entries
  add column if not exists approval_status text
    check (approval_status in ('draft', 'pending', 'approved', 'rejected'))
    default 'approved';

-- 既存行は approved 扱い
update journal_entries set approval_status = 'approved' where approval_status is null;

create index if not exists journal_entries_approval_status_idx on journal_entries (approval_status);

-- 🟢15 変更履歴・監査証跡
create table if not exists journal_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null,
  client_id uuid,
  action text not null check (action in ('created', 'updated', 'deleted')),
  before_data jsonb,
  after_data jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists audit_logs_entry_id_idx on journal_audit_logs (entry_id, changed_at desc);
create index if not exists audit_logs_user_id_idx on journal_audit_logs (user_id, changed_at desc);
create index if not exists audit_logs_client_id_idx on journal_audit_logs (client_id, changed_at desc);

-- 🟢16 ユーザーロール・権限管理（顧問先メンバー管理）
create table if not exists client_members (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  member_email text not null,
  role text not null check (role in ('approver', 'entry', 'viewer')) default 'entry',
  invited_at timestamptz not null default now(),
  note text
);

create unique index if not exists client_members_unique_idx
  on client_members (owner_user_id, client_id, member_email);

create index if not exists client_members_owner_idx on client_members (owner_user_id);
create index if not exists client_members_client_idx on client_members (client_id);
