"use client";

import type { Settings, TestResult } from "@price-tracker/api/routers/settings";
import { env } from "@price-tracker/env/web";
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

/** Channel names as a person would read them in a result row. */
const CHANNEL_LABELS: Record<TestResult["name"], string> = {
  email: "Email",
  webhook: "Home Assistant",
};

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
 * What the test send did, one row per channel it actually tried.
 *
 * An empty list is not a failure and must not read like one: it means nothing
 * is configured to receive alerts, which is a legitimate state on a fresh
 * install and the same state the worker quietly does nothing in.
 */
function TestResults({ results }: { results: TestResult[] }) {
  if (results.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Nothing is configured to receive alerts, so nothing was sent. Turn on “Send alerts”, then
        fill in Home Assistant, tick email alerts, or both.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2 text-xs">
      {results.map((result) => (
        <li className="flex flex-col gap-0.5" key={result.name}>
          <span className="font-medium">
            {CHANNEL_LABELS[result.name]}:{" "}
            <span className={result.ok ? "text-primary" : "text-destructive"}>
              {result.ok ? "delivered" : "failed"}
            </span>
            {result.httpStatus === null ? null : ` (HTTP ${result.httpStatus})`}
          </span>
          <span className="break-all text-muted-foreground">{result.target}</span>
          {result.error ? <span className="text-destructive">{result.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Where alerts go, how noisy they are allowed to be, and a test send.
 *
 * Everything here is one row in `settings`, which the worker re-reads on every
 * check — nothing needs restarting after a save.
 *
 * The two channels are configured independently and reported independently.
 * "Send alerts" is the master switch over both; Home Assistant is on once its
 * URL and webhook id are filled in, email once its box is ticked.
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
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(settings.emailAlertsEnabled);
  const [cooldownMinutes, setCooldownMinutes] = useState(String(settings.cooldownMinutes));
  const [failureThreshold, setFailureThreshold] = useState(String(settings.failureThreshold));

  // Build-time flag, so it only decides what the page *offers*. Whether a mail
  // can actually be sent is decided server-side by `emailEnabled()`, which is
  // authoritative; the worst this can get wrong is offering a tick box on an
  // install whose key was removed after the image was built.
  const mailerConfigured = env.NEXT_PUBLIC_EMAIL_ENABLED;

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
      // Only the call itself failing is a toast. What each channel did is
      // rendered below the button instead, because two channels produce two
      // outcomes and a toast can only really carry one.
      onError: (error) => {
        toast.error(`Could not send: ${error.message}`);
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
        emailAlertsEnabled,
        failureThreshold: Number(failureThreshold),
        // Empty means "clear it", which is how alerting is switched off
        // without losing the thresholds you tuned.
        haUrl: haUrl.trim() === "" ? null : haUrl.trim(),
        haWebhookId: haWebhookId.trim() === "" ? null : haWebhookId.trim(),
      });
    },
    [
      alertsEnabled,
      cooldownMinutes,
      emailAlertsEnabled,
      failureThreshold,
      haUrl,
      haWebhookId,
      update,
    ]
  );

  const onSendTest = useCallback(() => {
    sendTest.mutate({});
  }, [sendTest]);

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
            The master switch. With it off nothing is sent on any channel, and no alert is
            remembered — so turning it back on does not release a backlog.
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
            Leave both empty to switch this channel off without losing anything else.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label className="gap-2">
            <Checkbox
              checked={emailAlertsEnabled}
              disabled={!mailerConfigured}
              onCheckedChange={setEmailAlertsEnabled}
            />
            Email alerts
          </Label>
          {/*
           * There is deliberately no box to type an address into. Alerts go to
           * the accounts on this tracker, read from the database at send time,
           * so a typed-in address would be a second copy of a fact that is
           * already known and would go stale the moment somebody changed it.
           */}
          <p className="text-muted-foreground text-xs">
            Alerts are emailed to the email address on your account. There is nothing to enter here
            — change the address on your account page and alerts follow it. Only verified addresses
            are used, so an unverified account receives nothing.
          </p>
          {mailerConfigured ? null : (
            <p className="text-muted-foreground text-xs">
              No mailer is configured on this instance, so this channel is unavailable. Set{" "}
              <code>RESEND_API_KEY</code> and restart to enable it.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={update.isPending} type="submit">
          {update.isPending ? "Saving…" : "Save settings"}
        </Button>
        <Button disabled={sendTest.isPending} onClick={onSendTest} type="button" variant="outline">
          <Send className={sendTest.isPending ? "animate-pulse" : undefined} />
          {sendTest.isPending ? "Sending…" : "Send test"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        The test uses the saved settings, so save before you send. It goes out on every configured
        channel and reports each one separately. Home Assistant answers 200 even when no automation
        is listening — a green result proves the URL and id, not that your phone will buzz.
      </p>
      {sendTest.data ? <TestResults results={sendTest.data} /> : null}
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
