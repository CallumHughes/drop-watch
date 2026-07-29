"use client";

import type { Settings } from "@price-tracker/api/routers/settings";
import { Button } from "@price-tracker/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@price-tracker/ui/components/card";
import { Checkbox } from "@price-tracker/ui/components/checkbox";
import { Input } from "@price-tracker/ui/components/input";
import { Label } from "@price-tracker/ui/components/label";
import { Skeleton } from "@price-tracker/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useCallback, useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/** Native bounds mirroring the `settings.update` schema. */
const MIN_COOLDOWN_MINUTES = 60;
const MAX_COOLDOWN_MINUTES = 10_080;
const MIN_FAILURE_THRESHOLD = 2;
const MAX_FAILURE_THRESHOLD = 50;

function Field({
  children,
  hint,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label className="font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * The admin's half of settings: where the webhook goes and how noisy alerting
 * is allowed to be, instance-wide. The page only mounts this form for admins,
 * and the server enforces the role regardless — `settings.get` and
 * `settings.update` answer FORBIDDEN to anyone else.
 *
 * Everything here is one row in `settings`, which the worker re-reads on every
 * check — nothing needs restarting after a save.
 *
 * Whether alerts are *emailed* is not here: that became a per-account
 * preference, owned by `EmailPrefsForm` alongside this form on the settings
 * page — the test-send button lives there too, since it works for every
 * account, not just the admin's.
 */
function Editor({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const urlId = useId();
  const webhookId = useId();
  const cooldownId = useId();
  const thresholdId = useId();

  const [haUrl, setHaUrl] = useState(settings.haUrl ?? "");
  const [haWebhookId, setHaWebhookId] = useState(settings.haWebhookId ?? "");
  const [alertsEnabled, setAlertsEnabled] = useState(settings.alertsEnabled);
  const [cooldownMinutes, setCooldownMinutes] = useState(String(settings.cooldownMinutes));
  const [failureThreshold, setFailureThreshold] = useState(String(settings.failureThreshold));

  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onError: (error) => {
        toast.error(`Could not save: ${error.message}`);
      },
      onSuccess: () => {
        toast.success("Settings saved.");
        queryClient.invalidateQueries({ queryKey: orpc.settings.key() });
      },
    })
  );

  const onUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setHaUrl(event.target.value);
  }, []);
  const onWebhookChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setHaWebhookId(event.target.value);
  }, []);
  const onCooldownChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setCooldownMinutes(event.target.value);
  }, []);
  const onThresholdChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFailureThreshold(event.target.value);
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      update.mutate({
        alertsEnabled,
        cooldownMinutes: Number(cooldownMinutes),
        failureThreshold: Number(failureThreshold),
        // Empty means "clear it", which is how alerting is switched off
        // without losing the thresholds you tuned.
        haUrl: haUrl.trim() === "" ? null : haUrl.trim(),
        haWebhookId: haWebhookId.trim() === "" ? null : haWebhookId.trim(),
      });
    },
    [alertsEnabled, cooldownMinutes, failureThreshold, haUrl, haWebhookId, update]
  );

  return (
    <form className="flex flex-col gap-4" id="settings-form" onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              hint="Quiet period per product and rule after an alert fires."
              htmlFor={cooldownId}
              label="Alert cooldown (minutes)"
            >
              <Input
                id={cooldownId}
                max={MAX_COOLDOWN_MINUTES}
                min={MIN_COOLDOWN_MINUTES}
                onChange={onCooldownChange}
                required
                type="number"
                value={cooldownMinutes}
              />
            </Field>
            <Field
              hint='Consecutive failed checks before a "tracker broken" alert.'
              htmlFor={thresholdId}
              label="Failure threshold"
            >
              <Input
                id={thresholdId}
                max={MAX_FAILURE_THRESHOLD}
                min={MIN_FAILURE_THRESHOLD}
                onChange={onThresholdChange}
                required
                type="number"
                value={failureThreshold}
              />
            </Field>
          </div>

          <Label className="gap-2">
            <Checkbox checked={alertsEnabled} onCheckedChange={setAlertsEnabled} />
            Send alerts
          </Label>
          <p className="text-muted-foreground text-xs">
            The master switch, for every account. With it off nothing is sent on any channel to
            anyone, and no alert is remembered — so turning it back on does not release a backlog.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Home Assistant</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            hint="Base URL of your Home Assistant instance."
            htmlFor={urlId}
            label="Home Assistant URL"
          >
            <Input
              id={urlId}
              onChange={onUrlChange}
              placeholder="http://homeassistant.local:8123"
              type="url"
              value={haUrl}
            />
          </Field>

          <Field
            hint="Alerts POST to /api/webhook/<id>. Treat it as a secret."
            htmlFor={webhookId}
            label="Webhook id"
          >
            <Input
              id={webhookId}
              onChange={onWebhookChange}
              placeholder="price_tracker"
              value={haWebhookId}
            />
          </Field>
          <p className="text-muted-foreground text-xs">
            The webhook is the admin's channel: it fires only for products on your own account.
            Leave both fields empty to switch it off without losing anything else.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={update.isPending} type="submit">
          {update.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

export function SettingsForm() {
  const settings = useQuery(orpc.settings.get.queryOptions());

  if (settings.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!settings.data) {
    return <p className="text-muted-foreground text-sm">Settings could not be loaded.</p>;
  }

  // Remounted when the row changes so the inputs re-seed from the saved values
  // rather than holding stale local state.
  return <Editor key={settings.data.updatedAt.toISOString()} settings={settings.data} />;
}
