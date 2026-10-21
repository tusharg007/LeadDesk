-- Run once in a fresh Supabase project. All user writes go through checked RPCs,
-- except lead creation (which is protected by INSERT RLS).
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100)
);
create table public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  role text not null check (role in ('admin','sales')),
  display_name text not null
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  owner_id uuid not null references public.memberships(user_id),
  company text not null check (length(company) between 2 and 100),
  contact text not null check (length(contact) between 2 and 100),
  email text not null,
  value integer not null default 0 check (value between 0 and 100000000),
  source text not null check (source in ('Website','Referral','LinkedIn','Other')),
  inquiry text not null check (length(inquiry) between 15 and 6000),
  stage text not null default 'New' check (stage in ('New','Qualified','Contacted','Proposal','Won','Lost')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id, workspace_id)
);
create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  title text not null, content text not null, keywords text[] not null default '{}'
);
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  lead_id uuid not null, lead_revision integer not null,
  status text not null default 'running' check (status in ('running','awaiting_review','approved','rejected','failed')),
  mode text not null check (mode in ('demo','n8n')),
  recommendation jsonb, error text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  foreign key (lead_id,workspace_id) references public.leads(id,workspace_id) on delete cascade,
  unique(id,workspace_id)
);
create unique index one_pending_qualification on public.agent_runs(lead_id,lead_revision) where status in ('running','awaiting_review');
create table public.tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, lead_id uuid not null,
  title text not null check (length(title) between 5 and 160), draft text not null default '',
  due_at timestamptz not null, completed_at timestamptz,
  source_run_id uuid unique,
  foreign key (lead_id,workspace_id) references public.leads(id,workspace_id) on delete cascade,
  foreign key (source_run_id,workspace_id) references public.agent_runs(id,workspace_id)
);
create table public.activities (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, lead_id uuid not null,
  message text not null check (length(message) between 1 and 2000), created_at timestamptz not null default now(),
  foreign key (lead_id,workspace_id) references public.leads(id,workspace_id) on delete cascade
);
create index leads_workspace_stage on public.leads(workspace_id,stage,created_at desc);
create index tasks_due on public.tasks(workspace_id,due_at) where completed_at is null;
create index activities_lead on public.activities(lead_id,created_at desc);
create index runs_workspace on public.agent_runs(workspace_id,created_at desc);

create function public.can_access_lead(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.leads l join public.memberships m on m.workspace_id=l.workspace_id
    where l.id=p_id and m.user_id=auth.uid() and (m.role='admin' or l.owner_id=auth.uid()));
$$;

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.leads enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.agent_runs enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;
revoke all on public.workspaces,public.memberships,public.leads,public.knowledge_entries,public.agent_runs,public.tasks,public.activities from anon,authenticated;
grant select on public.workspaces,public.memberships,public.leads,public.knowledge_entries,public.agent_runs,public.tasks,public.activities to authenticated;
grant insert(company,contact,email,value,source,inquiry,workspace_id,owner_id) on public.leads to authenticated;
grant all on public.workspaces,public.memberships,public.leads,public.knowledge_entries,public.agent_runs,public.tasks,public.activities to service_role;

create policy own_membership on public.memberships for select to authenticated using (user_id=auth.uid());
create policy own_workspace on public.workspaces for select to authenticated using (id in (select workspace_id from public.memberships where user_id=auth.uid()));
create policy read_leads on public.leads for select to authenticated using (public.can_access_lead(id));
create policy insert_leads on public.leads for insert to authenticated with check (owner_id=auth.uid() and workspace_id in (select workspace_id from public.memberships where user_id=auth.uid()));
create policy read_knowledge on public.knowledge_entries for select to authenticated using (workspace_id in (select workspace_id from public.memberships where user_id=auth.uid()));
create policy read_runs on public.agent_runs for select to authenticated using (public.can_access_lead(lead_id));
create policy read_tasks on public.tasks for select to authenticated using (public.can_access_lead(lead_id));
create policy read_activities on public.activities for select to authenticated using (public.can_access_lead(lead_id));

create function public.on_lead_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.memberships where user_id=new.owner_id and workspace_id=new.workspace_id) then raise exception 'Invalid lead owner' using errcode='42501'; end if;
  insert into public.activities(workspace_id,lead_id,message) values(new.workspace_id,new.id,'Lead added to the workspace.');
  return new;
end $$;
create trigger lead_created after insert on public.leads for each row execute function public.on_lead_created();

