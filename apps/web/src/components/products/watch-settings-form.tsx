"use client";

import type { Product } from "@drop-watch/api/routers/products";
import {
  MAX_DROP_PERCENT,
  MAX_TITLE_LENGTH,
  MIN_DROP_PERCENT,
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
 * Identity and alert configuration — title, active, rules, target and drop
 * threshold. Schedule and extraction are per listing now and live in
 * `ListingSettingsForm` instead: a product can have several listings, each on
 * its own schedule, so there is no longer one interval to set here.
 */
export function WatchSettingsForm({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const targetId = useId();
  const dropId = useId();
  const [active, setActive] = useState(product.active);
  const [title, setTitle] = useState(product.title ?? "");
  const [targetPrice, setTargetPrice] = useState(product.targetPrice ?? "");
  const [dropPercent, setDropPercent] = useState(product.dropPercent?.toString() ?? "");
  const [rules, setRules] = useState<AlertRule[]>(product.rules);

  const updateProduct = useMutation(orpc.products.update.mutationOptions());

  const onTitleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
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
      updateProduct
        .mutateAsync({
          active,
          dropPercent: dropPercent === "" ? null : Number(dropPercent),
          id: product.id,
          rules,
          targetPrice: targetPrice === "" ? null : targetPrice,
          title: title.trim() === "" ? undefined : title.trim(),
        })
        .then(() => {
          toast.success("Watch settings saved.");
          queryClient.invalidateQueries({ queryKey: orpc.products.key() });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          toast.error(`Could not save: ${message}`);
        });
    },
    [active, dropPercent, product.id, queryClient, rules, targetPrice, title, updateProduct]
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor={titleId} label="Title">
          <Input
            id={titleId}
            maxLength={MAX_TITLE_LENGTH}
            onChange={onTitleChange}
            placeholder="derived from the URL"
            value={title}
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
        <Button disabled={updateProduct.isPending} type="submit">
          {updateProduct.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
