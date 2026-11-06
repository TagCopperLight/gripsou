-- Which seeded category a row started as. A rename clears `default_key` (the
-- frontend translates only names the user has not changed) but keeps this.
alter table budget_category add column seed_key text;

update budget_category set seed_key = default_key;

-- A catch-all whose name was already changed, recognised by the hint it
-- was seeded with. One per user at most.
update budget_category c
   set seed_key = 'other_expense'
  from (select distinct on (user_id) id
          from budget_category b
         where b.seed_key is null
           and b.kind = 'expense'
           and b.hint = 'Expenses that fit no other category. Use only when nothing else is a reasonable match.'
           and not exists (select 1 from budget_category o
                            where o.user_id = b.user_id and o.seed_key = 'other_expense')
         order by user_id, sort_order, id) r
 where c.id = r.id;

create or replace function seed_budget_categories_trg() returns trigger
language plpgsql as $$
begin
    perform seed_budget_categories(new.id);
    update budget_category set seed_key = default_key where user_id = new.id;
    return new;
end
$$;
