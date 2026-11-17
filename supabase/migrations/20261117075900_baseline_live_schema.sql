-- =====================================================================
-- Baseline: the Manemi schema as it existed in production on 2026-11-17,
-- before friends. Production was built in the dashboard, so it had no
-- migration history; this file recreates it so new databases (Supabase
-- branches, local dev) start from the same point.
--
-- PRODUCTION ALREADY HAS ALL OF THIS. Never run it there. If you link the
-- Supabase CLI to production, mark it as applied instead:
--   supabase migration repair --status applied 20261117075900
-- =====================================================================

-- Extensions --------------------------------------------------------------
create extension if not exists citext with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- Types -------------------------------------------------------------------
create type public.group_role as enum ('admin', 'member', 'owner');
create type public.expense_category as enum ('food', 'transport', 'utilities', 'entertainment', 'shopping', 'other');
create type public.settlement_status as enum ('pending', 'completed', 'cancelled');
create type public.payment_method as enum ('cash', 'gcash', 'bank_transfer');

create sequence public.user_code_seq;

-- Tables ------------------------------------------------------------------
create table public."User" (
  "userId" uuid not null,
  "userCode" character varying default ('U-'::text || lpad((nextval('user_code_seq'::regclass))::text, 5, '0'::text)),
  name character varying not null,
  email citext not null,
  "avatarUrl" character varying
);

create table public."Group" (
  "groupId" uuid default gen_random_uuid() not null,
  "createdBy" uuid not null,
  name character varying not null,
  "inviteCode" character varying(8),
  "inviteCodeExpiresAt" timestamp with time zone,
  "isArchived" boolean default false,
  "createdAt" timestamp with time zone default now()
);

create table public."Group_Member" (
  "memberId" uuid default gen_random_uuid() not null,
  "groupId" uuid not null,
  "userId" uuid not null,
  role group_role default 'member'::group_role not null,
  "joinedAt" timestamp with time zone default now()
);

create table public."Group_Invitation" (
  "invitationId" uuid default gen_random_uuid() not null,
  "groupId" uuid not null,
  "invitedUserId" uuid,
  "invitedEmail" citext not null,
  "invitedBy" uuid not null,
  "createdAt" timestamp with time zone default now()
);

create table public."Expense" (
  "expenseId" uuid default gen_random_uuid() not null,
  "groupId" uuid not null,
  "paidBy_UserId" uuid not null,
  title character varying not null,
  "totalAmount" numeric(10,2) not null,
  "expenseDate" timestamp with time zone default now(),
  category expense_category default 'other'::expense_category not null,
  "receiptUrl" character varying
);

create table public."Expense_Split" (
  "splitId" uuid default gen_random_uuid() not null,
  "expenseId" uuid not null,
  "userId" uuid not null,
  "amountOwed" numeric(10,2) not null,
  percentage numeric(5,2)
);

create table public."Settlement" (
  "settlementId" uuid default gen_random_uuid() not null,
  "groupId" uuid not null,
  "payerId" uuid not null,
  "receiverId" uuid not null,
  amount numeric(10,2) not null,
  status settlement_status default 'completed'::settlement_status not null,
  "paymentMethod" payment_method default 'cash'::payment_method,
  "settledAt" timestamp with time zone default now(),
  "createdAt" timestamp with time zone default now()
);

create table public."Group_Activity" (
  "activityId" uuid default gen_random_uuid() not null,
  "groupId" uuid not null,
  "actorId" uuid,
  action text not null,
  "entityType" text not null,
  "entityId" uuid not null,
  details jsonb default '{}'::jsonb not null,
  "createdAt" timestamp with time zone default now() not null
);

