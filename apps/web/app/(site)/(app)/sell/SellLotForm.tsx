"use client";
import { useState } from "react";
import type { FieldSpec } from "../../../../lib/forms.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { createLot } from "./actions.ts";

/** New-lot form; picking another product swaps in that product's quality fields and units. */
export function SellLotForm({ fieldsByProduct, initialProduct, submit }: { fieldsByProduct: Record<string, FieldSpec[]>; initialProduct: string; submit: string }) {
  const [productId, setProductId] = useState(initialProduct);
  return (
    <ActionForm action={createLot} submit={submit} fields={fieldsByProduct[productId] ?? []}
      onFieldChange={(name, value) => { if (name === "productId" && value in fieldsByProduct) setProductId(value); }} />
  );
}
