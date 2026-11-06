alter table time_entries
drop constraint if exists time_entries_minutes_check;

alter table time_entries
    add constraint time_entries_minutes_check
        check (
            minutes > 0
                and minutes <= 24 * 60
                and minutes % 15 = 0
    );