-- Keys and checks ---------------------------------------------------------
alter table public."Expense" add constraint "Expense_pkey" PRIMARY KEY ("expenseId");
alter table public."Expense_Split" add constraint "Expense_Split_pkey" PRIMARY KEY ("splitId");
alter table public."Group" add constraint "Group_pkey" PRIMARY KEY ("groupId");
alter table public."Group_Activity" add constraint "Group_Activity_pkey" PRIMARY KEY ("activityId");
alter table public."Group_Invitation" add constraint "Group_Invitation_pkey" PRIMARY KEY ("invitationId");
alter table public."Group_Member" add constraint "Group_Member_pkey" PRIMARY KEY ("memberId");
alter table public."Settlement" add constraint "Settlement_pkey" PRIMARY KEY ("settlementId");
alter table public."User" add constraint "User_pkey" PRIMARY KEY ("userId");
alter table public."Group_Invitation" add constraint "Group_Invitation_groupId_invitedEmail_key" UNIQUE ("groupId", "invitedEmail");
alter table public."Group_Member" add constraint "Group_Member_groupId_userId_key" UNIQUE ("groupId", "userId");
alter table public."User" add constraint "User_email_key" UNIQUE (email);
alter table public."User" add constraint "User_userCode_key" UNIQUE ("userCode");
alter table public."Expense" add constraint "Expense_totalAmount_check" CHECK (("totalAmount" > (0)::numeric));
alter table public."Expense_Split" add constraint "Expense_Split_amountOwed_check" CHECK (("amountOwed" >= (0)::numeric));
alter table public."Expense_Split" add constraint expense_split_percentage_check CHECK (((percentage IS NULL) OR ((percentage > (0)::numeric) AND (percentage <= (100)::numeric))));
alter table public."Group_Activity" add constraint "Group_Activity_action_check" CHECK ((action = ANY (ARRAY['expense_created'::text, 'expense_updated'::text, 'expense_deleted'::text, 'settlement_recorded'::text, 'settlement_updated'::text, 'settlement_cancelled'::text])));
alter table public."Group_Activity" add constraint "Group_Activity_entityType_check" CHECK (("entityType" = ANY (ARRAY['expense'::text, 'settlement'::text])));
alter table public."Settlement" add constraint "Settlement_amount_check" CHECK ((amount > (0)::numeric));
alter table public."Expense" add constraint "Expense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("groupId") ON DELETE CASCADE;
alter table public."Expense" add constraint "Expense_paidBy_UserId_fkey" FOREIGN KEY ("paidBy_UserId") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."Expense_Split" add constraint "Expense_Split_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("expenseId") ON DELETE CASCADE;
alter table public."Expense_Split" add constraint "Expense_Split_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."Group" add constraint "Group_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."Group_Activity" add constraint "Group_Activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("userId") ON DELETE SET NULL;
alter table public."Group_Activity" add constraint "Group_Activity_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("groupId") ON DELETE CASCADE;
alter table public."Group_Invitation" add constraint "Group_Invitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("groupId") ON DELETE CASCADE;
alter table public."Group_Invitation" add constraint "Group_Invitation_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."Group_Invitation" add constraint "Group_Invitation_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."Group_Member" add constraint "Group_Member_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("groupId") ON DELETE CASCADE;
alter table public."Group_Member" add constraint "Group_Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."Settlement" add constraint "Settlement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("groupId") ON DELETE CASCADE;
alter table public."Settlement" add constraint "Settlement_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."Settlement" add constraint "Settlement_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("userId") ON DELETE CASCADE;
alter table public."User" add constraint "User_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes -----------------------------------------------------------------
CREATE INDEX idx_expense_group ON public."Expense" USING btree ("groupId");
CREATE INDEX idx_group_activity_entity ON public."Group_Activity" USING btree ("entityId");
CREATE INDEX idx_group_activity_group_time ON public."Group_Activity" USING btree ("groupId", "createdAt" DESC);
CREATE INDEX idx_group_invitation_user ON public."Group_Invitation" USING btree ("invitedUserId");
CREATE INDEX idx_group_member_group ON public."Group_Member" USING btree ("groupId");
CREATE INDEX idx_group_member_user ON public."Group_Member" USING btree ("userId");
CREATE INDEX idx_user_code ON public."User" USING btree ("userCode");