create function public.update_lead_stage(p_id uuid,p_stage text,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
  if not public.can_access_lead(p_id) then raise exception 'Lead not found'; end if;
  select * into l from public.leads where id=p_id for update;
  if l.revision<>p_revision then raise exception 'This lead changed. Refresh and try again.'; end if;
  if l.stage=p_stage then return; end if;
  update public.leads set stage=p_stage,revision=revision+1,updated_at=now() where id=p_id;
  insert into public.activities(workspace_id,lead_id,message) values(l.workspace_id,p_id,'Stage changed from '||l.stage||' to '||p_stage||'.');
end $$;
create function public.add_lead_note(p_id uuid,p_message text) returns void language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
  if not public.can_access_lead(p_id) then raise exception 'Lead not found'; end if;
  select * into l from public.leads where id=p_id for update;
  insert into public.activities(workspace_id,lead_id,message) values(l.workspace_id,p_id,p_message);
  update public.leads set revision=revision+1,updated_at=now() where id=p_id;
end $$;
create function public.set_task_complete(p_id uuid,p_complete boolean) returns void language plpgsql security definer set search_path='' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id=p_id for update;
  if not found or not public.can_access_lead(t.lead_id) then raise exception 'Task not found'; end if;
  if (t.completed_at is not null)=p_complete then return; end if;
  update public.tasks set completed_at=case when p_complete then now() else null end where id=p_id;
  insert into public.activities(workspace_id,lead_id,message) values(t.workspace_id,t.lead_id,case when p_complete then 'Completed task: ' else 'Reopened task: ' end||t.title);
end $$;
create function public.create_qualification(p_lead_id uuid,p_mode text) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leads; r public.agent_runs;
begin
  if not public.can_access_lead(p_lead_id) then raise exception 'Lead not found'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  if l.stage in ('Won','Lost') then raise exception 'Reopen this lead before qualifying it.'; end if;
  if exists(select 1 from public.agent_runs where lead_id=p_lead_id and status='running') then raise exception 'A qualification is running' using errcode='23505'; end if;
  insert into public.agent_runs(workspace_id,lead_id,lead_revision,mode) values(l.workspace_id,l.id,l.revision,p_mode) returning * into r;
  return to_jsonb(r);
end $$;
create function public.finish_qualification(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.agent_runs; l public.leads; e jsonb; source_text text;
begin
  select * into r from public.agent_runs where id=p_id for update;
  if not found then raise exception 'Run not found'; end if;
  if r.status<>'running' then return; end if;
  select * into l from public.leads where id=r.lead_id for update;
  if l.revision<>r.lead_revision then raise exception 'Lead changed during qualification.'; end if;
  if jsonb_typeof(p_result->'evidence')<>'array' or jsonb_array_length(p_result->'evidence')<1 then raise exception 'Evidence is required'; end if;
  for e in select * from jsonb_array_elements(p_result->'evidence') loop
    source_text := null;
    if e->>'source_id'='inquiry' then source_text:=l.inquiry;
    else select content into source_text from public.knowledge_entries where id::text=e->>'source_id' and workspace_id=r.workspace_id;
    end if;
    if source_text is null or coalesce(length(e->>'quote'),0)<5 or position((e->>'quote') in source_text)=0 then raise exception 'Invalid evidence'; end if;
  end loop;
  update public.agent_runs set status='awaiting_review',recommendation=p_result,completed_at=now() where id=p_id;
end $$;
create function public.decide_qualification(p_id uuid,p_decision text,p_title text default null,p_draft text default null) returns void language plpgsql security definer set search_path='' as $$
declare r public.agent_runs; l public.leads; task_title text; task_draft text;
begin
  select * into r from public.agent_runs where id=p_id for update;
  if not found or not public.can_access_lead(r.lead_id) then raise exception 'Review not found'; end if;
  if (r.status='approved' and p_decision='approve') or (r.status='rejected' and p_decision='reject') then return; end if;
  if r.status<>'awaiting_review' then raise exception 'This review has already been resolved.'; end if;
  select * into l from public.leads where id=r.lead_id for update;
  if p_decision='reject' then
    update public.agent_runs set status='rejected' where id=p_id;
    insert into public.activities(workspace_id,lead_id,message) values(r.workspace_id,r.lead_id,'Qualification suggestion dismissed.');
    return;
  end if;
  if p_decision<>'approve' then raise exception 'Invalid decision'; end if;
  if l.revision<>r.lead_revision then raise exception 'This lead changed after qualification. Dismiss the suggestion and run it again.'; end if;
  task_title:=coalesce(p_title,r.recommendation->>'task_title');
  task_draft:=coalesce(p_draft,r.recommendation->>'draft');
  if length(task_draft) not between 10 and 3000 or task_draft is null then raise exception 'Invalid draft'; end if;
  insert into public.tasks(workspace_id,lead_id,title,draft,due_at,source_run_id)
    values(r.workspace_id,r.lead_id,task_title,task_draft,now()+interval '1 day',p_id) on conflict(source_run_id) do nothing;
  update public.agent_runs set status='approved' where id=p_id;
  insert into public.activities(workspace_id,lead_id,message) values(r.workspace_id,r.lead_id,'Approved qualification and created a follow-up task.');
end $$;

revoke all on function public.can_access_lead(uuid),public.on_lead_created(),public.update_lead_stage(uuid,text,integer),public.add_lead_note(uuid,text),public.set_task_complete(uuid,boolean),public.create_qualification(uuid,text),public.finish_qualification(uuid,jsonb),public.decide_qualification(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.can_access_lead(uuid),public.update_lead_stage(uuid,text,integer),public.add_lead_note(uuid,text),public.set_task_complete(uuid,boolean),public.create_qualification(uuid,text),public.decide_qualification(uuid,text,text,text) to authenticated;
grant execute on function public.finish_qualification(uuid,jsonb) to service_role;
