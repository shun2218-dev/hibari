"use client";

import { useContext } from "react";

import { type ChannelLinks, ChannelLinksContext } from "@/providers/channel-links-provider";

/** 本文の `<#ID>` を描くためのチャンネルの表とリンク先（ADR 0062）。ChannelLinksProvider の外では空の表。 */
export function useChannelLinks(): ChannelLinks {
  return useContext(ChannelLinksContext);
}