-- Functions (copied verbatim from production) -----------------------------
CREATE OR REPLACE FUNCTION public.is_group_member(gid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM "Group_Member"
    WHERE "groupId" = gid AND "userId" = (SELECT auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_group_member(_group_id character varying)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public."Group_Member"
    WHERE "groupId" = _group_id
      AND "userId" = auth.uid()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.shares_group_with(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM "Group_Member" a
    JOIN "Group_Member" b ON b."groupId" = a."groupId"
    WHERE a."userId" = (SELECT auth.uid()) AND b."userId" = other
  );
$function$;

CREATE OR REPLACE FUNCTION public.log_group_activity(p_group_id uuid, p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO "Group_Activity" ("groupId", "actorId", action, "entityType", "entityId", details)
  VALUES (p_group_id, p_actor, p_action, p_entity_type, p_entity_id, COALESCE(p_details, '{}'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.assert_valid_expense(p_group_id uuid, p_paid_by uuid, p_total numeric, p_splits jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bad int;
  v_sum numeric;
BEGIN
  IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
    RAISE EXCEPTION 'INVALID: Select at least one participant';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Group_Member" WHERE "groupId" = p_group_id AND "userId" = p_paid_by) THEN
    RAISE EXCEPTION 'INVALID: The payer must be a member of this group';
  END IF;

  SELECT count(*) INTO v_bad
  FROM jsonb_to_recordset(p_splits) AS s("userId" uuid, amount numeric)
  WHERE NOT EXISTS (
    SELECT 1 FROM "Group_Member" m
    WHERE m."groupId" = p_group_id AND m."userId" = s."userId"
  );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'INVALID: Every participant must be a member of this group';
  END IF;

  SELECT COALESCE(sum(s.amount), 0) INTO v_sum
  FROM jsonb_to_recordset(p_splits) AS s("userId" uuid, amount numeric);
  IF v_sum <> p_total THEN
    RAISE EXCEPTION 'INVALID: Split amounts (%) must equal the total (%)', v_sum, p_total;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.create_expense_with_splits(p_caller uuid, p_group_id uuid, p_paid_by uuid, p_title text, p_total numeric, p_date timestamp with time zone, p_category text, p_receipt_url text, p_splits jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expense "Expense";
  v_splits jsonb;
  v_cat public.expense_category;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Group" WHERE "groupId" = p_group_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: Group not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Group_Member" WHERE "groupId" = p_group_id AND "userId" = p_caller) THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not a member of this group';
  END IF;

  PERFORM assert_valid_expense(p_group_id, p_paid_by, p_total, p_splits);

  BEGIN
    v_cat := COALESCE(NULLIF(trim(p_category), ''), 'other')::public.expense_category;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID: Unknown category "%"', p_category;
  END;

  INSERT INTO "Expense" ("groupId", "paidBy_UserId", title, "totalAmount", "expenseDate", category, "receiptUrl")
  VALUES (p_group_id, p_paid_by, p_title, p_total, p_date, v_cat, p_receipt_url)
  RETURNING * INTO v_expense;

  INSERT INTO "Expense_Split" ("expenseId", "userId", "amountOwed", percentage)
  SELECT v_expense."expenseId", s."userId", s.amount, s.percentage
  FROM jsonb_to_recordset(p_splits) AS s("userId" uuid, amount numeric, percentage numeric);

  SELECT COALESCE(jsonb_agg(to_jsonb(es)), '[]'::jsonb) INTO v_splits
  FROM "Expense_Split" es WHERE es."expenseId" = v_expense."expenseId";

  -- Who entered it (p_caller) can differ from who paid it (p_paid_by)
  PERFORM log_group_activity(
    p_group_id, p_caller, 'expense_created', 'expense', v_expense."expenseId",
    jsonb_build_object(
      'title', v_expense.title,
      'totalAmount', v_expense."totalAmount",
      'category', v_expense.category,
      'paidBy', v_expense."paidBy_UserId"
    )
  );

  RETURN jsonb_build_object('expense', to_jsonb(v_expense), 'splits', v_splits);
END; $function$;

CREATE OR REPLACE FUNCTION public.update_expense_with_splits(p_caller uuid, p_expense_id uuid, p_paid_by uuid, p_title text, p_total numeric, p_date timestamp with time zone, p_category text, p_receipt_url text, p_splits jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expense "Expense";
  v_old "Expense";
  v_role text;
  v_paid_by uuid;
  v_splits jsonb;
  v_old_splits jsonb;
  v_new_splits jsonb;
  v_cat public.expense_category;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_expense FROM "Expense" WHERE "expenseId" = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Expense not found';
  END IF;
  v_old := v_expense;

  SELECT role::text INTO v_role FROM "Group_Member"
  WHERE "groupId" = v_expense."groupId" AND "userId" = p_caller;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not a member of this group';
  END IF;
  IF v_expense."paidBy_UserId" <> p_caller AND v_role NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the payer or a group admin can edit this expense';
  END IF;

  v_paid_by := COALESCE(p_paid_by, v_expense."paidBy_UserId");
  PERFORM assert_valid_expense(v_expense."groupId", v_paid_by, p_total, p_splits);

  IF NULLIF(trim(p_category), '') IS NOT NULL THEN
    BEGIN
      v_cat := trim(p_category)::public.expense_category;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID: Unknown category "%"', p_category;
    END;
  END IF;

  -- The splits as they were before this edit
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'userId', es."userId", 'amountOwed', es."amountOwed", 'percentage', es.percentage
         ) ORDER BY es."userId"), '[]'::jsonb)
  INTO v_old_splits
  FROM "Expense_Split" es WHERE es."expenseId" = p_expense_id;

  UPDATE "Expense" SET
    "paidBy_UserId" = v_paid_by,
    title = p_title,
    "totalAmount" = p_total,
    "expenseDate" = COALESCE(p_date, "expenseDate"),
    category = COALESCE(v_cat, category),
    "receiptUrl" = COALESCE(p_receipt_url, "receiptUrl")
  WHERE "expenseId" = p_expense_id
  RETURNING * INTO v_expense;

  DELETE FROM "Expense_Split" WHERE "expenseId" = p_expense_id;

  INSERT INTO "Expense_Split" ("expenseId", "userId", "amountOwed", percentage)
  SELECT p_expense_id, s."userId", s.amount, s.percentage
  FROM jsonb_to_recordset(p_splits) AS s("userId" uuid, amount numeric, percentage numeric);

  SELECT COALESCE(jsonb_agg(to_jsonb(es)), '[]'::jsonb) INTO v_splits
  FROM "Expense_Split" es WHERE es."expenseId" = p_expense_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'userId', es."userId", 'amountOwed', es."amountOwed", 'percentage', es.percentage
         ) ORDER BY es."userId"), '[]'::jsonb)
  INTO v_new_splits
  FROM "Expense_Split" es WHERE es."expenseId" = p_expense_id;

  -- What actually changed (old value and new value)
  IF v_old.title IS DISTINCT FROM v_expense.title THEN
    v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('from', v_old.title, 'to', v_expense.title));
  END IF;
  IF v_old."totalAmount" IS DISTINCT FROM v_expense."totalAmount" THEN
    v_changes := v_changes || jsonb_build_object('totalAmount', jsonb_build_object('from', v_old."totalAmount", 'to', v_expense."totalAmount"));
  END IF;
  IF v_old.category IS DISTINCT FROM v_expense.category THEN
    v_changes := v_changes || jsonb_build_object('category', jsonb_build_object('from', v_old.category, 'to', v_expense.category));
  END IF;
  IF v_old."paidBy_UserId" IS DISTINCT FROM v_expense."paidBy_UserId" THEN
    v_changes := v_changes || jsonb_build_object('paidBy', jsonb_build_object('from', v_old."paidBy_UserId", 'to', v_expense."paidBy_UserId"));
  END IF;
  IF v_old."expenseDate" IS DISTINCT FROM v_expense."expenseDate" THEN
    v_changes := v_changes || jsonb_build_object('expenseDate', jsonb_build_object('from', v_old."expenseDate", 'to', v_expense."expenseDate"));
  END IF;
  IF v_old."receiptUrl" IS DISTINCT FROM v_expense."receiptUrl" THEN
    v_changes := v_changes || jsonb_build_object('receiptUrl', jsonb_build_object('from', v_old."receiptUrl", 'to', v_expense."receiptUrl"));
  END IF;
  IF v_old_splits IS DISTINCT FROM v_new_splits THEN
    v_changes := v_changes || jsonb_build_object('splits', jsonb_build_object('from', v_old_splits, 'to', v_new_splits));
  END IF;

  -- An edit that changed nothing is not logged
  IF v_changes <> '{}'::jsonb THEN
    PERFORM log_group_activity(
      v_expense."groupId", p_caller, 'expense_updated', 'expense', p_expense_id,
      jsonb_build_object('title', v_expense.title, 'changes', v_changes)
    );
  END IF;

  RETURN jsonb_build_object('expense', to_jsonb(v_expense), 'splits', v_splits);
