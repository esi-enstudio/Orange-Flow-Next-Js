"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { DEFAULT_SERIAL_LENGTH } from "@/lib/serialValidation";

/**
 * Configurable SIM serial digit length, sourced from System Settings.
 * Cached at module level so all DMS pages share a single fetch per session.
 */
let cachedLength: number | null = null;
const listeners = new Set<(value: number) => void>();

function publish(value: number) {
  cachedLength = value;
  listeners.forEach((fn) => fn(value));
}

/** Update the cached value (e.g. after saving in System Settings). */
export function setSerialLengthCache(value: number) {
  publish(value);
}

/** Force a refetch of the configured serial length. */
export async function refreshSerialLength(): Promise<number> {
  const res = await apiClient.get("settings/sim-serial");
  const value = Number(res.data?.serial_length);
  if (Number.isFinite(value) && value > 0) {
    publish(value);
    return value;
  }
  return DEFAULT_SERIAL_LENGTH;
}

export function useSerialLength(): number {
  const [serialLength, setSerialLength] = useState<number>(
    cachedLength ?? DEFAULT_SERIAL_LENGTH
  );

  useEffect(() => {
    if (cachedLength !== null) {
      setSerialLength(cachedLength);
      return;
    }

    let active = true;
    const listener = (value: number) => {
      if (active) setSerialLength(value);
    };
    listeners.add(listener);

    refreshSerialLength()
      .then((value) => {
        if (active) setSerialLength(value);
      })
      .catch(() => {});

    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  return serialLength;
}
