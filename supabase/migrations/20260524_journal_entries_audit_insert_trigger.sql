-- AFTER INSERT 側も audit log を強制記録 (MU🟡 39eb3896)
-- 旧: app/api/journal-entries/route.ts:114 で `void service.from('journal_audit_logs').insert(...)` の silent fail。手動仕訳の作成記録が落ちる
-- 新: AFTER INSERT トリガで全 INSERT 経路 (OCR/depreciation/import/match/manual) を audit
-- 注意: 大量 INSERT 経路を巻き込むため journal_audit_logs が肥大化する。当面は容量・性能を実測する方針
CREATE OR REPLACE FUNCTION public.log_journal_entry_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_changed_keys text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.journal_audit_logs (user_id, entry_id, client_id, action, before_data, after_data)
    VALUES (
      NEW.user_id, NEW.id, NEW.client_id, 'created',
      NULL,
      jsonb_build_object(
        'entry_date',     NEW.entry_date,
        'debit_account',  NEW.debit_account,
        'credit_account', NEW.credit_account,
        'amount',         NEW.amount,
        'description',    NEW.description,
        'tax_category',   NEW.tax_category,
        'vendor_name',    NEW.vendor_name,
        'entry_type',     NEW.entry_type
      )
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key) INTO v_changed_keys
    FROM jsonb_each(to_jsonb(NEW))
    WHERE key NOT IN ('updated_at')
      AND to_jsonb(OLD)->key IS DISTINCT FROM to_jsonb(NEW)->key;

    IF v_changed_keys IS NULL OR array_length(v_changed_keys, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT jsonb_object_agg(key, value) INTO v_before
    FROM jsonb_each(to_jsonb(OLD))
    WHERE key = ANY(v_changed_keys);

    SELECT jsonb_object_agg(key, value) INTO v_after
    FROM jsonb_each(to_jsonb(NEW))
    WHERE key = ANY(v_changed_keys);

    INSERT INTO public.journal_audit_logs (user_id, entry_id, client_id, action, before_data, after_data)
    VALUES (NEW.user_id, NEW.id, NEW.client_id, 'updated', v_before, v_after);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.journal_audit_logs (user_id, entry_id, client_id, action, before_data, after_data)
    VALUES (
      OLD.user_id, OLD.id, OLD.client_id, 'deleted',
      jsonb_build_object(
        'entry_date',     OLD.entry_date,
        'debit_account',  OLD.debit_account,
        'credit_account', OLD.credit_account,
        'amount',         OLD.amount,
        'description',    OLD.description
      ),
      NULL
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entries_audit_insert ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_audit_insert
AFTER INSERT ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.log_journal_entry_changes();