END; $function$;

CREATE OR REPLACE FUNCTION public.create_group_with_admin(p_caller uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group "Group";
  v_role text;
  v_code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "userId" = p_caller) THEN
    RAISE EXCEPTION 'NOT_FOUND: User profile not found';
  END IF;

  -- 8-character invite code; retried in the (unlikely) case of a collision
  LOOP
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "Group" WHERE lower("inviteCode") = lower(v_code));
  END LOOP;

  INSERT INTO "Group" (name, "createdBy", "inviteCode")
  VALUES (p_name, p_caller, v_code)
  RETURNING * INTO v_group;

  -- Trigger on_group_created_add_owner should have added the creator as a member
  SELECT role::text INTO v_role FROM "Group_Member"
  WHERE "groupId" = v_group."groupId" AND "userId" = p_caller;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Owner membership was not created by trigger on_group_created_add_owner';
  END IF;

  RETURN jsonb_build_object('group', to_jsonb(v_group), 'role', v_role);
END; $function$;

CREATE OR REPLACE FUNCTION public.generate_group_invite_code(p_group_id uuid)
 RETURNS TABLE(invitecode character varying, expiresat timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code VARCHAR(8);
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."Group_Member" WHERE "groupId" = p_group_id AND "userId" = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: You are not a member of this group.';
  END IF;

  v_code := substring(md5(random()::text) from 1 for 8);
  v_expires := now() + INTERVAL '15 minutes';

  UPDATE public."Group"
  SET "inviteCode" = v_code,
      "inviteCodeExpiresAt" = v_expires
  WHERE "groupId" = p_group_id;

  RETURN QUERY SELECT v_code, v_expires;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_balances(p_caller uuid, p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_names text[];
  v_net numeric[];
  v_members jsonb;
  v_plan jsonb := '[]'::jsonb;
  v_pay jsonb;
  v_receive jsonb;
  v_owe numeric;
  v_owed numeric;
  v_my_net numeric;
  v_i int;
  v_j int;
  v_c int;
  v_d int;
  v_cmax numeric;
  v_dmin numeric;
  v_amt numeric;
  v_guard int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Group" WHERE "groupId" = p_group_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: Group not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Group_Member" WHERE "groupId" = p_group_id AND "userId" = p_caller) THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not a member of this group';
  END IF;

  -- 1. Net balance per member: positive = is owed, negative = owes, zero = settled
  WITH t AS (
    SELECT m."userId", u.name,
      COALESCE((SELECT sum(e."totalAmount") FROM "Expense" e
                WHERE e."groupId" = p_group_id AND e."paidBy_UserId" = m."userId"), 0)
      - COALESCE((SELECT sum(es."amountOwed") FROM "Expense_Split" es
                  JOIN "Expense" e ON e."expenseId" = es."expenseId"
                  WHERE e."groupId" = p_group_id AND es."userId" = m."userId"), 0)
      + COALESCE((SELECT sum(s.amount) FROM "Settlement" s
                  WHERE s."groupId" = p_group_id AND s.status = 'completed' AND s."payerId" = m."userId"), 0)
      - COALESCE((SELECT sum(s.amount) FROM "Settlement" s
                  WHERE s."groupId" = p_group_id AND s.status = 'completed' AND s."receiverId" = m."userId"), 0)
      AS net
    FROM "Group_Member" m
    JOIN "User" u ON u."userId" = m."userId"
    WHERE m."groupId" = p_group_id
  )
  SELECT array_agg(t."userId" ORDER BY t.name, t."userId"),
         array_agg(t.name ORDER BY t.name, t."userId"),
         array_agg(t.net ORDER BY t.name, t."userId"),
         COALESCE(jsonb_agg(jsonb_build_object(
           'userId', t."userId",
           'name', t.name,
           'net', t.net,
           'status', CASE WHEN t.net > 0 THEN 'owed' WHEN t.net < 0 THEN 'owes' ELSE 'settled' END
         ) ORDER BY t.name, t."userId"), '[]'::jsonb)
  INTO v_ids, v_names, v_net, v_members
  FROM t;

  -- 2. Simplified payment plan
  IF v_ids IS NOT NULL THEN
    LOOP
      v_guard := v_guard + 1;
      EXIT WHEN v_guard > 1000;

      -- a) A debtor and a creditor whose amounts cancel exactly settle with one payment
      v_c := NULL; v_d := NULL;
      FOR v_i IN 1..array_length(v_net, 1) LOOP
        CONTINUE WHEN v_net[v_i] <= 0;
        FOR v_j IN 1..array_length(v_net, 1) LOOP
          IF v_net[v_j] = -v_net[v_i] THEN
            v_c := v_i; v_d := v_j;
            EXIT;
          END IF;
        END LOOP;
        EXIT WHEN v_c IS NOT NULL;
      END LOOP;

      -- b) Otherwise the biggest debtor pays the biggest creditor
      IF v_c IS NULL THEN
        v_cmax := 0; v_dmin := 0;
        FOR v_i IN 1..array_length(v_net, 1) LOOP
          IF v_net[v_i] > v_cmax THEN v_cmax := v_net[v_i]; v_c := v_i; END IF;
          IF v_net[v_i] < v_dmin THEN v_dmin := v_net[v_i]; v_d := v_i; END IF;
        END LOOP;
      END IF;

      EXIT WHEN v_c IS NULL OR v_d IS NULL;

      v_amt := LEAST(v_net[v_c], -v_net[v_d]);
      v_plan := v_plan || jsonb_build_object(
        'fromUserId', v_ids[v_d], 'fromName', v_names[v_d],
        'toUserId', v_ids[v_c], 'toName', v_names[v_c],
        'amount', v_amt
      );
      v_net[v_c] := v_net[v_c] - v_amt;
      v_net[v_d] := v_net[v_d] + v_amt;
    END LOOP;
  END IF;

  -- 3. The caller's own picture
  SELECT (m->>'net')::numeric INTO v_my_net
  FROM jsonb_array_elements(v_members) m
  WHERE (m->>'userId')::uuid = p_caller;
  v_my_net := COALESCE(v_my_net, 0);

  SELECT COALESCE(jsonb_agg(p ORDER BY (p->>'amount')::numeric DESC), '[]'::jsonb),
         COALESCE(sum((p->>'amount')::numeric), 0)
  INTO v_pay, v_owe
  FROM jsonb_array_elements(v_plan) p
  WHERE (p->>'fromUserId')::uuid = p_caller;

  SELECT COALESCE(jsonb_agg(p ORDER BY (p->>'amount')::numeric DESC), '[]'::jsonb),
         COALESCE(sum((p->>'amount')::numeric), 0)
  INTO v_receive, v_owed
  FROM jsonb_array_elements(v_plan) p
  WHERE (p->>'toUserId')::uuid = p_caller;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'members', v_members,
    'plan', v_plan,
    'debts', v_plan,   -- kept so older clients and tests keep working; same list as plan
    'summary', jsonb_build_object(
      'userId', p_caller,
      'net', v_my_net,
      'status', CASE WHEN v_my_net > 0 THEN 'owed' WHEN v_my_net < 0 THEN 'owes' ELSE 'settled' END,
      'youOwe', v_owe,
      'owedToYou', v_owed,
      'youPay', v_pay,
      'youReceive', v_receive
    )
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.get_my_balances(p_caller uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_bal jsonb;
  v_net numeric;
  v_groups jsonb := '[]'::jsonb;
  v_owe_total numeric := 0;
  v_owed_total numeric := 0;
BEGIN
  FOR r IN
    SELECT g."groupId", g.name, COALESCE(g."isArchived", false) AS archived
    FROM "Group_Member" m
    JOIN "Group" g ON g."groupId" = m."groupId"
    WHERE m."userId" = p_caller
    ORDER BY g.name, g."groupId"
  LOOP
    v_bal := get_group_balances(p_caller, r."groupId");
    v_net := (v_bal->'summary'->>'net')::numeric;

    v_groups := v_groups || jsonb_build_object(
      'groupId', r."groupId",
      'name', r.name,
      'isArchived', r.archived,
      'net', v_net,
      'status', CASE WHEN v_net > 0 THEN 'owed' WHEN v_net < 0 THEN 'owes' ELSE 'settled' END
    );

    IF v_net < 0 THEN v_owe_total := v_owe_total - v_net;
    ELSIF v_net > 0 THEN v_owed_total := v_owed_total + v_net;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'groups', v_groups,
    'totals', jsonb_build_object(
      'youOwe', v_owe_total,
      'owedToYou', v_owed_total,
      'net', v_owed_total - v_owe_total
    )
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.settle_recommended_debt(p_caller uuid, p_group_id uuid, p_receiver_id uuid, p_payment_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balances jsonb;
  v_amount numeric;
  v_method public.payment_method;
  v_settlement "Settlement";
BEGIN
  IF p_receiver_id = p_caller THEN
    RAISE EXCEPTION 'INVALID: You cannot pay yourself';
  END IF;

  BEGIN
    v_method := COALESCE(NULLIF(trim(p_payment_method), ''), 'cash')::public.payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID: Unknown payment method "%"', p_payment_method;
  END;

  -- One calculation per group at a time, so the same payment can't be recorded twice
  PERFORM pg_advisory_xact_lock(hashtext(p_group_id::text));

  -- Also checks that the group exists and the caller is a member
  v_balances := get_group_balances(p_caller, p_group_id);

  -- The amount comes from the recommended plan, never from the request
  SELECT (d->>'amount')::numeric INTO v_amount
  FROM jsonb_array_elements(v_balances->'plan') d
  WHERE (d->>'fromUserId')::uuid = p_caller
    AND (d->>'toUserId')::uuid = p_receiver_id;

  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'INVALID: You have no recommended payment to this member in this group';
  END IF;

  INSERT INTO "Settlement" ("groupId", "payerId", "receiverId", amount, status, "paymentMethod")
  VALUES (p_group_id, p_caller, p_receiver_id, v_amount, 'completed', v_method)
  RETURNING * INTO v_settlement;

  PERFORM log_group_activity(
    p_group_id, p_caller, 'settlement_recorded', 'settlement', v_settlement."settlementId",
    jsonb_build_object(
      'amount', v_settlement.amount,
      'payerId', v_settlement."payerId",
      'receiverId', v_settlement."receiverId",
      'paymentMethod', v_settlement."paymentMethod",
      'markedFromRecommendation', true
    )
  );

  RETURN jsonb_build_object(
    'settlement', to_jsonb(v_settlement),
    'balances', get_group_balances(p_caller, p_group_id)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.handle_group_owner_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public."Group_Member" ("groupId", "userId", "role")
  VALUES (NEW."groupId", NEW."createdBy", 'owner');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public."User" ("userId", "email", "name", "avatarUrl")
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invite_users_to_group(p_group_id uuid, p_user_ids uuid[])
 RETURNS TABLE(invitecode character varying, expiresat timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_email CITEXT;
  v_code VARCHAR(8);
  v_expires TIMESTAMPTZ;
BEGIN
  -- Verify requesting user is a member of the group
  IF NOT EXISTS (SELECT 1 FROM public."Group_Member" WHERE "groupId" = p_group_id AND "userId" = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized to invite users to this group.';
  END IF;

  -- Generate fresh 15-minute invite code
  v_code := substring(md5(random()::text) from 1 for 8);
  v_expires := now() + INTERVAL '15 minutes';

  -- Update Group record with code and expiration
  UPDATE public."Group"
  SET "inviteCode" = v_code,
      "inviteCodeExpiresAt" = v_expires
  WHERE "groupId" = p_group_id;

  -- Create invitation entries for each targeted user UUID
  FOREACH v_user_id IN ARRAY p_user_ids LOOP
    SELECT "email" INTO v_email FROM public."User" WHERE "userId" = v_user_id;

    IF v_email IS NOT NULL THEN
      INSERT INTO public."Group_Invitation" ("groupId", "invitedUserId", "invitedEmail", "invitedBy")
      VALUES (p_group_id, v_user_id, v_email, auth.uid())
      ON CONFLICT ("groupId", "invitedEmail") DO NOTHING;
    END IF;
  END LOOP;

  -- Return code so Edge Function / client can send it via email
  RETURN QUERY SELECT v_code, v_expires;
END;
$function$;

CREATE OR REPLACE FUNCTION public.join_group_by_code(p_caller uuid, p_invite_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$DECLARE
  v_group public."Group";
  v_member public."Group_Member";
  v_email text;
BEGIN
  -- Find the group using its invitation code
  SELECT *
  INTO v_group
  FROM public."Group"
  WHERE lower("inviteCode") = lower(p_invite_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Invalid invite code';
  END IF;

  -- Prevent joining archived groups
  IF COALESCE(v_group."isArchived", false) THEN
    RAISE EXCEPTION 'INVALID: This group is archived';
  END IF;

  -- Check group invitation code expiration
  IF v_group."inviteCodeExpiresAt" IS NOT NULL
     AND v_group."inviteCodeExpiresAt" < now() THEN
    RAISE EXCEPTION 'INVALID: This invite code has expired';
  END IF;

  -- Prevent duplicate membership
  IF EXISTS (
    SELECT 1
    FROM public."Group_Member"
    WHERE "groupId" = v_group."groupId"
      AND "userId" = p_caller
  ) THEN
    RAISE EXCEPTION 'CONFLICT: You are already a member of this group';
  END IF;

  -- Get the user's verified email
  SELECT lower(trim(email))
  INTO v_email
  FROM auth.users
  WHERE id = p_caller
    AND email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Please verify your email before joining';
  END IF;

  -- Confirm the email was specifically invited
  IF NOT EXISTS (
    SELECT 1
    FROM public."Group_Invitation"
    WHERE "groupId" = v_group."groupId"
      AND lower(trim("invitedEmail")) = v_email
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: This invitation was not sent to your email address';
  END IF;

  -- Add the invited user to the group
  INSERT INTO public."Group_Member" ("groupId", "userId")
  VALUES (v_group."groupId", p_caller)
  RETURNING * INTO v_member;

  -- Remove the invitation after successful joining
  DELETE FROM public."Group_Invitation"
  WHERE "groupId" = v_group."groupId"
    AND lower(trim("invitedEmail")) = v_email;

  -- Return the group and new membership
  RETURN jsonb_build_object(
    'group', to_jsonb(v_group),
    'member', to_jsonb(v_member)
  );
END;$function$;

CREATE OR REPLACE FUNCTION public.join_group_with_code(p_invite_code character varying)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id UUID;
  v_user_email CITEXT;
  v_is_invited BOOLEAN;
BEGIN
  SELECT "email" INTO v_user_email FROM public."User" WHERE "userId" = auth.uid();

  SELECT "groupId" INTO v_group_id
  FROM public."Group"
  WHERE "inviteCode" = p_invite_code
    AND "inviteCodeExpiresAt" > now()
    AND "isArchived" = false;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite code.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public."Group_Invitation"
    WHERE "groupId" = v_group_id
      AND ("invitedUserId" = auth.uid() OR "invitedEmail" = v_user_email)
  ) INTO v_is_invited;

  IF NOT v_is_invited THEN
    RAISE EXCEPTION 'Access denied: You have not been invited to this group.';
  END IF;

  INSERT INTO public."Group_Member" ("groupId", "userId", "role")
  VALUES (v_group_id, auth.uid(), 'member')
  ON CONFLICT ("groupId", "userId") DO NOTHING;

  DELETE FROM public."Group_Invitation"
  WHERE "groupId" = v_group_id AND ("invitedUserId" = auth.uid() OR "invitedEmail" = v_user_email);

  RETURN v_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_user_codes(p_query character varying, p_limit integer DEFAULT 15)
 RETURNS TABLE("userId" uuid, "userCode" character varying, name character varying, "avatarUrl" character varying)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT u."userId", u."userCode", u."name", u."avatarUrl"
  FROM public."User" u
  WHERE u."userCode" ILIKE p_query || '%'
  ORDER BY u."userCode" ASC
  LIMIT p_limit;
END;
$function$;

-- Function permissions, matching production ------------------------------
-- Server-only (called by edge functions with the service role):
revoke all on function public.assert_valid_expense(uuid, uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.create_expense_with_splits(uuid, uuid, uuid, text, numeric, timestamp with time zone, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.update_expense_with_splits(uuid, uuid, uuid, text, numeric, timestamp with time zone, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_group_with_admin(uuid, text) from public, anon, authenticated;
revoke all on function public.get_group_balances(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_my_balances(uuid) from public, anon, authenticated;
revoke all on function public.join_group_by_code(uuid, text) from public, anon, authenticated;
revoke all on function public.log_group_activity(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.settle_recommended_debt(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assert_valid_expense(uuid, uuid, numeric, jsonb) to service_role;
grant execute on function public.create_expense_with_splits(uuid, uuid, uuid, text, numeric, timestamp with time zone, text, text, jsonb) to service_role;
grant execute on function public.update_expense_with_splits(uuid, uuid, uuid, text, numeric, timestamp with time zone, text, text, jsonb) to service_role;
grant execute on function public.create_group_with_admin(uuid, text) to service_role;
grant execute on function public.get_group_balances(uuid, uuid) to service_role;
grant execute on function public.get_my_balances(uuid) to service_role;
grant execute on function public.join_group_by_code(uuid, text) to service_role;
grant execute on function public.log_group_activity(uuid, uuid, text, text, uuid, jsonb) to service_role;
grant execute on function public.settle_recommended_debt(uuid, uuid, uuid, text) to service_role;
-- Signed-in users only:
revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated, service_role;
grant execute on function public.shares_group_with(uuid) to authenticated, service_role;
-- (The rest keep Supabase's default: callable by everyone, as in production.)

-- Triggers ----------------------------------------------------------------
CREATE TRIGGER on_group_created_add_owner AFTER INSERT ON public."Group" FOR EACH ROW EXECUTE FUNCTION handle_group_owner_creation();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Row level security ------------------------------------------------------
alter table public."Expense" enable row level security;
alter table public."Expense_Split" enable row level security;
alter table public."Group" enable row level security;
alter table public."Group_Activity" enable row level security;
alter table public."Group_Invitation" enable row level security;
alter table public."Group_Member" enable row level security;
alter table public."Settlement" enable row level security;
alter table public."User" enable row level security;

create policy "Members can view expenses" on public."Expense" as permissive for select to authenticated using (is_group_member("groupId"));
create policy "Members can view expense splits" on public."Expense_Split" as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM "Expense" e
  WHERE ((e."expenseId" = "Expense_Split"."expenseId") AND is_group_member(e."groupId")))));
create policy "Group creators can update their groups" on public."Group" as permissive for update to authenticated using (("createdBy" = ( SELECT auth.uid() AS uid))) with check (("createdBy" = ( SELECT auth.uid() AS uid)));
create policy "Members can view their groups" on public."Group" as permissive for select to authenticated using (is_group_member("groupId"));
create policy "Members can view group activity" on public."Group_Activity" as permissive for select to authenticated using (is_group_member("groupId"));
create policy "Members and invitees can view invitations" on public."Group_Invitation" as permissive for select to authenticated using ((("invitedUserId" = ( SELECT auth.uid() AS uid)) OR is_group_member("groupId")));
create policy "Members can view group members" on public."Group_Member" as permissive for select to authenticated using (is_group_member("groupId"));
create policy "Members can view settlements" on public."Settlement" as permissive for select to authenticated using (is_group_member("groupId"));
create policy "Users can view themselves and group mates" on public."User" as permissive for select to authenticated using ((("userId" = ( SELECT auth.uid() AS uid)) OR shares_group_with("userId")));
create policy "Users update self" on public."User" as permissive for update to authenticated using (("userId" = auth.uid()));

-- Storage: receipt photos --------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Authenticated users can upload receipts" on storage.objects
  for insert to authenticated with check (bucket_id = 'receipts');
create policy "Anyone can view receipt photos" on storage.objects
  for select to public using (bucket_id = 'receipts');
