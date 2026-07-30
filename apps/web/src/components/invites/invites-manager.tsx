"use client";

import type { PendingInvite } from "@drop-watch/api/routers/invites";
import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Input } from "@drop-watch/ui/components/input";
import { Label } from "@drop-watch/ui/components/label";
import { Skeleton } from "@drop-watch/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useId, useState } from "react";
import { toast } from "sonner";

import { formatDateTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/**
 * The invite link the admin most recently created, shown until the next one
 * replaces it.
 *
 * It is rendered as selectable text and not only piped to the clipboard,
 * because on mailer-less installs this reveal *is* the delivery mechanism —
 * the admin pastes it into whatever channel reaches the invitee. This is also
 * the only moment the raw token is visible anywhere: the server stores a hash,
 * so a link not copied now is a link regenerated later.
 */
function RevealedLink({ email, url }: { email: string; url: string }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Could not copy — select the link text instead."));
  }, [url]);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-xs">
      <span className="text-muted-foreground">
        Invite link for <span className="font-medium text-foreground">{email}</span>:
      </span>
      <code className="break-all" data-testid="invite-url">
        {url}
      </code>
      <div>
        <Button onClick={handleCopy} size="sm" type="button" variant="outline">
          <Copy />
          Copy link
        </Button>
      </div>
    </div>
  );
}

function InviteRow({
  invite,
  onRegenerate,
  onRevoke,
  pending,
}: {
  invite: PendingInvite;
  onRegenerate: (email: string) => void;
  onRevoke: (id: string) => void;
  pending: boolean;
}) {
  const handleRegenerate = useCallback(
    () => onRegenerate(invite.email),
    [invite.email, onRegenerate]
  );
  const handleRevoke = useCallback(() => onRevoke(invite.id), [invite.id, onRevoke]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-sm last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 break-all font-medium">
          {invite.email}
          {invite.expired ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
              Expired
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground text-xs">
          Created {formatDateTime(invite.createdAt)} · {invite.expired ? "expired" : "expires"}{" "}
          {formatDateTime(invite.expiresAt)}
        </span>
      </div>
      <div className="flex gap-2">
        {/* "Regenerate" is just `create` again: the server deletes the pending
            invite for the address and mints a fresh link, so this is also how
            an expired invite comes back to life. */}
        <Button disabled={pending} onClick={handleRegenerate} size="sm" variant="outline">
          Regenerate link
        </Button>
        <Button disabled={pending} onClick={handleRevoke} size="sm" variant="destructive">
          Revoke
        </Button>
      </div>
    </li>
  );
}

/**
 * The admin's invite desk: issue a link, see what is outstanding, pull one
 * back.
 *
 * Every action funnels through `invites.create` / `invites.revoke`, which
 * re-check the admin role server-side — this component being reachable is
 * navigation, not authorization.
 */
export function InvitesManager() {
  const queryClient = useQueryClient();
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [revealed, setRevealed] = useState<{ email: string; url: string } | null>(null);

  const invites = useQuery(orpc.invites.list.queryOptions());

  const create = useMutation(
    orpc.invites.create.mutationOptions({
      onError: (error) => {
        toast.error(`Could not create invite: ${error.message}`);
      },
      onSuccess: (result, variables) => {
        if ("error" in result) {
          toast.error("That address already has an account.");
          return;
        }
        if (result.emailed) {
          toast.success("Invite sent");
        } else if (result.emailError) {
          toast.warning("Invite created, but the email failed to send — copy the link below.");
        } else {
          toast.success("Invite created");
        }
        setRevealed({ email: variables.email, url: result.url });
        setEmail("");
        queryClient.invalidateQueries({ queryKey: orpc.invites.list.key() });
      },
    })
  );

  const revoke = useMutation(
    orpc.invites.revoke.mutationOptions({
      onError: (error) => {
        toast.error(`Could not revoke: ${error.message}`);
      },
      onSuccess: () => {
        toast.success("Invite revoked");
        queryClient.invalidateQueries({ queryKey: orpc.invites.list.key() });
      },
    })
  );

  const handleEmailChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      create.mutate({ email: email.trim() });
    },
    [create, email]
  );

  const handleRegenerate = useCallback(
    (address: string) => {
      create.mutate({ email: address });
    },
    [create]
  );

  const handleRevoke = useCallback(
    (id: string) => {
      revoke.mutate({ id });
    },
    [revoke]
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-wrap items-end gap-2" onSubmit={handleSubmit}>
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label className="text-xs" htmlFor={emailId}>
                Email
              </Label>
              <Input
                id={emailId}
                onChange={handleEmailChange}
                placeholder="them@example.com"
                required
                type="email"
                value={email}
              />
            </div>
            <Button disabled={create.isPending} type="submit">
              {create.isPending ? "Inviting…" : "Invite"}
            </Button>
          </form>
          {revealed ? <RevealedLink email={revealed.email} url={revealed.url} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.isPending ? <Skeleton className="h-24 w-full" /> : null}
          {invites.data && invites.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No pending invites. Anyone you invite shows up here until they accept.
            </p>
          ) : null}
          {invites.data && invites.data.length > 0 ? (
            <ul>
              {invites.data.map((invite) => (
                <InviteRow
                  invite={invite}
                  key={invite.id}
                  onRegenerate={handleRegenerate}
                  onRevoke={handleRevoke}
                  pending={create.isPending || revoke.isPending}
                />
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
