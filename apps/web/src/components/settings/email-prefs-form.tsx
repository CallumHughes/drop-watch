"use client";

import type { TestResult } from "@price-tracker/api/routers/settings";
import { env } from "@price-tracker/env/web";
import { Button } from "@price-tracker/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@price-tracker/ui/components/card";
import { Checkbox } from "@price-tracker/ui/components/checkbox";
import { Label } from "@price-tracker/ui/components/label";
import { Skeleton } from "@price-tracker/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/** Channel names as a person would read them in a result row. */
const CHANNEL_LABELS: Record<TestResult["name"], string> = {
  email: "Email",
  webhook: "Home Assistant",
};

/**
 * What the test send did, one row per channel it actually tried.
 *
 * An empty list is not a failure and must not read like one: it means nothing
 * is configured to receive alerts for this account, which is a legitimate
 * state on a fresh account and the same state the worker quietly does nothing
 * in.
 */
function TestResults({ results }: { results: TestResult[] }) {
  if (results.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Nothing is configured to receive alerts for your account, so nothing was sent. Tick email
        alerts above, or ask the admin whether alerting is switched on.
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
 * The signed-in account's own slice of alerting: whether alerts for *their*
 * products are emailed to *them*, plus the test-send button — which lives
 * here rather than on the admin form because every account can test its own
 * channels, and a test resolves exactly the channels that account's real
 * alerts would use.
 */
function Editor({ emailAlertsEnabled: saved }: { emailAlertsEnabled: boolean }) {
  const queryClient = useQueryClient();
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(saved);

  // Build-time flag, so it only decides what the page *offers*. Whether a mail
  // can actually be sent is decided server-side by `emailEnabled()`, which is
  // authoritative; the worst this can get wrong is offering a tick box on an
  // install whose key was removed after the image was built.
  const mailerConfigured = env.NEXT_PUBLIC_EMAIL_ENABLED;

  const update = useMutation(
    orpc.settings.updateEmailPrefs.mutationOptions({
      onError: (error) => {
        toast.error(`Could not save: ${error.message}`);
      },
      onSuccess: () => {
        toast.success("Email preference saved.");
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

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      update.mutate({ emailAlertsEnabled });
    },
    [emailAlertsEnabled, update]
  );

  const onSendTest = useCallback(() => {
    sendTest.mutate({});
  }, [sendTest]);

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
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
           * There is deliberately no box to type an address into. Alerts for
           * your products go to your account's address, read from the
           * database at send time, so a typed-in address would be a second
           * copy of a fact that is already known and would go stale the
           * moment you changed it.
           */}
          <p className="text-muted-foreground text-xs">
            Alerts for your products are emailed to the address on your account. There is nothing to
            enter here — change the address on your account page and alerts follow it. Only verified
            addresses are used, so an unverified account receives nothing.
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
          {update.isPending ? "Saving…" : "Save email preference"}
        </Button>
        <Button disabled={sendTest.isPending} onClick={onSendTest} type="button" variant="outline">
          <Send className={sendTest.isPending ? "animate-pulse" : undefined} />
          {sendTest.isPending ? "Sending…" : "Send test"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        The test uses the saved settings, so save before you send. It goes out on every channel your
        real alerts would use and reports each one separately. Home Assistant answers 200 even when
        no automation is listening — a green result proves the URL and id, not that your phone will
        buzz.
      </p>
      {sendTest.data ? <TestResults results={sendTest.data} /> : null}
    </form>
  );
}

export function EmailPrefsForm() {
  const prefs = useQuery(orpc.settings.emailPrefs.queryOptions());

  if (prefs.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (!prefs.data) {
    return <p className="text-muted-foreground text-sm">Email preferences could not be loaded.</p>;
  }

  // Remounted when the saved value changes so the checkbox re-seeds from the
  // server rather than holding stale local state.
  return (
    <Editor
      emailAlertsEnabled={prefs.data.emailAlertsEnabled}
      key={String(prefs.data.emailAlertsEnabled)}
    />
  );
}
