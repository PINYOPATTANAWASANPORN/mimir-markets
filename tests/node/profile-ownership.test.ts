import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProfile,
  findAgentOwner,
} from "../../lib/server/profile";
import type { AgentRecord } from "../../lib/db";
import type { DirectoryAgent } from "../../lib/server/agent-directory";
import type { AgentTradeRow } from "../../lib/agents/performance";

function makeFakeRecord(
  index: number,
  ownerWallet: string,
): AgentRecord {
  return {
    schemaVersion: 1,
    agentId: `agent-${index}`,
    ownerWallet,
    operatorWallet: `GB_OPERATOR_${index}`,
    payoutWallet: `GB_PAYOUT_${index}`,
    displayName: `Agent ${index}`,
    description: `Automated agent number ${index}`,
    capabilities: ["trading"],
    authorityLevel: 1,
    limits: {},
    status: "active",
    reputationBps: 5000,
    createdAt: 1700000000 + index * 1000,
    updatedAt: 1700000000 + index * 1000,
  };
}

const OWNER_A = "GBAHBL3NSW3KH3HZENA4H6NKTWLDZESHQLNAB2O5HORMZH6GK5FWTTKO";
const OWNER_B = "GBKAYYLD3NZ2JKDCS4ZSI4MTDQCTTR37CTXAFZBHAT7APSEPNSBV4V6N";

// Generate 300 records to prove coverage well beyond the 200-row limit
const ALL_RECORDS: AgentRecord[] = Array.from({ length: 300 }, (_, i) => {
  // Let owner A own agents 0, 50, 150, 240, 280 (several beyond the 200th row)
  const isOwnerA = [0, 50, 150, 240, 280].includes(i);
  return makeFakeRecord(i, isOwnerA ? OWNER_A : OWNER_B);
});

test("findAgentOwner resolves owner for agents beyond the 200th row", async () => {
  const getAgentRecord = async (agentId: string) => {
    return ALL_RECORDS.find((r) => r.agentId === agentId) ?? null;
  };

  // Row 240 is beyond the older 200-row scan limit
  const owner240 = await findAgentOwner("agent-240", { getAgentRecord });
  assert.equal(owner240, OWNER_A);

  const owner280 = await findAgentOwner("agent-280", { getAgentRecord });
  assert.equal(owner280, OWNER_A);

  // Non-existent agent returns null
  const missing = await findAgentOwner("agent-999", { getAgentRecord });
  assert.equal(missing, null);
});

test("buildProfile lists every owned agent including rows beyond 200", async () => {
  const listDirectoryAgents = async (): Promise<DirectoryAgent[]> => {
    return [0, 50, 150, 240, 280].map((i) => ({
      id: `agent-${i}`,
      name: `Agent ${i}`,
      description: `Description ${i}`,
      address: `GA_WALLET_AGENT_${i}`,
      category: "prediction",
      status: "active",
    }));
  };

  const listAgentRecordsByOwner = async (ownerWallet: string): Promise<AgentRecord[]> => {
    return ALL_RECORDS.filter((r) => r.ownerWallet === ownerWallet);
  };

  const getAgentTradeRows = async (): Promise<AgentTradeRow[]> => [];

  const profile = await buildProfile(OWNER_A, "all", Date.now(), {
    listDirectoryAgents,
    listAgentRecordsByOwner,
    getAgentTradeRows,
  });

  assert.notEqual(profile, null);
  assert.equal(profile?.address, OWNER_A);
  assert.equal(profile?.ownedAgents.length, 5);

  const ownedIds = profile?.ownedAgents.map((a) => a.id);
  assert.deepEqual(ownedIds, [
    "agent-0",
    "agent-50",
    "agent-150",
    "agent-240",
    "agent-280",
  ]);
});

test("exact Stellar address casing is preserved", async () => {
  const listDirectoryAgents = async () => [];
  const listAgentRecordsByOwner = async () => [];
  const getAgentTradeRows = async () => [];

  const profile = await buildProfile(OWNER_A, "all", Date.now(), {
    listDirectoryAgents,
    listAgentRecordsByOwner,
    getAgentTradeRows,
  });

  assert.notEqual(profile, null);
  assert.equal(profile?.address, OWNER_A);
});
