-- catalogue-check
select cron.schedule('catalogue-check', '* * * * *', $job$select private.catalogue_check_kick()$job$);

-- cover-store-gc
select cron.schedule('cover-store-gc', '30 2 * * 0', $job$select private.cover_gc_weekly()$job$);

-- cover-store-tick
select cron.schedule('cover-store-tick', '* * * * *', $job$select private.cover_store_tick()$job$);

-- enrich-drain
select cron.schedule('enrich-drain', '*/10 * * * *', $job$select private.enrich_kick()$job$);

-- enrich-refresh
select cron.schedule('enrich-refresh', '20 4 * * *', $job$select public.enrich_refresh(200)$job$);

-- import-job-push
select cron.schedule('import-job-push', '* * * * *', $job$select private.import_push_sweep()$job$);

-- import-job-tick
select cron.schedule('import-job-tick', '* * * * *', $job$select private.import_job_tick()$job$);

-- purge-abandoned-signups
select cron.schedule('purge-abandoned-signups', '0 * * * *', $job$ select public.purge_abandoned_signups() $job$);

-- purge-activity
select cron.schedule('purge-activity', '45 3 * * *', $job$select private.purge_activity()$job$);

-- purge-client-errors
select cron.schedule('purge-client-errors', '45 3 * * *', $job$select private.purge_client_errors()$job$);

-- purge-cron-log
select cron.schedule('purge-cron-log', '15 3 * * *', $job$select private.purge_cron_log()$job$);

-- purge-synced-writes
select cron.schedule('purge-synced-writes', '30 3 * * *', $job$select public.purge_synced_writes()$job$);

-- shelf-publish
select cron.schedule('shelf-publish', '*/5 * * * *', $job$select private.shelf_publish_dispatch()$job$);
