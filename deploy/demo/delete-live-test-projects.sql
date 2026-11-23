-- Deletes the projects the live GitHub tests made on the test deployment (#257, DD-064), with
-- everything that refers to them, in one transaction. The tool itself cannot delete a project.
--
-- A live test project is named `<label> live-YYYY-MM-DD-HH-MM-<4 hex digits>`, after its run
-- (backend/test/live/run.ts). No other project, account, group or repository is touched.
--
-- No foreign key to a project cascades, so the rows that refer to one are found from PostgreSQL's
-- catalog, not from a list kept here: every table with a foreign key to `projects` is purged of
-- the rows that point at a doomed project, and so on down, each table's referring rows before its
-- own. A table added later is covered without a change here. An AI proposal that touches a doomed
-- project is deleted whole first, so that none is left with some of its projects gone.
--
-- Plain SQL with no psql commands, so that the integration test runs it as it is. The workflow
-- runs it with `psql -v ON_ERROR_STOP=1`.

begin;

create temporary table doomed_projects on commit drop as
  select id, name from projects
  where name ~ ' live-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9a-f]{4}$';

-- Kept apart before anything is deleted: a condition must not read a table the purge empties.
create temporary table doomed_proposals on commit drop as
  select distinct proposal_id as id from proposal_projects
  where project_id in (select id from doomed_projects);

-- Deletes the rows of `target` that `condition` picks, after the rows of every table that refer
-- to them. `condition` reads only `target`'s ancestors and the doomed tables, never a table it
-- purges. A foreign key from a table to itself (a task's parent) needs no step of its own: its
-- rows go in the same statement, and a constraint that does not cascade is checked at its end.
create function pg_temp.purge(target regclass, condition text, depth int default 0)
returns void language plpgsql as $$
declare
  fk record;
begin
  if depth > 20 then
    raise exception 'references nest more than 20 tables deep below %', target;
  end if;
  for fk in
    select c.conrelid::regclass as child, c.conkey, c.confkey, c.conname
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = target and c.conrelid <> target
    order by c.conrelid::regclass::text, c.conname
  loop
    if cardinality(fk.conkey) <> 1 then
      raise exception 'the foreign key % of % has more than one column', fk.conname, fk.child;
    end if;
    perform pg_temp.purge(
      fk.child,
      format(
        '%I in (select %I from %s where %s)',
        (select attname from pg_attribute where attrelid = fk.child and attnum = fk.conkey[1]),
        (select attname from pg_attribute where attrelid = target and attnum = fk.confkey[1]),
        target,
        condition
      ),
      depth + 1
    );
  end loop;
  execute format('delete from %s where %s', target, condition);
end
$$;

select name as "Deleting the live tests' project" from doomed_projects order by name;

select pg_temp.purge('proposals', 'id in (select id from doomed_proposals)');
select pg_temp.purge('projects', 'id in (select id from doomed_projects)');

select count(*) as "Live test projects deleted" from doomed_projects;

commit;
