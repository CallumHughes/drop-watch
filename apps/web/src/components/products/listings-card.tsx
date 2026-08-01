"use client";

import type { ListingSummary } from "@drop-watch/api/routers/products";
import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Checkbox } from "@drop-watch/ui/components/checkbox";
import { Label } from "@drop-watch/ui/components/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@drop-watch/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { formatAvailability, formatPrice, productHost } from "@/lib/format";
import { orpc } from "@/utils/orpc";

import { AddListingForm } from "./add-listing-form";
import { CheckNowButton } from "./check-now-button";
import { ListingSettingsForm } from "./listing-settings-form";
import { StatusBadge } from "./status-badge";

/** One store: what it costs, whether it is healthy, and its controls. */
function ListingRow({ summary }: { summary: ListingSummary }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const { latest, listing } = summary;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: orpc.products.key() });
  }, [queryClient]);

  const toggleActive = useMutation(
    orpc.listings.update.mutationOptions({
      onError: (error) => {
        toast.error(`Could not update: ${error.message}`);
      },
      onSuccess: invalidate,
    })
  );
  const onToggleActive = useCallback(
    (active: boolean) => {
      toggleActive.mutate({ active, id: listing.id });
    },
    [listing.id, toggleActive]
  );

  const remove = useMutation(
    orpc.listings.remove.mutationOptions({
      onError: (error) => {
        // Includes the CONFLICT case — the server's message already explains
        // "this is the last listing" in words a user can act on.
        toast.error(error.message);
      },
      onSuccess: () => {
        toast.success("Store removed.");
        invalidate();
      },
    })
  );
  const startRemove = useCallback(() => setConfirmingRemove(true), []);
  const cancelRemove = useCallback(() => setConfirmingRemove(false), []);
  const confirmRemove = useCallback(() => {
    remove.mutate({ id: listing.id });
  }, [listing.id, remove]);

  const toggleEditing = useCallback(() => setEditing((current) => !current), []);
  const onSaved = useCallback(() => setEditing(false), []);

  return (
    <div className="flex flex-col gap-2 border-foreground/10 border-b py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <a
          className="inline-flex items-center gap-1 text-xs hover:underline"
          href={listing.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          {productHost(listing.url)}
          <ExternalLink className="size-3" />
        </a>
        <span className="text-sm tabular-nums">
          {latest ? formatPrice(latest.price, latest.currency) : "—"}
        </span>
        <span className="text-muted-foreground text-xs">
          {latest ? formatAvailability(latest.availability, latest.inStock) : "—"}
        </span>
        <StatusBadge
          active={listing.active}
          consecutiveFailures={summary.consecutiveFailures}
          lastStatus={summary.lastCheck?.status ?? null}
        />

        <div className="ml-auto flex items-center gap-2">
          <Label className="gap-1.5 text-muted-foreground">
            <Checkbox checked={listing.active} onCheckedChange={onToggleActive} />
            Active
          </Label>
          <CheckNowButton size="sm" target={{ kind: "listing", listingId: listing.id }} />
          <Button onClick={toggleEditing} size="sm" variant="outline">
            {editing ? "Close" : "Edit"}
          </Button>
          {confirmingRemove ? (
            <>
              <Button onClick={cancelRemove} size="sm" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={remove.isPending}
                onClick={confirmRemove}
                size="sm"
                variant="destructive"
              >
                {remove.isPending ? "Removing…" : "Confirm remove"}
              </Button>
            </>
          ) : (
            <Button onClick={startRemove} size="sm" variant="ghost">
              Remove
            </Button>
          )}
        </div>
      </div>

      {editing ? <ListingSettingsForm listing={listing} onSaved={onSaved} /> : null}
    </div>
  );
}

/**
 * Every store tracking one product: a row each, plus the affordance to add
 * another. This is where a listing is paused, edited or dropped — the header
 * above only ever acts on the whole product.
 */
export function ListingsCard({
  listings,
  productId,
}: {
  listings: readonly ListingSummary[];
  productId: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const closeAdd = useCallback(() => setAddOpen(false), []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Listings</CardTitle>
        <Sheet onOpenChange={setAddOpen} open={addOpen}>
          <SheetTrigger render={<Button size="sm" variant="outline" />}>
            <Plus className="size-3.5" />
            Add store
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add a store</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4">
              <AddListingForm onSuccess={closeAdd} productId={productId} />
            </div>
          </SheetContent>
        </Sheet>
      </CardHeader>
      <CardContent>
        {listings.map((summary) => (
          <ListingRow key={summary.listing.id} summary={summary} />
        ))}
      </CardContent>
    </Card>
  );
}
