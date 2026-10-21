import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Postgres migration enforces RLS, protects RPCs, and commits approval exactly once', async () => {
  const db = new PGlite();
  const admin = '11111111-1111-4111-8111-111111111111';
  const sales = '11111111-1111-4111-8111-111111111112';
  const outsider = '11111111-1111-4111-8111-111111111113';
  const ws = '22222222-2222-4222-8222-222222222222';
  const ws2 = '22222222-2222-4222-8222-222222222223';
  const lead = '33333333-3333-4333-8333-333333333333';
  const inquiry = 'We need a website for our design agency and want to launch next month.';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to authenticated,service_role;`);
    await db.exec(
      await readFile(new URL('../supabase/migrations/001_crm.sql', import.meta.url), 'utf8'),
    );
    await db.exec(`insert into auth.users values('${admin}'),('${sales}'),('${outsider}');
      insert into public.workspaces(id,name) values('${ws}','Test studio'),('${ws2}','Other studio');
      insert into public.memberships values('${admin}','${ws}','admin','Admin'),('${sales}','${ws}','sales','Sales'),('${outsider}','${ws2}','admin','Other');
      insert into public.leads(id,workspace_id,owner_id,company,contact,email,source,inquiry) values('${lead}','${ws}','${admin}','Test Studio','Maya Patel','maya@example.com','Website','${inquiry}');`);
    const asUser = async (id: string) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.exec('set role authenticated');
    };
    await asUser(sales);
    assert.equal((await db.query('select * from public.leads')).rows.length, 0);
    await assert.rejects(
      db.query('select public.create_qualification($1,$2)', [lead, 'n8n']),
      /not found/,
    );
    await asUser(outsider);
    assert.equal((await db.query('select * from public.leads')).rows.length, 0);
    await assert.rejects(
      db.query('select public.update_lead_stage($1,$2,$3)', [lead, 'Qualified', 1]),
      /not found/,
    );
    await asUser(admin);
    assert.equal((await db.query('select * from public.leads')).rows.length, 1);
    await assert.rejects(
      db.query("update public.leads set stage='Won' where id=$1", [lead]),
      /permission denied/,
    );
    const created = await db.query<{ run: { id: string } }>(
      'select public.create_qualification($1,$2) as run',
      [lead, 'n8n'],
    );
    const run = created.rows[0].run.id;
    await assert.rejects(
      db.query('select public.create_qualification($1,$2)', [lead, 'n8n']),
      /running/,
    );
    const result = {
      summary: 'The inquiry is a website project.',
      fit: 'good_fit',
      missing: [],
      evidence: [{ source_id: 'inquiry', quote: inquiry }],
      task_title: 'Discuss the website requirements',
      draft: 'Hello Maya, can we discuss the goals for your website?',
    };
    await assert.rejects(
      db.query('select public.finish_qualification($1,$2)', [run, JSON.stringify(result)]),
      /permission denied/,
    );
    await db.exec('reset role; set role service_role');
    await db.query('select public.finish_qualification($1,$2)', [run, JSON.stringify(result)]);
    await asUser(admin);
    await db.query('select public.decide_qualification($1,$2)', [run, 'approve']);
    await db.query('select public.decide_qualification($1,$2)', [run, 'approve']);
    assert.equal((await db.query('select * from public.tasks')).rows.length, 1);
    assert.equal(
      (await db.query<{ stage: string }>('select stage from public.leads')).rows[0].stage,
      'New',
    );
    await asUser(outsider);
    assert.equal((await db.query('select * from public.tasks')).rows.length, 0);
    await assert.rejects(
      db.query('select public.decide_qualification($1,$2)', [run, 'approve']),
      /not found/,
    );
    await asUser(admin);
    const next = await db.query<{ run: { id: string } }>(
      'select public.create_qualification($1,$2) as run',
      [lead, 'n8n'],
    );
    await db.exec('reset role; set role service_role');
    await db.query('select public.finish_qualification($1,$2)', [
      next.rows[0].run.id,
      JSON.stringify(result),
    ]);
    await asUser(admin);
    await db.query('select public.add_lead_note($1,$2)', [lead, 'The scope changed today.']);
    await assert.rejects(
      db.query('select public.decide_qualification($1,$2)', [next.rows[0].run.id, 'approve']),
      /changed/,
    );
    assert.equal((await db.query('select * from public.tasks')).rows.length, 1);
  } finally {
    await db.close();
  }
});
