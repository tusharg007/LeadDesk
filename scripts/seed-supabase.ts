import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { seed } from '../server/seed.js';

const email = process.env.SEED_USER_EMAIL;
if (!email || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Set SEED_USER_EMAIL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY in .env.');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) throw new Error('Could not list users. Check Supabase credentials.');
const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) throw new Error('Create this user in Supabase Authentication first, then rerun.');
const { data: existing, error: lookupError } = await db
  .from('memberships')
  .select('workspace_id')
  .eq('user_id', user.id)
  .maybeSingle();
if (lookupError) throw new Error('Apply the SQL migration before seeding.');
if (existing)
  throw new Error('This account already belongs to a workspace. Seed will not overwrite it.');
const { data: workspace, error: workspaceError } = await db
  .from('workspaces')
  .insert({ name: 'Studio North' })
  .select()
  .single();
if (workspaceError) throw new Error(workspaceError.message);
const { error: membershipError } = await db
  .from('memberships')
  .insert({
    user_id: user.id,
    workspace_id: workspace.id,
    role: 'admin',
    display_name: 'Alex Morgan',
  });
if (membershipError) throw new Error(membershipError.message);
const sample = seed();
const { error: knowledgeError } = await db
  .from('knowledge_entries')
  .insert(
    sample.knowledge.map(({ id: _id, ...entry }) => ({ ...entry, workspace_id: workspace.id })),
  );
if (knowledgeError) throw new Error(knowledgeError.message);
const { error: leadsError } = await db
  .from('leads')
  .insert(
    sample.leads.map(({ id: _id, ...lead }) => ({
      ...lead,
      workspace_id: workspace.id,
      owner_id: user.id,
    })),
  );
if (leadsError) throw new Error(leadsError.message);
console.log(
  'Workspace created with 8 synthetic leads and 3 knowledge entries. You can now sign in.',
);
