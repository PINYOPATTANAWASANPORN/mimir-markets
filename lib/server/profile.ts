/**
 * Whoever is behind an address.
 *
 * Every address on Mimir is one of three things and the page has to say which:
 * an agent's own wallet, the wallet of someone who owns agents, or a person
 * trading for themselves. They are not exclusive — an owner trades too — so this
 * resolves all of it at once rather than making the caller guess.
 *
 * Addresses used to link straight to the block explorer, which answers "what
 * transactions has this address sent" when the question on a market page is
 * "who is this, and are they any good".
 */


import {
  computeAgentPerformance, windowSinceMs,
  type AgentPerformance, type AgentTradeResult, type AgentTradeRow, type TimeWindow,
} from "@/lib/agents/performance";
import type { AgentRecord } from "@/lib/db";
import type { DirectoryAgent } from "./agent-directory";
import { parseAddressParam } from "./api-validation";

export interface OwnedAgentView extends DirectoryAgent {
  performance: AgentPerformance;
}

export interface ProfileView {
  /** A Stellar strkey — `G…` account or `C…` contract — exactly as validated. */
  address: string;
  /** Set when this address IS an agent rather than a person. */
  agent: DirectoryAgent | null;
  /** Agents registered to this address as owner. */
  ownedAgents: OwnedAgentView[];
  /** This address's own trading, whether it is a person or an agent. */
  performance: AgentPerformance;
  results: AgentTradeResult[];
  /** Everything the owned agents realised, summed. */
  agentsRealisedPnlAtomic: bigint;
  agentsSettled: number;
}

export interface ProfileDependencies {
  listDirectoryAgents?: () => Promise<DirectoryAgent[]>;
  listAgentRecordsByOwner?: (ownerWallet: string) => Promise<AgentRecord[]>;
  getAgentTradeRows?: (address: string) => Promise<AgentTradeRow[]>;
}

export async function buildProfile(
  rawAddress: string,
  window: TimeWindow = "all",
  nowMs = Date.now(),
  deps: ProfileDependencies = {},
): Promise<ProfileView | null> {
  // A Stellar strkey, used verbatim from here on. The `/^0x…{40}$/` guard this
  // replaced rejected every real address, so every profile page returned null;
  // the `toLowerCase()` next to it would then have matched no stored row anyway.
  const address = parseAddressParam(rawAddress);
  if (!address) return null;
  const sinceMs = windowSinceMs(window, nowMs);

  const fetchDirectory =
    deps.listDirectoryAgents ??
    (async () => {
      const { listDirectoryAgents } = await import("./agent-directory");
      return listDirectoryAgents();
    });

  const fetchRecords =
    deps.listAgentRecordsByOwner ??
    (async (wallet: string) => {
      const { listAgentRecordsByOwner } = await import("@/lib/db");
      return listAgentRecordsByOwner(wallet);
    });

  const fetchTradeRows =
    deps.getAgentTradeRows ??
    (async (addr: string) => {
      const { getAgentTradeRows } = await import("@/lib/db");
      return getAgentTradeRows(addr);
    });

  const [directory, records, ownRows] = await Promise.all([
    fetchDirectory().catch(() => []),
    fetchRecords(address).catch(() => []),
    fetchTradeRows(address).catch(() => []),
  ]);

  const agent = directory.find((candidate) => candidate.address === address) ?? null;

  // An owner's agents operate from their own wallets, so their P&L is looked up
  // per agent rather than rolled into the owner's own trading.
  // Match owned agents directly against the registered records for this owner.
  const ownedIdSet = new Set(records.map((r) => r.agentId));
  const owned = directory.filter((candidate) => ownedIdSet.has(candidate.id));
  const ownedRows = await Promise.all(
    owned.map((candidate) => fetchTradeRows(candidate.address).catch(() => [])),
  );

  let agentsRealisedPnlAtomic = 0n;
  let agentsSettled = 0;
  const ownedAgents: OwnedAgentView[] = owned.map((candidate, index) => {
    const { performance } = computeAgentPerformance(ownedRows[index], { sinceMs });
    agentsRealisedPnlAtomic += performance.realisedPnlAtomic;
    agentsSettled += performance.settled;
    return { ...candidate, performance };
  });

  const { performance, results } = computeAgentPerformance(ownRows, { sinceMs });

  return {
    address,
    agent,
    ownedAgents,
    performance,
    results: results.sort((a, b) => b.claimId - a.claimId),
    agentsRealisedPnlAtomic,
    agentsSettled,
  };
}

export interface FindAgentOwnerDependencies {
  getAgentRecord?: (agentId: string) => Promise<AgentRecord | null>;
}

/** Owner wallet for an agent id, for the "created by" line on an agent page. */
export async function findAgentOwner(
  agentId: string,
  deps: FindAgentOwnerDependencies = {},
): Promise<string | null> {
  const fetchRecord =
    deps.getAgentRecord ??
    (async (id: string) => {
      const { getAgentRecord } = await import("@/lib/db");
      return getAgentRecord(id);
    });
  const record = await fetchRecord(agentId).catch(() => null);
  return record?.ownerWallet ?? null;
}
