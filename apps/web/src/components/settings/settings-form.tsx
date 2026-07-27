"use client";

import type { Settings } from "@price-tracker/api/routers/settings";
import { Button } from "@price-tracker/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@price-tracker/ui/components/card";
import { Checkbox } from "@price-tracker/ui/components/checkbox";
import { Input } from "@price-tracker/ui/components/input";
import { Label } from "@price-tracker/ui/components/label";
import { Skeleton } from "@price-tracker/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
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
 * Home Assistant config and the two alert thresholds, plus a test send.
 *
 * Everything here is one row in `settings`, which the worker re-reads on every
 * check — nothing needs restarting after a save.
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

  const sendTest = useMutation(
    orpc.settings.sendTest.mutationOptions({
      onError: (error) => {
        toast.error(`Could not send: ${error.message}`);
      },
      onSuccess: (result) => {
        if (result.ok) {
          toast.success(`Test notification accepted by ${result.target}.`);
        } else {
          toast.error(result.error ?? "The test notification was not delivered.");
        }
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

  const onSendTest = useCallback(() => {
    sendTest.mutate({});
  }, [sendTest]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Home Assistant</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" id="settings-form" onSubmit={onSubmit}>
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

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={update.isPending} type="submit">
                {update.isPending ? "Saving…" : "Save settings"}
              </Button>
              <Button
                disabled={sendTest.isPending}
                onClick={onSendTest}
                type="button"
                variant="outline"
              >
                <Send className={sendTest.isPending ? "animate-pulse" : undefined} />
                {sendTest.isPending ? "Sending…" : "Send test"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              The test uses the saved settings, so save before you send. Home Assistant answers 200
              even when no automation is listening — a green result proves the URL and id, not that
              your phone will buzz.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
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
