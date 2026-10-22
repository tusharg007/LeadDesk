-- Apply after 001_crm.sql. Existing decisions remain explicitly unaudited;
-- historical reviewers are never inferred or backfilled.
alter table public.agent_runs add column review_audit jsonb;

alter function public.decide_qualification(uuid,text,text,text) rename to apply_qualification_decision;
revoke all on function public.apply_qualification_decision(uuid,text,text,text) from public,anon,authenticated,service_role;

create function public.decide_qualification(p_id uuid,p_decision text,p_reason text,p_title text default null,p_draft text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.agent_runs; l public.leads; reviewer text;
begin
  select * into r from public.agent_runs where id=p_id for update;
  if not found or not public.can_access_lead(r.lead_id) then raise exception 'Review not found'; end if;
  if p_decision is null or p_decision not in ('approve','reject') then
    raise exception 'Invalid decision' using errcode='22023';
  end if;
  -- Retrying cannot replace the original reviewer, note, or approved text.
  if (r.status='approved' and p_decision='approve') or (r.status='rejected' and p_decision='reject') then return; end if;
  if p_reason is null or length(trim(p_reason)) not between 10 and 1000 then
    raise exception 'A decision note between 10 and 1000 characters is required' using errcode='22023';
  end if;
  select * into l from public.leads where id=r.lead_id for update;
  select display_name into reviewer from public.memberships where user_id=auth.uid();
  perform public.apply_qualification_decision(p_id,p_decision,p_title,p_draft);
  update public.agent_runs set review_audit=jsonb_build_object(
    'reviewer_id',auth.uid(), 'reviewer_name',reviewer, 'reviewed_at',now(),
    'reason',trim(p_reason), 'decision',p_decision, 'lead_company',l.company,
    'lead_revision',r.lead_revision,
    'approved_task_title',case when p_decision='approve' then coalesce(p_title,r.recommendation->>'task_title') else null end,
    'approved_draft',case when p_decision='approve' then coalesce(p_draft,r.recommendation->>'draft') else null end
  ) where id=p_id;
end $$;
revoke all on function public.decide_qualification(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.decide_qualification(uuid,text,text,text,text) to authenticated;
