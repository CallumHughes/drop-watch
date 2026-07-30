"use client";

import type { Product } from "@drop-watch/api/routers/products";
import {
  MAX_DROP_PERCENT,
  MAX_INTERVAL_MINUTES,
  MAX_JITTER_PERCENT,
  MIN_DROP_PERCENT,
  MIN_INTERVAL_MINUTES,
} from "@drop-watch/api/schemas/products";
import { Button } from "@drop-watch/ui/components/button";
import { Checkbox } from "@drop-watch/ui/components/checkbox";
import { Input } from "@drop-watch/ui/components/input";
import { Label } from "@drop-watch/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useCallback, useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

type AlertRule = Product["rules"][number];

const RULE_OPTIONS: readonly { hint: string; label: string; value: AlertRule }[] = [
  { hint: "price at or below the target", label: "Target", value: "target" },
  { hint: "price falls by the drop percentage", label: "Price drop", value: "drop_percent" },
  { hint: "out of stock becomes in stock", label: "Restock", value: "restock" },
];

function RuleToggle({
  checked,
  onToggle,
  option,
}: {
  checked: boolean;
  onToggle: (rule: AlertRule, checked: boolean) => void;
  option: (typeof RULE_OPTIONS)[number];
}) {
  const handleChange = useCallback(
    (next: boolean) => onToggle(option.value, next),
    [onToggle, option.value]
  );
  return (
    <Label className="items-start gap-2">
      <Checkbox checked={checked} onCheckedChange={handleChange} />
      <span>
        {option.label}
        <span className="block text-muted-foreground">{option.hint}</span>
      </span>
    </Label>
  );
}

/**
 * A labelled control. The caller owns the id and hands the same one to its
 * input, which is what makes the label actually address the control rather
 * than merely sit above it.
 */
function Field({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label className="text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Interval, jitter and alert thresholds. Saving writes straight to `products`;
 * the worker reads the new interval on the product's next reschedule, so there
 * is nothing to notify — Postgres is the interface (PLAN.md §1).
 */
export function WatchSettingsForm({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const intervalId = useId();
  const jitterId = useId();
  const targetId = useId();
  const dropId = useId();
  const [active, setActive] = useState(product.active);
  const [intervalMinutes, setIntervalMinutes] = useState(String(product.intervalMinutes));
  const [jitterPercent, setJitterPercent] = useState(String(product.jitterPercent));
  const [targetPrice, setTargetPrice] = useState(product.targetPrice ?? "");
  const [dropPercent, setDropPercent] = useState(product.dropPercent?.toString() ?? "");
  const [rules, setRules] = useState<AlertRule[]>(product.rules);

  const update = useMutation(
    orpc.products.update.mutationOptions({
      onError: (error) => {
        toast.error(`Could not save: ${error.message}`);
      },
      onSuccess: () => {
        toast.success("Watch settings saved.");
        queryClient.invalidateQueries({ queryKey: orpc.products.key() });
      },
    })
  );

  const onIntervalChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setIntervalMinutes(event.target.value);
  }, []);
  const onJitterChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setJitterPercent(event.target.value);
  }, []);
  const onTargetChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setTargetPrice(event.target.value);
  }, []);
  const onDropChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDropPercent(event.target.value);
  }, []);

  const toggleRule = useCallback((rule: AlertRule, checked: boolean) => {
    setRules((current) =>
      checked ? [...current, rule] : current.filter((existing) => existing !== rule)
    );
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      update.mutate({
        active,
        dropPercent: dropPercent === "" ? null : Number(dropPercent),
        id: product.id,
        intervalMinutes: Number(intervalMinutes),
        jitterPercent: Number(jitterPercent),
        rules,
        targetPrice: targetPrice === "" ? null : targetPrice,
      });
    },
    [active, dropPercent, intervalMinutes, jitterPercent, product.id, rules, targetPrice, update]
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor={intervalId} label="Check every (minutes)">
          <Input
            id={intervalId}
            max={MAX_INTERVAL_MINUTES}
            min={MIN_INTERVAL_MINUTES}
            onChange={onIntervalChange}
            required
            type="number"
            value={intervalMinutes}
          />
        </Field>
        <Field htmlFor={jitterId} label="Jitter (%)">
          <Input
            id={jitterId}
            max={MAX_JITTER_PERCENT}
            min={0}
            onChange={onJitterChange}
            required
            type="number"
            value={jitterPercent}
          />
        </Field>
        <Field
          htmlFor={targetId}
          label={`Target price (${product.currency ?? "unknown currency"})`}
        >
          <Input
            id={targetId}
            inputMode="decimal"
            onChange={onTargetChange}
            placeholder="none"
            value={targetPrice}
          />
        </Field>
        <Field htmlFor={dropId} label="Drop alert threshold (%)">
          <Input
            id={dropId}
            max={MAX_DROP_PERCENT}
            min={MIN_DROP_PERCENT}
            onChange={onDropChange}
            placeholder="none"
            type="number"
            value={dropPercent}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-muted-foreground text-xs">Alert rules</legend>
        {RULE_OPTIONS.map((option) => (
          <RuleToggle
            checked={rules.includes(option.value)}
            key={option.value}
            onToggle={toggleRule}
            option={option}
          />
        ))}
      </fieldset>

      <Label className="gap-2">
        <Checkbox checked={active} onCheckedChange={setActive} />
        Actively tracked
      </Label>

      <div>
        <Button disabled={update.isPending} type="submit">
          {update.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
