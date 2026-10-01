-- Run this whole file in Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null default current_date,
  created_at timestamptz default now()
);
create table phases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  position int not null,
  name text not null,
  days_label text,
  subtitle text
);
create table groups (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references phases(id) on delete cascade,
  position int not null,
  title text not null
);
create table deliverables (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  position int not null default 0,
  title text not null,
  owner text,                       -- initials, e.g. MJ
  status text not null default 'todo' check (status in ('todo','in_progress','done','blocked')),
  evidence text,                    -- e.g. "128 pages reviewed"
  due_date date,
  blocker text                      -- why it is blocked
);

-- Only signed-in users (your team) can read/write.
alter table clients enable row level security;
alter table phases enable row level security;
alter table groups enable row level security;
alter table deliverables enable row level security;
create policy team_all on clients for all to authenticated using (true) with check (true);
create policy team_all on phases for all to authenticated using (true) with check (true);
create policy team_all on groups for all to authenticated using (true) with check (true);
create policy team_all on deliverables for all to authenticated using (true) with check (true);

-- The 90-day template. Edit the JSON below to change what every new client starts with.
create or replace function create_client_from_template(p_name text, p_start date)
returns uuid language plpgsql as $fn$
declare
  tpl jsonb := $tpl$[
   {"name":"The reset","days":"Days 1–30","sub":"Complete the foundations before launching the first sprint.","groups":[
    {"t":"Audit the current position","items":["Audit the current SEO strategy","Complete the technical SEO audit","Review the content library","Audit AEO and current LLM brand descriptions"]},
    {"t":"Set the revenue baseline","items":["Agree conversion goals and capture baseline","Map core BOFU keywords","Set up keyword and prompt tracking","Verify conversion tracking"]},
    {"t":"Build the strategy and get buy-in","items":["Build the BOFU content and money-page link plan","Create the brand entity map and positioning SOP","Define the LLM messaging gap plan","Find missing listicle and Reddit mentions","Reverse-engineer competitor winners","Finalise the 90-day strategy and roadmap","Present the strategy and record client approval"]}]},
   {"name":"Roll out fast","days":"Days 31–60","sub":"Fix what matters, then start the revenue engine.","groups":[
    {"t":"Fix and clean up","items":["Fix 100% of technical issues that matter","Cut underperforming pages and clean up content"]},
    {"t":"Growth sprints","items":["Sprint: add 10 internal links to high-intent pages","Sprint: optimise 10 product pages for high-intent keywords","Publish 5 new pages or 10 content updates","Build 20 backlinks to money pages"]},
    {"t":"Mentions and consistency","items":["Email outreach for best-X listicle mentions","Update social and directory listings with uniform messaging","Remove causes of LLM misinformation","Get client feedback on first content"]}]},
   {"name":"Build and iterate","days":"Days 61–90","sub":"Win recommendations and keep the engine running.","groups":[
    {"t":"Win recommendations","items":["Win brand recommendations on third-party sites","Keep publishing high-intent content and backlinks","Launch micro-tool pages"]},
    {"t":"Review and report","items":["Review branded AEO and high-intent prompts","Report early wins","Revisit the roadmap with on-the-ground data"]},
    {"t":"Expand reach","items":["Write guest articles for partners","Start the LinkedIn and Reddit plan","Set the monthly routine: content, links, mentions, sprints"]}]}
  ]$tpl$::jsonb;
  cid uuid; pid uuid; gid uuid; ph jsonb; gr jsonb; it text; pn int := 0; gn int; inn int;
begin
  insert into clients(name, start_date) values (p_name, p_start) returning id into cid;
  for ph in select * from jsonb_array_elements(tpl) loop
    pn := pn + 1;
    insert into phases(client_id, position, name, days_label, subtitle)
      values (cid, pn, ph->>'name', ph->>'days', ph->>'sub') returning id into pid;
    gn := 0;
    for gr in select * from jsonb_array_elements(ph->'groups') loop
      gn := gn + 1;
      insert into groups(phase_id, position, title) values (pid, gn, gr->>'t') returning id into gid;
      inn := 0;
      for it in select jsonb_array_elements_text(gr->'items') loop
        inn := inn + 1;
        insert into deliverables(group_id, position, title) values (gid, inn, it);
      end loop;
    end loop;
  end loop;
  return cid;
end $fn$;
