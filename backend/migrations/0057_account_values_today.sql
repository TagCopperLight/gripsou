-- Each account's value today, summed from `holding_day_values`: in the pivot
-- (`value_pivot`), the reader's currency (`value`) and the account's own
-- (`value_native`). A conversion with no rate is NULL. An account with no
-- valued holding has no row.
create function account_values_today(p_user uuid)
returns table (account_id uuid, value_pivot numeric, value numeric, value_native numeric,
               fx_missing boolean)
language sql
stable
as $$
    select v.account_id,
           sum(v.value),
           fx_convert(sum(v.value), 1, v.reporting_rate),
           fx_convert(sum(v.value), 1, v.account_rate),
           bool_or(v.fx_missing)
    from holding_day_values(p_user, array[user_today(p_user)]) v
    group by v.account_id, v.account_rate, v.reporting_rate
$$;
